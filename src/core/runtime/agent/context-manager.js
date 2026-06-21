/**
 * Context Manager — 会话上下文管理
 *
 * 职责：
 *   - 渐进式调整上下文窗口大小（根据迭代进度）
 *   - 使用 DynamicContextPruning 进行智能裁剪
 *   - 在裁剪后注入 workspace state 摘要，避免信息丢失
 *   - 缓存 workspace hint，避免重复生成
 *
 * 原为 ReActAgent.#manageContextWindow / #injectWorkspaceStateSummary /
 * #generateWorkspaceHint 等方法。
 */

import { DynamicContextPruning } from '../../dynamic-context-pruning.js';

export class ContextManager {
  #sessionManager;
  #contextPruner;
  #tokenScope;
  #workspaceState;
  #observationSummarizer;
  #cachedHint = '';
  #lastHintUpdate = 0;
  #config;

  constructor({ sessionManager, contextPruner, tokenScope, workspaceState, observationSummarizer, config }) {
    this.#sessionManager = sessionManager;
    this.#contextPruner = contextPruner || new DynamicContextPruning();
    this.#tokenScope = tokenScope;
    this.#workspaceState = workspaceState || null;
    this.#observationSummarizer = observationSummarizer || null;
    this.#config = config || { maxTokens: 8000 };
  }

  /**
   * 基于当前迭代进度调整上下文窗口。
   * - 早期：宽松保留上下文
   * - 后期：激进裁剪以腾出空间给真正重要的内容
   *
   * @param {number} iteration — 当前迭代号（1-based）
   * @param {number} maxIterations — 预算的最大迭代数
   */
  manage(iteration, maxIterations) {
    if (!this.#sessionManager) return null;

    const maxTokens = this.#tokenScope?.getEffectiveLimit?.()
      ?? this.#config.maxTokens
      ?? this.#sessionManager.getMaxTokens?.()
      ?? 8000;

    const progress = maxIterations > 0
      ? this.#sessionManager.getHistory?.().length / (maxIterations * 1.5)
      : 0.5;

    // 保留消息数：早期 10 → 后期 4
    const preserveRecentMessages = Math.max(4, Math.floor(10 - 6 * Math.min(progress, 1)));
    // 目标 token 占用比：早期 60% → 后期 35%
    const targetRatio = 0.6 - 0.25 * Math.min(progress, 1);
    const targetTokens = Math.floor(maxTokens * targetRatio);
    const minMessages = Math.max(2, Math.floor(5 - 2 * Math.min(progress, 1)));

    const currentTokens = this.#sessionManager.getTokenCount?.() ?? 0;
    const thresholdBase = 0.7;
    const thresholdMin = 0.4;
    const threshold = maxTokens * (thresholdBase - (thresholdBase - thresholdMin) * Math.min(progress, 1));

    if (currentTokens <= threshold) {
      return { trimmed: false, currentTokens, threshold };
    }

    let stats = null;
    if (typeof this.#contextPruner.updateConfig === 'function') {
      this.#contextPruner.updateConfig({ maxTokens, targetTokens, preserveRecentMessages });
    }
    if (typeof this.#sessionManager.trimWithPruner === 'function') {
      stats = this.#sessionManager.trimWithPruner(this.#contextPruner, {
        maxTokens, targetTokens, preserveRecentMessages, minMessages,
      });
    } else if (typeof this.#sessionManager.trimToContextWindow === 'function') {
      this.#sessionManager.trimToContextWindow(targetTokens, { minRecentMessages: preserveRecentMessages });
    }

    // 裁剪后注入工作区状态摘要
    this.#injectWorkspaceSummary();

    return {
      trimmed: true,
      currentTokens: this.#sessionManager.getTokenCount?.() ?? 0,
      threshold,
      targetTokens,
      preserveRecentMessages,
      stats,
    };
  }

  /** 手动触发工作区摘要注入（非裁剪路径也可调用） */
  injectSummaryIfStale() {
    this.#injectWorkspaceSummary({ force: false });
  }

  /** 强制刷新摘要缓存（如在 write_file/edit_file 等改变工作区状态的工具调用后） */
  refreshSummary() {
    this.#cachedHint = '';
    this.#lastHintUpdate = 0;
  }

  clear() {
    this.#cachedHint = '';
    this.#lastHintUpdate = 0;
  }

  // ============== 内部实现 ==============

  #injectWorkspaceSummary({ force = false } = {}) {
    if (!this.#workspaceState || !this.#sessionManager) return;

    const now = Date.now();
    // 30 秒内复用缓存
    if (!force && this.#cachedHint && now - this.#lastHintUpdate < 30000) {
      this.#sessionManager.addSystemMessage?.(this.#cachedHint);
      return;
    }

    const hint = this.#generateHint();
    if (!hint) return;

    this.#cachedHint = hint;
    this.#lastHintUpdate = now;
    this.#sessionManager.addSystemMessage?.(hint);
  }

  #generateHint() {
    const state = this.#workspaceState;
    if (!state) return '';

    const summary = typeof state.getSummary === 'function' ? state.getSummary() : null;
    if (!summary || (summary.trackedFiles === 0 && summary.trackedDirectories === 0)) return '';

    const criticalFacts = typeof state.getCriticalFacts === 'function'
      ? state.getCriticalFacts()
      : [];
    const knownNonExistent = criticalFacts
      .filter(f => f.type === 'path_not_found')
      .map(f => f.value?.path)
      .filter(Boolean);

    let workspaceDescription = '';
    if (this.#observationSummarizer && typeof this.#observationSummarizer.generateWorkspaceDescription === 'function') {
      workspaceDescription = this.#observationSummarizer.generateWorkspaceDescription();
    } else if (typeof state.generateWorkspaceDescription === 'function') {
      workspaceDescription = state.generateWorkspaceDescription();
    } else {
      workspaceDescription = `Tracked files: ${summary.trackedFiles ?? 0}; tracked directories: ${summary.trackedDirectories ?? 0}.`;
    }

    const parts = [];
    parts.push('## 工作区探索状态 (Context Trimmed)');
    parts.push('');
    parts.push(workspaceDescription);

    if (knownNonExistent.length > 0) {
      parts.push('');
      parts.push('### 已知不存在的路径 (避免重复尝试)');
      for (const p of knownNonExistent.slice(0, 10)) parts.push(`- ${p}`);
    }

    const importantFacts = criticalFacts.filter(f => f.type !== 'path_not_found').slice(-5);
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
}

export default ContextManager;
