import { readFile } from 'fs/promises';
import { describe, expect, test } from 'bun:test';

const FILES_WITH_CODING_COMPLETION_GATES = [
  'src/core/runtime/agent/agent.js',
  'src/core/runtime/agent/agent-engine.js',
];

describe('coding completion gate policy', () => {
  test('does not stop enforcing coding gates after a fixed correction count', async () => {
    for (const file of FILES_WITH_CODING_COMPLETION_GATES) {
      const source = await readFile(file, 'utf8');
      expect(source).not.toMatch(/codingGateCorrections\s*<\s*\d+/);
    }
  });
});
