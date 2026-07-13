import { IPCMessage, IPCMessageType } from '../protocol/ipc-protocol.js';
import { IPCAdapterBase } from './base-adapter.js';
import {
  handleActivityApprove,
  handleActivityReview,
  handleActivityUndo,
} from './main-process/activity-handlers.js';
import {
  handleDebugCommand,
  handlePreviewCommand,
  serializeTools,
} from './main-process/agent-command-handlers.js';
import { DIRECT_INVOKE_CHANNELS } from './main-process/channels.js';
import {
  handleCreateWorkspaceDirectory,
  handleCreateWorkspaceFile,
  handleDeleteWorkspaceItem,
  handleFileDiff,
  handleIsGitRepo,
  handleReadWorkspaceFile,
  handleRenameWorkspaceItem,
  handleWriteWorkspaceFile,
} from './main-process/workspace-handlers.js';

const buildSlashCommandSuggestions = () => [];
const parseDocumentCommand = () => null;
const handleDocumentCommand = async () => ({ success: false, error: 'OMP 请直接使用内置文件工具读取文档' });
const handleDocumentBatchAdd = handleDocumentCommand;

/**
 * 主进程 IPC 适配器
 * 用于 Electron 主进程
 */
export class MainProcessIPCAdapter extends IPCAdapterBase {
  #ipcMain;
  #eventBus;
  #eventBusUnsub;
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

    if (this.#eventBus) {
      this.#eventBusUnsub = this.#eventBus.subscribe('*', (eventData) => {
        const eventName = eventData?.type;
        if (!eventName) {
          return;
        }
        try {
          this.broadcast(eventName, eventData);
        } catch (err) {
          if (this.config.debug) {
            console.warn('[MainProcessIPC] 转发事件失败:', eventName, err);
          }
        }
      });
    }

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
          event.sender.send(
            IPCMessageType.ERROR,
            this.createError(message, new Error(validation.error)).toJSON(),
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
          code: 'HANDLER_ERROR',
        });
      }
    });

    // 兼容 preload 中直接使用 ipcRenderer.invoke(channel, ...args) 的旧接口。
    for (const channel of DIRECT_INVOKE_CHANNELS) {
      this.#ipcMain.handle(channel, async (event, ...args) => {
        const payload = args.length <= 1 ? (args[0] ?? {}) : args;
        const message = new IPCMessage(IPCMessageType.REQUEST, payload, {
          metadata: { channel },
          source: 'renderer',
          target: 'main',
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
          const processOptions = message.payload?.options || {};
          if (processOptions.sessionId && typeof this.#engine.setSessionId === 'function') {
            this.#engine.setSessionId(processOptions.sessionId);
          }
          const handlerContext = this.#createHandlerContext();
          const debugCommandResult = handleDebugCommand(input, handlerContext);
          if (debugCommandResult) {
            return this.createResponse(message, debugCommandResult);
          }
          const previewCommandResult = await handlePreviewCommand(input, handlerContext);
          if (previewCommandResult) {
            return this.createResponse(message, previewCommandResult);
          }

          const result =
            input === 'init_rag' && Array.isArray(message.payload?.options?.docs)
              ? await handleDocumentBatchAdd(processOptions.docs, { engine: this.#engine })
              : parseDocumentCommand(input)
                ? await handleDocumentCommand(input, { engine: this.#engine })
                : await this.#engine.processInput(input, processOptions);
          return this.createResponse(message, result);

        case 'agent:stop':
          if (this.#engine) {
            this.#engine.stop();
          }
          return this.createResponse(message, { success: true });

        case 'agent:steer':
          return this.createResponse(message, await this.#engine.steer(message.payload?.message || message.payload, message.payload?.images));

        case 'agent:followUp':
          return this.createResponse(message, await this.#engine.followUp(message.payload?.message || message.payload, message.payload?.images));

        case 'agent:respondInteraction':
          return this.createResponse(message, this.#engine.respondToInteraction(message.payload?.requestId, message.payload?.response));

        case 'omp:getState':
          return this.createResponse(message, this.#engine.getState());

        case 'omp:getAvailableModels':
          return this.createResponse(message, await this.#engine.getAvailableModels());

        case 'omp:setModel':
          return this.createResponse(message, await this.#engine.setModel(message.payload?.provider, message.payload?.modelId));

        case 'omp:cycleModel':
          return this.createResponse(message, await this.#engine.cycleModel());

        case 'omp:setThinkingLevel':
          return this.createResponse(message, await this.#engine.setThinkingLevel(message.payload?.level));

        case 'omp:cycleThinkingLevel':
          return this.createResponse(message, await this.#engine.cycleThinkingLevel());

        case 'agent:getState':
          if (!this.#engine) {
            return this.createResponse(message, { status: 'not_initialized' });
          }
          return this.createResponse(message, this.#engine.getState());

        case 'agent:getTools':
          if (!this.#engine) {
            return this.createResponse(message, []);
          }
          return this.createResponse(message, serializeTools(this.#engine.getTools()));

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
          return this.createResponse(
            message,
            await handleFileDiff(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:readFile':
          return this.createResponse(
            message,
            await handleReadWorkspaceFile(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:writeFile':
          return this.createResponse(
            message,
            await handleWriteWorkspaceFile(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:createFile':
          return this.createResponse(
            message,
            await handleCreateWorkspaceFile(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:createDirectory':
          return this.createResponse(
            message,
            await handleCreateWorkspaceDirectory(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:deleteFile':
          return this.createResponse(
            message,
            await handleDeleteWorkspaceItem(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:rename':
          return this.createResponse(
            message,
            await handleRenameWorkspaceItem(message.payload, this.#createHandlerContext()),
          );

        case 'workspace:isGitRepo':
          return this.createResponse(message, await handleIsGitRepo(this.#createHandlerContext()));

        case 'activity:undo':
          return this.createResponse(
            message,
            await handleActivityUndo(message.payload, this.#createHandlerContext()),
          );

        case 'activity:review':
          return this.createResponse(
            message,
            await handleActivityReview(message.payload, this.#createHandlerContext()),
          );

        case 'activity:approve':
          return this.createResponse(
            message,
            await handleActivityApprove(message.payload, this.#createHandlerContext()),
          );

        default:
          // 自定义处理器
          const handler = this.#handlers.get(channel);
          if (handler) {
            const result = await handler(message.payload, sender);
            // 确保结果不为 undefined
            return this.createResponse(message, result !== undefined ? result : { success: true });
          }

          // 未注册或未知频道：统一返回友好错误响应（不抛异常，避免污染日志）
          return this.createResponse(message, {
            success: false,
            error: DIRECT_INVOKE_CHANNELS.includes(channel)
              ? `处理器未注册: ${channel}`
              : `未知的频道: ${channel}`,
            code: DIRECT_INVOKE_CHANNELS.includes(channel)
              ? 'HANDLER_NOT_REGISTERED'
              : 'UNKNOWN_CHANNEL',
            channel,
          });
      }
    } catch (error) {
      console.error(`[MainProcessIPC] 处理请求时出错 (${channel}):`, error);
      // 返回错误响应而不是抛出异常
      return this.createResponse(message, {
        success: false,
        error: error.message,
        channel,
      });
    }
  }

  #createHandlerContext() {
    return {
      engine: this.#engine,
      broadcast: this.broadcast.bind(this),
    };
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
        console.warn(
          `[MainProcessIPC] registerHandler ${channel} ipcMain.handle 失败，将通过 #handleRequest 降级处理:`,
          registerError?.message,
        );
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

  attachDesktopCore(core) {
    this.attachEngine(core?.getEngine?.() || core?.engine || core);
    return this;
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
      this.send(message).catch((err) => {
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
      },
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
