/**
 * Diff3MergeEngine v2 — 工业级 Three-Way Merge
 *
 * 升级点：
 *  1. Myers diff 算法替代简单 LCS，精确计算 base→current 行间差异
 *  2. 严格 base/current/intended 三方冲突检测
 *  3. 结构化冲突标记（<<< current / ||| intended / === base / >>> final）
 *  4. ConflictRegion 统一格式输出
 *  5. 渐进式合并策略：clean merge → partial merge → conflict markers → reject
 */

import { hashContent } from './hashline.js';

// ── Myers Diff Algorithm ──────────────────────────────────────────────────

/**
 * 计算两个序列的 Myers diff。
 * O(ND) 时间，N = |a| + |b|，D = edit distance。
 *
 * @param {string[]} a  Base 文本行
 * @param {string[]} b  Current 文本行
 * @returns {{ type: 'keep'|'insert'|'delete', line: string, aIdx: number|null, bIdx: number|null }[]}
 */
export function myersDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  // V[k] = 到达对角线 k 的最远 x 坐标
  const V = new Int32Array(2 * max + 1);
  // 回溯路径记录
  const trace = [];

  // 快速路径：相同前缀
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) {prefix++;}

  // 后缀
  let suffixA = n, suffixB = m;
  if (prefix === 0) {
    while (suffixA > 0 && suffixB > 0 && a[suffixA - 1] === b[suffixB - 1]) {
      suffixA--;
      suffixB--;
    }
  }

  // 对中间不同部分做 Myers
  const A = a.slice(prefix, suffixA);
  const B = b.slice(prefix, suffixB);
  const aLen = A.length;
  const bLen = B.length;

  // 如果中间部分很小，直接 Myers
  for (let D = 0; D <= aLen + bLen; D++) {
    const snapshot = new Int32Array(2 * max + 1);
    for (let k = -D; k <= D; k += 2) {
      let x;
      if (k === -D || (k !== D && V[(k - 1) + max] < V[(k + 1) + max])) {
        x = V[(k + 1) + max]; // 向下移动
      } else {
        x = V[(k - 1) + max] + 1; // 向右移动
      }
      let y = x - k;

      // 沿对角线滑动
      while (x < aLen && y < bLen && A[x] === B[y]) {
        x++;
        y++;
      }

      V[k + max] = x;
      snapshot[k + max] = x;

      if (x >= aLen && y >= bLen) {
        // 找到最短编辑脚本，回溯构建 diff
        return _myersBacktrack(a, b, prefix, suffixA, suffixB, A, B, aLen, bLen, D, max, trace.concat([snapshot]), V);
      }
    }
    trace.push(snapshot);
  }

  // Fallback: 如果没有找到（理论上不会）
  return _fallbackDiff(a, b);
}

function _myersBacktrack(aFull, bFull, prefix, suffixA, suffixB, A, B, aLen, bLen, D, max, trace, V) {
  const edits = [];

  // 添加前缀
  for (let i = 0; i < prefix; i++) {
    edits.push({ type: 'keep', line: aFull[i], aIdx: i, bIdx: i });
  }

  // 从终点回溯
  let x = aLen, y = bLen;

  for (let d = D; d >= 0; d--) {
    const snapshot = d === D ? V : trace[d - 1] || new Int32Array(2 * max + 1);
    const k = x - y;

    let prevX, prevY, prevK;
    if (k === -d || (k !== d && snapshot[(k - 1) + max] < snapshot[(k + 1) + max])) {
      // 从 (k+1, y) 向下
      prevK = k + 1;
      prevX = snapshot[prevK + max] || 0;
      prevY = prevX - prevK;
    } else {
      // 从 (k-1, y+1) 向右
      prevK = k - 1;
      prevX = (snapshot[prevK + max] || 0) + 1;
      prevY = prevX - prevK;
    }

    // 对角线滑动（相同的行）
    while (x > prevX && y > prevY) {
      x--; y--;
      edits.push({ type: 'keep', line: A[x], aIdx: prefix + x, bIdx: prefix + y });
    }

    if (d > 0) {
      if (x === prevX && y > prevY) {
        // 插入
        y--;
        edits.push({ type: 'insert', line: B[y], aIdx: null, bIdx: prefix + y });
      } else if (y === prevY && x > prevX) {
        // 删除
        x--;
        edits.push({ type: 'delete', line: A[x], aIdx: prefix + x, bIdx: null });
      }
    }
  }

  // 添加后缀
  for (let i = suffixA; i < aFull.length; i++) {
    edits.push({ type: 'keep', line: aFull[i], aIdx: i, bIdx: suffixB + (i - suffixA) });
  }

  edits.reverse();

  // 修复 bIdx
  let bCounter = 0;
  for (const e of edits) {
    if (e.type === 'keep' || e.type === 'insert') {
      e.bIdx = bCounter++;
    } else {
      e.bIdx = null;
    }
  }

  return edits;
}

function _fallbackDiff(a, b) {
  // 简单逐行比较
  const result = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'keep', line: a[i], aIdx: i, bIdx: j });
      i++; j++;
    } else {
      result.push({ type: 'delete', line: a[i], aIdx: i, bIdx: null });
      i++;
    }
  }
  while (i < a.length) {
    result.push({ type: 'delete', line: a[i], aIdx: i, bIdx: null });
    i++;
  }
  while (j < b.length) {
    result.push({ type: 'insert', line: b[j], aIdx: null, bIdx: j });
    j++;
  }
  return result;
}

// ── Edit Hunk 提取 ──────────────────────────────────────────────────────

/**
 * 从 diff 中提取编辑块（连续的 insert/delete 区域）。
 */
function extractEditHunks(diff) {
  const hunks = [];
  let current = null;

  for (let i = 0; i < diff.length; i++) {
    const d = diff[i];
    if (d.type === 'keep') {
      if (current) { hunks.push(current); current = null; }
    } else {
      if (!current) {
        current = {
          baseStart: d.aIdx !== null ? d.aIdx : (i > 0 ? diff[i - 1].aIdx + 1 : 0),
          baseEnd: 0,
          curStart: d.bIdx !== null ? d.bIdx : (i > 0 ? diff[i - 1].bIdx + 1 : 0),
          curEnd: 0,
          baseLines: [],
          curLines: [],
        };
      }
      if (d.type === 'delete') {
        current.baseLines.push(d.line);
        if (d.aIdx !== null) {current.baseEnd = d.aIdx;}
      } else if (d.type === 'insert') {
        current.curLines.push(d.line);
        if (d.bIdx !== null) {current.curEnd = d.bIdx;}
      }
    }
  }
  if (current) {hunks.push(current);}

  return hunks;
}

// ── ConflictRegion ────────────────────────────────────────────────────────

/**
 * @typedef {Object} ConflictRegion
 * @property {'conflict'|'resolved'|'partial'} type
 * @property {number[]} baseRange     [start, end] base 行号 (0-based)
 * @property {number[]} currentRange  [start, end] current 行号 (0-based)
 * @property {number[]} intendedRange [start, end] intended(patch) 行号
 * @property {string[]} baseLines
 * @property {string[]} currentLines
 * @property {string[]} intendedLines
 * @property {string}   resolution    'base'|'current'|'intended'|'merge'|'unresolved'
 */

// ── Industrial Diff3 Merge ────────────────────────────────────────────────

export class IndustrialDiff3Engine {
  /**
   * 执行严格三方合并。
   *
   * @param {object} opts
   * @param {string} opts.baseText       补丁生成时的文件快照 (base)
   * @param {string} opts.currentText    当前磁盘文件 (current)
   * @param {string[]} opts.intendedHunks 要应用的 hunks 数组 (intended)
   * @param {string} [opts.path]         文件路径（用于错误报告）
   * @returns {{
   *   merged: string|null,
   *   conflicts: ConflictRegion[],
   *   strategy: 'clean'|'partial'|'markers'|'reject',
   *   stats: { baseLines: number, curLines: number, conflicts: number, resolved: number }
   * }}
   */
  static merge(opts) {
    const { baseText, currentText, intendedHunks = [], path = '' } = opts;

    const baseLines = baseText.split('\n');
    const curLines = currentText.split('\n');

    // ── Step 1: 计算 base→current 差异 ──
    const diff = myersDiff(baseLines, curLines);
    const editHunks = extractEditHunks(diff);

    // ── Step 2: 为每个 hunk 在 base 中找到位置 ──
    const intendedEntries = [];
    for (const h of (intendedHunks || [])) {
      if (h.op === 'NOP') {continue;}
      intendedEntries.push(_normalizeHunk(h, baseLines));
    }

    // ── Step 3: 检测冲突 ──
    const conflicts = [];
    const resolvedRegions = [];

    for (const intent of intendedEntries) {
      let hasConflict = false;

      for (const hunk of editHunks) {
        if (_rangesOverlap(intent.baseRange, [hunk.baseStart, hunk.baseEnd])) {
          // 冲突！
          const baseText_ = baseLines.slice(intent.baseRange[0], intent.baseRange[1] + 1).join('\n');
          const curText_ = curLines.slice(hunk.curStart, Math.min(hunk.curEnd + 1, curLines.length)).join('\n');
          const intendedText = intent.lines.join('\n');

          conflicts.push({
            type: 'conflict',
            baseRange: intent.baseRange,
            currentRange: [hunk.curStart, hunk.curEnd],
            intendedRange: intent.baseRange,
            baseLines: intent.baseRange[0] <= baseLines.length ? baseLines.slice(intent.baseRange[0], intent.baseRange[1] + 1) : [],
            currentLines: curLines.slice(hunk.curStart, Math.min(hunk.curEnd + 1, curLines.length)),
            intendedLines: intent.lines,
            resolution: 'unresolved',
            reason: 'base and current both modified the same region',
          });
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        resolvedRegions.push({
          type: 'resolved',
          baseRange: intent.baseRange,
          currentRange: _remapRange(intent.baseRange, diff),
          intendedRange: intent.baseRange,
          baseLines: intent.lines, // intended becomes the new content
          currentLines: curLines.slice(..._clampRange(intent.baseRange, curLines.length)),
          intendedLines: intent.lines,
          resolution: 'intended',
          op: intent.op,
        });
      }
    }

    // ── Step 4: 根据冲突决定策略 ──
    if (conflicts.length === 0) {
      // Clean merge
      const merged = _applyResolvedRegions(curLines, resolvedRegions, diff);
      return {
        merged,
        conflicts: [],
        strategy: 'clean',
        stats: { baseLines: baseLines.length, curLines: curLines.length, conflicts: 0, resolved: resolvedRegions.length },
      };
    }

    if (resolvedRegions.length > 0 && conflicts.length <= 3) {
      // Partial merge: 应用无冲突部分
      try {
        const merged = _applyResolvedRegions(curLines, resolvedRegions, diff);
        return {
          merged,
          conflicts,
          strategy: 'partial',
          partialMerge: true,
          unresolvedCount: conflicts.length,
          stats: { baseLines: baseLines.length, curLines: curLines.length, conflicts: conflicts.length, resolved: resolvedRegions.length },
        };
      } catch {
        // 无法部分合并
      }
    }

    // Markers merge: 生成带冲突标记的文本
    const mergedWithMarkers = _generateConflictMarkers(curLines, conflicts, diff);
    return {
      merged: mergedWithMarkers,
      conflicts,
      strategy: 'markers',
      stats: { baseLines: baseLines.length, curLines: curLines.length, conflicts: conflicts.length, resolved: 0 },
    };
  }
}

// ── 内部函数 ────────────────────────────────────────────────────────────

function _normalizeHunk(h, baseLines) {
  const start = Math.max(0, (h.start || 1) - 1);
  const end = Math.max(start, (h.end || h.start || 1) - 1);
  return {
    op: h.op,
    lines: h.lines || [],
    baseRange: [
      start,
      Math.min(end, baseLines.length - 1),
    ],
  };
}

function _rangesOverlap(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
}

function _remapRange(baseRange, diff) {
  // 通过 diff 映射 base 行号到 current 行号
  let curIdx = 0;
  let baseIdx = 0;
  const mapping = new Map();

  for (const d of diff) {
    if (d.type === 'keep' || d.type === 'delete') {
      mapping.set(baseIdx, d.type === 'keep' ? curIdx : -1);
      baseIdx++;
    }
    if (d.type === 'keep' || d.type === 'insert') {
      curIdx++;
    }
  }

  const start = mapping.get(baseRange[0]);
  const end = mapping.get(baseRange[1]);
  if (start !== undefined && end !== undefined && start >= 0 && end >= 0) {
    return [start, end];
  }
  return baseRange; // fallback
}

function _clampRange(range, maxLen) {
  return [Math.max(0, range[0]), Math.min(range[1], maxLen - 1)];
}

function _applyResolvedRegions(curLines, regions, diff) {
  // 按 baseRange start 降序排序，从后往前应用
  const sorted = [...regions].sort((a, b) => b.baseRange[0] - a.baseRange[0]);

  let result = [...curLines];

  // 合并 diff inserts/deletes 信息
  const diffMap = new Map();
  for (const d of diff) {
    if (d.type === 'delete') {diffMap.set(d.aIdx, { type: 'delete' });}
    if (d.type === 'insert') {
      const key = d.aIdx;
      if (!diffMap.has(key)) {diffMap.set(key, { type: 'insert', lines: [] });}
      diffMap.get(key).lines = (diffMap.get(key).lines || []).concat(d.line);
    }
  }

  for (const r of sorted) {
    const [s, e] = r.baseRange;
    const insert = r.intendedLines;
    result = [
      ...result.slice(0, s),
      ...insert,
      ...result.slice(e + 1),
    ];
  }

  return result.join('\n');
}

function _generateConflictMarkers(curLines, conflicts, diff) {
  const lines = [...curLines];

  // 对每个冲突，生成标准冲突标记
  const allMarkers = [];
  for (const c of conflicts) {
    const pos = c.baseRange[0];
    const marker = [
      '<<<<<<< CURRENT',
      ...(c.currentLines.length > 0 ? c.currentLines : ['[empty]']),
      '||||||| INTENDED',
      ...(c.intendedLines.length > 0 ? c.intendedLines : ['[empty]']),
      '=======',
      ...(c.baseLines.length > 0 ? c.baseLines : ['[empty]']),
      '>>>>>>>',
    ];
    allMarkers.push({ pos, lines: marker });
  }

  // 从后往前插入标记
  allMarkers.sort((a, b) => b.pos - a.pos);
  for (const m of allMarkers) {
    lines.splice(m.pos, 0, ...m.lines);
  }

  return lines.join('\n');
}

// ── 导出 ─────────────────────────────────────────────────────────────────

export default IndustrialDiff3Engine;
