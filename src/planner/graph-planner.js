/**
 * Graph Planner - 图任务规划器
 * 
 * 支持:
 * - Plan → Subtasks → Dependencies
 * - DAG (有向无环图) 依赖管理
 * - 并行执行优化
 * - 动态重规划
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

/**
 * 任务状态枚举
 */
export const TaskStatus = {
  PENDING: 'pending',
  BLOCKED: 'blocked',      // 等待依赖完成
  READY: 'ready',          // 依赖已满足，可以执行
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
};

/**
 * 子任务节点
 */
export class Subtask {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.name = data.name;
    this.description = data.description || '';
    this.status = TaskStatus.PENDING;
    
    // 依赖关系
    this.dependencies = new Set(data.dependencies || []);  // 依赖的任务ID
    this.dependents = new Set();                           // 依赖此任务的任务ID
    
    // 执行配置
    this.action = data.action;           // 执行函数或配置
    this.retryCount = 0;
    this.maxRetries = data.maxRetries || 3;
    this.timeout = data.timeout || 30000;
    
    // 结果
    this.result = null;
    this.error = null;
    this.startedAt = null;
    this.completedAt = null;
    
    // 元数据
    this.metadata = data.metadata || {};
    this.priority = data.priority || 0;  // 优先级，数字越大优先级越高
  }

  /**
   * 检查依赖是否满足
   */
  checkDependencies(taskMap) {
    if (this.dependencies.size === 0) {return true;}
    
    for (const depId of this.dependencies) {
      const dep = taskMap.get(depId);
      if (!dep || dep.status !== TaskStatus.COMPLETED) {
        return false;
      }
    }
    return true;
  }

  /**
   * 更新状态
   */
  updateStatus(newStatus, data = {}) {
    const oldStatus = this.status;
    this.status = newStatus;
    
    if (newStatus === TaskStatus.RUNNING) {
      this.startedAt = Date.now();
    }
    
    if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.SKIPPED].includes(newStatus)) {
      this.completedAt = Date.now();
      if (data.result !== undefined) {this.result = data.result;}
      if (data.error !== undefined) {this.error = data.error;}
    }
    
    return { oldStatus, newStatus };
  }
}

/**
 * 执行计划
 */
export class ExecutionPlan {
  constructor(data = {}) {
    this.id = data.id || randomUUID();
    this.name = data.name || 'Unnamed Plan';
    this.description = data.description || '';
    this.status = TaskStatus.PENDING;
    
    // 任务图
    this.tasks = new Map();        // taskId -> Subtask
    this.edges = new Map();        // taskId -> Set(dependentIds)
    
    // 执行状态
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    
    // 结果
    this.results = new Map();
    this.errors = new Map();
    
    // 上下文
    this.context = data.context || {};
    this.metadata = data.metadata || {};
  }

  /**
   * 添加子任务
   */
  addTask(taskData) {
    const task = new Subtask(taskData);
    
    if (this.tasks.has(task.id)) {
      throw new Error(`Task with id ${task.id} already exists`);
    }
    
    this.tasks.set(task.id, task);
    this.edges.set(task.id, new Set());
    
    // 建立依赖关系
    for (const depId of task.dependencies) {
      if (!this.edges.has(depId)) {
        this.edges.set(depId, new Set());
      }
      this.edges.get(depId).add(task.id);
      
      const depTask = this.tasks.get(depId);
      if (depTask) {
        depTask.dependents.add(task.id);
      }
    }
    
    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有就绪的任务
   */
  getReadyTasks() {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.BLOCKED) {
        return false;
      }
      return task.checkDependencies(this.tasks);
    });
  }

  /**
   * 获取可并行执行的任务
   */
  getParallelTasks(maxConcurrency = Infinity) {
    const ready = this.getReadyTasks()
      .sort((a, b) => b.priority - a.priority);  // 按优先级排序
    
    return ready.slice(0, maxConcurrency);
  }

  /**
   * 检查是否存在循环依赖
   */
  detectCycle() {
    const visited = new Set();
    const recStack = new Set();
    
    const dfs = (taskId) => {
      visited.add(taskId);
      recStack.add(taskId);
      
      const task = this.tasks.get(taskId);
      if (task) {
        for (const depId of task.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) {return true;}
          } else if (recStack.has(depId)) {
            return true;
          }
        }
      }
      
      recStack.delete(taskId);
      return false;
    };
    
    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        if (dfs(taskId)) {return true;}
      }
    }
    
    return false;
  }

  /**
   * 拓扑排序
   */
  topologicalSort() {
    const inDegree = new Map();
    const queue = [];
    const result = [];
    
    // 计算入度
    for (const [id, task] of this.tasks) {
      inDegree.set(id, task.dependencies.size);
      if (task.dependencies.size === 0) {
        queue.push(task);
      }
    }
    
    while (queue.length > 0) {
      const task = queue.shift();
      result.push(task);
      
      const dependents = this.edges.get(task.id) || new Set();
      for (const depId of dependents) {
        const newDegree = inDegree.get(depId) - 1;
        inDegree.set(depId, newDegree);
        
        if (newDegree === 0) {
          queue.push(this.tasks.get(depId));
        }
      }
    }
    
    // 检查是否有环
    if (result.length !== this.tasks.size) {
      throw new Error('Cycle detected in task graph');
    }
    
    return result;
  }

  /**
   * 计算关键路径
   */
  calculateCriticalPath() {
    const sorted = this.topologicalSort();
    const earliest = new Map();
    const latest = new Map();
    
    // 正向计算最早开始时间
    for (const task of sorted) {
      let maxDepTime = 0;
      for (const depId of task.dependencies) {
        const depTime = earliest.get(depId) || 0;
        maxDepTime = Math.max(maxDepTime, depTime + 1); // 假设每个任务耗时1单位
      }
      earliest.set(task.id, maxDepTime);
    }
    
    // 反向计算最晚开始时间
    const totalDuration = Math.max(...earliest.values()) + 1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const task = sorted[i];
      let minSuccTime = totalDuration;
      
      for (const succId of task.dependents) {
        const succTime = latest.get(succId) || totalDuration;
        minSuccTime = Math.min(minSuccTime, succTime - 1);
      }
      
      latest.set(task.id, minSuccTime - 1);
    }
    
    // 找出关键路径上的任务
    const criticalPath = [];
    for (const task of sorted) {
      const slack = (latest.get(task.id) || 0) - (earliest.get(task.id) || 0);
      if (slack === 0) {
        criticalPath.push(task);
      }
    }
    
    return criticalPath;
  }

  /**
   * 序列化为 JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      status: this.status,
      tasks: Array.from(this.tasks.values()).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        status: t.status,
        dependencies: Array.from(t.dependencies),
        priority: t.priority,
        result: t.result,
        error: t.error,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      })),
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      context: this.context,
      metadata: this.metadata,
    };
  }

  /**
   * 从 JSON 反序列化
   */
  static fromJSON(json) {
    const plan = new ExecutionPlan({
      id: json.id,
      name: json.name,
      description: json.description,
      context: json.context,
      metadata: json.metadata,
    });
    
    for (const taskData of json.tasks) {
      plan.addTask(taskData);
    }
    
    return plan;
  }
}

/**
 * 图规划器
 */
export class GraphPlanner extends EventEmitter {
  #plans = new Map();
  #executors = new Map();
  #config;

  constructor(config = {}) {
    super();
    this.#config = {
      maxConcurrency: config.maxConcurrency || 5,
      enableRetry: config.enableRetry ?? true,
      enableDynamicPlanning: config.enableDynamicPlanning ?? true,
      ...config,
    };
  }

  /**
   * 创建执行计划
   */
  createPlan(name, description, context = {}) {
    const plan = new ExecutionPlan({
      name,
      description,
      context,
    });
    
    this.#plans.set(plan.id, plan);
    this.emit('plan:created', plan);
    
    return plan;
  }

  /**
   * 分解任务为子任务
   */
  decomposeTask(planId, taskDescription, options = {}) {
    const plan = this.#plans.get(planId);
    if (!plan) {throw new Error(`Plan ${planId} not found`);}

    // 这里可以集成 LLM 进行智能任务分解
    // 简化版本：根据模板或规则分解
    const subtasks = this.#generateSubtasks(taskDescription, options);
    
    for (const subtask of subtasks) {
      plan.addTask(subtask);
    }
    
    // 检查循环依赖
    if (plan.detectCycle()) {
      throw new Error('Cycle detected in task dependencies');
    }
    
    this.emit('plan:decomposed', { plan, subtasks });
    
    return subtasks;
  }

  /**
   * 生成子任务（简化版本）
   */
  #generateSubtasks(description, options) {
    // 实际实现中应该调用 LLM 进行智能分解
    // 这里提供一个基于模板的简化实现
    const templates = {
      'code_review': [
        { name: 'analyze_code', description: '分析代码结构', dependencies: [] },
        { name: 'check_style', description: '检查代码风格', dependencies: ['analyze_code'] },
        { name: 'find_bugs', description: '查找潜在问题', dependencies: ['analyze_code'] },
        { name: 'generate_report', description: '生成审查报告', dependencies: ['check_style', 'find_bugs'] },
      ],
      'refactor': [
        { name: 'identify_smells', description: '识别代码坏味道', dependencies: [] },
        { name: 'plan_changes', description: '规划重构方案', dependencies: ['identify_smells'] },
        { name: 'apply_refactoring', description: '应用重构', dependencies: ['plan_changes'] },
        { name: 'verify_changes', description: '验证重构结果', dependencies: ['apply_refactoring'] },
      ],
    };

    const template = templates[options.template] || templates['code_review'];
    
    return template.map((t, index) => ({
      name: t.name,
      description: t.description,
      dependencies: t.dependencies,
      priority: options.priority || 0,
      action: options.actions?.[t.name] || null,
    }));
  }

  /**
   * 执行计划
   */
  async executePlan(planId, executor) {
    const plan = this.#plans.get(planId);
    if (!plan) {throw new Error(`Plan ${planId} not found`);}

    if (plan.detectCycle()) {
      throw new Error('Cannot execute plan with cyclic dependencies');
    }

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();
    this.emit('plan:started', plan);

    this.#executors.set(planId, executor);

    try {
      // 使用拓扑排序确定执行顺序
      const sorted = plan.topologicalSort();
      
      // 按层级分组，支持并行执行
      const levels = this.#groupByLevel(sorted);
      
      for (const level of levels) {
        // 并行执行当前层级的所有任务
        const promises = level.map(task => this.#executeTask(plan, task, executor));
        const results = await Promise.allSettled(promises);
        
        // 检查是否有失败
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0 && !this.#config.continueOnError) {
          throw new Error(`${failures.length} tasks failed`);
        }
      }

      plan.status = TaskStatus.COMPLETED;
      plan.completedAt = Date.now();
      this.emit('plan:completed', plan);
      
      return plan;
    } catch (error) {
      plan.status = TaskStatus.FAILED;
      plan.completedAt = Date.now();
      this.emit('plan:failed', { plan, error });
      throw error;
    }
  }

  /**
   * 按层级分组任务
   */
  #groupByLevel(sortedTasks) {
    const levels = [];
    const completed = new Set();
    
    while (completed.size < sortedTasks.length) {
      const currentLevel = [];
      
      for (const task of sortedTasks) {
        if (completed.has(task.id)) {continue;}
        
        // 检查所有依赖是否已完成
        const depsCompleted = Array.from(task.dependencies).every(depId => 
          completed.has(depId)
        );
        
        if (depsCompleted) {
          currentLevel.push(task);
        }
      }
      
      if (currentLevel.length === 0) {
        throw new Error('Cycle detected or invalid dependencies');
      }
      
      levels.push(currentLevel);
      for (const task of currentLevel) {
        completed.add(task.id);
      }
    }
    
    return levels;
  }

  /**
   * 执行单个任务
   */
  async #executeTask(plan, task, executor) {
    // 检查依赖
    if (!task.checkDependencies(plan.tasks)) {
      task.updateStatus(TaskStatus.BLOCKED);
      return { task, skipped: true };
    }

    task.updateStatus(TaskStatus.RUNNING);
    this.emit('task:started', { plan, task });

    try {
      let result;
      
      if (typeof task.action === 'function') {
        result = await executor.execute(task.action, {
          timeout: task.timeout,
          context: plan.context,
        });
      } else if (task.action) {
        result = await executor.execute(task.action.command, task.action.args, {
          timeout: task.timeout,
        });
      } else {
        // 默认执行：直接标记为完成
        result = { success: true };
      }

      task.updateStatus(TaskStatus.COMPLETED, { result });
      plan.results.set(task.id, result);
      
      this.emit('task:completed', { plan, task, result });
      
      return { task, result };
    } catch (error) {
      task.retryCount++;
      
      if (task.retryCount < task.maxRetries && this.#config.enableRetry) {
        // 重试
        this.emit('task:retry', { plan, task, error });
        return this.#executeTask(plan, task, executor);
      }
      
      task.updateStatus(TaskStatus.FAILED, { error: error.message });
      plan.errors.set(task.id, error);
      
      this.emit('task:failed', { plan, task, error });
      
      throw error;
    }
  }

  /**
   * 动态添加任务（执行中）
   */
  async addTaskDynamically(planId, taskData) {
    if (!this.#config.enableDynamicPlanning) {
      throw new Error('Dynamic planning is disabled');
    }

    const plan = this.#plans.get(planId);
    if (!plan) {throw new Error(`Plan ${planId} not found`);}

    const task = plan.addTask(taskData);
    
    // 检查循环依赖
    if (plan.detectCycle()) {
      plan.tasks.delete(task.id);
      throw new Error('Adding this task would create a cycle');
    }

    this.emit('plan:task:added', { plan, task });
    
    // 如果依赖已满足，立即执行
    if (task.checkDependencies(plan.tasks) && plan.status === TaskStatus.RUNNING) {
      const executor = this.#executors.get(planId);
      if (executor) {
        this.#executeTask(plan, task, executor).catch(console.error);
      }
    }
    
    return task;
  }

  /**
   * 获取计划
   */
  getPlan(planId) {
    return this.#plans.get(planId);
  }

  /**
   * 列出所有计划
   */
  listPlans() {
    return Array.from(this.#plans.values());
  }

  /**
   * 取消计划
   */
  cancelPlan(planId) {
    const plan = this.#plans.get(planId);
    if (!plan) {return false;}

    plan.status = TaskStatus.CANCELLED;
    
    // 取消所有正在运行的任务
    for (const task of plan.tasks.values()) {
      if (task.status === TaskStatus.RUNNING) {
        task.updateStatus(TaskStatus.CANCELLED);
      }
    }
    
    this.emit('plan:cancelled', plan);
    return true;
  }

  /**
   * 导出计划为 Mermaid 图
   */
  exportToMermaid(planId) {
    const plan = this.#plans.get(planId);
    if (!plan) {throw new Error(`Plan ${planId} not found`);}

    const lines = ['graph TD'];
    
    // 添加节点
    for (const [id, task] of plan.tasks) {
      const statusEmoji = {
        [TaskStatus.PENDING]: '⏳',
        [TaskStatus.RUNNING]: '🔄',
        [TaskStatus.COMPLETED]: '✅',
        [TaskStatus.FAILED]: '❌',
        [TaskStatus.BLOCKED]: '🚫',
      }[task.status] || '⚪';
      
      lines.push(`  ${id}["${statusEmoji} ${task.name}"]`);
    }
    
    // 添加边
    for (const [id, task] of plan.tasks) {
      for (const depId of task.dependencies) {
        lines.push(`  ${depId} --> ${id}`);
      }
    }
    
    return lines.join('\n');
  }
}

export default GraphPlanner;
