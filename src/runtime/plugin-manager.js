import { HOOKS, PluginState, PluginConfig } from './plugin-types.js';
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

    this.#hookManager.setErrorHandler('*', (error, context) => {
      console.error(`[HookManager] 钩子执行错误 (${context.hookName}):`, error);
    });
  }

  setToolRegistry(toolRegistry) {
    this.#toolRegistry = toolRegistry;
    this.#toolLoader = new ToolLoader(toolRegistry, this.#eventBus, this.#hookManager);
  }

  async register(plugin, options = {}) {
    if (!plugin || !plugin.name) {
      throw new Error('插件必须包含 name 属性');
    }

    if (this.#plugins.has(plugin.name)) {
      console.warn(`插件 "${plugin.name}" 已注册`);
      return false;
    }

    const deps = plugin.dependencies || [];
    if (deps.includes(plugin.name)) {
      throw new Error(`插件 "${plugin.name}" 不能依赖自身`);
    }

    const tempGraph = new Map(this.#dependencyGraph);
    tempGraph.set(plugin.name, deps);
    const cycle = this.#detectCircularDependency(plugin.name, tempGraph);
    if (cycle) {
      throw new Error(`插件 "${plugin.name}" 存在循环依赖: ${cycle.join(' → ')}`);
    }

    if (deps.length > 0) {
      const missingDeps = deps.filter(dep => !this.#plugins.has(dep));
      if (missingDeps.length > 0) {
        throw new Error(`插件 "${plugin.name}" 缺少依赖: ${missingDeps.join(', ')}`);
      }
    }

    const pluginInstance = {
      name: plugin.name,
      version: plugin.version || '1.0.0',
      description: plugin.description || '',
      dependencies: plugin.dependencies || [],
      state: PluginState.REGISTERED,
      config: new PluginConfig(plugin.defaultConfig || {}, plugin.configSchema),
      plugin,
      registeredAt: Date.now(),
      enabled: true,
      hooks: [],
      middlewares: []
    };

    if (options.config) {
      pluginInstance.config.set(options.config);
    }

    const validation = pluginInstance.config.validate();
    if (!validation.valid) {
      throw new Error(`插件 "${plugin.name}" 配置验证失败: ${validation.errors.join(', ')}`);
    }

    this.#dependencyGraph.set(plugin.name, plugin.dependencies || []);
    this.#plugins.set(plugin.name, pluginInstance);
    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_REGISTER, plugin.name, pluginInstance);

    if (typeof plugin.initialize === 'function') {
      pluginInstance.state = PluginState.INITIALIZING;

      try {
        const context = this.#createPluginContext(pluginInstance);
        await plugin.initialize(context);
        pluginInstance.state = PluginState.INITIALIZED;
      } catch (error) {
        pluginInstance.state = PluginState.ERROR;
        console.error(`插件 "${plugin.name}" 初始化失败:`, error);
        this.#plugins.delete(plugin.name);
        this.#dependencyGraph.delete(plugin.name);
        throw error;
      }
    }

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

  async unregister(pluginName) {
    const pluginInstance = this.#plugins.get(pluginName);
    if (!pluginInstance) {
      return false;
    }

    const dependents = this.#getDependents(pluginName);
    if (dependents.length > 0) {
      throw new Error(`无法注销插件 "${pluginName}"，以下插件依赖它: ${dependents.join(', ')}`);
    }

    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_DISABLE, pluginName);

    for (const { unsubscribe } of pluginInstance.hooks) {
      unsubscribe();
    }

    for (const remove of pluginInstance.middlewares) {
      remove();
    }

    if (typeof pluginInstance.plugin.cleanup === 'function') {
      try {
        await pluginInstance.plugin.cleanup();
      } catch (error) {
        console.error(`插件 "${pluginName}" 清理失败:`, error);
      }
    }

    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_UNREGISTER, pluginName);
    this.#plugins.delete(pluginName);
    this.#dependencyGraph.delete(pluginName);
    console.log(`插件 "${pluginName}" 已注销`);
    return true;
  }

  async enable(pluginName) {
    const pluginInstance = this.#plugins.get(pluginName);
    if (!pluginInstance) {return false;}

    pluginInstance.enabled = true;
    pluginInstance.state = PluginState.ACTIVE;

    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_ENABLE, pluginName);
    return true;
  }

  async disable(pluginName) {
    const pluginInstance = this.#plugins.get(pluginName);
    if (!pluginInstance) {return false;}

    pluginInstance.enabled = false;
    pluginInstance.state = PluginState.DISABLED;

    await this.#hookManager.trigger(HOOKS.ON_PLUGIN_DISABLE, pluginName);
    return true;
  }

  getPlugin(name) {
    return this.#plugins.get(name);
  }

  getAllPlugins() {
    return Array.from(this.#plugins.values());
  }

  getPluginCount() {
    return this.#plugins.size;
  }

  registerHook(hookName, hookFn, options = {}) {
    return this.#hookManager.register(hookName, hookFn, options);
  }

  async triggerHook(hookName, ...args) {
    return this.#hookManager.trigger(hookName, ...args);
  }

  getHookManager() {
    return this.#hookManager;
  }

  getToolMiddleware() {
    return this.#toolMiddleware;
  }

  getToolGroups() {
    return this.#toolGroups;
  }

  getToolLoader() {
    return this.#toolLoader;
  }

  async dispose() {
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

  #createPluginContext(pluginInstance) {
    const self = this;

    return {
      eventBus: this.#eventBus,
      config: pluginInstance.config,
      getEngine: () => this.#toolRegistry,
      registerHook: (hookName, fn, options = {}) => {
        const unsubscribe = self.#hookManager.register(hookName, fn, {
          ...options,
          pluginName: pluginInstance.name
        });
        pluginInstance.hooks.push({ hookName, unsubscribe });
        return unsubscribe;
      },
      triggerHook: (hookName, ...args) => self.#hookManager.trigger(hookName, ...args),
      useMiddleware: (middleware) => {
        const remove = self.#toolMiddleware.use({
          ...middleware,
          name: `${pluginInstance.name}:${middleware.name || 'anonymous'}`
        });
        pluginInstance.middlewares.push(remove);
        return remove;
      },
      getPlugin: (name) => self.getPlugin(name),
      createToolGroup: (name, options) => self.#toolGroups.createGroup(name, options),
      addToToolGroup: (groupName, toolName) => self.#toolGroups.addToGroup(groupName, toolName),
      loadTool: async (toolModule, options) => {
        if (!self.#toolLoader) {
          throw new Error('工具注册表未设置');
        }
        return self.#toolLoader.loadTool(toolModule, options);
      },
      unloadTool: async (toolName) => {
        if (!self.#toolLoader) {return false;}
        return self.#toolLoader.unloadTool(toolName);
      }
    };
  }

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
        if (!graph.has(dep)) {continue;}
        const c = color.get(dep);
        if (c === GRAY) {
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

  #getDependents(pluginName) {
    const dependents = [];
    for (const [name, deps] of this.#dependencyGraph) {
      if (deps.includes(pluginName)) {
        dependents.push(name);
      }
    }
    return dependents;
  }

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
