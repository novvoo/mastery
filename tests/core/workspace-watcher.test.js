import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  listWorkspaceDirectory,
  createWorkspaceWatcher,
  DEFAULT_IGNORED_WATCH_DIRECTORIES,
} from '../../src/core/workspace-watcher.js';

describe('workspace-watcher', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-watch-test-'));
    // Create test structure
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'src', 'index.js'), 'console.log("hi")');
    fs.writeFileSync(path.join(tempDir, 'src', 'readme.md'), '# Test');
    fs.mkdirSync(path.join(tempDir, '.git'));
    fs.writeFileSync(path.join(tempDir, '.git', 'config'), '[core]');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('listWorkspaceDirectory returns entries for valid directory', () => {
    const result = listWorkspaceDirectory(tempDir);
    expect(result.success).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.root).toBe(tempDir);
  });

  test('listWorkspaceDirectory separates directories and files', () => {
    const result = listWorkspaceDirectory(tempDir);
    expect(result.success).toBe(true);
    const dirs = result.entries.filter((e) => e.type === 'directory');
    const files = result.entries.filter((e) => e.type === 'file');
    expect(dirs.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
  });

  test('listWorkspaceDirectory respects maxEntries', () => {
    const result = listWorkspaceDirectory(tempDir, { maxEntries: 2 });
    expect(result.success).toBe(true);
    expect(result.entries.length).toBeLessThanOrEqual(2);
  });

  test('listWorkspaceDirectory ignores negative maxEntries', () => {
    const result = listWorkspaceDirectory(tempDir, { maxEntries: -1 });
    expect(result.success).toBe(true);
    expect(result.entries.length).toBe(result.total);
    expect(result.truncated).toBe(false);
  });

  test('listWorkspaceDirectory allows zero maxEntries', () => {
    const result = listWorkspaceDirectory(tempDir, { maxEntries: 0 });
    expect(result.success).toBe(true);
    expect(result.entries.length).toBe(0);
    expect(result.truncated).toBe(true);
  });

  test('listWorkspaceDirectory fails for non-existent directory', () => {
    const result = listWorkspaceDirectory('/non/existent/path');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('listWorkspaceDirectory fails for path outside workspace', () => {
    const result = listWorkspaceDirectory(tempDir, { path: '../../etc' });
    expect(result.success).toBe(false);
  });

  test('listWorkspaceDirectory navigates subdirectory', () => {
    const result = listWorkspaceDirectory(tempDir, { path: 'src' });
    expect(result.success).toBe(true);
    expect(result.entries.length).toBe(2);
  });

  test('DEFAULT_IGNORED_WATCH_DIRECTORIES includes common ignores', () => {
    expect(DEFAULT_IGNORED_WATCH_DIRECTORIES.has('node_modules')).toBe(true);
    expect(DEFAULT_IGNORED_WATCH_DIRECTORIES.has('.git')).toBe(true);
    expect(DEFAULT_IGNORED_WATCH_DIRECTORIES.has('dist')).toBe(true);
  });

  test('createWorkspaceWatcher detects file changes', async () => {
    const changes = [];
    const watcher = createWorkspaceWatcher(
      tempDir,
      (change) => {
        changes.push(change);
      },
      { debounceMs: 30, enableNativeWatch: false, pollIntervalMs: 20 },
    );

    // Create a new file
    fs.writeFileSync(path.join(tempDir, 'new-file.txt'), 'hello');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 200));

    watcher.close();
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].eventType).toBeDefined();
    expect(changes[0].root).toBe(tempDir);
  });

  test('createWorkspaceWatcher close stops watching', () => {
    const watcher = createWorkspaceWatcher(tempDir, () => {}, {
      debounceMs: 30,
      pollIntervalMs: 0,
    });
    // Should not throw
    watcher.close();
  });
});
