/**
 * Desktop IPC protocol primitives shared by main and renderer adapters.
 */

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
export const DEFAULT_CONFIG = {
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

export function parsePreviewArgs(text = '') {
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
