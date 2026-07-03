/**
 * AgentEngine 工具编排模块
 *
 * 职责：
 *   - 注册核心工具与调度器工具
 *   - 动态加载/卸载工具
 *   - 工具分组查询
 *   - 工具调用钩子包装（幂等）
 *   - MCP 服务器工具注册
 */

import { createCoreTools, createSchedulerTools, SKILL_TOOL_CREATORS } from '../../tools/index.js';
import { HOOKS } from '../plugin-system.js';
import { describeToolActivity } from '../../core/tool-activity.js';
import { RuntimeEvent } from '../types.js';
import { normalizeToolResult } from '../../core/runtime/agent/tool-result.js';

/**
 * 注册所有核心工具 + 根据条件注册调度器工具 + skill 工具。
 * 每个工具注册后会触发 ON_TOOL_REGISTER 钩子。
 */
export async function registerAllTools(ctx) {
  const { toolRegistry, pluginManager, schedulerEngine, config } = ctx;
  const registeredTools = [];

  const registerBatch = (tools, label) => {
    try {
      for (const tool of tools) {
        toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn(`${label} 注册失败:`, error.message);
    }
  };

  registerBatch(
    createCoreTools({
      workingDirectory: config?.workingDirectory,
      mcpClient: ctx.mcpClient,
    }),
    '核心工具',
  );

  if (schedulerEngine) {
    registerBatch(createSchedulerTools(schedulerEngine), '调度器工具');
  }

  for (const creator of SKILL_TOOL_CREATORS) {
    try {
      const tool = creator();
      toolRegistry.register(tool);
      registeredTools.push(tool.name);
    } catch (error) {
      console.warn(`技能工具 ${creator.name || 'unknown'} 注册失败:`, error.message);
    }
  }

  for (const toolName of registeredTools) {
    try {
      await pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, toolName, toolRegistry.get(toolName));
    } catch (_) {
      // 钩子失败不影响工具可用性
    }
  }
}

/**
 * 延迟注册调度器工具。在 attachModelProvider 时可能被调用。
 */
export async function registerSchedulerTools(ctx) {
  const { schedulerEngine, toolRegistry, pluginManager } = ctx;
  if (!schedulerEngine) {
    return;
  }
  try {
    for (const tool of createSchedulerTools(schedulerEngine)) {
      toolRegistry.register(tool);
      await pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
    }
  } catch (error) {
    console.warn('调度器工具注册失败:', error.message);
  }
}

/**
 * 包装 toolRegistry.execute，插入钩子 + 中间件 + 事件发射。
 * 幂等：多次调用安全。
 */
export function wrapToolCalls(ctx) {
  if (ctx.toolCallsWrapped) {
    return;
  }

  const originalExecute = ctx.toolRegistry.execute.bind(ctx.toolRegistry);
  const eventBus = ctx.eventBus;
  const pluginManager = ctx.pluginManager;
  const toolMiddleware = pluginManager.getToolMiddleware();

  ctx.toolRegistry.execute = async (toolName, args, context) => {
    return toolMiddleware.execute(toolName, args, context, async (name, arguments_, execCtx) => {
      await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, name, arguments_);

      {
        const activity = describeToolActivity(name, arguments_, 'running');
        eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: name, args: arguments_, activity });
        eventBus.emit(RuntimeEvent.TOOL_ACTIVITY, activity);
      }

      try {
        const startedAt = Date.now();
        const result = await originalExecute(name, arguments_, execCtx);
        const normalized = normalizeToolResult(result);
        {
          const activity = describeToolActivity(
            name,
            arguments_,
            normalized.success ? 'completed' : 'failed',
            normalized.success ? result : normalized.error,
          );
          eventBus.emit(RuntimeEvent.TOOL_RESULT, {
            toolName: name,
            args: arguments_,
            result,
            success: normalized.success,
            error: normalized.error,
            durationMs: Date.now() - startedAt,
            activity,
          });
          eventBus.emit(RuntimeEvent.TOOL_ACTIVITY, activity);
        }
        await pluginManager.triggerHook(HOOKS.AFTER_TOOL_CALL, name, result);
        return result;
      } catch (error) {
        {
          const activity = describeToolActivity(name, arguments_, 'failed', error.message);
          eventBus.emit(RuntimeEvent.TOOL_ERROR, {
            toolName: name,
            args: arguments_,
            error: error.message,
            activity,
          });
          eventBus.emit(RuntimeEvent.TOOL_ACTIVITY, activity);
        }
        await pluginManager.triggerHook(HOOKS.ON_TOOL_ERROR, name, error);
        throw error;
      }
    });
  };

  ctx.toolCallsWrapped = true;
}

/**
 * 动态加载工具模块。需要 pluginManager 已初始化。
 */
export async function loadTool(ctx, toolModule, options = {}) {
  const loader = ctx.pluginManager.getToolLoader();
  if (!loader) {
    throw new Error('工具加载器未初始化');
  }
  return loader.loadTool(toolModule, options);
}

export async function unloadTool(ctx, toolName) {
  const loader = ctx.pluginManager.getToolLoader();
  if (!loader) {
    return false;
  }
  return loader.unloadTool(toolName);
}

export function createToolGroup(ctx, name, options = {}) {
  return ctx.pluginManager.getToolGroups().createGroup(name, options);
}

export function getToolGroups(ctx) {
  return ctx.pluginManager.getToolGroups().getAllGroups();
}

export function getGroupTools(ctx, groupName) {
  return ctx.pluginManager.getToolGroups().getGroupTools(groupName);
}

export function addToolMiddleware(ctx, middleware) {
  return ctx.pluginManager.getToolMiddleware().use(middleware);
}

export function getToolSummary(ctx) {
  return ctx.toolRegistry.getToolSummary();
}

export function getToolsWithGroups(ctx) {
  const tools = ctx.toolRegistry.getAll();
  const groups = ctx.pluginManager.getToolGroups();
  return tools.map((tool) => ({
    ...tool,
    group: groups.getToolGroup(tool.name),
  }));
}

/**
 * 注册 MCP 服务器暴露的工具到本地 registry。
 * 在 connectMcpServer 成功后被调用。
 */
export function registerMcpTools(ctx, serverName) {
  const tools = ctx.mcpClient.getTools().filter((t) => t.serverName === serverName);
  for (const mcpTool of tools) {
    if (ctx.toolRegistry.has(mcpTool.fullName)) {
      continue;
    }

    const tool = {
      name: mcpTool.fullName,
      description: mcpTool.description,
      category: 'MCP',
      parameters: mcpTool.inputSchema.properties || {},
      required: mcpTool.inputSchema.required || [],
      handler: async (args) => await ctx.mcpClient.callTool(mcpTool.fullName, args),
    };
    ctx.toolRegistry.register(tool);
    ctx.pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
  }
}
