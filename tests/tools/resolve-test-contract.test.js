import { describe, expect, test } from 'bun:test';
import createResolveTestContractTool from '../../src/tools/skills/resolve-test-contract.js';

describe('resolve_test_contract tool', () => {
  test('returns a structured decision artifact', async () => {
    const tool = createResolveTestContractTool();
    const result = await tool.handler({
      declared_runners: ['bun', 'npm'],
      authoritative_runner: 'bun',
      rationale: 'The release CI executes Bun and is the shipping authority.',
      sync_targets: ['CONTEXT.md', 'docs/adr/0001.md'],
    });
    expect(result.ok).toBe(true);
    expect(result.decision.authoritativeRunner).toBe('bun');
  });

  test('rejects a runner outside the discovered conflict set', async () => {
    const tool = createResolveTestContractTool();
    const result = await tool.handler({
      declared_runners: ['bun', 'npm'],
      authoritative_runner: 'yarn',
      rationale: 'This explanation is deliberately long enough.',
      sync_targets: [],
    });
    expect(result.ok).toBe(false);
  });
});
