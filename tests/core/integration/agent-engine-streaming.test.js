import { describe, expect, test, beforeEach, mock } from 'bun:test';

mock.module('../../../src/core/session-manager.js', () => ({
  SessionManager: class SessionManager {
    constructor(opts = {}) {}
    setSystemPrompt() {}
    addSystemMessage() {}
    addMessage() {}
    addUserMessage() {}
    addAssistantMessage() {}
    getMessages() { return []; }
    getHistory() { return []; }
    clear() {}
    get length() { return 0; }
  },
}));

mock.module('../../../src/prompts/system-prompt.js', () => ({
  buildSystemPrompt: () => 'system prompt',
}));

mock.module('../../../src/errors/error-handler.js', () => ({
  RetryStrategy: class RetryStrategy {
    shouldRetry() { return false; }
    getDelay() { return 0; }
    async executeWithRetry(fn) { return await fn(); }
  },
  withTimeout: (fn) => fn,
}));

mock.module('../../../src/core/text-tool-parser.js', () => ({
  TextToolParser: class TextToolParser {
    constructor() {}
    parse() { return []; }
    generateToolPrompt() { return ''; }
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

mock.module('../../../src/core/workspace-state.js', () => ({
  WorkspaceState: class WorkspaceState {
    constructor() {}
    aggregateContext() { return null; }
    getFileSnapshot() { return null; }
  },
}));

mock.module('../../../src/core/routed-tool-context.js', () => ({
  withRoutedToolContext: (fn) => fn,
}));

mock.module('../../../src/core/token-scope.js', () => ({
  TokenScope: class TokenScope {
    constructor() {}
    allocate() {}
    release() {}
    getRemaining() { return Infinity; }
  },
}));

mock.module('../../../src/core/execution-plan-manager.js', () => ({
  ExecutionPlanManager: class ExecutionPlanManager {
    constructor() {}
    get plan() { return null; }
    get isCompleted() { return true; }
    buildPlan() { return null; }
    createIfNeeded() { return null; }
  },
}));

mock.module('../../../src/core/tool-executor.js', () => ({
  ToolExecutor: class ToolExecutor {
    constructor() { this.events = []; }
    reset() {}
    async execute() { return {}; }
  },
}));

mock.module('../../../src/core/context-manager.js', () => ({
  ContextManager: class ContextManager {
    constructor() {}
    prepareContext() { return {}; }
    manage() {}
  },
}));

mock.module('../../../src/core/metrics-sink.js', () => ({
  metricsSink: {
    startRun() {},
    endRun() {},
    recordEvent() {},
  },
}));

mock.module('../../../src/memory/memory-manager.js', () => ({
  MemoryManager: class MemoryManager {
    constructor() {}
  },
}));

mock.module('../../../src/core/prompt-builder.js', () => ({
  buildToolSyntaxCorrectionPrompt: () => '',
  buildToolUseCorrectionPrompt: () => '',
  buildCodingTaskOperatingPrompt: () => '',
  buildCodingCompletionGatePrompt: () => '',
  suggestVerificationStrategy: () => null,
  isTermination: () => false,
  extractFinalAnswer: (text) => text,
  normalizeFinalAnswer: (text) => text,
  containsUnparsedToolSyntax: () => false,
  shouldCorrectToolRefusal: () => false,
  shouldBlockCodingFinal: () => false,
}));

mock.module('../../../src/core/termination-detector.js', () => ({
  StagnationDetector: class StagnationDetector {
    constructor() {}
    reset() {}
    check() { return { shouldStop: false, reason: '' }; }
    nudge() { return null; }
  },
}));

mock.module('../../../src/planner/graph-planner.js', () => ({
  TaskStatus: {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
  },
}));

mock.module('../../../src/core/agent-constants.js', () => ({
  MAX_ITERATIONS_DEFAULT: 10,
}));

import { createAgentEngine } from '../../../src/core/agent-engine.js';
import { StreamEventType } from '../../../src/models/streaming-parser.js';

describe('AgentEngine Streaming', () => {
  let uiEvents;
  let ui;

  beforeEach(() => {
    uiEvents = [];
    ui = {
      thinking: (text) => uiEvents.push({ type: 'thinking', text }),
      toolCall: (name, args) => uiEvents.push({ type: 'tool_call', name, args }),
      toolResult: (name, result) => uiEvents.push({ type: 'tool_result', name, result }),
      finalAnswer: (text) => uiEvents.push({ type: 'final_answer', text }),
      warn: (text) => uiEvents.push({ type: 'warn', text }),
      iteration: (data) => uiEvents.push({ type: 'iteration', data }),
      onTextDelta: (text) => uiEvents.push({ type: 'text_delta', text }),
      onReasoningDelta: (text) => uiEvents.push({ type: 'reasoning_delta', text }),
      onToolCallDelta: (delta) => uiEvents.push({ type: 'tool_call_delta', delta }),
    };
  });

  test('chatStream 生成增量文本时触发 onTextDelta', async () => {
    const collectedDeltas = [];
    const streamingModelProvider = {
      async chatStream(messages, options = {}) {
        const innerEvents = (async function* () {
          yield { type: StreamEventType.TEXT_DELTA, text: '第一步' };
          yield { type: StreamEventType.TEXT_DELTA, text: '，第二步' };
          yield { type: StreamEventType.TEXT_DELTA, text: '。' };
          yield { type: StreamEventType.FINISH, finishReason: 'stop' };
        })();

        return {
          stream: () => innerEvents,
          async abort() {},
          async finalize() {
            return {
              content: '第一步，第二步。',
              reasoning: null,
              toolCalls: null,
              finishReason: 'stop',
              usage: { total_tokens: 3 },
            };
          },
        };
      },
      async chat() { return { content: 'fallback', finishReason: 'stop' }; },
      async dispose() {},
    };

    const engine = createAgentEngine({
      modelProvider: streamingModelProvider,
      ui,
      workingDirectory: process.cwd(),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    try {
      const deltas = [];
      const original = ui.onTextDelta;
      ui.onTextDelta = (text) => {
        deltas.push(text);
        original(text);
      };

      const result = await engine.processInput('生成一个简单的回答');

      // 收集到增量
      expect(deltas.length).toBeGreaterThan(1);
      expect(deltas.join('')).toContain('第一步');

      // finalize 返回的最终结果
      expect(result).toBeDefined();

      // UI 回调中应包含 text_delta 事件
      const textDeltaEvents = uiEvents.filter(e => e.type === 'text_delta');
      expect(textDeltaEvents.length).toBeGreaterThan(1);
    } finally {
      engine.dispose();
    }
  });

  test('流式工具调用通过 onToolCallDelta 回调传递', async () => {
    const streamingModelProvider = {
      async chatStream(messages, options = {}) {
        const innerEvents = (async function* () {
          yield { type: StreamEventType.TOOL_CALL_DELTA, name: 'read_file', arguments: '{"path":' };
          yield { type: StreamEventType.TOOL_CALL_DELTA, arguments: '"a.txt"}' };
          yield { type: StreamEventType.FINISH, finishReason: 'tool_use' };
        })();

        return {
          stream: () => innerEvents,
          async abort() {},
          async finalize() {
            return {
              content: null,
              reasoning: null,
              toolCalls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', id: '1' }],
              finishReason: 'tool_use',
              usage: { total_tokens: 5 },
            };
          },
        };
      },
      async chat() { return { content: 'fallback', finishReason: 'stop' }; },
      async dispose() {},
    };

    const engine = createAgentEngine({
      modelProvider: streamingModelProvider,
      ui,
      workingDirectory: process.cwd(),
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    try {
      await engine.processInput('读取文件');

      const toolDeltaEvents = uiEvents.filter(e => e.type === 'tool_call_delta');
      expect(toolDeltaEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      engine.dispose();
    }
  });

  test('禁用 streaming 时回退到 chat() 方法', async () => {
    process.env.AGENT_DISABLE_STREAMING = 'true';

    let chatCalled = false;
    let chatStreamCalled = false;

    const mockProvider = {
      async chatStream() {
        chatStreamCalled = true;
        return { stream: () => (async function* () {})(), abort: async () => {}, finalize: async () => ({}) };
      },
      async chat() {
        chatCalled = true;
        return {
          content: '来自非流式调用的回答',
          finishReason: 'stop',
          toolCalls: null,
        };
      },
      async dispose() {},
    };

    const engine = createAgentEngine({
      modelProvider: mockProvider,
      ui,
      workingDirectory: process.cwd(),
      systemPrompt: 'You are helpful.',
      tools: [],
    });

    try {
      const result = await engine.processInput('hi');
      expect(chatCalled).toBe(true);
      expect(chatStreamCalled).toBe(false);
    } finally {
      engine.dispose();
      delete process.env.AGENT_DISABLE_STREAMING;
    }
  });

  test('默认 UI 适配器提供空实现的 delta 回调', () => {
    const engine = createAgentEngine({
      modelProvider: {
        async chat() { return { content: 'ok', finishReason: 'stop' }; },
        async dispose() {},
      },
      ui: null,
      workingDirectory: process.cwd(),
      systemPrompt: 'hi',
      tools: [],
    });

    // 不应该抛出错误（因为默认适配器提供空实现）
    expect(() => engine.dispose()).not.toThrow();
  });
});
