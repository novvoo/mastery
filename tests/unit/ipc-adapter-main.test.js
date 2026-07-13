import { describe, expect, test } from 'bun:test';
import { MainProcessIPCAdapter } from '../../src/adapters/desktop/ipc/main-process-adapter.js';
import { IPCMessageType, IPCMessage } from '../../src/adapters/desktop/protocol/ipc-protocol.js';

/**
 * Build a mock ipcMain that simulates Electron's ipcMain module.
 * Tracks handlers (handle), listeners (on), and per-window outboxes.
 */
function mockIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  const windows = new Map();
  let nextWindowId = 1;

  const api = {
    handle: (channel, fn) => { handlers.set(channel, fn); },
    on: (channel, cb) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
    },
    // Simulate a new renderer window connecting
    _addWindow: () => {
      const id = nextWindowId++;
      const outbox = [];
      const sender = {
        id,
        send: (channel, ...args) => { outbox.push({ channel, args }); },
      };
      windows.set(id, { sender, id, outbox });
      return { id, sender, outbox };
    },
    // Simulate main process receiving a message from a window
    // Returns the handler's result for handle()-style, awaits listeners
    _receiveFromWindow: async (windowId, channel, ...args) => {
      const win = windows.get(windowId);
      if (!win) return;
      const event = { sender: win.sender };
      const handler = handlers.get(channel);
      if (handler) return handler(event, ...args);
      const cbs = listeners.get(channel);
      if (cbs) {
        for (const cb of cbs) await cb(event, ...args);
      }
    },
    // Get messages sent TO a specific window
    _getWindowMessages: (windowId) => {
      return windows.get(windowId)?.outbox || [];
    },
    // Simulate a renderer connecting (triggers CONNECT handler)
    _connectWindow: async (windowId) => {
      const win = windows.get(windowId);
      if (!win) return;
      return api._receiveFromWindow(windowId, IPCMessageType.CONNECT);
    },
  };
  return api;
}

// Shared stub eventBus for tests that don't need real events
function stubEventBus() {
  return { subscribe: () => () => {}, emit: () => {} };
}

describe('MainProcessIPCAdapter — constructor', () => {
  test('constructs with ipcMain and eventBus', () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    expect(adapter).toBeDefined();
    expect(adapter.isConnected).toBe(false);
  });

  test('accepts custom config', () => {
    const ipcMain = mockIpcMain();
    const eventBus = stubEventBus();
    const adapter = new MainProcessIPCAdapter(ipcMain, eventBus, {
      debug: true, requestTimeout: 5000,
    });
    expect(adapter.config.debug).toBe(true);
    expect(adapter.config.requestTimeout).toBe(5000);
  });
});

describe('MainProcessIPCAdapter — initialize', () => {
  test('initialize registers IPC handlers and sets connected', async () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    await adapter.initialize();
    expect(adapter.isConnected).toBe(true);
    // CONNECT handler should be registered
    const win = ipcMain._addWindow();
    const result = await ipcMain._receiveFromWindow(win.id, IPCMessageType.CONNECT);
    expect(result.success).toBe(true);
  });

  test('initialize is idempotent', async () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    await adapter.initialize();
    await adapter.initialize(); // second call: no duplicate registration crash
    expect(adapter.isConnected).toBe(true);
  });
});

describe('MainProcessIPCAdapter — broadcast to windows', () => {
  test('broadcast sends event to all connected windows', async () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    await adapter.initialize();

    // Connect two windows
    const win1 = ipcMain._addWindow();
    const win2 = ipcMain._addWindow();
    await ipcMain._connectWindow(win1.id);
    await ipcMain._connectWindow(win2.id);

    adapter.broadcast('runtime:status', { status: 'ready' });

    const msgs1 = ipcMain._getWindowMessages(win1.id);
    const msgs2 = ipcMain._getWindowMessages(win2.id);
    // Each window should receive at least one EVENT message
    const evt1 = msgs1.find((m) => m.channel === IPCMessageType.EVENT);
    const evt2 = msgs2.find((m) => m.channel === IPCMessageType.EVENT);
    expect(evt1).toBeDefined();
    expect(evt2).toBeDefined();
    if (evt1) {
      const payload = evt1.args[0];
      expect(payload.metadata.eventName).toBe('runtime:status');
    }
  });
});

describe('MainProcessIPCAdapter — request/response flow', () => {
  test('handle REQUEST processes and sends RESPONSE to window', async () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());

    const mockEngine = {
      processInput: async () => ({ answer: 'done' }),
      getState: () => ({ status: 'ready' }),
      getConfig: () => ({}),
    };
    adapter.attachEngine(mockEngine);
    await adapter.initialize();

    const win = ipcMain._addWindow();
    await ipcMain._connectWindow(win.id);

    const reqMsg = new IPCMessage(IPCMessageType.REQUEST,
      { input: 'hello world', options: {} },
      { id: 'req-test-1', metadata: { channel: 'agent:processInput' } },
    );

    await ipcMain._receiveFromWindow(win.id, IPCMessageType.REQUEST, reqMsg.toJSON());

    const sent = ipcMain._getWindowMessages(win.id);
    const resp = sent.find((m) => m.channel === IPCMessageType.RESPONSE);
    expect(resp).toBeDefined();
  });

  test('invalid request gets ERROR response', async () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    await adapter.initialize();

    const win = ipcMain._addWindow();
    await ipcMain._connectWindow(win.id);

    // Send a request with an unknown channel
    const badMsg = new IPCMessage(IPCMessageType.REQUEST, {},
      { id: 'bad-req', metadata: { channel: 'unknown:channel' } },
    );

    await ipcMain._receiveFromWindow(win.id, IPCMessageType.REQUEST, badMsg.toJSON());

    const sent = ipcMain._getWindowMessages(win.id);
    const errResp = sent.find((m) => m.channel === IPCMessageType.RESPONSE);
    expect(errResp).toBeDefined();
  });
});

describe('MainProcessIPCAdapter — engine attachment', () => {
  test('attachEngine stores engine ref', () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    adapter.attachEngine({ processInput: async () => {} });
    // no throw = pass
  });

  test('attachDesktopCore stores core ref', () => {
    const ipcMain = mockIpcMain();
    const adapter = new MainProcessIPCAdapter(ipcMain, stubEventBus());
    adapter.attachDesktopCore({ processInput: async () => {} });
    // no throw = pass
  });
});
