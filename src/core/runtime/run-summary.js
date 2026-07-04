/**
 * Run Summary — 运行统计聚合
 *
 * 参考 oh-my-pi 的 AgentRunSummary 设计理念：
 * - 纯数据对象，安全可序列化/持久化
 * - 聚合 token 用量、工具调用、成本、错误等统计
 * - 在 agent_end 事件中返回，供 UI 展示、评估测试、成本监控使用
 *
 * 使用方式：
 *   const collector = new RunSummaryCollector();
 *   collector.recordToolStart('read_file');
 *   collector.recordToolEnd('read_file', true, 150);
 *   collector.recordTokenUsage({ inputTokens: 1000, outputTokens: 500 });
 *   const summary = collector.summary;
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 每个工具的统计计数
 * @typedef {object} ToolCounters
 * @property {number} total - 总调用次数
 * @property {number} ok - 成功次数
 * @property {number} error - 失败次数
 * @property {number} totalLatencyMs - 总延迟
 */

/**
 * 运行汇总统计
 * @typedef {object} RunSummary
 * @property {object} chats
 * @property {number} chats.total - LLM 调用总次数
 * @property {Record<string, number>} chats.byStopReason - 按停止原因分组
 * @property {number} chats.totalLatencyMs - 总延迟
 *
 * @property {object} tools
 * @property {number} tools.total - 工具总调用次数
 * @property {number} tools.ok - 成功次数
 * @property {number} tools.error - 失败次数
 * @property {number} tools.totalLatencyMs - 工具总延迟
 * @property {Record<string, ToolCounters>} tools.byName - 按工具名分组
 *
 * @property {object} usage
 * @property {number} usage.inputTokens - 输入 token
 * @property {number} usage.outputTokens - 输出 token
 * @property {number} usage.reasoningOutputTokens - 推理输出 token
 * @property {number} usage.cachedInputTokens - 缓存输入 token
 * @property {number} usage.totalTokens - 总 token
 *
 * @property {object} cost
 * @property {number} cost.estimatedUsd - 预估成本（美元）
 *
 * @property {object} errors
 * @property {number} errors.total - 错误总数
 * @property {Record<string, number>} errors.byType - 按错误类型分组
 *
 * @property {object} phases
 * @property {Record<string, number>} phases.durationMs - 各阶段耗时
 * @property {string[]} phases.sequence - 阶段流转顺序
 *
 * @property {number} stepCount - 总迭代步数
 * @property {number} durationMs - 总耗时
 */

// ============================================================================
// RunSummaryCollector — 运行统计收集器
// ============================================================================

export class RunSummaryCollector {
  // ── 内部状态 ────────────────────────────────────────────────────────

  #chats = {
    total: 0,
    byStopReason: {},
    totalLatencyMs: 0,
  };

  #toolsTotal = 0;
  #toolsOk = 0;
  #toolsError = 0;
  #toolsLatencyMs = 0;
  #toolsByName = new Map(); // toolName -> ToolCounters

  #usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  };

  #cost = {
    estimatedUsd: 0,
  };

  #errors = {
    total: 0,
    byType: {},
  };

  #phases = {
    durationMs: {},
    sequence: [],
    currentPhase: null,
    currentPhaseStart: 0,
  };

  #stepCount = 0;
  #runEnded = false;

  // ── 公共 API ────────────────────────────────────────────────────────

  /** 是否已标记结束 */
  get runEnded() {
    return this.#runEnded;
  }

  /** 迭代步数 */
  get stepCount() {
    return this.#stepCount;
  }

  /**
   * 获取当前汇总（实时计算）
   * @returns {RunSummary}
   */
  get summary() {
    return this.#buildSummary();
  }

  // ── LLM 调用 ────────────────────────────────────────────────────────

  /**
   * 记录一次 LLM 调用开始
   * @param {object} [options]
   * @param {string} [options.model]
   */
  recordChatStart(options = {}) {
    this.#stepCount++;
    this.#chats.total++;
  }

  /**
   * 记录一次 LLM 调用结束
   * @param {object} options
   * @param {string} [options.stopReason]
   * @param {number} [options.latencyMs]
   */
  recordChatEnd(options = {}) {
    const { stopReason = 'unknown', latencyMs = 0 } = options;
    this.#chats.byStopReason[stopReason] = (this.#chats.byStopReason[stopReason] || 0) + 1;
    this.#chats.totalLatencyMs += latencyMs;
  }

  // ── 工具调用 ────────────────────────────────────────────────────────

  /**
   * 记录工具调用开始
   * @param {string} toolName
   */
  recordToolStart(toolName) {
    this.#toolsTotal++;
    const counters = this.#getOrCreateToolCounters(toolName);
    counters.total++;
  }

  /**
   * 记录工具调用结束
   * @param {string} toolName
   * @param {boolean} isOk - 是否成功
   * @param {number} [latencyMs] - 耗时
   */
  recordToolEnd(toolName, isOk, latencyMs = 0) {
    const counters = this.#getOrCreateToolCounters(toolName);
    if (isOk) {
      this.#toolsOk++;
      counters.ok++;
    } else {
      this.#toolsError++;
      counters.error++;
    }
    this.#toolsLatencyMs += latencyMs;
    counters.totalLatencyMs += latencyMs;
  }

  // ── Token 用量 ────────────────────────────────────────────────────

  /**
   * 记录 token 用量
   * @param {object} usage
   * @param {number} [usage.inputTokens]
   * @param {number} [usage.outputTokens]
   * @param {number} [usage.reasoningOutputTokens]
   * @param {number} [usage.cachedInputTokens]
   */
  recordTokenUsage(usage = {}) {
    const input = usage.inputTokens || 0;
    const output = usage.outputTokens || 0;
    const reasoning = usage.reasoningOutputTokens || 0;
    const cached = usage.cachedInputTokens || 0;

    this.#usage.inputTokens += input;
    this.#usage.outputTokens += output;
    this.#usage.reasoningOutputTokens += reasoning;
    this.#usage.cachedInputTokens += cached;
    this.#usage.totalTokens += input + output;
  }

  // ── 成本 ──────────────────────────────────────────────────────────

  /**
   * 记录成本（累加）
   * @param {number} usd
   */
  recordCost(usd) {
    this.#cost.estimatedUsd += usd || 0;
  }

  // ── 错误 ──────────────────────────────────────────────────────────

  /**
   * 记录错误
   * @param {string} errorType - 错误类型
   * @param {Error} [error]
   */
  recordError(errorType, error) {
    const type = errorType || error?.name || 'unknown';
    this.#errors.total++;
    this.#errors.byType[type] = (this.#errors.byType[type] || 0) + 1;
  }

  // ── 阶段追踪 ──────────────────────────────────────────────────────

  /**
   * 进入新阶段
   * @param {string} phase - 阶段名
   * @param {number} [timestamp=Date.now()]
   */
  recordPhaseChange(phase, timestamp = Date.now()) {
    // 结束上一个阶段
    if (this.#phases.currentPhase && this.#phases.currentPhaseStart > 0) {
      const duration = timestamp - this.#phases.currentPhaseStart;
      const prev = this.#phases.currentPhase;
      this.#phases.durationMs[prev] = (this.#phases.durationMs[prev] || 0) + duration;
    }

    // 开始新阶段
    this.#phases.currentPhase = phase;
    this.#phases.currentPhaseStart = timestamp;
    this.#phases.sequence.push(phase);
  }

  /**
   * 结束所有阶段追踪（在 run 结束时调用）
   * @param {number} [timestamp=Date.now()]
   */
  finalizePhases(timestamp = Date.now()) {
    if (this.#phases.currentPhase && this.#phases.currentPhaseStart > 0) {
      const duration = timestamp - this.#phases.currentPhaseStart;
      const prev = this.#phases.currentPhase;
      this.#phases.durationMs[prev] = (this.#phases.durationMs[prev] || 0) + duration;
    }
    this.#phases.currentPhase = null;
    this.#phases.currentPhaseStart = 0;
  }

  // ── 运行结束 ──────────────────────────────────────────────────────

  /**
   * 标记运行结束
   * @param {number} [totalDurationMs]
   * @returns {RunSummary}
   */
  markRunEnded(totalDurationMs = 0) {
    if (this.#runEnded) return this.#buildSummary(totalDurationMs);
    this.#runEnded = true;
    this.finalizePhases();
    return this.#buildSummary(totalDurationMs);
  }

  /**
   * 重置收集器
   */
  reset() {
    this.#chats = { total: 0, byStopReason: {}, totalLatencyMs: 0 };
    this.#toolsTotal = 0;
    this.#toolsOk = 0;
    this.#toolsError = 0;
    this.#toolsLatencyMs = 0;
    this.#toolsByName.clear();
    this.#usage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
    };
    this.#cost = { estimatedUsd: 0 };
    this.#errors = { total: 0, byType: {} };
    this.#phases = { durationMs: {}, sequence: [], currentPhase: null, currentPhaseStart: 0 };
    this.#stepCount = 0;
    this.#runEnded = false;
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  /**
   * 获取或创建工具统计
   * @param {string} toolName
   * @returns {ToolCounters}
   * @private
   */
  #getOrCreateToolCounters(toolName) {
    let counters = this.#toolsByName.get(toolName);
    if (!counters) {
      counters = { total: 0, ok: 0, error: 0, totalLatencyMs: 0 };
      this.#toolsByName.set(toolName, counters);
    }
    return counters;
  }

  /**
   * 构建汇总对象
   * @param {number} [totalDurationMs]
   * @returns {RunSummary}
   * @private
   */
  #buildSummary(totalDurationMs = 0) {
    // 把 Map 转成 plain object，按工具名排序
    const byName = {};
    const sortedNames = Array.from(this.#toolsByName.keys()).sort();
    for (const name of sortedNames) {
      byName[name] = { ...this.#toolsByName.get(name) };
    }

    return {
      chats: {
        total: this.#chats.total,
        byStopReason: { ...this.#chats.byStopReason },
        totalLatencyMs: this.#chats.totalLatencyMs,
      },
      tools: {
        total: this.#toolsTotal,
        ok: this.#toolsOk,
        error: this.#toolsError,
        totalLatencyMs: this.#toolsLatencyMs,
        byName,
      },
      usage: { ...this.#usage },
      cost: { ...this.#cost },
      errors: {
        total: this.#errors.total,
        byType: { ...this.#errors.byType },
      },
      phases: {
        durationMs: { ...this.#phases.durationMs },
        sequence: [...this.#phases.sequence],
      },
      stepCount: this.#stepCount,
      durationMs: totalDurationMs,
    };
  }
}

// ============================================================================
// 聚合工具函数
// ============================================================================

/**
 * 聚合多个 RunSummary 为一个
 * 用于评估测试中多次运行的汇总统计
 *
 * @param {RunSummary[]} summaries
 * @returns {RunSummary}
 */
export function aggregateRunSummaries(summaries) {
  const aggregated = {
    chats: { total: 0, byStopReason: {}, totalLatencyMs: 0 },
    tools: { total: 0, ok: 0, error: 0, totalLatencyMs: 0, byName: {} },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
    },
    cost: { estimatedUsd: 0 },
    errors: { total: 0, byType: {} },
    phases: { durationMs: {}, sequence: [] },
    stepCount: 0,
    durationMs: 0,
  };

  for (const s of summaries) {
    // chats
    aggregated.chats.total += s.chats?.total || 0;
    aggregated.chats.totalLatencyMs += s.chats?.totalLatencyMs || 0;
    if (s.chats?.byStopReason) {
      for (const [reason, count] of Object.entries(s.chats.byStopReason)) {
        aggregated.chats.byStopReason[reason] =
          (aggregated.chats.byStopReason[reason] || 0) + count;
      }
    }

    // tools
    aggregated.tools.total += s.tools?.total || 0;
    aggregated.tools.ok += s.tools?.ok || 0;
    aggregated.tools.error += s.tools?.error || 0;
    aggregated.tools.totalLatencyMs += s.tools?.totalLatencyMs || 0;
    if (s.tools?.byName) {
      for (const [name, counters] of Object.entries(s.tools.byName)) {
        if (!aggregated.tools.byName[name]) {
          aggregated.tools.byName[name] = { total: 0, ok: 0, error: 0, totalLatencyMs: 0 };
        }
        aggregated.tools.byName[name].total += counters.total || 0;
        aggregated.tools.byName[name].ok += counters.ok || 0;
        aggregated.tools.byName[name].error += counters.error || 0;
        aggregated.tools.byName[name].totalLatencyMs += counters.totalLatencyMs || 0;
      }
    }

    // usage
    aggregated.usage.inputTokens += s.usage?.inputTokens || 0;
    aggregated.usage.outputTokens += s.usage?.outputTokens || 0;
    aggregated.usage.reasoningOutputTokens += s.usage?.reasoningOutputTokens || 0;
    aggregated.usage.cachedInputTokens += s.usage?.cachedInputTokens || 0;
    aggregated.usage.totalTokens += s.usage?.totalTokens || 0;

    // cost
    aggregated.cost.estimatedUsd += s.cost?.estimatedUsd || 0;

    // errors
    aggregated.errors.total += s.errors?.total || 0;
    if (s.errors?.byType) {
      for (const [type, count] of Object.entries(s.errors.byType)) {
        aggregated.errors.byType[type] = (aggregated.errors.byType[type] || 0) + count;
      }
    }

    // step & duration
    aggregated.stepCount += s.stepCount || 0;
    aggregated.durationMs += s.durationMs || 0;
  }

  return aggregated;
}

/**
 * 空的 RunSummary 常量（用于默认值）
 * @type {RunSummary}
 */
export const EMPTY_RUN_SUMMARY = Object.freeze({
  chats: Object.freeze({ total: 0, byStopReason: Object.freeze({}), totalLatencyMs: 0 }),
  tools: Object.freeze({ total: 0, ok: 0, error: 0, totalLatencyMs: 0, byName: Object.freeze({}) }),
  usage: Object.freeze({
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  }),
  cost: Object.freeze({ estimatedUsd: 0 }),
  errors: Object.freeze({ total: 0, byType: Object.freeze({}) }),
  phases: Object.freeze({ durationMs: Object.freeze({}), sequence: Object.freeze([]) }),
  stepCount: 0,
  durationMs: 0,
});

export default {
  RunSummaryCollector,
  aggregateRunSummaries,
  EMPTY_RUN_SUMMARY,
};
