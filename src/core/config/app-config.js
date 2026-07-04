/**
 * 应用配置中心 — 集中管理所有配置项
 *
 * 参考 oh-my-pi 的设计理念：
 * - 单一真相来源，所有模块通过 config.get() 获取配置
 * - 配置来源优先级：传入值 > 环境变量 > .env 文件 > 默认值
 * - 类型安全，自动类型转换（string → number/boolean）
 * - 统一的配置 schema 和默认值
 *
 * 使用方式：
 *   import { appConfig } from './core/config/app-config.js';
 *   const maxIter = appConfig.getNumber('maxIterations', 50);
 *   const apiKey = appConfig.getString('OPENAI_API_KEY');
 */

export class AppConfig {
  #values = new Map();
  #env = null;

  /**
   * @param {object} [options]
   * @param {object} [options.env] - 环境变量对象（默认 process.env）
   * @param {object} [options.defaults] - 默认配置值
   */
  constructor(options = {}) {
    this.#env = options.env || (typeof process !== 'undefined' ? process.env : {});
    if (options.defaults) {
      for (const [key, value] of Object.entries(options.defaults)) {
        this.#values.set(key, value);
      }
    }
  }

  /**
   * 获取字符串配置
   * 优先级：set() 设置的值 > 环境变量 > 默认值
   * @param {string} key
   * @param {string} [defaultValue]
   * @returns {string|undefined}
   */
  getString(key, defaultValue = undefined) {
    if (this.#values.has(key)) {
      return this.#values.get(key);
    }
    if (this.#env && this.#env[key] !== undefined) {
      return this.#env[key];
    }
    return defaultValue;
  }

  /**
   * 获取数字配置
   * @param {string} key
   * @param {number} [defaultValue]
   * @returns {number}
   */
  getNumber(key, defaultValue = 0) {
    const raw = this.getString(key);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : defaultValue;
  }

  /**
   * 获取整数配置
   * @param {string} key
   * @param {number} [defaultValue]
   * @returns {number}
   */
  getInt(key, defaultValue = 0) {
    const num = this.getNumber(key, defaultValue);
    return Math.floor(num);
  }

  /**
   * 获取布尔配置
   * 真值: 'true', '1', 'yes', 'on' (不区分大小写)
   * @param {string} key
   * @param {boolean} [defaultValue]
   * @returns {boolean}
   */
  getBoolean(key, defaultValue = false) {
    const raw = this.getString(key);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }
    if (typeof raw === 'boolean') return raw;
    const lower = String(raw).toLowerCase().trim();
    return ['true', '1', 'yes', 'on'].includes(lower);
  }

  /**
   * 获取数组配置（逗号分隔）
   * @param {string} key
   * @param {string[]} [defaultValue]
   * @returns {string[]}
   */
  getArray(key, defaultValue = []) {
    const raw = this.getString(key);
    if (!raw) return defaultValue;
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * 设置配置值（最高优先级）
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    this.#values.set(key, value);
    return this;
  }

  /**
   * 批量设置
   * @param {object} values
   */
  setAll(values) {
    for (const [key, value] of Object.entries(values)) {
      this.#values.set(key, value);
    }
    return this;
  }

  /**
   * 检查配置是否存在
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.#values.has(key) || (this.#env && this.#env[key] !== undefined);
  }

  /**
   * 获取所有已知配置的快照
   * @returns {object}
   */
  toJSON() {
    const obj = {};
    for (const [key, value] of this.#values) {
      obj[key] = value;
    }
    return obj;
  }
}

/**
 * 默认全局配置实例（使用 process.env）
 */
export const appConfig = new AppConfig();

/**
 * 创建一个独立的配置实例（用于测试或隔离环境）
 * @param {object} [env]
 * @returns {AppConfig}
 */
export function createConfig(env = {}) {
  return new AppConfig({ env });
}
