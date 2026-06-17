/**
 * AgentEngine 插件桥接模块
 *
 * 职责：
 *   - 注册/注销插件
 *   - 钩子注册与触发
 *   - 工具分组（tool groups 由 tool-orchestration.js 已经处理）
 */

import { HOOKS } from '../plugin-system.js';

export async function registerPlugin(ctx, plugin, options = {}) {
  return ctx.pluginManager.register(plugin, options);
}

export async function unregisterPlugin(ctx, pluginName) {
  return ctx.pluginManager.unregister(pluginName);
}

export function getPluginManager(ctx) {
  return ctx.pluginManager;
}

export function registerHook(ctx, hookName, fn, options = {}) {
  return ctx.pluginManager.registerHook(hookName, fn, options);
}

export function getHooks() {
  return HOOKS;
}
