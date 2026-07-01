import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

  test('treats sub-1000 timeout values as seconds to avoid accidental millisecond kills', async () => {
    const shell = createShellTool();
    const debugEvents = [];

    const result = await shell.handler(
      {
        command: 'echo ok',
        timeout: 30,
      },
      {
        workingDirectory: process.cwd(),
        debug: true,
        ui: {
          debugEvent: (name, payload) => debugEvents.push({ name, payload }),
        },
      },
    );

    expect(result).toBe('ok');
    expect(debugEvents.some((event) => event.payload?.timeoutMs === 30000)).toBe(true);
    expect(debugEvents.some((event) => event.payload?.normalizedFromSeconds === true)).toBe(true);
  });

  test('returns a structured recovery plan when finite verification times out', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shell-timeout-recovery-'));
    const shell = createShellTool();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'node -e "setTimeout(() => {}, 2000)"',
        },
      }),
      'utf-8',
    );

    try {
      const result = await shell.handler(
        {
          command: 'npm test',
          timeout: 1000,
        },
        {
          workingDirectory: root,
          debug: false,
        },
      );

      expect(result).toContain('STEP_ABNORMAL: shell_timeout');
      expect(result).toContain('Recovery plan:');
      expect(result).toContain('Retry once with shell');
      expect(result).not.toContain('do not retry it with shell');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
