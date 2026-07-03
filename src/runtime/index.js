/**
 * Runtime Layer Entry Point
 * 运行时层入口点 - 公共 API 的单一真相来源（single source of truth）
 *
 * All library exports go through this file.
 * src/index.js re-exports from here for package consumers.
 */

// ── Types ─────────────────────────────────────────────────────────────
export * from './types.js';

// ── Core Agent ────────────────────────────────────────────────────────
export { AgentEngine } from './agent-engine.js';
export { ReActAgent } from '../core/runtime/agent/agent.js';
export { ToolRegistry } from '../core/runtime/agent/tool-registry.js';
export { SessionManager } from '../core/session/session-manager.js';
export { ExperienceMemory } from '../core/session/experience-memory.js';
export { MemoryManager } from '../memory/memory-manager.js';
export { SecurityPolicy } from '../core/runtime/agent/support/security-policy.js';
export { TokenJuice } from '../core/runtime/agent/support/token-juice.js';
export { IntelligentReasoning } from '../core/intelligent-reasoning.js';
export { AutomationEngine } from '../core/automation-engine.js';
export { Embedder } from '../core/embedder.js';
export { ToolCategory } from '../core/types/index.js';
export {
  createAgentSessionId,
  getAgentSessionTitle,
  findAgentSession,
  upsertAgentSession,
  saveAgentInputHistory,
  normalizeRagDocuments,
  mergeRagDocuments,
  getDocumentDisplayName,
  createAgentErrorPrompt,
  createLocalStorageAdapter,
  createFileSystemStorageAdapter,
  MAX_AGENT_HISTORY_ITEMS,
  MAX_AGENT_SESSIONS,
} from '../core/session/session-store.js';

// ── Model Providers ───────────────────────────────────────────────────
export { OpenAIModelProvider } from '../models/openai-provider.js';
export { LlamaModelProvider } from '../models/llama-provider.js';
export { ZhipuModelProvider } from '../models/zhipu-provider.js';
export { DeepSeekModelProvider } from '../models/deepseek-provider.js';
export { OpenRouterModelProvider } from '../models/openrouter-provider.js';

// ── Scheduler ─────────────────────────────────────────────────────────
export { SchedulerEngine } from '../scheduler/SchedulerEngine.js';

// ── MCP ───────────────────────────────────────────────────────────────
export { MCPClient } from '../mcp/mcp-client.js';

// ── Tools ─────────────────────────────────────────────────────────────
export { createFileSystemTools } from '../tools/filesystem/filesystem-tools.js';
export { createShellTool } from '../tools/system/shell.js';
export { createPtyTools } from '../tools/system/pty.js';
export { createSemanticSearchTool } from '../tools/memory/semantic-search.js';
export { createDocumentRagTools } from '../tools/memory/document-rag.js';
export { createWebTools } from '../tools/web/web-tools.js';
export { createPreviewTools } from '../tools/web/preview-tools.js';
export { createGitTools } from '../tools/git/git-tools.js';
export { createMCPTools } from '../tools/mcp/mcp-tools.js';
export { createTaskTools } from '../tools/scheduler/task-tools.js';
export { createScheduleTools } from '../tools/scheduler/schedule-tools.js';
export { createSubAgentTools } from '../tools/scheduler/subagent-tools.js';
export { default as createBrainstormTool } from '../tools/skills/brainstorm.js';
export { default as createGrillTool } from '../tools/skills/grill.js';
export { default as createTddTool } from '../tools/skills/tdd.js';
export { default as createDiagnoseTool } from '../tools/skills/diagnose.js';
export { default as createVerifyTool } from '../tools/skills/verify.js';
export { default as createCoverageCheckTool } from '../tools/skills/coverage_check.js';
export { default as createAutoResearchTool } from '../tools/skills/auto_research.js';
export { default as createAskUserTool } from '../tools/skills/ask_user.js';
export { default as createReviewTool } from '../tools/skills/review.js';
export { default as createArchitectTool } from '../tools/skills/architect.js';
export { default as createZoomOutTool } from '../tools/skills/zoom_out.js';
export { default as createCavemanTool } from '../tools/skills/caveman.js';
export { default as createHandoffTool } from '../tools/skills/handoff.js';
export { default as createToPrdTool } from '../tools/skills/to_prd.js';
export { default as createToIssuesTool } from '../tools/skills/to_issues.js';
export { default as createSetupTool } from '../tools/skills/setup.js';

// ── CLI enhanced UI ───────────────────────────────────────────────────
export { enhancedUI } from '../cli/enhanced-ui.js';
export { createEnhancedCommands } from '../cli/enhanced-commands.js';

// ── Runtime support ───────────────────────────────────────────────────
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
export { normalizePreviewUrlInput, formatPreviewUrlInput } from '../core/runtime/preview-url.js';
export {
  listWorkspaceDirectory,
  createWorkspaceWatcher,
  DEFAULT_IGNORED_WATCH_DIRECTORIES,
} from '../core/workspace/workspace-watcher.js';
export {
  buildActivitySummary,
  getActivityTone,
  getFileStatusLabel,
  getFileTypeIcon,
  formatDuration,
} from '../core/runtime/activity-summary.js';
export {
  isRuntimeDetailMessage,
  isThinkingMessage,
  isStatusUpdateMessage,
  isPrimaryMessage,
  formatRuntimeDetailValue,
  compactToolResult,
  getRuntimeDetailContent,
  buildThinkingSummary,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  createConversationGroups,
  createRuntimeDetailId,
  buildRuntimeDetailsExportData,
} from '../core/runtime/runtime-details.js';

// ── Event Bus ─────────────────────────────────────────────────────────
export { RuntimeEventBus, getEventBus, resetEventBus, EventPriority } from './event-bus.js';

// ── Plugin System ─────────────────────────────────────────────────────
export * from './plugin-system.js';

// ── Migration Bridge ──────────────────────────────────────────────────
export * from './migration-bridge.js';

// ── Harness ───────────────────────────────────────────────────────────
export { TextEditMapper } from '../core/harness/textedit-mapper.js';
export { SandboxedFilesystem } from '../core/harness/sandbox-filesystem.js';
export { ProjectSnapshotStore } from '../core/harness/persistent-snapshot-store.js';
export { ModuleResolver } from '../core/harness/module-resolver.js';
export { ImportGraph, ExportGraph } from '../core/harness/import-graph.js';
export { BarrelManager } from '../core/harness/barrel-manager.js';
export { EnhancedImportGraph } from '../core/harness/enhanced-import-graph.js';
export {
  Patcher,
  HashlineBridge,
  Diff3MergeEngine,
  createPatcher,
  computeTag,
  hashContent,
  normalizeText,
} from '../core/harness/hashline.js';
export { HashAnchoredPatcher, PatchIntentBuilder } from '../core/harness/hash-anchored-patch.js';

// ── Workspace Edit ────────────────────────────────────────────────────
export { EditOrchestrator, createEditOrchestrator } from '../core/edit-orchestrator.js';

// ── Diagnostics Gate ──────────────────────────────────────────────────
export { DiagnosticsGate } from '../core/diagnostics-gate.js';

// ── LSP ───────────────────────────────────────────────────────────────
export {
  LSPClient,
  LSPClientError,
  LSPServerError,
  ServerManager,
  detectLanguage,
  createLSPTools,
} from '../lsp/index.js';
export { LSPSandboxInstaller } from '../lsp/lsp-sandbox-installer.js';

// ── Memory ────────────────────────────────────────────────────────────
export {
  MemoryVerifier,
  MemoryProvenance,
  GitDiffStaleDetector,
} from '../memory/memory-verifier.js';
export { AgentMemory } from '../memory/agent-memory.js';
export { StructuredMemory } from '../memory/structured-memory.js';
export { MemorySelector, RuleBasedSelector } from '../memory/memory-selector.js';
export { ConversationJournal } from '../memory/conversation-journal.js';
export { MemoryAudit } from '../memory/memory-audit.js';

// ── Convenience factories ─────────────────────────────────────────────
import { AgentEngine } from './agent-engine.js';
import { ReActAgent } from '../core/runtime/agent/agent.js';
import { ToolRegistry } from '../core/runtime/agent/tool-registry.js';
import { SessionManager } from '../core/session/session-manager.js';
import { ExperienceMemory } from '../core/session/experience-memory.js';
import { RuntimeConfig, PlatformType } from './types.js';
import { detectPlatform, createCompatibilityLayer, MigrationBridge } from './migration-bridge.js';

export function createAgentEngine(config = {}) {
  return new AgentEngine(config);
}

export function createRuntime(options = {}) {
  const platform = options.platform || detectPlatform();
  const config = new RuntimeConfig({
    platform,
    workingDirectory: options.workingDirectory || process.cwd(),
    debug: options.debug || false,
    maxIterations: options.maxIterations,
    autoDownloadModels: options.autoDownloadModels !== false,
    ...options,
  });

  return createAgentEngine(config);
}

export { createCompatibilityLayer };

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
  MigrationBridge,
};
