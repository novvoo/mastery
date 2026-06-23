/**
 * TaskGroup.js
 * 任务组定义 - 管理一组任务的执行策略
 */

// 执行策略枚举
export const ExecutionStrategy = {
  SERIAL: 'serial',
  PARALLEL: 'parallel',
};

/**
 * 任务组类
 * 定义一组任务的执行策略和资源约束
 */
export class TaskGroup {
  /**
   * 创建任务组实例
   * @param {Object} options - 任务组配置
   * @param {string} options.id - 唯一标识
   * @param {string} options.name - 组名
   * @param {string} [options.strategy=ExecutionStrategy.PARALLEL] - 执行策略
   * @param {string[]} [options.resourceLocks=[] - 资源锁
   * @param {number} [options.priority=2 - 优先级
   * @param {number} [options.concurrencyLimit=5] - 并发限制（仅PARALLEL模式）
   */
  constructor(options) {
    this.id = options.id;
    this.name = options.name;
    this.strategy = options.strategy || ExecutionStrategy.PARALLEL;
    this.resourceLocks = options.resourceLocks || [];
    this.priority = options.priority !== undefined ? options.priority : 2;
    this.concurrencyLimit = options.concurrencyLimit || 5;

    // 运行时状态
    this.taskIds = new Set();
    this.runningTaskIds = new Set();
  }

  /**
   * 添加任务到组
   * @param {string} taskId - 任务ID
   */
  addTask(taskId) {
    this.taskIds.add(taskId);
  }

  /**
   * 从组移除任务
   * @param {string} taskId - 任务ID
   */
  removeTask(taskId) {
    this.taskIds.delete(taskId);
    this.runningTaskIds.delete(taskId);
  }

  /**
   * 标记任务为运行中
   * @param {string} taskId - 任务ID
   */
  markTaskRunning(taskId) {
    if (this.taskIds.has(taskId)) {
      this.runningTaskIds.add(taskId);
    }
  }

  /**
   * 标记任务为完成
   * @param {string} taskId - 任务ID
   */
  markTaskCompleted(taskId) {
    this.runningTaskIds.delete(taskId);
  }

  /**
   * 检查是否可以启动新任务
   * @returns {boolean}
   */
  canStartNewTask() {
    if (this.strategy === ExecutionStrategy.SERIAL) {
      // 串行模式：无运行中任务才能启动
      return this.runningTaskIds.size === 0;
    }
    // 并行模式：检查并发限制
    return this.runningTaskIds.size < this.concurrencyLimit;
  }

  /**
   * 获取当前运行的任务数
   * @returns {number}
   */
  getRunningCount() {
    return this.runningTaskIds.size;
  }

  /**
   * 获取组的统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      id: this.id,
      name: this.name,
      strategy: this.strategy,
      taskCount: this.taskIds.size,
      runningCount: this.runningTaskIds.size,
      resourceLocks: this.resourceLocks,
      canStartNew: this.canStartNewTask(),
    };
  }

  /**
   * 序列化为JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      strategy: this.strategy,
      resourceLocks: this.resourceLocks,
      priority: this.priority,
      concurrencyLimit: this.concurrencyLimit,
    };
  }
}

export default TaskGroup;
