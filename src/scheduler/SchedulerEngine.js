/**
 * SchedulerEngine.js
 * 调度引擎主类 - 整合任务队列、Cron调度器和子代理池
 */

import { TaskQueue, TaskStore, TaskStatus } from './task-queue/index.js';
import { CronScheduler, ScheduleStore } from './cron/index.js';
import { SubAgentPool } from './subagent/SubAgentPool.js';
import { MessageBus } from './subagent/MessageBus.js';
import { join } from 'path';

/**
 * 调度引擎类
 * 协调任务队列、Cron调度和子代理执行的中央控制器
 */
export class SchedulerEngine {
  // 私有字段
  #config;
  #taskQueue;
  #cronScheduler;
  #subAgentPool;
  #messageBus;
  #modelProvider;
  #toolRegistry;
  #memoryManager;
  #isRunning;
  #checkInterval;
  #checkIntervalMs;

  /**
   * 创建调度引擎实例
   * @param {Object} config - 配置对象
   * @param {string} config.workingDirectory - 工作目录
   * @param {string} [config.dataDir] - 数据存储目录
   * @param {number} [config.checkIntervalMs=60000] - 调度检查间隔（毫秒）
   * @param {number} [config.maxAgents=10] - 最大子代理数量
   * @param {Object} modelProvider - 模型提供者实例
   * @param {Object} toolRegistry - 工具注册表实例
   * @param {Object} memoryManager - 内存管理器实例
   */
  constructor(config, modelProvider, toolRegistry, memoryManager) {
    this.#config = config;
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry;
    this.#memoryManager = memoryManager;
    this.#isRunning = false;
    this.#checkInterval = null;
    this.#checkIntervalMs = config.checkIntervalMs || 60000; // 默认1分钟

    // 子模块将在initialize中创建
    this.#taskQueue = null;
    this.#cronScheduler = null;
    this.#subAgentPool = null;
    this.#messageBus = null;
  }

  /**
   * 初始化调度引擎
   * @returns {Promise<void>}
   */
  async initialize() {
    const dataDir = this.#config.dataDir || join(this.#config.workingDirectory, '.scheduler');

    // 创建消息总线
    this.#messageBus = new MessageBus({
      maxHistory: 1000
    });

    // 创建任务队列
    const taskStore = new TaskStore(join(dataDir, 'tasks.json'));
    this.#taskQueue = new TaskQueue(taskStore);
    await this.#taskQueue.initialize();

    // 创建Cron调度器
    const scheduleStore = new ScheduleStore(join(dataDir, 'schedules.json'));
    this.#cronScheduler = new CronScheduler(scheduleStore);
    await this.#cronScheduler.initialize();

    // 创建子代理池
    this.#subAgentPool = new SubAgentPool(
      this.#modelProvider,
      this.#toolRegistry,
      this.#memoryManager,
      this.#config,
      {
        maxAgents: this.#config.maxAgents || 10,
        messageBus: this.#messageBus,
        autoCleanup: this.#config.autoCleanup,
        autoCleanupIntervalMs: this.#config.autoCleanupIntervalMs,
        enableMemoryShare: this.#config.enableMemoryShare,
      }
    );

    // 设置事件监听
    this.#setupEventListeners();

    console.log('SchedulerEngine initialized successfully');
  }

  /**
   * 启动调度引擎
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#isRunning) {
      console.warn('SchedulerEngine is already running');
      return;
    }

    this.#isRunning = true;

    // 启动调度检查定时器
    this.#checkInterval = setInterval(() => {
      this.#checkSchedules();
    }, this.#checkIntervalMs);

    // 立即执行一次检查
    await this.#checkSchedules();

    console.log('SchedulerEngine started');
  }

  /**
   * 停止调度引擎
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.#isRunning) {
      return;
    }

    this.#isRunning = false;

    // 清除定时器
    if (this.#checkInterval) {
      clearInterval(this.#checkInterval);
      this.#checkInterval = null;
    }

    // 停止所有子代理
    await this.#subAgentPool.stopAll();

    console.log('SchedulerEngine stopped');
  }

  /**
   * 获取任务队列
   * @returns {TaskQueue}
   */
  getTaskQueue() {
    return this.#taskQueue;
  }

  /**
   * 获取Cron调度器
   * @returns {CronScheduler}
   */
  getCronScheduler() {
    return this.#cronScheduler;
  }

  /**
   * 获取子代理池
   * @returns {SubAgentPool}
   */
  getSubAgentPool() {
    return this.#subAgentPool;
  }

  /**
   * 获取消息总线
   * @returns {MessageBus}
   */
  getMessageBus() {
    return this.#messageBus;
  }

  /**
   * 检查并执行到期的调度计划
   * @private
   * @returns {Promise<void>}
   */
  async #checkSchedules() {
    if (!this.#isRunning) {
      return;
    }

    try {
      // 获取到期的调度计划
      const dueSchedules = this.#cronScheduler.getDueSchedules();

      for (const schedule of dueSchedules) {
        // 创建任务
        const task = await this.#taskQueue.add({
          type: schedule.taskType,
          payload: schedule.taskPayload,
          priority: 1, // 调度任务默认高优先级
          scheduleId: schedule.id
        });

        // 记录调度执行
        await this.#cronScheduler.recordRun(schedule.id);

        console.log(`Created task ${task.id} from schedule ${schedule.id}`);
      }

      // 处理待执行的任务
      await this.#processPendingTasks();

    } catch (error) {
      console.error('Error checking schedules:', error);
    }
  }

  /**
   * 处理待执行的任务
   * @private
   * @returns {Promise<void>}
   */
  async #processPendingTasks() {
    // 获取下一个待处理任务
    const task = this.#taskQueue.getNextPending();

    if (!task) {
      return;
    }

    // 执行任务
    await this.#executeTask(task);
  }

  /**
   * 执行任务
   * @private
   * @param {Object} task - 任务对象
   * @returns {Promise<void>}
   */
  async #executeTask(task) {
    // 更新任务状态为运行中
    await this.#taskQueue.update(task.id, {
      status: TaskStatus.RUNNING
    });

    // 创建子代理
    const subAgent = this.#subAgentPool.create({
      parentId: 'scheduler',
      workingDir: this.#config.workingDirectory
    });

    try {
      // 运行任务
      const result = await subAgent.run(task);

      // 更新任务状态为完成
      await this.#taskQueue.update(task.id, {
        status: TaskStatus.COMPLETED,
        result: result
      });

      console.log(`Task ${task.id} completed successfully`);

    } catch (error) {
      // 更新任务状态为失败
      await this.#taskQueue.update(task.id, {
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error.message : String(error)
      });

      console.error(`Task ${task.id} failed:`, error);

    } finally {
      // 清理子代理
      await this.#subAgentPool.remove(subAgent.id);
    }
  }

  /**
   * 立即执行任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} 执行结果
   */
  async executeTaskNow(taskId) {
    const task = this.#taskQueue.get(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== TaskStatus.PENDING) {
      throw new Error(`Task ${taskId} is not pending (status: ${task.status})`);
    }

    // 执行任务
    await this.#executeTask(task);

    // 返回更新后的任务
    return this.#taskQueue.get(taskId);
  }

  /**
   * 设置事件监听器
   * @private
   */
  #setupEventListeners() {
    // 监听任务事件
    this.#taskQueue.on('task:added', (task) => {
      console.log(`Task added: ${task.id} (${task.type})`);
    });

    this.#taskQueue.on('task:updated', (task) => {
      console.log(`Task updated: ${task.id} -> ${task.status}`);
    });

    this.#taskQueue.on('task:completed', (task) => {
      console.log(`Task completed: ${task.id}`);
    });

    this.#taskQueue.on('task:failed', (task) => {
      console.log(`Task failed: ${task.id}`);
    });

    // 监听调度事件
    this.#cronScheduler.on('schedule:added', (schedule) => {
      console.log(`Schedule added: ${schedule.id} (${schedule.name})`);
    });

    this.#cronScheduler.on('schedule:executed', (schedule) => {
      console.log(`Schedule executed: ${schedule.id} (run ${schedule.runCount})`);
    });

    // 订阅消息总线事件（用于调试）
    this.#messageBus.subscribe('scheduler', (message) => {
      console.log(`Scheduler received message: ${message.event} from ${message.from}`);
    });
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      isRunning: this.#isRunning,
      checkIntervalMs: this.#checkIntervalMs,
      taskQueue: this.#taskQueue ? this.#taskQueue.getStats() : null,
      cronScheduler: this.#cronScheduler ? {
        totalSchedules: this.#cronScheduler.list().length
      } : null,
      subAgentPool: this.#subAgentPool ? this.#subAgentPool.getStats() : null,
      messageBus: this.#messageBus ? this.#messageBus.getStats() : null
    };
  }

  /**
   * 释放所有资源
   */
  dispose() {
    // 停止引擎
    this.stop();

    // 释放子代理池
    if (this.#subAgentPool) {
      this.#subAgentPool.dispose();
    }

    // 清理引用
    this.#taskQueue = null;
    this.#cronScheduler = null;
    this.#subAgentPool = null;
    this.#messageBus = null;
  }
}

export default SchedulerEngine;
