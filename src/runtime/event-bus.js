/**
 * Event Bus for cross-platform communication
 * Enables decoupled communication between runtime and adapters
 * 
 * 增强功能：
 * - 事件优先级支持（high/medium/low）
 * - 事件过滤器功能（支持按类型、来源、数据过滤）
 * - 性能优化（批量事件处理、延迟订阅、事件缓存）
 * - 事件历史记录和回放功能
 * - 异步事件支持
 */

import { EventEmitter } from 'events';

/**
 * 事件优先级枚举
 * @enum {string}
 */
export const EventPriority = {
  HIGH: 'high',      // 高优先级，优先执行
  MEDIUM: 'medium',  // 中等优先级，默认值
  LOW: 'low'         // 低优先级，最后执行
};

/**
 * 优先级权重映射，用于排序
 */
const PRIORITY_WEIGHT = {
  [EventPriority.HIGH]: 3,
  [EventPriority.MEDIUM]: 2,
  [EventPriority.LOW]: 1
};

/**
 * 默认事件历史记录配置
 */
const DEFAULT_HISTORY_CONFIG = {
  enabled: true,           // 是否启用历史记录
  maxSize: 1000,           // 最大历史记录数量
  includeData: true        // 是否包含事件数据
};

/**
 * 默认事件缓存配置
 */
const DEFAULT_CACHE_CONFIG = {
  enabled: true,           // 是否启用缓存
  maxSize: 100,            // 最大缓存事件数量
  ttl: 60000               // 缓存过期时间（毫秒）
};

/**
 * 默认批量处理配置
 */
const DEFAULT_BATCH_CONFIG = {
  enabled: false,          // 是否启用批量处理
  batchSize: 50,           // 批量处理大小
  flushInterval: 100       // 批量处理刷新间隔（毫秒）
};

/**
 * 创建默认的事件过滤器
 * @returns {Object} 默认过滤器配置
 */
function createDefaultFilter() {
  return {
    types: null,           // 允许的事件类型列表，null 表示允许所有
    sources: null,         // 允许的事件来源列表，null 表示允许所有
    dataFilter: null       // 数据过滤函数，返回 true 表示通过
  };
}

/**
 * 运行时事件总线类
 * 支持优先级、过滤器、批量处理、历史记录、异步事件等功能
 * 
 * 注意：为了支持优先级功能，我们使用自定义的订阅者管理，
 * 而不是依赖 EventEmitter 的默认监听器顺序。
 */
export class RuntimeEventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 订阅者映射表，存储事件到订阅者数组的映射
    // 每个订阅者包含 { callback, priority, weight, id }
    this.subscribers = new Map();
    
    // 延迟订阅队列，用于延迟订阅激活
    this.pendingSubscriptions = new Map();
    
    // 事件过滤器映射表
    this.filters = new Map();
    
    // 全局过滤器
    this.globalFilter = createDefaultFilter();
    
    // 事件历史记录
    this.history = [];
    this.historyConfig = { ...DEFAULT_HISTORY_CONFIG, ...options.history };
    
    // 事件缓存
    this.cache = new Map();
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...options.cache };
    
    // 批量处理配置
    this.batchConfig = { ...DEFAULT_BATCH_CONFIG, ...options.batch };
    this.batchQueue = [];
    this.batchTimer = null;
    
    // 事件统计信息
    this.stats = {
      totalEvents: 0,
      filteredEvents: 0,
      cachedHits: 0
    };
    
    // 错误处理器，防止未捕获的错误导致进程崩溃
    this._setupErrorHandler();
  }

  /**
   * 设置错误处理器
   * @private
   */
  _setupErrorHandler() {
    // 默认错误处理器，防止没有订阅者时错误被抛出
    this.on('error', (errorData) => {
      // 如果没有其他错误监听器，记录错误但不抛出
      if (this.listenerCount('error') <= 1) {
        // 静默处理，避免进程崩溃
      }
    });
  }

  /**
   * 订阅事件（带优先级支持）
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @param {Object} options - 订阅选项
   * @param {EventPriority} options.priority - 事件优先级，默认为 medium
   * @param {boolean} options.deferred - 是否延迟订阅，默认为 false
   * @returns {Function} 取消订阅函数
   */
  subscribe(event, callback, options = {}) {
    const {
      priority = EventPriority.MEDIUM,
      deferred = false
    } = options;

    // 如果是延迟订阅，添加到待处理队列
    if (deferred) {
      return this._addDeferredSubscription(event, callback, priority);
    }

    // 创建订阅者对象
    const subscriber = {
      callback,
      priority,
      weight: PRIORITY_WEIGHT[priority] || PRIORITY_WEIGHT[EventPriority.MEDIUM],
      id: this._generateId()
    };

    // 添加到订阅者列表
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, []);
    }
    this.subscribers.get(event).push(subscriber);

    // 按优先级排序（权重高的在前）
    this._sortSubscribers(event);

    // 返回取消订阅函数
    return () => this.unsubscribe(event, callback);
  }

  /**
   * 添加延迟订阅
   * @private
   */
  _addDeferredSubscription(event, callback, priority) {
    const subscription = {
      event,
      callback,
      priority,
      id: this._generateId()
    };

    if (!this.pendingSubscriptions.has(event)) {
      this.pendingSubscriptions.set(event, []);
    }
    this.pendingSubscriptions.get(event).push(subscription);

    // 返回取消函数
    return () => {
      const subs = this.pendingSubscriptions.get(event);
      if (subs) {
        const index = subs.findIndex(s => s.id === subscription.id);
        if (index > -1) {
          subs.splice(index, 1);
        }
      }
    };
  }

  /**
   * 激活延迟订阅
   * @param {string} event - 可选，指定要激活的事件，不指定则激活所有
   */
  activateDeferred(event) {
    const eventsToActivate = event 
      ? [event] 
      : Array.from(this.pendingSubscriptions.keys());

    for (const evt of eventsToActivate) {
      const subs = this.pendingSubscriptions.get(evt);
      if (subs && subs.length > 0) {
        for (const sub of subs) {
          this.subscribe(evt, sub.callback, { priority: sub.priority });
        }
        this.pendingSubscriptions.delete(evt);
      }
    }
  }

  /**
   * 取消订阅事件
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  unsubscribe(event, callback) {
    // 从订阅者列表中移除
    if (this.subscribers.has(event)) {
      const subscribers = this.subscribers.get(event);
      const index = subscribers.findIndex(s => s.callback === callback);
      if (index > -1) {
        subscribers.splice(index, 1);
      }
      // 如果没有订阅者了，删除该事件的映射
      if (subscribers.length === 0) {
        this.subscribers.delete(event);
      }
    }
  }

  /**
   * 发射事件（带结构化数据）
   * 按优先级顺序执行订阅者回调
   * @param {string} event - 事件名称
   * @param {Object} data - 事件数据
   * @param {Object} options - 发射选项
   * @param {string} options.source - 事件来源
   * @param {boolean} options.cache - 是否缓存事件
   * @param {boolean} options.batch - 是否使用批量处理
   * @returns {boolean} 事件是否被发射
   */
  emit(event, data = {}, options = {}) {
    const { source = 'unknown', cache = false, batch = false } = options;

    // 构建事件数据
    const eventData = {
      type: event,
      timestamp: Date.now(),
      source,
      id: this._generateId(),
      ...data
    };

    // 检查过滤器
    if (!this._passFilters(event, eventData)) {
      this.stats.filteredEvents++;
      return false;
    }

    // 如果启用批量处理
    if (batch || this.batchConfig.enabled) {
      return this._addToBatch(event, eventData);
    }

    // 记录历史
    this._recordHistory(eventData);

    // 更新统计
    this.stats.totalEvents++;

    // 缓存事件
    if (cache || this.cacheConfig.enabled) {
      this._cacheEvent(event, eventData);
    }

    // 按优先级顺序执行订阅者回调
    const subscribers = this.subscribers.get(event) || [];
    for (const subscriber of subscribers) {
      try {
        subscriber.callback(eventData);
      } catch (error) {
        this._handleCallbackError(error, event, subscriber);
      }
    }

    // 同时触发 EventEmitter 的监听器（用于兼容直接使用 on/off 的场景）
    // 注意：这些监听器不遵循优先级顺序
    super.emit(event, eventData);

    return true;
  }

  /**
   * 异步发射事件
   * 按优先级顺序执行订阅者回调，支持异步回调
   * @param {string} event - 事件名称
   * @param {Object} data - 事件数据
   * @param {Object} options - 发射选项
   * @returns {Promise<void>}
   */
  async emitAsync(event, data = {}, options = {}) {
    const { source = 'unknown', cache = false } = options;

    const eventData = {
      type: event,
      timestamp: Date.now(),
      source,
      id: this._generateId(),
      async: true,
      ...data
    };

    // 检查过滤器
    if (!this._passFilters(event, eventData)) {
      this.stats.filteredEvents++;
      return;
    }

    // 记录历史
    this._recordHistory(eventData);

    // 更新统计
    this.stats.totalEvents++;

    // 缓存事件
    if (cache || this.cacheConfig.enabled) {
      this._cacheEvent(event, eventData);
    }

    // 获取订阅者并按优先级顺序执行
    const subscribers = this.subscribers.get(event) || [];
    
    // 按优先级顺序执行异步回调
    for (const subscriber of subscribers) {
      try {
        await Promise.resolve(subscriber.callback(eventData));
      } catch (error) {
        this._handleCallbackError(error, event, subscriber);
      }
    }

    // 同时触发 EventEmitter 的监听器（用于兼容直接使用 on/off 的场景）
    super.emit(event, eventData);
  }

  /**
   * 批量发射事件
   * @param {Array} events - 事件数组，每个元素包含 {event, data, options}
   */
  emitBatch(events) {
    for (const { event, data, options } of events) {
      this.emit(event, data, options);
    }
  }

  /**
   * 添加事件到批量队列
   * @private
   */
  _addToBatch(event, eventData) {
    this.batchQueue.push({ event, eventData });

    // 如果达到批量大小，立即刷新
    if (this.batchQueue.length >= this.batchConfig.batchSize) {
      this._flushBatch();
    } else if (!this.batchTimer) {
      // 设置定时器，定时刷新
      this.batchTimer = setTimeout(() => {
        this._flushBatch();
      }, this.batchConfig.flushInterval);
    }

    return true;
  }

  /**
   * 刷新批量队列
   * @private
   */
  _flushBatch() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    for (const { event, eventData } of batch) {
      // 按优先级顺序执行订阅者回调
      const subscribers = this.subscribers.get(event) || [];
      for (const subscriber of subscribers) {
        try {
          subscriber.callback(eventData);
        } catch (error) {
          this._handleCallbackError(error, event, subscriber);
        }
      }
      // 触发 EventEmitter 监听器
      super.emit(event, eventData);
    }
  }

  /**
   * 设置事件过滤器
   * @param {string} event - 事件名称，或 '*' 表示全局过滤器
   * @param {Object} filter - 过滤器配置
   * @param {Array} filter.types - 允许的事件类型
   * @param {Array} filter.sources - 允许的事件来源
   * @param {Function} filter.dataFilter - 数据过滤函数
   */
  setFilter(event, filter) {
    if (event === '*') {
      this.globalFilter = { ...createDefaultFilter(), ...filter };
    } else {
      this.filters.set(event, { ...createDefaultFilter(), ...filter });
    }
  }

  /**
   * 移除事件过滤器
   * @param {string} event - 事件名称
   */
  removeFilter(event) {
    if (event === '*') {
      this.globalFilter = createDefaultFilter();
    } else {
      this.filters.delete(event);
    }
  }

  /**
   * 检查事件是否通过过滤器
   * @private
   */
  _passFilters(event, eventData) {
    // 检查全局过滤器
    if (!this._checkFilter(this.globalFilter, event, eventData)) {
      return false;
    }

    // 检查特定事件过滤器
    const eventFilter = this.filters.get(event);
    if (eventFilter && !this._checkFilter(eventFilter, event, eventData)) {
      return false;
    }

    return true;
  }

  /**
   * 检查单个过滤器
   * @private
   */
  _checkFilter(filter, event, eventData) {
    // 检查类型过滤
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(event)) {
        return false;
      }
    }

    // 检查来源过滤
    if (filter.sources && filter.sources.length > 0) {
      if (!filter.sources.includes(eventData.source)) {
        return false;
      }
    }

    // 检查数据过滤函数
    if (filter.dataFilter && typeof filter.dataFilter === 'function') {
      if (!filter.dataFilter(eventData)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 记录事件历史
   * @private
   */
  _recordHistory(eventData) {
    if (!this.historyConfig.enabled) {
      return;
    }

    const record = this.historyConfig.includeData
      ? { ...eventData }
      : { type: eventData.type, timestamp: eventData.timestamp, source: eventData.source, id: eventData.id };

    this.history.push(record);

    // 限制历史记录大小
    if (this.history.length > this.historyConfig.maxSize) {
      this.history.shift();
    }
  }

  /**
   * 获取事件历史记录
   * @param {Object} options - 查询选项
   * @param {string} options.type - 按类型过滤
   * @param {string} options.source - 按来源过滤
   * @param {number} options.limit - 限制返回数量
   * @param {number} options.since - 起始时间戳
   * @returns {Array} 历史记录数组
   */
  getHistory(options = {}) {
    let result = [...this.history];

    if (options.type) {
      result = result.filter(e => e.type === options.type);
    }

    if (options.source) {
      result = result.filter(e => e.source === options.source);
    }

    if (options.since) {
      result = result.filter(e => e.timestamp >= options.since);
    }

    if (options.limit && options.limit > 0) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * 清除事件历史记录
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * 回放事件历史
   * @param {Object} options - 回放选项
   * @param {number} options.since - 起始时间戳
   * @param {number} options.until - 结束时间戳
   * @param {string} options.type - 事件类型过滤
   * @param {number} options.delay - 每个事件之间的延迟（毫秒）
   * @param {boolean} options.async - 是否异步回放
   * @returns {Promise<void>|void}
   */
  async replayHistory(options = {}) {
    const { since, until, type, delay = 0, async = false } = options;

    let events = [...this.history];

    // 过滤事件
    if (since) {
      events = events.filter(e => e.timestamp >= since);
    }
    if (until) {
      events = events.filter(e => e.timestamp <= until);
    }
    if (type) {
      events = events.filter(e => e.type === type);
    }

    // 按时间戳排序
    events.sort((a, b) => a.timestamp - b.timestamp);

    for (const event of events) {
      // 按优先级顺序执行订阅者回调
      const subscribers = this.subscribers.get(event.type) || [];
      const replayData = { ...event, replay: true };
      for (const subscriber of subscribers) {
        try {
          subscriber.callback(replayData);
        } catch (error) {
          this._handleCallbackError(error, event.type, subscriber);
        }
      }
      // 触发 EventEmitter 监听器
      super.emit(event.type, replayData);
      
      if (delay > 0) {
        await this._sleep(delay);
      }
    }
  }

  /**
   * 缓存事件
   * @private
   */
  _cacheEvent(event, eventData) {
    if (!this.cacheConfig.enabled) {
      return;
    }

    const cacheEntry = {
      data: eventData,
      timestamp: Date.now(),
      expires: Date.now() + this.cacheConfig.ttl
    };

    // 检查缓存大小限制
    if (this.cache.size >= this.cacheConfig.maxSize) {
      // 删除最旧的缓存
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(event, cacheEntry);
  }

  /**
   * 获取缓存的事件
   * @param {string} event - 事件名称
   * @returns {Object|null} 缓存的事件数据，如果不存在或已过期返回 null
   */
  getCachedEvent(event) {
    const entry = this.cache.get(event);
    
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expires) {
      this.cache.delete(event);
      return null;
    }

    this.stats.cachedHits++;
    return entry.data;
  }

  /**
   * 清除事件缓存
   * @param {string} event - 可选，指定要清除的事件
   */
  clearCache(event) {
    if (event) {
      this.cache.delete(event);
    } else {
      this.cache.clear();
    }
  }

  /**
   * 获取当前订阅者数量
   * @param {string} event - 事件名称
   * @returns {number} 订阅者数量
   */
  getSubscriberCount(event) {
    return this.subscribers.get(event)?.length || 0;
  }

  /**
   * 获取所有订阅者信息
   * @param {string} event - 可选，指定事件
   * @returns {Object|Map} 订阅者信息
   */
  getSubscribers(event) {
    if (event) {
      return this.subscribers.get(event) || [];
    }
    
    // 返回所有订阅者的摘要信息
    const result = {};
    for (const [evt, subs] of this.subscribers) {
      result[evt] = subs.map(s => ({
        priority: s.priority,
        id: s.id
      }));
    }
    return result;
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      subscriberCount: this.subscribers.size,
      historySize: this.history.length,
      cacheSize: this.cache.size,
      pendingSubscriptions: this.pendingSubscriptions.size
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalEvents: 0,
      filteredEvents: 0,
      cachedHits: 0
    };
  }

  /**
   * 清除所有订阅者和缓存
   */
  clear() {
    // 清除批量定时器
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // 刷新剩余的批量队列
    if (this.batchQueue.length > 0) {
      this._flushBatch();
    }

    this.removeAllListeners();
    this.subscribers.clear();
    this.pendingSubscriptions.clear();
    this.filters.clear();
    this.globalFilter = createDefaultFilter();
    this.history = [];
    this.cache.clear();
    this.batchQueue = [];
    
    // 重置统计
    this.resetStats();
    
    // 重新设置错误处理器
    this._setupErrorHandler();
  }

  /**
   * 按优先级排序订阅者
   * @private
   */
  _sortSubscribers(event) {
    const subscribers = this.subscribers.get(event);
    if (subscribers && subscribers.length > 0) {
      subscribers.sort((a, b) => b.weight - a.weight);
    }
  }

  /**
   * 处理回调错误
   * @private
   */
  _handleCallbackError(error, event, subscriber) {
    // 发射错误事件（使用自定义的 subscriber_error 事件）
    const errorData = {
      type: 'subscriber_error',
      event,
      subscriberId: subscriber.id,
      error: {
        message: error.message,
        stack: error.stack
      },
      timestamp: Date.now()
    };
    
    // 使用 super.emit 直接发射，避免触发我们的订阅者系统
    super.emit('subscriber_error', errorData);
    super.emit('error', errorData);
  }

  /**
   * 生成唯一 ID
   * @private
   */
  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 延迟函数
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 单例实例
let instance = null;

/**
 * 获取事件总线单例实例
 * @param {Object} options - 配置选项
 * @returns {RuntimeEventBus} 事件总线实例
 */
export function getEventBus(options) {
  if (!instance) {
    instance = new RuntimeEventBus(options);
  }
  return instance;
}

/**
 * 重置事件总线单例（主要用于测试）
 */
export function resetEventBus() {
  if (instance) {
    instance.clear();
    instance = null;
  }
}