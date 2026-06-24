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
import { join } from 'path';
import { pathToFileURL } from 'url';

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
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.dart': 'dart',
  '.cs': 'csharp',
  '.csx': 'csharp',
  '.zig': 'zig',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.swift': 'swift',
  '.r': 'r',
};

/**
 * 根据文件路径检测语言 ID。
 */
export function detectLanguage(filePath) {
  for (const [ext, lang] of Object.entries(EXT_TO_LANGUAGE)) {
    if (filePath.endsWith(ext)) {
      return lang;
    }
  }
  // 检查双扩展名
  const parts = filePath.split('.');
  if (parts.length >= 2) {
    const lastTwo = '.' + parts.slice(-2).join('.');
    for (const [ext, lang] of Object.entries(EXT_TO_LANGUAGE)) {
      if (lastTwo.endsWith(ext)) {
        return lang;
      }
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
    installCommand: 'npm install -g typescript-language-server typescript',
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    languageIds: ['python'],
    fallback: { command: 'pylsp', args: [] },
    installCommand: 'npm install -g pyright',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    languageIds: ['rust'],
    installCommand: 'cargo install rust-analyzer',
  },
  go: {
    command: 'gopls',
    args: [],
    languageIds: ['go'],
    installCommand: 'go install golang.org/x/tools/gopls@latest',
  },
  java: {
    command: 'jdtls',
    args: [],
    languageIds: ['java'],
    installCommand: 'npm install -g eclipse-jdtls',
  },
  vue: {
    command: 'vls',
    args: ['--stdio'],
    languageIds: ['vue'],
    fallback: { command: 'vue-language-server', args: ['--stdio'] },
    installCommand: 'npm install -g @vue/language-server',
  },
  svelte: {
    command: 'svelteserver',
    args: ['--stdio'],
    languageIds: ['svelte'],
    installCommand: 'npm install -g svelte-language-server',
  },
  css: {
    command: 'vscode-css-languageserver',
    args: ['--stdio'],
    languageIds: ['css', 'scss', 'less'],
    installCommand: 'npm install -g vscode-css-languageserver-bin',
  },
  html: {
    command: 'vscode-html-languageserver',
    args: ['--stdio'],
    languageIds: ['html'],
    installCommand: 'npm install -g vscode-html-languageserver-bin',
  },
  json: {
    command: 'vscode-json-languageserver',
    args: ['--stdio'],
    languageIds: ['json'],
    installCommand: 'npm install -g vscode-json-languageserver',
  },
  yaml: {
    command: 'yaml-language-server',
    args: ['--stdio'],
    languageIds: ['yaml'],
    installCommand: 'npm install -g yaml-language-server',
  },
  toml: {
    command: 'taplo',
    args: ['lsp', 'stdio'],
    languageIds: ['toml'],
    installCommand: 'cargo install taplo-cli',
  },
  dart: {
    command: 'dart',
    args: ['language-server', '--client-id=agent-mastery'],
    languageIds: ['dart'],
    installCommand:
      'flutter pub global activate dart_language_server || dart pub global activate dart_language_server',
    fallback: { command: 'dart_language_server', args: [] },
  },
  kotlin: {
    command: 'kotlin-language-server',
    args: [],
    languageIds: ['kotlin'],
    installCommand: 'npm install -g kotlin-language-server',
    fallback: { command: 'kotlin-ls', args: [] },
  },
  csharp: {
    command: 'omnisharp',
    args: ['-lsp'],
    languageIds: ['csharp'],
    installCommand: 'dotnet tool install -g csharp-ls || npm install -g omnisharp',
    fallback: { command: 'csharp-ls', args: [] },
  },
  zig: {
    command: 'zls',
    args: [],
    languageIds: ['zig'],
    installCommand: 'brew install zls || cargo install zls',
  },
  elixir: {
    command: 'elixir-ls',
    args: [],
    languageIds: ['elixir'],
    installCommand: 'brew install elixir-ls',
    fallback: { command: 'elixir-ls', args: ['language-server'] },
  },
  swift: {
    command: 'sourcekit-lsp',
    args: [],
    languageIds: ['swift'],
    installCommand: 'xcode-select --install || brew install swift-language-server',
  },
  r: {
    command: 'R',
    args: ['--slave', '-e', 'languageserver::run()'],
    languageIds: ['r'],
    installCommand: "R -e \"install.packages('languageserver', repos='https://cran.rstudio.com')\"",
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
  } catch {
    /* which 不可用 */
  }

  // 尝试 node_modules/.bin
  try {
    const path = `${process.cwd()}/node_modules/.bin/${command}`;
    accessSync(path, fsConstants.X_OK);
    return path;
  } catch {
    return null;
  }
}

/**
 * 简单的 shell 命令解析器，支持引号和转义。
 * @param {string} command
 * @returns {string[]} [cmd, arg1, arg2, ...]
 */
function parseShellCommand(command) {
  const args = [];
  let current = '';
  let inQuote = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (inQuote === null) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if ((char === ' ' || char === '\t') && inQuote === null) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
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
   * @param {string[]} [options.workspaceFolders]  多根工作区文件夹列表
   * @param {object} [options.serverConfigs]      自定义 server 配置（合并到默认）
   * @param {number} [options.maxServers=5]       最大并发 server 数
   * @param {number} [options.maxServersPerLang=3] 每种语言最大 server 实例数 (server pool)
   * @param {number} [options.idleTimeoutMs=300_000]  空闲 5 分钟后自动关闭
   * @param {boolean} [options.autoInstall=true]  自动安装缺失的 LSP server
   * @param {boolean} [options.useSandboxInstall=true]  使用 LSPSandboxInstaller 进行版本锁定安装
   * @param {string} [options.sandboxRoot]       沙箱安装根目录，默认 `.lsp-sandbox`
   */
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.maxServers = options.maxServers || 5;
    this.maxServersPerLang = options.maxServersPerLang || 3;
    this.idleTimeoutMs = options.idleTimeoutMs || 300_000;
    this.autoInstall = options.autoInstall !== false;
    this.useSandboxInstall = options.useSandboxInstall !== false;
    this.sandboxRoot = options.sandboxRoot || join(this.workspaceRoot, '.lsp-sandbox');

    // 多根工作区支持
    /** @type {string[]} */
    this.workspaceFolders = options.workspaceFolders || [this.workspaceRoot];

    /** @type {Map<string, { client: LSPClient, config: object, lastUsed: number, workspaceRoot: string }>} */
    this.#servers = new Map();
    /** @type {Map<string, string>} languageId -> serverKey */
    this.#languageMap = new Map();
    /** @type {Map<string, { uri: string, languageId: string, version: number, text?: string, workspaceRoot?: string }>} */
    this.#openDocs = new Map();

    // Server pool: langKey -> Map<workspaceRoot, entry>
    /** @type {Map<string, Map<string, object>>} */
    this.#serverPool = new Map();

    // 合并 server 配置
    this.#serverConfigs = {
      ...DEFAULT_SERVER_CONFIGS,
      ...options.serverConfigs,
    };
    // 构建 languageId -> serverKey 映射
    for (const [key, cfg] of Object.entries(this.#serverConfigs)) {
      for (const langId of cfg.languageIds || []) {
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

    // 正在安装中的 server（防止重复安装）
    /** @type {Set<string>} */
    this.#installing = new Set();
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
  /** @private */
  #installing;
  /** @private Server pool: langKey -> Map<workspaceRoot, serverEntry> */
  #serverPool;

  /**
   * 根据文件路径找到对应的 workspace root。
   * @private
   * @param {string} filePath
   * @returns {string}
   */
  #getWorkspaceForPath(filePath) {
    let best = this.workspaceRoot;
    let bestLen = 0;
    for (const wf of this.workspaceFolders) {
      if (filePath.startsWith(wf + '/') || filePath === wf) {
        if (wf.length > bestLen) {
          best = wf;
          bestLen = wf.length;
        }
      }
    }
    return best;
  }

  /**
   * 获取或创建某语言的 LSP 客户端（支持 workspace-aware server pool）。
   * @private
   */
  async #getClient(languageId, filePath) {
    const serverKey = this.#languageMap.get(languageId);
    if (!serverKey) {
      throw new LSPClientError(`no LSP server configured for language: ${languageId}`);
    }

    // Server pool 查找：根据 workspace root 找对应 instance
    const wsRoot = filePath ? this.#getWorkspaceForPath(filePath) : this.workspaceRoot;

    // 先从 server pool 查找
    if (!this.#serverPool.has(serverKey)) {
      this.#serverPool.set(serverKey, new Map());
    }
    const poolForLang = this.#serverPool.get(serverKey);
    if (poolForLang.has(wsRoot)) {
      const entry = poolForLang.get(wsRoot);
      if (entry && entry.client.started) {
        entry.lastUsed = Date.now();
        return entry.client;
      }
    }

    // 单例 fallback（非 pool 模式）
    let entry = this.#servers.get(serverKey);
    if (entry && entry.client.started) {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    const config = this.#serverConfigs[serverKey];
    let command = findExecutable(config.command);

    // 尝试 fallback
    if (!command && config.fallback) {
      command = findExecutable(config.fallback.command);
      if (command) {
        config.args = config.fallback.args || [];
      }
    }

    // 自动安装 fallback
    if (!command && config.installCommand && !this.#installing.has(serverKey) && this.autoInstall) {
      this.#installing.add(serverKey);
      try {
        console.warn(`[LSP] Server '${config.command}' not found, attempting auto-install...`);
        const installResult = await this.#tryInstallServer(serverKey, config);
        if (installResult.success) {
          // Sandbox 模式下使用安装路径
          if (installResult.binaryPath) {
            command = installResult.binaryPath;
          } else {
            command = findExecutable(config.command);
          }
        }
      } catch (err) {
        console.warn(`[LSP] Auto-install failed: ${err.message}`);
      } finally {
        this.#installing.delete(serverKey);
      }
    }

    if (!command) {
      const hint = config.installCommand ? `\nInstall with: ${config.installCommand}` : '';
      throw new LSPClientError(`LSP server '${config.command}' not found.${hint}`);
    }

    const client = new LSPClient({
      command,
      args: config.args || [],
      cwd: wsRoot,
      timeout: config.timeout || 60_000,
    });

    // 收集 diagnostics
    client.on('diagnostics', (params) => {
      this.#diagnostics.set(params.uri, params.diagnostics || []);
      for (const cb of this.#_diagListeners) {
        try {
          cb(params);
        } catch {
          /* 忽略回调错误 */
        }
      }
    });

    // 服务端退出时清除
    client.on('exit', () => {
      if (entry) {
        entry.client = null;
      }
      if (poolForLang) {
        poolForLang.delete(wsRoot);
      }
    });

    await client.start();

    // 初始化 — 传递 workspaceFolders 信息
    await client.initialize({
      rootUri: pathToFileURL(wsRoot).href,
      rootPath: wsRoot,
      workspaceFolders: this.workspaceFolders.map((f) => ({
        uri: pathToFileURL(f).href,
        name: f.split('/').pop() || f,
      })),
      capabilities: config.capabilities,
      extra: config.initializationOptions
        ? { initializationOptions: config.initializationOptions }
        : {},
    });
    client.initialized();

    entry = { client, config, lastUsed: Date.now(), workspaceRoot: wsRoot };
    this.#servers.set(serverKey, entry);

    // 存入 server pool
    poolForLang.set(wsRoot, entry);

    // Server pool 限制：每种语言最大实例数
    if (poolForLang.size > this.maxServersPerLang) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, e] of poolForLang) {
        if (e.lastUsed < oldestTime) {
          oldestTime = e.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const oldEntry = poolForLang.get(oldestKey);
        poolForLang.delete(oldestKey);
        oldEntry.client.shutdown().catch(() => {});
      }
    }

    // 重新打开该 server/workspace 负责的所有已打开文档
    for (const [uri, doc] of this.#openDocs) {
      const docLang = detectLanguage(uri);
      const docServerKey = docLang ? this.#languageMap.get(docLang) : null;
      const docWsRoot = doc.workspaceRoot || this.workspaceRoot;
      if (docServerKey === serverKey && docWsRoot === wsRoot) {
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

    // 全局 LRU 淘汰（总 server 数限制）
    if (this.#servers.size > this.maxServers) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, e] of this.#servers) {
        if (e.lastUsed < oldestTime) {
          oldestTime = e.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const e = this.#servers.get(oldestKey);
        this.#servers.delete(oldestKey);
        // 也从 pool 清理
        if (e.workspaceRoot) {
          const p = this.#serverPool.get(oldestKey);
          if (p) {
            p.delete(e.workspaceRoot);
          }
        }
        e.client.shutdown().catch(() => {});
      }
    }

    return client;
  }

  /**
   * 尝试自动安装语言服务器。
   * 当 useSandboxInstall=true 时使用 LSPSandboxInstaller 进行版本锁定 + 沙箱安装。
   * @private
   * @param {string} serverKey
   * @param {object} config
   */
  async #tryInstallServer(serverKey, config) {
    // ── 沙箱安装路径 ────────────────────────────────────────
    if (this.useSandboxInstall) {
      try {
        const { LSPSandboxInstaller } = await import('./lsp-sandbox-installer.js');
        const installer = new LSPSandboxInstaller({
          installRoot: this.sandboxRoot,
          keepPrevious: true,
          onProgress: (phase, msg, pct) => {
            if (phase === 'verify' || phase === 'install') {
              console.warn(`[LSP Sandbox] ${serverKey}: ${msg}`);
            }
          },
        });

        // 推断包管理器
        const cmd = config.command;
        const installCmd = config.installCommand;
        let manager = 'npm',
          pkg = cmd;
        if (installCmd) {
          if (installCmd.startsWith('npm ')) {
            manager = 'npm';
            pkg = cmd;
          } else if (installCmd.startsWith('go ')) {
            manager = 'go';
            pkg = cmd;
          } else if (installCmd.startsWith('cargo ')) {
            manager = 'cargo';
            pkg = cmd;
          } else if (installCmd.startsWith('pip') || installCmd.includes('pip install')) {
            manager = 'pip';
            pkg = cmd;
          } else if (installCmd.startsWith('brew ')) {
            manager = 'system';
            pkg = cmd;
          }
        }

        const result = await installer.install(
          serverKey,
          {
            command: config.command,
            pinnedVersion: config.pinnedVersion || config.minVersion || 'latest',
            minVersion: config.minVersion,
          },
          {
            manager,
            package: pkg,
          },
        );

        if (result.success && result.binaryPath) {
          console.warn(
            `[LSP Sandbox] ${serverKey}@${result.version} installed → ${result.binaryPath}`,
          );
          return { success: true, binaryPath: result.binaryPath };
        }
        if (result.rolledBack) {
          console.warn(
            `[LSP Sandbox] ${serverKey} install failed and rolled back to ${result.previousVersion || 'none'}`,
          );
        }
        return { success: false, error: result.error || 'Sandbox install failed' };
      } catch (err) {
        console.warn(
          `[LSP Sandbox] ${serverKey} install error: ${err.message}, falling back to direct install`,
        );
        // 沙箱安装失败 → 回退到直接安装
      }
    }

    // ── 直接安装（无沙箱） ──────────────────────────────────
    const installCommand = config.installCommand;
    const { spawn } = await import('child_process');
    const [cmd, ...args] = parseShellCommand(installCommand);

    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      });

      let stderr = '';
      proc.stdout.on('data', () => {
        // stdout consumed but not stored (only used for pipe draining)
      });
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      proc.on('timeout', () => {
        proc.kill();
        resolve({ success: false, error: 'Install timed out' });
      });
    });
  }

  /**
   * 串行化执行：防止对同一个 server 的并发请求导致消息交错。
   * @private
   */
  async #withLock(serverKey, fn) {
    const prev = this.#locks.get(serverKey) || Promise.resolve();
    let release;
    const next = new Promise((r) => {
      release = r;
    });
    this.#locks.set(
      serverKey,
      prev.then(() => next).catch(() => next),
    );
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
    if (!languageId) {
      return;
    }
    const uri = pathToFileURL(filePath).href;
    const existing = this.#openDocs.get(uri);

    if (content !== undefined && existing) {
      // didChange
      const newVersion = (existing.version || 0) + 1;
      const client = await this.#getClient(languageId, filePath);
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
      const client = await this.#getClient(languageId, filePath);
      const serverKey = this.#languageMap.get(languageId);
      await this.#withLock(serverKey, async () => {
        client.notify('textDocument/didOpen', {
          textDocument: { uri, languageId, version: 1, text: content },
        });
      });
      this.#openDocs.set(uri, { uri, languageId, version: 1, text: content });
    } else if (content === undefined && !existing) {
      // 文档未打开且未传 content：读取文件并 didOpen
      const { readFile } = await import('fs/promises');
      let fileContent;
      try {
        fileContent = await readFile(filePath, 'utf-8');
      } catch {
        return;
      }
      const client = await this.#getClient(languageId, filePath);
      const serverKey = this.#languageMap.get(languageId);
      await this.#withLock(serverKey, async () => {
        client.notify('textDocument/didOpen', {
          textDocument: { uri, languageId, version: 1, text: fileContent },
        });
      });
      this.#openDocs.set(uri, { uri, languageId, version: 1, text: fileContent });
    }
  }

  /**
   * 关闭文档，通知 LSP server。
   */
  async closeDocument(filePath) {
    const uri = pathToFileURL(filePath).href;
    const doc = this.#openDocs.get(uri);
    if (!doc) {
      return;
    }
    const languageId = doc.languageId;
    if (!languageId) {
      return;
    }
    try {
      const client = await this.#getClient(languageId, filePath);
      client.notify('textDocument/didClose', { textDocument: { uri } });
    } catch {
      /* server 可能已下线 */
    }
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
  async request(
    method,
    filePath,
    extraParams = {},
    position = null,
    content = null,
    timeout = null,
  ) {
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

    const client = await this.#getClient(languageId, filePath);
    const serverKey = this.#languageMap.get(languageId);
    const uri = pathToFileURL(filePath).href;

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
    const uri = pathToFileURL(filePath).href;
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
      this.#_diagListeners = this.#_diagListeners.filter((cb) => cb !== callback);
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
      if (!languageId) {
        return null;
      }
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
      if (!languageId) {
        return null;
      }
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

  /** 获取当前 workspace folders 列表。 */
  getWorkspaceFolders() {
    return [...this.workspaceFolders];
  }

  /**
   * 添加一个 workspace folder（多根工作区支持）。
   * @param {string} folderPath
   */
  addWorkspaceFolder(folderPath) {
    if (!this.workspaceFolders.includes(folderPath)) {
      this.workspaceFolders.push(folderPath);
    }
  }

  /**
   * 获取当前 server pool 统计。
   */
  getPoolStats() {
    const stats = {};
    for (const [langKey, pool] of this.#serverPool) {
      stats[langKey] = pool.size;
    }
    return stats;
  }

  /**
   * 检查已安装的 LSP server 版本是否满足最低要求。
   * 通过执行 `{command} --version` 检测。
   *
   * @param {string} serverKey  server 配置 key（如 'typescript', 'rust'）
   * @returns {Promise<{installed: boolean, version: string|null, meetsMinimum: boolean, message: string}>}
   */
  async checkServerVersion(serverKey) {
    const config = this.#serverConfigs[serverKey];
    if (!config) {
      return {
        installed: false,
        version: null,
        meetsMinimum: false,
        message: `Unknown server key: ${serverKey}`,
      };
    }

    const command = config.command;
    const { execSync } = await import('child_process');
    try {
      const output = execSync(
        `${command} --version 2>&1 || ${command} version 2>&1 || ${command} -v 2>&1`,
        {
          timeout: 5000,
          encoding: 'utf-8',
        },
      )
        .toString()
        .trim();
      const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : output.substring(0, 50);

      // 检查最低版本
      let meetsMinimum = true;
      const minVersion = config.minVersion;
      if (minVersion && versionMatch) {
        const [minMajor, minMinor, minPatch] = minVersion.split('.').map(Number);
        const [curMajor, curMinor, curPatch] = versionMatch[1].split('.').map(Number);
        if (
          curMajor < minMajor ||
          (curMajor === minMajor && curMinor < minMinor) ||
          (curMajor === minMajor && curMinor === minMinor && curPatch < minPatch)
        ) {
          meetsMinimum = false;
        }
      }

      return {
        installed: true,
        version,
        meetsMinimum,
        message: meetsMinimum
          ? `✅ ${serverKey} ${version} (meets minimum ${minVersion || 'none'})`
          : `⚠️ ${serverKey} ${version} (minimum required: ${minVersion})`,
      };
    } catch {
      return {
        installed: false,
        version: null,
        meetsMinimum: false,
        message: `❌ ${serverKey} (${command}) is not installed. ${config.installCommand ? `Try: ${config.installCommand}` : ''}`,
      };
    }
  }

  /**
   * 检查所有已配置的 LSP server 版本状态。
   * @returns {Promise<Array<{serverKey: string, installed: boolean, version: string|null, meetsMinimum: boolean, message: string}>>}
   */
  async checkAllServerVersions() {
    const results = [];
    for (const serverKey of Object.keys(this.#serverConfigs)) {
      results.push({ serverKey, ...(await this.checkServerVersion(serverKey)) });
    }
    return results;
  }

  /** 优雅关闭所有 server。 */
  async shutdown() {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
    }
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
