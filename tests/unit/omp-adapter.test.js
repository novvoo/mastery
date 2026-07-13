import { describe, expect, test } from 'bun:test';
import { OmpAdapter, createOmpAdapter } from '../../src/adapters/desktop/omp-adapter.js';

describe('OmpAdapter', () => {
  test('可以导入 OmpAdapter 类', () => {
    expect(OmpAdapter).toBeDefined();
    expect(typeof OmpAdapter).toBe('function');
  });

  test('createOmpAdapter 工厂函数返回实例', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(adapter).toBeInstanceOf(OmpAdapter);
  });

  test('getState() 在初始化前返回 idle 状态', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const state = adapter.getState();
    expect(state.status).toBe('idle');
    expect(state.sessionId).toBeNull();
    expect(state.isStreaming).toBe(false);
  });

  test('getTools() 在初始化前返回空数组', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const tools = adapter.getTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(0);
  });

  test('registerTool() 可以注册自定义工具', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    adapter.registerTool({
      name: 'test-tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'result',
    });
    const tools = adapter.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test-tool');
  });

  test('registerTools() 可以批量注册工具', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    adapter.registerTools([
      { name: 'tool1', description: '', parameters: {}, execute: async () => '' },
      { name: 'tool2', description: '', parameters: {}, execute: async () => '' },
    ]);
    const tools = adapter.getTools();
    expect(tools.length).toBe(2);
  });

  test('getEventBus() 返回事件总线实例', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const eventBus = adapter.getEventBus();
    expect(eventBus).toBeDefined();
    expect(typeof eventBus.subscribe).toBe('function');
    expect(typeof eventBus.emit).toBe('function');
  });

  test('getSessionManager() 在初始化前返回基本接口', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const manager = adapter.getSessionManager();
    expect(manager).toBeDefined();
    expect(typeof manager.getCurrentSessionId).toBe('function');
  });
});

describe('OmpAdapter — config & debug', () => {
  test('getConfig() 返回配置副本', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp/test', debug: true });
    const cfg = adapter.getConfig();
    expect(cfg.workingDirectory).toBe('/tmp/test');
    expect(cfg.debug).toBe(true);
  });

  test('getDebugMode() 返回调试模式', () => {
    const adapter = createOmpAdapter({ debug: true });
    expect(adapter.getDebugMode()).toBe(true);
  });

  test('setDebugMode() 更新调试模式', () => {
    const adapter = createOmpAdapter({ debug: false });
    adapter.setDebugMode(true);
    expect(adapter.getDebugMode()).toBe(true);
  });

  test('setDebugMode(false) 关闭调试模式', () => {
    const adapter = createOmpAdapter({ debug: true });
    adapter.setDebugMode(false);
    expect(adapter.getDebugMode()).toBe(false);
  });
});

describe('OmpAdapter — session/state getters', () => {
  test('getSessionId() 在初始化前返回 null', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(adapter.getSessionId()).toBeNull();
  });

  test('getCurrentModel() 在初始化前返回 null', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(adapter.getCurrentModel()).toBeNull();
  });

  test('getThinkingLevel() 在初始化前返回 null', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(adapter.getThinkingLevel()).toBeNull();
  });

  test('getState() 包含 getState 字段', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const state = adapter.getState();
    expect(typeof state.status).toBe('string');
    expect(typeof state.timestamp).toBe('number');
    expect('sessionId' in state).toBe(true);
    expect('isStreaming' in state).toBe(true);
    expect('model' in state).toBe(true);
    expect('thinkingLevel' in state).toBe(true);
    expect('messageCount' in state).toBe(true);
  });
});

describe('OmpAdapter — getAvailableCommands', () => {
  test('getAvailableCommands() 返回空数组（未初始化）', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const cmds = adapter.getAvailableCommands();
    expect(Array.isArray(cmds)).toBe(true);
    expect(cmds).toHaveLength(0);
  });
});

describe('OmpAdapter — session operations (safe no-ops before init)', () => {
  test('flushSession() 是安全无操作的（未初始化）', async () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    await adapter.flushSession();
    // no throw = pass
  });

  test('setSessionId() 是安全无操作的（未初始化）', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    adapter.setSessionId('some-session');
    // no throw = pass
  });
});

describe('OmpAdapter — respondToInteraction', () => {
  test('respondToInteraction() 抛出对无效 requestId', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(() => adapter.respondToInteraction('nonexistent', { value: 'test' })).toThrow('已失效或不存在');
  });
});

describe('OmpAdapter — dispose', () => {
  test('dispose() 不会抛出', async () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    await adapter.dispose();
    // no throw = pass
  });

  test('dispose() 后状态变为 idle', async () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    await adapter.dispose();
    const state = adapter.getState();
    expect(state.status).toBe('idle');
  });
});

describe('OmpAdapter — listSessions', () => {
  test('listSessions() 无 sessionFile 时返回空数组', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    const sessions = adapter.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toHaveLength(0);
  });
});

describe('OmpAdapter — LSP / MCP', () => {
  test('getLSPManager() 返回 null（omp 内置）', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(adapter.getLSPManager()).toBeNull();
  });

  test('getMcpClient() 返回 null（omp 内置）', () => {
    const adapter = createOmpAdapter({ workingDirectory: '/tmp' });
    expect(adapter.getMcpClient()).toBeNull();
  });
});
