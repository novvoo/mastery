/**
 * ConcurrencyCoordinator.js
 * 并发协调器 - 智能调度任务，管理任务组和资源锁
 */

import { TaskGroup, ExecutionStrategy } from './TaskGroup.js';

/**
 * 并发协调器类
 * 核心功能：
 * 1. 管理任务组
 * 2. 资源锁控制
 * 3. 智能调度决策
 */
export class ConcurrencyCoordinator {
  /**
   * 创建协调器实例
   * @param {Object} options - 配置项
   * @param {number} [options.globalConcurrencyLimit=10] - 全局并发限制
   */
  constructor(options = {}) {
    this.globalConcurrencyLimit = options.globalConcurrencyLimit || 10;

    // 状态管理
    this.taskGroups = new Map();
    this.taskToGroup = new Map();
    this.activeResourceLocks = new Set();
    this.runningTaskIds = new Set();
  }

  /**
   * 创建任务组
   * @param {Object} groupConfig - 组配置
   * @returns {TaskGroup}
   */
  createGroup(groupConfig) {
    const group = new TaskGroup(groupConfig);
    this.taskGroups.set(group.id, group);
    return group;
  }

  /**
   * 获取或创建默认任务组
   * @returns {TaskGroup}
   */
  getOrCreateDefaultGroup() {
    if (!this.taskGroups.has('default')) {
      this.createGroup({
        id: 'default',
        name: 'Default Group',
        strategy: ExecutionStrategy.PARALLEL,
        priority: 2
      });
    }
    return this.taskGroups.get('default');
  }

  /**
   * 注册任务到协调器
   * @param {Object} task - 任务对象
   * @param {Object} [options] - 注册选项
   * @param {string} [options.groupId] - 目标组ID
   * @param {string[]} [options.resourceLocks] - 任务级资源锁
   */
  registerTask(task, options = {}) {
    // 确定任务组
    let group;
    if (options.groupId && this.taskGroups.has(options.groupId)) {
      group = this.taskGroups.get(options.groupId);
    } else {
      group = this.getOrCreateDefaultGroup();
    }

    // 添加任务到组
    group.addTask(task.id);
    this.taskToGroup.set(task.id, group.id);
  }

  /**
   * 检查任务是否可以启动
   * @param {Object} task - 任务对象
   * @param {Object} [options] - 额外选项
   * @param {string[]} [options.resourceLocks] - 任务级资源锁
   * @returns {Object} { canStart: boolean, reason: string }
   */
  canStartTask(task, options = {}) {
    // 检查任务状态
    if (!task.isReadyToRun()) {
      return {
        canStart: false,
        reason: `Task is not ready (status: ${task.status})`
      };
    }

    // 检查全局并发限制
    if (this.runningTaskIds.size >= this.globalConcurrencyLimit) {
      return {
        canStart: false,
        reason: `Global concurrency limit reached (${this.runningTaskIds.size}/${this.globalConcurrencyLimit})`
      };
    }

    // 获取任务组
    const groupId = this.taskToGroup.get(task.id);
    const group = groupId ? this.taskGroups.get(groupId) : this.getOrCreateDefaultGroup();

    // 检查组是否可以启动新任务
    if (!group.canStartNewTask()) {
      return {
        canStart: false,
        reason: `Group ${group.name} cannot start new tasks (strategy: ${group.strategy}, running: ${group.getRunningCount()})`
      };
    }

    // 检查资源锁
    const taskResourceLocks = [
      ...(options.resourceLocks || []),
      ...(group.resourceLocks || [])
    ];

    for (const lock of taskResourceLocks) {
      if (this.activeResourceLocks.has(lock)) {
        return {
          canStart: false,
          reason: `Resource lock "${lock}" is already acquired`
        };
      }
    }

    return { canStart: true, reason: 'OK' };
  }

  /**
   * 标记任务为启动
   * @param {Object} task - 任务对象
   * @param {string[]} [resourceLocks] - 任务级资源锁
   */
  markTaskStarted(task, resourceLocks = []) {
    const groupId = this.taskToGroup.get(task.id);
    const group = groupId ? this.taskGroups.get(groupId) : this.getOrCreateDefaultGroup();

    group.markTaskRunning(task.id);
    this.runningTaskIds.add(task.id);

    // 获取所有资源锁
    const allLocks = [
      ...resourceLocks,
      ...(group.resourceLocks || [])
    ];

    // 锁定资源
    for (const lock of allLocks) {
      this.activeResourceLocks.add(lock);
    }
  }

  /**
   * 标记任务为完成
   * @param {Object} task - 任务对象
   * @param {string[]} [resourceLocks] - 任务级资源锁
   */
  markTaskCompleted(task, resourceLocks = []) {
    const groupId = this.taskToGroup.get(task.id);
    const group = groupId ? this.taskGroups.get(groupId) : this.getOrCreateDefaultGroup();

    group.markTaskCompleted(task.id);
    this.runningTaskIds.delete(task.id);

    // 获取所有资源锁
    const allLocks = [
      ...resourceLocks,
      ...(group.resourceLocks || [])
    ];

    // 释放资源
    for (const lock of allLocks) {
      this.activeResourceLocks.delete(lock);
    }
  }

  /**
   * 获取可启动的任务列表
   * @param {Object[]} pendingTasks - 待处理任务列表
   * @param {Object} [options] - 选项
   * @param {Map} [options.taskResourceLocks] - 任务资源锁映射
   * @returns {Object[]} 可以启动的任务列表
   */
  getRunnableTasks(pendingTasks, options = {}) {
    const { taskResourceLocks = new Map() } = options;
    const runnableTasks = [];

    // 按优先级排序
    const sortedTasks = [...pendingTasks].sort((a, b) => a.priority - b.priority);

    for (const task of sortedTasks) {
      const resourceLocks = taskResourceLocks.get(task.id) || [];
      const check = this.canStartTask(task, { resourceLocks });

      if (check.canStart) {
        runnableTasks.push(task);
      }
    }

    return runnableTasks;
  }

  /**
   * 从协调器移除任务
   * @param {string} taskId - 任务ID
   */
  unregisterTask(taskId) {
    const groupId = this.taskToGroup.get(taskId);
    if (groupId) {
      const group = this.taskGroups.get(groupId);
      if (group) {
        group.removeTask(taskId);
      }
      this.taskToGroup.delete(taskId);
    }
    this.runningTaskIds.delete(taskId);
  }

  /**
   * 获取任务组
   * @param {string} groupId - 组ID
   * @returns {TaskGroup|undefined}
   */
  getGroup(groupId) {
    return this.taskGroups.get(groupId);
  }

  /**
   * 获取所有任务组
   * @returns {TaskGroup[]}
   */
  getAllGroups() {
    return Array.from(this.taskGroups.values());
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const groupStats = Array.from(this.taskGroups.values()).map(g => g.getStats());

    return {
      globalConcurrencyLimit: this.globalConcurrencyLimit,
      runningTaskCount: this.runningTaskIds.size,
      activeResourceLocks: Array.from(this.activeResourceLocks),
      groupCount: this.taskGroups.size,
      taskCount: this.taskToGroup.size,
      groups: groupStats
    };
  }
}

export default ConcurrencyCoordinator;
