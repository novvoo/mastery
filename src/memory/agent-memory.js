import { StructuredMemory } from './structured-memory.js';
import { MemorySelector, RuleBasedSelector } from './memory-selector.js';
import { MemoryVerifier } from './memory-verifier.js';
import { MemoryType, inferTopic } from './memory-types.js';
import { MemoryManager } from './memory-manager.js';
import { ProjectRules } from './project-rules.js';
import { AdvancedMemoryManager } from './advanced-memory.js';
import { join } from 'path';

export class AgentMemory extends MemoryManager {
  #structuredMemory;
  #selector;
  #fallbackSelector;
  #verifier;
  #modelProvider;
  #projectRules;
  #rulesLoaded = false;
  #advancedMemory;  // 会话内三层记忆（与结构化记忆互补）

  constructor(workingDir, modelProvider = null) {
    super(workingDir, '.agent-memory');  // CONTEXT.md 统一存入 .agent-memory/
    this.#modelProvider = modelProvider;
    this.#structuredMemory = new StructuredMemory(workingDir);
    this.#verifier = new MemoryVerifier(workingDir);
    this.#selector = new MemorySelector(modelProvider);
    this.#fallbackSelector = new RuleBasedSelector();
    this.#projectRules = new ProjectRules(workingDir);
    this.#advancedMemory = new AdvancedMemoryManager({
      maxEpisodicMemories: 1000,
      maxSummaries: 100,
      compression: { maxTokens: 4000, compressionRatio: 0.5 },
    });
  }

  async initialize() {
    await this.load();
    // 懒加载分层规则（初次访问时才扫描文件系统）
    this.#projectRules.load();
    this.#rulesLoaded = true;
    return this;
  }

  addUser(title, content, options = {}) {
    return this.#structuredMemory.addUser(title, content, options);
  }

  addFeedback(title, content, options = {}) {
    return this.#structuredMemory.addFeedback(title, content, options);
  }

  addProject(title, content, options = {}) {
    return this.#structuredMemory.addProject(title, content, options);
  }

  addReference(title, content, options = {}) {
    return this.#structuredMemory.addReference(title, content, options);
  }

  get(id) {
    return this.#structuredMemory.get(id);
  }

  getAll(type = null) {
    return this.#structuredMemory.getAll(type);
  }

  delete(id) {
    return this.#structuredMemory.delete(id);
  }

  async retrieve(query, options = {}) {
    const { limit = 5, types = null, forceVerification = false } = options;

    const allMemories = types
      ? this.getAll().filter(m => types.includes(m.type))
      : this.getAll();

    if (allMemories.length === 0) {
      return [];
    }

    const candidates = allMemories.filter(m => !m.isExpired());

    const selected = await this.#selector.select(query, candidates, { limit });

    const results = [];
    for (const memory of selected) {
      const verificationResult = forceVerification || memory.isStale()
        ? await this.#verifier.verifyMemory(memory)
        : { valid: true, message: 'No verification needed' };

      results.push({
        ...memory,
        verificationResult,
        content: memory.content,
      });
    }

    return results;
  }

  getMemoryContext(currentTask = '') {
    const parts = [];

    // 1. 分层规则（全局 → 项目 → 目录级）
    const rulesContext = this.getRulesContext();
    if (rulesContext) {
      parts.push(rulesContext);
      parts.push('');
    }

    // 2. Topic 摘要
    const topicSummary = this.getTopicSummary();
    if (topicSummary) {
      parts.push(topicSummary);
      parts.push('');
    }

    // 3. 记忆索引
    const indexSummary = this.#structuredMemory.getIndexSummary();
    if (indexSummary) {
      parts.push(indexSummary);
    }

    // 4. 当前任务相关记忆
    if (currentTask) {
      const relevant = this.retrieveSync(currentTask, { limit: 3 });
      if (relevant.length > 0) {
        parts.push('');
        parts.push('[RELEVANT MEMORIES - Pre-loaded for current task:]');
        for (const mem of relevant) {
          const staleMarker = mem.isStale ? mem.isStale() : false;
          parts.push(`- [${mem.type}] ${mem.title}${staleMarker ? ' ⚠️STALE' : ''}`);
          parts.push(`  Content: ${mem.content.substring(0, 150)}${mem.content.length > 150 ? '...' : ''}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * 获取分层规则上下文（全局 + 项目 + 子目录 rules）。
   */
  getRulesContext() {
    if (!this.#rulesLoaded) {
      try { this.#projectRules.load(); } catch { /* 静默 */ }
      this.#rulesLoaded = true;
    }
    return this.#projectRules.toPromptFragment();
  }

  /**
   * 检查子目录是否包含规则文件（用于当前工作路径的规则查找）。
   */
  getSubdirRulesPath(subdir) {
    return this.#projectRules.getSubdirRulesPath(subdir);
  }

  /**
   * 重新加载规则（用于文件系统变更后刷新）。
   */
  reloadRules(subdirs = []) {
    this.#projectRules.load({ subdirs });
    this.#rulesLoaded = true;
  }

  /**
   * 路径作用域懒加载：当 Agent 切换到子目录时，自动加载该目录的规则。
   * 保持已有规则不变，仅增量添加新路径发现的规则。
   *
   * @param {string} cwd - 当前工作路径（如 /project/src/components）
   * @returns {{ loaded: string[], hasNewRules: boolean }}
   */
  ensureRulesForPath(cwd) {
    if (!this.#rulesLoaded) {
      try { this.#projectRules.load(); } catch { /* 静默 */ }
      this.#rulesLoaded = true;
    }

    const before = this.#projectRules.getLoadedRules();
    this.#projectRules.loadForPath(cwd);
    const after = this.#projectRules.getLoadedRules();

    const newRules = after.filter(a => !before.some(b => b.path === a.path));
    return {
      loaded: newRules.map(r => r.path),
      hasNewRules: newRules.length > 0,
    };
  }

  retrieveSync(query, options = {}) {
    const { limit = 5, types = null } = options;

    const allMemories = types
      ? this.getAll().filter(m => types.includes(m.type))
      : this.getAll();

    if (allMemories.length === 0) {
      return [];
    }

    const candidates = allMemories.filter(m => !m.isExpired());
    return this.#fallbackSelector.select(query, candidates, { limit });
  }

  getFullMemory(id) {
    return this.#structuredMemory.getFullContent(id);
  }

  async verifyMemory(id) {
    const memory = this.get(id);
    if (!memory) {
      return { success: false, message: 'Memory not found' };
    }

    const result = await this.#verifier.verifyMemory(memory);
    return {
      success: result.valid,
      message: result.message,
      memory,
    };
  }

  getStats() {
    return this.#structuredMemory.getStats();
  }

  flush() {
    this.#structuredMemory.flush();
  }

  clearAll() {
    this.#structuredMemory.clear();
  }

  getIndexContent() {
    return this.#structuredMemory.getIndex();
  }

  setModelProvider(modelProvider) {
    this.#modelProvider = modelProvider;
    this.#selector = new MemorySelector(modelProvider);
  }

  // ── AdvancedMemoryManager 代理（会话内三层记忆）──────────────────────

  /**
   * 添加情景记忆（会话内短期记忆）。
   */
  addEpisodic(content, metadata = {}) {
    return this.#advancedMemory.addEpisodic(content, metadata);
  }

  /**
   * 添加语义记忆（跨会话知识）。
   */
  addSemantic(key, content, metadata = {}) {
    return this.#advancedMemory.addSemantic(key, content, metadata);
  }

  /**
   * 添加摘要记忆（压缩后的上下文）。
   */
  addSessionSummary(content, metadata = {}) {
    return this.#advancedMemory.addSummary(content, metadata);
  }

  /**
   * 从三层记忆检索。
   */
  retrieveFromSession(query, options = {}) {
    return this.#advancedMemory.retrieve(query, options);
  }

  /**
   * 生成会话记忆上下文（注入 prompt 用）。
   */
  getSessionMemoryContext(currentQuery = '', maxTokens = 4000) {
    if (this.#advancedMemory.getStats().total === 0) {
      return '';
    }
    const ctx = this.#advancedMemory.generateContext(currentQuery, maxTokens);
    const parts = [];
    if (ctx.summaries && ctx.summaries.length > 0) {
      parts.push('[SESSION SUMMARIES]');
      for (const s of ctx.summaries) {
        parts.push(`  - ${s}`);
      }
    }
    if (ctx.semantic && ctx.semantic.length > 0) {
      parts.push('[SESSION SEMANTIC KNOWLEDGE]');
      for (const s of ctx.semantic) {
        parts.push(`  - [${s.key}]: ${s.content}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * 桥梁：将高价值的会话记忆持久化到 StructuredMemory。
   * @param {{ threshold?: number, includeSemantic?: boolean }} opts
   */
  persistSessionMemories(opts = {}) {
    const { threshold = 0.6, includeSemantic = true } = opts;
    const stats = this.#advancedMemory.getStats();
    const written = [];

    // 持久化摘要（通常是高价值知识）
    const { summaries = [], semantic = [] } = this.#advancedMemory.generateContext('', stats.total * 4);
    for (const summary of summaries) {
      if (summary && summary.length > 30) {
        const entry = this.#structuredMemory.addProject(
          'Session Summary', summary,
          { tags: ['session-summary', 'auto'] },
        );
        written.push({ id: entry.id, source: 'summary' });
      }
    }

    // 持久化语义知识
    if (includeSemantic) {
      for (const s of semantic) {
        if (s.content && s.content.length > 20 && s.importance >= threshold) {
          const entry = this.#structuredMemory.addReference(
            `Knowledge: ${s.key || 'unnamed'}`,
            s.content,
            { tags: ['semantic', 'auto'] },
          );
          written.push({ id: entry.id, source: 'semantic' });
        }
      }
    }

    return written;
  }

  /**
   * 保存会话记忆状态到磁盘。
   * @param {string} [filePath] - 自定义路径，默认 .agent-memory/session-memory.json
   */
  saveSessionState(filePath) {
    const dest = filePath || join(this._memoryDir || '.agent-memory', 'session-memory.json');
    return this.#advancedMemory.saveToDisk(dest);
  }

  /**
   * 从磁盘加载会话记忆状态。
   * @param {string} [filePath]
   */
  loadSessionState(filePath) {
    const dest = filePath || join(this._memoryDir || '.agent-memory', 'session-memory.json');
    return this.#advancedMemory.loadFromDisk(dest);
  }

  /**
   * 获取会话记忆摘要文本（供归档或调试）。
   * @param {{ maxEntries?: number }} opts
   */
  getSessionMemorySummary(opts = {}) {
    return this.#advancedMemory.toSummaryText(opts);
  }

  /**
   * 获取高级记忆统计。
   */
  getSessionStats() {
    return this.#advancedMemory.getStats();
  }

  toPromptFragment() {
    const parts = [];

    parts.push(super.toPromptFragment());

    const memoryContext = this.getMemoryContext();
    if (memoryContext && memoryContext.trim().length > 0) {
      parts.push('');
      parts.push(memoryContext);
    }

    // 注入会话记忆上下文
    const sessionCtx = this.getSessionMemoryContext();
    if (sessionCtx) {
      parts.push('');
      parts.push(sessionCtx);
    }

    return parts.join('\n');
  }

  // ── 自动记忆沉淀 ──────────────────────────────────────────────────────

  /**
   * 分析会话上下文，生成自动记忆建议。
   */
  autoSuggestMemory(sessionContext = {}) {
    const suggestions = [];

    if (sessionContext.corrections && sessionContext.corrections.length > 0) {
      for (const correction of sessionContext.corrections) {
        if (this.#isWorthyCorrection(correction)) {
          suggestions.push({
            type: 'feedback',
            title: this.#summarizeCorrection(correction),
            content: correction,
            reason: 'user correction detected',
            confidence: 0.8,
          });
        }
      }
    }

    if (sessionContext.discoveries && sessionContext.discoveries.length > 0) {
      for (const discovery of sessionContext.discoveries) {
        if (this.#isNovelDiscovery(discovery)) {
          suggestions.push({
            type: 'project',
            title: this.#summarizeDiscovery(discovery),
            content: discovery,
            reason: 'new project knowledge discovered',
            confidence: 0.7,
          });
        }
      }
    }

    if (sessionContext.toolEvents && sessionContext.toolEvents.length > 0) {
      const patterns = this.#extractErrorPatterns(sessionContext.toolEvents);
      for (const pattern of patterns) {
        suggestions.push({
          type: 'reference',
          title: `Known fix: ${pattern.title}`,
          content: pattern.content,
          reason: 'recurring issue pattern detected',
          confidence: 0.85,
        });
      }
    }

    return {
      shouldSuggest: suggestions.length > 0,
      suggestions,
    };
  }

  /**
   * 多因子置信度计算。
   *
   * 综合以下信号计算一个 0-1 的归一化置信度：
   *  - baseConfidence：调用方给出的基础置信度
   *  - sourceQuality：来源质量（user_correction=0.9, lsp_fix=0.7, auto_pattern=0.6）
   *  - verificationScore：是否通过文件引用验证
   *  - existingSimilar：是否已有相似记忆（已有则加 0.05）
   *  - agePenalty：如果候选内容太旧，降低置信度
   *
   * @param {object} suggestion
   * @param {number} suggestion.confidence   基础置信度
   * @param {string} [suggestion.type]       记忆类型
   * @param {string} [suggestion.reason]     建议原因
   * @param {object} [opts]
   * @param {number} [opts.maxAgeMs=86400000] 最大时效（24h）
   * @returns {{ confidence: number, factors: object }}
   */
  _computeConfidence(suggestion, opts = {}) {
    const { maxAgeMs = 86_400_000 } = opts;
    const factors = {};

    // 基础置信度
    factors.base = suggestion.confidence || 0.5;

    // 来源质量加权
    const sourceWeights = {
      feedback: 0.90,     // 用户纠正确认
      reference: 0.85,    // 问题模式识别
      project: 0.70,      // 项目发现
      user: 0.75,         // 用户偏好
    };
    factors.source = sourceWeights[suggestion.type] || 0.6;

    // 时效性惩罚：距今超过 maxAgeMs 按线性衰减
    const now = Date.now();
    const ts = suggestion.timestamp || (now - 1000); // 假设 1s 前
    const ageWeight = Math.max(0.2, 1 - (now - ts) / maxAgeMs);
    factors.age = ageWeight;

    // 已有相似记忆：加权
    const existing = this.getAll()
      .filter(m => m.title && suggestion.title &&
        (m.title.toLowerCase().includes(suggestion.title.toLowerCase().substring(0, 10)) ||
         suggestion.title.toLowerCase().includes((m.title || '').toLowerCase().substring(0, 10))))
      .length;
    factors.existingSimilar = Math.min(1, existing * 0.1 + 0.8);

    // 加权综合（来源 40%，基础 25%，相似性 20%，时效性 15%）
    const composite = (
      factors.source * 0.40 +
      factors.base * 0.25 +
      factors.existingSimilar * 0.20 +
      factors.age * 0.15
    );

    return { confidence: Math.min(1, Math.max(0, composite)), factors };
  }

  /**
   * 自动写入高置信度记忆（自动沉淀闭环）。
   *
   * 增强版：使用多因子置信度计算，写入前检测与现有记忆的矛盾。
   *
   * 高置信度（>= 0.8 / 错误模式 >= 0.85）的建议直接写入；
   * 中等置信度（0.6 - 0.8）的建议递交给 isWorthRemembering 做 LLM 判断。
   *
   * @param {object} sessionContext
   * @param {{ autoWriteThreshold?: number, checkContradictions?: boolean }} opts
   * @returns {Promise<{ written: Array<{id:string, topic:string}>, deferred: Array<object>, contradictions: Array<object> }>}
   */
  async autoWriteMemory(sessionContext = {}, opts = {}) {
    const { autoWriteThreshold = 0.8, checkContradictions = true } = opts;
    const { suggestions } = this.autoSuggestMemory(sessionContext);

    const written = [];
    const deferred = [];
    const contradictions = [];

    for (const s of suggestions) {
      // 多因子置信度
      const { confidence: adjustedConfidence } = this._computeConfidence(s);

      // 矛盾检测：检查新建议是否与已有记忆矛盾
      const conflictIds = [];
      if (checkContradictions) {
        const { contradictions: existingConflicts } = MemoryVerifier.detectContradictions(this.getAll());
        const myConflicts = existingConflicts.filter(c =>
          c.memories.some(m => m.title === s.title || m.topic === s.type)
        );
        for (const c of myConflicts) {
          // 根据置信度决定保留哪一个
          const other = c.memories.find(m => m.title !== s.title);
          if (other && adjustedConfidence > 0.8) {
            // 新记忆置信度更高：标记旧记忆为 superseded
            if (other.id) {
              this.updateStatus(other.id, 'superseded');
              conflictIds.push({ resolved: 'newer', oldId: other.id, oldTitle: other.title });
            }
          } else if (other) {
            // 旧记忆置信度更高：跳过新记忆
            contradictions.push({
              newTitle: s.title,
              conflictingWith: { id: other.id, title: other.title },
              resolution: 'skipped_new',
            });
            deferred.push(s);
            continue;
          }
        }
      }

      if (adjustedConfidence >= autoWriteThreshold) {
        // 高置信度：直接写入
        const entry = this.#addWithTopic(s.type, s.title, s.content, { tags: ['auto'], reason: s.reason });
        written.push({ id: entry.id, topic: entry.topic, confidence: adjustedConfidence });
      } else if (adjustedConfidence >= 0.6 && this.#modelProvider) {
        // 中等置信度：LLM 判断
        const isWorth = await this.isWorthRemembering(s.content, { type: s.type, reason: s.reason });
        if (isWorth) {
          const entry = this.#addWithTopic(s.type, s.title, s.content, { tags: ['auto'], reason: s.reason });
          written.push({ id: entry.id, topic: entry.topic, confidence: adjustedConfidence });
        }
      } else {
        deferred.push(s);
      }
    }

    // 写入后自动检查是否需要 compaction
    if (written.length >= 5) {
      this._scheduleCompaction();
    }

    return { written, deferred, contradictions };
  }

  /**
   * 压缩调度：当写入超过阈值时触发自动压缩。
   * @private
   */
  _scheduleCompaction() {
    const allMemories = this.getAll();
    if (allMemories.length < 10) { return; } // 少于 10 条不触发

    const { removedIds } = MemoryVerifier.compact(allMemories);
    for (const id of removedIds) {
      try {
        if (this.#structuredMemory?.remove) {
          this.#structuredMemory.remove(id);
        }
      } catch { /* best-effort removal */ }
    }
    if (removedIds.length > 0) {
      // 静默日志
      if (typeof process !== 'undefined' && process.env?.AGENT_DEBUG) {
        console.warn(`[Memory] Auto-compacted ${removedIds.length} duplicate entries`);
      }
    }
  }

  /**
   * LLM 驱动判断是否值得记忆。
   * 使用模型来判断一段内容是否对未来的任务有价值。
   *
   * @param {string} candidateText
   * @param {{ type?: string, reason?: string, context?: string }} ctx
   * @returns {Promise<boolean>}
   */
  async isWorthRemembering(candidateText, ctx = {}) {
    if (!this.#modelProvider) {
      // 无模型时使用启发式规则
      return candidateText.length > 30 && !/^(ok|好的|嗯|哦|thanks|got it|明白了|好)[\s,.!]*$/i.test(candidateText.trim());
    }

    const prompt = `You are a memory quality filter. Determine if this information is worth remembering for future AI agent tasks.

Information to evaluate:
"""
${candidateText.substring(0, 500)}
"""
Type: ${ctx.type || 'unknown'}
Reason for suggestion: ${ctx.reason || 'unspecified'}
${ctx.context ? `Context: ${ctx.context}` : ''}

Criteria for WORTH remembering (YES):
- Contains reusable project knowledge (architecture, conventions, API details)
- Captures a user preference or workflow preference
- Documents a recurring fix or workaround
- Provides constraints or rules the agent must follow
- Explains a non-obvious project decision

Criteria for NOT worth remembering (NO):
- Trivial or obvious information
- One-time task-specific details
- Pure greetings or emotional expressions
- Information that will be outdated in < 1 hour
- Already recorded in existing project documentation

Answer ONLY "YES" or "NO":`;

    try {
      const response = await this.#modelProvider.generate(prompt, {
        model: 'gpt-4o-mini',
        maxTokens: 5,
        temperature: 0,
      });
      return response.trim().toUpperCase() === 'YES';
    } catch {
      // Fallback: 启发式
      return candidateText.length > 30;
    }
  }

  /**
   * 生成自动记忆建议的 prompt 提示文本（注入 system prompt）。
   */
  getAutoMemoryPrompt(sessionContext = {}) {
    const { shouldSuggest, suggestions } = this.autoSuggestMemory(sessionContext);
    if (!shouldSuggest) { return ''; }

    const lines = ['## Auto-Memory Suggestions'];
    lines.push('The following items may be worth remembering for future tasks.');
    lines.push('Use `write_memory` tool to persist important items:');
    lines.push('');
    for (const s of suggestions) {
      lines.push(`- [${s.type}] ${s.title} (confidence: ${(s.confidence * 100).toFixed(0)}%, reason: ${s.reason})`);
      lines.push(`  > ${s.content.substring(0, 120)}`);
    }

    return lines.join('\n');
  }

  // ── Token-budget 感知的上下文构建器 ────────────────────────────

  /**
   * 在 token 预算限制下构建最优记忆上下文。
   * 按优先级加载：分层规则 > topic 摘要 > 当前任务相关 > 最近记忆 > 索引。
   *
   * @param {object} opts
   * @param {string} [opts.currentTask='']   当前任务描述
   * @param {number} [opts.maxTokens=2000]   token 预算上限
   * @param {number} [opts.tokensPerChar=0.25] 字符→token 估算系数
   * @returns {string}
   */
  getBudgetedMemoryContext(opts = {}) {
    const { currentTask = '', maxTokens = 2000, tokensPerChar = 0.25 } = opts;
    const budget = maxTokens;
    let used = 0;
    const parts = [];

    const estimateTokens = (text) => Math.ceil(text.length * tokensPerChar);
    const canFit = (text) => estimateTokens(text) + used <= budget;

    // Priority 1: 分层规则（最高优先级）
    const rulesCtx = this.getRulesContext();
    if (rulesCtx) {
      if (canFit(rulesCtx)) {
        parts.push(rulesCtx);
        used += estimateTokens(rulesCtx);
      } else {
        // 截断规则上下文
        const truncated = rulesCtx.substring(0, Math.floor((budget - used) / tokensPerChar));
        if (truncated.length > 50) {
          parts.push(truncated + '\n[Rules truncated to fit token budget]');
          used = budget;
          return parts.join('\n\n');
        }
      }
    }

    // Priority 2: Topic 摘要
    const topicSummary = this.getTopicSummary();
    if (topicSummary && canFit(topicSummary)) {
      parts.push(topicSummary);
      used += estimateTokens(topicSummary);
    }

    // Priority 3: 当前任务相关记忆
    if (currentTask && used < budget * 0.7) {
      const relevant = this.retrieveSync(currentTask, { limit: 5 });
      if (relevant.length > 0) {
        let taskCtx = '[RELEVANT MEMORIES]\n';
        let counted = 0;
        for (const mem of relevant) {
          const staleMarker = mem.isStale ? mem.isStale() : false;
          const line = `- [${mem.type}] ${mem.title}${staleMarker ? ' ⚠️STALE' : ''}: ${mem.content.substring(0, 120)}\n`;
          if (estimateTokens(taskCtx + line) + used > budget * 0.95) break;
          taskCtx += line;
          counted++;
        }
        if (counted > 0) {
          parts.push(taskCtx);
          used += estimateTokens(taskCtx);
        }
      }
    }

    // Priority 4: 最近 N 条记忆（按时间排序，去重）
    if (used < budget * 0.5) {
      const allMemories = this.getAll()
        .filter(m => !m.isExpired || !m.isExpired())
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 10);
      let recentCtx = '[RECENT MEMORIES]\n';
      let counted = 0;
      for (const mem of allMemories) {
        const line = `- [${mem.type}] ${mem.title || 'untitled'}\n`;
        if (estimateTokens(recentCtx + line) + used > budget * 0.9) break;
        recentCtx += line;
        counted++;
      }
      if (counted > 0) {
        parts.push(recentCtx);
        used += estimateTokens(recentCtx);
      }
    }

    return parts.join('\n\n');
  }

  // ── 矛盾检测 + Compaction 生命周期集成 ─────────────────────────

  /**
   * 运行记忆健康维护：矛盾检测 + 压缩 + stale 标记。
   * 建议在会话结束或定期（每 N 轮）调用。
   *
   * @param {object} [opts]
   * @param {boolean} [opts.detectContradictions=true]
   * @param {boolean} [opts.compactDuplicates=true]
   * @param {boolean} [opts.detectStale=true]
   * @returns {Promise<MemoryHealthResult>}
   */
  async runMemoryHealthCheck(opts = {}) {
    const {
      detectContradictions = true,
      compactDuplicates = true,
      detectStale = true,
    } = opts;

    const result = {
      contradictions: [],
      removedDuplicateIds: [],
      staleIds: [],
      actions: [],
    };

    const allMemories = this.getAll();

    // 1) 矛盾检测
    if (detectContradictions && allMemories.length > 1) {
      const { contradictions } = MemoryVerifier.detectContradictions(allMemories);
      result.contradictions = contradictions;
      if (contradictions.length > 0) {
        result.actions.push(`Found ${contradictions.length} contradictions`);
      }
    }

    // 2) Compaction：合并重复条目
    if (compactDuplicates && allMemories.length > 0) {
      const { removedIds } = MemoryVerifier.compact(allMemories);
      result.removedDuplicateIds = removedIds;
      if (removedIds.length > 0) {
        result.actions.push(`Compacted ${removedIds.length} duplicate entries`);
      }
    }

    // 3) Stale 检测（Git diff 驱动）
    if (detectStale && allMemories.length > 0) {
      try {
        const verifyResult = await this.#verifier.verifyAll(allMemories);
        result.staleIds = (verifyResult.stale || []);
        if (result.staleIds.length > 0) {
          result.actions.push(`Detected ${result.staleIds.length} stale entries`);
        }
      } catch {
        // Git diff 可能不可用
      }
    }

    return result;
  }

  /**
   * 运行完整审计（通过 MemoryAudit）。
   * @returns {Promise<import('./memory-audit.js').AuditReport>}
   */
  async runFullAudit() {
    const { MemoryAudit } = await import('./memory-audit.js');
    const auditor = new MemoryAudit({
      workingDirectory: this._baseDir || this.workingDir,
      structuredMemory: this.#structuredMemory,
    });
    return auditor.runAudit({ autoClean: false });
  }

  // ── Topic-file 代理 ──────────────────────────────────────────────────

  /**
   * 显式写入到指定 topic。
   * @param {string} type - 记忆类型
   * @param {string} title
   * @param {string} content
   * @param {{ topic?: string, tags?: string[] }} opts
   */
  addWithTopic(type, title, content, opts = {}) {
    return this.#addWithTopic(type, title, content, opts);
  }

  /**
   * 列出所有 topic 文件。
   */
  listTopics() {
    return this.#structuredMemory.listTopics();
  }

  /**
   * 读取指定 topic 文件。
   */
  readTopic(topic) {
    return this.#structuredMemory.readTopic(topic);
  }

  /**
   * 获取 topic 摘要。
   */
  getTopicSummary() {
    return this.#structuredMemory.getTopicSummary();
  }

  /**
   * 迁移已有 entries 到 topic 文件。
   */
  migrateToTopics() {
    return this.#structuredMemory.migrateToTopics();
  }

  // ── 私有：自动记忆判断 ────────────────────────────────────────────────

  /**
   * 内部添加方法：写入 entry + topic 双轨。
   */
  #addWithTopic(type, title, content, opts = {}) {
    const topic = opts.topic || inferTopic(type, opts.tags || [], content);
    const entry = this.#structuredMemory.add(type, title, content, {
      tags: opts.tags || [],
      topic,
      metadata: opts.metadata || {},
    });
    // add() 内部已通过 topic 参数调用 appendToTopic
    return { ...entry, topic };
  }

  #isWorthyCorrection(text) {
    // 过滤太短/无意义的内容
    if (!text || text.length < 10) { return false; }
    // 排除纯情绪表达
    const noisePatterns = /^(ok|好的|嗯|哦|thanks|got it|明白了|好)[\s,.!]*$/i;
    if (noisePatterns.test(text.trim())) { return false; }
    // 排除已有相似记忆
    const existing = this.retrieveSync(text, { limit: 2 });
    if (existing.length > 0) {
      // 太相似的就不重复建议
      const similarityThreshold = 0.6;
      for (const mem of existing) {
        if (this.#textSimilarity(mem.content, text) > similarityThreshold) {
          return false;
        }
      }
    }
    return true;
  }

  #isNovelDiscovery(text) {
    if (!text || text.length < 20) { return false; }
    const existing = this.retrieveSync(text, { limit: 2, types: [MemoryType.PROJECT, MemoryType.REFERENCE] });
    for (const mem of existing) {
      if (this.#textSimilarity(mem.content, text) > 0.5) { return false; }
    }
    return true;
  }

  #summarizeCorrection(text) {
    const cleaned = text.replace(/\n/g, ' ').trim();
    return cleaned.length > 60 ? cleaned.substring(0, 57) + '...' : cleaned;
  }

  #summarizeDiscovery(text) {
    const lines = text.split('\n');
    const firstMeaningful = lines.find(l => l.trim().length > 10) || lines[0] || '';
    return firstMeaningful.substring(0, 60).trim();
  }

  /**
   * 从工具事件中提取重复错误模式。
   */
  #extractErrorPatterns(toolEvents) {
    const errorMap = new Map();
    for (const event of toolEvents) {
      if (event.error || (event.result && event.result.error)) {
        const errMsg = (event.error || event.result.error).toString();
        const key = errMsg.substring(0, 80);
        errorMap.set(key, (errorMap.get(key) || 0) + 1);
      }
    }
    const patterns = [];
    for (const [key, count] of errorMap) {
      if (count >= 2) {
        patterns.push({
          title: key.substring(0, 40),
          content: `This error occurred ${count} times: ${key}`,
        });
      }
    }
    return patterns;
  }

  /**
   * 简单的文本相似度（Jaccard on word bigrams）。
   */
  #textSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    if (wordsA.size === 0 || wordsB.size === 0) { return 0; }
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) { intersection++; }
    }
    return intersection / Math.max(wordsA.size, wordsB.size);
  }
}

export default AgentMemory;