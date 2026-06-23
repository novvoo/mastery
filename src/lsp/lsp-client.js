/**
 * LSP JSON-RPC 2.0 客户端 — 通过 stdio 与语言服务器通信。
 *
 * 支持：
 *  - spawn / kill 语言服务器进程
 *  - JSON-RPC 请求/响应/通知
 *  - 消息分帧（Content-Length header）
 *  - 超时与错误恢复
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// ── 常量 ───────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const HEADER_RE = /^Content-Length:\s*(\d+)\r?\n/i;

// ── 错误 ───────────────────────────────────────────────────────────────────

export class LSPClientError extends Error {
  constructor(message, { code, data } = {}) {
    super(message);
    this.name = 'LSPClientError';
    this.code = code;
    this.data = data;
  }
}

export class LSPServerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LSPServerError';
  }
}

// ── LSPClient ──────────────────────────────────────────────────────────────

/**
 * 单个 LSP 服务器实例的管理客户端。
 *
 * 用法：
 * ```js
 * const client = new LSPClient({ command: 'typescript-language-server', args: ['--stdio'] });
 * await client.start();
 * const result = await client.request('textDocument/definition', { ... });
 * await client.shutdown();
 * ```
 */
export class LSPClient extends EventEmitter {
  #proc = null;
  #id = 0;
  #pending = new Map(); // id -> { resolve, reject, timer }
  #buffer = Buffer.alloc(0);
  #started = false;
  #stopping = false;

  /**
   * @param {object} options
   * @param {string} options.command     可执行文件路径或命令名
   * @param {string[]} [options.args]    命令行参数
   * @param {object} [options.env]       额外环境变量
   * @param {string} [options.cwd]       工作目录
   * @param {number} [options.timeout]   请求超时 ms（默认 30000）
   */
  constructor(options) {
    super();
    this.command = options.command;
    this.args = options.args || [];
    this.env = { ...process.env, ...options.env };
    this.cwd = options.cwd || process.cwd();
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────

  get started() {
    return this.#started && !this.#stopping;
  }

  /** 启动语言服务器 */
  async start() {
    if (this.#started) {
      return;
    }
    return new Promise((resolve, reject) => {
      try {
        this.#proc = spawn(this.command, this.args, {
          cwd: this.cwd,
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(new LSPServerError(`failed to spawn ${this.command}: ${err.message}`));
        return;
      }

      this.#proc.on('error', (err) => {
        this.emit('error', err);
        if (!this.#started) {
          reject(err);
        }
      });

      this.#proc.on('exit', (code, signal) => {
        this.#started = false;
        this.emit('exit', { code, signal });
        // 拒绝所有 pending 请求
        for (const [, p] of this.#pending) {
          clearTimeout(p.timer);
          p.reject(new LSPServerError(`server exited with code ${code} signal ${signal}`));
        }
        this.#pending.clear();
      });

      this.#proc.stderr.on('data', (chunk) => {
        this.emit('stderr', chunk.toString());
      });

      // 读取 stdout — 按 Content-Length 头分帧
      let stdoutBuffer = Buffer.alloc(0);
      this.#proc.stdout.on('data', (chunk) => {
        stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
        // 尝试从 buffer 中提取完整消息
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const headerEnd = stdoutBuffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) {
            break;
          }
          const headerText = stdoutBuffer.slice(0, headerEnd + 4).toString();
          const match = headerText.match(HEADER_RE);
          if (!match) {
            // 无效帧头，丢弃
            stdoutBuffer = stdoutBuffer.slice(headerEnd + 4);
            continue;
          }
          const contentLength = parseInt(match[1], 10);
          const bodyStart = headerEnd + 4;
          if (stdoutBuffer.length < bodyStart + contentLength) {
            // 消息体尚未完整接收
            break;
          }
          const body = stdoutBuffer.slice(bodyStart, bodyStart + contentLength);
          stdoutBuffer = stdoutBuffer.slice(bodyStart + contentLength);
          this.#handleMessage(body.toString());
        }
      });

      this.#started = true;
      resolve();
    });
  }

  /** 发送初始化请求 (initialize) */
  async initialize(params) {
    return this.request('initialize', {
      processId: process.pid,
      rootUri: params.rootUri || null,
      rootPath: params.rootPath || null,
      workspaceFolders: params.workspaceFolders || null,
      capabilities: params.capabilities || {
        textDocument: {
          synchronization: { didSave: true },
          definition: { linkSupport: true },
          references: {},
          rename: { prepareSupport: true },
          codeAction: {},
          formatting: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: {},
          semanticTokens: {
            tokenTypes: [
              'namespace',
              'type',
              'class',
              'enum',
              'interface',
              'struct',
              'typeParameter',
              'parameter',
              'variable',
              'property',
              'enumMember',
              'function',
              'method',
              'macro',
              'keyword',
              'modifier',
              'comment',
              'string',
              'number',
              'regexp',
              'operator',
              'decorator',
            ],
            tokenModifiers: [
              'declaration',
              'definition',
              'readonly',
              'static',
              'deprecated',
              'abstract',
              'async',
              'modification',
              'documentation',
              'defaultLibrary',
            ],
            formats: ['relative'],
          },
        },
        workspace: {
          symbol: {},
          workspaceEdit: { documentChanges: true },
        },
      },
      ...params.extra,
    });
  }

  /** 发送 initialized 通知 */
  initialized() {
    this.notify('initialized', {});
  }

  /** 优雅关闭 */
  async shutdown() {
    if (!this.#started || this.#stopping) {
      return;
    }
    this.#stopping = true;
    try {
      await this.request('shutdown', null, 5000);
    } catch {
      /* ignore */
    }
    this.notify('exit', null);
    this.#kill();
  }

  /** 强制 kill */
  #kill() {
    if (this.#proc) {
      try {
        this.#proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          this.#proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 2000);
    }
    this.#started = false;
    this.#stopping = false;
  }

  // ── JSON-RPC ─────────────────────────────────────────────────────────────

  /**
   * 发送 JSON-RPC 请求并等待响应。
   * @param {string} method
   * @param {object} params
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  request(method, params, timeout) {
    const id = ++this.#id;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    this.#send(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new LSPClientError(`request ${method} timed out after ${timeout || this.timeout}ms`),
        );
      }, timeout || this.timeout);
      this.#pending.set(id, { resolve, reject, timer, method });
    });
  }

  /**
   * 发送 JSON-RPC 通知（无响应）。
   * @param {string} method
   * @param {object} params
   */
  notify(method, params) {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.#send(message);
  }

  #send(data) {
    if (!this.#proc || !this.#proc.stdin.writable) {
      throw new LSPServerError('server not connected');
    }
    const content = Buffer.from(data, 'utf-8');
    const header = `Content-Length: ${content.length}\r\n\r\n`;
    this.#proc.stdin.write(header);
    this.#proc.stdin.write(content);
  }

  #handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.emit('parse-error', raw);
      return;
    }

    // 响应
    if (msg.id !== undefined && msg.method === undefined) {
      const pending = this.#pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(msg.id);
        if (msg.error) {
          pending.reject(
            new LSPClientError(msg.error.message || `LSP error`, {
              code: msg.error.code,
              data: msg.error.data,
            }),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 服务器 -> 客户端请求（如 window/showMessageRequest）
    if (msg.id !== undefined && msg.method !== undefined) {
      this.emit('server-request', msg);
      // 自动以 null 响应（表示不支持）
      try {
        this.#send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null }));
      } catch {
        /* ignore */
      }
      return;
    }

    // 通知
    this.emit('notification', { method: msg.method, params: msg.params });

    // 特殊处理 diagnostics 发布
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.emit('diagnostics', msg.params);
    }
  }
}
