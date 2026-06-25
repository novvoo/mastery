/**
 * AgentPlanner — 执行计划创建、推进与阶段推导
 *
 * 从 ReActAgent 拆出的职责：
 *   - 根据任务 profile 创建自动化执行计划 (inspect -> plan -> implement -> verify)
 *   - 根据工具调用结果推进计划状态
 *   - 推导当前执行阶段 (exploration/planning/implementation/inspection/verification)
 *   - 生成面向 LLM 的计划状态提示
 *   - 跟踪必要的文件修改路径
 *
 * 三层执行链集成（Phase 7）：
 *   Methodology（阶段约束） ← Plan（任务 DAG） ← Executor（当前可执行任务）
 *   - PlanExecutor 负责选出 currentRunnableTask
 *   - 当前 task 的 phase 属性直接驱动 methodology phase
 *   - ToolRouter 按 currentTask.allowedTools 限制可用工具
 *   - System Prompt 按当前 task 注入执行约束
 * 这样 Plan 不再是“展示列表”，而是真正的执行调度器。
 */

import { ExecutionPlan, TaskStatus, PlanExecutor } from '../../../planner/graph-planner.js';
import {
  isWorkspaceInspectionTool,
  isPlanningTool,
  isMutationTool,
  isChangeInspectionTool,
  isVerificationTool,
  isSemanticRiskReviewTool,
  isSuccessfulToolResult,
} from './execution-plan-manager.js';

export class AgentPlanner {
  #debugEvent;
  #sessionManager;
  #onPlanAdvance;

  /** @type {ExecutionPlan|null} */
  #activePlan = null;
  /** @type {PlanExecutor|null} */
  #executor = null;
  /** @type {Set<string>} */
  #requiredMutationPaths = new Set();
  /** @type {Set<string>} */
  #completedMutationPaths = new Set();
  /** @type {boolean} */
  #useExternalPlan = false;

  constructor({ debugEvent, sessionManager, onPlanAdvance }) {
    this.#debugEvent = debugEvent;
    this.#sessionManager = sessionManager;
    this.#onPlanAdvance = typeof onPlanAdvance === 'function' ? onPlanAdvance : null;
  }

  /**
   * 设置外部创建的 plan（由 GraphPlanner 创建）
   * @param {ExecutionPlan} plan - 外部创建的执行计划
   */
  setPlan(plan) {
    if (!(plan instanceof ExecutionPlan)) {
      throw new Error('Invalid plan - must be an instance of ExecutionPlan');
    }

    this.#activePlan = plan;
    this.#useExternalPlan = true;

    // ✅ 创建 PlanExecutor 来管理任务执行
    this.#executor = new PlanExecutor(plan);

    if (plan.status === TaskStatus.RUNNING) {
      const runningTask = Array.from(plan.tasks.values()).find(
        (t) => t.status === TaskStatus.RUNNING,
      );
      if (!runningTask) {
        const firstReadyTask = Array.from(plan.tasks.values()).find(
          (t) => t.status === TaskStatus.PENDING && t.dependencies.size === 0,
        );
        if (firstReadyTask) {
          firstReadyTask.updateStatus(TaskStatus.RUNNING);
        }
      }
    }

    // 推送计划创建事件到 UI
    if (this.#onPlanAdvance) {
      const tasks = plan.toJSON().tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        description: t.description,
        dependencies: [...t.dependencies],
        scopeFiles: t.scopeFiles || [],
      }));
      this.#onPlanAdvance({
        planId: plan.id,
        planCreated: true,
        tasks,
        total: tasks.length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        running: tasks.filter((t) => t.status === 'running').length,
        failed: tasks.filter((t) => t.status === 'failed').length,
        planStatus: plan.status,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          tasks,
          status: plan.status,
          createdAt: plan.createdAt,
          decompositionMethod: 'external',
        },
      });
    }
  }

  /**
   * 根据用户输入和任务 profile 创建执行计划（编码任务强制走 plan）
   * 如果已经设置了外部 plan，则直接使用外部 plan
   * @returns {ExecutionPlan|null}
   */
  createIfNeeded(userInput, taskProfile) {
    if (this.#useExternalPlan && this.#activePlan) {
      // 即使使用外部 plan，也需要根据 taskProfile 进行调整
      this.#adjustPlanByTaskProfile(this.#activePlan, taskProfile);
      return this.#activePlan;
    }

    const isCoding =
      taskProfile?.isCodingTask || taskProfile?.isModificationTask || taskProfile?.isBugTask;
    if (!isCoding && !taskProfile?.requiresAutomaticPlanning) {
      return null;
    }

    const plan = new ExecutionPlan({
      name: 'Automatic coding task plan',
      description: userInput,
      context: {
        source: 'react-agent',
        generatedAt: new Date().toISOString(),
      },
    });

    plan.addTask({
      id: 'inspect_workspace',
      name: 'Inspect workspace',
      description:
        'Discover the relevant project structure and existing files before reading or writing.',
      dependencies: [],
      phase: 'exploration',
      allowedTools: ['list_dir', 'glob', 'read_file', 'search_codebase', 'semantic_search'],
    });
    plan.addTask({
      id: 'plan_solution',
      name: 'Plan solution',
      description: 'Choose the implementation approach and file split for the requested change.',
      dependencies: ['inspect_workspace'],
      phase: 'planning',
      allowedTools: ['ask_user', 'brainstorm', 'architect', 'tdd'],
    });
    plan.addTask({
      id: 'implement_changes',
      name: 'Implement changes',
      description: 'Create or edit the required files using the smallest necessary changes.',
      dependencies: ['plan_solution'],
      phase: 'implementation',
      allowedTools: ['write_file', 'edit_file', 'apply_hashline_patch', 'shell'],
    });
    plan.addTask({
      id: 'inspect_changes',
      name: 'Inspect changes',
      description: 'Read back or otherwise inspect the files that were created or edited.',
      dependencies: ['implement_changes'],
      phase: 'inspection',
      allowedTools: ['read_file', 'list_dir', 'glob', 'search_codebase'],
    });
    if (taskProfile.requiresSemanticRiskReview) {
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${taskProfile.semanticRiskDomains.map((d) => d.label).join('; ')}.`,
        dependencies: ['inspect_changes'],
        phase: 'inspection',
        allowedTools: ['review', 'read_file'],
      });
    }
    plan.addTask({
      id: 'verify_result',
      name: 'Verify result',
      description: 'Run an appropriate command/tool to verify the requested behavior.',
      dependencies: taskProfile.requiresSemanticRiskReview
        ? ['semantic_risk_review']
        : ['inspect_changes'],
      phase: 'verification',
      allowedTools: ['shell', 'verify', 'lsp_diagnostics'],
    });

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();
    plan.getTask('inspect_workspace')?.updateStatus(TaskStatus.RUNNING);

    this.#activePlan = plan;
    this.#requiredMutationPaths = this.#extractRequestedFilePaths(userInput);
    this.#completedMutationPaths = new Set();

    // ✅ 创建 PlanExecutor，使模板计划也能被 Executor 层调度
    this.#executor = new PlanExecutor(plan);

    // 推送计划创建事件到 UI
    if (this.#onPlanAdvance) {
      const tasks = plan.toJSON().tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        description: t.description,
        dependencies: [...t.dependencies],
      }));
      this.#onPlanAdvance({
        planId: plan.id,
        planCreated: true,
        tasks,
        total: tasks.length,
        completed: 0,
        running: 1,
        failed: 0,
        planStatus: plan.status,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          tasks,
          status: plan.status,
          createdAt: plan.createdAt,
          decompositionMethod: 'auto',
        },
      });
    }

    return plan;
  }

  /** 重置当前计划（每次 run 开始时调用） */
  reset({ preserveExternalPlan = false } = {}) {
    if (preserveExternalPlan && this.#useExternalPlan && this.#activePlan) {
      this.#requiredMutationPaths = new Set();
      this.#completedMutationPaths = new Set();
      return;
    }

    this.#activePlan = null;
    this.#useExternalPlan = false;
    this.#executor = null;
    this.#requiredMutationPaths = new Set();
    this.#completedMutationPaths = new Set();
  }

  /** @returns {ExecutionPlan|null} */
  get activePlan() {
    return this.#activePlan;
  }

  /**
   * 动态修改当前计划。
   *
   * mode:
   * - replace: 用 tasks 替换所有未完成任务，保留 completed 任务作为进度基座
   * - insertBefore: 将 tasks 插入 targetTaskId 之前
   * - insertAfter: 将 tasks 插入 targetTaskId 之后
   * - append: 将 tasks 追加到计划末尾
   */
  changePlan({ mode = 'append', tasks = [], targetTaskId = null, reason = '' } = {}) {
    const plan = this.#activePlan;
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

      if (plan.detectCycle()) {
        this.#restorePlanSnapshot(plan, snapshot);
        return { success: false, error: 'Plan change would create a dependency cycle' };
      }
    } catch (error) {
      this.#restorePlanSnapshot(plan, snapshot);
      return { success: false, error: error.message };
    }

    plan.status = TaskStatus.RUNNING;
    plan.completedAt = null;
    this.#executor = new PlanExecutor(plan);
    this.#startReadyTasks(plan);

    const after = this.#summarizeProgress(plan);
    this.#debugEvent('Dynamic plan change applied', {
      mode,
      targetTaskId,
      reason,
      insertedTasks,
      before,
      after,
    });

    this.#sessionManager.addUserMessage(
      `Automatic task orchestration plan changed (${mode}${reason ? `: ${reason}` : ''}).\n` +
        `${after}\n\nContinue with the current ready task: ${this.#currentTaskLabel(plan)}.`,
    );
    this.#emitPlanProgress(plan, {
      planChanged: true,
      change: { mode, targetTaskId, reason, insertedTasks },
      decompositionMethod: 'dynamic',
    });

    return {
      success: true,
      plan,
      insertedTasks,
      planStatus: plan.status,
    };
  }

  /**
   * 推导当前执行阶段
   * 三层架构原则：优先使用当前可执行 Plan task 的 phase 属性驱动 methodology phase。
   * 这样 Plan task 成为 phase 的单一事实来源，避免全局 phase 与 Plan 脱节。
   * @returns {string|null} exploration|planning|implementation|inspection|verification
   */
  deriveCurrentPhase() {
    const plan = this.#activePlan;
    if (!plan || plan.status !== TaskStatus.RUNNING) {
      return null;
    }

    // 1) 最高优先级：当前可执行任务的 phase 属性（Plan → Methodology）
    const currentTask = this.getCurrentRunnableTask();
    if (currentTask?.phase) {
      return currentTask.phase;
    }

    const runningTask = Array.from(plan.tasks.values()).find(
      (task) => task.status === TaskStatus.RUNNING,
    );

    if (runningTask) {
      // 2) 次优先级：task 对象上的 phase 字段（LLM 分解任务通常带有）
      if (runningTask.phase) {
        return runningTask.phase;
      }

      switch (runningTask.id) {
        case 'inspect_workspace':
        case 'gather_information':
        case 'define_research_scope':
          return 'exploration';
        case 'plan_solution':
        case 'plan_documentation':
          return 'planning';
        case 'implement_changes':
        case 'write_documentation':
        case 'perform_analysis':
        case 'conduct_research':
          return 'implementation';
        case 'inspect_changes':
        case 'review_documentation':
        case 'review_analysis':
        case 'synthesize_findings':
          return 'inspection';
        case 'semantic_risk_review':
        case 'verify_result':
        case 'verify_documentation':
        case 'verify_analysis':
        case 'verify_findings':
          return 'verification';
      }
    }

    // 所有 task 已完成但 plan 未关闭 → 验证阶段
    const allCompleted = Array.from(plan.tasks.values()).every(
      (task) => task.status === TaskStatus.COMPLETED,
    );
    if (allCompleted) {
      return 'verification';
    }

    return null;
  }

  /**
   * 根据工具调用结果推进执行计划
   */
  advance(toolName, args, result) {
    const plan = this.#activePlan;
    if (!plan || plan.status !== TaskStatus.RUNNING) {
      return;
    }
    if (!isSuccessfulToolResult(result)) {
      return;
    }

    const before = this.#summarizeProgress(plan);

    this.#completeTaskIf('inspect_workspace', toolName, args, result, () =>
      isWorkspaceInspectionTool(toolName, args),
    );
    this.#startReadyTasks(plan);
    // plan_solution 可以通过显式的计划工具或直接开始修改来完成
    this.#completeTaskIf(
      'plan_solution',
      toolName,
      args,
      result,
      () => isPlanningTool(toolName) || isMutationTool(toolName, args),
    );
    this.#startReadyTasks(plan);
    this.#recordMutationPath(toolName, args);
    this.#completeTaskIf(
      'implement_changes',
      toolName,
      args,
      result,
      () => isMutationTool(toolName, args) && this.#hasCompletedRequiredMutationPaths(),
    );
    this.#startReadyTasks(plan);
    this.#completeTaskIf('inspect_changes', toolName, args, result, () =>
      isChangeInspectionTool(toolName, args),
    );
    this.#startReadyTasks(plan);
    this.#completeTaskIf('semantic_risk_review', toolName, args, result, () =>
      isSemanticRiskReviewTool(toolName, args, this.#activePlan),
    );
    this.#startReadyTasks(plan);
    this.#completeTaskIf('verify_result', toolName, args, result, () =>
      isVerificationTool(toolName, args),
    );
    this.#startReadyTasks(plan);

    if (Array.from(plan.tasks.values()).every((task) => task.status === TaskStatus.COMPLETED)) {
      plan.status = TaskStatus.COMPLETED;
      plan.completedAt = Date.now();
    }

    const after = this.#summarizeProgress(plan);
    if (after !== before) {
      this.#debugEvent('Automatic task orchestration advanced', {
        tool: toolName,
        before,
        after,
      });
      this.#sessionManager.addUserMessage(
        `Automatic task orchestration update:\n${after}\n\n` +
          `${
            plan.status === TaskStatus.COMPLETED
              ? 'All orchestrated tasks are complete. You may now provide FINAL_ANSWER with the change and verification summary.'
              : `Continue with the current ready task: ${this.#currentTaskLabel(plan)}.`
          }`,
      );
      // 推送计划进度到 UI（实时更新 plan 卡片）
      if (this.#onPlanAdvance) {
        const tasks = plan.toJSON().tasks.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          description: t.description,
          dependencies: [...t.dependencies],
          scopeFiles: t.scopeFiles || [],
        }));
        this.#onPlanAdvance({
          planId: plan.id,
          tasks,
          total: tasks.length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          running: tasks.filter((t) => t.status === 'running').length,
          failed: tasks.filter((t) => t.status === 'failed').length,
          planStatus: plan.status,
          plan: {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            tasks,
            status: plan.status,
            createdAt: plan.createdAt,
            completedAt: plan.completedAt,
            decompositionMethod: 'auto',
          },
        });
      }
    }
  }

  /**
   * 生成面向 LLM 的执行计划提示
   */
  buildPrompt(userInput, semanticRiskGuidance = '') {
    const plan = this.#activePlan;
    if (!plan) {
      return '';
    }

    const tasks = plan
      .toJSON()
      .tasks.map((task) => `- ${task.id}: ${task.name} [${task.status}] - ${task.description}`)
      .join('\n');

    return (
      `Automatic task orchestration is active for this request:\n${userInput}\n\n` +
      `Execute this DAG in dependency order. Do not skip ahead, and do not provide FINAL_ANSWER until every task is completed.\n` +
      `${tasks}\n\n` +
      `The DAG task ids are status labels, not tool names. Use real available tools such as list_dir, read_file, write_file, shell, and methodology tools.\n` +
      `${semanticRiskGuidance ? `${semanticRiskGuidance}\n` : ''}` +
      `Current task: inspect_workspace. Call list_dir or another filesystem discovery tool first, then continue through the plan.`
    );
  }

  /** 计划是否已完成 */
  isCompleted() {
    return this.#activePlan?.status === TaskStatus.COMPLETED;
  }

  // ---- private ----

  #completeTaskIf(taskId, toolName, args, result, predicate) {
    const task = this.#activePlan?.getTask(taskId);
    if (
      !task ||
      task.status === TaskStatus.COMPLETED ||
      !task.checkDependencies(this.#activePlan.tasks)
    ) {
      return;
    }
    if (!predicate()) {
      return;
    }

    // ✅ 第 9 阶段增强：记录工具调用历史
    task.recordToolCall(toolName, args, result);

    // ✅ 第 9 阶段：双重验证 — 先检查 canBeAdvancedBy，再用 validateCompletion 严格验证
    if (!task.canBeAdvancedBy(toolName, args, result)) {
      this.#debugEvent('Task completion blocked by task constraints', {
        taskId,
        toolName,
        allowedTools: task.allowedTools,
        completionPredicate: task.completionPredicate
          ? typeof task.completionPredicate === 'function'
            ? 'function'
            : task.completionPredicate
          : null,
      });
      return; // 工具不被此任务接受，不标记完成
    }

    // ✅ 第 9 阶段：严格的多维度完成条件验证（防止虚假完成）
    const validation = task.validateCompletion({ strictMode: true });
    if (!validation.completed) {
      this.#debugEvent('Task strict validation failed - not marking complete', {
        taskId,
        toolName,
        missingRequirements: validation.missingRequirements,
        reason: validation.reason,
        toolCallsHistoryLength: task.toolCallsHistory.length,
      });
      // 不标记为 COMPLETED，让任务继续等待更多工具调用
      return;
    }

    // 所有验证通过，正式标记为 COMPLETED
    task.updateStatus(TaskStatus.COMPLETED, {
      result: { completedBy: 'strict-validation', toolName, validationReason: validation.reason },
      validatedAt: Date.now(),
    });

    this.#debugEvent('Task completed with strict validation', {
      taskId,
      toolName,
      validationReason: validation.reason,
      totalToolCalls: task.toolCallsHistory.length,
    });
  }

  #startReadyTasks(plan) {
    const readyTasks = [
      ...Array.from(plan.tasks.values()).filter((task) => task.status === TaskStatus.READY),
      ...plan.getReadyTasks(),
    ];
    for (const task of readyTasks) {
      if (
        task.status === TaskStatus.PENDING ||
        task.status === TaskStatus.BLOCKED ||
        task.status === TaskStatus.READY
      ) {
        task.updateStatus(TaskStatus.RUNNING);
        return;
      }
    }
  }

  #summarizeProgress(plan) {
    return plan
      .toJSON()
      .tasks.map((task) => `- ${task.id}: ${task.status}`)
      .join('\n');
  }

  #currentTaskLabel(plan) {
    const active = Array.from(plan.tasks.values()).find(
      (task) =>
        task.status === TaskStatus.RUNNING ||
        task.status === TaskStatus.PENDING ||
        task.status === TaskStatus.BLOCKED,
    );
    return active ? `${active.id} (${active.name})` : 'none';
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
        .filter((path) => path.includes('/'))
        .map((path) => path.split('/').pop()),
    );
    for (const path of Array.from(paths)) {
      if (!path.includes('/') && basenamesWithDirectory.has(path)) {
        paths.delete(path);
      }
    }
    return paths;
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
    for (const path of this.#requiredMutationPaths) {
      if (!this.#completedMutationPaths.has(path)) {
        return false;
      }
    }
    return true;
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

    const inserted = this.#addTaskChain(plan, taskDefs, { defaultFirstDependencies: [targetTaskId] });
    const lastInserted = inserted[inserted.length - 1];
    for (const task of plan.tasks.values()) {
      if (inserted.includes(task.id) || task.id === targetTaskId || task.status === TaskStatus.COMPLETED) {
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
      const id = this.#uniqueTaskId(plan, raw.id || raw.name || `dynamic_task_${inserted.length + 1}`);
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
      edges: new Map(Array.from(plan.edges.entries()).map(([id, deps]) => [id, new Set(deps)])),
    };
  }

  #restorePlanSnapshot(plan, snapshot) {
    plan.status = snapshot.status;
    plan.completedAt = snapshot.completedAt;
    plan.tasks = new Map(snapshot.tasks.map(({ task }) => [task.id, task]));
    plan.edges = new Map(Array.from(snapshot.edges.entries()).map(([id, deps]) => [id, new Set(deps)]));
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

  #emitPlanProgress(plan, extra = {}) {
    if (!this.#onPlanAdvance) {
      return;
    }
    const tasks = plan.toJSON().tasks.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      description: t.description,
      dependencies: [...t.dependencies],
      scopeFiles: t.scopeFiles || [],
    }));
    this.#onPlanAdvance({
      ...extra,
      planId: plan.id,
      tasks,
      total: tasks.length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      running: tasks.filter((t) => t.status === 'running').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      planStatus: plan.status,
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        tasks,
        status: plan.status,
        createdAt: plan.createdAt,
        completedAt: plan.completedAt,
        decompositionMethod: extra.decompositionMethod || 'auto',
      },
    });
  }

  /**
   * 根据 taskProfile 调整外部 plan
   * 如果外部 plan 缺少必要的任务，则添加它们
   * @param {ExecutionPlan} plan - 外部 plan
   * @param {object} taskProfile - 任务分类结果
   */
  #adjustPlanByTaskProfile(plan, taskProfile) {
    if (!plan || !taskProfile) {
      return;
    }

    // 如果外部 plan 没有 inspect_workspace 任务，添加它
    if (!plan.getTask('inspect_workspace')) {
      plan.addTask({
        id: 'inspect_workspace',
        name: 'Inspect workspace',
        description:
          'Discover the relevant project structure and existing files before reading or writing.',
        dependencies: [],
        phase: 'exploration',
        allowedTools: ['list_dir', 'glob', 'read_file', 'search_codebase', 'semantic_search'],
      });
    }

    // 如果外部 plan 没有 plan_solution 任务，添加它
    if (!plan.getTask('plan_solution')) {
      plan.addTask({
        id: 'plan_solution',
        name: 'Plan solution',
        description: 'Choose the implementation approach and file split for the requested change.',
        dependencies: ['inspect_workspace'],
        phase: 'planning',
        allowedTools: ['ask_user', 'brainstorm', 'architect', 'tdd'],
      });
    }

    // 如果外部 plan 没有 implement_changes 任务，添加它
    if (!plan.getTask('implement_changes')) {
      plan.addTask({
        id: 'implement_changes',
        name: 'Implement changes',
        description: 'Create or edit the required files using the smallest necessary changes.',
        dependencies: ['plan_solution'],
        phase: 'implementation',
        allowedTools: ['write_file', 'edit_file', 'apply_hashline_patch', 'shell'],
      });
    }

    // 如果外部 plan 没有 inspect_changes 任务，添加它
    if (!plan.getTask('inspect_changes')) {
      plan.addTask({
        id: 'inspect_changes',
        name: 'Inspect changes',
        description: 'Read back or otherwise inspect the files that were created or edited.',
        dependencies: ['implement_changes'],
        phase: 'inspection',
        allowedTools: ['read_file', 'list_dir', 'glob', 'search_codebase'],
      });
    }

    // 如果需要语义风险审查，添加 semantic_risk_review 任务
    if (taskProfile.requiresSemanticRiskReview && !plan.getTask('semantic_risk_review')) {
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${taskProfile.semanticRiskDomains.map((d) => d.label).join('; ')}.`,
        dependencies: ['inspect_changes'],
        phase: 'inspection',
        allowedTools: ['review', 'read_file'],
      });
    }

    // 如果外部 plan 没有 verify_result 任务，添加它
    if (!plan.getTask('verify_result')) {
      plan.addTask({
        id: 'verify_result',
        name: 'Verify result',
        description: 'Run an appropriate command/tool to verify the requested behavior.',
        dependencies: taskProfile.requiresSemanticRiskReview
          ? ['semantic_risk_review']
          : ['inspect_changes'],
        phase: 'verification',
        allowedTools: ['shell', 'verify', 'lsp_diagnostics'],
      });
    }

    // ✅ 更新 executor（如果已存在）
    if (this.#executor) {
      this.#executor = new PlanExecutor(plan);
    }

    // 更新 requiredMutationPaths
    this.#requiredMutationPaths = this.#extractRequestedFilePaths(plan.description);
    this.#completedMutationPaths = new Set();
  }

  /**
   * ✅ 获取当前可执行任务
   */
  getCurrentRunnableTask() {
    if (!this.#executor) {
      return null;
    }
    return this.#executor.getCurrentRunnableTask();
  }

  /**
   * ✅ 获取当前任务允许的工具列表
   */
  getCurrentAllowedTools() {
    if (!this.#executor) {
      return null;
    }
    return this.#executor.getCurrentAllowedTools();
  }

  /**
   * ✅ 获取 Plan Executor（用于直接调用其方法）
   */
  getExecutor() {
    return this.#executor;
  }
}
