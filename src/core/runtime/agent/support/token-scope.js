/**
 * TokenScope - Token 使用情况和成本分析模块
 * 核心功能：
 * - 实时 Token 统计和追踪
 * - 多模型成本计算
 * - 历史使用报告
 * - 预算监控和告警
 */

const DEFAULT_PRICING = {
  'gpt-4o': { input: 5.0, output: 15.0, cacheRead: 1.25, cacheWrite: 5.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 },
  'gpt-4-turbo': { input: 10.0, output: 30.0, cacheRead: 2.5, cacheWrite: 10.0 },
  'gpt-4': { input: 30.0, output: 60.0, cacheRead: 7.5, cacheWrite: 30.0 },
  'claude-3-opus': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-3-sonnet': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheRead: 0.025, cacheWrite: 0.3125 },
  'claude-3.5-sonnet': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3.5-haiku': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  'gemini-1.5-pro': { input: 3.5, output: 10.5, cacheRead: 0.875, cacheWrite: 3.5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0.075 },
};

const DEFAULT_UNKNOWN_MODEL_COST = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };

export class TokenScope {
  #sessionStats;
  #requestHistory;
  #budgetLimits;
  #pricing;
  #callbacks;

  constructor(options = {}) {
    this.#sessionStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      totalCost: 0,
      startTime: Date.now(),
      byModel: {},
      byUser: {},
    };
    this.#requestHistory = [];
    this.#budgetLimits = options.budgetLimits || {};
    this.#pricing = { ...DEFAULT_PRICING, ...options.pricing };
    this.#callbacks = {
      onBudgetWarning: options.onBudgetWarning || null,
      onBudgetExceeded: options.onBudgetExceeded || null,
    };
  }

  recordRequest(request) {
    const {
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens = 0,
      cacheWriteTokens = 0,
      userId,
      timestamp = Date.now(),
      requestId,
      metadata = {},
    } = request;

    const cost = this.calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);

    const record = {
      requestId: requestId || this.generateId(),
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      cost,
      userId,
      timestamp,
      metadata,
    };

    this.#requestHistory.push(record);

    this.#sessionStats.totalInputTokens += inputTokens;
    this.#sessionStats.totalOutputTokens += outputTokens;
    this.#sessionStats.totalRequests += 1;
    this.#sessionStats.totalCost += cost;

    if (!this.#sessionStats.byModel[model]) {
      this.#sessionStats.byModel[model] = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
      };
    }
    this.#sessionStats.byModel[model].requests++;
    this.#sessionStats.byModel[model].inputTokens += inputTokens;
    this.#sessionStats.byModel[model].outputTokens += outputTokens;
    this.#sessionStats.byModel[model].cost += cost;

    if (userId) {
      if (!this.#sessionStats.byUser[userId]) {
        this.#sessionStats.byUser[userId] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        };
      }
      this.#sessionStats.byUser[userId].requests++;
      this.#sessionStats.byUser[userId].inputTokens += inputTokens;
      this.#sessionStats.byUser[userId].outputTokens += outputTokens;
      this.#sessionStats.byUser[userId].cost += cost;

      this.#checkBudget(userId, this.#sessionStats.byUser[userId].cost);
    }

    return record;
  }

  calculateCost(model, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
    const pricing = this.#pricing[model];
    if (!pricing) {
      // Unknown model: use default cost and track it
      this.#trackUnknownModel(model);
      const fallback = DEFAULT_UNKNOWN_MODEL_COST;
      const inputCost = (inputTokens / 1_000_000) * fallback.input;
      const outputCost = (outputTokens / 1_000_000) * fallback.output;
      const cacheReadCost = (cacheReadTokens / 1_000_000) * fallback.cacheRead;
      const cacheWriteCost = (cacheWriteTokens / 1_000_000) * fallback.cacheWrite;
      return inputCost + outputCost + cacheReadCost + cacheWriteCost;
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const cacheReadCost = pricing.cacheRead !== undefined ? (cacheReadTokens / 1_000_000) * pricing.cacheRead : 0;
    const cacheWriteCost = pricing.cacheWrite !== undefined ? (cacheWriteTokens / 1_000_000) * pricing.cacheWrite : 0;

    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  #unknownModels = new Set();

  #trackUnknownModel(model) {
    if (!this.#unknownModels.has(model)) {
      this.#unknownModels.add(model);
      console.warn(`[TokenScope] Unknown model "${model}" — using default pricing fallback`);
    }
  }

  getUnknownModels() {
    return [...this.#unknownModels];
  }

  #checkBudget(userId, currentCost) {
    const budget = this.#budgetLimits[userId];
    if (!budget) {
      return;
    }

    const percentage = (currentCost / budget.limit) * 100;

    if (percentage >= 100 && this.#callbacks.onBudgetExceeded) {
      this.#callbacks.onBudgetExceeded({ userId, cost: currentCost, limit: budget.limit });
    } else if (percentage >= budget.warningThreshold && this.#callbacks.onBudgetWarning) {
      this.#callbacks.onBudgetWarning({
        userId,
        cost: currentCost,
        limit: budget.limit,
        percentage: percentage.toFixed(1),
      });
    }
  }

  setBudgetLimit(userId, limit, warningThreshold = 80) {
    this.#budgetLimits[userId] = { limit, warningThreshold };
  }

  getStats() {
    const duration = Date.now() - this.#sessionStats.startTime;
    return {
      ...this.#sessionStats,
      duration,
      averageTokensPerRequest:
        this.#sessionStats.totalRequests > 0
          ? (
              (this.#sessionStats.totalInputTokens + this.#sessionStats.totalOutputTokens) /
              this.#sessionStats.totalRequests
            ).toFixed(1)
          : 0,
      costPerMinute: ((this.#sessionStats.totalCost / duration) * 60000).toFixed(6),
    };
  }

  getModelBreakdown() {
    return { ...this.#sessionStats.byModel };
  }

  getUserBreakdown() {
    return { ...this.#sessionStats.byUser };
  }

  getHistory(filter = {}) {
    let history = [...this.#requestHistory];

    if (filter.model) {
      history = history.filter((r) => r.model === filter.model);
    }
    if (filter.userId) {
      history = history.filter((r) => r.userId === filter.userId);
    }
    if (filter.startTime) {
      history = history.filter((r) => r.timestamp >= filter.startTime);
    }
    if (filter.endTime) {
      history = history.filter((r) => r.timestamp <= filter.endTime);
    }

    return history;
  }

  generateReport(timeRange = 'session') {
    const now = Date.now();
    let startTime;

    switch (timeRange) {
      case 'hour':
        startTime = now - 3600000;
        break;
      case 'day':
        startTime = now - 86400000;
        break;
      case 'week':
        startTime = now - 604800000;
        break;
      default:
        startTime = this.#sessionStats.startTime;
    }

    const filteredHistory = this.getHistory({ startTime });
    const stats = this.calculateStatsFromHistory(filteredHistory);

    return {
      timeRange,
      period: {
        start: new Date(startTime).toISOString(),
        end: new Date(now).toISOString(),
        duration: now - startTime,
      },
      ...stats,
      topModels: this.getTopModels(filteredHistory, 5),
      costTrend: this.getCostTrend(filteredHistory),
    };
  }

  calculateStatsFromHistory(history) {
    if (history.length === 0) {
      return {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        averageCostPerRequest: 0,
      };
    }

    const totals = history.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        cost: acc.cost + r.cost,
      }),
      { inputTokens: 0, outputTokens: 0, cost: 0 },
    );

    return {
      totalRequests: history.length,
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalTokens: totals.inputTokens + totals.outputTokens,
      totalCost: totals.cost,
      averageCostPerRequest: totals.cost / history.length,
    };
  }

  getTopModels(history, limit = 5) {
    const modelStats = {};
    for (const record of history) {
      if (!modelStats[record.model]) {
        modelStats[record.model] = { cost: 0, requests: 0, tokens: 0 };
      }
      modelStats[record.model].cost += record.cost;
      modelStats[record.model].requests++;
      modelStats[record.model].tokens += record.totalTokens;
    }

    return Object.entries(modelStats)
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, limit)
      .map(([model, stats]) => ({ model, ...stats }));
  }

  getCostTrend(history) {
    if (history.length === 0) {
      return [];
    }

    const buckets = 24;
    const now = Date.now();
    const startTime = history[0]?.timestamp || now;
    const range = now - startTime;
    const bucketSize = range / buckets || 1;

    const bucketsData = Array(buckets)
      .fill(null)
      .map((_, i) => ({
        start: startTime + i * bucketSize,
        end: startTime + (i + 1) * bucketSize,
        cost: 0,
        requests: 0,
      }));

    for (const record of history) {
      const bucketIndex = Math.min(
        Math.floor((record.timestamp - startTime) / bucketSize),
        buckets - 1,
      );
      if (bucketIndex >= 0) {
        bucketsData[bucketIndex].cost += record.cost;
        bucketsData[bucketIndex].requests++;
      }
    }

    return bucketsData;
  }

  reset() {
    this.#sessionStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      totalCost: 0,
      startTime: Date.now(),
      byModel: {},
      byUser: {},
    };
    this.#requestHistory = [];
  }

  exportData() {
    return {
      session: this.getStats(),
      modelBreakdown: this.getModelBreakdown(),
      userBreakdown: this.getUserBreakdown(),
      history: this.#requestHistory,
    };
  }

  generateId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default TokenScope;
