import { getEventBus } from '../../runtime/event-bus.js';
import { RuntimeEvent } from '../../runtime/types.js';
import { createMainProcessIPCAdapter } from './ipc-adapter.js';
import { DesktopPlugin } from './desktop-core/desktop-plugin.js';
import { UIBridge } from './desktop-core/ui-bridge.js';
import { createOmpAdapter } from './omp-adapter.js';

export { DesktopPlugin } from './desktop-core/desktop-plugin.js';
export { UIBridge } from './desktop-core/ui-bridge.js';

export const DesktopState = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  READY: 'ready',
  RUNNING: 'running',
  ERROR: 'error',
  DISPOSED: 'disposed',
};

const DEFAULT_DESKTOP_CONFIG = {
  workingDirectory: process.cwd(),
  debug: false,
  maxIterations: 60,
  autoDownloadModels: true,
  ipc: {
    enabled: true,
    requestTimeout: 30000,
    heartbeatInterval: 30000,
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
    enableQueue: true,
    validateMessages: true,
  },
  ui: {
    theme: 'system',
    fontSize: 14,
  },
  securityPolicy: 'full',
  useOmp: true,
};

export class DesktopCore {
  #config;
  #state;
  #isInitialized;
  #isDisposed;
  #eventBus;
  #engine;
  #runtime;
  #ipcAdapter;
  #uiBridge;
  #stateListeners;
  #eventBuffer;
  #subscriptions;

  constructor(config = {}) {
    this.#config = { ...DEFAULT_DESKTOP_CONFIG, ...config };
    this.#state = DesktopState.IDLE;
    this.#isInitialized = false;
    this.#isDisposed = false;
    this.#eventBus = getEventBus();
    this.#engine = null;
    this.#runtime = null;
    this.#ipcAdapter = null;
    this.#uiBridge = null;
    this.#stateListeners = new Set();
    this.#eventBuffer = [];
    this.#subscriptions = [];
  }

  async initialize() {
    if (this.#isInitialized) return;
    this.#setState(DesktopState.INITIALIZING);

    try {
      this.#engine = createOmpAdapter({
        workingDirectory: this.#config.workingDirectory,
        debug: !!this.#config.debug,
      });
      await this.#engine.initialize();

      this.#runtime = {
        engine: this.#engine,
        toolRegistry: null,
        securityPolicy: 'full',
        workspaceState: null,
        mcpClient: null,
        sessionFileStore: null,
      };

      this.#setupEventForwarding();
      this.#setupStateMonitoring();

      this.#isInitialized = true;
      this.#setState(DesktopState.READY);
      return this;
    } catch (error) {
      this.#setState(DesktopState.ERROR);
      throw error;
    }
  }

  #setupEventForwarding() {
    const events = Object.values(RuntimeEvent);
    for (const event of events) {
      const unsub = this.#eventBus.subscribe(event, (data) => {
        this.#eventBuffer.push({ event, data, timestamp: Date.now() });
        if (this.#eventBuffer.length > 1000) {
          this.#eventBuffer.shift();
        }
        if (this.#ipcAdapter) {
          this.#ipcAdapter.broadcast(event, data);
        }
      });
      this.#subscriptions.push(unsub);
    }
  }

  #setupStateMonitoring() {
    const unsub1 = this.#eventBus.subscribe(RuntimeEvent.AGENT_START, () => {
      this.#setState(DesktopState.RUNNING);
    });
    const unsub2 = this.#eventBus.subscribe(RuntimeEvent.AGENT_STOP, () => {
      this.#setState(DesktopState.READY);
    });
    const unsub3 = this.#eventBus.subscribe(RuntimeEvent.AGENT_ERROR, () => {
      this.#setState(DesktopState.READY);
    });
    this.#subscriptions.push(unsub1, unsub2, unsub3);
  }

  #setState(newState) {
    if (this.#state === newState) return;
    this.#state = newState;
    for (const listener of this.#stateListeners) {
      try {
        listener(newState, this.getState());
      } catch {}
    }
  }

  attachIPCAdapter(ipcMain) {
    if (this.#ipcAdapter) return this.#ipcAdapter;
    this.#ipcAdapter = createMainProcessIPCAdapter(ipcMain, this.#eventBus, {
      debug: this.#config.debug,
      ...this.#config.ipc,
    });
    if (this.#engine) {
      if (typeof this.#ipcAdapter.attachEngine === 'function') {
        this.#ipcAdapter.attachEngine(this.#engine);
      } else if (typeof this.#ipcAdapter.attachDesktopCore === 'function') {
        this.#ipcAdapter.attachDesktopCore(this);
      } else {
        throw new TypeError('IPC adapter does not support engine attachment');
      }
    }
    this.#ipcAdapter.initialize().catch(() => {});
    return this.#ipcAdapter;
  }

  attachUIBridge(bridge) {
    this.#uiBridge = bridge || new UIBridge();
    return this.#uiBridge;
  }

  async processInput(input, options = {}) {
    if (!this.#isInitialized) await this.initialize();
    return this.#engine.processInput(input, options);
  }

  stop() {
    if (this.#engine) this.#engine.stop();
    this.#setState(DesktopState.READY);
  }

  getState() {
    return {
      status: this.#state,
      desktopState: this.#state,
      initialized: this.#isInitialized,
      disposed: this.#isDisposed,
      ipcConnected: Boolean(this.#ipcAdapter?.isConnected),
      isInitialized: this.#isInitialized,
      isDisposed: this.#isDisposed,
      workingDirectory: this.#config.workingDirectory,
      timestamp: Date.now(),
    };
  }

  getDetailedState() {
    const engineState = this.#engine?.getState?.() || {};
    return {
      ...this.getState(),
      engine: engineState,
    };
  }

  getEngine() { return this.#engine; }
  getIPCAdapter() { return this.#ipcAdapter; }
  getUIBridge() { return this.#uiBridge; }
  getEventBus() { return this.#eventBus; }

  getTools() {
    return this.#engine?.getTools?.() || [];
  }

  registerTool(tool) {
    this.#engine?.registerTool?.(tool);
  }

  registerTools(tools) {
    for (const tool of tools) this.registerTool(tool);
  }

  getLSPManager() { return null; }
  attachModelProvider() {}

  async setWorkingDirectory(directory) {
    this.#config.workingDirectory = directory;
    await this.#engine?.setWorkingDirectory?.(directory);
  }

  getRuntime() { return this.#runtime; }
  getWorkspaceState() { return null; }
  getMetricsSink() { return null; }
  getMcpClient() { return null; }
  getSecurityPolicy() { return this.#config.securityPolicy; }
  getToolRegistry() { return null; }
  getSessionFileStore() { return null; }

  getSessionManager() {
    return this.#engine?.getSessionManager?.() || null;
  }

  getSessionStore() { return null; }

  getSessionId() {
    return this.#engine?.getSessionId?.() || null;
  }

  setSessionId(sessionId) {
    this.#engine?.setSessionId?.(sessionId);
  }

  async flushSession() {
    return this.#engine?.flushSession?.();
  }

  addStateListener(listener) {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  getEventBuffer() { return [...this.#eventBuffer]; }
  clearEventBuffer() { this.#eventBuffer = []; }

  async waitForState(targetState, timeout = 30000) {
    if (this.#state === targetState) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for state ${targetState}`));
      }, timeout);
      const remove = this.addStateListener((state) => {
        if (state === targetState) {
          cleanup();
          resolve();
        }
      });
      const cleanup = () => {
        clearTimeout(timer);
        remove();
      };
    });
  }

  isReady() { return this.#state === DesktopState.READY; }
  isRunning() { return this.#state === DesktopState.RUNNING; }

  async dispose() {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    for (const unsub of this.#subscriptions) {
      try { unsub(); } catch {}
    }
    this.#subscriptions = [];
    if (this.#engine?.dispose) {
      try { await this.#engine.dispose(); } catch {}
    }
    if (this.#ipcAdapter?.dispose) {
      try { await this.#ipcAdapter.dispose(); } catch {}
    }
    this.#setState(DesktopState.DISPOSED);
  }
}

export function createDesktopCore(config = {}) {
  return new DesktopCore(config);
}

export function createUIBridge(config = {}) {
  return new UIBridge(config);
}

export { RuntimeEvent };
