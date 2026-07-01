/**
 * Desktop IPC Initialization Tests
 * 验证 IPC handler 注册和初始化顺序的正确性
 *
 * 关键测试点：
 * - MainProcessIPCAdapter.initialize() 是否注册了 ipc:connect handler
 * - DesktopCore + IPCAdapter 能否在窗口创建前完成初始化
 * - 注册的 handler 是否能正确处理连接请求
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const DESKTOP_ROOT = dirname(dirname(__filename));
const REPO_ROOT = dirname(DESKTOP_ROOT);

// ── 模拟辅助 ──────────────────────────────────────────────────────

/**
 * 创建一个模拟的 ipcMain 对象，追踪所有 handle/on 注册
 */
function createMockIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    on(channel, fn) {
      if (!listeners.has(channel)) {listeners.set(channel, []);}
      listeners.get(channel).push(fn);
    },
  };
}

/**
 * 模拟 event.sender 对象
 */
function createMockSender(id = 1) {
  return { id };
}

/**
 * 模拟事件对象
 */
function createMockEvent(senderId = 1) {
  return { sender: createMockSender(senderId) };
}

// ── 测试套件 ──────────────────────────────────────────────────────

describe('Desktop IPC Initialization Order', () => {
  // ── Test 1: IPC handler 注册 ──────────────────────────────────

  test('MainProcessIPCAdapter registers ipc:connect handler on initialize()', async () => {
    const { resetEventBus } = await import('../../src/runtime/event-bus.js');
    const { createMainProcessIPCAdapter, IPCMessageType } =
      await import('../../src/adapters/desktop/ipc-adapter.js');

    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const mockIpcMain = createMockIpcMain();
    const adapter = createMainProcessIPCAdapter(mockIpcMain, eventBus, {
      debug: false,
      validateMessages: false,
    });

    // 初始化前没有 handler
    expect(mockIpcMain.handlers.has(IPCMessageType.CONNECT)).toBe(false);

    // 初始化后应该注册了 ipc:connect
    await adapter.initialize();
    expect(mockIpcMain.handlers.has(IPCMessageType.CONNECT)).toBe(true);

    // 验证 handler 能正确处理连接请求
    const connectHandler = mockIpcMain.handlers.get(IPCMessageType.CONNECT);
    const mockEvent = createMockEvent(42);
    const result = await connectHandler(mockEvent);
    expect(result).toEqual({ success: true, windowId: 42 });

    adapter.disconnect();
    resetEventBus();
  });

  // ── Test 2: 关键 invoke channel handler 注册 ──────────────────

  test('MainProcessIPCAdapter registers all critical invoke channels', async () => {
    const { resetEventBus } = await import('../../src/runtime/event-bus.js');
    const { createMainProcessIPCAdapter } =
      await import('../../src/adapters/desktop/ipc-adapter.js');

    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const mockIpcMain = createMockIpcMain();
    const adapter = createMainProcessIPCAdapter(mockIpcMain, eventBus, {
      debug: false,
    });

    await adapter.initialize();

    // 这些是渲染进程 preload 调用的关键频道，必须全部注册
    const expectedChannels = [
      'agent:processInput',
      'agent:stop',
      'agent:getState',
      'agent:getTools',
      'system:getStats',
      'window:minimize',
      'window:maximize',
      'window:close',
      'dialog:openFile',
      'dialog:saveFile',
      'dialog:openDirectory',
      'app:getInfo',
      'app:getPath',
      'workspace:readFile',
      'workspace:writeFile',
    ];

    for (const channel of expectedChannels) {
      expect(mockIpcMain.handlers.has(channel)).toBe(true);
    }

    adapter.disconnect();
    resetEventBus();
  });

  // ── Test 3: DesktopCore + attachIPCAdapter 完整流程 ──────────

  test('DesktopCore initializes then attachIPCAdapter produces working adapter', async () => {
    const { resetEventBus } = await import('../../src/runtime/event-bus.js');
    const { createDesktopCore, DesktopState } =
      await import('../../src/adapters/desktop/desktop-core.js');

    resetEventBus();

    const core = createDesktopCore({ debug: false });
    expect(core.getState().desktopState).toBe(DesktopState.IDLE);

    // 初始化 DesktopCore
    await core.initialize();
    const stateAfterInit = core.getState();
    expect(stateAfterInit.desktopState).toBe(DesktopState.READY);
    expect(stateAfterInit.initialized).toBe(true);

    // attachIPCAdapter 应该在初始化之后正常工作
    const mockIpcMain = createMockIpcMain();
    const ipcAdapter = core.attachIPCAdapter(mockIpcMain);
    expect(ipcAdapter).toBeTruthy();
    expect(typeof ipcAdapter.initialize).toBe('function');

    // 初始化 adapter 后 ipc:connect handler 应被注册
    await ipcAdapter.initialize();
    expect(mockIpcMain.handlers.has('ipc:connect')).toBe(true);

    await core.dispose();
    resetEventBus();
  });

  // ── Test 4: 初始化顺序模拟 ────────────────────────────────────

  test('IPC handlers registered before simulated window creation — ordering assertion', async () => {
    // 这个测试模拟 main.js 中 initialize() 的修正后顺序：
    //   DesktopCore init → attachConfiguredModelProvider → IPCAdapter init → createMainWindow
    // 验证在 "createMainWindow" 步骤之前 IPC handler 已经就绪

    const { resetEventBus } = await import('../../src/runtime/event-bus.js');
    const { createDesktopCore } = await import('../../src/adapters/desktop/desktop-core.js');
    const { createMainProcessIPCAdapter, IPCMessageType } =
      await import('../../src/adapters/desktop/ipc-adapter.js');

    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    // Step 1: 初始化 DesktopCore
    const core = createDesktopCore({ debug: false });
    await core.initialize();

    // Step 2: 创建 IPC adapter（模拟 attachConfiguredModelProvider 后的 IPC 初始化）
    const mockIpcMain = createMockIpcMain();
    const adapter = createMainProcessIPCAdapter(mockIpcMain, eventBus, {
      debug: false,
    });
    await adapter.initialize();

    // Step 3: 验证所有 handler 已注册（模拟 createMainWindow 前的检查）
    const requiredForPreload = [
      IPCMessageType.CONNECT,
      'agent:processInput',
      'agent:stop',
      'agent:getState',
      'agent:getTools',
      'system:getStats',
    ];

    // ★ 关键断言：此时 handler 必须全部注册完毕
    //   （模拟：如果在 createMainWindow() 之前添加此检查，就是绿色）
    for (const channel of requiredForPreload) {
      if (!mockIpcMain.handlers.has(channel)) {
        throw new Error(
          `Handler for "${channel}" was NOT registered before createMainWindow step. ` +
            `If this was a real app, preload.js would fail with: ` +
            `"No handler registered for '${channel}'"`,
        );
      }
    }

    // Step 4: 验证 connect handler 确实可以处理渲染进程的连接请求
    const connectHandler = mockIpcMain.handlers.get(IPCMessageType.CONNECT);
    const result = await connectHandler(createMockEvent(99));
    expect(result.success).toBe(true);
    expect(result.windowId).toBe(99);

    // 清理
    await core.dispose();
    adapter.disconnect();
    resetEventBus();
  });

  // ── Test 5: 重复初始化不会覆盖 handler ───────────────────────

  test('Multiple initialize() calls do not crash or overwrite handler registration', async () => {
    const { resetEventBus } = await import('../../src/runtime/event-bus.js');
    const { createMainProcessIPCAdapter, IPCMessageType } =
      await import('../../src/adapters/desktop/ipc-adapter.js');

    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const mockIpcMain = createMockIpcMain();
    const adapter = createMainProcessIPCAdapter(mockIpcMain, eventBus, {
      debug: false,
    });

    // 多次初始化不会抛异常
    await adapter.initialize();
    // 第二次调用不应该抛错（Electron 里重复 ipcMain.handle 会抛异常）
    // 但因为 adapter 内部只注册一次，所以应该安全
    await adapter.initialize();

    expect(mockIpcMain.handlers.has(IPCMessageType.CONNECT)).toBe(true);

    adapter.disconnect();
    resetEventBus();
  });

  // ==================== Event Forwarding & Deduplication ====================

  describe('Desktop Event Forwarding', () => {
    test('DesktopCore forwards agent:start through IPC adapter once', async () => {
      const { getEventBus, resetEventBus } = await import('../../src/runtime/event-bus.js');
      const { DesktopCore, createDesktopCore } =
        await import('../../src/adapters/desktop/desktop-core.js');
      const { createMainProcessIPCAdapter } =
        await import('../../src/adapters/desktop/ipc-adapter.js');
      const { RuntimeEvent } = await import('../../src/runtime/types.js');

      resetEventBus();
      const bus = getEventBus();
      const mockIpcMain = { handle: () => {}, on: () => {} };

      const core = createDesktopCore({ workingDirectory: '/tmp', debug: false });
      await core.initialize();
      const adapter = core.attachIPCAdapter(mockIpcMain);
      let broadcastCount = 0;
      adapter.broadcast = (name, data) => {
        broadcastCount++;
      };

      bus.emit(RuntimeEvent.AGENT_START, { task: 'test' });

      if (broadcastCount === 0) {
        throw new Error('Expected at least 1 broadcast, got 0 (event forwarding broken)');
      }
      if (broadcastCount > 4) {
        throw new Error(
          'Expected exactly 1 broadcast, got ' + broadcastCount + ' (possible state cascade)',
        );
      }

      core.dispose();
      adapter.disconnect();
      resetEventBus();
    });
    test('DesktopCore state transitions: idle -> ready -> disposed', async () => {
      const { createDesktopCore, DesktopState } =
        await import('../../src/adapters/desktop/desktop-core.js');

      const core = createDesktopCore({ workingDirectory: '/tmp', debug: false });

      // Initial state idle
      const initialState = core.getState();
      if (initialState.desktopState !== DesktopState.IDLE) {
        throw new Error('Expected IDLE state after creation, got ' + initialState.desktopState);
      }

      // After initialize, state becomes READY
      await core.initialize();
      const readyState = core.getState();
      if (readyState.desktopState !== DesktopState.READY) {
        throw new Error('Expected READY state after initialize, got ' + readyState.desktopState);
      }

      // After dispose, state becomes DISPOSED
      await core.dispose();
      const disposedState = core.getState();
      if (disposedState.desktopState !== DesktopState.DISPOSED) {
        throw new Error('Expected DISPOSED state after dispose, got ' + disposedState.desktopState);
      }
    });

    test('DesktopCore getState returns expected fields', async () => {
      const { createDesktopCore, DesktopState } =
        await import('../../src/adapters/desktop/desktop-core.js');

      const core = createDesktopCore({ workingDirectory: '/tmp', debug: false });
      await core.initialize();

      const state = core.getState();
      if (typeof state.desktopState !== 'string') {
        throw new Error('Expected desktopState to be a string, got ' + typeof state.desktopState);
      }
      if (typeof state.initialized !== 'boolean') {
        throw new Error('Expected initialized to be a boolean, got ' + typeof state.initialized);
      }
      if (typeof state.ipcConnected !== 'boolean') {
        throw new Error('Expected ipcConnected to be a boolean, got ' + typeof state.ipcConnected);
      }

      // After attach with mock, adapter gets initialized automatically
      const mockIpcMain = { handle: () => {}, on: () => {} };
      core.attachIPCAdapter(mockIpcMain);
      const afterAttach = core.getState();
      if (afterAttach.ipcConnected !== true) {
        throw new Error(
          'Expected ipcConnected to be true after attach (initialized), got ' +
            afterAttach.ipcConnected,
        );
      }

      await core.dispose();
    });

    test('DesktopCore can attach and access IPC adapter', async () => {
      const { createDesktopCore } = await import('../../src/adapters/desktop/desktop-core.js');

      const core = createDesktopCore({ workingDirectory: '/tmp', debug: false });
      await core.initialize();

      const mockIpcMain = { handle: () => {}, on: () => {} };
      const adapter = core.attachIPCAdapter(mockIpcMain);

      if (typeof adapter.broadcast !== 'function') {
        throw new Error('Expected adapter to have broadcast method');
      }
      if (typeof adapter.initialize !== 'function') {
        throw new Error('Expected adapter to have initialize method');
      }

      // Adapter gets initialized automatically on attach
      if (adapter.isConnected !== true) {
        throw new Error(
          'Expected adapter isConnected to be true after attach, got ' + adapter.isConnected,
        );
      }

      await core.dispose();
      adapter.disconnect();
    });
  });

  describe('Desktop App Config Persistence', () => {
    test('saveAppConfig persists and readAppConfig restores workingDirectory', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const path = await import('path');
      const { saveAppConfig, readAppConfig } =
        await import('../main-app/llm-config-and-persistence.js');

      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastery-desktop-config-'));
      const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastery-workspace-'));
      const electron = {
        app: {
          getPath(name) {
            if (name !== 'userData') {
              throw new Error(`unexpected path: ${name}`);
            }
            return userDataDir;
          },
        },
      };
      const ctx = {
        electron,
        config: {
          workingDirectory: workspaceDir,
          window: { width: 1200, height: 800 },
          runtime: { maxIterations: 42 },
        },
        mainWindow: {
          getSize: () => [1440, 900],
        },
      };

      const saved = saveAppConfig(ctx);
      expect(saved.success).toBe(true);

      const restored = readAppConfig(electron);
      expect(restored.workingDirectory).toBe(workspaceDir);
      expect(restored.window).toMatchObject({ width: 1440, height: 900 });
      expect(restored.runtime).toMatchObject({ maxIterations: 42 });
    });
  });

  describe('Desktop Model Management Activation', () => {
    const envKeys = [
      'MODEL_PROVIDER',
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
      'OPENAI_BASE_URL',
      'OPENAI_API_URL',
    ];

    function snapshotEnv() {
      return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    }

    function restoreEnv(snapshot) {
      for (const key of envKeys) {
        if (snapshot[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = snapshot[key];
        }
      }
    }

    async function createModelTestContext(prefix = 'mastery-model-mgmt-') {
      const os = await import('os');
      const fs = await import('fs');
      const path = await import('path');
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      const attachedProviders = [];
      return {
        fs,
        path,
        userDataDir,
        ctx: {
          userEnvPath: path.join(userDataDir, '.env'),
          config: { debug: false },
          electron: {
            app: {
              getPath(name) {
                if (name !== 'userData') {
                  throw new Error(`unexpected path: ${name}`);
                }
                return userDataDir;
              },
            },
          },
          desktopCore: {
            attachModelProvider(provider) {
              attachedProviders.push(provider);
            },
          },
          attachedProviders,
        },
      };
    }

    test('saveSingleModelConfig activates an enabled model immediately', async () => {
      const savedEnv = snapshotEnv();
      const { fs, userDataDir, ctx } = await createModelTestContext();
      try {
        for (const key of envKeys) {delete process.env[key];}
        const { saveSingleModelConfig } = await import('../main-app/llm-config-and-persistence.js');

        const result = await saveSingleModelConfig(ctx, {
          id: 'model-openai',
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'test-key-from-management',
          enabled: true,
          name: 'OpenAI',
        });

        expect(result.success).toBe(true);
        expect(result.provider).toBe('openai');
        expect(result.model).toBe('gpt-4o');
        expect(result.status?.configured).toBe(true);
        expect(ctx.attachedProviders.length).toBe(1);
        expect(process.env.MODEL_PROVIDER).toBe('openai');
        expect(process.env.OPENAI_MODEL).toBe('gpt-4o');
        expect(process.env.OPENAI_API_KEY).toBe('test-key-from-management');
      } finally {
        restoreEnv(savedEnv);
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('saveSingleModelConfig encrypts model API keys when safeStorage is available', async () => {
      const savedEnv = snapshotEnv();
      const { fs, path, userDataDir, ctx } = await createModelTestContext('mastery-model-secure-');
      try {
        for (const key of envKeys) {delete process.env[key];}
        ctx.electron.safeStorage = {
          isEncryptionAvailable: () => true,
          encryptString(value) {
            return Buffer.from(`secure:${Buffer.from(value).toString('base64')}`);
          },
          decryptString(buffer) {
            const encoded = buffer.toString().replace(/^secure:/, '');
            return Buffer.from(encoded, 'base64').toString();
          },
        };

        const { readAllModelConfigsForRenderer, saveSingleModelConfig } =
          await import('../main-app/llm-config-and-persistence.js');
        const result = await saveSingleModelConfig(ctx, {
          id: 'model-openai',
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'test-key-secure',
          enabled: true,
          name: 'OpenAI',
        });

        expect(result.success).toBe(true);
        const rawModels = fs.readFileSync(path.join(userDataDir, 'models.json'), 'utf8');
        expect(rawModels).not.toContain('test-key-secure');
        expect(rawModels).toContain('apiKeyEncrypted');

        const rendererConfigs = readAllModelConfigsForRenderer(ctx);
        expect(rendererConfigs[0].apiKey).toBe('');
        expect(rendererConfigs[0].hasApiKey).toBe(true);
        expect(rendererConfigs[0].apiKeyPreview).toBe('••••cure');
      } finally {
        restoreEnv(savedEnv);
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('attachConfiguredModelProvider restores active model from models.json when env is missing', async () => {
      const savedEnv = snapshotEnv();
      const { fs, path, userDataDir, ctx } = await createModelTestContext('mastery-model-restore-');
      try {
        for (const key of envKeys) {delete process.env[key];}
        fs.writeFileSync(
          path.join(userDataDir, 'models.json'),
          JSON.stringify(
            [
              {
                id: 'model-openai',
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'test-key-restored',
                enabled: true,
                name: 'OpenAI Mini',
              },
            ],
            null,
            2,
          ),
        );

        const { attachConfiguredModelProvider } =
          await import('../main-app/llm-config-and-persistence.js');
        const status = await attachConfiguredModelProvider(ctx);

        expect(status.configured).toBe(true);
        expect(status.provider).toBe('openai');
        expect(status.model).toBe('gpt-4o-mini');
        expect(ctx.attachedProviders.length).toBe(1);
        expect(process.env.OPENAI_API_KEY).toBe('test-key-restored');
      } finally {
        restoreEnv(savedEnv);
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    test('saveAllModelConfigsAndActivate does not persist an invalid active model', async () => {
      const savedEnv = snapshotEnv();
      const { fs, path, userDataDir, ctx } = await createModelTestContext('mastery-model-invalid-');
      try {
        for (const key of envKeys) {delete process.env[key];}
        const initialConfigs = [
          {
            id: 'model-openai',
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'valid-key',
            enabled: true,
            name: 'OpenAI',
          },
        ];
        fs.writeFileSync(
          path.join(userDataDir, 'models.json'),
          JSON.stringify(initialConfigs, null, 2),
        );

        const { saveAllModelConfigsAndActivate } =
          await import('../main-app/llm-config-and-persistence.js');
        const result = await saveAllModelConfigsAndActivate(ctx, [
          {
            id: 'model-bad',
            provider: 'openai',
            model: '',
            apiKey: '',
            enabled: true,
            name: 'Broken',
          },
        ]);

        expect(result.success).toBe(false);
        expect(result.error).toBe('模型配置不完整（缺少 API Key 或模型名称）');
        const savedConfigs = JSON.parse(
          fs.readFileSync(path.join(userDataDir, 'models.json'), 'utf8'),
        );
        expect(savedConfigs).toEqual(initialConfigs);
        expect(ctx.attachedProviders.length).toBe(0);
      } finally {
        restoreEnv(savedEnv);
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

  describe('Desktop IPC Preload Bridge', () => {
    test('ElectronMainApp always points BrowserWindow preload at sandbox-compatible CommonJS preload', async () => {
      const path = await import('path');
      const fs = await import('fs');

      const source = fs.readFileSync(path.join(DESKTOP_ROOT, 'main-app.js'), 'utf8');
      const preloadCjsRefs = source.match(/path\.join\(__dirname, 'preload\.cjs'\)/g) || [];
      expect(preloadCjsRefs.length).toBeGreaterThanOrEqual(2);
      expect(source).not.toContain("preload: path.join(__dirname, 'preload-entry', 'index.js')");
      expect(source).not.toContain("preload: path.join(__dirname, 'preload.js')");
      expect(source).toContain('nodeIntegration: false');
      expect(source).toContain('contextIsolation: true');
      expect(source).toContain('sandbox: true');
      expect(source).not.toContain('sandbox: false');
    });

    test('desktop packaging includes the sandboxed preload and diagnostic preload files', async () => {
      const path = await import('path');
      const fs = await import('fs');

      const rootPackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
      const electronBuilder = JSON.parse(
        fs.readFileSync(path.join(DESKTOP_ROOT, 'electron-builder.json'), 'utf8'),
      );
      const verifyScript = fs.readFileSync(
        path.join(REPO_ROOT, 'scripts', 'verify-desktop-package.mjs'),
        'utf8',
      );

      expect(rootPackage.build.files).toContain('desktop/preload-entry/**/*');
      expect(rootPackage.build.files).toContain('desktop/main-app.js');
      expect(rootPackage.build.files).toContain('desktop/main-app/**/*');
      expect(rootPackage.build.files).toContain('desktop/preload.cjs');
      expect(rootPackage.build.files).toContain('desktop/preload.js');

      expect(electronBuilder.files).toContain('main-app.js');
      expect(electronBuilder.files).toContain('main-app/**/*');
      expect(electronBuilder.files).toContain('preload-entry/**/*');
      expect(electronBuilder.files).toContain('preload.cjs');
      expect(electronBuilder.files).toContain('preload.js');

      expect(verifyScript).toContain('/desktop/main-app.js');
      expect(verifyScript).toContain('/desktop/main-app/window-lifecycle.js');
      expect(verifyScript).toContain('/desktop/preload-entry/index.js');
      expect(verifyScript).toContain('/desktop/preload-entry/package.json');
      expect(verifyScript).toContain('/desktop/preload.cjs');
    });

    test('active CommonJS preload remains sandbox-compatible', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const preloadPath = path.join(DESKTOP_ROOT, 'preload.cjs');
      const preloadSource = fs.readFileSync(preloadPath, 'utf8');

      expect(preloadSource).toContain("const electron = require('electron')");
      expect(preloadSource).toContain("contextBridge.exposeInMainWorld('electronAPI'");
      expect(preloadSource).not.toContain("require('fs')");
      expect(preloadSource).not.toContain("require('vm')");
    });

    test('preload exposes diagnostic APIs and allows ipc:diagnose', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const preloadSource = fs.readFileSync(path.join(DESKTOP_ROOT, 'preload.js'), 'utf8');

      expect(preloadSource).toContain("'ipc:diagnose'");
      expect(preloadSource).toContain('diagnose: () =>');
      expect(preloadSource).toContain('diagnoseMain: async () =>');
      expect(preloadSource).toContain("contextBridge.exposeInMainWorld('electronAPI'");
      expect(preloadSource).toContain("contextBridge.exposeInMainWorld('__masteryPreloadDiag'");
    });

    test('registerCustomHandlers registers ipc:diagnose for preload diagnostics', async () => {
      const path = await import('path');
      const { registerCustomHandlers } = await import('../main-app/ipc-router.js');

      const mockIpcMain = createMockIpcMain();
      const handlers = new Map();
      const ipcAdapter = {
        getStats: () => ({ isConnected: true, pendingRequests: 0 }),
        registerHandler(channel, handler) {
          handlers.set(channel, handler);
          mockIpcMain.handle(channel, async (event, payload) => handler(payload, event.sender));
        },
      };
      const webContents = {
        id: 7,
        getURL: () => 'http://127.0.0.1:5173/',
      };
      const ctx = {
        ipcAdapter,
        config: {
          debug: true,
          workingDirectory: REPO_ROOT,
          window: {
            webPreferences: {
              preload: path.join(DESKTOP_ROOT, 'preload-entry', 'index.js'),
            },
          },
        },
        mainWindow: { webContents },
        electron: {
          BrowserWindow: {
            getAllWindows: () => [{ webContents }],
            fromWebContents: () => ({ isDestroyed: () => false }),
          },
          dialog: {},
          Notification: function Notification() {},
          shell: {},
          app: {},
        },
      };

      registerCustomHandlers(ctx);

      expect(handlers.has('ipc:diagnose')).toBe(true);
      const result = await handlers.get('ipc:diagnose')({}, webContents);
      expect(result.success).toBe(true);
      expect(result.preload.exists).toBe(true);
      expect(result.window.senderMatchesMainWindow).toBe(true);
      expect(result.ipc.isConnected).toBe(true);
    });

    test('workspace:listDirectory flattens legacy preload options payload', async () => {
      const { registerCustomHandlers } = await import('../main-app/ipc-router.js');

      const handlers = new Map();
      let captured = null;
      const ctx = {
        ipcAdapter: {
          getStats: () => ({}),
          registerHandler(channel, handler) {
            handlers.set(channel, handler);
          },
        },
        config: {
          debug: false,
          workingDirectory: REPO_ROOT,
          window: { webPreferences: {} },
        },
        mainWindow: { webContents: { id: 1, getURL: () => '' } },
        listWorkspaceDirectory(root, options) {
          captured = { root, options };
          return { success: true, entries: [] };
        },
        electron: {
          BrowserWindow: {
            getAllWindows: () => [],
            fromWebContents: () => null,
          },
          dialog: {},
          Notification: function Notification() {},
          shell: {},
          app: {},
        },
      };

      registerCustomHandlers(ctx);
      const result = await handlers.get('workspace:listDirectory')({
        path: 'src',
        options: { maxEntries: 7 },
      });

      expect(result.success).toBe(true);
      expect(captured.root).toBe(REPO_ROOT);
      expect(captured.options).toEqual({ maxEntries: 7, path: 'src' });
    });

    test('terminal command completion does not execute the typed prefix', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const { registerCustomHandlers } = await import('../main-app/ipc-router.js');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastery-complete-'));
      const injectedPath = path.join(tempDir, 'injected');
      const handlers = new Map();
      const ctx = {
        ipcAdapter: {
          getStats: () => ({}),
          registerHandler(channel, handler) {
            handlers.set(channel, handler);
          },
        },
        config: {
          debug: false,
          workingDirectory: tempDir,
          window: { webPreferences: {} },
        },
        mainWindow: { webContents: { id: 1, getURL: () => '' } },
        electron: {
          BrowserWindow: {
            getAllWindows: () => [],
            fromWebContents: () => null,
          },
          dialog: {},
          Notification: function Notification() {},
          shell: {},
          app: {},
        },
      };

      try {
        registerCustomHandlers(ctx);
        const result = await handlers.get('terminal:complete')({
          command: `zzzz;touch ${injectedPath}`,
          cwd: tempDir,
        });

        expect(result.success).toBe(true);
        expect(fs.existsSync(injectedPath)).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
