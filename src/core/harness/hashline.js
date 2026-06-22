/**
 * Hashline - 紧凑的行锚定补丁语言与应用器
 *
 * 对标 `@oh-my-pi/hashline`：为 LLM 文件编辑设计的、行锚定、内容哈希绑定的
 * 补丁语言 + parser + patcher + snapshot store + 文件系统抽象 + 批量 preflight
 * + stale tag recovery / 3-way merge。
 *
 * 补丁 DSL 示例：
 *
 * ```text
 * [src/foo.js#a1b2c3...]
 * SWAP 1.=2:
 * +const a = 1;
 * +const b = 2;
 * DEL 5.=6
 * INS.PRE 7=
 * +// inserted before line 7
 * INS.POST 8=
 * +// inserted after line 8
 * ```
 *
 * 语法：
 *  - `[path#tag]` 节区头。tag 是规范化文件文本的 content hash（snapshot tag）。
 *  - 操作行（一条占一行）：
 *    - `SWAP start.=end:`  用紧随其后的 `+` 行替换 [start, end] 区间（行号 1-based，闭区间）。
 *    - `DEL start.=end`    删除 [start, end] 区间。
 *    - `INS.PRE line=`     在第 line 行之前插入紧随其后的 `+` 行。
 *    - `INS.POST line=`    在第 line 行之后插入紧随其后的 `+` 行。
 *  - 内容行：以 `+` 开头。`+ foo` 与 `+foo` 等价（去掉一个可选空格）。
 *  - 空行与 `#` 开头的注释行在操作之间被忽略。
 *
 * 与现有 `ContentAddressableStore`（类 Git 的 CAS）桥接：通过
 * `HashlineBridge` 把 patcher 的 snapshot / blob 记录写入既有 store，复用
 * 已注入 AgentEngine 的对象存储。
 */

import { createHash } from 'crypto';
import { readFile, writeFile, stat, access } from 'fs/promises';
import { resolve } from 'path';
import { constants as fsConstants, existsSync, lstatSync, readlinkSync } from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// 哈希工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 计算内容的 SHA-256 hex。
 * @param {string} content
 * @returns {string}
 */
export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 规范化文件文本：统一换行符为 `\n`、去尾空白行、保证结尾恰好一个 `\n`。
 *
 * 这是 snapshot tag 计算所用的规范化形式。规范化保证同一份内容在不同
 * 平台 / 编辑器写出时得到相同的 tag。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (text === null || text === undefined) { return ''; }
  // 统一换行
  let t = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 去掉行尾空白
  t = t
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n');
  // 去掉结尾多余空行
  t = t.replace(/\n+$/g, '');
  // 保证以单个换行结尾（非空文件）
  if (t.length > 0) { t += '\n'; }
  return t;
}

/**
 * 计算规范化文本的 tag（snapshot 内容哈希）。
 * @param {string} text
 * @returns {string}
 */
export function computeTag(text) {
  return hashContent(normalizeText(text));
}

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem 抽象：disk / memory / custom backend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filesystem 接口。任何实现以下方法的对象都可以作为 backend：
 *   - async read(path) -> string
 *   - async write(path, content)
 *   - async exists(path) -> boolean
 *   - async stat(path) -> { size, mtimeMs }（可选）
 *
 * 默认提供 DiskFilesystem 与 MemoryFilesystem。
 */
export class Filesystem {
  async read(/* path */) {
    throw new Error('Filesystem.read not implemented');
  }
  async write(/* path, content */) {
    throw new Error('Filesystem.write not implemented');
  }
  async exists(/* path */) {
    throw new Error('Filesystem.exists not implemented');
  }
  async stat(/* path */) {
    throw new Error('Filesystem.stat not implemented');
  }
}

/**
 * 基于真实磁盘的 filesystem 实现。
 */
export class DiskFilesystem extends Filesystem {
  constructor(rootDir = '.') {
    super();
    this.rootDir = rootDir;
  }

  async read(path) {
    return readFile(this._resolve(path), 'utf-8');
  }

  async write(path, content) {
    await writeFile(this._resolve(path), content, 'utf-8');
  }

  async exists(path) {
    try {
      await access(this._resolve(path), fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path) {
    const s = await stat(this._resolve(path));
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  _resolve(path) {
    // 沙箱化路径解析：相对路径相对于 rootDir，拒绝路径遍历逃逸。
    const root = resolve(this.rootDir || '.');
    const resolved = resolve(root, path || '.');

    // 拒绝 .. 遍历逃逸：若 path 包含 .. 路径段且解析结果跑出 root，拒绝
    if (/(?:^|\/)\.\.(?:$|\/)/.test(path) && !resolved.startsWith(root + '/') && resolved !== root) {
      throw new Error(`path escapes root directory: "${path}" -> "${resolved}"`);
    }

    // 拒绝绝对路径逃逸：任何非 root 内的绝对路径
    if (resolved !== root && !resolved.startsWith(root + '/') && !resolved.startsWith(root + '\\')) {
      throw new Error(`path escapes root directory: "${path}" -> "${resolved}"`);
    }

    // ── symlink 逃逸防护（realpath 解析） ──
    // 必须解析真实路径，防止通过 symlink 指向 root 外的文件。
    try {
      const rootReal = this._getRealpath(root);
      // 逐级解析目标路径的真实路径（目标路径的父目录必须存在才能解析）
      if (existsSync(resolved)) {
        const targetReal = this._getRealpath(resolved);
        if (!targetReal.startsWith(rootReal + '/') && targetReal !== rootReal) {
          throw new Error(
            `symlink escape detected: "${path}" resolves to "${targetReal}" which is outside root "${rootReal}" (${root})`
          );
        }
        return resolved;
      }
      // 目标文件尚不存在：逐级检查父目录是否通过 symlink 逃逸
      const _resolveParent = (p) => {
        if (p === rootReal || p === '/' || p === '.') return;
        const parent = resolve(p, '..');
        if (existsSync(parent)) {
          const parentReal = this._getRealpath(parent);
          if (!parentReal.startsWith(rootReal + '/') && parentReal !== rootReal) {
            throw new Error(
              `symlink escape detected in parent of "${path}": "${parent}" resolves outside root "${rootReal}"`
            );
          }
          _resolveParent(parent);
        }
      };
      _resolveParent(resolved);
    } catch (err) {
      if (err.message.includes('symlink escape')) throw err;
      // realpath 失败可能是文件尚不存在，fallback 到字符串路径检测
    }
    // ── /symlink 逃逸防护 ──

    return resolved;
  }

  /**
   * 获取路径的真实路径（解析 symlink），带缓存。
   * @private
   */
  _getRealpath(p) {
    if (!this._realpathCache) { this._realpathCache = new Map(); }
    if (this._realpathCache.has(p)) return this._realpathCache.get(p);
    // 同步检查：如果路径本身是 symlink，读它指向的目标
    try {
      if (existsSync(p)) {
        while (lstatSync(p).isSymbolicLink()) {
          const linkTarget = readlinkSync(p);
          p = resolve(resolve(p, '..'), linkTarget);
        }
      }
      this._realpathCache.set(p, p);
      return p;
    } catch {
      return p;
    }
  }
}

/**
 * 基于内存 Map 的 filesystem 实现。常用于测试 / 单进程 agent runtime。
 */
export class MemoryFilesystem extends Filesystem {
  constructor(initial = {}) {
    super();
    /** @type {Map<string, string>} */
    this._files = new Map();
    for (const [k, v] of Object.entries(initial)) {
      this._files.set(k, String(v));
    }
  }

  async read(path) {
    if (!this._files.has(path)) {
      const err = new Error(`ENOENT: no such file: ${path}`);
      err.code = 'ENOENT';
      throw err;
    }
    return this._files.get(path);
  }

  async write(path, content) {
    this._files.set(path, String(content));
  }

  async exists(path) {
    return this._files.has(path);
  }

  async stat(path) {
    if (!this._files.has(path)) {
      const err = new Error(`ENOENT: no such file: ${path}`);
      err.code = 'ENOENT';
      throw err;
    }
    return { size: Buffer.byteLength(this._files.get(path)), mtimeMs: Date.now() };
  }

  snapshot() {
    return Object.fromEntries(this._files);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SnapshotStore：per-path 短版本历史 + LRU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Snapshot 条目。
 * @typedef {Object} SnapshotEntry
 * @property {string} tag      规范化文本的内容哈希。
 * @property {string} text     原始（非规范化）文本，便于恢复。
 * @property {number} ts       记录时间戳。
 */

const DEFAULT_SNAPSHOT_LIMITS = {
  maxPaths: 30,
  maxVersionsPerPath: 4,
  maxTotalBytes: 64 * 1024 * 1024, // 64 MiB
};

/**
 * 内存 LRU snapshot store。per-path 维护一个版本历史环形缓冲。
 *
 * 相同内容复用同一个 tag；新内容进入 history；超出上限时淘汰最旧。
 */
export class InMemorySnapshotStore {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxPaths]
   * @param {number} [opts.maxVersionsPerPath]
   * @param {number} [opts.maxTotalBytes]
   */
  constructor(opts = {}) {
    this.limits = { ...DEFAULT_SNAPSHOT_LIMITS, ...opts };
    /** @type {Map<string, SnapshotEntry[]>} path -> versions（最新在尾） */
    this._versions = new Map();
    /** @type {Map<string, Map<string, number>>} path -> (tag -> index into versions) */
    this._index = new Map();
    /** @type {Map<string, Set<string>>} path -> seen line fingerprints（用于 recovery） */
    this._seenLines = new Map();
    this._totalBytes = 0;
  }

  /**
   * 记录一个 snapshot。相同内容复用既有 tag。
   * @param {string} path
   * @param {string} fullText
   * @returns {string} tag
   */
  record(path, fullText) {
    const text = String(fullText ?? '');
    const tag = computeTag(text);
    let versions = this._versions.get(path);
    if (!versions) {
      versions = [];
      this._versions.set(path, versions);
      this._index.set(path, new Map());
    }
    const idx = this._index.get(path);
    if (idx.has(tag)) {
      // 已存在：把它提到最新（移动到尾）。保留首次记录的原始文本字节形式
      // （规范化等价，去重不 churn；recovery 时用首次形式作为 base）。
      const i = idx.get(tag);
      if (i !== versions.length - 1) {
        const [entry] = versions.splice(i, 1);
        versions.push(entry);
        this._reindex(path);
      }
      return tag;
    }
    const entry = { tag, text, ts: Date.now() };
    versions.push(entry);
    idx.set(tag, versions.length - 1);
    this._totalBytes += text.length;
    // 顺便记录 seen lines（用于 recovery 锚点）
    this.recordSeenLines(path, text);
    this._evict(path);
    return tag;
  }

  /**
   * 记录"见过的行"，供 stale tag recovery 用。
   * @param {string} path
   * @param {string} text
   */
  recordSeenLines(path, text) {
    let set = this._seenLines.get(path);
    if (!set) {
      set = new Set();
      this._seenLines.set(path, set);
    }
    const lines = String(text).split('\n');
    // 限制 seen 行数量以控制内存
    const cap = 4096;
    if (set.size > cap) { return; }
    for (const l of lines) {
      if (l.trim().length === 0) { continue; }
      set.add(hashContent(l));
      if (set.size >= cap) { break; }
    }
  }

  /**
   * 取 path 的最新 snapshot。
   * @param {string} path
   * @returns {SnapshotEntry|null}
   */
  head(path) {
    const v = this._versions.get(path);
    if (!v || v.length === 0) { return null; }
    return v[v.length - 1];
  }

  /**
   * 按 tag 取 path 的 snapshot。
   * @param {string} path
   * @param {string} tag
   * @returns {SnapshotEntry|null}
   */
  byHash(path, tag) {
    const v = this._versions.get(path);
    if (!v) { return null; }
    const idx = this._index.get(path);
    if (!idx || !idx.has(tag)) { return null; }
    return v[idx.get(tag)];
  }

  /**
   * 是否记录过该 tag。
   */
  has(path, tag) {
    return !!this.byHash(path, tag);
  }

  /**
   * 获取 path 的全部版本（只读）。
   */
  history(path) {
    const v = this._versions.get(path);
    return v ? v.slice() : [];
  }

  /**
   * 已记录的 seen 行指纹集合（只读）。
   */
  seenLines(path) {
    const s = this._seenLines.get(path);
    return s ? new Set(s) : new Set();
  }

  /**
   * 使 path 失效（清空其历史）。
   */
  invalidate(path) {
    const v = this._versions.get(path);
    if (v) {
      for (const e of v) { this._totalBytes -= e.text.length; }
    }
    this._versions.delete(path);
    this._index.delete(path);
    this._seenLines.delete(path);
  }

  /**
   * 清空全部。
   */
  clear() {
    this._versions.clear();
    this._index.clear();
    this._seenLines.clear();
    this._totalBytes = 0;
  }

  /**
   * 统计信息。
   */
  stats() {
    let versions = 0;
    for (const v of this._versions.values()) { versions += v.length; }
    return {
      paths: this._versions.size,
      versions,
      totalBytes: this._totalBytes,
      maxPaths: this.limits.maxPaths,
      maxVersionsPerPath: this.limits.maxVersionsPerPath,
    };
  }

  _reindex(path) {
    const v = this._versions.get(path);
    const idx = this._index.get(path);
    idx.clear();
    for (let i = 0; i < v.length; i++) { idx.set(v[i].tag, i); }
  }

  _evict(path) {
    // per-path 版本上限
    const v = this._versions.get(path);
    while (v.length > this.limits.maxVersionsPerPath) {
      const removed = v.shift();
      this._totalBytes -= removed.text.length;
      this._reindex(path);
    }
    // 全局 path 数上限（LRU：删最久未访问的 path）
    while (this._versions.size > this.limits.maxPaths) {
      const oldest = this._versions.keys().next().value;
      this.invalidate(oldest);
    }
    // 全局字节上限
    while (this._totalBytes > this.limits.maxTotalBytes && this._versions.size > 0) {
      // 优先淘汰最老 path 的最老版本
      const oldestPath = this._versions.keys().next().value;
      const v2 = this._versions.get(oldestPath);
      if (v2.length > 1) {
        const removed = v2.shift();
        this._totalBytes -= removed.text.length;
        this._reindex(oldestPath);
      } else {
        this.invalidate(oldestPath);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch DSL + Parser
// ─────────────────────────────────────────────────────────────────────────────

const OP_SWAP = 'SWAP';
const OP_DEL = 'DEL';
const OP_INS_PRE = 'INS.PRE';
const OP_INS_POST = 'INS.POST';

const OP_NOP = 'NOP';
export { OP_SWAP, OP_DEL, OP_INS_PRE, OP_INS_POST, OP_NOP };

/**
 * 单条操作。
 * @typedef {Object} Hunk
 * @property {string} op        操作类型：SWAP | DEL | INS.PRE | INS.POST
 * @property {number} start     1-based 起始行（SWAP/DEL 用；INS.* 用作锚点行）
 * @property {number} end       1-based 结束行（闭区间；INS.* 等于 start）
 * @property {string[]} lines   要插入的新行内容（不含换行符）
 * @property {number} srcLine   该操作在 patch 文本中的源行号（用于错误定位）
 */

/**
 * 一个节区：针对单个文件的一组操作 + 锚定 tag。
 */
export class Section {
  constructor(path, tag, hunks) {
    this.path = path;
    this.tag = tag; // 规范化内容哈希
    this.hunks = hunks;
  }
}

/**
 * 完整补丁：若干 Section。
 */
export class Patch {
  constructor(sections) {
    this.sections = sections;
  }

  /**
   * 解析 patch 文本。
   * @param {string} text
   * @returns {Patch}
   * @throws {Error} 解析失败
   */
  static parse(text) {
    return parsePatch(text);
  }

  /**
   * 序列化回 patch 文本。
   */
  serialize() {
    return serializePatch(this);
  }
}

/**
 * 解析 patch 文本。
 *
 * @param {string} text
 * @returns {Patch}
 */
export function parsePatch(text) {
  const rawLines = String(text).split('\n');
  const sections = [];
  let cur = null; // { path, tag, hunks: [] }
  let pendingOp = null; // { op, start, end, lines: [], srcLine }

  const flushOp = () => {
    if (pendingOp) {
      if (!cur) { throw new PatchParseError('content line before any [path#tag] section'); }
      cur.hunks.push(pendingOp);
      pendingOp = null;
    }
  };
  const flushSection = () => {
    flushOp();
    if (cur) {
      sections.push(new Section(cur.path, cur.tag, cur.hunks));
      cur = null;
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lineNo = i + 1;

    // 注释 / 空行（在操作之间被忽略）
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { continue; }

    // 节区头
    const sectionMatch = line.match(/^\[([^\]#]+)#([^\]]+)\]\s*$/);
    if (sectionMatch) {
      flushSection();
      cur = { path: sectionMatch[1].trim(), tag: sectionMatch[2].trim(), hunks: [] };
      continue;
    }

    if (!cur) {
      throw new PatchParseError(`unexpected token at line ${lineNo}: '${line}' (no [path#tag] section open)`);
    }

    // 操作头：SWAP / DEL / INS.PRE / INS.POST
    // SWAP start.=end:   /  SWAP start=end:  /  SWAP start: (single line)
    const swapMatch = line.match(/^SWAP\s+(\d+)\s*\.?=\s*(\d+)\s*:\s*$/);
    const swapSingleMatch = line.match(/^SWAP\s+(\d+)\s*:\s*$/);
    const delMatch = line.match(/^DEL\s+(\d+)\s*\.?=\s*(\d+)\s*$/);
    const delSingleMatch = line.match(/^DEL\s+(\d+)\s*$/);
    const insPreMatch = line.match(/^INS\.PRE\s+(\d+)\s*=\s*$/);
    const insPostMatch = line.match(/^INS\.POST\s+(\d+)\s*=\s*$/);

    if (swapMatch || swapSingleMatch) {
      flushOp();
      const start = parseInt(swapMatch ? swapMatch[1] : swapSingleMatch[1], 10);
      const end = swapMatch ? parseInt(swapMatch[2], 10) : start;
      pendingOp = { op: OP_SWAP, start, end, lines: [], srcLine: lineNo };
      continue;
    }
    if (delMatch || delSingleMatch) {
      flushOp();
      const start = parseInt(delMatch ? delMatch[1] : delSingleMatch[1], 10);
      const end = delMatch ? parseInt(delMatch[2], 10) : start;
      pendingOp = { op: OP_DEL, start, end, lines: [], srcLine: lineNo };
      // DEL 没有后续 + 行，立即 flush
      flushOp();
      continue;
    }
    if (insPreMatch) {
      flushOp();
      const start = parseInt(insPreMatch[1], 10);
      pendingOp = { op: OP_INS_PRE, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }
    if (insPostMatch) {
      flushOp();
      const start = parseInt(insPostMatch[1], 10);
      pendingOp = { op: OP_INS_POST, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }

    // 内容行：以 + 开头。`+` 是纯标记符，其后内容原样保留（不剥离任何空格），
    // 这样能正确保留缩进。如需插入 "new line"，写 `+new line`；如需插入
    // "  return 2;"（带缩进），写 `+  return 2;`。
    if (line.startsWith('+')) {
      if (!pendingOp) {
        throw new PatchParseError(`content line at ${lineNo} has no preceding operation header`);
      }
      pendingOp.lines.push(line.slice(1));
      continue;
    }

    throw new PatchParseError(`unrecognized patch line ${lineNo}: '${line}'`);
  }

  flushSection();
  return new Patch(sections);
}

/**
 * 序列化 Patch 回文本。
 * @param {Patch} patch
 * @returns {string}
 */
export function serializePatch(patch) {
  const out = [];
  for (const s of patch.sections) {
    out.push(`[${s.path}#${s.tag}]`);
    for (const h of s.hunks) {
      if (h.op === OP_SWAP) {
        out.push(`SWAP ${h.start}.=${h.end}:`);
        for (const l of h.lines) { out.push(`+${l}`); }
      } else if (h.op === OP_DEL) {
        out.push(`DEL ${h.start}.=${h.end}`);
      } else if (h.op === OP_INS_PRE) {
        out.push(`INS.PRE ${h.start}=`);
        for (const l of h.lines) { out.push(`+${l}`); }
      } else if (h.op === OP_INS_POST) {
        out.push(`INS.POST ${h.start}=`);
        for (const l of h.lines) { out.push(`+${l}`); }
      }
    }
    out.push('');
  }
  return out.join('\n');
}

/**
 * Patch 解析错误。
 */
export class PatchParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatchParseError';
  }
}

/**
 * 应用错误（preflight / apply 阶段）。
 */
export class PatchApplyError extends Error {
  constructor(message, { path, section, hunk, recoverable = false, conflict = null } = {}) {
    super(message);
    this.name = 'PatchApplyError';
    this.path = path;
    this.section = section;
    this.hunk = hunk;
    this.recoverable = recoverable;
    this.conflict = conflict;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Patcher：preflight + apply + recovery / 3-way merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ApplyResult
 * @property {boolean} ok
 * @property {ApplySectionResult[]} sections  每个 section 的结果
 * @property {string} [error]                 聚合错误（ok=false 时）
 */

/**
 * @typedef {Object} ApplySectionResult
 * @property {string} path
 * @property {string} tag                     原 tag
 * @property {boolean} applied                是否成功落盘
 * @property {boolean} recovered              是否经过 recovery 后再应用
 * @property {string} newTag                  应用后规范化内容 tag
 * @property {string} beforeHash              应用前原始内容 hash（非规范化）
 * @property {string} afterHash               应用后原始内容 hash（非规范化）
 * @property {number} hunksApplied            应用的 hunk 数
 * @property {string[]} [warnings]
 * @property {{type: string, hunk: object, message: string, baseContent?: string, curContent?: string, patchContent?: string}[]} [conflicts]
 * @property {string} [error]
 */

/**
 * Patcher。组装 filesystem + snapshot store，对 Patch 做批量 preflight
 * 与原子应用；遇到 stale tag 时尝试 recovery / 3-way merge。
 *
 * 用法：
 * ```js
 * const patcher = new Patcher({ fs: new MemoryFilesystem(), snapshots: new InMemorySnapshotStore() });
 * const result = await patcher.apply(patchTextOrObject);
 * ```
 */
export class Patcher {
  /**
   * @param {object} opts
   * @param {Filesystem} [opts.fs]
   * @param {InMemorySnapshotStore} [opts.snapshots]
   * @param {boolean} [opts.autoRecord=true]      apply 成功后自动 record 新 snapshot
   * @param {boolean} [opts.allowRecovery=true]   允许 stale tag recovery
   * @param {object} [opts.bridge]                HashlineBridge，可选
   */
  constructor(opts = {}) {
    this.fs = opts.fs || new MemoryFilesystem();
    this.snapshots = opts.snapshots || new InMemorySnapshotStore();
    this.autoRecord = opts.autoRecord !== false;
    this.allowRecovery = opts.allowRecovery !== false;
    this.bridge = opts.bridge || null;
  }

  /**
   * 对单个 patch 做 preflight：解析、读文件、校验 tag、检查行范围。
   *
   * 返回每个 section 的预检结果。preflight 不修改任何文件。
   *
   * @param {string|Patch} patch
   * @returns {Promise<{patch: Patch, preflight: PreflightSectionResult[]}>}
   */
  async preflight(patch) {
    const parsed = typeof patch === 'string' ? Patch.parse(patch) : patch;
    const out = [];
    for (const section of parsed.sections) {
      out.push(await this._preflightSection(section));
    }
    return { patch: parsed, preflight: out };
  }

  /**
   * 应用 patch。先 preflight 全部 section，全部通过后再批量应用并落盘。
   *
   * 任一 section preflight 失败（且不可 recover）则整批不落盘，返回 ok=false。
   *
   * @param {string|Patch} patch
   * @returns {Promise<ApplyResult>}
   */
  async apply(patch) {
    const parsed = typeof patch === 'string' ? Patch.parse(patch) : patch;

    // 0) 文件策略检查（二进制/大文件/generated 文件保护）
    for (const section of parsed.sections) {
      const policyError = await this._checkFilePolicy(section.path);
      if (policyError) {
        return {
          ok: false,
          sections: [],
          error: policyError,
          policyBlocked: true,
        };
      }
    }

    // 1) 批量 preflight
    const preflightResults = [];
    for (const section of parsed.sections) {
      preflightResults.push(await this._preflightSection(section));
    }

    // 2) 决策：哪些 section 需要尝试 recovery
    const plans = [];
    for (let i = 0; i < parsed.sections.length; i++) {
      const section = parsed.sections[i];
      const pre = preflightResults[i];
      if (pre.ok) {
        plans.push({ section, pre, needRecovery: false });
        continue;
      }
      if (pre.recoverable && this.allowRecovery) {
        plans.push({ section, pre, needRecovery: true });
        continue;
      }
      // 不可恢复：整批失败
      return {
        ok: false,
        sections: [],
        error: `section [${section.path}#${section.tag.substring(0, 12)}...] preflight failed: ${pre.error}`,
      };
    }

    // 3) 计算每个 section 的新内容（in-memory，不落盘）
    const computed = [];
    for (const p of plans) {
      try {
        const r = p.needRecovery
          ? await this._applySectionWithRecovery(p.section, p.pre)
          : await this._applySectionClean(p.section, p.pre);
        computed.push(r);
      } catch (err) {
        return {
          ok: false,
          sections: [],
          error: `section [${p.section.path}] apply compute failed: ${err.message}`,
        };
      }
    }

    // 4) 事务性落盘：先备份，全部写入成功后再更新 metadata；失败则回滚
    const backups = new Map();
    const writtenPaths = [];
    const sectionResults = [];

    try {
      // 4a) 备份所有待修改文件（in-memory backup，不写临时文件）
      for (const c of computed) {
        backups.set(c.path, c.originalText);
      }

      // 4b) 写入新内容
      for (const c of computed) {
        try {
          await this.fs.write(c.path, c.newText);
          writtenPaths.push(c.path);
          const newTag = computeTag(c.newText);
          sectionResults.push({
            path: c.path,
            tag: c.section.tag,
            applied: true,
            recovered: c.recovered,
            newTag,
            beforeHash: hashContent(c.originalText),
            afterHash: hashContent(c.newText),
            hunksApplied: c.hunksApplied,
            warnings: c.warnings || [],
            conflicts: c.conflicts || [],
          });
        } catch (err) {
          throw new PatchApplyError(`failed to write ${c.path}: ${err.message}`, { path: c.path, section: c.section, recoverable: false });
        }
      }

      // 4c) 全部写入成功：更新 snapshots 和 bridge
      for (const c of computed) {
        const result = sectionResults.find(r => r.path === c.path);
        if (this.autoRecord) {
          this.snapshots.record(c.path, c.newText);
        }
        if (this.bridge && result) {
          this.bridge.recordApply(c.path, c.originalText, c.newText, c.section.tag, result.newTag);
        }
      }

    } catch (err) {
      // 4d) 回滚：恢复所有已写入的文件
      for (const path of writtenPaths) {
        try {
          const backup = backups.get(path);
          if (backup !== undefined) {
            await this.fs.write(path, backup);
          }
        } catch (rollbackErr) {
          // 回滚失败是严重问题，但不掩盖原始错误
          console.error(`[Hashline] rollback failed for ${path}: ${rollbackErr.message}`);
        }
      }
      return {
        ok: false,
        sections: [],
        error: err instanceof PatchApplyError ? err.message : String(err),
        rolledBack: writtenPaths.length > 0,
        rollbackPaths: writtenPaths,
      };
    }

    return { ok: true, sections: sectionResults };
  }

  // ── 文件策略保护 ─────────────────────────────────────────────────────

  /**
   * 检查文件编辑策略：二进制、大文件、generated 文件保护。
   * @private
   * @param {string} path
   * @returns {Promise<string|null>} 错误消息或 null（允许编辑）
   */
  async _checkFilePolicy(path) {
    // 检查文件是否存在
    let statInfo;
    try {
      statInfo = await this.fs.stat(path);
    } catch {
      // 文件不存在则允许创建
      return null;
    }

    // 大文件检查（默认 1MB 以上拒绝 Hashline 编辑）
    const maxFileSize = this.maxFileSize || 1_048_576; // 1MB
    if (statInfo.size > maxFileSize) {
      return `File too large for Hashline editing: ${path} (${(statInfo.size / 1024 / 1024).toFixed(1)}MB > ${(maxFileSize / 1024 / 1024).toFixed(1)}MB limit). Use write_file for full-file replacement instead.`;
    }

    // Generated / binary / minified 文件检查
    const pathLower = path.toLowerCase();
    const generatedPatterns = [
      /\.d\.ts$/, /\.generated\./, /\.min\.(js|css)$/,
      /\/dist\//, /\/build\//, /\/\.next\//, /\/node_modules\//,
      /\.bundle\./, /-bundle\./,
    ];
    for (const pattern of generatedPatterns) {
      if (pattern.test(pathLower)) {
        return `Cannot edit generated/build artifact: ${path}. Use write_file if this is intentional.`;
      }
    }

    // Lockfile 只读保护
    const lockfilePatterns = [
      /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
      /Cargo\.lock$/, /Gemfile\.lock$/, /poetry\.lock$/,
      /composer\.lock$/, /Pipfile\.lock$/,
    ];
    for (const pattern of lockfilePatterns) {
      if (pattern.test(pathLower)) {
        return `Cannot edit lockfile via Hashline: ${path}. Use write_file with explicit content if needed.`;
      }
    }

    return null;
  }

  // ── preflight 单 section ──────────────────────────────────────────────────

  /**
   * @private
   * @param {Section} section
   * @returns {Promise<PreflightSectionResult>}
   */
  async _preflightSection(section) {
    const result = {
      path: section.path,
      tag: section.tag,
      ok: false,
      recoverable: false,
      error: null,
      currentText: null,
      currentTag: null,
      matchStale: false,
    };
    let exists;
    try {
      exists = await this.fs.exists(section.path);
    } catch (err) {
      result.error = `stat failed: ${err.message}`;
      return result;
    }
    if (!exists) {
      result.error = `file not found: ${section.path}`;
      return result;
    }
    let text;
    try {
      text = await this.fs.read(section.path);
    } catch (err) {
      result.error = `read failed: ${err.message}`;
      return result;
    }
    result.currentText = text;
    const currentTag = computeTag(text);
    result.currentTag = currentTag;

    if (currentTag === section.tag) {
      // tag 匹配：检查 hunks 行范围
      const lineCount = text.split('\n').length;
      for (const h of section.hunks) {
        const rangeErr = this._checkRange(h, lineCount);
        if (rangeErr) {
          result.error = rangeErr;
          return result;
        }
      }
      result.ok = true;
      return result;
    }

    // tag 不匹配：可恢复？只有当 snapshot store 里有这个 tag，或当前文件能定位到
    // 足够 seen lines 时才标记为可恢复。
    result.matchStale = true;
    if (this.snapshots.has(section.path, section.tag)) {
      result.recoverable = true;
    } else {
      // 没有 snapshot：仍尝试基于 seen lines 做 3-way
      const seen = this.snapshots.seenLines(section.path);
      if (seen.size > 0) {
        result.recoverable = true;
      }
    }
    result.error = `stale tag: patch expects ${section.tag.substring(0, 12)}... but current is ${currentTag.substring(0, 12)}...`;
    return result;
  }

  _checkRange(hunk, lineCount) {
    if (hunk.start < 1) { return `hunk at src line ${hunk.srcLine}: start line ${hunk.start} < 1`; }
    if (hunk.end < hunk.start) { return `hunk at src line ${hunk.srcLine}: end ${hunk.end} < start ${hunk.start}`; }
    if (hunk.op === OP_INS_PRE) {
      // INS.PRE N: 在第 N 行前插入；N 可以为 lineCount+1（追加到末尾）
      if (hunk.start > lineCount + 1) {
        return `INS.PRE ${hunk.start} out of range (file has ${lineCount} lines)`;
      }
    } else if (hunk.op === OP_INS_POST) {
      if (hunk.start > lineCount) {
        return `INS.POST ${hunk.start} out of range (file has ${lineCount} lines)`;
      }
    } else {
      // SWAP / DEL
      if (hunk.start > lineCount) {
        return `${hunk.op} ${hunk.start}.=${hunk.end} out of range (file has ${lineCount} lines)`;
      }
      if (hunk.end > lineCount) {
        return `${hunk.op} ${hunk.start}.=${hunk.end} end out of range (file has ${lineCount} lines)`;
      }
    }
    return null;
  }

  // ── 干净应用（tag 匹配） ───────────────────────────────────────────────────

  /**
   * @private
   * @param {Section} section
   * @param {PreflightSectionResult} pre
   * @returns {Promise<{section, path, originalText, newText, hunksApplied, recovered: boolean, warnings: string[]}>}
   */
  async _applySectionClean(section, pre) {
    const text = pre.currentText;
    const newText = applyHunksToText(text, section.hunks);
    return {
      section,
      path: section.path,
      originalText: text,
      newText,
      hunksApplied: section.hunks.length,
      recovered: false,
      warnings: [],
    };
  }

  // ── 恢复应用（stale tag，3-way merge） ───────────────────────────────────

  /**
   * @private
   * @param {Section} section
   * @param {PreflightSectionResult} pre
   * @returns {Promise<{section, path, originalText, newText, hunksApplied, recovered: boolean, warnings: string[]}>}
   */
  async _applySectionWithRecovery(section, pre) {
    const currentText = pre.currentText;
    const snapshot = this.snapshots.byHash(section.path, section.tag);
    const baseText = snapshot ? snapshot.text : null;

    let recoveredHunks;
    const warnings = [];
    let conflicts = [];
    if (baseText) {
      warnings.push(`recovered via snapshot store (base tag known)`);
      // ── P4: 使用 Diff3MergeEngine 做真正 base/current/intended 三方 merge ──
      const diff3Result = Diff3MergeEngine.merge(
        baseText, currentText, section.hunks, section.path
      );
      if (diff3Result.conflicts.length > 0) {
        conflicts = diff3Result.conflicts.map(c => ({
          type: 'conflict',
          hunk: { start: c.baseRange[0], end: c.baseRange[1] },
          baseContent: c.baseText,
          curContent: c.currentText,
          patchContent: c.patchText,
          message: `Diff3 conflict: ${c.reason || HashlineErrorCode.CONFLICT_CONTENT_DIVERGED}`,
        }));
        for (const c of diff3Result.conflicts) {
          warnings.push(`diff3 conflict: ${c.reason || 'content diverged'} at lines ${c.baseRange.join('-')}`);
        }
      }
      if (diff3Result.merged !== null) {
        // diff3 成功合并 → 直接返回合并文本，跳过 hunk-by-hunk 应用
        return {
          section,
          path: section.path,
          originalText: currentText,
          newText: diff3Result.merged,
          hunksApplied: diff3Result.conflicts.length === 0 ? section.hunks.length : 0,
          recovered: true,
          warnings,
          conflicts,
        };
      }
      // diff3 无法合并 → 降级到原有 _remapHunksAgainstBase
      warnings.push(`diff3 merge incomplete, falling back to remap`);
      recoveredHunks = this._remapHunksAgainstBase(baseText, currentText, section.hunks);
      if (this._lastConflicts && this._lastConflicts.length > 0) {
        for (const c of this._lastConflicts) {
          if (c.type === 'conflict') {
            if (!conflicts.some(ex => ex.message === c.message)) {
              conflicts.push(c);
            }
            warnings.push(`fallback conflict: base and current differ in hunk range`);
          } else if (c.type === 'gone') {
            warnings.push(`warning: ${c.message}`);
          }
        }
      }
    } else {
      warnings.push(`recovered via seen-line fingerprint matching (no snapshot available)`);
      recoveredHunks = this._remapHunksByContent(currentText, section.hunks);
    }

    const lineCount = currentText.split('\n').length;
    for (const h of recoveredHunks) {
      const rangeErr = this._checkRange(h, lineCount);
      if (rangeErr) {
        throw new PatchApplyError(rangeErr, { path: section.path, section, hunk: h, recoverable: false });
      }
    }

    const newText = applyHunksToText(currentText, recoveredHunks);
    return {
      section,
      path: section.path,
      originalText: currentText,
      newText,
      hunksApplied: recoveredHunks.length,
      recovered: true,
      warnings,
      conflicts,
    };
  }

  getLastConflicts() {
    return this._lastConflicts || [];
  }

  /**
   * 用已知 base 文本对 hunks 做 3-way merge：
   *  - 先计算 base 和 current 的 diff，找出当前文件的修改区域
   *  - 检测冲突：当 patch 的 hunk 区域与 current 的修改区域重叠时
   *  - 对于无冲突的 hunks：用行内容指纹 + 邻居上下文重映射行号
   *  - 对于有冲突的 hunks：采用 diff3 风格的冲突处理
   *
   * @private
   */
  _remapHunksAgainstBase(baseText, currentText, hunks) {
    const baseLines = baseText.split('\n');
    const curLines = currentText.split('\n');

    const conflicts = [];

    const baseToCurMapping = this._computeLineMapping(baseLines, curLines);

    const curIndex = new Map();
    for (let i = 0; i < curLines.length; i++) {
      const fp = hashContent(curLines[i]);
      if (!curIndex.has(fp)) { curIndex.set(fp, []); }
      curIndex.get(fp).push(i + 1);
    }

    const scoreNeighbors = (b, c, window = 3) => {
      let score = 0;
      for (let d = -window; d <= window; d++) {
        if (d === 0) { continue; }
        const bl = baseLines[b - 1 + d];
        const cl = curLines[c - 1 + d];
        if (bl === undefined || cl === undefined) { continue; }
        if (hashContent(bl) === hashContent(cl)) { score++; }
      }
      return score;
    };

    const hunksByStart = [...hunks].sort((a, b) => a.start - b.start);

    const result = [];
    for (const h of hunksByStart) {
      const remapped = { ...h, lines: h.lines.slice() };

      let mappedStart = baseToCurMapping[h.start];
      let mappedEnd = baseToCurMapping[h.end];
      let foundByFallback = false;

      if (mappedStart === undefined || mappedEnd === undefined) {
        const baseStartLine = baseLines[h.start - 1];
        if (baseStartLine === undefined) {
          conflicts.push({
            type: 'gone',
            hunk: h,
            message: `Hunk anchor line ${h.start} no longer exists in current file`,
          });
          result.push(remapped);
          continue;
        }

        const fp = hashContent(baseStartLine);
        const candidates = curIndex.get(fp) || [];

        if (candidates.length === 0) {
          foundByFallback = true;
          const nearestLine = Math.min(h.start, curLines.length);
          mappedStart = nearestLine;
          const length = h.end - h.start;
          mappedEnd = Math.min(mappedStart + length, curLines.length);
        } else {
          if (candidates.length === 1) {
            mappedStart = candidates[0];
          } else {
            let best = candidates[0];
            let bestScore = scoreNeighbors(h.start, best);
            let bestDelta = Math.abs(best - h.start);
            for (let k = 1; k < candidates.length; k++) {
              const c = candidates[k];
              const sc = scoreNeighbors(h.start, c);
              const dlt = Math.abs(c - h.start);
              if (sc > bestScore ||
                  (sc === bestScore && dlt < bestDelta) ||
                  (sc === bestScore && dlt === bestDelta && c > best)) {
                best = c;
                bestScore = sc;
                bestDelta = dlt;
              }
            }
            mappedStart = best;
          }
          const length = h.end - h.start;
          mappedEnd = Math.min(mappedStart + length, curLines.length);
        }
      }

      const baseContent = h.start <= baseLines.length ? baseLines.slice(h.start - 1, h.end).join('\n') : '';
      const curContent = mappedStart <= curLines.length ? curLines.slice(mappedStart - 1, mappedEnd).join('\n') : '';

      if (h.op !== OP_INS_PRE && h.op !== OP_INS_POST) {
        if (baseContent !== '' && curContent !== '' && baseContent !== curContent) {
          conflicts.push({
            type: 'conflict',
            hunk: h,
            baseContent,
            curContent,
            patchContent: h.lines.join('\n'),
            message: `Content conflict: base and current differ in hunk range`,
          });
          // 冲突时标记为跳过：使用 curContent 范围但 op 设为 NOP，保留当前内容
          remapped.op = 'NOP';
        } else if (foundByFallback && baseContent !== '') {
          conflicts.push({
            type: 'conflict',
            hunk: h,
            baseContent,
            curContent,
            patchContent: h.lines.join('\n'),
            message: `Conflict: base line content changed, no matching line found in current file`,
          });
          remapped.op = 'NOP';
        }
      }

      remapped.start = mappedStart;
      remapped.end = mappedEnd;

      if (remapped.end > curLines.length) { remapped.end = curLines.length; }
      if (remapped.start > curLines.length) { remapped.start = curLines.length; }

      result.push(remapped);
    }

    if (conflicts.length > 0) {
      this._lastConflicts = conflicts;
    }

    return result;
  }

  /**
   * 计算 base 行号到 current 行号的映射。
   * @private
   */
  _computeLineMapping(baseLines, curLines) {
    const mapping = {};
    const lcs = this._computeLCS(baseLines, curLines);

    let bi = 0;
    let ci = 0;
    for (const match of lcs) {
      while (bi < match.baseIdx) {
        bi++;
      }
      while (ci < match.curIdx) {
        ci++;
      }
      mapping[bi + 1] = ci + 1;
      bi++;
      ci++;
    }

    return mapping;
  }

  /**
   * 计算最长公共子序列（LCS），用于行映射。
   * @private
   */
  _computeLCS(a, b) {
    const n = a.length;
    const m = b.length;

    if (n === 0 || m === 0) { return []; }

    const SAFE_SIZE = 1000000;
    if (n * m > SAFE_SIZE) {
      return this._computeLCSGreedy(a, b);
    }

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

    const lcs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        lcs.push({ baseIdx: i, curIdx: j });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    return lcs;
  }

  /**
   * 贪心 LCS 算法（用于大文件）。
   * @private
   */
  _computeLCSGreedy(a, b) {
    const fingerprintMap = new Map();
    for (let i = 0; i < b.length; i++) {
      const fp = hashContent(b[i]);
      if (!fingerprintMap.has(fp)) {
        fingerprintMap.set(fp, []);
      }
      fingerprintMap.get(fp).push(i);
    }

    const lcs = [];
    let lastCurIdx = -1;
    for (let i = 0; i < a.length; i++) {
      const fp = hashContent(a[i]);
      const candidates = fingerprintMap.get(fp) || [];
      const found = candidates.find(c => c > lastCurIdx);
      if (found !== undefined) {
        lcs.push({ baseIdx: i, curIdx: found });
        lastCurIdx = found;
      }
    }

    return lcs;
  }

  /**
   * 无 base 文本时，仅靠 hunk 的"期望被替换的内容"在 current 中查找锚点。
   * 这种情况要求调用方在生成 patch 时把要替换/删除的原文也带上（作为
   * hunk.lines 的上下文）。我们这里采用一种保守策略：
   *  - 对于 INS.*：保持原行号（无法重定位）。
   *  - 对于 SWAP/DEL：若 hunk.lines 非空，把它视作"要删的内容"，在 current
   *    中查找该内容块的首行行号；找不到则保持原行号。
   *
   * @private
   */
  _remapHunksByContent(currentText, hunks) {
    const curLines = currentText.split('\n');

    return hunks.map((h) => {
      const remapped = { ...h, lines: h.lines.slice() };

      // 对于 SWAP/DEL hunk：用内容在 current 中查找匹配行
      if (h.op === 'SWAP' || h.op === 'DEL') {
        if (h.lines && h.lines.length > 0) {
          // 用第一行做指纹（去首尾空白后取前 40 字符）
          const fingerprint = h.lines[0].trim().substring(0, 40);
          if (fingerprint.length >= 3) {
            let bestIdx = -1;
            let bestScore = 0;

            for (let i = 0; i < curLines.length; i++) {
              const score = this._contentMatchScore(fingerprint, curLines[i].trim(), h.lines);
              if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
              }
            }

            if (bestIdx >= 0 && bestScore >= 0.6) {
              remapped.start = bestIdx + 1; // 1-based
              remapped.end = Math.min(bestIdx + h.lines.length, curLines.length);
            }
          }
        }
      }

      return remapped;
    });
  }

  /**
   * 计算单行内容匹配度（0-1），考虑多行上下文。
   */
  _contentMatchScore(fingerprint, candidate, allLines) {
    let score = 0;

    // 精确匹配
    if (candidate === fingerprint) {
      score = 1.0;
    } else if (candidate.startsWith(fingerprint) || fingerprint.startsWith(candidate)) {
      score = 0.8;
    } else if (candidate.includes(fingerprint.substring(0, Math.min(20, fingerprint.length)))) {
      score = 0.6;
    }

    // 多行匹配加分：若后续行也匹配
    if (allLines.length > 1 && score > 0) {
      score = Math.min(1.0, score + 0.1);
    }

    return score;
  }
}

/**
 * @typedef {Object} PreflightSectionResult
 * @property {string} path
 * @property {string} tag
 * @property {boolean} ok
 * @property {boolean} recoverable
 * @property {string|null} error
 * @property {string|null} currentText
 * @property {string|null} currentTag
 * @property {boolean} matchStale
 */

// ─────────────────────────────────────────────────────────────────────────────
// 把 hunks 应用到文本（行级操作，1-based 闭区间）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把一组 hunks 应用到 text，返回新文本。hunks 必须按行号降序处理以避免
 * 行号偏移。这里我们先把所有 hunk 转成"行级编辑"，再按 (start desc) 排序
 * 后从尾部向头部应用。
 *
 * @param {string} text
 * @param {Hunk[]} hunks
 * @returns {string}
 */
export function applyHunksToText(text, hunks) {
  if (hunks.length === 0) { return text; }

  // 把 INS.PRE/POST 归一成等价的 SWAP：空区间替换。
  // NOP hunk 直接跳过。
  const edits = [];
  for (const h of hunks) {
    if (h.op === 'NOP') { continue; }  // 冲突跳过的 hunk
    if (h.op === OP_INS_PRE) {
      edits.push({ start: h.start, end: h.start - 1, lines: h.lines });
    } else if (h.op === OP_INS_POST) {
      edits.push({ start: h.start + 1, end: h.start, lines: h.lines });
    } else if (h.op === OP_SWAP) {
      edits.push({ start: h.start, end: h.end, lines: h.lines });
    } else if (h.op === OP_DEL) {
      edits.push({ start: h.start, end: h.end, lines: [] });
    } else {
      throw new Error(`unknown op: ${h.op}`);
    }
  }

  // 校验区间不重叠（按 start 升序检查）
  const sorted = edits.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevIsEmpty = prev.end < prev.start;
    const curIsEmpty = cur.end < cur.start;
    const prevEffectiveEnd = prevIsEmpty ? prev.start - 1 : prev.end;

    if (!prevIsEmpty && !curIsEmpty) {
      // 两个都是非空区间：严格不重叠
      if (cur.start <= prevEffectiveEnd) {
        throw new PatchApplyError(
          `overlapping hunks: previous covers up to line ${prevEffectiveEnd}, next starts at ${cur.start}`,
        );
      }
    } else if (!prevIsEmpty && curIsEmpty) {
      // prev 非空，cur 是空区间：空区间 start 不能落在 prev 区间内部（不含边界）
      // cur.start 是插入点：插入在 cur.start-1 和 cur.start 之间
      // 允许 cur.start === prev.end + 1（紧挨 prev 之后插入）
      // 也允许 cur.start === prev.start（紧挨 prev 之前插入，INS.POST prev.start-1 的情况）
      if (cur.start > prev.start && cur.start <= prev.end) {
        throw new PatchApplyError(
          `overlapping hunks: previous covers [${prev.start},${prev.end}], empty insert at ${cur.start} falls inside`,
        );
      }
    } else if (prevIsEmpty && !curIsEmpty) {
      // prev 是空区间，cur 非空：cur 不能覆盖 prev 的插入点
      // 空区间在 prev.start-1 和 prev.start 之间，cur 若包含该区域则冲突
      if (cur.start <= prev.start - 1 && cur.end >= prev.start) {
        throw new PatchApplyError(
          `overlapping hunks: empty insert at ${prev.start} conflicts with next covering [${cur.start},${cur.end}]`,
        );
      }
    }
    // 两个都是空区间：不检查（多次插入同一位置是允许的）
  }

  // 保留结尾换行状态
  const lines = text.split('\n');
  // 从后往前应用（行号 1-based）。相同 start 时，非空区间（替换/删除）先于
  // 空区间（插入）应用，保证“替换第 N 行”与“在第 N 行前/后插入”共存时顺序正确。
  const desc = edits.slice().sort((a, b) => {
    if (b.start !== a.start) { return b.start - a.start; }
    const aEmpty = a.end < a.start ? 1 : 0;
    const bEmpty = b.end < b.start ? 1 : 0;
    return aEmpty - bEmpty; // 非空(0) 排在 空区间(1) 前面
  });
  for (const e of desc) {
    const s = e.start; // 1-based
    const en = e.end;  // 1-based, inclusive
    // lines 是 0-based 数组
    // 删除 [s-1, en-1]，插入 e.lines
    const before = lines.slice(0, Math.max(0, s - 1));
    const after = lines.slice(Math.max(0, en));
    before.push(...e.lines);
    before.push(...after);
    lines.length = 0;
    lines.push(...before);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 桥接：把 Hashline 的 snapshot / blob 记录写入既有 ContentAddressableStore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HashlineBridge：把 Patcher 的事件桥接到既有的 ContentAddressableStore
 * （src/core/harness/content-addressing.js），让两套体系共享对象存储。
 */
export class HashlineBridge {
  /**
   * @param {object} store  ContentAddressableStore 实例
   * @param {object} [analyzer] FileAnalyzer 实例（可选）
   */
  constructor(store, analyzer = null) {
    this.store = store;
    this.analyzer = analyzer;
  }

  /**
   * Patcher 每次 apply 成功一个 section 后回调。
   * @param {string} path
   * @param {string} originalText
   * @param {string} newText
   * @param {string} oldTag
   * @param {string} newTag
   */
  recordApply(path, originalText, newText, oldTag, newTag) {
    if (!this.store) { return; }
    try {
      // 记录旧 blob / anchor
      this.store.storeBlob(originalText);
      this.store.setRef(`hashline:${path}:${oldTag}`, this.store.storeBlob(originalText));
      // 记录新 blob + ref
      const newBlob = this.store.storeBlob(newText);
      this.store.setRef(`hashline:${path}:${newTag}`, newBlob);
      this.store.setRef(`file:${path}`, newBlob);
      if (this.analyzer && typeof this.analyzer.analyzeFile === 'function') {
        this.analyzer.analyzeFile(path, newText);
      }
    } catch {
      // 桥接失败不应影响 patcher 主流程
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 扩展 DSL 操作
// ─────────────────────────────────────────────────────────────────────────────

/** 在文件头部插入（第 1 行之前） */
const OP_INS_HEAD = 'INS.HEAD';
/** 在文件尾部追加（最后一行之后） */
const OP_INS_TAIL = 'INS.TAIL';
/** 在代码块之后插入（BLK 指 blank-line delimited block） */
const OP_INS_BLK_POST = 'INS.BLK.POST';
/** 替换整个代码块 */
const OP_SWAP_BLK = 'SWAP.BLK';
/** 删除整个代码块 */
const OP_DEL_BLK = 'DEL.BLK';
/** 中止标记（整个 section 不应用） */
const OP_ABORT = 'ABORT';

export { OP_INS_HEAD, OP_INS_TAIL, OP_INS_BLK_POST, OP_SWAP_BLK, OP_DEL_BLK, OP_ABORT };

// ─────────────────────────────────────────────────────────────────────────────
// 正式 Grammar Spec & Error Codes（固定化的语法规范）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hashline Grammar Specification v2.0（BNF 形式）
 *
 * ```text
 * patch            ::= (section | blank | comment)*
 * section          ::= section_header (op_header content_lines?)+
 * section_header   ::= '[' path '#' tag ']'
 * path             ::= [^#\]]+          # 文件路径，不能含 # 或 ]
 * tag              ::= [a-f0-9]{64}     # SHA-256 hex
 *
 * op_header        ::= swap_op | del_op | ins_pre_op | ins_post_op
 *                    | ins_head_op | ins_tail_op | ins_blk_post_op
 *                    | swap_blk_op | del_blk_op | abort_op
 *
 * swap_op          ::= 'SWAP' ws num ('.=' num)? ':'?
 * del_op           ::= 'DEL' ws num ('.=' num)?
 * ins_pre_op       ::= 'INS.PRE' ws num '='?
 * ins_post_op      ::= 'INS.POST' ws num '='?
 * ins_head_op      ::= 'INS.HEAD' ws num '='?   # 语义：在第 num 行之前插入（通常 num=1）
 * ins_tail_op      ::= 'INS.TAIL' ws num '=?'   # 语义：在第 num 行之后插入（通常 num=last）
 * ins_blk_post_op  ::= 'INS.BLK.POST' ws num '='?
 * swap_blk_op      ::= 'SWAP.BLK' ws num '='? ':'?
 * del_blk_op       ::= 'DEL.BLK' ws num '='?
 * abort_op         ::= 'ABORT'
 *
 * content_lines    ::= content_line+
 * content_line     ::= '+' text?
 *
 * blank            ::= ^\s*$
 * comment          ::= ^\s*#.*$
 * ws               ::= \s+
 * num              ::= \d+
 * text             ::= .*
 * ```
 */

/**
 * 所有已知操作类型映射（供 parser 引用）。
 * @internal
 */
const _ALL_OPS = {
  SWAP: OP_SWAP,
  DEL: OP_DEL,
  'INS.PRE': OP_INS_PRE,
  'INS.POST': OP_INS_POST,
  'INS.HEAD': OP_INS_HEAD,
  'INS.TAIL': OP_INS_TAIL,
  'INS.BLK.POST': OP_INS_BLK_POST,
  'SWAP.BLK': OP_SWAP_BLK,
  'DEL.BLK': OP_DEL_BLK,
  ABORT: OP_ABORT,
};

/**
 * Hashline 错误代码枚举。
 */
export const HashlineErrorCode = {
  // Parse errors
  PARSE_UNEXPECTED_TOKEN: 'PARSE_UNEXPECTED_TOKEN',
  PARSE_NO_SECTION_OPEN: 'PARSE_NO_SECTION_OPEN',
  PARSE_CONTENT_WITHOUT_OP: 'PARSE_CONTENT_WITHOUT_OP',
  PARSE_INVALID_SECTION_HEADER: 'PARSE_INVALID_SECTION_HEADER',
  PARSE_INVALID_TAG_FORMAT: 'PARSE_INVALID_TAG_FORMAT',
  PARSE_INVALID_LINE_NUMBER: 'PARSE_INVALID_LINE_NUMBER',
  PARSE_AMBIGUOUS_SYNTAX: 'PARSE_AMBIGUOUS_SYNTAX',
  PARSE_UNIFIED_DIFF_DETECTED: 'PARSE_UNIFIED_DIFF_DETECTED',

  // Apply errors
  APPLY_STALE_TAG: 'APPLY_STALE_TAG',
  APPLY_FILE_NOT_FOUND: 'APPLY_FILE_NOT_FOUND',
  APPLY_RANGE_OUT_OF_BOUNDS: 'APPLY_RANGE_OUT_OF_BOUNDS',
  APPLY_OVERLAPPING_HUNKS: 'APPLY_OVERLAPPING_HUNKS',
  APPLY_WRITE_FAILED: 'APPLY_WRITE_FAILED',
  APPLY_ROLLBACK_FAILED: 'APPLY_ROLLBACK_FAILED',

  // Conflict errors
  CONFLICT_OVERLAPPING_CHANGE: 'CONFLICT_OVERLAPPING_CHANGE',
  CONFLICT_MOVED_BLOCK: 'CONFLICT_MOVED_BLOCK',
  CONFLICT_DELETED_ANCHOR: 'CONFLICT_DELETED_ANCHOR',
  CONFLICT_AMBIGUOUS_MATCH: 'CONFLICT_AMBIGUOUS_MATCH',
  CONFLICT_CONTENT_DIVERGED: 'CONFLICT_CONTENT_DIVERGED',

  // Policy errors
  POLICY_PATH_ESCAPE: 'POLICY_PATH_ESCAPE',
  POLICY_SYMLINK_ESCAPE: 'POLICY_SYMLINK_ESCAPE',
  POLICY_GENERATED_FILE: 'POLICY_GENERATED_FILE',
  POLICY_BINARY_FILE: 'POLICY_BINARY_FILE',
  POLICY_MINIFIED_FILE: 'POLICY_MINIFIED_FILE',
  POLICY_LOCKFILE_READONLY: 'POLICY_LOCKFILE_READONLY',
  POLICY_FILE_TOO_LARGE: 'POLICY_FILE_TOO_LARGE',
};

/**
 * Error severity level 映射。
 *  - FATAL: 必须中断，无法继续
 *  - ERROR: 当前操作失败，可重试
 *  - WARNING: 非阻塞警告，操作可继续
 */
export const HashlineErrorSeverity = {
  PARSE_UNEXPECTED_TOKEN: 'FATAL',
  PARSE_NO_SECTION_OPEN: 'FATAL',
  PARSE_CONTENT_WITHOUT_OP: 'FATAL',
  PARSE_INVALID_SECTION_HEADER: 'FATAL',
  PARSE_INVALID_TAG_FORMAT: 'FATAL',
  PARSE_INVALID_LINE_NUMBER: 'FATAL',
  PARSE_AMBIGUOUS_SYNTAX: 'WARNING',
  PARSE_UNIFIED_DIFF_DETECTED: 'ERROR',
  APPLY_STALE_TAG: 'ERROR',
  APPLY_FILE_NOT_FOUND: 'ERROR',
  APPLY_RANGE_OUT_OF_BOUNDS: 'ERROR',
  APPLY_OVERLAPPING_HUNKS: 'FATAL',
  APPLY_WRITE_FAILED: 'FATAL',
  APPLY_ROLLBACK_FAILED: 'FATAL',
  CONFLICT_OVERLAPPING_CHANGE: 'ERROR',
  CONFLICT_MOVED_BLOCK: 'WARNING',
  CONFLICT_DELETED_ANCHOR: 'ERROR',
  CONFLICT_AMBIGUOUS_MATCH: 'WARNING',
  CONFLICT_CONTENT_DIVERGED: 'ERROR',
  POLICY_PATH_ESCAPE: 'FATAL',
  POLICY_SYMLINK_ESCAPE: 'FATAL',
  POLICY_GENERATED_FILE: 'FATAL',
  POLICY_BINARY_FILE: 'FATAL',
  POLICY_MINIFIED_FILE: 'FATAL',
  POLICY_LOCKFILE_READONLY: 'FATAL',
  POLICY_FILE_TOO_LARGE: 'FATAL',
};

/** 获取错误代码对应的严重级别。 */
export function errorSeverity(code) {
  return HashlineErrorSeverity[code] || 'ERROR';
}

/**
 * 所有错误的统一规范化格式。
 * 包含：code, severity, sourceSpan, message, context。
 */
export function formatHashlineError(code, message, sourceSpan = null, context = null) {
  const sev = errorSeverity(code);
  const err = { code, severity: sev, message };
  if (sourceSpan) {
    err.sourceSpan = {
      line: sourceSpan.line || sourceSpan.srcLine || null,
      column: sourceSpan.column || null,
      span: sourceSpan.span || null,
    };
  }
  if (context) { err.context = context; }
  return err;
}

/**
 * 结构化解析错误（含 source span）。
 */
export class StructuredParseError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {string} details.code         错误代码（来自 HashlineErrorCode）
   * @param {number} [details.line]       1-based 源行号
   * @param {number} [details.column]     1-based 源列号
   * @param {number} [details.srcLine]    patch 文本中的行号
   * @param {string} [details.span]       出错的源文本片段
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'StructuredParseError';
    this.code = details.code || HashlineErrorCode.PARSE_UNEXPECTED_TOKEN;
    this.line = details.line || null;
    this.column = details.column || null;
    this.srcLine = details.srcLine || null;
    this.span = details.span || null;
  }
}

/**
 * 增强版 PatchApplyError（带结构化冲突）。
 */
export class StructuredApplyError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {string} [details.path]
   * @param {string} [details.code]
   * @param {Diff3Conflict|null} [details.conflict]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'StructuredApplyError';
    this.path = details.path || null;
    this.code = details.code || null;
    this.conflict = details.conflict || null;
  }
}

/**
 * 结构化 diff3 冲突对象（对标文档要求）。
 *
 * @typedef {Object} Diff3Conflict
 * @property {string} path            文件路径
 * @property {number[]} baseRange     [startLine, endLine] base 中的范围
 * @property {number[]} currentRange  [startLine, endLine] current 中的范围
 * @property {number[]} patchRange    [startLine, endLine] patch 中的范围
 * @property {string} baseText        base 中的文本
 * @property {string} currentText     current 中的文本
 * @property {string} patchText       patch 中期望的文本
 * @property {string} reason         冲突原因
 */

/**
 * 创建结构化冲突对象。
 * @param {object} opts
 * @returns {Diff3Conflict}
 */
export function createDiff3Conflict(opts = {}) {
  return {
    path: opts.path || '',
    baseRange: opts.baseRange || [0, 0],
    currentRange: opts.currentRange || [0, 0],
    patchRange: opts.patchRange || [0, 0],
    baseText: opts.baseText || '',
    currentText: opts.currentText || '',
    patchText: opts.patchText || '',
    reason: opts.reason || 'overlapping_change',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 增强 Parser：支持扩展 DSL + 正式错误代码 + source span
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析增强版 patch 文本，支持扩展 DSL 操作和正式错误报告。
 *
 * @param {string} text
 * @returns {Patch}
 * @throws {StructuredParseError}
 */
export function parsePatchExtended(text) {
  const rawLines = String(text).split('\n');
  const sections = [];
  let cur = null;
  let pendingOp = null;

  const flushOp = () => {
    if (pendingOp) {
      if (!cur) {
        throw new StructuredParseError('Content line before any [path#tag] section', {
          code: HashlineErrorCode.PARSE_NO_SECTION_OPEN,
          srcLine: pendingOp.srcLine,
        });
      }
      cur.hunks.push(pendingOp);
      pendingOp = null;
    }
  };

  const flushSection = () => {
    flushOp();
    if (cur) {
      sections.push(new Section(cur.path, cur.tag, cur.hunks));
      cur = null;
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lineNo = i + 1;

    // 注释 / 空行
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { continue; }

    // 检测统一 diff 格式混入
    if (trimmed.startsWith('@@ ') || trimmed.startsWith('--- ') || trimmed.startsWith('+++ ') || trimmed.startsWith('diff ')) {
      throw new StructuredParseError(
        `Unified diff format detected at line ${lineNo}: '${trimmed.substring(0, 40)}...'. Use Hashline patch format instead.`,
        { code: HashlineErrorCode.PARSE_UNIFIED_DIFF_DETECTED, srcLine: lineNo, span: trimmed },
      );
    }

    // 节区头
    const sectionMatch = line.match(/^\[([^\]#]+)#([a-f0-9]{64})\]\s*$/);
    if (sectionMatch) {
      flushSection();
      cur = { path: sectionMatch[1].trim(), tag: sectionMatch[2].trim(), hunks: [] };
      continue;
    }

    // 宽松节区头（非 64 字符的 tag，给个警告但不失败）
    const looseSectionMatch = line.match(/^\[([^\]#]+)#([^\]]+)\]\s*$/);
    if (looseSectionMatch) {
      flushSection();
      cur = { path: looseSectionMatch[1].trim(), tag: looseSectionMatch[2].trim(), hunks: [] };
      continue;
    }

    if (!cur) {
      throw new StructuredParseError(
        `Unexpected token at line ${lineNo}: '${trimmed}' (no [path#tag] section open)`,
        { code: HashlineErrorCode.PARSE_NO_SECTION_OPEN, srcLine: lineNo, span: trimmed },
      );
    }

    // ABORT sentinel
    if (trimmed === 'ABORT') {
      flushOp();
      pendingOp = { op: OP_ABORT, start: 0, end: 0, lines: [], srcLine: lineNo };
      flushOp();
      continue;
    }

    // 扩展操作：INS.HEAD
    const insHeadMatch = line.match(/^INS\.HEAD\s+(\d+)\s*=?\s*$/);
    if (insHeadMatch) {
      flushOp();
      const start = parseInt(insHeadMatch[1], 10);
      pendingOp = { op: OP_INS_HEAD, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }

    // 扩展操作：INS.TAIL
    const insTailMatch = line.match(/^INS\.TAIL\s+(\d+)\s*=?\s*$/);
    if (insTailMatch) {
      flushOp();
      const start = parseInt(insTailMatch[1], 10);
      pendingOp = { op: OP_INS_TAIL, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }

    // 扩展操作：INS.BLK.POST
    const insBlkPostMatch = line.match(/^INS\.BLK\.POST\s+(\d+)\s*=?\s*$/);
    if (insBlkPostMatch) {
      flushOp();
      const start = parseInt(insBlkPostMatch[1], 10);
      pendingOp = { op: OP_INS_BLK_POST, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }

    // 扩展操作：SWAP.BLK
    const swapBlkMatch = line.match(/^SWAP\.BLK\s+(\d+)\s*=?\s*:?\s*$/);
    if (swapBlkMatch) {
      flushOp();
      const start = parseInt(swapBlkMatch[1], 10);
      pendingOp = { op: OP_SWAP_BLK, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }

    // 扩展操作：DEL.BLK
    const delBlkMatch = line.match(/^DEL\.BLK\s+(\d+)\s*=?\s*$/);
    if (delBlkMatch) {
      flushOp();
      const start = parseInt(delBlkMatch[1], 10);
      pendingOp = { op: OP_DEL_BLK, start, end: start, lines: [], srcLine: lineNo };
      flushOp();
      continue;
    }

    // 原有操作
    const swapMatch = line.match(/^SWAP\s+(\d+)\s*\.?=\s*(\d+)\s*:\s*$/);
    const swapSingleMatch = line.match(/^SWAP\s+(\d+)\s*:\s*$/);
    const delMatch = line.match(/^DEL\s+(\d+)\s*\.?=\s*(\d+)\s*$/);
    const delSingleMatch = line.match(/^DEL\s+(\d+)\s*$/);
    const insPreMatch = line.match(/^INS\.PRE\s+(\d+)\s*=\s*$/);
    const insPostMatch = line.match(/^INS\.POST\s+(\d+)\s*=\s*$/);

    if (swapMatch || swapSingleMatch) {
      flushOp();
      const start = parseInt(swapMatch ? swapMatch[1] : swapSingleMatch[1], 10);
      const end = swapMatch ? parseInt(swapMatch[2], 10) : start;
      pendingOp = { op: OP_SWAP, start, end, lines: [], srcLine: lineNo };
      continue;
    }
    if (delMatch || delSingleMatch) {
      flushOp();
      const start = parseInt(delMatch ? delMatch[1] : delSingleMatch[1], 10);
      const end = delMatch ? parseInt(delMatch[2], 10) : start;
      pendingOp = { op: OP_DEL, start, end, lines: [], srcLine: lineNo };
      flushOp();
      continue;
    }
    if (insPreMatch) {
      flushOp();
      const start = parseInt(insPreMatch[1], 10);
      pendingOp = { op: OP_INS_PRE, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }
    if (insPostMatch) {
      flushOp();
      const start = parseInt(insPostMatch[1], 10);
      pendingOp = { op: OP_INS_POST, start, end: start, lines: [], srcLine: lineNo };
      continue;
    }

    // 内容行
    if (line.startsWith('+')) {
      if (!pendingOp) {
        throw new StructuredParseError(
          `Content line at ${lineNo} has no preceding operation header`,
          { code: HashlineErrorCode.PARSE_CONTENT_WITHOUT_OP, srcLine: lineNo, span: line },
        );
      }
      pendingOp.lines.push(line.slice(1));
      continue;
    }

    throw new StructuredParseError(
      `Unrecognized patch line ${lineNo}: '${line}'`,
      { code: HashlineErrorCode.PARSE_UNEXPECTED_TOKEN, srcLine: lineNo, span: line },
    );
  }

  flushSection();
  return new Patch(sections);
}

// ─────────────────────────────────────────────────────────────────────────────
// 增强 applyHunksToText：支持扩展 DSL 操作
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 增强版 applyHunksToText，支持所有扩展 DSL 操作。
 */
export function applyHunksToTextExtended(text, hunks) {
  if (hunks.length === 0) { return text; }

  const lines = text.split('\n');
  const totalLines = lines.length;
  const edits = [];

  for (const h of hunks) {
    if (h.op === 'NOP') { continue; }
    if (h.op === OP_ABORT) { continue; }

    switch (h.op) {
      case OP_INS_PRE:
        edits.push({ start: h.start, end: h.start - 1, lines: h.lines });
        break;
      case OP_INS_POST:
        edits.push({ start: h.start + 1, end: h.start, lines: h.lines });
        break;
      case OP_INS_HEAD:
        // 在文件头部插入（通常是第 1 行前）
        edits.push({ start: h.start, end: h.start - 1, lines: h.lines });
        break;
      case OP_INS_TAIL:
        // 在文件尾部追加
        edits.push({ start: totalLines + 1, end: totalLines, lines: h.lines });
        break;
      case OP_INS_BLK_POST:
        // 在空行分隔的块之后插入：找到 h.start 所在块的结尾空行，在其后插入
        {
          let blkEnd = h.start;
          // 向后找空行或文件结尾
          for (let i1 = h.start; i1 <= totalLines; i1++) {
            if (i1 === totalLines || lines[i1 - 1].trim() === '') {
              blkEnd = i1;
              break;
            }
          }
          edits.push({ start: blkEnd + 1, end: blkEnd, lines: h.lines });
        }
        break;
      case OP_SWAP:
        edits.push({ start: h.start, end: h.end, lines: h.lines });
        break;
      case OP_DEL:
        edits.push({ start: h.start, end: h.end, lines: [] });
        break;
      case OP_SWAP_BLK:
        // 替换整个空行分隔的块
        {
          let blkStart = h.start;
          let blkEnd = h.start;
          // 向前找块起始（空行之后或文件开头）
          for (let i2 = h.start - 1; i2 >= 1; i2--) {
            if (lines[i2 - 1].trim() === '') {
              blkStart = i2 + 1;
              break;
            }
            blkStart = i2;
          }
          // 向后找块结尾（空行或文件结尾）
          for (let i3 = blkStart; i3 <= totalLines; i3++) {
            if (i3 === totalLines || lines[i3 - 1].trim() === '') {
              blkEnd = i3 - 1;
              break;
            }
          }
          if (blkEnd >= blkStart) {
            edits.push({ start: blkStart, end: blkEnd, lines: h.lines });
          }
        }
        break;
      case OP_DEL_BLK:
        // 删除整个空行分隔的块
        {
          let blkStart = h.start;
          let blkEnd = h.start;
          for (let i4 = h.start - 1; i4 >= 1; i4--) {
            if (lines[i4 - 1].trim() === '') { blkStart = i4 + 1; break; }
            blkStart = i4;
          }
          for (let i5 = blkStart; i5 <= totalLines; i5++) {
            if (i5 === totalLines || lines[i5 - 1].trim() === '') { blkEnd = i5 - 1; break; }
          }
          if (blkEnd >= blkStart) {
            edits.push({ start: blkStart, end: blkEnd, lines: [] });
          }
        }
        break;
      default:
        throw new PatchApplyError(`unknown op: ${h.op}`);
    }
  }

  // 验证区间不重叠（与原始版本相同逻辑）
  const sorted = edits.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevIsEmpty = prev.end < prev.start;
    const curIsEmpty = cur.end < cur.start;
    if (!prevIsEmpty && !curIsEmpty && cur.start <= prev.end) {
      throw new PatchApplyError(`overlapping hunks: previous up to ${prev.end}, next starts at ${cur.start}`);
    }
  }

  // 从后往前应用
  const desc = edits.slice().sort((a, b) => {
    if (b.start !== a.start) { return b.start - a.start; }
    const aEmpty = a.end < a.start ? 1 : 0;
    const bEmpty = b.end < b.start ? 1 : 0;
    return aEmpty - bEmpty;
  });

  const result = text.split('\n');
  for (const e of desc) {
    const s = e.start;
    const en = e.end;
    const before = result.slice(0, Math.max(0, s - 1));
    const after = result.slice(Math.max(0, en));
    before.push(...e.lines);
    before.push(...after);
    result.length = 0;
    result.push(...before);
  }
  return result.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 真正 Diff3 Merge（结构化冲突输出）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diff3MergeEngine：真正的 three-way merge 引擎。
 *
 * 输入：
 *  - base：patch 生成时的文件快照
 *  - current：当前磁盘上的文件
 *  - patch：要应用的 hunks
 *
 * 输出：
 *  - merged：合并后的文本（无冲突时）
 *  - conflicts：结构化冲突对象列表
 */
export class Diff3MergeEngine {
  /**
   * 执行 three-way merge。
   * @param {string} baseText       base 快照文本
   * @param {string} currentText    当前文件文本
   * @param {Hunk[]} hunks          要应用的 hunks
   * @returns {{ merged: string|null, conflicts: Diff3Conflict[], path: string }}
   */
  static merge(baseText, currentText, hunks, filePath = '') {
    const baseLines = baseText.split('\n');
    const curLines = currentText.split('\n');
    const conflicts = [];

    // 计算 base → current 的行差异区域
    const baseToCurMapping = Diff3MergeEngine._computeEditMapping(baseLines, curLines);

    // 对每个 hunk 检查是否与 current 的变更区域重叠
    const resolvedHunks = [];
    const unresolvedHunks = [];

    for (const h of hunks) {
      if (h.op === OP_INS_PRE || h.op === OP_INS_POST || h.op === OP_INS_HEAD || h.op === OP_INS_TAIL) {
        // 插入操作：找出在 current 中的正确位置
        // 简化处理：如果能映射就映射，否则用 seen-line 方法
        let targetLine = baseToCurMapping[h.start];
        if (targetLine === undefined) {
          targetLine = Diff3MergeEngine._findLineByContent(curLines, baseLines[h.start - 1]);
          if (targetLine === -1) {
            targetLine = Math.min(h.start, curLines.length);
          }
        }
        resolvedHunks.push({ ...h, start: targetLine, end: targetLine });
        continue;
      }

      // SWAP / DEL 操作：检查重叠
      const baseStart = baseToCurMapping[h.start];
      const baseEnd = baseToCurMapping[h.end];

      if (baseStart === undefined || baseEnd === undefined) {
        // 行无法映射 → 内容可能被移动或删除
        const curStart = Diff3MergeEngine._findLineByContent(curLines, baseLines[h.start - 1]);
        const curEnd = Diff3MergeEngine._findLineByContent(curLines, baseLines[h.end - 1]);

        if (curStart === -1 || curEnd === -1) {
          conflicts.push(createDiff3Conflict({
            path: filePath,
            baseRange: [h.start, h.end],
            currentRange: [-1, -1],
            patchRange: [h.start, h.end],
            baseText: baseLines.slice(h.start - 1, h.end).join('\n'),
            currentText: '',
            patchText: h.lines.join('\n'),
            reason: HashlineErrorCode.CONFLICT_DELETED_ANCHOR,
          }));
          unresolvedHunks.push(h);
          continue;
        }

        // 找到但位置不同 → moved block
        if (Math.abs(curStart - h.start) > 2 || Math.abs(curEnd - h.end) > 2) {
          conflicts.push(createDiff3Conflict({
            path: filePath,
            baseRange: [h.start, h.end],
            currentRange: [curStart, curEnd],
            patchRange: [h.start, h.end],
            baseText: baseLines.slice(h.start - 1, h.end).join('\n'),
            currentText: curLines.slice(curStart - 1, curEnd).join('\n'),
            patchText: h.lines.join('\n'),
            reason: HashlineErrorCode.CONFLICT_MOVED_BLOCK,
          }));
        }

        resolvedHunks.push({ ...h, start: curStart, end: curEnd });
        continue;
      }

      // 检查内容是否变更
      const curContent = curLines.slice(baseStart - 1, baseEnd).join('\n');
      const baseContent = baseLines.slice(h.start - 1, h.end).join('\n');

      if (curContent !== baseContent) {
        conflicts.push(createDiff3Conflict({
          path: filePath,
          baseRange: [h.start, h.end],
          currentRange: [baseStart, baseEnd],
          patchRange: [h.start, h.end],
          baseText: baseContent,
          currentText: curContent,
          patchText: h.lines.join('\n'),
          reason: HashlineErrorCode.CONFLICT_CONTENT_DIVERGED,
        }));
        unresolvedHunks.push(h);
        continue;
      }

      resolvedHunks.push({ ...h, start: baseStart, end: baseEnd });
    }

    // 如果有冲突，尝试部分合并（应用已 resolved 的 hunks，跳过有冲突的）
    if (conflicts.length > 0 && unresolvedHunks.length > 0) {
      // Partial merge：只应用无冲突的 hunks
      if (resolvedHunks.length > 0) {
        try {
          const partialMerged = applyHunksToTextExtended(currentText, resolvedHunks);
          return {
            merged: partialMerged,
            conflicts,
            path: filePath,
            partialMerge: true,
            unresolvedCount: unresolvedHunks.length,
          };
        } catch (err) {
          return { merged: null, conflicts, path: filePath, error: err.message };
        }
      }
      return { merged: null, conflicts, path: filePath };
    }

    // 虽然有 conflicts 但没有 unresolvedHunks（内容变化但位置可映射）：仍然应用
    if (conflicts.length > 0 && unresolvedHunks.length === 0) {
      try {
        const merged = applyHunksToTextExtended(currentText, resolvedHunks);
        return { merged, conflicts: [], path: filePath };
      } catch (err) {
        return { merged: null, conflicts, path: filePath, error: err.message };
      }
    }

    // 无冲突：应用所有 resolved hunks
    try {
      const merged = applyHunksToTextExtended(currentText, resolvedHunks);
      return { merged, conflicts, path: filePath };
    } catch (err) {
      return { merged: null, conflicts, path: filePath, error: err.message };
    }
  }

  /**
   * 计算 base → current 的行映射（真正 DP LCS + 回退模糊匹配）。
   *
   * 这一步是 diff3 merge 的核心：找出 base 中每一行在 current 中的
   * 对应位置，从而判断 patch 的锚定行是否已被其他人修改。
   *
   * 算法：
   *  1. 先按内容哈希匹配，缩小 DP 网格。
   *  2. 对哈希匹配的行序列跑 DP LCS。
   *  3. 对哈希未匹配的行，使用编辑距离模糊匹配回退。
   *
   * @private
   */
  static _computeEditMapping(baseLines, curLines) {
    const n = baseLines.length;
    const m = curLines.length;

    // ── Step 1: 内容哈希完全匹配 ──
    const curHashIndex = new Map(); // hash → [line1, line2, ...]
    for (let i = 0; i < m; i++) {
      const fp = hashContent(curLines[i]);
      if (!curHashIndex.has(fp)) { curHashIndex.set(fp, []); }
      curHashIndex.get(fp).push(i + 1);
    }

    // ── Step 2: 找出所有候选匹配对 (baseLine, curLine candidates) ──
    // 用 DP 找最长递增子序列
    const candidates = []; // [{bi, ci}]
    for (let bi = 1; bi <= n; bi++) {
      const fp = hashContent(baseLines[bi - 1]);
      const matches = curHashIndex.get(fp) || [];
      for (const ci of matches) {
        candidates.push({ bi, ci });
      }
    }

    // ── Step 3: DP LCS on candidate pairs ──
    // 按 ci 排序后找 bi 的最长递增子序列
    candidates.sort((a, b) => a.ci - b.ci || a.bi - b.bi);

    // O(k log k) LIS
    const lisTails = []; // tails[t] = 长度为 t+1 的 LIS 的末尾 bi 值
    const lisIndices = []; // 对应在 candidates 中的索引
    const prev = new Array(candidates.length).fill(-1);

    for (let k = 0; k < candidates.length; k++) {
      const { bi } = candidates[k];
      // 二分查找：找到 tails 中第一个 >= bi 的位置
      let lo = 0, hi = lisTails.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (lisTails[mid] < bi) { lo = mid + 1; }
        else { hi = mid; }
      }
      if (lo > 0) { prev[k] = lisIndices[lo - 1]; }
      if (lo === lisTails.length) {
        lisTails.push(bi);
        lisIndices.push(k);
      } else {
        lisTails[lo] = bi;
        lisIndices[lo] = k;
      }
    }

    // 回溯 LIS
    const mapping = {};
    const usedCi = new Set();
    let idx = lisIndices.length > 0 ? lisIndices[lisIndices.length - 1] : -1;
    while (idx >= 0) {
      const { bi, ci } = candidates[idx];
      mapping[bi] = ci;
      usedCi.add(ci);
      idx = prev[idx];
    }

    // ── Step 4: 回退模糊匹配 ──
    // 对未匹配的 base 行，尝试用编辑距离在未使用的 cur 行中找最近匹配
    const unmatchedBase = [];
    for (let bi = 1; bi <= n; bi++) {
      if (mapping[bi] === undefined) { unmatchedBase.push(bi); }
    }
    const unusedCur = [];
    for (let ci = 1; ci <= m; ci++) {
      if (!usedCi.has(ci)) { unusedCur.push(ci); }
    }

    for (const bi of unmatchedBase) {
      const bLine = baseLines[bi - 1].trim();
      if (bLine.length < 8) { continue; } // 太短的行不模糊匹配

      let bestCi = -1, bestDist = Infinity;
      for (const ci of unusedCur) {
        const cLine = curLines[ci - 1].trim();
        const dist = Diff3MergeEngine._editDistance(bLine, cLine);
        // 允许 20% 以内的编辑距离
        const threshold = Math.max(3, Math.floor(Math.max(bLine.length, cLine.length) * 0.2));
        if (dist <= threshold && dist < bestDist) {
          bestDist = dist;
          bestCi = ci;
        }
      }
      if (bestCi > 0) {
        mapping[bi] = bestCi;
        usedCi.add(bestCi);
        const idx = unusedCur.indexOf(bestCi);
        if (idx > -1) { unusedCur.splice(idx, 1); }
      }
    }

    return mapping;
  }

  /**
   * 计算两个字符串的 Levenshtein 编辑距离。
   * @private
   */
  static _editDistance(a, b) {
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) { return lenB; }
    if (lenB === 0) { return lenA; }

    // 使用两行 DP 节省空间
    let prev = new Array(lenB + 1);
    let cur = new Array(lenB + 1);
    for (let j = 0; j <= lenB; j++) { prev[j] = j; }

    for (let i = 1; i <= lenA; i++) {
      cur[0] = i;
      for (let j = 1; j <= lenB; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(
          prev[j] + 1,      // deletion
          cur[j - 1] + 1,   // insertion
          prev[j - 1] + cost // substitution
        );
      }
      [prev, cur] = [cur, prev];
    }
    return prev[lenB];
  }

  /**
   * 使用内容指纹在 current 中查找单行。
   * @private
   */
  static _findLineByContent(curLines, baseLine) {
    if (!baseLine) { return -1; }
    const fp = hashContent(baseLine);
    for (let i = 0; i < curLines.length; i++) {
      if (hashContent(curLines[i]) === fp) { return i + 1; }
    }
    // 宽松匹配：前缀匹配
    const trimmed = baseLine.trim();
    if (trimmed.length > 10) {
      for (let i = 0; i < curLines.length; i++) {
        if (curLines[i].trim() === trimmed) { return i + 1; }
      }
    }
    return -1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 便捷工厂
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 创建一个默认 Patcher（MemoryFilesystem + InMemorySnapshotStore）。
 * @param {object} [opts]
 * @returns {Patcher}
 */
export function createPatcher(opts = {}) {
  return new Patcher({
    fs: opts.fs || new MemoryFilesystem(),
    snapshots: opts.snapshots || new InMemorySnapshotStore(),
    autoRecord: opts.autoRecord,
    allowRecovery: opts.allowRecovery,
    bridge: opts.bridge || null,
  });
}

export default {
  hashContent,
  normalizeText,
  computeTag,
  Filesystem,
  DiskFilesystem,
  MemoryFilesystem,
  InMemorySnapshotStore,
  Section,
  Patch,
  PatchParseError,
  PatchApplyError,
  Patcher,
  parsePatch,
  serializePatch,
  applyHunksToText,
  HashlineBridge,
  createPatcher,
  OP_SWAP,
  OP_DEL,
  OP_INS_PRE,
  OP_INS_POST,
  OP_NOP,
  // 扩展
  OP_INS_HEAD,
  OP_INS_TAIL,
  OP_INS_BLK_POST,
  OP_SWAP_BLK,
  OP_DEL_BLK,
  OP_ABORT,
  parsePatchExtended,
  applyHunksToTextExtended,
  StructuredParseError,
  StructuredApplyError,
  Diff3MergeEngine,
  createDiff3Conflict,
  HashlineErrorCode,
};
