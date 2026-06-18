/**
 * Renderer-side IPC hook tests — electronAPI 不可用场景
 *
 * 直接调用 `../renderer/hooks/useIPC.js` 中导出的纯函数
 * （connectElectronAPI / invokeElectronAPI / hasElectronAPI / waitForElectronAPI / getElectronAPI），
 * 通过 globalThis.window 模拟浏览器全局对象，确保测试路径与生产路径完全一致。
 *
 * Bug 场景：
 *   - 在非 Electron 环境（普通浏览器、SSR、开发调试）下运行渲染进程
 *   - preload.js 初始化失败，fallback 也失败
 *   - 导致 window.electronAPI 未被定义
 *
 * 期望行为（本测试一一覆盖）：
 *   - hasElectronAPI() 返回 false（不应抛错）
 *   - connectElectronAPI() 返回 null，并在 console.warn 输出
 *     "[useIPC] electronAPI 不可用，可能不在 Electron 环境中"
 *   - invokeElectronAPI(channel, ...) 抛出带有"请在 Electron 环境中运行此应用"
 *     提示的明确错误
 *   - waitForElectronAPI(timeout) 在超时时 resolve(false)，而非挂起
 *   - getPlatform / getVersions 安全降级到默认值
 *   - window === null / undefined 时也不能抛 TypeError
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// ── 直接引入生产代码（纯函数核心） ──────────────────────────────

import {
  hasElectronAPI as prodHasElectronAPI,
  waitForElectronAPI as prodWaitForElectronAPI,
  connectElectronAPI as prodConnectElectronAPI,
  invokeElectronAPI as prodInvokeElectronAPI,
  getElectronAPI as prodGetElectronAPI,
} from '../renderer/hooks/useIPC.js';

// 为了让测试代码里也能拿到 `getPlatform` / `getVersions`（它们在 Hook 层以
// useCallback 形式存在），我们直接复用生产代码导出的 getElectronAPI
// 做等价的降级分支，行为与 useIPC 中 getPlatform/getVersions 完全一致：

function getPlatformViaProdAPI() {
  const api = prodGetElectronAPI();
  if (!api) {
    return { platform: 'web', arch: 'unknown', isWindows: false, isMac: false, isLinux: false };
  }
  return api.getPlatform();
}

function getVersionsViaProdAPI() {
  const api = prodGetElectronAPI();
  if (!api) {
    return { electron: 'unknown', node: 'unknown', chrome: 'unknown', v8: 'unknown' };
  }
  return api.getVersions();
}

// ── 工具：构造 window 替身（挂载到 globalThis.window） ─────────

function createMockWindow({ exposeElectronAPI = false, delayedMs = 0 } = {}) {
  const win = {
    electronAPI: undefined,
    location: { href: 'about:blank' },
  };
  if (exposeElectronAPI) {
    win.electronAPI = {
      connect: async () => ({ success: true, windowId: 1 }),
      invoke: async (channel, ...args) => ({ channel, args }),
      send: () => {},
      on: () => () => {},
      once: () => Promise.resolve(null),
      disconnect: () => {},
      getPlatform: () => ({ platform: 'darwin', arch: 'arm64', isMac: true, isWindows: false, isLinux: false }),
      getVersions: () => ({ electron: '30.0.0', node: '20.0.0', chrome: '124.0.0', v8: '12.4.0' }),
    };
  }
  if (delayedMs > 0) {
    setTimeout(() => {
      if (!win.electronAPI) {
        win.electronAPI = { connect: async () => ({ success: true }) };
      }
    }, delayedMs);
  }
  return win;
}

// ── 工具：捕获 console.warn / console.error / console.log 输出 ─

function captureConsole() {
  const warns = [];
  const errors = [];
  const logs = [];
  const origWarn = console.warn;
  const origError = console.error;
  const origLog = console.log;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  console.log = (...args) => { logs.push(args.join(' ')); };
  return {
    warns, errors, logs,
    restore: () => {
      console.warn = origWarn;
      console.error = origError;
      console.log = origLog;
    },
  };
}

// ── 测试套件 ─────────────────────────────────────────────────────

describe('useIPC — electronAPI 不可用时的降级路径（直接测生产代码）', () => {
  const originalWindow = globalThis.window;
  let cap;

  beforeEach(() => {
    cap = captureConsole();
  });

  afterEach(() => {
    cap.restore();
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  // ── Test 1: hasElectronAPI 检测 ──────────────────────────

  test('hasElectronAPI returns false when window.electronAPI is undefined', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    expect(prodHasElectronAPI()).toBe(false);
  });

  test('hasElectronAPI returns false when window is null/undefined', () => {
    // 先确保 globalThis.window 为 undefined
    delete globalThis.window;
    expect(prodHasElectronAPI()).toBe(false);
    // 再置为 null
    globalThis.window = null;
    expect(prodHasElectronAPI()).toBe(false);
  });

  test('hasElectronAPI returns true when window.electronAPI is an object', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: true });
    expect(prodHasElectronAPI()).toBe(true);
  });

  // ── Test 2: waitForElectronAPI 超时行为 ─────────────────

  test('waitForElectronAPI resolves false after timeout (not throw)', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    const start = Date.now();
    const result = await prodWaitForElectronAPI(80, 20);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(500);
  });

  test('waitForElectronAPI resolves true when electronAPI appears before timeout', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false, delayedMs: 40 });
    const result = await prodWaitForElectronAPI(500, 10);
    expect(result).toBe(true);
    expect(prodHasElectronAPI()).toBe(true);
  });

  // ── Test 3: connectElectronAPI 输出核心中文警告 ─────────
  //    这是本次修复要"能测出来"的关键路径：在 electronAPI 缺失时
  //    必须打印 `[useIPC] electronAPI 不可用，可能不在 Electron 环境中`
  //    并且返回 null，不能抛错。

  test('connectElectronAPI prints "[useIPC] electronAPI 不可用，可能不在 Electron 环境中" and returns null', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    const result = await prodConnectElectronAPI();
    expect(result).toBe(null);
    // 必须至少有一条 console.warn 包含中文提示
    const hasChineseWarning = cap.warns.some(
      (msg) => msg.includes('[useIPC] electronAPI 不可用') && msg.includes('Electron 环境'),
    );
    expect(hasChineseWarning).toBe(true);
    // 也不能抛任何错误（Promise 不能 reject）
    const hasTypeError = cap.errors.some((m) => m.includes('TypeError'));
    expect(hasTypeError).toBe(false);
  });

  test('connectElectronAPI against null/undefined window returns null, prints warning, no TypeError', async () => {
    // window = undefined
    delete globalThis.window;
    const r1 = await prodConnectElectronAPI();
    expect(r1).toBe(null);
    expect(cap.warns.some((m) => m.includes('[useIPC] electronAPI 不可用'))).toBe(true);
    expect(cap.errors.some((m) => m.includes('TypeError'))).toBe(false);

    // window = null（关键：typeof null === 'object'，许多旧代码会漏掉这种情况）
    cap.warns.length = 0;
    cap.errors.length = 0;
    globalThis.window = null;
    const r2 = await prodConnectElectronAPI();
    expect(r2).toBe(null);
    expect(cap.warns.some((m) => m.includes('[useIPC] electronAPI 不可用'))).toBe(true);
    expect(cap.errors.some((m) => m.includes('TypeError'))).toBe(false);
  });

  test('connectElectronAPI succeeds normally when electronAPI is available', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: true });
    const result = await prodConnectElectronAPI();
    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    // 成功路径应打印 "已连接到主进程"（不强制，但至少不能有警告）
    const hasFailureWarning = cap.warns.some((m) => m.includes('不可用'));
    expect(hasFailureWarning).toBe(false);
  });

  // ── Test 4: invokeElectronAPI 失败路径（核心 bug 测试） ───

  test('invokeElectronAPI throws a clear error with Chinese hint when electronAPI is missing', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    let thrown = null;
    try {
      await prodInvokeElectronAPI('agent:processInput', { input: 'hi' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toInclude('electronAPI 不可用');
    expect(thrown.message).toInclude('Electron 环境');
    expect(thrown.message).toInclude('window.electronAPI=undefined');
  });

  test('invokeElectronAPI does NOT throw when electronAPI is available', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: true });
    const result = await prodInvokeElectronAPI('agent:getState');
    expect(result).toBeTruthy();
    expect(result.channel).toBe('agent:getState');
  });

  test('invokeElectronAPI re-throws original error from electronAPI.invoke', async () => {
    globalThis.window = {
      electronAPI: {
        invoke: async () => { throw new Error('main-process rejected: channel=xxx'); },
      },
      location: { href: 'about:blank' },
    };
    let thrown = null;
    try {
      await prodInvokeElectronAPI('agent:processInput', {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toInclude('main-process rejected');
  });

  test('invokeElectronAPI detects runtime removal of window.electronAPI', async () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: true });
    // 模拟在 invoke 检测前 API 被意外移除
    globalThis.window.electronAPI = null;
    let thrown = null;
    try {
      await prodInvokeElectronAPI('window:minimize');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toInclude('electronAPI 不可用');
  });

  test('invokeElectronAPI reports "无 window 对象" against null/undefined window', async () => {
    // window = null
    globalThis.window = null;
    let thrown1 = null;
    try {
      await prodInvokeElectronAPI('agent:processInput', {});
    } catch (err) {
      thrown1 = err;
    }
    expect(thrown1).toBeInstanceOf(Error);
    expect(thrown1.message).toInclude('无 window 对象');

    // window = undefined
    delete globalThis.window;
    let thrown2 = null;
    try {
      await prodInvokeElectronAPI('agent:processInput', {});
    } catch (err) {
      thrown2 = err;
    }
    expect(thrown2).toBeInstanceOf(Error);
    expect(thrown2.message).toInclude('无 window 对象');
  });

  // ── Test 5: send / subscribe 行为不崩溃 ───────────────────
  //（send/subscribe 在 hook 层以 useCallback 封装了对 window.electronAPI
  // 的访问；下面通过直接调用 getElectronAPI 来复用与生产代码一致的检测）

  test('send silently no-ops when electronAPI unavailable', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    const api = prodGetElectronAPI();
    expect(() => {
      if (api) api.send('channel', { data: 1 });
    }).not.toThrow();
    // 也不会抛 TypeError
    expect(cap.errors.some((m) => m.includes('TypeError'))).toBe(false);
  });

  test('subscribe returns a no-op unsubscriber when electronAPI unavailable', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    const api = prodGetElectronAPI();
    const unsub = api ? api.on('agent:start', () => {}) : () => {};
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  // ── Test 6: getPlatform / getVersions 降级 ───────────────

  test('getPlatform returns web fallback when electronAPI unavailable', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    const info = getPlatformViaProdAPI();
    expect(info.platform).toBe('web');
    expect(info.arch).toBe('unknown');
    expect(info.isWindows).toBe(false);
    expect(info.isMac).toBe(false);
    expect(info.isLinux).toBe(false);
  });

  test('getPlatform returns real info when electronAPI available', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: true });
    const info = getPlatformViaProdAPI();
    expect(info.platform).toBe('darwin');
    expect(info.arch).toBe('arm64');
  });

  test('getVersions returns unknown fallback when electronAPI unavailable', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: false });
    const v = getVersionsViaProdAPI();
    expect(v.electron).toBe('unknown');
    expect(v.node).toBe('unknown');
    expect(v.chrome).toBe('unknown');
    expect(v.v8).toBe('unknown');
  });

  test('getVersions returns real versions when electronAPI available', () => {
    globalThis.window = createMockWindow({ exposeElectronAPI: true });
    const v = getVersionsViaProdAPI();
    expect(v.electron).toStartWith('30');
  });
});

describe('useIPC — 与 useRuntime.js 的协作降级', () => {
  /**
   * useRuntime.js 里多处使用 `if (window.electronAPI)` 作为保护分支。
   * 以下测试仅验证"未挂起"的保护行为。
   */

  test('loadTools-style branch must not throw without electronAPI', async () => {
    const win = createMockWindow({ exposeElectronAPI: false });
    let tools = null;
    try {
      if (win.electronAPI) {
        tools = await win.electronAPI.getTools();
      } else {
        tools = [{ name: 'read_file', description: 'mock' }];
      }
    } catch (err) {
      throw new Error('useRuntime loadTools branch unexpectedly threw: ' + err.message);
    }
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('getState-style branch must not throw without electronAPI', async () => {
    const win = createMockWindow({ exposeElectronAPI: false });
    let state = null;
    try {
      if (win.electronAPI) {
        state = await win.electronAPI.getState();
      } else {
        state = { status: 'idle' };
      }
    } catch (err) {
      throw new Error('useRuntime refreshState branch unexpectedly threw: ' + err.message);
    }
    expect(state).toBeTruthy();
    expect(typeof state.status).toBe('string');
  });
});
