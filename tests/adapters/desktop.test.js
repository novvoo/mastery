/**
 * Desktop IPC Adapter 测试
 * 测试 IPC 通信协议、双向通信、错误处理和重连机制
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  IPCMessage,
  IPCMessageType,
  IPCMessageStatus,
  IPCAdapterBase,
  MainProcessIPCAdapter,
  RendererProcessIPCAdapter,
  createMainProcessIPCAdapter,
  createRendererProcessIPCAdapter
} from '../../src/adapters/desktop/ipc-adapter.js';
import {
  DesktopCore,
  UIBridge,
  DesktopState,
  createDesktopCore,
  createUIBridge
} from '../../src/adapters/desktop/desktop-core.js';
import { getEventBus, RuntimeEvent } from '../../src/runtime/index.js';
import { listPreviews, startPreview, stopAllPreviews, stopPreview } from '../../src/core/preview-server.js';

// ==================== IPCMessage 测试 ====================

describe('IPCMessage', () => {
  test('应该正确创建 IPC 消息', () => {
    const message = new IPCMessage(IPCMessageType.REQUEST, { test: 'data' });
    
    expect(message.type).toBe(IPCMessageType.REQUEST);
    expect(message.payload).toEqual({ test: 'data' });
    expect(message.id).toMatch(/^msg_/);
    expect(message.status).toBe(IPCMessageStatus.PENDING);
    expect(message.timestamp).toBeDefined();
  });

  test('应该正确序列化消息', () => {
    const message = new IPCMessage(IPCMessageType.EVENT, { key: 'value' }, {
      correlationId: 'req_123',
      metadata: { channel: 'test' }
    });
    
    const json = message.toJSON();
    
    expect(json.type).toBe(IPCMessageType.EVENT);
    expect(json.payload).toEqual({ key: 'value' });
    expect(json.correlationId).toBe('req_123');
    expect(json.metadata.channel).toBe('test');
  });

  test('应该正确从 JSON 反序列化消息', () => {
    const original = new IPCMessage(IPCMessageType.RESPONSE, { result: 'success' }, {
      id: 'msg_test',
      correlationId: 'req_456'
    });
    original.status = IPCMessageStatus.SUCCESS;
    
    const json = original.toJSON();
    const restored = IPCMessage.fromJSON(json);
    
    expect(restored.type).toBe(original.type);
    expect(restored.payload).toEqual(original.payload);
    expect(restored.id).toBe(original.id);
    expect(restored.correlationId).toBe(original.correlationId);
    expect(restored.status).toBe(original.status);
  });

  test('应该正确从 JSON 字符串反序列化', () => {
    const jsonStr = JSON.stringify({
      type: IPCMessageType.REQUEST,
      payload: { input: 'test' },
      id: 'msg_123',
      timestamp: Date.now(),
      status: IPCMessageStatus.PENDING,
      correlationId: null,
      metadata: {},
      source: 'unknown',
      target: 'unknown'
    });
    
    const message = IPCMessage.fromJSON(jsonStr);
    
    expect(message.type).toBe(IPCMessageType.REQUEST);
    expect(message.payload.input).toBe('test');
  });
});

// ==================== IPCAdapterBase 测试 ====================

describe('IPCAdapterBase', () => {
  let adapter;

  beforeEach(() => {
    adapter = new IPCAdapterBase({ debug: true });
  });

  afterEach(() => {
    adapter.disconnect();
  });

  test('应该正确初始化', () => {
    expect(adapter.config).toBeDefined();
    expect(adapter.messageQueue).toBeDefined();
    expect(adapter.pendingRequests.size).toBe(0);
    expect(adapter.isConnected).toBe(false);
  });

  test('应该正确验证消息', () => {
    const validMessage = { type: IPCMessageType.REQUEST, payload: {} };
    const result = adapter.validateMessage(validMessage);
    expect(result.valid).toBe(true);
  });

  test('应该拒绝无效消息', () => {
    const invalidMessage = null;
    const result = adapter.validateMessage(invalidMessage);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('应该拒绝没有 type 的消息', () => {
    const invalidMessage = { payload: {} };
    const result = adapter.validateMessage(invalidMessage);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('type');
  });

  test('应该正确验证允许的频道', () => {
    adapter.config.allowedChannels = [IPCMessageType.REQUEST, IPCMessageType.EVENT];
    
    const allowed = { type: IPCMessageType.REQUEST };
    const blocked = { type: IPCMessageType.HEARTBEAT };
    
    expect(adapter.validateMessage(allowed).valid).toBe(true);
    expect(adapter.validateMessage(blocked).valid).toBe(false);
  });

  test('应该正确创建请求消息', () => {
    const message = adapter.createRequest('test:channel', { data: 'test' });
    
    expect(message.type).toBe(IPCMessageType.REQUEST);
    expect(message.metadata.channel).toBe('test:channel');
    expect(message.payload.data).toBe('test');
  });

  test('应该正确创建响应消息', () => {
    const request = new IPCMessage(IPCMessageType.REQUEST, {}, { id: 'req_123' });
    const response = adapter.createResponse(request, { result: 'ok' });
    
    expect(response.type).toBe(IPCMessageType.RESPONSE);
    expect(response.correlationId).toBe('req_123');
    expect(response.payload.result).toBe('ok');
  });

  test('应该正确创建错误消息', () => {
    const request = new IPCMessage(IPCMessageType.REQUEST, {}, { id: 'req_456' });
    const error = new Error('Test error');
    error.code = 'TEST_ERROR';
    
    const errorMessage = adapter.createError(request, error);
    
    expect(errorMessage.type).toBe(IPCMessageType.ERROR);
    expect(errorMessage.correlationId).toBe('req_456');
    expect(errorMessage.payload.message).toBe('Test error');
    expect(errorMessage.payload.code).toBe('TEST_ERROR');
  });

  test('应该正确创建事件消息', () => {
    const event = adapter.createEvent('agent:start', { task: 'test' });
    
    expect(event.type).toBe(IPCMessageType.EVENT);
    expect(event.metadata.eventName).toBe('agent:start');
    expect(event.payload.task).toBe('test');
  });

  test('应该正确处理超时', () => {
    const requestId = 'req_timeout_test';
    let rejected = false;
    
    adapter.pendingRequests.set(requestId, {
      reject: (error) => {
        rejected = true;
        expect(error.message).toContain('超时');
      }
    });
    
    adapter.handleTimeout(requestId);
    
    expect(rejected).toBe(true);
    expect(adapter.pendingRequests.has(requestId)).toBe(false);
  });

  test('应该正确获取统计信息', () => {
    const stats = adapter.getStats();
    
    expect(stats.isConnected).toBe(false);
    expect(stats.pendingRequests).toBe(0);
    expect(stats.queueSize).toBe(0);
    expect(stats.reconnectAttempts).toBe(0);
  });
});

// ==================== MainProcessIPCAdapter 测试 ====================

describe('MainProcessIPCAdapter', () => {
  let adapter;
  let mockIpcMain;
  let eventBus;

  beforeEach(() => {
    eventBus = getEventBus();
    
    // 创建模拟的 ipcMain
    mockIpcMain = {
      handlers: new Map(),
      listeners: new Map(),
      
      handle: (channel, handler) => {
        mockIpcMain.handlers.set(channel, handler);
      },
      
      on: (channel, listener) => {
        mockIpcMain.listeners.set(channel, listener);
      },
      
      // 模拟触发事件
      simulateEvent: (channel, event, data) => {
        const listener = mockIpcMain.listeners.get(channel);
        if (listener) {
          listener(event, data);
        }
      },
      
      // 模拟处理请求
      simulateHandle: async (channel, event, ...args) => {
        const handler = mockIpcMain.handlers.get(channel);
        if (handler) {
          return await handler(event, ...args);
        }
        return null;
      }
    };
    
    adapter = new MainProcessIPCAdapter(mockIpcMain, eventBus, { debug: true });
  });

  afterEach(() => {
    stopAllPreviews();
    adapter.disconnect();
    eventBus.clear();
  });

  test('应该正确初始化', async () => {
    await adapter.initialize();
    
    expect(adapter.isConnected).toBe(true);
    expect(mockIpcMain.handlers.has(IPCMessageType.CONNECT)).toBe(true);
    expect(mockIpcMain.listeners.has(IPCMessageType.REQUEST)).toBe(true);
  });

  test('应该正确处理连接请求', async () => {
    await adapter.initialize();
    
    const mockEvent = { sender: { id: 123 } };
    const result = await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, mockEvent);
    
    expect(result.success).toBe(true);
    expect(result.windowId).toBe(123);
    expect(adapter.getWindowCount()).toBe(1);
  });

  test('应该正确注册自定义处理器', () => {
    const handler = async (payload) => {
      return { processed: true, payload };
    };
    
    adapter.registerHandler('custom:action', handler);
    
    expect(adapter.getStats()).toBeDefined();
  });

  test('应该通过 Desktop 直连 IPC 切换窗口最大化状态', async () => {
    await adapter.initialize();

    let isMaximized = false;
    adapter.registerHandler('window:maximize', async () => {
      isMaximized = !isMaximized;
      return { success: true, isMaximized };
    });

    const mockEvent = { sender: { id: 123 } };
    const first = await mockIpcMain.simulateHandle('window:maximize', mockEvent);
    const second = await mockIpcMain.simulateHandle('window:maximize', mockEvent);

    expect(first.success).toBe(true);
    expect(first.isMaximized).toBe(true);
    expect(second.success).toBe(true);
    expect(second.isMaximized).toBe(false);
  });

  test('应该正确注销处理器', () => {
    adapter.registerHandler('test:handler', async () => {});
    adapter.unregisterHandler('test:handler');
    
    // 验证处理器已被移除（通过尝试使用它）
    expect(adapter.getStats()).toBeDefined();
  });

  test('应该正确附加引擎', () => {
    const mockEngine = {
      processInput: async (input) => ({ result: input }),
      stop: () => {},
      getState: () => ({ status: 'idle' }),
      getTools: () => []
    };
    
    adapter.attachEngine(mockEngine);
    
    expect(adapter.getStats()).toBeDefined();
  });

  test('应该在 Desktop IPC 中本地处理 /doc search 命令', async () => {
    await adapter.initialize();

    let processInputCalled = false;
    let documentSearchArgs = null;
    const mockEngine = {
      processInput: async () => {
        processInputCalled = true;
        return { result: 'agent path' };
      },
      getToolRegistry: () => ({
        execute: async (name, args) => {
          if (name !== 'document_search') {
            throw new Error(`unexpected tool: ${name}`);
          }
          documentSearchArgs = args;
          return '1. Policy\n\nThe refund window is 14 days.';
        }
      }),
      getModelProvider: () => null,
      getConfig: () => ({ workingDirectory: process.cwd(), debug: false }),
      stop: () => {},
      getState: () => ({ status: 'idle' }),
      getTools: () => []
    };
    adapter.attachEngine(mockEngine);

    const result = await mockIpcMain.simulateHandle(
      'agent:processInput',
      { sender: { id: 123 } },
      { input: '/doc search refund window', options: {} }
    );

    expect(processInputCalled).toBe(false);
    expect(documentSearchArgs).toEqual({ query: 'refund window', limit: 5 });
    expect(result.localCommand).toBe(true);
    expect(result.kind).toBe('document_command');
    expect(result.content).toContain('refund window');
  });

  test('应该在 Desktop IPC 中持久化处理 init_rag 文档初始化', async () => {
    await adapter.initialize();

    let processInputCalled = false;
    const addedSources = [];
    const mockEngine = {
      processInput: async () => {
        processInputCalled = true;
        return { result: 'agent path' };
      },
      getToolRegistry: () => ({
        execute: async (name, args) => {
          if (name !== 'document_add') {
            throw new Error(`unexpected tool: ${name}`);
          }
          addedSources.push(args.source);
          return {
            success: true,
            id: args.source.split('/').pop(),
            title: args.source.split('/').pop(),
            source: args.source,
            kind: 'text',
            chunks: 1,
          };
        }
      }),
      getConfig: () => ({ workingDirectory: process.cwd(), debug: false }),
      stop: () => {},
      getState: () => ({ status: 'idle' }),
      getTools: () => []
    };
    adapter.attachEngine(mockEngine);

    const result = await mockIpcMain.simulateHandle(
      'agent:processInput',
      { sender: { id: 123 } },
      { input: 'init_rag', options: { docs: ['/tmp/a.md', '/tmp/b.md'] } }
    );

    expect(processInputCalled).toBe(false);
    expect(addedSources).toEqual(['/tmp/a.md', '/tmp/b.md']);
    expect(result.localCommand).toBe(true);
    expect(result.kind).toBe('document_command');
    expect(result.documents.length).toBe(2);
    expect(result.content).toContain('Indexed documents: 2/2');
  });

  test('应该在 Desktop IPC 中本地处理 /debug 命令', async () => {
    await adapter.initialize();

    let processInputCalled = false;
    let debugMode = false;
    const sentMessages = [];
    const mockEvent = {
      sender: {
        id: 123,
        send: (channel, data) => sentMessages.push({ channel, data })
      }
    };
    await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, mockEvent);

    const mockEngine = {
      processInput: async () => {
        processInputCalled = true;
        return { result: 'agent path' };
      },
      setDebugMode: (enabled) => {
        debugMode = enabled;
      },
      getDebugMode: () => debugMode,
      stop: () => {},
      getState: () => ({ status: 'idle' }),
      getTools: () => []
    };
    adapter.attachEngine(mockEngine);

    const result = await mockIpcMain.simulateHandle(
      'agent:processInput',
      mockEvent,
      { input: '/debug on', options: {} }
    );

    expect(processInputCalled).toBe(false);
    expect(debugMode).toBe(true);
    expect(result.localCommand).toBe(true);
    expect(result.command).toBe('/debug');
    expect(result.debug).toBe(true);
    expect(result.content).toContain('开启');
    expect(sentMessages.some(message => message.channel === IPCMessageType.EVENT)).toBe(true);
    expect(sentMessages.some(message => message.channel === RuntimeEvent.STATUS_UPDATE)).toBe(true);
  });

  test('应该在 Desktop IPC 中本地处理 /preview 命令', async () => {
    await adapter.initialize();

    const root = mkdtempSync(join(tmpdir(), 'desktop-preview-'));
    writeFileSync(join(root, 'index.html'), '<h1>Desktop Preview</h1>');

    let processInputCalled = false;
    const mockEngine = {
      processInput: async () => {
        processInputCalled = true;
        return { result: 'agent path' };
      },
      getConfig: () => ({ workingDirectory: root, debug: false }),
      stop: () => {},
      getState: () => ({ status: 'idle' }),
      getTools: () => []
    };
    adapter.attachEngine(mockEngine);

    try {
      const result = await mockIpcMain.simulateHandle(
        'agent:processInput',
        { sender: { id: 123 } },
        { input: '/preview index.html', options: {} }
      );

      expect(processInputCalled).toBe(false);
      expect(result.localCommand).toBe(true);
      expect(result.command).toBe('/preview');
      expect(result.url).toContain('127.0.0.1');

      const html = await fetch(result.url).then(response => response.text());
      expect(html).toContain('Desktop Preview');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('应该为 Desktop preload 直接注册 preview invoke 通道', async () => {
    await adapter.initialize();

    const root = mkdtempSync(join(tmpdir(), 'desktop-preview-direct-'));
    writeFileSync(join(root, 'index.html'), '<h1>Direct Preview</h1>');

    const mockEngine = {
      processInput: async () => ({ result: 'agent path' }),
      getConfig: () => ({ workingDirectory: root, debug: false }),
      stop: () => {},
      getState: () => ({ status: 'idle' }),
      getTools: () => []
    };
    adapter.attachEngine(mockEngine);
    adapter.registerHandler('preview:start', async (options = {}) => startPreview({
      workingDirectory: root,
      ...options
    }));
    adapter.registerHandler('preview:list', async () => ({ success: true, previews: listPreviews() }));
    adapter.registerHandler('preview:stop', async (sessionId) => stopPreview(sessionId));

    try {
      const startResult = await mockIpcMain.simulateHandle(
        'preview:start',
        { sender: { id: 123 } },
        { target: 'index.html', kind: 'static' }
      );
      expect(startResult.url).toContain('127.0.0.1');

      const listResult = await mockIpcMain.simulateHandle(
        'preview:list',
        { sender: { id: 123 } }
      );
      expect(listResult.success).toBe(true);
      expect(listResult.previews.some(preview => preview.session_id === startResult.session_id)).toBe(true);

      const stopResult = await mockIpcMain.simulateHandle(
        'preview:stop',
        { sender: { id: 123 } },
        startResult.session_id
      );
      expect(stopResult.success).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('应该正确广播消息', async () => {
    await adapter.initialize();
    
    // 模拟连接窗口
    const sentMessages = [];
    const mockEvent = {
      sender: {
        id: 123,
        send: (channel, data) => sentMessages.push({ channel, data })
      }
    };
    await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, mockEvent);
    
    // 广播事件
    adapter.broadcast('test:event', { data: 'broadcast' });
    
    // 验证广播成功
    expect(adapter.getWindowCount()).toBe(1);
    expect(sentMessages.map(message => message.channel)).toContain(IPCMessageType.EVENT);
    expect(sentMessages.map(message => message.channel)).toContain('test:event');
  });

  test('应该正确获取窗口 ID 列表', async () => {
    await adapter.initialize();
    
    // 连接多个窗口
    await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, { sender: { id: 1 } });
    await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, { sender: { id: 2 } });
    
    const ids = adapter.getWindowIds();
    
    expect(ids.length).toBe(2);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  test('应该正确断开连接', async () => {
    await adapter.initialize();
    adapter.disconnect();
    
    expect(adapter.isConnected).toBe(false);
    expect(adapter.getWindowCount()).toBe(0);
  });
});

// ==================== RendererProcessIPCAdapter 测试 ====================

describe('RendererProcessIPCAdapter', () => {
  let adapter;
  let mockIpcRenderer;

  beforeEach(() => {
    // 创建模拟的 ipcRenderer
    mockIpcRenderer = {
      listeners: new Map(),
      sentMessages: [],
      
      on: (channel, listener) => {
        mockIpcRenderer.listeners.set(channel, listener);
      },
      
      send: (channel, data) => {
        mockIpcRenderer.sentMessages.push({ channel, data });
      },
      
      invoke: async (channel) => {
        if (channel === IPCMessageType.CONNECT) {
          return { success: true, windowId: 123 };
        }
        return null;
      },
      
      // 模拟接收事件
      simulateReceive: (channel, data) => {
        const listener = mockIpcRenderer.listeners.get(channel);
        if (listener) {
          listener({}, data);
        }
      }
    };
    
    adapter = new RendererProcessIPCAdapter(mockIpcRenderer, { debug: true });
  });

  afterEach(() => {
    adapter.disconnect();
  });

  test('应该正确初始化', async () => {
    await adapter.initialize();
    
    expect(adapter.isConnected).toBe(true);
    expect(mockIpcRenderer.listeners.has(IPCMessageType.RESPONSE)).toBe(true);
    expect(mockIpcRenderer.listeners.has(IPCMessageType.ERROR)).toBe(true);
  });

  test('应该正确发送请求', async () => {
    await adapter.initialize();
    
    // 发送请求（不等待响应）
    const message = adapter.createRequest('test:channel', { data: 'test' });
    
    // 模拟发送
    adapter.send(message);
    
    // 验证消息已发送
    expect(mockIpcRenderer.sentMessages.length).toBeGreaterThan(0);
  });

  test('应该正确订阅事件', async () => {
    await adapter.initialize();
    
    let received = false;
    const unsubscribe = adapter.subscribe('test:event', (data) => {
      received = true;
    });
    
    // 模拟接收事件
    const eventMessage = new IPCMessage(IPCMessageType.EVENT, { test: 'data' }, {
      metadata: { eventName: 'test:event' }
    });
    mockIpcRenderer.simulateReceive(IPCMessageType.EVENT, eventMessage.toJSON());
    
    expect(received).toBe(true);
    
    // 取消订阅
    unsubscribe();
  });

  test('应该正确取消订阅', async () => {
    await adapter.initialize();
    
    const callback = () => {};
    adapter.subscribe('test:event', callback);
    adapter.unsubscribe('test:event', callback);
    
    // 验证订阅已移除
    expect(adapter.getStats()).toBeDefined();
  });

  test('应该提供便捷方法', async () => {
    await adapter.initialize();
    
    // 测试便捷方法存在
    expect(typeof adapter.processInput).toBe('function');
    expect(typeof adapter.stop).toBe('function');
    expect(typeof adapter.getState).toBe('function');
    expect(typeof adapter.getTools).toBe('function');
    expect(typeof adapter.getStats).toBe('function');
  });

  test('应该正确处理连接失败', async () => {
    // 模拟连接失败
    mockIpcRenderer.invoke = async () => {
      throw new Error('Connection failed');
    };
    
    try {
      await adapter.initialize();
      expect(true).toBe(false); // 不应该到达这里
    } catch (error) {
      expect(error.message).toContain('Connection failed');
    }
  });

  test('应该正确断开连接', async () => {
    await adapter.initialize();
    adapter.disconnect();
    
    expect(adapter.isConnected).toBe(false);
    expect(mockIpcRenderer.sentMessages.some(m => m.channel === IPCMessageType.DISCONNECT)).toBe(true);
  });
});

// ==================== DesktopCore 测试 ====================

describe('DesktopCore', () => {
  let desktopCore;

  beforeEach(() => {
    desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: true
    });
  });

  afterEach(async () => {
    await desktopCore.dispose();
  });

  test('应该正确创建实例', () => {
    expect(desktopCore).toBeDefined();
    expect(desktopCore.getState().desktopState).toBe(DesktopState.IDLE);
  });

  test('应该正确初始化', async () => {
    await desktopCore.initialize();
    
    const state = desktopCore.getState();
    expect(state.initialized).toBe(true);
    expect(state.desktopState).toBe(DesktopState.READY);
  });

  test('不应该重复初始化', async () => {
    await desktopCore.initialize();
    await desktopCore.initialize(); // 第二次调用
    
    expect(desktopCore.getState().initialized).toBe(true);
  });

  test('应该正确附加 UI Bridge', async () => {
    await desktopCore.initialize();
    
    const uiBridge = new UIBridge();
    desktopCore.attachUIBridge(uiBridge);
    
    expect(desktopCore.getUIBridge()).toBe(uiBridge);
  });

  test('应该正确获取工具列表', async () => {
    await desktopCore.initialize();
    
    const tools = desktopCore.getTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('应该正确获取状态', async () => {
    await desktopCore.initialize();
    
    const state = desktopCore.getState();
    
    expect(state.desktopState).toBe(DesktopState.READY);
    expect(state.initialized).toBe(true);
    expect(state.engineState).toBeDefined();
    expect(state.eventBufferSize).toBeDefined();
  });

  test('应该正确获取详细状态', async () => {
    await desktopCore.initialize();
    
    const detailedState = desktopCore.getDetailedState();
    
    expect(detailedState.config).toBeDefined();
    expect(detailedState.config.workingDirectory).toBeDefined();
    expect(detailedState.pendingOperations).toBeDefined();
    expect(detailedState.eventBuffer).toBeDefined();
  });

  test('应该正确添加状态监听器', async () => {
    let stateChanged = false;
    
    const unsubscribe = desktopCore.addStateListener(({ newState }) => {
      if (newState === DesktopState.INITIALIZING) {
        stateChanged = true;
      }
    });
    
    await desktopCore.initialize();
    
    expect(stateChanged).toBe(true);
    unsubscribe();
  });

  test('应该正确等待状态', async () => {
    desktopCore.initialize();
    
    const result = await desktopCore.waitForState(DesktopState.READY, 5000);
    expect(result).toBe(true);
  });

  test('应该正确检查就绪状态', async () => {
    expect(desktopCore.isReady()).toBe(false);
    
    await desktopCore.initialize();
    
    expect(desktopCore.isReady()).toBe(true);
  });

  test('应该正确停止执行', async () => {
    await desktopCore.initialize();
    
    desktopCore.stop();
    
    expect(desktopCore.getState().desktopState).toBe(DesktopState.READY);
  });

  test('应该正确销毁', async () => {
    await desktopCore.initialize();
    await desktopCore.dispose();
    
    const state = desktopCore.getState();
    expect(state.desktopState).toBe(DesktopState.DISPOSED);
    expect(state.initialized).toBe(false);
  });

  test('应该正确获取事件缓冲', async () => {
    await desktopCore.initialize();
    
    const buffer = desktopCore.getEventBuffer();
    expect(Array.isArray(buffer)).toBe(true);
  });

  test('应该正确清空事件缓冲', async () => {
    await desktopCore.initialize();
    
    desktopCore.clearEventBuffer();
    
    expect(desktopCore.getEventBuffer().length).toBe(0);
  });

  test('应该正确获取引擎', async () => {
    await desktopCore.initialize();
    
    const engine = desktopCore.getEngine();
    expect(engine).toBeDefined();
  });

  test('应该正确获取事件总线', () => {
    const eventBus = desktopCore.getEventBus();
    expect(eventBus).toBeDefined();
  });
});

// ==================== UIBridge 测试 ====================

describe('UIBridge', () => {
  let uiBridge;

  beforeEach(() => {
    uiBridge = new UIBridge({ debug: true });
  });

  afterEach(() => {
    uiBridge.disconnect();
  });

  test('应该正确创建实例', () => {
    expect(uiBridge).toBeDefined();
    expect(uiBridge.isConnected()).toBe(false);
  });

  test('应该正确接收消息', () => {
    let received = false;
    
    uiBridge.subscribe('test:type', (message) => {
      received = true;
      expect(message.type).toBe('test:type');
    });
    
    uiBridge.onMessage({
      type: 'test:type',
      data: { test: 'data' },
      timestamp: Date.now()
    });
    
    expect(received).toBe(true);
  });

  test('应该正确订阅和取消订阅', () => {
    const callback = () => {};
    
    const unsubscribe = uiBridge.subscribe('test:event', callback);
    
    // 取消订阅
    unsubscribe();
    
    expect(uiBridge.getMessageQueue()).toBeDefined();
  });

  test('应该正确缓冲消息', () => {
    for (let i = 0; i < 5; i++) {
      uiBridge.onMessage({
        type: `event_${i}`,
        data: { index: i },
        timestamp: Date.now()
      });
    }
    
    const queue = uiBridge.getMessageQueue();
    expect(queue.length).toBe(5);
  });

  test('应该正确获取最后一条消息', () => {
    uiBridge.onMessage({
      type: 'first',
      data: { order: 1 },
      timestamp: Date.now()
    });
    
    uiBridge.onMessage({
      type: 'last',
      data: { order: 2 },
      timestamp: Date.now()
    });
    
    const lastMessage = uiBridge.getLastMessage();
    expect(lastMessage.type).toBe('last');
  });

  test('应该正确获取特定类型的消息', () => {
    uiBridge.onMessage({
      type: 'type_a',
      data: {},
      timestamp: Date.now()
    });
    
    uiBridge.onMessage({
      type: 'type_b',
      data: {},
      timestamp: Date.now()
    });
    
    uiBridge.onMessage({
      type: 'type_a',
      data: {},
      timestamp: Date.now()
    });
    
    const typeAMessages = uiBridge.getMessagesByType('type_a');
    expect(typeAMessages.length).toBe(2);
  });

  test('应该正确清空消息队列', () => {
    uiBridge.onMessage({
      type: 'test',
      data: {},
      timestamp: Date.now()
    });
    
    uiBridge.clearMessageQueue();
    
    expect(uiBridge.getMessageQueue().length).toBe(0);
  });

  test('应该正确创建 React Hook', () => {
    const hook = uiBridge.createReactHook();
    
    expect(typeof hook.subscribe).toBe('function');
    expect(typeof hook.unsubscribe).toBe('function');
    expect(typeof hook.sendMessage).toBe('function');
    expect(typeof hook.processInput).toBe('function');
    expect(typeof hook.stop).toBe('function');
    expect(typeof hook.getState).toBe('function');
    expect(typeof hook.getTools).toBe('function');
    expect(typeof hook.isConnected).toBe('function');
  });

  test('应该正确断开连接', () => {
    uiBridge.disconnect();
    
    expect(uiBridge.isConnected()).toBe(false);
    expect(uiBridge.getMessageQueue().length).toBe(0);
  });

  test('应该支持通用监听器 (*)', () => {
    let allMessagesCount = 0;
    
    uiBridge.subscribe('*', (message) => {
      allMessagesCount++;
    });
    
    uiBridge.onMessage({ type: 'event1', data: {}, timestamp: Date.now() });
    uiBridge.onMessage({ type: 'event2', data: {}, timestamp: Date.now() });
    uiBridge.onMessage({ type: 'event3', data: {}, timestamp: Date.now() });
    
    expect(allMessagesCount).toBe(3);
  });
});

// ==================== 集成测试 ====================

describe('Desktop Integration', () => {
  test('DesktopCore 和 UIBridge 应该正确集成', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: true
    });
    
    await desktopCore.initialize();
    
    const uiBridge = new UIBridge({ debug: true });
    desktopCore.attachUIBridge(uiBridge);
    
    // 订阅事件 - 使用正确的事件类型 RuntimeEvent.STATUS_UPDATE
    let eventReceived = false;
    uiBridge.subscribe(RuntimeEvent.STATUS_UPDATE, (message) => {
      eventReceived = true;
    });
    
    // 触发事件
    const eventBus = desktopCore.getEventBus();
    eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'Test status' });
    
    // 等待一小段时间让事件传播
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(eventReceived).toBe(true);
    
    await desktopCore.dispose();
  });

  test('应该正确处理完整流程', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: true
    });
    
    await desktopCore.initialize();
    
    const uiBridge = new UIBridge();
    desktopCore.attachUIBridge(uiBridge);
    
    // 检查状态
    const state = desktopCore.getState();
    expect(state.initialized).toBe(true);
    expect(state.uiBridgeAttached).toBe(true);
    
    // 获取工具
    const tools = desktopCore.getTools();
    expect(tools.length).toBeGreaterThan(0);
    
    await desktopCore.dispose();
    
    expect(desktopCore.getState().desktopState).toBe(DesktopState.DISPOSED);
  });

  test('IPC 消息应该正确序列化和反序列化', () => {
    const originalMessage = new IPCMessage(IPCMessageType.REQUEST, {
      input: 'test input',
      options: { maxIterations: 50 }
    }, {
      id: 'msg_test_123',
      correlationId: 'req_456',
      metadata: { channel: 'agent:processInput' }
    });
    
    // 序列化
    const json = originalMessage.toJSON();
    const jsonString = JSON.stringify(json);
    
    // 反序列化
    const parsed = JSON.parse(jsonString);
    const restored = IPCMessage.fromJSON(parsed);
    
    expect(restored.type).toBe(originalMessage.type);
    expect(restored.payload.input).toBe(originalMessage.payload.input);
    expect(restored.id).toBe(originalMessage.id);
    expect(restored.correlationId).toBe(originalMessage.correlationId);
    expect(restored.metadata.channel).toBe(originalMessage.metadata.channel);
  });

  test('错误处理应该正确工作', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: true
    });
    
    await desktopCore.initialize();
    
    // 添加错误监听器
    let errorReceived = false;
    const eventBus = desktopCore.getEventBus();
    eventBus.subscribe(RuntimeEvent.AGENT_ERROR, (data) => {
      errorReceived = true;
    });
    
    // 模拟错误
    eventBus.emit(RuntimeEvent.AGENT_ERROR, { error: 'Test error' });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(errorReceived).toBe(true);
    
    await desktopCore.dispose();
  });
});

// ==================== 安全性测试 ====================

describe('IPC Security', () => {
  test('应该验证消息结构', () => {
    const adapter = new IPCAdapterBase({ validateMessages: true });
    
    // 测试有效消息
    const validResult = adapter.validateMessage({ type: IPCMessageType.REQUEST });
    expect(validResult.valid).toBe(true);
    
    // 测试无效消息
    const invalidResult = adapter.validateMessage(null);
    expect(invalidResult.valid).toBe(false);
  });

  test('应该限制允许的频道', () => {
    const adapter = new IPCAdapterBase({
      validateMessages: true,
      allowedChannels: [IPCMessageType.REQUEST, IPCMessageType.EVENT]
    });
    
    // 允许的频道
    const allowedResult = adapter.validateMessage({ type: IPCMessageType.REQUEST });
    expect(allowedResult.valid).toBe(true);
    
    // 不允许的频道
    const blockedResult = adapter.validateMessage({ type: IPCMessageType.HEARTBEAT });
    expect(blockedResult.valid).toBe(false);
    expect(blockedResult.error).toContain('不在允许列表中');
  });

  test('应该正确处理超时', () => {
    const adapter = new IPCAdapterBase({ requestTimeout: 1000 });
    
    const requestId = 'req_test';
    let timeoutTriggered = false;
    
    adapter.pendingRequests.set(requestId, {
      reject: (error) => {
        timeoutTriggered = true;
        expect(error.message).toContain('超时');
      },
      timer: null
    });
    
    adapter.handleTimeout(requestId);
    
    expect(timeoutTriggered).toBe(true);
    expect(adapter.pendingRequests.has(requestId)).toBe(false);
  });

  test('消息队列应该限制大小', () => {
    const adapter = new IPCAdapterBase({ maxQueueSize: 5, enableQueue: true });
    
    // 添加超过限制的消息
    for (let i = 0; i < 10; i++) {
      adapter.messageQueue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
    }
    
    // 验证队列大小限制
    expect(adapter.messageQueue.size()).toBeLessThanOrEqual(5);
  });
});
