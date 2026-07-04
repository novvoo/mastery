import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  SessionFileStore,
  SessionFileStoreError,
  getProjectHash,
  createSessionFileStore,
} from '../../src/core/session/session-file-store.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-file-store-test-'));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createStore(appDataDir, debounceMs = 50) {
  return new SessionFileStore({ appDataDir, debounceMs });
}

describe('SessionFileStore - 基础', () => {
  test('构造函数创建实例', () => {
    const tempDir = makeTempDir();
    try {
      const store = new SessionFileStore({ appDataDir: tempDir });
      expect(store).toBeInstanceOf(SessionFileStore);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('getSessionsDir 返回正确路径', () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      expect(store.getSessionsDir()).toBe(path.join(tempDir, 'sessions'));
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('getProjectSessionsDir 包含 project hash', () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const projectDir = '/some/project/path';
      const hash = getProjectHash(projectDir);
      const result = store.getProjectSessionsDir(projectDir);
      expect(result).toContain(hash);
      expect(result).toBe(path.join(tempDir, 'sessions', hash));
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('getSessionFilePath 返回正确路径', () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const result = store.getSessionFilePath('session-123');
      expect(result).toBe(path.join(tempDir, 'sessions', 'session-123.jsonl'));
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('getProjectHash 对相同路径返回相同 hash', () => {
    const path1 = '/Users/test/project';
    const path2 = '/Users/test/project';
    expect(getProjectHash(path1)).toBe(getProjectHash(path2));
  });

  test('getProjectHash 不同路径返回不同 hash', () => {
    const path1 = '/Users/test/project-a';
    const path2 = '/Users/test/project-b';
    expect(getProjectHash(path1)).not.toBe(getProjectHash(path2));
  });
});

describe('SessionFileStore - 写入与加载', () => {
  test('appendMeta 写入元数据 entry', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const meta = {
        title: 'Test Session',
        createdAt: 1000,
        status: 'running',
      };
      const result = await store.appendMeta('s1', meta);
      await store.flush();

      expect(result.type).toBe('session_meta');
      expect(result.title).toBe('Test Session');
      expect(result.sessionId).toBe('s1');

      const loaded = await store.loadSession('s1');
      expect(loaded.meta.title).toBe('Test Session');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('appendMessage 写入消息 entry', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const message = { role: 'user', content: 'hello' };
      await store.appendMeta('s1', { title: 'Test' });
      await store.appendMessage('s1', message);
      await store.flush();

      const loaded = await store.loadSession('s1');
      expect(loaded.messages.length).toBe(1);
      expect(loaded.messages[0].content).toBe('hello');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('appendToolCall / appendToolResult 写入工具 entry', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Test' });
      await store.appendToolCall('s1', 'read_file', { path: '/tmp/test.txt' });
      await store.appendToolResult('s1', 'read_file', 'file content');
      await store.flush();

      const loaded = await store.loadSession('s1');
      const toolCalls = loaded.entries.filter((e) => e.type === 'tool_call');
      const toolResults = loaded.entries.filter((e) => e.type === 'tool_result');
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].toolName).toBe('read_file');
      expect(toolResults.length).toBe(1);
      expect(toolResults[0].result).toBe('file content');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('appendCompaction 写入压缩 entry', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Test' });
      await store.appendCompaction('s1', { compactedMessages: 5, summary: 'test summary' });
      await store.flush();

      const loaded = await store.loadSession('s1');
      const compactions = loaded.entries.filter((e) => e.type === 'compaction');
      expect(compactions.length).toBe(1);
      expect(compactions[0].compactionInfo.summary).toBe('test summary');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('loadSession 加载完整会话(所有 entries 转换正确)', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Full Session', createdAt: 100 });
      await store.appendMessage('s1', { role: 'user', content: 'hi' });
      await store.appendToolCall('s1', 'tool1', { a: 1 });
      await store.appendToolResult('s1', 'tool1', 'result1');
      await store.appendMessage('s1', { role: 'assistant', content: 'bye' });
      await store.appendCompaction('s1', { summary: 'done' });
      await store.flush();

      const loaded = await store.loadSession('s1');
      expect(loaded.sessionId).toBe('s1');
      expect(loaded.entries.length).toBe(6);
      expect(loaded.messages.length).toBe(2);
      expect(loaded.meta.title).toBe('Full Session');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('loadSession 返回 { sessionId, meta, messages, entries }', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Test' });
      await store.appendMessage('s1', { role: 'user', content: 'hi' });
      await store.flush();

      const loaded = await store.loadSession('s1');
      expect(loaded).toHaveProperty('sessionId');
      expect(loaded).toHaveProperty('meta');
      expect(loaded).toHaveProperty('messages');
      expect(loaded).toHaveProperty('entries');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('getSessionMeta 只读元数据', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Meta Test', createdAt: 500 });
      await store.appendMessage('s1', { role: 'user', content: 'hi' });
      await store.appendMessage('s1', { role: 'assistant', content: 'hello' });
      await store.flush();

      const meta = await store.getSessionMeta('s1');
      expect(meta.type).toBe('session_meta');
      expect(meta.title).toBe('Meta Test');
      expect(meta.createdAt).toBe(500);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('多次 append 后加载顺序正确', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Order Test' });
      await store.appendMessage('s1', { role: 'user', content: '1' });
      await store.appendMessage('s1', { role: 'assistant', content: '2' });
      await store.appendMessage('s1', { role: 'user', content: '3' });
      await store.flush();

      const loaded = await store.loadSession('s1');
      expect(loaded.messages[0].content).toBe('1');
      expect(loaded.messages[1].content).toBe('2');
      expect(loaded.messages[2].content).toBe('3');
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});

describe('SessionFileStore - 删除与重命名', () => {
  test('deleteSession 删除文件', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'To Delete' });
      await store.flush();

      const before = await store.loadSession('s1');
      expect(before).not.toBeNull();

      const result = await store.deleteSession('s1');
      expect(result).toBe(true);

      const after = await store.loadSession('s1');
      expect(after).toBeNull();
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('deleteSession 不存在的会话不抛错', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const result = await store.deleteSession('nonexistent');
      expect(result).toBe(false);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('saveSessionTitle 更新标题', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Old Title' });
      await store.flush();

      const result = await store.saveSessionTitle('s1', 'New Title');
      expect(result).toBe(true);

      const meta = await store.getSessionMeta('s1');
      expect(meta.title).toBe('New Title');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('saveSessionTitle 后 getSessionMeta 返回新标题', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Original' });
      await store.flush();

      await store.saveSessionTitle('s1', 'Updated Title');
      const meta = await store.getSessionMeta('s1');
      expect(meta.title).toBe('Updated Title');
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});

describe('SessionFileStore - 批量 flush', () => {
  test('flush() 等待所有待写入完成', async () => {
    const tempDir = makeTempDir();
    try {
      const store = new SessionFileStore({ appDataDir: tempDir, debounceMs: 100 });
      await store.appendMeta('s1', { title: 'Flush Test' });
      await store.appendMessage('s1', { role: 'user', content: 'hi' });

      const beforeFlushPath = store.getSessionFilePath('s1');
      expect(fs.existsSync(beforeFlushPath)).toBe(false);

      await store.flush();
      expect(fs.existsSync(beforeFlushPath)).toBe(true);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('debounceMs=0 时创建 store 不报错', () => {
    const tempDir = makeTempDir();
    try {
      const store = new SessionFileStore({ appDataDir: tempDir, debounceMs: 0 });
      expect(store).toBeInstanceOf(SessionFileStore);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('多次 append 合并到一次 flush', async () => {
    const tempDir = makeTempDir();
    try {
      const store = new SessionFileStore({ appDataDir: tempDir, debounceMs: 100 });
      await store.appendMeta('s1', { title: 'Batch' });
      await store.appendMessage('s1', { role: 'user', content: 'msg1' });
      await store.appendMessage('s1', { role: 'user', content: 'msg2' });
      await store.appendMessage('s1', { role: 'user', content: 'msg3' });

      const filePath = store.getSessionFilePath('s1');
      expect(fs.existsSync(filePath)).toBe(false);

      await store.flush();
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = await store.loadSession('s1');
      expect(loaded.messages.length).toBe(3);
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});

describe('SessionFileStore - 列表', () => {
  test('listSessionFiles 列出所有 .jsonl 文件', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      await store.appendMeta('s1', { title: 'Session 1' });
      await store.appendMeta('s2', { title: 'Session 2' });
      await store.flush();

      const files = await store.listSessionFiles();
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some((f) => f.endsWith('s1.jsonl'))).toBe(true);
      expect(files.some((f) => f.endsWith('s2.jsonl'))).toBe(true);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('多项目目录隔离', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const projectA = '/path/to/projectA';
      const projectB = '/path/to/projectB';

      await store.appendMeta('s1', { title: 'Project A Session' }, projectA);
      await store.appendMeta('s2', { title: 'Project B Session' }, projectB);
      await store.flush();

      const filesA = await store.listSessionFiles(projectA);
      const filesB = await store.listSessionFiles(projectB);

      expect(filesA.length).toBe(1);
      expect(filesB.length).toBe(1);
      expect(filesA[0]).not.toBe(filesB[0]);
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});

describe('SessionFileStore - 错误处理', () => {
  test('getSessionFilePath 无 sessionId 抛错', () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      expect(() => store.getSessionFilePath('')).toThrow(SessionFileStoreError);
      expect(() => store.getSessionFilePath(null)).toThrow(SessionFileStoreError);
      expect(() => store.getSessionFilePath(undefined)).toThrow(SessionFileStoreError);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('loadSession 不存在的会话返回 null', async () => {
    const tempDir = makeTempDir();
    try {
      const store = createStore(tempDir);
      const result = await store.loadSession('nonexistent');
      expect(result).toBeNull();
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  test('SessionFileStoreError 有 code 和 name', () => {
    const error = new SessionFileStoreError('test error', 'TEST_CODE');
    expect(error.name).toBe('SessionFileStoreError');
    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('test error');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('SessionFileStore - 工厂函数', () => {
  test('createSessionFileStore(options) 返回实例', () => {
    const tempDir = makeTempDir();
    try {
      const store = createSessionFileStore({ appDataDir: tempDir });
      expect(store).toBeInstanceOf(SessionFileStore);
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
