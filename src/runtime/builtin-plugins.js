import { HOOKS, HookPriority } from './plugin-types.js';
import { createPlugin } from './plugin-factory.js';

export const LoggerPlugin = createPlugin({
  name: 'logger',
  version: '1.0.0',
  description: '日志插件 - 记录所有事件到控制台',

  hooks: {
    [HOOKS.BEFORE_AGENT_START]: async (input) => {
      console.log('[Logger] Agent 启动，输入:', input);
    },
    [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
      console.log('[Logger] Agent 完成，结果:', result);
    },
    [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
      console.log(`[Logger] 调用工具: ${toolName}`, args);
    },
    [HOOKS.ON_TOOL_ERROR]: async (toolName, error) => {
      const msg = error && error.message ? error.message : String(error);
      console.error(`[Logger] 工具 ${toolName} 执行失败: ${msg}`);
    },
    [HOOKS.ON_CONFIG_CHANGE]: async (key, value) => {
      console.log(`[Logger] 配置变更: ${key} =`, value);
    },
    [HOOKS.ON_MEMORY_UPDATE]: async (operation, data) => {
      console.log(`[Logger] 内存更新: ${operation}`, data);
    },
  },
});

export const PerformancePlugin = createPlugin({
  name: 'performance',
  version: '1.0.0',
  description: '性能监控插件 - 追踪性能指标',

  defaultConfig: {
    logInterval: 5000,
    trackMemory: true,
  },

  initialize({ eventBus }) {
    this.startTime = Date.now();
    this.calls = 0;
    this.events = [];
    this.timers = new Map();

    eventBus.subscribe('*', (event) => {
      this.calls++;
      this.events.push({
        type: event.type,
        timestamp: Date.now(),
      });
    });
  },

  cleanup() {
    const duration = Date.now() - this.startTime;
    console.log(`[Performance] 插件处理了 ${this.calls} 个事件，耗时 ${duration}ms`);
  },

  hooks: {
    [HOOKS.BEFORE_AGENT_START]: {
      fn: async function () {
        this.agentStartTime = Date.now();
      },
      priority: HookPriority.HIGH,
    },
    [HOOKS.AFTER_AGENT_COMPLETE]: async function () {
      const duration = Date.now() - this.agentStartTime;
      console.log(`[Performance] Agent 执行耗时 ${duration}ms`);
    },
    [HOOKS.BEFORE_TOOL_CALL]: {
      fn: async function (toolName) {
        this.timers.set(toolName, Date.now());
      },
      priority: HookPriority.HIGHEST,
    },
    [HOOKS.AFTER_TOOL_CALL]: async function (toolName) {
      const startTime = this.timers.get(toolName);
      if (startTime) {
        const duration = Date.now() - startTime;
        console.log(`[Performance] 工具 ${toolName} 执行耗时 ${duration}ms`);
        this.timers.delete(toolName);
      }
    },
  },

  middlewares: [
    {
      name: 'performance-tracker',
      priority: HookPriority.HIGHEST,
      before: async (ctx) => {
        ctx.metadata.startTime = Date.now();
      },
      after: async (ctx) => {
        const duration = Date.now() - ctx.metadata.startTime;
        console.log(`[Performance] 工具 ${ctx.toolName} 总耗时 ${duration}ms`);
      },
    },
  ],
});

export const CachePlugin = createPlugin({
  name: 'cache',
  version: '1.0.0',
  description: '缓存插件 - 缓存工具执行结果',
  dependencies: [],

  defaultConfig: {
    maxSize: 100,
    ttl: 60000,
  },

  initialize({ config }) {
    this.cache = new Map();
    this.maxSize = config.get('maxSize');
    this.ttl = config.get('ttl');
  },

  cleanup() {
    this.cache.clear();
  },

  middlewares: [
    {
      name: 'cache-middleware',
      priority: HookPriority.HIGHEST,
      before: async (ctx) => {
        const cacheKey = `${ctx.toolName}:${JSON.stringify(ctx.args)}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.ttl) {
          ctx.metadata.cached = true;
          ctx.metadata.cacheKey = cacheKey;
          ctx.args.__cachedResult = cached.result;
          return cached.result;
        }

        ctx.metadata.cacheKey = cacheKey;
      },
      after: async (ctx) => {
        if (!ctx.metadata.cached && ctx.metadata.cacheKey) {
          if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }

          this.cache.set(ctx.metadata.cacheKey, {
            result: ctx.result,
            timestamp: Date.now(),
          });
        }
      },
    },
  ],
});
