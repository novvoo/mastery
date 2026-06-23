/**
 * Plugin Hook System
 * 插件钩子系统 - 注册、触发和优先级管理
 */

import { HookPriority } from './plugin-types.js';

/**
 * 钩子条目类 - 支持优先级和元数据
 */
export class HookEntry {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.priority = options.priority ?? HookPriority.NORMAL;
    this.once = options.once ?? false; // 是否只执行一次
    this.name = options.name ?? fn.name ?? 'anonymous';
    this.pluginName = options.pluginName ?? null;
    this.errorHandler = options.errorHandler ?? null;
    this.called = 0;
    this.enabled = true;
  }

  /**
   * 执行钩子
   */
  async execute(...args) {
    if (!this.enabled) {
      return { executed: false, result: undefined, error: null };
    }

    this.called++;

    try {
      const result = await this.fn(...args);
      return { executed: true, result, error: null };
    } catch (error) {
      if (this.errorHandler) {
        this.errorHandler(error, ...args);
        return { executed: true, result: undefined, error: null };
      }
      return { executed: true, result: undefined, error };
    }
  }

  /**
   * 检查是否应该移除
   */
  shouldRemove() {
    return this.once && this.called > 0;
  }
}

/**
 * 钩子管理器 - 处理钩子的注册、排序和执行
 */
export class HookManager {
  #hooks = new Map();
  #errorHandlers = new Map();

  /**
   * 注册钩子
   */
  register(hookName, fn, options = {}) {
    if (!this.#hooks.has(hookName)) {
      this.#hooks.set(hookName, []);
    }

    const entry = new HookEntry(fn, options);
    const hooks = this.#hooks.get(hookName);
    hooks.push(entry);

    // 按优先级排序
    hooks.sort((a, b) => a.priority - b.priority);

    return () => this.unregister(hookName, entry);
  }

  /**
   * 注销钩子
   */
  unregister(hookName, entry) {
    const hooks = this.#hooks.get(hookName);
    if (!hooks) {
      return false;
    }

    const index = hooks.indexOf(entry);
    if (index > -1) {
      hooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 触发钩子
   */
  async trigger(hookName, ...args) {
    const hooks = this.#hooks.get(hookName) || [];
    const results = [];
    const errors = [];

    const toRemove = [];

    for (const entry of hooks) {
      const { executed, result, error } = await entry.execute(...args);

      if (executed) {
        results.push(result);

        if (error) {
          errors.push({
            hookName,
            hookFn: entry.name,
            pluginName: entry.pluginName,
            error,
          });

          // 调用全局错误处理器
          const globalHandler = this.#errorHandlers.get(hookName);
          if (globalHandler) {
            globalHandler(error, { hookName, entry, args });
          }
        }
      }

      if (entry.shouldRemove()) {
        toRemove.push(entry);
      }
    }

    // 移除一次性钩子
    for (const entry of toRemove) {
      this.unregister(hookName, entry);
    }

    return { results, errors };
  }

  /**
   * 设置钩子错误处理器
   */
  setErrorHandler(hookName, handler) {
    this.#errorHandlers.set(hookName, handler);
  }

  /**
   * 获取钩子数量
   */
  getHookCount(hookName) {
    return this.#hooks.get(hookName)?.length || 0;
  }

  /**
   * 清除所有钩子
   */
  clear(hookName) {
    if (hookName) {
      this.#hooks.delete(hookName);
    } else {
      this.#hooks.clear();
    }
  }

  /**
   * 获取钩子信息（用于调试）
   */
  getHookInfo(hookName) {
    const hooks = this.#hooks.get(hookName) || [];
    return hooks.map((entry) => ({
      name: entry.name,
      priority: entry.priority,
      pluginName: entry.pluginName,
      called: entry.called,
      enabled: entry.enabled,
    }));
  }
}
