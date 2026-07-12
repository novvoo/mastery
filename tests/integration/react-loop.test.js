/**
 * Integration tests: real ToolRegistry + scripted model provider → full ReAct loop.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createAgentEngine } from '../../src/core/runtime/agent/agent-engine.js';
import { ToolRegistry } from '../../src/core/runtime/agent/tool-registry.js';

function makeScriptedModelProvider(responseScript = []) {
  let idx = 0;
  return {
    constructor: { name: 'ScriptedModelProvider' },
    getModelName() {
      return 'scripted';
    },
    async chat() {
      const next = responseScript[idx % Math.max(responseScript.length, 1)];
      idx++;
      if (next && typeof next === 'object') {
        return {
          text: next.text || '',
          finishReason: next.finishReason || 'stop',
          toolCalls: next.toolCalls || null,
          reasoning: next.reasoning || null,
          usage: next.usage || { inputTokens: 0, outputTokens: 0 },
        };
      }
      return {
        text: typeof next === 'string' ? next : 'FINAL_ANSWER: {done}',
        finishReason: 'stop',
        toolCalls: null,
        reasoning: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    get callCount() {
      return idx;
    },
  };
}

function makeFakeMemoryManager() {
  return {
    toPromptFragment() {
      return '## Memory\n(no long-term memory fragments available in test harness)';
    },
    async updateFileMap() {},
    getSummary() {
      return [];
    },
  };
}

function buildEngine(registry, modelProvider, ui) {
  return createAgentEngine({
    modelProvider,
    toolRegistry: registry,
    memoryManager: makeFakeMemoryManager(),
    config: {
      workingDirectory: process.cwd(),
      maxIterations: 5,
      maxTokens: 64,
      toolResultCacheEnabled: false,
    },
    ui,
  });
}

function makeRegistryWithTools() {
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: 'returns the input message',
    category: 'all',
    permissionLevel: 'none',
    params: { message: { type: 'string', description: 'string to echo back' } },
    required: ['message'],
    async call(args) {
      return { ok: true, echoed: args.message || '(empty)' };
    },
    async handler(args) {
      return { ok: true, echoed: args.message || '(empty)' };
    },
  });
  registry.register({
    name: 'sum',
    description: 'adds two numbers',
    category: 'all',
    permissionLevel: 'none',
    params: {
      a: { type: 'number', description: 'first number' },
      b: { type: 'number', description: 'second number' },
    },
    required: ['a', 'b'],
    async call(args) {
      return { ok: true, result: Number(args.a) + Number(args.b) };
    },
    async handler(args) {
      return { ok: true, result: Number(args.a) + Number(args.b) };
    },
  });
  return registry;
}

function makeUi() {
  return {
    iteration() {},
    toolCall() {},
    toolResult() {},
    toolError() {},
    finalAnswer() {},
    warn() {},
    debug() {},
    thinking() {},
    debugEvent() {},
  };
}

describe('ReAct loop: real ToolRegistry + scripted model provider', () => {
  let registry;
  let ui;
  let engine;

  beforeEach(() => {
    registry = makeRegistryWithTools();
    ui = makeUi();
  });

  afterEach(() => {
    if (engine) {
      try {
        engine.dispose();
      } catch {
        /* ok */
      }
    }
  });

  test('FINAL_ANSWER marker: terminates with success=true', async () => {
    const model = makeScriptedModelProvider(['FINAL_ANSWER: Hello, world.']);
    engine = buildEngine(registry, model, ui);
    const result = await engine.run('say hi');
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(typeof result.answer).toBe('string');
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('Model emits native tool call → tool events populated', async () => {
    const model = makeScriptedModelProvider([
      {
        text: 'I will echo.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'echo', arguments: { message: 'ping' } }],
      },
      'FINAL_ANSWER: echoed successfully.',
    ]);
    engine = buildEngine(registry, model, ui);
    const result = await engine.run('echo something');
    expect(result.success).toBe(true);
    expect(result.toolEvents.length).toBeGreaterThan(0);
    const echoEvent = result.toolEvents.find((e) => e.name === 'echo');
    expect(echoEvent).toBeTruthy();
    expect(echoEvent.success).toBe(true);
    expect(String(echoEvent.resultPreview || '')).toMatch(/ping/);
  });

  test('parallelizes independent read-only tool calls in one model turn', async () => {
    const events = [];
    registry.register({
      name: 'web_fetch',
      description: 'delayed fetch',
      category: 'all',
      permissionLevel: 'none',
      params: { url: { type: 'string' } },
      required: ['url'],
      async handler(args) {
        events.push(`${args.url}:start`);
        await new Promise((resolve) => setTimeout(resolve, 40));
        events.push(`${args.url}:end`);
        return `fetch:${args.url}`;
      },
    });
    registry.register({
      name: 'web_search',
      description: 'delayed web search',
      category: 'all',
      permissionLevel: 'none',
      params: { query: { type: 'string' } },
      required: ['query'],
      async handler(args) {
        events.push(`${args.query}:start`);
        await new Promise((resolve) => setTimeout(resolve, 40));
        events.push(`${args.query}:end`);
        return `search:${args.query}`;
      },
    });
    const model = makeScriptedModelProvider([
      {
        text: 'I will inspect.',
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'fetch_1', name: 'web_fetch', arguments: { url: 'https://example.test/a' } },
          { id: 'search_1', name: 'web_search', arguments: { query: 'beta' } },
        ],
      },
      'FINAL_ANSWER: inspected successfully.',
    ]);

    engine = buildEngine(registry, model, ui);
    const result = await engine.run('run two safe tools');

    const firstEndIndex = events.findIndex((event) => event.endsWith(':end'));
    expect(result.success).toBe(true);
    expect(events.slice(0, firstEndIndex)).toEqual(
      expect.arrayContaining(['https://example.test/a:start', 'beta:start']),
    );
  });

  test('Native tool call with numeric args: sum tool computes correctly', async () => {
    const model = makeScriptedModelProvider([
      {
        text: 'computing sum.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'sum_1', name: 'sum', arguments: { a: 40, b: 2 } }],
      },
      'FINAL_ANSWER: done.',
    ]);
    engine = buildEngine(registry, model, ui);
    const result = await engine.run('sum 40 and 2');
    expect(result.success).toBe(true);
    const sumEvent = result.toolEvents.find((e) => e.name === 'sum');
    expect(sumEvent).toBeTruthy();
    expect(sumEvent.success).toBe(true);
    expect(String(sumEvent.resultPreview || '')).toMatch(/42/);
  });

  test('Provider returns stop with text → treated as final answer', async () => {
    const model = makeScriptedModelProvider([
      { text: 'The answer is blue.', finishReason: 'stop' },
    ]);
    engine = buildEngine(registry, model, ui);
    const result = await engine.run('color of the sky');
    expect(result.success).toBe(true);
    expect(result.answer).toMatch(/blue/i);
  });

  test('Missing tool: tool event failure recorded but engine continues', async () => {
    const model = makeScriptedModelProvider([
      {
        text: 'calling non-existent tool.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'bad_1', name: 'does_not_exist', arguments: {} }],
      },
      'FINAL_ANSWER: finished.',
    ]);
    engine = buildEngine(registry, model, ui);
    const result = await engine.run('something strange');
    expect(result).toBeTruthy();
    expect(Array.isArray(result.toolEvents)).toBe(true);
  });

  test('toFunctionDefinitions is called once across multiple same-tool iterations', async () => {
    const originalFn = registry.toFunctionDefinitions.bind(registry);
    let callCount = 0;
    registry.toFunctionDefinitions = (tools) => {
      callCount++;
      return originalFn(tools);
    };

    const model = makeScriptedModelProvider([
      {
        text: 'echo once.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: { message: 'ping' } }],
      },
      {
        text: 'echo twice.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c2', name: 'echo', arguments: { message: 'pong' } }],
      },
      'FINAL_ANSWER: all done.',
    ]);

    engine = buildEngine(registry, model, ui);
    const result = await engine.run('do two echoes');
    expect(result.success).toBe(true);
    expect(callCount).toBe(1);
  });

  test('toFunctionDefinitions is called fresh for each run() call', async () => {
    const originalFn = registry.toFunctionDefinitions.bind(registry);
    let callCount = 0;
    registry.toFunctionDefinitions = (tools) => {
      callCount++;
      return originalFn(tools);
    };

    const model = makeScriptedModelProvider([
      // Run 1: one tool call + final answer
      {
        text: 'echo.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: { message: 'a' } }],
      },
      'FINAL_ANSWER: run 1 done.',
      // Run 2: one tool call + final answer (model index continues)
      {
        text: 'echo again.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c2', name: 'echo', arguments: { message: 'b' } }],
      },
      'FINAL_ANSWER: run 2 done.',
    ]);

    engine = buildEngine(registry, model, ui);
    const result1 = await engine.run('run 1');
    expect(result1.success).toBe(true);
    const afterRun1 = callCount;
    expect(afterRun1).toBe(1);

    const result2 = await engine.run('run 2');
    expect(result2.success).toBe(true);
    expect(callCount).toBe(afterRun1 + 1);
  });

  test('tool execution works correctly with cached function definitions', async () => {
    const model = makeScriptedModelProvider([
      {
        text: 'sum 40 and 2.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 's1', name: 'sum', arguments: { a: 40, b: 2 } }],
      },
      {
        text: 'sum 10 and 5.',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 's2', name: 'sum', arguments: { a: 10, b: 5 } }],
      },
      'FINAL_ANSWER: sums computed.',
    ]);

    engine = buildEngine(registry, model, ui);
    const result = await engine.run('compute two sums');
    expect(result.success).toBe(true);
    const sumEvents = result.toolEvents.filter((e) => e.name === 'sum');
    expect(sumEvents).toHaveLength(2);
    expect(String(sumEvents[0].resultPreview || '')).toMatch(/42/);
    expect(String(sumEvents[1].resultPreview || '')).toMatch(/15/);
  });

  test('three consecutive same-tool iterations use cached definitions', async () => {
    const originalFn = registry.toFunctionDefinitions.bind(registry);
    let callCount = 0;
    registry.toFunctionDefinitions = (tools) => {
      callCount++;
      return originalFn(tools);
    };

    const script = [];
    for (let i = 0; i < 3; i++) {
      script.push({
        text: `echo ${i}.`,
        finishReason: 'tool_calls',
        toolCalls: [{ id: `c${i}`, name: 'echo', arguments: { message: `msg${i}` } }],
      });
    }
    script.push('FINAL_ANSWER: all echoes done.');

    const model = makeScriptedModelProvider(script);
    engine = buildEngine(registry, model, ui);
    const result = await engine.run('echo three times');
    expect(result.success).toBe(true);
    expect(callCount).toBe(1);
    expect(result.toolEvents).toHaveLength(3);
  });
});
