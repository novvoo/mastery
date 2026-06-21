import { EventEmitter } from 'events';
import { DEFAULT_CONFIG, IPCMessage, IPCMessageStatus, IPCMessageType, MessageQueue } from '../protocol/ipc-protocol.js';

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
