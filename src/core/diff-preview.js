/**
 * Diff Preview Engine
 *
 * 在写文件前计算 unified diff，供 UI 以 "hunk 卡片" 形式让用户确认或
 * 逐段拒绝。实现方式是使用"行粒度 diff + 上下文窗口"生成标准 unified diff
 * 文本，同时输出结构化 hunks 供渲染器解析与高亮。
 *
 * 设计目标：
 *   - 零第三方依赖（myers diff 自实现，避免 npm 差异）
 *   - 可作为 "写入前确认" 的 gate：先 produce diff -> 用户确认 -> 再写
 *   - 对 edit_file 类型工具返回同样结构（即 "直接 hunk 输入"）
 *
 * 输出结构（DiffPreview）：
 *   {
 *     path: '相对路径',
 *     hunks: [ { header, lines: [{ kind, content, oldLineNo, newLineNo }] } ],
 *     unifiedDiff: '标准 unified diff 文本',
 *     stats: { added, removed, unchanged, hunkCount }
 *   }
 */

import path from 'node:path';
import fs from 'node:fs';

// ----------------- Myers Diff (O(ND) 变体，只输出编辑脚本) ----------------
// 算法参考: "An O(ND) Difference Algorithm and Its Variations" (Eugene Myers, 1986)
// 这里实现一个基于 dp 的简化版本，能在 10k 行内稳定运行。
function _myersDiff(a, b) {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;
  const V = new Array(2 * MAX + 1).fill(0); // 存每个 diagonal 上的 x 值
  const trace = [];

  for (let D = 0; D <= MAX; D++) {
    trace.push(V.slice());
    for (let k = -D; k <= D; k += 2) {
      let x;
      if (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) {
        x = V[MAX + k + 1]; // 向下移动
      } else {
        x = V[MAX + k - 1] + 1; // 向右移动
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      V[MAX + k] = x;
      if (x >= N && y >= M) {
        // 回溯得到编辑脚本
        return _backtrack(trace, a, b);
      }
    }
  }
  return _backtrack(trace, a, b);
}

function _backtrack(trace, a, b) {
  // 从终点 (N, M) 反向走回 (0, 0)，产生操作序列
  let x = a.length;
  let y = b.length;
  const ops = []; // { op: 'equal'|'del'|'ins', old: string, new: string }
  for (let D = trace.length - 1; D > 0; D--) {
    const V = trace[D];
    const MAX = a.length + b.length;
    const k = x - y;
    const prevK = (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) ? k + 1 : k - 1;
    const prevX = V[MAX + prevK];
    const prevY = prevX - prevK;
    // 先回溯对角线
    while (x > prevX && y > prevY) { x--; y--; ops.push({ op: 'equal', old: a[x], new: b[y] }); }
    if (D > 0) {
      if (x === prevX) {
        y--; ops.push({ op: 'ins', old: null, new: b[y] });
      } else {
        x--; ops.push({ op: 'del', old: a[x], new: null });
      }
    }
  }
  return ops.reverse();
}

function _splitLines(text) {
  if (text == null) {return [];}
  const str = typeof text === 'string' ? text : String(text);
  if (str.length === 0) {return [];}
  // 保留换行符在行尾：按 '\n' 切分，再把 '\r' 去掉
  const parts = str.split('\n');
  const lines = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    // 将末尾的 \r 视为换行一部分
    if (p.endsWith('\r')) {p = p.slice(0, -1);}
    lines.push(p);
  }
  // 如果原文末有换行，split 结果会多出一个空串。去掉 trailing 空串以避免
  // 末尾多余删除行。
  if (lines.length > 0 && lines[lines.length - 1] === '' && str.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

// ----------------- Hunk 聚合 ----------------
const DEFAULT_CONTEXT = 3;

function _buildHunks(ops, context = DEFAULT_CONTEXT) {
  const hunks = [];
  let i = 0;
  while (i < ops.length) {
    // 跳过 leading equal 直到遇到非 equal
    if (ops[i].op === 'equal') { i++; continue; }
    // 往前带 context 行（最多 context 行）
    let j = i;
    // 先退 context（只退 equal 段）
    let startOld = 0, startNew = 0;
    // 先扫描到之前，计算 old/new line 编号
    {
      let ol = 1, nl = 1;
      for (let k = 0; k < j; k++) {
        if (ops[k].op === 'equal' || ops[k].op === 'del') {ol++;}
        if (ops[k].op === 'equal' || ops[k].op === 'ins') {nl++;}
      }
      startOld = ol; startNew = nl;
    }
    // 带前 context
    let contextBefore = 0;
    while (i - contextBefore - 1 >= 0 && ops[i - contextBefore - 1].op === 'equal' && contextBefore < context) {
      contextBefore++;
    }
    const hunkStart = i - contextBefore;
    // 扩展 hunk：直到 non-equal 段结束 + 后 context，且与下一个变更段距离 <= 2*context 时合并
    let hunkEnd = i;
    let gapCount = 0;
    while (hunkEnd < ops.length) {
      if (ops[hunkEnd].op === 'equal') {
        gapCount++;
        if (gapCount > 2 * context) { break; }
      } else {
        gapCount = 0;
      }
      hunkEnd++;
    }
    // 裁剪尾部多余 equal（超过 context 的）
    let tailCount = 0;
    while (hunkEnd > hunkStart && ops[hunkEnd - 1].op === 'equal' && tailCount < context) {
      tailCount++;
      hunkEnd--;
    }
    // 裁剪尾部为 context 行
    const finalEnd = Math.min(hunkEnd + context, ops.length);

    // 计算 hunk 的起始 old/new 编号（基于 hunkStart 前）
    {
      let ol = 1, nl = 1;
      for (let k = 0; k < hunkStart; k++) {
        if (ops[k].op === 'equal' || ops[k].op === 'del') {ol++;}
        if (ops[k].op === 'equal' || ops[k].op === 'ins') {nl++;}
      }
      startOld = ol; startNew = nl;
    }

    // 生成行 + 统计
    const lines = [];
    let added = 0, removed = 0, unchanged = 0;
    let endOld = startOld, endNew = startNew;
    for (let k = hunkStart; k < finalEnd; k++) {
      const op = ops[k];
      if (op.op === 'equal') {
        lines.push({ kind: ' ', content: op.old, oldLineNo: endOld, newLineNo: endNew });
        endOld++; endNew++; unchanged++;
      } else if (op.op === 'del') {
        lines.push({ kind: '-', content: op.old, oldLineNo: endOld, newLineNo: null });
        endOld++; removed++;
      } else if (op.op === 'ins') {
        lines.push({ kind: '+', content: op.new, oldLineNo: null, newLineNo: endNew });
        endNew++; added++;
      }
    }
    const oldRangeLen = endOld - startOld;
    const newRangeLen = endNew - startNew;
    const header = `@@ -${startOld}${oldRangeLen === 1 ? '' : ',' + oldRangeLen} +${startNew}${newRangeLen === 1 ? '' : ',' + newRangeLen} @@`;
    hunks.push({ header, lines, stats: { added, removed, unchanged } });
    i = finalEnd;
  }
  return hunks;
}

// ----------------- 公开 API ----------------
/**
 * 在内存中计算文件 diff。
 * @param {object} opts
 * @param {string} opts.path - 相对路径（仅用于显示）
 * @param {string} [opts.oldContent] - 旧内容；不传则尝试读取 filePath
 * @param {string} opts.newContent - 新内容
 * @param {string} [opts.workingDirectory] - oldContent 为空时读取文件的根目录
 * @param {number} [opts.context=3] - 上下文行数
 */
export function computeDiff({ path: relPath, oldContent, newContent, workingDirectory, context = DEFAULT_CONTEXT }) {
  let oldLines;
  if (oldContent == null && workingDirectory && relPath) {
    try {
      const abs = path.isAbsolute(relPath) ? relPath : path.join(workingDirectory, relPath);
      oldLines = _splitLines(fs.readFileSync(abs, 'utf8'));
    } catch {
      oldLines = [];
    }
  } else {
    oldLines = _splitLines(oldContent);
  }
  const newLines = _splitLines(newContent);
  const ops = _myersDiff(oldLines, newLines);
  const hunks = _buildHunks(ops, context);

  const stats = hunks.reduce(
    (acc, h) => ({
      added: acc.added + h.stats.added,
      removed: acc.removed + h.stats.removed,
      unchanged: acc.unchanged + h.stats.unchanged,
    }),
    { added: 0, removed: 0, unchanged: 0 },
  );

  const headerOld = `--- ${relPath || 'a'}`;
  const headerNew = `+++ ${relPath || 'b'}`;
  const body = hunks.map(h =>
    h.header + '\n' + h.lines.map(l => l.kind + l.content).join('\n'),
  ).join('\n');
  const unifiedDiff = hunks.length
    ? `${headerOld}\n${headerNew}\n${body}\n`
    : '';

  return {
    path: relPath,
    hunks,
    unifiedDiff,
    stats: {
      ...stats,
      hunkCount: hunks.length,
    },
  };
}

/**
 * 判断 diff 是否为空（完全一致）。
 */
export function isNoop(diff) {
  return !diff || diff.stats.hunkCount === 0;
}

/**
 * 将用户选择保留的 hunk 列表与被丢弃的 hunk 合并，
 * 返回 "最终应写入磁盘的新内容"。
 * @param {object} diff - computeDiff 的返回值
 * @param {boolean[]} acceptHunks - 与 hunks 同长，true = 采用
 * @param {string} baseContent - 原文（未改动的基底）
 */
export function applySelectedHunks(diff, acceptHunks, baseContent) {
  if (!diff || !Array.isArray(diff.hunks)) {return baseContent;}
  // 先从原文逐行构建，再根据 hunk 位置按顺序替换
  const oldLines = _splitLines(baseContent);
  // 从后向前处理，避免索引错位
  const sortedHunks = [...diff.hunks].map((h, idx) => ({ h, idx })).sort((A, B) => {
    // 按起始 old line 号从大到小
    const aFirst = A.h.lines.find(l => l.oldLineNo != null)?.oldLineNo ?? 0;
    const bFirst = B.h.lines.find(l => l.oldLineNo != null)?.oldLineNo ?? 0;
    return bFirst - aFirst;
  });

  let working = oldLines.slice();
  for (const { h, idx } of sortedHunks) {
    if (acceptHunks[idx]) {
      // 找到这个 hunk 的替换区间
      const oldStart = h.lines.find(l => l.oldLineNo != null)?.oldLineNo ?? 0;
      const lastOld = [...h.lines].reverse().find(l => l.oldLineNo != null)?.oldLineNo ?? oldStart;
      const replaceLines = h.lines
        .filter(l => l.kind !== '-')
        .map(l => l.content);
      // old line 号是 1-based；替换 [oldStart-1, lastOld]
      working.splice(oldStart - 1, lastOld - oldStart + 1, ...replaceLines);
    }
  }
  // 保留原文的换行风格
  const hasTrailingNewline = typeof baseContent === 'string' && (baseContent.endsWith('\n') || baseContent.endsWith('\r\n'));
  return working.join('\n') + (hasTrailingNewline ? '\n' : '');
}

export default { computeDiff, isNoop, applySelectedHunks };
