import { describe, expect, test } from 'bun:test';
import {
  DesktopCore,
  createDesktopCore,
  DesktopState,
} from '../../src/adapters/desktop/desktop-core.js';

describe('DesktopCore', () => {
  test('可以导入 DesktopCore 类', () => {
    expect(DesktopCore).toBeDefined();
    expect(typeof DesktopCore).toBe('function');
  });

  test('createDesktopCore 工厂函数返回实例', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core).toBeInstanceOf(DesktopCore);
  });

  test('DesktopState 包含所有预期状态', () => {
    expect(DesktopState.IDLE).toBe('idle');
    expect(DesktopState.INITIALIZING).toBe('initializing');
    expect(DesktopState.READY).toBe('ready');
    expect(DesktopState.RUNNING).toBe('running');
    expect(DesktopState.ERROR).toBe('error');
    expect(DesktopState.DISPOSED).toBe('disposed');
  });

  test('初始状态为 IDLE', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const state = core.getState();
    expect(state.status).toBe(DesktopState.IDLE);
    expect(state.isInitialized).toBe(false);
    expect(state.isDisposed).toBe(false);
  });

  test('isReady() 在初始化前返回 false', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.isReady()).toBe(false);
  });

  test('isRunning() 在初始化前返回 false', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.isRunning()).toBe(false);
  });

  test('getTools() 在初始化前返回空数组', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const tools = core.getTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(0);
  });

  test('getEventBus() 返回事件总线实例', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const eventBus = core.getEventBus();
    expect(eventBus).toBeDefined();
    expect(typeof eventBus.subscribe).toBe('function');
  });

  test('addStateListener() 可以添加状态监听器', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    let called = false;
    const remove = core.addStateListener(() => {
      called = true;
    });
    expect(typeof remove).toBe('function');
    expect(called).toBe(false);
  });

  test('getEventBuffer() 返回数组', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    const buffer = core.getEventBuffer();
    expect(Array.isArray(buffer)).toBe(true);
  });

  test('clearEventBuffer() 可以清空事件缓冲', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    core.clearEventBuffer();
    const buffer = core.getEventBuffer();
    expect(buffer.length).toBe(0);
  });

  test('getLSPManager() 返回 null（omp 内置）', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getLSPManager()).toBeNull();
  });

  test('getMcpClient() 返回 null（omp 内置）', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getMcpClient()).toBeNull();
  });

  test('getSecurityPolicy() 返回默认值 full', () => {
    const core = createDesktopCore({ workingDirectory: '/tmp' });
    expect(core.getSecurityPolicy()).toBe('full');
  });
});
