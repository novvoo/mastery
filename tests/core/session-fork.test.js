import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createSessionFileStore } from '../../src/core/session/session-file-store.js';
import {
  forkSession,
  createChildSession,
  getSessionLineage,
  listChildSessions,
} from '../../src/core/session/session-fork.js';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-fork-test-'));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createStore(tempDir) {
  return createSessionFileStore({ appDataDir: tempDir, debounceMs: 50 });
}

async function createTestSession(store, sessionId, options = {}) {
  const {
    title = 'Test Session',
    createdAt = Date.now(),
    status = 'running',
    messageCount = 3,
    workingDirectory = '',
  } = options;

  await store.appendMeta(
    sessionId,
    {
      title,
      createdAt,
      updatedAt: createdAt,
      status,
      workingDirectory,
    },
    workingDirectory,
  );

  for (let i = 0; i < messageCount; i++) {
    await store.appendMessage(
      sessionId,
      {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
      },
      workingDirectory,
    );
  }

  await store.flush();
}

describe('session-fork (src/core)', () => {
  describe('forkSession', () => {
    test('基本 fork - 创建新会话，复制内容', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-1', { title: 'Source', messageCount: 5 });

        const result = await forkSession(store, 'source-1');
        expect(result.sessionId).toBeDefined();
        expect(result.sessionId).not.toBe('source-1');
        expect(result.meta).toBeDefined();

        const loaded = await store.loadSession(result.sessionId);
        expect(loaded).not.toBeNull();
        expect(loaded.messages.length).toBe(5);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('新会话有 forkedFrom 和 forkedAt', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-2', { title: 'Source', messageCount: 3 });

        const result = await forkSession(store, 'source-2');
        expect(result.meta.forkedFrom).toBe('source-2');
        expect(result.meta.forkedAt).toBeDefined();
        expect(typeof result.meta.forkedAt).toBe('number');
        expect(result.meta.forkedAt).toBeGreaterThan(0);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('默认标题 Fork: {原标题}', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-3', { title: 'My Session', messageCount: 3 });

        const result = await forkSession(store, 'source-3');
        expect(result.meta.title).toBe('Fork: My Session');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('默认标题处理未命名会话', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await store.appendMeta('unnamed', { title: '', createdAt: Date.now() });
        await store.flush();

        const result = await forkSession(store, 'unnamed');
        expect(result.meta.title).toContain('Fork:');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('指定 newTitle 使用自定义标题', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-4', { title: 'Source', messageCount: 3 });

        const result = await forkSession(store, 'source-4', { newTitle: 'Custom Fork Title' });
        expect(result.meta.title).toBe('Custom Fork Title');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('指定 forkAtMessageIndex 只复制到指定位置', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-5', { title: 'Source', messageCount: 5 });

        const result = await forkSession(store, 'source-5', { forkAtMessageIndex: 2 });
        const loaded = await store.loadSession(result.sessionId);
        expect(loaded.messages.length).toBe(2);
        expect(loaded.messages[0].content).toBe('Message 1');
        expect(loaded.messages[1].content).toBe('Message 2');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('forkAtMessageIndex 为 0 时只复制 meta', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-6', { title: 'Source', messageCount: 5 });

        const result = await forkSession(store, 'source-6', { forkAtMessageIndex: 0 });
        const loaded = await store.loadSession(result.sessionId);
        expect(loaded.messages.length).toBe(0);
        expect(loaded.meta).not.toBeNull();
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('返回 { sessionId, meta }', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-7', { title: 'Source', messageCount: 3 });

        const result = await forkSession(store, 'source-7');
        expect(Object.keys(result).sort()).toEqual(['meta', 'sessionId'].sort());
        expect(typeof result.sessionId).toBe('string');
        expect(typeof result.meta).toBe('object');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('新会话 meta 中的 sessionId 已更新', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-8', { title: 'Source', messageCount: 3 });

        const result = await forkSession(store, 'source-8');
        expect(result.meta.sessionId).toBe(result.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('源会话不存在时抛出错误', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        expect(forkSession(store, 'nonexistent-session')).rejects.toThrow(
          'Source session not found',
        );
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('fork 后 updatedAt 被更新', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        const beforeTime = Date.now() - 1000;
        await createTestSession(store, 'source-9', {
          title: 'Source',
          createdAt: beforeTime,
          messageCount: 3,
        });

        const result = await forkSession(store, 'source-9');
        expect(result.meta.updatedAt).toBeGreaterThanOrEqual(beforeTime);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('forkAtMessageIndex 保留 meta entry', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-10', { title: 'Source', messageCount: 5 });

        const result = await forkSession(store, 'source-10', { forkAtMessageIndex: 3 });
        expect(result.meta).not.toBeNull();
        expect(result.meta.type).toBe('session_meta');
        expect(result.meta.sessionId).toBe(result.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('fork 后源会话保持不变', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-11', { title: 'Original', messageCount: 3 });

        const before = await store.loadSession('source-11');
        await forkSession(store, 'source-11');
        const after = await store.loadSession('source-11');

        expect(after.messages.length).toBe(before.messages.length);
        expect(after.meta.title).toBe('Original');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('fork 生成的 sessionId 是唯一的 UUID', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-12', { title: 'Source', messageCount: 2 });

        const result1 = await forkSession(store, 'source-12');
        const result2 = await forkSession(store, 'source-12');
        expect(result1.sessionId).not.toBe(result2.sessionId);
        expect(result1.sessionId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('forkAtMessageIndex 大于消息数时复制全部消息', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'source-13', { title: 'Source', messageCount: 3 });

        const result = await forkSession(store, 'source-13', { forkAtMessageIndex: 100 });
        const loaded = await store.loadSession(result.sessionId);
        expect(loaded.messages.length).toBe(3);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('createChildSession', () => {
    test('创建子会话，有 parentSession 和 isSubAgent', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-1', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-1', { agentName: 'coder' });
        expect(result.meta.parentSession).toBe('parent-1');
        expect(result.meta.isSubAgent).toBe(true);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('agentName 写入 meta', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-2', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-2', { agentName: 'reviewer' });
        expect(result.meta.agentName).toBe('reviewer');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('默认 agentName 为 unknown', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-3', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-3', {});
        expect(result.meta.agentName).toBe('unknown');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('有 task 时标题使用 task 前缀', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-4', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-4', {
          agentName: 'coder',
          task: 'Fix the bug in login',
        });
        expect(result.meta.title).toContain('Sub-agent:');
        expect(result.meta.title).toContain('Fix the bug in login');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('无 task 时标题使用 agentName', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-5', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-5', { agentName: 'tester' });
        expect(result.meta.title).toBe('Sub-agent: tester');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('返回 { sessionId, meta }', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-6', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-6', { agentName: 'helper' });
        expect(Object.keys(result).sort()).toEqual(['meta', 'sessionId'].sort());
        expect(result.meta.sessionId).toBe(result.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话状态为 running', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-7', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-7', { agentName: 'helper' });
        expect(result.meta.status).toBe('running');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('task 被存储在 meta 中', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-8', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-8', {
          agentName: 'coder',
          task: 'Write tests',
        });
        expect(result.meta.task).toBe('Write tests');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('长 task 标题会被截断', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-9', { title: 'Parent', messageCount: 3 });

        const longTask = 'A'.repeat(100);
        const result = await createChildSession(store, 'parent-9', {
          agentName: 'coder',
          task: longTask,
        });
        expect(result.meta.title.length).toBeLessThanOrEqual('Sub-agent: '.length + 60);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话有 createdAt 和 updatedAt', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-10', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-10', { agentName: 'coder' });
        expect(result.meta.createdAt).toBeDefined();
        expect(result.meta.updatedAt).toBeDefined();
        expect(typeof result.meta.createdAt).toBe('number');
        expect(typeof result.meta.updatedAt).toBe('number');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话 sessionId 是 UUID 格式', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-11', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-11', { agentName: 'coder' });
        expect(result.sessionId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话可以被加载', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-12', { title: 'Parent', messageCount: 3 });

        const result = await createChildSession(store, 'parent-12', { agentName: 'coder' });
        const loaded = await store.loadSession(result.sessionId);
        expect(loaded).not.toBeNull();
        expect(loaded.meta.isSubAgent).toBe(true);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('父会话不存在时也能创建子会话', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        const result = await createChildSession(store, 'nonexistent-parent', {
          agentName: 'coder',
        });
        expect(result.meta.parentSession).toBe('nonexistent-parent');
        expect(result.meta.isSubAgent).toBe(true);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话 version 为 1', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-13', { title: 'Parent', messageCount: 1 });

        const result = await createChildSession(store, 'parent-13', { agentName: 'coder' });
        expect(result.meta.version).toBe(1);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话 type 为 session_meta', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-14', { title: 'Parent', messageCount: 1 });

        const result = await createChildSession(store, 'parent-14', { agentName: 'coder' });
        expect(result.meta.type).toBe('session_meta');
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('getSessionLineage', () => {
    test('单层 fork 返回两级 lineage', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-1', { title: 'Parent', messageCount: 3 });
        const forkResult = await forkSession(store, 'parent-1');

        const lineage = await getSessionLineage(store, forkResult.sessionId);
        expect(lineage.length).toBe(2);
        expect(lineage[0].sessionId).toBe('parent-1');
        expect(lineage[1].sessionId).toBe(forkResult.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('多层 fork 返回完整祖先链', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'level-1', { title: 'Level 1', messageCount: 2 });
        const level2 = await forkSession(store, 'level-1');
        const level3 = await forkSession(store, level2.sessionId);

        const lineage = await getSessionLineage(store, level3.sessionId);
        expect(lineage.length).toBe(3);
        expect(lineage[0].sessionId).toBe('level-1');
        expect(lineage[1].sessionId).toBe(level2.sessionId);
        expect(lineage[2].sessionId).toBe(level3.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('lineage 包含 title 和 isSubAgent 信息', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-2', { title: 'Parent Session', messageCount: 2 });
        const childResult = await createChildSession(store, 'parent-2', { agentName: 'coder' });

        const lineage = await getSessionLineage(store, childResult.sessionId);
        expect(lineage.length).toBe(2);
        expect(lineage[0].title).toBe('Parent Session');
        expect(lineage[0].isSubAgent).toBe(false);
        expect(lineage[1].isSubAgent).toBe(true);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话链通过 parentSession 追溯', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'root-1', { title: 'Root', messageCount: 2 });
        const child1 = await createChildSession(store, 'root-1', { agentName: 'coder' });
        const child2 = await createChildSession(store, child1.sessionId, { agentName: 'tester' });

        const lineage = await getSessionLineage(store, child2.sessionId);
        expect(lineage.length).toBe(3);
        expect(lineage[0].sessionId).toBe('root-1');
        expect(lineage[1].sessionId).toBe(child1.sessionId);
        expect(lineage[2].sessionId).toBe(child2.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('根会话只返回一级', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'root-2', { title: 'Root Session', messageCount: 2 });

        const lineage = await getSessionLineage(store, 'root-2');
        expect(lineage.length).toBe(1);
        expect(lineage[0].sessionId).toBe('root-2');
        expect(lineage[0].title).toBe('Root Session');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('循环检测防止无限循环', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await store.appendMeta('cycle-1', {
          title: 'S1',
          forkedFrom: 'cycle-2',
          createdAt: Date.now(),
        });
        await store.appendMeta('cycle-2', {
          title: 'S2',
          forkedFrom: 'cycle-1',
          createdAt: Date.now(),
        });
        await store.flush();

        const lineage = await getSessionLineage(store, 'cycle-1');
        expect(lineage.length).toBeLessThanOrEqual(2);
        expect(lineage[lineage.length - 1].sessionId).toBe('cycle-1');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('不存在的会话返回空数组', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        const lineage = await getSessionLineage(store, 'nonexistent');
        expect(lineage).toEqual([]);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('lineage 顺序从祖先到后代', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'ancestor', { title: 'Ancestor', messageCount: 1 });
        const mid = await forkSession(store, 'ancestor');
        const descendant = await forkSession(store, mid.sessionId);

        const lineage = await getSessionLineage(store, descendant.sessionId);
        expect(lineage[0].sessionId).toBe('ancestor');
        expect(lineage[lineage.length - 1].sessionId).toBe(descendant.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('混合 fork 和 child 会话的 lineage', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'original', { title: 'Original', messageCount: 2 });
        const forked = await forkSession(store, 'original');
        const child = await createChildSession(store, forked.sessionId, { agentName: 'coder' });

        const lineage = await getSessionLineage(store, child.sessionId);
        expect(lineage.length).toBe(3);
        expect(lineage[0].sessionId).toBe('original');
        expect(lineage[1].sessionId).toBe(forked.sessionId);
        expect(lineage[2].sessionId).toBe(child.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('lineage 中每个元素都有 sessionId, title, isSubAgent', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'root-3', { title: 'Root', messageCount: 1 });
        const child = await createChildSession(store, 'root-3', { agentName: 'coder' });

        const lineage = await getSessionLineage(store, child.sessionId);
        for (const item of lineage) {
          expect(item).toHaveProperty('sessionId');
          expect(item).toHaveProperty('title');
          expect(item).toHaveProperty('isSubAgent');
        }
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('未命名会话显示默认标题', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await store.appendMeta('unnamed-lineage', { title: '', createdAt: Date.now() });
        await store.flush();

        const lineage = await getSessionLineage(store, 'unnamed-lineage');
        expect(lineage[0].title).toBe('未命名会话');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('多级子会话 lineage 正确', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'top', { title: 'Top', messageCount: 1 });
        const l1 = await createChildSession(store, 'top', { agentName: 'l1' });
        const l2 = await createChildSession(store, l1.sessionId, { agentName: 'l2' });
        const l3 = await createChildSession(store, l2.sessionId, { agentName: 'l3' });

        const lineage = await getSessionLineage(store, l3.sessionId);
        expect(lineage.length).toBe(4);
        expect(lineage[0].sessionId).toBe('top');
        expect(lineage[3].sessionId).toBe(l3.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('listChildSessions', () => {
    test('列出某个会话的所有子会话', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-1', { title: 'Parent', messageCount: 2 });
        const child1 = await createChildSession(store, 'parent-1', { agentName: 'coder' });
        const child2 = await createChildSession(store, 'parent-1', { agentName: 'tester' });
        await store.flush();

        const children = await listChildSessions(store, 'parent-1');
        expect(children.length).toBe(2);
        const childIds = children.map((c) => c.sessionId).sort();
        expect(childIds).toEqual([child1.sessionId, child2.sessionId].sort());
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('无子会话时返回空数组', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-2', { title: 'Parent', messageCount: 2 });
        await store.flush();

        const children = await listChildSessions(store, 'parent-2');
        expect(children).toEqual([]);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话对象包含预期字段', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-3', { title: 'Parent', messageCount: 2 });
        await createChildSession(store, 'parent-3', {
          agentName: 'coder',
          task: 'Test task',
        });
        await store.flush();

        const children = await listChildSessions(store, 'parent-3');
        expect(children.length).toBe(1);
        const child = children[0];
        expect(child.sessionId).toBeDefined();
        expect(child.title).toBeDefined();
        expect(child.isSubAgent).toBe(true);
        expect(child.agentName).toBe('coder');
        expect(child.createdAt).toBeDefined();
        expect(child.updatedAt).toBeDefined();
        expect(child.status).toBeDefined();
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('fork 会话不算作子会话', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-4', { title: 'Parent', messageCount: 2 });
        await forkSession(store, 'parent-4');
        await store.flush();

        const children = await listChildSessions(store, 'parent-4');
        expect(children.length).toBe(0);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话按 createdAt 降序排列', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-5', { title: 'Parent', messageCount: 2 });
        const child1 = await createChildSession(store, 'parent-5', { agentName: 'first' });
        await new Promise((r) => setTimeout(r, 20));
        const child2 = await createChildSession(store, 'parent-5', { agentName: 'second' });
        await store.flush();

        const children = await listChildSessions(store, 'parent-5');
        expect(children.length).toBe(2);
        expect(children[0].sessionId).toBe(child2.sessionId);
        expect(children[1].sessionId).toBe(child1.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('没有任何会话时返回空数组', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        const children = await listChildSessions(store, 'nonexistent-parent');
        expect(children).toEqual([]);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('只返回直接子会话，不返回孙会话', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'grandparent', { title: 'Grandparent', messageCount: 1 });
        const child = await createChildSession(store, 'grandparent', { agentName: 'child' });
        await createChildSession(store, child.sessionId, { agentName: 'grandchild' });
        await store.flush();

        const children = await listChildSessions(store, 'grandparent');
        expect(children.length).toBe(1);
        expect(children[0].sessionId).toBe(child.sessionId);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话状态正确', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-6', { title: 'Parent', messageCount: 1 });
        await createChildSession(store, 'parent-6', { agentName: 'coder' });
        await store.flush();

        const children = await listChildSessions(store, 'parent-6');
        expect(children[0].status).toBe('running');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('多个父会话的子会话互不干扰', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-a', { title: 'Parent A', messageCount: 1 });
        await createTestSession(store, 'parent-b', { title: 'Parent B', messageCount: 1 });
        await createChildSession(store, 'parent-a', { agentName: 'a1' });
        await createChildSession(store, 'parent-a', { agentName: 'a2' });
        await createChildSession(store, 'parent-b', { agentName: 'b1' });
        await store.flush();

        const childrenA = await listChildSessions(store, 'parent-a');
        const childrenB = await listChildSessions(store, 'parent-b');
        expect(childrenA.length).toBe(2);
        expect(childrenB.length).toBe(1);
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('子会话标题正确', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        await createTestSession(store, 'parent-7', { title: 'Parent', messageCount: 1 });
        await createChildSession(store, 'parent-7', {
          agentName: 'coder',
          task: 'Fix bug',
        });
        await store.flush();

        const children = await listChildSessions(store, 'parent-7');
        expect(children[0].title).toContain('Fix bug');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    test('空 sessions 目录返回空数组', async () => {
      const tempDir = createTempDir();
      try {
        const store = createStore(tempDir);
        const sessionsDir = store.getSessionsDir();
        fs.mkdirSync(sessionsDir, { recursive: true });

        const children = await listChildSessions(store, 'any-parent');
        expect(children).toEqual([]);
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });
});
