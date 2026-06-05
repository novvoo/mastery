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
  ON_PLUGIN_DISABLE: 'on_plugin_disable'
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
  ERROR: 'error'
};

/**
 * 钩子优先级（数字越小优先级越高）
 */
export const HookPriority = {
  HIGHEST: 0,
  HIGH: 25,
  NORMAL: 50,
  LOW: 75,
  LOWEST: 100
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

/**
 * 钩子条目类 - 支持优先级和元数据
 */
class HookEntry {
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
class HookManager {
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
    if (!hooks) return false;
    
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
            error
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
    return hooks.map(entry => ({
      name: entry.name,
      priority: entry.priority,
      pluginName: entry.pluginName,
      called: entry.called,
      enabled: entry.enabled
    }));
  }
}

/**
 * 工具中间件管理器
 */
class ToolMiddleware {
  #middlewares = [];
  #hooks;

  constructor(hooks) {
    this.#hooks = hooks;
  }

  /**
   * 添加中间件
   * @param {Object} middleware - 中间件对象
   * @param {Function} middleware.before - 执行前钩子
   * @param {Function} middleware.after - 执行后钩子
   * @param {Function} middleware.error - 错误处理钩子
   * @param {number} middleware.priority - 优先级
   */
  use(middleware) {
    const entry = {
      before: middleware.before || null,
      after: middleware.after || null,
      error: middleware.error || null,
      priority: middleware.priority ?? HookPriority.NORMAL,
      name: middleware.name ?? 'anonymous'
    };
    
    this.#middlewares.push(entry);
    this.#middlewares.sort((a, b) => a.priority - b.priority);
    
    return () => this.remove(entry);
  }

  /**
   * 移除中间件
   */
  remove(entry) {
    const index = this.#middlewares.indexOf(entry);
    if (index > -1) {
      this.#middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 执行工具调用（包装中间件）
   */
  async execute(toolName, args, context, executor) {
    const middlewareContext = {
      toolName,
      args: { ...args },
      context,
      startTime: Date.now(),
      metadata: {}
    };
    
    // 执行 before 中间件
    for (const middleware of this.#middlewares) {
      if (middleware.before) {
        try {
          await middleware.before(middlewareContext);
        } catch (error) {
          console.error(`[ToolMiddleware] before hook error in ${middleware.name}:`, error);
        }
      }
    }
    
    try {
      // 执行实际工具
      const result = await executor(toolName, middlewareContext.args, context);
      middlewareContext.result = result;
      
      // 执行 after 中间件
      for (const middleware of this.#middlewares) {
        if (middleware.after) {
          try {
            await middleware.after(middlewareContext);
          } catch (error) {
            console.error(`[ToolMiddleware] after hook error in ${middleware.name}:`, error);
          }
        }
      }
      
      return result;
    } catch (error) {
      middlewareContext.error = error;
      
      // 执行 error 中间件
      for (const middleware of this.#middlewares) {
        if (middleware.error) {
          try {
            await middleware.error(error, middlewareContext);
          } catch (handlerError) {
            console.error(`[ToolMiddleware] error hook error in ${middleware.name}:`, handlerError);
          }
        }
      }
      
      throw error;
    }
  }

  /**
   * 获取中间件数量
   */
  count() {
    return this.#middlewares.length;
  }

  /**
   * 清除所有中间件
   */
  clear() {
    this.#middlewares = [];
  }
}

/**
 * 工具分组管理器
 */
class ToolGroupManager {
  #groups = new Map();
  #toolToGroup = new Map();

  /**
   * 创建工具分组
   */
  createGroup(name, options = {}) {
    if (this.#groups.has(name)) {
      console.warn(`工具分组 "${name}" 已存在`);
      return false;
    }
    
    this.#groups.set(name, {
      name,
      description: options.description || '',
      tools: new Set(),
      metadata: options.metadata || {},
      enabled: options.enabled ?? true,
      priority: options.priority ?? 50
    });
    
    return true;
  }

  /**
   * 删除工具分组
   */
  deleteGroup(name) {
    const group = this.#groups.get(name);
    if (!group) return false;
    
    // 清除工具到分组的映射
    for (const toolName of group.tools) {
      this.#toolToGroup.delete(toolName);
    }
    
    this.#groups.delete(name);
    return true;
  }

  /**
   * 将工具添加到分组
   */
  addToGroup(groupName, toolName) {
    const group = this.#groups.get(groupName);
    if (!group) {
      console.warn(`工具分组 "${groupName}" 不存在`);
      return false;
    }
    
    // 如果工具已在其他分组，先移除
    const currentGroup = this.#toolToGroup.get(toolName);
    if (currentGroup) {
      currentGroup.tools.delete(toolName);
    }
    
    group.tools.add(toolName);
    this.#toolToGroup.set(toolName, group);
    return true;
  }

  /**
   * 从分组移除工具
   */
  removeFromGroup(toolName) {
    const group = this.#toolToGroup.get(toolName);
    if (!group) return false;
    
    group.tools.delete(toolName);
    this.#toolToGroup.delete(toolName);
    return true;
  }

  /**
   * 获取工具所属分组
   */
  getToolGroup(toolName) {
    return this.#toolToGroup.get(toolName)?.name || null;
  }

  /**
   * 获取分组中的所有工具
   */
  getGroupTools(groupName) {
    const group = this.#groups.get(groupName);
    return group ? Array.from(group.tools) : [];
  }

  /**
   * 获取所有分组
   */
  getAllGroups() {
    return Array.from(this.#groups.values()).map(group => ({
      name: group.name,
      description: group.description,
      toolCount: group.tools.size,
      enabled: group.enabled,
      priority: group.priority,
      metadata: { ...group.metadata }
    }));
  }

  /**
   * 启用/禁用分组
   */
  setGroupEnabled(groupName, enabled) {
    const group = this.#groups.get(groupName);
    if (!group) return false;
    group.enabled = enabled;
    return true;
  }

  /**
   * 检查分组是否启用
   */
  isGroupEnabled(groupName) {
    const group = this.#groups.get(groupName);
    return group?.enabled ?? false;
  }
}

/**
 * 工具动态加载器
 */
class ToolLoader {
  #loadedTools = new Map();
  #toolRegistry;
  #eventBus;
  #hooks;

  constructor(toolRegistry, eventBus, hooks) {
    this.#toolRegistry = toolRegistry;
    this.#eventBus = eventBus;
    this.#hooks = hooks;
  }

  /**
   * 动态加载工具
   */
  async loadTool(toolModule, options = {}) {
    try {
      // 支持模块路径或模块对象
      let tool;
      if (typeof toolModule === 'string') {
        tool = await import(toolModule);
        // 支持默认导出或命名导出
        tool = tool.default || tool;
      } else {
        tool = toolModule;
      }
      
      // 处理工具工厂函数
      if (typeof tool === 'function') {
        tool = tool(options.config || {});
      }
      
      // 处理工具数组
      const tools = Array.isArray(tool) ? tool : [tool];
      
      for (const t of tools) {
        if (!t || !t.name) {
          console.warn('无效的工具定义，缺少 name 属性');
          continue;
        }
        
        this.#toolRegistry.register(t);
        this.#loadedTools.set(t.name, {
          tool: t,
          module: typeof toolModule === 'string' ? toolModule : 'inline',
          loadedAt: Date.now(),
          enabled: true
        });
        
        // 触发工具注册钩子
        await this.#hooks.trigger(HOOKS.ON_TOOL_REGISTER, t.name, t);
        
        // 发送事件
        if (this.#eventBus) {
          this.#eventBus.emit('tool:loaded', { toolName: t.name });
        }
      }
      
      return tools;
    } catch (error) {
      console.error('加载工具失败:', error);
      throw error;
    }
  }

  /**
   * 卸载工具
   */
  async unloadTool(toolName) {
    const info = this.#loadedTools.get(toolName);
    if (!info) return false;
    
    // 从注册表中移除
    if (this.#toolRegistry.unregister) {
      this.#toolRegistry.unregister(toolName);
    }
    
    this.#loadedTools.delete(toolName);
    
    // 触发工具注销钩子
    await this.#hooks.trigger(HOOKS.ON_TOOL_UNREGISTER, toolName);
    
    // 发送事件
    if (this.#eventBus) {
      this.#eventBus.emit('tool:unloaded', { toolName });
    }
    
    return true;
  }

  /**
   * 重新加载工具
   */
  async reloadTool(toolName) {
    const info = this.#loadedTools.get(toolName);
    if (!info || info.module === 'inline') return false;
    
    await this.unloadTool(toolName);
    return this.loadTool(info.module, { config: info.tool.config });
  }

  /**
   * 获取已加载的工具信息
   */
  getLoadedToolInfo(toolName) {
    return this.#loadedTools.get(toolName);
  }

  /**
   * 获取所有已加载的工具
   */
  getAllLoadedTools() {
    return Array.from(this.#loadedTools.entries()).map(([name, info]) => ({
      name,
      module: info.module,
      loadedAt: info.loadedAt,
      enabled: info.enabled
    }));
  }

  /**
   * 启用/禁用工具
   */
  setToolEnabled(toolName, enabled) {
    const info = this.#loadedTools.get(toolName);
    if (!info) return false;
    info.enabled = enabled;
    return true;
  }
}

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
    
    // 检查依赖
    if (plugin.dependencies && plugin.dependencies.length > 0) {
      const missingDeps = plugin.dependencies.filter(dep => !this.#plugins.has(dep));
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
        if (!self.#toolLoader) return false;
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
    if (!pluginInstance) return false;
    
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
    if (!pluginInstance) return false;
    
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
      if (visited.has(name)) return;
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