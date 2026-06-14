/**
 * Plugin Tool Middleware System
 * 插件工具中间件系统 - 工具包装、分组和动态加载
 */

import { HookPriority } from './plugin-types.js';
import { HOOKS } from './plugin-types.js';

/**
 * 工具中间件管理器
 */
export class ToolMiddleware {
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
          const msg = (error && error.message) ? error.message : String(error);
          console.error(`[ToolMiddleware] before hook error in ${middleware.name}: ${msg}`);
        }
      }
    }

    try {
      // 执行实际工具
      const result = await executor(toolName, middlewareContext.args, context);
      middlewareContext.result = result;

      // 执行 after 中间件（反向：后注册的先执行 after，洋葱模型）
      for (let i = this.#middlewares.length - 1; i >= 0; i--) {
        const middleware = this.#middlewares[i];
        if (middleware.after) {
          try {
            await middleware.after(middlewareContext);
          } catch (error) {
            const msg = (error && error.message) ? error.message : String(error);
            console.error(`[ToolMiddleware] after hook error in ${middleware.name}: ${msg}`);
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
            const msg = (handlerError && handlerError.message) ? handlerError.message : String(handlerError);
            console.error(`[ToolMiddleware] error hook error in ${middleware.name}: ${msg}`);
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
export class ToolGroupManager {
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
    if (!group) {return false;}

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
    if (!group) {return false;}

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
    if (!group) {return false;}
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
export class ToolLoader {
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
      const msg = (error && error.message) ? error.message : String(error);
      console.error(`加载工具失败: ${msg}`);
      throw error;
    }
  }

  /**
   * 卸载工具
   */
  async unloadTool(toolName) {
    const info = this.#loadedTools.get(toolName);
    if (!info) {return false;}

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
    if (!info || info.module === 'inline') {return false;}

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
    if (!info) {return false;}
    info.enabled = enabled;
    return true;
  }
}
