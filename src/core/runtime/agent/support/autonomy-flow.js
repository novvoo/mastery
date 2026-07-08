/**
 * AutonomyFlow - Multi-step workflow execution for autonomous agent tasks.
 *
 * A Flow consists of ordered steps, each with a prompt. Steps execute
 * sequentially, with optional wait conditions between steps.
 */

export const FlowStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const StepStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const TriggerKind = {
  PROACTIVE_TICK: 'proactive-tick',
  SCHEDULED_TASK: 'scheduled-task',
  MANAGED_FLOW_STEP: 'managed-flow-step',
  USER_REQUEST: 'user-request',
};

function generateId(prefix = 'flow') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * A single step in an autonomy workflow.
 */
export class AutonomyFlowStep {
  constructor(definition) {
    this.stepId = generateId('step');
    this.name = definition.name || 'unnamed-step';
    this.prompt = definition.prompt || '';
    this.waitFor = definition.waitFor || null;
    this.status = StepStatus.PENDING;
    this.runId = null;
    this.startedAt = null;
    this.endedAt = null;
    this.error = null;
    this.result = null;
  }

  toJSON() {
    return {
      stepId: this.stepId,
      name: this.name,
      prompt: this.prompt,
      waitFor: this.waitFor,
      status: this.status,
      runId: this.runId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      error: this.error,
      result: this.result,
    };
  }

  static fromJSON(data) {
    const step = new AutonomyFlowStep({
      name: data.name,
      prompt: data.prompt,
      waitFor: data.waitFor,
    });
    step.stepId = data.stepId || generateId('step');
    step.status = data.status || StepStatus.PENDING;
    step.runId = data.runId || null;
    step.startedAt = data.startedAt || null;
    step.endedAt = data.endedAt || null;
    step.error = data.error || null;
    step.result = data.result || null;
    return step;
  }
}

/**
 * AutonomyFlow - A multi-step workflow that can be executed autonomously.
 */
export class AutonomyFlow {
  constructor(options = {}) {
    this.flowId = options.flowId || generateId('flow');
    this.flowKey = options.flowKey || this.flowId;
    this.goal = options.goal || 'Unnamed flow';
    this.trigger = options.trigger || TriggerKind.USER_REQUEST;
    this.status = FlowStatus.QUEUED;
    this.ownerKey = options.ownerKey || 'main-thread';
    this.rootDir = options.rootDir || process.cwd();
    this.currentDir = options.currentDir || this.rootDir;
    this.sourceId = options.sourceId || null;
    this.sourceLabel = options.sourceLabel || null;
    this.boundary = options.boundary || [];
    this.revision = 0;
    this.runCount = 0;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.startedAt = null;
    this.endedAt = null;
    this.currentStepIndex = 0;
    this.steps = (options.steps || []).map((s) =>
      s instanceof AutonomyFlowStep ? s : new AutonomyFlowStep(s),
    );
    this.waitState = null;
    this.lastError = null;
    this.cancelRequestedAt = null;
    this.#onStateChange = options.onStateChange || null;
  }

  #onStateChange;

  get onStateChange() {
    return this.#onStateChange;
  }

  set onStateChange(handler) {
    this.#onStateChange = typeof handler === 'function' ? handler : null;
  }

  get currentStep() {
    if (this.currentStepIndex >= 0 && this.currentStepIndex < this.steps.length) {
      return this.steps[this.currentStepIndex];
    }
    return null;
  }

  get isActive() {
    return (
      this.status === FlowStatus.QUEUED ||
      this.status === FlowStatus.RUNNING ||
      this.status === FlowStatus.WAITING ||
      this.status === FlowStatus.BLOCKED
    );
  }

  get isComplete() {
    return (
      this.status === FlowStatus.SUCCEEDED ||
      this.status === FlowStatus.FAILED ||
      this.status === FlowStatus.CANCELLED
    );
  }

  get progress() {
    if (this.steps.length === 0) return 1;
    const completed = this.steps.filter(
      (s) => s.status === StepStatus.COMPLETED || s.status === StepStatus.FAILED || s.status === StepStatus.CANCELLED,
    ).length;
    return completed / this.steps.length;
  }

  start() {
    if (this.status !== FlowStatus.QUEUED) {
      throw new Error(`Cannot start flow in status: ${this.status}`);
    }
    this.status = FlowStatus.RUNNING;
    this.startedAt = Date.now();
    this.runCount++;
    this.#bumpRevision();
    this.#notifyStateChange();
  }

  advanceStep(result = null) {
    const step = this.currentStep;
    if (step) {
      step.status = StepStatus.COMPLETED;
      step.endedAt = Date.now();
      step.result = result;
    }

    this.currentStepIndex++;

    if (this.currentStepIndex >= this.steps.length) {
      this.status = FlowStatus.SUCCEEDED;
      this.endedAt = Date.now();
    } else {
      const nextStep = this.currentStep;
      if (nextStep.waitFor) {
        this.status = FlowStatus.WAITING;
        this.waitState = {
          reason: nextStep.waitFor,
          stepId: nextStep.stepId,
          stepName: nextStep.name,
          stepIndex: this.currentStepIndex,
        };
      } else {
        this.status = FlowStatus.RUNNING;
        this.waitState = null;
      }
    }

    this.#bumpRevision();
    this.#notifyStateChange();
  }

  markStepRunning(runId) {
    const step = this.currentStep;
    if (!step) return false;
    step.status = StepStatus.RUNNING;
    step.runId = runId;
    step.startedAt = Date.now();
    this.status = FlowStatus.RUNNING;
    this.#bumpRevision();
    this.#notifyStateChange();
    return true;
  }

  markStepFailed(error) {
    const step = this.currentStep;
    if (!step) return false;
    step.status = StepStatus.FAILED;
    step.endedAt = Date.now();
    step.error = String(error);
    this.status = FlowStatus.FAILED;
    this.lastError = String(error);
    this.endedAt = Date.now();
    this.#bumpRevision();
    this.#notifyStateChange();
    return true;
  }

  markStepBlocked(reason, runId = null) {
    const step = this.currentStep;
    if (!step) return false;
    this.status = FlowStatus.BLOCKED;
    step.runId = runId;
    this.lastError = String(reason);
    this.#bumpRevision();
    this.#notifyStateChange();
    return true;
  }

  resumeFromWait() {
    if (this.status !== FlowStatus.WAITING) {
      return false;
    }
    this.status = FlowStatus.RUNNING;
    this.waitState = null;
    this.#bumpRevision();
    this.#notifyStateChange();
    return true;
  }

  cancel() {
    if (this.isComplete) {
      return false;
    }
    this.cancelRequestedAt = Date.now();
    const step = this.currentStep;
    if (step && step.status === StepStatus.RUNNING) {
      step.status = StepStatus.CANCELLED;
      step.endedAt = Date.now();
    }
    this.status = FlowStatus.CANCELLED;
    this.endedAt = Date.now();
    this.#bumpRevision();
    this.#notifyStateChange();
    return true;
  }

  retryFromStep(stepIndex = 0) {
    if (!this.isComplete && this.status !== FlowStatus.BLOCKED) {
      throw new Error(`Cannot retry flow in status: ${this.status}`);
    }
    this.currentStepIndex = Math.max(0, Math.min(stepIndex, this.steps.length - 1));
    this.status = FlowStatus.QUEUED;
    this.lastError = null;
    this.endedAt = null;
    this.waitState = null;
    for (let i = this.currentStepIndex; i < this.steps.length; i++) {
      this.steps[i].status = StepStatus.PENDING;
      this.steps[i].runId = null;
      this.steps[i].startedAt = null;
      this.steps[i].endedAt = null;
      this.steps[i].error = null;
      this.steps[i].result = null;
    }
    this.#bumpRevision();
    this.#notifyStateChange();
  }

  toJSON() {
    return {
      flowId: this.flowId,
      flowKey: this.flowKey,
      goal: this.goal,
      trigger: this.trigger,
      status: this.status,
      ownerKey: this.ownerKey,
      rootDir: this.rootDir,
      currentDir: this.currentDir,
      sourceId: this.sourceId,
      sourceLabel: this.sourceLabel,
      boundary: this.boundary,
      revision: this.revision,
      runCount: this.runCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      currentStepIndex: this.currentStepIndex,
      steps: this.steps.map((s) => s.toJSON()),
      waitState: this.waitState,
      lastError: this.lastError,
      cancelRequestedAt: this.cancelRequestedAt,
    };
  }

  static fromJSON(data) {
    const flow = new AutonomyFlow({
      flowId: data.flowId,
      flowKey: data.flowKey,
      goal: data.goal,
      trigger: data.trigger,
      ownerKey: data.ownerKey,
      rootDir: data.rootDir,
      currentDir: data.currentDir,
      sourceId: data.sourceId,
      sourceLabel: data.sourceLabel,
      boundary: data.boundary,
      steps: (data.steps || []).map((s) => AutonomyFlowStep.fromJSON(s)),
    });
    flow.status = data.status || FlowStatus.QUEUED;
    flow.revision = data.revision || 0;
    flow.runCount = data.runCount || 0;
    flow.createdAt = data.createdAt || Date.now();
    flow.updatedAt = data.updatedAt || flow.createdAt;
    flow.startedAt = data.startedAt || null;
    flow.endedAt = data.endedAt || null;
    flow.currentStepIndex = data.currentStepIndex || 0;
    flow.waitState = data.waitState || null;
    flow.lastError = data.lastError || null;
    flow.cancelRequestedAt = data.cancelRequestedAt || null;
    return flow;
  }

  #bumpRevision() {
    this.revision++;
    this.updatedAt = Date.now();
  }

  #notifyStateChange() {
    if (this.#onStateChange) {
      try {
        this.#onStateChange(this);
      } catch (err) {
        console.debug('[AutonomyFlow] state change handler error:', err);
      }
    }
  }
}
