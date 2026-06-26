/**
 * Execution Plan Manager — 执行计划管理与推进
 *
 * 负责：
 *   - 根据任务 profile 构建自动化执行计划 (inspect -> plan -> implement -> verify)
 *   - 监听工具调用结果，根据谓词完成/启动任务
 *   - 生成面向 LLM 的计划状态提示
 *
 * 原为 ReActAgent 内联的 #createAutomaticExecutionPlan / #advanceAutomaticPlan /
 * #buildExecutionPlanPrompt / #isWorkspaceInspectionTool 等一大组方法。
 */

import { ExecutionPlan, TaskStatus, GraphPlanner } from '../../../planner/graph-planner.js';
import {
  isMutation as isSemanticsMutation,
  isInspection as isSemanticsInspection,
} from './support/tool-semantics.js';
import { shouldEnablePlan } from './support/task-profile.js';
import { PlanType, selectPlanType } from './support/plan-types.js';

// ============== 工具谓词：统一委托给 tool-semantics 模块 ==============

export function isWorkspaceInspectionTool(toolName, args) {
  // 先检查是否是检查类工具
  if (isSemanticsInspection(toolName)) {
    return true;
  }
  // Shell 命令需要检查命令内容
  if (toolName === 'shell') {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    // 只读命令模式
    const readonlyPatterns =
      /\b(ls|cat|grep|rg|find|pwd|tree|stat|head|tail|wc|which|whereis|echo|print)\b/;
    if (readonlyPatterns.test(command)) {
      return true;
    }
    // git 只读子命令
    if (
      /^git\s+(log|status|diff|show|branch|tag|rev-parse|config\s+--list|remote\s+-v)\b/.test(
        command,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function isPlanningTool(toolName) {
  return [
    'brainstorm',
    'grill',
    'zoom_out',
    'tdd',
    'to_prd',
    'to_issues',
    'architect',
    'setup',
    'impact_map',
    'project_profile',
    'risk_check',
    'test_strategy',
    'migration_plan',
    'release_checklist',
    'ui_acceptance',
    'data_contract_check',
    'security_review',
  ].includes(toolName);
}

/** @deprecated 委托给 tool-semantics.js 的 isMutation，保留以兼容外部调用 */
export function isMutationTool(toolName, args) {
  return isSemanticsMutation(toolName, args);
}

export function isChangeInspectionTool(toolName, args) {
  if (
    [
      'read_file',
      'list_dir',
      'glob',
      'search',
      'check_file',
      'review',
      'risk_check',
      'impact_map',
      'project_profile',
      'security_review',
      'data_contract_check',
      'ui_acceptance',
    ].includes(toolName)
  ) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || '').toLowerCase();
    return /\b(cat|sed|awk|ls|find|rg|grep|git\s+diff|git\s+status)\b/.test(command);
  }
  return false;
}

export function isVerificationTool(toolName, args) {
  if (
    [
      'verify',
      'review',
      'preview',
      'project_profile',
      'test_strategy',
      'release_checklist',
      'security_review',
      'data_contract_check',
      'ui_acceptance',
      'risk_check',
    ].includes(toolName)
  ) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    return /\b(test|lint|check|verify|build|typecheck|tsc|jest|vitest|pytest|bun|node|npm|pnpm|yarn)\b/.test(
      command,
    );
  }
  return false;
}

export function isProjectProfileTool(toolName, args) {
  if (toolName === 'project_profile') {
    return true;
  }
  const path = String(args?.path || args?.file_path || args?.file || '').toLowerCase();
  if (
    toolName === 'read_file' &&
    /(package\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|tsconfig|jsconfig|vite\.config|vitest\.config|jest\.config|playwright\.config|eslint|biome|prettier|makefile|docker-compose|\.github\/workflows|tests?\/|__tests__|spec\.)/.test(
      path,
    )
  ) {
    return true;
  }
  if (
    toolName === 'glob' &&
    /(package\.json|tsconfig|vite\.config|vitest|jest|playwright|eslint|biome|tests?|\*\*\/\*\.test|\*\*\/\*\.spec)/.test(
      String(args?.pattern || args?.glob || '').toLowerCase(),
    )
  ) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    return /\b(cat|sed|rg|find|ls|npm|pnpm|yarn|bun|npx)\b.*\b(package\.json|scripts?|test|lint|typecheck|build|vitest|jest|playwright|tsconfig|eslint|biome)\b/.test(
      command,
    );
  }
  return false;
}

export function isSemanticRiskReviewTool(toolName, args, profile) {
  if (!profile?.requiresSemanticRiskReview) {
    return false;
  }
  const focusText = String(
    args?.focus_areas ||
      args?.criteria ||
      args?.claim ||
      args?.evidence ||
      args?.command ||
      args?.input ||
      args?.text ||
      '',
  ).toLowerCase();
  const mentionsSemanticReview =
    /semantic|api|unit|timing|time|fps|frame|state|behavior|behaviour|invariant|boundary|语义|单位|时间|速度|状态|行为|边界/.test(
      focusText,
    );
  if (toolName === 'review' || toolName === 'security_review') {
    return mentionsSemanticReview || !focusText;
  }
  if (toolName === 'verify') {
    return mentionsSemanticReview;
  }
  if (toolName === 'shell' && mentionsSemanticReview) {
    return true;
  }
  return false;
}

// ============== 判断工具结果是否"成功" ==============

export function isSuccessfulToolResult(result) {
  // 如果是跳过的工具调用，仍然视为成功（因为这是正常的缓存行为）
  if (result && result.skipped) {
    return true;
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  if (!text.trim()) {
    return false;
  }
  return !/^(Error|Command failed|BLOCKED):/i.test(text.trim());
}

// ============== 执行计划管理器 ==============

export class ExecutionPlanManager {
  #plan = null;
  #profile = null;
  #userInput = '';
  #requiredMutationPaths = new Set();
  #completedMutationPaths = new Set();
  #mutationCallCount = 0; // 修改工具调用次数（用于无明确文件路径时的完成判断）
  #useLLMDecomposition = false; // 是否使用 LLM 智能分解（替代固定模板）
  #graphPlanner = null;

  constructor() {}

  // ============== 生命周期阶段常量 ==============
  static PHASE = Object.freeze({
    EXPLORATION: 'exploration',
    PLANNING: 'planning',
    IMPLEMENTATION: 'implementation',
    INSPECTION: 'inspection',
    VERIFICATION: 'verification',
  });

  /** 根据 profile 决定是否创建计划
   *
   * 重构说明：
   * - MUTATE 模式强制创建 plan
   * - 其他模式根据 profile.requiresPlan（boolean 或 'optional'）和上下文决定
   * - 非 mutate 任务的 plan 可能是轻量计划，不强制 LLM 分解
   */
  async createIfNeeded(userInput, profile, options = {}) {
    this.#userInput = String(userInput || '');

    // 兼容处理：profile 可能是 quickAssess 的完整返回值（包含 taskProfile 字段）
    // 需要提取内部的结构化 taskProfile
    const taskProfile = profile?.taskProfile || profile;
    this.#profile = taskProfile || null;

    this.#requiredMutationPaths = this.#extractRequestedFilePaths(this.#userInput);
    this.#completedMutationPaths = new Set();
    this.#mutationCallCount = 0;

    // 使用 shouldEnablePlan 判断是否启用计划（考虑上下文）
    const planContext = options.planContext || { complexityScore: 0, fileCount: 0 };
    if (!shouldEnablePlan(taskProfile, planContext)) {
      this.#plan = null;
      this.#useLLMDecomposition = false;
      return null;
    }

    // 确认是否是修改型任务
    const isMutationTask = taskProfile?.mode === 'mutate' || taskProfile?.allowsMutation;
    const planType = selectPlanType(taskProfile, this.#userInput);

    const { modelProvider, intent, availableTools, feedbackContext } = options;

    // ==== LLM 智能分解：用意图分析结果驱动 GraphPlanner.decomposeTaskLLM ====
    let llmSubtasks = null;
    const shouldUseLLMDecomposition = this.#shouldUseLLMDecomposition(taskProfile, planType);
    if (modelProvider && shouldUseLLMDecomposition) {
      // 复杂任务使用 LLM 智能分解，模板作为稳定 fallback
      try {
        const intentContext = intent
          ? {
              intent: intent.intent,
              normalizedTask: intent.normalizedTask || userInput,
              isCodingRelated: intent.isCodingRelated,
              requiresCodeModification: intent.requiresCodeModification,
              recommendedTools: intent.recommendedTools || [],
              slots: intent.slots || {},
            }
          : { normalizedTask: userInput };
        this.#graphPlanner = new GraphPlanner({ debug: false });
        llmSubtasks = await this.#graphPlanner.decomposeTaskLLM(
          intentContext.normalizedTask || userInput,
          modelProvider,
          {
            availableTools: availableTools || [],
            intent: intentContext,
            planType,
            taskProfile,
            feedbackContext: feedbackContext || null,
          },
        );
      } catch {
        // LLM 分解失败，回退到模板
        llmSubtasks = null;
      }
    }

    // ==== 构建 ExecutionPlan ====
    const plan = new ExecutionPlan({
      name: 'Automatic task execution plan',
      description: this.#userInput,
      context: {
        source: 'react-agent',
        generatedAt: new Date().toISOString(),
        decomposition: llmSubtasks ? 'llm' : 'template',
        planType,
        ...(llmSubtasks ? { intentAnalysis: true } : {}),
      },
    });

    if (llmSubtasks && llmSubtasks.length > 0) {
      // LLM 智能分解模式：使用 GraphPlanner 返回的子任务填充 DAG
      this.#useLLMDecomposition = true;

      // 修复：LLM 可能返回重复 task id（如多个 "查看项目结构"），需要重命名并更新依赖
      const seenIds = new Set();
      const idMap = new Map(); // originalId -> finalId
      for (const st of llmSubtasks) {
        let taskId = String(st.name || '').trim();
        if (!taskId) {
          taskId = `llm_task_${seenIds.size + 1}`;
        }
        const originalId = taskId;
        let counter = 1;
        while (seenIds.has(taskId)) {
          taskId = `${originalId}_${counter++}`;
        }
        seenIds.add(taskId);
        if (originalId !== taskId) {
          idMap.set(originalId, taskId);
        }

        plan.addTask({
          id: taskId,
          name: st.description?.substring(0, 80) || st.name,
          description: st.description || '',
          dependencies: (st.dependencies || []).map((dep) => idMap.get(dep) || dep),
          scopeFiles: st.scopeFiles || [],
          phase: st.phase || null,
          metadata: { source: 'llm-decomposition', originalId },
        });
      }
    } else {
      // 模板模式：标准 inspect → plan → implement → verify
      this.#useLLMDecomposition = false;
      this.#buildTemplatePlan(plan, taskProfile, planType);
    }

    this.#ensureProjectProfileTask(plan, planType, taskProfile);

    // 语义风险审查（两种模式通用）
    if (
      taskProfile.requiresSemanticRiskReview &&
      !this.#useLLMDecomposition &&
      !plan.getTask('semantic_risk_review')
    ) {
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${(taskProfile.semanticRiskDomains || []).map((d) => d.label).join('; ')}.`,
        dependencies: ['inspect_changes'],
      });
    }

    // 只对修改类任务添加验证步骤
    // 查询/回答类任务（research, general）和分析类任务（analysis）不需要验证
    if (isMutationTask || this.#shouldAddVerification(planType, taskProfile)) {
      const hasVerification = Array.from(plan.tasks.values()).some(
        (t) => t.id === 'verify_result' || t.name?.toLowerCase().includes('verify'),
      );
      if (!hasVerification) {
        const lastId = Array.from(plan.tasks.keys()).at(-1);
        plan.addTask({
          id: 'verify_result',
          name: 'Verify result',
          description: 'Verify the final result: run tests / lint / build to confirm correctness.',
          dependencies: lastId ? [lastId] : [],
        });
      }
    }

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();

    // 启动第一批任务（依赖已满足的）
    const firstTaskId = plan.tasks.keys().next().value;
    plan.getTask(firstTaskId)?.updateStatus(TaskStatus.RUNNING);

    this.#plan = plan;
    return plan;
  }

  /** 模板模式：根据任务类型生成不同的 plan DAG
   *
   * 任务类型 → 计划模板映射：
   * - 查询/回答类 (research, general): 轻量 2 步 → explore → answer
   * - 分析类 (analysis): 3 步 → explore → analyze → report
   * - 修改类 (coding, modification, bug_fix, documentation): 完整流程
   *   - bug_fix: implement → inspect（直接修复，无前置探索）
   *   - 其他修改: explore → plan → implement → inspect
   */
  #buildTemplatePlan(plan, profile, selectedPlanType = null) {
    // 兼容新旧 profile 格式
    const intent = profile?.intent;
    const mode = profile?.mode;
    const allowsMutation = profile?.allowsMutation;

    // 从 intent/mode 映射到 taskType（必须与 isMutationTask 判断一致）
    // 只有 allowsMutation=true 或 mode='mutate' 才是修改类任务
    let taskType = selectedPlanType || selectPlanType(profile, this.#userInput);
    if (taskType === PlanType.STANDARD) {
      taskType = null;
    }

    if (!taskType && (allowsMutation || mode === 'mutate')) {
      // 修改类任务
      if (profile?.isBugTask || intent === 'diagnosis') {
        taskType = PlanType.BUG_FIX;
      } else if (intent === 'code_modification' || intent === 'feature_implementation') {
        taskType = 'modification';
      } else if (profile?.isDocumentationTask) {
        taskType = PlanType.DOCUMENTATION;
      } else if (profile?.isCodingTask) {
        taskType = 'coding';
      } else {
        taskType = 'modification';
      }
    } else if (!taskType) {
      // 非修改类任务
      if (intent === 'project_info' || intent === 'how_to_run') {
        taskType = PlanType.RESEARCH;
      } else if (intent === 'diagnosis') {
        // 诊断任务但不是修改型：使用分析模板
        taskType = PlanType.ANALYSIS;
      } else if (intent === 'read_only_analysis' || mode === 'inspect' || mode === 'diagnose') {
        taskType = PlanType.ANALYSIS;
      } else if (intent === 'verify' || mode === 'verify') {
        taskType = PlanType.VERIFICATION;
      } else if (profile?.isDocumentationTask) {
        taskType = PlanType.RESEARCH;
      } else if (profile?.isAnalysisTask) {
        taskType = PlanType.ANALYSIS;
      } else if (profile?.isResearchTask) {
        taskType = PlanType.RESEARCH;
      } else {
        taskType = 'general';
      }
    }

    // ===== 查询/回答类任务：轻量 2 步流程 =====
    if (taskType === PlanType.RESEARCH || taskType === 'general') {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Explore context',
        description:
          taskType === PlanType.RESEARCH
            ? 'Search and gather relevant information from the codebase to answer the question.'
            : 'Understand the user request and gather any necessary context.',
        dependencies: [],
        phase: ExecutionPlanManager.PHASE.EXPLORATION,
      });
      plan.addTask({
        id: 'answer_question',
        name: 'Provide answer',
        description:
          'Synthesize the gathered information into a clear, accurate response. No file modifications needed.',
        dependencies: ['inspect_workspace'],
        phase: ExecutionPlanManager.PHASE.VERIFICATION,
      });
      return;
    }

    // ===== 分析类任务：3 步流程 =====
    if (taskType === PlanType.ANALYSIS) {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Explore context',
        description:
          'Read relevant files, search codebase, and gather all necessary information for analysis.',
        dependencies: [],
        phase: ExecutionPlanManager.PHASE.EXPLORATION,
      });
      plan.addTask({
        id: 'analyze_findings',
        name: 'Analyze findings',
        description:
          'Analyze the gathered information and generate insights, findings, and recommendations.',
        dependencies: ['inspect_workspace'],
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
      });
      plan.addTask({
        id: 'generate_report',
        name: 'Generate report',
        description: 'Compile the analysis into a structured report or summary.',
        dependencies: ['analyze_findings'],
        phase: ExecutionPlanManager.PHASE.VERIFICATION,
      });
      return;
    }

    // ===== 修改类任务：核心 4 步流程 =====
    // 注：测试/验证由 createIfNeeded 的兜底逻辑按需自动添加，不写入模板

    // bug_fix 特殊处理：直接修复，无需前置探索
    if (taskType === PlanType.VERIFICATION) {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Inspect verification target',
        description: 'Identify the behavior, files, or commands that need verification.',
        dependencies: [],
        phase: ExecutionPlanManager.PHASE.EXPLORATION,
      });
      plan.addTask({
        id: 'verify_result',
        name: 'Run verification',
        description: 'Run an appropriate verification command or tool and summarize the result.',
        dependencies: ['inspect_workspace'],
        phase: ExecutionPlanManager.PHASE.VERIFICATION,
      });
      return;
    }

    if (taskType === PlanType.QUICK) {
      plan.addTask({
        id: 'implement_changes',
        name: 'Make focused edit',
        description: 'Apply the obvious low-risk change with minimal surrounding edits.',
        dependencies: [],
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
      });
      plan.addTask({
        id: 'inspect_changes',
        name: 'Review edit',
        description: 'Read back the changed file and confirm the focused edit.',
        dependencies: ['implement_changes'],
        phase: ExecutionPlanManager.PHASE.INSPECTION,
      });
      return;
    }

    if (taskType === PlanType.BUG_FIX) {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Reproduce or inspect failure',
        description: 'Find the failing path, relevant files, and likely root cause before editing.',
        dependencies: [],
        phase: ExecutionPlanManager.PHASE.EXPLORATION,
      });
      plan.addTask({
        id: 'implement_changes',
        name: 'Implement bug fix',
        description: 'Implement the smallest change that addresses the diagnosed failure.',
        dependencies: ['inspect_workspace'],
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
      });
      plan.addTask({
        id: 'inspect_changes',
        name: 'Review changes',
        description: 'Read back the fixed code to verify the changes are correct.',
        dependencies: ['implement_changes'],
        phase: ExecutionPlanManager.PHASE.INSPECTION,
      });
      return;
    }

    // coding / modification / documentation：标准 4 步流程
    const descMap = {
      coding: {
        inspect:
          'Discover the relevant project structure and existing files before reading or writing.',
        plan: 'Choose the implementation approach and file split for the requested change.',
        implement: 'Create or edit the required files using the smallest necessary changes.',
        review: 'Read back or otherwise inspect the files that were created or edited.',
      },
      modification: {
        inspect: 'Read the existing code to understand the current implementation.',
        plan: 'Plan the modification approach and identify the smallest necessary changes.',
        implement: 'Make the planned changes to the existing code.',
        review: 'Read back the modified files to verify the changes.',
      },
      [PlanType.DOCUMENTATION]: {
        inspect: 'Discover the project structure and identify existing documentation files.',
        plan: 'Plan the documentation structure, sections, and key topics to cover.',
        implement: 'Create or update documentation files with clear, structured content.',
        review: 'Read back and review the documentation for clarity and completeness.',
      },
      [PlanType.REFACTOR]: {
        inspect: 'Read current behavior and identify refactor boundaries.',
        plan: 'Plan behavior-preserving refactor slices and checks.',
        implement: 'Refactor code in small, reviewable steps.',
        review: 'Review refactored code for behavior drift and unnecessary churn.',
      },
      [PlanType.TESTING]: {
        inspect: 'Find existing tests, test runner, fixtures, and target behavior.',
        plan: 'Plan test cases, assertions, and fixtures.',
        implement: 'Create or update tests and minimal supporting code.',
        review: 'Read back tests and inspect assertions for coverage and intent.',
      },
      [PlanType.CODE_REVIEW]: {
        inspect: 'Gather changed files, relevant context, and current behavior.',
        plan: 'Plan review focus areas and risk checklist.',
        implement: 'Perform the code review and collect findings.',
        review: 'Organize actionable findings with evidence.',
      },
      [PlanType.MIGRATION]: {
        inspect:
          'Inventory old and new usage sites, schemas, configs, and compatibility boundaries.',
        plan: 'Plan migration order, compatibility, and rollback checks.',
        implement: 'Apply migration changes in controlled steps.',
        review: 'Review migrated references and compatibility paths.',
      },
      [PlanType.SETUP]: {
        inspect: 'Inspect environment, package files, configs, and setup instructions.',
        plan: 'Plan the setup or configuration sequence.',
        implement: 'Apply setup/configuration changes.',
        review: 'Review setup result and changed config.',
      },
      [PlanType.RELEASE]: {
        inspect: 'Inspect release state, version files, package config, and CI scripts.',
        plan: 'Plan versioning, changelog, packaging, or deployment steps.',
        implement: 'Prepare release metadata, scripts, or artifacts.',
        review: 'Review release preparation and pending diff.',
      },
      [PlanType.SECURITY]: {
        inspect: 'Inspect auth, permissions, secrets, input handling, and security boundaries.',
        plan: 'Plan a minimal secure change and identify abuse cases.',
        implement: 'Apply security-sensitive changes carefully.',
        review: 'Review security-sensitive behavior and boundary cases.',
      },
      [PlanType.DATA]: {
        inspect: 'Inspect schemas, queries, datasets, migrations, or data scripts.',
        plan: 'Plan validation, rollback, and data-shape compatibility.',
        implement: 'Apply data, schema, query, or processing changes.',
        review: 'Validate changed data logic and inspect outputs.',
      },
      [PlanType.UI]: {
        inspect: 'Inspect components, styles, routes, and interaction structure.',
        plan: 'Plan component, state, layout, and responsive behavior changes.',
        implement: 'Update UI components, styles, and interactions.',
        review: 'Inspect UI changes and preview or verify when possible.',
      },
    };
    const desc = descMap[taskType] || descMap.modification;

    plan.addTask({
      id: 'inspect_workspace',
      name: 'Explore context',
      description: desc.inspect,
      dependencies: [],
      phase: ExecutionPlanManager.PHASE.EXPLORATION,
    });
    plan.addTask({
      id: 'plan_solution',
      name: 'Plan approach',
      description: desc.plan,
      dependencies: ['inspect_workspace'],
      phase: ExecutionPlanManager.PHASE.PLANNING,
    });
    plan.addTask({
      id: 'implement_changes',
      name: 'Execute',
      description: desc.implement,
      dependencies: ['plan_solution'],
      phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
    });
    plan.addTask({
      id: 'inspect_changes',
      name: 'Review',
      description: desc.review,
      dependencies: ['implement_changes'],
      phase: ExecutionPlanManager.PHASE.INSPECTION,
    });
  }

  #shouldUseLLMDecomposition(taskProfile, planType) {
    if (!taskProfile || taskProfile.isLikelyTrivial) {
      return false;
    }
    if (taskProfile.riskLevel === 'high' || taskProfile.riskLevel === 'critical') {
      return true;
    }
    if (taskProfile.isModificationTask || taskProfile.allowsMutation) {
      return true;
    }
    return [
      PlanType.CODE_REVIEW,
      PlanType.MIGRATION,
      PlanType.SECURITY,
      PlanType.DATA,
      PlanType.RELEASE,
      PlanType.SETUP,
      PlanType.REFACTOR,
      PlanType.TESTING,
      PlanType.UI,
    ].includes(planType);
  }

  #shouldAddVerification(planType, taskProfile) {
    if ([PlanType.RESEARCH, PlanType.ANALYSIS, PlanType.CODE_REVIEW].includes(planType)) {
      return Boolean(taskProfile?.requiresVerification);
    }
    return [
      PlanType.TESTING,
      PlanType.REFACTOR,
      PlanType.MIGRATION,
      PlanType.SETUP,
      PlanType.RELEASE,
      PlanType.SECURITY,
      PlanType.DATA,
      PlanType.UI,
      PlanType.VERIFICATION,
    ].includes(planType);
  }

  #ensureProjectProfileTask(plan, planType, taskProfile) {
    if (plan.getTask('profile_project') || !this.#shouldAddProjectProfile(planType, taskProfile)) {
      return;
    }

    const anchor =
      plan.getTask('inspect_workspace') ||
      plan.getTask('inspect_existing_code') ||
      Array.from(plan.tasks.values()).find(
        (task) => task.phase === ExecutionPlanManager.PHASE.EXPLORATION,
      );
    if (!anchor) {
      return;
    }

    plan.addTask({
      id: 'profile_project',
      name: 'Profile existing project',
      description:
        'Identify package/config files, available scripts, test modules, framework conventions, and the narrowest useful verification command before planning edits.',
      dependencies: [anchor.id],
      phase: ExecutionPlanManager.PHASE.EXPLORATION,
      allowedTools: [
        'project_profile',
        'read_file',
        'glob',
        'list_dir',
        'search_codebase',
        'shell',
        'test_strategy',
      ],
      completionPredicate: ({ toolName, args }) => isProjectProfileTool(toolName, args),
    });

    for (const task of plan.tasks.values()) {
      if (task.id === 'profile_project' || task.id === anchor.id) {
        continue;
      }
      if (task.dependencies.has(anchor.id)) {
        task.dependencies.delete(anchor.id);
        task.dependencies.add('profile_project');
      }
    }
    this.#reorderTasks(plan, { after: anchor.id, ids: ['profile_project'] });
  }

  #shouldAddProjectProfile(planType, taskProfile) {
    if (
      [PlanType.QUICK, PlanType.RESEARCH, PlanType.ANALYSIS, PlanType.VERIFICATION].includes(
        planType,
      )
    ) {
      return false;
    }
    return Boolean(
      taskProfile?.isCodingTask ||
      taskProfile?.isModificationTask ||
      taskProfile?.isBugTask ||
      taskProfile?.allowsMutation ||
      taskProfile?.mode === 'mutate' ||
      taskProfile?.requiresAutomaticPlanning ||
      taskProfile?.requiresPlan,
    );
  }

  get plan() {
    return this.#plan;
  }
  get isActive() {
    return !!this.#plan && this.#plan.status === TaskStatus.RUNNING;
  }
  get isCompleted() {
    return !!this.#plan && this.#plan.status === TaskStatus.COMPLETED;
  }
  get isBugTask() {
    return !!this.#profile?.isBugTask;
  }
  get currentTask() {
    return (
      Array.from(this.#plan?.tasks?.values?.() || []).find(
        (task) => task.status === TaskStatus.RUNNING,
      ) || null
    );
  }

  /**
   * 动态修改当前执行计划。
   * 支持和 AgentPlanner.changePlan 相同的常用模式，供 change_plan 工具调用。
   */
  changePlan({ mode = 'append', tasks = [], targetTaskId = null, reason = '' } = {}) {
    const plan = this.#plan;
    if (!plan) {
      return { success: false, error: 'No active plan to change' };
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { success: false, error: 'Plan change requires at least one task' };
    }

    const before = this.#summarizeProgress(plan);
    const snapshot = this.#snapshotPlan(plan);
    let insertedTasks = [];

    try {
      if (mode === 'replace') {
        insertedTasks = this.#replaceUnfinishedTasks(plan, tasks);
      } else if (mode === 'insertBefore') {
        insertedTasks = this.#insertTasksBefore(plan, targetTaskId, tasks);
      } else if (mode === 'insertAfter') {
        insertedTasks = this.#insertTasksAfter(plan, targetTaskId, tasks);
      } else if (mode === 'append') {
        insertedTasks = this.#appendTasks(plan, tasks);
      } else {
        return { success: false, error: `Unsupported plan change mode: ${mode}` };
      }

      if (typeof plan.detectCycle === 'function' && plan.detectCycle()) {
        this.#restorePlanSnapshot(plan, snapshot);
        return { success: false, error: 'Plan change would create a dependency cycle' };
      }
    } catch (error) {
      this.#restorePlanSnapshot(plan, snapshot);
      return { success: false, error: error.message };
    }

    plan.status = TaskStatus.RUNNING;
    plan.completedAt = null;
    this.#startReadyTasks(plan);

    return {
      success: true,
      plan,
      insertedTasks,
      planStatus: plan.status,
      before,
      after: this.#summarizeProgress(plan),
      reason,
    };
  }

  /** 记录工具调用后推进计划；返回 plan 的新摘要（若有变化）
   * ✅ 第 9 阶段增强：
   * - 优先使用 task.completionPredicate 判断完成（而非宽松的工具谓词）
   * - 双重验证：工具谓词 + completionPredicate
   * - 防止虚假完成（一个 read_file 不应同时完成多个 exploration 任务）
   */
  advance(toolName, args, result) {
    if (!this.isActive) {
      return null;
    }
    if (!isSuccessfulToolResult(result)) {
      return null;
    }

    const plan = this.#plan;
    const before = this.#summarizeProgress(plan);

    // ✅ 第 9 阶段：严格模式 — 使用 completionPredicate 验证
    this.#advanceWithStrictValidation(plan, toolName, args, result);

    const allDone = Array.from(plan.tasks.values()).every((t) => t.status === TaskStatus.COMPLETED);
    if (allDone) {
      plan.status = TaskStatus.COMPLETED;
      plan.completedAt = Date.now();
    }

    const after = this.#summarizeProgress(plan);
    return after !== before
      ? { before, after, isCompleted: plan.status === TaskStatus.COMPLETED }
      : null;
  }

  /**
   * ✅ 第 9 阶段：严格完成条件验证的推进逻辑
   *
   * 核心改进：
   * 1. 只推进当前 RUNNING 状态的任务（不批量推进）
   * 2. 使用 task.completionPredicate / canBeAdvancedBy 进行精确匹配
   * 3. 工具调用只作用于一个任务（防止虚假并行推进）
   * 4. 记录工具调用历史，使谓词可以基于历史判断
   */
  #advanceWithStrictValidation(plan, toolName, args, result) {
    // 找到当前 RUNNING 的任务
    const runningTasks = Array.from(plan.tasks.values()).filter(
      (t) => t.status === TaskStatus.RUNNING,
    );

    if (runningTasks.length === 0) {
      // 没有 RUNNING 任务，检查是否有 READY 任务可以启动
      this.#startReadyTasks(plan);
      return;
    }

    // 尝试将此工具调用匹配到一个 RUNNING 任务
    let matchedTask = null;
    let matchedByPredicate = false;

    for (const task of runningTasks) {
      // 记录工具调用历史
      task.recordToolCall(toolName, args, result);

      // 检查任务是否可以被此工具推进
      if (task.canBeAdvancedBy(toolName, args, result)) {
        matchedTask = task;
        // 如果有 completionPredicate 且满足，标记为谓词匹配
        if (task.completionPredicate) {
          const validation = task.validateCompletion({ strictMode: false });
          if (validation.completed) {
            matchedByPredicate = true;
          }
        }
        break; // 一个工具调用只能推进一个任务
      }
    }

    if (!matchedTask) {
      // 没有任何 RUNNING 任务接受这个工具调用
      // 可能是任务还未启动或工具不在允许列表中
      this.#startReadyTasks(plan);
      return;
    }

    // ✅ 第 9 阶段关键：使用 validateCompletion 进行多维度验证
    const validation = matchedTask.validateCompletion({ strictMode: true });

    if (validation.completed || matchedByPredicate) {
      // 完成条件满足，标记为 COMPLETED
      matchedTask.updateStatus(TaskStatus.COMPLETED, {
        result: { completedBy: 'strict-validation', toolName, args },
        validatedAt: Date.now(),
        validationReason: validation.reason,
      });

      // 启动依赖已满足的后继任务
      this.#startReadyTasks(plan);
    }
    // 否则：任务继续 RUNNING 状态，等待更多工具调用
  }

  /** LLM 分解模式：按阶段匹配完成当前 RUNNING 子任务（保留作为 fallback） */
  #advanceLLMPlan(plan, toolName, args) {
    // 阶段 1: Exploration — 工作区探索工具完成后，完成当前 exploration 阶段的任务
    if (isWorkspaceInspectionTool(toolName, args)) {
      this.#completeRunningPhaseTask(plan, ExecutionPlanManager.PHASE.EXPLORATION);
      this.#startReadyTasks(plan);
    }

    // 阶段 2: Planning — 计划/方法论工具 或 直接开始写代码
    if (isPlanningTool(toolName) || isMutationTool(toolName, args)) {
      this.#completeRunningPhaseTask(plan, ExecutionPlanManager.PHASE.PLANNING);
      this.#startReadyTasks(plan);
    }

    // 阶段 3: Implementation — 记录变更路径，完成后推进
    this.#recordMutationPath(toolName, args);
    if (isMutationTool(toolName, args) && this.#hasCompletedRequiredMutationPaths()) {
      this.#completeRunningPhaseTask(plan, ExecutionPlanManager.PHASE.IMPLEMENTATION);
      this.#startReadyTasks(plan);
    }

    // 阶段 4: Inspection — 变更审查工具
    if (isChangeInspectionTool(toolName, args)) {
      this.#completeRunningPhaseTask(plan, ExecutionPlanManager.PHASE.INSPECTION);
      this.#startReadyTasks(plan);
    }

    // 阶段 5: Verification — 验证工具
    if (isVerificationTool(toolName, args)) {
      this.#completeRunningPhaseTask(plan, ExecutionPlanManager.PHASE.VERIFICATION);
      this.#startReadyTasks(plan);
    }
  }

  /** 模板模式：按固定 taskId 推进 */
  #advanceTemplatePlan(plan, toolName, args) {
    // 1) inspect_workspace
    this.#completeIf('inspect_workspace', () => isWorkspaceInspectionTool(toolName, args));
    this.#startReadyTasks(plan);

    // 2) profile_project — identify project config, scripts, and test surface
    this.#completeIf('profile_project', () => isProjectProfileTool(toolName, args));
    this.#startReadyTasks(plan);

    // 3) plan_solution — 显式的计划工具 OR 直接开始修改
    this.#completeIf(
      'plan_solution',
      () => isPlanningTool(toolName) || isMutationTool(toolName, args),
    );
    this.#startReadyTasks(plan);

    // 4) implement_changes — 记录路径并检查 requiredMutationPaths
    this.#recordMutationPath(toolName, args);
    this.#completeIf(
      'implement_changes',
      () => isMutationTool(toolName, args) && this.#hasCompletedRequiredMutationPaths(),
    );
    this.#startReadyTasks(plan);

    // 5) inspect_changes
    this.#completeIf('inspect_changes', () => isChangeInspectionTool(toolName, args));
    this.#startReadyTasks(plan);

    // 6) semantic_risk_review（可选）
    this.#completeIf('semantic_risk_review', () =>
      isSemanticRiskReviewTool(toolName, args, this.#profile),
    );
    this.#startReadyTasks(plan);

    // 7) verify_result
    this.#completeIf('verify_result', () => isVerificationTool(toolName, args));
    this.#startReadyTasks(plan);
  }

  /** 生成面向 LLM 的 plan 提示文本 */
  buildPrompt() {
    if (!this.#plan) {
      return '';
    }
    const plan = this.#plan;
    const tasks = plan
      .toJSON()
      .tasks.map((t) => {
        const scopeStr =
          t.scopeFiles && t.scopeFiles.length > 0 ? ` [📁: ${t.scopeFiles.join(', ')}]` : '';
        return `- ${t.id}: ${t.name} [${t.status}]${scopeStr} - ${t.description}`;
      })
      .join('\n');

    const decompositionNote = this.#useLLMDecomposition
      ? 'LLM 智能分解模式：每个子任务有明确文件范围和依赖关系。按 DAG 顺序执行，完成后自动推进。\n'
      : 'Execute this DAG in dependency order. Do not skip ahead, and do not provide FINAL_ANSWER until every task is completed.\n';

    // 统一策略：无论是否 LLM 分解模式，都优先选择真正 RUNNING 的任务，
    // 避免 DAG 显示 inspect_workspace 但 prompt 又说 implement_changes 的矛盾信号。
    let firstTaskPrompt = '';
    let firstTaskScope = '';
    const runningTask =
      Array.from(plan.tasks.values()).find((t) => t.status === TaskStatus.RUNNING) ||
      Array.from(plan.tasks.values()).find((t) => t.status === TaskStatus.PENDING);

    if (runningTask) {
      const firstTaskId = runningTask.id;
      if (this.#useLLMDecomposition) {
        firstTaskPrompt = `▶ 当前子任务: ${firstTaskId} — ${runningTask.description}`;
        if (runningTask.scopeFiles?.length) {
          firstTaskScope = `\n📁 文件作用域: ${runningTask.scopeFiles.join(', ')}`;
        }
      } else {
        firstTaskScope = runningTask.scopeFiles?.length
          ? ` 📁 当前子任务文件作用域: ${runningTask.scopeFiles.join(', ')}`
          : '';

        if (firstTaskId === 'implement_changes') {
          firstTaskPrompt = `Current task: implement_changes. Read the relevant code with read_file, identify the bug, then fix it with write_file or edit_file. Do NOT produce a diagnostic report — fix the bug.`;
        } else if (firstTaskId === 'inspect_workspace') {
          firstTaskPrompt = `Current task: inspect_workspace. Call list_dir or another filesystem discovery tool first, then continue through the plan.`;
        } else if (firstTaskId === 'profile_project') {
          firstTaskPrompt = `Current task: profile_project. Identify package/config files, scripts, test modules, and verification commands using project_profile or by reading config/test files.`;
        } else {
          firstTaskPrompt = `Current task: ${firstTaskId}. ${runningTask.description} Complete this task using the appropriate available tools.`;
        }
      }
    }

    return (
      `Automatic task orchestration is active for this request:\n${this.#userInput}\n\n` +
      decompositionNote +
      `${tasks}\n\n` +
      `The DAG task ids are status labels, not tool names. Use real available tools such as list_dir, read_file, write_file, shell, and methodology tools.\n` +
      `For existing code projects, complete profile_project by identifying package/config files, scripts, test modules, and verification commands before choosing implementation or tests.\n` +
      `When the current task offers methodology tools such as project_profile, impact_map, risk_check, test_strategy, security_review, data_contract_check, ui_acceptance, migration_plan, or release_checklist, prefer using the most relevant one before editing or finalizing.\n` +
      `If the plan becomes wrong during execution, call change_plan to append, replace, or insert tasks before continuing.\n` +
      `${this.#profile?.requiresSemanticRiskReview ? this.#buildSemanticRiskGuidance() + '\n' : ''}` +
      firstTaskPrompt +
      firstTaskScope
    );
  }

  /** 完成状态标记 */
  markCompleted() {
    if (this.#plan) {
      this.#plan.status = TaskStatus.COMPLETED;
    }
  }

  /**
   * 生成执行摘要 — 供 ExecutionFeedbackLoop 收集反馈数据。
   * 返回结构化的 plan 执行结果，包括各阶段耗时、冲突信息等。
   */
  generateExecutionSummary() {
    if (!this.#plan) return null;

    const tasks = Array.from(this.#plan.tasks.values());
    const completedTasks = tasks.filter((t) => t.status === TaskStatus.COMPLETED);
    const failedTasks = tasks.filter((t) => t.status === TaskStatus.FAILED);

    // 按阶段统计完成情况
    const phasesCompleted = [];
    const phaseTimings = {};
    for (const phase of Object.values(ExecutionPlanManager.PHASE)) {
      const phaseTasks = tasks.filter((t) => t.phase === phase);
      if (phaseTasks.length > 0 && phaseTasks.every((t) => t.status === TaskStatus.COMPLETED)) {
        phasesCompleted.push(phase);
      }
      // 计算阶段耗时
      const phaseCompletedTasks = phaseTasks.filter((t) => t.completedAt);
      if (phaseCompletedTasks.length > 0) {
        const earliest = Math.min(...phaseCompletedTasks.map((t) => t.startedAt || Infinity));
        const latest = Math.max(...phaseCompletedTasks.map((t) => t.completedAt || 0));
        if (earliest < Infinity && latest > 0) {
          phaseTimings[phase] = latest - earliest;
        }
      }
    }

    return {
      planId: this.#plan.id,
      planName: this.#plan.name,
      decompositionMode: this.#plan.context?.decomposition || 'template',
      totalSubtasks: tasks.length,
      completedSubtasks: completedTasks.length,
      failedSubtasks: failedTasks.length,
      phasesCompleted,
      phaseTimings,
      // 子任务名称序列（用于分解模式签名）
      subtaskNames: tasks.map((t) => t.name || t.id),
      // Hashline 冲突计数（从 task metadata 提取）
      hashlineConflicts: tasks.reduce((sum, t) => sum + (t.metadata?.hashlineConflicts || 0), 0),
      hashlineRollbacks: tasks.reduce((sum, t) => sum + (t.metadata?.hashlineRollbacks || 0), 0),
      hashlineAutoRepairs: tasks.reduce(
        (sum, t) => sum + (t.metadata?.hashlineAutoRepairs || 0),
        0,
      ),
      completedAt: this.#plan.completedAt,
      startedAt: this.#plan.startedAt,
    };
  }

  /**
   * 动态重规划 — 当 Hashline 报告冲突时插入修复/重试子任务。
   * @param {object} conflictHints - 来自 ExecutionFeedbackLoop.generateReplanHints() 的输出
   * @returns {object|null} 新插入的子任务信息，或 null（无需 replan）
   */
  replan(conflictHints) {
    if (!this.isActive || !this.#plan) return null;

    const { conflictType, affectedFiles, suggestedStrategies } = conflictHints || {};
    if (!conflictType) return null;

    // 找到当前所有 IMPLEMENTATION 阶段未完成的任务
    const blockedTasks = Array.from(this.#plan.tasks.values()).filter(
      (t) =>
        t.phase === ExecutionPlanManager.PHASE.IMPLEMENTATION &&
        (t.status === TaskStatus.RUNNING || t.status === TaskStatus.PENDING),
    );

    if (blockedTasks.length === 0) return null;

    // 为每个阻塞任务创建诊断+重试子任务
    const insertedTasks = [];
    const replanId = `replan_${conflictType}_${Date.now()}`;

    // 1) 诊断任务
    const diagnoseId = `${replanId}_diagnose`;
    this.#plan.addTask({
      id: diagnoseId,
      name: `Diagnose: ${conflictType}`,
      description: `Hashline 冲突检测: ${conflictType}。涉及文件: ${(affectedFiles || []).join(', ') || 'unknown'}。建议策略: ${(suggestedStrategies || ['re-read + retry']).join('; ')}`,
      dependencies: blockedTasks.map((t) => t.id),
      phase: ExecutionPlanManager.PHASE.INSPECTION,
      scopeFiles: affectedFiles || [],
      metadata: { source: 'replan-diagnose', conflictType },
    });
    insertedTasks.push(diagnoseId);

    // 2) 重试任务（依赖诊断任务）
    const retryId = `${replanId}_retry`;
    this.#plan.addTask({
      id: retryId,
      name: `Retry after ${conflictType}`,
      description: `在诊断 hash 冲突后，用正确的上下文重新执行编辑。涉及文件: ${(affectedFiles || []).join(', ') || 'unknown'}`,
      dependencies: [diagnoseId],
      phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
      scopeFiles: affectedFiles || [],
      metadata: { source: 'replan-retry', conflictType },
    });
    insertedTasks.push(retryId);

    // 3) 重跑验证（如果原本有验证步骤）
    const verifyTasks = Array.from(this.#plan.tasks.values()).filter(
      (t) => t.phase === ExecutionPlanManager.PHASE.VERIFICATION,
    );
    if (verifyTasks.length > 0) {
      const reVerifyId = `${replanId}_reverify`;
      this.#plan.addTask({
        id: reVerifyId,
        name: `Re-verify after conflict recovery`,
        description: `重新验证修复后的变更：运行 test/lint/build 确认正确性`,
        dependencies: [retryId, ...verifyTasks.map((t) => t.id)],
        phase: ExecutionPlanManager.PHASE.VERIFICATION,
        metadata: { source: 'replan-reverify', conflictType },
      });
      insertedTasks.push(reVerifyId);
    }

    // 将新插入的第一个任务标记为 RUNNING
    const firstInserted = this.#plan.getTask(diagnoseId);
    if (firstInserted) {
      firstInserted.updateStatus(TaskStatus.RUNNING);
    }

    return {
      replanId,
      conflictType,
      insertedTasks,
      affectedFiles,
      suggestedStrategies,
    };
  }

  /**
   * 记录 Hashline 冲突信号到当前 RUNNING 任务。
   * 由 AgentEngine 在检测到冲突后调用，用于后续 generateExecutionSummary 统计。
   */
  recordConflictSignal(toolName, conflictType, recovered) {
    if (!this.#plan) return;
    const runningTasks = Array.from(this.#plan.tasks.values()).filter(
      (t) => t.status === TaskStatus.RUNNING,
    );
    for (const task of runningTasks) {
      task.metadata.hashlineConflicts = (task.metadata.hashlineConflicts || 0) + 1;
      if (!recovered) {
        task.metadata.hashlineRollbacks = (task.metadata.hashlineRollbacks || 0) + 1;
      } else {
        task.metadata.hashlineAutoRepairs = (task.metadata.hashlineAutoRepairs || 0) + 1;
      }
    }
  }

  // ============== 内部实现 ==============

  #completeIf(taskId, predicate) {
    const task = this.#plan?.getTask(taskId);
    if (!task || task.status === TaskStatus.COMPLETED) {
      return;
    }
    if (predicate()) {
      task.updateStatus(TaskStatus.COMPLETED, { result: { completedBy: 'tool-observation' } });
    }
  }

  /**
   * LLM 分解模式：找到当前 RUNNING 且属于指定 phase 的子任务，标记完成。
   * 如果没有显式 phase 标记，回退到按任务 name/id 前缀推断。
   */
  #completeRunningPhaseTask(plan, targetPhase) {
    const runningTasks = Array.from(plan.tasks.values()).filter(
      (t) => t.status === TaskStatus.RUNNING,
    );
    // 优先匹配有显式 phase 的任务
    let target = runningTasks.find((t) => t.phase === targetPhase);
    // 回退：按 phase 前缀匹配（LLM 分解可能在 name/id 中包含阶段信息）
    if (!target) {
      const prefixMap = {
        [ExecutionPlanManager.PHASE.EXPLORATION]: [
          'inspect',
          'explore',
          'discover',
          'read',
          'gather',
          'analyze',
        ],
        [ExecutionPlanManager.PHASE.PLANNING]: [
          'plan',
          'design',
          'architect',
          'brainstorm',
          'grill',
          'zoom_out',
          'approach',
        ],
        [ExecutionPlanManager.PHASE.IMPLEMENTATION]: [
          'implement',
          'create',
          'edit',
          'write',
          'fix',
          'add',
          'update',
          'refactor',
          'build',
          'code',
        ],
        [ExecutionPlanManager.PHASE.INSPECTION]: [
          'inspect',
          'review',
          'check',
          'audit',
          'read_back',
        ],
        [ExecutionPlanManager.PHASE.VERIFICATION]: [
          'verify',
          'test',
          'validate',
          'confirm',
          'lint',
          'build_check',
        ],
      };
      const prefixes = prefixMap[targetPhase] || [];
      target = runningTasks.find((t) => {
        const lower = (t.name || t.id || '').toLowerCase();
        return prefixes.some((p) => lower.includes(p));
      });
    }
    if (target) {
      target.updateStatus(TaskStatus.COMPLETED, {
        result: { completedBy: 'tool-observation', phase: targetPhase },
      });
    }
  }

  #startReadyTasks(plan) {
    for (const task of plan.getReadyTasks()) {
      if (task.status === TaskStatus.PENDING || task.status === TaskStatus.BLOCKED) {
        task.updateStatus(TaskStatus.RUNNING);
        return;
      }
    }
  }

  #recordMutationPath(toolName, args) {
    if (!['write_file', 'edit_file'].includes(toolName)) {
      return;
    }
    this.#mutationCallCount += 1;
    const path = args?.path || args?.file_path || args?.file;
    if (path) {
      this.#completedMutationPaths.add(String(path));
    }
  }

  #hasCompletedRequiredMutationPaths() {
    if (this.#requiredMutationPaths.size === 0) {
      // 无明确文件路径时：要求至少 2 次修改调用才认为完成
      // 防止第一次修改工具调用就过早完成 implement_changes
      return this.#mutationCallCount >= 2;
    }
    for (const p of this.#requiredMutationPaths) {
      if (!this.#completedMutationPaths.has(p)) {
        return false;
      }
    }
    return true;
  }

  #extractRequestedFilePaths(text) {
    const paths = new Set();
    const regex =
      /\b((?:[\w.-]+\/)*[\w.-]+\.(?:html|js|css|ts|tsx|jsx|json|md|py|java|go|rs|c|cpp|h|hpp))\b/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      paths.add(match[1]);
    }
    const basenamesWithDirectory = new Set(
      Array.from(paths)
        .filter((p) => p.includes('/'))
        .map((p) => p.split('/').pop()),
    );
    for (const path of Array.from(paths)) {
      if (!path.includes('/') && basenamesWithDirectory.has(path)) {
        paths.delete(path);
      }
    }
    return paths;
  }

  #summarizeProgress(plan) {
    return plan
      .toJSON()
      .tasks.map((t) => `- ${t.id}: ${t.status}`)
      .join('\n');
  }

  #replaceUnfinishedTasks(plan, taskDefs) {
    const completedTasks = Array.from(plan.tasks.values()).filter(
      (task) => task.status === TaskStatus.COMPLETED,
    );
    const removeIds = Array.from(plan.tasks.values())
      .filter((task) => task.status !== TaskStatus.COMPLETED)
      .map((task) => task.id);
    this.#removeTasks(plan, removeIds);

    const defaultDeps = this.#leafTaskIds(completedTasks);
    return this.#addTaskChain(plan, taskDefs, { defaultFirstDependencies: defaultDeps });
  }

  #insertTasksBefore(plan, targetTaskId, taskDefs) {
    const target = plan.getTask(targetTaskId);
    if (!target) {
      throw new Error(`Target task not found: ${targetTaskId}`);
    }
    if (target.status === TaskStatus.COMPLETED) {
      throw new Error(`Cannot insert before completed task: ${targetTaskId}`);
    }

    const originalDeps = Array.from(target.dependencies);
    const inserted = this.#addTaskChain(plan, taskDefs, { defaultFirstDependencies: originalDeps });
    target.dependencies = new Set([inserted[inserted.length - 1]]);
    if (target.status === TaskStatus.RUNNING || target.status === TaskStatus.READY) {
      target.updateStatus(TaskStatus.PENDING);
    }
    this.#reorderTasks(plan, { before: targetTaskId, ids: inserted });
    return inserted;
  }

  #insertTasksAfter(plan, targetTaskId, taskDefs) {
    const target = plan.getTask(targetTaskId);
    if (!target) {
      throw new Error(`Target task not found: ${targetTaskId}`);
    }

    const inserted = this.#addTaskChain(plan, taskDefs, {
      defaultFirstDependencies: [targetTaskId],
    });
    const lastInserted = inserted[inserted.length - 1];
    for (const task of plan.tasks.values()) {
      if (
        inserted.includes(task.id) ||
        task.id === targetTaskId ||
        task.status === TaskStatus.COMPLETED
      ) {
        continue;
      }
      if (task.dependencies.has(targetTaskId)) {
        task.dependencies.delete(targetTaskId);
        task.dependencies.add(lastInserted);
      }
    }
    this.#reorderTasks(plan, { after: targetTaskId, ids: inserted });
    return inserted;
  }

  #appendTasks(plan, taskDefs) {
    const existing = Array.from(plan.tasks.values());
    const defaultDeps = existing.length > 0 ? [existing[existing.length - 1].id] : [];
    return this.#addTaskChain(plan, taskDefs, { defaultFirstDependencies: defaultDeps });
  }

  #addTaskChain(plan, taskDefs, { defaultFirstDependencies = [] } = {}) {
    const inserted = [];
    let previousId = null;
    for (const raw of taskDefs) {
      const id = this.#uniqueTaskId(
        plan,
        raw.id || raw.name || `dynamic_task_${inserted.length + 1}`,
      );
      const hasExplicitDeps = Array.isArray(raw.dependencies);
      const dependencies = hasExplicitDeps
        ? raw.dependencies
        : previousId
          ? [previousId]
          : defaultFirstDependencies;
      plan.addTask({
        ...raw,
        id,
        name: raw.name || id,
        dependencies,
        metadata: {
          ...(raw.metadata || {}),
          source: raw.metadata?.source || 'dynamic-plan-change',
          reason: raw.metadata?.reason || undefined,
        },
      });
      inserted.push(id);
      previousId = id;
    }
    this.#rebuildGraph(plan);
    return inserted;
  }

  #removeTasks(plan, taskIds) {
    const remove = new Set(taskIds);
    for (const id of remove) {
      plan.tasks.delete(id);
      plan.edges.delete(id);
    }
    for (const task of plan.tasks.values()) {
      task.dependencies = new Set(Array.from(task.dependencies).filter((dep) => !remove.has(dep)));
      task.dependents = new Set(Array.from(task.dependents).filter((dep) => !remove.has(dep)));
    }
    this.#rebuildGraph(plan);
  }

  #reorderTasks(plan, { before = null, after = null, ids = [] } = {}) {
    const moving = new Set(ids);
    const ordered = [];
    const movedTasks = ids.map((id) => plan.getTask(id)).filter(Boolean);
    for (const task of plan.tasks.values()) {
      if (moving.has(task.id)) {
        continue;
      }
      if (before && task.id === before) {
        ordered.push(...movedTasks);
      }
      ordered.push(task);
      if (after && task.id === after) {
        ordered.push(...movedTasks);
      }
    }
    plan.tasks = new Map(ordered.map((task) => [task.id, task]));
    this.#rebuildGraph(plan);
  }

  #rebuildGraph(plan) {
    plan.edges = new Map();
    for (const task of plan.tasks.values()) {
      task.dependents = new Set();
      plan.edges.set(task.id, new Set());
    }
    for (const task of plan.tasks.values()) {
      task.dependencies = new Set(
        Array.from(task.dependencies || []).filter((depId) => plan.tasks.has(depId)),
      );
      for (const depId of task.dependencies) {
        if (!plan.edges.has(depId)) {
          plan.edges.set(depId, new Set());
        }
        plan.edges.get(depId).add(task.id);
        plan.getTask(depId)?.dependents.add(task.id);
      }
    }
  }

  #leafTaskIds(tasks) {
    const ids = new Set(tasks.map((task) => task.id));
    const dependedOn = new Set();
    for (const task of tasks) {
      for (const depId of task.dependencies || []) {
        if (ids.has(depId)) {
          dependedOn.add(depId);
        }
      }
    }
    return tasks.filter((task) => !dependedOn.has(task.id)).map((task) => task.id);
  }

  #uniqueTaskId(plan, preferredId) {
    const base = String(preferredId || 'dynamic_task').replace(/\s+/g, '_');
    let id = base;
    let counter = 1;
    while (plan.tasks.has(id)) {
      id = `${base}_${counter++}`;
    }
    return id;
  }

  #snapshotPlan(plan) {
    return {
      status: plan.status,
      completedAt: plan.completedAt,
      tasks: Array.from(plan.tasks.values()).map((task) => ({
        task,
        dependencies: new Set(task.dependencies),
        dependents: new Set(task.dependents),
        status: task.status,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        result: task.result,
        error: task.error,
        toolCallsHistory: Array.isArray(task.toolCallsHistory) ? [...task.toolCallsHistory] : [],
      })),
      edges: new Map(
        Array.from((plan.edges || new Map()).entries()).map(([id, deps]) => [id, new Set(deps)]),
      ),
    };
  }

  #restorePlanSnapshot(plan, snapshot) {
    plan.status = snapshot.status;
    plan.completedAt = snapshot.completedAt;
    plan.tasks = new Map(snapshot.tasks.map(({ task }) => [task.id, task]));
    plan.edges = new Map(
      Array.from(snapshot.edges.entries()).map(([id, deps]) => [id, new Set(deps)]),
    );
    for (const item of snapshot.tasks) {
      item.task.dependencies = new Set(item.dependencies);
      item.task.dependents = new Set(item.dependents);
      item.task.status = item.status;
      item.task.startedAt = item.startedAt;
      item.task.completedAt = item.completedAt;
      item.task.result = item.result;
      item.task.error = item.error;
      item.task.toolCallsHistory = [...item.toolCallsHistory];
    }
  }

  #buildSemanticRiskGuidance() {
    const domains = this.#profile?.semanticRiskDomains || [];
    if (domains.length === 0) {
      return '';
    }
    return (
      `Semantic risk domains for this change:\n` +
      domains
        .map((d) => `  - ${d.label}: ${d.checklist?.[0] || 'review API surface and invariants'}`)
        .join('\n')
    );
  }
}

export default ExecutionPlanManager;
