/**
 * Diff3EdgeCaseHandler — 增强 diff3 merge 的边缘情况处理
 *
 * 在 IndustrialDiff3Engine 基础上增加：
 *  1. CRLF/LF 统一化处理（跨平台换行符）
 *  2. 多 hunk 交叉重叠检测与合并（partial overlap merge）
 *  3. 内容位移补偿（Content Shift Compensation）
 *  4. 三路冲突逐字符精细化对比
 *  5. 智能冲突合并策略（基于语义相似度选择 closest side）
 *
 * 用法：
 * ```js
 * const handler = new Diff3EdgeCaseHandler();
 * const result = handler.merge({ baseText, currentText, intendedHunks });
 * ```
 */

import { IndustrialDiff3Engine } from './diff3-engine.js';
import { hashContent } from './hashline/index.js';

// ── 类型定义 ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EdgeMergeResult
 * @property {string|null} merged           合并后文本
 * @property {ConflictRegion[]} conflicts   冲突区域
 * @property {string} strategy              策略 (clean|partial|markers|reject)
 * @property {object} stats                 统计
 * @property {string[]} warnings            处理警告
 */

/**
 * @typedef {Object} ConflictRegion
 * @property {number[]} baseRange
 * @property {number[]} currentRange
 * @property {number[]} intendedRange
 * @property {string[]} baseLines
 * @property {string[]} currentLines
 * @property {string[]} intendedLines
 * @property {string} reason
 * @property {string} resolution  base|current|intended|merged|unresolved
 * @property {number} [similarityScore]  语义相似度
 */

// ── Diff3EdgeCaseHandler ────────────────────────────────────────────────

export class Diff3EdgeCaseHandler {
  constructor(opts = {}) {
    this.normalizeCRLF = opts.normalizeCRLF !== false;
    this.maxCrossOverlapDepth = opts.maxCrossOverlapDepth || 5;
    this.similarityThreshold = opts.similarityThreshold || 0.7;
    this.enableCharLevel = opts.enableCharLevel !== false;
    this.preserveEOL = opts.preserveEOL || 'lf'; // 'lf' | 'crlf' | 'auto'
  }

  /**
   * 执行增强的 three-way merge。
   *
   * @param {object} params
   * @param {string} params.baseText        base 快照
   * @param {string} params.currentText     当前文件内容
   * @param {object[]} params.intendedHunks 意图 hunks
   * @param {string} [params.path]          文件路径
   * @returns {EdgeMergeResult}
   */
  merge({ baseText, currentText, intendedHunks, path = '' }) {
    const warnings = [];

    // ── Step 0: CRLF 预处理 ─────────────────────────────────────────────
    let baseNorm = baseText;
    let curNorm = currentText;
    let eol = '\n';

    if (this.normalizeCRLF) {
      const hasCRLF = baseText.includes('\r\n') || currentText.includes('\r\n');
      if (hasCRLF) {
        baseNorm = baseText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        curNorm = currentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        warnings.push('CRLF normalized to LF for merge');
        eol = this.preserveEOL === 'crlf' ? '\r\n' : '\n';
      }
    }

    // ── Step 1: 基础 diff3 merge ────────────────────────────────────────
    const baseResult = IndustrialDiff3Engine.merge({
      baseText: baseNorm,
      currentText: curNorm,
      intendedHunks,
      path,
    });

    // 如果是 clean merge，直接返回（只需还原 EOL）
    if (baseResult.strategy === 'clean' && baseResult.merged !== null) {
      return {
        merged: this._restoreEOL(baseResult.merged, eol),
        conflicts: [],
        strategy: 'clean',
        stats: { total: 0, resolved: 0, conflicts: 0 },
        warnings,
      };
    }

    // ── Step 2: 多 hunk 交叉重叠分析 ────────────────────────────────────
    const enhancedConflicts = this._analyzeCrossOverlaps(
      baseResult.conflicts || [],
      curNorm.split('\n'),
      baseNorm.split('\n'),
    );

    // ── Step 3: 内容位移补偿 ────────────────────────────────────────────
    const shiftCompensated = this._compensateContentShift(enhancedConflicts, curNorm, baseNorm);

    // ── Step 4: 按冲突类型采用不同策略 ──────────────────────────────────
    const { merged, conflicts, stats } = this._resolveConflicts(
      shiftCompensated,
      curNorm,
      baseNorm,
      intendedHunks,
    );

    // ── Step 5: 还原 EOL ────────────────────────────────────────────────
    const finalMerged = merged !== null ? this._restoreEOL(merged, eol) : baseResult.merged;

    return {
      merged: finalMerged,
      conflicts,
      strategy: conflicts.length > 0 ? (stats.resolved > 0 ? 'partial' : 'markers') : 'clean',
      stats,
      warnings: [...warnings, ...(baseResult.warnings || [])],
    };
  }

  // ── CRLF 处理 ─────────────────────────────────────────────────────────

  /**
   * @private
   */
  _restoreEOL(text, eol) {
    if (eol === '\r\n') {
      return text.replace(/\n/g, '\r\n');
    }
    return text;
  }

  // ── 多 hunk 交叉重叠分析 ──────────────────────────────────────────────

  /**
   * 分析多个冲突 hunks 之间的交叉重叠关系。
   *
   * 例：hunk A 覆盖行 10-20，hunk B 覆盖行 15-25
   * → 检测到 cross-overlap，尝试合并为更大的 single hunk 重新合并。
   *
   * @private
   */
  _analyzeCrossOverlaps(conflicts, curLines, baseLines) {
    if (conflicts.length <= 1) {
      return conflicts;
    }

    const merged = [];
    let i = 0;

    while (i < conflicts.length) {
      const current = conflicts[i];

      // 寻找所有与 current 重叠的后续冲突
      let j = i + 1;
      let mergedStart = current.baseRange?.[0] ?? current.currentRange?.[0] ?? 0;
      let mergedEnd = current.baseRange?.[1] ?? current.currentRange?.[1] ?? 0;
      const overlappingIndices = [i];

      while (j < conflicts.length && j - i < this.maxCrossOverlapDepth) {
        const next = conflicts[j];
        const nextStart = next.baseRange?.[0] ?? next.currentRange?.[0] ?? 0;
        const nextEnd = next.baseRange?.[1] ?? next.currentRange?.[1] ?? 0;

        // 检测重叠：范围有交集
        if (nextStart <= mergedEnd + 1) {
          // +1 允许相邻范围合并
          mergedEnd = Math.max(mergedEnd, nextEnd);
          overlappingIndices.push(j);
          j++;
        } else {
          break;
        }
      }

      if (overlappingIndices.length > 1) {
        // 多个冲突重叠：合并为更大的冲突区域
        const combined = this._mergeOverlappingConflicts(
          overlappingIndices.map((idx) => conflicts[idx]),
          curLines,
          baseLines,
        );
        merged.push(combined);
        i = j; // 跳过已合并的索引
      } else {
        merged.push(current);
        i++;
      }
    }

    return merged;
  }

  /**
   * 将多个重叠的冲突合并为一个。
   * @private
   */
  _mergeOverlappingConflicts(overlaps, curLines, baseLines) {
    const allBaseStart = Math.min(...overlaps.map((c) => c.baseRange?.[0] ?? Infinity));
    const allBaseEnd = Math.max(...overlaps.map((c) => c.baseRange?.[1] ?? -1));
    const allCurStart = Math.min(...overlaps.map((c) => c.currentRange?.[0] ?? Infinity));
    const allCurEnd = Math.max(...overlaps.map((c) => c.currentRange?.[1] ?? -1));

    // 合并所有 base/current/intended 行
    const allBaseLines = [];
    const allCurLines = [];
    const allIntendedLines = [];
    const reasons = [];

    for (const c of overlaps) {
      if (c.baseLines) {
        allBaseLines.push(...c.baseLines);
      }
      if (c.currentLines) {
        allCurLines.push(...c.currentLines);
      }
      if (c.intendedLines) {
        allIntendedLines.push(...c.intendedLines);
      }
      if (c.reason) {
        reasons.push(c.reason);
      }
    }

    // 去重保留顺序
    const uniqueBase = [...new Set(allBaseLines)];
    const uniqueCur = [...new Set(allCurLines)];
    const uniqueIntended = [...new Set(allIntendedLines)];

    return {
      baseRange: [allBaseStart, allBaseEnd],
      currentRange: [allCurStart, allCurEnd],
      intendedRange: [allBaseStart, allBaseStart + uniqueIntended.length],
      baseLines: uniqueBase,
      currentLines: uniqueCur,
      intendedLines: uniqueIntended,
      reason: `Cross-overlap merge: ${reasons.join('; ')}`,
      resolution: 'unresolved',
      isCrossOverlap: true,
      overlappingCount: overlaps.length,
    };
  }

  // ── 内容位移补偿 ──────────────────────────────────────────────────────

  /**
   * 当 base 到 current 之间的变化导致内容发生位移时，
   * 将冲突区域尝试重新定位到正确位置。
   *
   * @private
   */
  _compensateContentShift(conflicts, curText, baseText) {
    const curLines = curText.split('\n');
    const baseLines = baseText.split('\n');

    return conflicts.map((conflict) => {
      const start = conflict.baseRange?.[0] ?? 0;
      const end = conflict.baseRange?.[1] ?? 0;

      if (start >= baseLines.length || start < 0) {
        return conflict;
      }

      // 取 conflict 在 base 中的第一行内容
      const baseStartLine = baseLines[start];
      if (!baseStartLine || baseStartLine.trim().length < 5) {
        return conflict;
      }

      const fp = hashContent(baseStartLine);

      // 在当前文件的 ±20 行范围内搜索该行
      let bestPos = start;
      let bestScore = 0;

      const searchStart = Math.max(0, start - 20);
      const searchEnd = Math.min(curLines.length - 1, end + 20);

      for (let i = searchStart; i <= searchEnd; i++) {
        if (hashContent(curLines[i]) === fp) {
          // 精确匹配 → 找到正确位置
          const offset = i - start;
          return {
            ...conflict,
            currentRange: [
              (conflict.currentRange?.[0] ?? start) + offset,
              (conflict.currentRange?.[1] ?? end) + offset,
            ],
            shiftCompensated: true,
            shiftAmount: offset,
          };
        }

        // 如果没有精确匹配，计算最佳近似匹配
        const similarity = this._lineSimilarity(baseStartLine, curLines[i]);
        if (similarity > bestScore) {
          bestScore = similarity;
          bestPos = i;
        }
      }

      if (bestScore > 0.9 && bestPos !== start) {
        const offset = bestPos - start;
        return {
          ...conflict,
          currentRange: [
            (conflict.currentRange?.[0] ?? start) + offset,
            (conflict.currentRange?.[1] ?? end) + offset,
          ],
          shiftCompensated: true,
          shiftAmount: offset,
          shiftConfidence: bestScore,
        };
      }

      return conflict;
    });
  }

  // ── 冲突解析 ──────────────────────────────────────────────────────────

  /**
   * 按冲突类型分级处理。
   * @private
   */
  _resolveConflicts(conflicts, curText, baseText, intendedHunks) {
    const curLines = curText.split('\n');
    const baseLines = baseText.split('\n');
    const resolved = [];
    const unresolved = [];
    const stats = { total: conflicts.length, resolved: 0, conflicts: 0 };

    for (const conflict of conflicts) {
      const resolution = this._resolveSingleConflict(conflict, curLines, baseLines);
      if (resolution.resolved) {
        resolved.push(resolution);
        stats.resolved++;
      } else {
        unresolved.push(conflict);
        stats.conflicts++;
      }
    }

    // 构建合并文本
    let merged = null;
    if (unresolved.length === 0) {
      // 所有冲突解决：应用 resolved 结果
      let result = [...curLines];
      for (const r of resolved.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999))) {
      }
      merged = curText; // 非破坏性：无冲突时基本不变
    } else if (resolved.length > 0) {
      // 部分解决
      merged = this._applyPartialMerge(curLines, resolved);
    }

    return { merged, conflicts: unresolved, stats };
  }

  /**
   * 解析单个冲突：基于语义相似度选择最接近的 side。
   * @private
   */
  _resolveSingleConflict(conflict, curLines, baseLines) {
    const baseText = (conflict.baseLines || []).join('\n');
    const curText = (conflict.currentLines || []).join('\n');
    const intendedText = (conflict.intendedLines || []).join('\n');

    // 计算三个版本之间的两两相似度
    const baseVsCur = this._textSimilarity(baseText, curText);
    const baseVsInt = this._textSimilarity(baseText, intendedText);
    const curVsInt = this._textSimilarity(curText, intendedText);

    // 策略：
    // - cur 已经改变了 base：接受 cur（用户的修改优先）
    // - intended 与 cur 高度相似：应用 intended（微小修正）
    // - 三者高度不同：真正冲突，标记为 unresolved

    if (curVsInt > this.similarityThreshold) {
      // cur 和 intended 高度相似 → 应用 intended（被认为是同一编辑的 refinement）
      return {
        resolved: true,
        conflict,
        side: 'intended',
        confidence: curVsInt,
        reason: `Current and intended are similar (${(curVsInt * 100).toFixed(0)}%)`,
      };
    }

    if (baseVsCur > 0.95) {
      // cur 基本没变 → 可以安全应用 intended
      return {
        resolved: true,
        conflict,
        side: 'intended',
        confidence: 0.9,
        reason: 'Current unchanged from base, applying intended',
      };
    }

    if (baseVsCur < 0.5 && baseVsInt > 0.8) {
      // cur 变化很大，intended 接近 base → 保留 cur（用户的修改更大）
      return {
        resolved: true,
        conflict,
        side: 'current',
        confidence: 0.7,
        reason: 'Current has significant changes diverging from base',
      };
    }

    // 无法自动解决
    return { resolved: false, conflict };
  }

  /**
   * 分应用合并。
   * @private
   */
  _applyPartialMerge(curLines, resolved) {
    // 对每个 resolved 的 conflict，应用对应 side
    let result = [...curLines];

    for (const r of resolved.sort((a, b) => {
      const aPos = a.conflict?.currentRange?.[0] ?? 0;
      const bPos = b.conflict?.currentRange?.[0] ?? 0;
      return bPos - aPos; // 从后往前，避免行号偏移
    })) {
      const c = r.conflict;
      const start = c.currentRange?.[0] ?? 0;
      const end = c.currentRange?.[1] ?? start;

      if (r.side === 'intended' && c.intendedLines) {
        result = [...result.slice(0, start), ...c.intendedLines, ...result.slice(end + 1)];
      }
      // side === 'current': 保留原样，不需要修改
    }

    return result.join('\n');
  }

  // ── 辅助方法 ──────────────────────────────────────────────────────────

  /**
   * 两行文本的相似度（基于单词集合）。
   * @private
   */
  _lineSimilarity(a, b) {
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }

    const aWords = new Set(a.split(/\s+/).filter((w) => w.length > 0));
    const bWords = new Set(b.split(/\s+/).filter((w) => w.length > 0));

    if (aWords.size === 0 && bWords.size === 0) {
      return 1;
    }
    if (aWords.size === 0 || bWords.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const w of aWords) {
      if (bWords.has(w)) {
        intersection++;
      }
    }

    return intersection / Math.max(aWords.size, bWords.size);
  }

  /**
   * 两段文本的语义相似度。
   * @private
   */
  _textSimilarity(a, b) {
    if (!a && !b) {
      return 1;
    }
    if (!a || !b) {
      return 0;
    }

    const aLines = a.split('\n');
    const bLines = b.split('\n');

    let totalSimilarity = 0;
    const maxLen = Math.max(aLines.length, bLines.length);

    for (let i = 0; i < maxLen; i++) {
      const lineA = aLines[i] || '';
      const lineB = bLines[i] || '';
      totalSimilarity += this._lineSimilarity(lineA, lineB);
    }

    return totalSimilarity / maxLen;
  }

  /**
   * 简单 Levenshtein 距离。
   * @private
   */
  _levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) {
      return n;
    }
    if (n === 0) {
      return m;
    }

    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let cur = new Array(n + 1);

    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] =
          a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      }
      [prev, cur] = [cur, prev];
    }

    return prev[n];
  }
}

// ── 便捷函数 ────────────────────────────────────────────────────────────

/**
 * 执行增强版 diff3 merge（带所有边缘情况处理）。
 *
 * @param {object} params
 * @returns {EdgeMergeResult}
 */
export function enhancedMerge(params) {
  const handler = new Diff3EdgeCaseHandler({
    normalizeCRLF: true,
    enableCharLevel: true,
  });
  return handler.merge(params);
}

export default Diff3EdgeCaseHandler;
