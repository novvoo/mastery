/**
 * AgentEngine 图规划与模型连接
 *
 * 职责：
 *   - attachModelProvider：附加模型提供者，按需初始化调度器
 *   - setModelProvider：切换/更新模型提供者
 *   - connectMcpServer：连接 MCP 服务器并注册工具
 */

import { SchedulerEngine } from '../../scheduler/SchedulerEngine.js';
import { HOOKS } from '../plugin-system.js';

/**
 * 附加/更新模型提供者。若 AgentEngine 已初始化，则同时创建调度器。
 */
export function attachModelProvider(ctx, modelProvider) {
  ctx.modelProvider = modelProvider;
  ctx.config.modelProvider = modelProvider;

  // 如果已初始化但没有 schedulerEngine，创建它
  if (ctx.isInitialized && !ctx.schedulerEngine) {
    const experienceDir = ctx.config.workingDirectory + '/.agent-data';
    ctx.schedulerEngine = new SchedulerEngine(
      {
        workingDirectory: ctx.config.workingDirectory,
        dataDir: experienceDir,
        checkIntervalMs: 60000,
        maxAgents: 10,
        securityPolicy: ctx.securityPolicy
      },
      ctx.modelProvider,
      ctx.toolRegistry,
      ctx.memoryManager
    );
    ctx.schedulerEngine.initialize().then(() => {
      // 注册调度器工具（延迟导入避免循环依赖）
      import('./tool-orchestration.js').then(mod => {
        mod.registerSchedulerTools(ctx);
      });
    }).catch(error => {
      console.warn('调度器引擎初始化失败:', error.message);
    });
  }

  // 为 memoryManager 设置 modelProvider，启用 LLM 选择器
  if (ctx.memoryManager && typeof ctx.memoryManager.setModelProvider === 'function') {
    ctx.memoryManager.setModelProvider(modelProvider);
  }

  ctx.pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, 'modelProvider', modelProvider);
}

export function setModelProvider(ctx, modelProvider, options = {}) {
  ctx.modelProvider = modelProvider;
  ctx.config.modelProvider = modelProvider;

  if (options.model) {
    ctx.config.model = options.model;
  }

  if (ctx.agent && typeof ctx.agent.setModelProvider === 'function') {
    ctx.agent.setModelProvider(modelProvider, options);
  }

  if (ctx.schedulerEngine) {
    ctx.schedulerEngine.modelProvider = modelProvider;
  }

  // 为 memoryManager 设置 modelProvider，启用 LLM 选择器
  if (ctx.memoryManager && typeof ctx.memoryManager.setModelProvider === 'function') {
    ctx.memoryManager.setModelProvider(modelProvider);
  }

  ctx.pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, 'modelProvider', modelProvider);
}

export async function connectMcpServer(ctx, name, config) {
  if (!ctx.mcpClient) throw new Error('MCP 客户端未初始化');

  const success = await ctx.mcpClient.connect(name, config);
  if (success) {
    // 延迟导入避免循环依赖
    const mod = await import('./tool-orchestration.js');
    mod.registerMcpTools(ctx, name);
  }
  return success;
}

export function getGraphPlanner(ctx) {
  return ctx.graphPlanner;
}
