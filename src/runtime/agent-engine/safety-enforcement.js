/**
 * AgentEngine 安全策略与资源释放
 *
 * 职责：
 *   - updateMemory / clearMemory / updateConfig（状态同步 + 钩子触发）
 *   - dispose：完整释放所有子组件资源
 */

import { HOOKS } from '../plugin-system.js';
import { RuntimeEvent } from '../types.js';

export async function updateMemory(ctx, operation, data) {
  await ctx.pluginManager.triggerHook(HOOKS.ON_MEMORY_UPDATE, operation, data);
  ctx.eventBus.emit(RuntimeEvent.MEMORY_UPDATE, { operation, data });
}

export async function clearMemory(ctx) {
  await ctx.pluginManager.triggerHook(HOOKS.ON_MEMORY_CLEAR);

  if (ctx.memoryManager && typeof ctx.memoryManager.clear === 'function') {
    await ctx.memoryManager.clear();
  } else if (ctx.memoryManager && typeof ctx.memoryManager.reset === 'function') {
    await ctx.memoryManager.reset();
  }

  ctx.eventBus.emit(RuntimeEvent.MEMORY_CLEAR, {});
}

export async function updateConfig(ctx, key, value) {
  ctx.config.update(key, value);
  await ctx.pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, key, value);
  ctx.eventBus.emit(RuntimeEvent.CONFIG_CHANGE, { key, value });
}

/**
 * 销毁引擎并清理所有子组件资源。按初始化的逆序释放。
 */
export async function dispose(ctx) {
  await ctx.pluginManager.triggerHook(HOOKS.BEFORE_DISPOSE, ctx);

  // 停止调度器
  if (ctx.schedulerEngine) {
    try { await ctx.schedulerEngine.stop(); } catch (_) {}
  }

  // 停止 MCP 客户端
  if (ctx.mcpClient && typeof ctx.mcpClient.dispose === 'function') {
    try { await ctx.mcpClient.dispose(); } catch (_) {}
  }

  // 停止自动化引擎
  if (ctx.automationEngine && typeof ctx.automationEngine.stop === 'function') {
    try { await ctx.automationEngine.stop(); } catch (_) {}
  }

  // 清理 Agent 实例
  if (ctx.agent && typeof ctx.agent.dispose === 'function') {
    try { ctx.agent.dispose(); } catch (_) {}
  }

  // 发射 AGENT_STOP 事件（在 clear 之前）
  ctx.eventBus.emit(RuntimeEvent.AGENT_STOP, {});

  // 清理插件管理器
  try { await ctx.pluginManager.dispose(); } catch (_) {}

  // 清理事件总线
  ctx.eventBus.clear();

  ctx.isInitialized = false;

  await ctx.pluginManager.triggerHook(HOOKS.AFTER_DISPOSE);
}
