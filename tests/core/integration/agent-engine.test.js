import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mock all heavy dependencies before importing
let sessionMessages = [];
let sessionAssistantMessages = [];

mock.module('../../../src/core/session-manager.js', () => ({
  SessionManager: class SessionManager {
    static PRIORITY = Object.freeze({ ORDINARY: 1, EVIDENCE: 2, DECISION: 3 });
    static LAYER = Object.freeze({
      STRUCTURE: 0,
      PROJECTION: 10,
      DIAGNOSTICS: 20,
      DEPENDENCIES: 30,
      MEMORY: 40,
    });
    constructor() {
      sessionMessages = [];
      sessionAssistantMessages = [];
    }
    setSystemPrompt() {}
    addSystemMessage(msg) {
      sessionMessages.push({ role: 'system', content: msg });
    }
    addMessage(msg) {
      sessionMessages.push(msg);
    }
    addUserMessage(msg) {
      sessionMessages.push({ role: 'user', content: msg });
    }
    addAssistantMessage(msg) {
      sessionAssistantMessages.push(msg);
      sessionMessages.push({ role: 'assistant', content: msg });
    }
    getMessages() {
      return sessionMessages;
    }
    getHistory() {
      return [];
    }
    clear() {
      sessionMessages = [];
      sessionAssistantMessages = [];
    }
    get length() {
      return sessionMessages.length;
    }
  },
}));

mock.module('../../../src/prompts/system-prompt.js', () => ({
  buildSystemPrompt: () => 'system prompt',
}));

mock.module('../../../src/errors/error-handler.js', () => ({
  RetryStrategy: class RetryStrategy {
    shouldRetry() {
      return false;
    }
    getDelay() {
      return 0;
    }
    async executeWithRetry(fn) {
      return await fn();
    }
  },
  withTimeout: (fn) => fn,
}));

mock.module('../../../src/core/text-tool-parser.js', () => {
  let parseResult = [];
  return {
    TextToolParser: class TextToolParser {
      constructor() {}
      parse(text) {
        if (text.includes('<action>')) {
          return [{ name: 'read_file', arguments: { path: 'test.txt' }, source: 'action_tag' }];
        }
        if (text.includes('```json')) {
          return [{ name: 'search_file', arguments: { pattern: 'test' }, source: 'code_fence' }];
        }
        return parseResult;
      }
      generateToolPrompt() {
        return '';
      }
    },
    _setParseResult: (result) => {
      parseResult = result;
    },
  };
});

mock.module('../../../src/core/intent-classifier.js', () => ({
  IntentClassifier: class IntentClassifier {
    constructor() {}
    async classify() {
      return null;
    }
  },
}));

mock.module('../../../src/core/dynamic-context-pruning.js', () => ({
  DynamicContextPruning: class DynamicContextPruning {
    prune(messages) {
      return messages;
    }
  },
}));

mock.module('../../../src/core/workspace-index.js', () => ({
  WorkspaceIndex: class WorkspaceIndex {
    constructor() {}
    startPeriodicSync() {}
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
    getSummary() {
      return {};
    }
    getCriticalFacts() {
      return this.criticalFacts;
    }
    recordPathNotFound(path, reason) {
      this._files.delete(path);
      this._failedPaths.set(path, { reason: reason || 'Not found', timestamp: Date.now() });
      this.criticalFacts.push({
        type: 'path_not_found',
        value: { path, reason },
        source: 'error',
        priority: 'high',
      });
    }
    recordFileRead(path, success, content) {
      if (success) {
        this._failedPaths.delete(path);
        this._files.set(path, { exists: true, timestamp: Date.now(), source: 'read_file' });
        this.criticalFacts.push({
          type: 'file_readable',
          value: { path },
          source: 'read_file',
          priority: 'high',
        });
      } else {
        this.recordPathNotFound(path, content?.error || 'File not found');
      }
    }
    _getPathFromArgs(args, toolName) {
      if (!args) {
        return null;
      }
      if (args.path) {
        return args.path;
      }
      if (args.file_path) {
        return args.file_path;
      }
      if (args.file) {
        return args.file;
      }
      if (args.dir_path) {
        return args.dir_path;
      }
      if (args.directory) {
        return args.directory;
      }
      return null;
    }
    predictToolResult(toolName, args) {
      const KNOWN_TOOLS = new Set([
        'read_file',
        'file_read',
        'list_dir',
        'read_directory',
        'write_file',
        'edit_file',
        'file_edit',
        'delete_file',
        'file_delete',
        'run_command',
        'bash',
        'run_mcp',
        'code_search',
      ]);
      if (!KNOWN_TOOLS.has(toolName)) {
        return {
          canSkip: false,
          reason: 'Unknown tool - no prediction logic',
          predicted: null,
          type: 'unknown',
        };
      }
      const path = this._getPathFromArgs(args, toolName);
      if (!path) {
        return { canSkip: false, type: 'ok', predicted: null };
      }
      const exists = this.checkPathExists(path);
      if (exists === 'not_found') {
        if (['read_file', 'file_read', 'list_dir', 'read_directory'].includes(toolName)) {
          return {
            canSkip: true,
            reason: `Path "${path}" was previously checked and does not exist`,
            predicted: { error: 'File not found' },
            type: 'will_fail',
          };
        }
      }
      return {
        canSkip: false,
        reason: `Path "${path}" exists or unknown, need actual tool call`,
        predicted: null,
        type: exists === 'exists' ? 'will_succeed' : 'ok',
      };
    }
    checkPathExists(path) {
      if (this._files.has(path)) {
        return 'exists';
      }
      if (this._failedPaths.has(path)) {
        return 'not_found';
      }
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
    generateWorkspaceDescription() {
      return '';
    }
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
    getUsage() {
      return { total: 0 };
    }
  },
}));

mock.module('../../../src/core/agent-constants.js', () => ({
  MAX_ITERATIONS_DEFAULT: 10,
}));

mock.module('../../../src/planner/graph-planner.js', () => {
  const TaskStatus = {
    PENDING: 'pending',
    BLOCKED: 'blocked',
    READY: 'ready',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
    CANCELLED: 'cancelled',
  };
  return {
    TaskStatus,
    ExecutionPlan: class ExecutionPlan {
      constructor(opts) {
        this.name = opts?.name || '';
        this.description = opts?.description || '';
        this.context = opts?.context || {};
        this.status = TaskStatus.PENDING;
        this.startedAt = null;
        this.completedAt = null;
        this.tasks = new Map();
      }
      addTask(task) {
        const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
        this.tasks.set(task.id, {
          id: task.id,
          name: task.name,
          description: task.description || '',
          dependencies: new Set(deps),
          dependents: new Set(),
          status: TaskStatus.PENDING,
          updateStatus(status, data) {
            this.status = status;
            if (data?.result) {
              this.result = data.result;
            }
          },
          checkDependencies(taskMap) {
            if (this.dependencies.size === 0) {
              return true;
            }
            for (const depId of this.dependencies) {
              const dep = taskMap.get(depId);
              if (!dep || dep.status !== TaskStatus.COMPLETED) {
                return false;
              }
            }
            return true;
          },
        });
      }
      getTask(id) {
        return this.tasks.get(id);
      }
      getReadyTasks() {
        return Array.from(this.tasks.values()).filter(
          (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.BLOCKED,
        );
      }
      toJSON() {
        return {
          name: this.name,
          status: this.status,
          tasks: Array.from(this.tasks.values()).map((t) => ({
            id: t.id,
            status: t.status,
            dependencies: Array.from(t.dependencies || []),
          })),
        };
      }
    },
    default: class GraphPlanner {
      constructor() {
        this._latestPlanId = null;
      }
      createPlan() {
        this._latestPlanId = 'mock-plan';
      }
      decomposeTask() {
        return [];
      }
    },
  };
});

mock.module('../../../src/core/risk-budget.js', () => ({
  quickAssess: () => ({ risk: 'low', type: 'general' }),
  computeIterationBudget: () => 10,
}));

mock.module('../../../src/core/agent-planner.js', () => ({
  AgentPlanner: class AgentPlanner {
    constructor() {}
  },
}));

mock.module('../../../src/core/tool-executor.js', () => ({
  ToolExecutor: class ToolExecutor {
    constructor() {}
    get events() {
      return [];
    }
    async execute(toolCall) {
      return { name: toolCall.name, result: 'mock result' };
    }
  },
}));

mock.module('../../../src/core/context-manager.js', () => ({
  ContextManager: class ContextManager {
    constructor() {}
  },
}));

mock.module('../../../src/core/termination-detector.js', () => ({
  StagnationDetector: class StagnationDetector {
    constructor() {}
  },
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
  buildCodingTaskOperatingPrompt: () => '',
  buildCodingCompletionGatePrompt: () => '',
  suggestVerificationStrategy: () => '',
}));

import { AgentEngine, createAgentEngine } from '../../../src/core/agent-engine.js';

function makeModelProvider() {
  return {
    chat: mock(async () => ({ content: 'done' })),
    dispose: mock(() => {}),
  };
}

function makeToolRegistry(tools = []) {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    get: mock((name) => map.get(name)),
    getAll: mock(() => tools),
    has: mock((name) => map.has(name)),
    toFunctionDefinitions: mock(() => []),
  };
}

function makeEngineOptions(overrides = {}) {
  return {
    modelProvider: overrides.modelProvider || makeModelProvider(),
    toolRegistry: overrides.toolRegistry || makeToolRegistry(),
    memoryManager: overrides.memoryManager || null,
    config: overrides.config || {},
    ui: overrides.ui || {
      toolCall: () => {},
      toolResult: () => {},
      toolError: () => {},
      iteration: () => {},
      finalAnswer: () => {},
      warn: () => {},
      debug: () => {},
      debugEvent: () => {},
    },
  };
}

describe('AgentEngine', () => {
  test('constructs with valid options', () => {
    const engine = new AgentEngine(makeEngineOptions());
    expect(engine).toBeDefined();
  });

  test('getRunResult() returns null before any run', () => {
    const engine = new AgentEngine(makeEngineOptions());
    expect(engine.getRunResult()).toBeNull();
  });

  test('stop() can be called without error', () => {
    const engine = new AgentEngine(makeEngineOptions());
    expect(() => engine.stop()).not.toThrow();
  });

  test('getWorkspaceSummary() returns an object with expected keys', () => {
    const engine = new AgentEngine(makeEngineOptions());
    const summary = engine.getWorkspaceSummary();
    expect(summary).toBeDefined();
    expect(summary).toHaveProperty('state');
    expect(summary).toHaveProperty('criticalFacts');
    expect(summary).toHaveProperty('workspaceDescription');
  });

  test('dispose() calls modelProvider.dispose()', () => {
    const modelProvider = makeModelProvider();
    const engine = new AgentEngine(makeEngineOptions({ modelProvider }));
    engine.dispose();
    expect(modelProvider.dispose).toHaveBeenCalled();
  });

  test('constructs with custom config values', () => {
    const engine = new AgentEngine(
      makeEngineOptions({
        config: { maxIterations: 3, maxTokens: 1024, workingDirectory: '/tmp/test' },
      }),
    );
    expect(engine).toBeDefined();
  });

  test('constructs with null memoryManager without error', () => {
    const engine = new AgentEngine(makeEngineOptions({ memoryManager: null }));
    expect(engine).toBeDefined();
  });

  test('constructs with no ui provided (uses default quiet ui)', () => {
    const opts = makeEngineOptions();
    delete opts.ui;
    const engine = new AgentEngine(opts);
    expect(engine).toBeDefined();
  });
});

describe('createAgentEngine', () => {
  test('creates an AgentEngine instance', () => {
    const engine = createAgentEngine(makeEngineOptions());
    expect(engine).toBeDefined();
    expect(engine).toBeInstanceOf(AgentEngine);
  });

  test('factory result has getRunResult method', () => {
    const engine = createAgentEngine(makeEngineOptions());
    expect(typeof engine.getRunResult).toBe('function');
  });

  test('factory result has stop method', () => {
    const engine = createAgentEngine(makeEngineOptions());
    expect(typeof engine.stop).toBe('function');
  });

  test('factory result has dispose method', () => {
    const engine = createAgentEngine(makeEngineOptions());
    expect(typeof engine.dispose).toBe('function');
  });
});
