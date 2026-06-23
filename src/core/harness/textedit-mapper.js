/**
 * TextEditMapper — 将 LSP TextEdit 转换为 Hashline Patch，处理同行多 edit、
 * overlapping edit、mixed create-delete-rename 等复杂场景。
 *
 * 核心问题：LSP 返回的 TextEdit 是扁平列表，但同一行上可能有多个 edit、
 * 跨行重叠的 edit、或混合 create/delete/rename 操作。此模块将其转换为
 * Hashline 的非重叠操作序列，并检测冲突。
 *
 * 用法：
 * ```js
 * const mapper = new TextEditMapper({ filePath, fileContent });
 * const { patch, conflicts, stats } = mapper.convert(textEdits);
 * ```
 */

import { hashContent, computeTag, Patch, Section, OP_SWAP, OP_DEL, OP_INS_PRE, OP_INS_POST, OP_NOP } from './hashline.js';

// ── 类型定义 ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TextEdit
 * @property {{line:number, character:number}} range       LSP Range (0-based)
 * @property {{line:number, character:number}} range.start
 * @property {{line:number, character:number}} range.end
 * @property {string} newText                              替换文本
 */

/**
 * @typedef {Object} MappedEdit
 * @property {number} startLine    1-based 起始行
 * @property {number} endLine      1-based 结束行（闭区间）
 * @property {string} op           SWAP | DEL | INS.PRE | INS.POST
 * @property {string[]} lines      新内容行
 * @property {TextEdit} source     原始 TextEdit
 * @property {boolean} merged      是否被合并
 * @property {string[]} mergedFrom 从哪些 edit 合并而来
 */

/**
 * @typedef {Object} EditConflict
 * @property {string} type         overlap | adjacent | same-line-multi
 * @property {TextEdit[]} edits    冲突的编辑
 * @property {MappedEdit} resolution 解决方式
 * @property {string} reason      冲突原因
 */

// ── TextEditMapper ──────────────────────────────────────────────────────

export class TextEditMapper {
  /**
   * @param {object} opts
   * @param {string} opts.filePath     文件路径
   * @param {string} opts.fileContent  当前文件内容（用于 Hashline tag 计算）
   * @param {object} [opts.options]    配置选项
   * @param {boolean} [opts.options.autoMerge=true]       自动合并相邻相同行 edit
   * @param {boolean} [opts.options.detectConflicts=true]  检测冲突
   * @param {boolean} [opts.options.strictOverlap=true]    严格重叠检测
   */
  constructor(opts = {}) {
    this.filePath = opts.filePath || '';
    this.fileContent = opts.fileContent || '';
    this.options = {
      autoMerge: opts.options?.autoMerge !== false,
      detectConflicts: opts.options?.detectConflicts !== false,
      strictOverlap: opts.options?.strictOverlap !== false,
    };

    // 缓存文件行
    this._lines = this.fileContent ? this.fileContent.split('\n') : [];
    this._tag = this.fileContent ? computeTag(this.fileContent) : '';
  }

  /**
   * 将一组 TextEdit 转换为 Hashline MappedEdit 列表。
   *
   * @param {TextEdit[]} edits
   * @returns {{ patch: import('./hashline.js').Patch, mappedEdits: MappedEdit[], conflicts: EditConflict[], stats: object }}
   */
  convert(edits) {
    if (!edits || edits.length === 0) {
      return {
        patch: null,
        mappedEdits: [],
        conflicts: [],
        stats: { total: 0, mapped: 0, merged: 0, conflicts: 0, create: 0, delete: 0, modify: 0, rename: 0 },
      };
    }

    // 1) 按位置排序 (startLine, startChar)
    const sorted = [...edits].sort((a, b) => {
      const aStart = a.range.start.line * 100000 + a.range.start.character;
      const bStart = b.range.start.line * 100000 + b.range.start.character;
      return aStart - bStart;
    });

    // 2) 分类每个 edit
    const classified = sorted.map(e => this._classify(e));

    // 3) 检测并合并同行多 edit / overlapping edits
    const { mapped, conflicts } = this._resolveConflicts(classified);

    // 4) 生成 Hashline Patch 格式
    const patch = this._toHashlinePatch(mapped);

    const stats = {
      total: edits.length,
      mapped: mapped.length,
      merged: mapped.filter(m => m.merged).length,
      conflicts: conflicts.length,
      create: mapped.filter(m => m.op === 'INS.PRE' || m.op === 'INS.POST').length,
      delete: mapped.filter(m => m.op === 'DEL').length,
      modify: mapped.filter(m => m.op === 'SWAP').length,
    };

    return { patch, mappedEdits: mapped, conflicts, stats };
  }

  // ── 分类 ──────────────────────────────────────────────────────────────

  /**
   * 将 LSP TextEdit 分类为 Hashline 操作类型。
   * @private
   */
  _classify(edit) {
    const { range, newText } = edit;
    const startLine = range.start.line + 1; // 1-based
    const endLine = range.end.line + 1;
    const startChar = range.start.character;
    const endChar = range.end.character;

    const hasOldContent = !(startLine === endLine && startChar === endChar);
    const hasNewContent = newText && newText.length > 0;

    // 分类
    let op;
    const newLines = hasNewContent ? newText.split('\n') : [];

    if (!hasOldContent && hasNewContent) {
      // 纯插入：startChar == endChar, newText 非空
      op = 'INS.PRE';
    } else if (hasOldContent && !hasNewContent) {
      // 纯删除
      op = 'DEL';
    } else if (hasOldContent && hasNewContent) {
      // 替换（SWAP）
      op = 'SWAP';
    } else {
      // 空编辑（no-op）
      op = 'NOP';
    }

    // 获取原始内容（用于冲突检测）
    const originalContent = hasOldContent ? this._getContent(startLine, endLine, startChar, endChar) : '';

    return {
      startLine,
      endLine,
      op,
      lines: newLines,
      source: edit,
      originalContent,
      merged: false,
      mergedFrom: [],
      startChar,
      endChar,
    };
  }

  /**
   * 从文件中提取指定范围的内容。
   * @private
   */
  _getContent(startLine, endLine, startChar, endChar) {
    if (startLine < 1 || startLine > this._lines.length) return '';
    const s = startLine - 1;
    const e = Math.min(endLine - 1, this._lines.length - 1);

    if (s === e) {
      return this._lines[s].substring(startChar, Math.min(endChar, this._lines[s].length));
    }

    const parts = [];
    parts.push(this._lines[s].substring(startChar));
    for (let i = s + 1; i < e; i++) {
      parts.push(this._lines[i]);
    }
    if (e < this._lines.length) {
      parts.push(this._lines[e].substring(0, Math.min(endChar, this._lines[e].length)));
    }
    return parts.join('\n');
  }

  // ── 冲突检测与合并 ────────────────────────────────────────────────────

  /**
   * 检测同一行上的多个 edit 并合并，检测 overlapping edit 并标记冲突。
   * @private
   */
  _resolveConflicts(classified) {
    const conflicts = [];
    const resolved = [];

    let i = 0;
    while (i < classified.length) {
      const cur = classified[i];
      if (cur.op === 'NOP') { i++; continue; }

      // 检查与前一个 resolved edit 是否有冲突
      if (resolved.length > 0 && this.options.detectConflicts) {
        const prev = resolved[resolved.length - 1];

        // 情况 1: 同一行的多个 edit —— 批量收集并合并
        if (cur.startLine === prev.endLine && cur.startLine === prev.startLine) {
          if (this.options.autoMerge) {
            // 收集该行所有连续的 edit（包括 prev 及其后续）
            const sameLineEdits = [];
            // 先将 prev 从 resolved 中取出
            const prevEdit = resolved.pop();

            // 找到 classified 中 prev 对应的位置
            let k = i - 1;
            while (k >= 0 && classified[k] !== prevEdit && classified[k].startLine === prevEdit.startLine) k--;
            // prev 可能已经是合并后的，需要拆分其 mergedFrom
            if (prevEdit.merged && prevEdit.mergedFrom.length > 0) {
              // 将 prevEdit.mergedFrom 中的原始 edits 加入（但它们在 classified 中已被合并）
              // 直接收集该行所有原始 classified edits
              let scanIdx = 0;
              while (scanIdx < classified.length && classified[scanIdx].startLine < cur.startLine) scanIdx++;
              while (scanIdx < classified.length && classified[scanIdx].startLine === cur.startLine) {
                if (classified[scanIdx].op !== 'NOP') {
                  sameLineEdits.push(classified[scanIdx]);
                }
                scanIdx++;
              }
              // 跳过已处理的
              i = scanIdx;
            } else {
              // prev 未合并过：从 prev 位置开始收集
              sameLineEdits.push(prevEdit);
              while (i < classified.length && classified[i].startLine === cur.startLine) {
                if (classified[i].op !== 'NOP') {
                  sameLineEdits.push(classified[i]);
                }
                i++;
              }
            }

            if (sameLineEdits.length >= 2) {
              const merged = this._mergeSameLineEditsBatch(sameLineEdits);
              if (merged) {
                resolved.push(merged);
                continue;
              }
              // 批量合并失败，回退为冲突
              const lastEdit = sameLineEdits[sameLineEdits.length - 1];
              resolved.push(sameLineEdits[0]);
              for (let m = 1; m < sameLineEdits.length; m++) {
                conflicts.push({
                  type: 'same-line-multi',
                  edits: [sameLineEdits[m - 1].source, sameLineEdits[m].source],
                  resolution: null,
                  reason: `Same-line multiple edits at line ${sameLineEdits[m].startLine} cannot be auto-merged`,
                });
                resolved.push(sameLineEdits[m]);
              }
              continue;
            }
            // 无法合并，回退为逐个添加
            for (const edit of sameLineEdits) resolved.push(edit);
            continue;
          }

          // 不自动合并：记录冲突
          conflicts.push({
            type: 'same-line-multi',
            edits: [prev.source, cur.source],
            resolution: null,
            reason: `Same-line multiple edits at line ${cur.startLine} cannot be auto-merged`,
          });
          resolved.push(cur);
          i++;
          continue;
        }

        // 情况 2: 行号重叠（overlapping）
        if (this.options.strictOverlap && cur.startLine <= prev.endLine) {
          const overlapDetected = this._detectOverlap(prev, cur);
          if (overlapDetected) {
            conflicts.push({
              type: 'overlap',
              edits: [prev.source, cur.source],
              resolution: null,
              reason: overlapDetected.reason,
            });
            resolved.push(cur);
            i++;
            continue;
          }
        }

        // 情况 3: 相邻行的混合操作（create + delete + rename）
        if (cur.startLine === prev.endLine + 1) {
          const mixedPattern = this._detectMixedPattern(prev, cur);
          if (mixedPattern) {
            resolved[resolved.length - 1] = { ...prev, ...mixedPattern.merged };
            i++;
            continue;
          }
        }
      }

      resolved.push(cur);
      i++;
    }

    return { mapped: resolved, conflicts };
  }

  /**
   * 批量合并同一行的多个 edit。
   * 按字符位置排序后，一次性构建合并结果，避免迭代式合并的坐标漂移问题。
   * @private
   */
  _mergeSameLineEditsBatch(edits) {
    if (edits.length < 2) return edits[0] || null;

    const lineIdx = edits[0].startLine - 1;
    if (lineIdx < 0 || lineIdx >= this._lines.length) return null;

    const orgLine = this._lines[lineIdx];

    // 按 startChar 排序
    const sorted = [...edits].sort((a, b) => a.startChar - b.startChar);

    // 检测字符级重叠
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.startChar < prev.endChar) {
        // 字符级重叠：拒绝自动合并
        return null;
      }
    }

    // 无重叠：逐段构建合并结果
    const parts = [];
    let cursor = 0;

    for (const edit of sorted) {
      // 保留 edit 之前的原始内容
      if (edit.startChar > cursor) {
        parts.push(orgLine.substring(cursor, edit.startChar));
      }
      // 插入替换内容
      const newText = edit.lines.join('\n');
      if (newText) parts.push(newText);
      cursor = edit.endChar;
    }

    // 保留最后一个 edit 之后的原始内容
    if (cursor < orgLine.length) {
      parts.push(orgLine.substring(cursor));
    }

    const newLine = parts.join('');

    return {
      op: 'SWAP',
      startLine: edits[0].startLine,
      endLine: edits[0].endLine,
      lines: [newLine],
      source: edits[0].source,
      merged: true,
      mergedFrom: sorted.map(e => e.source),
      startChar: sorted[0].startChar,
      endChar: sorted[sorted.length - 1].endChar,
    };
  }

  /**
   * 检测两个 edit 是否有内容重叠冲突。
   * @private
   */
  _detectOverlap(prev, cur) {
    // 简单检测：如果 prev 修改了行 N 到 M，cur 修改了行 N' 到 M'，
    // 且区间重叠，则为冲突
    if (cur.startLine <= prev.endLine && prev.startLine <= cur.endLine) {
      return {
        reason: `Overlapping edits: prev covers lines [${prev.startLine}, ${prev.endLine}], cur covers [${cur.startLine}, ${cur.endLine}]`,
      };
    }
    return null;
  }

  /**
   * 检测 mixed create-delete-rename 模式。
   * 例如：- 删除旧函数 + 在同一位置创建新函数 = rename。
   * @private
   */
  _detectMixedPattern(prev, cur) {
    // create + delete = 可能是 rename
    if (prev.op === 'DEL' && (cur.op === 'INS.PRE' || cur.op === 'INS.POST')) {
      // 相邻的 delete + insert：可能是 rename
      const oldContent = prev.originalContent;
      const newContent = cur.lines.join('\n');

      // 计算相似度（简单 Levenshtein 比率）
      const similarity = this._computeSimilarity(oldContent, newContent);
      if (similarity > 0.5) {
        return {
          pattern: 'rename',
          merged: {
            op: 'SWAP',
            startLine: prev.startLine,
            endLine: prev.endLine,
            lines: cur.lines,
            merged: true,
            mergedFrom: [prev.source, cur.source],
            renameConfidence: similarity,
          },
        };
      }
    }

    // delete + create = 也可能是 create（新增）
    if (prev.op === 'DEL' && cur.op === 'INS.PRE') {
      const oldContent = prev.originalContent;
      const newContent = cur.lines.join('\n');
      const similarity = this._computeSimilarity(oldContent, newContent);
      if (similarity < 0.3) {
        return {
          pattern: 'replace',
          merged: {
            op: 'SWAP',
            startLine: prev.startLine,
            endLine: prev.endLine,
            lines: cur.lines,
            merged: true,
            mergedFrom: [prev.source, cur.source],
            renameConfidence: similarity,
          },
        };
      }
    }

    return null;
  }

  /**
   * 计算两个文本的相似度（0-1）。
   * @private
   */
  _computeSimilarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;

    const aWords = new Set(a.toLowerCase().split(/\s+/));
    const bWords = new Set(b.toLowerCase().split(/\s+/));

    if (aWords.size === 0 && bWords.size === 0) return 1;
    if (aWords.size === 0 || bWords.size === 0) return 0;

    let intersection = 0;
    for (const w of aWords) {
      if (bWords.has(w)) intersection++;
    }

    return intersection / Math.max(aWords.size, bWords.size);
  }

  // ── 生成 Hashline Patch ────────────────────────────────────────────────

  /**
   * 将 MappedEdit 列表转换为 Hashline Patch。
   * @private
   */
  _toHashlinePatch(mappedEdits) {
    if (mappedEdits.length === 0) return null;

    const hunks = mappedEdits
      .filter(e => e.op !== OP_NOP)
      .map(e => ({
        op: e.op,
        start: e.startLine,
        end: e.endLine,
        lines: e.lines,
        srcLine: 0,
      }));

    if (hunks.length === 0) return null;

    const section = new Section(this.filePath, this._tag, hunks);
    return new Patch([section]);
  }

  /**
   * 生成 Hashline patch 文本（不经过 Patch 对象）。
   */
  toPatchText(mappedEdits) {
    if (!mappedEdits || mappedEdits.length === 0) return '';

    const lines = [];
    lines.push(`[${this.filePath}#${this._tag}]`);

    for (const e of mappedEdits) {
      if (e.op === 'NOP') continue;
      if (e.op === 'SWAP') {
        lines.push(`SWAP ${e.startLine}.=${e.endLine}:`);
        for (const l of e.lines) lines.push(`+${l}`);
      } else if (e.op === 'DEL') {
        lines.push(`DEL ${e.startLine}.=${e.endLine}`);
      } else if (e.op === 'INS.PRE') {
        lines.push(`INS.PRE ${e.startLine}=`);
        for (const l of e.lines) lines.push(`+${l}`);
      } else if (e.op === 'INS.POST') {
        lines.push(`INS.POST ${e.startLine}=`);
        for (const l of e.lines) lines.push(`+${l}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }
}

// ── 测试辅助: 直接转换，返回文本 ─────────────────────────────────────────

/**
 * 便捷函数：将 TextEdit 列表转换为 Hashline patch 文本。
 *
 * @param {string} filePath
 * @param {string} fileContent
 * @param {TextEdit[]} edits
 * @param {object} [options]
 * @returns {{ patchText: string, conflicts: EditConflict[], stats: object }}
 */
export function convertTextEditsToHashline(filePath, fileContent, edits, options = {}) {
  const mapper = new TextEditMapper({
    filePath,
    fileContent,
    options,
  });

  const result = mapper.convert(edits);
  const patchText = mapper.toPatchText(result.mappedEdits);

  return {
    patchText,
    conflicts: result.conflicts,
    stats: result.stats,
    mappedEdits: result.mappedEdits,
  };
}

export default TextEditMapper;
