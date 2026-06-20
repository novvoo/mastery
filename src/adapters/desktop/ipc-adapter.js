/**
 * Desktop IPC Adapter - 完整的 IPC 通信适配器
 * 用于 Electron 主进程和渲染进程之间的双向通信
 * 
 * 功能特性：
 * - 双向通信（主进程 <-> 渲染进程）
 * - 事件转发和转换
 * - 错误处理和重连机制
 * - 消息验证和安全检查
 * - 消息队列和缓冲
 */

import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'node:fs';
import path from 'node:path';
import { RuntimeEvent } from '../../runtime/types.js';
import { buildSlashCommandSuggestions } from '../../cli/slash-command-suggestions.js';
import { handleDocumentBatchAdd, handleDocumentCommand, parseDocumentCommand } from '../../runtime/document-command.js';
import { listPreviews, startPreview, stopPreview } from '../../core/preview-server.js';
import { computeDiff, isNoop } from '../../core/diff-preview.js';

const execFileAsync = promisify(execFile);

/**
 * IPC 消息类型定义
 */
export const IPCMessageType = {
  // 请求类型（需要响应）
  REQUEST: 'ipc:request',
  RESPONSE: 'ipc:response',
  ERROR: 'ipc:error',
  
  // 事件类型（单向通知）
  EVENT: 'ipc:event',
  
  // 系统类型
  HEARTBEAT: 'ipc:heartbeat',
  CONNECT: 'ipc:connect',
  DISCONNECT: 'ipc:disconnect',
  RECONNECT: 'ipc:reconnect'
};

/**
 * IPC 消息状态
 */
export const IPCMessageStatus = {
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error',
  TIMEOUT: 'timeout'
};

/**
 * IPC 配置
 */
const DEFAULT_CONFIG = {
  // 超时设置
  requestTimeout: 30000,      // 请求超时时间（毫秒）
  heartbeatInterval: 30000,   // 心跳间隔（毫秒）
  reconnectDelay: 1000,        // 重连延迟（毫秒）
  maxReconnectAttempts: 5,     // 最大重连次数
  
  // 消息队列设置
  maxQueueSize: 100,           // 最大队列大小
  enableQueue: true,           // 是否启用消息队列
  
  // 安全设置
  validateMessages: true,      // 是否验证消息
  allowedChannels: null,       // 允许的频道列表（null 表示允许所有）
  
  // 调试设置
  debug: false
};

function parsePreviewArgs(text = '') {
  const args = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

/**
 * IPC 消息类
 */
export class IPCMessage {
  constructor(type, payload, options = {}) {
    this.id = options.id || this.#generateId();
    this.type = type;
    this.payload = payload;
    this.timestamp = Date.now();
    this.status = IPCMessageStatus.PENDING;
    this.correlationId = options.correlationId || null;
    this.metadata = options.metadata || {};
    this.source = options.source || 'unknown';
    this.target = options.target || 'unknown';
  }

  /**
   * 生成唯一 ID
   */
  #generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 转换为可序列化的对象
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      payload: this.payload,
      timestamp: this.timestamp,
      status: this.status,
      correlationId: this.correlationId,
      metadata: this.metadata,
      source: this.source,
      target: this.target
    };
  }

  /**
   * 从 JSON 创建消息
   */
  static fromJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const msg = new IPCMessage(data.type, data.payload, {
      id: data.id,
      correlationId: data.correlationId,
      metadata: data.metadata,
      source: data.source,
      target: data.target
    });
    msg.timestamp = data.timestamp;
    msg.status = data.status;
    return msg;
  }
}

/**
 * IPC 消息队列
 */
/**
 * IPC 消息队列类
 * 用于缓存待处理的消息
 */
export class MessageQueue {
  constructor(maxSize = 100) {
    this.queue = [];
    this.maxSize = maxSize;
  }

  /**
   * 添加消息到队列
   */
  enqueue(message) {
    if (this.maxSize <= 0) {
      return;
    }
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
    }
    this.queue.push(message);
  }

  /**
   * 从队列取出消息
   */
  dequeue() {
    return this.queue.shift();
  }

  /**
   * 查看队列头部消息
   */
  peek() {
    return this.queue[0];
  }

  /**
   * 获取队列大小
   */
  size() {
    return this.queue.length;
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue = [];
  }

  /**
   * 获取所有消息
   */
  getAll() {
    return [...this.queue];
  }
}

/**
 * IPC 适配器基类
 * 提供主进程和渲染进程共享的功能
 */
export class IPCAdapterBase extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.messageQueue = new MessageQueue(this.config.maxQueueSize);
    this.pendingRequests = new Map();
    this.eventSubscriptions = new Map();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.heartbeatTimer = null;
    this.lastHeartbeat = Date.now();

    // 保存子类可能定义的 send 实现
    const subclassSend = typeof this.send === 'function' && this.send !== IPCAdapterBase.prototype.send
      ? this.send.bind(this)
      : null;

    // 包装 send：统一检查连接状态 + 队列管理
    const self = this;
    this.send = async function (message) {
      if (!self.isConnected) {
        if (self.config.enableQueue) {
          self.messageQueue.enqueue(message);
          return null;
        }
        throw new Error('IPC 未连接');
      }
      if (subclassSend) {
        return subclassSend(message);
      }
      return self._sendImpl(message);
    };
  }

  /**
   * 生成唯一请求 ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 验证消息
   */
  validateMessage(message) {
    if (!this.config.validateMessages) {
      return { valid: true };
    }

    // 检查消息结构
    if (!message || typeof message !== 'object') {
      return { valid: false, error: '消息必须是一个对象' };
    }

    if (!message.type) {
      return { valid: false, error: '消息必须包含 type 字段' };
    }

    // 检查是否是允许的频道
    if (this.config.allowedChannels && !this.config.allowedChannels.includes(message.type)) {
      return { valid: false, error: `频道 ${message.type} 不在允许列表中` };
    }

    return { valid: true };
  }

  /**
   * 创建请求消息
   */
  createRequest(channel, payload, options = {}) {
    const message = new IPCMessage(IPCMessageType.REQUEST, payload, {
      ...options,
      metadata: { channel, ...options.metadata }
    });
    return message;
  }

  /**
   * 创建响应消息
   */
  createResponse(requestMessage, payload, status = IPCMessageStatus.SUCCESS) {
    const message = new IPCMessage(IPCMessageType.RESPONSE, payload, {
      correlationId: requestMessage.id,
      metadata: { 
        channel: requestMessage.metadata?.channel,
        status 
      }
    });
    message.status = status;
    return message;
  }

  /**
   * 创建错误消息
   */
  createError(requestMessage, error) {
    const message = new IPCMessage(IPCMessageType.ERROR, {
      message: error.message || 'Unknown error',
      code: error.code || 'UNKNOWN_ERROR',
      stack: error.stack
    }, {
      correlationId: requestMessage.id,
      metadata: { 
        channel: requestMessage.metadata?.channel,
        status: IPCMessageStatus.ERROR
      }
    });
    message.status = IPCMessageStatus.ERROR;
    return message;
  }

  /**
   * 创建事件消息
   */
  createEvent(eventName, data) {
    return new IPCMessage(IPCMessageType.EVENT, data, {
      metadata: { eventName }
    });
  }

  /**
   * 处理请求超时
   */
  handleTimeout(requestId) {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.reject(new Error(`请求超时: ${requestId}`));
      this.pendingRequests.delete(requestId);
      this.emit('timeout', { requestId });
    }
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送心跳
   */
  sendHeartbeat() {
    const heartbeat = new IPCMessage(IPCMessageType.HEARTBEAT, {
      timestamp: Date.now(),
      lastHeartbeat: this.lastHeartbeat
    });
    
    this.send(heartbeat).catch(err => {
      this.emit('error', err);
    });
  }

  /**
   * 处理重连
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.emit('error', new Error('最大重连次数已达到'));
      return false;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await this.connect();
      this.reconnectAttempts = 0;
      return true;
    } catch (error) {
      return this.handleReconnect();
    }
  }

  /**
   * 发送消息（统一做连接状态检查和队列管理
   * 子类应重写 _sendImpl() 实现实际发送逻辑
   */
  async send(message) {
    if (!this.isConnected) {
      if (this.config.enableQueue) {
        this.messageQueue.enqueue(message);
        return null;
      }
      throw new Error('IPC 未连接');
    }
    return this._sendImpl(message);
  }

  /**
   * 实际发送逻辑（子类重写）
   * @protected
   */
  async _sendImpl(message) {
    throw new Error('_sendImpl() 必须由子类实现');
  }

  /**
   * 连接（子类实现）
   */
  async connect() {
    throw new Error('connect() 必须由子类实现');
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.isConnected = false;
    this.stopHeartbeat();
    this.emit('disconnected');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      isConnected: this.isConnected,
      pendingRequests: this.pendingRequests.size,
      queueSize: this.messageQueue.size(),
      subscriptions: this.eventSubscriptions.size,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeat
    };
  }
}

/**
 * 主进程 IPC 适配器
 * 用于 Electron 主进程
 */
export class MainProcessIPCAdapter extends IPCAdapterBase {
  #ipcMain;
  #eventBus;
  #engine;
  #windows;
  #windowSenders;
  #handlers;
  #handlersSetup;

  constructor(ipcMain, eventBus, config = {}) {
    super(config);
    this.#ipcMain = ipcMain;
    this.#eventBus = eventBus;
    this.#windows = new Set();
    this.#windowSenders = new Map();
    this.#handlers = new Map();
    this.#handlersSetup = false;
  }

  /**
   * 初始化适配器（幂等：重复调用不会重新注册 IPC handler）
   */
  async initialize() {
    this.#setupIPCHandlers();
    this.isConnected = true;
    this.startHeartbeat();
    
    if (this.config.debug) {
      console.log('[MainProcessIPC] 适配器已初始化');
    }
  }

  /**
   * 设置 IPC 处理器（幂等：只注册一次，避免 Electron 抛出重复 handler 错误）
   */
  #setupIPCHandlers() {
    if (this.#handlersSetup) {
      return;
    }
    this.#handlersSetup = true;

    // 处理连接请求
    this.#ipcMain.handle(IPCMessageType.CONNECT, (event) => {
      const windowId = event.sender.id;
      this.#windows.add(windowId);
      this.#windowSenders.set(windowId, event.sender);
      this.emit('window-connected', { windowId });
      
      if (this.config.debug) {
        console.log(`[MainProcessIPC] 窗口已连接: ${windowId}`);
      }
      
      return { success: true, windowId };
    });

    // 处理断开连接
    this.#ipcMain.on(IPCMessageType.DISCONNECT, (event) => {
      const windowId = event.sender.id;
      this.#windows.delete(windowId);
      this.#windowSenders.delete(windowId);
      this.emit('window-disconnected', { windowId });
      
      if (this.config.debug) {
        console.log(`[MainProcessIPC] 窗口已断开: ${windowId}`);
      }
    });

    // 处理请求
    this.#ipcMain.on(IPCMessageType.REQUEST, async (event, messageData) => {
      try {
        const message = IPCMessage.fromJSON(messageData);
        
        // 验证消息
        const validation = this.validateMessage(message);
        if (!validation.valid) {
          event.sender.send(IPCMessageType.ERROR, 
            this.createError(message, new Error(validation.error)).toJSON()
          );
          return;
        }

        // 处理请求
        const response = await this.#handleRequest(message, event.sender);
        event.sender.send(IPCMessageType.RESPONSE, response.toJSON());
      } catch (error) {
        this.emit('error', error);
        event.sender.send(IPCMessageType.ERROR, {
          message: error.message,
          code: 'HANDLER_ERROR'
        });
      }
    });

    // 兼容 preload 中直接使用 ipcRenderer.invoke(channel, ...args) 的旧接口。
    const directInvokeChannels = [
      'agent:processInput',
      'agent:stop',
      'agent:getState',
      'agent:getSlashSuggestions',
      'agent:getTools',
      'agent:getStats',
      'system:getStats',
      'window:minimize',
      'window:maximize',
      'window:close',
      'window:show',
      'window:hide',
      'window:getState',
      'dialog:openFile',
      'dialog:saveFile',
      'dialog:openDirectory',
      'notification:show',
      'app:getInfo',
      'app:getPath',
      'app:openExternal',
      'workspace:setWorkingDirectory',
      'workspace:listDirectory',
      'workspace:readFile',
      'workspace:writeFile',
      'workspace:getFileDiff',
      'workspace:isGitRepo',
      'activity:undo',
      'activity:review',
      'activity:approve',
      'preview:start',
      'preview:list',
      'preview:stop',
      'llm:getConfigStatus',
      'llm:saveConfig',
      'llm:list-models',
      'llm:save-model',
      'llm:save-all-models',
      'llm:delete-model',
      'llm:toggle-model',
      'command:list',
      'command:run',
      'metrics:snapshot',
    ];

    for (const channel of directInvokeChannels) {
      this.#ipcMain.handle(channel, async (event, ...args) => {
        const payload = args.length <= 1 ? (args[0] ?? {}) : args;
        const message = new IPCMessage(IPCMessageType.REQUEST, payload, {
          metadata: { channel },
          source: 'renderer',
          target: 'main'
        });
        const response = await this.#handleRequest(message, event.sender);
        return response.payload;
      });
    }

    // 处理心跳响应
    this.#ipcMain.on(IPCMessageType.HEARTBEAT, (event, data) => {
      this.lastHeartbeat = Date.now();
      this.#windows.add(event.sender.id);
      this.#windowSenders.set(event.sender.id, event.sender);
    });

    // 处理事件订阅
    this.#ipcMain.on('ipc:subscribe', (event, eventName) => {
      this.#subscribeToEvent(eventName, event.sender);
    });

    // 处理事件取消订阅
  }

  /**
   * 处理请求
   */
  async #handleRequest(message, sender) {
    const channel = message.metadata?.channel;
    
    if (this.config.debug) {
      console.log(`[MainProcessIPC] 处理请求: ${channel}`, message.payload);
    }

    try {
      // 内置处理器
      switch (channel) {
        case 'agent:processInput':
          if (!this.#engine) {
            return this.createResponse(message, { success: false, error: '引擎未初始化' });
          }
          const input = message.payload?.input || message.payload;
          const debugCommandResult = this.#handleDebugCommand(input);
          if (debugCommandResult) {
            return this.createResponse(message, debugCommandResult);
          }
          const previewCommandResult = await this.#handlePreviewCommand(input);
          if (previewCommandResult) {
            return this.createResponse(message, previewCommandResult);
          }

          const result = input === 'init_rag' && Array.isArray(message.payload?.options?.docs)
            ? await handleDocumentBatchAdd(message.payload.options.docs, { engine: this.#engine })
            : parseDocumentCommand(input)
            ? await handleDocumentCommand(input, { engine: this.#engine })
            : await this.#engine.processInput(input, message.payload?.options || {});
          return this.createResponse(message, result);

        case 'agent:stop':
          if (this.#engine) {
            this.#engine.stop();
          }
          return this.createResponse(message, { success: true });

        case 'agent:getState':
          if (!this.#engine) {
            return this.createResponse(message, { status: 'not_initialized' });
          }
          return this.createResponse(message, this.#engine.getState());

        case 'agent:getTools':
          if (!this.#engine) {
            return this.createResponse(message, []);
          }
          return this.createResponse(message, this.#serializeTools(this.#engine.getTools()));

        case 'agent:getSlashSuggestions':
          if (!this.#engine) {
            return this.createResponse(message, []);
          }
          try {
            const suggestions = buildSlashCommandSuggestions(this.#engine.getTools() || []);
            return this.createResponse(message, suggestions);
          } catch (err) {
            return this.createResponse(message, []);
          }

        case 'agent:getStats':
        case 'system:getStats':
          return this.createResponse(message, this.getStats());

        case 'workspace:getFileDiff':
          return this.createResponse(message, await this.#handleFileDiff(message.payload));

        case 'workspace:readFile':
          return this.createResponse(message, await this.#handleReadWorkspaceFile(message.payload));

        case 'workspace:writeFile':
          return this.createResponse(message, await this.#handleWriteWorkspaceFile(message.payload));

        case 'workspace:isGitRepo':
          return this.createResponse(message, await this.#handleIsGitRepo());

        case 'activity:undo':
          return this.createResponse(message, await this.#handleActivityUndo(message.payload));

        case 'activity:review':
          return this.createResponse(message, await this.#handleActivityReview(message.payload));

        case 'activity:approve':
          return this.createResponse(message, await this.#handleActivityApprove(message.payload));

        default:
          // 自定义处理器
          const handler = this.#handlers.get(channel);
          if (handler) {
            const result = await handler(message.payload, sender);
            // 确保结果不为 undefined
            return this.createResponse(message, result !== undefined ? result : { success: true });
          }
          
          throw new Error(`未知的频道: ${channel}`);
      }
    } catch (error) {
      console.error(`[MainProcessIPC] 处理请求时出错 (${channel}):`, error);
      // 返回错误响应而不是抛出异常
      return this.createResponse(message, { 
        success: false, 
        error: error.message,
        channel 
      });
    }
  }

  #serializeTools(tools) {
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools.map(({ handler, execute, fn, ...tool }) => tool);
  }

  #handleDebugCommand(input) {
    const trimmedInput = String(input || '').trim();
    const match = trimmedInput.match(/^\/debug(?:\s+(status|on|off|enable|disable|true|false|toggle))?$/i);
    if (!match) {
      return null;
    }

    const action = (match[1] || 'toggle').toLowerCase();
    const current = typeof this.#engine.getDebugMode === 'function'
      ? this.#engine.getDebugMode()
      : false;

    let enabled = current;
    if (['on', 'enable', 'true'].includes(action)) {
      enabled = true;
    } else if (['off', 'disable', 'false'].includes(action)) {
      enabled = false;
    } else if (action === 'toggle') {
      enabled = !current;
    }

    if (action !== 'status') {
      this.#engine.setDebugMode(enabled);
      process.env.DEBUG = enabled ? 'true' : 'false';
    }

    const content = action === 'status'
      ? `调试模式当前${enabled ? '已开启' : '已关闭'}`
      : `调试模式已${enabled ? '开启' : '关闭'}`;

    this.broadcast(RuntimeEvent.STATUS_UPDATE, {
      message: content,
      level: enabled ? 'debug' : 'info',
      debug: enabled
    });

    return {
      success: true,
      localCommand: true,
      command: '/debug',
      debug: enabled,
      content
    };
  }

  async #handlePreviewCommand(input) {
    const trimmedInput = String(input || '').trim();
    if (!trimmedInput.toLowerCase().startsWith('/preview')) {
      return null;
    }

    const args = parsePreviewArgs(trimmedInput.slice('/preview'.length).trim());
    const subcommand = (args[0] || 'start').toLowerCase();

    if (subcommand === 'list') {
      return {
        success: true,
        localCommand: true,
        command: '/preview',
        content: 'Active preview sessions',
        previews: listPreviews()
      };
    }

    if (subcommand === 'stop') {
      const result = stopPreview(args[1]);
      return {
        ...result,
        localCommand: true,
        command: '/preview',
        content: result.success ? `Preview stopped: ${args[1]}` : result.error
      };
    }

    const kind = ['static', 'node', 'auto'].includes(subcommand) ? subcommand : 'auto';
    const target = ['static', 'node', 'auto'].includes(subcommand)
      ? (args[1] || '.')
      : (args[0] || '.');
    const command = kind === 'node' && args.length > 2 ? args.slice(2).join(' ') : undefined;
    const preview = await startPreview({
      workingDirectory: this.#engine?.getConfig?.().workingDirectory,
      target,
      kind,
      command,
    });
    this.broadcast('preview:started', preview);
    return {
      ...preview,
      localCommand: true,
      command: '/preview',
      content: `Preview ready: ${preview.url}`,
    };
  }

  async #handleIsGitRepo() {
    const workingDirectory = this.#engine?.getConfig?.().workingDirectory || process.cwd();
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: workingDirectory });
      return { isGitRepo: true };
    } catch {
      return { isGitRepo: false };
    }
  }

  #resolveWorkspacePath(filePath) {
    const requestedPath = String(filePath || '').trim();
    if (!requestedPath) {
      throw new Error('Missing file path.');
    }

    const workingDirectory = this.#engine?.getConfig?.().workingDirectory || process.cwd();
    const root = path.resolve(workingDirectory);
    const absolutePath = path.resolve(root, requestedPath);
    const relativePath = path.relative(root, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('Path is outside the current workspace.');
    }

    return {
      absolutePath,
      relativePath: relativePath || path.basename(absolutePath),
      workingDirectory: root,
    };
  }

  async #handleReadWorkspaceFile(payload = {}) {
    try {
      const { absolutePath, relativePath } = this.#resolveWorkspacePath(payload?.path || payload?.target);
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) {
        return { success: false, error: 'Selected path is not a file.', path: relativePath };
      }

      const maxBytes = Number(payload?.maxBytes || 512 * 1024);
      if (stat.size > maxBytes) {
        return {
          success: false,
          error: `File is too large to preview (${stat.size} bytes).`,
          path: relativePath,
          size: stat.size,
        };
      }

      const content = fs.readFileSync(absolutePath, 'utf8');
      return {
        success: true,
        path: relativePath,
        name: path.basename(absolutePath),
        content,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      return { success: false, error: error.message || 'Unable to read file.' };
    }
  }

  async #handleWriteWorkspaceFile(payload = {}) {
    try {
      const { absolutePath, relativePath, workingDirectory } = this.#resolveWorkspacePath(payload?.path || payload?.target);
      const content = String(payload?.content ?? '');
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, 'utf8');
      const stat = fs.statSync(absolutePath);
      this.broadcast('workspace:changed', {
        path: relativePath,
        workingDirectory,
        action: 'write',
      });
      return {
        success: true,
        path: relativePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      return { success: false, error: error.message || 'Unable to write file.' };
    }
  }

  async #handleFileDiff(payload = {}) {
    const filePath = String(payload?.path || payload?.target || '').trim();
    if (!filePath) {
      return { success: false, error: 'Missing file path.' };
    }

    const workingDirectory = this.#engine?.getConfig?.().workingDirectory || process.cwd();
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], {
        cwd: workingDirectory,
      });

      const { stdout } = await execFileAsync('git', ['diff', '--', filePath], {
        cwd: workingDirectory,
        maxBuffer: 1024 * 1024,
      });
      return {
        success: true,
        path: filePath,
        diff: stdout || '',
        hasDiff: Boolean(stdout && stdout.trim()),
        source: 'git',
      };
    } catch (gitError) {
      try {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(workingDirectory, filePath);
        const newContent = fs.readFileSync(absPath, 'utf8');
        const oldContent = this.#engine?.workspaceState?.getFileSnapshot(filePath)?.content ||
                           this.#engine?.workspaceState?.getFileSnapshot(absPath)?.content || '';

        const diff = computeDiff({ path: filePath, oldContent, newContent });
        const hasDiff = !isNoop(diff);

        return {
          success: true,
          path: filePath,
          diff: diff.unifiedDiff,
          hasDiff,
          source: 'snapshot',
        };
      } catch (snapshotError) {
        return {
          success: false,
          path: filePath,
          error: snapshotError.message || '无法读取文件内容',
          diff: '',
          hasDiff: false,
        };
      }
    }
  }

  async #handleActivityUndo(payload = {}) {
    const activity = payload?.activity || payload || {};
    const target = String(activity.target || payload?.target || '').trim();
    const diff = target ? await this.#handleFileDiff({ path: target }) : null;
    const result = {
      success: true,
      action: 'undo',
      mode: payload?.confirm === true ? 'not_implemented' : 'prepare',
      requiresConfirmation: payload?.confirm !== true,
      activity,
      target,
      diff: diff?.diff || '',
      hasDiff: Boolean(diff?.hasDiff),
      message: payload?.confirm === true
        ? '结构化撤销通道已接收确认，但自动写回尚未启用。'
        : '已准备撤销信息，请确认后再执行写回。',
    };
    this.broadcast('activity:undo', result);
    return result;
  }

  async #handleActivityReview(payload = {}) {
    const activity = payload?.activity || payload || {};
    const target = String(activity.target || payload?.target || '').trim();
    const diff = target ? await this.#handleFileDiff({ path: target }) : null;
    const result = {
      success: true,
      action: 'review',
      activity,
      target,
      diff: diff?.diff || '',
      hasDiff: Boolean(diff?.hasDiff),
      message: diff?.hasDiff ? '已获取文件 diff，可在 UI 中审核。' : '没有可显示的未提交 diff。',
    };
    this.broadcast('activity:review', result);
    return result;
  }

  async #handleActivityApprove(payload = {}) {
    const activity = payload?.activity || payload || {};
    const input = String(payload?.input || payload?.answer || '').trim() || '我确认继续。';
    const result = this.#engine
      ? await this.#engine.processInput(input, {
        continuation: true,
        activityAction: 'approve',
        activity,
      })
      : { success: false, error: '引擎未初始化' };
    this.broadcast('activity:approve', { success: result?.success !== false, action: 'approve', activity, result });
    return result;
  }

  /**
   * 订阅事件
   */
  #subscribeToEvent(eventName, sender) {
    if (!this.eventSubscriptions.has(eventName)) {
      this.eventSubscriptions.set(eventName, new Map());
    }
    
    this.eventSubscriptions.get(eventName).set(sender.id, sender);
    
    if (this.config.debug) {
      console.log(`[MainProcessIPC] 窗口 ${sender.id} 订阅事件: ${eventName}`);
    }
  }

  /**
   * 取消订阅事件
   */
  #unsubscribeFromEvent(eventName, windowId) {
    if (this.eventSubscriptions.has(eventName)) {
      this.eventSubscriptions.get(eventName).delete(windowId);
    }
    
    if (this.config.debug) {
      console.log(`[MainProcessIPC] 窗口 ${windowId} 取消订阅事件: ${eventName}`);
    }
  }

  /**
   * 注册自定义处理器 —— 同时注册到 IPC handler Map 与 ipcMain.handle
   * 确保渲染进程可用 ipcRenderer.invoke(channel, ...args) 直接调用。
   */
  registerHandler(channel, handler) {
    this.#handlers.set(channel, handler);

    if (this.#ipcMain && typeof this.#ipcMain.handle === 'function') {
      if (typeof this.#ipcMain.removeHandler === 'function') {
        try {
          this.#ipcMain.removeHandler(channel);
        } catch (e) {
          // 忽略未注册时的错误
        }
      }
      try {
        this.#ipcMain.handle(channel, async (event, ...args) => {
          try {
            const payload = args.length <= 1 ? (args[0] ?? {}) : args;
            const result = await handler(payload, event.sender);
            return result !== undefined ? result : { success: true };
          } catch (error) {
            console.error(`[MainProcessIPC] invoke ${channel} 失败:`, error);
            throw error;
          }
        });
      } catch (registerError) {
        console.warn(`[MainProcessIPC] registerHandler ${channel} ipcMain.handle 失败，将通过 #handleRequest 降级处理:`, registerError?.message);
      }
    }

    if (this.config.debug) {
      console.log(`[MainProcessIPC] 注册处理器: ${channel}`);
    }
  }

  /**
   * 注销处理器
   */
  unregisterHandler(channel) {
    this.#handlers.delete(channel);
    if (this.#ipcMain && typeof this.#ipcMain.removeHandler === 'function') {
      try {
        this.#ipcMain.removeHandler(channel);
      } catch (e) {
        // 忽略未注册 handler 的情况
      }
    }
  }

  /**
   * 附加引擎
   */
  attachEngine(engine) {
    this.#engine = engine;
    
    if (this.config.debug) {
      console.log('[MainProcessIPC] 引擎已附加');
    }
  }

  /**
   * 发送消息到指定窗口
   */
  async send(message, windowId) {
    if (!this.isConnected) {
      throw new Error('IPC 未连接');
    }

    // 如果消息在队列中，先处理队列
    if (this.config.enableQueue && this.messageQueue.size() > 0) {
      this.#processQueue();
    }

    // 查找窗口
    const window = this.#getWindow(windowId);
    if (!window) {
      throw new Error(`窗口未找到: ${windowId}`);
    }

    window.send(message.type, message.toJSON());
    return message;
  }

  /**
   * 广播消息到所有窗口
   */
  broadcast(eventName, data) {
    const message = this.createEvent(eventName, data);
    const deliveredWindowIds = new Set();
    
    for (const windowId of this.#windows) {
      const window = this.#getWindow(windowId);
      if (window) {
        window.send(IPCMessageType.EVENT, message.toJSON());
        window.send(eventName, data);
        deliveredWindowIds.add(windowId);
      }
    }

    // 也发送给订阅者
    if (this.eventSubscriptions.has(eventName)) {
      for (const [id, sender] of this.eventSubscriptions.get(eventName)) {
        if (this.#windows.has(id) && !deliveredWindowIds.has(id)) {
          sender.send(IPCMessageType.EVENT, message.toJSON());
          sender.send(eventName, data);
        }
      }
    }
  }

  /**
   * 处理消息队列
   */
  #processQueue() {
    while (this.messageQueue.size() > 0) {
      const message = this.messageQueue.dequeue();
      this.send(message).catch(err => {
        this.emit('error', err);
      });
    }
  }

  /**
   * 获取窗口
   */
  #getWindow(windowId) {
    const sender = this.#windowSenders.get(windowId);
    if (sender && typeof sender.send === 'function') {
      return sender;
    }

    // 测试或未连接场景下保留一个可调用的兜底对象。
    return {
      id: windowId,
      send: (channel, data) => {
        if (this.config.debug) {
          console.log(`[MainProcessIPC] 发送到窗口 ${windowId}:`, channel, data);
        }
      }
    };
  }

  /**
   * 连接
   */
  async connect() {
    this.isConnected = true;
    this.startHeartbeat();
    this.emit('connected');
    return true;
  }

  /**
   * 断开连接
   */
  disconnect() {
    super.disconnect();
    this.#windows.clear();
    this.#windowSenders.clear();
    this.#handlersSetup = false;
    this.removeAllListeners();
    
    if (this.config.debug) {
      console.log('[MainProcessIPC] 适配器已断开');
    }
  }

  /**
   * 获取连接的窗口数量
   */
  getWindowCount() {
    return this.#windows.size;
  }

  /**
   * 获取所有窗口 ID
   */
  getWindowIds() {
    return Array.from(this.#windows);
  }
}

/**
 * 渲染进程 IPC 适配器
 * 用于 Electron 渲染进程（React UI 等）
 */
export class RendererProcessIPCAdapter extends IPCAdapterBase {
  #ipcRenderer;
  #eventListeners;

  constructor(ipcRenderer, config = {}) {
    super(config);
    this.#ipcRenderer = ipcRenderer;
    this.#eventListeners = new Map();
  }

  /**
   * 初始化适配器
   */
  async initialize() {
    this.#setupListeners();
    
    // 发送连接请求
    try {
      await this.#ipcRenderer.invoke(IPCMessageType.CONNECT);
      this.isConnected = true;
      this.startHeartbeat();
      
      if (this.config.debug) {
        console.log('[RendererProcessIPC] 已连接到主进程');
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 设置监听器
   */
  #setupListeners() {
    // 监听响应
    this.#ipcRenderer.on(IPCMessageType.RESPONSE, (event, data) => {
      const message = IPCMessage.fromJSON(data);
      const pending = this.pendingRequests.get(message.correlationId);
      
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.correlationId);
        pending.resolve(message.payload);
      }
    });

    // 监听错误
    this.#ipcRenderer.on(IPCMessageType.ERROR, (event, data) => {
      const message = IPCMessage.fromJSON(data);
      const pending = this.pendingRequests.get(message.correlationId);
      
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.correlationId);
        pending.reject(new Error(message.payload.message || 'IPC 错误'));
      }
      
      this.emit('error', new Error(message.payload.message));
    });

    // 监听事件
    this.#ipcRenderer.on(IPCMessageType.EVENT, (event, data) => {
      const message = IPCMessage.fromJSON(data);
      const eventName = message.metadata?.eventName;
      
      if (eventName && this.#eventListeners.has(eventName)) {
        for (const callback of this.#eventListeners.get(eventName)) {
          try {
            callback(message.payload);
          } catch (error) {
            this.emit('error', error);
          }
        }
      }
      
      this.emit('event', { eventName, data: message.payload });
    });

    // 监听心跳
    this.#ipcRenderer.on(IPCMessageType.HEARTBEAT, (event, data) => {
      this.lastHeartbeat = Date.now();
      event.sender.send(IPCMessageType.HEARTBEAT, { timestamp: Date.now() });
    });
  }

  /**
   * 发送请求并等待响应
   */
  async request(channel, payload, options = {}) {
    if (!this.isConnected) {
      // 如果启用了队列，将消息加入队列
      if (this.config.enableQueue) {
        const message = this.createRequest(channel, payload, options);
        this.messageQueue.enqueue(message);
        return null;
      }
      throw new Error('IPC 未连接');
    }

    const message = this.createRequest(channel, payload, options);
    const requestId = message.id;
    
    return new Promise((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.handleTimeout(requestId);
        reject(new Error(`请求超时: ${channel}`));
      }, options.timeout || this.config.requestTimeout);

      // 存储待处理请求
      this.pendingRequests.set(requestId, { resolve, reject, timer });

      // 发送请求
      this.#ipcRenderer.send(IPCMessageType.REQUEST, message.toJSON());
      
      if (this.config.debug) {
        console.log(`[RendererProcessIPC] 发送请求: ${channel}`, payload);
      }
    });
  }

  /**
   * 实际发送逻辑（重写基类方法，基类已统一做了连接状态检查和队列管理
   */
  async _sendImpl(message) {
    this.#ipcRenderer.send(message.type, message.toJSON());
    return message;
  }

  /**
   * 订阅事件
   */
  subscribe(eventName, callback) {
    if (!this.#eventListeners.has(eventName)) {
      this.#eventListeners.set(eventName, new Set());
      
      // 通知主进程订阅事件
      this.#ipcRenderer.send('ipc:subscribe', eventName);
    }
    
    this.#eventListeners.get(eventName).add(callback);
    
    // 返回取消订阅函数
    return () => {
      this.unsubscribe(eventName, callback);
    };
  }

  /**
   * 取消订阅事件
   */
  unsubscribe(eventName, callback) {
    if (this.#eventListeners.has(eventName)) {
      this.#eventListeners.get(eventName).delete(callback);
      
      // 如果没有监听器了，通知主进程取消订阅
      if (this.#eventListeners.get(eventName).size === 0) {
        this.#eventListeners.delete(eventName);
        this.#ipcRenderer.send('ipc:unsubscribe', eventName);
      }
    }
  }

  /**
   * 便捷方法：处理输入
   */
  async processInput(input, options = {}) {
    return this.request('agent:processInput', { input, options });
  }

  /**
   * 便捷方法：停止代理
   */
  async stop() {
    return this.request('agent:stop');
  }

  /**
   * 便捷方法：获取状态
   */
  async getState() {
    return this.request('agent:getState');
  }

  /**
   * 便捷方法：获取工具列表
   */
  async getTools() {
    return this.request('agent:getTools');
  }

  /**
   * 便捷方法：获取 slash 补全建议
   */
  async getSlashSuggestions() {
    return this.request('agent:getSlashSuggestions');
  }

  /**
   * 便捷方法：获取统计信息
   */
  async getStats() {
    return this.request('system:getStats');
  }

  /**
   * 连接
   */
  async connect() {
    return this.initialize();
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.#ipcRenderer.send(IPCMessageType.DISCONNECT);
    super.disconnect();
    this.#eventListeners.clear();
    
    if (this.config.debug) {
      console.log('[RendererProcessIPC] 已断开连接');
    }
  }
}

/**
 * 创建主进程 IPC 适配器
 */
export function createMainProcessIPCAdapter(ipcMain, eventBus, config = {}) {
  return new MainProcessIPCAdapter(ipcMain, eventBus, config);
}

/**
 * 创建渲染进程 IPC 适配器
 */
export function createRendererProcessIPCAdapter(ipcRenderer, config = {}) {
  return new RendererProcessIPCAdapter(ipcRenderer, config);
}

/**
 * DesktopIPCAdapter - 兼容旧版本的适配器
 * @deprecated 使用 MainProcessIPCAdapter 替代
 */
export class DesktopIPCAdapter extends MainProcessIPCAdapter {
  constructor(eventBus, ipcMain) {
    super(ipcMain, eventBus);
    console.warn('[DEPRECATED] DesktopIPCAdapter 已弃用，请使用 MainProcessIPCAdapter');
  }
}
