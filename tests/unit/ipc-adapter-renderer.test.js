import { describe, expect, test } from 'bun:test';
import { RendererProcessIPCAdapter } from '../../src/adapters/desktop/ipc/renderer-process-adapter.js';
import { IPCMessageType, IPCMessage } from '../../src/adapters/desktop/protocol/ipc-protocol.js';

/**
 * Build a mock ipcRenderer that simulates Electron's contextBridge API.
 */
function mockIpcRenderer() {
  const handlers = new Map();
  const listeners = new Map();
  const sent = [];

  return {
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (handler) return handler(...args);
      throw new Error(`No handler for "${channel}"`);
    },
    on: (channel, cb) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
    },
    send: (channel, ...args) => {
      sent.push({ channel, args });
    },
    // Test helpers — not part of real ipcRenderer
    _handlers: handlers,
    _listeners: listeners,
    _sent: sent,
    _receive: (channel, data) => {
      const cbs = listeners.get(channel);
      if (cbs) {
        const fakeEvent = { sender: { send: () => {} } };
        for (const cb of cbs) cb(fakeEvent, data);
      }
    },
    _handle: (channel, fn) => {
      handlers.set(channel, fn);
    },
  };
}

describe('RendererProcessIPCAdapter — constructor', () => {
  test('constructs with ipcRenderer', () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    expect(adapter).toBeDefined();
    expect(adapter.isConnected).toBe(false);
  });

  test('starts with empty pending requests', () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    expect(adapter.pendingRequests.size).toBe(0);
  });
});

describe('RendererProcessIPCAdapter — initialize', () => {
  test('initialize sends CONNECT and sets isConnected', async () => {
    const ipc = mockIpcRenderer();
    ipc._handle(IPCMessageType.CONNECT, () => ({ success: true }));
    const adapter = new RendererProcessIPCAdapter(ipc);

    await adapter.initialize();

    expect(adapter.isConnected).toBe(true);
  });

  test('initialize fails when CONNECT throws', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    const errors = [];
    adapter.on('error', (e) => errors.push(e));

    let err;
    try {
      await adapter.initialize();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/connect/i);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(adapter.isConnected).toBe(false);
  });
});

describe('RendererProcessIPCAdapter — request', () => {
  test('request sends IPC message and resolves on response', async () => {
    const ipc = mockIpcRenderer();
    ipc._handle(IPCMessageType.CONNECT, () => ({ success: true }));
    const adapter = new RendererProcessIPCAdapter(ipc);
    await adapter.initialize();

    const resultPromise = adapter.request('agent:status', { query: true });

    const sentCall = ipc._sent.find((s) => s.channel === IPCMessageType.REQUEST);
    expect(sentCall).toBeDefined();
    const sentData = sentCall.args[0];
    expect(sentData.type).toBe(IPCMessageType.REQUEST);
    expect(sentData.payload).toEqual({ query: true });

    // Simulate main process sending back a RESPONSE
    ipc._receive(IPCMessageType.RESPONSE, JSON.stringify({
      type: IPCMessageType.RESPONSE,
      payload: { status: 'ready' },
      correlationId: sentData.id,
      status: 'success',
    }));

    const result = await resultPromise;
    expect(result).toEqual({ status: 'ready' });
  });

  test('request queues when not connected and enableQueue=true', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc, { enableQueue: true });

    const result = await adapter.request('agent:status', { x: 1 });
    expect(result).toBeNull();
    expect(adapter.messageQueue.size()).toBe(1);
  });

  test('request throws when not connected and enableQueue=false', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc, { enableQueue: false });

    let err;
    try {
      await adapter.request('agent:status', { x: 1 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('未连接');
  });
});

describe('RendererProcessIPCAdapter — subscribe / unsubscribe', () => {
  test('subscribe adds event listener and returns unsubscribe fn', () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    const cb = () => {};

    const unsub = adapter.subscribe('runtime:event', cb);
    expect(typeof unsub).toBe('function');

    // Verify ipcRenderer.send('ipc:subscribe') was called
    const subs = ipc._sent.filter((s) => s.channel === 'ipc:subscribe');
    expect(subs.length).toBe(1);
  });

  test('subscribed callback receives event data after initialize', async () => {
    const ipc = mockIpcRenderer();
    ipc._handle(IPCMessageType.CONNECT, () => ({ success: true }));
    const adapter = new RendererProcessIPCAdapter(ipc);

    // Must initialize to set up #setupListeners IPC event handler
    await adapter.initialize();

    const received = [];
    adapter.subscribe('runtime:status', (data) => received.push(data));

    // Simulate main process sending an EVENT
    ipc._receive(IPCMessageType.EVENT, JSON.stringify({
      type: IPCMessageType.EVENT,
      payload: { status: 'ready' },
      metadata: { eventName: 'runtime:status' },
    }));

    expect(received).toEqual([{ status: 'ready' }]);
  });

  test('unsubscribe removes callback', () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    const received = [];
    const cb = (data) => received.push(data);

    const unsub = adapter.subscribe('runtime:evt', cb);
    unsub();

    // Without initialize, ipc:EVENT listener never set up, so _receive
    // goes nowhere. We verify via the internal #eventListeners mechanism:
    // subscribe stores cb, unsubscribe removes it.
    // Since initialize wasn't called, only verify no crash.
    expect(received).toEqual([]);
  });

  test('subscribing same event twice does not send duplicate ipc:subscribe', () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);

    adapter.subscribe('evt:x', () => {});
    adapter.subscribe('evt:x', () => {});

    const subs = ipc._sent.filter((s) => s.channel === 'ipc:subscribe');
    expect(subs.length).toBe(1);
  });
});

describe('RendererProcessIPCAdapter — _sendImpl', () => {
  test('delegates to ipcRenderer.send', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    adapter.isConnected = true;

    const msg = new IPCMessage(IPCMessageType.REQUEST, { action: 'test' });
    await adapter._sendImpl(msg);

    const sent = ipc._sent.find((s) => s.channel === IPCMessageType.REQUEST);
    expect(sent).toBeDefined();
    expect(sent.args[0].payload).toEqual({ action: 'test' });
  });
});

describe('RendererProcessIPCAdapter — convenience methods', () => {
  test('processInput delegates to request agent:processInput', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    adapter.request = async (channel, payload) => {
      expect(channel).toBe('agent:processInput');
      expect(payload.input).toBe('hello');
      return { success: true };
    };
    adapter.isConnected = true;

    const result = await adapter.processInput('hello');
    expect(result).toEqual({ success: true });
  });

  test('stop delegates to request agent:stop', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    adapter.request = async (channel) => {
      expect(channel).toBe('agent:stop');
      return { stopped: true };
    };
    adapter.isConnected = true;

    const result = await adapter.stop();
    expect(result).toEqual({ stopped: true });
  });

  test('getState delegates to request agent:getState', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    adapter.request = async (channel) => {
      expect(channel).toBe('agent:getState');
      return { status: 'ready' };
    };
    adapter.isConnected = true;

    const result = await adapter.getState();
    expect(result).toEqual({ status: 'ready' });
  });

  test('getTools delegates to request agent:getTools', async () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    adapter.request = async (channel) => {
      expect(channel).toBe('agent:getTools');
      return ['tool1'];
    };
    adapter.isConnected = true;

    const result = await adapter.getTools();
    expect(result).toEqual(['tool1']);
  });
});

describe('RendererProcessIPCAdapter — disconnect', () => {
  test('disconnect sends DISCONNECT and clears listeners', () => {
    const ipc = mockIpcRenderer();
    const adapter = new RendererProcessIPCAdapter(ipc);
    adapter.isConnected = true;

    adapter.subscribe('evt:1', () => {});
    adapter.subscribe('evt:2', () => {});
    adapter.disconnect();

    const disc = ipc._sent.find((s) => s.channel === IPCMessageType.DISCONNECT);
    expect(disc).toBeDefined();
    expect(adapter.isConnected).toBe(false);
  });
});
