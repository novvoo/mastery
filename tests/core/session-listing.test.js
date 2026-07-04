import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  listSessions,
  countSessions,
  searchSessions,
  getSessionPreview,
} from '../../src/core/session/session-listing.js';
import { createSessionFileStore } from '../../src/core/session/session-file-store.js';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-listing-test-'));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function getSessionsDir(tempDir) {
  return path.join(tempDir, 'sessions');
}

function writeSessionFile(sessionsDir, sessionId, meta, messages = []) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);
  const lines = [];

  if (meta) {
    lines.push(JSON.stringify({
      type: 'session_meta',
      version: 1,
      sessionId,
      ...meta,
    }));
  }

  for (const msg of messages) {
    lines.push(JSON.stringify({
      type: 'message',
      message: msg,
      timestamp: Date.now(),
    }));
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}

describe('session-listing', () => {
  describe('listSessions', () => {
    test('空目录返回空数组', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        fs.mkdirSync(sessionsDir, { recursive: true });

        const result = await listSessions({ sessionsDir });
        expect(result).toEqual([]);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('单个会话返回一条，含 sessionId/title/createdAt/updatedAt/status', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const now = Date.now();

        writeSessionFile(sessionsDir, 'sess-001', {
          title: 'My First Session',
          createdAt: now,
          updatedAt: now + 1000,
          status: 'completed',
        });

        const result = await listSessions({ sessionsDir });
        expect(result.length).toBe(1);
        expect(result[0].sessionId).toBe('sess-001');
        expect(result[0].title).toBe('My First Session');
        expect(result[0].createdAt).toBe(now);
        expect(result[0].updatedAt).toBe(now + 1000);
        expect(result[0].status).toBe('completed');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('多个会话按 updatedAt 倒序（默认）', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        writeSessionFile(sessionsDir, 'sess-old', {
          title: 'Old Session',
          createdAt: baseTime,
          updatedAt: baseTime + 1000,
        });

        writeSessionFile(sessionsDir, 'sess-new', {
          title: 'New Session',
          createdAt: baseTime + 500,
          updatedAt: baseTime + 5000,
        });

        writeSessionFile(sessionsDir, 'sess-mid', {
          title: 'Mid Session',
          createdAt: baseTime + 200,
          updatedAt: baseTime + 3000,
        });

        const result = await listSessions({ sessionsDir });
        expect(result.length).toBe(3);
        expect(result[0].sessionId).toBe('sess-new');
        expect(result[1].sessionId).toBe('sess-mid');
        expect(result[2].sessionId).toBe('sess-old');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('按 createdAt 排序', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        writeSessionFile(sessionsDir, 'sess-1', {
          title: 'Session 1',
          createdAt: baseTime + 100,
          updatedAt: baseTime + 5000,
        });

        writeSessionFile(sessionsDir, 'sess-2', {
          title: 'Session 2',
          createdAt: baseTime + 300,
          updatedAt: baseTime + 1000,
        });

        writeSessionFile(sessionsDir, 'sess-3', {
          title: 'Session 3',
          createdAt: baseTime + 200,
          updatedAt: baseTime + 3000,
        });

        const result = await listSessions({ sessionsDir, sortBy: 'createdAt' });
        expect(result.length).toBe(3);
        expect(result[0].sessionId).toBe('sess-2');
        expect(result[1].sessionId).toBe('sess-3');
        expect(result[2].sessionId).toBe('sess-1');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test("sortOrder='asc' 升序", async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        writeSessionFile(sessionsDir, 'sess-a', {
          title: 'A',
          createdAt: baseTime,
          updatedAt: baseTime + 100,
        });

        writeSessionFile(sessionsDir, 'sess-b', {
          title: 'B',
          createdAt: baseTime,
          updatedAt: baseTime + 300,
        });

        writeSessionFile(sessionsDir, 'sess-c', {
          title: 'C',
          createdAt: baseTime,
          updatedAt: baseTime + 200,
        });

        const result = await listSessions({ sessionsDir, sortOrder: 'asc' });
        expect(result.length).toBe(3);
        expect(result[0].sessionId).toBe('sess-a');
        expect(result[1].sessionId).toBe('sess-c');
        expect(result[2].sessionId).toBe('sess-b');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('limit 分页限制数量', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        for (let i = 0; i < 10; i++) {
          writeSessionFile(sessionsDir, `sess-${i}`, {
            title: `Session ${i}`,
            createdAt: baseTime + i * 1000,
            updatedAt: baseTime + i * 1000,
          });
        }

        const result = await listSessions({ sessionsDir, limit: 3 });
        expect(result.length).toBe(3);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('offset 跳过指定数量', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        for (let i = 0; i < 5; i++) {
          writeSessionFile(sessionsDir, `sess-${i}`, {
            title: `Session ${i}`,
            createdAt: baseTime + i * 1000,
            updatedAt: baseTime + i * 1000,
          });
        }

        const result = await listSessions({ sessionsDir, offset: 2, limit: 10 });
        expect(result.length).toBe(3);
        expect(result[0].sessionId).toBe('sess-2');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('limit + offset 组合正确', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        for (let i = 0; i < 10; i++) {
          writeSessionFile(sessionsDir, `sess-${i}`, {
            title: `Session ${i}`,
            createdAt: baseTime + i * 1000,
            updatedAt: baseTime + i * 1000,
          });
        }

        const result = await listSessions({ sessionsDir, offset: 3, limit: 4 });
        expect(result.length).toBe(4);
        expect(result[0].sessionId).toBe('sess-6');
        expect(result[3].sessionId).toBe('sess-3');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('超过 64 个文件时并发读取（创建 70 个会话验证不报错）', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        for (let i = 0; i < 70; i++) {
          writeSessionFile(sessionsDir, `sess-${i}`, {
            title: `Session ${i}`,
            createdAt: baseTime + i * 1000,
            updatedAt: baseTime + i * 1000,
          });
        }

        const result = await listSessions({ sessionsDir, limit: 100 });
        expect(result.length).toBe(70);
        expect(result[0].sessionId).toBe('sess-69');
        expect(result[69].sessionId).toBe('sess-0');
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('countSessions', () => {
    test('空目录返回 0', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        fs.mkdirSync(sessionsDir, { recursive: true });

        const count = await countSessions({ sessionsDir });
        expect(count).toBe(0);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('N 个会话返回 N', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        for (let i = 0; i < 5; i++) {
          writeSessionFile(sessionsDir, `sess-${i}`, {
            title: `Session ${i}`,
            createdAt: baseTime + i * 1000,
          });
        }

        const count = await countSessions({ sessionsDir });
        expect(count).toBe(5);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('searchSessions', () => {
    test('搜索标题匹配的会话（大小写不敏感）', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        writeSessionFile(sessionsDir, 'sess-1', {
          title: 'Hello World Project',
          createdAt: baseTime,
          updatedAt: baseTime + 1000,
        });

        writeSessionFile(sessionsDir, 'sess-2', {
          title: 'Goodbye World',
          createdAt: baseTime,
          updatedAt: baseTime + 2000,
        });

        writeSessionFile(sessionsDir, 'sess-3', {
          title: 'HELLO universe',
          createdAt: baseTime,
          updatedAt: baseTime + 3000,
        });

        const result = await searchSessions({ sessionsDir, query: 'hello' });
        expect(result.length).toBe(2);
        expect(result.some((s) => s.title === 'Hello World Project')).toBe(true);
        expect(result.some((s) => s.title === 'HELLO universe')).toBe(true);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('无匹配返回空数组', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        writeSessionFile(sessionsDir, 'sess-1', {
          title: 'Test Session',
          createdAt: baseTime,
        });

        const result = await searchSessions({ sessionsDir, query: 'nonexistent' });
        expect(result).toEqual([]);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('limit 限制结果数', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        const baseTime = Date.now();

        for (let i = 0; i < 10; i++) {
          writeSessionFile(sessionsDir, `sess-${i}`, {
            title: `Project ${i}`,
            createdAt: baseTime + i * 1000,
            updatedAt: baseTime + i * 1000,
          });
        }

        const result = await searchSessions({ sessionsDir, query: 'Project', limit: 3 });
        expect(result.length).toBe(3);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('getSessionPreview', () => {
    test('返回第一条用户消息的预览', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);

        writeSessionFile(
          sessionsDir,
          'sess-1',
          { title: 'Test' },
          [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello, how are you?' },
            { role: 'assistant', content: 'I am fine.' },
            { role: 'user', content: 'Second message' },
          ],
        );

        const preview = await getSessionPreview('sess-1', { sessionsDir });
        expect(preview).not.toBeNull();
        expect(preview.sessionId).toBe('sess-1');
        expect(preview.preview).toBe('Hello, how are you?');
        expect(preview.hasMore).toBe(false);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('超长文本截断（hasMore=true）', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);

        const longContent = 'A'.repeat(500);
        writeSessionFile(
          sessionsDir,
          'sess-1',
          { title: 'Test' },
          [{ role: 'user', content: longContent }],
        );

        const preview = await getSessionPreview('sess-1', { sessionsDir, previewLength: 100 });
        expect(preview).not.toBeNull();
        expect(preview.preview.length).toBe(100);
        expect(preview.preview).toBe('A'.repeat(100));
        expect(preview.hasMore).toBe(true);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('无用户消息返回空字符串', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);

        writeSessionFile(
          sessionsDir,
          'sess-1',
          { title: 'Test' },
          [
            { role: 'system', content: 'System prompt' },
            { role: 'assistant', content: 'Assistant message' },
          ],
        );

        const preview = await getSessionPreview('sess-1', { sessionsDir });
        expect(preview).not.toBeNull();
        expect(preview.preview).toBe('');
        expect(preview.hasMore).toBe(false);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('边界情况', () => {
    test('损坏的 JSONL 文件不崩溃（跳过错误行）', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'broken.jsonl');
        const content = [
          'this is not valid json',
          JSON.stringify({ type: 'session_meta', sessionId: 'broken', title: 'Broken Session', createdAt: 1000 }),
          'another bad line',
        ].join('\n');
        fs.writeFileSync(filePath, content, 'utf-8');

        const result = await listSessions({ sessionsDir });
        expect(result.length).toBe(1);
        expect(result[0].sessionId).toBe('broken');
        expect(result[0].title).toBe('Broken Session');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('meta 在文件末尾的情况（读尾部窗口）', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'tail-meta.jsonl');
        const lines = [];
        for (let i = 0; i < 100; i++) {
          lines.push(JSON.stringify({ type: 'message', message: { role: 'user', content: `msg ${i}` } }));
        }
        lines.push(JSON.stringify({ type: 'session_meta', sessionId: 'tail-meta', title: 'Tail Meta Session', createdAt: 2000, updatedAt: 3000 }));
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

        const result = await listSessions({ sessionsDir });
        expect(result.length).toBe(1);
        expect(result[0].sessionId).toBe('tail-meta');
        expect(result[0].title).toBe('Tail Meta Session');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('文件 mtime 作为 updatedAt fallback', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        fs.mkdirSync(sessionsDir, { recursive: true });

        const filePath = path.join(sessionsDir, 'no-meta.jsonl');
        fs.writeFileSync(filePath, 'not a meta line\n', 'utf-8');

        const result = await listSessions({ sessionsDir });
        expect(result.length).toBe(1);
        expect(result[0].sessionId).toBe('no-meta');
        expect(typeof result[0].updatedAt).toBe('number');
        expect(result[0].updatedAt).toBeGreaterThan(0);
        expect(result[0].title).toBe('未命名会话');
        expect(result[0].status).toBe('unknown');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('sessionsDir 不存在时返回空数组', async () => {
      const result = await listSessions({ sessionsDir: '/nonexistent/path' });
      expect(result).toEqual([]);

      const count = await countSessions({ sessionsDir: '/nonexistent/path' });
      expect(count).toBe(0);

      const search = await searchSessions({ sessionsDir: '/nonexistent/path', query: 'test' });
      expect(search).toEqual([]);
    });

    test('getSessionPreview 不存在的会话返回 null', async () => {
      const tempDir = createTempDir();
      try {
        const sessionsDir = getSessionsDir(tempDir);
        fs.mkdirSync(sessionsDir, { recursive: true });

        const preview = await getSessionPreview('nonexistent', { sessionsDir });
        expect(preview).toBeNull();
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('使用 createSessionFileStore 创建会话后能被 listSessions 读取', async () => {
      const tempDir = createTempDir();
      try {
        const store = createSessionFileStore({ appDataDir: tempDir, debounceMs: 10 });
        const sessionsDir = store.getSessionsDir();

        store.appendMeta('sess-store-1', { title: 'From Store', createdAt: 1000 });
        await store.flush();

        const result = await listSessions({ sessionsDir });
        expect(result.length).toBe(1);
        expect(result[0].sessionId).toBe('sess-store-1');
        expect(result[0].title).toBe('From Store');
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });
});
