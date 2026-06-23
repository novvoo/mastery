/**
 * TokenJuice - 智能上下文压缩引擎
 * 参考 vincentkoc/tokenjuice 的复杂 JSON 规则引擎架构
 *
 * 核心功能：
 * - 可扩展的 JSON 规则引擎
 * - 命令分类与置信度评估
 * - HTML → Markdown 转换
 * - 冗余内容去重
 * - 长输出智能截断
 * - Token 估算与压缩统计
 */

const DEFAULT_MAX_CHARS = 4000; // 更激进的默认字符限制
const CJK_CHAR_REGEX = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g;

/**
 * @typedef {Object} RuleMatch
 * @property {string[]} [toolNames] - 匹配的工具名
 * @property {string[]} [argv0] - 匹配的命令名 (argv[0])
 * @property {string[]} [gitSubcommands] - Git 子命令
 * @property {string[][]} [argvIncludes] - argv 必须包含的模式
 * @property {string[][]} [argvIncludesAny] - argv 包含任意模式
 * @property {string[]} [commandIncludes] - 命令行包含的模式
 */

/**
 * @typedef {Object} RuleFilters
 * @property {string[]} [skipPatterns] - 跳过匹配的模式
 * @property {string[]} [keepPatterns] - 保留匹配的模式
 */

/**
 * @typedef {Object} RuleTransforms
 * @property {boolean} [stripAnsi] - 移除 ANSI 转义码
 * @property {boolean} [prettyPrintJson] - 格式化 JSON 输出
 * @property {boolean} [dedupeAdjacent] - 去重相邻行
 * @property {boolean} [trimEmptyEdges] - 移除首尾空行
 */

/**
 * @typedef {Object} RuleSummarize
 * @property {number} [head] - 保留前 N 行
 * @property {number} [tail] - 保留后 N 行
 */

/**
 * @typedef {Object} RuleCounter
 * @property {string} name - 计数器名称
 * @property {string} pattern - 匹配模式
 */

/**
 * @typedef {Object} JsonRule
 * @property {string} id - 规则 ID
 * @property {string} family - 规则家族
 * @property {string} [description] - 规则描述
 * @property {number} [priority] - 优先级
 * @property {string} [onEmpty] - 空输出处理
 * @property {RuleMatch} match - 匹配条件
 * @property {RuleFilters} [filters] - 过滤器
 * @property {RuleTransforms} [transforms] - 转换操作
 * @property {RuleSummarize} [summarize] - 摘要配置
 * @property {RuleCounter[]} [counters] - 计数器
 */

/**
 * @typedef {Object} ClassificationResult
 * @property {string} family - 匹配的规则家族
 * @property {number} confidence - 置信度 (0-1)
 * @property {string} [matchedReducer] - 匹配的处理规则
 * @property {string} [matchedCommand] - 实际匹配的命令
 */

/**
 * @typedef {Object} CompactResult
 * @property {string} inlineText - 内联压缩文本
 * @property {string} [previewText] - 预览文本
 * @property {Record<string, number>} [facts] - 提取的事实数据
 * @property {Object} [trace] - 分类跟踪信息
 * @property {Object} stats - 统计信息
 */

export class TokenJuice {
  #rules;
  #compiledRules;
  #maxChars;
  #tokenCounter;

  constructor(options = {}) {
    this.#maxChars = options.maxChars || DEFAULT_MAX_CHARS;
    this.#rules = [];
    this.#compiledRules = [];
    this.#tokenCounter = options.tokenCounter || this.#defaultTokenCounter.bind(this);

    this.#addBuiltinRules();
  }

  /**
   * 默认 token 计数器
   */
  #defaultTokenCounter(text) {
    if (!text) {
      return 0;
    }
    let tokens = 0;
    let lastIndex = 0;
    const cjkMatches = text.matchAll(CJK_CHAR_REGEX);

    for (const match of cjkMatches) {
      const nonCjkLength = match.index - lastIndex;
      tokens += Math.ceil(nonCjkLength / 4);
      tokens += match[0].length * 0.67;
      lastIndex = match.index + match[0].length;
    }

    const remaining = text.length - lastIndex;
    tokens += Math.ceil(remaining / 4);
    return Math.ceil(tokens);
  }

  /**
   * 添加内置压缩规则
   */
  #addBuiltinRules() {
    // HTML → Markdown
    this.addRule({
      id: 'html_to_markdown',
      family: 'html',
      description: 'Strip HTML tags',
      priority: 10,
      match: {},
      transforms: { stripAnsi: false },
      pattern: /<[^>]+>/g,
      replacement: '',
    });

    // 多余空行压缩
    this.addRule({
      id: 'collapse_blank_lines',
      family: 'formatting',
      description: 'Collapse multiple blank lines',
      priority: 20,
      match: {},
      pattern: /\n{3,}/g,
      replacement: '\n\n',
    });

    // 多余空格压缩
    this.addRule({
      id: 'collapse_spaces',
      family: 'formatting',
      description: 'Collapse multiple spaces',
      priority: 25,
      match: {},
      pattern: /[ \t]+/g,
      replacement: ' ',
    });

    // 去除行尾空格
    this.addRule({
      id: 'trim_lines',
      family: 'formatting',
      description: 'Trim trailing whitespace',
      priority: 30,
      match: {},
      pattern: /[ \t]+$/gm,
      replacement: '',
    });

    // ANSI 转义码移除
    this.addRule({
      id: 'strip_ansi',
      family: 'terminal',
      description: 'Strip ANSI escape codes',
      priority: 5,
      match: {},
      transforms: { stripAnsi: true },
      pattern: /\x1b\[[0-9;]*m/g,
      replacement: '',
    });

    // Git diff 路径前缀
    this.addRule({
      id: 'git_diff_prefix',
      family: 'git',
      description: 'Strip git diff file prefixes',
      priority: 15,
      match: { commandIncludes: ['git diff', 'git diff --cached'] },
      pattern: /^(a\/|b\/)/gm,
      replacement: '',
    });

    // JSON 格式化
    this.addRule({
      id: 'pretty_json',
      family: 'json',
      description: 'Pretty print JSON output',
      priority: 40,
      match: { commandIncludes: ['json', '--json', 'echo $'] },
      transforms: { prettyPrintJson: true },
    });

    // 添加 npm ls/package 规则 - 提取依赖信息
    this.addRule({
      id: 'npm_ls',
      family: 'npm',
      description: 'Summarize npm ls output',
      priority: 35,
      match: { commandIncludes: ['npm ls', 'npm list', 'pnpm ls', 'pnpm list'] },
      transforms: { trimEmptyEdges: true },
      counters: [
        { name: 'packages', pattern: /├──|└──/g },
        { name: 'totalDeps', pattern: /\d+\s+packages?/g },
      ],
    });

    // Docker 规则 - 提取容器/镜像信息
    this.addRule({
      id: 'docker_ps',
      family: 'docker',
      description: 'Compact docker ps output',
      priority: 35,
      match: { commandIncludes: ['docker ps', 'docker images', 'docker container ls'] },
      transforms: { trimEmptyEdges: true },
    });

    // Git status 规则
    this.addRule({
      id: 'git_status',
      family: 'git',
      description: 'Extract git status changes',
      priority: 35,
      match: { commandIncludes: ['git status'] },
      counters: [
        { name: 'changed', pattern: /modified:/g },
        { name: 'added', pattern: /new file:/g },
        { name: 'deleted', pattern: /deleted:/g },
      ],
    });

    // Git log 规则 - 限制显示条目
    this.addRule({
      id: 'git_log',
      family: 'git',
      description: 'Limit git log output',
      priority: 35,
      match: { commandIncludes: ['git log', 'git log --oneline'] },
      summarize: { head: 20 },
    });
  }

  /**
   * 添加自定义压缩规则（兼容旧接口）
   */
  addRule(rule) {
    if (rule.pattern) {
      // 旧格式：简单正则规则
      this.#rules.push({
        id: rule.name || `rule_${this.#rules.length}`,
        family: rule.family || 'general',
        description: rule.description || '',
        priority: rule.priority || 50,
        pattern: rule.pattern,
        replacement: rule.replacement || '',
        transforms: {},
      });
    } else {
      // 新格式：JSON 规则
      const compiled = this.#compileRule(rule);
      this.#compiledRules.push({
        rule,
        compiled,
        priority: rule.priority || 50,
      });
      this.#compiledRules.sort((a, b) => b.priority - a.priority);
    }
  }

  /**
   * 批量添加 JSON 规则
   */
  addRules(rules) {
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  /**
   * 编译 JSON 规则
   */
  #compileRule(rule) {
    return {
      skipPatterns: (rule.filters?.skipPatterns || []).map((p) => new RegExp(p)),
      keepPatterns: (rule.filters?.keepPatterns || []).map((p) => new RegExp(p)),
      counters: (rule.counters || []).map((c) => ({
        name: c.name,
        pattern: new RegExp(c.pattern),
      })),
    };
  }

  /**
   * 分类命令输出
   */
  classify(input) {
    const { toolName, command, argv } = input;
    const cmdStr = command || argv?.join(' ') || toolName || '';

    for (const { rule } of this.#compiledRules) {
      const match = this.#matchRule(rule.match, toolName, argv, cmdStr);
      if (match.matched) {
        return {
          family: rule.family,
          confidence: match.confidence,
          matchedReducer: rule.id,
          matchedCommand: match.matchedValue,
        };
      }
    }

    // 默认分类
    return {
      family: 'unknown',
      confidence: 0,
    };
  }

  /**
   * 检查规则是否匹配
   */
  #matchRule(match, toolName, argv, cmdStr) {
    if (!match || Object.keys(match).length === 0) {
      return { matched: false, confidence: 0 };
    }

    let confidence = 0;
    let matchedValue = null;

    // 工具名匹配
    if (match.toolNames?.length) {
      if (toolName && match.toolNames.includes(toolName)) {
        confidence = Math.max(confidence, 0.9);
        matchedValue = toolName;
      } else {
        return { matched: false, confidence: 0 };
      }
    }

    // argv0 匹配
    if (match.argv0?.length) {
      const argv0 = argv?.[0] || '';
      if (match.argv0.includes(argv0)) {
        confidence = Math.max(confidence, 0.85);
        matchedValue = argv0;
      } else {
        return { matched: false, confidence: 0 };
      }
    }

    // Git 子命令匹配
    if (match.gitSubcommands?.length) {
      const gitMatch = cmdStr.match(/^git\s+(\w+)/);
      if (gitMatch && match.gitSubcommands.includes(gitMatch[1])) {
        confidence = Math.max(confidence, 0.95);
        matchedValue = `git ${gitMatch[1]}`;
      } else {
        return { matched: false, confidence: 0 };
      }
    }

    // argv 包含匹配
    if (match.argvIncludes?.length) {
      const argvStr = argv?.join(' ') || '';
      const allMatch = match.argvIncludes.every((patterns) =>
        patterns.every((p) => argvStr.includes(p)),
      );
      if (allMatch) {
        confidence = Math.max(confidence, 0.8);
      } else {
        return { matched: false, confidence: 0 };
      }
    }

    // argv 任意匹配
    if (match.argvIncludesAny?.length) {
      const argvStr = argv?.join(' ') || '';
      const anyMatch = match.argvIncludesAny.some((patterns) =>
        patterns.some((p) => argvStr.includes(p)),
      );
      if (anyMatch) {
        confidence = Math.max(confidence, 0.7);
      }
    }

    // 命令行包含匹配
    if (match.commandIncludes?.length) {
      const hasAll = match.commandIncludes.every((p) => cmdStr.includes(p));
      if (hasAll) {
        confidence = Math.max(confidence, 0.75);
        matchedValue = matchedValue || cmdStr;
      } else if (match.commandIncludesAny?.length === 0) {
        return { matched: false, confidence: 0 };
      }
    }

    // commandIncludesAny 匹配
    if (match.commandIncludesAny?.length) {
      const hasAny = match.commandIncludesAny.some((p) => cmdStr.includes(p));
      if (hasAny) {
        confidence = Math.max(confidence, 0.6);
        matchedValue = matchedValue || cmdStr;
      }
    }

    return { matched: confidence > 0, confidence, matchedValue };
  }

  /**
   * 压缩文本
   * @param {string} text - 原始文本
   * @param {object} options - 选项
   * @returns {string} 压缩后的文本
   */
  compress(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let result = text;
    const maxChars = options.maxChars || this.#maxChars;

    // 应用简单规则
    for (const rule of this.#rules) {
      result = result.replace(rule.pattern, rule.replacement);
    }

    // 应用 JSON 规则转换
    for (const { rule } of this.#compiledRules) {
      result = this.#applyTransforms(result, rule.transforms || {});
    }

    // 去重相邻行
    result = this.#deduplicateLines(result);

    // 截断
    result = this.#smartTruncate(result, maxChars);

    return result.trim();
  }

  /**
   * 压缩工具结果（支持命令输入元信息）
   */
  compressToolResult(result, options = {}) {
    const input = options.input || {};
    let text;

    if (typeof result === 'string') {
      text = result;
    } else if (result && typeof result === 'object') {
      text =
        result.output ||
        result.content ||
        result.message ||
        result.result ||
        JSON.stringify(result, null, 2);
    } else {
      text = String(result);
    }

    // 分类
    const classification = this.classify(input);

    // 压缩
    let compressed = text;
    const maxChars = options.maxChars || this.#maxChars;

    for (const rule of this.#rules) {
      compressed = compressed.replace(rule.pattern, rule.replacement);
    }

    for (const { rule, compiled } of this.#compiledRules) {
      // 构建 cmdStr（与 classify 方法一致）
      const cmdStr = input.command || input.argv?.join(' ') || input.toolName || '';

      // 检查是否匹配
      const match = this.#matchRule(rule.match, input.toolName, input.argv, cmdStr);

      if (match.matched) {
        // 应用过滤器
        if (rule.filters?.skipPatterns?.length) {
          for (const pattern of compiled.skipPatterns) {
            compressed = compressed.split(pattern).join('');
          }
        }

        // 应用转换
        compressed = this.#applyTransforms(compressed, rule.transforms || {});

        // 应用摘要
        if (rule.summarize) {
          compressed = this.#applySummarize(compressed, rule.summarize);
        }
      }
    }

    // 去重
    compressed = this.#deduplicateLines(compressed);

    // 截断
    compressed = this.#smartTruncate(compressed, maxChars);

    // 提取事实
    const facts = this.#extractFacts(compressed, input);

    return {
      inlineText: compressed.trim(),
      previewText: compressed.substring(0, 200),
      facts,
      trace: {
        normalizedCommand: input.command || input.argv?.join(' ') || input.toolName,
        matchedReducer: classification.matchedReducer,
        family: classification.family,
      },
      stats: {
        rawChars: text.length,
        reducedChars: compressed.length,
        ratio: text.length > 0 ? compressed.length / text.length : 1,
      },
      classification,
    };
  }

  /**
   * 应用转换操作
   */
  #applyTransforms(text, transforms) {
    if (!text || !transforms) {
      return text;
    }

    let result = text;

    if (transforms.stripAnsi) {
      result = result.replace(/\x1b\[[0-9;]*m/g, '');
    }

    if (transforms.prettyPrintJson) {
      try {
        const parsed = JSON.parse(result);
        result = JSON.stringify(parsed, null, 2);
      } catch {
        // 不是 JSON，保持原样
      }
    }

    if (transforms.trimEmptyEdges) {
      result = result.trim();
      result = result.replace(/^\n+/, '').replace(/\n+$/, '');
    }

    return result;
  }

  /**
   * 应用摘要规则
   */
  #applySummarize(text, summarize) {
    if (!text || !summarize) {
      return text;
    }

    const lines = text.split('\n');
    const result = [];

    if (summarize.head) {
      result.push(...lines.slice(0, summarize.head));
    }

    if (summarize.tail) {
      const tailLines = lines.slice(-summarize.tail);
      if (result.length > 0) {
        result.push('...');
      }
      result.push(...tailLines);
    }

    return result.length > 0 ? result.join('\n') : text;
  }

  /**
   * 提取事实数据（计数器）
   */
  #extractFacts(text, input) {
    const facts = {};
    const cmdStr = input.command || input.argv?.join(' ') || input.toolName || '';

    // 查找匹配的规则计数器
    for (const { rule, compiled } of this.#compiledRules) {
      const match = this.#matchRule(rule.match, input.toolName, input.argv, cmdStr);

      if (match.matched && rule.counters?.length) {
        for (const counter of compiled.counters) {
          const matches = text.match(counter.pattern);
          if (matches) {
            facts[counter.name] = Array.isArray(matches) ? matches.length : 1;
          }
        }
      }
    }

    return facts;
  }

  /**
   * 行去重（相邻重复）
   */
  #deduplicateLines(text) {
    const lines = text.split('\n');
    const result = [];
    let lastLine = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed !== lastLine) {
        result.push(line);
        lastLine = trimmed;
      }
    }

    return result.join('\n');
  }

  /**
   * 智能截断 - 在句子/段落边界截断
   */
  #smartTruncate(text, maxChars) {
    if (text.length <= maxChars) {
      return text;
    }

    // 在最后一个完整段落处截断
    const truncated = text.substring(0, maxChars);
    const lastParagraph = truncated.lastIndexOf('\n\n');
    if (lastParagraph > maxChars * 0.5) {
      return truncated.substring(0, lastParagraph) + '\n\n... [truncated]';
    }

    // 在最后一个完整句子处截断
    const lastSentence = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('! '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('！'),
      truncated.lastIndexOf('？'),
    );
    if (lastSentence > maxChars * 0.5) {
      return truncated.substring(0, lastSentence + 1) + '... [truncated]';
    }

    // 最后手段：在空格处截断
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.5) {
      return truncated.substring(0, lastSpace) + '... [truncated]';
    }

    return truncated + '... [truncated]';
  }

  /**
   * 估算 token 数量
   */
  estimateTokens(text) {
    if (!text) {
      return 0;
    }
    return this.#tokenCounter(text);
  }

  /**
   * 获取压缩统计
   */
  getStats(original, compressed) {
    const origTokens = this.estimateTokens(original);
    const compTokens = this.estimateTokens(compressed);
    const savings =
      origTokens > 0 ? (((origTokens - compTokens) / origTokens) * 100).toFixed(1) : 0;

    return {
      originalChars: original.length,
      compressedChars: compressed.length,
      originalTokens: origTokens,
      compressedTokens: compTokens,
      savingsPercent: savings,
      compressionRatio: compressed.length / (original.length || 1),
    };
  }

  /**
   * 获取已注册规则列表
   */
  getRules() {
    return {
      simple: this.#rules.map((r) => ({
        id: r.id,
        family: r.family,
        description: r.description,
      })),
      compiled: this.#compiledRules.map(({ rule, priority }) => ({
        id: rule.id,
        family: rule.family,
        description: rule.description,
        priority,
        hasCounters: (rule.counters?.length || 0) > 0,
      })),
    };
  }

  /**
   * 清除所有规则
   */
  clearRules() {
    this.#rules = [];
    this.#compiledRules = [];
  }
}

export default TokenJuice;
