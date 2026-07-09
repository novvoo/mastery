/**
 * AgentContext — 上下文管理、工作区状态、停滞检测
 *
 * 从 ReActAgent 拆出的职责：
 *   - 上下文窗口管理（渐进式裁剪策略）
 *   - 工作区状态摘要注入（上下文裁剪后保留关键信息）
 *   - 停滞检测与 nudge 注入
 *   - 工作区索引预热
 */

import {
  MAX_STAGNATION_NUDGES,
  PROGRESS_CHECKPOINT_INTERVAL,
  STAGNATION_LOOKBACK,
  STAGNATION_NO_MUTATION_LIMIT,
  STAGNATION_SAME_TOOL_LIMIT,
  EXPLORATION_BUDGET,
  FORCE_ACTION_GRACE_TURNS,
} from '../../agent/constants.js';
import {
  isWorkspaceInspectionTool,
  isVerificationTool,
  isPlanningTool,
} from './execution-plan-manager.js';

export class AgentContext {
  #debugEvent;
  #sessionManager;
  #contextPruner;
  #workspaceState;
  #observationSummarizer;
  #workspaceIndex;

  // 停滞检测
  #stagnationWindow = [];
  #lastStagnationNudge = 0;
  #consecutiveSameTool = 0;
  #lastMutationIteration = 0;
  // 探索预算与零调用追踪
  #explorationIterations = 0;
  #zeroToolCallStreak = 0;
  #forceActionTriggered = false;
  #forceActionIgnored = 0;

  // 工作区状态缓存
  #lastWorkspaceHintUpdate = 0;
  #cachedWorkspaceHint = '';

  constructor({
    debugEvent,
    sessionManager,
    contextPruner,
    workspaceState,
    observationSummarizer,
    workspaceIndex,
  }) {
    this.#debugEvent = debugEvent;
    this.#sessionManager = sessionManager;
    this.#contextPruner = contextPruner;
    this.#workspaceState = workspaceState;
    this.#observationSummarizer = observationSummarizer;
    this.#workspaceIndex = workspaceIndex;
  }

  /** 重置每次 run 的状态 */
  reset() {
    this.#stagnationWindow = [];
    this.#lastStagnationNudge = 0;
    this.#consecutiveSameTool = 0;
    this.#lastMutationIteration = 0;
    this.#explorationIterations = 0;
    this.#zeroToolCallStreak = 0;
    this.#forceActionTriggered = false;
    this.#forceActionIgnored = 0;
    this.#cachedWorkspaceHint = '';
  }

  /**
   * 管理上下文窗口（渐进式裁剪）
   */
  manageContextWindow(modelProvider, iterationBudget) {
    const maxTokens = modelProvider.getMaxContextTokens();
    const currentTokens = this.#sessionManager.getTokenCount();

    // 渐进式裁剪强度
    const progress =
      iterationBudget > 0
        ? this.#sessionManager.getHistory().length / (iterationBudget * 1.5)
        : 0.5;

    const thresholdBase = 0.55; // 从 0.7 降低到 0.55，更早触发裁剪防止上下文溢出
    const thresholdMin = 0.35; // 从 0.4 降低到 0.35，后期更激进
    const progressFactor = Math.min(progress, 1.0);
    const threshold = maxTokens * (thresholdBase - (thresholdBase - thresholdMin) * progressFactor);

    const preserveMessages = Math.max(3, Math.floor(8 - 5 * progressFactor));
    const targetRatio = 0.5 - 0.2 * progressFactor; // 从 0.6-0.25*progress 调整为更激进
    const targetTokens = Math.floor(maxTokens * targetRatio);
    const minMessages = Math.max(2, Math.floor(5 - 2 * progressFactor));

    if (currentTokens > threshold) {
      this.#debugEvent('Context window trimming', {
        currentTokens,
        maxTokens,
        threshold,
        targetTokens,
        preserveRecentMessages: preserveMessages,
        messagesBefore: this.#sessionManager.getHistory().length,
      });

      if (this.#contextPruner) {
        this.#contextPruner.updateConfig?.({
          maxTokens,
          targetTokens,
          preserveRecentMessages: preserveMessages,
        });
        // 优先使用摘要压缩（保留语义），回退到裁剪丢弃
        if (
          typeof this.#contextPruner.compress === 'function' &&
          typeof this.#sessionManager.compressWithSummarizer === 'function'
        ) {
          this.#sessionManager.compressWithSummarizer(this.#contextPruner, {
            maxTokens,
            targetTokens,
            preserveRecentMessages: preserveMessages,
          });
        } else {
          this.#sessionManager.trimWithPruner(this.#contextPruner, {
            maxTokens,
            targetTokens,
            preserveRecentMessages: preserveMessages,
            minMessages,
          });
        }
      } else {
        this.#sessionManager.trimToContextWindow(targetTokens, {
          minRecentMessages: preserveMessages,
        });
      }

      this.#debugEvent('Context window trimmed', {
        estimatedTokens: this.#sessionManager.getTokenCount(),
        messagesAfter: this.#sessionManager.getHistory().length,
      });

      this.#injectWorkspaceStateSummary();
    }
  }

  /**
   * 注入工作区状态摘要（上下文裁剪后保留关键信息）
   */
  #injectWorkspaceStateSummary() {
    if (!this.#workspaceState) {
      return;
    }

    const now = Date.now();
    const cacheAge = now - this.#lastWorkspaceHintUpdate;

    if (cacheAge < 30000 && this.#cachedWorkspaceHint) {
      this.#sessionManager.addSystemMessage(this.#cachedWorkspaceHint);
      return;
    }

    const hint = this.#generateWorkspaceHint();
    this.#cachedWorkspaceHint = hint;
    this.#lastWorkspaceHintUpdate = now;

    if (hint) {
      this.#sessionManager.addSystemMessage(hint);
      this.#debugEvent('Workspace state hint injected', { hintLength: hint.length });
    }
  }

  #generateWorkspaceHint() {
    if (!this.#workspaceState || !this.#observationSummarizer) {
      return '';
    }

    const summary = this.#workspaceState.getSummary();
    if (summary.trackedFiles === 0 && summary.trackedDirectories === 0) {
      return '';
    }

    const criticalFacts = this.#workspaceState.getCriticalFacts();
    const knownNonExistent = criticalFacts
      .filter((f) => f.type === 'path_not_found')
      .map((f) => f.value?.path)
      .filter(Boolean);

    const workspaceDescription = this.#observationSummarizer.generateWorkspaceDescription();

    const parts = [];
    parts.push('## 工作区探索状态 (Context Trimmed)');
    parts.push('');
    parts.push(workspaceDescription);

    if (knownNonExistent.length > 0) {
      parts.push('');
      parts.push('### 已知不存在的路径 (避免重复尝试)');
      for (const path of knownNonExistent.slice(0, 10)) {
        parts.push(`- ${path}`);
      }
    }

    const importantFacts = criticalFacts.filter((f) => f.type !== 'path_not_found').slice(-5);

    if (importantFacts.length > 0) {
      parts.push('');
      parts.push('### 关键发现');
      for (const fact of importantFacts) {
        const value =
          typeof fact.value === 'object'
            ? JSON.stringify(fact.value).substring(0, 100)
            : fact.value;
        parts.push(`- ${fact.type}: ${value}`);
      }
    }

    parts.push('');
    parts.push('这些信息来自之前的探索，在上下文裁剪后保留。请利用这些信息避免重复探索。');

    return parts.join('\n');
  }

  /**
   * 停滞检测与 nudge 注入
   */
  injectStagnationNudge(iteration, maxIterations, planSummary = null) {
    if (iteration < 3) {
      return;
    }

    // 进度检查点
    if (iteration % PROGRESS_CHECKPOINT_INTERVAL === 0) {
      const planStatus = planSummary || 'not available';
      const hasWritten = this.#stagnationWindow.some((t) => t.isMutation);
      this.#sessionManager.addUserMessage(
        `[Progress checkpoint @iter ${iteration}/${maxIterations}]\nPlan status:\n${planStatus}\n` +
          `${hasWritten ? 'You have made code changes — verify and complete.' : 'No code modifications yet. If the target is clear, apply the smallest scoped edit; otherwise gather the single missing fact, replan, ask_user, or explain the blocker.'}`,
      );
      return;
    }

    // 降级预算
    if (
      this.#consecutiveSameTool >= STAGNATION_SAME_TOOL_LIMIT ||
      this.#stagnationWindow.length >= STAGNATION_LOOKBACK
    ) {
      if (this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT < iteration) {
        if (this.#lastStagnationNudge >= MAX_STAGNATION_NUDGES) {
          // 预算降级由外部处理
        }
      }
    }

    // 模式 1：相同工具类型连续重复
    const window = this.#stagnationWindow;
    if (window.length >= STAGNATION_SAME_TOOL_LIMIT) {
      const recentTools = window.slice(-STAGNATION_SAME_TOOL_LIMIT);
      const uniqueTools = new Set(recentTools.map((t) => t.toolName));
      if (uniqueTools.size <= 2 && window.every((t) => !t.isMutation)) {
        this.#lastStagnationNudge++;
        const toolList = [...uniqueTools].join(', ');
        this.#sessionManager.addUserMessage(
          `[Progress check] You have called ${toolList} repeatedly for ${STAGNATION_SAME_TOOL_LIMIT} consecutive iterations with zero code modifications.\nStop repeating the same exploration. Take one concrete evidence-based step: scoped edit, focused read/diagnostic for one missing fact, change_plan, ask_user, or FINAL_ANSWER with the blocker.`,
        );
        this.#consecutiveSameTool = 0;
        return;
      }
    }

    // 模式 2：长时间无修改操作
    if (
      this.#lastMutationIteration > 0 &&
      this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT <= iteration &&
      window.length >= STAGNATION_NO_MUTATION_LIMIT
    ) {
      this.#lastStagnationNudge++;
      const planStatus = planSummary || 'not available';
      this.#sessionManager.addUserMessage(
        `[Progress check] No file modifications in ${STAGNATION_NO_MUTATION_LIMIT}+ iterations.\nPlan status:\n${planStatus}\nChoose the next narrow action from the evidence: edit if ready, gather one missing fact, run a focused diagnostic, replan/ask_user, or FINAL_ANSWER with the blocker.`,
      );
      this.#lastMutationIteration = iteration;
    }
  }

  /**
   * 记录工具调用到停滞检测窗口，同时追踪探索预算
   * 有效进展包括：mutation工具、探索工具、验证工具、规划工具
   */
  recordToolCallForStagnation(toolResult, iteration, isMutationFn) {
    if (!toolResult || !toolResult.name) {
      return;
    }
    const isMutation = isMutationFn ? isMutationFn(toolResult.name, toolResult) : false;
    const args = toolResult.args || toolResult.result?.args || {};
    const isExploration = isWorkspaceInspectionTool(toolResult.name, args);
    const isVerification = isVerificationTool(toolResult.name, args);
    const isPlanning = isPlanningTool(toolResult.name);
    const hasProgress = isMutation || isExploration || isVerification || isPlanning;

    this.#stagnationWindow.push({
      toolName: toolResult.name,
      iteration,
      isMutation,
      hasProgress,
    });
    if (this.#stagnationWindow.length > STAGNATION_LOOKBACK) {
      this.#stagnationWindow.shift();
    }
    if (hasProgress) {
      this.#lastMutationIteration = iteration;
      this.#explorationIterations = 0;
      this.#forceActionTriggered = false;
      this.#forceActionIgnored = 0;
    } else {
      this.#explorationIterations++;
    }
    this.#zeroToolCallStreak = 0;
  }

  /**
   * 记录一次零工具调用迭代（用于探索预算追踪）
   */
  recordZeroToolCallIteration() {
    this.#zeroToolCallStreak++;
    this.#explorationIterations++;
  }

  /** 探索预算是否已超出 */
  isExplorationBudgetExceeded() {
    return this.#explorationIterations >= EXPLORATION_BUDGET;
  }

  /** 探索预算 + grace turns 后应强制终止 */
  shouldHardStopForExploration() {
    return this.#forceActionTriggered && this.#forceActionIgnored >= FORCE_ACTION_GRACE_TURNS;
  }

  /** 连续零工具调用超过 5 回合 */
  shouldHardStopForZeroToolCalls() {
    return this.#zeroToolCallStreak >= 8;
  }

  /** 触发强制行动命令（返回 nudge 消息，由外部注入） */
  triggerForceAction() {
    if (this.#forceActionTriggered) {
      this.#forceActionIgnored++;
    } else {
      this.#forceActionTriggered = true;
    }
    if (this.#forceActionIgnored === 0) {
      return (
        `[IMPLEMENTATION PROGRESS CHECK] You have spent ${this.#explorationIterations} iterations reading and exploring without decisive progress.\n` +
        'This is a coding task — the user expects a concrete evidence-backed step.\n' +
        'If the target is clear, apply the smallest scoped edit. If one fact is missing, gather that fact. If the plan is wrong, replan or ask_user. If you cannot proceed, provide FINAL_ANSWER explaining why.'
      );
    }
    return (
      `[FINAL WARNING] You have ignored the implementation progress checkpoint for ${this.#forceActionIgnored} iteration(s). ` +
      `You will be terminated in ${FORCE_ACTION_GRACE_TURNS - this.#forceActionIgnored} more iteration(s) ` +
      `if you do not take a concrete evidence-based step. This is a coding task — act from the evidence.`
    );
  }

  /** 连续零工具调用打断消息 */
  getZeroToolCallNudge() {
    return (
      '[HARD STOP] You have produced 5+ consecutive responses with ZERO tool calls. ' +
      'You are stuck in an analysis loop. Take one concrete action now: edit if the target is clear, gather the one missing fact with a tool, replan/ask_user if blocked, OR provide FINAL_ANSWER with the actual blocker.'
    );
  }

  /**
   * 是否达到停滞 nudge 上限
   */
  isStagnationNudgesExceeded() {
    return this.#lastStagnationNudge >= MAX_STAGNATION_NUDGES;
  }

  /** 零工具调用连续计数 */
  get zeroToolCallStreak() {
    return this.#zeroToolCallStreak;
  }

  /** force-action 是否已触发 */
  get forceActionTriggered() {
    return this.#forceActionTriggered;
  }

  /** force-action 被忽略的次数 */
  get forceActionIgnored() {
    return this.#forceActionIgnored;
  }

  /**
   * 预热工作目录索引
   */
  async warmWorkspaceCache() {
    try {
      return await this.#workspaceIndex.warm();
    } catch (err) {
      this.#debugEvent('WorkspaceIndex warmup failed', { error: err.message });
      return '';
    }
  }
}
