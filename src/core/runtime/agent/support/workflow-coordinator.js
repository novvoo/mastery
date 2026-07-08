/**
 * FlowPlanCoordinator — 统一工作流协调器
 *
 * 将 ExecutionPlan (Plan) 和 AutonomyFlow (Flow) 提升到同一抽象级别，
 * 统一管理、协调执行、共享上下文、处理跨工作流触发。
 */

import { EventEmitter } from 'events';

export const WorkflowType = {
  PLAN: 'plan',
  FLOW: 'flow',
};

export const WorkflowStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const WorkflowEvent = {
  REGISTERED: 'workflow:registered',
  UNREGISTERED: 'workflow:unregistered',
  STARTED: 'workflow:started',
  STEP_STARTED: 'workflow:step-started',
  STEP_COMPLETED: 'workflow:step-completed',
  STEP_FAILED: 'workflow:step-failed',
  PAUSED: 'workflow:paused',
  RESUMED: 'workflow:resumed',
  COMPLETED: 'workflow:completed',
  FAILED: 'workflow:failed',
  CANCELLED: 'workflow:cancelled',
  CONTEXT_SHARED: 'workflow:context-shared',
  TRIGGERED: 'workflow:triggered',
};

/**
 * UnifiedWorkflow — 统一工作流接口
 * Plan 和 Flow 都通过 Adapter 实现此接口。
 */
export class UnifiedWorkflow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.name = options.name || 'Unnamed Workflow';
    this.type = options.type || WorkflowType.PLAN;
    this.status = WorkflowStatus.PENDING;
    this.#context = new Map(Object.entries(options.context || {}));
    this.#metadata = options.metadata || {};
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.#adapter = options.adapter || null;
  }

  #context;
  #metadata;
  #adapter;

  get context() {
    return Object.fromEntries(this.#context);
  }

  get metadata() {
    return { ...this.#metadata };
  }

  get isActive() {
    return (
      this.status === WorkflowStatus.PENDING ||
      this.status === WorkflowStatus.RUNNING ||
      this.status === WorkflowStatus.WAITING ||
      this.status === WorkflowStatus.BLOCKED
    );
  }

  get isComplete() {
    return (
      this.status === WorkflowStatus.COMPLETED ||
      this.status === WorkflowStatus.FAILED ||
      this.status === WorkflowStatus.CANCELLED
    );
  }

  getProgress() {
    return this.#adapter?.getProgress?.() || 0;
  }

  getCurrentStep() {
    return this.#adapter?.getCurrentStep?.() || null;
  }

  getSteps() {
    return this.#adapter?.getSteps?.() || [];
  }

  setContext(key, value) {
    this.#context.set(key, value);
    this.emit('context:changed', { workflowId: this.id, key, value });
  }

  getContext(key) {
    return this.#context.get(key);
  }

  mergeContext(context) {
    for (const [key, value] of Object.entries(context)) {
      this.#context.set(key, value);
    }
    this.emit('context:merged', { workflowId: this.id, context });
  }

  start() {
    if (this.status !== WorkflowStatus.PENDING) {
      throw new Error(`Cannot start workflow in status: ${this.status}`);
    }
    this.status = WorkflowStatus.RUNNING;
    this.startedAt = Date.now();
    this.#adapter?.start?.();
    this.emit(WorkflowEvent.STARTED, { workflowId: this.id, workflow: this });
  }

  pause() {
    if (this.status !== WorkflowStatus.RUNNING) {
      return false;
    }
    this.status = WorkflowStatus.PAUSED;
    this.#adapter?.pause?.();
    this.emit(WorkflowEvent.PAUSED, { workflowId: this.id, workflow: this });
    return true;
  }

  resume() {
    if (this.status !== WorkflowStatus.PAUSED && this.status !== WorkflowStatus.WAITING) {
      return false;
    }
    this.status = WorkflowStatus.RUNNING;
    this.#adapter?.resume?.();
    this.emit(WorkflowEvent.RESUMED, { workflowId: this.id, workflow: this });
    return true;
  }

  cancel() {
    if (this.isComplete) {
      return false;
    }
    this.status = WorkflowStatus.CANCELLED;
    this.endedAt = Date.now();
    this.#adapter?.cancel?.();
    this.emit(WorkflowEvent.CANCELLED, { workflowId: this.id, workflow: this });
    return true;
  }

  retry(fromStep = 0) {
    if (!this.isComplete && this.status !== WorkflowStatus.BLOCKED) {
      throw new Error(`Cannot retry workflow in status: ${this.status}`);
    }
    this.status = WorkflowStatus.PENDING;
    this.endedAt = null;
    this.#adapter?.retry?.(fromStep);
    this.emit(WorkflowEvent.STARTED, { workflowId: this.id, workflow: this, retry: true });
  }

  markStepStarted(stepId, stepData = {}) {
    this.emit(WorkflowEvent.STEP_STARTED, {
      workflowId: this.id,
      stepId,
      stepData,
      workflow: this,
    });
  }

  markStepCompleted(stepId, result = null) {
    this.emit(WorkflowEvent.STEP_COMPLETED, {
      workflowId: this.id,
      stepId,
      result,
      workflow: this,
    });
  }

  markStepFailed(stepId, error) {
    this.status = WorkflowStatus.FAILED;
    this.endedAt = Date.now();
    this.emit(WorkflowEvent.STEP_FAILED, {
      workflowId: this.id,
      stepId,
      error: String(error),
      workflow: this,
    });
    this.emit(WorkflowEvent.FAILED, { workflowId: this.id, error: String(error), workflow: this });
  }

  markCompleted(result = null) {
    this.status = WorkflowStatus.COMPLETED;
    this.endedAt = Date.now();
    this.emit(WorkflowEvent.COMPLETED, { workflowId: this.id, result, workflow: this });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      context: this.context,
      metadata: this.metadata,
      progress: this.getProgress(),
      currentStep: this.getCurrentStep(),
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }
}

/**
 * FlowPlanCoordinator — 工作流协调器
 *
 * 统一管理 Plan 和 Flow 工作流，处理跨工作流触发和上下文共享。
 */
export class FlowPlanCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.#workflows = new Map();
    this.#activeWorkflowId = null;
    this.#contextPool = new Map();
    this.#onExecuteStep = options.onExecuteStep || null;
    this.#onExecutePlan = options.onExecutePlan || null;
    this.#triggers = new Map();
  }

  #workflows;
  #activeWorkflowId;
  #contextPool;
  #onExecuteStep;
  #onExecutePlan;
  #triggers;

  get workflows() {
    return [...this.#workflows.values()];
  }

  get activeWorkflows() {
    return this.workflows.filter((w) => w.isActive);
  }

  get activeWorkflow() {
    return this.#activeWorkflowId ? this.#workflows.get(this.#activeWorkflowId) || null : null;
  }

  getWorkflow(id) {
    return this.#workflows.get(id) || null;
  }

  getWorkflowsByType(type) {
    return this.workflows.filter((w) => w.type === type);
  }

  /**
   * 注册一个统一工作流实例。
   */
  register(workflow) {
    if (!(workflow instanceof UnifiedWorkflow)) {
      throw new TypeError('workflow must be a UnifiedWorkflow instance');
    }
    this.#workflows.set(workflow.id, workflow);

    // 自动转发工作流事件到协调器
    workflow.on(WorkflowEvent.STARTED, (data) => {
      this.#activeWorkflowId = data.workflowId;
      this.emit(WorkflowEvent.STARTED, data);
    });
    workflow.on(WorkflowEvent.STEP_STARTED, (data) => this.emit(WorkflowEvent.STEP_STARTED, data));
    workflow.on(WorkflowEvent.STEP_COMPLETED, (data) => {
      this.emit(WorkflowEvent.STEP_COMPLETED, data);
      this.#handleStepCompleted(data);
    });
    workflow.on(WorkflowEvent.STEP_FAILED, (data) => this.emit(WorkflowEvent.STEP_FAILED, data));
    workflow.on(WorkflowEvent.COMPLETED, (data) => this.emit(WorkflowEvent.COMPLETED, data));
    workflow.on(WorkflowEvent.FAILED, (data) => this.emit(WorkflowEvent.FAILED, data));
    workflow.on(WorkflowEvent.CANCELLED, (data) => this.emit(WorkflowEvent.CANCELLED, data));
    workflow.on(WorkflowEvent.PAUSED, (data) => this.emit(WorkflowEvent.PAUSED, data));
    workflow.on(WorkflowEvent.RESUMED, (data) => this.emit(WorkflowEvent.RESUMED, data));

    this.emit(WorkflowEvent.REGISTERED, { workflowId: workflow.id, workflow });
    return workflow;
  }

  unregister(workflowId) {
    const workflow = this.#workflows.get(workflowId);
    if (!workflow) return false;
    workflow.removeAllListeners();
    this.#workflows.delete(workflowId);
    if (this.#activeWorkflowId === workflowId) {
      this.#activeWorkflowId = null;
    }
    this.emit(WorkflowEvent.UNREGISTERED, { workflowId });
    return true;
  }

  /**
   * 从 Plan (ExecutionPlanManager) 创建并注册统一工作流。
   */
  registerPlan(planManager, plan, options = {}) {
    const workflow = new UnifiedWorkflow({
      id: plan.id || `plan-${Date.now()}`,
      name: plan.name || 'Execution Plan',
      type: WorkflowType.PLAN,
      context: options.context || {},
      metadata: {
        planType: plan.context?.planType,
        ...options.metadata,
      },
      adapter: {
        getProgress: () => {
          if (!plan.tasks || plan.tasks.size === 0) return 0;
          const completed = Array.from(plan.tasks.values()).filter(
            (t) => t.status === 'completed' || t.status === 'skipped',
          ).length;
          return completed / plan.tasks.size;
        },
        getCurrentStep: () => {
          const running = Array.from(plan.tasks.values()).find((t) => t.status === 'running');
          if (running) {
            return { id: running.id, name: running.name, status: running.status };
          }
          const ready = Array.from(plan.tasks.values()).find((t) => t.status === 'ready');
          if (ready) {
            return { id: ready.id, name: ready.name, status: ready.status };
          }
          return null;
        },
        getSteps: () =>
          Array.from(plan.tasks.values()).map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
          })),
      },
    });

    // 包装 planManager 的事件
    const originalAdvance = planManager.advance.bind(planManager);
    planManager.advance = function (toolName, args, result, executionResult) {
      const before = workflow.getCurrentStep();
      const ret = originalAdvance(toolName, args, result, executionResult);
      const after = workflow.getCurrentStep();
      if (before?.id !== after?.id) {
        workflow.markStepStarted(after.id, after);
      }
      if (ret?.isCompleted) {
        workflow.markCompleted(ret);
      }
      return ret;
    };

    return this.register(workflow);
  }

  /**
   * 从 Flow (AutonomyFlow) 创建并注册统一工作流。
   */
  registerFlow(flow, options = {}) {
    const workflow = new UnifiedWorkflow({
      id: flow.flowId,
      name: flow.goal || 'Autonomy Flow',
      type: WorkflowType.FLOW,
      context: options.context || {},
      metadata: {
        flowKey: flow.flowKey,
        trigger: flow.trigger,
        ...options.metadata,
      },
      adapter: {
        getProgress: () => flow.progress,
        getCurrentStep: () => {
          const step = flow.currentStep;
          return step ? { id: step.stepId, name: step.name, status: step.status } : null;
        },
        getSteps: () =>
          flow.steps.map((s) => ({
            id: s.stepId,
            name: s.name,
            status: s.status,
          })),
        start: () => flow.start(),
        pause: () => {},
        resume: () => flow.resumeFromWait(),
        cancel: () => flow.cancel(),
        retry: (fromStep) => flow.retryFromStep(fromStep),
      },
    });

    // 包装 flow 的事件
    const originalOnStateChange = flow.onStateChange;
    flow.onStateChange = (f) => {
      originalOnStateChange?.(f);
      workflow.status = this.#mapFlowStatus(f.status);
      const step = f.currentStep;
      if (step?.status === 'running') {
        workflow.markStepStarted(step.stepId, { name: step.name });
      }
      if (f.status === 'succeeded') {
        workflow.markCompleted();
      } else if (f.status === 'failed') {
        workflow.markStepFailed(f.currentStep?.stepId, f.lastError);
      }
    };

    return this.register(workflow);
  }

  /**
   * 触发一个新的工作流（Plan 或 Flow）。
   */
  triggerWorkflow(sourceWorkflowId, targetType, options = {}) {
    const source = this.getWorkflow(sourceWorkflowId);
    const targetId = options.targetId || `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    this.emit(WorkflowEvent.TRIGGERED, {
      sourceWorkflowId,
      targetId,
      targetType,
      options,
    });

    return {
      targetId,
      targetType,
      sourceWorkflowId,
    };
  }

  /**
   * 跨工作流共享上下文。
   */
  shareContext(fromWorkflowId, toWorkflowId, keys = null) {
    const from = this.getWorkflow(fromWorkflowId);
    const to = this.getWorkflow(toWorkflowId);
    if (!from || !to) {
      throw new Error('Source or target workflow not found');
    }

    const contextToShare = keys
      ? Object.fromEntries(keys.map((k) => [k, from.getContext(k)]).filter(([, v]) => v !== undefined))
      : from.context;

    to.mergeContext(contextToShare);

    this.emit(WorkflowEvent.CONTEXT_SHARED, {
      fromWorkflowId,
      toWorkflowId,
      keys: keys || Object.keys(contextToShare),
      context: contextToShare,
    });

    return contextToShare;
  }

  /**
   * 同步上下文到全局上下文池。
   */
  syncToPool(workflowId, keys = null) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) return false;

    const context = keys
      ? Object.fromEntries(keys.map((k) => [k, workflow.getContext(k)]))
      : workflow.context;

    for (const [key, value] of Object.entries(context)) {
      this.#contextPool.set(key, value);
    }

    return true;
  }

  /**
   * 从全局上下文池同步到工作流。
   */
  syncFromPool(workflowId, keys = null) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) return false;

    const context = keys
      ? Object.fromEntries(keys.map((k) => [k, this.#contextPool.get(k)]).filter(([, v]) => v !== undefined))
      : Object.fromEntries(this.#contextPool);

    workflow.mergeContext(context);
    return true;
  }

  /**
   * 注册触发器：当源工作流某个步骤完成时，触发目标工作流。
   */
  registerTrigger(sourceWorkflowId, stepPattern, targetType, targetOptions = {}) {
    const key = `${sourceWorkflowId}:${stepPattern}`;
    this.#triggers.set(key, { targetType, targetOptions });
  }

  /**
   * 获取所有工作流的统一状态报告。
   */
  getStatus() {
    return this.workflows.map((w) => ({
      ...w.toJSON(),
      isActive: w.isActive,
      isComplete: w.isComplete,
    }));
  }

  #handleStepCompleted(data) {
    const { workflowId, stepId } = data;
    // 检查是否有注册触发器
    for (const [key, trigger] of this.#triggers) {
      const [sourceId, pattern] = key.split(':');
      if (sourceId === workflowId && (pattern === '*' || stepId.includes(pattern))) {
        this.triggerWorkflow(workflowId, trigger.targetType, trigger.targetOptions);
      }
    }
  }

  #mapFlowStatus(flowStatus) {
    const mapping = {
      queued: WorkflowStatus.PENDING,
      running: WorkflowStatus.RUNNING,
      waiting: WorkflowStatus.WAITING,
      blocked: WorkflowStatus.BLOCKED,
      succeeded: WorkflowStatus.COMPLETED,
      failed: WorkflowStatus.FAILED,
      cancelled: WorkflowStatus.CANCELLED,
    };
    return mapping[flowStatus] || flowStatus;
  }
}
