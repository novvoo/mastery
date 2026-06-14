import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock all heavy dependencies before importing the module under test
mock.module('../../../src/core/session-manager.js', () => ({
  SessionManager: class SessionManager {
    #model;
    constructor(opts = {}) { this.#model = opts?.model || null; }
    clear() {}
    setTokenizerModel() {}
    addMessage() {}
    getMessages() { return []; }
  },
}));

mock.module('../../../src/prompts/system-prompt.js', () => ({
  buildSystemPrompt: () => 'system prompt',
}));

mock.module('../../../src/errors/error-handler.js', () => ({
  classifyError: () => ({ type: 'unknown', retryable: false }),
  RetryStrategy: class RetryStrategy {
    shouldRetry() { return false; }
    getDelay() { return 0; }
  },
  withTimeout: (fn) => fn,
}));

mock.module('../../../src/cli/ui.js', () => ({
  ui: {
    toolCall: () => {}, toolResult: () => {}, toolError: () => {},
    iteration: () => {}, finalAnswer: () => {}, info: () => {},
    warn: () => {}, debug: () => {}, debugEvent: () => {},
  },
}));

mock.module('../../../src/core/text-tool-parser.js', () => ({
  TextToolParser: class TextToolParser {
    constructor() {}
    parse() { return []; }
  },
}));

mock.module('../../../src/core/intent-classifier.js', () => ({
  IntentClassifier: class IntentClassifier {
    constructor() {}
    async classify() { return null; }
  },
}));

mock.module('../../../src/core/dynamic-context-pruning.js', () => ({
  DynamicContextPruning: class DynamicContextPruning {
    prune(messages) { return messages; }
  },
}));

mock.module('../../../src/core/workspace-index.js', () => ({
  WorkspaceIndex: class WorkspaceIndex {
    constructor() {}
    stopPeriodicSync() {}
  },
}));

mock.module('../../../src/core/tool-router.js', () => ({
  selectToolsForRequest: () => [],
  shouldUseIntentClassifier: () => false,
}));

mock.module('../../../src/core/workspace-state.js', () => ({
  WorkspaceState: class WorkspaceState {
    constructor() {
      this.criticalFacts = [];
      this._files = new Map();
      this._failedPaths = new Map();
    }
    getSummary() { return {}; }
    getCriticalFacts() { return this.criticalFacts; }
    recordPathNotFound(path, reason) {
      this._files.delete(path);
      this._failedPaths.set(path, { reason: reason || 'Not found', timestamp: Date.now() });
      this.criticalFacts.push({ type: 'path_not_found', value: { path, reason }, source: 'error', priority: 'high' });
    }
    recordFileRead(path, success, content) {
      if (success) {
        this._failedPaths.delete(path);
        this._files.set(path, { exists: true, timestamp: Date.now(), source: 'read_file' });
        this.criticalFacts.push({ type: 'file_readable', value: { path }, source: 'read_file', priority: 'high' });
      } else {
        this.recordPathNotFound(path, content?.error || 'File not found');
      }
    }
    _getPathFromArgs(args, toolName) {
      if (!args) return null;
      if (args.path) return args.path;
      if (args.file_path) return args.file_path;
      if (args.file) return args.file;
      if (args.dir_path) return args.dir_path;
      if (args.directory) return args.directory;
      return null;
    }
    predictToolResult(toolName, args) {
      const KNOWN_TOOLS = new Set(['read_file', 'file_read', 'list_dir', 'read_directory', 'write_file', 'edit_file', 'file_edit', 'delete_file', 'file_delete', 'run_command', 'bash', 'run_mcp', 'code_search']);
      if (!KNOWN_TOOLS.has(toolName)) {
        return { canSkip: false, reason: 'Unknown tool - no prediction logic', predicted: null, type: 'unknown' };
      }
      const path = this._getPathFromArgs(args, toolName);
      if (!path) return { canSkip: false, type: 'ok', predicted: null };
      const exists = this.checkPathExists(path);
      if (exists === 'not_found') {
        if (['read_file', 'file_read', 'list_dir', 'read_directory'].includes(toolName)) {
          return { canSkip: true, reason: `Path "${path}" was previously checked and does not exist`, predicted: { error: 'File not found' }, type: 'will_fail' };
        }
      }
      return { canSkip: false, reason: `Path "${path}" exists or unknown, need actual tool call`, predicted: null, type: exists === 'exists' ? 'will_succeed' : 'ok' };
    }
    checkPathExists(path) {
      if (this._files.has(path)) return 'exists';
      if (this._failedPaths.has(path)) return 'not_found';
      return 'unknown';
    }
    getPathNotFoundReason(path) {
      return this._failedPaths.get(path)?.reason || null;
    }
    export() {
      return {
        criticalFacts: this.criticalFacts,
        files: Array.from(this._files.entries()),
        failedPaths: Array.from(this._failedPaths.entries()),
      };
    }
    import(state) {
      this.criticalFacts = state?.criticalFacts || [];
      this._files = new Map(state?.files || []);
      this._failedPaths = new Map(state?.failedPaths || []);
    }
    clear() {
      this.criticalFacts = [];
      this._files = new Map();
      this._failedPaths = new Map();
    }
  },
}));

mock.module('../../../src/core/observation-summarizer.js', () => ({
  ObservationSummarizer: class ObservationSummarizer {
    constructor() {}
    generateWorkspaceDescription() { return 'workspace'; }
    processToolResult(toolName, args, result) {
      return {
        summary: `Tool ${toolName} executed successfully`,
        facts: [],
        shouldCache: true,
      };
    }
  },
}));

mock.module('../../../src/core/harness/content-addressing.js', () => ({
  ContentAddressableStore: class ContentAddressableStore {},
  FileAnalyzer: class FileAnalyzer {},
}));

mock.module('../../../src/core/routed-tool-context.js', () => ({
  withRoutedToolContext: (fn) => fn,
}));

mock.module('../../../src/core/token-scope.js', () => ({
  TokenScope: class TokenScope {
    constructor() {}
    track() {}
    getUsage() { return { total: 0 }; }
  },
}));

mock.module('../../../src/core/agent-constants.js', () => ({
  MAX_ITERATIONS_DEFAULT: 10,
  METHODOLOGY_TOOLS: [],
}));

mock.module('../../../src/planner/graph-planner.js', () => ({
  TaskStatus: { PENDING: 'pending', RUNNING: 'running', DONE: 'done' },
}));

mock.module('../../../src/core/execution-plan-manager.js', () => ({
  isMutationTool: () => false,
  isSemanticRiskReviewTool: () => false,
}));

mock.module('../../../src/core/prompt-builder.js', () => ({
  isTermination: () => false,
  extractFinalAnswer: () => '',
  normalizeFinalAnswer: (a) => a,
  containsUnparsedToolSyntax: () => false,
  shouldCorrectToolRefusal: () => false,
  shouldBlockCodingFinal: () => false,
  buildToolSyntaxCorrectionPrompt: () => '',
  buildToolUseCorrectionPrompt: () => '',
}));

mock.module('../../../src/core/agent-planner.js', () => ({
  AgentPlanner: class AgentPlanner {
    constructor() {}
  },
}));

mock.module('../../../src/core/agent-verifier.js', () => ({
  AgentVerifier: class AgentVerifier {
    constructor() {}
  },
}));

mock.module('../../../src/core/agent-router.js', () => ({
  AgentRouter: class AgentRouter {
    constructor() {}
    reset() {}
  },
}));

mock.module('../../../src/core/agent-context.js', () => ({
  AgentContext: class AgentContext {
    constructor() {}
  },
}));

import { ReActAgent } from '../../../src/core/agent.js';

function makeModelProvider(response = 'Final answer') {
  return {
    chat: mock(async () => ({ content: response })),
    dispose: mock(() => {}),
  };
}

function makeToolRegistry(tools = []) {
  const map = new Map(tools.map(t => [t.name, t]));
  return {
    get: mock((name) => map.get(name)),
    getAll: mock(() => tools),
    has: mock((name) => map.has(name)),
    toFunctionDefinitions: mock(() => []),
  };
}

function makeMemoryManager() {
  return {
    store: mock(async () => {}),
    recall: mock(async () => []),
  };
}

function makeAgent(overrides = {}) {
  const modelProvider = overrides.modelProvider || makeModelProvider();
  const toolRegistry = overrides.toolRegistry || makeToolRegistry();
  const memoryManager = overrides.memoryManager || makeMemoryManager();
  const config = overrides.config || {};
  const ui = overrides.ui || {
    toolCall: () => {}, toolResult: () => {}, toolError: () => {},
    iteration: () => {}, finalAnswer: () => {}, info: () => {},
    warn: () => {}, debug: () => {}, debugEvent: () => {},
  };
  return new ReActAgent(modelProvider, toolRegistry, memoryManager, config, ui);
}

describe('ReActAgent', () => {
  test('constructs without error with valid dependencies', () => {
    const agent = makeAgent();
    expect(agent).toBeDefined();
  });

  test('exposes memoryManager getter', () => {
    const mm = makeMemoryManager();
    const agent = makeAgent({ memoryManager: mm });
    expect(agent.memoryManager).toBe(mm);
  });

  test('exposes sessionManager getter', () => {
    const agent = makeAgent();
    expect(agent.sessionManager).toBeDefined();
  });

  test('stop() can be called without error', () => {
    const agent = makeAgent();
    expect(() => agent.stop()).not.toThrow();
  });

  test('getTools() returns the tool registry', () => {
    const registry = makeToolRegistry();
    const agent = makeAgent({ toolRegistry: registry });
    expect(agent.getTools()).toBe(registry);
  });

  test('setDebugMode() can be called without error', () => {
    const agent = makeAgent();
    expect(() => agent.setDebugMode(true)).not.toThrow();
  });

  test('clearSession() can be called without error', () => {
    const agent = makeAgent();
    expect(() => agent.clearSession()).not.toThrow();
  });

  test('constructs with custom maxIterations config', () => {
    const agent = makeAgent({ config: { maxIterations: 5 } });
    expect(agent).toBeDefined();
  });

  test('constructs with intentClassification disabled by default', () => {
    const agent = makeAgent({ config: { intentClassification: false } });
    expect(agent.intentClassifier).toBeNull();
  });

  test('dispose() calls modelProvider.dispose()', () => {
    const modelProvider = makeModelProvider();
    const agent = makeAgent({ modelProvider });
    agent.dispose();
    expect(modelProvider.dispose).toHaveBeenCalled();
  });

  test('getLastRunResult() returns null before any run', () => {
    const agent = makeAgent();
    expect(agent.getLastRunResult()).toBeNull();
  });
});
