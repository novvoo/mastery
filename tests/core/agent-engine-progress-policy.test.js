import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const agentEngineSource = readFileSync(
  join(import.meta.dir, '../../src/core/runtime/agent/agent-engine.js'),
  'utf8',
);

describe('AgentEngine progress policy', () => {
  test('does not implement force-action by blocking read/context tools', () => {
    expect(agentEngineSource).toContain('IMPLEMENTATION PROGRESS CHECK');
    expect(agentEngineSource).toContain('No tools are blocked by this checkpoint');
    expect(agentEngineSource).not.toContain('FORCE-ACTION MODE');
    expect(agentEngineSource).not.toContain('Only mutation tools are available');
    expect(agentEngineSource).not.toContain('read-only tools are now BLOCKED');
    expect(agentEngineSource).not.toContain('Read-only tools are BLOCKED');
    expect(agentEngineSource).not.toContain('FORCE_ACTION_MUTATION_TOOLS');
    expect(agentEngineSource).not.toContain('more non-mutation rounds');
    expect(agentEngineSource).not.toContain('without making ANY code changes');
    expect(agentEngineSource).toContain('without producing decisive progress');
  });
});
