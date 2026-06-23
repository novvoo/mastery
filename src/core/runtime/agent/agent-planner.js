/**
 * AgentPlanner — 执行计划创建、推进与阶段推导
 *
 * 从 ReActAgent 拆出的职责：
 *   - 根据任务 profile 创建自动化执行计划 (inspect -> plan -> implement -> verify)
 *   - 根据工具调用结果推进计划状态
 *   - 推导当前执行阶段 (exploration/planning/implementation/inspection/verification)
 *   - 生成面向 LLM 的计划状态提示
 *   - 跟踪必要的文件修改路径
 */

import { ExecutionPlan, TaskStatus } from '../../../planner/graph-planner.js';
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
  /** @type {Set<string>} */
  #requiredMutationPaths = new Set();
  /** @type {Set<string>} */
  #completedMutationPaths = new Set();

  constructor({ debugEvent, sessionManager, onPlanAdvance }) {
    this.#debugEvent = debugEvent;
    this.#sessionManager = sessionManager;
    this.#onPlanAdvance = typeof onPlanAdvance === 'function' ? onPlanAdvance : null;
  }

  /**
   * 根据用户输入和任务 profile 创建执行计划（编码任务强制走 plan）
   * @returns {ExecutionPlan|null}
   */
  createIfNeeded(userInput, taskProfile) {
    const isCoding = taskProfile?.isCodingTask || taskProfile?.isModificationTask || taskProfile?.isBugTask;
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
    });
    plan.addTask({
      id: 'plan_solution',
      name: 'Plan solution',
      description: 'Choose the implementation approach and file split for the requested change.',
      dependencies: ['inspect_workspace'],
    });
    plan.addTask({
      id: 'implement_changes',
      name: 'Implement changes',
      description: 'Create or edit the required files using the smallest necessary changes.',
      dependencies: ['plan_solution'],
    });
    plan.addTask({
      id: 'inspect_changes',
      name: 'Inspect changes',
      description: 'Read back or otherwise inspect the files that were created or edited.',
      dependencies: ['implement_changes'],
    });
    if (taskProfile.requiresSemanticRiskReview) {
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${taskProfile.semanticRiskDomains.map((d) => d.label).join('; ')}.`,
        dependencies: ['inspect_changes'],
      });
    }
    plan.addTask({
      id: 'verify_result',
      name: 'Verify result',
      description: 'Run an appropriate command/tool to verify the requested behavior.',
      dependencies: taskProfile.requiresSemanticRiskReview
        ? ['semantic_risk_review']
        : ['inspect_changes'],
    });

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();
    plan.getTask('inspect_workspace')?.updateStatus(TaskStatus.RUNNING);

    this.#activePlan = plan;
    this.#requiredMutationPaths = this.#extractRequestedFilePaths(userInput);
    this.#completedMutationPaths = new Set();

    return plan;
  }

  /** 重置当前计划（每次 run 开始时调用） */
  reset() {
    this.#activePlan = null;
    this.#requiredMutationPaths = new Set();
    this.#completedMutationPaths = new Set();
  }

  /** @returns {ExecutionPlan|null} */
  get activePlan() {
    return this.#activePlan;
  }

  /**
   * 推导当前执行阶段
   * @returns {string|null} exploration|planning|implementation|inspection|verification
   */
  deriveCurrentPhase() {
    const plan = this.#activePlan;
    if (!plan || plan.status !== TaskStatus.RUNNING) {
      return null;
    }

    const runningTask = Array.from(plan.tasks.values()).find(
      (task) => task.status === TaskStatus.RUNNING,
    );

    if (runningTask) {
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

    this.#completeTaskIf('inspect_workspace', () => isWorkspaceInspectionTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#completeTaskIf('plan_solution', () => isPlanningTool(toolName));
    this.#startReadyTasks(plan);
    this.#completeTaskIf('plan_solution', () => isMutationTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#recordMutationPath(toolName, args);
    this.#completeTaskIf(
      'implement_changes',
      () => isMutationTool(toolName, args) && this.#hasCompletedRequiredMutationPaths(),
    );
    this.#startReadyTasks(plan);
    this.#completeTaskIf('inspect_changes', () => isChangeInspectionTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#completeTaskIf('semantic_risk_review', () =>
      isSemanticRiskReviewTool(toolName, args, this.#activePlan),
    );
    this.#startReadyTasks(plan);
    this.#completeTaskIf('verify_result', () => isVerificationTool(toolName, args));
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
        }));
        this.#onPlanAdvance({
          tasks,
          total: tasks.length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          running: tasks.filter((t) => t.status === 'running').length,
          failed: tasks.filter((t) => t.status === 'failed').length,
          planStatus: plan.status,
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

  #completeTaskIf(taskId, predicate) {
    const task = this.#activePlan?.getTask(taskId);
    if (
      !task ||
      task.status === TaskStatus.COMPLETED ||
      !task.checkDependencies(this.#activePlan.tasks)
    ) {
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
}
