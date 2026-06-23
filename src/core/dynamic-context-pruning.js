/**
 * Dynamic Context Pruning - 动态上下文窗口优化模块
 * 核心功能：
 * - 基于重要性的消息筛选
 * - 语义保留的上下文压缩
 * - 对话连贯性维护
 * - 自适应窗口大小调整
 */

const MESSAGE_TYPE_PRIORITY = {
  system: 100,
  user: 80,
  assistant: 60,
  tool_result: 30,
  error: 20,
  thought: 10,
};

// 注入摘要的最大字符数（控制压缩产物大小）
const MAX_SUMMARY_CHARS_FOR_INJECT = 2000;

export class DynamicContextPruning {
  #config;
  #importanceScorer;
  #tokenCounter;
  /** @type {import('./conversation-summarizer.js').ConversationSummarizer|null} */
  #summarizer;

  constructor(options = {}) {
    this.#config = {
      maxTokens: options.maxTokens || 128000,
      targetTokens: options.targetTokens || 64000, // 更激进：80000→64000
      minMessages: options.minMessages || 5,
      preserveSystemPrompt: options.preserveSystemPrompt !== false,
      preserveRecentMessages: options.preserveRecentMessages || 4, // 6→4
      importanceThreshold: options.importanceThreshold || 0.5, // 0.4→0.5，更容易丢弃
      compressionRatio: options.compressionRatio || 0.6, // 0.7→0.6，更激进压缩
      // 新增：摘要模式开关。为 true 时，旧消息用 ConversationSummarizer 压缩而非丢弃
      useSummarization: options.useSummarization !== false, // 默认开启
    };

    this.#importanceScorer = options.importanceScorer || this.#defaultImportanceScorer;
    this.#tokenCounter = options.tokenCounter || this.#defaultTokenCounter;
    this.#summarizer = options.summarizer || null;
  }

  /**
   * 设置摘要器实例（在 agent 初始化时注入）
   * @param {import('./conversation-summarizer.js').ConversationSummarizer} summarizer
   */
  setSummarizer(summarizer) {
    this.#summarizer = summarizer;
  }

  #defaultImportanceScorer(message) {
    const typeWeight = MESSAGE_TYPE_PRIORITY[message.role] || 50;
    const lengthScore = Math.min(message.content?.length || 0 / 500, 1) * 30;
    const hasCode = /```|```[\s\S]*?```|\bfunction\b|\bclass\b|\bconst\b|\blet\b/.test(
      message.content || '',
    )
      ? 20
      : 0;
    const hasKeyTerms =
      /\b(important|critical|must|should|need|require|fix|bug|error|issue)\b/i.test(
        message.content || '',
      )
        ? 15
        : 0;
    const referencesOther = /\b(above|previous|earlier|mentioned|following)\b/i.test(
      message.content || '',
    )
      ? 25
      : 0;

    return Math.min(100, typeWeight + lengthScore + hasCode + hasKeyTerms + referencesOther);
  }

  #defaultTokenCounter(text) {
    if (!text) {
      return 0;
    }
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2.0 + otherChars / 3.5);
  }

  prune(messages, options = {}) {
    const config = { ...this.#config, ...options };

    if (!Array.isArray(messages) || messages.length === 0) {
      return { messages: [], stats: this.#createEmptyStats() };
    }

    const startTokens = this.#calculateTotalTokens(messages, config);

    if (startTokens <= config.targetTokens) {
      return {
        messages: [...messages],
        stats: {
          originalTokens: startTokens,
          prunedTokens: 0,
          messagesRemoved: 0,
          compressionRatio: 1,
        },
      };
    }

    const scoredMessages = messages.map((msg, index) => ({
      ...msg,
      originalIndex: index,
      importance: this.#importanceScorer(msg, index, messages),
      tokenCount: this.#estimateTokens(msg, config),
    }));

    let prunedMessages = this.#pruneByStrategy(scoredMessages, config);
    prunedMessages = this.#ensureRecentMessages(prunedMessages, config);
    prunedMessages = this.#ensureConversationFlow(prunedMessages);
    prunedMessages = this.#compressIfNeeded(prunedMessages, config);
    prunedMessages = this.#injectPruneSummary(scoredMessages, prunedMessages, config);

    const endTokens = this.#calculateTotalTokens(prunedMessages, config);

    return {
      messages: prunedMessages,
      stats: {
        originalTokens: startTokens,
        prunedTokens: startTokens - endTokens,
        messagesRemoved: messages.length - prunedMessages.length,
        compressionRatio: endTokens / startTokens,
        finalTokens: endTokens,
      },
    };
  }

  #pruneByStrategy(messages, config) {
    let remaining = [...messages];
    const toRemove = [];

    const systemMsg = remaining.find((m) => m.role === 'system');
    if (systemMsg && config.preserveSystemPrompt) {
      remaining = remaining.filter((m) => m !== systemMsg);
    }

    const recentMessages = remaining.splice(-config.preserveRecentMessages);

    remaining.sort((a, b) => {
      if (a.importance !== b.importance) {
        return b.importance - a.importance;
      }
      return a.originalIndex - b.originalIndex;
    });

    const currentTokens = this.#calculateTotalTokens([
      ...(systemMsg ? [systemMsg] : []),
      ...recentMessages,
    ]);

    let availableTokens = config.maxTokens - currentTokens;

    for (const msg of remaining) {
      if (availableTokens >= msg.tokenCount) {
        availableTokens -= msg.tokenCount;
      } else if (msg.importance < config.importanceThreshold * 100) {
        toRemove.push(msg);
      } else {
        break;
      }
    }

    const keptMessages = remaining.filter(
      (m) => !toRemove.some((r) => r.originalIndex === m.originalIndex),
    );

    const result = [
      ...(systemMsg ? [systemMsg] : []),
      ...keptMessages.sort((a, b) => a.originalIndex - b.originalIndex),
      ...recentMessages,
    ];

    return result;
  }

  #ensureRecentMessages(messages, config) {
    if (messages.length <= config.preserveRecentMessages) {
      return messages;
    }

    const recentCount = config.preserveRecentMessages;
    const recentMessages = messages.slice(-recentCount);
    const olderMessages = messages.slice(0, -recentCount);

    const recentTokens = this.#calculateTotalTokens(recentMessages);
    const availableForOlder = config.targetTokens - recentTokens;

    if (availableForOlder <= 0) {
      return recentMessages;
    }

    let accumulatedTokens = 0;
    const keptOlder = [];

    for (const msg of olderMessages.reverse()) {
      if (accumulatedTokens + msg.tokenCount <= availableForOlder) {
        accumulatedTokens += msg.tokenCount;
        keptOlder.push(msg);
      } else {
        break;
      }
    }

    return [...keptOlder.reverse(), ...recentMessages];
  }

  #ensureConversationFlow(messages) {
    const result = [];
    let lastRole = null;

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === lastRole) {
        result.push(msg);
      } else {
        result.push(msg);
        lastRole = msg.role;
      }
    }

    return result;
  }

  #compressIfNeeded(messages, config) {
    const currentTokens = this.#calculateTotalTokens(messages);

    if (currentTokens <= config.targetTokens) {
      return messages;
    }

    const compressionFactor = config.targetTokens / currentTokens;
    const targetLength = Math.floor(messages.length * compressionFactor);

    if (targetLength >= messages.length) {
      return messages;
    }

    const scoredMessages = messages.map((msg) => ({
      ...msg,
      importance: this.#importanceScorer(msg),
      tokenCount: this.#estimateTokens(msg, config),
    }));

    scoredMessages.sort((a, b) => b.importance - a.importance);

    let accumulatedTokens = 0;
    const compressed = [];

    for (const msg of scoredMessages) {
      if (compressed.length < targetLength || msg.role === 'system') {
        if (accumulatedTokens + msg.tokenCount <= config.targetTokens) {
          accumulatedTokens += msg.tokenCount;
          compressed.push(msg);
        }
      }
    }

    return compressed.sort((a, b) => a.originalIndex - b.originalIndex);
  }

  #calculateTotalTokens(messages, config) {
    return messages.reduce((sum, msg) => sum + this.#estimateTokens(msg, config), 0);
  }

  #estimateTokens(message, config) {
    const content = message.content || '';
    const role = message.role || '';
    const combined = `${role}: ${content}`;

    let tokens = this.#tokenCounter(combined);

    if (message.name) {
      tokens += this.#tokenCounter(message.name) + 5;
    }

    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        tokens += this.#tokenCounter(call.function?.name || '') + 10;
        tokens += this.#tokenCounter(call.function?.arguments || '') + 5;
      }
    }

    if (message.tool_call_id) {
      tokens += 5;
    }

    return tokens;
  }

  #createEmptyStats() {
    return {
      originalTokens: 0,
      prunedTokens: 0,
      messagesRemoved: 0,
      compressionRatio: 1,
      finalTokens: 0,
    };
  }

  analyzeImportance(messages) {
    return messages.map((msg, index) => ({
      index,
      role: msg.role,
      preview: (msg.content || '').substring(0, 100),
      importance: this.#importanceScorer(msg, index, messages),
      tokens: this.#estimateTokens(msg, this.#config),
    }));
  }

  suggestOptimizations(messages) {
    const analysis = this.analyzeImportance(messages);
    const totalTokens = analysis.reduce((sum, m) => sum + m.tokens, 0);

    const suggestions = [];

    if (totalTokens > this.#config.maxTokens * 0.9) {
      suggestions.push({
        type: 'critical_overflow',
        message: `Context window is at ${((totalTokens / this.#config.maxTokens) * 100).toFixed(1)}% capacity`,
        recommendation: 'Immediate pruning required',
      });
    }

    const lowImportanceCount = analysis.filter((m) => m.importance < 30).length;
    if (lowImportanceCount > 3) {
      suggestions.push({
        type: 'low_importance_messages',
        count: lowImportanceCount,
        message: `${lowImportanceCount} messages have low importance scores`,
        recommendation: 'Consider removing or compressing low-importance messages',
      });
    }

    const toolMessages = analysis.filter((m) => m.role === 'tool');
    if (toolMessages.length > 10) {
      suggestions.push({
        type: 'excessive_tool_results',
        count: toolMessages.length,
        message: `${toolMessages.length} tool results may be bloating context`,
        recommendation: 'Keep only essential tool results',
      });
    }

    return suggestions;
  }

  getConfig() {
    return { ...this.#config };
  }

  updateConfig(newConfig) {
    this.#config = { ...this.#config, ...newConfig };
  }
  /**
   * 将旧消息压缩为富语义摘要。
   *
   * 与 prune() 的区别：
   *  - prune() 丢弃消息，只生成极简计数摘要
   *  - compress() 将所有旧消息通过 ConversationSummarizer 压缩为密集语义块
   *
   * @param {Array} messages - 全部消息（含 system prompt）
   * @param {object} [options]
   * @returns {{ messages: Array, stats: object }}
   */
  compress(messages, options = {}) {
    const config = { ...this.#config, ...options };

    if (!Array.isArray(messages) || messages.length === 0) {
      return { messages: [], stats: this.#createEmptyStats() };
    }

    const startTokens = this.#calculateTotalTokens(messages, config);
    if (startTokens <= config.targetTokens) {
      return {
        messages: [...messages],
        stats: {
          originalTokens: startTokens,
          prunedTokens: 0,
          messagesRemoved: 0,
          compressionRatio: 1,
          finalTokens: startTokens,
        },
      };
    }

    // 提取 system prompt（始终保留）
    const systemMessages = [];
    const nonSystemMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        nonSystemMessages.push(msg);
      }
    }

    const preserveRecent = config.preserveRecentMessages || 4;
    // 最近 N 条消息保留原文
    const recentMessages = nonSystemMessages.splice(-preserveRecent);
    const recentTokens = this.#calculateTotalTokens(recentMessages, config);
    const systemTokens = this.#calculateTotalTokens(systemMessages, config);
    const availableForCompressed = config.targetTokens - systemTokens - recentTokens;

    // 如果连最近消息+system 都放不下，缩减最近消息
    if (availableForCompressed <= 200) {
      // 极端情况：只保留最少消息
      const minRecent = Math.max(2, Math.floor(preserveRecent / 2));
      const trimmedRecent = recentMessages.slice(-minRecent);
      return {
        messages: [...systemMessages, ...trimmedRecent],
        stats: {
          originalTokens: startTokens,
          prunedTokens: startTokens - this.#calculateTotalTokens([...systemMessages, ...trimmedRecent], config),
          messagesRemoved: messages.length - systemMessages.length - trimmedRecent.length,
          compressionRatio: 0.3,
          finalTokens: this.#calculateTotalTokens([...systemMessages, ...trimmedRecent], config),
          summaryGenerated: true,
        },
      };
    }

    // 中间消息 → 摘要压缩
    let summaryContent;
    if (this.#summarizer && nonSystemMessages.length > 0) {
      // 使用 ConversationSummarizer 生成富语义摘要
      const maxSummaryChars = Math.min(MAX_SUMMARY_CHARS_FOR_INJECT, Math.floor(availableForCompressed * 3));
      summaryContent = this.#summarizer.summarize(nonSystemMessages, { maxChars: maxSummaryChars });
    } else {
      // 回退：简单的消息计数摘要
      summaryContent = this.#buildFallbackSummary(nonSystemMessages);
    }

    // 摘要作为 system message 注入（高 importance，永远不会被裁剪）
    const summaryMessage = {
      role: 'system',
      content: summaryContent || `[${nonSystemMessages.length} earlier messages compressed]`,
      originalIndex: -100,
      importance: 100,
      tokenCount: this.#tokenCounter(summaryContent || ''),
    };

    const finalMessages = [...systemMessages, summaryMessage, ...recentMessages];
    const endTokens = this.#calculateTotalTokens(finalMessages, config);

    return {
      messages: finalMessages,
      stats: {
        originalTokens: startTokens,
        prunedTokens: startTokens - endTokens,
        messagesRemoved: nonSystemMessages.length,
        compressionRatio: endTokens / startTokens,
        finalTokens: endTokens,
        summaryGenerated: true,
        compressedCount: nonSystemMessages.length,
      },
    };
  }

  #buildFallbackSummary(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';

    const parts = [];

    const userMsgs = messages.filter((m) => m.role === 'user');
    if (userMsgs.length > 0) {
      const topics = userMsgs
        .map((m) => String(m.content || '').split(/[.!?\n]/)[0]?.trim().slice(0, 120))
        .filter(Boolean);
      if (topics.length > 0) {
        parts.push(`User requests (${topics.length}): ${topics.slice(0, 5).join(' | ')}`);
      }
    }

    const toolMsgs = messages.filter((m) => m.role === 'tool' || m.role === 'tool_result');
    if (toolMsgs.length > 0) {
      parts.push(`Tool results: ${toolMsgs.length} operations`);
    }

    const asstMsgs = messages.filter((m) => m.role === 'assistant');
    if (asstMsgs.length > 0) {
      const decisions = asstMsgs.filter((m) =>
        /\b(decision|will|should|must|need to|plan to|decided|discovered|found)\b/i.test(
          String(m.content || ''),
        ),
      );
      parts.push(
        `Assistant responses: ${asstMsgs.length}${decisions.length > 0 ? ` (${decisions.length} with decisions)` : ''}`,
      );
    }

    return parts.length > 0
      ? `[Context summary: ${parts.join('. ')}]`
      : `[${messages.length} earlier messages compressed]`;
  }

  #injectPruneSummary(allMessages, prunedMessages, config) {
    if (prunedMessages.length === allMessages.length) {
      return prunedMessages;
    }

    const prunedIndices = new Set(prunedMessages.map((m) => m.originalIndex));
    const removed = allMessages.filter((m) => !prunedIndices.has(m.originalIndex));

    // 如果有 summarizer，用它生成富摘要
    if (this.#summarizer && removed.length > 0) {
      const summaryText = this.#summarizer.summarize(removed, {
        maxChars: MAX_SUMMARY_CHARS_FOR_INJECT,
      });
      const summary = {
        role: 'system',
        content: summaryText,
        originalIndex: -10,
        importance: 100,
        tokenCount: this.#tokenCounter(summaryText),
      };
      return [summary, ...prunedMessages];
    }

    // 回退：旧版简单摘要
    const summaryParts = [];

    const userMessages = removed.filter((m) => m.role === 'user');
    if (userMessages.length > 0) {
      const userTopics = userMessages
        .map((m) => {
          const content = String(m.content || '');
          const firstSentence = content.split(/[.!?。！？\n]/)[0] || '';
          return (
            firstSentence.length > 200 ? firstSentence.substring(0, 200) + '...' : firstSentence
          ).trim();
        })
        .filter(Boolean);

      if (userTopics.length > 0) {
        summaryParts.push(`User topics (${userTopics.length}): ${userTopics.join(' | ')}`);
      }
    }

    const toolResults = removed.filter((m) => m.role === 'tool' || m.role === 'tool_result');
    if (toolResults.length > 0) {
      summaryParts.push(`Tool results: ${toolResults.length} operations`);
    }

    const assistantMessages = removed.filter((m) => m.role === 'assistant');
    if (assistantMessages.length > 0) {
      const hasCompletion = assistantMessages.some(
        (m) =>
          String(m.content || '')
            .toLowerCase()
            .includes('final') ||
          String(m.content || '')
            .toLowerCase()
            .includes('complete') ||
          String(m.content || '')
            .toLowerCase()
            .includes('done'),
      );
      if (hasCompletion) {
        summaryParts.push('Note: Prior assistant responses included task completion');
      }
      summaryParts.push(`Assistant responses: ${assistantMessages.length}`);
    }

    if (summaryParts.length === 0) {
      return prunedMessages;
    }

    const summaryText = '[Context summary: ' + summaryParts.join('. ') + ']';
    const summary = {
      role: 'system',
      content: summaryText,
      originalIndex: -10,
      importance: 100,
      tokenCount: this.#estimateTokens({ role: 'system', content: summaryText }, config),
    };

    return [summary, ...prunedMessages];
  }
}

export default DynamicContextPruning;
