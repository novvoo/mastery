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
  BLOCKED: 'blocked', // 等待依赖完成
  READY: 'ready', // 依赖已满足，可以执行
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
};

/**
 * 🎯 任务模板库 - 方法论级别的任务定义
 * 包含：语义化 ID、执行约束、工具限制、完成条件
 *
 * 这些模板防止 LLM 生成 task_1/task_2，而是使用语义化 ID
 */
export const TASK_TEMPLATE_REGISTRY = {
  // ===== 探索阶段 (inspection) 任务 =====
  inspect_readme: {
    id: 'inspect_readme',
    semanticName: '阅读项目说明',
    phase: 'exploration',
    priority: 100,
    allowedTools: ['read_file', 'glob'],
    requiredToolIntents: ['read'],
    completionPredicate: (toolCall, result) =>
      toolCall.name === 'read_file' && (result.path || '').toLowerCase().includes('readme'),
    description: '通过 read_file 工具读取 README.md 理解项目',
    methodologyHint: 'inspect',
  },

  inspect_workspace: {
    id: 'inspect_workspace',
    semanticName: '查看项目结构',
    phase: 'exploration',
    priority: 90,
    allowedTools: ['list_dir', 'glob', 'read_file'],
    requiredToolIntents: ['read'],
    completionPredicate: (toolCall, result) =>
      ['list_dir', 'glob', 'read_file'].includes(toolCall.name),
    description: '通过 list_dir/glob 工具查看项目目录结构',
    methodologyHint: 'inspect',
  },

  inspect_existing_code: {
    id: 'inspect_existing_code',
    semanticName: '检查现有代码',
    phase: 'exploration',
    priority: 80,
    allowedTools: ['read_file', 'glob', 'search'],
    requiredToolIntents: ['read'],
    completionPredicate: (toolCall, result) =>
      ['read_file', 'glob', 'search'].includes(toolCall.name),
    description: '读取关键源文件，理解现有实现',
    methodologyHint: 'inspect',
  },

  analyze_requirements: {
    id: 'analyze_requirements',
    semanticName: '分析需求',
    phase: 'planning',
    priority: 70,
    allowedTools: ['read_file', 'semantic_search', 'context_assess'],
    requiredToolIntents: ['read'],
    completionPredicate: (toolCall, result) =>
      ['read_file', 'semantic_search', 'context_assess'].includes(toolCall.name),
    description: '基于代码现状分析需求和缺失功能',
    methodologyHint: 'plan',
  },

  // ===== 规划阶段 (planning) 任务 =====
  plan_solution: {
    id: 'plan_solution',
    semanticName: '规划实现方案',
    phase: 'planning',
    priority: 60,
    allowedTools: ['context_assess'],
    requiredToolIntents: [],
    completionPredicate: (toolCall, result) => toolCall.name === 'context_assess',
    description: '设计实现方案，分解为具体改动',
    methodologyHint: 'plan',
  },

  design_changes: {
    id: 'design_changes',
    semanticName: '设计改动方案',
    phase: 'planning',
    priority: 55,
    allowedTools: ['context_assess'],
    requiredToolIntents: [],
    completionPredicate: (toolCall, result) => toolCall.name === 'context_assess',
    description: '确定具体修改文件和代码位置',
    methodologyHint: 'plan',
  },

  // ===== 实现阶段 (implementation) 任务 =====
  implement_features: {
    id: 'implement_features',
    semanticName: '实现功能',
    phase: 'implementation',
    priority: 50,
    allowedTools: ['write_file', 'edit_file', 'apply_hashline_patch'],
    requiredToolIntents: ['write'],
    completionPredicate: (toolCall, result) =>
      ['write_file', 'edit_file', 'apply_hashline_patch'].includes(toolCall.name) &&
      result?.success === true,
    description: '通过 write_file/edit_file 修改源代码实现功能',
    methodologyHint: 'implement',
    requiresMutation: true,
  },

  implement_changes: {
    id: 'implement_changes',
    semanticName: '实现代码改动',
    phase: 'implementation',
    priority: 50,
    allowedTools: ['write_file', 'edit_file', 'apply_hashline_patch'],
    requiredToolIntents: ['write'],
    completionPredicate: (toolCall, result) =>
      ['write_file', 'edit_file', 'apply_hashline_patch'].includes(toolCall.name) &&
      result?.success === true,
    description: '执行实际代码修改',
    methodologyHint: 'implement',
    requiresMutation: true,
  },

  create_new_files: {
    id: 'create_new_files',
    semanticName: '创建新文件',
    phase: 'implementation',
    priority: 45,
    allowedTools: ['write_file', 'apply_hashline_patch'],
    requiredToolIntents: ['write'],
    completionPredicate: (toolCall, result) =>
      ['write_file', 'apply_hashline_patch'].includes(toolCall.name) && result?.success === true,
    description: '创建新的源代码文件',
    methodologyHint: 'implement',
    requiresMutation: true,
  },

  refactor_code: {
    id: 'refactor_code',
    semanticName: '重构代码',
    phase: 'implementation',
    priority: 40,
    allowedTools: ['edit_file', 'apply_hashline_patch'],
    requiredToolIntents: ['write'],
    completionPredicate: (toolCall, result) =>
      ['edit_file', 'apply_hashline_patch'].includes(toolCall.name) && result?.success === true,
    description: '重构现有代码改进质量',
    methodologyHint: 'implement',
    requiresMutation: true,
  },

  // ===== 验证阶段 (verification) 任务 =====
  verify_result: {
    id: 'verify_result',
    semanticName: '验证结果',
    phase: 'verification',
    priority: 30,
    allowedTools: ['shell', 'lsp_diagnostics', 'read_file'],
    requiredToolIntents: ['execute', 'read'],
    completionPredicate: (toolCall, result) => ['shell', 'lsp_diagnostics'].includes(toolCall.name),
    description: '运行测试、构建、linter 验证改动',
    methodologyHint: 'verify',
  },

  run_tests: {
    id: 'run_tests',
    semanticName: '运行测试',
    phase: 'verification',
    priority: 25,
    allowedTools: ['shell', 'read_file'],
    requiredToolIntents: ['execute'],
    completionPredicate: (toolCall, result) =>
      toolCall.name === 'shell' && (result.command || '').includes('test'),
    description: '执行测试套件验证功能正确性',
    methodologyHint: 'verify',
  },

  check_diagnostics: {
    id: 'check_diagnostics',
    semanticName: '检查诊断结果',
    phase: 'verification',
    priority: 20,
    allowedTools: ['lsp_diagnostics', 'shell'],
    requiredToolIntents: ['read'],
    completionPredicate: (toolCall, result) => ['lsp_diagnostics', 'shell'].includes(toolCall.name),
    description: '检查 LSP 诊断信息，确保无错误',
    methodologyHint: 'verify',
  },

  review_changes: {
    id: 'review_changes',
    semanticName: '审查改动',
    phase: 'verification',
    priority: 15,
    allowedTools: ['read_file', 'shell'],
    requiredToolIntents: ['read'],
    completionPredicate: (toolCall, result) => ['read_file', 'shell'].includes(toolCall.name),
    description: '检查修改的代码，确保符合标准',
    methodologyHint: 'verify',
  },
};

/**
 * 子任务节点
 */
export class Subtask {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.name = data.name;
    this.description = data.description || '';
    this.status = data.status || TaskStatus.PENDING;

    // 依赖关系
    this.dependencies = new Set(data.dependencies || []); // 依赖的任务ID
    this.dependents = new Set(); // 依赖此任务的任务ID

    // 执行配置
    this.action = data.action; // 执行函数或配置
    this.retryCount = 0;
    this.maxRetries = data.maxRetries || 3;
    this.timeout = data.timeout || 30000;

    // 结果
    this.result = data.result ?? null;
    this.error = data.error ?? null;
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;

    // 元数据
    this.metadata = data.metadata || {};
    // 文件作用域（渐进式探索：该子任务允许关注的文件/目录）
    this.scopeFiles = Array.isArray(data.scopeFiles) ? data.scopeFiles : [];
    // 生命周期阶段：exploration | planning | implementation | inspection | verification
    this.phase = data.phase || null;
    this.priority = data.priority || 0; // 优先级，数字越大优先级越高

    // ✅ 新增：执行约束
    // allowedTools: 该 task 只能调用这些工具
    this.allowedTools = Array.isArray(data.allowedTools) ? data.allowedTools : [];

    // requiredToolIntents: 该 task 必须调用的工具类型（如 'read', 'write'）
    this.requiredToolIntents = Array.isArray(data.requiredToolIntents)
      ? data.requiredToolIntents
      : [];

    // completionPredicate: 判断 task 是否完成的谓词
    // 可以是字符串（如 'toolName:read_file && success') 或函数 (toolResult) => boolean
    this.completionPredicate = data.completionPredicate || null;

    // requiredMutationPaths: 该 task 需要修改的文件路径
    this.requiredMutationPaths = new Set(data.requiredMutationPaths || []);

    // 追踪该任务进行的工具调用（用于完成条件检查）
    this.toolCallsHistory = Array.isArray(data.toolCallsHistory) ? [...data.toolCallsHistory] : [];
  }

  /**
   * 检查依赖是否满足
   */
  checkDependencies(taskMap) {
    if (this.dependencies.size === 0) {
      return true;
    }

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
      if (data.result !== undefined) {
        this.result = data.result;
      }
      if (data.error !== undefined) {
        this.error = data.error;
      }
    }

    return { oldStatus, newStatus };
  }

  /**
   * 检查工具调用是否可以推进此 task
   * @param {string} toolName - 工具名称
   * @param {object} args - 工具参数
   * @param {object} result - 工具结果（可选，用于结果敏感谓词）
   * @returns {boolean}
   */
  canBeAdvancedBy(toolName, args, result = null) {
    // 如果定义了 allowedTools，工具必须在列表中
    if (this.allowedTools.length > 0 && !this.allowedTools.includes(toolName)) {
      return false;
    }

    // 如果定义了 completionPredicate，检查是否满足条件（传入完整上下文）
    if (typeof this.completionPredicate === 'function') {
      try {
        return this.completionPredicate({
          toolName,
          args,
          result: result ?? undefined,
          toolCallsHistory: this.toolCallsHistory,
          taskPhase: this.phase,
          taskId: this.id,
        });
      } catch (e) {
        console.error(`Error evaluating completionPredicate for task ${this.id}:`, e);
        return false;
      }
    }

    if (typeof this.completionPredicate === 'string') {
      return this.evaluatePredicateString(this.completionPredicate, {
        toolName,
        success: result?.success !== false && result?.error == null,
      });
    }

    return true;
  }

  /**
   * ✅ 第 9 阶段增强：严格验证任务是否真正完成
   * 基于多维度检查，防止虚假完成：
   * 1. completionPredicate 是否满足
   * 2. requiredToolIntents 是否全部覆盖
   * 3. requiredMutationPaths 是否全部修改
   * 4. 工具调用历史是否足够丰富
   *
   * @param {object} options - 验证选项
   * @param {boolean} options.strictMode - 严格模式：要求所有必须意图都满足
   * @returns {{ completed: boolean, reason: string, missingRequirements: string[] }}
   */
  validateCompletion(options = {}) {
    const { strictMode = true } = options;
    const missingRequirements = [];

    // 1. 检查是否有工具调用历史
    if (this.toolCallsHistory.length === 0) {
      return {
        completed: false,
        reason: 'No tool calls recorded for this task',
        missingRequirements: ['tool_calls'],
      };
    }

    // 2. 检查必需的工具意图是否都满足
    if (strictMode && this.requiredToolIntents.length > 0) {
      const satisfiedIntents = new Set();
      for (const call of this.toolCallsHistory) {
        for (const intent of this.requiredToolIntents) {
          if (Subtask.#toolMatchesIntent(call.toolName, intent)) {
            satisfiedIntents.add(intent);
          }
        }
      }
      const missingIntents = this.requiredToolIntents.filter((i) => !satisfiedIntents.has(i));
      if (missingIntents.length > 0) {
        missingRequirements.push(`missing_intents: ${missingIntents.join(', ')}`);
      }
    }

    // 3. 检查必需的修改路径是否都已覆盖
    if (strictMode && this.requiredMutationPaths.size > 0) {
      const mutatedPaths = new Set();
      for (const call of this.toolCallsHistory) {
        const path = call.args?.path || call.args?.file_path || call.args?.file;
        if (path) {
          mutatedPaths.add(String(path));
        }
      }
      const missingPaths = Array.from(this.requiredMutationPaths).filter(
        (p) => !mutatedPaths.has(p),
      );
      if (missingPaths.length > 0) {
        missingRequirements.push(`missing_mutations: ${missingPaths.join(', ')}`);
      }
    }

    // 4. 使用 completionPredicate 进行最终判定
    const lastCall = this.toolCallsHistory[this.toolCallsHistory.length - 1];
    if (lastCall && this.completionPredicate) {
      const predicateSatisfied = this.canBeAdvancedBy(
        lastCall.toolName,
        lastCall.args,
        lastCall.result,
      );
      if (!predicateSatisfied) {
        missingRequirements.push('completion_predicate_not_satisfied');
      }
    }

    // 判定结果
    const completed = missingRequirements.length === 0;
    return {
      completed,
      reason: completed
        ? 'Task completion validated'
        : `Task not yet complete: ${missingRequirements.join('; ')}`,
      missingRequirements,
    };
  }

  /**
   * 工具是否匹配意图（静态方法，供外部调用）
   */
  static #toolMatchesIntent(toolName, intent) {
    const intentMap = {
      read: ['read_file', 'list_dir', 'glob', 'semantic_search', 'grep_search', 'search_codebase'],
      write: ['write_file', 'edit_file', 'apply_hashline_patch', 'create_file', 'create_directory'],
      execute: ['shell', 'run_in_terminal'],
      search: ['semantic_search', 'grep_search', 'file_search', 'search_codebase'],
      inspect: ['lsp_diagnostics', 'lsp_hover', 'get_errors', 'verify'],
    };

    const tools = intentMap[intent] || [];
    return tools.includes(toolName);
  }

  /**
   * 评估简单的谓词字符串
   * 例如: 'toolName:read_file && success'
   */
  evaluatePredicateString(predicateStr, context) {
    try {
      return predicateStr.split('&&').every((condition) => {
        const [key, value] = condition.trim().split(':');
        if (!key || !value) {
          return true; // 格式错误时默认通过
        }
        const normalizedKey = key.trim();
        const normalizedValue = value.trim();
        return String(context[normalizedKey]) === normalizedValue;
      });
    } catch (e) {
      console.error(`Error evaluating predicate string "${predicateStr}":`, e);
      return false;
    }
  }

  /**
   * 记录工具调用历史
   */
  recordToolCall(toolName, args, result) {
    this.toolCallsHistory.push({
      toolName,
      args,
      result,
      timestamp: Date.now(),
    });
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
    this.status = data.status || TaskStatus.PENDING;

    // 任务图
    this.tasks = new Map(); // taskId -> Subtask
    this.edges = new Map(); // taskId -> Set(dependentIds)

    // 执行状态
    this.createdAt = data.createdAt || Date.now();
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;

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
    return Array.from(this.tasks.values()).filter((task) => {
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
    const ready = this.getReadyTasks().sort((a, b) => b.priority - a.priority); // 按优先级排序

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
            if (dfs(depId)) {
              return true;
            }
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
        if (dfs(taskId)) {
          return true;
        }
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
      tasks: Array.from(this.tasks.values()).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        status: t.status,
        phase: t.phase,
        dependencies: Array.from(t.dependencies),
        priority: t.priority,
        allowedTools: t.allowedTools,
        requiredToolIntents: t.requiredToolIntents,
        requiredMutationPaths: Array.from(t.requiredMutationPaths || []),
        scopeFiles: t.scopeFiles || [],
        metadata: t.metadata || {},
        result: t.result,
        error: t.error,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        toolCallsHistory: Array.isArray(t.toolCallsHistory) ? [...t.toolCallsHistory] : [],
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
      status: json.status,
      createdAt: json.createdAt,
      startedAt: json.startedAt,
      completedAt: json.completedAt,
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
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

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

  // ——— 方法论工具映射（与 agent/constants.js METHODOLOGY_TOOLS 对齐）———
  static #METHODOLOGY_TOOL_HINTS = {
    setup: { phase: 'exploration', hint: '设置项目上下文、初始化环境' },
    coverage_check: { phase: 'exploration', hint: '检查代码覆盖、确认变更范围' },
    ask_user: { phase: 'exploration', hint: '向用户确认缺失的决策信息' },
    brainstorm: { phase: 'planning', hint: '头脑风暴设计方案' },
    grill: { phase: 'planning', hint: '深度质疑需求、澄清不明确的规范' },
    zoom_out: { phase: 'planning', hint: '从全局视角审视跨模块变更影响' },
    architect: { phase: 'planning', hint: '设计架构方案、组件拆分' },
    to_prd: { phase: 'planning', hint: '将需求转为结构化 PRD 文档' },
    to_issues: { phase: 'planning', hint: '将 PRD 分解为具体 issue 列表' },
    tdd: { phase: 'implementation', hint: '先写测试再写实现代码' },
    diagnose: { phase: 'implementation', hint: '诊断遇到的 bug 或问题' },
    review: { phase: 'inspection', hint: '审查变更的代码文件' },
    verify: { phase: 'verification', hint: '运行时验证：执行测试/lint/build 确认正确性' },
    impact_map: {
      phase: 'exploration',
      hint: '绘制影响面/爆炸半径，适合跨模块、迁移、安全、数据、UI 改动',
    },
    project_profile: {
      phase: 'exploration',
      hint: '识别已有项目的配置、包管理器、脚本、测试模块和验证入口',
    },
    risk_check: { phase: 'planning', hint: '显式风险检查，适合高风险或语义敏感改动的前后检查' },
    test_strategy: {
      phase: 'planning',
      hint: '规划测试层级、用例、验证证据，适合 bug、测试、重构、发布',
    },
    migration_plan: { phase: 'planning', hint: '规划迁移/升级/兼容路径和回滚方案' },
    release_checklist: { phase: 'verification', hint: '发布/部署/打包/CI readiness 检查' },
    ui_acceptance: { phase: 'inspection', hint: '定义 UI 验收标准、响应式状态、预览检查' },
    data_contract_check: {
      phase: 'inspection',
      hint: '验证数据契约、schema、query、迁移和下游兼容',
    },
    security_review: {
      phase: 'inspection',
      hint: '安全专项审查：auth、权限、secret、注入、输入边界',
    },
  };

  /** 根据任务名和描述自动推断生命周期阶段 */
  static #inferPhase(taskName, description) {
    const lower = (taskName + ' ' + description).toLowerCase();
    if (/\b(verify|test|validate|confirm|lint|build_check)\b/.test(lower)) return 'verification';
    if (/\b(inspect|review|check|audit|read_back|审[核查]|复查)\b/.test(lower)) return 'inspection';
    if (
      /\b(implement|create|edit|write|fix|add|update|refactor|build|code|修改|实现|创建|編写|修复|重构)\b/.test(
        lower,
      )
    )
      return 'implementation';
    if (/\b(plan|design|architect|brainstorm|grill|zoom_out|approach|方案|设计|规划)\b/.test(lower))
      return 'planning';
    if (
      /\b(inspect|explore|discover|read|gather|analyze|了解|探索|检查|分析|读取|发现)\b/.test(lower)
    )
      return 'exploration';
    // 默认按任务顺序：第一个 → exploration，中间 → implementation，最后一个 → verification
    return null;
  }

  /**
   * 生成子任务（简化版本 — 模板规则）
   */
  #generateSubtasks(description, options) {
    const templates = {
      code_review: [
        { name: 'analyze_code', description: '分析代码结构', dependencies: [] },
        { name: 'check_style', description: '检查代码风格', dependencies: ['analyze_code'] },
        { name: 'find_bugs', description: '查找潜在问题', dependencies: ['analyze_code'] },
        {
          name: 'generate_report',
          description: '在最终回复中总结审查发现；除非用户明确要求，不创建报告文件',
          dependencies: ['check_style', 'find_bugs'],
        },
      ],
      refactor: [
        { name: 'identify_smells', description: '识别代码坏味道', dependencies: [] },
        { name: 'plan_changes', description: '规划重构方案', dependencies: ['identify_smells'] },
        { name: 'apply_refactoring', description: '应用重构', dependencies: ['plan_changes'] },
        {
          name: 'verify_changes',
          description: '验证重构结果',
          dependencies: ['apply_refactoring'],
        },
      ],
    };

    const template = templates[options.template] || templates['code_review'];

    return template.map((t, index) => ({
      id: t.id || t.name,
      name: t.name,
      description: t.description,
      dependencies: t.dependencies,
      priority: options.priority || 0,
      action: options.actions?.[t.name] || null,
    }));
  }

  /**
   * LLM 驱动的智能任务分解
   *
   * 使用 modelProvider 调用 LLM，根据任务描述 + 可用工具/方法论
   * 生成结构化的 DAG 子任务列表。
   *
   * @param {string} taskDescription - 原始任务描述
   * @param {object} modelProvider - 模型提供者 { chat(messages, opts): string|{text} }
   * @param {object} options - { availableTools?, workingDirectory?, taskProfile? }
   * @returns {Array} 子任务列表 [{ name, description, dependencies, methodologyHint? }]
   */
  async decomposeTaskLLM(taskDescription, modelProvider, options = {}) {
    if (!modelProvider || typeof modelProvider.chat !== 'function') {
      // 无 LLM 可用，回退到模板
      return this.#generateSubtasks(taskDescription, options);
    }

    const toolList = options.availableTools || [];
    const toolHint =
      toolList.length > 0
        ? `\n可用工具: ${toolList.join(', ')}`
        : '\n可用工具: read_file, write_file, edit_file, apply_hashline_patch, list_dir, shell, web_search, web_fetch';

    const methodologyHints = Object.entries(GraphPlanner.#METHODOLOGY_TOOL_HINTS)
      .map(([name, { phase, hint }]) => `- ${name} (${phase}): ${hint}`)
      .join('\n');

    // ==== 反馈闭环：消费 ExecutionFeedbackLoop 提供的历史经验 ====
    const feedbackContext = options.feedbackContext || null;
    const feedbackSection = feedbackContext ? this.#buildFeedbackPrompt(feedbackContext) : '';

    // ==== 任务分类结果 ====
    const taskProfile = options.taskProfile || null;
    const taskProfileSection = taskProfile ? this.#buildTaskProfilePrompt(taskProfile) : '';
    const planTypeSection = options.planType
      ? `\n## 推荐 Plan 类型\n- planType: ${options.planType}\n请围绕该 plan 类型设计子任务，不要退化成泛用编码流程。`
      : '';

    const systemPrompt = `你是一个任务规划专家。你的职责是将用户的任务描述分解为结构化的有向无环图(DAG)子任务列表。

## 方法论工具（LLM 可在对应阶段调用）
${methodologyHints}

## Hashline 编辑路径
- apply_hashline_patch: 原子化多文件编辑（含 preflight + LSP-sync + diagnostics-gate），用于跨文件事务性修改
- write_file / edit_file: 单文件直接编辑
- shell: 执行命令、构建、测试
${feedbackSection}
${taskProfileSection}
${planTypeSection}
## 输出格式
严格输出 JSON 数组，每个元素:
{
  "id": "语义化任务ID(snake_case)，例如 inspect_workspace / plan_solution / implement_changes / verify_result，禁止 task_1/task_2",
  "name": "人类可读任务名称",
  "description": "中文任务描述（含建议使用的方法论工具）",
  "dependencies": ["依赖的任务ID", ...],
  "scope_files": ["该子任务涉及的 2-5 个关键文件路径或目录"]
}

## scope_files 规则
- 每个子任务必须指定 scope_files，来限制 Agent 只关注这些文件
- 只写该子任务直接涉及的文件 —— 不要跨子任务预加载文件
- 纯分析子任务（brainstorm/architect/grill），scope_files 可为空数组
- 目录路径用 /dirname/ 表示（如 /src/runtime/），该子任务中只能 list_dir 该目录

## 规划原则
1. 遵循 inspect → plan → implement → verify 的生命周期
2. 编码任务必须包含验证步骤（test/lint/build）
3. 有代码变更的任务，在实现后必须审查+验证
4. 依赖关系必须形成 DAG，不能有环
5. 不确定的需求，规划 ask_user / grill 步骤
6. 跨模块变更，规划 zoom_out / architect 步骤
7. 每个任务描述中明确建议使用哪个方法论工具

## ⚠️ 【关键】任务 ID 规范
**禁止**使用通用 task ID 如 task_1/task_2/task_N！

**必须**使用以下语义化 ID（按优先级）：

### 探索阶段 (exploration)
- \`inspect_readme\` - 阅读项目说明（read_file）
- \`inspect_workspace\` - 查看项目结构（list_dir, glob）
- \`inspect_existing_code\` - 检查现有代码（read_file）
- \`analyze_requirements\` - 分析需求（semantic_search）

### 规划阶段 (planning)
- \`plan_solution\` - 规划实现方案（context_assess）
- \`design_changes\` - 设计改动方案（context_assess）

### 实现阶段 (implementation)
- \`implement_features\` - 实现功能（write_file, edit_file）
- \`implement_changes\` - 实现代码改动（write_file, edit_file）
- \`create_new_files\` - 创建新文件（write_file）
- \`refactor_code\` - 重构代码（edit_file）

### 验证阶段 (verification)
- \`verify_result\` - 验证结果（shell, lsp_diagnostics）
- \`run_tests\` - 运行测试（shell）
- \`check_diagnostics\` - 检查诊断（lsp_diagnostics）
- \`review_changes\` - 审查改动（read_file）`;

    const userPrompt = `请将以下任务分解为执行子任务：

任务描述: ${taskDescription}
${options.workingDirectory ? `工作目录: ${options.workingDirectory}` : ''}
${toolHint}

输出 JSON 数组（仅 JSON，无其他文字）:`;

    try {
      const response = await modelProvider.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens: 1500, temperature: 0.2 },
      );

      const text =
        typeof response === 'string' ? response : response?.text || response?.content || '';
      return this.#parseLLMSubtasks(text, taskDescription, options);
    } catch (err) {
      // LLM 调用失败，回退到模板
      if (this.#config?.debug) {
        console.warn('[GraphPlanner] LLM 分解失败，回退到模板:', err.message);
      }
      return this.#generateSubtasks(taskDescription, options);
    }
  }

  /**
   * 规范化任务 ID，禁止 task_1/task_2，使用语义化 ID
   * 遵循 TASK_TEMPLATE_REGISTRY 中的定义
   */
  static #normalizeTaskId(rawId, description = '', index = 0) {
    const id = String(rawId || '')
      .trim()
      .toLowerCase();
    const text = `${id} ${description}`.toLowerCase();

    // 第 1 步：如果已经是模板中的有效 ID，直接返回
    if (TASK_TEMPLATE_REGISTRY[id]) {
      return id;
    }

    // 第 2 步：如果不是 task_N 格式，进行标准化处理
    if (!/^task_\d+$/.test(id)) {
      const normalized = id
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      // 检查是否匹配模板
      if (TASK_TEMPLATE_REGISTRY[normalized]) {
        return normalized;
      }

      return normalized;
    }

    // 第 3 步：task_1/task_2 转换为语义化 ID
    // 通过关键词匹配来选择最接近的语义化 ID

    // 探索阶段关键词 → 对应任务
    if (/readme|说明|文档|description/.test(text)) return 'inspect_readme';
    if (/dir|structure|目录|项目结构|查看|list/.test(text)) return 'inspect_workspace';
    if (/exist|code|源代码|读取|existing/.test(text)) return 'inspect_existing_code';
    if (/require|analysis|分析|需求|requirement/.test(text)) return 'analyze_requirements';

    // 规划阶段关键词
    if (/plan|design|方案|规划|设计|architecture/.test(text)) return 'plan_solution';
    if (/design|改动|change/.test(text)) return 'design_changes';

    // 实现阶段关键词
    if (/implement|edit|write|fix|修改|实现|修复|coding|code/.test(text)) {
      // 进一步细分
      if (/create|new|创建/.test(text)) return 'create_new_files';
      if (/refactor|重构/.test(text)) return 'refactor_code';
      return 'implement_changes';
    }

    // 验证阶段关键词
    if (/verify|test|lint|build|验证|测试|诊断|diagnostic/.test(text)) {
      if (/test|测试/.test(text)) return 'run_tests';
      if (/diagnostic|diagnostics|诊断/.test(text)) return 'check_diagnostics';
      if (/review|审查|复查/.test(text)) return 'review_changes';
      return 'verify_result';
    }

    // 兜底：按索引分配默认任务
    const defaultSequence = [
      'inspect_readme',
      'inspect_workspace',
      'analyze_requirements',
      'plan_solution',
      'implement_changes',
      'verify_result',
    ];

    return defaultSequence[index % defaultSequence.length];
  }

  /**
   * 解析 LLM 返回的子任务 JSON，并应用任务模板
   */
  #parseLLMSubtasks(text, fallbackDescription, options) {
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('未找到 JSON 数组');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('解析结果不是有效数组');
      }

      const validTaskIds = new Set();
      const subtasks = parsed.map((item, index) => {
        const rawId = item.id || item.name || `task_${index + 1}`;
        const id = GraphPlanner.#normalizeTaskId(rawId, item.description, index);
        validTaskIds.add(id);

        const phase = item.phase || GraphPlanner.#inferPhase(id, item.description || '');

        // ✅ 第 2 阶段改进：应用任务模板
        const template = TASK_TEMPLATE_REGISTRY[id];

        return {
          id,
          name: template?.semanticName || (item.name && item.name !== rawId ? item.name : id),
          description: item.description || template?.description || `子任务 ${index + 1}`,
          dependencies: (item.dependencies || []).filter((dep) => {
            return true;
          }),
          priority: template?.priority || options.priority || 0,
          scopeFiles: Array.isArray(item.scope_files) ? item.scope_files : [],
          phase: template?.phase || phase,

          // ✅ 应用模板中的执行约束
          allowedTools: template?.allowedTools || [],
          requiredToolIntents: template?.requiredToolIntents || [],
          completionPredicate: template?.completionPredicate || null,
          requiresMutation: template?.requiresMutation || false,
          methodologyHint: template?.methodologyHint || null,
        };
      });

      for (const task of subtasks) {
        task.dependencies = task.dependencies.filter((dep) => validTaskIds.has(dep));
      }

      const hasVerification = subtasks.some(
        (t) =>
          t.name.toLowerCase().includes('verify') ||
          t.name.toLowerCase().includes('test') ||
          t.description.toLowerCase().includes('验证') ||
          t.description.toLowerCase().includes('测试'),
      );
      if (!hasVerification) {
        const lastId = subtasks[subtasks.length - 1]?.id;
        subtasks.push({
          id: 'verify_result',
          name: '验证结果',
          description: '验证最终结果：运行测试 / lint / build 确认所有变更正确',
          dependencies: lastId ? [lastId] : [],
          priority: options.priority || 0,
        });
      }

      return subtasks;
    } catch (parseErr) {
      if (this.#config?.debug) {
        console.warn('[GraphPlanner] LLM 响应解析失败，回退到模板:', parseErr.message);
      }
      return this.#generateSubtasks(fallbackDescription, options);
    }
  }

  /**
   * 从 ExecutionFeedbackLoop 提供的反馈上下文构建经验提示文本。
   * 注入到 decomposeTaskLLM 的 system prompt 中，让 LLM 借鉴历史成功/失败模式。
   */
  #buildFeedbackPrompt(feedbackContext) {
    const lines = ['\n## 历史执行反馈（借鉴以往经验）'];

    // 最近成功的执行模式
    const recentResults = feedbackContext.recentResults || [];
    if (recentResults.length > 0) {
      lines.push('\n### 最近成功的执行模式');
      for (const r of recentResults.slice(-3)) {
        lines.push(
          `- ${r.decompositionMode === 'llm' ? 'LLM分解' : '模板分解'} | 历时 ${(r.durationMs / 1000).toFixed(1)}s | 迭代 ${r.iterations} 次 | 完成阶段: ${(r.phasesCompleted || []).join(' → ')}`,
        );
      }
    }

    // LLM 分解 vs 模板效率对比
    const advice = feedbackContext.llmDecompositionAdvice;
    if (advice) {
      lines.push('\n### 分解模式效果对比');
      lines.push(
        `- LLM智能分解成功率: ${(advice.llmSuccessRate * 100).toFixed(0)}% | 平均迭代: ${advice.llmAvgIterations.toFixed(1)}`,
      );
      lines.push(
        `- 模板分解成功率: ${(advice.templateSuccessRate * 100).toFixed(0)}% | 平均迭代: ${advice.templateAvgIterations.toFixed(1)}`,
      );
      lines.push(`- 建议: ${advice.recommendation}`);
    }

    // 如果 LLM 分解表现不佳，提示简化
    if (advice && advice.llmSuccessRate < 0.4 && advice.templateSuccessRate > 0.6) {
      lines.push(
        '\n⚠️ 注意: LLM智能分解在该任务类型上成功率偏低，建议采用更简洁的 4-5 步子任务分解，避免过度复杂化。',
      );
    }

    lines.push('\n请结合以上历史反馈优化本次分解策略，但不要生搬硬套 —— 每个任务都有其特殊性。');

    return lines.join('\n');
  }

  /**
   * 从任务分类结果构建提示文本。
   * 注入到 decomposeTaskLLM 的 system prompt 中，让 LLM 根据任务类型调整分解策略。
   */
  #buildTaskProfilePrompt(taskProfile) {
    const lines = ['\n## 任务分类结果（用于调整分解策略）'];

    if (taskProfile.isCodingTask) {
      lines.push('- 任务类型: 编码任务');
    }
    if (taskProfile.isModificationTask) {
      lines.push('- 任务类型: 修改任务（需要代码变更）');
    }
    if (taskProfile.isBugTask) {
      lines.push('- 任务类型: Bug修复任务');
      lines.push('  → 建议分解步骤: 复现问题 → 定位根因 → 编写修复 → 验证修复 → 编写测试');
    }
    if (taskProfile.isDocumentationTask) {
      lines.push('- 任务类型: 文档任务');
      lines.push('  → 建议分解步骤: 收集信息 → 组织内容 → 编写文档 → 审查文档');
    }

    if (taskProfile.riskLevel) {
      lines.push(`- 风险等级: ${taskProfile.riskLevel}`);
      if (taskProfile.riskLevel === 'high') {
        lines.push('  → 高风险任务: 建议增加验证步骤，每个关键变更后都进行测试');
      }
    }

    if (taskProfile.requiresSemanticRiskReview) {
      lines.push('- 需要语义风险审查');
      lines.push('  → 建议在实现后添加 API/语义风险审查步骤');
    }

    if (taskProfile.planType) {
      lines.push(`- 推荐 Plan 类型: ${taskProfile.planType}`);
    }

    if (taskProfile.planSelection?.ranked?.length) {
      const top = taskProfile.planSelection.ranked
        .slice(0, 3)
        .map((item) => `${item.type}:${item.score}`)
        .join(', ');
      lines.push(`- Plan 类型候选评分: ${top}`);
    }

    if (taskProfile.taskSignals) {
      const activeSignals = Object.entries(taskProfile.taskSignals)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
      if (activeSignals.length > 0) {
        lines.push(`- 检测到任务信号: ${activeSignals.join(', ')}`);
      }
    }

    if (taskProfile.semanticRiskDomains && taskProfile.semanticRiskDomains.length > 0) {
      lines.push(
        `- 语义风险领域: ${taskProfile.semanticRiskDomains.map((d) => d.label).join(', ')}`,
      );
    }

    lines.push('\n请根据以上任务分类结果调整分解策略，确保子任务覆盖所有必要阶段。');

    return lines.join('\n');
  }

  /**
   * 执行计划
   */
  async executePlan(planId, executor) {
    const plan = this.#plans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

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
        const promises = level.map((task) => this.#executeTask(plan, task, executor));
        const results = await Promise.allSettled(promises);

        // 检查是否有失败
        const failures = results.filter((r) => r.status === 'rejected');
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
        if (completed.has(task.id)) {
          continue;
        }

        // 检查所有依赖是否已完成
        const depsCompleted = Array.from(task.dependencies).every((depId) => completed.has(depId));

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
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

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
    if (!plan) {
      return false;
    }

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
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const lines = ['graph TD'];

    // 添加节点
    for (const [id, task] of plan.tasks) {
      const statusEmoji =
        {
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

/**
 * Plan 执行控制器
 *
 * 核心职责：
 * - 管理当前可执行的任务（runnable task）
 * - 根据工具调用结果推进任务状态
 * - 检测任务完成条件
 * - 强制推进卡顿的任务
 */
export class PlanExecutor extends EventEmitter {
  #plan = null;
  #currentRunnableTaskId = null;
  #taskStartTime = null;
  #taskToolCallCount = 0;
  #config = {};

  constructor(plan, config = {}) {
    super();
    this.#plan = plan;
    this.#config = {
      taskTimeoutMs: config.taskTimeoutMs || 120000,
      maxToolCallsPerTask: config.maxToolCallsPerTask || 20,
      ...config,
    };

    // 初始化计划的第一个可运行任务
    this.#selectNextRunnableTask();
  }

  /**
   * 获取当前可执行任务
   */
  getCurrentRunnableTask() {
    if (!this.#currentRunnableTaskId) {
      return null;
    }
    return this.#plan.getTask(this.#currentRunnableTaskId);
  }

  /**
   * 获取当前任务允许的工具列表
   */
  getCurrentAllowedTools() {
    const task = this.getCurrentRunnableTask();
    if (!task || task.allowedTools.length === 0) {
      return null; // null 表示没有约束，使用全局工具选择逻辑
    }
    return task.allowedTools;
  }

  /**
   * 执行任务 - 处理工具调用结果并更新任务状态
   * ✅ 第 9 阶段增强：
   * - 使用 validateCompletion() 进行多维度验证
   * - 检测虚假完成（工具调用不满足完成谓词但被标记为完成）
   * - 支持回滚错误完成的任务状态
   */
  async executeTask(taskId, toolCall, result) {
    const task = this.#plan.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in plan`);
    }

    // 记录工具调用
    task.recordToolCall(toolCall.name, toolCall.args, result);
    this.#taskToolCallCount++;

    // ✅ 第 9 阶段：先计算验证结果（用于 stall 原因）
    const validation = task.validateCompletion({ strictMode: true });

    // 即使工具不被允许或谓词不匹配，也要检测是否卡顿
    if (this.#taskToolCallCount >= this.#config.maxToolCallsPerTask) {
      this.emit('task:stalled', {
        taskId,
        taskName: task.name,
        toolCallCount: this.#taskToolCallCount,
        maxToolCalls: this.#config.maxToolCallsPerTask,
        missingRequirements: validation.missingRequirements,
        reason: `Task stalled: ${validation.reason}`,
      });
    }

    // 检查工具调用是否允许
    if (!task.canBeAdvancedBy(toolCall.name, toolCall.args, result)) {
      this.emit('task:tool-not-allowed', {
        taskId,
        toolName: toolCall.name,
        allowedTools: task.allowedTools,
        reason: 'tool_not_in_allowed_list_or_predicate_not_matched',
      });
      return false;
    }

    if (validation.completed) {
      // 所有完成条件满足，正式标记为 COMPLETED
      task.updateStatus(TaskStatus.COMPLETED, {
        result,
        validationReason: validation.reason,
        validatedAt: Date.now(),
      });
      this.emit('task:completed', {
        taskId,
        taskName: task.name,
        toolCallCount: this.#taskToolCallCount,
        validationReason: validation.reason,
      });

      // 推进到下一个可执行任务
      this.#selectNextRunnableTask();
      return true;
    }

    // 完成条件不满足，继续运行该任务
    if (task.status !== TaskStatus.RUNNING) {
      task.updateStatus(TaskStatus.RUNNING);
      this.#taskStartTime = Date.now();
    }

    return false; // 任务尚未完成
  }

  /**
   * 工具是否匹配意图
   */
  #toolMatchesIntent(toolName, intent) {
    const intentMap = {
      read: ['read_file', 'list_dir', 'glob', 'semantic_search', 'grep_search'],
      write: ['write_file', 'edit_file', 'apply_hashline_patch', 'create_file', 'create_directory'],
      execute: ['shell', 'run_in_terminal'],
      search: ['semantic_search', 'grep_search', 'file_search'],
      inspect: ['lsp_diagnostics', 'lsp_hover', 'get_errors'],
    };

    const tools = intentMap[intent] || [];
    return tools.includes(toolName);
  }

  /**
   * 选择下一个可运行的任务
   */
  #selectNextRunnableTask() {
    if (!this.#plan) {
      this.#currentRunnableTaskId = null;
      return;
    }

    const activeTask = Array.from(this.#plan.tasks.values()).find(
      (task) =>
        (task.status === TaskStatus.RUNNING || task.status === TaskStatus.READY) &&
        task.checkDependencies(this.#plan.tasks),
    );
    if (activeTask) {
      this.#currentRunnableTaskId = activeTask.id;
      this.#taskToolCallCount = activeTask.toolCallsHistory.length;
      this.#taskStartTime = activeTask.startedAt || Date.now();
      return;
    }

    // 获取所有就绪的任务
    const readyTasks = this.#plan.getReadyTasks();
    if (readyTasks.length === 0) {
      // 检查是否所有任务都完成了
      const allCompleted = Array.from(this.#plan.tasks.values()).every(
        (t) => t.status === TaskStatus.COMPLETED || t.status === TaskStatus.SKIPPED,
      );

      if (allCompleted) {
        this.emit('plan:completed', {
          planId: this.#plan.id,
          taskCount: this.#plan.tasks.size,
        });
      }

      this.#currentRunnableTaskId = null;
      return;
    }

    // 按优先级和拓扑顺序选择第一个就绪任务
    const selected = readyTasks.sort((a, b) => {
      // 优先级高的优先
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // 优先级相同时，按添加顺序（ID）
      return a.id.localeCompare(b.id);
    })[0];

    this.#currentRunnableTaskId = selected.id;
    selected.updateStatus(TaskStatus.READY);

    this.#taskToolCallCount = 0;
    this.#taskStartTime = Date.now();

    this.emit('task:selected', {
      taskId: selected.id,
      taskName: selected.name,
      allowedTools: selected.allowedTools,
    });
  }

  /**
   * 检查当前任务是否超时
   */
  isCurrentTaskTimeout() {
    if (!this.#taskStartTime) {
      return false;
    }
    return Date.now() - this.#taskStartTime > this.#config.taskTimeoutMs;
  }

  /**
   * 检查当前任务是否超过最大工具调用次数
   */
  hasExceededMaxToolCalls() {
    return this.#taskToolCallCount >= this.#config.maxToolCallsPerTask;
  }

  /**
   * 强制标记当前任务为完成（用于熔断）
   */
  forceCompleteCurrentTask(reason = 'forced') {
    const task = this.getCurrentRunnableTask();
    if (!task) {
      return false;
    }

    task.updateStatus(TaskStatus.COMPLETED, {
      result: { forced: true, reason },
    });

    this.emit('task:forced-complete', {
      taskId: task.id,
      taskName: task.name,
      reason,
    });

    this.#selectNextRunnableTask();
    return true;
  }

  /**
   * 强制将当前任务标记为失败
   */
  forceFailCurrentTask(reason = 'forced failure') {
    const task = this.getCurrentRunnableTask();
    if (!task) {
      return false;
    }

    task.updateStatus(TaskStatus.FAILED, {
      error: reason,
    });

    this.emit('task:forced-failed', {
      taskId: task.id,
      taskName: task.name,
      reason,
    });

    // 不继续，让 plan 停止
    this.#currentRunnableTaskId = null;
    return true;
  }

  /**
   * 获取计划执行进度
   */
  getProgress() {
    const completed = Array.from(this.#plan.tasks.values()).filter(
      (t) => t.status === TaskStatus.COMPLETED,
    ).length;
    const total = this.#plan.tasks.size;

    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      currentTask: this.getCurrentRunnableTask(),
    };
  }

  /**
   * 获取计划状态快照
   */
  getStatusSnapshot() {
    return {
      planId: this.#plan.id,
      planName: this.#plan.name,
      currentTaskId: this.#currentRunnableTaskId,
      tasks: Array.from(this.#plan.tasks.values()).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        allowedTools: t.allowedTools,
        phase: t.phase,
        toolCallCount: t.toolCallsHistory.length,
      })),
      progress: this.getProgress(),
    };
  }
}

export default GraphPlanner;
