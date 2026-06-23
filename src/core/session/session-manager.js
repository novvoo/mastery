/**
 * Session Manager - manages conversation history and context window
 */

import { Tokenizer } from '../tokenizer.js';

export class SessionManager {
  /** @type {Array<{role: string, content: string, toolCalls?: Array, toolCallId?: string, priority: number}>} */
  #messages = [];
  /** @type {string} */
  #systemPrompt = '';

  #tokenCounter;
  #usesCustomTokenCounter;
  #tokenizerModel;

  // priority 分级: 1 = ordinary, 2 = evidence, 3 = decision
  static PRIORITY = Object.freeze({ ORDINARY: 1, EVIDENCE: 2, DECISION: 3 });

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

  /** @param {string} content */
  addSystemMessage(content) {
    // Append to existing system prompt
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
      priority: priority || SessionManager.PRIORITY.ORDINARY,
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
      priority: priority || SessionManager.PRIORITY.EVIDENCE,
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

  /** Get all messages including system prompt for LLM API */
  getMessages() {
    /** @type {Array} */
    const all = [];
    if (this.#systemPrompt) {
      all.push({ role: 'system', content: this.#systemPrompt });
    }
    all.push(...this.#messages);
    return all;
  }

  getHistory() {
    return [...this.#messages];
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
