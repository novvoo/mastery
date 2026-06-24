#!/usr/bin/env bun
/**
 * AI Engineering Mastery Agent public entrypoint.
 *
 * Keep this file thin so importing the package does not start the interactive CLI.
 */

import { pathToFileURL } from 'url';
import AIEngineeringAgent, { handleCliArgs } from './cli/agent-app.js';

export async function runCli(argv = process.argv.slice(2)) {
  if (!(await handleCliArgs(argv))) {
    const app = new AIEngineeringAgent();
    await app.run();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { AIEngineeringAgent, handleCliArgs };
export default AIEngineeringAgent;

// Backward-compatible public API exports
export { ReActAgent } from './core/runtime/agent/agent.js';
export { ToolRegistry } from './core/runtime/agent/tool-registry.js';
export { SessionManager } from './core/session/session-manager.js';
export { MemoryManager } from './memory/memory-manager.js';
export { SecurityPolicy } from './core/runtime/agent/support/security-policy.js';
export { TokenJuice } from './core/runtime/agent/support/token-juice.js';
export { ExperienceMemory } from './core/session/experience-memory.js';
export { IntelligentReasoning } from './core/intelligent-reasoning.js';
export { AutomationEngine } from './core/automation-engine.js';
export { Embedder } from './core/embedder.js';
export { ToolCategory } from './core/types.js';
export { OpenAIModelProvider } from './models/openai-provider.js';
export { LlamaModelProvider } from './models/llama-provider.js';
export { ZhipuModelProvider } from './models/zhipu-provider.js';
export { DeepSeekModelProvider } from './models/deepseek-provider.js';
export { OpenRouterModelProvider } from './models/openrouter-provider.js';
export { SchedulerEngine } from './scheduler/SchedulerEngine.js';
export { MCPClient } from './mcp/mcp-client.js';
export { createFileSystemTools } from './tools/filesystem/filesystem-tools.js';
export { createShellTool } from './tools/system/shell.js';
export { createPtyTools } from './tools/system/pty.js';
export { createSemanticSearchTool } from './tools/memory/semantic-search.js';
export { createDocumentRagTools } from './tools/memory/document-rag.js';
export { createWebTools } from './tools/web/web-tools.js';
export { createPreviewTools } from './tools/web/preview-tools.js';
export { createGitTools } from './tools/git/git-tools.js';
export { createMCPTools } from './tools/mcp/mcp-tools.js';
export { createTaskTools } from './tools/scheduler/task-tools.js';
export { createScheduleTools } from './tools/scheduler/schedule-tools.js';
export { createSubAgentTools } from './tools/scheduler/subagent-tools.js';
export { default as createBrainstormTool } from './tools/skills/brainstorm.js';
export { default as createGrillTool } from './tools/skills/grill.js';
export { default as createTddTool } from './tools/skills/tdd.js';
export { default as createDiagnoseTool } from './tools/skills/diagnose.js';
export { default as createVerifyTool } from './tools/skills/verify.js';
export { default as createCoverageCheckTool } from './tools/skills/coverage_check.js';
export { default as createAskUserTool } from './tools/skills/ask_user.js';
export { default as createReviewTool } from './tools/skills/review.js';
export { default as createArchitectTool } from './tools/skills/architect.js';
export { default as createZoomOutTool } from './tools/skills/zoom_out.js';
export { default as createCavemanTool } from './tools/skills/caveman.js';
export { default as createHandoffTool } from './tools/skills/handoff.js';
export { default as createToPrdTool } from './tools/skills/to_prd.js';
export { default as createToIssuesTool } from './tools/skills/to_issues.js';
export { default as createSetupTool } from './tools/skills/setup.js';
export { enhancedUI } from './cli/enhanced-ui.js';
export { createEnhancedCommands } from './cli/enhanced-commands.js';
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
} from './core/runtime/runtime-config.js';
export {
  listWorkspaceDirectory,
  createWorkspaceWatcher,
  DEFAULT_IGNORED_WATCH_DIRECTORIES,
} from './core/workspace/workspace-watcher.js';
export {
  buildActivitySummary,
  getActivityTone,
  getFileStatusLabel,
  getFileTypeIcon,
  formatDuration,
} from './core/runtime/activity-summary.js';
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
} from './core/runtime/runtime-details.js';
export { normalizePreviewUrlInput, formatPreviewUrlInput } from './core/runtime/preview-url.js';
export { TextEditMapper } from './core/harness/textedit-mapper.js';
export { SandboxedFilesystem } from './core/harness/sandbox-filesystem.js';
export { ProjectSnapshotStore } from './core/harness/persistent-snapshot-store.js';
export { ModuleResolver } from './core/harness/module-resolver.js';
export { ImportGraph } from './core/harness/import-graph.js';
export { BarrelManager } from './core/harness/barrel-manager.js';
export { EnhancedImportGraph } from './core/harness/enhanced-import-graph.js';
export { LSPSandboxInstaller } from './lsp/lsp-sandbox-installer.js';
export { MemoryAudit } from './memory/memory-audit.js';

// ── Harness 核心: hashline / patch / diff3 ────────────────────────────
export {
  Patcher,
  HashlineBridge,
  Diff3MergeEngine,
  createPatcher,
  computeTag,
  hashContent,
  normalizeText,
} from './core/harness/hashline.js';
export { HashAnchoredPatcher, PatchIntentBuilder } from './core/harness/hash-anchored-patch.js';
export { ExportGraph } from './core/harness/import-graph.js';

// ── Workspace Edit 编排器 ────────────────────────────────────────────
export { EditOrchestrator, createEditOrchestrator } from './core/edit-orchestrator.js';

// ── Diagnostics Gate ──────────────────────────────────────────────────
export { DiagnosticsGate } from './core/diagnostics-gate.js';

// ── LSP 子系统完整导出 ────────────────────────────────────────────────
export {
  LSPClient,
  LSPClientError,
  LSPServerError,
  ServerManager,
  detectLanguage,
  createLSPTools,
} from './lsp/index.js';

// ── Memory 子系统增强: verifier / agent / structured / selector ───────
export {
  MemoryVerifier,
  MemoryProvenance,
  GitDiffStaleDetector,
} from './memory/memory-verifier.js';
export { AgentMemory } from './memory/agent-memory.js';
export { StructuredMemory } from './memory/structured-memory.js';
export { MemorySelector, RuleBasedSelector } from './memory/memory-selector.js';
export { ConversationJournal } from './memory/conversation-journal.js';

export {
  RUNTIME_STATUS_META,
  getRuntimeStatusMeta,
  getRuntimeStatusText,
} from './core/runtime/runtime-status.js';
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
} from './core/session/session-store.js';
export {
  createAgentEngine,
  createRuntime,
  createCompatibilityLayer,
  AgentEngine,
  RuntimeConfig,
  PlatformType,
  detectPlatform,
  MigrationBridge,
  getApiMapping,
  getAllApiMappings,
} from './runtime/index.js';
