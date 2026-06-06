/**
 * SchedulerEngine.js
 * 调度引擎主类 - 整合任务队列、Cron调度器和子代理池
 * 增强版：支持并发协调器
 */

import { TaskQueue, TaskStore, TaskStatus } from './task-queue/index.js';
import { CronScheduler, ScheduleStore } from './cron/index.js';
import { SubAgentPool } from './subagent/SubAgentPool.js';
import { MessageBus } from './subagent/MessageBus.js';
import { ConcurrencyCoordinator } from './concurrency/index.js';
import { join } from 'path';

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000; // 默认5分钟任务超时

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
  #concurrencyCoordinator;
  #taskResourceLocks; // 任务资源锁映射

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

    // 初始化资源锁映射
    this.#taskResourceLocks = new Map();

    // 子模块将在initialize中创建
    this.#taskQueue = null;
    this.#cronScheduler = null;
    this.#subAgentPool = null;
    this.#messageBus = null;
    this.#concurrencyCoordinator = null;
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

    // 创建并发协调器
    this.#concurrencyCoordinator = new ConcurrencyCoordinator({
      globalConcurrencyLimit: this.#config.globalConcurrencyLimit || 5
    });

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
   * 获取并发协调器
   * @returns {ConcurrencyCoordinator}
   */
  getConcurrencyCoordinator() {
    return this.#concurrencyCoordinator;
  }

  /**
   * 创建任务组
   * @param {Object} groupConfig - 组配置
   * @returns {TaskGroup}
   */
  createTaskGroup(groupConfig) {
    return this.#concurrencyCoordinator.createGroup(groupConfig);
  }

  /**
   * 添加任务并指定组和资源锁
   * @param {Object} taskData - 任务数据
   * @param {Object} [options] - 选项
   * @param {string} [options.groupId] - 组ID
   * @param {string[]} [options.resourceLocks] - 资源锁
   * @returns {Promise<Object>} 任务对象
   */
  async addTaskWithOptions(taskData, options = {}) {
    const task = await this.#taskQueue.add(taskData);

    if (options.groupId || options.resourceLocks) {
      this.#concurrencyCoordinator.registerTask(task, { groupId: options.groupId });

      if (options.resourceLocks) {
        this.#taskResourceLocks.set(task.id, options.resourceLocks);
      }
    }

    return task;
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
   * 处理待执行的任务 - 支持并发
   * @private
   * @returns {Promise<void>}
   */
  async #processPendingTasks() {
    // 获取所有待处理任务
    const allTasks = this.#taskQueue.list({ status: TaskStatus.PENDING });

    if (allTasks.length === 0) {
      return;
    }

    // 注册所有新任务到协调器
    for (const task of allTasks) {
      if (!this.#concurrencyCoordinator.getGroup('default').taskIds.has(task.id)) {
        this.#concurrencyCoordinator.registerTask(task);
      }
    }

    // 获取可运行的任务
    const runnableTasks = this.#concurrencyCoordinator.getRunnableTasks(allTasks, {
      taskResourceLocks: this.#taskResourceLocks
    });

    if (runnableTasks.length === 0) {
      console.log(`No tasks ready to run. Total pending: ${allTasks.length}`);
      return;
    }

    console.log(`Ready to run ${runnableTasks.length} tasks`);

    // 并发执行所有可运行的任务
    const executionPromises = runnableTasks.map(task => this.#executeTask(task));
    await Promise.all(executionPromises);
  }

  /**
   * 执行单个任务
   * @private
   * @param {Object} task - 任务对象
   * @returns {Promise<void>}
   */
  async #executeTask(task) {
    const resourceLocks = this.#taskResourceLocks.get(task.id) || [];
    const taskTimeout = task.timeoutMs || DEFAULT_TASK_TIMEOUT_MS;

    // 标记任务为运行中
    this.#concurrencyCoordinator.markTaskStarted(task, resourceLocks);

    // 更新任务状态为运行中
    await this.#taskQueue.update(task.id, {
      status: TaskStatus.RUNNING,
      startedAt: Date.now()
    });

    // 创建子代理
    const subAgent = this.#subAgentPool.create({
      parentId: 'scheduler',
      workingDir: this.#config.workingDirectory
    });

    // 超时控制器
    let timeoutId;
    let taskTimedOut = false;
    
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        taskTimedOut = true;
        reject(new Error(`Task timed out after ${taskTimeout}ms`));
      }, taskTimeout);
    });

    try {
      // 带超时运行任务
      const result = await Promise.race([
        subAgent.run(task),
        timeoutPromise
      ]);

      // 更新任务状态为完成
      await this.#taskQueue.update(task.id, {
        status: TaskStatus.COMPLETED,
        result: result,
        completedAt: Date.now()
      });

      console.log(`Task ${task.id} completed successfully`);

    } catch (error) {
      // 更新任务状态为失败或超时
      const status = taskTimedOut ? 'TIMED_OUT' : TaskStatus.FAILED;
      await this.#taskQueue.update(task.id, {
        status,
        error: error instanceof Error ? error.message : String(error),
        failedAt: Date.now()
      });

      console.error(`Task ${task.id} ${taskTimedOut ? 'timed out' : 'failed'}:`, error);

      // 如果超时，尝试强制终止子代理
      if (taskTimedOut) {
        try {
          await subAgent.terminate?.();
        } catch (terminateError) {
          console.warn('Failed to terminate timed out sub-agent:', terminateError);
        }
      }

    } finally {
      // 清理超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // 清理资源
      this.#concurrencyCoordinator.markTaskCompleted(task, resourceLocks);
      await this.#subAgentPool.remove(subAgent.id);
      this.#taskResourceLocks.delete(task.id);
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
      messageBus: this.#messageBus ? this.#messageBus.getStats() : null,
      concurrencyCoordinator: this.#concurrencyCoordinator ? this.#concurrencyCoordinator.getStats() : null
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
