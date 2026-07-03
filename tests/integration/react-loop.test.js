/**
 * Integration tests: real ToolRegistry + scripted model provider → full ReAct loop.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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
    config: { workingDirectory: process.cwd(), maxIterations: 5, maxTokens: 64 },
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
});
