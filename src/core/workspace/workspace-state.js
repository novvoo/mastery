/**
 * WorkspaceState - 工作区状态追踪器
 *
 * 核心功能：
 * - 追踪文件/目录的存在性和内容
 * - 存储从工具调用中学到的关键事实
 * - 支持基于已有观察推断操作结果
 * - 在上下文裁剪时保留关键信息
 */

const MAX_DIRECTORY_ENTRIES = 500;
const MAX_FACTS = 200;
const MAX_FAILED_PATHS = 100;
const MAX_SNAPSHOT_FILES = 30; // 最多缓存多少个文件的内容
const MAX_SNAPSHOT_BYTES_PER_FILE = 64 * 1024; // 每个文件的缓存上限
const MAX_AGGREGATE_CHARS = 4000; // 聚合摘要时的字符上限

export class WorkspaceState {
  constructor() {
    // 目录结构追踪: path -> { exists, entries: Set, timestamp }
    this._directories = new Map();

    // 文件存在性追踪: path -> { exists, size?, timestamp }
    this._files = new Map();

    // 关键事实: { type, value, source, timestamp }
    this._facts = [];

    // 失败的路径尝试: path -> error message
    this._failedPaths = new Map();

    // Shell 命令结果: 用于推断环境状态
    this._shellKnowledge = [];

    // 文件内容快照: 规范化路径 -> { content, size, updatedAt, truncated, source }
    this._fileSnapshots = new Map();
    // 最近引用: 规范化路径 -> { timestamp, count, refs: [...] }
    this._recentReferences = new Map();
  }

  // ============ 目录追踪 ============

  /**
   * 记录目录探索结果
   * @param {string} dirPath - 目录路径
   * @param {string[]} entries - 目录内容
   * @param {string} source - 来源 (list_dir, glob 等)
   */
  recordDirectoryListing(dirPath, entries, source = 'list_dir') {
    const normalized = this._normalizePath(dirPath);

    this._directories.set(normalized, {
      exists: true,
      entries: new Set(entries.map((e) => this._normalizePath(e))),
      timestamp: Date.now(),
      source,
    });

    // 从条目中推断文件存在性
    for (const entry of entries) {
      const entryPath =
        entry.startsWith('/') || entry.startsWith('.')
          ? entry
          : `${normalized}/${entry}`.replace(/\/+/g, '/');
      this._markPathExists(entryPath);
    }

    this._addFact({
      type: 'directory_listing',
      value: { path: normalized, entries: entries.length },
      source,
      priority: 'medium',
    });
  }

  /**
   * 记录 glob 搜索结果
   * @param {string} pattern - glob 模式
   * @param {string[]} matches - 匹配的文件
   */
  recordGlobResults(pattern, matches) {
    this._addFact({
      type: 'glob_search',
      value: { pattern, count: matches.length, examples: matches.slice(0, 5) },
      source: 'glob',
      priority: 'medium',
    });

    // 标记所有匹配的文件存在
    for (const match of matches) {
      this._markPathExists(match);
    }
  }

  // ============ 文件追踪 ============

  /**
   * 标记路径存在
   */
  _markPathExists(path) {
    const normalized = this._normalizePath(path);

    if (normalized.endsWith('/')) {
      if (!this._directories.has(normalized)) {
        this._directories.set(normalized, {
          exists: true,
          entries: new Set(),
          timestamp: Date.now(),
          source: 'inferred',
        });
      }
    } else {
      if (!this._files.has(normalized)) {
        this._files.set(normalized, {
          exists: true,
          timestamp: Date.now(),
          source: 'inferred',
        });
      }
    }
  }

  /**
   * 记录文件读取结果
   * @param {string} filePath - 文件路径
   * @param {boolean} success - 是否成功
   * @param {object} result - 读取结果或错误信息
   */
  recordFileRead(filePath, success, result) {
    const normalized = this._normalizePath(filePath);

    if (success) {
      this._files.set(normalized, {
        exists: true,
        timestamp: Date.now(),
        source: 'read_file',
      });

      this._addFact({
        type: 'file_readable',
        value: { path: normalized },
        source: 'read_file',
        priority: 'high',
      });

      // 可选地缓存文件内容（如果结果里带 text/content 字段）
      const text = result?.text ?? result?.content ?? result?.data ?? null;
      if (typeof text === 'string' && text.length > 0) {
        this._cacheFileContent(normalized, text, 'read_file');
      }
    } else {
      this.recordPathNotFound(filePath, result?.error || 'File not found');
    }
  }

  /** 缓存一个文件的内容快照（用于多文件上下文聚合） */
  _cacheFileContent(normalizedPath, content, source = 'manual') {
    const truncated = content.length > MAX_SNAPSHOT_BYTES_PER_FILE;
    const text = truncated ? content.slice(0, MAX_SNAPSHOT_BYTES_PER_FILE) : content;

    // LRU 淘汰：超过上限时删除时间戳最旧的项
    if (
      !this._fileSnapshots.has(normalizedPath) &&
      this._fileSnapshots.size >= MAX_SNAPSHOT_FILES
    ) {
      let oldestKey = null;
      let oldestTs = Infinity;
      for (const [k, v] of this._fileSnapshots) {
        if (v.updatedAt < oldestTs) {
          oldestTs = v.updatedAt;
          oldestKey = k;
        }
      }
      if (oldestKey != null) {
        this._fileSnapshots.delete(oldestKey);
      }
    }

    this._fileSnapshots.set(normalizedPath, {
      content: text,
      size: text.length,
      originalSize: content.length,
      updatedAt: Date.now(),
      truncated,
      source,
    });
  }

  /** 外部写入文件后同步更新快照（避免重复读磁盘） */
  setFileSnapshot(filePath, content, source = 'write_file') {
    if (typeof content !== 'string') {
      return;
    }
    const normalized = this._normalizePath(filePath);
    this._files.set(normalized, { exists: true, timestamp: Date.now(), source });
    this._cacheFileContent(normalized, content, source);
  }

  /** 获取一个已缓存的文件内容快照（不读磁盘） */
  getFileSnapshot(filePath) {
    const normalized = this._normalizePath(filePath);
    const snap = this._fileSnapshots.get(normalized);
    return snap ? { ...snap } : null;
  }

  listSnapshots() {
    return Array.from(this._fileSnapshots.entries()).map(([p, v]) => ({
      path: p,
      size: v.size,
      originalSize: v.originalSize,
      updatedAt: v.updatedAt,
      truncated: v.truncated,
    }));
  }

  /** 记录一次"引用"：用户或 Agent 提到某个路径（用于最近文件排序） */
  recordReference(filePath, context = 'mention') {
    if (!filePath) {
      return;
    }
    const normalized = this._normalizePath(filePath);
    const existing = this._recentReferences.get(normalized) || { count: 0, refs: [], _order: 0 };
    existing.count++;
    existing.refs.push({ timestamp: Date.now(), context });
    if (existing.refs.length > 20) {
      existing.refs = existing.refs.slice(-20);
    }
    existing.timestamp = Date.now();
    existing._order = this._referenceOrderCounter = (this._referenceOrderCounter || 0) + 1;
    this._recentReferences.set(normalized, existing);
  }

  /** 返回最近引用的文件列表（按引用时间倒序） */
  getRecentlyReferenced(limit = 10) {
    return Array.from(this._recentReferences.entries())
      .sort((a, b) => {
        const ts = (b[1].timestamp || 0) - (a[1].timestamp || 0);
        if (ts !== 0) {
          return ts;
        }
        return (b[1]._order || 0) - (a[1]._order || 0);
      })
      .slice(0, limit)
      .map(([p, v]) => ({ path: p, count: v.count, lastReferencedAt: v.timestamp }));
  }

  /**
   * 记录路径不存在
   * @param {string} path - 路径
   * @param {string} reason - 原因
   */
  recordPathNotFound(path, reason) {
    const normalized = this._normalizePath(path);

    // 移除可能存在的存在记录
    this._files.delete(normalized);
    this._directories.delete(normalized);

    this._failedPaths.set(normalized, {
      reason: reason || 'Not found',
      timestamp: Date.now(),
    });

    this._addFact({
      type: 'path_not_found',
      value: { path: normalized, reason },
      source: 'error',
      priority: 'high',
    });
  }

  /**
   * 记录文件写入成功
   * @param {string} filePath - 文件路径
   */
  recordFileWrite(filePath) {
    const normalized = this._normalizePath(filePath);

    this._files.set(normalized, {
      exists: true,
      timestamp: Date.now(),
      source: 'write_file',
    });

    // 从 failedPaths 中移除（如果之前存在）
    this._failedPaths.delete(normalized);

    this._addFact({
      type: 'file_created',
      value: { path: normalized },
      source: 'write_file',
      priority: 'high',
    });
  }

  // ============ 关键事实管理 ============

  /**
   * 添加关键事实
   */
  _addFact(fact) {
    // 去重：检查是否有相同类型和值的事实
    const isDuplicate = this._facts.some(
      (f) => f.type === fact.type && JSON.stringify(f.value) === JSON.stringify(fact.value),
    );

    if (!isDuplicate) {
      this._facts.push({
        ...fact,
        timestamp: Date.now(),
      });

      // 限制大小
      if (this._facts.length > MAX_FACTS) {
        // 保留高优先级的事实
        this._facts.sort((a, b) => {
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
        this._facts = this._facts.slice(0, MAX_FACTS);
      }
    }
  }

  /**
   * 添加通用的关键事实
   * @param {string} type - 事实类型
   * @param {string} content - 事实内容
   * @param {string} priority - 优先级
   */
  addFact(type, content, priority = 'medium') {
    this._addFact({ type, value: content, source: 'manual', priority });
  }

  // ============ 查询接口 ============

  /**
   * 检查路径是否已知存在
   * @param {string} path - 路径
   * @returns {'exists' | 'not_found' | 'unknown'}
   */
  checkPathExists(path) {
    const normalized = this._normalizePath(path);

    if (this._files.has(normalized) || this._directories.has(normalized)) {
      return 'exists';
    }

    if (this._failedPaths.has(normalized)) {
      return 'not_found';
    }

    return 'unknown';
  }

  /**
   * 检查目录是否包含某个条目
   * @param {string} dirPath - 目录路径
   * @param {string} entryName - 条目名称
   * @returns {boolean | null} null 表示未知
   */
  directoryHasEntry(dirPath, entryName) {
    const normalized = this._normalizePath(dirPath);
    const dir = this._directories.get(normalized);

    if (!dir) {
      return null;
    }

    // 检查直接匹配
    const entryPath = this._normalizePath(`${dirPath}/${entryName}`);
    if (dir.entries.has(entryPath) || dir.entries.has(entryName)) {
      return true;
    }

    // 检查是否在 failedPaths 中
    if (this._failedPaths.has(entryPath)) {
      return false;
    }

    return null;
  }

  /**
   * 获取路径不存在的原因
   */
  getPathNotFoundReason(path) {
    const normalized = this._normalizePath(path);
    const failed = this._failedPaths.get(normalized);
    return failed ? failed.reason : null;
  }

  /**
   * 查询相关的已知事实
   * @param {string} query - 查询关键词
   * @param {number} limit - 返回数量限制
   */
  queryFacts(query, limit = 10) {
    const lowerQuery = query.toLowerCase();

    const results = this._facts
      .filter((fact) => {
        const valueStr = JSON.stringify(fact.value).toLowerCase();
        return valueStr.includes(lowerQuery) || fact.type.includes(lowerQuery);
      })
      .slice(-limit);

    return results;
  }

  /**
   * 获取高优先级的关键事实
   */
  getCriticalFacts() {
    return this._facts.filter((f) => f.priority === 'high').slice(-20);
  }

  // ============ 推理接口 ============

  /**
   * 预测工具调用结果（用于去重和优化）
   * @param {string} toolName - 工具名称
   * @param {object} args - 工具参数
   * @returns {{ canSkip: boolean, reason: string, predicted: any }}
   */
  predictToolResult(toolName, args) {
    switch (toolName) {
      case 'read_file':
      case 'file_read': {
        const path = args?.path || args?.file_path || args?.file;
        if (!path) {
          break;
        }

        const exists = this.checkPathExists(path);
        if (exists === 'not_found') {
          return {
            canSkip: true,
            reason: `Path "${path}" was previously checked and does not exist`,
            predicted: { error: this.getPathNotFoundReason(path) || 'File not found' },
            type: 'will_fail',
          };
        }
        if (exists === 'exists') {
          return {
            canSkip: false,
            reason: `Path "${path}" exists, need to read actual content`,
            predicted: null,
            type: 'will_succeed',
          };
        }
        break;
      }

      case 'list_dir': {
        const path = args?.path || args?.dir || args?.directory;
        if (!path) {
          break;
        }

        const exists = this.checkPathExists(path);
        if (exists === 'not_found') {
          return {
            canSkip: true,
            reason: `Directory "${path}" was previously checked and does not exist`,
            predicted: { error: this.getPathNotFoundReason(path) || 'Directory not found' },
            type: 'will_fail',
          };
        }
        if (exists === 'exists') {
          return {
            canSkip: false,
            reason: `Directory "${path}" exists, need to get current listing`,
            predicted: null,
            type: 'will_succeed',
          };
        }
        break;
      }

      case 'shell': {
        const command = args?.command || args?.input || '';

        // 检查是否在失败路径中尝试访问文件
        const pathMatch = command.match(/(?:cat|read|head|tail|ls)\s+([^\s;>&]+)/);
        if (pathMatch) {
          const filePath = pathMatch[1].replace(/^['"]|['"]$/g, '');
          const exists = this.checkPathExists(filePath);
          if (exists === 'not_found') {
            return {
              canSkip: true,
              reason: `File "${filePath}" in command was previously checked and does not exist`,
              predicted: { error: `cat: ${filePath}: No such file or directory` },
              type: 'will_fail',
            };
          }
        }
        break;
      }
    }

    return {
      canSkip: false,
      reason: 'Cannot predict outcome based on current state',
      predicted: null,
      type: 'unknown',
    };
  }

  // ============ 状态管理 ============

  /**
   * 多文件上下文聚合：以"最近读/写 + 最近引用"的顺序，将若干文件的关键
   * 片段拼装成一个紧凑的文本块，供 LLM 作为工作区上下文。
   * @param {object} opts
   * @param {number} [opts.maxFiles=8] - 最多包含多少个文件
   * @param {number} [opts.maxCharsPerFile=600] - 每个文件最多截取多少字符（头部）
   * @param {number} [opts.maxTotalChars=MAX_AGGREGATE_CHARS]
   * @param {string[]} [opts.hintPaths=[]] - 额外提示用户关注的路径，优先
   */
  aggregateContext(opts = {}) {
    const maxFiles = opts.maxFiles || 8;
    const maxCharsPerFile = opts.maxCharsPerFile || 600;
    const maxTotalChars = opts.maxTotalChars || MAX_AGGREGATE_CHARS;
    const hintPaths = (opts.hintPaths || []).filter(Boolean).map((p) => this._normalizePath(p));

    const seen = new Set();
    const pickPath = (p) => {
      if (!p || seen.has(p)) {
        return false;
      }
      seen.add(p);
      return true;
    };

    const ordered = [];
    // 1. 提示路径（如果已缓存）
    for (const p of hintPaths) {
      if (this._fileSnapshots.has(p) && pickPath(p)) {
        ordered.push(p);
      }
    }
    // 2. 按快照时间倒序（最近写入/读取优先）
    const bySnapshot = Array.from(this._fileSnapshots.keys()).sort((a, b) => {
      const ta = this._fileSnapshots.get(a)?.updatedAt || 0;
      const tb = this._fileSnapshots.get(b)?.updatedAt || 0;
      return tb - ta;
    });
    for (const p of bySnapshot) {
      if (pickPath(p)) {
        ordered.push(p);
      }
    }
    // 3. 最近引用的路径
    for (const item of this.getRecentlyReferenced(maxFiles)) {
      if (pickPath(item.path)) {
        ordered.push(item.path);
      }
    }

    const blocks = [];
    let totalChars = 0;
    for (const p of ordered) {
      if (blocks.length >= maxFiles) {
        break;
      }
      const snap = this._fileSnapshots.get(p);
      if (!snap) {
        // 没有快照：只记录路径与是否已知存在
        blocks.push(`- ${p}${this._files.has(p) ? ' (known file)' : ''}`);
        continue;
      }
      const head = snap.content.slice(0, maxCharsPerFile);
      const truncated = snap.content.length > head.length;
      const block = `## ${p}${snap.truncated || truncated ? ' (truncated)' : ''}\n${head}${truncated ? '\n...' : ''}`;
      if (totalChars + block.length > maxTotalChars) {
        const remaining = Math.max(0, maxTotalChars - totalChars - 32);
        if (remaining > 32) {
          blocks.push(`## ${p} (truncated)\n${snap.content.slice(0, remaining)}\n...`);
        }
        break;
      }
      totalChars += block.length;
      blocks.push(block);
    }

    return {
      files: ordered,
      totalChars,
      summary: blocks.length
        ? `# Workspace context (${ordered.length} files)\n${blocks.join('\n\n')}`
        : '',
    };
  }

  /**
   * 清除所有状态
   */
  clear() {
    this._directories.clear();
    this._files.clear();
    this._facts = [];
    this._failedPaths.clear();
    this._shellKnowledge = [];
    this._fileSnapshots.clear();
    this._recentReferences.clear();
  }

  /**
   * 获取状态摘要（用于调试和显示）
   */
  getSummary() {
    return {
      trackedFiles: this._files.size,
      trackedDirectories: this._directories.size,
      knownNotFound: this._failedPaths.size,
      facts: this._facts.length,
      snapshots: this._fileSnapshots.size,
      recentReferences: this._recentReferences.size,
      recentFacts: this._facts.slice(-5).map((f) => ({
        type: f.type,
        value: typeof f.value === 'object' ? JSON.stringify(f.value).slice(0, 100) : f.value,
      })),
    };
  }

  /**
   * 导出状态（用于序列化）
   */
  export() {
    return {
      directories: Array.from(this._directories.entries()).map(([path, data]) => ({
        path,
        ...data,
        entries: Array.from(data.entries),
      })),
      files: Array.from(this._files.entries()),
      facts: this._facts,
      failedPaths: Array.from(this._failedPaths.entries()).map(([path, data]) => ({
        path,
        ...data,
      })),
    };
  }

  /**
   * 导入状态
   */
  import(state) {
    if (state.directories) {
      for (const dir of state.directories) {
        this._directories.set(dir.path, {
          ...dir,
          entries: new Set(dir.entries),
        });
      }
    }

    if (state.files) {
      for (const [path, data] of state.files) {
        this._files.set(path, data);
      }
    }

    if (state.facts) {
      this._facts = state.facts;
    }

    if (state.failedPaths) {
      for (const fp of state.failedPaths) {
        this._failedPaths.set(fp.path, fp);
      }
    }
  }

  /**
   * 路径规范化
   */
  _normalizePath(path) {
    if (!path) {
      return '';
    }
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }
}

export default WorkspaceState;
