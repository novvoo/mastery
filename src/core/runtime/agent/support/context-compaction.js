export class ContextCompactionManager {
  constructor(options = {}) {
    this.#targetTokens = options.targetTokens ?? 10000;
    this.#minTokens = options.minTokens ?? 5000;
    this.#maxMessages = options.maxMessages ?? 50;
    this.#compactionRatio = options.compactionRatio ?? 0.5;
    this.#onCompaction = options.onCompaction ?? (() => {});
  }

  #targetTokens;
  #minTokens;
  #maxMessages;
  #compactionRatio;
  #onCompaction;

  shouldCompact(messages, tokenCount) {
    return tokenCount > this.#targetTokens || messages.length > this.#maxMessages;
  }

  compact(messages, tokenEstimator) {
    if (messages.length <= 2) return messages;

    const compacted = [...messages];
    let totalTokens = tokenEstimator(compacted);

    while (totalTokens > this.#minTokens && compacted.length > 2) {
      const middleIndex = Math.floor(compacted.length / 2);
      const messageToCompact = compacted[middleIndex];

      if (messageToCompact.role === 'toolResult' || messageToCompact.role === 'assistant') {
        const summarized = this.#summarizeMessage(messageToCompact);
        compacted[middleIndex] = summarized;
      } else {
        compacted.splice(middleIndex, 1);
      }

      totalTokens = tokenEstimator(compacted);
    }

    this.#onCompaction({
      originalCount: messages.length,
      compactedCount: compacted.length,
      originalTokens: tokenEstimator(messages),
      compactedTokens: totalTokens,
    });

    return compacted;
  }

  compactByRatio(messages, tokenEstimator, ratio = null) {
    const targetRatio = ratio ?? this.#compactionRatio;
    const currentTokens = tokenEstimator(messages);
    const targetTokens = Math.floor(currentTokens * targetRatio);

    return this.#compactToTarget(messages, tokenEstimator, targetTokens);
  }

  compactToTarget(messages, tokenEstimator, targetTokens) {
    return this.#compactToTarget(messages, tokenEstimator, targetTokens);
  }

  #compactToTarget(messages, tokenEstimator, targetTokens) {
    if (messages.length <= 2) return messages;

    const compacted = [...messages];
    let totalTokens = tokenEstimator(compacted);

    if (totalTokens <= targetTokens) return compacted;

    while (totalTokens > targetTokens && compacted.length > 2) {
      const priority = this.#calculateCompactionPriority(compacted);
      const lowestPriorityIndex = priority.indexOf(Math.min(...priority));

      const message = compacted[lowestPriorityIndex];
      if (message.role === 'toolResult' || message.role === 'assistant') {
        const summarized = this.#summarizeMessage(message);
        compacted[lowestPriorityIndex] = summarized;
      } else {
        compacted.splice(lowestPriorityIndex, 1);
      }

      totalTokens = tokenEstimator(compacted);
    }

    return compacted;
  }

  #calculateCompactionPriority(messages) {
    return messages.map((msg, index) => {
      let score = 0;

      if (msg.role === 'user') score += 100;
      if (msg.role === 'system') score += 80;
      if (msg.role === 'assistant') score += 30;
      if (msg.role === 'toolResult') score += 20;

      if (index === 0 || index === messages.length - 1) score += 50;

      const recencyBonus = Math.max(0, 10 - (messages.length - 1 - index));
      score += recencyBonus;

      return score;
    });
  }

  #summarizeMessage(message) {
    const content =
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const maxLength = Math.max(100, Math.floor(content.length * 0.3));

    if (content.length <= maxLength) return message;

    const summary = content.substring(0, maxLength - 3) + '...';

    return {
      ...message,
      content: summary,
      compacted: true,
      originalLength: content.length,
    };
  }

  static estimateTokens(messages) {
    let total = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      total += Math.ceil(content.length / 4);
      if (msg.role) total += 10;
      if (msg.toolName) total += 20;
    }
    return total;
  }
}
