/**
 * MessageBus.js
 * 消息总线实现 - 用于子代理间通信
 */

/**
 * 消息总线类
 * 提供代理间的消息传递机制
 */
export class MessageBus {
  /**
   * 创建消息总线实例
   * @param {Object} options - 配置选项
   * @param {number} [options.maxHistory=1000] - 最大历史消息数量
   */
  constructor(options = {}) {
    this.maxHistory = options.maxHistory ?? 1000;
    this.#handlers = new Map();
    this.#history = [];
  }

  #handlers;
  #history;

  /**
   * 发送消息
   * @param {Object} message - 消息对象
   * @param {string} message.from - 发送者ID
   * @param {string} message.to - 接收者ID
   * @param {string} message.event - 事件类型
   * @param {*} [message.data] - 消息数据
   * @returns {Object} 带ID的完整消息对象
   */
  send(message) {
    // 验证必要字段
    if (!message.from || !message.to || !message.event) {
      throw new Error('Message must have from, to, and event fields');
    }

    // 创建完整消息对象
    const fullMessage = {
      id: this.#generateId(),
      from: message.from,
      to: message.to,
      event: message.event,
      data: message.data,
      timestamp: Date.now(),
    };

    // 保存到历史
    if (this.maxHistory > 0) {
      this.#history.push(fullMessage);
    }

    // 限制历史数量
    if (this.#history.length > this.maxHistory) {
      this.#history = this.#history.slice(-this.maxHistory);
    }

    // 触发接收者的处理器
    const handlers = this.#handlers.get(message.to);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(fullMessage);
        } catch (error) {
          console.error(`Error in message handler for '${message.to}':`, error);
        }
      }
    }

    return fullMessage;
  }

  /**
   * 订阅消息
   * @param {string} agentId - 代理ID
   * @param {Function} handler - 消息处理器
   * @returns {Function} 取消订阅函数
   */
  subscribe(agentId, handler) {
    if (!this.#handlers.has(agentId)) {
      this.#handlers.set(agentId, new Set());
    }

    this.#handlers.get(agentId).add(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.#handlers.get(agentId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.#handlers.delete(agentId);
        }
      }
    };
  }

  /**
   * 获取历史消息
   * @param {Object} options - 过滤选项
   * @param {string} [options.from] - 按发送者过滤
   * @param {string} [options.to] - 按接收者过滤
   * @param {string} [options.event] - 按事件类型过滤
   * @param {number} [options.limit] - 返回数量限制
   * @returns {Array<Object>} 消息数组
   */
  getHistory(options = {}) {
    let messages = [...this.#history];

    // 按发送者过滤
    if (options.from) {
      messages = messages.filter((m) => m.from === options.from);
    }

    // 按接收者过滤
    if (options.to) {
      messages = messages.filter((m) => m.to === options.to);
    }

    // 按事件类型过滤
    if (options.event) {
      messages = messages.filter((m) => m.event === options.event);
    }

    // 按时间降序排序（最新的在前）
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // 限制数量
    if (Number.isInteger(options.limit) && options.limit >= 0) {
      messages = messages.slice(0, options.limit);
    }

    return messages;
  }

  /**
   * 广播消息（发送给除发送者外的所有代理）
   * @param {string} from - 发送者ID
   * @param {string} event - 事件类型
   * @param {*} data - 消息数据
   * @returns {Array<Object>} 发送的消息数组
   */
  broadcast(from, event, data) {
    const messages = [];

    // 获取所有订阅者（排除发送者）
    for (const agentId of this.#handlers.keys()) {
      if (agentId !== from) {
        const message = this.send({
          from,
          to: agentId,
          event,
          data,
        });
        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * 生成唯一ID
   * @private
   * @returns {string}
   */
  #generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清空历史消息
   */
  clearHistory() {
    this.#history = [];
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      historyCount: this.#history.length,
      subscriberCount: this.#handlers.size,
      subscribers: Array.from(this.#handlers.keys()),
    };
  }
}

export default MessageBus;
