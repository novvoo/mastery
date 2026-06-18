/**
 * WorkspaceIndex - 工作目录文件索引
 *
 * 为代码任务预构建项目文件索引。
 * 索引包含：文件路径、类型、大小、行数、修改时间、
 * 头部摘要（前15行）、导出的符号名。
 *
 * 支持增量同步：启动时快速校验 mtime，
 * 只需 stat 而无需重新读取文件内容。
 *
 * 文件变化后自动 sync：定时轮询检测新增/删除/修改。
 *
 * 设计原则：
 * - 紧凑：索引远小于文件内容
 * - 持久化：磁盘缓存，重启无需重建
 * - 低开销：增量同步只 stat mtime，变动的文件才重读
 * - 自动同步：运行期间定时检查
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { resolve, join, dirname, extname, basename } from 'path';
import { glob } from 'glob';

const INDEX_VERSION = 1;

// 索引范围：与 semantic_search 对齐
const INDEX_PATTERN = '**/*.{js,mjs,cjs,ts,tsx,jsx,json,md,txt,yml,yaml,css,html}';
const INDEX_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.agent-data/**',
  '**/.automation/**',
  '**/.test-temp/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/bun.lock',
  '**/bun.lockb',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/*.min.*',
];

const MAX_HEAD_LINES = 15;        // 每个文件保留前 N 行
const MAX_HEAD_CHARS = 500;       // 头部截断
const MAX_SYMBOLS = 25;           // 最多提取 N 个符号
const MAX_FILES = 1000;           // 最大索引文件数
const CONCURRENCY = 20;           // 并发数
const SYNC_INTERVAL_MS = 25000;   // 增量同步间隔

// 文件类型 → 种类
const FILE_KINDS = {
  js: 'source', jsx: 'source', ts: 'source', tsx: 'source',
  mjs: 'source', cjs: 'source',
  css: 'style', scss: 'style', less: 'style',
  html: 'html', htm: 'html',
  md: 'doc', mdx: 'doc', txt: 'doc',
  json: 'config', yml: 'config', yaml: 'config', toml: 'config',
  test: 'test', spec: 'test',
};

function extractSymbols(text) {
  const symbols = [];
  const patterns = [
    /(?:export\s+(?:default\s+)?)?(?:function|class|interface|type|enum)\s+(\w+)/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/g,
    /module\.exports\s*=\s*(\w+)/g,
    /def\s+(\w+)/g,
    /(?:public|private|protected|static)\s+(?:function|class)\s+(\w+)/g,
    /async\s+function\s+(\w+)/g,
    /export\s+default\s+(\w+)/g,
  ];
for (const re of patterns) {
    let match;
    while ((match = re.exec(text)) !== null) {
      const name = match[1];
      if (name && name.length <= 80 && !symbols.includes(name)) {
        symbols.push(name);
      }
    }
  }
  return symbols.slice(0, MAX_SYMBOLS);
}

// 推断文件种类
function inferKind(relPath, ext) {
  const base = basename(relPath).toLowerCase();
  if (/.(test|spec).(js|ts|jsx|tsx)$/.test(relPath)) {return 'test';}
  if (/^./.test(basename(relPath))) {return 'config';}
  if (base === 'makefile' || base === 'dockerfile') {return 'config';}
  return FILE_KINDS[ext] || 'other';
}

export class WorkspaceIndex {
  #workingDir;
  #index;
  #lastSyncAt;
  #syncTimer;

  constructor(workingDir) {
    this.#workingDir = workingDir;
    this.#index = new Map();
    this.#lastSyncAt = 0;
    this.#syncTimer = null;
  }

  /** 动态计算索引目录 — 确保工作目录切换后使用新目录 */
  get #indexDir() {
    return join(this.#workingDir, '.agent-data', 'workspace-index');
  }

  /** 动态计算索引文件路径 */
  get #indexPath() {
    return join(this.#indexDir, 'index.json');
  }

  /** 动态更新工作目录。切换目录时会清空现有索引。 */
  setWorkingDirectory(workingDir) {
    if (!workingDir || typeof workingDir !== 'string') return;
    if (this.#workingDir === workingDir) return;
    this.#workingDir = workingDir;
    this.#index.clear();
    this.#lastSyncAt = 0;
  }

  // ─── 持久化 ───

  async load() {
    try {
      await mkdir(this.#indexDir, { recursive: true });
      const raw = await readFile(this.#indexPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && data.version === INDEX_VERSION && Array.isArray(data.files)) {
        for (const entry of data.files) {
          this.#index.set(entry.path, entry);
        }
        this.#lastSyncAt = data.syncedAt || Date.now();
      }
    } catch {
      // 首次运行或无缓存
    }
  }

  async save() {
    try {
      await mkdir(this.#indexDir, { recursive: true });
      const data = {
        version: INDEX_VERSION,
        syncedAt: Date.now(),
        files: Array.from(this.#index.values()),
      };
      await writeFile(this.#indexPath, JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.warn('WorkspaceIndex: save failed', err.message);
    }
  }

  /**
   * 预热索引：加载缓存 → 增量同步
   * 返回摘要文本（供注入 prompt），无文件时返回空串
   */
  async warm() {
    await this.load();

    // 如果有缓存，快速增量同步（仅 stat mtime）
    if (this.#index.size > 0) {
      const changes = await this.#incrementalSync();
      if (changes.changed > 0 || changes.removed > 0) {
        await this.save();
      }
      return this.getSummary();
    }

    // 无缓存，全量构建
    await this.#fullBuild();
    await this.save();
    return this.getSummary();
  }

  // ─── 全量构建 ───

  async #fullBuild() {
    const files = await glob(INDEX_PATTERN, {
      cwd: this.#workingDir,
      absolute: false,
      nodir: true,
      ignore: INDEX_IGNORE,
    });

    const toIndex = files.slice(0, MAX_FILES);
    this.#index.clear();

    for (let i = 0; i < toIndex.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        toIndex.slice(i, i + CONCURRENCY).map(async (relPath) => {
          try {
            return await this.#indexOne(relPath);
          } catch {
            return null;
          }
        })
      );
      for (const entry of batch) {
        if (entry) {this.#index.set(entry.path, entry);}
      }
    }

    this.#lastSyncAt = Date.now();
  }

  // ─── 增量同步 ───

  async #incrementalSync() {
    let changed = 0;
    let removed = 0;
    let added = 0;

    // 1) 检查已索引文件的 mtime
    const staleEntries = [];
    for (const [relPath, entry] of this.#index) {
      try {
        const fullPath = resolve(this.#workingDir, relPath);
        const stats = await stat(fullPath);
        if (stats.mtimeMs !== entry.mtime) {
          staleEntries.push(relPath);
        }
      } catch {
        // 文件已删除
        this.#index.delete(relPath);
        removed++;
      }
    }

    // 重新索引变动文件
    if (staleEntries.length > 0) {
      for (let i = 0; i < staleEntries.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          staleEntries.slice(i, i + CONCURRENCY).map(async (relPath) => {
            try {
              return await this.#indexOne(relPath);
            } catch {
              return null;
            }
          })
        );
        for (const entry of batch) {
          if (entry) {
            this.#index.set(entry.path, entry);
            changed++;
          }
        }
      }
    }

    // 2) 检查新增文件（快速 glob）
    try {
      const allFiles = await glob(INDEX_PATTERN, {
        cwd: this.#workingDir,
        absolute: false,
        nodir: true,
        ignore: INDEX_IGNORE,
      });

      const newFiles = allFiles.filter(f => !this.#index.has(f)).slice(0, 100);

      for (let i = 0; i < newFiles.length; i += CONCURRENCY) {
        const batch = await Promise.all(
          newFiles.slice(i, i + CONCURRENCY).map(async (relPath) => {
            try {
              return await this.#indexOne(relPath);
            } catch {
              return null;
            }
          })
        );
        for (const entry of batch) {
          if (entry) {
            this.#index.set(entry.path, entry);
            added++;
          }
        }
      }
    } catch {
      // glob 失败不阻塞
    }

    this.#lastSyncAt = Date.now();
    return { changed, removed, added };
  }

  // ─── 索引单个文件 ───

  async #indexOne(relPath) {
    const fullPath = resolve(this.#workingDir, relPath);
    const stats = await stat(fullPath);

    // 跳过过大文件
    if (stats.size > 256 * 1024) {return null;}

    const text = await readFile(fullPath, 'utf-8');

    // 跳过二进制文件
    if (text.includes('\0')) {return null;}

    const lines = text.split('\n');
    const headLines = lines.slice(0, MAX_HEAD_LINES);
    const head = headLines.join('\n').trim().substring(0, MAX_HEAD_CHARS);
    const symbols = extractSymbols(text);
    const ext = extname(relPath).replace('.', '');
    const kind = inferKind(relPath, ext);

    return {
      path: relPath,
      type: ext,
      kind,
      size: stats.size,
      lines: lines.length,
      mtime: stats.mtimeMs,
      head: head || '(empty)',
      symbols,
    };
  }

  // ─── 摘要输出 ───

  getSummary() {
    const entries = Array.from(this.#index.values());
    if (entries.length === 0) {return '';}

    // 按顶级目录统计
    const topDirs = new Map();
    for (const entry of entries) {
      const top = entry.dir ? entry.dir.split('/')[0] : '.';
      if (!topDirs.has(top)) {topDirs.set(top, []);}
      topDirs.get(top).push(entry);
    }

    const lines = [];
    lines.push('[Workspace Index: ' + entries.length + ' files]');

    for (const [dir, files] of topDirs) {
      const byKind = {};
      for (const f of files) {
        byKind[f.kind] = (byKind[f.kind] || 0) + 1;
      }
      const kinds = Object.entries(byKind)
        .map(function (kv) { return kv[1] + ' ' + kv[0]; })
        .join(', ');
      lines.push('  ' + dir + '/ (' + kinds + ')');

      // 只显示有符号的关键源文件
      const keyFiles = files
        .filter(function (f) { return f.symbols.length > 0; })
        .slice(0, 10);

      for (const f of keyFiles) {
        const syms = f.symbols.slice(0, 4).join(', ');
        lines.push(
          '    ' + f.path + ': ' + f.lines + 'L [' + syms + (f.symbols.length > 4 ? ', ...' : '') + ']'
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取指定路径的索引条目
   */
  getFileInfo(relPath) {
    return this.#index.get(relPath) || null;
  }

  get size() {
    return this.#index.size;
  }

  // ─── 运行期间自动同步 ───

  startPeriodicSync() {
    this.stopPeriodicSync();
    this.#syncTimer = setInterval(async () => {
      try {
        const changes = await this.#incrementalSync();
        if (changes.changed > 0 || changes.removed > 0 || changes.added > 0) {
          await this.save();
        }
      } catch {
        // 定时同步失败不影响主流程
      }
    }, SYNC_INTERVAL_MS);
  }

  stopPeriodicSync() {
    if (this.#syncTimer) {
      clearInterval(this.#syncTimer);
      this.#syncTimer = null;
    }
  }

  destroy() {
    this.stopPeriodicSync();
    this.#index.clear();
  }
}

export default WorkspaceIndex;
