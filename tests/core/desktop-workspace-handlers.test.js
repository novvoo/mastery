import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  handleCreateWorkspaceDirectory,
  handleCreateWorkspaceFile,
  handleDeleteWorkspaceItem,
  handleFileDiff,
  handleReadWorkspaceFile,
  handleRenameWorkspaceItem,
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

  test('workspace CRUD handlers create, rename, and delete real files', async () => {
    const create = await handleCreateWorkspaceFile(
      { path: 'src/created.txt', content: 'hello' },
      { engine },
    );

    expect(create.success).toBe(true);
    expect(create.path).toBe('src/created.txt');
    expect(fs.readFileSync(path.join(tempDir, 'src', 'created.txt'), 'utf8')).toBe('hello');

    const rename = await handleRenameWorkspaceItem(
      { path: 'src/created.txt', newPath: 'src/renamed.txt' },
      { engine },
    );

    expect(rename.success).toBe(true);
    expect(rename.path).toBe('src/renamed.txt');
    expect(fs.existsSync(path.join(tempDir, 'src', 'created.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(tempDir, 'src', 'renamed.txt'), 'utf8')).toBe('hello');

    const remove = await handleDeleteWorkspaceItem({ path: 'src/renamed.txt' }, { engine });

    expect(remove.success).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'src', 'renamed.txt'))).toBe(false);
  });

  test('workspace CRUD handlers create and delete real directories', async () => {
    const create = await handleCreateWorkspaceDirectory({ path: 'nested/dir' }, { engine });

    expect(create.success).toBe(true);
    expect(fs.statSync(path.join(tempDir, 'nested', 'dir')).isDirectory()).toBe(true);

    fs.writeFileSync(path.join(tempDir, 'nested', 'dir', 'child.txt'), 'child', 'utf8');
    const remove = await handleDeleteWorkspaceItem({ path: 'nested' }, { engine });

    expect(remove.success).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'nested'))).toBe(false);
  });

  test('workspace rename refuses to overwrite existing paths', async () => {
    fs.writeFileSync(path.join(tempDir, 'one.txt'), 'one', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'two.txt'), 'two', 'utf8');

    const result = await handleRenameWorkspaceItem(
      { path: 'one.txt', newPath: 'two.txt' },
      { engine },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('目标路径已存在');
    expect(fs.readFileSync(path.join(tempDir, 'one.txt'), 'utf8')).toBe('one');
    expect(fs.readFileSync(path.join(tempDir, 'two.txt'), 'utf8')).toBe('two');
  });

  test('workspace CRUD handlers reject paths outside the workspace', async () => {
    const create = await handleCreateWorkspaceFile({ path: '../outside.txt' }, { engine });
    const remove = await handleDeleteWorkspaceItem({ path: '../outside.txt' }, { engine });
    const rename = await handleRenameWorkspaceItem(
      { path: 'inside.txt', newPath: '../outside.txt' },
      { engine },
    );

    expect(create.success).toBe(false);
    expect(remove.success).toBe(false);
    expect(rename.success).toBe(false);
    expect(create.error).toContain('outside');
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
