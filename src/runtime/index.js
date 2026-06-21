/**
 * Runtime Layer Entry Point
 * 运行时层入口点 - 导出共享组件供 CLI 和 Desktop 平台使用
 */

// Types - 类型定义
export * from './types.js';

// Event Bus - 事件总线
export { RuntimeEventBus, getEventBus, resetEventBus, EventPriority } from './event-bus.js';

// Agent Engine - Agent 引擎
export { AgentEngine } from './agent-engine.js';
export { ReActAgent } from '../core/runtime/agent/agent.js';
export { ToolRegistry } from '../core/runtime/agent/tool-registry.js';
export { SessionManager } from '../core/session/session-manager.js';
export { ExperienceMemory } from '../core/session/experience-memory.js';

// Runtime support - 运行时支撑能力
export {
  loadRuntimeEnv,
  applyRuntimeValues,
  getMissingRequiredConfig,
  getProviderBaseUrl,
  getProviderModel,
  getProviderRequirement,
  getUserEnvPath,
  writeUserEnv,
  APP_NAME,
  APP_DISPLAY_NAME,
  APP_COPYRIGHT,
  APP_CREDITS,
} from '../core/runtime/runtime-config.js';
export {
  RUNTIME_STATUS_META,
  getRuntimeStatusMeta,
  getRuntimeStatusText,
} from '../core/runtime/runtime-status.js';
export {
  normalizePreviewUrlInput,
  formatPreviewUrlInput,
} from '../core/runtime/preview-url.js';

// Plugin System - 插件系统
export * from './plugin-system.js';

// Migration Bridge - 迁移桥接
export * from './migration-bridge.js';

// Convenience factory - 便捷工厂函数
import { AgentEngine } from './agent-engine.js';
import { ReActAgent } from '../core/runtime/agent/agent.js';
import { ToolRegistry } from '../core/runtime/agent/tool-registry.js';
import { SessionManager } from '../core/session/session-manager.js';
import { ExperienceMemory } from '../core/session/experience-memory.js';
import { RuntimeConfig, PlatformType } from './types.js';
import { detectPlatform, createCompatibilityLayer, MigrationBridge } from './migration-bridge.js';

/**
 * Create a new Agent Engine instance
 * 创建新的 Agent 引擎实例
 */
export function createAgentEngine(config = {}) {
  return new AgentEngine(config);
}

/**
 * Create runtime with automatic platform detection
 * 创建运行时并自动检测平台
 */
export function createRuntime(options = {}) {
  const platform = options.platform || detectPlatform();
  const config = new RuntimeConfig({
    platform,
    workingDirectory: options.workingDirectory || process.cwd(),
    debug: options.debug || false,
    maxIterations: options.maxIterations,
    autoDownloadModels: options.autoDownloadModels !== false,
    ...options
  });
  
  return createAgentEngine(config);
}

/**
 * Create compatibility layer for gradual migration
 * 创建兼容层用于渐进式迁移
 */
export { createCompatibilityLayer };

/**
 * Default runtime export - 默认运行时导出
 */
export default {
  AgentEngine,
  ReActAgent,
  ToolRegistry,
  SessionManager,
  ExperienceMemory,
  RuntimeConfig,
  PlatformType,
  createAgentEngine,
  createRuntime,
  createCompatibilityLayer,
  MigrationBridge
};
