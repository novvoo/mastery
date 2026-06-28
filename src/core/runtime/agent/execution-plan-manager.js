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
  isStrictMutation as isSemanticsStrictMutation,
  isInspection as isSemanticsInspection,
} from './support/tool-semantics.js';
import { shouldEnablePlan } from './support/task-profile.js';
import { PlanType, selectPlanType } from './support/plan-types.js';
import {
  HASHLINE_PLAN_COORDINATION_GUIDANCE,
  analyzeHashlinePatchResult,
  extractHashlinePatchPaths,
  isHashlinePatchTool,
} from './support/hashline-plan-policy.js';

const CANONICAL_SINGLETON_TASK_IDS = new Set([
  'inspect_workspace',
  'profile_project',
  'plan_solution',
  'implement_changes',
  'inspect_changes',
  'semantic_risk_review',
  'verify_result',
]);

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

export function isStrictMutationTool(toolName, args) {
  return isSemanticsStrictMutation(toolName, args);
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

export function isTddEvidenceTool(toolName, args, result = null) {
  if (['tdd', 'test_strategy'].includes(toolName)) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    return /\b(test|jest|vitest|pytest|bun\s+test|npm\s+(run\s+)?test|pnpm\s+test|yarn\s+test|go\s+test|cargo\s+test)\b/.test(
      command,
    );
  }
  if (['read_file', 'glob', 'search'].includes(toolName)) {
    const text = String(
      args?.path || args?.pattern || args?.query || args?.glob || result || '',
    ).toLowerCase();
    return /\b(test|tests|spec|__tests__|fixture|fixtures)\b/.test(text);
  }
  return false;
}

export function isProjectProfileTool(toolName, args, result = null) {
  if (toolName === 'project_profile') {
    return true;
  }
  const path = String(args?.path || args?.file_path || args?.file || '').toLowerCase();
  const query = String(
    args?.query || args?.pattern || args?.glob || args?.text || '',
  ).toLowerCase();
  const resultText =
    typeof result === 'string' ? result.toLowerCase() : JSON.stringify(result ?? '').toLowerCase();
  const profilePathPattern =
    /(package\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|tsconfig|jsconfig|vite\.config|vitest\.config|jest\.config|playwright\.config|eslint|biome|prettier|makefile|dockerfile|docker-compose|\.github\/workflows|pyproject\.toml|requirements(?:-[\w.-]+)?\.txt|setup\.py|setup\.cfg|tox\.ini|pytest\.ini|poetry\.lock|pipfile|go\.mod|go\.sum|cargo\.toml|cargo\.lock|gemfile|composer\.json|pom\.xml|build\.gradle|gradle\.properties|tests?\/|__tests__|spec\.|readme|context\.md)/;
  const profileIntentPattern =
    /(package|config|script|test|lint|typecheck|build|runner|framework|workspace|dependency|entry point|ci|workflow|pytest|jest|vitest|playwright|cargo|go test|make|gradle|maven|配置|脚本|测试|构建|依赖|入口|框架)/;
  if (toolName === 'read_file' && profilePathPattern.test(path)) {
    return true;
  }
  if (
    ['glob', 'search', 'search_codebase', 'semantic_search', 'grep_search', 'file_search'].includes(
      toolName,
    ) &&
    (profilePathPattern.test(query) || profileIntentPattern.test(query))
  ) {
    return true;
  }
  if (
    ['list_dir', 'tree', 'stat_file'].includes(toolName) &&
    (profilePathPattern.test(path) || profilePathPattern.test(resultText))
  ) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    return (
      /\b(cat|sed|rg|find|ls|npm|pnpm|yarn|bun|npx|python|pytest|pip|poetry|go|cargo|make|mvn|gradle)\b/.test(
        command,
      ) &&
      (profilePathPattern.test(command) ||
        profileIntentPattern.test(command) ||
        profilePathPattern.test(resultText))
    );
  }
  return false;
}

export function isSemanticRiskReviewTool(toolName, args, profile) {
  if (!profile?.requiresSemanticRiskReview && profile?.planType !== PlanType.SECURITY) {
    return false;
  }
  const focusText = String(
    args?.focus_areas ||
      args?.criteria ||
      args?.surface ||
      args?.area ||
      args?.target ||
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
  if (toolName === 'security_review') {
    return true;
  }
  if (toolName === 'review') {
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

  if (result && typeof result === 'object') {
    if (result.success === false || result.ok === false) {
      return false;
    }
    const exitCode = result.exitCode ?? result.code ?? result.status;
    if (typeof exitCode === 'number' && exitCode !== 0) {
      return false;
    }
    const errorCount = result.errorCount ?? result.errors;
    if (typeof errorCount === 'number' && errorCount > 0) {
      return false;
    }
    const failedCount = result.failed ?? result.failures ?? result.failedTests;
    if (typeof failedCount === 'number' && failedCount > 0) {
      return false;
    }
    if (result.error) {
      return false;
    }
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  if (!text.trim()) {
    return false;
  }
  const hashline = analyzeHashlinePatchResult('apply_hashline_patch', {}, result);
  if (hashline.isHashline && hashline.ok === false) {
    return false;
  }
  return !/(^(Error|Command failed|BLOCKED):|\b(exit\s*code|status)\s*[:=]?\s*[1-9]\d*\b|\b(fail|failed|failing|failures?|tests?\s+failed|errorCount)\b)/i.test(
    text.trim(),
  );
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
  #debugEvent = null;
  #sessionManager = null;
  #onPlanAdvance = null;
  #useExternalPlan = false;
  #verificationRepairCount = 0;

  constructor({ debugEvent = null, sessionManager = null, onPlanAdvance = null } = {}) {
    this.#debugEvent = typeof debugEvent === 'function' ? debugEvent : null;
    this.#sessionManager = sessionManager || null;
    this.#onPlanAdvance = typeof onPlanAdvance === 'function' ? onPlanAdvance : null;
  }

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

    // 兼容处理：profile 可能是 quickAssess 的完整返回值（包含 taskProfile 字段）。
    // 合并内外层，避免只取 taskProfile 时丢掉 isAnalysisTask/isResearchTask/risk 等旧字段。
    const taskProfile = this.#normalizePlanProfile(profile);
    this.#profile = taskProfile || null;

    if (this.#useExternalPlan && this.#plan) {
      this.#adjustExternalPlanByProfile(this.#plan, taskProfile);
      this.#emitPlanProgress({ planCreated: false, decompositionMethod: 'external' });
      return this.#plan;
    }

    this.#requiredMutationPaths = this.#extractRequestedFilePaths(this.#userInput);
    this.#completedMutationPaths = new Set();
    this.#mutationCallCount = 0;

    // 使用统一策略判断是否启用计划（考虑上下文）。
    // 计划不再只服务编码任务：诊断、分析、验证、项目运行/配置等多步任务也使用轻量 plan。
    const planContext = options.planContext || { complexityScore: 0, fileCount: 0 };
    const shouldPlan = this.#shouldCreatePlanForTask(taskProfile, this.#userInput, planContext);
    if (!shouldPlan) {
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
        let taskId = String(st.id || st.name || '').trim();
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

        // 如果没有 phase，尝试从任务名/描述推断
        const inferredPhase = st.phase || this.#inferTaskPhase(taskId, st.description || '');

        plan.addTask({
          id: taskId,
          name: st.description?.substring(0, 80) || st.name,
          description: st.description || '',
          dependencies: (st.dependencies || []).map((dep) => idMap.get(dep) || dep),
          scopeFiles: st.scopeFiles || [],
          phase: inferredPhase,
          metadata: { source: 'llm-decomposition', originalId },
        });
      }
    } else {
      // 模板模式：标准 inspect → plan → implement → verify
      this.#useLLMDecomposition = false;
      this.#buildTemplatePlan(plan, taskProfile, planType);
    }

    this.#ensureProjectProfileTask(plan, planType, taskProfile);
    this.#ensureTddGate(plan, planType, taskProfile);

    // 语义风险审查（两种模式通用）
    if (
      (taskProfile.requiresSemanticRiskReview || planType === PlanType.SECURITY) &&
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
          phase: ExecutionPlanManager.PHASE.VERIFICATION,
        });
      }
    }

    this.#normalizeTaskExecutionConstraints(plan);
    this.#enforcePhaseBarriers(plan);

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();

    // 启动第一批任务（依赖已满足且未被阶段屏障阻挡的）
    this.#startReadyTasks(plan);

    this.#plan = plan;
    this.#emitPlanProgress({
      planCreated: true,
      decompositionMethod: llmSubtasks ? 'llm' : 'auto',
    });
    return plan;
  }

  #normalizePlanProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }
    if (profile.taskProfile && typeof profile.taskProfile === 'object') {
      return {
        ...profile,
        ...profile.taskProfile,
        riskLevel: profile.riskLevel ?? profile.taskProfile.riskLevel,
        riskScore: profile.score ?? profile.riskScore ?? profile.taskProfile.riskScore,
        riskReasons: profile.reasons ?? profile.riskReasons ?? profile.taskProfile.riskReasons,
        semanticRiskDomains:
          profile.semanticRiskDomains ??
          profile.semanticDomains ??
          profile.taskProfile.semanticRiskDomains ??
          [],
        requiresAutomaticPlanning:
          profile.requiresAutomaticPlanning ?? profile.taskProfile.requiresAutomaticPlanning,
      };
    }
    return profile;
  }

  #shouldCreatePlanForTask(profile, userInput, planContext = {}) {
    if (!profile) {
      return false;
    }

    if (
      shouldEnablePlan(profile, planContext) ||
      profile.requiresAutomaticPlanning === true ||
      profile.requiresPlan === true ||
      profile.mode === 'mutate' ||
      profile.allowsMutation ||
      profile.isCodingTask ||
      profile.isModificationTask ||
      profile.isBugTask
    ) {
      return true;
    }

    const text = String(userInput || '');
    const lower = text.toLowerCase();
    const hasLocalEvidence =
      /(?:^|\s|["'`])(?:\.{1,2}\/|\/|~\/)[^\s"'`]+/.test(text) ||
      /\b[\w.-]+\.(?:js|ts|jsx|tsx|py|go|rs|java|json|yaml|yml|toml|md|html|css|sql|log)\b/i.test(
        text,
      ) ||
      /\b(src|tests?|app|pages|components|package\.json|webpack|vite|next|jest|vitest|pytest|cargo|go\.mod)\b/i.test(
        text,
      );
    const hasDiagnosticSignal =
      profile.intent === 'diagnosis' ||
      profile.mode === 'diagnose' ||
      profile.isAnalysisTask ||
      /\b(error|exception|failed|failing|broken|hang|stuck|crash|eaddrinuse|enoent|traceback|stack trace)\b/i.test(
        text,
      ) ||
      /(报错|错误|失败|崩溃|卡住|没响应|原因|为什么|排查|诊断)/i.test(text);
    const hasVerificationSignal =
      profile.intent === 'test_or_verify' ||
      profile.mode === 'verify' ||
      /\b(test|verify|validate|check|lint|build|compile|run|start|dev server|preview)\b/i.test(
        text,
      ) ||
      /(测试|验证|检查|构建|编译|运行|启动|预览)/i.test(text);
    const hasAnalysisSignal =
      profile.intent === 'read_only_analysis' ||
      profile.mode === 'inspect' ||
      profile.isResearchTask ||
      /(分析|审查|审计|评估|调研|梳理|看下|找出|定位)/i.test(text) ||
      /\b(analyze|review|audit|inspect|investigate|find out|locate)\b/i.test(text);
    const hasProjectQuestion =
      profile.intent === 'project_info' ||
      profile.intent === 'how_to_run' ||
      /(这个项目|当前项目|项目里|代码库|仓库|怎么运行|如何运行|怎么启动|如何启动)/i.test(text) ||
      /\b(this project|current project|repo|repository|codebase|how to run|how to start)\b/i.test(
        lower,
      );
    const hasMultipleSteps =
      /(\n|然后|接着|并且|同时|顺便|全部|多个|所有|先.*再|step|steps|then|also|and)/i.test(text) ||
      Number(planContext.complexityScore || 0) >= 2;

    if (hasDiagnosticSignal || hasVerificationSignal) {
      return true;
    }
    if ((hasAnalysisSignal || hasProjectQuestion) && (hasLocalEvidence || hasMultipleSteps)) {
      return true;
    }
    if (profile.requiresPlan === 'optional' && (hasLocalEvidence || hasMultipleSteps)) {
      return true;
    }

    return false;
  }

  /** 模板模式：根据任务类型生成不同的 plan DAG
   *
   * 任务类型 → 计划模板映射：
   * - 查询/回答类 (research, general): 轻量 2 步 → explore → answer
   * - 分析类 (analysis): 3 步 → explore → analyze → summarize
   * - 修改类 (coding, modification, bug_fix, documentation): 完整流程
   *   - bug_fix: inspect/reproduce → implement → inspect
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
      } else if (profile?.isCodingTask || profile?.requiresAutomaticPlanning) {
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
      } else if (profile?.requiresAutomaticPlanning) {
        taskType = 'coding';
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
          'Analyze the gathered information and identify concrete findings. This is a read-only analysis step, not an implementation step.',
        dependencies: ['inspect_workspace'],
        phase: ExecutionPlanManager.PHASE.INSPECTION,
      });
      plan.addTask({
        id: 'generate_report',
        name: 'Summarize findings',
        description:
          'Summarize the analysis in the final response. Do not create PROJECT_REPORT.md, REPORT.md, or any report file unless the user explicitly asks for one.',
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

    // ===== 新项目创建任务：工程化脚手架流程 =====
    if (intent === 'new_project') {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Inspect workspace',
        description: 'Check if workspace is empty or has existing files. Identify the project type (JS/TS/Python/etc.) and requirements.',
        dependencies: [],
        phase: ExecutionPlanManager.PHASE.EXPLORATION,
        allowedTools: ['list_dir', 'project_profile', 'read_file', 'shell'],
      });
      plan.addTask({
        id: 'setup_project_structure',
        name: 'Setup project structure',
        description: 'Create project directory structure with src/, tests/, configuration files (package.json, vite.config, eslint, etc.).',
        dependencies: ['inspect_workspace'],
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
        allowedTools: ['write_file', 'mkdir', 'shell'],
        scopeFiles: ['package.json', 'src/', 'tests/', 'vite.config.js', 'eslint.config.js', 'README.md'],
      });
      plan.addTask({
        id: 'implement_core',
        name: 'Implement core functionality',
        description: 'Create core source files in src/ directory with proper ES module structure. Separate logic, components, and styles.',
        dependencies: ['setup_project_structure'],
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
        allowedTools: ['write_file', 'edit_file'],
        scopeFiles: ['src/'],
      });
      plan.addTask({
        id: 'add_tests',
        name: 'Add tests',
        description: 'Create unit tests in tests/ directory for core logic. Verify test coverage.',
        dependencies: ['implement_core'],
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
        allowedTools: ['write_file', 'edit_file'],
        scopeFiles: ['tests/'],
      });
      plan.addTask({
        id: 'verify_build',
        name: 'Verify build and tests',
        description: 'Run npm install, npm run build, and npm test to verify the project builds correctly and tests pass.',
        dependencies: ['add_tests'],
        phase: ExecutionPlanManager.PHASE.VERIFICATION,
        allowedTools: ['shell', 'verify'],
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
        inspect: 'Inspect environment, check if workspace is empty, and identify existing package files or configs.',
        plan: 'Plan the project structure (src/, tests/, config files) and setup sequence.',
        implement: 'Create project structure and apply setup/configuration changes.',
        review: 'Review setup result, verify file structure and build configuration.',
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
      name: 'Inspect context',
      description: desc.inspect,
      dependencies: [],
      phase: ExecutionPlanManager.PHASE.EXPLORATION,
    });
    plan.addTask({
      id: 'plan_solution',
      name: 'Plan changes',
      description: desc.plan,
      dependencies: ['inspect_workspace'],
      phase: ExecutionPlanManager.PHASE.PLANNING,
    });
    plan.addTask({
      id: 'implement_changes',
      name: 'Apply changes',
      description: desc.implement,
      dependencies: ['plan_solution'],
      phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
    });
    plan.addTask({
      id: 'inspect_changes',
      name: 'Inspect changes',
      description: desc.review,
      dependencies: ['implement_changes'],
      phase: ExecutionPlanManager.PHASE.INSPECTION,
    });
  }

  #shouldUseLLMDecomposition(taskProfile, planType) {
    if (!taskProfile || taskProfile.isLikelyTrivial) {
      return false;
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
    if (
      taskProfile?.requiresSemanticRiskReview ||
      taskProfile?.requiresAutomaticPlanning ||
      taskProfile?.isCodingTask ||
      taskProfile?.isModificationTask ||
      taskProfile?.isBugTask ||
      taskProfile?.allowsMutation ||
      taskProfile?.mode === 'mutate'
    ) {
      return true;
    }
    return [
      PlanType.QUICK,
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
        'tree',
        'stat_file',
        'search',
        'search_codebase',
        'semantic_search',
        'grep_search',
        'file_search',
        'shell',
        'test_strategy',
      ],
      completionPredicate: ({ toolName, args, result }) =>
        isProjectProfileTool(toolName, args, result),
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
      [
        PlanType.QUICK,
        PlanType.RESEARCH,
        PlanType.ANALYSIS,
        PlanType.VERIFICATION,
        PlanType.DOCUMENTATION,
      ].includes(planType)
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

  #ensureTddGate(plan, planType, taskProfile) {
    if (!this.#shouldRequireTddGate(planType, taskProfile) || plan.getTask('tdd_reproduce')) {
      return;
    }

    const implementationTasks = Array.from(plan.tasks.values()).filter(
      (task) => task.phase === ExecutionPlanManager.PHASE.IMPLEMENTATION,
    );
    if (implementationTasks.length === 0) {
      return;
    }

    const anchor =
      plan.getTask('profile_project') ||
      plan.getTask('plan_solution') ||
      plan.getTask('inspect_workspace') ||
      Array.from(plan.tasks.values()).find(
        (task) => task.phase === ExecutionPlanManager.PHASE.PLANNING,
      );
    const anchorDeps = anchor ? [anchor.id] : [];

    plan.addTask({
      id: 'tdd_reproduce',
      name: 'Reproduce or define failing check',
      description:
        'Before editing, identify the narrowest failing test/check or define the test strategy that will prove the fix. A failing targeted test is valid evidence here.',
      dependencies: anchorDeps,
      phase: ExecutionPlanManager.PHASE.PLANNING,
      allowedTools: ['tdd', 'test_strategy', 'shell', 'read_file', 'glob', 'search'],
      completionPredicate: ({ toolName, args, result }) =>
        isTddEvidenceTool(toolName, args, result),
      metadata: {
        source: 'methodology-tdd-gate',
        expectedFailureEvidence: true,
      },
    });

    for (const task of implementationTasks) {
      task.dependencies.add('tdd_reproduce');
    }
    if (anchor?.id) {
      this.#reorderTasks(plan, {
        after: anchor.id,
        ids: ['tdd_reproduce'],
      });
    }
  }

  #normalizeTaskExecutionConstraints(plan) {
    for (const task of plan.tasks.values()) {
      if (task.id === 'semantic_risk_review') {
        task.phase = task.phase || ExecutionPlanManager.PHASE.INSPECTION;
        task.allowedTools = [
          'ask_user',
          'review',
          'verify',
          'shell',
          'security_review',
          'risk_check',
          'data_contract_check',
          'ui_acceptance',
        ];
        task.completionPredicate = ({ toolName, args }) =>
          isSemanticRiskReviewTool(toolName, args, this.#profile);
        continue;
      }
      if (task.id === 'profile_project' || task.id === 'tdd_reproduce') {
        if (Array.isArray(task.allowedTools) && !task.allowedTools.includes('ask_user')) {
          task.allowedTools.push('ask_user');
        }
        continue;
      }

      if (task.phase === ExecutionPlanManager.PHASE.EXPLORATION) {
        if (!task.allowedTools?.length) {
          task.allowedTools = [
            'ask_user',
            'list_dir',
            'read_file',
            'glob',
            'search',
            'semantic_search',
            'search_codebase',
            'grep_search',
            'file_search',
            'tree',
            'stat_file',
            'shell',
          ];
        }
        if (!task.completionPredicate) {
          task.completionPredicate = ({ toolName, args }) =>
            isWorkspaceInspectionTool(toolName, args);
        }
      } else if (task.phase === ExecutionPlanManager.PHASE.PLANNING) {
        if (!task.allowedTools?.length) {
          task.allowedTools = [
            'ask_user',
            'brainstorm',
            'grill',
            'zoom_out',
            'architect',
            'impact_map',
            'risk_check',
            'test_strategy',
            'migration_plan',
            'security_review',
            'data_contract_check',
            'ui_acceptance',
            'project_profile',
          ];
        }
        if (!task.completionPredicate) {
          task.completionPredicate = ({ toolName }) => isPlanningTool(toolName);
        }
      } else if (task.phase === ExecutionPlanManager.PHASE.IMPLEMENTATION) {
        if (!task.allowedTools?.length) {
          task.allowedTools = [
            'ask_user',
            'write_file',
            'edit_file',
            'delete_file',
            'rename_file',
            'mkdir',
            'apply_hashline_patch',
            'lsp_rename',
            'lsp_workspace_edit',
            'lsp_code_action',
            'git_apply_patch',
            'shell',
          ];
        }
        if (!task.completionPredicate) {
          task.completionPredicate = ({ toolName, args, result }) =>
            isStrictMutationTool(toolName, args) &&
            isSuccessfulToolResult(result) &&
            (!isHashlinePatchTool(toolName) ||
              analyzeHashlinePatchResult(toolName, args, result).ok === true);
        }
      } else if (task.phase === ExecutionPlanManager.PHASE.INSPECTION) {
        if (!task.allowedTools?.length) {
          task.allowedTools = [
            'ask_user',
            'read_file',
            'list_dir',
            'glob',
            'search',
            'shell',
            'review',
            'risk_check',
            'impact_map',
            'project_profile',
            'security_review',
            'data_contract_check',
            'ui_acceptance',
          ];
        }
        if (!task.completionPredicate) {
          task.completionPredicate = ({ toolName, args }) => isChangeInspectionTool(toolName, args);
        }
      } else if (task.phase === ExecutionPlanManager.PHASE.VERIFICATION) {
        if (!task.allowedTools?.length) {
          task.allowedTools = [
            'ask_user',
            'shell',
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
          ];
        }
        if (!task.completionPredicate) {
          task.completionPredicate = ({ toolName, args }) => isVerificationTool(toolName, args);
        }
      }
      if (Array.isArray(task.allowedTools) && !task.allowedTools.includes('ask_user')) {
        task.allowedTools.push('ask_user');
      }
    }
  }

  #shouldRequireTddGate(planType, taskProfile) {
    if (
      [
        PlanType.QUICK,
        PlanType.RESEARCH,
        PlanType.ANALYSIS,
        PlanType.CODE_REVIEW,
        PlanType.DOCUMENTATION,
        PlanType.VERIFICATION,
      ].includes(planType)
    ) {
      return false;
    }
    return Boolean(
      taskProfile?.isBugTask ||
      taskProfile?.isTestingTask ||
      taskProfile?.isCodingTask ||
      taskProfile?.isModificationTask ||
      taskProfile?.allowsMutation ||
      taskProfile?.mode === 'mutate' ||
      taskProfile?.requiresAutomaticPlanning ||
      [
        PlanType.BUG_FIX,
        PlanType.TESTING,
        PlanType.REFACTOR,
        PlanType.MIGRATION,
        PlanType.SETUP,
        PlanType.RELEASE,
        PlanType.SECURITY,
        PlanType.DATA,
        PlanType.UI,
      ].includes(planType),
    );
  }

  get plan() {
    return this.#plan;
  }
  get activePlan() {
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

  reset({ preserveExternalPlan = false } = {}) {
    if (preserveExternalPlan && this.#useExternalPlan && this.#plan) {
      return;
    }
    this.#plan = null;
    this.#profile = null;
    this.#userInput = '';
    this.#requiredMutationPaths = new Set();
    this.#completedMutationPaths = new Set();
    this.#mutationCallCount = 0;
    this.#useLLMDecomposition = false;
    this.#graphPlanner = null;
    this.#verificationRepairCount = 0;
    if (!preserveExternalPlan) {
      this.#useExternalPlan = false;
    }
  }

  exportSnapshot() {
    if (!this.#plan) {
      return null;
    }
    return {
      version: 1,
      userInput: this.#userInput,
      profile: this.#profile,
      useExternalPlan: this.#useExternalPlan,
      useLLMDecomposition: this.#useLLMDecomposition,
      verificationRepairCount: this.#verificationRepairCount,
      requiredMutationPaths: Array.from(this.#requiredMutationPaths),
      completedMutationPaths: Array.from(this.#completedMutationPaths),
      mutationCallCount: this.#mutationCallCount,
      plan: {
        ...this.#plan.toJSON(),
        tasks: this.#plan.toJSON().tasks.map((task) => ({
          ...task,
          toolCallsHistory: this.#plan.getTask(task.id)?.toolCallsHistory || [],
        })),
      },
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot?.plan?.tasks || !Array.isArray(snapshot.plan.tasks)) {
      return false;
    }

    const plan = ExecutionPlan.fromJSON(snapshot.plan);
    plan.status = snapshot.plan.status || TaskStatus.RUNNING;
    plan.createdAt = snapshot.plan.createdAt || plan.createdAt;
    plan.startedAt = snapshot.plan.startedAt || null;
    plan.completedAt = snapshot.plan.completedAt || null;

    for (const taskData of snapshot.plan.tasks) {
      const task = plan.getTask(taskData.id);
      if (!task) {
        continue;
      }
      task.status = taskData.status || TaskStatus.PENDING;
      task.startedAt = taskData.startedAt || null;
      task.completedAt = taskData.completedAt || null;
      task.result = taskData.result || null;
      task.error = taskData.error || null;
      task.metadata = taskData.metadata || {};
      task.scopeFiles = Array.isArray(taskData.scopeFiles) ? taskData.scopeFiles : [];
      task.allowedTools = Array.isArray(taskData.allowedTools) ? taskData.allowedTools : [];
      task.toolCallsHistory = Array.isArray(taskData.toolCallsHistory)
        ? taskData.toolCallsHistory
        : [];
      this.#rehydrateTaskCompletionPredicate(task);
    }

    this.#plan = plan;
    this.#profile = snapshot.profile || null;
    this.#userInput = String(snapshot.userInput || plan.description || '');
    this.#useExternalPlan = Boolean(snapshot.useExternalPlan);
    this.#useLLMDecomposition = Boolean(snapshot.useLLMDecomposition);
    this.#verificationRepairCount = Number(snapshot.verificationRepairCount || 0);
    this.#requiredMutationPaths = new Set(snapshot.requiredMutationPaths || []);
    this.#completedMutationPaths = new Set(snapshot.completedMutationPaths || []);
    this.#mutationCallCount = Number(snapshot.mutationCallCount || 0);
    this.#normalizeTaskExecutionConstraints(plan);
    this.#rebuildGraph(plan);
    this.#enforcePhaseBarriers(plan);
    this.#startReadyTasks(plan);
    this.#emitPlanProgress({
      planRestored: true,
      decompositionMethod: plan.context?.decomposition,
    });
    return true;
  }

  setPlan(plan) {
    if (!(plan instanceof ExecutionPlan)) {
      throw new Error('Invalid plan - must be an instance of ExecutionPlan');
    }
    this.#plan = plan;
    this.#useExternalPlan = true;
    // 确保计划状态是 RUNNING，即使是 COMPLETED 的计划也应该被重置
    if (plan.status === TaskStatus.COMPLETED || plan.status === TaskStatus.PENDING) {
      plan.status = TaskStatus.RUNNING;
      plan.startedAt = plan.startedAt || Date.now();
      plan.completedAt = null;
    }
    this.#enforcePhaseBarriers(plan);
    this.#startReadyTasks(plan);
    this.#emitPlanProgress({ planCreated: true, decompositionMethod: 'external' });
  }

  deriveCurrentPhase() {
    const current = this.currentTask;
    if (current?.phase) {
      return current.phase;
    }
    if (!this.#plan) {
      return null;
    }
    const tasks = Array.from(this.#plan.tasks.values());
    if (tasks.some((task) => task.status === TaskStatus.RUNNING)) {
      return (
        tasks.find((task) => task.status === TaskStatus.RUNNING && task.phase)?.phase ||
        ExecutionPlanManager.PHASE.EXPLORATION
      );
    }
    if (tasks.length > 0 && tasks.every((task) => task.status === TaskStatus.COMPLETED)) {
      return ExecutionPlanManager.PHASE.VERIFICATION;
    }
    return null;
  }

  getCurrentRunnableTask() {
    return this.currentTask;
  }

  getCurrentAllowedTools() {
    const task = this.currentTask;
    if (!task || !Array.isArray(task.allowedTools) || task.allowedTools.length === 0) {
      return null;
    }
    return task.allowedTools;
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

      this.#enforcePhaseBarriers(plan);
    } catch (error) {
      this.#restorePlanSnapshot(plan, snapshot);
      return { success: false, error: error.message };
    }

    plan.status = TaskStatus.RUNNING;
    plan.completedAt = null;
    this.#startReadyTasks(plan);
    this.#emitPlanProgress({
      planChanged: true,
      decompositionMethod: 'dynamic',
      reason,
      change: { mode, targetTaskId, insertedTasks, reason },
    });

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

    const plan = this.#plan;
    const before = this.#summarizeProgress(plan);

    if (
      !isSuccessfulToolResult(result) &&
      this.#canCurrentTaskAcceptFailedEvidence(plan, toolName, args, result)
    ) {
      this.#advanceWithStrictValidation(plan, toolName, args, result);
      const after = this.#summarizeProgress(plan);
      if (after === before) {
        return null;
      }
      this.#emitPlanProgress({ tool: toolName, expectedFailureEvidence: true });
      return { before, after, isCompleted: false };
    }

    if (!isSuccessfulToolResult(result)) {
      const handled =
        this.#handleFailedHashlineResult(plan, toolName, args, result) ||
        this.#handleFailedToolResult(plan, toolName, args, result);
      if (!handled) {
        return null;
      }
      const after = this.#summarizeProgress(plan);
      this.#debugEvent?.('Automatic task orchestration replanned after failed tool result', {
        tool: toolName,
        before,
        after,
      });
      this.#sessionManager?.addUserMessage?.(
        `Automatic task orchestration update:\n${after}\n\n` +
          `Verification failed. Continue with the current repair task: ${this.#currentTaskLabel(plan)}.`,
      );
      this.#emitPlanProgress({
        tool: toolName,
        planChanged: true,
        reason: isHashlinePatchTool(toolName) ? 'hashline_failed' : 'verification_failed',
      });
      return { before, after, isCompleted: false, replanned: true };
    }

    // ✅ 第 9 阶段：严格模式 — 使用 completionPredicate 验证
    this.#advanceWithStrictValidation(plan, toolName, args, result);

    const allDone = Array.from(plan.tasks.values()).every((t) => t.status === TaskStatus.COMPLETED);
    if (allDone) {
      plan.status = TaskStatus.COMPLETED;
      plan.completedAt = Date.now();
    }

    const after = this.#summarizeProgress(plan);
    if (after === before) {
      return null;
    }

    this.#debugEvent?.('Automatic task orchestration advanced', {
      tool: toolName,
      before,
      after,
    });
    this.#sessionManager?.addUserMessage?.(
      `Automatic task orchestration update:\n${after}\n\n` +
        `${
          plan.status === TaskStatus.COMPLETED
            ? 'All orchestrated tasks are complete. You may now provide FINAL_ANSWER with the change and verification summary.'
            : `Continue with the current ready task: ${this.#currentTaskLabel(plan)}.`
        }`,
    );
    this.#emitPlanProgress({ tool: toolName });

    return { before, after, isCompleted: plan.status === TaskStatus.COMPLETED };
  }

  #handleFailedHashlineResult(plan, toolName, args, result) {
    const hashline = analyzeHashlinePatchResult(toolName, args, result);
    if (!hashline.isHashline || hashline.ok !== false) {
      return false;
    }

    const runningImplementationTask = Array.from(plan.tasks.values()).find(
      (task) =>
        task.status === TaskStatus.RUNNING &&
        (task.phase === ExecutionPlanManager.PHASE.IMPLEMENTATION ||
          /implement|repair|retry|edit|change/i.test(task.id || task.name || '')),
    );
    if (!runningImplementationTask) {
      return false;
    }

    runningImplementationTask.recordToolCall(toolName, args, result);
    runningImplementationTask.updateStatus(TaskStatus.PENDING);
    runningImplementationTask.completedAt = null;
    runningImplementationTask.result = {
      completedBy: 'failed-hashline-observation',
      displayStatus: 'needs_repair',
      statusReason: 'Hashline edit failed; recovery tasks were added.',
      hashline,
      failureSummary: this.#summarizeFailureResult(result),
    };

    const conflictType = hashline.conflictType || 'hashline_failed';
    const failureSummary = this.#summarizeFailureResult(result);
    const baseId = `repair_after_hashline_failure_${Date.now().toString(36)}`;
    this.#insertTasksBefore(plan, runningImplementationTask.id, [
      {
        id: `${baseId}_diagnose`,
        name: 'Diagnose Hashline edit failure',
        description:
          `Inspect current file tags, stale anchors, and diagnostics before retrying. ` +
          `Conflict: ${conflictType}. Failure evidence: ${failureSummary}`,
        phase: ExecutionPlanManager.PHASE.INSPECTION,
        scopeFiles: hashline.affectedFiles,
        allowedTools: ['read_file', 'glob', 'search', 'shell', 'review'],
        metadata: { source: 'hashline-repair', conflictType, hashline },
      },
      {
        id: `${baseId}_retry`,
        name: 'Retry Hashline edit',
        description:
          'Rebuild the patch from the current file content and apply the smallest valid Hashline edit.',
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
        scopeFiles: hashline.affectedFiles,
        allowedTools: ['read_file', 'apply_hashline_patch', 'edit_file', 'write_file'],
        metadata: { source: 'hashline-repair', conflictType, hashline },
      },
      {
        id: `${baseId}_inspect`,
        name: 'Inspect Hashline edit result',
        description:
          'Read back the edited files or diff and confirm the retry matches the plan intent.',
        phase: ExecutionPlanManager.PHASE.INSPECTION,
        scopeFiles: hashline.affectedFiles,
        allowedTools: ['read_file', 'glob', 'search', 'shell', 'review'],
        metadata: { source: 'hashline-repair', conflictType, hashline },
      },
    ]);

    plan.status = TaskStatus.RUNNING;
    plan.completedAt = null;
    this.#enforcePhaseBarriers(plan);
    this.#startReadyTasks(plan);
    return true;
  }

  #handleFailedToolResult(plan, toolName, args, result) {
    if (!isVerificationTool(toolName, args)) {
      return false;
    }

    const runningVerificationTask = Array.from(plan.tasks.values()).find(
      (task) =>
        task.status === TaskStatus.RUNNING &&
        (task.phase === ExecutionPlanManager.PHASE.VERIFICATION ||
          task.id === 'verify_result' ||
          /verify|test|lint|build|check/i.test(task.id || task.name || '')),
    );
    if (!runningVerificationTask) {
      return false;
    }

    runningVerificationTask.recordToolCall(toolName, args, result);

    if (this.#verificationRepairCount >= 2) {
      runningVerificationTask.updateStatus(TaskStatus.FAILED, {
        error: {
          failedBy: toolName,
          args,
          result,
          reason: 'verification_failed_after_repair_budget',
        },
      });
      plan.status = TaskStatus.FAILED;
      plan.completedAt = Date.now();
      return true;
    }

    this.#verificationRepairCount += 1;
    const iteration = this.#verificationRepairCount;
    const baseId = `repair_after_verification_failure_${iteration}`;
    const failureSummary = this.#summarizeFailureResult(result);

    runningVerificationTask.updateStatus(TaskStatus.PENDING);
    runningVerificationTask.completedAt = null;
    runningVerificationTask.result = {
      completedBy: 'failed-verification-observation',
      verificationFailed: true,
      displayStatus: 'needs_repair',
      statusReason: 'Verification failed; repair tasks were added.',
      toolName,
      args,
      failureSummary,
      repairIteration: iteration,
    };

    this.#insertTasksBefore(plan, runningVerificationTask.id, [
      {
        id: `${baseId}_diagnose`,
        name: 'Diagnose verification failure',
        description: `Analyze the failed verification output and identify the root cause before editing. Failure evidence: ${failureSummary}`,
        phase: ExecutionPlanManager.PHASE.INSPECTION,
        allowedTools: ['read_file', 'list_dir', 'glob', 'search', 'shell', 'review'],
        metadata: { source: 'verification-repair', repairIteration: iteration },
      },
      {
        id: `${baseId}_fix`,
        name: 'Repair failed verification',
        description:
          'Apply the smallest code or test change needed to resolve the verification failure.',
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
        allowedTools: ['write_file', 'edit_file', 'apply_hashline_patch', 'shell'],
        metadata: { source: 'verification-repair', repairIteration: iteration },
      },
      {
        id: `${baseId}_inspect`,
        name: 'Inspect repair',
        description:
          'Read back the repaired files or diff and confirm the fix matches the failure.',
        phase: ExecutionPlanManager.PHASE.INSPECTION,
        allowedTools: ['read_file', 'list_dir', 'glob', 'search', 'shell', 'review'],
        metadata: { source: 'verification-repair', repairIteration: iteration },
      },
    ]);

    plan.status = TaskStatus.RUNNING;
    plan.completedAt = null;
    this.#enforcePhaseBarriers(plan);
    this.#startReadyTasks(plan);
    return true;
  }

  #summarizeFailureResult(result) {
    const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
    return text.replace(/\s+/g, ' ').trim().slice(0, 600) || 'verification command failed';
  }

  #canCurrentTaskAcceptFailedEvidence(plan, toolName, args, result) {
    const task = Array.from(plan.tasks.values()).find((t) => t.status === TaskStatus.RUNNING);
    if (!task?.metadata?.expectedFailureEvidence) {
      return false;
    }
    return task.canBeAdvancedBy(toolName, args, result);
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
    const runningTasks = Array.from(plan.tasks.values()).filter(
      (t) => t.status === TaskStatus.RUNNING,
    );

    if (runningTasks.length === 0) {
      this.#startReadyTasks(plan);
      return;
    }

    let matchedTask = null;
    let matchedByPredicate = false;

    for (const task of runningTasks) {
      if (task.canBeAdvancedBy(toolName, args, result)) {
        matchedTask = task;
        if (task.completionPredicate) {
          const validation = task.validateCompletion({ strictMode: false });
          if (validation.completed) {
            matchedByPredicate = true;
          }
        }
        break;
      }
    }

    if (!matchedTask) {
      this.#startReadyTasks(plan);
      return;
    }

    matchedTask.recordToolCall(toolName, args, result);

    const validation = matchedTask.validateCompletion({ strictMode: true });

    if (validation.completed || matchedByPredicate) {
      matchedTask.updateStatus(TaskStatus.COMPLETED, {
        result: { completedBy: 'strict-validation', toolName, args },
        validatedAt: Date.now(),
        validationReason: validation.reason,
      });

      this.#startReadyTasks(plan);
    }
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
  #advanceTemplatePlan(plan, toolName, args, result) {
    // 1) inspect_workspace
    this.#completeIf('inspect_workspace', () => isWorkspaceInspectionTool(toolName, args));
    this.#startReadyTasks(plan);

    // 2) profile_project — identify project config, scripts, and test surface
    this.#completeIf('profile_project', () => isProjectProfileTool(toolName, args, result));
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
        const phase = this.#formatPhaseForPrompt(t.phase);
        const displayStatus = this.#taskDisplayStatus(t);
        const cycleLabel = this.#taskCycleLabel(t);
        const cycleStr = cycleLabel ? `, ${cycleLabel}` : '';
        return `- ${t.id}: ${t.name} [${displayStatus}, ${phase}${cycleStr}]${scopeStr} - ${t.description}`;
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
        firstTaskPrompt = `▶ 当前子任务: ${firstTaskId} (${this.#formatPhaseForPrompt(runningTask.phase)}) — ${runningTask.description}`;
        if (runningTask.scopeFiles?.length) {
          firstTaskScope = `\n📁 文件作用域: ${runningTask.scopeFiles.join(', ')}`;
        }
      } else {
        firstTaskScope = runningTask.scopeFiles?.length
          ? ` 📁 当前子任务文件作用域: ${runningTask.scopeFiles.join(', ')}`
          : '';

        firstTaskPrompt = this.#buildCurrentTaskPrompt(runningTask);
      }
    }

    return (
      `Automatic task orchestration is active for this request:\n${this.#userInput}\n\n` +
      decompositionNote +
      `Phase meanings: exploration=understand existing context; planning=choose approach; implementation=make mutations; inspection=read/review changed or analyzed material; verification=run checks or summarize final evidence.\n` +
      `${tasks}\n\n` +
      `The DAG task ids are status labels, not tool names. Use real available tools such as list_dir, read_file, write_file, shell, and methodology tools.\n` +
      `${HASHLINE_PLAN_COORDINATION_GUIDANCE}\n` +
      `For existing code projects, complete profile_project by identifying package/config files, scripts, test modules, and verification commands before choosing implementation or tests.\n` +
      `When the current task offers methodology tools such as project_profile, impact_map, risk_check, test_strategy, security_review, data_contract_check, ui_acceptance, migration_plan, or release_checklist, prefer using the most relevant one before editing or finalizing.\n` +
      `If the plan becomes wrong during execution, call change_plan to append, replace, or insert tasks before continuing.\n` +
      `${this.#profile?.requiresSemanticRiskReview ? this.#buildSemanticRiskGuidance() + '\n' : ''}` +
      firstTaskPrompt +
      firstTaskScope
    );
  }

  #buildCurrentTaskPrompt(task) {
    const taskId = task?.id;
    const phase = this.#formatPhaseForPrompt(task?.phase);
    const description = task?.description || 'Complete this task using the appropriate tools.';
    const prefix = `Current task: ${taskId} (${phase}).`;

    if (taskId === 'inspect_workspace') {
      return `${prefix} ${description} Use focused read/search/list tools to understand only the relevant context.`;
    }

    if (taskId === 'profile_project') {
      return `${prefix} Identify package/config files, scripts, test modules, framework conventions, and the narrowest useful verification command. Use project_profile when available, or read/list/search config and test files.`;
    }

    if (taskId === 'plan_solution') {
      return `${prefix} ${description} Decide the smallest concrete change before editing. Do not create a separate plan/report file unless explicitly requested.`;
    }

    if (taskId === 'tdd_reproduce') {
      return `${prefix} ${description} Prefer test_strategy or run the narrowest existing test first; an expected failing test is progress here, not a reason to skip into implementation.`;
    }

    if (taskId === 'implement_changes') {
      const bugLike =
        this.#profile?.isBugTask ||
        this.#profile?.intent === 'diagnosis' ||
        this.#plan?.context?.planType === PlanType.BUG_FIX;
      const action = bugLike
        ? 'Apply the smallest fix that addresses the diagnosed failure.'
        : 'Apply the planned change with write_file, edit_file, apply_hashline_patch, or an appropriate filesystem/shell operation.';
      return `${prefix} ${description} ${action}`;
    }

    if (taskId === 'inspect_changes') {
      return `${prefix} ${description} Inspect the actual files or outputs affected by the previous mutation; this is not runtime verification.`;
    }

    if (taskId === 'verify_result') {
      return `${prefix} ${description} Run the narrowest relevant test/lint/build/check. If it fails, use the failure output as evidence, repair the issue, and re-run verification instead of finalizing.`;
    }

    if (taskId?.includes('repair_after_verification_failure')) {
      return `${prefix} ${description} Use the captured failure output as the source of truth; fix the root cause, inspect the changed files, then re-run the failing check.`;
    }

    if (taskId === 'analyze_findings') {
      return `${prefix} ${description} Keep this read-only unless the user asked for a fix.`;
    }

    if (taskId === 'generate_report') {
      return `${prefix} ${description} Summarize in FINAL_ANSWER; do not write REPORT.md/PROJECT_REPORT.md unless explicitly requested.`;
    }

    return `${prefix} ${description} Complete this task using the appropriate available tools.`;
  }

  #formatPhaseForPrompt(phase) {
    switch (phase) {
      case ExecutionPlanManager.PHASE.EXPLORATION:
        return 'exploration';
      case ExecutionPlanManager.PHASE.PLANNING:
        return 'planning';
      case ExecutionPlanManager.PHASE.IMPLEMENTATION:
        return 'implementation';
      case ExecutionPlanManager.PHASE.INSPECTION:
        return 'inspection';
      case ExecutionPlanManager.PHASE.VERIFICATION:
        return 'verification';
      default:
        return 'unphased';
    }
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
    if (!this.#plan) {
      return null;
    }

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
    if (!this.isActive || !this.#plan) {
      return null;
    }

    const { conflictType, affectedFiles, suggestedStrategies } = conflictHints || {};
    if (!conflictType) {
      return null;
    }

    // 找到当前所有 IMPLEMENTATION 阶段未完成的任务
    const blockedTasks = Array.from(this.#plan.tasks.values()).filter(
      (t) =>
        t.phase === ExecutionPlanManager.PHASE.IMPLEMENTATION &&
        (t.status === TaskStatus.RUNNING || t.status === TaskStatus.PENDING),
    );

    if (blockedTasks.length === 0) {
      return null;
    }

    const blockedTask = blockedTasks[0];
    const replanId = `replan_${conflictType}_${Date.now()}`;

    const diagnoseId = `${replanId}_diagnose`;
    const retryId = `${replanId}_retry`;

    const insertedTasks = this.#insertTasksBefore(this.#plan, blockedTask.id, [
      {
        id: diagnoseId,
        name: `Diagnose: ${conflictType}`,
        description: `Hashline 冲突检测: ${conflictType}。涉及文件: ${(affectedFiles || []).join(', ') || 'unknown'}。建议策略: ${(suggestedStrategies || ['re-read + retry']).join('; ')}`,
        phase: ExecutionPlanManager.PHASE.INSPECTION,
        scopeFiles: affectedFiles || [],
        metadata: { source: 'replan-diagnose', conflictType },
      },
      {
        id: retryId,
        name: `Retry after ${conflictType}`,
        description: `在诊断 hash 冲突后，用正确的上下文重新执行编辑。涉及文件: ${(affectedFiles || []).join(', ') || 'unknown'}`,
        phase: ExecutionPlanManager.PHASE.IMPLEMENTATION,
        scopeFiles: affectedFiles || [],
        metadata: { source: 'replan-retry', conflictType },
      },
    ]);

    this.#enforcePhaseBarriers(this.#plan);
    this.#startReadyTasks(this.#plan);

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
    if (!this.#plan) {
      return;
    }
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
    this.#pauseBlockedRunningTasks(plan);

    // 统计当前正在运行的任务数量
    const runningTasks = Array.from(plan.tasks.values()).filter(
      (t) => t.status === TaskStatus.RUNNING
    );
    const runningCount = runningTasks.length;

    // 最多允许 3 个并行任务
    const MAX_CONCURRENT_TASKS = 3;

    // 如果已经达到最大并发数，则不启动新任务
    if (runningCount >= MAX_CONCURRENT_TASKS) {
      return;
    }

    // 启动可以运行的任务，但不超过最大并发数
    let startedCount = 0;
    for (const task of plan.getReadyTasks()) {
      if (
        (task.status === TaskStatus.PENDING || task.status === TaskStatus.BLOCKED) &&
        this.#canStartTask(plan, task) &&
        startedCount < (MAX_CONCURRENT_TASKS - runningCount)
      ) {
        task.updateStatus(TaskStatus.RUNNING);
        startedCount++;
      }
    }
  }

  #enforcePhaseBarriers(plan) {
    if (!plan?.tasks) {
      return;
    }

    const phaseOrder = [
      ExecutionPlanManager.PHASE.EXPLORATION,
      ExecutionPlanManager.PHASE.PLANNING,
      ExecutionPlanManager.PHASE.IMPLEMENTATION,
      ExecutionPlanManager.PHASE.INSPECTION,
      ExecutionPlanManager.PHASE.VERIFICATION,
    ];
    const phaseRank = new Map(phaseOrder.map((phase, index) => [phase, index]));
    const phasedTasks = Array.from(plan.tasks.values()).filter((task) => phaseRank.has(task.phase));

    for (const task of phasedTasks) {
      const taskRank = phaseRank.get(task.phase);
      for (const candidate of phasedTasks) {
        if (candidate.id === task.id || phaseRank.get(candidate.phase) >= taskRank) {
          continue;
        }
        if (this.#taskDependsOn(plan, task.id, candidate.id)) {
          continue;
        }
        if (this.#taskDependsOn(plan, candidate.id, task.id)) {
          continue;
        }
        task.dependencies.add(candidate.id);
      }
    }

    this.#rebuildGraph(plan);
    this.#pauseBlockedRunningTasks(plan);
  }

  #canStartTask(plan, task) {
    return task.checkDependencies(plan.tasks) && !this.#hasIncompleteEarlierPhase(plan, task);
  }

  #pauseBlockedRunningTasks(plan) {
    if (!plan?.tasks) {
      return;
    }
    for (const task of plan.tasks.values()) {
      if (task.status !== TaskStatus.RUNNING) {
        continue;
      }
      if (!this.#canStartTask(plan, task)) {
        task.updateStatus(TaskStatus.PENDING, {
          result: {
            pausedBy: 'phase-barrier',
            reason: 'Waiting for dependencies or earlier phase tasks to complete.',
          },
        });
      }
    }
  }

  #hasIncompleteEarlierPhase(plan, task) {
    const taskRank = this.#phaseRank(task.phase);
    if (taskRank === null) {
      return false;
    }
    return Array.from(plan.tasks.values()).some((candidate) => {
      const candidateRank = this.#phaseRank(candidate.phase);
      return (
        candidate.id !== task.id &&
        candidateRank !== null &&
        candidateRank < taskRank &&
        !this.#taskDependsOn(plan, candidate.id, task.id) &&
        candidate.status !== TaskStatus.COMPLETED &&
        candidate.status !== TaskStatus.SKIPPED
      );
    });
  }

  #phaseRank(phase) {
    const phaseOrder = [
      ExecutionPlanManager.PHASE.EXPLORATION,
      ExecutionPlanManager.PHASE.PLANNING,
      ExecutionPlanManager.PHASE.IMPLEMENTATION,
      ExecutionPlanManager.PHASE.INSPECTION,
      ExecutionPlanManager.PHASE.VERIFICATION,
    ];
    const index = phaseOrder.indexOf(phase);
    return index === -1 ? null : index;
  }

  #taskDependsOn(plan, taskId, dependencyId, seen = new Set()) {
    if (taskId === dependencyId) {
      return true;
    }
    if (seen.has(taskId)) {
      return false;
    }
    seen.add(taskId);

    const task = plan.getTask(taskId);
    if (!task) {
      return false;
    }
    for (const depId of task.dependencies || []) {
      if (depId === dependencyId || this.#taskDependsOn(plan, depId, dependencyId, seen)) {
        return true;
      }
    }
    return false;
  }

  #recordMutationPath(toolName, args) {
    if (!['write_file', 'edit_file', 'apply_hashline_patch'].includes(toolName)) {
      return;
    }
    this.#mutationCallCount += 1;
    if (isHashlinePatchTool(toolName)) {
      const paths = extractHashlinePatchPaths(args);
      for (const path of paths) {
        this.#completedMutationPaths.add(String(path));
      }
      if (paths.length > 1) {
        this.#mutationCallCount += paths.length - 1;
      }
      return;
    }
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
      .tasks.map((t) => {
        const displayStatus = this.#taskDisplayStatus(t);
        const cycleLabel = this.#taskCycleLabel(t);
        return `- ${t.id}: ${displayStatus}${cycleLabel ? ` (${cycleLabel})` : ''}`;
      })
      .join('\n');
  }

  #taskDisplayStatus(task) {
    return (
      task?.displayStatus ||
      task?.result?.displayStatus ||
      (task?.result?.verificationFailed ? 'needs_repair' : null) ||
      task?.status ||
      TaskStatus.PENDING
    );
  }

  #taskStatusReason(task) {
    return (
      task?.statusReason ||
      task?.result?.statusReason ||
      (task?.result?.verificationFailed ? 'Verification failed; repair tasks were added.' : '')
    );
  }

  #taskCycleLabel(task) {
    const iteration = task?.metadata?.repairIteration || task?.result?.repairIteration;
    if (!iteration) {
      return '';
    }
    return `repair cycle ${iteration}`;
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
    if (inserted.length === 0) {
      return inserted;
    }
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
    if (inserted.length === 0) {
      return inserted;
    }
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
      const preferredId = this.#canonicalTaskId(
        raw.id || raw.name || `dynamic_task_${inserted.length + 1}`,
      );
      if (CANONICAL_SINGLETON_TASK_IDS.has(preferredId) && plan.tasks.has(preferredId)) {
        previousId = preferredId;
        continue;
      }
      const id = this.#uniqueTaskId(plan, preferredId);
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
    this.#normalizeTaskExecutionConstraints(plan);
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

  #canonicalTaskId(value) {
    return String(value || 'dynamic_task')
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
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

  #rehydrateTaskCompletionPredicate(task) {
    if (!task) {
      return;
    }
    if (task.id === 'profile_project') {
      task.completionPredicate = ({ toolName, args, result }) =>
        isProjectProfileTool(toolName, args, result);
      return;
    }
    if (task.id === 'tdd_reproduce') {
      task.completionPredicate = ({ toolName, args, result }) =>
        isTddEvidenceTool(toolName, args, result);
      task.metadata = {
        ...(task.metadata || {}),
        expectedFailureEvidence: true,
      };
      return;
    }
    if (task.id === 'verify_result' || /verify|test|lint|build|check/i.test(task.id)) {
      task.completionPredicate = ({ toolName, args }) => isVerificationTool(toolName, args);
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

  #currentTaskLabel(plan = this.#plan) {
    const task =
      Array.from(plan?.tasks?.values?.() || []).find((t) => t.status === TaskStatus.RUNNING) ||
      Array.from(plan?.tasks?.values?.() || []).find((t) => t.status === TaskStatus.PENDING);
    if (!task) {
      return 'none';
    }
    return `${task.id} (${task.name})`;
  }

  #emitPlanProgress(extra = {}) {
    if (!this.#onPlanAdvance || !this.#plan) {
      return;
    }
    const tasks = this.#plan.toJSON().tasks.map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      displayStatus: this.#taskDisplayStatus(task),
      statusReason: this.#taskStatusReason(task),
      cycleLabel: this.#taskCycleLabel(task),
      metadata: task.metadata || {},
      description: task.description,
      dependencies: [...(task.dependencies || [])],
      scopeFiles: task.scopeFiles || [],
    }));
    const completed = tasks.filter((task) => task.displayStatus === TaskStatus.COMPLETED).length;
    const running = tasks.filter((task) => task.displayStatus === TaskStatus.RUNNING).length;
    const failed = tasks.filter((task) => task.displayStatus === TaskStatus.FAILED).length;
    const needsRepair = tasks.filter((task) => task.displayStatus === 'needs_repair').length;
    this.#onPlanAdvance({
      ...extra,
      planId: this.#plan.id,
      tasks,
      total: tasks.length,
      completed,
      running,
      failed,
      needsRepair,
      planStatus: this.#plan.status,
      plan: {
        id: this.#plan.id,
        name: this.#plan.name,
        description: this.#plan.description,
        tasks,
        status: this.#plan.status,
        createdAt: this.#plan.createdAt,
        completedAt: this.#plan.completedAt,
        decompositionMethod:
          extra.decompositionMethod || this.#plan.context?.decomposition || 'auto',
        planType: this.#plan.context?.planType,
      },
    });
  }

  #adjustExternalPlanByProfile(plan, taskProfile) {
    if (!plan || !taskProfile) {
      return;
    }
    this.#profile = taskProfile;
    plan.context = {
      ...(plan.context || {}),
      planType: plan.context?.planType || selectPlanType(taskProfile, plan.description),
    };
    this.#ensureProjectProfileTask(plan, plan.context.planType, taskProfile);
    this.#ensureTddGate(plan, plan.context.planType, taskProfile);
    this.#normalizeTaskExecutionConstraints(plan);
    if (taskProfile.requiresSemanticRiskReview && !plan.getTask('semantic_risk_review')) {
      const lastId = Array.from(plan.tasks.keys()).at(-1);
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${(taskProfile.semanticRiskDomains || []).map((d) => d.label).join('; ')}.`,
        dependencies: lastId ? [lastId] : [],
        phase: ExecutionPlanManager.PHASE.INSPECTION,
        allowedTools: ['review', 'read_file', 'security_review', 'data_contract_check'],
      });
    }
    this.#rebuildGraph(plan);
    this.#startReadyTasks(plan);
  }

  /**
   * 根据任务名和描述推断生命周期阶段
   * 用于 LLM 分解时没有设置 phase 的任务
   */
  #inferTaskPhase(taskName, description) {
    const lower = (taskName + ' ' + description).toLowerCase();
    // 验证阶段：verify, test, validate, confirm, lint, build_check, 验证, 测试
    if (/\b(verify|test|validate|confirm|lint|build_check|check_diagnostics|run_tests|review_changes)\b/.test(lower) || /验证|测试/.test(lower)) {
      return ExecutionPlanManager.PHASE.VERIFICATION;
    }
    // 审查阶段：inspect, review, check, audit, read_back, 审查, 复查
    if (/\b(inspect_changes|review|audit|read_back|security_review|ui_acceptance|data_contract_check)\b/.test(lower) || /审[核查]|复查/.test(lower)) {
      return ExecutionPlanManager.PHASE.INSPECTION;
    }
    // 实现阶段：implement, create, edit, write, fix, add, update, refactor, build, code
    if (
      /\b(implement|create|edit|write|fix|add|update|refactor|build|code|implement_features|implement_changes|create_new_files|refactor_code)\b/.test(lower) ||
      /修改|实现|创建|編写|修复|重构/.test(lower)
    ) {
      return ExecutionPlanManager.PHASE.IMPLEMENTATION;
    }
    // 规划阶段：plan, design, architect, brainstorm, grill, zoom_out, approach
    if (/\b(plan|design|architect|brainstorm|grill|zoom_out|approach|plan_solution|design_changes|risk_check|test_strategy|migration_plan)\b/.test(lower) || /方案|设计|规划/.test(lower)) {
      return ExecutionPlanManager.PHASE.PLANNING;
    }
    // 探索阶段：inspect, explore, discover, read, gather, analyze
    if (
      /\b(inspect|explore|discover|read|gather|analyze|inspect_readme|inspect_workspace|inspect_existing_code|analyze_requirements|inspect_verification_target)\b/.test(lower) ||
      /了解|探索|检查|分析|读取|发现/.test(lower)
    ) {
      return ExecutionPlanManager.PHASE.EXPLORATION;
    }
    // 默认：null（阶段屏障不会对这些任务生效）
    return null;
  }
}

export default ExecutionPlanManager;
