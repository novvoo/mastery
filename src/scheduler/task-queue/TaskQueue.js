/**
 * TaskQueue.js
 * 任务队列管理实现
 * 增强版：支持任务依赖关系处理
 */

import { Task, TaskStatus } from './Task.js';

/**
 * 任务队列类
 * 管理任务的添加、更新、查询和持久化
 * 增强功能：
 * 1. 支持任务依赖关系
 * 2. 自动处理依赖满足后的任务状态转换
 */
export class TaskQueue {
  /**
   * 创建任务队列实例
   * @param {TaskStore} store - 任务存储实例
   */
  constructor(store) {
    this.store = store;
    this.#tasks = new Map();
    this.#listeners = new Map();
    this.#dependencyGraph = new Map(); // 依赖图：taskId -> [dependentTaskIds]
  }

  // 私有字段
  #tasks;
  #listeners;
  #dependencyGraph;

  /**
   * 初始化队列，从存储加载任务
   * @returns {Promise<void>}
   */
  async initialize() {
    const taskData = await this.store.load();

    for (const data of taskData) {
      const task = Task.fromJSON(data);
      this.#tasks.set(task.id, task);
      this.#buildDependencyGraph(task);
    }

    // 检查所有任务的依赖状态
    this.#checkAllDependencies();
  }

  /**
   * 构建依赖图
   * @private
   * @param {Task} task - 任务对象
   */
  #buildDependencyGraph(task) {
    if (task.dependsOn && task.dependsOn.length > 0) {
      for (const depId of task.dependsOn) {
        if (!this.#dependencyGraph.has(depId)) {
          this.#dependencyGraph.set(depId, new Set());
        }
        this.#dependencyGraph.get(depId).add(task.id);
      }
    }
  }

  /**
   * 更新依赖图（当任务被删除时）
   * @private
   * @param {string} taskId - 被删除的任务ID
   */
  #removeFromDependencyGraph(taskId) {
    // 从其他任务的依赖列表中移除
    for (const [depId, dependents] of this.#dependencyGraph.entries()) {
      dependents.delete(taskId);
      if (dependents.size === 0) {
        this.#dependencyGraph.delete(depId);
      }
    }
    // 删除该任务自己的依赖条目
    this.#dependencyGraph.delete(taskId);
  }

  /**
   * 检查所有任务的依赖状态
   * @private
   */
  #checkAllDependencies() {
    for (const task of this.#tasks.values()) {
      if (task.status === TaskStatus.WAITING && task.isReadyToRun()) {
        task.status = TaskStatus.PENDING;
        task.updatedAt = Date.now();
        this.#emit('task:ready', task);
      }
    }
  }

  /**
   * 处理任务完成后的依赖更新
   * @private
   * @param {string} completedTaskId - 已完成的任务ID
   */
  #handleDependencyCompletion(completedTaskId) {
    const dependents = this.#dependencyGraph.get(completedTaskId);
    if (!dependents || dependents.size === 0) {
      return;
    }

    const readyTasks = [];

    for (const dependentId of dependents) {
      const dependentTask = this.#tasks.get(dependentId);
      if (!dependentTask) {continue;}

      // 标记依赖为已完成
      const allDepsMet = dependentTask.markDependencyCompleted(completedTaskId);

      if (allDepsMet && dependentTask.status === TaskStatus.WAITING) {
        // 所有依赖都完成了，将任务状态改为PENDING
        dependentTask.status = TaskStatus.PENDING;
        dependentTask.updatedAt = Date.now();
        readyTasks.push(dependentTask);

        // 触发依赖满足回调（如果存在）
        if (typeof dependentTask.onDependenciesMet === 'function') {
          try {
            dependentTask.onDependenciesMet(dependentTask);
          } catch (error) {
            console.error(`Error in onDependenciesMet callback for task ${dependentId}:`, error);
          }
        }

        this.#emit('task:ready', dependentTask);
      }
    }

    // 持久化更新
    if (readyTasks.length > 0) {
      this.#persist();
    }

    return readyTasks;
  }

  /**
   * 添加新任务
   * @param {Object} taskData - 任务数据
   * @param {string[]} [taskData.dependsOn] - 依赖的任务ID列表
   * @returns {Promise<Task>}
   */
  async add(taskData) {
    const task = new Task(taskData);

    // 如果有依赖，设置状态为WAITING
    if (task.dependsOn && task.dependsOn.length > 0) {
      // 检查依赖是否都已存在且已完成
      const allDepsCompleted = task.dependsOn.every(depId => {
        const depTask = this.#tasks.get(depId);
        return depTask && depTask.status === TaskStatus.COMPLETED;
      });

      if (allDepsCompleted) {
        // 所有依赖都已完成，直接设为PENDING
        task.completedDependencies = new Set(task.dependsOn);
      } else {
        // 有未完成的依赖，设为WAITING
        task.status = TaskStatus.WAITING;
        // 检查已完成的依赖
        for (const depId of task.dependsOn) {
          const depTask = this.#tasks.get(depId);
          if (depTask && depTask.status === TaskStatus.COMPLETED) {
            task.completedDependencies.add(depId);
          }
        }
      }
    }

    // 存储任务
    this.#tasks.set(task.id, task);

    // 构建依赖图
    this.#buildDependencyGraph(task);

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('task:added', task);

    // 如果任务已经准备好，触发ready事件
    if (task.status === TaskStatus.PENDING) {
      this.#emit('task:ready', task);
    }

    return task;
  }

  /**
   * 获取下一个待处理的高优先级任务（只返回依赖满足的任务）
   * @returns {Task|null}
   */
  getNextPending() {
    const readyTasks = Array.from(this.#tasks.values())
      .filter(task => task.isReadyToRun())
      .sort((a, b) => {
        // 按优先级排序（数值越小优先级越高）
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // 优先级相同则按创建时间排序（先创建的先执行）
        return a.createdAt - b.createdAt;
      });

    return readyTasks.length > 0 ? readyTasks[0] : null;
  }

  /**
   * 获取等待依赖的任务列表
   * @returns {Array<Task>}
   */
  getWaitingTasks() {
    return Array.from(this.#tasks.values())
      .filter(task => task.status === TaskStatus.WAITING)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 根据ID获取任务
   * @param {string} id - 任务ID
   * @returns {Task|undefined}
   */
  get(id) {
    return this.#tasks.get(id);
  }

  /**
   * 更新任务
   * @param {string} id - 任务ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Task|null>}
   */
  async update(id, updates) {
    const task = this.#tasks.get(id);

    if (!task) {
      return null;
    }

    const previousStatus = task.status;

    // 应用更新
    if (updates.status) {
      const metadata = {};
      if (updates.result !== undefined) {metadata.result = updates.result;}
      if (updates.error !== undefined) {metadata.error = updates.error;}
      task.updateStatus(updates.status, metadata);

      // 如果任务变为完成状态，处理依赖
      if (updates.status === TaskStatus.COMPLETED && previousStatus !== TaskStatus.COMPLETED) {
        this.#handleDependencyCompletion(id);
      }
    }

    // 更新其他字段
    if (updates.priority !== undefined) {
      task.priority = updates.priority;
      task.updatedAt = Date.now();
    }

    if (updates.payload !== undefined) {
      task.payload = { ...task.payload, ...updates.payload };
      task.updatedAt = Date.now();
    }

    if (updates.maxRetries !== undefined) {
      task.maxRetries = updates.maxRetries;
      task.updatedAt = Date.now();
    }

    // 更新依赖列表
    if (updates.dependsOn !== undefined) {
      // 移除旧的依赖关系
      this.#removeFromDependencyGraph(task.id);
      // 设置新的依赖
      task.dependsOn = updates.dependsOn;
      task.completedDependencies.clear();
      // 重建依赖图
      this.#buildDependencyGraph(task);
      // 重新检查依赖状态
      if (task.dependsOn.length > 0) {
        const allDepsCompleted = task.dependsOn.every(depId => {
          const depTask = this.#tasks.get(depId);
          return depTask && depTask.status === TaskStatus.COMPLETED;
        });
        if (allDepsCompleted) {
          task.status = TaskStatus.PENDING;
          task.completedDependencies = new Set(task.dependsOn);
        } else {
          task.status = TaskStatus.WAITING;
        }
      }
    }

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('task:updated', task);

    return task;
  }

  /**
   * 删除任务（仅允许删除已完成、失败或已取消的任务）
   * @param {string} id - 任务ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const task = this.#tasks.get(id);

    if (!task) {
      return false;
    }

    // 检查是否有其他任务依赖此任务
    const dependents = this.#dependencyGraph.get(id);
    if (dependents && dependents.size > 0) {
      throw new Error(
        `Cannot delete task ${id}. It has ${dependents.size} dependent task(s): ${Array.from(dependents).join(', ')}`
      );
    }

    // 只允许删除终态任务
    const deletableStatuses = [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED];
    if (!deletableStatuses.includes(task.status)) {
      throw new Error(`Cannot delete task with status '${task.status}'. Only completed, failed, or cancelled tasks can be deleted.`);
    }

    // 从依赖图中移除
    this.#removeFromDependencyGraph(id);

    this.#tasks.delete(id);

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('task:deleted', { id });

    return true;
  }

  /**
   * 取消任务
   * @param {string} id - 任务ID
   * @returns {Promise<Task|null>}
   */
  async cancel(id) {
    const task = this.#tasks.get(id);

    if (!task) {
      return null;
    }

    // 只允许取消待处理、等待中或运行中的任务
    const cancellableStatuses = [TaskStatus.PENDING, TaskStatus.WAITING, TaskStatus.RUNNING];
    if (!cancellableStatuses.includes(task.status)) {
      throw new Error(`Cannot cancel task with status '${task.status}'. Only pending, waiting, or running tasks can be cancelled.`);
    }

    task.updateStatus(TaskStatus.CANCELLED);

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('task:cancelled', task);

    return task;
  }

  /**
   * 列出任务
   * @param {Object} options - 过滤选项
   * @param {string} [options.status] - 按状态过滤
   * @param {string} [options.type] - 按类型过滤
   * @param {number} [options.priority] - 按优先级过滤
   * @param {number} [options.limit] - 返回数量限制
   * @returns {Array<Task>}
   */
  list(options = {}) {
    let tasks = Array.from(this.#tasks.values());

    // 按状态过滤
    if (options.status) {
      tasks = tasks.filter(task => task.status === options.status);
    }

    // 按类型过滤
    if (options.type) {
      tasks = tasks.filter(task => task.type === options.type);
    }

    // 按优先级过滤
    if (options.priority !== undefined) {
      tasks = tasks.filter(task => task.priority === options.priority);
    }

    // 按创建时间降序排序（最新的在前）
    tasks.sort((a, b) => b.createdAt - a.createdAt);

    // 限制数量
    if (options.limit && options.limit > 0) {
      tasks = tasks.slice(0, options.limit);
    }

    return tasks;
  }

  /**
   * 获取任务统计信息
   * @returns {Object}
   */
  getStats() {
    const stats = {
      total: this.#tasks.size,
      pending: 0,
      waiting: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    };

    for (const task of this.#tasks.values()) {
      if (stats[task.status] !== undefined) {
        stats[task.status]++;
      }
    }

    return stats;
  }

  /**
   * 获取依赖图信息
   * @returns {Object}
   */
  getDependencyGraph() {
    const graph = {};
    for (const [taskId, dependents] of this.#dependencyGraph.entries()) {
      graph[taskId] = Array.from(dependents);
    }
    return graph;
  }

  /**
   * 重试失败的任务
   * @param {string} id - 任务ID
   * @returns {Promise<Task|null>}
   */
  async retry(id) {
    const task = this.#tasks.get(id);

    if (!task) {
      return null;
    }

    if (!task.canRetry()) {
      throw new Error(`Task ${id} cannot be retried. Status: ${task.status}, Retries: ${task.retryCount}/${task.maxRetries}`);
    }

    // 重置任务状态
    task.status = TaskStatus.PENDING;
    task.error = null;
    task.result = null;
    task.startedAt = null;
    task.completedAt = null;
    task.updatedAt = Date.now();

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('task:retry', task);

    return task;
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }

    this.#listeners.get(event).add(callback);

    // 返回取消订阅函数
    return () => {
      this.#listeners.get(event)?.delete(callback);
    };
  }

  /**
   * 触发事件（私有方法）
   * @private
   * @param {string} event - 事件名称
   * @param {*} data - 事件数据
   */
  #emit(event, data) {
    const listeners = this.#listeners.get(event);

    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for '${event}':`, error);
        }
      }
    }
  }

  /**
   * 持久化任务数据（私有方法）
   * @private
   * @returns {Promise<void>}
   */
  async #persist() {
    const tasks = Array.from(this.#tasks.values()).map(task => task.toJSON());
    await this.store.save(tasks);
  }
}

export default TaskQueue;
