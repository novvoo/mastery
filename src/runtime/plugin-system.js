/**
 * Plugin System for Runtime Layer
 * 运行时插件系统 - 增强版
 * 
 * 功能：
 * - 插件生命周期管理（initialize/cleanup）
 * - 插件依赖管理
 * - 插件配置系统
 * - 钩子系统（优先级、错误处理）
 * - 工具中间件机制
 */

// Re-export types, constants, and enums
export { HOOKS, PluginState, HookPriority, PluginConfig } from './plugin-types.js';

// Re-export hook system
export { HookEntry, HookManager } from './plugin-hooks.js';

// Re-export middleware system
export { ToolMiddleware, ToolGroupManager, ToolLoader } from './plugin-middleware.js';

// Import internal dependencies for PluginManager
import { HOOKS, PluginState, HookPriority, PluginConfig } from './plugin-types.js';
import { HookManager } from './plugin-hooks.js';
import { ToolMiddleware, ToolGroupManager, ToolLoader } from './plugin-middleware.js';

/**
 * 插件管理器 - 核心类
 */
export class PluginManager {
  #plugins = new Map();
  #hookManager;
  #toolMiddleware;
  #toolGroups;
  #toolLoader;
  #eventBus;
  #toolRegistry;
  #dependencyGraph = new Map();
  #config;

  constructor(eventBus, options = {}) {
    this.#eventBus = eventBus;
    this.#hookManager = new HookManager();
    this.#toolMiddleware = new ToolMiddleware(this.#hookManager);
    this.#toolGroups = new ToolGroupManager();
    this.#config = options.config || {};
    
    // 设置全局钩子错误处理器
    this.#hookManager.setErrorHandler('*', (error, context) => {
      console.error(`[HookManager] 钩子执行错误 (${context.hookName}):`, error);
    });
  }

  /**
   * 设置工具注册表（用于动态加载）
   */
  setToolRegistry(toolRegistry) {
    this.#toolRegistry = toolRegistry;
    this.#toolLoader = new ToolLoader(toolRegistry, this.#eventBus, this.#hookManager);
  }

  /**
   * 检测循环依赖（DFS + 三色标记法）
   * @private
   * @param {string} startNode - 起始插件名
   * @param {Map<string, string[]>} graph - 依赖图（插件名 → 依赖数组）
   * @returns {string[]|null} 循环路径，无则返回 null
   */
  #detectCircularDependency(startNode, graph) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    for (const node of graph.keys()) {color.set(node, WHITE);}

    const path = [];
    const dfs = (node) => {
      color.set(node, GRAY);
      path.push(node);
      const deps = graph.get(node) || [];
      for (const dep of deps) {
        if (!graph.has(dep)) {continue;} // 未注册的依赖跳过
        const c = color.get(dep);
        if (c === GRAY) {
          // 找到环
          const idx = path.indexOf(dep);
          return path.slice(idx).concat(dep);
        }
        if (c === WHITE) {
          const res = dfs(dep);
          if (res) {return res;}
        }
      }
      path.pop();
      color.set(node, BLACK);
      return null;
    };

    return dfs(startNode);
  }

  /**
   * 注册插件
   */
  async register(plugin, options = {}) {
    if (!plugin || !plugin.name) {
      throw new Error('插件必须包含 name 属性');
    }
    
    if (this.#plugins.has(plugin.name)) {
      console.warn(`插件 "${plugin.name}" 已注册`);
      return false;
    }
    
    const deps = plugin.dependencies || [];

    // 1) 自依赖检测
    if (deps.includes(plugin.name)) {
      throw new Error(`插件 "${plugin.name}" 不能依赖自身`);
    }

    // 2) 循环依赖检测（在当前依赖图基础上加入新插件后检测）
    const tempGraph = new Map(this.#dependencyGraph);
    tempGraph.set(plugin.name, deps);
    const cycle = this.#detectCircularDependency(plugin.name, tempGraph);
    if (cycle) {
      throw new Error(`插件 "${plugin.name}" 存在循环依赖: ${cycle.join(' → ')}`);
    }
    
    // 3) 缺失依赖抛错
    if (deps.length > 0) {
      const missingDeps = deps.filter(dep => !this.#plugins.has(dep));
      if (missingDeps.length > 0) {
        throw new Error(`插件 "${plugin.name}" 缺少依赖: ${missingDeps.join(', ')}`);
      }
    }
    
    // 创建插件实例
    const pluginInstance = {
      name: plugin.name,
      version: plugin.version || '1.0.0',
      description: plugin.description || '',
      dependencies: plugin.dependencies || [],
      state: PluginState.REGISTERED,
      config: new PluginConfig(plugin.defaultConfig || {}, plugin.configSchema),
      plugin: plugin,
      registeredAt: Date.now(),
      enabled: true,
      hooks: [],
      middlewares: []
    };
    
    // 应用用户配置
    if (options.config) {
      pluginInstance.config.set(options.config);
    }
    
    // 验证配置
    const validation = pluginInstance.config.validate();
    if (!validation.valid) {
      throw new Error(`插件 "${plugin.name}" 配置验证失败: ${validation.errors.join(', ')}`);
    }
    
    // 更新依赖图
    this.#dependencyGraph.set(plugin.name, plugin.dependencies || []);
    
    // 保存插件
    this.#plugins.set(plugin.name, pluginInstance);
    
    // 触发插件注册钩子
    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_REGISTER, plugin.name, pluginInstance);
    
    // 初始化插件
    if (typeof plugin.initialize === 'function') {
      pluginInstance.state = PluginState.INITIALIZING;
      
      try {
        const context = this.#createPluginContext(pluginInstance);
        await plugin.initialize(context);
        pluginInstance.state = PluginState.INITIALIZED;
      } catch (error) {
        pluginInstance.state = PluginState.ERROR;
        console.error(`插件 "${plugin.name}" 初始化失败:`, error);
        
        // 清理
        this.#plugins.delete(plugin.name);
        this.#dependencyGraph.delete(plugin.name);
        
        throw error;
      }
    }
    
    // 注册钩子
    if (plugin.hooks) {
      for (const [hookName, hookConfig] of Object.entries(plugin.hooks)) {
        const hookFn = typeof hookConfig === 'function' ? hookConfig : hookConfig.fn;
        const hookOptions = typeof hookConfig === 'function' 
          ? { pluginName: plugin.name }
          : { ...hookConfig, pluginName: plugin.name };
        
        const unsubscribe = this.#hookManager.register(hookName, hookFn.bind(plugin), hookOptions);
        pluginInstance.hooks.push({ hookName, unsubscribe });
      }
    }
    
    // 注册中间件
    if (plugin.middlewares && plugin.middlewares.length > 0) {
      for (const middleware of plugin.middlewares) {
        const remove = this.#toolMiddleware.use({
          ...middleware,
          name: `${plugin.name}:${middleware.name || 'anonymous'}`
        });
        pluginInstance.middlewares.push(remove);
      }
    }
    
    pluginInstance.state = PluginState.ACTIVE;
    
    console.log(`插件 "${plugin.name}" 注册成功`);
    return true;
  }

  /**
   * 创建插件上下文
   */
  #createPluginContext(pluginInstance) {
    const self = this;
    
    return {
      // 事件总线
      eventBus: this.#eventBus,
      
      // 插件配置
      config: pluginInstance.config,
      
      // 获取引擎引用（延迟获取）
      getEngine: () => this.#toolRegistry,
      
      // 注册钩子
      registerHook: (hookName, fn, options = {}) => {
        const unsubscribe = self.#hookManager.register(hookName, fn, {
          ...options,
          pluginName: pluginInstance.name
        });
        pluginInstance.hooks.push({ hookName, unsubscribe });
        return unsubscribe;
      },
      
      // 触发钩子
      triggerHook: (hookName, ...args) => {
        return self.#hookManager.trigger(hookName, ...args);
      },
      
      // 注册工具中间件
      useMiddleware: (middleware) => {
        const remove = self.#toolMiddleware.use({
          ...middleware,
          name: `${pluginInstance.name}:${middleware.name || 'anonymous'}`
        });
        pluginInstance.middlewares.push(remove);
        return remove;
      },
      
      // 获取其他插件
      getPlugin: (name) => self.getPlugin(name),
      
      // 工具分组
      createToolGroup: (name, options) => self.#toolGroups.createGroup(name, options),
      addToToolGroup: (groupName, toolName) => self.#toolGroups.addToGroup(groupName, toolName),
      
      // 动态加载工具
      loadTool: async (toolModule, options) => {
        if (!self.#toolLoader) {
          throw new Error('工具注册表未设置');
        }
        return self.#toolLoader.loadTool(toolModule, options);
      },
      
      // 卸载工具
      unloadTool: async (toolName) => {
        if (!self.#toolLoader) {return false;}
        return self.#toolLoader.unloadTool(toolName);
      }
    };
  }

  /**
   * 注销插件
   */
  async unregister(pluginName) {
    const pluginInstance = this.#plugins.get(pluginName);
    if (!pluginInstance) {
      return false;
    }
    
    // 检查是否有其他插件依赖此插件
    const dependents = this.#getDependents(pluginName);
    if (dependents.length > 0) {
      throw new Error(`无法注销插件 "${pluginName}"，以下插件依赖它: ${dependents.join(', ')}`);
    }
    
    // 触发插件禁用钩子
    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_DISABLE, pluginName);
    
    // 清理钩子
    for (const { unsubscribe } of pluginInstance.hooks) {
      unsubscribe();
    }
    
    // 清理中间件
    for (const remove of pluginInstance.middlewares) {
      remove();
    }
    
    // 执行插件清理
    if (typeof pluginInstance.plugin.cleanup === 'function') {
      try {
        await pluginInstance.plugin.cleanup();
      } catch (error) {
        console.error(`插件 "${pluginName}" 清理失败:`, error);
      }
    }
    
    // 触发插件注销钩子
    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_UNREGISTER, pluginName);
    
    // 移除插件
    this.#plugins.delete(pluginName);
    this.#dependencyGraph.delete(pluginName);
    
    console.log(`插件 "${pluginName}" 已注销`);
    return true;
  }

  /**
   * 获取依赖此插件的其他插件
   */
  #getDependents(pluginName) {
    const dependents = [];
    for (const [name, deps] of this.#dependencyGraph) {
      if (deps.includes(pluginName)) {
        dependents.push(name);
      }
    }
    return dependents;
  }

  /**
   * 启用插件
   */
  async enable(pluginName) {
    const pluginInstance = this.#plugins.get(pluginName);
    if (!pluginInstance) {return false;}
    
    pluginInstance.enabled = true;
    pluginInstance.state = PluginState.ACTIVE;
    
    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_ENABLE, pluginName);
    return true;
  }

  /**
   * 禁用插件
   */
  async disable(pluginName) {
    const pluginInstance = this.#plugins.get(pluginName);
    if (!pluginInstance) {return false;}
    
    pluginInstance.enabled = false;
    pluginInstance.state = PluginState.DISABLED;
    
    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_DISABLE, pluginName);
    return true;
  }

  /**
   * 获取插件
   */
  getPlugin(name) {
    return this.#plugins.get(name);
  }

  /**
   * 获取所有插件
   */
  getAllPlugins() {
    return Array.from(this.#plugins.values());
  }

  /**
   * 获取插件数量
   */
  getPluginCount() {
    return this.#plugins.size;
  }

  /**
   * 注册钩子
   */
  registerHook(hookName, hookFn, options = {}) {
    return this.#hookManager.register(hookName, hookFn, options);
  }

  /**
   * 触发钩子
   */
  async triggerHook(hookName, ...args) {
    return this.#hookManager.trigger(hookName, ...args);
  }

  /**
   * 获取钩子管理器
   */
  getHookManager() {
    return this.#hookManager;
  }

  /**
   * 获取工具中间件
   */
  getToolMiddleware() {
    return this.#toolMiddleware;
  }

  /**
   * 获取工具分组管理器
   */
  getToolGroups() {
    return this.#toolGroups;
  }

  /**
   * 获取工具加载器
   */
  getToolLoader() {
    return this.#toolLoader;
  }

  /**
   * 清理所有插件
   */
  async dispose() {
    // 按依赖顺序反向注销
    const order = this.#getUnloadOrder();
    
    for (const pluginName of order) {
      try {
        await this.unregister(pluginName);
      } catch (error) {
        console.error(`清理插件 "${pluginName}" 失败:`, error);
      }
    }
    
    this.#hookManager.clear();
    this.#toolMiddleware.clear();
  }

  /**
   * 获取插件卸载顺序（依赖顺序的反向）
   */
  #getUnloadOrder() {
    const visited = new Set();
    const order = [];
    
    const visit = (name) => {
      if (visited.has(name)) {return;}
      visited.add(name);
      
      const deps = this.#dependencyGraph.get(name) || [];
      for (const dep of deps) {
        visit(dep);
      }
      
      order.push(name);
    };
    
    for (const name of this.#plugins.keys()) {
      visit(name);
    }
    
    return order.reverse();
  }
}

/**
 * 创建插件工厂函数
 */
export function createPlugin(config) {
  return {
    name: config.name,
    version: config.version || '1.0.0',
    description: config.description || '',
    dependencies: config.dependencies || [],
    defaultConfig: config.defaultConfig || {},
    configSchema: config.configSchema || null,
    initialize: config.initialize,
    cleanup: config.cleanup,
    hooks: config.hooks || {},
    middlewares: config.middlewares || []
  };
}

/**
 * 日志插件示例
 */
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
      console.error(`[Logger] 工具 ${toolName} 执行失败:`, error);
    },
    [HOOKS.ON_CONFIG_CHANGE]: async (key, value) => {
      console.log(`[Logger] 配置变更: ${key} =`, value);
    },
    [HOOKS.ON_MEMORY_UPDATE]: async (operation, data) => {
      console.log(`[Logger] 内存更新: ${operation}`, data);
    }
  }
});

/**
 * 性能监控插件示例
 */
export const PerformancePlugin = createPlugin({
  name: 'performance',
  version: '1.0.0',
  description: '性能监控插件 - 追踪性能指标',
  
  defaultConfig: {
    logInterval: 5000,
    trackMemory: true
  },
  
  initialize({ config, eventBus }) {
    this.startTime = Date.now();
    this.calls = 0;
    this.events = [];
    this.timers = new Map();
    
    // 订阅所有事件
    eventBus.subscribe('*', (event) => {
      this.calls++;
      this.events.push({
        type: event.type,
        timestamp: Date.now()
      });
    });
  },
  
  cleanup() {
    const duration = Date.now() - this.startTime;
    console.log(`[Performance] 插件处理了 ${this.calls} 个事件，耗时 ${duration}ms`);
  },
  
  hooks: {
    [HOOKS.BEFORE_AGENT_START]: {
      fn: async function() {
        this.agentStartTime = Date.now();
      },
      priority: HookPriority.HIGH
    },
    [HOOKS.AFTER_AGENT_COMPLETE]: async function() {
      const duration = Date.now() - this.agentStartTime;
      console.log(`[Performance] Agent 执行耗时 ${duration}ms`);
    },
    [HOOKS.BEFORE_TOOL_CALL]: {
      fn: async function(toolName) {
        this.timers.set(toolName, Date.now());
      },
      priority: HookPriority.HIGHEST
    },
    [HOOKS.AFTER_TOOL_CALL]: async function(toolName) {
      const startTime = this.timers.get(toolName);
      if (startTime) {
        const duration = Date.now() - startTime;
        console.log(`[Performance] 工具 ${toolName} 执行耗时 ${duration}ms`);
        this.timers.delete(toolName);
      }
    }
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
      }
    }
  ]
});

/**
 * 缓存插件示例
 */
export const CachePlugin = createPlugin({
  name: 'cache',
  version: '1.0.0',
  description: '缓存插件 - 缓存工具执行结果',
  dependencies: [],
  
  defaultConfig: {
    maxSize: 100,
    ttl: 60000 // 1分钟
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
          // 清理旧缓存
          if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }
          
          this.cache.set(ctx.metadata.cacheKey, {
            result: ctx.result,
            timestamp: Date.now()
          });
        }
      }
    }
  ]
});
