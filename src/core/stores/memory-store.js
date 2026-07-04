/**
 * MemoryStore — 统一的键值存储接口
 *
 * 参考 oh-my-pi 的设计理念：
 * - 所有存储实现遵循统一的接口契约
 * - 支持多种后端：内存、文件系统、localStorage、IndexedDB 等
 * - 组合优于继承：通过组合不同的 store 实现复杂功能
 *
 * 解决的问题：
 * - 之前有 N 种存储方式（MemoryManager, StructuredMemory, SessionStore,
 *   SessionFileStore...），每种都有自己的 API
 * - 难以切换存储后端，难以测试
 * - 没有统一的错误处理和性能监控点
 *
 * 使用方式：
 *   const store = createMemoryStore('memory', { namespace: 'sessions' });
 *   await store.set('session_123', { title: 'test' });
 *   const session = await store.get('session_123');
 *   const all = await store.list();
 */

// ============================================================================
// 类型定义
// ============================================================================

export const StoreType = {
  MEMORY: 'memory',
  FILE: 'file',
  LOCAL_STORAGE: 'localStorage',
  INDEXED_DB: 'indexedDB',
};

export const StoreEvent = {
  BEFORE_SET: 'beforeSet',
  AFTER_SET: 'afterSet',
  BEFORE_DELETE: 'beforeDelete',
  AFTER_DELETE: 'afterDelete',
  BEFORE_CLEAR: 'beforeClear',
  AFTER_CLEAR: 'afterClear',
  ERROR: 'error',
};

// ============================================================================
// MemoryStore 接口（基类，所有实现继承自此）
// ============================================================================

/**
 * 统一的键值存储接口
 * @interface
 */
export class MemoryStore {
  /**
   * @param {object} [options]
   * @param {string} [options.namespace] - 命名空间，用于隔离不同用途的数据
   * @param {number} [options.ttl] - 默认过期时间（毫秒），0 表示永不过期
   */
  constructor(options = {}) {
    this._namespace = options.namespace || 'default';
    this._defaultTtl = options.ttl || 0;
    this._listeners = new Map();
  }

  // ── 核心 CRUD ──────────────────────────────────────────────────────────

  /**
   * 获取值
   * @param {string} key
   * @returns {Promise<*>} 值，不存在返回 undefined
   */
  async get(key) {
    throw new Error('MemoryStore.get: not implemented');
  }

  /**
   * 设置值
   * @param {string} key
   * @param {*} value
   * @param {object} [options]
   * @param {number} [options.ttl] - 过期时间（毫秒），覆盖默认值
   * @returns {Promise<*>} 写入的值
   */
  async set(key, value, options = {}) {
    throw new Error('MemoryStore.set: not implemented');
  }

  /**
   * 删除值
   * @param {string} key
   * @returns {Promise<boolean>} 是否成功删除
   */
  async delete(key) {
    throw new Error('MemoryStore.delete: not implemented');
  }

  /**
   * 检查键是否存在
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    const value = await this.get(key);
    return value !== undefined;
  }

  /**
   * 列出所有键
   * @param {object} [options]
   * @param {string} [options.prefix] - 只列出带指定前缀的键
   * @returns {Promise<string[]>}
   */
  async keys(options = {}) {
    throw new Error('MemoryStore.keys: not implemented');
  }

  /**
   * 列出所有值
   * @param {object} [options]
   * @param {string} [options.prefix] - 只列出带指定前缀的值
   * @returns {Promise<Array<{key: string, value: *}>>}
   */
  async list(options = {}) {
    const keys = await this.keys(options);
    const results = [];
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) {
        results.push({ key, value });
      }
    }
    return results;
  }

  /**
   * 清空所有数据
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('MemoryStore.clear: not implemented');
  }

  /**
   * 获取条目数量
   * @returns {Promise<number>}
   */
  async size() {
    const keys = await this.keys();
    return keys.length;
  }

  // ── 批量操作 ──────────────────────────────────────────────────────────

  /**
   * 批量获取
   * @param {string[]} keys
   * @returns {Promise<Array<{key: string, value: *}>>}
   */
  async getMany(keys) {
    const results = [];
    for (const key of keys) {
      const value = await this.get(key);
      results.push({ key, value });
    }
    return results;
  }

  /**
   * 批量设置
   * @param {Array<{key: string, value: *}>} entries
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async setMany(entries, options = {}) {
    for (const { key, value } of entries) {
      await this.set(key, value, options);
    }
  }

  /**
   * 批量删除
   * @param {string[]} keys
   * @returns {Promise<number>} 成功删除的数量
   */
  async deleteMany(keys) {
    let count = 0;
    for (const key of keys) {
      if (await this.delete(key)) {
        count++;
      }
    }
    return count;
  }

  // ── 持久化 ──────────────────────────────────────────────────────────

  /**
   * 刷新（从持久化后端重新加载）
   * @returns {Promise<void>}
   */
  async load() {
    // 默认空实现，内存存储不需要 load
  }

  /**
   * 保存（将内存中的数据写入持久化后端）
   * @returns {Promise<void>}
   */
  async save() {
    // 默认空实现，内存存储不需要 save
  }

  /**
   * 刷新待写入的缓冲数据
   * @returns {Promise<void>}
   */
  async flush() {
    await this.save();
  }

  // ── 事件系统 ──────────────────────────────────────────────────────────

  /**
   * 监听事件
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} 取消监听函数
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * 取消监听
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * 触发事件
   * @param {string} event
   * @param {*} data
   * @protected
   */
  _emit(event, data) {
    const set = this._listeners.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(data, event);
        } catch (err) {
          console.error(`[MemoryStore] Event handler error for "${event}":`, err);
        }
      }
    }
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────

  /**
   * 生成带命名空间的键
   * @param {string} key
   * @returns {string}
   * @protected
   */
  _namespacedKey(key) {
    return this._namespace === 'default' ? key : `${this._namespace}:${key}`;
  }

  /**
   * 剥离命名空间前缀
   * @param {string} namespacedKey
   * @returns {string}
   * @protected
   */
  _stripNamespace(namespacedKey) {
    const prefix = `${this._namespace}:`;
    return namespacedKey.startsWith(prefix) ? namespacedKey.slice(prefix.length) : namespacedKey;
  }
}

// ============================================================================
// 内存存储实现（最简单、最快，用于测试和缓存）
// ============================================================================

/**
 * 基于 Map 的内存存储
 */
export class MemoryMapStore extends MemoryStore {
  constructor(options = {}) {
    super(options);
    this._data = new Map();
    this._expiries = new Map(); // key -> expiry timestamp
  }

  async get(key) {
    const nsKey = this._namespacedKey(key);
    this._checkExpiry(nsKey);
    return this._data.get(nsKey);
  }

  async set(key, value, options = {}) {
    const nsKey = this._namespacedKey(key);
    this._emit(StoreEvent.BEFORE_SET, { key, value });

    this._data.set(nsKey, value);

    const ttl = options.ttl ?? this._defaultTtl;
    if (ttl > 0) {
      this._expiries.set(nsKey, Date.now() + ttl);
    } else {
      this._expiries.delete(nsKey);
    }

    this._emit(StoreEvent.AFTER_SET, { key, value });
    return value;
  }

  async delete(key) {
    const nsKey = this._namespacedKey(key);
    if (!this._data.has(nsKey)) return false;

    this._emit(StoreEvent.BEFORE_DELETE, { key });
    this._data.delete(nsKey);
    this._expiries.delete(nsKey);
    this._emit(StoreEvent.AFTER_DELETE, { key });
    return true;
  }

  async has(key) {
    const nsKey = this._namespacedKey(key);
    this._checkExpiry(nsKey);
    return this._data.has(nsKey);
  }

  async keys(options = {}) {
    const { prefix = '' } = options;
    const nsPrefix = this._namespacedKey(prefix);
    const result = [];
    for (const nsKey of this._data.keys()) {
      this._checkExpiry(nsKey);
      if (!this._data.has(nsKey)) continue;
      if (prefix && !nsKey.startsWith(nsPrefix)) continue;
      result.push(this._stripNamespace(nsKey));
    }
    return result;
  }

  async clear() {
    this._emit(StoreEvent.BEFORE_CLEAR, {});
    if (this._namespace === 'default') {
      this._data.clear();
      this._expiries.clear();
    } else {
      const prefix = `${this._namespace}:`;
      for (const key of this._data.keys()) {
        if (key.startsWith(prefix)) {
          this._data.delete(key);
          this._expiries.delete(key);
        }
      }
    }
    this._emit(StoreEvent.AFTER_CLEAR, {});
  }

  async size() {
    const keys = await this.keys();
    return keys.length;
  }

  /**
   * 检查并清理过期条目
   * @param {string} nsKey
   * @private
   */
  _checkExpiry(nsKey) {
    const expiry = this._expiries.get(nsKey);
    if (expiry && Date.now() > expiry) {
      this._data.delete(nsKey);
      this._expiries.delete(nsKey);
    }
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建存储实例
 * @param {string} type - 存储类型
 * @param {object} [options]
 * @returns {MemoryStore}
 */
export function createMemoryStore(type = 'memory', options = {}) {
  switch (type) {
    case StoreType.MEMORY:
    case 'memory':
    default:
      return new MemoryMapStore(options);
  }
}

/**
 * 默认全局内存存储实例
 */
export const defaultMemoryStore = new MemoryMapStore();
