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
} from './agent-constants.js';

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

  // 工作区状态缓存
  #lastWorkspaceHintUpdate = 0;
  #cachedWorkspaceHint = '';

  constructor({
    debugEvent, sessionManager, contextPruner,
    workspaceState, observationSummarizer, workspaceIndex,
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
    this.#cachedWorkspaceHint = '';
  }

  /**
   * 管理上下文窗口（渐进式裁剪）
   */
  manageContextWindow(modelProvider, iterationBudget) {
    const maxTokens = modelProvider.getMaxContextTokens();
    const currentTokens = this.#sessionManager.getTokenCount();

    // 渐进式裁剪强度
    const progress = iterationBudget > 0
      ? this.#sessionManager.getHistory().length / (iterationBudget * 1.5)
      : 0.5;

    const thresholdBase = 0.7;
    const thresholdMin = 0.4;
    const progressFactor = Math.min(progress, 1.0);
    const threshold = maxTokens * (thresholdBase - (thresholdBase - thresholdMin) * progressFactor);

    const preserveMessages = Math.max(4, Math.floor(10 - 6 * progressFactor));
    const targetRatio = 0.6 - 0.25 * progressFactor;
    const targetTokens = Math.floor(maxTokens * targetRatio);
    const minMessages = Math.max(2, Math.floor(5 - 2 * progressFactor));

    if (currentTokens > threshold) {
      this.#debugEvent('Context window trimming', {
        currentTokens, maxTokens, threshold, targetTokens,
        preserveRecentMessages: preserveMessages,
        messagesBefore: this.#sessionManager.getHistory().length,
      });

      if (this.#contextPruner) {
        this.#contextPruner.updateConfig?.({ maxTokens, targetTokens, preserveRecentMessages: preserveMessages });
        this.#sessionManager.trimWithPruner(this.#contextPruner, {
          maxTokens, targetTokens, preserveRecentMessages: preserveMessages, minMessages,
        });
      } else {
        this.#sessionManager.trimToContextWindow(targetTokens, { minRecentMessages: preserveMessages });
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
    if (!this.#workspaceState) return;

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
    if (!this.#workspaceState || !this.#observationSummarizer) return '';

    const summary = this.#workspaceState.getSummary();
    if (summary.trackedFiles === 0 && summary.trackedDirectories === 0) return '';

    const criticalFacts = this.#workspaceState.getCriticalFacts();
    const knownNonExistent = criticalFacts
      .filter(f => f.type === 'path_not_found')
      .map(f => f.value?.path)
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

    const importantFacts = criticalFacts
      .filter(f => f.type !== 'path_not_found')
      .slice(-5);

    if (importantFacts.length > 0) {
      parts.push('');
      parts.push('### 关键发现');
      for (const fact of importantFacts) {
        const value = typeof fact.value === 'object'
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
    if (iteration < 3) return;

    // 进度检查点
    if (iteration % PROGRESS_CHECKPOINT_INTERVAL === 0) {
      const planStatus = planSummary || 'not available';
      this.#sessionManager.addUserMessage(
        `[Progress checkpoint @iter ${iteration}/${maxIterations}]\nPlan status:\n${planStatus}\nIf you have enough information to answer, provide FINAL_ANSWER now.\nIf you are stuck, try a fundamentally different approach instead of repeating the same pattern.`
      );
      return;
    }

    // 降级预算
    if (this.#consecutiveSameTool >= STAGNATION_SAME_TOOL_LIMIT ||
        this.#stagnationWindow.length >= STAGNATION_LOOKBACK) {
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
      const uniqueTools = new Set(recentTools.map(t => t.toolName));
      if (uniqueTools.size <= 2 && window.every(t => !t.isMutation)) {
        this.#lastStagnationNudge++;
        const toolList = [...uniqueTools].join(', ');
        this.#sessionManager.addUserMessage(
          `[Efficiency note] You have called ${toolList} repeatedly for ${STAGNATION_SAME_TOOL_LIMIT} consecutive iterations with no modifications.\nConsider: (1) call a different tool to make progress, (2) provide FINAL_ANSWER if you already have enough information, or (3) ask the user for clarification.`
        );
        this.#consecutiveSameTool = 0;
        return;
      }
    }

    // 模式 2：长时间无修改操作
    if (this.#lastMutationIteration > 0 &&
        this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT <= iteration &&
        window.length >= STAGNATION_NO_MUTATION_LIMIT) {
      this.#lastStagnationNudge++;
      const planStatus = planSummary || 'not available';
      this.#sessionManager.addUserMessage(
        `[Efficiency note] No modifications were made in the last ${STAGNATION_NO_MUTATION_LIMIT} iterations.\nPlan status:\n${planStatus}\nIf you are still investigating, try narrowing your search. Otherwise, provide FINAL_ANSWER with what you have found so far.`
      );
      this.#lastMutationIteration = iteration;
    }
  }

  /**
   * 记录工具调用到停滞检测窗口
   */
  recordToolCallForStagnation(toolResult, iteration, isMutationFn) {
    if (!toolResult || !toolResult.name) return;
    const isMutation = isMutationFn ? isMutationFn(toolResult.name, toolResult) : false;
    this.#stagnationWindow.push({
      toolName: toolResult.name,
      iteration,
      isMutation,
    });
    if (this.#stagnationWindow.length > STAGNATION_LOOKBACK) {
      this.#stagnationWindow.shift();
    }
    if (isMutation) {
      this.#lastMutationIteration = iteration;
    }
  }

  /**
   * 是否达到停滞 nudge 上限
   */
  isStagnationNudgesExceeded() {
    return this.#lastStagnationNudge >= MAX_STAGNATION_NUDGES;
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
