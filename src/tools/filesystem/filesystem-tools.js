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
import { ToolCategory } from '../../core/types.js';

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
  if (trimmed.length > 40
      && trimmed.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      // 反向验证：解码后重新编码应接近原字符串
      const reencoded = buf.toString('base64');
      if (reencoded === trimmed
          || reencoded === trimmed.replace(/=+$/, '') + '=='.slice((3 - (trimmed.length % 4)) % 3)) {
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
  if (isAbsolute(trimmed)) {
    return { ok: false, error: `Error: Absolute paths are not allowed: ${trimmed}` };
  }

  // Reject any path that contains an explicit ".." segment.  Normalization via
  // path.resolve below is the definitive check, but failing fast here gives a
  // clearer error message.
  const segments = trimmed.split(/[/\\]/);
  if (segments.includes('..')) {
    return { ok: false, error: `Error: Path traversal ("..") is not allowed: ${trimmed}` };
  }

  const normalizedWorkingDir = resolve(workingDirectory).replace(/[\\/]+$/, '') + sep;
  const fullPath = resolve(join(workingDirectory, trimmed));

  if (!fullPath.startsWith(normalizedWorkingDir) && fullPath !== normalizedWorkingDir.slice(0, -1)) {
    return { ok: false, error: `Error: Path escapes working directory: ${trimmed}` };
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
  if (a.length > 0 && a[a.length - 1] === '') a.pop();
  if (b.length > 0 && b[b.length - 1] === '') b.pop();
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return '(no changes)';

  // Build LCS DP table. For large diffs, fall back to whole-file presentation.
  const SAFE_CELLS = 16_000_000;
  const ops = [];
  if (n * m <= SAFE_CELLS) {
    const dp = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        ops.push({ type: 'equal', oldIdx: i, newIdx: j, text: a[i] });
        i++; j++;
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
    for (let i = 0; i < n; i++) ops.push({ type: 'del', oldIdx: i, newIdx: 0, text: a[i] });
    for (let j = 0; j < m; j++) ops.push({ type: 'add', oldIdx: n, newIdx: j, text: b[j] });
  }

  const CONTEXT = 3;
  const hunks = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'equal') { k++; continue; }
    let startIdx = Math.max(0, k - CONTEXT);
    let nonEqEnd = k;
    while (nonEqEnd < ops.length && ops[nonEqEnd].type !== 'equal') nonEqEnd++;
    let endIdx = Math.min(ops.length, nonEqEnd + CONTEXT);

    const firstOp = ops[startIdx];
    const lastOp = ops[endIdx - 1];
    const oldStart = firstOp.oldIdx;
    const newStart = firstOp.newIdx;
    let oldCount = 0, newCount = 0;
    for (let p = startIdx; p < endIdx; p++) {
      const o = ops[p];
      if (o.type === 'equal') { oldCount++; newCount++; }
      else if (o.type === 'del') { oldCount++; }
      else { newCount++; }
    }
    const body = [];
    for (let p = startIdx; p < endIdx; p++) {
      const o = ops[p];
      if (o.type === 'equal') body.push(' ' + o.text);
      else if (o.type === 'del') body.push('-' + o.text);
      else body.push('+' + o.text);
    }
    hunks.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@\n${body.join('\n')}`);
    k = endIdx;
  }

  if (hunks.length === 0) return '(no changes)';
  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('\n')}\n`;
}

// Count occurrences of a substring in a string
function countOccurrences(text, sub) {
  if (!sub) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(sub, idx)) !== -1) {
    count++;
    idx += sub.length;
  }
  return count;
}

export function createFileSystemTools() {
  return [
    {
      name: 'read_files',
      description: 'Read multiple files at once for efficiency. Returns contents of all files.',
      category: ToolCategory.FILESYSTEM,
      params: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to read' },
      },
      required: ['paths'],
      handler: async ({ paths }, ctx) => {
        if (!paths || !Array.isArray(paths)) {
          return 'Error: paths must be an array of file paths.';
        }

        const results = [];
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
            const content = await readFile(safe.fullPath, 'utf-8');
            const numbered = content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
            results.push(`=== ${path} ===\n${numbered}\n`);
            await ctx.memoryManager.updateFileMap(path, 'read');
          } catch (error) {
            results.push(`=== ${path} ===\nError: ${error instanceof Error ? error.message : error}\n`);
          }
        }
        
        return results.join('\n' + '='.repeat(40) + '\n\n');
      },
    },

    {
      name: 'read_file',
      description: 'Read the contents of a single file. For multiple files, use read_files for efficiency.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['path'],
      handler: async ({ path, offset, limit }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path);
        if (!safe.ok) {return safe.error;}
        const fullPath = safe.fullPath;
        if (!existsSync(fullPath)) {return `Error: File not found: ${path}`;}

        try {
          let content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          if (offset || limit) {
            const start = ((offset) || 1) - 1;
            const end = start + ((limit) || lines.length);
            const sliced = lines.slice(start, end);
            content = sliced.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
          } else {
            content = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
          }

          // Update file map
          await ctx.memoryManager.updateFileMap(path, 'read');

          return content;
        } catch (error) {
          return `Error reading file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
      handler: async ({ path, content }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path);
        if (!safe.ok) {return safe.error;}
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
            // 判断是纯文本还是二进制 — 如果是有效的 UTF-8 文本，用 'utf-8'
            let contentInfo;
            try {
              const asText = decodedBuffer.toString('utf-8');
              // 如果重新编码一致，作为文本处理
              if (Buffer.from(asText, 'utf-8').equals(decodedBuffer)) {
                await writeFile(fullPath, asText, 'utf-8');
                contentInfo = `${asText.split('\n').length} lines (decoded from base64)`;
              } else {
                // 二进制内容，直接写 buffer
                await writeFile(fullPath, decodedBuffer);
                contentInfo = `${decodedBuffer.length} bytes (binary, decoded from base64)`;
              }
            } catch {
              await writeFile(fullPath, decodedBuffer);
              contentInfo = `${decodedBuffer.length} bytes (binary, decoded from base64)`;
            }
            await ctx.memoryManager.updateFileMap(path, 'created/modified');
            return `File written successfully: ${path} (${contentInfo})`;
          }

          await writeFile(fullPath, content, 'utf-8');
          await ctx.memoryManager.updateFileMap(path, 'created/modified');

          // --- Record in harness ContentAddressableStore (if available) ---
          if (ctx.contentStore) {
            try {
              const blobHash = ctx.contentStore.storeBlob(content);
              ctx.contentStore.setRef(`file:${path}`, blobHash);
              // Auto-analyze: create line-level anchors via the injected fileAnalyzer.
              if (ctx.fileAnalyzer && typeof ctx.fileAnalyzer.analyzeFile === 'function') {
                ctx.fileAnalyzer.analyzeFile(path, content);
              }
            } catch {
              // Non-fatal: contentStore is optional extension surface.
            }
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
        'Edit a file by replacing a specific text segment. The old_text must be unique in the file (exactly one match). Uses a content-addressable anchor hash to verify the unchanged region around the edit, and returns a deterministic diff.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'File path relative to working directory' },
        old_text: { type: 'string', description: 'The exact text to find and replace (must match exactly one location in the file)' },
        new_text: { type: 'string', description: 'The replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
      handler: async ({ path, old_text, new_text }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path);
        if (!safe.ok) {return safe.error;}
        const fullPath = safe.fullPath;
        if (!existsSync(fullPath)) {return `Error: File not found: ${path}`;}

        try {
          const content = await readFile(fullPath, 'utf-8');

          // --- Uniqueness gate (anchor hash requires a single match) ---
          const occurrences = countOccurrences(content, old_text);
          if (occurrences === 0) {
            return `Error: The specified old_text was not found in the file. Make sure it matches exactly (including whitespace/indentation).`;
          }
          if (occurrences > 1) {
            const firstMatchLine = content.substring(0, content.indexOf(old_text)).split('\n').length;
            return `Error: old_text matches ${occurrences} locations in the file (first match around line ${firstMatchLine}). ` +
                   `Make old_text more specific by including surrounding context lines so it matches exactly one location.`;
          }

          // --- Anchor hash: hash of the 200-char context window around the match.
          //    This lets us detect whether the file was concurrently modified. ---
          const matchOffset = content.indexOf(old_text);
          const ctxStart = Math.max(0, matchOffset - 200);
          const ctxEnd = Math.min(content.length, matchOffset + old_text.length + 200);
          const anchorContext = content.substring(ctxStart, ctxEnd);
          const anchorHash = hashContent(anchorContext);
          const beforeHash = hashContent(content);

          // Cross-check anchor hash against the harness ContentAddressableStore
          // (ctx.contentStore is set by the agent if the store is available).
          if (ctx.contentStore) {
            const storedAnchor = ctx.contentStore.getAnchor(anchorHash);
            if (storedAnchor) {
              const knownSnippet = storedAnchor.text.slice(0, Math.min(storedAnchor.text.length, 50));
              if (!anchorContext.includes(knownSnippet)) {
                return `Error: Anchor hash ${anchorHash.substring(0, 12)}... no longer matches file content. ` +
                       `The file was modified underneath this edit. Re-read the file and try again.`;
              }
            }
          }

          const firstMatchLine = content.substring(0, matchOffset).split('\n').length;
          const newContent = content.replace(old_text, new_text);
          const afterHash = hashContent(newContent);
          const diff = generateUnifiedDiff(content, newContent, path);

          await writeFile(fullPath, newContent, 'utf-8');
          await ctx.memoryManager.updateFileMap(path, 'edited');

          // --- Record edit in the harness ContentAddressableStore (if available) ---
          if (ctx.contentStore) {
            try {
              ctx.contentStore.storeAnchor(path, matchOffset, matchOffset + old_text.length, old_text);
              const newBlobHash = ctx.contentStore.storeBlob(newContent);
              ctx.contentStore.setRef(`file:${path}`, newBlobHash);
              // Re-analyze the modified file so new anchors reflect the new content.
              if (ctx.fileAnalyzer && typeof ctx.fileAnalyzer.analyzeFile === 'function') {
                ctx.fileAnalyzer.analyzeFile(path, newContent);
              }
            } catch {
              // Non-fatal: contentStore is optional extension surface.
            }
          }

          const oldLineCount = old_text.split('\n').length;
          return (
            `File edited successfully: ${path}\n` +
            `Changed ${oldLineCount} line(s) starting at line ${firstMatchLine}.\n` +
            `Anchor hash: ${anchorHash.substring(0, 16)}...\n` +
            `Before hash: ${beforeHash.substring(0, 16)}\n` +
            `After hash:  ${afterHash.substring(0, 16)}\n` +
            `---- diff ----\n${diff}`
          );
        } catch (error) {
          return `Error editing file: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'search',
      description: 'Search for a pattern in files within the working directory. Returns matching lines with file paths and line numbers.',
      category: ToolCategory.FILESYSTEM,
      params: {
        pattern: { type: 'string', description: 'Search pattern (plain text; regex metachars are matched literally)' },
        file_pattern: { type: 'string', description: 'File glob pattern to filter files (e.g., "*.ts")' },
        max_results: { type: 'number', description: 'Maximum number of results to return (default 20, max 100)' },
      },
      required: ['pattern'],
      handler: async ({ pattern, file_pattern, max_results }, ctx) => {
        if (typeof pattern !== 'string' || pattern.length === 0) {
          return 'Error: search pattern must be a non-empty string.';
        }
        if (pattern.length > 512) {
          return 'Error: search pattern too long (max 512 chars).';
        }
        if (file_pattern !== undefined && (typeof file_pattern !== 'string' || file_pattern.length > 128)) {
          return 'Error: file_pattern must be a string under 128 chars.';
        }

        try {
          const HARD_MAX_RESULTS = 100;
          const SEARCH_TIMEOUT_MS = 30000;
          const max = Math.max(1, Math.min((max_results || 20), HARD_MAX_RESULTS));

          // Build the grep argument list as an array -- execFile never spawns a
          // shell, so there is no risk of command injection regardless of what
          // the user-supplied pattern contains.
          const grepArgs = [
            '-rn',
            '-F',              // treat pattern as plain text, not regex
            '--color=never',
            '-m', String(max),
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
            '.git', 'node_modules', '.agent-data', '.automation',
            '.test-temp', 'dist', 'build', 'coverage', '.next', '.cache'
          ];
          for (const dir of excludeDirs) {
            grepArgs.push(`--exclude-dir=${dir}`);
          }

          grepArgs.push('--');
          grepArgs.push(pattern);
          grepArgs.push(ctx.workingDirectory);

          const result = await new Promise((resolve, reject) => {
            execFile('grep', grepArgs, {
              encoding: 'utf-8',
              maxBuffer: 5 * 1024 * 1024,
              timeout: SEARCH_TIMEOUT_MS,
            }, (err, stdout) => {
              // grep exits with code 1 when there are no matches -- that is not
              // an error for us.
              if (err && err.code !== 1) {
                reject(err);
              } else {
                resolve(stdout);
              }
            });
          });

          if (!result.trim()) {return `No matches found for pattern: ${pattern}`;}

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
          if (files.length === 0) {return `No files matched pattern: ${pattern}`;}
          return files.join('\n');
        } catch (error) {
          return `Error globbing: ${error instanceof Error ? error.message : error}`;
        }
      },
    },

    {
      name: 'tree',
      description: 'Recursively list directory structure as a tree for efficient workspace inspection.',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: 'Directory path relative to working directory (default: root)' },
        max_depth: { type: 'number', description: 'Maximum depth to traverse (default: 3, max: 8)' },
      },
      required: [],
      handler: async ({ path, max_depth }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path || '.');
        if (!safe.ok) {return safe.error;}
        const rootPath = safe.fullPath;
        const maxDepth = Math.min(max_depth || 3, 8);

        const excludeDirs = new Set([
          '.git', 'node_modules', '.agent-data', '.automation',
          '.test-temp', 'dist', 'build', 'coverage', '.next', '.cache', '__pycache__'
        ]);

        try {
          if (!existsSync(rootPath)) {return `Error: Directory not found: ${path || '.'}`;}

          const results = [];
          
          async function traverse(currentPath, depth, prefix) {
            if (depth > maxDepth) {return;}

            const entries = await readdir(currentPath);
            const sortedEntries = entries
              .filter(e => !excludeDirs.has(e))
              .sort((a, b) => {
                const aIsDir = stat(join(currentPath, a)).then(s => s.isDirectory());
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

          results.push(`${rootPath.replace(ctx.workingDirectory + '/', '').replace(ctx.workingDirectory, '.')}/`);
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
        path: { type: 'string', description: 'Directory path relative to working directory (default: root)' },
      },
      required: [],
      handler: async ({ path }, ctx) => {
        const safe = safeResolvePath(ctx.workingDirectory, path || '.');
        if (!safe.ok) {return safe.error;}
        const dirPath = safe.fullPath;

        try {
          if (!existsSync(dirPath)) {return `Error: Directory not found: ${path || '.'}`;}
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
