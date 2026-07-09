import { describe, expect, test, beforeEach, afterEach } from 'bun:test';

const mockLocalStorage = (() => {
  let store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      const keys = Array.from(store.keys());
      return keys[index] || null;
    },
    get length() {
      return store.size;
    },
    _clear() {
      store.clear();
    },
    _getStore() {
      return store;
    },
  };
})();

const mockElectronAPI = (() => {
  let invocations = [];
  let handlers = {};
  let enabled = false;
  return {
    invoke(channel, ...args) {
      invocations.push({ channel, args });
      const handler = handlers[channel];
      if (handler) {
        return Promise.resolve(handler(...args));
      }
      return Promise.resolve(null);
    },
    connect() {
      return Promise.resolve({ version: 'test' });
    },
    _invocations: invocations,
    _handlers: handlers,
    _setHandler(channel, fn) {
      handlers[channel] = fn;
    },
    _clearInvocations() {
      invocations.length = 0;
    },
    _clearHandlers() {
      handlers = {};
    },
    _enabled: enabled,
    _setEnabled(val) {
      enabled = val;
    },
    get isEnabled() {
      return enabled;
    },
  };
})();

const listeners = new Map();
const mockWindow = {
  get localStorage() {
    return mockLocalStorage;
  },
  get electronAPI() {
    return mockElectronAPI.isEnabled ? mockElectronAPI : null;
  },
  dispatchEvent(event) {
    const list = listeners.get(event.type) || [];
    list.forEach((cb) => cb(event));
    return true;
  },
  addEventListener(type, callback) {
    if (!listeners.has(type)) {
      listeners.set(type, []);
    }
    listeners.get(type).push(callback);
  },
  removeEventListener(type, callback) {
    const list = listeners.get(type) || [];
    const idx = list.indexOf(callback);
    if (idx >= 0) list.splice(idx, 1);
  },
  CustomEvent: globalThis.CustomEvent || class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  },
  innerWidth: 1024,
  location: { href: 'about:blank', protocol: 'about:', origin: 'null' },
  navigator: { userAgent: 'TestAgent' },
  _listeners: listeners,
};

globalThis.window = mockWindow;
globalThis.localStorage = mockLocalStorage;
globalThis.CustomEvent = mockWindow.CustomEvent;

let sessionStorageModule;

beforeEach(async () => {
  mockLocalStorage._clear();
  mockElectronAPI._clearInvocations();
  mockElectronAPI._clearHandlers();
  mockElectronAPI._setEnabled(false);
  listeners.clear();
  if (!sessionStorageModule) {
    sessionStorageModule = await import('../../desktop/renderer/app/session/session-storage.js');
  }
});

afterEach(() => {
  mockLocalStorage._clear();
  mockElectronAPI._clearInvocations();
  mockElectronAPI._clearHandlers();
  mockElectronAPI._setEnabled(false);
  listeners.clear();
});

function setupIPCMode() {
  mockElectronAPI._setEnabled(true);
}

function setupLocalStorageMode() {
  mockElectronAPI._setEnabled(false);
}

describe('session-storage dual mode', () => {
  describe('localStorage mode (no electronAPI)', () => {
    beforeEach(() => {
      setupLocalStorageMode();
    });

    test('空 localStorage 返回空数组', async () => {
      const { readAgentSessions } = sessionStorageModule;
      const sessions = await readAgentSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBe(0);
    });

    test('saveAgentSession 写入 localStorage', async () => {
      const { saveAgentSession, AGENT_SESSIONS_STORAGE_KEY } = sessionStorageModule;
      const session = { id: 'session_1', title: 'Test Session', messages: [] };
      await saveAgentSession(session);
      const raw = mockLocalStorage.getItem(AGENT_SESSIONS_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].id).toBe('session_1');
      expect(parsed[0].title).toBe('Test Session');
    });

    test('readAgentSessions 从 localStorage 读取', async () => {
      const { saveAgentSession, readAgentSessions } = sessionStorageModule;
      await saveAgentSession({ id: 's1', title: 'A' });
      await saveAgentSession({ id: 's2', title: 'B' });
      const sessions = await readAgentSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0].id).toBe('s2');
      expect(sessions[1].id).toBe('s1');
    });

    test('readAgentSession 读取单个会话', async () => {
      const { saveAgentSession, readAgentSession } = sessionStorageModule;
      await saveAgentSession({ id: 'target', title: 'Target Session' });
      const session = await readAgentSession('target');
      expect(session).toBeTruthy();
      expect(session.id).toBe('target');
      expect(session.title).toBe('Target Session');
    });

    test('readAgentSession 不存在返回 null', async () => {
      const { readAgentSession } = sessionStorageModule;
      const session = await readAgentSession('nonexistent');
      expect(session).toBeNull();
    });

    test('readAgentSession 空 sessionId 返回 null', async () => {
      const { readAgentSession } = sessionStorageModule;
      expect(await readAgentSession(null)).toBeNull();
      expect(await readAgentSession('')).toBeNull();
      expect(await readAgentSession(undefined)).toBeNull();
    });

    test('deleteAgentSession 从 localStorage 删除', async () => {
      const { saveAgentSession, deleteAgentSession, readAgentSessions } = sessionStorageModule;
      await saveAgentSession({ id: 's1', title: 'A' });
      await saveAgentSession({ id: 's2', title: 'B' });
      await deleteAgentSession('s1');
      const sessions = await readAgentSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('s2');
    });

    test('renameAgentSession 更新 localStorage', async () => {
      const { saveAgentSession, renameAgentSession, readAgentSession } = sessionStorageModule;
      await saveAgentSession({ id: 's1', title: 'Old Title' });
      const before = Date.now();
      await renameAgentSession('s1', 'New Title');
      const after = Date.now();
      const session = await readAgentSession('s1');
      expect(session.title).toBe('New Title');
      expect(session.updatedAt).toBeGreaterThanOrEqual(before);
      expect(session.updatedAt).toBeLessThanOrEqual(after + 1);
    });
  });

  describe('IPC mode (with electronAPI)', () => {
    beforeEach(() => {
      setupIPCMode();
    });

    test('readAgentSessions 调用 invoke("session:list")', async () => {
      const { readAgentSessions } = sessionStorageModule;
      const mockSessions = [{ id: 'ipc1', title: 'IPC Session' }];
      mockElectronAPI._setHandler('session:list', () => ({ sessions: mockSessions }));
      const sessions = await readAgentSessions({ limit: 10 });
      const listCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:list');
      expect(listCall).toBeTruthy();
      expect(listCall.args[0]).toEqual({ limit: 10 });
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('ipc1');
    });

    test('readAgentSessions 失败时回退到 localStorage', async () => {
      const { saveAgentSession, readAgentSessions } = sessionStorageModule;
      await saveAgentSession({ id: 'local1', title: 'Local Session' });
      mockElectronAPI._setHandler('session:list', () => {
        throw new Error('IPC failed');
      });
      const sessions = await readAgentSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('local1');
    });

    test('readAgentSession 调用 invoke("session:load") 和 "session:meta"', async () => {
      const { readAgentSession } = sessionStorageModule;
      mockElectronAPI._setHandler('session:load', ({ sessionId }) => ({ id: sessionId, title: 'Loaded', messages: [] }));
      mockElectronAPI._setHandler('session:meta', ({ sessionId }) => ({ id: sessionId, extra: 'meta' }));
      const session = await readAgentSession('ipc-session');
      const loadCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:load');
      const metaCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:meta');
      expect(loadCall).toBeTruthy();
      expect(metaCall).toBeTruthy();
      expect(loadCall.args[0].sessionId).toBe('ipc-session');
      expect(session).toBeTruthy();
      expect(session.id).toBe('ipc-session');
      expect(session.title).toBe('Loaded');
      expect(session.extra).toBe('meta');
    });

    test('readAgentSession IPC 返回 null 时返回 null', async () => {
      const { saveAgentSession, readAgentSession } = sessionStorageModule;
      await saveAgentSession({ id: 'local-session', title: 'Local' });
      mockElectronAPI._setHandler('session:load', () => null);
      mockElectronAPI._setHandler('session:meta', () => null);
      const session = await readAgentSession('local-session');
      expect(session).toBeNull();
    });

    test('readAgentSession session:load 失败被 catch 住', async () => {
      const { saveAgentSession, readAgentSession } = sessionStorageModule;
      await saveAgentSession({ id: 'local-session', title: 'Local' });
      mockElectronAPI._setHandler('session:load', () => {
        throw new Error('IPC failed');
      });
      mockElectronAPI._setHandler('session:meta', () => ({ extra: 'meta' }));
      const session = await readAgentSession('local-session');
      expect(session).toBeNull();
    });

    test('deleteAgentSession 调用 invoke("session:delete")', async () => {
      const { saveAgentSession, deleteAgentSession } = sessionStorageModule;
      await saveAgentSession({ id: 'del-session', title: 'To Delete' });
      mockElectronAPI._clearInvocations();
      await deleteAgentSession('del-session');
      const deleteCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:delete');
      expect(deleteCall).toBeTruthy();
      expect(deleteCall.args[0].sessionId).toBe('del-session');
    });

    test('renameAgentSession 调用 invoke("session:rename")', async () => {
      const { saveAgentSession, renameAgentSession } = sessionStorageModule;
      await saveAgentSession({ id: 'ren-session', title: 'Old' });
      mockElectronAPI._clearInvocations();
      await renameAgentSession('ren-session', 'New Title');
      const renameCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:rename');
      expect(renameCall).toBeTruthy();
      expect(renameCall.args[0].sessionId).toBe('ren-session');
      expect(renameCall.args[0].title).toBe('New Title');
    });

    test('forkAgentSession 调用 invoke("session:fork")', async () => {
      const { forkAgentSession } = sessionStorageModule;
      const expectedResult = { sessionId: 'forked-id', meta: { id: 'forked-id', title: 'Forked' } };
      mockElectronAPI._setHandler('session:fork', () => expectedResult);
      const result = await forkAgentSession('source-id', { extra: 'opt' });
      const forkCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:fork');
      expect(forkCall).toBeTruthy();
      expect(forkCall.args[0].sessionId).toBe('source-id');
      expect(forkCall.args[0].extra).toBe('opt');
      expect(result).toEqual(expectedResult);
    });

    test('searchAgentSessions 调用 invoke("session:search")', async () => {
      const { searchAgentSessions } = sessionStorageModule;
      const mockResults = [{ id: 'r1', title: 'Result 1' }];
      mockElectronAPI._setHandler('session:search', () => ({ sessions: mockResults }));
      const results = await searchAgentSessions('test query', 15);
      const searchCall = mockElectronAPI._invocations.find((c) => c.channel === 'session:search');
      expect(searchCall).toBeTruthy();
      expect(searchCall.args[0].query).toBe('test query');
      expect(searchCall.args[0].limit).toBe(15);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('r1');
    });

    test('searchAgentSessions 失败时回退到 localStorage', async () => {
      const { saveAgentSession, searchAgentSessions } = sessionStorageModule;
      await saveAgentSession({ id: 's1', title: 'Hello World' });
      await saveAgentSession({ id: 's2', title: 'Other' });
      mockElectronAPI._setHandler('session:search', () => {
        throw new Error('IPC failed');
      });
      const results = await searchAgentSessions('hello');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('s1');
    });
  });

  describe('历史记录 (localStorage 始终)', () => {
    test('saveAgentInputHistory 总是用 localStorage - 无 electronAPI', async () => {
      setupLocalStorageMode();
      const { saveAgentInputHistory, AGENT_HISTORY_STORAGE_KEY } = sessionStorageModule;
      await saveAgentInputHistory('test input', 'sess1');
      const raw = mockLocalStorage.getItem(AGENT_HISTORY_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].input).toBe('test input');
      expect(parsed[0].sessionId).toBe('sess1');
    });

    test('readAgentHistory 总是用 localStorage - 无 electronAPI', async () => {
      setupLocalStorageMode();
      const { saveAgentInputHistory, readAgentHistory } = sessionStorageModule;
      await saveAgentInputHistory('input 1', 's1');
      await saveAgentInputHistory('input 2', 's2');
      const history = readAgentHistory();
      expect(history.length).toBe(2);
      expect(history[0].input).toBe('input 2');
      expect(history[1].input).toBe('input 1');
    });

    test('saveAgentInputHistory 总是用 localStorage - 有 electronAPI', async () => {
      setupIPCMode();
      const { saveAgentInputHistory, AGENT_HISTORY_STORAGE_KEY } = sessionStorageModule;
      await saveAgentInputHistory('ipc mode input', 'sess-ipc');
      const raw = mockLocalStorage.getItem(AGENT_HISTORY_STORAGE_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(parsed.length).toBe(1);
      expect(parsed[0].input).toBe('ipc mode input');
      const hasHistoryInvoke = mockElectronAPI._invocations.some((c) => c.channel.startsWith('history:'));
      expect(hasHistoryInvoke).toBe(false);
    });

    test('readAgentHistory 总是用 localStorage - 有 electronAPI', async () => {
      setupIPCMode();
      const { saveAgentInputHistory, readAgentHistory } = sessionStorageModule;
      await saveAgentInputHistory('history in ipc mode', 's-x');
      const history = readAgentHistory();
      expect(history.length).toBe(1);
      expect(history[0].input).toBe('history in ipc mode');
    });
  });

  describe('数据迁移', () => {
    test('migrateLocalStorageSessions 无 electronAPI 时返回 skipped', async () => {
      setupLocalStorageMode();
      const { saveAgentSession, migrateLocalStorageSessions } = sessionStorageModule;
      await saveAgentSession({ id: 'm1', title: 'Migrate 1' });
      await saveAgentSession({ id: 'm2', title: 'Migrate 2' });
      const result = await migrateLocalStorageSessions();
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.reason).toBe('no-ipc');
    });

    test('migrateLocalStorageSessions 有 electronAPI 时调用 session:create', async () => {
      setupIPCMode();
      const { saveAgentSession, migrateLocalStorageSessions } = sessionStorageModule;
      await saveAgentSession({ id: 'mig1', title: 'Mig 1' });
      await saveAgentSession({ id: 'mig2', title: 'Mig 2' });
      let createCount = 0;
      mockElectronAPI._setHandler('session:create', (session) => {
        createCount++;
        return { id: session.id };
      });
      const result = await migrateLocalStorageSessions();
      expect(result.migrated).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
      expect(createCount).toBe(2);
      const createCalls = mockElectronAPI._invocations.filter((c) => c.channel === 'session:create');
      expect(createCalls.length).toBe(2);
    });

    test('migrateLocalStorageSessions counts existing sessions as skipped', async () => {
      setupIPCMode();
      const { saveAgentSession, migrateLocalStorageSessions } = sessionStorageModule;
      await saveAgentSession({ id: 'existing1', title: 'Existing 1' });
      await saveAgentSession({ id: 'new1', title: 'New 1' });
      mockElectronAPI._setHandler('session:create', (session) => {
        if (session.id === 'existing1') {
          return { success: true, sessionId: session.id, skipped: true };
        }
        return { success: true, sessionId: session.id };
      });
      const result = await migrateLocalStorageSessions();
      expect(result.migrated).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
    });


    test('migrateLocalStorageSessions 迁移统计正确 - 部分失败', async () => {
      setupIPCMode();
      const { saveAgentSession, migrateLocalStorageSessions } = sessionStorageModule;
      await saveAgentSession({ id: 'good1', title: 'Good 1' });
      await saveAgentSession({ id: 'bad1', title: 'Bad 1' });
      await saveAgentSession({ id: 'good2', title: 'Good 2' });
      mockElectronAPI._setHandler('session:create', (session) => {
        if (session.id === 'bad1') {
          throw new Error('fail');
        }
        return { id: session.id };
      });
      const result = await migrateLocalStorageSessions();
      expect(result.migrated).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(3);
    });

    test('migrateLocalStorageSessions 空 localStorage 返回 0', async () => {
      setupIPCMode();
      const { migrateLocalStorageSessions } = sessionStorageModule;
      const result = await migrateLocalStorageSessions();
      expect(result.migrated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
    });
  });
});
