/**
 * Intelligent Reasoning Engine
 * 智能推理引擎 - 增强 Agent 的决策和推理能力
 *
 * 重构后：delegate 模式，不再重复实现 IntentClassifier / tool-router
 * 保留的独特功能：
 *   - decomposeTask: 任务分解
 *   - evaluateResult: 结果评估
 */

export class IntelligentReasoning {
  #intentClassifier;
  #toolRegistry;
  #experienceMemory;
  #config;

  constructor(options = {}) {
    this.#intentClassifier = options.intentClassifier || null;
    this.#toolRegistry = options.toolRegistry;
    this.#experienceMemory = options.experienceMemory;
    this.#config = {
      maxCandidates: 5,
      confidenceThreshold: 0.7,
      ...options.config,
    };
  }

  /**
   * 分析用户意图 — 委托给 IntentClassifier
   */
  async analyzeIntent(userInput) {
    if (this.#intentClassifier) {
      const intent = await this.#intentClassifier.classify(userInput);
      if (intent) {
        return {
          intents: {
            isAction: intent.requiresCodeModification || false,
            isSearch: intent.requiresFreshData || false,
            isAnalysis: intent.intent === 'coding_task' || intent.intent === 'local_file_task',
            isGit: intent.intent === 'git_task',
            isFileSystem: intent.intent === 'local_file_task' || intent.intent === 'coding_task',
            isSchedule: intent.intent === 'schedule_task',
            isQuestion: intent.intent === 'explanation' || intent.intent === 'general_chat',
          },
          primary: this.#mapIntentToPrimary(intent),
          confidence: intent.confidence,
          keywords: this.#extractKeywords(userInput),
          _raw: intent,
        };
      }
    }

    // Fallback: regex-based (原逻辑)
    return this.#fallbackAnalyzeIntent(userInput);
  }

  /**
   * 选择最佳工具 — 委托给 IntentClassifier + tool-router
   */
  async selectTools(userInput, intent) {
    const allTools = this.#toolRegistry?.getAll?.() || [];

    // 如果有 IntentClassifier 的原始结果，用 tool-router 的 selectToolsForRequest
    if (intent?._raw && this.#intentClassifier) {
      const { selectToolsForRequest } = await import('./tool-router.js');
      const taskProfile = this.#intentClassifier.classifyTask?.(userInput, intent._raw);
      const selected = selectToolsForRequest(allTools, {
        userInput,
        taskProfile,
        intent: intent._raw,
      });
      return selected.map((t) => ({
        name: t.name,
        description: t.description,
        score: 8,
        confidence: 0.8,
      }));
    }

    // Fallback: 简单关键词匹配
    return this.#fallbackSelectTools(userInput, allTools);
  }

  /**
   * 分解复杂任务 — 独特功能，保留
   */
  async decomposeTask(task) {
    const subtasks = [];

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
   * 评估执行结果 — 独特功能，保留
   */
  async evaluateResult(task, result) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

    const evaluation = {
      success: true,
      completeness: 1.0,
      quality: 'good',
      issues: [],
      suggestions: [],
    };

    if (resultStr.toLowerCase().includes('error') || resultStr.toLowerCase().includes('failed')) {
      evaluation.success = false;
      evaluation.issues.push('Execution reported error');
    }

    if (!resultStr || resultStr.trim().length === 0) {
      evaluation.completeness = 0.0;
      evaluation.issues.push('Empty result');
    }

    if (resultStr.includes('[truncated]')) {
      evaluation.completeness = 0.8;
      evaluation.issues.push('Result was truncated');
    }

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
   * 生成执行策略 — 简化版
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
        tools: tools.slice(0, 2).map((t) => t.name),
        reasoning: 'Multiple relevant tools, will try in sequence',
      };
    }

    return {
      type: 'exploratory',
      tools: tools.map((t) => t.name),
      reasoning: 'Will explore with available tools',
    };
  }

  // ============================================================
  // Private helpers
  // ============================================================

  #mapIntentToPrimary(intent) {
    const map = {
      coding_task: 'isAction',
      local_file_task: 'isFileSystem',
      git_task: 'isGit',
      terminal_task: 'isFileSystem',
      schedule_task: 'isSchedule',
      web_research: 'isSearch',
      weather_query: 'isSearch',
      explanation: 'isQuestion',
      general_chat: 'isQuestion',
    };
    return map[intent.intent] || 'general';
  }

  #fallbackAnalyzeIntent(userInput) {
    const lower = userInput.toLowerCase();
    const intents = {
      isQuestion:
        /^(what|how|why|when|where|who|which|can|is|are|do|does|什么|怎么|为什么|何时|哪里|谁|哪个|是否)/i.test(
          userInput,
        ),
      isAction:
        /^(create|write|delete|update|run|execute|start|stop|build|deploy|创建|写入|删除|更新|运行|执行|启动|停止|构建|部署)/i.test(
          userInput,
        ),
      isSearch: /^(find|search|look|grep|list|show|get|查找|搜索|列出|显示|获取)/i.test(userInput),
      isAnalysis:
        /^(analyze|review|check|verify|diagnose|explain|分析|审查|检查|验证|诊断|解释)/i.test(
          userInput,
        ),
      isGit: /^(git|commit|push|pull|branch|merge|stash)/i.test(lower) || lower.includes('git'),
      isFileSystem: /^(read|write|edit|file|dir|path|读取|写入|编辑|文件|目录)/i.test(userInput),
      isSchedule: /^(schedule|cron|timer|定时|调度|计划)/i.test(lower),
      isSubAgent: /^(subagent|delegate|spawn|子代理|委托)/i.test(lower),
    };

    const primaryIntent = Object.entries(intents)
      .filter(([k, v]) => v && k.startsWith('is'))
      .sort((a, b) => {
        const priority = {
          isAction: 1,
          isGit: 2,
          isFileSystem: 3,
          isSearch: 4,
          isAnalysis: 5,
          isQuestion: 6,
          isSchedule: 7,
          isSubAgent: 8,
        };
        return (priority[a[0]] || 99) - (priority[b[0]] || 99);
      })[0];

    return {
      intents,
      primary: primaryIntent ? primaryIntent[0] : 'general',
      confidence: primaryIntent ? 0.8 : 0.5,
      keywords: this.#extractKeywords(userInput),
    };
  }

  #fallbackSelectTools(userInput, allTools) {
    const input = userInput.toLowerCase();
    const scored = [];

    for (const tool of allTools) {
      const name = tool.name.toLowerCase();
      let score = 0;
      if (input.includes('git') && name.startsWith('git_')) {
        score += 5;
      }
      if (
        (input.includes('file') || input.includes('文件')) &&
        (name.includes('file') || name.includes('dir'))
      ) {
        score += 4;
      }
      if (
        (input.includes('search') || input.includes('搜索')) &&
        (name.includes('search') || name.includes('find'))
      ) {
        score += 4;
      }
      if (score > 0) {
        scored.push({
          name: tool.name,
          description: tool.description,
          score,
          confidence: score / 10,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.#config.maxCandidates);
  }

  #extractKeywords(text) {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'can',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'under',
      'again',
      'further',
      'then',
      'once',
      'here',
      'there',
      'when',
      'where',
      'why',
      'how',
      'all',
      'each',
      'few',
      'more',
      'most',
      'other',
      'some',
      'such',
      'no',
      'nor',
      'not',
      'only',
      'own',
      'same',
      'so',
      'than',
      'too',
      'very',
      'just',
      'and',
      'but',
      'if',
      'or',
      'because',
      'until',
      'while',
      'although',
      'though',
      '的',
      '是',
      '在',
      '有',
      '和',
      '与',
      '或',
      '不',
      '了',
      '这',
      '那',
      '个',
      '些',
      '到',
      '对',
      '为',
      '就',
      '也',
      '都',
      '会',
      '能',
      '要',
      '让',
      '把',
      '给',
      '从',
      '向',
      '上',
      '下',
      '里',
      '外',
      '前',
      '后',
      '左',
      '右',
    ]);

    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 10);
  }
}

export default IntelligentReasoning;
