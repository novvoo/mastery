/**
 * Plugin System public entrypoint.
 *
 * Keep this file as the compatibility facade; implementation lives in focused
 * modules so lifecycle management, factories, and bundled plugins can evolve
 * independently.
 */

export { HOOKS, PluginState, HookPriority, PluginConfig } from './plugin-types.js';
export { HookEntry, HookManager } from './plugin-hooks.js';
export { ToolMiddleware, ToolGroupManager, ToolLoader } from './plugin-middleware.js';
export { PluginManager } from './plugin-manager.js';
export { createPlugin } from './plugin-factory.js';
export { LoggerPlugin, PerformancePlugin, CachePlugin } from './builtin-plugins.js';
