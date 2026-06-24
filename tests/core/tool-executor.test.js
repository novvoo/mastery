import { describe, test, expect, mock } from 'bun:test';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { Decision } from '../../src/core/security-policy.js';

function makeTool(name, extra = {}) {
  return {
    name,
    description: `${name} tool`,
    handler: extra.handler || (async () => `${name} result`),
    required: extra.required || [],
    ...extra,
  };
}

function makeMockRegistry(tools = []) {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    get: mock((name) => map.get(name)),
    validateAndCoerceArgs: mock((name, args) => ({ valid: true, coercedArgs: args || {} })),
    has: mock((name) => map.has(name)),
  };
}

function makeMockExecutor({ tools = [], securityPolicy = null, config = {} } = {}) {
  const registry = makeMockRegistry(tools);
  const textToolParser = { parse: mock(() => []) };
  const ui = {
    toolCall: mock(() => {}),
    toolResult: mock(() => {}),
    toolError: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  };
  const executor = new ToolExecutor({
    toolRegistry: registry,
    securityPolicy,
    textToolParser,
    ui,
    config: { toolResultCacheEnabled: false, ...config },
  });
  return { executor, registry, textToolParser, ui };
}

describe('ToolExecutor', () => {
  test('executes a registered tool and returns result', async () => {
    const tool = makeTool('read_file', { handler: async () => 'file content' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.name).toBe('read_file');
    expect(result.result).toBe('file content');
    expect(result.skipped).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test('returns error for unregistered tool', async () => {
    const { executor } = makeMockExecutor({ tools: [] });

    const result = await executor.execute({ id: '1', name: 'unknown_tool', arguments: {} });

    expect(result.name).toBe('unknown_tool');
    expect(result.error).toContain('not registered');
    expect(result.result).toContain('not registered');
  });

  test('read-only tools are not skipped on duplicate calls', async () => {
    const tool = makeTool('read_file', { handler: async () => 'content' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const callArgs = { path: '/a.txt' };
    const result1 = await executor.execute({ id: '1', name: 'read_file', arguments: callArgs });
    const result2 = await executor.execute({ id: '2', name: 'read_file', arguments: callArgs });

    expect(result1.skipped).toBeUndefined();
    expect(result2.skipped).toBeUndefined();
    expect(result2.result).toBe('content');
  });

  test('mutation tools are blocked on duplicate calls', async () => {
    const tool = makeTool('write_file', { handler: async () => 'written' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const callArgs = { path: '/a.txt', content: 'hello' };
    const result1 = await executor.execute({ id: '1', name: 'write_file', arguments: callArgs });
    const result2 = await executor.execute({ id: '2', name: 'write_file', arguments: callArgs });

    expect(result1.skipped).toBeUndefined();
    expect(result2.skipped).toBe(true);
    expect(result2.duplicateMutation).toBe(true);
  });

  test('blocks tool call when security policy denies', async () => {
    const tool = makeTool('shell', { handler: async () => 'output' });
    const policy = {
      evaluate: mock(() => ({ decision: Decision.DENY, suggestedMessage: 'dangerous command' })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({
      id: '1',
      name: 'shell',
      arguments: { command: 'rm -rf /' },
    });

    expect(result.error).toContain('dangerous command');
    expect(result.result).toContain('Security policy blocked');
  });

  test('blocks tool call when security policy requires approval', async () => {
    const tool = makeTool('shell', { handler: async () => 'output' });
    const policy = {
      evaluate: mock(() => ({
        decision: Decision.REQUIRE_APPROVAL,
        suggestedMessage: 'needs approval',
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('needs approval');
  });

  test('blocks tool call when security policy rate limited', async () => {
    const tool = makeTool('shell', { handler: async () => 'output' });
    const policy = {
      evaluate: mock(() => ({
        decision: Decision.RATE_LIMITED,
        suggestedMessage: 'too many calls',
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('too many calls');
  });

  test('returns error when required parameters are missing', async () => {
    const tool = makeTool('write_file', { required: ['path', 'content'] });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'write_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.error).toContain('Missing required parameter');
    expect(result.error).toContain('content');
  });

  test('normalizes OpenAI-style function tool calls', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: 'call_abc',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"/a.txt"}' },
    });

    expect(result.name).toBe('read_file');
    expect(result.result).toBe('ok');
  });

  test('records events accessible via events getter', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute({ id: '1', name: 'read_file', arguments: { path: '/a.txt' } });

    const events = executor.events;
    expect(events.length).toBe(1);
    expect(events[0].name).toBe('read_file');
    expect(events[0].success).toBe(true);
  });

  test('onEvent subscribes and receives events', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });
    const received = [];

    const unsub = executor.onEvent((event) => received.push(event));
    await executor.execute({ id: '1', name: 'read_file', arguments: { path: '/a.txt' } });

    expect(received.length).toBe(1);
    expect(received[0].name).toBe('read_file');

    // Unsubscribe and verify no more events
    unsub();
    await executor.execute({ id: '2', name: 'read_file', arguments: { path: '/b.txt' } });
    expect(received.length).toBe(1); // still 1 after unsubscribe
  });

  test('reset clears call history and events', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute({ id: '1', name: 'read_file', arguments: { path: '/a.txt' } });
    expect(executor.events.length).toBe(1);

    executor.reset();
    expect(executor.events.length).toBe(0);

    // After reset, same call should not be deduped
    const result = await executor.execute({
      id: '2',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.result).toBe('ok');
  });

  test('handles tool handler errors gracefully', async () => {
    const tool = makeTool('fail_tool', {
      handler: async () => {
        throw new Error('something broke');
      },
    });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({ id: '1', name: 'fail_tool', arguments: {} });

    expect(result.error).toContain('something broke');
    expect(result.result).toContain('Error: something broke');
    expect(executor.events.length).toBe(1);
    expect(executor.events[0].success).toBe(false);
  });

  test('normalizes string arguments to object', async () => {
    const tool = makeTool('read_file', { handler: async (args) => args.path });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: '{"path":"/x.txt"}',
    });

    expect(result.name).toBe('read_file');
  });

  test('uses coerceArgs from registry when available', async () => {
    const tool = makeTool('search', { handler: async (args) => args.query });
    const registry = makeMockRegistry([tool]);
    registry.validateAndCoerceArgs = mock((name, args) => ({
      valid: false,
      errors: ['query is required'],
      coercedArgs: args || {},
    }));
    const textToolParser = { parse: mock(() => []) };
    const ui = {
      toolCall: mock(() => {}),
      toolResult: mock(() => {}),
      toolError: mock(() => {}),
      warn: mock(() => {}),
      debug: mock(() => {}),
    };
    const executor = new ToolExecutor({
      toolRegistry: registry,
      textToolParser,
      ui,
      config: { toolResultCacheEnabled: false },
    });

    const result = await executor.execute({ id: '1', name: 'search', arguments: {} });

    expect(result.name).toBe('search');
    expect(ui.warn).toHaveBeenCalled();
  });

  test('backward-compatible security policy: requiresApproval', async () => {
    const tool = makeTool('shell', { handler: async () => 'ok' });
    const policy = {
      requiresApproval: mock((name) => name === 'shell'),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('approval_required');
  });

  test('backward-compatible security policy: validateToolCall returns false', async () => {
    const tool = makeTool('shell', { handler: async () => 'ok' });
    const policy = {
      validateToolCall: mock(() => false),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('denied');
  });

  test('workspaceState prediction skips tool', async () => {
    const tool = makeTool('read_file', { handler: async () => 'content' });
    const workspaceState = {
      predictToolResult: mock(() => ({
        canSkip: true,
        reason: 'file already read',
        predicted: 'cached content',
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], config: { workspaceState } });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.skipped).toBe(true);
    expect(result.predicted).toBe(true);
    expect(result.result).toBe('cached content');
  });

  test('events getter returns a copy (not the internal array)', async () => {
    const { executor } = makeMockExecutor({ tools: [] });
    const e1 = executor.events;
    const e2 = executor.events;
    expect(e1).not.toBe(e2); // different array instances
  });

  test('works with minimal constructor args (defaults)', async () => {
    const executor = new ToolExecutor({});
    // Should not throw on construction
    expect(executor.events).toEqual([]);
  });

  test('calls emitObservation when provided in options', async () => {
    const tool = makeTool('read_file', { handler: async () => 'data' });
    const { executor } = makeMockExecutor({ tools: [tool] });
    const observations = [];
    const emitObservation = mock((id, name, result, mode) =>
      observations.push({ id, name, result, mode }),
    );

    await executor.execute(
      { id: '1', name: 'read_file', arguments: { path: '/a.txt' } },
      {},
      { resultMode: 'observation', emitObservation },
    );

    expect(observations.length).toBe(1);
    expect(observations[0].name).toBe('read_file');
    expect(observations[0].mode).toBe('observation');
  });

  test('passes execution context to tool handler', async () => {
    let capturedCtx = null;
    const tool = makeTool('ctx_tool', {
      handler: async (args, ctx) => {
        capturedCtx = ctx;
        return 'ok';
      },
    });
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute(
      { id: '1', name: 'ctx_tool', arguments: {} },
      { memoryManager: { mem: true }, sessionManager: { sess: true }, debug: true },
    );

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx.memoryManager).toEqual({ mem: true });
    expect(capturedCtx.sessionManager).toEqual({ sess: true });
    expect(capturedCtx.debug).toBe(true);
  });

  test('security policy allows tool when decision is ALLOW', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const policy = {
      evaluate: mock(() => ({ decision: Decision.ALLOW })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.error).toBeUndefined();
    expect(result.result).toBe('ok');
  });

  test('applies security result policy (truncateResult)', async () => {
    const tool = makeTool('read_file', { handler: async () => 'long content here' });
    const policy = {
      evaluate: mock(() => ({ decision: Decision.ALLOW })),
      truncateResult: mock((name, result) => result.substring(0, 5)),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.result).toBe('long ');
  });
});
