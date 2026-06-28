/**
 * Task.js
 * 任务状态、优先级定义及任务类实现
 * 增强版：支持任务依赖关系
 */

// 任务状态枚举
export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  WAITING: 'waiting', // 新增：等待依赖任务完成
};

// 任务优先级枚举（数值越小优先级越高）
export const TaskPriority = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
  BACKGROUND: 4,
};

/**
 * 任务类
 * 表示一个可执行的工作单元
 * 增强功能：
 * 1. 支持任务依赖关系（dependsOn）
 * 2. 支持依赖完成后的回调
 */
export class Task {
  /**
   * 创建任务实例
   * @param {Object} data - 任务数据
   * @param {string} data.id - 任务唯一标识
   * @param {string} data.type - 任务类型
   * @param {string} [data.status=TaskStatus.PENDING] - 任务状态
   * @param {number} [data.priority=TaskPriority.NORMAL] - 任务优先级
   * @param {Object} [data.payload={}] - 任务载荷数据
   * @param {any} [data.result=null] - 任务执行结果
   * @param {string} [data.error=null] - 错误信息
   * @param {number} [data.retryCount=0] - 当前重试次数
   * @param {number} [data.maxRetries=3] - 最大重试次数
   * @param {string} [data.parentId=null] - 父任务ID
   * @param {string} [data.scheduleId=null] - 关联的调度计划ID
   * @param {string[]} [data.dependsOn=[]] - 依赖的任务ID列表
   * @param {Function} [data.onDependenciesMet] - 依赖满足后的回调
   */
  constructor(data) {
    const now = Date.now();

    this.id = data.id ?? this.#generateId();
    this.type = data.type;
    this.status = data.status ?? TaskStatus.PENDING;
    this.priority = data.priority !== undefined ? data.priority : TaskPriority.NORMAL;
    this.payload = data.payload ?? {};
    this.result = data.result !== undefined ? data.result : null;
    this.error = data.error ?? null;

    // 时间戳
    this.createdAt = data.createdAt ?? now;
    this.updatedAt = data.updatedAt ?? now;
    this.startedAt = data.startedAt ?? null;
    this.completedAt = data.completedAt ?? null;

    // 重试相关
    this.retryCount = data.retryCount ?? 0;
    this.maxRetries = data.maxRetries !== undefined ? data.maxRetries : 3;

    // 关联关系
    this.parentId = data.parentId ?? null;
    this.scheduleId = data.scheduleId ?? null;

    // 依赖关系（新增）
    this.dependsOn = data.dependsOn ?? [];
    this.completedDependencies = new Set(data.completedDependencies ?? []);
    this.onDependenciesMet = data.onDependenciesMet ?? null;
  }

  /**
   * 生成唯一ID
   * @private
   * @returns {string}
   */
  #generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 更新任务状态
   * @param {string} status - 新状态
   * @param {Object} [metadata={}] - 附加元数据
   * @param {any} [metadata.result] - 执行结果
   * @param {string} [metadata.error] - 错误信息
   */
  updateStatus(status, metadata = {}) {
    const now = Date.now();
    const previousStatus = this.status;

    this.status = status;
    this.updatedAt = now;

    // 根据状态更新时间戳
    if (status === TaskStatus.RUNNING && previousStatus !== TaskStatus.RUNNING) {
      this.startedAt = now;
    }

    if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(status)) {
      this.completedAt = now;
    }

    // 更新结果或错误
    if (metadata.result !== undefined) {
      this.result = metadata.result;
    }
    if (metadata.error !== undefined) {
      this.error = metadata.error;
    }

    // 失败时增加重试计数
    if (status === TaskStatus.FAILED) {
      this.retryCount++;
    }
  }

  /**
   * 检查是否可以重试
   * @returns {boolean}
   */
  canRetry() {
    return this.status === TaskStatus.FAILED && this.retryCount < this.maxRetries;
  }

  /**
   * 添加依赖任务
   * @param {string} taskId - 依赖的任务ID
   */
  addDependency(taskId) {
    if (!this.dependsOn.includes(taskId)) {
      this.dependsOn.push(taskId);
    }
  }

  /**
   * 移除依赖任务
   * @param {string} taskId - 要移除的依赖任务ID
   */
  removeDependency(taskId) {
    this.dependsOn = this.dependsOn.filter((id) => id !== taskId);
    this.completedDependencies.delete(taskId);
  }

  /**
   * 标记依赖任务为已完成
   * @param {string} taskId - 已完成的依赖任务ID
   * @returns {boolean} 是否所有依赖都已完成
   */
  markDependencyCompleted(taskId) {
    if (this.dependsOn.includes(taskId)) {
      this.completedDependencies.add(taskId);
    }
    return this.areDependenciesMet();
  }

  /**
   * 检查所有依赖是否已满足
   * @returns {boolean}
   */
  areDependenciesMet() {
    if (this.dependsOn.length === 0) {
      return true;
    }
    return this.dependsOn.every((id) => this.completedDependencies.has(id));
  }

  /**
   * 获取未完成的依赖列表
   * @returns {string[]}
   */
  getPendingDependencies() {
    return this.dependsOn.filter((id) => !this.completedDependencies.has(id));
  }

  /**
   * 检查任务是否准备好执行（依赖满足且状态为PENDING或WAITING）
   * @returns {boolean}
   */
  isReadyToRun() {
    return (
      this.areDependenciesMet() &&
      (this.status === TaskStatus.PENDING || this.status === TaskStatus.WAITING)
    );
  }

  /**
   * 序列化为普通对象
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      priority: this.priority,
      payload: this.payload,
      result: this.result,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      parentId: this.parentId,
      scheduleId: this.scheduleId,
      dependsOn: this.dependsOn,
      completedDependencies: Array.from(this.completedDependencies),
    };
  }

  /**
   * 从普通对象反序列化
   * @param {Object} json - 序列化的任务数据
   * @returns {Task}
   */
  static fromJSON(json) {
    return new Task(json);
  }
}

export default Task;
