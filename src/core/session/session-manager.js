/**
 * Session Manager - manages conversation history and context window
 *
 * 分层上下文架构：
 *   #systemPrompt   — 不可变行为规则 (ROLE + PRINCIPLES + REACT + AUTO_TRIGGER + FORBIDDEN)
 *   #layers         — 引擎注入的结构化上下文层，按 identity 管理，支持独立刷新
 *   #messages       — 对话历史 (user / assistant / tool)
 *
 * Layer identity 使得引擎可以在运行时选择性刷新某一层（例如编辑后刷新 memory layer），
 * 而不需要重新注入所有上下文。同时也支持 transient layer（一次性注入，用完即弃）。
 */

import { Tokenizer } from '../tokenizer.js';

export class SessionManager {
  /** @type {Array<{role: string, content: string, toolCalls?: Array, toolCallId?: string, priority: number}>} */
  #messages = [];
  /** @type {string} */
  #systemPrompt = '';

  /**
   * 分层上下文存储。
   * Map<layerId, { content: string, priority: number, tokenBudget: number|null, transient: boolean }>
   * priority 越低越靠前注入（0=结构层, 10=投影层, 20=诊断层, 30=依赖层, 40=记忆层）
   */
  #layers = new Map();

  #tokenCounter;
  #usesCustomTokenCounter;
  #tokenizerModel;

  // priority 分级: 1 = ordinary, 2 = evidence, 3 = decision
  static PRIORITY = Object.freeze({ ORDINARY: 1, EVIDENCE: 2, DECISION: 3 });

  // Layer priority 常量：数值越大越靠后（越接近对话），LLM 注意力权重自然更高
  static LAYER = Object.freeze({
    STRUCTURE: 0, // 项目结构
    PROJECTION: 10, // 状态图投影
    DIAGNOSTICS: 20, // LSP 诊断
    DEPENDENCIES: 30, // 依赖关系
    MEMORY: 40, // 项目记忆（最高优先级，最后注入）
  });

  constructor(options = {}) {
    this.#usesCustomTokenCounter = typeof options.tokenCounter === 'function';
    this.#tokenizerModel = options.model || options.modelName || process.env.MODEL || 'gpt-4o';
    this.#tokenCounter = this.#usesCustomTokenCounter
      ? options.tokenCounter
      : Tokenizer.createTokenCounter({ model: this.#tokenizerModel });
  }

  /** @param {string} prompt */
  setSystemPrompt(prompt) {
    this.#systemPrompt = prompt;
  }

  /**
   * 注入结构化上下文层。与 addSystemMessage() 不同，layer 有 identity，
   * 可以被后续的 refreshLayer() 更新，或 removeLayer() 移除。
   *
   * @param {string} layerId   — 全局唯一标识，如 'layer1_structure', 'layer4_memory'
   * @param {string} content   — 上下文内容
   * @param {object} [options]
   * @param {number} [options.priority]  — 注入顺序（越低越靠前），默认 0
   * @param {number} [options.tokenBudget] — 该层 token 上限，null 为不限制
   * @param {boolean} [options.transient]  — 一次性层，下次 getMessages() 后自动清除
   */
  addLayer(layerId, content, options = {}) {
    this.#layers.set(layerId, {
      content,
      priority: options.priority ?? 0,
      tokenBudget: options.tokenBudget ?? null,
      transient: options.transient ?? false,
    });
  }

  /**
   * 刷新已有 layer 的内容。layerId 不存在时自动创建（等同于 addLayer）。
   * 用于闭环记忆：编辑后更新 layer4_memory，不重写其他层。
   */
  refreshLayer(layerId, content, options = {}) {
    if (this.#layers.has(layerId)) {
      const existing = this.#layers.get(layerId);
      existing.content = content;
      if (options.priority !== undefined) existing.priority = options.priority;
      if (options.transient !== undefined) existing.transient = options.transient;
    } else {
      this.addLayer(layerId, content, options);
    }
  }

  /**
   * 移除指定 layer，用于清理过期的上下文层。
   */
  removeLayer(layerId) {
    return this.#layers.delete(layerId);
  }

  /**
   * 清除所有 transient layers（一次性注入层）。
   */
  clearTransientLayers() {
    for (const [id, layer] of this.#layers) {
      if (layer.transient) this.#layers.delete(id);
    }
  }

  /**
   * 检查某个 layer 是否存在。
   */
  hasLayer(layerId) {
    return this.#layers.has(layerId);
  }

  /** @param {string} content */
  addSystemMessage(content) {
    // Append to existing system prompt (backward compat)
    this.#systemPrompt = this.#systemPrompt ? `${this.#systemPrompt}\n\n${content}` : content;
  }

  /**
   * @param {string} role
   * @param {string} content
   * @param {Array} [toolCalls]
   * @param {number} [priority]
   */
  addMessage(role, content, toolCalls, priority) {
    this.#messages.push({
      role,
      content,
      ...(toolCalls ? { toolCalls } : {}),
      priority: priority ?? SessionManager.PRIORITY.ORDINARY,
    });
  }

  /** @param {string} content */
  addUserMessage(content) {
    this.addMessage('user', content, undefined, SessionManager.PRIORITY.ORDINARY);
  }

  /**
   * @param {string} content
   * @param {Array} [toolCalls]
   */
  addAssistantMessage(content, toolCalls) {
    // Assistant 消息默认高一些优先级：里面可能包含决策/推理
    this.addMessage('assistant', content, toolCalls, SessionManager.PRIORITY.EVIDENCE);
  }

  /** @param {string} toolCallId @param {string} toolName @param {string} result @param {number} [priority] */
  addToolResult(toolCallId, toolName, result, priority) {
    // Tool 结果默认 evidence：它往往是后续决策的依据
    this.#messages.push({
      role: 'tool',
      content: result,
      toolCallId,
      priority: priority ?? SessionManager.PRIORITY.EVIDENCE,
    });
  }

  /**
   * 给最后一条消息重新打 priority tag。用于 agent 运行时对消息动态打标。
   * @param {number} priority
   */
  tagLastMessage(priority) {
    const last = this.#messages[this.#messages.length - 1];
    if (last) {
      last.priority = priority;
    }
  }

  /**
   * 根据关键词给最后一条 assistant 消息打 priority：
   *   - 包含 "decision", "I will", "we should" 等 → DECISION
   *   - 否则保持原 priority
   * 非侵入：只是启发式打标，不会影响既有调用方
   */
  autoTagLastAssistantPriority() {
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      const msg = this.#messages[i];
      if (msg.role === 'assistant') {
        const text =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        const lower = text.toLowerCase();
        const decisionKeywords = [
          'decision',
          'we should',
          'we will',
          'i will',
          'let us',
          "let's",
          'therefore',
          '决定',
          '因此',
          '所以',
          '应该',
          '要做',
          '将使用',
        ];
        if (decisionKeywords.some((kw) => lower.includes(kw))) {
          msg.priority = SessionManager.PRIORITY.DECISION;
        }
        break;
      }
    }
  }

  /** Get all messages including system prompt and layered context for LLM API */
  getMessages() {
    /** @type {Array} */
    const all = [];

    // 1. 核心 system prompt（不可变行为规则）
    if (this.#systemPrompt) {
      all.push({ role: 'system', content: this.#systemPrompt });
    }

    // 2. 分层上下文：按 priority 升序注入（低 priority 在前，LLM 越靠后的注意力越高）
    const sortedLayers = [...this.#layers.entries()].sort(
      ([, a], [, b]) => a.priority - b.priority,
    );

    for (const [layerId, layer] of sortedLayers) {
      let content = layer.content;
      // Token budget：如果设置了上限，截断内容
      if (layer.tokenBudget != null && content.length > 0) {
        const estimatedTokens = Math.ceil(content.length * 0.25);
        if (estimatedTokens > layer.tokenBudget) {
          const maxChars = Math.floor(layer.tokenBudget * 4);
          content =
            content.substring(0, maxChars) + '\n... (layer truncated, see engine for full context)';
        }
      }
      all.push({ role: 'system', content });
    }

    // 3. 对话历史
    all.push(...this.#messages);

    // 4. 清除一次性 layer
    this.clearTransientLayers();

    return all;
  }

  getHistory() {
    return [...this.#messages];
  }

  exportSnapshot(options = {}) {
    const maxMessages = Math.max(0, options.maxMessages ?? 80);
    const messages = maxMessages === 0 ? [] : this.#messages.slice(-maxMessages);
    const layers = Array.from(this.#layers.entries())
      .filter(([, layer]) => !layer.transient)
      .map(([id, layer]) => ({
        id,
        content: layer.content,
        priority: layer.priority,
        tokenBudget: layer.tokenBudget,
        transient: false,
      }));

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      tokenizerModel: this.getTokenizerModel(),
      systemPrompt: this.#systemPrompt,
      layers,
      messages: messages.map((message) => ({ ...message })),
    };
  }

  restoreSnapshot(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }

    const replace = options.replace !== false;
    if (replace) {
      this.#messages = [];
      this.#layers.clear();
      this.#systemPrompt = '';
    }

    if (typeof snapshot.systemPrompt === 'string') {
      this.#systemPrompt = snapshot.systemPrompt;
    }

    if (Array.isArray(snapshot.layers)) {
      for (const layer of snapshot.layers) {
        if (!layer?.id || typeof layer.content !== 'string') {
          continue;
        }
        this.#layers.set(layer.id, {
          content: layer.content,
          priority: layer.priority ?? 0,
          tokenBudget: layer.tokenBudget ?? null,
          transient: false,
        });
      }
    }

    if (Array.isArray(snapshot.messages)) {
      const restoredMessages = snapshot.messages
        .filter((message) => message?.role && typeof message.content === 'string')
        .map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
          ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
          priority: message.priority ?? SessionManager.PRIORITY.ORDINARY,
        }));
      this.#messages = replace ? restoredMessages : [...this.#messages, ...restoredMessages];
    }

    return true;
  }

  /** Token estimation with a CJK-aware fallback counter. */
  getTokenCount() {
    let total = 0;
    for (const msg of this.getMessages()) {
      total += this.#countTokens(msg.content);
    }
    return Math.ceil(total);
  }

  setTokenizerModel(model) {
    if (this.#usesCustomTokenCounter) {
      return;
    }
    this.#tokenizerModel = model || 'gpt-4o';
    this.#tokenCounter = Tokenizer.createTokenCounter({ model: this.#tokenizerModel });
  }

  getTokenizerModel() {
    return Tokenizer.normalizeModelName(this.#tokenizerModel);
  }

  /** Trim old messages to fit within context window, keeping system prompt */
  trimToContextWindow(maxTokens, options = {}) {
    const systemTokens = this.#countTokens(this.#systemPrompt);
    const targetTokens = maxTokens * 0.4;
    const availableTokens = Math.max(0, targetTokens - systemTokens);
    const minRecentMessages = Math.max(0, options.minRecentMessages || 0);
    const minPriority = options.minPriority || SessionManager.PRIORITY.EVIDENCE; // 默认保留 evidence 及以上

    // Step 1: 先收集所有高 priority 消息（决策 + 证据），它们必须被保留
    const highPriorityMessages = this.#messages.filter((m) => (m.priority || 1) >= minPriority);
    let usedTokens = highPriorityMessages.reduce((sum, m) => sum + this.#countTokens(m.content), 0);

    /** @type {Array} */
    const kept = [...highPriorityMessages];
    const keptSet = new Set(highPriorityMessages);

    // Step 2: 从尾部倒序，把低 priority 消息塞进剩余 budget
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      const msg = this.#messages[i];
      if (keptSet.has(msg)) {
        continue;
      }
      const msgTokens = this.#countTokens(msg.content);
      if (usedTokens + msgTokens > availableTokens) {
        break;
      }
      usedTokens += msgTokens;
      kept.push(msg); // 顺序不保证，下一步再按原始顺序排序
      keptSet.add(msg);
    }

    // Step 3: 保证 minRecentMessages 条最近消息被保留
    if (minRecentMessages > 0) {
      const recent = this.#messages.slice(-minRecentMessages);
      for (const msg of recent) {
        if (!keptSet.has(msg)) {
          kept.push(msg);
          keptSet.add(msg);
        }
      }
    }

    // Step 4: 按原始顺序排序，保持对话时序
    const originalIndex = new Map(this.#messages.map((m, i) => [m, i]));
    kept.sort((a, b) => (originalIndex.get(a) || 0) - (originalIndex.get(b) || 0));

    this.#messages = kept;
  }

  /**
   * Trim with a richer pruning strategy while preserving this class' split
   * system-prompt/session-message storage model.
   */
  trimWithPruner(pruner, options = {}) {
    const originalMessages = [...this.#messages];
    const pruned = pruner.prune(this.getMessages(), options);
    const messages = pruned.messages || [];
    const system = messages.find((message) => message.role === 'system');
    if (system) {
      this.#systemPrompt = system.content || '';
    }
    const keptMessages = messages.filter((message) => message.role !== 'system');
    const minRecentMessages = Math.max(
      0,
      options.minRecentMessages || options.preserveRecentMessages || 0,
    );

    if (minRecentMessages > 0) {
      for (const msg of originalMessages.slice(-minRecentMessages)) {
        if (!keptMessages.includes(msg)) {
          keptMessages.push(msg);
        }
      }
    }

    this.#messages = keptMessages;
    return pruned.stats;
  }

  /**
   * 用摘要压缩替代丢弃。将中间消息通过 ConversationSummarizer 压缩为富语义摘要，
   * 保留最近消息的完整内容。与 trimToContextWindow / trimWithPruner 的区别是：
   *  - 旧版方法丢弃消息 → 信息丢失
   *  - 本方法压缩消息 → 语义保留，生成结构化摘要
   *
   * @param {import('../dynamic-context-pruning.js').DynamicContextPruning} pruner
   * @param {object} [options]
   * @returns {object} stats — 压缩统计
   */
  compressWithSummarizer(pruner, options = {}) {
    const allMessages = this.getMessages();
    const compressed = pruner.compress(allMessages, options);
    const messages = compressed.messages || [];

    // 分离 system prompt 和 对话消息
    const newSystemMessages = [];
    const keptMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        newSystemMessages.push(msg.content || '');
      } else {
        keptMessages.push(msg);
      }
    }

    // 合并 system prompt（摘要注入 + 原有 system prompt）
    if (newSystemMessages.length > 0) {
      // 最后一个 system message 是最新的摘要，放在 system prompt 前面
      const existingPrompt = this.#systemPrompt || '';
      this.#systemPrompt = newSystemMessages.join('\n\n');
      if (existingPrompt && !this.#systemPrompt.includes(existingPrompt)) {
        this.#systemPrompt = existingPrompt + '\n\n' + this.#systemPrompt;
      }
    }

    // 保留最近消息
    const preserveRecent = options.preserveRecentMessages || 4;
    const originalMessages = [...this.#messages];
    const recentOriginal = originalMessages.slice(-preserveRecent);

    // 确保最近消息没有被丢掉
    for (const msg of recentOriginal) {
      if (!keptMessages.includes(msg)) {
        keptMessages.push(msg);
      }
    }

    this.#messages = keptMessages;
    return compressed.stats;
  }

  /** Get the last N user-assistant exchange pairs */
  getRecentExchanges(count) {
    /** @type {Array} */
    const exchanges = [];
    let pairs = 0;
    for (let i = this.#messages.length - 1; i >= 0 && pairs < count; i--) {
      exchanges.unshift(this.#messages[i]);
      if (this.#messages[i].role === 'user') {
        pairs++;
      }
    }
    return exchanges;
  }

  clear() {
    this.#messages = [];
  }

  get length() {
    return this.#messages.length;
  }

  #countTokens(content) {
    return this.#tokenCounter(String(content || ''));
  }
}
