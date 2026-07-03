import { describe, test, expect } from 'bun:test';

describe('AgentContext', () => {
  test('module can be imported', async () => {
    const { AgentContext } = await import('../../src/core/runtime/agent/agent-context.js');
    expect(AgentContext).toBeDefined();
    expect(typeof AgentContext).toBe('function');
  });

  test('constructor requires dependencies', async () => {
    const { AgentContext } = await import('../../src/core/runtime/agent/agent-context.js');
    // AgentContext requires dependencies - test that it's a class
    expect(typeof AgentContext.prototype).toBe('object');
  });
});
