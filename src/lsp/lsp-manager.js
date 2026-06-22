/**
 * LSP Server Manager — 管理多个语言服务器的生命周期。
 *
 * 职责：
 *  - 按语言自动创建/复用 LSPClient 实例
 *  - 文档同步（didOpen / didChange / didClose）
 *  - 读写锁（防止请求与文档变更交错）
 *  - 健康检查与自动重启
 *  - Language -> ServerConfig 映射
 */

import { LSPClient, LSPClientError } from './lsp-client.js';
import { accessSync, constants as fsConstants } from 'fs';
import { spawnSync } from 'child_process';

// ── 语言检测 ──────────────────────────────────────────────────────────────

const EXT_TO_LANGUAGE = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.json': 'json',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
};

/**
 * 根据文件路径检测语言 ID。
 */
export function detectLanguage(filePath) {
  for (const [ext, lang] of Object.entries(EXT_TO_LANGUAGE)) {
    if (filePath.endsWith(ext)) { return lang; }
  }
  // 检查双扩展名
  const parts = filePath.split('.');
  if (parts.length >= 2) {
    const lastTwo = '.' + parts.slice(-2).join('.');
    for (const [ext, lang] of Object.entries(EXT_TO_LANGUAGE)) {
      if (lastTwo.endsWith(ext)) { return lang; }
    }
  }
  return null;
}

// ── 默认 server 配置 ───────────────────────────────────────────────────────

const DEFAULT_SERVER_CONFIGS = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    languageIds: ['python'],
    fallback: { command: 'pylsp', args: [] },
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    languageIds: ['rust'],
  },
  go: {
    command: 'gopls',
    args: [],
    languageIds: ['go'],
  },
};

/**
 * 查找可执行文件。先检查 PATH，再检查 node_modules/.bin。
 */
function findExecutable(command) {
  // 使用 which 命令查找（兼容 Node 和 Bun）
  try {
    const result = spawnSync('which', [command], { encoding: 'utf-8', timeout: 3000 });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch { /* which 不可用 */ }

  // 尝试 node_modules/.bin
  try {
    const path = `${process.cwd()}/node_modules/.bin/${command}`;
    accessSync(path, fsConstants.X_OK);
    return path;
  } catch {
    return null;
  }
}

// ── ServerManager ──────────────────────────────────────────────────────────

/**
 * LSP ServerManager：按语言管理 LSP 客户端实例。
 *
 * 用法：
 * ```js
 * const mgr = new ServerManager({ workspaceRoot: '/path/to/project' });
 * await mgr.initialize();
 * const def = await mgr.request('textDocument/definition', 'src/index.ts', { line: 10, character: 4 });
 * await mgr.shutdown();
 * ```
 */
export class ServerManager {
  /**
   * @param {object} options
   * @param {string} options.workspaceRoot        工作区根目录
   * @param {object} [options.serverConfigs]      自定义 server 配置（合并到默认）
   * @param {number} [options.maxServers=5]       最大并发 server 数
   * @param {number} [options.idleTimeoutMs=300_000]  空闲 5 分钟后自动关闭
   */
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.maxServers = options.maxServers || 5;
    this.idleTimeoutMs = options.idleTimeoutMs || 300_000;

    /** @type {Map<string, { client: LSPClient, config: object, lastUsed: number }>} */
    this.#servers = new Map();
    /** @type {Map<string, string>} languageId -> serverKey */
    this.#languageMap = new Map();
    /** @type {Map<string, { uri: string, languageId: string, version: number, text?: string }>} */
    this.#openDocs = new Map();

    // 合并 server 配置
    this.#serverConfigs = {
      ...DEFAULT_SERVER_CONFIGS,
      ...options.serverConfigs,
    };
    // 构建 languageId -> serverKey 映射
    for (const [key, cfg] of Object.entries(this.#serverConfigs)) {
      for (const langId of (cfg.languageIds || [])) {
        this.#languageMap.set(langId, key);
      }
    }

    // 空闲回收定时器
    this.#idleTimer = null;

    // 最新 diagnostics 缓存
    /** @type {Map<string, object[]>} uri -> diagnostics */
    this.#diagnostics = new Map();

    // 操作队列锁（同一 server 的请求串行化以避免消息交错）
    /** @type {Map<string, Promise>} */
    this.#locks = new Map();
  }

  // ── server 配置 ─────────────────────────────────────────────────────────

  /** @private */
  #serverConfigs;
  /** @private */
  #languageMap;
  /** @private */
  #servers;
  /** @private */
  #openDocs;
  /** @private */
  #idleTimer;
  /** @private */
  #diagnostics;
  /** @private */
  #locks;

  /**
   * 获取或创建某语言的 LSP 客户端。
   * @private
   */
  async #getClient(languageId) {
    const serverKey = this.#languageMap.get(languageId);
    if (!serverKey) {
      throw new LSPClientError(`no LSP server configured for language: ${languageId}`);
    }
    let entry = this.#servers.get(serverKey);
    if (entry && entry.client.started) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    // 创建新 client
    const config = this.#serverConfigs[serverKey];
    let command = findExecutable(config.command);

    // 尝试 fallback
    if (!command && config.fallback) {
      command = findExecutable(config.fallback.command);
      if (command) {
        config.args = config.fallback.args || [];
      }
    }

    if (!command) {
      throw new LSPClientError(
        `LSP server '${config.command}' not found. Install it (e.g. npm i -g ${config.command}) or configure a custom server.`,
      );
    }

    const client = new LSPClient({
      command,
      args: config.args || [],
      cwd: this.workspaceRoot,
      timeout: config.timeout || 60_000,
    });

    // 收集 diagnostics
    client.on('diagnostics', (params) => {
      this.#diagnostics.set(params.uri, params.diagnostics || []);
      // 通知编辑器 diagnostic 监听器
      for (const cb of this.#_diagListeners) {
        try { cb(params); } catch { /* 忽略回调错误 */ }
      }
    });

    // 服务端退出时清除
    client.on('exit', () => {
      if (entry) { entry.client = null; }
    });

    await client.start();

    // 初始化
    await client.initialize({
      rootUri: `file://${this.workspaceRoot}`,
      rootPath: this.workspaceRoot,
      capabilities: config.capabilities,
      extra: config.initializationOptions
        ? { initializationOptions: config.initializationOptions }
        : {},
    });
    client.initialized();

    entry = { client, config, lastUsed: Date.now() };
    this.#servers.set(serverKey, entry);

    // 重新打开该 server 负责的所有已打开文档
    for (const [uri, doc] of this.#openDocs) {
      const docLang = detectLanguage(uri);
      const docServerKey = docLang ? this.#languageMap.get(docLang) : null;
      if (docServerKey === serverKey) {
        client.notify('textDocument/didOpen', {
          textDocument: {
            uri: doc.uri,
            languageId: doc.languageId,
            version: doc.version,
            text: doc.text || '',
          },
        });
      }
    }

    // LRU 淘汰
    if (this.#servers.size > this.maxServers) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, e] of this.#servers) {
        if (e.lastUsed < oldestTime) { oldestTime = e.lastUsed; oldestKey = k; }
      }
      if (oldestKey) {
        const e = this.#servers.get(oldestKey);
        this.#servers.delete(oldestKey);
        e.client.shutdown().catch(() => {});
      }
    }

    return client;
  }

  /**
   * 串行化执行：防止对同一个 server 的并发请求导致消息交错。
   * @private
   */
  async #withLock(serverKey, fn) {
    const prev = this.#locks.get(serverKey) || Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    this.#locks.set(serverKey, prev.then(() => next).catch(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ── 文档同步 ────────────────────────────────────────────────────────────

  /**
   * 在发送 LSP 请求前，确保文档已打开并同步到最新内容。
   * @param {string} filePath  文件路径
   * @param {string} [content]  当前内容；不传则直接 use LSP 已缓存的版本
   */
  async syncDocument(filePath, content) {
    const languageId = detectLanguage(filePath);
    if (!languageId) { return; }
    const uri = `file://${filePath}`;
    const existing = this.#openDocs.get(uri);

    if (content !== undefined && existing) {
      // didChange
      const newVersion = (existing.version || 0) + 1;
      const client = await this.#getClient(languageId);
      const serverKey = this.#languageMap.get(languageId);
      await this.#withLock(serverKey, async () => {
        client.notify('textDocument/didChange', {
          textDocument: { uri, version: newVersion },
          contentChanges: [{ text: content }],
        });
      });
      existing.text = content;
      existing.version = newVersion;
    } else if (content !== undefined && !existing) {
      // didOpen
      const client = await this.#getClient(languageId);
      const serverKey = this.#languageMap.get(languageId);
      await this.#withLock(serverKey, async () => {
        client.notify('textDocument/didOpen', {
          textDocument: { uri, languageId, version: 1, text: content },
        });
      });
      this.#openDocs.set(uri, { uri, languageId, version: 1, text: content });
    }
    // 如果没传 content 且已有 open doc：不做任何事（用现有版本）
  }

  /**
   * 关闭文档，通知 LSP server。
   */
  async closeDocument(filePath) {
    const uri = `file://${filePath}`;
    const doc = this.#openDocs.get(uri);
    if (!doc) { return; }
    const languageId = doc.languageId;
    if (!languageId) { return; }
    try {
      const client = await this.#getClient(languageId);
      client.notify('textDocument/didClose', { textDocument: { uri } });
    } catch { /* server 可能已下线 */ }
    this.#openDocs.delete(uri);
  }

  // ── 公开 LSP 能力 ────────────────────────────────────────────────────────

  /**
   * 发送 LSP 请求。
   *
   * @param {string} method        LSP 方法名
   * @param {string} filePath      文件路径
   * @param {object} extraParams   额外参数（不含 textDocument/position）
   * @param {object} [position]    { line, character } 0-based
   * @param {string} [content]     同步文档内容
   * @param {number} [timeout]     超时 ms
   * @returns {Promise<any>}
   */
  async request(method, filePath, extraParams = {}, position = null, content = null, timeout = null) {
    // 先同步文档
    if (content !== null && content !== undefined) {
      await this.syncDocument(filePath, content);
    } else {
      // 确保至少打开过
      await this.syncDocument(filePath, undefined);
    }

    const languageId = detectLanguage(filePath);
    if (!languageId) {
      throw new LSPClientError(`unsupported file type: ${filePath}`);
    }

    const client = await this.#getClient(languageId);
    const serverKey = this.#languageMap.get(languageId);
    const uri = `file://${filePath}`;

    return this.#withLock(serverKey, async () => {
      const params = {
        textDocument: { uri },
        ...extraParams,
      };
      if (position) {
        params.position = { line: position.line, character: position.character };
      }
      return client.request(method, params, timeout);
    });
  }

  /**
   * 获取缓存的 diagnostics。
   */
  getDiagnostics(filePath) {
    const uri = `file://${filePath}`;
    return this.#diagnostics.get(uri) || [];
  }

  /**
   * 获取所有 diagnostics。
   */
  getAllDiagnostics() {
    const result = {};
    for (const [uri, diags] of this.#diagnostics) {
      result[uri] = diags;
    }
    return result;
  }

  /**
   * 订阅 diagnostics 变更回调（用于编辑器实时更新）。
   * 返回取消订阅函数。
   */
  onDiagnostics(callback) {
    this.#_diagListeners.push(callback);
    return () => {
      this.#_diagListeners = this.#_diagListeners.filter(cb => cb !== callback);
    };
  }

  // 内部：diagnostic 变更监听器列表（新 client 创建时自动复用）
  #_diagListeners = [];

  /**
   * 获取文件的 Semantic Tokens（用于编辑器语法高亮）。
   * @param {string} filePath
   * @returns {Promise<{legend: object, data: number[]}|null>}
   */
  async getSemanticTokens(filePath) {
    try {
      const languageId = detectLanguage(filePath);
      if (!languageId) { return null; }
      await this.syncDocument(filePath, undefined);
      return await this.request('textDocument/semanticTokens/full', filePath);
    } catch {
      // semantic tokens 不总是可用，静默失败
      return null;
    }
  }

  /**
   * 获取文件指定位置的 Hover 信息。
   * @param {string} filePath
   * @param {{line:number, character:number}} position
   * @returns {Promise<object|null>}
   */
  async getHover(filePath, position) {
    try {
      const languageId = detectLanguage(filePath);
      if (!languageId) { return null; }
      await this.syncDocument(filePath, undefined);
      return await this.request('textDocument/hover', filePath, position);
    } catch {
      return null;
    }
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────

  /** 检查是否有可用的 LSP server。 */
  isAvailable(languageId) {
    return this.#languageMap.has(languageId);
  }

  /** 获取当前已启动的 server 数量。 */
  get serverCount() {
    return this.#servers.size;
  }

  /** 获取所有已知的语言 ID。 */
  get supportedLanguages() {
    return [...this.#languageMap.keys()];
  }

  /** 优雅关闭所有 server。 */
  async shutdown() {
    if (this.#idleTimer) { clearTimeout(this.#idleTimer); }
    const promises = [];
    for (const [, entry] of this.#servers) {
      promises.push(entry.client.shutdown().catch(() => {}));
    }
    this.#servers.clear();
    this.#openDocs.clear();
    this.#diagnostics.clear();
    this.#locks.clear();
    await Promise.all(promises);
  }
}
