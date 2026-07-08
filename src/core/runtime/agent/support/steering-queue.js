/**
 * Steering 消息处理机制
 *
 * 参考 oh-my-pi 的 user-interjection.md 和 steer queue 实现。
 *
 * Steering 允许用户在 Agent 运行过程中发送新消息，
 * 这些消息会被注入到当前对话中，优先于之前的指令。
 *
 * 使用方式：
 * 1. 创建 SteeringQueue 实例
 * 2. 用户中途输入时调用 queueSteer(message)
 * 3. Agent 主循环中检查并处理 queued steers
 */

/**
 * 用户转向消息模板
 * 参考 oh-my-pi 的 user-interjection.md
 */
const USER_INTERJECTION_TEMPLATE = `<user_interjection>
The user sent this message as an interjection while you were working. It takes
priority and supersedes earlier instructions wherever they conflict — re-read it
and make sure your current work reflects their intent.

<message>
{{message}}
</message>
</user_interjection>`;

/**
 * Steering 消息类型
 */
export const SteeringMessageType = {
  /** 用户中途输入的新指令 */
  USER_INTERJECTION: 'user_interjection',
  /** 系统发出的转向提醒 */
  SYSTEM_REMINDER: 'system_reminder',
  /** 来自协作方的消息 */
  COLLAB_MESSAGE: 'collab_message',
};

/**
 * Steering 消息队列
 */
export class SteeringQueue {
  #queue = [];
  #maxQueueSize = 10;
  #onSteerQueued = null;

  constructor(options = {}) {
    this.#maxQueueSize = options.maxQueueSize || 10;
    this.#onSteerQueued = options.onSteerQueued;
  }

  /**
   * 添加一条 steering 消息到队列
   *
   * @param {string} message - 消息内容
   * @param {object} options - 选项
   * @param {string} options.type - 消息类型 (default: 'user_interjection')
   * @param {object} options.metadata - 附加元数据
   * @returns {boolean} 是否成功添加
   */
  queueSteer(message, options = {}) {
    if (this.#queue.length >= this.#maxQueueSize) {
      console.warn('[SteeringQueue] Queue full, dropping oldest steer');
      this.#queue.shift();
    }

    const steer = {
      id: `steer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message,
      type: options.type || SteeringMessageType.USER_INTERJECTION,
      metadata: options.metadata || {},
      queuedAt: Date.now(),
    };

    this.#queue.push(steer);

    if (this.#onSteerQueued) {
      this.#onSteerQueued(steer);
    }

    return true;
  }

  /**
   * 检查是否有待处理的 steering 消息
   *
   * @returns {boolean}
   */
  hasPendingSteer() {
    return this.#queue.length > 0;
  }

  /**
   * 获取所有待处理的 steering 消息
   *
   * @returns {Array} 待处理的消息列表
   */
  getPendingSteers() {
    return [...this.#queue];
  }

  /**
   * 弹出下一条 steering 消息
   *
   * @returns {object|null} 下一条消息或 null
   */
  popSteer() {
    return this.#queue.shift() || null;
  }

  /**
   * 清空队列
   */
  clear() {
    this.#queue = [];
  }

  /**
   * 获取队列长度
   */
  get length() {
    return this.#queue.length;
  }

  /**
   * 渲染 steering 消息为 LLM 可读格式
   *
   * @param {object} steer - Steering 消息对象
   * @returns {string} 渲染后的消息
   */
  renderSteer(steer) {
    switch (steer.type) {
      case SteeringMessageType.USER_INTERJECTION:
        return USER_INTERJECTION_TEMPLATE.replace('{{message}}', steer.message);

      case SteeringMessageType.SYSTEM_REMINDER:
        return `<system_reminder>
${steer.message}
</system_reminder>`;

      case SteeringMessageType.COLLAB_MESSAGE:
        return `<collab_message>
From: ${steer.metadata?.from || 'unknown'}
${steer.message}
</collab_message>`;

      default:
        return steer.message;
    }
  }

  /**
   * 将所有待处理的 steering 消息合并为一条消息
   * 用于批量注入到对话中
   *
   * @returns {string|null} 合并后的消息或 null
   */
  drainAndMerge() {
    if (this.#queue.length === 0) {
      return null;
    }

    const steers = [...this.#queue];
    this.clear();

    // 单条消息直接渲染
    if (steers.length === 1) {
      return this.renderSteer(steers[0]);
    }

    // 多条消息合并渲染
    const parts = steers.map((s) => this.renderSteer(s));
    return `<multiple_interjections>
The user has sent multiple interjections while you were working. Read all of them
and make sure your current work reflects their latest intent.

${parts.join('\n\n')}
</multiple_interjections>`;
  }

  /**
   * 检查队列是否有超时的消息并清理
   *
   * @param {number} maxAgeMs - 最大保留时间（毫秒）
   * @returns {number} 清理的消息数量
   */
  pruneExpired(maxAgeMs = 300000) {
    const now = Date.now();
    const originalLength = this.#queue.length;
    this.#queue = this.#queue.filter((s) => now - s.queuedAt < maxAgeMs);
    return originalLength - this.#queue.length;
  }
}

/**
 * 创建用户转向消息的便捷函数
 *
 * @param {string} message - 用户消息
 * @returns {string} 格式化的转向消息
 */
export function createUserInterjection(message) {
  return USER_INTERJECTION_TEMPLATE.replace('{{message}}', message);
}

/**
 * 检查消息是否是转向消息
 *
 * @param {string} message - 消息内容
 * @returns {boolean}
 */
export function isSteeringMessage(message) {
  return message.includes('<user_interjection>') ||
         message.includes('<system_reminder>') ||
         message.includes('<collab_message>');
}

/**
 * 从消息中提取转向内容
 *
 * @param {string} message - 包含转向标记的消息
 * @returns {string|null} 提取的内容或 null
 */
export function extractSteerContent(message) {
  // 匹配 <message>...</message> 标签内容
  const match = message.match(/<message>\s*([\s\S]*?)\s*<\/message>/);
  if (match) {
    return match[1].trim();
  }

  // 匹配纯文本转向消息
  const interjectionMatch = message.match(/<user_interjection>[\s\S]*?<message>([\s\S]*?)<\/message>[\s\S]*?<\/user_interjection>/);
  if (interjectionMatch) {
    return interjectionMatch[1].trim();
  }

  return null;
}

export default {
  SteeringQueue,
  SteeringMessageType,
  createUserInterjection,
  isSteeringMessage,
  extractSteerContent,
  USER_INTERJECTION_TEMPLATE,
};