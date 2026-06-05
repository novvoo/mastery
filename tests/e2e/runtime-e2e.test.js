/**
 * 端到端测试文件
 * 测试完整的 Runtime 流程、CLI 适配器、Desktop IPC 适配器、插件系统和事件系统
 */

import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { 
  createAgentEngine, 
  RuntimeConfig, 
  RuntimeEvent, 
  getEventBus, 
  resetEventBus 
} from '../../src/runtime/index.js';
import { 
  PlatformType, 
  AgentState, 
  ToolDefinition, 
  ToolGroup, 
  MiddlewareDefinition 
} from '../../src/runtime/types.js';
import { 
  HOOKS, 
  HookPriority, 
  PluginState, 
  createPlugin, 
  LoggerPlugin, 
  PerformancePlugin,
  PluginManager 
} from '../../src/runtime/plugin-system.js';
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

// ==================== Runtime 完整流程测试 ====================

describe('Runtime 完整流程端到端测试', () => {
  let engine;
  let testDir;
  let eventBus;
  let capturedEvents;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = `/tmp/runtime-e2e-test-${Date.now()}`;
    
    // 重置事件总线并获取新实例
    resetEventBus();
    eventBus = getEventBus();
    
    // 捕获所有事件用于验证
    capturedEvents = [];
    eventBus.subscribe('*', (event) => {
      capturedEvents.push(event);
    });
  });

  afterEach(async () => {
    // 清理引擎
    if (engine) {
      await engine.dispose();
      engine = null;
    }
    
    // 清理事件总线
    resetEventBus();
    capturedEvents = [];
  });

  describe('完整生命周期流程', () => {
    it('应该完成完整的初始化 -> 工具注册 -> 执行 -> 清理流程', async () => {
      // 步骤 1: 创建引擎
      engine = createAgentEngine({
        platform: PlatformType.CLI,
        workingDirectory: testDir,
        debug: true,
        maxIterations: 10,
        hookTimeout: 3000
      });
      
      expect(engine).toBeDefined();
      expect(engine.isInitialized()).toBe(false);
      
      // 步骤 2: 初始化引擎
      await engine.initialize();
      
      expect(engine.isInitialized()).toBe(true);
      expect(engine.getToolRegistry()).toBeDefined();
      expect(engine.getMemoryManager()).toBeDefined();
      expect(engine.getSecurityPolicy()).toBeDefined();
      expect(engine.getPluginManager()).toBeDefined();
      
      // 验证初始化事件
      const initEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.STATUS_UPDATE && 
        (e.status === 'initializing' || e.status === 'ready')
      );
      expect(initEvents.length).toBeGreaterThanOrEqual(2);
      
      // 步骤 3: 注册自定义工具
      const customTool = {
        name: 'e2e_test_tool',
        description: '端到端测试工具',
        category: 'Test',
        parameters: {
          input: { type: 'string', description: '测试输入' }
        },
        required: ['input'],
        handler: async (args) => {
          return { result: `处理结果: ${args.input}`, timestamp: Date.now() };
        }
      };
      
      engine.registerTool(customTool);
      
      const tools = engine.getTools();
      expect(tools.some(t => t.name === 'e2e_test_tool')).toBe(true);
      
      // 验证工具注册事件
      const toolRegisterEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.TOOL_LOADED
      );
      expect(toolRegisterEvents.length).toBeGreaterThan(0);
      
      // 步骤 4: 注册插件
      const testPlugin = createPlugin({
        name: 'e2e-test-plugin',
        version: '1.0.0',
        description: '端到端测试插件',
        hooks: {
          [HOOKS.BEFORE_AGENT_START]: async (input) => {
            console.log('[E2E Plugin] Agent 启动前，输入:', input);
          },
          [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
            console.log('[E2E Plugin] Agent 完成后，结果:', result);
          },
          [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
            console.log('[E2E Plugin] 工具调用前:', toolName);
          },
          [HOOKS.AFTER_TOOL_CALL]: async (toolName, result) => {
            console.log('[E2E Plugin] 工具调用后:', toolName);
          }
        }
      });
      
      await engine.registerPlugin(testPlugin);
      
      const pluginManager = engine.getPluginManager();
      expect(pluginManager.getPluginCount()).toBe(1);
      
      // 步骤 5: 添加中间件
      const middlewareCalls = [];
      engine.addToolMiddleware({
        name: 'e2e-tracking-middleware',
        priority: HookPriority.HIGH,
        before: async (ctx) => {
          middlewareCalls.push({ phase: 'before', tool: ctx.toolName });
          ctx.metadata.startTime = Date.now();
        },
        after: async (ctx) => {
          middlewareCalls.push({ phase: 'after', tool: ctx.toolName });
          ctx.metadata.duration = Date.now() - ctx.metadata.startTime;
        }
      });
      
      // 步骤 6: 创建工具分组
      engine.createToolGroup('e2e-test-group', {
        description: '端到端测试工具分组',
        priority: 100
      });
      
      const groups = engine.getToolGroups();
      expect(groups.some(g => g.name === 'e2e-test-group')).toBe(true);
      
      // 步骤 7: 验证状态
      const state = engine.getState();
      expect(state.status).toBe('idle');
      
      // 步骤 8: 清理
      await engine.dispose();
      
      expect(engine.isInitialized()).toBe(false);
      
      // 验证清理事件
      const disposeEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.AGENT_STOP
      );
      expect(disposeEvents.length).toBeGreaterThan(0);
      
      // 验证插件已清理
      expect(pluginManager.getPluginCount()).toBe(0);
    });

    it('应该正确处理多个工具的注册和执行', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册多个工具
      const tools = [
        {
          name: 'multi_tool_1',
          description: '第一个多工具测试',
          category: 'Test',
          parameters: { input: { type: 'string' } },
          handler: async (args) => `tool1: ${args.input}`
        },
        {
          name: 'multi_tool_2',
          description: '第二个多工具测试',
          category: 'Test',
          parameters: { input: { type: 'string' } },
          handler: async (args) => `tool2: ${args.input}`
        },
        {
          name: 'multi_tool_3',
          description: '第三个多工具测试',
          category: 'Test',
          parameters: { input: { type: 'string' } },
          handler: async (args) => `tool3: ${args.input}`
        }
      ];
      
      engine.registerTools(tools);
      
      const registeredTools = engine.getTools();
      expect(registeredTools.some(t => t.name === 'multi_tool_1')).toBe(true);
      expect(registeredTools.some(t => t.name === 'multi_tool_2')).toBe(true);
      expect(registeredTools.some(t => t.name === 'multi_tool_3')).toBe(true);
      
      // 验证工具分组
      const toolsWithGroups = engine.getToolsWithGroups();
      expect(toolsWithGroups.length).toBeGreaterThan(0);
      expect(toolsWithGroups[0].group).toBeDefined();
    });

    it('应该正确处理配置更新流程', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册配置变更监听器
      let configChanged = false;
      engine.registerHook(HOOKS.ON_CONFIG_CHANGE, async (key, value) => {
        configChanged = true;
        expect(key).toBe('maxIterations');
        expect(value).toBe(50);
      });
      
      // 更新配置
      await engine.updateConfig('maxIterations', 50);
      
      expect(configChanged).toBe(true);
      expect(engine.getConfig().maxIterations).toBe(50);
      
      // 验证配置变更事件
      const configEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.CONFIG_CHANGE
      );
      expect(configEvents.length).toBe(1);
    });

    it('应该正确处理内存更新流程', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册内存更新监听器
      let memoryUpdated = false;
      engine.registerHook(HOOKS.ON_MEMORY_UPDATE, async (operation, data) => {
        memoryUpdated = true;
        expect(operation).toBe('add');
      });
      
      // 更新内存
      await engine.updateMemory('add', { key: 'test_key', value: 'test_value' });
      
      expect(memoryUpdated).toBe(true);
      
      // 验证内存更新事件
      const memoryEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.MEMORY_UPDATE
      );
      expect(memoryEvents.length).toBe(1);
    });
  });

  describe('错误处理流程', () => {
    it('应该正确处理工具执行错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册会失败的工具
      const failingTool = {
        name: 'failing_tool',
        description: '会失败的测试工具',
        category: 'Test',
        parameters: {},
        handler: async () => {
          throw new Error('工具执行失败');
        }
      };
      
      engine.registerTool(failingTool);
      
      // 注册错误监听器
      let errorCaught = false;
      engine.registerHook(HOOKS.ON_TOOL_ERROR, async (toolName, error) => {
        errorCaught = true;
        expect(toolName).toBe('failing_tool');
        expect(error.message).toBe('工具执行失败');
      });
      
      // 尝试执行工具（通过工具注册表）
      const registry = engine.getToolRegistry();
      
      try {
        await registry.execute('failing_tool', {});
      } catch (error) {
        expect(error.message).toBe('工具执行失败');
      }
      
      expect(errorCaught).toBe(true);
      
      // 验证错误事件
      const errorEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.TOOL_ERROR
      );
      expect(errorEvents.length).toBeGreaterThan(0);
    });

    it('应该正确处理插件初始化错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 创建会失败的插件
      const failingPlugin = createPlugin({
        name: 'failing-plugin',
        initialize: () => {
          throw new Error('插件初始化失败');
        }
      });
      
      // 尝试注册插件
      try {
        await engine.registerPlugin(failingPlugin);
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('插件初始化失败');
      }
      
      // 验证插件未注册
      const pluginManager = engine.getPluginManager();
      expect(pluginManager.getPlugin('failing-plugin')).toBeUndefined();
    });

    it('应该正确处理模型提供者缺失错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 尝试在没有模型提供者的情况下处理输入
      try {
        await engine.processInput('测试输入');
        expect.fail('应该抛出错误');
      } catch (error) {
        const hasKeyword = error.message.includes('Model provider') || 
                           error.message.includes('模型提供者');
        expect(hasKeyword).toBe(true);
      }
    });
  });

  describe('状态管理流程', () => {
    it('应该正确管理引擎状态转换', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      
      // 初始状态
      expect(engine.getState().status).toBe('idle');
      
      // 初始化后
      await engine.initialize();
      expect(engine.isInitialized()).toBe(true);
      
      // 停止后
      await engine.stop();
      expect(engine.getState().status).toBe('idle');
      
      // 销毁后
      await engine.dispose();
      expect(engine.isInitialized()).toBe(false);
    });

    it('应该正确追踪状态变更事件', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      
      // 初始化
      await engine.initialize();
      
      // 检查状态更新事件
      const statusEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.STATUS_UPDATE
      );
      
      expect(statusEvents.length).toBeGreaterThan(0);
      
      // 验证状态序列
      const statusSequence = statusEvents.map(e => e.status);
      expect(statusSequence).toContain('initializing');
      expect(statusSequence).toContain('ready');
    });
  });
});

// ==================== CLI 适配器完整流程测试 ====================

describe('CLI 适配器完整流程端到端测试', () => {
  let eventBus;
  let capturedEvents;

  beforeEach(() => {
    resetEventBus();
    eventBus = getEventBus();
    capturedEvents = [];
    eventBus.subscribe('*', (event) => {
      capturedEvents.push(event);
    });
  });

  afterEach(() => {
    resetEventBus();
    capturedEvents = [];
  });

  describe('CLIUIAdapter 完整流程', () => {
    it('应该完成完整的 UI 适配器生命周期', async () => {
      // 创建模拟 UI
      const mockUI = {
        messages: [],
        showBanner: () => mockUI.messages.push({ type: 'banner' }),
        showResult: (result) => mockUI.messages.push({ type: 'result', content: result }),
        showError: (error) => mockUI.messages.push({ type: 'error', content: error }),
        info: (msg) => mockUI.messages.push({ type: 'info', content: msg }),
        success: (msg) => mockUI.messages.push({ type: 'success', content: msg }),
        error: (msg) => mockUI.messages.push({ type: 'error', content: msg }),
        debugEvent: (name, data) => mockUI.messages.push({ type: 'debug', name, data }),
        theme: { dim: (t) => t }
      };
      
      // 导入 CLIUIAdapter
      const { CLIUIAdapter } = await import('../../src/adapters/cli/index.js');
      
      // 创建适配器
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      
      // 附加到事件总线
      adapter.attach();
      
      // 验证订阅
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_COMPLETE)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_ERROR)).toBe(1);
      
      // 发送各种事件
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '测试任务' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '信息消息', level: 'info' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '成功消息', level: 'success' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '错误消息', level: 'error' });
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'test_tool', args: {} });
      eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result: '测试结果' });
      eventBus.emit(RuntimeEvent.AGENT_ERROR, { error: '测试错误' });
      
      // 验证消息处理
      expect(mockUI.messages.length).toBeGreaterThan(0);
      expect(mockUI.messages.some(m => m.type === 'banner')).toBe(true);
      expect(mockUI.messages.some(m => m.type === 'result')).toBe(true);
      expect(mockUI.messages.some(m => m.type === 'info')).toBe(true);
      expect(mockUI.messages.some(m => m.type === 'success')).toBe(true);
      expect(mockUI.messages.some(m => m.type === 'error')).toBe(true);
      
      // 分离适配器
      adapter.detach();
      
      // 验证取消订阅
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(0);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_COMPLETE)).toBe(0);
    });

    it('应该正确处理多个适配器实例', async () => {
      const { CLIUIAdapter } = await import('../../src/adapters/cli/index.js');
      
      const mockUI1 = { 
        messages: [], 
        info: (m) => mockUI1.messages.push(m),
        success: (m) => mockUI1.messages.push(m),
        error: (m) => mockUI1.messages.push(m),
        theme: { dim: (t) => t }
      };
      
      const mockUI2 = { 
        messages: [], 
        info: (m) => mockUI2.messages.push(m),
        success: (m) => mockUI2.messages.push(m),
        error: (m) => mockUI2.messages.push(m),
        theme: { dim: (t) => t }
      };
      
      const adapter1 = new CLIUIAdapter(eventBus, mockUI1);
      const adapter2 = new CLIUIAdapter(eventBus, mockUI2);
      
      adapter1.attach();
      adapter2.attach();
      
      // 验证两个订阅者
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(2);
      
      // 发送事件
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '共享消息', level: 'info' });
      
      // 两个适配器都应该收到
      expect(mockUI1.messages.length).toBeGreaterThan(0);
      expect(mockUI2.messages.length).toBeGreaterThan(0);
      
      // 分离第一个
      adapter1.detach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      
      // 分离第二个
      adapter2.detach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(0);
    });
  });
});

// ==================== Desktop IPC 适配器完整流程测试 ====================

describe('Desktop IPC 适配器完整流程端到端测试', () => {
  let eventBus;
  let capturedEvents;

  beforeEach(() => {
    resetEventBus();
    eventBus = getEventBus();
    capturedEvents = [];
    eventBus.subscribe('*', (event) => {
      capturedEvents.push(event);
    });
  });

  afterEach(() => {
    resetEventBus();
    capturedEvents = [];
  });

  describe('IPC 消息完整流程', () => {
    it('应该完成完整的 IPC 消息生命周期', async () => {
      // 创建消息
      const request = new IPCMessage(IPCMessageType.REQUEST, {
        action: 'test',
        data: { input: '测试数据' }
      }, {
        metadata: { channel: 'test:channel' }
      });
      
      // 验证消息创建
      expect(request.type).toBe(IPCMessageType.REQUEST);
      expect(request.id).toMatch(/^msg_/);
      expect(request.status).toBe(IPCMessageStatus.PENDING);
      
      // 序列化
      const json = request.toJSON();
      const jsonString = JSON.stringify(json);
      
      // 反序列化
      const parsed = JSON.parse(jsonString);
      const restored = IPCMessage.fromJSON(parsed);
      
      // 验证完整性
      expect(restored.type).toBe(request.type);
      expect(restored.payload.action).toBe(request.payload.action);
      expect(restored.id).toBe(request.id);
      expect(restored.metadata.channel).toBe(request.metadata.channel);
      
      // 更新状态
      request.status = IPCMessageStatus.SUCCESS;
      expect(request.status).toBe(IPCMessageStatus.SUCCESS);
    });

    it('应该正确处理请求-响应流程', async () => {
      const adapter = new IPCAdapterBase({ debug: true });
      
      // 创建请求
      const request = adapter.createRequest('test:action', { param: 'value' });
      
      expect(request.type).toBe(IPCMessageType.REQUEST);
      expect(request.metadata.channel).toBe('test:action');
      
      // 创建响应
      const response = adapter.createResponse(request, { result: 'success' });
      
      expect(response.type).toBe(IPCMessageType.RESPONSE);
      expect(response.correlationId).toBe(request.id);
      expect(response.payload.result).toBe('success');
      
      // 创建错误响应
      const error = new Error('测试错误');
      error.code = 'TEST_ERROR';
      
      const errorMessage = adapter.createError(request, error);
      
      expect(errorMessage.type).toBe(IPCMessageType.ERROR);
      expect(errorMessage.correlationId).toBe(request.id);
      expect(errorMessage.payload.message).toBe('测试错误');
      expect(errorMessage.payload.code).toBe('TEST_ERROR');
    });
  });

  describe('主进程 IPC 适配器完整流程', () => {
    it('应该完成完整的主进程 IPC 生命周期', async () => {
      // 创建模拟的 ipcMain
      const mockIpcMain = {
        handlers: new Map(),
        listeners: new Map(),
        
        handle: (channel, handler) => {
          mockIpcMain.handlers.set(channel, handler);
        },
        
        on: (channel, listener) => {
          mockIpcMain.listeners.set(channel, listener);
        },
        
        simulateHandle: async (channel, event) => {
          const handler = mockIpcMain.handlers.get(channel);
          if (handler) {
            return await handler(event);
          }
          return null;
        }
      };
      
      // 创建适配器
      const adapter = new MainProcessIPCAdapter(mockIpcMain, eventBus, { debug: true });
      
      // 初始化
      await adapter.initialize();
      
      expect(adapter.isConnected).toBe(true);
      
      // 模拟窗口连接
      const mockEvent1 = { sender: { id: 1 } };
      const mockEvent2 = { sender: { id: 2 } };
      
      await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, mockEvent1);
      await mockIpcMain.simulateHandle(IPCMessageType.CONNECT, mockEvent2);
      
      expect(adapter.getWindowCount()).toBe(2);
      
      // 注册自定义处理器
      let customHandlerCalled = false;
      adapter.registerHandler('custom:action', async (payload) => {
        customHandlerCalled = true;
        return { processed: true, payload };
      });
      
      // 广播事件
      adapter.broadcast('test:event', { data: 'broadcast' });
      
      // 获取窗口列表
      const windowIds = adapter.getWindowIds();
      expect(windowIds.length).toBe(2);
      expect(windowIds).toContain(1);
      expect(windowIds).toContain(2);
      
      // 断开连接
      adapter.disconnect();
      
      expect(adapter.isConnected).toBe(false);
      expect(adapter.getWindowCount()).toBe(0);
    });

    it('应该正确处理引擎附加和事件转发', async () => {
      const mockIpcMain = {
        handlers: new Map(),
        listeners: new Map(),
        handle: (channel, handler) => mockIpcMain.handlers.set(channel, handler),
        on: (channel, listener) => mockIpcMain.listeners.set(channel, listener)
      };
      
      const adapter = new MainProcessIPCAdapter(mockIpcMain, eventBus, { debug: true });
      await adapter.initialize();
      
      // 创建模拟引擎
      const mockEngine = {
        processInput: async (input) => ({ result: input }),
        stop: () => {},
        getState: () => ({ status: 'idle' }),
        getTools: () => [{ name: 'test_tool' }]
      };
      
      // 附加引擎
      adapter.attachEngine(mockEngine);
      
      // 发送事件
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '测试任务' });
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'test_tool', args: {} });
      
      // 验证事件被捕获
      const agentEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.AGENT_START
      );
      expect(agentEvents.length).toBe(1);
      
      adapter.disconnect();
    });
  });

  describe('渲染进程 IPC 适配器完整流程', () => {
    it('应该完成完整的渲染进程 IPC 生命周期', async () => {
      // 创建模拟的 ipcRenderer
      const mockIpcRenderer = {
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
        
        simulateReceive: (channel, data) => {
          const listener = mockIpcRenderer.listeners.get(channel);
          if (listener) {
            listener({}, data);
          }
        }
      };
      
      // 创建适配器
      const adapter = new RendererProcessIPCAdapter(mockIpcRenderer, { debug: true });
      
      // 初始化
      await adapter.initialize();
      
      expect(adapter.isConnected).toBe(true);
      
      // 订阅事件
      let eventReceived = false;
      const unsubscribe = adapter.subscribe('test:event', (data) => {
        eventReceived = true;
        expect(data.test).toBe('data');
      });
      
      // 模拟接收事件
      const eventMessage = new IPCMessage(IPCMessageType.EVENT, { test: 'data' }, {
        metadata: { eventName: 'test:event' }
      });
      mockIpcRenderer.simulateReceive(IPCMessageType.EVENT, eventMessage.toJSON());
      
      expect(eventReceived).toBe(true);
      
      // 发送请求
      const request = adapter.createRequest('agent:processInput', { input: '测试' });
      adapter.send(request);
      
      expect(mockIpcRenderer.sentMessages.length).toBeGreaterThan(0);
      
      // 取消订阅
      unsubscribe();
      
      // 断开连接
      adapter.disconnect();
      
      expect(adapter.isConnected).toBe(false);
    });
  });

  describe('DesktopCore 完整流程', () => {
    it('应该完成完整的 Desktop Core 生命周期', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: true
      });
      
      // 初始状态
      expect(desktopCore.getState().desktopState).toBe(DesktopState.IDLE);
      expect(desktopCore.isReady()).toBe(false);
      
      // 初始化
      await desktopCore.initialize();
      
      expect(desktopCore.isReady()).toBe(true);
      expect(desktopCore.getState().desktopState).toBe(DesktopState.READY);
      
      // 附加 UI Bridge
      const uiBridge = new UIBridge({ debug: true });
      desktopCore.attachUIBridge(uiBridge);
      
      expect(desktopCore.getUIBridge()).toBe(uiBridge);
      
      // 获取工具
      const tools = desktopCore.getTools();
      expect(tools.length).toBeGreaterThan(0);
      
      // 获取状态
      const state = desktopCore.getState();
      expect(state.initialized).toBe(true);
      expect(state.uiBridgeAttached).toBe(true);
      
      // 添加状态监听器
      let stateChanged = false;
      const unsubscribe = desktopCore.addStateListener(({ newState }) => {
        if (newState === DesktopState.DISPOSED) {
          stateChanged = true;
        }
      });
      
      // 停止
      desktopCore.stop();
      
      // 销毁
      await desktopCore.dispose();
      
      expect(desktopCore.getState().desktopState).toBe(DesktopState.DISPOSED);
      expect(stateChanged).toBe(true);
      
      unsubscribe();
    });

    it('应该正确处理事件缓冲和转发', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: true
      });
      
      await desktopCore.initialize();
      
      const uiBridge = new UIBridge({ debug: true });
      desktopCore.attachUIBridge(uiBridge);
      
      // 订阅事件
      let eventsReceived = 0;
      uiBridge.subscribe(RuntimeEvent.STATUS_UPDATE, (message) => {
        eventsReceived++;
      });
      
      // 发送多个事件
      const eventBus = desktopCore.getEventBus();
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '消息1' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '消息2' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '消息3' });
      
      // 等待事件传播
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(eventsReceived).toBe(3);
      
      // 检查事件缓冲
      const buffer = desktopCore.getEventBuffer();
      expect(buffer.length).toBeGreaterThan(0);
      
      // 清空缓冲
      desktopCore.clearEventBuffer();
      expect(desktopCore.getEventBuffer().length).toBe(0);
      
      await desktopCore.dispose();
    });
  });
});

// ==================== 插件系统完整流程测试 ====================

describe('插件系统完整流程端到端测试', () => {
  let engine;
  let testDir;
  let eventBus;

  beforeEach(() => {
    testDir = `/tmp/plugin-e2e-test-${Date.now()}`;
    resetEventBus();
    eventBus = getEventBus();
  });

  afterEach(async () => {
    if (engine) {
      await engine.dispose();
      engine = null;
    }
    resetEventBus();
  });

  describe('插件生命周期完整流程', () => {
    it('应该完成完整的插件注册 -> 初始化 -> 启用/禁用 -> 注销流程', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const pluginManager = engine.getPluginManager();
      
      // 步骤 1: 创建插件
      const lifecyclePlugin = createPlugin({
        name: 'lifecycle-test-plugin',
        version: '1.0.0',
        description: '生命周期测试插件',
        
        defaultConfig: {
          enabled: true,
          logLevel: 'info'
        },
        
        initialize({ config, eventBus }) {
          this.config = config;
          this.eventBus = eventBus;
          this.initialized = true;
          console.log('[Lifecycle Plugin] 初始化完成');
        },
        
        cleanup() {
          this.initialized = false;
          console.log('[Lifecycle Plugin] 清理完成');
        },
        
        hooks: {
          [HOOKS.BEFORE_AGENT_START]: async (input) => {
            console.log('[Lifecycle Plugin] Agent 启动前');
          },
          [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
            console.log('[Lifecycle Plugin] Agent 完成后');
          }
        }
      });
      
      // 步骤 2: 注册插件
      await engine.registerPlugin(lifecyclePlugin);
      
      expect(pluginManager.getPluginCount()).toBe(1);
      
      const pluginInfo = pluginManager.getPlugin('lifecycle-test-plugin');
      expect(pluginInfo).toBeDefined();
      expect(pluginInfo.state).toBe(PluginState.ACTIVE);
      expect(pluginInfo.enabled).toBe(true);
      
      // 步骤 3: 禁用插件
      await pluginManager.disable('lifecycle-test-plugin');
      
      const disabledInfo = pluginManager.getPlugin('lifecycle-test-plugin');
      expect(disabledInfo.state).toBe(PluginState.DISABLED);
      expect(disabledInfo.enabled).toBe(false);
      
      // 步骤 4: 启用插件
      await pluginManager.enable('lifecycle-test-plugin');
      
      const enabledInfo = pluginManager.getPlugin('lifecycle-test-plugin');
      expect(enabledInfo.state).toBe(PluginState.ACTIVE);
      expect(enabledInfo.enabled).toBe(true);
      
      // 步骤 5: 注销插件
      await engine.unregisterPlugin('lifecycle-test-plugin');
      
      expect(pluginManager.getPluginCount()).toBe(0);
      expect(pluginManager.getPlugin('lifecycle-test-plugin')).toBeUndefined();
    });

    it('应该正确处理插件依赖关系', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const pluginManager = engine.getPluginManager();
      
      // 创建基础插件
      const basePlugin = createPlugin({
        name: 'base-plugin',
        version: '1.0.0',
        description: '基础插件',
        
        initialize() {
          this.ready = true;
        }
      });
      
      // 创建依赖插件
      const dependentPlugin = createPlugin({
        name: 'dependent-plugin',
        version: '1.0.0',
        description: '依赖插件',
        dependencies: ['base-plugin'],
        
        initialize({ getPlugin }) {
          const base = getPlugin('base-plugin');
          expect(base).toBeDefined();
          this.basePluginReady = base.plugin.ready;
        }
      });
      
      // 注册基础插件
      await engine.registerPlugin(basePlugin);
      
      // 注册依赖插件
      await engine.registerPlugin(dependentPlugin);
      
      expect(pluginManager.getPluginCount()).toBe(2);
      
      // 尝试注销基础插件（应该失败，因为有依赖）
      try {
        await engine.unregisterPlugin('base-plugin');
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('依赖');
      }
      
      // 先注销依赖插件
      await engine.unregisterPlugin('dependent-plugin');
      
      // 再注销基础插件
      await engine.unregisterPlugin('base-plugin');
      
      expect(pluginManager.getPluginCount()).toBe(0);
    });

    it('应该正确处理插件配置', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 创建带配置的插件
      const configurablePlugin = createPlugin({
        name: 'configurable-plugin',
        version: '1.0.0',
        
        defaultConfig: {
          timeout: 5000,
          retries: 3,
          debug: false
        },
        
        configSchema: {
          timeout: { type: 'number', required: true },
          retries: { type: 'number', enum: [1, 2, 3, 5, 10] },
          debug: { type: 'boolean' }
        },
        
        initialize({ config }) {
          this.timeout = config.get('timeout');
          this.retries = config.get('retries');
          this.debug = config.get('debug');
        }
      });
      
      // 注册插件（使用自定义配置）
      await engine.registerPlugin(configurablePlugin, {
        config: {
          timeout: 10000,
          retries: 5
        }
      });
      
      const pluginInfo = engine.getPluginManager().getPlugin('configurable-plugin');
      
      // 验证配置
      const config = pluginInfo.config;
      expect(config.get('timeout')).toBe(10000);
      expect(config.get('retries')).toBe(5);
      expect(config.get('debug')).toBe(false); // 默认值
      
      // 验证配置
      const validation = config.validate();
      expect(validation.valid).toBe(true);
      
      await engine.unregisterPlugin('configurable-plugin');
    });
  });

  describe('钩子系统完整流程', () => {
    it('应该按优先级顺序执行钩子', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const hookCalls = [];
      
      // 注册不同优先级的钩子
      engine.registerHook(HOOKS.BEFORE_AGENT_START, async (input) => {
        hookCalls.push({ priority: 'low', order: hookCalls.length });
      }, { priority: HookPriority.LOW });
      
      engine.registerHook(HOOKS.BEFORE_AGENT_START, async (input) => {
        hookCalls.push({ priority: 'normal', order: hookCalls.length });
      }, { priority: HookPriority.NORMAL });
      
      engine.registerHook(HOOKS.BEFORE_AGENT_START, async (input) => {
        hookCalls.push({ priority: 'high', order: hookCalls.length });
      }, { priority: HookPriority.HIGH });
      
      engine.registerHook(HOOKS.BEFORE_AGENT_START, async (input) => {
        hookCalls.push({ priority: 'highest', order: hookCalls.length });
      }, { priority: HookPriority.HIGHEST });
      
      // 手动触发钩子
      await engine.getPluginManager().triggerHook(HOOKS.BEFORE_AGENT_START, 'test');
      
      // 验证执行顺序（优先级高的先执行）
      expect(hookCalls[0].priority).toBe('highest');
      expect(hookCalls[1].priority).toBe('high');
      expect(hookCalls[2].priority).toBe('normal');
      expect(hookCalls[3].priority).toBe('low');
    });

    it('应该正确处理一次性钩子', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      let callCount = 0;
      
      // 注册一次性钩子
      engine.registerHook(HOOKS.ON_CONFIG_CHANGE, async (key, value) => {
        callCount++;
      }, { once: true });
      
      // 第一次触发
      await engine.updateConfig('testKey', 'value1');
      expect(callCount).toBe(1);
      
      // 第二次触发（不应该执行）
      await engine.updateConfig('testKey', 'value2');
      expect(callCount).toBe(1); // 仍然是 1
    });

    it('应该正确处理钩子错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册会失败的钩子
      engine.registerHook(HOOKS.BEFORE_AGENT_START, async () => {
        throw new Error('钩子执行失败');
      });
      
      // 注册正常钩子
      let normalHookCalled = false;
      engine.registerHook(HOOKS.BEFORE_AGENT_START, async () => {
        normalHookCalled = true;
      });
      
      // 触发钩子（错误不应该阻止其他钩子）
      const result = await engine.getPluginManager().triggerHook(HOOKS.BEFORE_AGENT_START, 'test');
      
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].error.message).toBe('钩子执行失败');
      expect(normalHookCalled).toBe(true);
    });
  });

  describe('中间件完整流程', () => {
    it('应该按优先级执行中间件', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const middlewareCalls = [];
      
      // 添加不同优先级的中间件
      engine.addToolMiddleware({
        name: 'low-middleware',
        priority: HookPriority.LOW,
        before: async (ctx) => {
          middlewareCalls.push({ name: 'low', phase: 'before', order: middlewareCalls.length });
        },
        after: async (ctx) => {
          middlewareCalls.push({ name: 'low', phase: 'after', order: middlewareCalls.length });
        }
      });
      
      engine.addToolMiddleware({
        name: 'high-middleware',
        priority: HookPriority.HIGH,
        before: async (ctx) => {
          middlewareCalls.push({ name: 'high', phase: 'before', order: middlewareCalls.length });
        },
        after: async (ctx) => {
          middlewareCalls.push({ name: 'high', phase: 'after', order: middlewareCalls.length });
        }
      });
      
      // 注册测试工具
      engine.registerTool({
        name: 'middleware_test_tool',
        description: '中间件测试工具',
        category: 'Test',
        parameters: {},
        handler: async () => 'result'
      });
      
      // 执行工具
      const registry = engine.getToolRegistry();
      await registry.execute('middleware_test_tool', {});
      
      // 验证执行顺序
      // before: high -> low
      // after: low -> high（反向）
      expect(middlewareCalls[0]).toEqual({ name: 'high', phase: 'before', order: 0 });
      expect(middlewareCalls[1]).toEqual({ name: 'low', phase: 'before', order: 1 });
      expect(middlewareCalls[2]).toEqual({ name: 'low', phase: 'after', order: 2 });
      expect(middlewareCalls[3]).toEqual({ name: 'high', phase: 'after', order: 3 });
    });

    it('应该正确处理中间件错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      let errorHandled = false;
      
      // 添加错误处理中间件
      engine.addToolMiddleware({
        name: 'error-handler-middleware',
        priority: HookPriority.HIGHEST,
        error: async (error, ctx) => {
          errorHandled = true;
          console.log('[Error Middleware] 捕获错误:', error.message);
        }
      });
      
      // 注册会失败的工具
      engine.registerTool({
        name: 'failing_middleware_tool',
        description: '会失败的中间件测试工具',
        category: 'Test',
        parameters: {},
        handler: async () => {
          throw new Error('工具执行失败');
        }
      });
      
      // 执行工具
      const registry = engine.getToolRegistry();
      
      try {
        await registry.execute('failing_middleware_tool', {});
      } catch (error) {
        // 预期的错误
      }
      
      expect(errorHandled).toBe(true);
    });
  });

  describe('工具分组完整流程', () => {
    it('应该正确管理工具分组', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 创建自定义分组
      engine.createToolGroup('custom-group-1', {
        description: '第一个自定义分组',
        priority: 10
      });
      
      engine.createToolGroup('custom-group-2', {
        description: '第二个自定义分组',
        priority: 20
      });
      
      // 注册工具到分组
      const groups = engine.getPluginManager().getToolGroups();
      
      groups.addToGroup('custom-group-1', 'read_file');
      groups.addToGroup('custom-group-1', 'write_file');
      groups.addToGroup('custom-group-2', 'execute_shell');
      
      // 验证分组
      const allGroups = engine.getToolGroups();
      expect(allGroups.some(g => g.name === 'custom-group-1')).toBe(true);
      expect(allGroups.some(g => g.name === 'custom-group-2')).toBe(true);
      
      // 验证分组中的工具
      const group1Tools = engine.getGroupTools('custom-group-1');
      expect(group1Tools.length).toBeGreaterThan(0);
      
      // 验证工具分组信息
      const toolsWithGroups = engine.getToolsWithGroups();
      const readFileTool = toolsWithGroups.find(t => t.name === 'read_file');
      expect(readFileTool?.group).toBe('custom-group-1');
      
      // 禁用分组
      groups.setGroupEnabled('custom-group-1', false);
      expect(groups.isGroupEnabled('custom-group-1')).toBe(false);
      
      // 启用分组
      groups.setGroupEnabled('custom-group-1', true);
      expect(groups.isGroupEnabled('custom-group-1')).toBe(true);
      
      // 删除分组
      groups.deleteGroup('custom-group-2');
      expect(groups.getAllGroups().some(g => g.name === 'custom-group-2')).toBe(false);
    });
  });

  describe('内置插件测试', () => {
    it('应该正确使用 LoggerPlugin', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册 LoggerPlugin
      await engine.registerPlugin(LoggerPlugin);
      
      const pluginInfo = engine.getPluginManager().getPlugin('logger');
      expect(pluginInfo).toBeDefined();
      expect(pluginInfo.name).toBe('logger');
      expect(pluginInfo.state).toBe(PluginState.ACTIVE);
      
      // 触发一些事件
      await engine.getPluginManager().triggerHook(HOOKS.BEFORE_AGENT_START, '测试输入');
      await engine.getPluginManager().triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test_tool', {});
      
      await engine.unregisterPlugin('logger');
    });

    it('应该正确使用 PerformancePlugin', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 注册 PerformancePlugin
      await engine.registerPlugin(PerformancePlugin);
      
      const pluginInfo = engine.getPluginManager().getPlugin('performance');
      expect(pluginInfo).toBeDefined();
      expect(pluginInfo.name).toBe('performance');
      
      // 触发性能追踪钩子
      await engine.getPluginManager().triggerHook(HOOKS.BEFORE_AGENT_START, '测试');
      await engine.getPluginManager().triggerHook(HOOKS.AFTER_AGENT_COMPLETE, { result: '完成' });
      
      await engine.unregisterPlugin('performance');
    });
  });
});

// ==================== 事件系统完整流程测试 ====================

describe('事件系统完整流程端到端测试', () => {
  let eventBus;

  beforeEach(() => {
    resetEventBus();
    eventBus = getEventBus();
  });

  afterEach(() => {
    resetEventBus();
  });

  describe('事件订阅和发射完整流程', () => {
    it('应该完成完整的事件订阅 -> 发射 -> 取消订阅流程', async () => {
      const eventsReceived = [];
      
      // 订阅多个事件
      const unsub1 = eventBus.subscribe(RuntimeEvent.AGENT_START, (data) => {
        eventsReceived.push({ type: 'start', data });
      });
      
      const unsub2 = eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, (data) => {
        eventsReceived.push({ type: 'complete', data });
      });
      
      const unsub3 = eventBus.subscribe(RuntimeEvent.TOOL_CALL, (data) => {
        eventsReceived.push({ type: 'tool', data });
      });
      
      // 验证订阅者数量
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_COMPLETE)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(1);
      
      // 发射事件
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '任务1' });
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'tool1', args: {} });
      eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result: '结果1' });
      
      // 验证事件接收
      expect(eventsReceived.length).toBe(3);
      expect(eventsReceived[0].type).toBe('start');
      expect(eventsReceived[1].type).toBe('tool');
      expect(eventsReceived[2].type).toBe('complete');
      
      // 取消订阅
      unsub1();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(0);
      
      unsub2();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_COMPLETE)).toBe(0);
      
      unsub3();
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(0);
      
      // 再次发射事件（不应该被接收）
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '任务2' });
      expect(eventsReceived.length).toBe(3); // 仍然是 3
    });

    it('应该正确处理优先级订阅', async () => {
      const executionOrder = [];
      
      // 按不同优先级订阅同一事件
      eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, () => {
        executionOrder.push('low');
      }, { priority: 'low' });
      
      eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, () => {
        executionOrder.push('medium');
      }, { priority: 'medium' });
      
      eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, () => {
        executionOrder.push('high');
      }, { priority: 'high' });
      
      // 发射事件
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '测试' });
      
      // 验证执行顺序（高优先级先执行）
      expect(executionOrder).toEqual(['high', 'medium', 'low']);
    });

    it('应该正确处理异步事件', async () => {
      const asyncResults = [];
      
      // 订阅异步处理
      eventBus.subscribe(RuntimeEvent.AGENT_START, async (data) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        asyncResults.push({ type: 'async1', data });
      });
      
      eventBus.subscribe(RuntimeEvent.AGENT_START, async (data) => {
        await new Promise(resolve => setTimeout(resolve, 30));
        asyncResults.push({ type: 'async2', data });
      });
      
      // 异步发射事件
      await eventBus.emitAsync(RuntimeEvent.AGENT_START, { task: '异步任务' });
      
      // 验证异步处理完成
      expect(asyncResults.length).toBe(2);
    });
  });

  describe('事件历史和回放', () => {
    it('应该正确记录和查询事件历史', async () => {
      // 发射多个事件
      for (let i = 0; i < 10; i++) {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: `消息${i}`, index: i });
      }
      
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '任务' });
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'tool' });
      
      // 获取历史记录
      const history = eventBus.getHistory();
      expect(history.length).toBeGreaterThan(0);
      
      // 按类型过滤
      const statusHistory = eventBus.getHistory({ type: RuntimeEvent.STATUS_UPDATE });
      expect(statusHistory.length).toBe(10);
      
      // 按数量限制
      const limitedHistory = eventBus.getHistory({ limit: 5 });
      expect(limitedHistory.length).toBe(5);
      
      // 清除历史
      eventBus.clearHistory();
      expect(eventBus.getHistory().length).toBe(0);
    });

    it('应该正确回放事件历史', async () => {
      const replayedEvents = [];
      
      // 发射一些事件
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '任务1' });
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'tool1' });
      eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result: '结果1' });
      
      // 订阅回放
      eventBus.subscribe('*', (event) => {
        if (event.replay) {
          replayedEvents.push(event);
        }
      });
      
      // 回放历史
      await eventBus.replayHistory({ delay: 10 });
      
      // 验证回放
      expect(replayedEvents.length).toBeGreaterThan(0);
    });
  });

  describe('事件过滤', () => {
    it('应该正确过滤事件', async () => {
      const receivedEvents = [];
      
      // 设置过滤器
      eventBus.setFilter(RuntimeEvent.STATUS_UPDATE, {
        dataFilter: (data) => data.message?.includes('important')
      });
      
      // 订阅事件
      eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
        receivedEvents.push(data);
      });
      
      // 发射事件
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'important消息' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '普通消息' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'another important' });
      
      // 验证过滤结果
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents.every(e => e.message.includes('important'))).toBe(true);
      
      // 移除过滤器
      eventBus.removeFilter(RuntimeEvent.STATUS_UPDATE);
      
      // 再次发射（应该全部接收）
      receivedEvents.length = 0;
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '普通消息' });
      expect(receivedEvents.length).toBe(1);
    });

    it('应该正确设置全局过滤器', async () => {
      const receivedEvents = [];
      
      // 设置全局过滤器（只允许特定来源）
      eventBus.setFilter('*', {
        sources: ['allowed-source']
      });
      
      eventBus.subscribe('*', (data) => {
        receivedEvents.push(data);
      });
      
      // 发射不同来源的事件
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'msg1' }, { source: 'allowed-source' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'msg2' }, { source: 'blocked-source' });
      eventBus.emit(RuntimeEvent.AGENT_START, { task: 'task' }, { source: 'allowed-source' });
      
      // 验证过滤结果
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents.every(e => e.source === 'allowed-source')).toBe(true);
    });
  });

  describe('事件缓存', () => {
    it('应该正确缓存和获取事件', async () => {
      // 发射并缓存事件
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '缓存任务' }, { cache: true });
      
      // 获取缓存的事件
      const cached = eventBus.getCachedEvent(RuntimeEvent.AGENT_START);
      
      expect(cached).toBeDefined();
      expect(cached.task).toBe('缓存任务');
      
      // 验证缓存命中统计
      const stats = eventBus.getStats();
      expect(stats.cachedHits).toBeGreaterThan(0);
      
      // 清除缓存
      eventBus.clearCache();
      expect(eventBus.getCachedEvent(RuntimeEvent.AGENT_START)).toBeNull();
    });
  });

  describe('批量事件处理', () => {
    it('应该正确批量处理事件', async () => {
      // 配置批量处理
      const batchEventBus = new RuntimeEventBus({
        batch: {
          enabled: true,
          batchSize: 5,
          flushInterval: 100
        }
      });
      
      const receivedEvents = [];
      
      batchEventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
        receivedEvents.push(data);
      });
      
      // 发射多个事件
      for (let i = 0; i < 10; i++) {
        batchEventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: `批量${i}` });
      }
      
      // 等待批量处理完成
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 验证批量处理
      expect(receivedEvents.length).toBe(10);
    });
  });

  describe('事件统计', () => {
    it('应该正确追踪事件统计', async () => {
      // 发射多个事件
      for (let i = 0; i < 5; i++) {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: `消息${i}` });
      }
      
      // 设置过滤器并发射被过滤的事件
      eventBus.setFilter(RuntimeEvent.AGENT_START, {
        dataFilter: () => false
      });
      eventBus.emit(RuntimeEvent.AGENT_START, { task: '被过滤' });
      
      // 获取统计
      const stats = eventBus.getStats();
      
      expect(stats.totalEvents).toBeGreaterThan(0);
      expect(stats.filteredEvents).toBeGreaterThan(0);
      expect(stats.subscriberCount).toBeGreaterThan(0);
      
      // 重置统计
      eventBus.resetStats();
      const newStats = eventBus.getStats();
      expect(newStats.totalEvents).toBe(0);
    });
  });

  describe('延迟订阅', () => {
    it('应该正确处理延迟订阅', async () => {
      const receivedEvents = [];
      
      // 创建延迟订阅
      const unsub = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
        receivedEvents.push(data);
      }, { deferred: true });
      
      // 发射事件（延迟订阅不应该接收）
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '早期消息' });
      expect(receivedEvents.length).toBe(0);
      
      // 激活延迟订阅
      eventBus.activateDeferred(RuntimeEvent.STATUS_UPDATE);
      
      // 再次发射事件（应该接收）
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '后期消息' });
      expect(receivedEvents.length).toBe(1);
      
      unsub();
    });
  });
});

// ==================== 集成场景测试 ====================

describe('集成场景端到端测试', () => {
  let engine;
  let testDir;
  let eventBus;
  let desktopCore;
  let uiBridge;

  beforeEach(() => {
    testDir = `/tmp/integration-e2e-test-${Date.now()}`;
    resetEventBus();
    eventBus = getEventBus();
  });

  afterEach(async () => {
    if (engine) {
      await engine.dispose();
      engine = null;
    }
    if (desktopCore) {
      await desktopCore.dispose();
      desktopCore = null;
    }
    resetEventBus();
  });

  describe('Runtime + Desktop Core 集成', () => {
    it('应该完成 Runtime 和 Desktop Core 的完整集成流程', async () => {
      // 创建 Desktop Core
      desktopCore = createDesktopCore({
        workingDirectory: testDir,
        debug: true
      });
      
      await desktopCore.initialize();
      
      // 获取引擎
      engine = desktopCore.getEngine();
      expect(engine).toBeDefined();
      expect(engine.isInitialized()).toBe(true);
      
      // 附加 UI Bridge
      uiBridge = new UIBridge({ debug: true });
      desktopCore.attachUIBridge(uiBridge);
      
      // 注册事件监听
      const uiEvents = [];
      uiBridge.subscribe(RuntimeEvent.STATUS_UPDATE, (message) => {
        uiEvents.push(message);
      });
      
      // 通过引擎触发事件
      const eventBus = desktopCore.getEventBus();
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '集成测试消息' });
      
      // 等待事件传播
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 验证 UI Bridge 接收到事件
      expect(uiEvents.length).toBeGreaterThan(0);
      
      // 验证工具可用
      const tools = desktopCore.getTools();
      expect(tools.length).toBeGreaterThan(0);
      
      // 验证状态同步
      const state = desktopCore.getState();
      expect(state.initialized).toBe(true);
      expect(state.uiBridgeAttached).toBe(true);
    });

    it('应该正确处理 Runtime 和 IPC 的集成', async () => {
      desktopCore = createDesktopCore({
        workingDirectory: testDir,
        debug: true,
        ipc: {
          enabled: true,
          requestTimeout: 5000
        }
      });
      
      await desktopCore.initialize();
      
      // 创建模拟 IPC
      const mockIpcMain = {
        handlers: new Map(),
        listeners: new Map(),
        handle: (channel, handler) => mockIpcMain.handlers.set(channel, handler),
        on: (channel, listener) => mockIpcMain.listeners.set(channel, listener)
      };
      
      // 附加 IPC 适配器
      const ipcAdapter = desktopCore.attachIPCAdapter(mockIpcMain);
      
      expect(ipcAdapter).toBeDefined();
      expect(ipcAdapter.isConnected).toBe(true);
      
      // 模拟窗口连接
      await mockIpcMain.handlers.get(IPCMessageType.CONNECT)({ sender: { id: 1 } });
      
      expect(ipcAdapter.getWindowCount()).toBe(1);
      
      // 验证引擎已附加
      ipcAdapter.attachEngine(desktopCore.getEngine());
      
      // 广播事件
      ipcAdapter.broadcast('test:event', { data: '测试' });
      
      // 验证 IPC 统计
      const stats = ipcAdapter.getStats();
      expect(stats.isConnected).toBe(true);
    });
  });

  describe('Runtime + Plugin + Event 集成', () => {
    it('应该完成 Runtime、插件和事件的完整集成流程', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const capturedEvents = [];
      eventBus.subscribe('*', (event) => {
        capturedEvents.push(event);
      });
      
      // 注册多个插件
      await engine.registerPlugin(LoggerPlugin);
      await engine.registerPlugin(PerformancePlugin);
      
      // 注册自定义插件
      const integrationPlugin = createPlugin({
        name: 'integration-plugin',
        hooks: {
          [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
            eventBus.emit('custom:tool_event', { toolName, phase: 'before' });
          },
          [HOOKS.AFTER_TOOL_CALL]: async (toolName, result) => {
            eventBus.emit('custom:tool_event', { toolName, phase: 'after' });
          }
        }
      });
      
      await engine.registerPlugin(integrationPlugin);
      
      // 注册工具
      engine.registerTool({
        name: 'integration_test_tool',
        description: '集成测试工具',
        category: 'Test',
        parameters: {},
        handler: async () => '集成测试结果'
      });
      
      // 执行工具
      const registry = engine.getToolRegistry();
      await registry.execute('integration_test_tool', {});
      
      // 验证事件流
      const toolEvents = capturedEvents.filter(e => 
        e.type === RuntimeEvent.TOOL_CALL || 
        e.type === RuntimeEvent.TOOL_RESULT ||
        e.type === 'custom:tool_event'
      );
      
      expect(toolEvents.length).toBeGreaterThan(0);
      
      // 验证插件钩子执行
      const pluginManager = engine.getPluginManager();
      const hookInfo = pluginManager.getHookManager().getHookInfo(HOOKS.BEFORE_TOOL_CALL);
      expect(hookInfo.length).toBeGreaterThan(0);
      
      // 清理
      await engine.unregisterPlugin('integration-plugin');
      await engine.unregisterPlugin('logger');
      await engine.unregisterPlugin('performance');
    });
  });

  describe('完整应用场景模拟', () => {
    it('应该模拟完整的桌面应用启动流程', async () => {
      // 步骤 1: 创建 Desktop Core
      desktopCore = createDesktopCore({
        workingDirectory: testDir,
        debug: true,
        maxIterations: 50
      });
      
      // 步骤 2: 初始化
      await desktopCore.initialize();
      
      expect(desktopCore.isReady()).toBe(true);
      
      // 步骤 3: 附加 UI Bridge
      uiBridge = new UIBridge({ debug: true });
      desktopCore.attachUIBridge(uiBridge);
      
      // 步骤 4: 创建 React Hook
      const reactHook = uiBridge.createReactHook();
      
      expect(typeof reactHook.subscribe).toBe('function');
      expect(typeof reactHook.processInput).toBe('function');
      expect(typeof reactHook.getState).toBe('function');
      expect(typeof reactHook.getTools).toBe('function');
      
      // 步骤 5: 获取工具列表
      const tools = reactHook.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      // 步骤 6: 获取状态
      const state = reactHook.getState();
      expect(state).toBeDefined();
      
      // 步骤 7: 订阅状态更新
      const stateUpdates = [];
      reactHook.subscribe(RuntimeEvent.STATUS_UPDATE, (message) => {
        stateUpdates.push(message);
      });
      
      // 步骤 8: 触发事件
      const eventBus = desktopCore.getEventBus();
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '应用就绪' });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(stateUpdates.length).toBeGreaterThan(0);
      
      // 步骤 9: 检查连接状态
      expect(reactHook.isConnected()).toBe(true);
      
      // 步骤 10: 清理
      await desktopCore.dispose();
      
      expect(reactHook.isConnected()).toBe(false);
    });
  });
});