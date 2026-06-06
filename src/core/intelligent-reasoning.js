/**
 * Intelligent Reasoning Engine
 * 智能推理引擎 - 增强 Agent 的决策和推理能力
 * 
 * 功能：
 * - 任务意图分析
 * - 工具选择优化
 * - 执行策略决策
 * - 结果评估
 */

export class IntelligentReasoning {
  #modelProvider;
  #toolRegistry;
  #experienceMemory;
  #config;

  constructor(options = {}) {
    this.#modelProvider = options.modelProvider;
    this.#toolRegistry = options.toolRegistry;
    this.#experienceMemory = options.experienceMemory;
    this.#config = {
      maxCandidates: 5,
      confidenceThreshold: 0.7,
      ...options.config,
    };
  }

  /**
   * 分析用户意图
   * @param {string} userInput - 用户输入
   * @returns {Promise<object>} 意图分析结果
   */
  async analyzeIntent(userInput) {
    const lower = userInput.toLowerCase();
    
    // 意图分类
    const intents = {
      isQuestion: /^(what|how|why|when|where|who|which|can|is|are|do|does|什么|怎么|为什么|何时|哪里|谁|哪个|是否)/i.test(userInput),
      isAction: /^(create|write|delete|update|run|execute|start|stop|build|deploy|创建|写入|删除|更新|运行|执行|启动|停止|构建|部署)/i.test(userInput),
      isSearch: /^(find|search|look|grep|list|show|get|查找|搜索|列出|显示|获取)/i.test(userInput),
      isAnalysis: /^(analyze|review|check|verify|diagnose|explain|分析|审查|检查|验证|诊断|解释)/i.test(userInput),
      isGit: /^(git|commit|push|pull|branch|merge|stash)/i.test(lower) || lower.includes('git'),
      isFileSystem: /^(read|write|edit|file|dir|path|读取|写入|编辑|文件|目录)/i.test(userInput),
      isSchedule: /^(schedule|cron|timer|定时|调度|计划)/i.test(lower),
      isSubAgent: /^(subagent|delegate|spawn|子代理|委托)/i.test(lower),
    };

    // 确定主要意图
    const primaryIntent = Object.entries(intents)
      .filter(([k, v]) => v && k.startsWith('is'))
      .sort((a, b) => {
        const priority = { isAction: 1, isGit: 2, isFileSystem: 3, isSearch: 4, isAnalysis: 5, isQuestion: 6, isSchedule: 7, isSubAgent: 8 };
        return (priority[a[0]] || 99) - (priority[b[0]] || 99);
      })[0];

    return {
      intents,
      primary: primaryIntent ? primaryIntent[0] : 'general',
      confidence: primaryIntent ? 0.8 : 0.5,
      keywords: this.#extractKeywords(userInput),
    };
  }

  /**
   * 选择最佳工具
   * @param {string} userInput - 用户输入
   * @param {object} intent - 意图分析
   * @returns {Promise<Array<object>>} 推荐工具列表
   */
  async selectTools(userInput, intent) {
    const allTools = this.#toolRegistry.getAll();
    const scored = [];

    for (const tool of allTools) {
      const score = this.#scoreToolForIntent(tool, intent, userInput);
      if (score > 0) {
        scored.push({ tool, score });
      }
    }

    // 排序并返回 top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.#config.maxCandidates).map(s => ({
      name: s.tool.name,
      description: s.tool.description,
      score: s.score,
      confidence: s.score / 10,
    }));
  }

  /**
   * 为工具评分
   */
  #scoreToolForIntent(tool, intent, userInput) {
    let score = 0;
    const name = tool.name.toLowerCase();
    const desc = (tool.description || '').toLowerCase();
    const input = userInput.toLowerCase();

    // 意图匹配
    if (intent.primary === 'isGit' && name.startsWith('git_')) {score += 5;}
    if (intent.primary === 'isFileSystem' && (name.includes('file') || name.includes('dir'))) {score += 4;}
    if (intent.primary === 'isSearch' && (name.includes('search') || name.includes('find') || name.includes('list'))) {score += 4;}
    if (intent.primary === 'isAnalysis' && (name.includes('analyze') || name.includes('review') || name.includes('diagnose'))) {score += 4;}
    if (intent.primary === 'isSchedule' && (name.includes('schedule') || name.includes('cron'))) {score += 5;}
    if (intent.primary === 'isSubAgent' && name.includes('subagent')) {score += 5;}

    // 关键词匹配
    for (const kw of intent.keywords) {
      if (name.includes(kw)) {score += 2;}
      if (desc.includes(kw)) {score += 1;}
    }

    // 技能工具特殊处理
    if (tool.category && tool.category.includes('skill')) {
      if (input.includes('brainstorm') && name === 'brainstorm') {score += 5;}
      if (input.includes('review') && name === 'review') {score += 5;}
      if (input.includes('tdd') && name === 'tdd') {score += 5;}
      if (input.includes('architect') && name === 'architect') {score += 5;}
      if (input.includes('diagnose') && name === 'diagnose') {score += 5;}
    }

    return score;
  }

  /**
   * 提取关键词
   */
  #extractKeywords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', '的', '是', '在', '有', '和', '与', '或', '不', '了', '这', '那', '个', '些', '到', '对', '为', '就', '也', '都', '会', '能', '要', '让', '把', '给', '从', '向', '上', '下', '里', '外', '前', '后', '左', '右']);
    
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter(w => w.length > 2 && !stopWords.has(w))
      .slice(0, 10);
  }

  /**
   * 分解复杂任务
   * @param {string} task - 任务描述
   * @returns {Promise<Array<object>>} 子任务列表
   */
  async decomposeTask(task) {
    // 简单任务分解启发式
    const subtasks = [];
    
    // 检测多步骤任务
    const steps = task.split(/\s*(?:then|after that|next|and then|之后|然后|接着)\s*/i);
    if (steps.length > 1) {
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].trim()) {
          subtasks.push({
            id: `sub_${i + 1}`,
            description: steps[i].trim(),
            order: i + 1,
            dependencies: i > 0 ? [`sub_${i}`] : [],
          });
        }
      }
    }

    // 检测并列任务
    const parallels = task.split(/\s*(?:and|also|as well as|同时|并且)\s*/i);
    if (parallels.length > 1 && subtasks.length === 0) {
      for (let i = 0; i < parallels.length; i++) {
        if (parallels[i].trim()) {
          subtasks.push({
            id: `par_${i + 1}`,
            description: parallels[i].trim(),
            order: i + 1,
            dependencies: [],
            parallel: true,
          });
        }
      }
    }

    // 如果没有分解，返回原任务
    if (subtasks.length === 0) {
      subtasks.push({
        id: 'main',
        description: task,
        order: 1,
        dependencies: [],
      });
    }

    return subtasks;
  }

  /**
   * 评估执行结果
   * @param {string} task - 原始任务
   * @param {any} result - 执行结果
   * @returns {Promise<object>} 评估结果
   */
  async evaluateResult(task, result) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    
    // 基本评估
    const evaluation = {
      success: true,
      completeness: 1.0,
      quality: 'good',
      issues: [],
      suggestions: [],
    };

    // 检查错误
    if (resultStr.toLowerCase().includes('error') || resultStr.toLowerCase().includes('failed')) {
      evaluation.success = false;
      evaluation.issues.push('Execution reported error');
    }

    // 检查空结果
    if (!resultStr || resultStr.trim().length === 0) {
      evaluation.completeness = 0.0;
      evaluation.issues.push('Empty result');
    }

    // 检查截断
    if (resultStr.includes('[truncated]')) {
      evaluation.completeness = 0.8;
      evaluation.issues.push('Result was truncated');
    }

    // 从经验记忆中学习
    if (this.#experienceMemory) {
      const relevant = this.#experienceMemory.recall(task);
      if (relevant.length > 0) {
        for (const exp of relevant.slice(0, 2)) {
          if (exp.outcome === 'failure') {
            evaluation.suggestions.push(`Past experience: ${exp.lesson}`);
          }
        }
      }
    }

    // 确定质量等级
    if (evaluation.issues.length === 0) {
      evaluation.quality = 'excellent';
    } else if (evaluation.issues.length === 1) {
      evaluation.quality = 'good';
    } else if (evaluation.issues.length === 2) {
      evaluation.quality = 'acceptable';
    } else {
      evaluation.quality = 'poor';
    }

    return evaluation;
  }

  /**
   * 生成执行策略
   * @param {string} task - 任务
   * @param {Array<object>} tools - 推荐工具
   * @returns {object} 执行策略
   */
  generateStrategy(task, tools) {
    if (tools.length === 0) {
      return {
        type: 'direct',
        reasoning: 'No specific tools recommended, will use general reasoning',
      };
    }

    const topTool = tools[0];
    
    if (topTool.confidence >= 0.8) {
      return {
        type: 'single_tool',
        tool: topTool.name,
        reasoning: `High confidence (${topTool.confidence.toFixed(2)}) in ${topTool.name}`,
      };
    }

    if (tools.length >= 2 && tools[1].confidence >= 0.5) {
      return {
        type: 'tool_chain',
        tools: tools.slice(0, 2).map(t => t.name),
        reasoning: `Multiple relevant tools, will try in sequence`,
      };
    }

    return {
      type: 'exploratory',
      tools: tools.map(t => t.name),
      reasoning: 'Will explore with available tools',
    };
  }
}

export default IntelligentReasoning;
