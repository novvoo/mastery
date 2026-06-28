import { IPCMessage, IPCMessageType } from '../protocol/ipc-protocol.js';
import { IPCAdapterBase } from './base-adapter.js';

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
      }, options.timeout ?? this.config.requestTimeout);

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
