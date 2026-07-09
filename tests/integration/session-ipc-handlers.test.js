import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerSessionHandlers } from '../../src/adapters/desktop/ipc/main-process/session-handlers.js';
import { createSessionFileStore } from '../../src/core/session/session-file-store.js';

function createMockIpcAdapter() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    registerHandler(channel, fn) {
      handlers.set(channel, fn);
    },
    on(channel, fn) {
      if (!listeners.has(channel)) {
        listeners.set(channel, []);
      }
      listeners.get(channel).push(fn);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for channel: ${channel}`);
      }
      return await handler(payload);
    },
  };
}

function createTestCtx(tempDir) {
  const ipcAdapter = createMockIpcAdapter();
  const appDataDir = join(tempDir, 'app-data');
  const sessionStore = createSessionFileStore({ appDataDir, debounceMs: 10 });
  return {
    ipcAdapter,
    electron: {
      app: {},
    },
    config: {
      workingDirectory: join(tempDir, 'test-project'),
    },
    sessionStore,
  };
}

async function createTestSession(ctx, sessionId, title, messages = []) {
  const store = ctx.sessionStore;
  const wd = ctx.config.workingDirectory;
  const now = Date.now();

  await store.appendMeta(
    sessionId,
    {
      sessionId,
      title,
      createdAt: now,
      updatedAt: now,
      workingDirectory: wd,
      status: 'completed',
    },
    wd,
  );

  for (const msg of messages) {
    await store.appendMessage(sessionId, msg, wd);
  }

  await store.flush();
  return sessionId;
}

describe('Session IPC Handlers', () => {
  let tempDir;
  let ctx;
  let ipc;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-ipc-test-'));
    ctx = createTestCtx(tempDir);
    ipc = ctx.ipcAdapter;
    registerSessionHandlers(ctx);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Setup', () => {
    test('registers all 12 session handlers', () => {
      const expectedChannels = [
        'session:list',
        'session:load',
        'session:meta',
        'session:delete',
        'session:rename',
        'session:fork',
        'session:search',
        'session:preview',
        'session:lineage',
        'session:children',
        'session:count',
        'session:create',
      ];

      for (const channel of expectedChannels) {
        expect(ipc.handlers.has(channel)).toBe(true);
      }
    });

    test('creates sessionStore on ctx', () => {
      expect(ctx.sessionStore).toBeDefined();
      expect(typeof ctx.sessionStore.appendMeta).toBe('function');
    });
  });

  describe('session:list', () => {
    test('returns empty array and total=0 when no sessions exist', async () => {
      const result = await ipc.invoke('session:list', {});

      expect(result.success).toBe(true);
      expect(result.sessions).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('lists created sessions', async () => {
      await createTestSession(ctx, 'sess-1', 'First Session');
      await createTestSession(ctx, 'sess-2', 'Second Session');

      const result = await ipc.invoke('session:list', {});

      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.sessions.length).toBe(2);
      const titles = result.sessions.map((s) => s.title).sort();
      expect(titles).toEqual(['First Session', 'Second Session']);
    });

    test('supports limit and offset pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestSession(ctx, `sess-${i}`, `Session ${i}`);
      }

      const page1 = await ipc.invoke('session:list', { limit: 2, offset: 0 });
      expect(page1.success).toBe(true);
      expect(page1.sessions.length).toBe(2);
      expect(page1.total).toBe(5);

      const page2 = await ipc.invoke('session:list', { limit: 2, offset: 2 });
      expect(page2.success).toBe(true);
      expect(page2.sessions.length).toBe(2);

      const page3 = await ipc.invoke('session:list', { limit: 2, offset: 4 });
      expect(page3.success).toBe(true);
      expect(page3.sessions.length).toBe(1);
    });
  });

  describe('session:load', () => {
    test('loads an existing session with full data', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      await createTestSession(ctx, 'sess-load', 'Load Test', messages);

      const result = await ipc.invoke('session:load', { sessionId: 'sess-load' });

      expect(result.success).toBe(true);
      expect(result.id).toBe('sess-load');
      expect(result.title).toBe('Load Test');
      expect(result.messages.length).toBe(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.status).toBeDefined();
    });

    test('returns success:false for non-existent session', async () => {
      const result = await ipc.invoke('session:load', { sessionId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('session:meta', () => {
    test('gets meta for existing session', async () => {
      await createTestSession(ctx, 'sess-meta', 'Meta Test');

      const result = await ipc.invoke('session:meta', { sessionId: 'sess-meta' });

      expect(result.success).toBe(true);
      expect(result.id).toBe('sess-meta');
      expect(result.title).toBe('Meta Test');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.messageCount).toBeDefined();
    });

    test('returns success:false for non-existent session meta', async () => {
      const result = await ipc.invoke('session:meta', { sessionId: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('session:delete', () => {
    test('deletes an existing session and returns success:true', async () => {
      await createTestSession(ctx, 'sess-delete', 'Delete Me');

      const before = await ipc.invoke('session:list', {});
      expect(before.total).toBe(1);

      const result = await ipc.invoke('session:delete', { sessionId: 'sess-delete' });
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);

      const after = await ipc.invoke('session:list', {});
      expect(after.total).toBe(0);
    });

    test('session not found in list after deletion', async () => {
      await createTestSession(ctx, 'sess-gone', 'Gone Soon');

      await ipc.invoke('session:delete', { sessionId: 'sess-gone' });

      const listResult = await ipc.invoke('session:list', {});
      const ids = listResult.sessions.map((s) => s.id);
      expect(ids).not.toContain('sess-gone');
    });
  });

  describe('session:rename', () => {
    test('renames a session and updates meta', async () => {
      await createTestSession(ctx, 'sess-rename', 'Old Title');

      const renameResult = await ipc.invoke('session:rename', {
        sessionId: 'sess-rename',
        title: 'New Title',
      });
      expect(renameResult.success).toBe(true);

      const metaResult = await ipc.invoke('session:meta', { sessionId: 'sess-rename' });
      expect(metaResult.title).toBe('New Title');
    });
  });

  describe('session:fork', () => {
    test('forks a session and returns new sessionId and meta', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      await createTestSession(ctx, 'sess-original', 'Original', messages);

      const result = await ipc.invoke('session:fork', { sessionId: 'sess-original' });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).not.toBe('sess-original');
      expect(result.meta).toBeDefined();
      expect(result.meta.title).toContain('副本');
      expect(result.meta.forkedFrom).toBe('sess-original');
    });

    test('forked session has forkedFrom field', async () => {
      await createTestSession(ctx, 'sess-parent', 'Parent');

      const forkResult = await ipc.invoke('session:fork', {
        sessionId: 'sess-parent',
        newTitle: 'Forked Child',
      });

      const metaResult = await ipc.invoke('session:meta', { sessionId: forkResult.sessionId });
      expect(metaResult.forkedFrom).toBe('sess-parent');
      expect(metaResult.title).toBe('Forked Child');
    });
  });

  describe('session:search', () => {
    test('searches sessions by matching title', async () => {
      await createTestSession(ctx, 'sess-1', 'React Project');
      await createTestSession(ctx, 'sess-2', 'Python Script');
      await createTestSession(ctx, 'sess-3', 'React Components');

      const result = await ipc.invoke('session:search', { query: 'React' });

      expect(result.success).toBe(true);
      expect(result.sessions.length).toBe(2);
      const titles = result.sessions.map((s) => s.title).sort();
      expect(titles).toEqual(['React Components', 'React Project']);
    });

    test('returns empty array when no matches', async () => {
      await createTestSession(ctx, 'sess-1', 'Hello World');

      const result = await ipc.invoke('session:search', { query: 'NonexistentTerm' });

      expect(result.success).toBe(true);
      expect(result.sessions).toEqual([]);
    });
  });

  describe('session:preview', () => {
    test('gets preview text for a session', async () => {
      const messages = [{ role: 'user', content: 'This is a test message for preview' }];
      await createTestSession(ctx, 'sess-preview', 'Preview Test', messages);

      const result = await ipc.invoke('session:preview', { sessionId: 'sess-preview' });

      expect(result.success).toBe(true);
      expect(typeof result.preview).toBe('string');
      expect(result.preview.length).toBeGreaterThan(0);
    });
  });

  describe('session:lineage', () => {
    test('normal session returns single-element lineage', async () => {
      await createTestSession(ctx, 'sess-single', 'Single Lineage');

      const result = await ipc.invoke('session:lineage', { sessionId: 'sess-single' });

      expect(result.success).toBe(true);
      expect(result.lineage.length).toBe(1);
      expect(result.lineage[0].sessionId).toBe('sess-single');
    });

    test('forked session returns multi-level lineage', async () => {
      await createTestSession(ctx, 'sess-grandparent', 'Grandparent');

      const fork1 = await ipc.invoke('session:fork', {
        sessionId: 'sess-grandparent',
        newTitle: 'Parent',
      });

      const fork2 = await ipc.invoke('session:fork', {
        sessionId: fork1.sessionId,
        newTitle: 'Child',
      });

      const result = await ipc.invoke('session:lineage', { sessionId: fork2.sessionId });

      expect(result.success).toBe(true);
      expect(result.lineage.length).toBe(3);
      expect(result.lineage[0].sessionId).toBe('sess-grandparent');
      expect(result.lineage[result.lineage.length - 1].sessionId).toBe(fork2.sessionId);
    });
  });

  describe('session:children', () => {
    test('session with no children returns empty array', async () => {
      await createTestSession(ctx, 'sess-childless', 'No Kids');

      const result = await ipc.invoke('session:children', { sessionId: 'sess-childless' });

      expect(result.success).toBe(true);
      expect(result.children).toEqual([]);
    });

    test('lists children after creating forked sessions', async () => {
      await createTestSession(ctx, 'sess-mom', 'Mom');

      await ipc.invoke('session:fork', { sessionId: 'sess-mom', newTitle: 'Child 1' });
      await ipc.invoke('session:fork', { sessionId: 'sess-mom', newTitle: 'Child 2' });

      const result = await ipc.invoke('session:children', { sessionId: 'sess-mom' });

      expect(result.success).toBe(true);
      expect(result.children.length).toBe(2);
    });
  });

  describe('session:create', () => {
    test('does not append duplicate messages when creating an existing session id', async () => {
      const message = { role: 'user', content: 'history dup' };

      const first = await ipc.invoke('session:create', {
        sessionId: 'sess-dup',
        title: 'Duplicate guard',
        messages: [message],
      });
      expect(first.success).toBe(true);
      expect(first.skipped).toBeUndefined();

      const second = await ipc.invoke('session:create', {
        sessionId: 'sess-dup',
        title: 'Duplicate guard',
        messages: [message],
      });
      expect(second.success).toBe(true);
      expect(second.skipped).toBe(true);

      const loaded = await ipc.invoke('session:load', { sessionId: 'sess-dup' });
      expect(loaded.messages).toEqual([message]);
    });
  });

  describe('session:count', () => {
    test('returns correct session count', async () => {
      const result0 = await ipc.invoke('session:count', {});
      expect(result0.success).toBe(true);
      expect(result0.count).toBe(0);

      await createTestSession(ctx, 'sess-a', 'A');
      await createTestSession(ctx, 'sess-b', 'B');

      const result2 = await ipc.invoke('session:count', {});
      expect(result2.success).toBe(true);
      expect(result2.count).toBe(2);
    });
  });
});
