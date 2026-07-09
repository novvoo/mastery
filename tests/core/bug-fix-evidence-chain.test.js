import { describe, test, expect } from 'bun:test';

import { AgentRouter } from '../../src/core/runtime/agent/agent-router.js';
import { AgentVerifier } from '../../src/core/runtime/agent/agent-verifier.js';

function makeRouter(tools) {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  return new AgentRouter({
    debugEvent: () => {},
    toolRegistry: {
      get: (name) => toolMap.get(name),
      getAll: () => tools,
      has: (name) => toolMap.has(name),
      validateAndCoerceArgs: (_name, args) => ({ valid: true, coercedArgs: args || {} }),
    },
    textToolParser: { parse: () => [] },
    ui: { toolCall: () => {}, toolResult: () => {}, toolError: () => {}, warn: () => {} },
    config: { workingDirectory: '/tmp/test-agent', toolResultCacheEnabled: false },
    contentStore: null,
    fileAnalyzer: null,
    memoryManager: null,
    sessionManager: null,
    modelProvider: null,
  });
}

function eventFromToolResult(toolResult) {
  return {
    name: toolResult.name,
    args: toolResult.args || {},
    success: !toolResult.error && !toolResult.skipped,
    resultPreview:
      typeof toolResult.result === 'string' ? toolResult.result : JSON.stringify(toolResult.result),
  };
}

describe('bug-fix evidence chain', () => {
  test('hashline fix plus runtime verification satisfies coding completion gate', async () => {
    const router = makeRouter([
      {
        name: 'apply_hashline_patch',
        category: 'filesystem',
        handler: async () =>
          'Hashline patch applied successfully through EditOrchestrator.\nFiles changed: app.js\nTotal edits: 1\nDiagnostics gate: PASSED',
      },
      {
        name: 'shell',
        category: 'shell',
        handler: async () => ({ exitCode: 0, stdout: '1 test passed' }),
      },
    ]);
    const verifier = new AgentVerifier({
      debugEvent: () => {},
      toolRegistry: { has: () => false, getAll: () => [] },
      preview: (value) => String(value).slice(0, 200),
    });

    const patchResult = await router.executeToolCall({
      name: 'apply_hashline_patch',
      arguments: { patch: '[app.js#abc]\nSWAP 1.=1:\n-bug();\n+fix();' },
    });
    const testResult = await router.executeToolCall({
      name: 'shell',
      arguments: { command: 'bun test tests/app.test.js' },
    });

    const runToolEvents = [eventFromToolResult(patchResult), eventFromToolResult(testResult)];
    const gate = verifier.shouldBlockCodingFinal({
      responseText: 'FINAL_ANSWER: Fixed app.js and verified with bun test tests/app.test.js.',
      taskProfile: { isModificationTask: true, riskLevel: 'medium' },
      runToolEvents,
      activePlan: null,
      activePlanManager: null,
    });

    expect(patchResult.args.patch).toContain('+fix();');
    expect(testResult.args.command).toBe('bun test tests/app.test.js');
    expect(gate.block).toBe(false);
  });

  test('dropped tool args would fail the same completion gate', () => {
    const verifier = new AgentVerifier({
      debugEvent: () => {},
      toolRegistry: { has: () => false, getAll: () => [] },
      preview: (value) => String(value).slice(0, 200),
    });

    const gate = verifier.shouldBlockCodingFinal({
      responseText: 'FINAL_ANSWER: Fixed app.js and verified with bun test tests/app.test.js.',
      taskProfile: { isModificationTask: true, riskLevel: 'medium' },
      runToolEvents: [
        {
          name: 'apply_hashline_patch',
          args: {},
          success: true,
          resultPreview: 'Hashline patch applied successfully',
        },
        { name: 'shell', args: {}, success: true, resultPreview: '1 test passed' },
      ],
      activePlan: null,
      activePlanManager: null,
    });

    expect(gate.block).toBe(true);
    expect(gate.reason).toContain('no_code_mutation');
  });
});
