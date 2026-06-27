import { describe, expect, test } from 'bun:test';
import { createShellTool } from '../../src/tools/system/shell.js';

describe('shell long-running command guard', () => {
  test('blocks compound commands that mix a dev server with later commands', async () => {
    const shell = createShellTool();

    const result = await shell.handler(
      {
        command: 'npm install && npm run dev && npm test',
      },
      {
        workingDirectory: process.cwd(),
        debug: false,
      },
    );

    expect(result).toContain('BLOCKED');
    expect(result).toContain('mixes a long-running command');
    expect(result).toContain('npm run dev');
    expect(result).toContain('Run setup, tests, and build commands separately');
  });
});
