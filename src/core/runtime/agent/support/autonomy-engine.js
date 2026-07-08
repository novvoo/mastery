/**
 * AutonomyEngine - Schedules and executes multi-step autonomy workflows.
 *
 * Manages a queue of AutonomyFlow instances, persists state to disk,
 * and coordinates step execution with the agent engine.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { AutonomyFlow, FlowStatus, TriggerKind } from './autonomy-flow.js';

export class AutonomyEngine {
  constructor(options = {}) {
    this.#flows = new Map();
    this.#queue = [];
    this.#activeFlowId = null;
    this.#persistenceDir = options.persistenceDir || join(process.cwd(), '.mastery', 'autonomy');
    this.#persistenceFile = join(this.#persistenceDir, 'flows.json');
    this.#onExecuteStep = options.onExecuteStep || null;
    this.#onStateChange = options.onStateChange || null;
    this.#tickIntervalMs = options.tickIntervalMs || 5000;
    this.#maxConcurrentFlows = options.maxConcurrentFlows || 1;
    this.#running = false;
    this.#tickTimer = null;
    this.#executedThisTick = false;
  }

  #flows;
  #queue;
  #activeFlowId;
  #persistenceDir;
  #persistenceFile;
  #onExecuteStep;
  #onStateChange;
  #tickIntervalMs;
  #maxConcurrentFlows;
  #running;
  #tickTimer;
  #executedThisTick;

  get flows() {
    return [...this.#flows.values()];
  }

  get activeFlows() {
    return this.flows.filter((f) => f.isActive);
  }

  get completedFlows() {
    return this.flows.filter((f) => f.isComplete);
  }

  get activeFlow() {
    return this.#activeFlowId ? this.#flows.get(this.#activeFlowId) || null : null;
  }

  /**
   * Create and optionally queue a new autonomy workflow.
   */
  createFlow(options) {
    const flow = new AutonomyFlow({
      ...options,
      onStateChange: (f) => {
        this.#persistFlow(f);
        this.#onStateChange?.(f);
      },
    });
    this.#flows.set(flow.flowId, flow);
    this.#persist();
    return flow;
  }

  /**
   * Queue a flow for execution.
   */
  queueFlow(flowOrId) {
    const flow = typeof flowOrId === 'string' ? this.#flows.get(flowOrId) : flowOrId;
    if (!flow) {
      throw new Error(`Flow not found: ${flowOrId}`);
    }
    if (flow.status !== FlowStatus.QUEUED && flow.status !== FlowStatus.WAITING) {
      throw new Error(`Cannot queue flow in status: ${flow.status}`);
    }
    if (!this.#queue.includes(flow.flowId)) {
      this.#queue.push(flow.flowId);
    }
    this.#persist();
    return flow;
  }

  /**
   * Start the engine tick loop.
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#scheduleTick();
  }

  /**
   * Stop the engine tick loop.
   */
  stop() {
    this.#running = false;
    if (this.#tickTimer) {
      clearTimeout(this.#tickTimer);
      this.#tickTimer = null;
    }
  }

  /**
   * Execute a single tick: check queue, run next step, persist.
   */
  async tick() {
    this.#executedThisTick = false;

    // 1. Resume waiting flows whose conditions may have been met
    for (const flow of this.activeFlows) {
      if (flow.status === FlowStatus.WAITING) {
        const shouldResume = await this.#checkWaitCondition(flow);
        if (shouldResume) {
          flow.resumeFromWait();
          if (!this.#queue.includes(flow.flowId)) {
            this.#queue.push(flow.flowId);
          }
        }
      }
    }

    // 2. Process queued flows
    while (this.#queue.length > 0 && this.#canExecute()) {
      const flowId = this.#queue.shift();
      const flow = this.#flows.get(flowId);
      if (!flow || !flow.isActive) continue;

      await this.#executeNextStep(flow);
    }

    // 3. Persist state
    this.#persist();

    return this.#executedThisTick;
  }

  /**
   * Advance a flow after its current step completes successfully.
   */
  advanceFlow(flowId, result = null) {
    const flow = this.#flows.get(flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }
    if (flow.status === FlowStatus.BLOCKED) {
      flow.retryFromStep(flow.currentStepIndex);
      this.queueFlow(flow);
      return flow;
    }
    flow.advanceStep(result);
    if (flow.isActive) {
      this.queueFlow(flow);
    }
    this.#persist();
    return flow;
  }

  /**
   * Mark a flow step as failed.
   */
  markStepFailed(flowId, error) {
    const flow = this.#flows.get(flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }
    flow.markStepFailed(error);
    this.#persist();
    return flow;
  }

  /**
   * Cancel a flow.
   */
  cancelFlow(flowId) {
    const flow = this.#flows.get(flowId);
    if (!flow) {
      throw new Error(`Flow not found: ${flowId}`);
    }
    flow.cancel();
    // Remove from queue
    const idx = this.#queue.indexOf(flowId);
    if (idx >= 0) this.#queue.splice(idx, 1);
    if (this.#activeFlowId === flowId) {
      this.#activeFlowId = null;
    }
    this.#persist();
    return flow;
  }

  /**
   * Get formatted status of all flows.
   */
  getStatus() {
    return this.flows.map((f) => ({
      flowId: f.flowId,
      flowKey: f.flowKey,
      goal: f.goal,
      status: f.status,
      progress: f.progress,
      currentStep: f.currentStep?.name || null,
      currentStepIndex: f.currentStepIndex,
      totalSteps: f.steps.length,
      trigger: f.trigger,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      lastError: f.lastError,
    }));
  }

  /**
   * Load persisted flows from disk.
   */
  load() {
    if (!existsSync(this.#persistenceFile)) return false;
    try {
      const data = JSON.parse(readFileSync(this.#persistenceFile, 'utf-8'));
      if (data.flows) {
        for (const flowData of data.flows) {
          const flow = AutonomyFlow.fromJSON(flowData);
          flow.onStateChange = (f) => {
            this.#persistFlow(f);
            this.#onStateChange?.(f);
          };
          this.#flows.set(flow.flowId, flow);
          if (flow.isActive && !this.#queue.includes(flow.flowId)) {
            this.#queue.push(flow.flowId);
          }
        }
      }
      if (data.queue) {
        for (const flowId of data.queue) {
          if (!this.#queue.includes(flowId)) {
            this.#queue.push(flowId);
          }
        }
      }
      return true;
    } catch (err) {
      console.warn('[AutonomyEngine] Failed to load persisted flows:', err.message);
      return false;
    }
  }

  #canExecute() {
    const activeCount = this.activeFlows.length;
    return activeCount < this.#maxConcurrentFlows;
  }

  async #executeNextStep(flow) {
    const step = flow.currentStep;
    if (!step) return;

    this.#activeFlowId = flow.flowId;
    flow.markStepRunning(`run-${Date.now()}`);
    this.#executedThisTick = true;

    try {
      if (this.#onExecuteStep) {
        const result = await this.#onExecuteStep(flow, step);
        // Result is handled by caller via advanceFlow/markStepFailed
      } else {
        // No handler: auto-advance after a delay (for testing)
        flow.advanceStep(null);
      }
    } catch (err) {
      flow.markStepFailed(err);
    } finally {
      if (this.#activeFlowId === flow.flowId) {
        this.#activeFlowId = null;
      }
    }
  }

  async #checkWaitCondition(flow) {
    if (!flow.waitState) return true;
    // Simple timeout-based wait: if wait has exceeded 60s, resume
    const waitDuration = Date.now() - flow.updatedAt;
    return waitDuration > 60000;
  }

  #persistFlow(flow) {
    // Individual flow persistence is handled by #persist
  }

  #persist() {
    try {
      if (!existsSync(this.#persistenceDir)) {
        mkdirSync(this.#persistenceDir, { recursive: true });
      }
      const data = {
        flows: this.flows.map((f) => f.toJSON()),
        queue: [...this.#queue],
        activeFlowId: this.#activeFlowId,
        timestamp: Date.now(),
      };
      writeFileSync(this.#persistenceFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('[AutonomyEngine] Failed to persist flows:', err.message);
    }
  }

  #scheduleTick() {
    if (!this.#running) return;
    this.#tickTimer = setTimeout(() => {
      this.tick().catch((err) => {
        console.warn('[AutonomyEngine] Tick error:', err.message);
      });
      this.#scheduleTick();
    }, this.#tickIntervalMs);
  }
}
