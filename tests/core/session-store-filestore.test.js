import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  SessionStore,
  createSessionStore,
} from '../../src/core/session/session-store.js';
import {
  SessionFileStore,
  createSessionFileStore,
} from '../../src/core/session/session-file-store.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-filestore-test-'));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createFileStore(appDataDir, debounceMs = 50) {
  return createSessionFileStore({ appDataDir, debounceMs });
}

describe('SessionStore + fileStore 集成', () => {
  describe('无 fileStore (纯内存模式)', () => {
    test('SessionStore 创建时不传 fileStore 也能工作', () => {
      const store = new SessionStore();
      expect(store).toBeInstanceOf(SessionStore);
    });

    test('createSession 创建会话', () => {
      const store = new SessionStore();
      const session = store.createSession('s1', { title: 'Test Session' });
      expect(session.id).toBe('s1');
      expect(session.title).toBe('Test Session');
      expect(session.messages).toEqual([]);
      expect(session.toolCalls).toEqual([]);
      expect(session.toolResults).toEqual([]);
    });

    test('addMessage 添加消息', () => {
      const store = new SessionStore();
      store.createSession('s1');
      const message = { role: 'user', content: 'hello' };
      const result = store.addMessage('s1', message);
      expect(result).toBe(message);
      const session = store.getSession('s1');
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].content).toBe('hello');
    });

    test('getSession 获取会话', () => {
      const store = new SessionStore();
      store.createSession('s1', { title: 'Hello' });
      const session = store.getSession('s1');
      expect(session).not.toBeNull();
      expect(session.title).toBe('Hello');
      expect(store.getSession('nonexistent')).toBeNull();
    });

    test('addToolCall / addToolResult 正常', () => {
      const store = new SessionStore();
      store.createSession('s1');
      const toolCall = store.addToolCall('s1', 'read_file', { path: '/tmp/test.txt' });
      expect(toolCall.toolName).toBe('read_file');
      expect(toolCall.args.path).toBe('/tmp/test.txt');

      const toolResult = store.addToolResult('s1', 'read_file', 'file content here');
      expect(toolResult.toolName).toBe('read_file');
      expect(toolResult.result).toBe('file content here');

      const session = store.getSession('s1');
      expect(session.toolCalls.length).toBe(1);
      expect(session.toolResults.length).toBe(1);
    });

    test('getFileStore 返回 null', () => {
      const store = new SessionStore();
      expect(store.getFileStore()).toBeNull();
    });

    test('getAllSessions 返回所有会话', () => {
      const store = new SessionStore();
      store.createSession('s1');
      store.createSession('s2');
      const all = store.getAllSessions();
      expect(all.length).toBe(2);
    });

    test('deleteSession 删除会话', () => {
      const store = new SessionStore();
      store.createSession('s1');
      expect(store.getSession('s1')).not.toBeNull();
      const result = store.deleteSession('s1');
      expect(result).toBe(true);
      expect(store.getSession('s1')).toBeNull();
    });
  });

  describe('有 fileStore (持久化模式)', () => {
    let tempDir;
    let fileStore;
    let store;

    beforeEach(() => {
      tempDir = makeTempDir();
      fileStore = createFileStore(tempDir, 50);
      store = new SessionStore({ fileStore, workingDirectory: '/test/project' });
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    test('createSession 同时写入 fileStore (appendMeta)', async () => {
      store.createSession('s1', { title: 'Persistent Session' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test/project');
      expect(loaded).not.toBeNull();
      expect(loaded.meta.title).toBe('Persistent Session');
      expect(loaded.meta.type).toBe('session_meta');
    });

    test('addMessage 同时写入 fileStore', async () => {
      store.createSession('s1');
      store.addMessage('s1', { role: 'user', content: 'hello world' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test/project');
      expect(loaded.messages.length).toBe(1);
      expect(loaded.messages[0].content).toBe('hello world');
    });

    test('addToolCall 同时写入 fileStore', async () => {
      store.createSession('s1');
      store.addToolCall('s1', 'run_command', { cmd: 'ls' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test/project');
      const toolCalls = loaded.entries.filter((e) => e.type === 'tool_call');
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].toolName).toBe('run_command');
      expect(toolCalls[0].args.cmd).toBe('ls');
    });

    test('addToolResult 同时写入 fileStore', async () => {
      store.createSession('s1');
      store.addToolResult('s1', 'run_command', { stdout: 'file1.txt\nfile2.txt' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test/project');
      const toolResults = loaded.entries.filter((e) => e.type === 'tool_result');
      expect(toolResults.length).toBe(1);
      expect(toolResults[0].toolName).toBe('run_command');
      expect(toolResults[0].result.stdout).toBe('file1.txt\nfile2.txt');
    });

    test('flush() 后文件中能读到数据', async () => {
      store.createSession('s1', { title: 'Flush Test' });
      store.addMessage('s1', { role: 'user', content: 'before flush' });

      const filePath = fileStore.getSessionFilePath('s1', '/test/project');
      expect(fs.existsSync(filePath)).toBe(false);

      await store.flush();
      await fileStore.flush();
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = await fileStore.loadSession('s1', '/test/project');
      expect(loaded.messages.length).toBe(1);
    });

    test('deleteSession 从内存删除，fileStore 保留文件', async () => {
      store.createSession('s1', { title: 'To Delete' });
      await store.flush();
      await fileStore.flush();

      const filePath = fileStore.getSessionFilePath('s1', '/test/project');
      expect(fs.existsSync(filePath)).toBe(true);

      const result = store.deleteSession('s1');
      expect(result).toBe(true);
      expect(store.getSession('s1')).toBeNull();

      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('重启场景: 创建新 SessionStore,加载之前写入的文件', async () => {
      store.createSession('s1', { title: 'Restart Test' });
      store.addMessage('s1', { role: 'user', content: 'message 1' });
      store.addMessage('s1', { role: 'assistant', content: 'reply 1' });
      store.addToolCall('s1', 'tool_a', { x: 1 });
      store.addToolResult('s1', 'tool_a', 'result_a');
      await store.flush();
      await fileStore.flush();

      const newFileStore = createFileStore(tempDir, 50);
      const newStore = new SessionStore({ fileStore: newFileStore, workingDirectory: '/test/project' });

      const loadedData = await newFileStore.loadSession('s1', '/test/project');
      expect(loadedData).not.toBeNull();
      expect(loadedData.meta.title).toBe('Restart Test');
      expect(loadedData.messages.length).toBe(2);

      newStore.createSession('s1', {
        title: loadedData.meta.title,
        createdAt: loadedData.meta.createdAt,
      });
      for (const msg of loadedData.messages) {
        newStore.addMessage('s1', msg);
      }

      const session = newStore.getSession('s1');
      expect(session.title).toBe('Restart Test');
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].content).toBe('message 1');
      expect(session.messages[1].content).toBe('reply 1');
    });

    test('getFileStore 返回 fileStore 实例', () => {
      expect(store.getFileStore()).toBe(fileStore);
    });

    test('workingDirectory 属性正确', () => {
      expect(store.workingDirectory).toBe('/test/project');
    });

    test('多消息顺序正确', async () => {
      store.createSession('s1');
      store.addMessage('s1', { role: 'user', content: 'first' });
      store.addMessage('s1', { role: 'assistant', content: 'second' });
      store.addMessage('s1', { role: 'user', content: 'third' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test/project');
      expect(loaded.messages.length).toBe(3);
      expect(loaded.messages[0].content).toBe('first');
      expect(loaded.messages[1].content).toBe('second');
      expect(loaded.messages[2].content).toBe('third');
    });

    test('不同 workingDirectory 写入不同目录', async () => {
      const storeA = new SessionStore({ fileStore, workingDirectory: '/proj/A' });
      const storeB = new SessionStore({ fileStore, workingDirectory: '/proj/B' });

      storeA.createSession('s1', { title: 'Project A' });
      storeB.createSession('s1', { title: 'Project B' });
      await storeA.flush();
      await storeB.flush();

      const loadedA = await fileStore.loadSession('s1', '/proj/A');
      const loadedB = await fileStore.loadSession('s1', '/proj/B');

      expect(loadedA.meta.title).toBe('Project A');
      expect(loadedB.meta.title).toBe('Project B');
    });
  });

  describe('autoPersist 选项', () => {
    let tempDir;
    let fileStore;

    beforeEach(() => {
      tempDir = makeTempDir();
      fileStore = createFileStore(tempDir, 50);
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    test('autoPersist=false 时 createSession 不写入 fileStore', async () => {
      const store = new SessionStore({
        fileStore,
        workingDirectory: '/test',
        autoPersist: false,
      });

      store.createSession('s1', { title: 'No Persist' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test');
      expect(loaded).toBeNull();
    });

    test('autoPersist=false 时 addMessage 不写入 fileStore', async () => {
      const store = new SessionStore({
        fileStore,
        workingDirectory: '/test',
        autoPersist: false,
      });

      store.createSession('s1');
      store.addMessage('s1', { role: 'user', content: 'hello' });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test');
      expect(loaded).toBeNull();

      const session = store.getSession('s1');
      expect(session.messages.length).toBe(1);
    });

    test('autoPersist=false 时 addToolCall 不写入 fileStore', async () => {
      const store = new SessionStore({
        fileStore,
        workingDirectory: '/test',
        autoPersist: false,
      });

      store.createSession('s1');
      store.addToolCall('s1', 'tool1', { a: 1 });
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test');
      expect(loaded).toBeNull();

      const session = store.getSession('s1');
      expect(session.toolCalls.length).toBe(1);
    });

    test('autoPersist=false 时 addToolResult 不写入 fileStore', async () => {
      const store = new SessionStore({
        fileStore,
        workingDirectory: '/test',
        autoPersist: false,
      });

      store.createSession('s1');
      store.addToolResult('s1', 'tool1', 'result');
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test');
      expect(loaded).toBeNull();

      const session = store.getSession('s1');
      expect(session.toolResults.length).toBe(1);
    });

    test('autoPersist 默认值为 true', async () => {
      const store = new SessionStore({ fileStore, workingDirectory: '/test' });
      store.createSession('s1');
      await store.flush();

      const loaded = await fileStore.loadSession('s1', '/test');
      expect(loaded).not.toBeNull();
    });

    test('写入内存但不写文件 (addMessage 内存正常)', () => {
      const store = new SessionStore({
        fileStore,
        workingDirectory: '/test',
        autoPersist: false,
      });

      store.createSession('s1');
      store.addMessage('s1', { role: 'user', content: 'memory only' });

      const session = store.getSession('s1');
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].content).toBe('memory only');
    });
  });

  describe('错误隔离', () => {
    test('fileStore 写入错误不影响内存操作 (只 console.error,不抛出)', async () => {
      const tempDir = makeTempDir();
      try {
        const realFileStore = createFileStore(tempDir, 50);

        const brokenFileStore = {
          appendMeta: () => Promise.reject(new Error('disk full')),
          appendMessage: () => Promise.reject(new Error('disk full')),
          appendToolCall: () => Promise.reject(new Error('disk full')),
          appendToolResult: () => Promise.reject(new Error('disk full')),
          flush: () => Promise.resolve(),
        };

        const originalError = console.error;
        let errorLogged = false;
        console.error = (...args) => {
          if (args[0]?.includes?.('[SessionStore]') || args.some(a => a?.message?.includes?.('disk full'))) {
            errorLogged = true;
          }
        };

        const store = new SessionStore({ fileStore: brokenFileStore, workingDirectory: '/test' });

        expect(() => {
          store.createSession('s1', { title: 'Error Test' });
        }).not.toThrow();

        expect(() => {
          store.addMessage('s1', { role: 'user', content: 'test' });
        }).not.toThrow();

        expect(() => {
          store.addToolCall('s1', 'tool', {});
        }).not.toThrow();

        expect(() => {
          store.addToolResult('s1', 'tool', 'res');
        }).not.toThrow();

        const session = store.getSession('s1');
        expect(session).not.toBeNull();
        expect(session.title).toBe('Error Test');
        expect(session.messages.length).toBe(1);
        expect(session.toolCalls.length).toBe(1);
        expect(session.toolResults.length).toBe(1);

        await store.flush();
        expect(errorLogged).toBe(true);

        console.error = originalError;
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('部分写入失败不影响其他会话', async () => {
      const tempDir = makeTempDir();
      try {
        let failNext = false;
        const flakyFileStore = {
          appendMeta: (sessionId, meta, wd) => {
            if (failNext) {
              return Promise.reject(new Error('flaky error'));
            }
            return Promise.resolve({ type: 'session_meta', sessionId, ...meta });
          },
          appendMessage: () => Promise.resolve({ type: 'message' }),
          appendToolCall: () => Promise.resolve({ type: 'tool_call' }),
          appendToolResult: () => Promise.resolve({ type: 'tool_result' }),
          flush: () => Promise.resolve(),
        };

        const store = new SessionStore({ fileStore: flakyFileStore, workingDirectory: '/test' });

        const originalError = console.error;
        console.error = () => {};

        store.createSession('good1');
        failNext = true;
        store.createSession('bad');
        failNext = false;
        store.createSession('good2');

        expect(store.getSession('good1')).not.toBeNull();
        expect(store.getSession('bad')).not.toBeNull();
        expect(store.getSession('good2')).not.toBeNull();

        await store.flush();
        console.error = originalError;
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('工厂函数', () => {
    test('createSessionStore(options) 返回 SessionStore 实例', () => {
      const store = createSessionStore();
      expect(store).toBeInstanceOf(SessionStore);
    });

    test('createSessionStore 不传参数也能工作', () => {
      const store = createSessionStore();
      store.createSession('s1');
      expect(store.getSession('s1')).not.toBeNull();
    });

    test('createSessionStore 传入 fileStore 选项', () => {
      const tempDir = makeTempDir();
      try {
        const fs = createFileStore(tempDir);
        const store = createSessionStore({ fileStore: fs });
        expect(store.getFileStore()).toBe(fs);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('createSessionStore 传入 workingDirectory', () => {
      const store = createSessionStore({ workingDirectory: '/my/project' });
      expect(store.workingDirectory).toBe('/my/project');
    });

    test('createSessionStore 传入 autoPersist=false', () => {
      const tempDir = makeTempDir();
      try {
        const fs = createFileStore(tempDir);
        const store = createSessionStore({ fileStore: fs, autoPersist: false });
        expect(store.getFileStore()).toBe(fs);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });
});
