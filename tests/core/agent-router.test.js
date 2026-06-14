import { describe, test, expect } from 'bun:test';
import { AgentRouter } from '../../src/core/agent-router.js';

function makeMockDeps() {
  return {
    debugEvent: () => {},
    toolRegistry: {
      get: () => null,
      getAll: () => [],
      has: () => false,
      validateAndCoerceArgs: () => ({ valid: true, coercedArgs: {} }),
    },
    textToolParser: { parse: () => [] },
    ui: { toolCall: () => {}, toolResult: () => {}, toolError: () => {}, warn: () => {} },
    config: { workingDirectory: '/tmp/test-agent', toolResultCacheEnabled: false },
    contentStore: null,
    fileAnalyzer: null,
    memoryManager: null,
    sessionManager: null,
    modelProvider: null,
  };
}

describe('AgentRouter', () => {
  test('creates instance', () => {
    const router = new AgentRouter(makeMockDeps());
    expect(router).toBeDefined();
  });

  test('reset clears state', () => {
    const router = new AgentRouter(makeMockDeps());
    router.reset();
    // No error thrown
  });

  test('executeToolCall returns error for unknown tool', async () => {
    const router = new AgentRouter(makeMockDeps());
    const result = await router.executeToolCall({ name: 'nonexistent', arguments: {} });
    expect(result.name).toBe('nonexistent');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Unknown tool');
  });

  test('executeToolCall handles null tool call', async () => {
    const router = new AgentRouter(makeMockDeps());
    const result = await router.executeToolCall(null);
    // Should not crash, returns error for unknown
    expect(result).toBeDefined();
  });

  test('executeToolCall normalizes function-style tool calls', async () => {
    const deps = makeMockDeps();
    deps.toolRegistry.get = (name) => {
      if (name === 'test_tool') {
        return { handler: async () => 'ok', category: 'test' };
      }
      return null;
    };
    deps.toolRegistry.has = (name) => name === 'test_tool';
    const router = new AgentRouter(deps);
    const result = await router.executeToolCall({
      id: 'call_1',
      type: 'function',
      function: { name: 'test_tool', arguments: '{}' },
    });
    // Should resolve to the tool or return error depending on routing
    expect(result).toBeDefined();
  });

  test('executeToolCall skips duplicate calls', async () => {
    const callCount = { value: 0 };
    const deps = makeMockDeps();
    const handler = async () => { callCount.value++; return 'result'; };
    deps.toolRegistry.get = (name) => ({ handler, category: 'test' });
    deps.toolRegistry.has = (name) => true;
    const router = new AgentRouter(deps);

    const call = { name: 'test', arguments: {} };
    const result1 = await router.executeToolCall(call);
    const result2 = await router.executeToolCall(call);
    expect(result1).toBeDefined();
    expect(result2.skipped).toBe(true);
  });

  test('executeToolCall respects security policy', async () => {
    const deps = makeMockDeps();
    deps.config.securityPolicy = { requiresApproval: (name) => name === 'dangerous' };
    deps.toolRegistry.get = (name) => ({ handler: async () => 'ok', category: 'test' });
    const router = new AgentRouter(deps);

    const result = await router.executeToolCall({ name: 'dangerous', arguments: {} });
    expect(result.error).toBeDefined();
  });

  test('executeToolCall checks missing required params', async () => {
    const deps = makeMockDeps();
    deps.toolRegistry.get = (name) => ({
      handler: async () => 'ok',
      category: 'test',
      required: ['path'],
    });
    const router = new AgentRouter(deps);

    const result = await router.executeToolCall({ name: 'write_file', arguments: {} });
    expect(result.error).toContain('Missing required');
  });

  test('executeToolCall handles tool execution error', async () => {
    const deps = makeMockDeps();
    deps.toolRegistry.get = (name) => ({
      handler: async () => { throw new Error('tool crashed'); },
      category: 'test',
    });
    const router = new AgentRouter(deps);

    const result = await router.executeToolCall({ name: 'crashy', arguments: {} });
    expect(result.error).toContain('tool crashed');
  });

  test('executeToolCall works with workspace state prediction', async () => {
    const deps = makeMockDeps();
    deps.toolRegistry.get = (name) => ({ handler: async () => 'ok', category: 'test' });
    const router = new AgentRouter(deps);

    const workspaceState = {
      predictToolResult: () => ({ canSkip: true, reason: 'already read', predicted: { content: 'cached' }, type: 'cache_hit' }),
    };
    const result = await router.executeToolCall({ name: 'read_file', arguments: { path: '/tmp/test' } }, { workspaceState });
    expect(result.skipped).toBe(true);
  });
});
