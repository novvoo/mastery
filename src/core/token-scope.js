/**
 * TokenScope - Token 使用情况和成本分析模块
 * 核心功能：
 * - 实时 Token 统计和追踪
 * - 多模型成本计算
 * - 历史使用报告
 * - 预算监控和告警
 */

const DEFAULT_PRICING = {
  'gpt-4o': { input: 5.00, output: 15.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-3-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3.5-haiku': { input: 0.80, output: 4.00 },
  'gemini-1.5-pro': { input: 3.50, output: 10.50 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

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
      userId,
      timestamp = Date.now(),
      requestId,
      metadata = {},
    } = request;

    const cost = this.calculateCost(model, inputTokens, outputTokens);

    const record = {
      requestId: requestId || this.generateId(),
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
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

  calculateCost(model, inputTokens, outputTokens) {
    const pricing = this.#pricing[model];
    if (!pricing) return 0;

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  #checkBudget(userId, currentCost) {
    const budget = this.#budgetLimits[userId];
    if (!budget) return;

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
      { inputTokens: 0, outputTokens: 0, cost: 0 }
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
    if (history.length === 0) return [];

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
        buckets - 1
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
