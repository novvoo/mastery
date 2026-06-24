/**
 * ExecutionFeedbackLoop — 方法论 ↔ Plan ↔ Hashline 反向反馈闭环
 *
 * 三个闭环链路：
 *   1. Plan 执行结果 → Methodology 调优 (IntentClassifier / GraphPlanner 策略改进)
 *   2. Hashline 冲突信号 → Plan 动态重规划 (replan)
 *   3. 跨 run 模式学习 → 后续分类/分解更准确
 *
 * 核心数据结构：
 *   ExecutionRecord   — 单次 plan 执行的全量摘要
 *   DecompositionPattern — 一种分解模式的成功率统计
 *   ConflictPattern  — Hashline 冲突类型及其恢复策略
 */

// ──────────────────────────── 数据结构 ────────────────────────────

/**
 * 单次执行摘要
 */
class ExecutionRecord {
  constructor(data = {}) {
    this.runId = data.runId || '';
    this.taskType = data.taskType || 'coding'; // coding | bug_fix | modification | ...
    this.decompositionMode = data.decompositionMode || 'template'; // llm | template
    this.intent = data.intent || '';
    this.intentConfidence = data.intentConfidence ?? 0;
    this.success = data.success ?? false;
    this.reason = data.reason || '';
    this.durationMs = data.durationMs ?? 0;
    this.iterations = data.iterations ?? 0;
    this.toolCount = data.toolCount ?? 0;

    // 各阶段完成情况
    this.phasesCompleted = data.phasesCompleted || []; // ['exploration','planning',...]
    this.phaseTimings = data.phaseTimings || {}; // { exploration: 1200, ... }

    // Hashline 相关
    this.hashlineConflicts = data.hashlineConflicts ?? 0;
    this.hashlineRollbacks = data.hashlineRollbacks ?? 0;
    this.hashlineAutoRepairs = data.hashlineAutoRepairs ?? 0;

    // 子任务统计
    this.totalSubtasks = data.totalSubtasks ?? 0;
    this.completedSubtasks = data.completedSubtasks ?? 0;
    this.failedSubtasks = data.failedSubtasks ?? 0;

    // 工具效率
    this.toolSuccessRate = data.toolSuccessRate ?? 0; // 工具调用成功占比

    this.timestamp = data.timestamp || Date.now();
  }

  /** 是否使用了 LLM 智能分解 */
  get usedLLMDecomposition() {
    return this.decompositionMode === 'llm';
  }

  /** 阶段性进度 (0~1) */
  get progress() {
    return this.totalSubtasks > 0 ? this.completedSubtasks / this.totalSubtasks : 0;
  }
}

/**
 * 分解模式统计
 */
class DecompositionPattern {
  constructor() {
    this.taskType = '';
    this.patternSignature = ''; // 子任务名称序列的哈希
    this.subtaskNames = []; // 分解出的子任务 ID 列表
    this.totalRuns = 0;
    this.successRuns = 0;
    this.avgDurationMs = 0;
    this.avgIterations = 0;
    this.phaseCompletionRates = {}; // { exploration: 0.95, implementation: 0.82, ... }
    this.lastSeen = 0;
  }

  get successRate() {
    return this.totalRuns > 0 ? this.successRuns / this.totalRuns : 0;
  }

  /** 简单签名：排序后的子任务名称拼接 */
  static signature(subtaskNames) {
    return [...(subtaskNames || [])].sort().join('|');
  }

  updateFromRecord(record) {
    this.totalRuns++;
    if (record.success) this.successRuns++;
    this.avgDurationMs =
      (this.avgDurationMs * (this.totalRuns - 1) + (record.durationMs || 0)) / this.totalRuns;
    this.avgIterations =
      (this.avgIterations * (this.totalRuns - 1) + (record.iterations || 0)) / this.totalRuns;
    for (const phase of record.phasesCompleted || []) {
      if (!this.phaseCompletionRates[phase])
        this.phaseCompletionRates[phase] = { total: 0, completed: 0 };
      this.phaseCompletionRates[phase].total++;
      this.phaseCompletionRates[phase].completed++;
    }
    this.lastSeen = Date.now();
  }
}

/**
 * Hashline 冲突模式
 */
class ConflictPattern {
  constructor() {
    this.conflictType = ''; // tag_mismatch | patch_rejected | diag_new_errors | recovery_failed
    this.totalOccurrences = 0;
    this.successfulRecoveries = 0; // 成功恢复次数
    this.avgRepairTimeMs = 0;
    this.recoveryStrategies = []; // 历史有效的恢复策略
    this.affectedFiles = new Set();
    this.lastSeen = 0;
  }

  get recoveryRate() {
    return this.totalOccurrences > 0 ? this.successfulRecoveries / this.totalOccurrences : 0;
  }

  record(conflictType, recovered, repairTimeMs, file) {
    this.conflictType = conflictType;
    this.totalOccurrences++;
    if (recovered) this.successfulRecoveries++;
    this.avgRepairTimeMs =
      (this.avgRepairTimeMs * (this.totalOccurrences - 1) + (repairTimeMs || 0)) /
      this.totalOccurrences;
    if (file) this.affectedFiles.add(file);
    this.lastSeen = Date.now();
  }
}

// ──────────────────────────── 反馈闭环主类 ────────────────────────────

export class ExecutionFeedbackLoop {
  constructor(config = {}) {
    this.maxRecords = config.maxRecords || 50;
    this.learnFromHistory = config.learnFromHistory !== false; // 默认开启

    /** @type {ExecutionRecord[]} 最近 N 次执行记录 */
    this.history = [];

    /** @type {Map<string, DecompositionPattern>} 分解模式统计 */
    this.decompositionStats = new Map();

    /** @type {Map<string, ConflictPattern>} 冲突模式统计 */
    this.conflictStats = new Map();

    /** @type {object} 跨 run 累计的全局统计 */
    this.globalStats = {
      totalRuns: 0,
      successRuns: 0,
      llmDecompositionRuns: 0,
      llmDecompositionSuccesses: 0,
      avgDurationMs: 0,
      avgIterations: 0,
      // 意图分类准确度追踪
      intentHits: {}, // { 'coding_task': { total: N, correct: M }, ... }
      // 推荐工具的有效性
      toolEffectiveness: {}, // { toolName: { recommended: N, actuallyUsed: M }, ... }
    };
  }

  // ──────────────────────── 数据收集 ────────────────────────────────

  /**
   * 收集一次 plan 执行完成后的反馈。
   * 由 AgentEngine.#completeRun() 调用。
   */
  collect(recordData) {
    const record = new ExecutionRecord(recordData);
    this.history.push(record);
    if (this.history.length > this.maxRecords) {
      this.history.shift();
    }

    // 更新全局统计
    const gs = this.globalStats;
    gs.totalRuns++;
    if (record.success) gs.successRuns++;
    gs.avgDurationMs =
      (gs.avgDurationMs * (gs.totalRuns - 1) + (record.durationMs || 0)) / gs.totalRuns;
    gs.avgIterations =
      (gs.avgIterations * (gs.totalRuns - 1) + (record.iterations || 0)) / gs.totalRuns;

    if (record.usedLLMDecomposition) {
      gs.llmDecompositionRuns++;
      if (record.success) gs.llmDecompositionSuccesses++;
    }

    // 追踪意图分类准确度
    if (record.intent) {
      const intentKey = record.intent;
      if (!gs.intentHits[intentKey]) {
        gs.intentHits[intentKey] = { total: 0, correct: 0 };
      }
      gs.intentHits[intentKey].total++;
      // "正确" = 任务成功完成（作为分类准确的代理指标）
      if (record.success) {
        gs.intentHits[intentKey].correct++;
      }
    }

    return record;
  }

  /**
   * 收集工具有效性反馈。Agent 被推荐了某些工具，实际用了哪些。
   */
  collectToolEffectiveness(recommendedTools = [], actuallyUsedTools = []) {
    const used = new Set(actuallyUsedTools);
    for (const tool of recommendedTools) {
      if (!this.globalStats.toolEffectiveness[tool]) {
        this.globalStats.toolEffectiveness[tool] = { recommended: 0, actuallyUsed: 0 };
      }
      this.globalStats.toolEffectiveness[tool].recommended++;
      if (used.has(tool)) {
        this.globalStats.toolEffectiveness[tool].actuallyUsed++;
      }
    }
  }

  /**
   * 记录 Hashline 冲突信号。
   * 由 AgentEngine 中 EditOrchestrator 工具调用后调用。
   */
  recordConflict(conflictType, recovered, repairTimeMs, file) {
    let pattern = this.conflictStats.get(conflictType);
    if (!pattern) {
      pattern = new ConflictPattern();
      this.conflictStats.set(conflictType, pattern);
    }
    pattern.record(conflictType, recovered, repairTimeMs, file);
    return pattern;
  }

  // ──────────────────────── 反馈处理 ────────────────────────────────

  /**
   * 判断当前是否有 Hashline 冲突需要触发 replan。
   * 返回 { shouldReplan: boolean, conflictType: string, severity: 'low'|'medium'|'high' }
   */
  detectReplanNeed() {
    // 检查最近的冲突
    const recentConflicts = [];
    for (const [type, pattern] of this.conflictStats) {
      if (pattern.totalOccurrences > 0) {
        recentConflicts.push({ type, pattern });
      }
    }

    if (recentConflicts.length === 0) return { shouldReplan: false };

    // 按恢复率判断严重性
    for (const { type, pattern } of recentConflicts) {
      // recovery_failed: 高严重性，必须 replan
      if (type === 'recovery_failed' && pattern.recoveryRate < 0.3) {
        return { shouldReplan: true, conflictType: type, severity: 'high' };
      }
      // diag_new_errors: 中等，可能需要 replan
      if (type === 'diag_new_errors' && pattern.recoveryRate < 0.5) {
        return { shouldReplan: true, conflictType: type, severity: 'medium' };
      }
    }

    return { shouldReplan: false };
  }

  /**
   * 为 Hashline 冲突生成重规划提示。
   * 供 ExecutionPlanManager.replan() 使用。
   */
  generateReplanHints(conflictType) {
    const pattern = this.conflictStats.get(conflictType);
    const affectedFiles = pattern ? Array.from(pattern.affectedFiles) : [];
    const strategies = pattern?.recoveryStrategies || [];

    return {
      conflictType,
      affectedFiles,
      suggestedStrategies:
        strategies.length > 0
          ? strategies
          : [
              '重新读取冲突文件确认当前状态',
              '分析冲突原因（tag 过期 / 并发修改 / 语法差异）',
              '用正确的上下文重新生成编辑 patch',
            ],
      severity: conflictType === 'recovery_failed' ? 'high' : 'medium',
    };
  }

  // ──────────────────────── 丰富上下文（供 Methododology 层消费）───

  /**
   * 为 GraphPlanner.decomposeTaskLLM 生成反馈上下文。
   * 包含：历史上类似任务的成功分解模式、应避免的模式。
   */
  enrichDecompositionContext(taskType) {
    if (!this.learnFromHistory || this.history.length === 0) return null;

    const context = {
      recentResults: [],
      llmDecompositionAdvice: null,
    };

    // 最近成功的执行摘要
    const recentSuccesses = this.history.filter((r) => r.success).slice(-5);
    context.recentResults = recentSuccesses.map((r) => ({
      taskType: r.taskType,
      decompositionMode: r.decompositionMode,
      phasesCompleted: r.phasesCompleted,
      durationMs: r.durationMs,
      iterations: r.iterations,
    }));

    // LLM 分解模式 vs 模板模式的效率对比
    const llmRuns = this.history.filter((r) => r.decompositionMode === 'llm');
    const templateRuns = this.history.filter((r) => r.decompositionMode === 'template');

    if (llmRuns.length > 0 || templateRuns.length > 0) {
      const llmSuccessRate =
        llmRuns.length > 0 ? llmRuns.filter((r) => r.success).length / llmRuns.length : 0;
      const templateSuccessRate =
        templateRuns.length > 0
          ? templateRuns.filter((r) => r.success).length / templateRuns.length
          : 0;

      context.llmDecompositionAdvice = {
        llmSuccessRate,
        templateSuccessRate,
        llmAvgIterations:
          llmRuns.length > 0 ? llmRuns.reduce((s, r) => s + r.iterations, 0) / llmRuns.length : 0,
        templateAvgIterations:
          templateRuns.length > 0
            ? templateRuns.reduce((s, r) => s + r.iterations, 0) / templateRuns.length
            : 0,
        recommendation:
          llmSuccessRate >= templateSuccessRate
            ? 'LLM decomposition performs well, continue using.'
            : 'Consider using template-based decomposition for simpler tasks.',
      };
    }

    return context;
  }

  /**
   * 为 IntentClassifier 生成反馈上下文。
   * 包含：历史意图分类准确度、推荐工具命中率。
   */
  enrichClassificationContext() {
    if (!this.learnFromHistory || this.history.length === 0) return null;

    return {
      intentHitRates: Object.entries(this.globalStats.intentHits).map(([intent, stats]) => ({
        intent,
        accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
        total: stats.total,
      })),
      toolEffectiveness: Object.entries(this.globalStats.toolEffectiveness)
        .map(([tool, stats]) => ({
          tool,
          hitRate: stats.recommended > 0 ? stats.actuallyUsed / stats.recommended : 0,
          recommended: stats.recommended,
          used: stats.actuallyUsed,
        }))
        .sort((a, b) => b.hitRate - a.hitRate)
        .slice(0, 10),

      // 实验性：如果 LLM 分解在当前 taskType 上表现不佳，降低自动化规划置信度
      automationConfidenceAdjustment: this.#computeAutomationAdjustment(),
    };
  }

  // ──────────────────────── 内部计算 ────────────────────────────────

  #computeAutomationAdjustment() {
    const gs = this.globalStats;
    if (gs.totalRuns < 3) return 0; // 样本不足

    const overallSuccessRate = gs.successRuns / gs.totalRuns;

    // 如果整体成功率低于 0.6，降低对自动化计划的信心
    if (overallSuccessRate < 0.4) return -0.3;
    if (overallSuccessRate < 0.6) return -0.15;
    if (overallSuccessRate > 0.85) return 0.1;
    return 0;
  }

  // ──────────────────────── 摘要 / 调试 ────────────────────────────

  /** 生成可读的反馈摘要 */
  summarize() {
    const gs = this.globalStats;
    return {
      totalRuns: gs.totalRuns,
      successRate:
        gs.totalRuns > 0 ? ((gs.successRuns / gs.totalRuns) * 100).toFixed(1) + '%' : 'N/A',
      avgDurationMs: Math.round(gs.avgDurationMs),
      avgIterations: gs.avgIterations.toFixed(1),
      llmDecompositionSuccessRate:
        gs.llmDecompositionRuns > 0
          ? ((gs.llmDecompositionSuccesses / gs.llmDecompositionRuns) * 100).toFixed(1) + '%'
          : 'N/A',
      conflictPatterns: Array.from(this.conflictStats.entries()).map(([type, p]) => ({
        type,
        occurrences: p.totalOccurrences,
        recoveryRate: (p.recoveryRate * 100).toFixed(1) + '%',
        affectedFiles: Array.from(p.affectedFiles).slice(0, 5),
      })),
    };
  }

  /** 重置（用于测试或工作区切换） */
  reset() {
    this.history = [];
    this.decompositionStats.clear();
    this.conflictStats.clear();
    this.globalStats = {
      totalRuns: 0,
      successRuns: 0,
      llmDecompositionRuns: 0,
      llmDecompositionSuccesses: 0,
      avgDurationMs: 0,
      avgIterations: 0,
      intentHits: {},
      toolEffectiveness: {},
    };
  }
}

export default ExecutionFeedbackLoop;
