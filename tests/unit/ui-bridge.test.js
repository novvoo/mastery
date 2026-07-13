import { describe, expect, test } from 'bun:test';
import { UIBridge } from '../../src/adapters/desktop/desktop-core/ui-bridge.js';

describe('UIBridge — constructor & config', () => {
  test('create instance without config', () => {
    const bridge = new UIBridge();
    expect(bridge).toBeDefined();
  });

  test('create instance with config options', () => {
    const bridge = new UIBridge({ maxQueueSize: 5, debug: true });
    expect(bridge).toBeDefined();
  });

  test('initial state: not connected', () => {
    const bridge = new UIBridge();
    expect(bridge.isConnected()).toBe(false);
  });

  test('getIPCAdapter returns null before connect', () => {
    const bridge = new UIBridge();
    expect(bridge.getIPCAdapter()).toBeNull();
  });
});

describe('UIBridge — subscribe / unsubscribe', () => {
  test('subscribe returns unsubscribe function', () => {
    const bridge = new UIBridge();
    const unsub = bridge.subscribe('test:evt', () => {});
    expect(typeof unsub).toBe('function');
  });

  test('subscribed callback fires on onMessage', () => {
    const bridge = new UIBridge();
    const received = [];
    bridge.subscribe('my:evt', (msg) => received.push(msg.data.value));
    bridge.onMessage({ type: 'my:evt', data: { value: 42 } });
    expect(received).toEqual([42]);
  });

  test('unsubscribed callback no longer fires', () => {
    const bridge = new UIBridge();
    const received = [];
    const cb = (msg) => received.push(msg.data.val);
    const unsub = bridge.subscribe('my:evt', cb);
    unsub();
    bridge.onMessage({ type: 'my:evt', data: { val: 99 } });
    expect(received).toEqual([]);
  });

  test('unsubscribe removes only the specified callback', () => {
    const bridge = new UIBridge();
    const received = [];
    const cb1 = () => received.push('first');
    const cb2 = () => received.push('second');

    bridge.subscribe('evt:a', cb1);
    bridge.subscribe('evt:a', cb2);
    bridge.unsubscribe('evt:a', cb1);

    bridge.onMessage({ type: 'evt:a', data: {} });
    expect(received).toEqual(['second']);
  });
});

describe('UIBridge — wildcard listener', () => {
  test('"*" listener receives all messages', () => {
    const bridge = new UIBridge();
    const received = [];
    bridge.subscribe('*', (msg) => received.push(msg.type));
    bridge.onMessage({ type: 'a', data: {} });
    bridge.onMessage({ type: 'b', data: {} });
    expect(received).toEqual(['a', 'b']);
  });

  test('"*" unsubscribable', () => {
    const bridge = new UIBridge();
    const received = [];
    const unsub = bridge.subscribe('*', (msg) => received.push(msg.type));
    unsub();
    bridge.onMessage({ type: 'a', data: {} });
    expect(received).toEqual([]);
  });
});

describe('UIBridge — message queue', () => {
  test('onMessage adds to queue', () => {
    const bridge = new UIBridge();
    bridge.onMessage({ type: 'evt:x', data: { n: 1 } });
    expect(bridge.getMessageQueue()).toHaveLength(1);
  });

  test('getMessageQueue returns copy (not mutable ref)', () => {
    const bridge = new UIBridge();
    bridge.onMessage({ type: 'a', data: {} });
    const q = bridge.getMessageQueue();
    q.push({ type: 'fake' });
    expect(bridge.getMessageQueue()).toHaveLength(1);
  });

  test('clearMessageQueue empties queue', () => {
    const bridge = new UIBridge();
    bridge.onMessage({ type: 'a', data: {} });
    bridge.onMessage({ type: 'b', data: {} });
    bridge.clearMessageQueue();
    expect(bridge.getMessageQueue()).toHaveLength(0);
  });

  test('getLastMessage returns most recent', () => {
    const bridge = new UIBridge();
    bridge.onMessage({ type: 'first', data: {} });
    bridge.onMessage({ type: 'last', data: { key: 'val' } });
    expect(bridge.getLastMessage().type).toBe('last');
    expect(bridge.getLastMessage().data.key).toBe('val');
  });

  test('getLastMessage returns undefined when queue empty', () => {
    const bridge = new UIBridge();
    expect(bridge.getLastMessage()).toBeUndefined();
  });

  test('getMessagesByType filters correctly', () => {
    const bridge = new UIBridge();
    bridge.onMessage({ type: 'a', data: { n: 1 } });
    bridge.onMessage({ type: 'b', data: { n: 2 } });
    bridge.onMessage({ type: 'a', data: { n: 3 } });
    const aMsgs = bridge.getMessagesByType('a');
    expect(aMsgs).toHaveLength(2);
    expect(aMsgs.map((m) => m.data.n)).toEqual([1, 3]);
  });

  test('queue respects maxQueueSize', () => {
    const bridge = new UIBridge({ maxQueueSize: 2 });
    bridge.onMessage({ type: 'a', data: {} });
    bridge.onMessage({ type: 'b', data: {} });
    bridge.onMessage({ type: 'c', data: {} });
    expect(bridge.getMessageQueue()).toHaveLength(2);
    expect(bridge.getMessageQueue()[0].type).toBe('b');
    expect(bridge.getMessageQueue()[1].type).toBe('c');
  });
});

describe('UIBridge — sendToCore without IPC', () => {
  test('sendToCore returns null when no IPC adapter', async () => {
    const bridge = new UIBridge();
    const result = await bridge.sendToCore('test:msg', { data: 1 });
    expect(result).toBeNull();
  });
});

describe('UIBridge — attachCoreRef', () => {
  test('attachCoreRef sets connected state', () => {
    const bridge = new UIBridge();
    const fakeCore = { isReady: () => true };
    bridge.attachCoreRef(fakeCore);
    expect(bridge.isConnected()).toBe(true);
  });

  test('processInput delegates to coreRef', async () => {
    const bridge = new UIBridge();
    const core = { processInput: async (input) => ({ processed: input }) };
    bridge.attachCoreRef(core);
    const result = await bridge.processInput('hello');
    expect(result.processed).toBe('hello');
  });

  test('stop delegates to coreRef', async () => {
    const bridge = new UIBridge();
    let stopped = false;
    const core = { stop: async () => { stopped = true; } };
    bridge.attachCoreRef(core);
    await bridge.stop();
    expect(stopped).toBe(true);
  });

  test('getState delegates to coreRef', () => {
    const bridge = new UIBridge();
    const core = { getState: () => ({ status: 'idle' }) };
    bridge.attachCoreRef(core);
    expect(bridge.getState().status).toBe('idle');
  });

  test('getTools delegates to coreRef', () => {
    const bridge = new UIBridge();
    const core = { getTools: () => ['tool1'] };
    bridge.attachCoreRef(core);
    expect(bridge.getTools()).toEqual(['tool1']);
  });

  test('processInput throws when nothing connected', async () => {
    const bridge = new UIBridge();
    let err;
    try {
      await bridge.processInput('x');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('未连接');
  });

  test('stop throws when nothing connected', async () => {
    const bridge = new UIBridge();
    let err;
    try {
      await bridge.stop();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('未连接');
  });

  test('getState throws when nothing connected', () => {
    const bridge = new UIBridge();
    expect(() => bridge.getState()).toThrow('未连接');
  });

  test('getTools throws when nothing connected', () => {
    const bridge = new UIBridge();
    expect(() => bridge.getTools()).toThrow('未连接');
  });
});

describe('UIBridge — disconnect', () => {
  test('disconnect clears listeners and queue', () => {
    const bridge = new UIBridge();
    let callCount = 0;
    bridge.subscribe('test:evt', () => { callCount++; });
    bridge.onMessage({ type: 'test:evt', data: {} });
    expect(callCount).toBe(1);
    expect(bridge.getMessageQueue()).toHaveLength(1);

    bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.getMessageQueue()).toHaveLength(0);
    expect(bridge.getIPCAdapter()).toBeNull();

    // After disconnect, onMessage should not trigger old listeners
    bridge.onMessage({ type: 'test:evt', data: {} });
    expect(callCount).toBe(1);
  });

  test('disconnect on fresh instance is safe', () => {
    const bridge = new UIBridge();
    bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
  });
});

describe('UIBridge — createReactHook', () => {
  test('createReactHook returns an object with expected methods', () => {
    const bridge = new UIBridge();
    const hook = bridge.createReactHook();
    expect(typeof hook.subscribe).toBe('function');
    expect(typeof hook.unsubscribe).toBe('function');
    expect(typeof hook.sendMessage).toBe('function');
    expect(typeof hook.processInput).toBe('function');
    expect(typeof hook.stop).toBe('function');
    expect(typeof hook.getState).toBe('function');
    expect(typeof hook.getTools).toBe('function');
    expect(typeof hook.getMessageQueue).toBe('function');
    expect(typeof hook.isConnected).toBe('function');
  });
});
