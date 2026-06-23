/**
 * Plugin Types, Constants, and Enums
 * 插件类型、常量与枚举定义
 */

/**
 * 钩子常量定义
 */
export const HOOKS = {
  // Agent 生命周期钩子
  BEFORE_AGENT_START: 'before_agent_start',
  AFTER_AGENT_START: 'after_agent_start',
  BEFORE_AGENT_STOP: 'before_agent_stop',
  AFTER_AGENT_STOP: 'after_agent_stop',
  AFTER_AGENT_COMPLETE: 'after_agent_complete',

  // 工具相关钩子
  BEFORE_TOOL_CALL: 'before_tool_call',
  AFTER_TOOL_CALL: 'after_tool_call',
  ON_TOOL_ERROR: 'on_tool_error',
  ON_TOOL_REGISTER: 'on_tool_register',
  ON_TOOL_UNREGISTER: 'on_tool_unregister',

  // 状态更新钩子
  BEFORE_STATUS_UPDATE: 'before_status_update',
  AFTER_STATUS_UPDATE: 'after_status_update',

  // 输入输出钩子
  ON_INPUT_RECEIVED: 'on_input_received',
  ON_OUTPUT_GENERATED: 'on_output_generated',

  // 初始化/销毁钩子
  BEFORE_INIT: 'before_init',
  AFTER_INIT: 'after_init',
  BEFORE_DISPOSE: 'before_dispose',
  AFTER_DISPOSE: 'after_dispose',

  // 配置变更钩子
  ON_CONFIG_CHANGE: 'on_config_change',

  // 内存更新钩子
  ON_MEMORY_UPDATE: 'on_memory_update',
  ON_MEMORY_CLEAR: 'on_memory_clear',

  // 插件生命周期钩子
  ON_PLUGIN_REGISTER: 'on_plugin_register',
  ON_PLUGIN_UNREGISTER: 'on_plugin_unregister',
  ON_PLUGIN_ENABLE: 'on_plugin_enable',
  ON_PLUGIN_DISABLE: 'on_plugin_disable',
};

/**
 * 插件状态枚举
 */
export const PluginState = {
  UNREGISTERED: 'unregistered',
  REGISTERED: 'registered',
  INITIALIZING: 'initializing',
  INITIALIZED: 'initialized',
  ACTIVE: 'active',
  DISABLED: 'disabled',
  ERROR: 'error',
};

/**
 * 钩子优先级（数字越小优先级越高）
 */
export const HookPriority = {
  HIGHEST: 0,
  HIGH: 25,
  NORMAL: 50,
  LOW: 75,
  LOWEST: 100,
};

/**
 * 插件配置类
 */
export class PluginConfig {
  #config;
  #defaults;
  #schema;

  constructor(defaults = {}, schema = null) {
    this.#defaults = { ...defaults };
    this.#config = { ...defaults };
    this.#schema = schema;
  }

  /**
   * 获取配置值
   */
  get(key, defaultValue = undefined) {
    if (key === undefined) {
      return { ...this.#config };
    }
    return this.#config.hasOwnProperty(key) ? this.#config[key] : defaultValue;
  }

  /**
   * 设置配置值
   */
  set(key, value) {
    if (typeof key === 'object') {
      Object.assign(this.#config, key);
    } else {
      this.#config[key] = value;
    }
    return this;
  }

  /**
   * 重置为默认值
   */
  reset() {
    this.#config = { ...this.#defaults };
    return this;
  }

  /**
   * 验证配置
   */
  validate() {
    if (!this.#schema) {
      return { valid: true, errors: [] };
    }

    const errors = [];
    for (const [key, rules] of Object.entries(this.#schema)) {
      const value = this.#config[key];

      if (rules.required && value === undefined) {
        errors.push(`配置项 "${key}" 是必需的`);
        continue;
      }

      if (value !== undefined && rules.type && typeof value !== rules.type) {
        errors.push(`配置项 "${key}" 类型错误，期望 ${rules.type}，实际 ${typeof value}`);
      }

      if (value !== undefined && rules.enum && !rules.enum.includes(value)) {
        errors.push(`配置项 "${key}" 值无效，必须是 ${rules.enum.join(', ')} 之一`);
      }

      if (value !== undefined && rules.validate && !rules.validate(value)) {
        errors.push(`配置项 "${key}" 验证失败`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 序列化配置
   */
  toJSON() {
    return { ...this.#config };
  }
}
