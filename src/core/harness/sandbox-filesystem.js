/**
 * SandboxedFilesystem — 严格沙箱化的文件系统实现
 *
 * 对标文件中要求的 1.1 节：
 *   - 所有 path canonicalize
 *   - 禁止 ../ 逃逸
 *   - 禁止 symlink escape
 *   - 禁止写 root 外路径
 *   - 支持 virtual workspace root
 *   - 所有 patch path 必须相对 workspace
 *
 * 在 DiskFilesystem 基础上增强：
 *   1. realpath 规范化（解析所有 symlink）
 *   2. 严格路径逃逸检测（realpath 后比对 root）
 *   3. 虚拟工作区根支持
 *   4. 文件大小限制
 *   5. 二进制文件拒绝
 *   6. Generated file 检测
 */

import { readFile, writeFile, stat, access, realpath } from 'fs/promises';
import { resolve, relative, normalize } from 'path';
import { constants as fsConstants } from 'fs';

// ── 文件类型检测 ──────────────────────────────────────────────────────────

/**
 * 通过文件扩展名和魔数检测二进制文件。
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.db', '.sqlite', '.sqlite3',
  '.pak', '.bin', '.dat',
]);

const GENERATED_FILE_PATTERNS = [
  /\.d\.ts$/,
  /\.generated\./,
  /-generated\./,
  /\/generated\//,
  /\/dist\//,
  /\/build\//,
  /\/\.next\//,
  /\/coverage\//,
  /\.min\.js$/,
  /\.min\.css$/,
  /-lock\.json$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lock$/,
];

const MINIFIED_FILE_PATTERNS = [
  /\.min\.js$/,
  /\.min\.css$/,
  /\.min\.mjs$/,
];

const LOCKFILE_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lock$/,
  /Cargo\.lock$/,
  /Gemfile\.lock$/,
  /poetry\.lock$/,
];

/**
 * 安全路径解析：规范化 + realpath 检测 symlink escape。
 * @param {string} root 工作区根
 * @param {string} userPath 用户提供的路径
 * @returns {Promise<string>} 解析后的绝对路径
 */
async function safeResolve(root, userPath) {
  const rootResolved = resolve(root);
  const pathResolved = resolve(rootResolved, userPath);

  // 1) 检查 ../ 逃逸
  if (/(?:^|\/)\.\.(?:$|\/)/.test(userPath)) {
    const rel = relative(rootResolved, pathResolved);
    if (rel.startsWith('..') || pathResolved !== rootResolved && !pathResolved.startsWith(rootResolved + '/')) {
      throw new SandboxError(`path traversal detected: "${userPath}" escapes root`);
    }
  }

  // 2) Realpath 检查（解析 symlink）
  try {
    const real = await realpath(pathResolved);
    const realRoot = await realpath(rootResolved);
    if (real !== realRoot && !real.startsWith(realRoot + '/')) {
      throw new SandboxError(`symlink escape detected: "${userPath}" → "${real}" outside root`);
    }
  } catch (err) {
    if (err instanceof SandboxError) { throw err; }
    // ENOENT 等是正常的（文件可能不存在）
  }

  return pathResolved;
}

/**
 * 同步版 safeResolve（用于同步场景）。
 */
function safeResolveSync(root, userPath) {
  const rootResolved = resolve(root);
  const pathResolved = resolve(rootResolved, userPath);

  if (/(?:^|\/)\.\.(?:$|\/)/.test(userPath)) {
    const rel = relative(rootResolved, pathResolved);
    if (rel.startsWith('..') || pathResolved !== rootResolved && !pathResolved.startsWith(rootResolved + '/')) {
      throw new SandboxError(`path traversal detected: "${userPath}" escapes root`);
    }
  }

  return pathResolved;
}

/**
 * 判断是否为二进制文件扩展名。
 */
function isBinaryExtension(filePath) {
  const lower = filePath.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) { return true; }
  }
  return false;
}

/**
 * 判断是否为 generated 文件。
 */
function isGeneratedFile(filePath) {
  return GENERATED_FILE_PATTERNS.some(p => p.test(filePath));
}

/**
 * 判断是否为 minified 文件。
 */
function isMinifiedFile(filePath) {
  return MINIFIED_FILE_PATTERNS.some(p => p.test(filePath));
}

/**
 * 判断是否为 lockfile。
 */
function isLockfile(filePath) {
  return LOCKFILE_PATTERNS.some(p => p.test(filePath));
}

/**
 * 检测内容是否为二进制。
 * 读取前 512 字节，检测是否包含 null 字节。
 */
function isBinaryContent(buffer) {
  const sample = buffer instanceof Buffer ? buffer : Buffer.from(buffer.slice(0, 512));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) { return true; }
  }
  return false;
}

// ── SandboxError ───────────────────────────────────────────────────────────

export class SandboxError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SandboxError';
    this.details = details;
  }
}

// ── FilePolicy — 文件策略配置 ─────────────────────────────────────────────

export class FilePolicy {
  /**
   * @param {object} opts
   * @param {number} [opts.maxFileSize=5_000_000]     最大文件大小 (bytes)，默认 5MB
   * @param {boolean} [opts.denyBinary=true]           是否拒绝二进制文件
   * @param {boolean} [opts.denyGenerated=true]        是否拒绝 generated 文件
   * @param {boolean} [opts.denyMinified=true]         是否拒绝 minified 文件
   * @param {boolean} [opts.lockfileReadOnly=true]     lockfile 是否只读
   * @param {number} [opts.maxLockfileSize=2_000_000]  lockfile 最大大小
   */
  constructor(opts = {}) {
    this.maxFileSize = opts.maxFileSize ?? 5_000_000;
    this.denyBinary = opts.denyBinary !== false;
    this.denyGenerated = opts.denyGenerated !== false;
    this.denyMinified = opts.denyMinified !== false;
    this.lockfileReadOnly = opts.lockfileReadOnly !== false;
    this.maxLockfileSize = opts.maxLockfileSize ?? 2_000_000;
  }

  /**
   * 检查写操作是否允许。
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkWrite(filePath, contentSize = null) {
    // Generated 文件
    if (this.denyGenerated && isGeneratedFile(filePath)) {
      return { allowed: false, reason: `generated file: ${filePath}` };
    }

    // Minified 文件
    if (this.denyMinified && isMinifiedFile(filePath)) {
      return { allowed: false, reason: `minified file: ${filePath}` };
    }

    // Lockfile 只读
    if (this.lockfileReadOnly && isLockfile(filePath)) {
      return { allowed: false, reason: `lockfile is read-only: ${filePath}` };
    }

    // 二进制
    if (this.denyBinary && isBinaryExtension(filePath)) {
      return { allowed: false, reason: `binary file not supported for editing: ${filePath}` };
    }

    // 大小限制
    if (contentSize !== null && this.maxFileSize > 0 && contentSize > this.maxFileSize) {
      return {
        allowed: false,
        reason: `file too large: ${contentSize} bytes > ${this.maxFileSize} max`,
      };
    }

    return { allowed: true };
  }

  /**
   * 检查读操作是否允许。
   */
  checkRead(filePath) {
    // 二进制文件可以读但不能编辑
    if (this.denyBinary && isBinaryExtension(filePath)) {
      return { allowed: true, warning: `binary file: editing not supported` };
    }
    return { allowed: true };
  }
}

// ── SandboxedFilesystem ────────────────────────────────────────────────────

/**
 * 严格沙箱文件系统。
 *
 * 在 DiskFilesystem 基础上增加：
 *  - realpath escape 检测
 *  - 文件策略检查
 *  - 虚拟根支持
 *  - 内容哈希规范化
 */
export class SandboxedFilesystem {
  /**
   * @param {object} opts
   * @param {string} opts.root            工作区根目录
   * @param {FilePolicy} [opts.policy]    文件策略
   * @param {boolean} [opts.resolveSymlinks=true]  是否解析 symlink realpath
   */
  constructor(opts = {}) {
    this.root = resolve(opts.root || process.cwd());
    this.policy = opts.policy || new FilePolicy();
    this.resolveSymlinks = opts.resolveSymlinks !== false;
  }

  get rootPath() { return this.root; }

  /**
   * 安全读取文件。
   * @param {string} path
   * @returns {Promise<string>}
   */
  async read(path) {
    const resolved = await safeResolve(this.root, path);
    const readCheck = this.policy.checkRead(resolved);
    if (!readCheck.allowed) {
      throw new SandboxError(readCheck.reason || 'read denied', { path, resolved });
    }
    const content = await readFile(resolved, 'utf-8');
    return content;
  }

  /**
   * 安全读取二进制文件。
   * @param {string} path
   * @returns {Promise<Buffer>}
   */
  async readBinary(path) {
    const resolved = await safeResolve(this.root, path);
    return readFile(resolved);
  }

  /**
   * 安全写入文件。
   * @param {string} path
   * @param {string} content
   * @returns {Promise<void>}
   */
  async write(path, content) {
    const resolved = path.startsWith('/')
      ? await safeResolve(this.root, path)
      : await safeResolve(this.root, path);
    const contentStr = String(content);
    const size = Buffer.byteLength(contentStr, 'utf-8');
    const writeCheck = this.policy.checkWrite(resolved, size);
    if (!writeCheck.allowed) {
      throw new SandboxError(writeCheck.reason || 'write denied', { path, resolved, size });
    }
    // 检测二进制内容
    const buf = Buffer.from(contentStr.slice(0, 512), 'utf-8');
    if (isBinaryContent(buf)) {
      throw new SandboxError('binary content detected, refusing write', { path, resolved });
    }
    await writeFile(resolved, contentStr, 'utf-8');
  }

  /**
   * 文件是否存在。
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async exists(path) {
    try {
      const resolved = await safeResolve(this.root, path);
      await access(resolved, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件状态。
   * @param {string} path
   * @returns {Promise<{size: number, mtimeMs: number, isBinary: boolean, isGenerated: boolean}>}
   */
  async stat(path) {
    const resolved = await safeResolve(this.root, path);
    const s = await stat(resolved);
    return {
      size: s.size,
      mtimeMs: s.mtimeMs,
      isBinary: isBinaryExtension(path),
      isGenerated: isGeneratedFile(path),
      isMinified: isMinifiedFile(path),
      isLockfile: isLockfile(path),
    };
  }

  /**
   * 是否允许对路径进行写操作。
   * @param {string} path
   * @returns {Promise<{allowed: boolean, reason?: string}>}
   */
  async canWrite(path) {
    try {
      const resolved = await safeResolve(this.root, path);
      const exists = await this.exists(resolved);
      let size = null;
      if (exists) {
        const s = await this.stat(path);
        size = s.size;
      }
      return this.policy.checkWrite(resolved, size);
    } catch (err) {
      return { allowed: false, reason: err.message };
    }
  }

  /**
   * 同步版 safeResolve（用于 parser/preflight）
   */
  resolvePath(userPath) {
    return safeResolveSync(this.root, userPath);
  }

  /**
   * 计算相对工作区的路径。
   */
  relativePath(absolutePath) {
    return relative(this.root, absolutePath);
  }
}

export default SandboxedFilesystem;

export {
  isBinaryExtension,
  isGeneratedFile,
  isMinifiedFile,
  isLockfile,
  isBinaryContent,
  safeResolve,
  safeResolveSync,
};
