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

import { ExecutionPlan, TaskStatus } from '../../../planner/graph-planner.js';

// ============== 工具谓词：根据工具名/args 推断它归属哪一阶段 ==============

export function isWorkspaceInspectionTool(toolName, args) {
  if (
    ['list_dir', 'glob', 'search', 'semantic_search', 'read_file', 'check_file'].includes(toolName)
  ) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || '').toLowerCase();
    return /\b(pwd|ls|find|rg|grep|tree|cat|stat)\b/.test(command);
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
  ].includes(toolName);
}

export function isMutationTool(toolName, args) {
  if (
    [
      'write_file',
      'edit_file',
      'git_apply_patch',
      'git_commit',
      'delete_file',
      'rename_file',
      'mkdir',
    ].includes(toolName)
  ) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    return /(^|\s)(bun|npm|pnpm|yarn|npx|node|python|pytest|vitest|jest|eslint|tsc|git|touch|cp|mv|rm|sed|perl|tee)\b|>|>>|apply_patch/.test(
      command,
    );
  }
  return false;
}

export function isChangeInspectionTool(toolName, args) {
  if (['read_file', 'list_dir', 'glob', 'search', 'check_file'].includes(toolName)) {
    return true;
  }
  if (toolName === 'shell') {
    const command = String(args?.command || '').toLowerCase();
    return /\b(cat|sed|awk|ls|find|rg|grep|git\s+diff|git\s+status)\b/.test(command);
  }
  return false;
}

export function isVerificationTool(toolName, args) {
  if (['verify', 'review', 'preview'].includes(toolName)) {
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

  constructor() {}

  /** 根据 profile 决定是否创建计划；返回 plan（非修改任务返回 null） */
  createIfNeeded(userInput, profile) {
    this.#userInput = String(userInput || '');
    this.#profile = profile || null;
    this.#requiredMutationPaths = this.#extractRequestedFilePaths(this.#userInput);
    this.#completedMutationPaths = new Set();

    if (!profile?.requiresAutomaticPlanning) {
      this.#plan = null;
      return null;
    }

    const planName = 'Automatic task execution plan';

    const plan = new ExecutionPlan({
      name: planName,
      description: this.#userInput,
      context: { source: 'react-agent', generatedAt: new Date().toISOString() },
    });

    const taskType = profile?.isBugTask
      ? 'bug_fix'
      : profile?.isDocumentationTask
      ? 'documentation'
      : profile?.isAnalysisTask
      ? 'analysis'
      : profile?.isResearchTask
      ? 'research'
      : profile?.isModificationTask
      ? 'modification'
      : profile?.isCodingTask
      ? 'coding'
      : 'general';

    let inspectDescription = 'Explore the context and gather necessary information before proceeding.';
    let planDescription = 'Plan the approach and define the steps needed to accomplish the task.';
    let implementDescription = 'Execute the planned approach to accomplish the task.';
    let inspectChangesDescription = 'Review the work that was done to ensure it meets requirements.';
    let verifyDescription = 'Verify the final result to confirm the task is complete.';

    switch (taskType) {
      case 'coding':
        inspectDescription = 'Discover the relevant project structure and existing files before reading or writing.';
        planDescription = 'Choose the implementation approach and file split for the requested change.';
        implementDescription = 'Create or edit the required files using the smallest necessary changes.';
        inspectChangesDescription = 'Read back or otherwise inspect the files that were created or edited.';
        verifyDescription = 'Run an appropriate command/tool to verify the requested behavior.';
        break;
      case 'modification':
        inspectDescription = 'Read the existing code to understand the current implementation.';
        planDescription = 'Plan the modification approach and identify the smallest necessary changes.';
        implementDescription = 'Make the planned changes to the existing code.';
        inspectChangesDescription = 'Read back the modified files to verify the changes.';
        verifyDescription = 'Run tests or verification commands to ensure the modification works correctly.';
        break;
      case 'bug_fix':
        inspectDescription = 'Read the relevant code to understand the bug and its root cause.';
        planDescription = 'Plan the minimal fix approach to resolve the bug.';
        implementDescription = 'Implement the bug fix directly. Focus on fixing, not analyzing.';
        inspectChangesDescription = 'Read back the fixed code to verify the changes.';
        verifyDescription = 'Run tests to verify the bug is resolved and no regressions were introduced.';
        break;
      case 'documentation':
        inspectDescription = 'Discover the project structure and identify existing documentation files.';
        planDescription = 'Plan the documentation structure, sections, and key topics to cover.';
        implementDescription = 'Create or update documentation files with clear, structured content.';
        inspectChangesDescription = 'Read back and review the documentation for clarity and completeness.';
        verifyDescription = 'Verify the documentation is complete, accurate, and well-structured.';
        break;
      case 'analysis':
        inspectDescription = 'Read relevant files, search codebase, and gather all necessary information for analysis.';
        planDescription = 'Plan the analysis approach and define the key questions to answer.';
        implementDescription = 'Analyze the gathered information and generate insights, findings, and recommendations.';
        inspectChangesDescription = 'Review the analysis results for accuracy and completeness.';
        verifyDescription = 'Verify the analysis conclusions against the actual codebase or evidence.';
        break;
      case 'research':
        inspectDescription = 'Clarify the research question and define the scope of the investigation.';
        planDescription = 'Plan the research approach and identify relevant sources to consult.';
        implementDescription = 'Search, read, and gather information from various sources to answer the research question.';
        inspectChangesDescription = 'Synthesize the research findings into a coherent summary.';
        verifyDescription = 'Verify the research findings are accurate, comprehensive, and well-sourced.';
        break;
    }

    if (taskType === 'bug_fix') {
      plan.addTask({
        id: 'implement_changes',
        name: 'Implement bug fix',
        description: implementDescription,
        dependencies: [],
      });
      plan.addTask({
        id: 'inspect_changes',
        name: 'Inspect changes',
        description: inspectChangesDescription,
        dependencies: ['implement_changes'],
      });
    } else {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Explore context',
        description: inspectDescription,
        dependencies: [],
      });
      plan.addTask({
        id: 'plan_solution',
        name: 'Plan approach',
        description: planDescription,
        dependencies: ['inspect_workspace'],
      });
      plan.addTask({
        id: 'implement_changes',
        name: 'Execute',
        description: implementDescription,
        dependencies: ['plan_solution'],
      });
      plan.addTask({
        id: 'inspect_changes',
        name: 'Review work',
        description: inspectChangesDescription,
        dependencies: ['implement_changes'],
      });
    }

    if (profile.requiresSemanticRiskReview) {
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${(profile.semanticRiskDomains || []).map((d) => d.label).join('; ')}.`,
        dependencies: ['inspect_changes'],
      });
    }

    plan.addTask({
      id: 'verify_result',
      name: 'Verify result',
      description: verifyDescription,
      dependencies: profile.requiresSemanticRiskReview
        ? ['semantic_risk_review']
        : ['inspect_changes'],
    });

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();

    const firstTaskId = plan.tasks.keys().next().value;
    plan.getTask(firstTaskId)?.updateStatus(TaskStatus.RUNNING);

    this.#plan = plan;
    return plan;
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

  /** 记录工具调用后推进计划；返回 plan 的新摘要（若有变化） */
  advance(toolName, args, result) {
    if (!this.isActive) {
      return null;
    }
    if (!isSuccessfulToolResult(result)) {
      return null;
    }

    const plan = this.#plan;
    const before = this.#summarizeProgress(plan);

    // 1) inspect_workspace
    this.#completeIf('inspect_workspace', () => isWorkspaceInspectionTool(toolName, args));
    this.#startReadyTasks(plan);

    // 2) plan_solution — 显式的计划工具 OR 直接开始修改（即跳过计划阶段也可以）
    this.#completeIf(
      'plan_solution',
      () => isPlanningTool(toolName) || isMutationTool(toolName, args),
    );
    this.#startReadyTasks(plan);

    // 3) implement_changes — 记录路径并检查 requiredMutationPaths
    this.#recordMutationPath(toolName, args);
    this.#completeIf(
      'implement_changes',
      () => isMutationTool(toolName, args) && this.#hasCompletedRequiredMutationPaths(),
    );
    this.#startReadyTasks(plan);

    // 4) inspect_changes
    this.#completeIf('inspect_changes', () => isChangeInspectionTool(toolName, args));
    this.#startReadyTasks(plan);

    // 5) semantic_risk_review（可选）
    this.#completeIf('semantic_risk_review', () =>
      isSemanticRiskReviewTool(toolName, args, this.#profile),
    );
    this.#startReadyTasks(plan);

    // 6) verify_result
    this.#completeIf('verify_result', () => isVerificationTool(toolName, args));
    this.#startReadyTasks(plan);

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
          t.scopeFiles && t.scopeFiles.length > 0
            ? ` [📁: ${t.scopeFiles.join(', ')}]`
            : '';
        return `- ${t.id}: ${t.name} [${t.status}]${scopeStr} - ${t.description}`;
      })
      .join('\n');
    const firstTask = plan.getTask('implement_changes') || plan.getTask('inspect_workspace');
    const firstTaskId = firstTask ? firstTask.id : 'inspect_workspace';
    const firstTaskScope =
      firstTask && firstTask.scopeFiles?.length
        ? ` 📁 当前子任务文件作用域: ${firstTask.scopeFiles.join(', ')}`
        : '';
    const firstTaskPrompt =
      firstTaskId === 'implement_changes'
        ? `Current task: implement_changes. Read the relevant code with read_file, identify the bug, then fix it with write_file or edit_file. Do NOT produce a diagnostic report — fix the bug.`
        : `Current task: inspect_workspace. Call list_dir or another filesystem discovery tool first, then continue through the plan.`;

    return (
      `Automatic task orchestration is active for this request:\n${this.#userInput}\n\n` +
      `Execute this DAG in dependency order. Do not skip ahead, and do not provide FINAL_ANSWER until every task is completed.\n` +
      `${tasks}\n\n` +
      `The DAG task ids are status labels, not tool names. Use real available tools such as list_dir, read_file, write_file, shell, and methodology tools.\n` +
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
    const path = args?.path || args?.file_path || args?.file;
    if (path) {
      this.#completedMutationPaths.add(String(path));
    }
  }

  #hasCompletedRequiredMutationPaths() {
    if (this.#requiredMutationPaths.size === 0) {
      return true;
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
