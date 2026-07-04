/**
 * Storage seam for the hashline patcher. `Filesystem` is intentionally minimal
 * — `readText`, `writeText`, `exists` — so any backing store can be adapted:
 * disk, memory, S3, an LSP text-document protocol, a Git tree, a VFS, etc.
 *
 * The patcher does its own BOM stripping and LF normalization between
 * `Filesystem.readText` and `Filesystem.writeText`; the FS deals only in raw
 * text strings.
 * Uses `node:fs/promises`
 * directly instead of `Bun.file`/`Bun.write` so the module is portable.
 */

import * as fs from 'node:fs/promises';
import { constants as fsConstants, existsSync, lstatSync, readlinkSync } from 'node:fs';
import * as pathModule from 'node:path';

/**
 * Result returned by `Filesystem.writeText`. The patcher echoes back `text`
 * so adapters that transform on serialization (e.g. notebooks) can report
 * what actually landed on disk.
 *
 * @typedef {Object} WriteResult
 * @property {string} text Final text that was persisted. May differ from the input if the FS transformed it.
 */

/**
 * Optional hints for `Filesystem.preflightWrite`.
 *
 * @typedef {Object} PreflightWriteOptions
 * @property {import("./types.js").FileOp} [fileOp]
 */

/**
 * ENOENT-like error thrown by `Filesystem.readText` when a path is missing.
 * Carrying a `code` property keeps the contract compatible with `node:fs`
 * callers that already check `err.code === "ENOENT"`.
 */
export class NotFoundError extends Error {
  code = 'ENOENT';

  constructor(path, cause) {
    super(`File not found: ${path}`);
    this.name = 'NotFoundError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** Type guard for `NotFoundError` and structurally-compatible errors. */
export function isNotFound(error) {
  if (error instanceof NotFoundError) return true;
  if (error instanceof Error && error.code === 'ENOENT') return true;
  return false;
}

/**
 * Abstract storage backend the `Patcher` reads from and writes to. Subclass
 * for new backends; the package ships `InMemoryFilesystem` and `NodeFilesystem`
 * for the most common cases.
 */
export class Filesystem {
  /** Read the file's full text content. Throw on missing file. */
  async readText(_path) {
    throw new Error('Filesystem.readText() not implemented');
  }

  /** Read raw bytes for backends whose text is a direct decode of persisted bytes. */
  async readBinary(_path) {
    return undefined;
  }

  /** Validate that `path` is writable before a prepared batch starts committing. */
  async preflightWrite(_path, _options) {}

  /** Persist `content` at `path`. Returns the actual final text that was written. */
  async writeText(_path, _content) {
    throw new Error('Filesystem.writeText() not implemented');
  }

  /** Delete the file at `path`. Default: not supported. */
  async delete(path) {
    throw new Error(`Filesystem does not support delete: ${path}`);
  }

  /**
   * Move/rename `from` to `to`. When `content` is provided the destination
   * receives that text; otherwise implementations may preserve the source bytes.
   */
  async move(from, to, content) {
    throw new Error(`Filesystem does not support move: ${from} -> ${to}`);
  }

  /** Return true when the path exists and can be read. Default: probe via `readText`. */
  async exists(path) {
    try {
      await this.readText(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Canonical path used as a key by external caches (e.g. snapshot stores).
   * The default is identity; override to return an absolute or otherwise
   * canonicalised path.
   */
  canonicalPath(path) {
    return path;
  }

  /**
   * Whether a section whose authored path is missing may be redirected to the
   * file its snapshot tag names (tag-based path recovery in `Patcher.prepare`).
   * Default: allow.
   */
  allowTagPathRecovery(_authoredPath, _resolvedPath) {
    return true;
  }

  // ── Legacy API aliases ──────────────────────────────────────────────────
  // Back-compat shims so callers using the older `read` / `write` / `stat` /
  // `rename` method names keep working without changes.

  async read(path) {
    return this.readText(path);
  }

  async write(path, content) {
    return this.writeText(path, content);
  }

  async stat(path) {
    const text = await this.readText(path);
    return { size: Buffer.byteLength(text), mtimeMs: Date.now() };
  }

  async rename(from, to) {
    return this.move(from, to);
  }
}

/**
 * In-memory `Filesystem`. Useful for tests, sandboxes, dry-runs, and as a
 * building block for stacked adapters.
 */
export class InMemoryFilesystem extends Filesystem {
  #files = new Map();

  constructor(initial) {
    super();
    if (initial) {
      const entries =
        initial instanceof Map || typeof initial[Symbol.iterator] === 'function'
          ? initial
          : Object.entries(initial);
      for (const [path, content] of entries) this.#files.set(path, String(content));
    }
  }

  async readText(path) {
    const text = this.#files.get(path);
    if (text === undefined) throw new NotFoundError(path);
    return text;
  }

  async writeText(path, content) {
    const text = String(content);
    this.#files.set(path, text);
    return { text };
  }

  async delete(path) {
    if (!this.#files.delete(path)) throw new NotFoundError(path);
  }

  async move(from, to, content) {
    const existing = this.#files.get(from);
    if (existing === undefined) throw new NotFoundError(from);
    const finalContent = content ?? existing;
    this.#files.set(to, finalContent);
    this.#files.delete(from);
  }

  async exists(path) {
    return this.#files.has(path);
  }

  async read(path) {
    return this.readText(path);
  }

  async write(path, content) {
    await this.writeText(path, content);
  }

  async stat(path) {
    const text = await this.readText(path);
    return { size: Buffer.byteLength(text), mtimeMs: Date.now() };
  }

  async rename(from, to) {
    await this.move(from, to);
  }

  /** Synchronous helper for setting up fixtures without awaiting. */
  set(path, content) {
    this.#files.set(path, content);
  }

  /** Synchronous helper for inspecting state without awaiting. */
  get(path) {
    return this.#files.get(path);
  }

  /** Wipe all entries. */
  clear() {
    this.#files.clear();
  }

  /** Iterate `[path, content]` pairs. */
  entries() {
    return this.#files.entries();
  }

  snapshot() {
    return Object.fromEntries(this.#files);
  }
}

/**
 * Disk-backed `Filesystem` using `node:fs/promises`. The default for CLI use.
 * Paths are accepted as-is; callers responsible for any cwd or jail/sandbox
 * resolution should wrap this with their own subclass.
 */
export class NodeFilesystem extends Filesystem {
  async readText(path) {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundError(path, error);
      throw error;
    }
  }

  async readBinary(path) {
    try {
      return await fs.readFile(path);
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundError(path, error);
      throw error;
    }
  }

  async writeText(path, content) {
    await fs.writeFile(path, content, 'utf-8');
    return { text: content };
  }

  async delete(path) {
    try {
      await fs.rm(path);
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundError(path, error);
      throw error;
    }
  }

  async move(from, to, content) {
    if (content !== undefined) {
      await fs.writeFile(to, content, 'utf-8');
      await this.delete(from);
      return;
    }
    try {
      await fs.rename(from, to);
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundError(from, error);
      throw error;
    }
  }

  canonicalPath(path) {
    return pathModule.resolve(path);
  }

  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Disk filesystem rooted at a workspace directory. Public hashline paths stay
 * workspace-relative, while all disk I/O is resolved under `rootDir` with path
 * traversal and symlink escape checks.
 */
export class RootedNodeFilesystem extends NodeFilesystem {
  constructor(rootDir = '.') {
    super();
    this.rootDir = rootDir;
    this._realpathCache = new Map();
  }

  async readText(path) {
    return super.readText(this._resolve(path));
  }

  async readBinary(path) {
    return super.readBinary(this._resolve(path));
  }

  async writeText(path, content) {
    return super.writeText(this._resolve(path), content);
  }

  async delete(path) {
    return super.delete(this._resolve(path));
  }

  async move(from, to, content) {
    return super.move(this._resolve(from), this._resolve(to), content);
  }

  async exists(path) {
    try {
      await fs.access(this._resolve(path), fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path) {
    const s = await fs.stat(this._resolve(path));
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  async read(path) {
    return this.readText(path);
  }

  async write(path, content) {
    await this.writeText(path, content);
  }

  async rename(from, to) {
    await this.move(from, to);
  }

  canonicalPath(path) {
    return path;
  }

  _resolve(path) {
    const root = pathModule.resolve(this.rootDir || '.');
    const resolved = pathModule.resolve(root, path || '.');
    const isInside =
      resolved === root ||
      resolved.startsWith(root + pathModule.sep) ||
      resolved.startsWith(root + '/');
    if (!isInside) {
      throw new Error(`path escapes root directory: "${path}" -> "${resolved}"`);
    }

    const rootReal = this._getRealpath(root);
    const checkReal = (candidate, label) => {
      const real = this._getRealpath(candidate);
      const realInside = real === rootReal || real.startsWith(rootReal + pathModule.sep);
      if (!realInside) {
        throw new Error(
          `symlink escape detected: "${label}" resolves to "${real}" outside root "${rootReal}"`,
        );
      }
    };

    if (existsSync(resolved)) {
      checkReal(resolved, path);
      return resolved;
    }

    let parent = pathModule.dirname(resolved);
    while (parent && parent !== root && parent !== pathModule.dirname(parent)) {
      if (existsSync(parent)) checkReal(parent, parent);
      parent = pathModule.dirname(parent);
    }
    return resolved;
  }

  _getRealpath(target) {
    if (this._realpathCache.has(target)) return this._realpathCache.get(target);
    let current = target;
    try {
      if (existsSync(current)) {
        while (lstatSync(current).isSymbolicLink()) {
          const linkTarget = readlinkSync(current);
          current = pathModule.resolve(pathModule.dirname(current), linkTarget);
        }
      }
    } catch {
      current = target;
    }
    this._realpathCache.set(target, current);
    return current;
  }
}
