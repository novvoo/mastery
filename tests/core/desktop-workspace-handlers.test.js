import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  handleFileDiff,
  handleReadWorkspaceFile,
  handleWriteWorkspaceFile,
} from '../../src/adapters/desktop/ipc/main-process/workspace-handlers.js';

describe('desktop workspace handlers', () => {
  let tempDir;
  let engine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-handlers-'));
    engine = {
      getConfig: () => ({ workingDirectory: tempDir }),
      workspaceState: {
        getFileSnapshot: (filePath) => {
          if (filePath === 'changed.txt') {
            return { content: '' };
          }
          return null;
        },
      },
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('handleReadWorkspaceFile honors explicit zero maxBytes', async () => {
    fs.writeFileSync(path.join(tempDir, 'nonempty.txt'), 'x', 'utf8');

    const result = await handleReadWorkspaceFile({ path: 'nonempty.txt', maxBytes: 0 }, { engine });

    expect(result.success).toBe(false);
    expect(result.error).toContain('too large');
  });

  test('handleWriteWorkspaceFile succeeds without a broadcast callback', async () => {
    const result = await handleWriteWorkspaceFile({ path: 'created.txt', content: '' }, { engine });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, 'created.txt'), 'utf8')).toBe('');
  });

  test('handleFileDiff uses an empty snapshot as the old content', async () => {
    fs.writeFileSync(path.join(tempDir, 'changed.txt'), 'new content\n', 'utf8');

    const result = await handleFileDiff({ path: 'changed.txt' }, { engine });

    expect(result.success).toBe(true);
    expect(result.source).toBe('snapshot');
    expect(result.hasDiff).toBe(true);
    expect(result.diff).toContain('+new content');
  });
});
