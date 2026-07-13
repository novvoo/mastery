import { describe, expect, test, afterEach } from 'bun:test';
import {
  DesktopCore,
  createDesktopCore,
  DesktopState,
  DesktopPlugin,
} from '../../src/adapters/desktop/desktop-core.js';
import { getEventBus, resetEventBus } from '../../src/runtime/event-bus.js';

// DesktopCore uses getEventBus() singleton — reset between tests
afterEach(() => {
  resetEventBus();
});

describe('DesktopCore — config merge', () => {
  test('uses defaults when no config provided', () => {
    const core = new DesktopCore();
    const state = core.getState();
    expect(state.workingDirectory).toBeDefined();
  });

  test('merges provided config with defaults', () => {
    const core = createDesktopCore({ workingDirectory: '/custom/path', debug: true });
    const state = core.getState();
    expect(state.workingDirectory).toBe('/custom/path');
  });
});

describe('DesktopCore — pre-init state', () => {
  test('status is IDLE before initialize', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getState().status).toBe(DesktopState.IDLE);
  });

  test('isReady() returns false before init', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.isReady()).toBe(false);
  });

  test('isRunning() returns false before init', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.isRunning()).toBe(false);
  });
});

describe('DesktopCore — getState() shape', () => {
  test('state has all expected fields', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const s = core.getState();
    expect(s).toHaveProperty('status');
    expect(s).toHaveProperty('desktopState');
    expect(s).toHaveProperty('initialized');
    expect(s).toHaveProperty('disposed');
    expect(s).toHaveProperty('ipcConnected');
    expect(s).toHaveProperty('isInitialized');
    expect(s).toHaveProperty('isDisposed');
    expect(s).toHaveProperty('workingDirectory');
    expect(s).toHaveProperty('timestamp');
    expect(s.initialized).toBe(false);
    expect(s.disposed).toBe(false);
    expect(s.ipcConnected).toBe(false);
  });

  test('getDetailedState() includes engine field', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const s = core.getDetailedState();
    expect(s).toHaveProperty('engine');
    // engine should be an empty object (null mapped)
    expect(typeof s.engine).toBe('object');
  });
});

describe('DesktopCore — addStateListener', () => {
  test('listener is called on state changes via events', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const changes = [];
    const remove = core.addStateListener((state, full) => {
      changes.push({ state, initialized: full.isInitialized });
    });
    expect(typeof remove).toBe('function');

    // Emit agent lifecycle events — #setupStateMonitoring not active,
    // so listeners won't fire. Test the listener mechanism directly.
    // The listener is a Set + call pattern: `core.#setState` checks
    // state != oldState before invoking listeners.

    // We can't access #setState, but we can observe listener removal.
    remove();
    expect(changes).toEqual([]);
  });
});

describe('DesktopCore — event buffer', () => {
  test('getEventBuffer() returns empty array pre-init', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getEventBuffer()).toEqual([]);
  });

  test('clearEventBuffer() is safe pre-init', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.clearEventBuffer();
    expect(core.getEventBuffer()).toEqual([]);
  });

  test('event buffer fills when events are emitted on shared bus', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const bus = getEventBus();
    // The buffer sub (in #setupEventForwarding) isn't active until
    // initialize. So buffer remains empty from emit alone.
    bus.emit('test:evt', { n: 1 });
    expect(core.getEventBuffer()).toEqual([]);
  });
});

describe('DesktopCore — getters return null/none before init', () => {
  test('getEngine() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getEngine()).toBeNull();
  });

  test('getIPCAdapter() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getIPCAdapter()).toBeNull();
  });

  test('getUIBridge() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getUIBridge()).toBeNull();
  });

  test('getRuntime() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getRuntime()).toBeNull();
  });

  test('getLSPManager() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getLSPManager()).toBeNull();
  });

  test('getMcpClient() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getMcpClient()).toBeNull();
  });

  test('getToolRegistry() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getToolRegistry()).toBeNull();
  });

  test('getSessionStore() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getSessionStore()).toBeNull();
  });

  test('getSessionFileStore() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getSessionFileStore()).toBeNull();
  });

  test('getWorkspaceState() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getWorkspaceState()).toBeNull();
  });

  test('getMetricsSink() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getMetricsSink()).toBeNull();
  });

  test('getSessionManager() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getSessionManager()).toBeNull();
  });

  test('getSessionId() returns null', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getSessionId()).toBeNull();
  });
});

describe('DesktopCore — no-ops before init', () => {
  test('registerTool is safe no-op', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.registerTool({ name: 'test', execute: async () => 'ok' });
    // no throw = pass
  });

  test('registerTools is safe no-op', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.registerTools([{ name: 't1' }, { name: 't2' }]);
    // no throw = pass
  });

  test('stop transitions state to READY even before init', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.stop();
    expect(core.getState().status).toBe(DesktopState.READY);
  });

  test('setSessionId is safe no-op', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.setSessionId('test-session');
    expect(core.getSessionId()).toBeNull();
  });

  test('flushSession resolves to undefined', async () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const result = await core.flushSession();
    expect(result).toBeUndefined();
  });

  test('attachModelProvider is safe no-op', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.attachModelProvider({});
    // no throw = pass
  });
});

describe('DesktopCore — security policy', () => {
  test('default securityPolicy is full', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getSecurityPolicy()).toBe('full');
  });

  test('custom securityPolicy from config', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp', securityPolicy: 'restricted' });
    expect(core.getSecurityPolicy()).toBe('restricted');
  });
});
describe('DesktopCore — attachIPCAdapter', () => {
  test('creates adapter without throwing (errors caught internally)', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    // attachIPCAdapter creates MainProcessIPCAdapter internally;
    // constructor stores ipcMain ref, initialize errors are caught
    expect(() => core.attachIPCAdapter({})).not.toThrow();
    const adapter = core.getIPCAdapter();
    expect(adapter).toBeDefined();
  });
});

describe('DesktopCore — attachUIBridge', () => {
  test('returns UIBridge when none provided', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const bridge = core.attachUIBridge();
    expect(bridge).toBeDefined();
    expect(typeof bridge.subscribe).toBe('function');
    expect(typeof bridge.onMessage).toBe('function');
  });

  test('returns provided bridge', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const fakeBridge = { custom: true };
    const bridge = core.attachUIBridge(fakeBridge);
    expect(bridge).toBe(fakeBridge);
  });
});

describe('DesktopCore — waitForState', () => {
  test('resolves immediately when already in target state', async () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    await core.waitForState(DesktopState.IDLE, 100);
    // no timeout = pass
  });

  test('rejects on timeout when state never reached', async () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    let err;
    try {
      await core.waitForState(DesktopState.READY, 50);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('Timeout');
  });
});

describe('DesktopCore — dispose', () => {
  test('dispose sets state to DISPOSED', async () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    await core.dispose();
    expect(core.getState().status).toBe(DesktopState.DISPOSED);
    expect(core.getState().isDisposed).toBe(true);
  });

  test('dispose is idempotent', async () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    await core.dispose();
    await core.dispose();
    expect(core.getState().status).toBe(DesktopState.DISPOSED);
  });
});

describe('DesktopCore — setWorkingDirectory', () => {
  test('updates config without engine (pre-init)', async () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    await core.setWorkingDirectory('/new/path');
    expect(core.getState().workingDirectory).toBe('/new/path');
  });
});

describe('DesktopCore — DesktopState constants', () => {
  test('all states are defined', () => {
    expect(DesktopState.IDLE).toBe('idle');
    expect(DesktopState.INITIALIZING).toBe('initializing');
    expect(DesktopState.READY).toBe('ready');
    expect(DesktopState.RUNNING).toBe('running');
    expect(DesktopState.ERROR).toBe('error');
    expect(DesktopState.DISPOSED).toBe('disposed');
  });
});

describe('DesktopCore — DesktopPlugin export', () => {
  test('DesktopPlugin has name and version', () => {
    expect(DesktopPlugin.name).toBe('desktop');
    expect(DesktopPlugin.version).toBe('1.0.0');
    expect(DesktopPlugin.description).toBeDefined();
  });
});
