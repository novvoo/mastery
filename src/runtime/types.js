/**
 * Runtime Layer Type Definitions
 * 运行时层类型定义 - 共享类型
 */

/**
 * 平台类型
 */
export const PlatformType = {
  CLI: 'cli',
  DESKTOP: 'desktop',
  WEB: 'web',
};

/**
 * 运行时事件类型
 */
export const RuntimeEvent = {
  // Agent 生命周期事件
  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  AGENT_ERROR: 'agent:error',
  AGENT_COMPLETE: 'agent:complete',
  AGENT_STREAM: 'agent:stream',
  AGENT_THINKING: 'agent:thinking',

  // 流式增量事件（打字机效果）
  AGENT_TEXT_DELTA: 'agent:text_delta',
  AGENT_REASONING_DELTA: 'agent:reasoning_delta',
  AGENT_TOOL_CALL_DELTA: 'agent:tool_call_delta',

  // 工具相关事件
  TOOL_CALL: 'tool:call',
  TOOL_RESULT: 'tool:result',
  TOOL_ERROR: 'tool:error',
  TOOL_ACTIVITY: 'tool:activity',
  TOOL_PROGRESS: 'tool:progress',
  TOOL_LOADED: 'tool:loaded',
  TOOL_UNLOADED: 'tool:unloaded',

  // 消息事件
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_SENT: 'message:sent',

  // 状态事件
  STATUS_UPDATE: 'status:update',
  CONFIG_CHANGE: 'config:change',

  // 内存事件
  MEMORY_UPDATE: 'memory:update',
  MEMORY_CLEAR: 'memory:clear',

  // 插件事件
  PLUGIN_REGISTER: 'plugin:register',
  PLUGIN_UNREGISTER: 'plugin:unregister',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',

  // 规划事件
  EXECUTION_PLAN_CREATED: 'plan:created',
  EXECUTION_PLAN_UPDATED: 'plan:updated',
  PLAN_DECOMPOSED: 'plan:decomposed',
  PLAN_EXECUTED: 'plan:executed',
};

/**
 * 默认最大迭代次数 —— 单一数据源定义在 core/agent-constants.js，
 * 运行时层与 Agent 层共享。此处 re-export 以保持向后兼容。
 */
import { MAX_ITERATIONS_DEFAULT } from '../core/agent-constants.js';
export { MAX_ITERATIONS_DEFAULT } from '../core/agent-constants.js';

/**
 * 运行时配置类
 */
export class RuntimeConfig {
  constructor(options = {}) {
    const opts = options || {};
    this.platform = opts.platform || PlatformType.CLI;
    this.workingDirectory = opts.workingDirectory || process.cwd();
    this.debug = opts.debug || false;
    this.modelProvider = opts.modelProvider;
    this.autoDownloadModels = opts.autoDownloadModels !== false;
    this.maxIterations = normalizePositiveInteger(opts.maxIterations, MAX_ITERATIONS_DEFAULT);

    // 新增配置项
    this.pluginConfig = opts.pluginConfig || {};
    this.enableMiddleware = opts.enableMiddleware !== false;
    this.enableToolGroups = opts.enableToolGroups !== false;
    this.hookTimeout = normalizeNonNegativeNumber(opts.hookTimeout, 5000);

    // Budget & Cache 控制
    this.tokenBudget = opts.tokenBudget ?? null;
    this.tokenBudgetWarningThreshold = opts.tokenBudgetWarningThreshold ?? 70;
    this.toolResultCacheEnabled = opts.toolResultCacheEnabled !== false;
  }

  /**
   * 更新配置
   */
  update(key, value) {
    if (typeof key === 'object') {
      for (const [entryKey, entryValue] of Object.entries(key)) {
        this.#assignConfigValue(entryKey, entryValue);
      }
    } else {
      this.#assignConfigValue(key, value);
    }
    return this;
  }

  #assignConfigValue(key, value) {
    if (key === 'maxIterations') {
      this.maxIterations = normalizePositiveInteger(value, MAX_ITERATIONS_DEFAULT);
      return;
    }
    if (key === 'hookTimeout') {
      this.hookTimeout = normalizeNonNegativeNumber(value, 5000);
      return;
    }
    this[key] = value;
  }

  /**
   * 获取配置
   */
  get(key, defaultValue = undefined) {
    return this.hasOwnProperty(key) ? this[key] : defaultValue;
  }

  /**
   * 克隆配置
   */
  clone() {
    return new RuntimeConfig({ ...this });
  }
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Agent 状态类
 */
export class AgentState {
  constructor() {
    this.status = 'idle'; // idle, running, completed, error
    this.currentTask = null;
    this.currentPlanId = null; // GraphPlanner 的执行计划ID
    this.iteration = 0;
    this.startTime = null;
    this.lastActivity = null;
    this.error = null;
    this.metadata = {};
  }

  /**
   * 更新状态
   */
  setStatus(status, metadata = {}) {
    this.status = status;
    this.lastActivity = Date.now();
    Object.assign(this.metadata, metadata);
    return this;
  }

  /**
   * 设置错误
   */
  setError(error) {
    this.status = 'error';
    this.error = error;
    this.lastActivity = Date.now();
    return this;
  }

  /**
   * 重置状态
   */
  reset() {
    this.status = 'idle';
    this.currentTask = null;
    this.currentPlanId = null;
    this.iteration = 0;
    this.startTime = null;
    this.lastActivity = null;
    this.error = null;
    this.metadata = {};
    return this;
  }
}

/**
 * 工具执行上下文
 */
export class ToolContext {
  constructor(options = {}) {
    this.workingDirectory = options.workingDirectory;
    this.memoryManager = options.memoryManager;
    this.securityPolicy = options.securityPolicy;
    this.debug = options.debug || false;
    this.sessionId = options.sessionId || null;
    this.userId = options.userId || null;
    this.metadata = options.metadata || {};
  }

  /**
   * 设置元数据
   */
  setMetadata(key, value) {
    if (typeof key === 'object') {
      Object.assign(this.metadata, key);
    } else {
      this.metadata[key] = value;
    }
    return this;
  }
}

/**
 * 工具定义类
 */
export class ToolDefinition {
  constructor(options = {}) {
    this.name = options.name;
    this.description = options.description || '';
    this.category = options.category || 'general';
    this.parameters = options.parameters || {};
    this.required = options.required || [];
    this.handler = options.handler;
    this.metadata = options.metadata || {};
    this.enabled = options.enabled !== false;
    this.priority = options.priority || 50;
    this.group = options.group || null;

    // 中间件相关
    this.beforeHooks = options.beforeHooks || [];
    this.afterHooks = options.afterHooks || [];
    this.errorHandler = options.errorHandler || null;
  }

  /**
   * 验证工具定义
   */
  validate() {
    const errors = [];

    if (!this.name) {
      errors.push('工具名称是必需的');
    }

    if (!this.description) {
      errors.push('工具描述是必需的');
    }

    if (!this.handler || typeof this.handler !== 'function') {
      errors.push('工具处理器必须是函数');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 添加前置钩子
   */
  addBeforeHook(fn, options = {}) {
    this.beforeHooks.push({ fn, ...options });
    return this;
  }

  /**
   * 添加后置钩子
   */
  addAfterHook(fn, options = {}) {
    this.afterHooks.push({ fn, ...options });
    return this;
  }

  /**
   * 设置错误处理器
   */
  setErrorHandler(fn) {
    this.errorHandler = fn;
    return this;
  }
}

/**
 * 工具分组类
 */
export class ToolGroup {
  constructor(options = {}) {
    this.name = options.name;
    this.description = options.description || '';
    this.tools = new Set(options.tools || []);
    this.enabled = options.enabled !== false;
    this.priority = options.priority || 50;
    this.metadata = options.metadata || {};
  }

  /**
   * 添加工具
   */
  addTool(toolName) {
    this.tools.add(toolName);
    return this;
  }

  /**
   * 移除工具
   */
  removeTool(toolName) {
    this.tools.delete(toolName);
    return this;
  }

  /**
   * 获取所有工具
   */
  getTools() {
    return Array.from(this.tools);
  }

  /**
   * 检查工具是否在分组中
   */
  hasTool(toolName) {
    return this.tools.has(toolName);
  }
}

/**
 * 中间件定义类
 */
export class MiddlewareDefinition {
  constructor(options = {}) {
    this.name = options.name || 'anonymous';
    this.priority = options.priority || 50;
    this.before = options.before || null;
    this.after = options.after || null;
    this.error = options.error || null;
    this.enabled = options.enabled !== false;
  }

  /**
   * 验证中间件定义
   */
  validate() {
    const errors = [];

    if (!this.before && !this.after && !this.error) {
      errors.push('中间件必须至少有一个钩子函数（before/after/error）');
    }

    if (this.before && typeof this.before !== 'function') {
      errors.push('before 钩子必须是函数');
    }

    if (this.after && typeof this.after !== 'function') {
      errors.push('after 钩子必须是函数');
    }

    if (this.error && typeof this.error !== 'function') {
      errors.push('error 钩子必须是函数');
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * 钩子结果类
 */
export class HookResult {
  constructor(options = {}) {
    this.executed = options.executed || false;
    this.result = options.result;
    this.error = options.error || null;
    this.hookName = options.hookName || '';
    this.hookFn = options.hookFn || '';
    this.pluginName = options.pluginName || null;
    this.duration = options.duration || 0;
  }
}

/**
 * 插件信息类
 */
export class PluginInfo {
  constructor(options = {}) {
    this.name = options.name;
    this.version = options.version || '1.0.0';
    this.description = options.description || '';
    this.state = options.state || 'registered';
    this.dependencies = options.dependencies || [];
    this.enabled = options.enabled !== false;
    this.registeredAt = options.registeredAt || Date.now();
    this.hookCount = options.hookCount || 0;
    this.middlewareCount = options.middlewareCount || 0;
  }
}

/**
 * 事件数据类
 */
export class EventData {
  constructor(type, data = {}) {
    this.type = type;
    this.timestamp = Date.now();
    Object.assign(this, data);
  }
}

/**
 * 创建工具定义的工厂函数
 */
export function createToolDefinition(options) {
  return new ToolDefinition(options);
}

/**
 * 创建工具分组的工厂函数
 */
export function createToolGroup(options) {
  return new ToolGroup(options);
}

/**
 * 创建中间件定义的工厂函数
 */
export function createMiddleware(options) {
  return new MiddlewareDefinition(options);
}
