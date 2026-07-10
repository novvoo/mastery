/**
 * File System Tools: read_file, write_file, edit_file, search, glob, list_dir
 *
 * SECURITY: All tools enforce path containment within the working directory to
 * prevent path traversal attacks (e.g. "../../etc/passwd" or absolute paths
 * pointing outside the sandbox).
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { join, resolve, sep, isAbsolute } from 'path';
import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { ToolCategory } from '../../core/types/index.js';
import { computeTag } from '../../core/harness/hashline/index.js';

export const HASHLINE_TOOL_DESCRIPTION = `Apply compact, line-anchored edits to existing files with the Hashline patch language.

Use this after reading the exact lines you need to change. The latest read gives you the file text and the content tag for the section header. For new files, use write_file instead.

<format>
Every section starts with [path/to/file#tag].
Line numbers are 1-based and refer to the original file snapshot for this one call.
A header ending in ":" takes + body rows. DEL has no body.
</format>

<ops>
SWAP N.=M: replace original lines N through M with the following + rows.
DEL N.=M delete original lines N through M. DEL N deletes one line.
INS.PRE N: insert the following + rows immediately before line N.
INS.POST N: insert the following + rows immediately after line N.
INS.HEAD: insert the following + rows at the start of the file.
INS.TAIL: insert the following + rows at the end of the file.
</ops>

<body>
Every body row starts with +. The text after + is written verbatim, including indentation.
+ alone writes a blank line.
Do not write -old lines or unchanged context lines. To keep a line, leave it out of every range.
Literal Markdown bullets still need the body prefix: "+- item".
</body>

<examples>
[src/app.js#abc123]
SWAP 2.=2:
+const enabled = true;

[src/app.js#abc123]
INS.POST 5:
+  return result;

[README.md#def456]
INS.TAIL:
+## Notes
+- item

[src/app.js#abc123]
DEL 8
</examples>

<failure>
If the tag is stale, the range is wrong, or the result is surprising, stop and read the file again before retrying.
After a successful edit, use the new tag from the result or read again before making another Hashline patch.
</failure>

<critical>
Use tags and line numbers from the latest read.
Keep ranges tight: touch only lines that change.
Body rows are final content, not an old/new diff.
Use write_file for new files.
</critical>`;

/**
 * 检测内容是否为 base64 编码，并在适当时解码
 * - data: URI 格式: "data:[<mediatype>][;base64],<data>"
 * - 纯 base64 字符串: 仅 A-Za-z0-9+/= 字符，长度 > 40
 * @param {string} content
 * @returns {{ isBase64: boolean, decoded: Buffer|string|null }}
 */
function tryDecodeBase64(content) {
  if (typeof content !== 'string') {
    return { isBase64: false, decoded: null };
  }

  // 1) data URI 格式
  const dataUriMatch = content.trim().match(/^data:[^;,\s]*;base64,([A-Za-z0-9+/=\s]+)$/);
  if (dataUriMatch) {
    try {
      const b64 = dataUriMatch[1].replace(/\s/g, '');
      return { isBase64: true, decoded: Buffer.from(b64, 'base64') };
    } catch {
      return { isBase64: false, decoded: null };
    }
  }

  // 2) 纯 base64 字符串检测 — 必须是无空白的纯 base64 字符
  const trimmed = content.trim();
  if (trimmed.length > 40 && trimmed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      // 反向验证：解码后重新编码应接近原字符串
      const reencoded = buf.toString('base64');
      if (
        reencoded === trimmed ||
        reencoded === trimmed.replace(/=+$/, '') + '=='.slice((3 - (trimmed.length % 4)) % 3)
      ) {
        return { isBase64: true, decoded: buf };
      }
    } catch {
      // fall through
    }
  }

  return { isBase64: false, decoded: null };
}

/**
 * Safely resolve a user-supplied path and verify it stays within the working
 * directory.  Rejects absolute paths, ".." traversal segments, and any
 * canonical result that does not start with the working directory prefix.
 *
 * @param {string} workingDirectory - The sandbox root (already resolved).
 * @param {string} userPath - The (possibly-relative) path supplied by the user.
 * @returns {{ ok: true, fullPath: string, relPath: string } | { ok: false, error: string }}
 */
function safeResolvePath(workingDirectory, userPath) {
  if (userPath === undefined || userPath === null || userPath === '') {
    return { ok: false, error: 'Error: Path is empty.' };
  }
  if (typeof userPath !== 'string') {
    return { ok: false, error: 'Error: Path must be a string.' };
  }

  const trimmed = userPath.trim();
  const normalizedWorkingDir = resolve(workingDirectory).replace(/[\\/]+$/, '') + sep;

  // If an absolute path is supplied AND it sits inside the working directory,
  // auto-convert it to the equivalent relative path so downstream checks pass.
  let effectivePath = trimmed;
  if (isAbsolute(trimmed)) {
    const resolved = resolve(trimmed);
    if (
      resolved.startsWith(normalizedWorkingDir) ||
      resolved === normalizedWorkingDir.slice(0, -1)
    ) {
      effectivePath = resolved.slice(normalizedWorkingDir.length);
    } else {
      return { ok: false, error: `Error: Absolute path is outside working directory: ${trimmed}` };
    }
  }

  // Reject any path that contains an explicit ".." segment.  Normalization via
  // path.resolve below is the definitive check, but failing fast here gives a
  // clearer error message.
  const segments = effectivePath.split(/[/\\]/);
  if (segments.includes('..')) {
    return { ok: false, error: `Error: Path traversal ("..") is not allowed: ${effectivePath}` };
  }

  const fullPath = resolve(join(workingDirectory, effectivePath));

  if (
    !fullPath.startsWith(normalizedWorkingDir) &&
    fullPath !== normalizedWorkingDir.slice(0, -1)
  ) {
    return { ok: false, error: `Error: Path escapes working directory: ${effectivePath}` };
  }

  const relPath = fullPath.slice(normalizedWorkingDir.length);
  return { ok: true, fullPath, relPath };
}

// =========================================================================
// Content-addressable helpers: deterministic hash + unified diff (no deps)
// =========================================================================

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

// LCS-based unified diff generator. Context lines: 3.
// Returns a string starting with "--- a/<path>\n+++ b/<path>\n"
function generateUnifiedDiff(oldText, newText, filename) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length > 0 && a[a.length - 1] === '') {
    a.pop();
  }
  if (b.length > 0 && b[b.length - 1] === '') {
    b.pop();
  }
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) {
    return '(no changes)';
  }

  // Build LCS DP table. For large diffs, fall back to whole-file presentation.
  const SAFE_CELLS = 16_000_000;
  const ops = [];
  if (n * m <= SAFE_CELLS) {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (a[i] === b[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        ops.push({ type: 'equal', oldIdx: i, newIdx: j, text: a[i] });
        i++;
        j++;
      } else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) {
        ops.push({ type: 'del', oldIdx: i, newIdx: j, text: a[i] });
        i++;
      } else {
        ops.push({ type: 'add', oldIdx: i, newIdx: j, text: b[j] });
        j++;
      }
    }
  } else {
    // Large diff fallback: delete all then add all
    for (let i = 0; i < n; i++) {
      ops.push({ type: 'del', oldIdx: i, newIdx: 0, text: a[i] });
    }
    for (let j = 0; j < m; j++) {
      ops.push({ type: 'add', oldIdx: n, newIdx: j, text: b[j] });
    }
  }

  const CONTEXT = 3;
  const hunks = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'equal') {
      k++;
      continue;
    }
    let startIdx = Math.max(0, k - CONTEXT);
    let nonEqEnd = k;
    while (nonEqEnd < ops.length && ops[nonEqEnd].type !== 'equal') {
      nonEqEnd++;
    }
    let endIdx = Math.min(ops.length, nonEqEnd + CONTEXT);

    const firstOp = ops[startIdx];
    const lastOp = ops[endIdx - 1];
    const oldStart = firstOp.oldIdx;
    const newStart = firstOp.newIdx;
    let oldCount = 0,
      newCount = 0;
    for (let p = startIdx; p < endIdx; p++) {
      const o = ops[p];
      if (o.type === 'equal') {
        oldCount++;
        newCount++;
      } else if (o.type === 'del') {
        oldCount++;
      } else {
        newCount++;
      }
    }
    const body = [];
    for (let p = startIdx; p < endIdx; p++) {
      const o = ops[p];
      if (o.type === 'equal') {
        body.push(' ' + o.text);
      } else if (o.type === 'del') {
        body.push('-' + o.text);
      } else {
        body.push('+' + o.text);
      }
    }
    hunks.push(
      `@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@\n${body.join('\n')}`,
    );
    k = endIdx;
  }

  if (hunks.length === 0) {
    return '(no changes)';
  }
  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('\n')}\n`;
}

// Count occurrences of a substring in a string
function countOccurrences(text, sub) {
  if (!sub) {
    return 0;
  }
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(sub, idx)) !== -1) {
    count++;
    idx += sub.length;
  }
  return count;
}

function normalizeComparableLine(line) {
  return line.replace(/\r/g, '').trim();
}

function normalizeComparableBlock(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => normalizeComparableLine(line))
    .join('\n')
    .trim();
}

function stripReadFileLinePrefixes(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sourceLines = normalized.split('\n');
  const strippedLines = [];
  let previousLineNumber = null;
  let sawNumberedLine = false;

  for (const sourceLine of sourceLines) {
    const match = sourceLine.match(/^\s*(\d+): ?(.*)$/);
    if (!match) {
      return null;
    }
    const lineNumber = Number.parseInt(match[1], 10);
    if (previousLineNumber !== null && lineNumber !== previousLineNumber + 1) {
      return null;
    }
    previousLineNumber = lineNumber;
    sawNumberedLine = true;
    strippedLines.push(match[2]);
  }

  if (!sawNumberedLine) {
    return null;
  }
  const stripped = strippedLines.join('\n');
  return stripped.trim() ? stripped : null;
}

// 跟踪编辑循环检测：path -> { count, lastContentHash }
const noopEditTracker = new Map();
const NOOP_EDIT_LIMIT = 3;

export function createFileSystemTools() {
  return [
    {
      name: 'read_files',
      description: 'Read multiple files at once for efficiency. Returns contents of all files.',
      category: ToolCategory.FILESYSTEM,
      params: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read',
        },
      },
      required: ['paths'],
      handler: async ({ paths }, ctx) => {
        if (!paths || !Array.isArray(paths)) {
          return 'Error: paths must be an array of file paths.';
        }

        const results = [];
        const snapshotStore = ctx.snapshotStore;

        for (const path of paths) {
          const safe = safeResolvePath(ctx.workingDirectory, path);
          if (!safe.ok) {
            results.push(`=== ${path} ===\n${safe.error}\n`);
            continue;
          }

          if (!existsSync(safe.fullPath)) {
            results.push(`=== ${path} ===\nError: File not found\n`);
            continue;
          }

          try {
            let content;

            // 尝试从缓存获取（如果文件未变）
            if (snapshotStore && typeof snapshotStore.head === 'function') {
              const currentTag = snapshotStore.head(path);
              if (currentTag && typeof snapshotStore.byHash === 'function') {
                const cachedEntry = snapshotStore.byHash(path, currentTag);
                if (cachedEntry) {
                  content = cachedEntry.content || cachedEntry.data?.text;
                }
              }
            }

            // 缓存未命中，从磁盘读取
            if (!content) {
              content = await readFile(safe.fullPath, 'utf-8');
            }

            const numbered = content
              .split('\n')
              .map((line, i) => `${i + 1}: ${line}`)
              .join('\n');
            results.push(`=== ${path} ===\n${numbered}\n`);
            if (ctx.memoryManager && typeof ctx.memoryManager.updateFileMap === 'function') {
              ctx.memoryManager.updateFileMap(path, 'read').catch(() => {});
            }
          } catch (error) {
            results.push(
              `=== ${path} ===\nError: ${error instanceof Error ? error.message : error}\n`,
            );
          }
        }

        return results.join('\n' + '='.repeat(40) + '\n\n');
      },
    },

    {
      name: 'read_file',
      description:
        'Read the contents of a single file. For multiple files, use read_files for efficiency.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['path'],
      paramAliases: { file_path: 'path' },
      handler: async ({ path, offset, limit }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path);
        if (!safe.ok) {
          return safe.error;
        }
        const fullPath = safe.fullPath;
        if (!existsSync(fullPath)) {
          return `Error: File not found: ${path}`;
        }

        try {
          let rawContent = await readFile(fullPath, 'utf-8');
          const lines = rawContent.split('\n');

          // 记录 snapshot 到 Hashline SnapshotStore（在格式化之前用原始内容）
          if (ctx.snapshotStore && typeof ctx.snapshotStore.record === 'function') {
            try {
              ctx.snapshotStore.record(path, rawContent);
            } catch {}
          }

          let content;
          if (offset || limit) {
            const start = (offset || 1) - 1;
            const end = start + (limit || lines.length);
            const sliced = lines.slice(start, end);
            content = sliced.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
          } else {
            content = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
          }

          if (ctx.memoryManager && typeof ctx.memoryManager.updateFileMap === 'function') {
            ctx.memoryManager.updateFileMap(path, 'read').catch(() => {});
          }

          return content;
        } catch (error) {
          return `Error reading file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'write_file',
      description:
        'Write full content to a file. Use for new files by default. For existing files, prefer edit_file or apply_hashline_patch; full-file replacement requires overwrite=true with overwrite_reason.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        content: { type: 'string', description: 'Content to write to the file' },
        overwrite: {
          type: 'boolean',
          description:
            'Set true only when intentionally replacing an existing file after reading it.',
        },
        overwrite_reason: {
          type: 'string',
          description:
            'Required when overwrite=true for an existing file; explain why edit_file/apply_hashline_patch is not appropriate.',
        },
      },
      required: ['path', 'content'],
      paramAliases: { file_path: 'path', file_content: 'content' },
      handler: async ({ path, content }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path);
        if (!safe.ok) {
          return safe.error;
        }
        const fullPath = safe.fullPath;

        try {
          const { mkdir } = await import('fs/promises');
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          if (dir && !existsSync(dir)) {
            await mkdir(dir, { recursive: true });
          }

          const b64Result = tryDecodeBase64(content);
          if (b64Result.isBase64 && b64Result.decoded) {
            const decodedBuffer = b64Result.decoded;
            let contentInfo;
            try {
              const asText = decodedBuffer.toString('utf-8');
              if (Buffer.from(asText, 'utf-8').equals(decodedBuffer)) {
                await writeFile(fullPath, asText, 'utf-8');
                contentInfo = `${asText.split('\n').length} lines (decoded from base64)`;
              } else {
                await writeFile(fullPath, decodedBuffer);
                contentInfo = `${decodedBuffer.length} bytes (binary, decoded from base64)`;
              }
            } catch {
              await writeFile(fullPath, decodedBuffer);
              contentInfo = `${decodedBuffer.length} bytes (binary, decoded from base64)`;
            }
            if (ctx.memoryManager && typeof ctx.memoryManager.updateFileMap === 'function') {
              ctx.memoryManager.updateFileMap(path, 'created/modified').catch(() => {});
            }
            return `File written successfully: ${path} (${contentInfo})`;
          }

          // 对现有文件的覆盖写入走事务化管线
          if (existsSync(fullPath)) {
            // 1) EditOrchestrator 完整事务
            const orchestrator = ctx.editOrchestrator;
            if (orchestrator && typeof orchestrator.writeFile === 'function') {
              const result = await orchestrator.writeFile(fullPath, content);
              if (result.success) {
                const lineCount = content.split('\n').length;
                const parts = [
                  `File written successfully: ${path} (${lineCount} lines, via EditOrchestrator)`,
                ];
                if (result.diagnostics) {
                  parts.push(
                    result.diagnostics.ok
                      ? 'Diagnostics gate: PASSED'
                      : `Diagnostics gate: ${result.diagnostics.newErrors?.length || 0} new errors`,
                  );
                }
                if (result.repaired?.length > 0) {
                  parts.push(`Auto-repaired: ${result.repaired.length} error(s) via codeAction`);
                }
                if (result.memoryUpdated) {
                  parts.push('Memory: updated');
                }
                return parts.join('\n');
              }
              return `Error writing file ${path}: orchestrator write failed - ${result.error || 'unknown error'}`;
            }

            // 2) Hashline Patcher 回退
            const patcher = ctx.hashlinePatcher;
            if (patcher && typeof patcher.preflight === 'function') {
              try {
                const tag = computeTag(await readFile(fullPath, 'utf-8'));
                const newLines = content.split('\n');
                const totalLines = newLines.length;
                const body = newLines.map((l) => `+${l}`).join('\n');
                const patchText = `[${safe.relPath}#${tag}]\nSWAP 1.=${Math.max(1, totalLines)}:\n${body}`;
                const { patch: parsedPatch, preflight } = await patcher.preflight(patchText);
                if (!preflight.find((p) => !p.ok && !p.recoverable)) {
                  const applyResult = await patcher.apply(parsedPatch);
                  if (applyResult.ok) {
                    return `File written successfully: ${path} (${content.split('\n').length} lines, via Hashline patcher)`;
                  }
                }
              } catch {}
            }
          }

          await writeFile(fullPath, content, 'utf-8');
          if (ctx.memoryManager && typeof ctx.memoryManager.updateFileMap === 'function') {
            ctx.memoryManager.updateFileMap(path, 'created/modified').catch(() => {});
          }

          if (ctx.contentStore) {
            try {
              const blobHash = ctx.contentStore.storeBlob(content);
              ctx.contentStore.setRef(`file:${path}`, blobHash);
              if (ctx.fileAnalyzer && typeof ctx.fileAnalyzer.analyzeFile === 'function') {
                ctx.fileAnalyzer.analyzeFile(path, content);
              }
            } catch {}
          }

          if (ctx.snapshotStore && typeof ctx.snapshotStore.record === 'function') {
            try {
              ctx.snapshotStore.record(path, content);
            } catch {}
          }

          return `File written successfully: ${path} (${content.split('\n').length} lines)`;
        } catch (error) {
          return `Error writing file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'edit_file',
      description:
        'Edit a file by replacing text. Supports three strategies (tried in order):\n' +
        '1) Line-based: use line/startLine/endLine to specify exact line range\n' +
        '2) Exact match: use old_text to find unique match in file\n' +
        '3) Fuzzy fallback: trim old_text and find unique candidate',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        old_text: {
          type: 'string',
          description:
            'The text to find and replace. If line/startLine/endLine is provided, old_text is optional (used for validation).',
        },
        new_text: {
          type: 'string',
          description: 'The replacement text (empty string to delete)',
          allowEmpty: true,
        },
        line: { type: 'number', description: 'Single line number (1-based) to replace' },
        startLine: {
          type: 'number',
          description: 'Start line number (1-based, inclusive) for multi-line replace',
        },
        endLine: {
          type: 'number',
          description: 'End line number (1-based, inclusive) for multi-line replace',
        },
      },
      required: ['path', 'new_text'],
      paramAliases: {
        file_path: 'path',
        old_str: 'old_text',
        new_str: 'new_text',
        old_string: 'old_text',
        new_string: 'new_text',
        original_text: 'old_text',
        start_line: 'startLine',
        end_line: 'endLine',
        search: 'old_text',
        replace: 'new_text',
      },
      handler: async (
        { path, old_text, new_text, line, startLine, endLine, edits, changes, original_text },
        ctx,
      ) => {
        // Claude Code 兼容：edits/changes 数组作为单次替换处理
        const editArray = edits || changes;
        if (editArray && Array.isArray(editArray) && editArray.length > 0) {
          old_text =
            editArray[0].old_text || editArray[0].old_string || editArray[0].old_str || old_text;
          new_text =
            editArray[0].new_text || editArray[0].new_string || editArray[0].new_str || new_text;
        }
        // Claude Code 兼容：original_text 作为 old_text
        if (!old_text && original_text) old_text = original_text;
        const safe = safeResolvePath(ctx.workingDirectory, path);
        if (!safe.ok) {
          return safe.error;
        }
        const fullPath = safe.fullPath;
        if (!existsSync(fullPath)) {
          return `Error: File not found: ${path}`;
        }

        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          let matchOffset, matchLength, firstMatchLine, strategy;

          const findMatchByLineRange = (start, end) => {
            if (start < 1 || start > lines.length) {
              return null;
            }
            if (end < start || end > lines.length) {
              return null;
            }
            let offset = 0;
            for (let i = 0; i < start - 1; i++) {
              offset += lines[i].length + 1;
            }
            let length = 0;
            for (let i = start - 1; i < end; i++) {
              length += lines[i].length + 1;
            }
            length = Math.max(0, length - 1);
            return { offset, length, line: start };
          };

          const findExactMatch = (text) => {
            const occurrences = countOccurrences(content, text);
            if (occurrences === 0) {
              return null;
            }
            if (occurrences > 1) {
              return { multiple: true };
            }
            const offset = content.indexOf(text);
            return {
              offset,
              length: text.length,
              line: content.substring(0, offset).split('\n').length,
            };
          };

          const findFuzzyMatch = (text) => {
            if (!text || !text.trim()) {
              return null;
            }
            const trimmed = text.trim();
            const candidates = [];
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim() === trimmed) {
                candidates.push(i + 1);
              }
            }
            if (candidates.length === 1) {
              return findMatchByLineRange(candidates[0], candidates[0]);
            }
            return null;
          };

          const findNormalizedUniqueMatch = (text) => {
            if (!text || !text.trim()) {
              return null;
            }
            const targetLines = text.replace(/\r/g, '').split('\n');
            const targetLen = targetLines.length;
            if (targetLen === 0 || targetLen > lines.length) {
              return null;
            }
            const normalizedTarget = normalizeComparableBlock(text);
            const candidates = [];
            for (let i = 0; i <= lines.length - targetLen; i++) {
              const candidateText = lines.slice(i, i + targetLen).join('\n');
              if (normalizeComparableBlock(candidateText) === normalizedTarget) {
                candidates.push(i + 1);
                if (candidates.length > 1) {
                  return { multiple: true, firstLine: candidates[0] };
                }
              }
            }
            if (candidates.length === 1) {
              return findMatchByLineRange(candidates[0], candidates[0] + targetLen - 1);
            }
            return null;
          };

          if (line !== undefined && line !== null) {
            const result = findMatchByLineRange(line, line);
            if (result) {
              matchOffset = result.offset;
              matchLength = result.length;
              firstMatchLine = result.line;
              strategy = 'line';
            } else {
              return `Error: Line ${line} is out of range (file has ${lines.length} lines). Re-read the file to see current line numbers.`;
            }
          } else if (startLine !== undefined && startLine !== null) {
            const end = endLine !== undefined && endLine !== null ? endLine : startLine;
            const result = findMatchByLineRange(startLine, end);
            if (result) {
              matchOffset = result.offset;
              matchLength = result.length;
              firstMatchLine = result.line;
              strategy = 'line-range';
            } else {
              return `Error: Line range ${startLine}-${end} is out of range (file has ${lines.length} lines)`;
            }
          } else if (old_text) {
            const result = findExactMatch(old_text);
            if (result?.multiple) {
              const firstIdx = content.indexOf(old_text);
              const firstLine = content.substring(0, firstIdx).split('\n').length;
              return `Error: old_text matches multiple locations (first at line ${firstLine}). Use line/startLine/endLine for unambiguous edits.`;
            } else if (result) {
              matchOffset = result.offset;
              matchLength = result.length;
              firstMatchLine = result.line;
              strategy = 'exact';
            } else {
              const fuzzy = findFuzzyMatch(old_text);
              if (fuzzy) {
                matchOffset = fuzzy.offset;
                matchLength = fuzzy.length;
                firstMatchLine = fuzzy.line;
                strategy = 'fuzzy';
              } else {
                const normalized = findNormalizedUniqueMatch(old_text);
                if (normalized?.multiple) {
                  return `Error: old_text matches multiple normalized locations (first at line ${normalized.firstLine}). Use line/startLine/endLine for unambiguous edits.`;
                }
                if (normalized) {
                  matchOffset = normalized.offset;
                  matchLength = normalized.length;
                  firstMatchLine = normalized.line;
                  strategy = 'normalized';
                } else {
                  const strippedOldText = stripReadFileLinePrefixes(old_text);
                  const readOutputMatch = strippedOldText ? findExactMatch(strippedOldText) : null;
                  if (readOutputMatch?.multiple) {
                    const firstIdx = content.indexOf(strippedOldText);
                    const firstLine = content.substring(0, firstIdx).split('\n').length;
                    return `Error: old_text with read_file line prefixes matches multiple locations after stripping prefixes (first at line ${firstLine}). Use line/startLine/endLine for unambiguous edits.`;
                  }
                  if (readOutputMatch) {
                    matchOffset = readOutputMatch.offset;
                    matchLength = readOutputMatch.length;
                    firstMatchLine = readOutputMatch.line;
                    strategy = 'read-file-output';
                  } else {
                    const readOutputNormalized = strippedOldText
                      ? findNormalizedUniqueMatch(strippedOldText)
                      : null;
                    if (readOutputNormalized?.multiple) {
                      return `Error: old_text with read_file line prefixes matches multiple normalized locations after stripping prefixes (first at line ${readOutputNormalized.firstLine}). Use line/startLine/endLine for unambiguous edits.`;
                    }
                    if (readOutputNormalized) {
                      matchOffset = readOutputNormalized.offset;
                      matchLength = readOutputNormalized.length;
                      firstMatchLine = readOutputNormalized.line;
                      strategy = 'read-file-output-normalized';
                    } else {
                      return (
                        `Error: old_text not found in file. The file may have been modified since you last read it.\n` +
                        `1) Re-read the file with read_file to see current content\n` +
                        `2) Retry with raw file text from the latest read, without leading "N: " line-number prefixes\n` +
                        `3) Use line/startLine/endLine for line-based editing\n` +
                        `4) If you just called write_file on this file, the old content was replaced. Use read_file to get the new content before editing.`
                      );
                    }
                  }
                }
              }
            }
          } else {
            return `Error: Either old_text or line/startLine must be provided`;
          }

          // Noop 循环检测：编辑后内容不变则跟踪并截断
          const checkNoopLoop = (newContent) => {
            const contentHash = hashContent(newContent);
            const tracker = noopEditTracker.get(safe.relPath) || { count: 0, lastHash: null };
            if (tracker.lastHash === contentHash) {
              tracker.count++;
              noopEditTracker.set(safe.relPath, tracker);
              if (tracker.count >= NOOP_EDIT_LIMIT) {
                return (
                  `Error: ${NOOP_EDIT_LIMIT} consecutive no-op edits detected for "${path}". ` +
                  `The file content is not changing. Re-read the file to see current state and stop retrying the same change.`
                );
              }
            } else {
              noopEditTracker.set(safe.relPath, { count: 0, lastHash: contentHash });
            }
            return null;
          };

          const old_text_content = content.substring(matchOffset, matchOffset + matchLength);
          const oldLineCount = old_text_content.split('\n').length;
          const endLineForPatch = firstMatchLine + oldLineCount - 1;

          // 尝试走成熟编辑链路：orchestrator > patcher > 直接写盘
          const editViaHashlinePipeline = async () => {
            const tag = computeTag(content);
            const normalizedNew = new_text.replace(/\r\n/g, '\n');
            const newPatchLines = normalizedNew.split('\n');

            let patchText;
            if (newPatchLines.length === 1 && newPatchLines[0] === '' && oldLineCount > 0) {
              patchText = `[${safe.relPath}#${tag}]\nDEL ${firstMatchLine}.=${endLineForPatch}`;
            } else {
              const body = newPatchLines.map((l) => `+${l}`).join('\n');
              patchText = `[${safe.relPath}#${tag}]\nSWAP ${firstMatchLine}.=${endLineForPatch}:\n${body}`;
            }

            // 1) EditOrchestrator 完整事务管道（preflight → apply → LSP sync → diagnostics gate → memory update）
            const orchestrator = ctx.editOrchestrator;
            if (orchestrator && typeof orchestrator.editViaHashline === 'function') {
              const result = await orchestrator.editViaHashline(patchText);
              if (result.success) {
                if (ctx.snapshotStore && typeof ctx.snapshotStore.record === 'function') {
                  try {
                    const diskContent = await readFile(fullPath, 'utf-8');
                    ctx.snapshotStore.record(path, diskContent);
                  } catch {}
                }
                const parts = [
                  `File edited successfully: ${path}`,
                  `Strategy: ${strategy} (via EditOrchestrator)`,
                  `Changed ${oldLineCount} line(s) starting at line ${firstMatchLine}.`,
                  `Files changed: ${result.filesChanged.join(', ')}`,
                ];
                if (result.diagnostics) {
                  parts.push(
                    result.diagnostics.ok
                      ? 'Diagnostics gate: PASSED'
                      : `Diagnostics gate: ${result.diagnostics.newErrors?.length || 0} new errors`,
                  );
                }
                if (result.repaired?.length > 0) {
                  parts.push(`Auto-repaired: ${result.repaired.length} error(s) via codeAction`);
                }
                if (result.memoryUpdated) {
                  parts.push('Memory: updated');
                }
                return parts.join('\n');
              }
              return `Edit failed via orchestrator: ${result.error || 'unknown error'}`;
            }

            // 2) Hashline Patcher 回退（无 diagnostics gate，但有 preflight tag 校验和 recovery）
            const patcher = ctx.hashlinePatcher;
            if (patcher && typeof patcher.preflight === 'function') {
              try {
                const { patch: parsedPatch, preflight } = await patcher.preflight(patchText);
                const fatalSection = preflight.find((p) => !p.ok && !p.recoverable);
                if (!fatalSection) {
                  const applyResult = await patcher.apply(parsedPatch);
                  if (applyResult.ok) {
                    if (ctx.snapshotStore && typeof ctx.snapshotStore.record === 'function') {
                      try {
                        const diskContent = await readFile(fullPath, 'utf-8');
                        ctx.snapshotStore.record(path, diskContent);
                      } catch {}
                    }
                    return (
                      `File edited successfully: ${path}\n` +
                      `Strategy: ${strategy} (via Hashline patcher)\n` +
                      `Changed ${oldLineCount} line(s) starting at line ${firstMatchLine}.`
                    );
                  }
                  return `Edit failed via patcher: ${applyResult.error}`;
                }
                return `Edit failed: ${fatalSection.path}: ${fatalSection.error}. Re-read the file and try again.`;
              } catch (err) {
                return `Edit failed via patcher: ${err.message}`;
              }
            }

            return null;
          };

          const pipelineResult = await editViaHashlinePipeline();
          if (pipelineResult !== null) {
            return pipelineResult;
          }

          // 3) 直接写盘回退（无 orchestrator/patcher 时的兜底路径）
          const beforeHash = hashContent(content);
          const newContent =
            content.substring(0, matchOffset) +
            new_text +
            content.substring(matchOffset + matchLength);
          const afterHash = hashContent(newContent);
          const diff = generateUnifiedDiff(content, newContent, path);

          // Noop 检测
          if (afterHash === beforeHash) {
            const loopErr = checkNoopLoop(newContent);
            if (loopErr) return loopErr;
          }

          await writeFile(fullPath, newContent, 'utf-8');

          if (ctx.snapshotStore && typeof ctx.snapshotStore.record === 'function') {
            try {
              ctx.snapshotStore.record(path, newContent);
            } catch {}
          }

          return (
            `File edited successfully: ${path}\n` +
            `Strategy: ${strategy} (direct)\n` +
            `Changed ${oldLineCount} line(s) starting at line ${firstMatchLine}.\n` +
            `Before hash: ${beforeHash.substring(0, 16)}\n` +
            `After hash:  ${afterHash.substring(0, 16)}\n` +
            `---- diff ----\n${diff}`
          );
        } catch (error) {
          return `Error editing file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    // =====================================================================
    // Hashline Patch: 使用 Oh My Pi Hashline DSL 进行多文件原子编辑
    // =====================================================================
    {
      name: 'apply_hashline_patch',
      description: HASHLINE_TOOL_DESCRIPTION,
      category: ToolCategory.FILESYSTEM,
      params: {
        patch: {
          type: 'string',
          description: 'The complete Hashline patch text in the DSL format described above.',
        },
      },
      required: ['patch'],
      handler: async ({ patch }, ctx) => {
        if (!patch || typeof patch !== 'string' || patch.trim().length === 0) {
          return 'Error: patch must be a non-empty string in Hashline DSL format.';
        }

        // 优先走 EditOrchestrator 完整事务管道
        // （preflight → apply → LSP sync → diagnostics gate → memory update）
        const orchestrator = ctx.editOrchestrator;
        if (orchestrator && typeof orchestrator.editViaHashline === 'function') {
          try {
            const result = await orchestrator.editViaHashline(patch);

            if (!result.success) {
              const diagInfo =
                result.diagnostics && !result.diagnostics.ok
                  ? `\nDiagnostics gate: ${result.diagnostics.newErrors?.length || 0} new errors` +
                    (result.rolledBack ? ' (rolled back)' : '')
                  : '';
              return (
                `Hashline patch FAILED: ${result.error || 'unknown error'}` +
                `\nFiles changed: ${result.filesChanged.join(', ') || '(none)'}` +
                `\nFiles failed: ${result.filesFailed.join(', ') || '(none)'}` +
                diagInfo
              );
            }

            const parts = [
              'Hashline patch applied successfully through EditOrchestrator.',
              `Files changed: ${result.filesChanged.join(', ') || '(none)'}`,
              `Total edits: ${result.totalEdits}`,
            ];

            if (result.diagnostics?.ok !== undefined) {
              parts.push(
                result.diagnostics.ok
                  ? 'Diagnostics gate: PASSED (no new errors introduced)'
                  : `Diagnostics gate: ${result.diagnostics.newErrors?.length || 0} new errors`,
              );
            }

            if (result.repaired?.length > 0) {
              parts.push(`Auto-repaired: ${result.repaired.length} error(s) via codeAction`);
            }

            if (result.rolledBack) {
              parts.push('WARNING: Edits were rolled back due to diagnostics gate failure.');
            }

            if (result.memoryUpdated) {
              parts.push('Memory: updated with edit record.');
            }

            return parts.join('\n');
          } catch (error) {
            return `Error applying Hashline patch through EditOrchestrator: ${error instanceof Error ? error.message : error}`;
          }
        }

        // Fallback: 直接走 patcher（无 diagnostics gate / memory update）
        const patcher = ctx.hashlinePatcher;
        if (!patcher) {
          return 'Error: Neither EditOrchestrator nor Hashline Patcher is available. Use edit_file or write_file instead.';
        }

        try {
          const { patch: parsedPatch, preflight } = await patcher.preflight(patch);

          const preflightSummary = preflight
            .map((p) => {
              if (p.ok) {
                return `  ✓ ${p.path}: tag matches (${p.tag?.substring(0, 12)}...)`;
              }
              if (p.recoverable) {
                return `  ⚠ ${p.path}: stale tag, will attempt recovery`;
              }
              return `  ✗ ${p.path}: ${p.error}`;
            })
            .join('\n');

          const fatalSection = preflight.find((p) => !p.ok && !p.recoverable);
          if (fatalSection) {
            return `Hashline patch preflight FAILED:\n${preflightSummary}\n\nPatch NOT applied. Fix the following and retry:\n  - ${fatalSection.path}: ${fatalSection.error}`;
          }

          const result = await patcher.apply(parsedPatch);

          if (!result.ok) {
            return `Hashline patch apply FAILED: ${result.error}`;
          }

          const applySummary = result.sections
            .map((s) => {
              const status = s.recovered ? 'RECOVERED' : 'applied';
              const warnStr =
                s.warnings?.length > 0 ? `\n    warnings: ${s.warnings.join('; ')}` : '';
              return `  ✓ ${s.path}: ${status} (${s.hunksApplied} hunks)${warnStr}\n    tag: ${s.tag?.substring(0, 12)}... → ${s.newTag?.substring(0, 12)}...`;
            })
            .join('\n');

          for (const s of result.sections) {
            if (ctx.memoryManager && typeof ctx.memoryManager.updateFileMap === 'function') {
              ctx.memoryManager.updateFileMap(s.path, 'edited').catch(() => {});
            }
          }

          return (
            `Hashline patch applied (patcher fallback, no diagnostics gate):\n${applySummary}\n\n` +
            `Preflight:\n${preflightSummary}\n\n` +
            `Note: applied without LSP diagnostics gate or memory update.` +
            (ctx.editOrchestrator
              ? ''
              : ' Upgrade available — install EditOrchestrator for full transaction pipeline.')
          );
        } catch (error) {
          return `Error applying Hashline patch: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'search',
      description:
        'Search for a pattern in files within the working directory. Returns matching lines with file paths and line numbers.',
      category: ToolCategory.FILESYSTEM,
      params: {
        pattern: {
          type: 'string',
          description: 'Search pattern (plain text; regex metachars are matched literally)',
        },
        file_pattern: {
          type: 'string',
          description: 'File glob pattern to filter files (e.g., "*.ts")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default 20, max 100)',
        },
      },
      required: ['pattern'],
      handler: async ({ pattern, file_pattern, max_results }, ctx) => {
        if (typeof pattern !== 'string' || pattern.length === 0) {
          return 'Error: search pattern must be a non-empty string.';
        }
        if (pattern.length > 512) {
          return 'Error: search pattern too long (max 512 chars).';
        }
        if (
          file_pattern !== undefined &&
          (typeof file_pattern !== 'string' || file_pattern.length > 128)
        ) {
          return 'Error: file_pattern must be a string under 128 chars.';
        }

        try {
          const HARD_MAX_RESULTS = 100;
          const SEARCH_TIMEOUT_MS = 30000;
          const max = Math.max(1, Math.min(max_results || 20, HARD_MAX_RESULTS));

          // Build the grep argument list as an array -- execFile never spawns a
          // shell, so there is no risk of command injection regardless of what
          // the user-supplied pattern contains.
          const grepArgs = [
            '-rn',
            '-F', // treat pattern as plain text, not regex
            '--color=never',
            '-m',
            String(max),
          ];

          if (file_pattern) {
            // Validate the file_filter contains only safe glob chars.  We still
            // pass it as a single argv element so grep's own glob handling
            // applies without any shell parsing.
            if (!/^[A-Za-z0-9*?.\-_/\[\]]+$/.test(file_pattern)) {
              return `Error: file_pattern contains disallowed characters: ${file_pattern}`;
            }
            grepArgs.push(`--include=${file_pattern}`);
          }

          const excludeDirs = [
            '.git',
            'node_modules',
            '.agent-data',
            '.automation',
            '.test-temp',
            'dist',
            'build',
            'coverage',
            '.next',
            '.cache',
          ];
          for (const dir of excludeDirs) {
            grepArgs.push(`--exclude-dir=${dir}`);
          }

          grepArgs.push('--');
          grepArgs.push(pattern);
          grepArgs.push(ctx.workingDirectory);

          const result = await new Promise((resolve, reject) => {
            execFile(
              'grep',
              grepArgs,
              {
                encoding: 'utf-8',
                maxBuffer: 5 * 1024 * 1024,
                timeout: SEARCH_TIMEOUT_MS,
              },
              (err, stdout) => {
                // grep exits with code 1 when there are no matches -- that is not
                // an error for us.
                if (err && err.code !== 1) {
                  reject(err);
                } else {
                  resolve(stdout);
                }
              },
            );
          });

          if (!result.trim()) {
            return `No matches found for pattern: ${pattern}`;
          }

          const lines = result.trim().split('\n');
          const limitedLines = lines.slice(0, HARD_MAX_RESULTS);

          return limitedLines.join('\n');
        } catch (error) {
          if (error.killed && error.signal === 'SIGTERM') {
            return `Search timed out after 30 seconds. Try a more specific pattern or smaller scope.`;
          }
          return `Error searching: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'glob',
      description: 'Find files matching a glob pattern in the working directory.',
      category: ToolCategory.FILESYSTEM,
      params: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' },
      },
      required: ['pattern'],
      handler: async ({ pattern }, ctx) => {
        if (!pattern || typeof pattern !== 'string') {
          return 'Error: Missing required glob pattern.';
        }

        try {
          const { glob } = await import('glob');
          const files = await glob(pattern, {
            cwd: ctx.workingDirectory,
            absolute: false,
            ignore: ['**/node_modules/**', '**/.git/**'],
          });
          if (files.length === 0) {
            return `No files matched pattern: ${pattern}`;
          }
          return files.join('\n');
        } catch (error) {
          return `Error globbing: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'tree',
      description:
        'Recursively list directory structure as a tree for efficient workspace inspection.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: {
          type: 'string',
          description: 'Directory path relative to working directory (default: root)',
        },
        max_depth: {
          type: 'number',
          description: 'Maximum depth to traverse (default: 3, max: 8)',
        },
      },
      required: [],
      handler: async ({ path, max_depth }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path || '.');
        if (!safe.ok) {
          return safe.error;
        }
        const rootPath = safe.fullPath;
        const maxDepth = Math.min(max_depth || 3, 8);

        const excludeDirs = new Set([
          '.git',
          'node_modules',
          '.agent-data',
          '.automation',
          '.test-temp',
          'dist',
          'build',
          'coverage',
          '.next',
          '.cache',
          '__pycache__',
        ]);

        try {
          if (!existsSync(rootPath)) {
            return `Error: Directory not found: ${path || '.'}`;
          }

          const results = [];

          async function traverse(currentPath, depth, prefix) {
            if (depth > maxDepth) {
              return;
            }

            const entries = await readdir(currentPath);
            const sortedEntries = entries
              .filter((e) => !excludeDirs.has(e))
              .sort((a, b) => {
                const aIsDir = stat(join(currentPath, a)).then((s) => s.isDirectory());
                return 0;
              });

            for (let i = 0; i < sortedEntries.length; i++) {
              const entry = sortedEntries[i];
              const fullPath = join(currentPath, entry);
              const s = await stat(fullPath);
              const isLast = i === sortedEntries.length - 1;
              const connector = isLast ? '└── ' : '├── ';
              const relPath = fullPath.replace(rootPath + '/', '').replace(rootPath, '');

              results.push(`${prefix}${connector}${entry}${s.isDirectory() ? '/' : ''}`);

              if (s.isDirectory()) {
                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                await traverse(fullPath, depth + 1, newPrefix);
              }
            }
          }

          results.push(
            `${rootPath.replace(ctx.workingDirectory + '/', '').replace(ctx.workingDirectory, '.')}/`,
          );
          await traverse(rootPath, 1, '');

          return results.join('\n');
        } catch (error) {
          return `Error building tree: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'list_dir',
      description: 'List files and directories at a given path. For full tree, use tree tool.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: {
          type: 'string',
          description: 'Directory path relative to working directory (default: root)',
        },
      },
      required: [],
      handler: async ({ path }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path || '.');
        if (!safe.ok) {
          return safe.error;
        }
        const dirPath = safe.fullPath;

        try {
          if (!existsSync(dirPath)) {
            return `Error: Directory not found: ${path || '.'}`;
          }
          const entries = await readdir(dirPath);
          /** @type {string[]} */
          const results = [];

          for (const entry of entries) {
            const fullPath = join(dirPath, entry);
            const s = await stat(fullPath);
            const prefix = s.isDirectory() ? 'D ' : 'F ';
            results.push(`${prefix}${entry}`);
          }

          return results.length > 0 ? results.join('\n') : '(empty directory)';
        } catch (error) {
          return `Error listing directory: ${error instanceof Error ? error.message : error}`;
        }
      },
    },
  ];
}
