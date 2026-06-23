/**
 * Automation Engine
 * 自动化引擎 - 事件驱动的自动化执行系统
 *
 * 功能：
 * - 触发器系统（文件变化、时间、事件）
 * - 工作流引擎（多步骤流程）
 * - 条件执行（基于规则的自动决策）
 * - 后台任务（潜意识系统）
 */

import { EventEmitter } from 'events';
import { existsSync, watch } from 'fs';

export const TriggerType = Object.freeze({
  FILE_CHANGE: 'file_change',
  SCHEDULE: 'schedule',
  EVENT: 'event',
  CONDITION: 'condition',
  WEBHOOK: 'webhook',
});

export const WorkflowStatus = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export class AutomationEngine extends EventEmitter {
  #triggers;
  #workflows;
  #conditions;
  #backgroundTasks;
  #isRunning;
  #fileWatchers;
  #intervalId;
  #config;

  constructor(options = {}) {
    super();
    this.#triggers = new Map();
    this.#workflows = new Map();
    this.#conditions = new Map();
    this.#backgroundTasks = new Map();
    this.#fileWatchers = new Map();
    this.#isRunning = false;
    this.#config = {
      checkIntervalMs: options.checkIntervalMs || 5000,
      maxConcurrentWorkflows: options.maxConcurrentWorkflows || 5,
      dataDir: options.dataDir || './.automation',
    };
  }

  /**
   * 启动自动化引擎
   */
  async start() {
    if (this.#isRunning) {
      return;
    }
    this.#isRunning = true;

    // 启动定期检查
    this.#intervalId = setInterval(() => {
      this.#checkTriggers();
      this.#runBackgroundTasks();
    }, this.#config.checkIntervalMs);

    this.emit('started');
    console.log('AutomationEngine started');
  }

  /**
   * 停止自动化引擎
   */
  async stop() {
    if (!this.#isRunning) {
      return;
    }
    this.#isRunning = false;

    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }

    // 关闭所有文件监视器
    for (const watcher of this.#fileWatchers.values()) {
      watcher.close();
    }
    this.#fileWatchers.clear();

    this.emit('stopped');
    console.log('AutomationEngine stopped');
  }

  // ============ 触发器管理 ============

  /**
   * 注册触发器
   * @param {string} id - 触发器 ID
   * @param {object} trigger - 触发器配置
   */
  registerTrigger(id, trigger) {
    const config = {
      id,
      type: trigger.type,
      enabled: trigger.enabled !== false,
      action: trigger.action, // 触发后执行的动作
      lastTriggered: null,
      triggerCount: 0,
      ...trigger,
    };

    this.#triggers.set(id, config);

    // 设置文件监视器
    if (trigger.type === TriggerType.FILE_CHANGE && trigger.path) {
      this.#setupFileWatcher(id, trigger.path, trigger.options || {});
    }

    this.emit('trigger:registered', config);
    return config;
  }

  /**
   * 设置文件监视器
   */
  #setupFileWatcher(triggerId, path, options) {
    if (!existsSync(path)) {
      return;
    }

    const watcher = watch(
      path,
      { recursive: options.recursive || false },
      (eventType, filename) => {
        if (!this.#isRunning) {
          return;
        }

        const trigger = this.#triggers.get(triggerId);
        if (!trigger || !trigger.enabled) {
          return;
        }

        // 过滤检查
        if (options.ignore && options.ignore.test(filename)) {
          return;
        }
        if (options.include && !options.include.test(filename)) {
          return;
        }

        this.#executeTrigger(triggerId, { eventType, filename, path });
      },
    );

    this.#fileWatchers.set(path, watcher);
  }

  /**
   * 执行触发器动作
   */
  async #executeTrigger(triggerId, context) {
    const trigger = this.#triggers.get(triggerId);
    if (!trigger) {
      return;
    }

    trigger.lastTriggered = Date.now();
    trigger.triggerCount++;

    this.emit('trigger:executed', { triggerId, context });

    // 执行动作
    if (trigger.action) {
      try {
        await trigger.action(context);
      } catch (error) {
        this.emit('trigger:error', { triggerId, error });
      }
    }
  }

  /**
   * 移除触发器
   */
  removeTrigger(id) {
    const trigger = this.#triggers.get(id);
    if (!trigger) {
      return false;
    }

    if (trigger.type === TriggerType.FILE_CHANGE && trigger.path) {
      const watcher = this.#fileWatchers.get(trigger.path);
      if (watcher) {
        watcher.close();
        this.#fileWatchers.delete(trigger.path);
      }
    }

    this.#triggers.delete(id);
    this.emit('trigger:removed', { id });
    return true;
  }

  /**
   * 列出所有触发器
   */
  listTriggers() {
    return Array.from(this.#triggers.values());
  }

  // ============ 工作流管理 ============

  /**
   * 创建工作流
   * @param {string} id - 工作流 ID
   * @param {object} workflow - 工作流配置
   */
  createWorkflow(id, workflow) {
    const config = {
      id,
      name: workflow.name || id,
      description: workflow.description || '',
      steps: workflow.steps || [],
      status: WorkflowStatus.PENDING,
      currentStep: 0,
      context: workflow.context || {},
      onError: workflow.onError || 'stop', // 'stop' | 'continue' | 'retry'
      maxRetries: workflow.maxRetries || 3,
      retryCount: 0,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    this.#workflows.set(id, config);
    this.emit('workflow:created', config);
    return config;
  }

  /**
   * 执行工作流
   * @param {string} id - 工作流 ID
   * @param {object} initialContext - 初始上下文
   */
  async executeWorkflow(id, initialContext = {}) {
    const workflow = this.#workflows.get(id);
    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    workflow.status = WorkflowStatus.RUNNING;
    workflow.startedAt = Date.now();
    workflow.context = { ...workflow.context, ...initialContext };

    this.emit('workflow:started', workflow);

    try {
      for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        workflow.currentStep = i;

        this.emit('workflow:step', { workflowId: id, step, stepIndex: i });

        // 执行步骤
        const result = await this.#executeWorkflowStep(step, workflow.context);

        // 更新上下文
        if (result && typeof result === 'object') {
          workflow.context = { ...workflow.context, ...result };
        }

        // 检查条件
        if (step.condition && !this.#evaluateCondition(step.condition, workflow.context)) {
          this.emit('workflow:step:skipped', { workflowId: id, step, reason: 'condition not met' });
          continue;
        }
      }

      workflow.status = WorkflowStatus.COMPLETED;
      workflow.completedAt = Date.now();
      this.emit('workflow:completed', workflow);
    } catch (error) {
      workflow.status = WorkflowStatus.FAILED;
      workflow.error = error.message;
      this.emit('workflow:failed', { workflow, error });

      if (workflow.onError === 'retry' && workflow.retryCount < workflow.maxRetries) {
        workflow.retryCount++;
        workflow.status = WorkflowStatus.PENDING;
        workflow.currentStep = 0;
        this.emit('workflow:retry', workflow);
      }
    }

    return workflow;
  }

  /**
   * 执行工作流步骤
   */
  async #executeWorkflowStep(step, context) {
    if (typeof step.execute === 'function') {
      return await step.execute(context);
    }
    if (typeof step === 'function') {
      return await step(context);
    }
    return null;
  }

  /**
   * 暂停工作流
   */
  pauseWorkflow(id) {
    const workflow = this.#workflows.get(id);
    if (!workflow) {
      return false;
    }

    workflow.status = WorkflowStatus.PAUSED;
    this.emit('workflow:paused', workflow);
    return true;
  }

  /**
   * 恢复工作流
   */
  async resumeWorkflow(id) {
    const workflow = this.#workflows.get(id);
    if (!workflow || workflow.status !== WorkflowStatus.PAUSED) {
      return false;
    }

    return await this.executeWorkflow(id);
  }

  /**
   * 列出所有工作流
   */
  listWorkflows() {
    return Array.from(this.#workflows.values());
  }

  // ============ 条件执行 ============

  /**
   * 注册条件规则
   * @param {string} id - 规则 ID
   * @param {object} rule - 规则配置
   */
  registerCondition(id, rule) {
    const config = {
      id,
      condition: rule.condition, // 函数或表达式
      action: rule.action, // 条件满足时执行
      priority: rule.priority || 0,
      enabled: rule.enabled !== false,
      lastChecked: null,
      lastResult: null,
    };

    this.#conditions.set(id, config);
    return config;
  }

  /**
   * 评估条件
   */
  #evaluateCondition(condition, context) {
    if (typeof condition === 'function') {
      return condition(context);
    }
    if (typeof condition === 'string') {
      // 简单表达式求值
      try {
        return new Function('ctx', `return ${condition}`)(context);
      } catch {
        return false;
      }
    }
    return Boolean(condition);
  }

  /**
   * 检查所有条件
   */
  #checkTriggers() {
    if (!this.#isRunning) {
      return;
    }

    // 检查条件触发器
    for (const [id, cond] of this.#conditions) {
      if (!cond.enabled) {
        continue;
      }

      try {
        const result = this.#evaluateCondition(cond.condition, {});
        cond.lastChecked = Date.now();

        if (result && !cond.lastResult) {
          // 条件从 false 变为 true
          this.emit('condition:triggered', cond);
          if (cond.action) {
            cond.action();
          }
        }

        cond.lastResult = result;
      } catch (error) {
        this.emit('condition:error', { id, error });
      }
    }
  }

  // ============ 后台任务（潜意识系统）============

  /**
   * 注册后台任务
   * @param {string} id - 任务 ID
   * @param {object} task - 任务配置
   */
  registerBackgroundTask(id, task) {
    const config = {
      id,
      name: task.name || id,
      execute: task.execute,
      interval: task.interval || 60000, // 默认 1 分钟
      enabled: task.enabled !== false,
      lastRun: null,
      runCount: 0,
      errorCount: 0,
    };

    this.#backgroundTasks.set(id, config);
    this.emit('background:registered', config);
    return config;
  }

  /**
   * 运行后台任务
   */
  async #runBackgroundTasks() {
    if (!this.#isRunning) {
      return;
    }

    const now = Date.now();

    for (const task of this.#backgroundTasks.values()) {
      if (!task.enabled) {
        continue;
      }

      const timeSinceLastRun = now - (task.lastRun || 0);
      if (timeSinceLastRun < task.interval) {
        continue;
      }

      try {
        task.lastRun = now;
        await task.execute();
        task.runCount++;
        this.emit('background:executed', task);
      } catch (error) {
        task.errorCount++;
        this.emit('background:error', { task, error });
      }
    }
  }

  /**
   * 启用/禁用后台任务
   */
  toggleBackgroundTask(id, enabled) {
    const task = this.#backgroundTasks.get(id);
    if (!task) {
      return false;
    }
    task.enabled = enabled;
    return true;
  }

  /**
   * 列出所有后台任务
   */
  listBackgroundTasks() {
    return Array.from(this.#backgroundTasks.values());
  }

  // ============ 状态和统计 ============

  /**
   * 获取引擎状态
   */
  getStatus() {
    return {
      isRunning: this.#isRunning,
      triggers: this.#triggers.size,
      workflows: this.#workflows.size,
      conditions: this.#conditions.size,
      backgroundTasks: this.#backgroundTasks.size,
      fileWatchers: this.#fileWatchers.size,
    };
  }

  /**
   * 获取详细统计
   */
  getStats() {
    return {
      status: this.getStatus(),
      triggers: this.listTriggers().map((t) => ({
        id: t.id,
        type: t.type,
        enabled: t.enabled,
        triggerCount: t.triggerCount,
        lastTriggered: t.lastTriggered,
      })),
      workflows: this.listWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        currentStep: w.currentStep,
        totalSteps: w.steps.length,
      })),
      backgroundTasks: this.listBackgroundTasks().map((t) => ({
        id: t.id,
        name: t.name,
        enabled: t.enabled,
        runCount: t.runCount,
        errorCount: t.errorCount,
        lastRun: t.lastRun,
      })),
    };
  }

  /**
   * 清理所有资源
   */
  dispose() {
    this.stop();
    this.#triggers.clear();
    this.#workflows.clear();
    this.#conditions.clear();
    this.#backgroundTasks.clear();
  }
}

export default AutomationEngine;
