/**
 * File Reference Parser & Normalizer
 *
 * 把 Agent 对话/工具输出中的文本路径引用解析为标准化的
 * FileReference 对象，供渲染层生成可点击卡片、供工具执行层做
 * 跳转或预览。
 *
 * 支持的引用格式：
 *   - `path/to/file.js`              → 纯文件
 *   - `path/to/file.js:42`            → 单行号
 *   - `path/to/file.js:10-25`         → 行区间
 *   - `path/to/file.js:10:5`          → 行:列
 *   - `path/to/file.js#L10-L20`       → GitHub 风格锚
 *   - 引号包裹 `"...path"` / `'...path'`
 *   - @ 提及 `@path/to/file.js`
 *
 * 过滤原则：
 *   - 相对路径需存在于工作目录内
 *   - 绝对路径只允许是工作目录前缀下的真实文件（可选）
 *   - 不跨出工作目录（拒绝 `../../../etc/passwd`）
 */

import path from 'node:path';
import fs from 'node:fs';

/**
 * @typedef {Object} FileReference
 * @property {string} raw        - 原始匹配文本（用于还原替换）
 * @property {string} path       - 规范化后的相对路径（相对 workingDirectory）
 * @property {string} absolute   - 绝对路径
 * @property {number|null} line  - 起始行号（1-based）
 * @property {number|null} endLine - 结束行号（1-based）
 * @property {number|null} column - 列号（1-based，可选）
 * @property {number} startIndex - 在输入文本中的起始字符偏移
 * @property {number} endIndex   - 在输入文本中的结束字符偏移
 * @property {'file'|'line'|'range'} kind - 引用类型
 */

// --- 基础正则（匹配 path[:anchor]，不含空白与控制字符） ---
// 允许: 非空白 ASCII + 中文路径 + ./ ../ 前缀; 不包含引号
const PATH_BODY = String.raw`[^\s"'<>()\[\]{}\x00-\x1F]+?`;
const ANCHOR = String.raw`(?::\d+(?::\d+)?(?::\d+)?|:[L\d][-\dL]*)`;
const LEADING_QUOTES = /["'`]/;

// 主要匹配：`@path` / 引号内路径 / 裸路径
const LOOSE_RE = new RegExp(
  String.raw`(?:` +
    String.raw`(?<at>@)(?<atPath>${PATH_BODY})` +
    String.raw`|` +
    String.raw`"(?<qPath>${PATH_BODY})"` +
    String.raw`|` +
    String.raw`'(?<sqPath>${PATH_BODY})'` +
    String.raw`|` +
    String.raw`(?<bare>(?:\.{1,2}/|/)?(?:[\w.\-@]+/)*[\w.\-@]+(?:\.\w+)?(?:${ANCHOR})?)` +
    String.raw`)`,
  'g',
);

// 判断一个候选是否"像文件路径"的启发式规则：
// - 含 `/` 或 含 `.` 且尾部是常见扩展名
// - 不含 http(s)://、mailto:、data:、urn: 等 URI scheme
const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;
const COMMON_CODE_EXT = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  'd.ts',
  'py',
  'pyi',
  'rb',
  'rs',
  'go',
  'java',
  'kt',
  'kts',
  'scala',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cxx',
  'cs',
  'swift',
  'dart',
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'md',
  'markdown',
  'txt',
  'rst',
  'org',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'styl',
  'vue',
  'svelte',
  'sh',
  'bash',
  'zsh',
  'fish',
  'bat',
  'cmd',
  'ps1',
  'sql',
  'db',
  'sqlite',
  'csv',
  'tsv',
  'pdf',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'env',
  'conf',
  'log',
]);

export function _looksLikeFile(candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return false;
  }
  if (URI_SCHEME_RE.test(candidate) && !candidate.startsWith('file:')) {
    return false;
  }
  if (candidate.includes('\0')) {
    return false;
  }

  if (candidate.includes('/') || candidate.includes('\\')) {
    return true;
  }
  const ext = candidate.split('.').pop().toLowerCase();
  if (COMMON_CODE_EXT.has(ext)) {
    return true;
  }
  return false;
}

// 解析锚点片段 ":42" / ":10-25" / ":10:5" / "#L10-L20" / "#L10"
function _parseAnchor(anchor) {
  if (!anchor) {
    return { line: null, endLine: null, column: null };
  }
  const trimmed = anchor.replace(/^[#:]/, '');
  // L10 / L10-L20
  let m = trimmed.match(/^L(\d+)(?:-L?(\d+))?$/i);
  if (m) {
    return {
      line: Number(m[1]),
      endLine: m[2] ? Number(m[2]) : null,
      column: null,
    };
  }
  // 42 / 10-25 / 10:5 / 10:25:5
  m = trimmed.match(/^(\d+)(?:([-:])(\d+)(?::(\d+))?)?$/);
  if (m) {
    const line = Number(m[1]);
    if (m[2] === '-') {
      return { line, endLine: Number(m[3]), column: null };
    }
    if (m[2] === ':') {
      return { line, column: Number(m[3]), endLine: m[4] ? Number(m[4]) : null };
    }
    return { line, endLine: null, column: null };
  }
  return { line: null, endLine: null, column: null };
}

// 把候选中的锚点部分剥离，返回 [cleanPath, anchor]
function _splitPathAndAnchor(candidate) {
  // 优先匹配 #L.. 或 :<digits> 出现在最后一段（非路径部分）
  const idxHash = candidate.lastIndexOf('#L');
  if (idxHash !== -1) {
    return [candidate.slice(0, idxHash), candidate.slice(idxHash + 1)];
  }
  // 冒号锚：必须在最后一个 / 之后，且后面是数字
  const lastSlash = Math.max(candidate.lastIndexOf('/'), candidate.lastIndexOf('\\'));
  const afterSlash = lastSlash === -1 ? candidate : candidate.slice(lastSlash + 1);
  const colonInName = afterSlash.match(/:(\d[\d\-:L]*)$/i);
  if (colonInName) {
    const cut = candidate.length - colonInName[0].length;
    return [candidate.slice(0, cut), colonInName[0]];
  }
  return [candidate, null];
}

// 安全规范化路径：不允许跳出 workdir
function _safeResolve(candidatePath, workingDirectory) {
  const root = path.resolve(workingDirectory);
  const joined = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(root, candidatePath);
  if (!joined.startsWith(root + path.sep) && joined !== root) {
    return null; // 跳出工作目录，拒绝
  }
  return { absolute: joined, relative: path.relative(root, joined) };
}

/**
 * 从一段自由文本中抽取文件引用。
 * @param {string} text
 * @param {string} workingDirectory - 绝对路径，作为解析相对路径的根
 * @param {object} [options]
 * @param {boolean} [options.requireExists=false] - 是否要求文件在磁盘真实存在
 * @returns {FileReference[]} 按 startIndex 升序排列的引用列表
 */
export function parseFileReferences(text, workingDirectory, options = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  if (!workingDirectory) {
    return [];
  }

  const requireExists = options.requireExists === true;
  const results = [];

  const scan = (candidate, matchStart, matchEnd) => {
    if (!_looksLikeFile(candidate)) {
      return;
    }
    const [cleanPath, anchor] = _splitPathAndAnchor(candidate);
    if (!cleanPath) {
      return;
    }
    const resolved = _safeResolve(cleanPath, workingDirectory);
    if (!resolved) {
      return;
    }
    if (requireExists) {
      try {
        if (!fs.existsSync(resolved.absolute)) {
          return;
        }
      } catch {
        return;
      }
    }
    const { line, endLine, column } = _parseAnchor(anchor);
    const kind = endLine ? 'range' : line ? 'line' : 'file';
    results.push({
      raw: candidate,
      path: resolved.relative || path.basename(resolved.absolute),
      absolute: resolved.absolute,
      line,
      endLine,
      column,
      startIndex: matchStart,
      endIndex: matchEnd,
      kind,
    });
  };

  // 手动扫描 @path / "path" / 'path' 和裸路径
  let i = 0;
  while (i < text.length) {
    // @路径
    if (text[i] === '@') {
      const rest = text.slice(i + 1);
      const m = rest.match(/^([^\s"'<>()\[\]{}\x00-\x1F]{1,200})/);
      if (m && _looksLikeFile(m[1])) {
        const start = i;
        const end = i + 1 + m[1].length;
        scan(m[1], start, end);
        i = end;
        continue;
      }
    }
    // 引号内
    if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      const quote = text[i];
      const closeIdx = text.indexOf(quote, i + 1);
      if (closeIdx !== -1) {
        const inside = text.slice(i + 1, closeIdx);
        if (inside.length < 400 && _looksLikeFile(inside)) {
          scan(inside, i, closeIdx + 1);
          i = closeIdx + 1;
          continue;
        }
      }
    }
    // 裸路径：以 .、..、/ 或含常见扩展名的词
    const rest = text.slice(i);
    // 精确匹配：./xxx / ../xxx / /xxx / xxx.yy[:anchor]
    const bareMatch = rest.match(
      /^((?:\.{1,2}\/|\/|[\w.\-]+\/)[\w.\-/@+]+(?:\.\w+)?(?:[:#][L\d][-\dL:]*)?)/,
    );
    if (bareMatch && _looksLikeFile(bareMatch[1])) {
      scan(bareMatch[1], i, i + bareMatch[1].length);
      i += bareMatch[1].length;
      continue;
    }
    i++;
  }

  // 去重：同 absolute + 同锚点只保留第一个
  const seen = new Set();
  const dedup = [];
  for (const ref of results) {
    const key = `${ref.absolute}|${ref.line}|${ref.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedup.push(ref);
  }
  return dedup.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * 把文本中的 FileReference 以自定义渲染器替换，返回新文本 + 引用列表。
 * @param {string} text
 * @param {string} workingDirectory
 * @param {(ref: FileReference) => string} renderer
 */
export function replaceFileReferences(text, workingDirectory, renderer) {
  const refs = parseFileReferences(text, workingDirectory);
  if (refs.length === 0) {
    return { text, refs };
  }
  let out = '';
  let cursor = 0;
  for (const ref of refs) {
    out += text.slice(cursor, ref.startIndex);
    out += renderer(ref);
    cursor = ref.endIndex;
  }
  out += text.slice(cursor);
  return { text: out, refs };
}

/**
 * 将引用格式化为稳定的展示字符串（用于发送到渲染层显示）
 */
export function formatReferenceLabel(ref) {
  const loc = ref.line ? (ref.endLine ? `:${ref.line}-${ref.endLine}` : `:${ref.line}`) : '';
  return `${ref.path}${loc}`;
}

export default { parseFileReferences, replaceFileReferences, formatReferenceLabel };
