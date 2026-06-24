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
 * 子任务节点
 */
export class Subtask {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.name = data.name;
    this.description = data.description || '';
    this.status = TaskStatus.PENDING;

    // 依赖关系
    this.dependencies = new Set(data.dependencies || []); // 依赖的任务ID
    this.dependents = new Set(); // 依赖此任务的任务ID

    // 执行配置
    this.action = data.action; // 执行函数或配置
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
    // 文件作用域（渐进式探索：该子任务允许关注的文件/目录）
    this.scopeFiles = Array.isArray(data.scopeFiles) ? data.scopeFiles : [];
    // 生命周期阶段：exploration | planning | implementation | inspection | verification
    this.phase = data.phase || null;
    this.priority = data.priority || 0; // 优先级，数字越大优先级越高
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
    this.tasks = new Map(); // taskId -> Subtask
    this.edges = new Map(); // taskId -> Set(dependentIds)

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
        dependencies: Array.from(t.dependencies),
        priority: t.priority,
        scopeFiles: t.scopeFiles || [],
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
          description: '生成审查报告',
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

    const systemPrompt = `你是一个任务规划专家。你的职责是将用户的任务描述分解为结构化的有向无环图(DAG)子任务列表。

## 方法论工具（LLM 可在对应阶段调用）
${methodologyHints}

## Hashline 编辑路径
- apply_hashline_patch: 原子化多文件编辑（含 preflight + LSP-sync + diagnostics-gate），用于跨文件事务性修改
- write_file / edit_file: 单文件直接编辑
- shell: 执行命令、构建、测试
${feedbackSection}
${taskProfileSection}
## 输出格式
严格输出 JSON 数组，每个元素:
{
  "name": "唯一任务ID(snake_case)",
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
7. 每个任务描述中明确建议使用哪个方法论工具`;

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
   * 解析 LLM 返回的子任务 JSON
   */
  #parseLLMSubtasks(text, fallbackDescription, options) {
    try {
      // 尝试提取 JSON 数组
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('未找到 JSON 数组');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('解析结果不是有效数组');
      }

      // 验证并规范化每个子任务
      const validTaskIds = new Set();
      const subtasks = parsed.map((item, index) => {
        const id = item.name || item.id || `task_${index + 1}`;
        validTaskIds.add(id);

        // 自动推断生命周期阶段
        const phase = item.phase || GraphPlanner.#inferPhase(id, item.description || '');

        return {
          name: id,
          description: item.description || `子任务 ${index + 1}`,
          dependencies: (item.dependencies || []).filter((dep) => {
            // 过滤不存在的依赖（稍后会验证）
            return true;
          }),
          priority: options.priority || 0,
          scopeFiles: Array.isArray(item.scope_files) ? item.scope_files : [],
          phase,
        };
      });

      // 验证依赖引用的任务 ID 存在
      for (const task of subtasks) {
        task.dependencies = task.dependencies.filter((dep) => validTaskIds.has(dep));
      }

      // 如果没有验证步骤，自动附加一个
      const hasVerification = subtasks.some(
        (t) =>
          t.name.toLowerCase().includes('verify') ||
          t.name.toLowerCase().includes('test') ||
          t.description.toLowerCase().includes('验证') ||
          t.description.toLowerCase().includes('测试'),
      );
      if (!hasVerification) {
        const lastId = subtasks[subtasks.length - 1]?.name;
        subtasks.push({
          name: 'verify_result',
          description: '验证最终结果：运行测试 / lint / build 确认所有变更正确',
          dependencies: lastId ? [lastId] : [],
          priority: options.priority || 0,
        });
      }

      return subtasks;
    } catch (parseErr) {
      // 解析失败，回退到模板
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

export default GraphPlanner;
