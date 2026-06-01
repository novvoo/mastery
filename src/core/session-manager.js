/**
 * Session Manager - manages conversation history and context window
 */

export class SessionManager {
  /** @type {Array<{role: string, content: string, toolCalls?: Array, toolCallId?: string}>} */
  #messages = [];
  /** @type {string} */
  #systemPrompt = '';

  #tokenCounter;

  constructor(options = {}) {
    this.#tokenCounter = options.tokenCounter || defaultTokenCounter;
  }

  /** @param {string} prompt */
  setSystemPrompt(prompt) {
    this.#systemPrompt = prompt;
  }

  /** @param {string} content */
  addSystemMessage(content) {
    // Append to existing system prompt
    this.#systemPrompt = this.#systemPrompt
      ? `${this.#systemPrompt}\n\n${content}`
      : content;
  }

  /**
   * @param {string} role
   * @param {string} content
   * @param {Array} [toolCalls]
   */
  addMessage(role, content, toolCalls) {
    this.#messages.push({ role, content, toolCalls });
  }

  /** @param {string} content */
  addUserMessage(content) {
    this.addMessage('user', content);
  }

  /**
   * @param {string} content
   * @param {Array} [toolCalls]
   */
  addAssistantMessage(content, toolCalls) {
    this.addMessage('assistant', content, toolCalls);
  }

  /** @param {string} toolCallId @param {string} toolName @param {string} result */
  addToolResult(toolCallId, toolName, result) {
    this.#messages.push({
      role: 'tool',
      content: result,
      toolCallId,
    });
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

  /** Trim old messages to fit within context window, keeping system prompt */
  trimToContextWindow(maxTokens, options = {}) {
    const systemTokens = this.#countTokens(this.#systemPrompt);
    const targetTokens = maxTokens * 0.7;
    const availableTokens = targetTokens - systemTokens;
    const minRecentMessages = Math.max(0, options.minRecentMessages || 0);

    let usedTokens = 0;
    /** @type {Array} */
    const kept = [];

    // Keep messages from the end (most recent)
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      const msgTokens = this.#countTokens(this.#messages[i].content);
      if (usedTokens + msgTokens > availableTokens) {
        break;
      }
      usedTokens += msgTokens;
      kept.unshift(this.#messages[i]);
    }

    if (minRecentMessages > 0) {
      const recent = this.#messages.slice(-minRecentMessages);
      for (const msg of recent) {
        if (!kept.includes(msg)) {
          kept.push(msg);
        }
      }
    }

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
    const system = messages.find(message => message.role === 'system');
    if (system) {
      this.#systemPrompt = system.content || '';
    }
    const keptMessages = messages.filter(message => message.role !== 'system');
    const minRecentMessages = Math.max(
      0,
      options.minRecentMessages || options.preserveRecentMessages || 0
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
      if (this.#messages[i].role === 'user') pairs++;
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

function defaultTokenCounter(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 0.67 + otherChars / 4);
}
