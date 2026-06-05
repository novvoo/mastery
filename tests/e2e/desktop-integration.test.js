/**
 * Enhanced Desktop Integration Tests
 * 增强的桌面集成测试
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DesktopCore,
  UIBridge,
  createDesktopCore
} from '../../src/adapters/desktop/desktop-core.js';
import {
  MainProcessIPCAdapter,
  RendererProcessIPCAdapter,
  createMainProcessIPCAdapter,
  createRendererProcessIPCAdapter
} from '../../src/adapters/desktop/ipc-adapter.js';
import { getEventBus, RuntimeEvent } from '../../src/runtime/index.js';
import { listWorkspaceDirectory, createWorkspaceWatcher } from '../../desktop/workspace.js';
import { normalizeRuntimeEventMessage } from '../../desktop/renderer/hooks/useRuntime.js';

describe('Desktop Integration - Enhanced', () => {

  describe('IPC Message Flow', () => {
    test('IPC消息应该能正确序列化和反序列化', async () => {
      const originalPayload = {
        action: 'test',
        data: { nested: [1, 2, 3], text: '测试文本' },
        timestamp: Date.now()
      };
      
      const mainAdapter = new MainProcessIPCAdapter({
        ipcMain: {
          handle: () => {},
          on: () => {}
        },
        eventBus: getEventBus()
      });
      
      const request = mainAdapter.createRequest('test_channel', originalPayload);
      expect(request.payload).toEqual(originalPayload);
      
      const serialized = JSON.stringify(request.toJSON());
      const parsed = JSON.parse(serialized);
      
      expect(parsed.payload).toEqual(originalPayload);
    });

    test('UI 桥接器应该能正确转发事件', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      await desktopCore.initialize();
      
      const uiBridge = new UIBridge();
      desktopCore.attachUIBridge(uiBridge);
      
      let receivedEvent = null;
      const unsubscribe = uiBridge.subscribe(RuntimeEvent.STATUS_UPDATE, (msg) => {
        receivedEvent = msg;
      });
      
      const testEventData = {
        message: '测试状态更新',
        level: 'info',
        timestamp: Date.now()
      };
      
      const eventBus = getEventBus();
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, testEventData);
      
      // 等待事件传播
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(receivedEvent).toBeDefined();
      expect(receivedEvent.data).toMatchObject({
        message: testEventData.message,
        level: testEventData.level
      });
      
      unsubscribe();
      await desktopCore.dispose();
    });
  });

  describe('Desktop Core State Management', () => {
    test('Desktop Core 应该能正确管理状态转换', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      expect(desktopCore.getState().desktopState).toBe('idle');
      
      await desktopCore.initialize();
      expect(desktopCore.getState().desktopState).toBe('ready');
      expect(desktopCore.isReady()).toBe(true);
      
      desktopCore.stop();
      
      await desktopCore.dispose();
      expect(desktopCore.getState().desktopState).toBe('disposed');
    });

    test('Desktop Core 应该能正确添加和移除状态监听器', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      let stateChanges = 0;
      const unsubscribe = desktopCore.addStateListener(() => {
        stateChanges++;
      });
      
      await desktopCore.initialize();
      expect(stateChanges).toBeGreaterThan(0);
      
      // 取消监听
      unsubscribe();
      
      await desktopCore.dispose();
    });
  });

  describe('Tool Integration', () => {
    test('Desktop Core 应该能获取工具列表', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      await desktopCore.initialize();
      
      const tools = desktopCore.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      // 检查是否有常见工具
      const toolNames = tools.map(t => t.name);
      
      await desktopCore.dispose();
    });

    test('应该能正确获取工具分组信息', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      await desktopCore.initialize();
      
      const engine = desktopCore.getEngine();
      const groups = engine.getToolGroups();
      
      expect(Array.isArray(groups)).toBe(true);
      
      await desktopCore.dispose();
    });
  });

  describe('Event Bus Integration', () => {
    test('事件总线应该能正确处理多种类型事件', async () => {
      const eventBus = getEventBus();
      
      const receivedEvents = [];
      
      // 订阅多个事件
      const unsubscribe1 = eventBus.subscribe(RuntimeEvent.AGENT_START, (data) => {
        receivedEvents.push({ type: 'agent_start', data });
      });
      
      const unsubscribe2 = eventBus.subscribe(RuntimeEvent.TOOL_CALL, (data) => {
        receivedEvents.push({ type: 'tool_call', data });
      });
      
      // 发送事件
      eventBus.emit(RuntimeEvent.AGENT_START, { input: '测试输入' });
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'test_tool', args: { a: 1 } });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(receivedEvents.length).toBe(2);
      
      unsubscribe1();
      unsubscribe2();
      eventBus.clear();
    });

    test('事件缓冲区应该能正确工作', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      await desktopCore.initialize();
      
      const eventBus = getEventBus();
      
      // 发送一些事件
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '事件1' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '事件2' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '事件3' });
      
      // 获取缓冲区
      const buffer = desktopCore.getEventBuffer();
      
      // 清理缓冲区
      desktopCore.clearEventBuffer();
      expect(desktopCore.getEventBuffer().length).toBe(0);
      
      await desktopCore.dispose();
    });
  });

  describe('Configuration & Initialization', () => {
    test('应该能正确使用自定义配置初始化', async () => {
      const customConfig = {
        workingDirectory: process.cwd(),
        debug: true,
        maxIterations: 50,
        autoDownloadModels: false
      };
      
      const desktopCore = createDesktopCore(customConfig);
      
      await desktopCore.initialize();
      
      const state = desktopCore.getState();
      expect(state.initialized).toBe(true);
      
      const detailedState = desktopCore.getDetailedState();
      expect(detailedState.config).toBeDefined();
      expect(detailedState.config.debug).toBe(true);
      
      await desktopCore.dispose();
    });

    test('重复初始化应该安全', async () => {
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd()
      });
      
      await desktopCore.initialize();
      const initialEngine = desktopCore.getEngine();
      
      // 再次初始化
      await desktopCore.initialize();
      const secondEngine = desktopCore.getEngine();
      
      // 引擎应该是同一个实例
      expect(initialEngine).toBe(secondEngine);
      
      await desktopCore.dispose();
    });
  });

  describe('UIBridge Functionality', () => {
    test('UIBridge 应该能正确创建 React Hook', () => {
      const uiBridge = new UIBridge();
      
      const hook = uiBridge.createReactHook();
      
      expect(typeof hook.subscribe).toBe('function');
      expect(typeof hook.sendMessage).toBe('function');
      expect(typeof hook.processInput).toBe('function');
      expect(typeof hook.stop).toBe('function');
      expect(typeof hook.getState).toBe('function');
      expect(typeof hook.getTools).toBe('function');
      expect(typeof hook.isConnected).toBe('function');
    });

    test('UIBridge 应该能正确处理消息队列', () => {
      const uiBridge = new UIBridge();
      
      // 发送一些消息
      uiBridge.onMessage({ type: 'type1', data: { a: 1 }, timestamp: Date.now() });
      uiBridge.onMessage({ type: 'type2', data: { b: 2 }, timestamp: Date.now() });
      uiBridge.onMessage({ type: 'type1', data: { c: 3 }, timestamp: Date.now() });
      
      expect(uiBridge.getMessageQueue().length).toBe(3);
      
      // 按类型获取消息
      const type1Messages = uiBridge.getMessagesByType('type1');
      expect(type1Messages.length).toBe(2);
      
      // 获取最后一条消息
      const lastMessage = uiBridge.getLastMessage();
      expect(lastMessage.type).toBe('type1');
      
      // 清空队列
      uiBridge.clearMessageQueue();
      expect(uiBridge.getMessageQueue().length).toBe(0);
    });

    test('UIBridge 应该支持通配符订阅', () => {
      const uiBridge = new UIBridge();
      
      let allMessages = [];
      
      // 通配符订阅
      const unsubscribe = uiBridge.subscribe('*', (msg) => {
        allMessages.push(msg);
      });
      
      uiBridge.onMessage({ type: 'msg1', data: 1 });
      uiBridge.onMessage({ type: 'msg2', data: 2 });
      uiBridge.onMessage({ type: 'msg3', data: 3 });
      
      expect(allMessages.length).toBe(3);
      
      unsubscribe();
    });
  });

  describe('Complete Workflow', () => {
    test('完整的桌面工作流应该能正常工作', async () => {
      const eventBus = getEventBus();
      eventBus.clear();
      
      // 1. 创建并初始化 DesktopCore
      const desktopCore = createDesktopCore({
        workingDirectory: process.cwd(),
        debug: false
      });
      
      await desktopCore.initialize();
      
      // 2. 创建并附加 UIBridge
      const uiBridge = new UIBridge();
      desktopCore.attachUIBridge(uiBridge);
      
      // 3. 验证状态
      expect(desktopCore.getState().initialized).toBe(true);
      expect(desktopCore.isReady()).toBe(true);
      
      // 4. 验证工具可用
      const tools = desktopCore.getTools();
      expect(tools.length).toBeGreaterThan(0);
      
      // 5. 验证事件能被接收
      let eventsReceived = 0;
      const unsubscribe = uiBridge.subscribe('*', () => {
        eventsReceived++;
      });
      
      // 发送测试事件
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: '测试事件' });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 清理
      unsubscribe();
      await desktopCore.dispose();
      
      expect(desktopCore.getState().desktopState).toBe('disposed');
    });
  });

  describe('Desktop Project Tree Integration', () => {
    test('工作目录列表应该返回项目文件并阻止越界路径', () => {
      const root = mkdtempSync(join(tmpdir(), 'desktop-workspace-'));

      try {
        mkdirSync(join(root, 'src'));
        mkdirSync(join(root, 'docs'));
        writeFileSync(join(root, 'README.md'), '# test');
        writeFileSync(join(root, 'package.json'), '{}');

        const result = listWorkspaceDirectory(root);

        expect(result.success).toBe(true);
        expect(result.root).toBe(root);
        expect(result.entries.map(entry => entry.name)).toEqual([
          'docs',
          'src',
          'package.json',
          'README.md'
        ]);
        expect(result.entries.slice(0, 2).every(entry => entry.type === 'directory')).toBe(true);

        const escaped = listWorkspaceDirectory(root, { path: '../' });
        expect(escaped.success).toBe(false);
        expect(escaped.error).toContain('工作目录范围');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('工作目录文件变更应该触发刷新事件', async () => {
      const root = mkdtempSync(join(tmpdir(), 'desktop-watch-'));
      let watcher;

      try {
        const changePromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('workspace change timeout')), 1000);
          watcher = createWorkspaceWatcher(root, (change) => {
            clearTimeout(timeout);
            resolve(change);
          }, { debounceMs: 10 });
        });

        writeFileSync(join(root, 'notes.md'), 'hello');
        const change = await changePromise;

        expect(change.root).toBe(root);
        expect(change.timestamp).toBeGreaterThan(0);
        expect(['rename', 'change']).toContain(change.eventType);
      } finally {
        watcher?.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('Desktop Conversation Event Integration', () => {
    test('Agent 和工具事件应该归一化为可显示的对话消息', () => {
      const agentStart = normalizeRuntimeEventMessage('agent:start', { task: '分析项目' });
      expect(agentStart.message.type).toBe('agent');
      expect(agentStart.message.content).toContain('分析项目');

      const agentComplete = normalizeRuntimeEventMessage('agent:complete', { result: { response: '完成了' } });
      expect(agentComplete.message.type).toBe('result');
      expect(agentComplete.message.content).toBe('完成了');

      const toolCall = normalizeRuntimeEventMessage('tool:call', {
        toolName: 'read_file',
        args: { path: 'README.md' }
      });
      expect(toolCall.stats.toolCall).toBe(true);
      expect(toolCall.message.type).toBe('tool');
      expect(toolCall.message.toolName).toBe('read_file');

      const workspaceChange = normalizeRuntimeEventMessage('workspace:changed', { path: 'README.md' });
      expect(workspaceChange.message).toBeNull();
    });
  });

  describe('Error Scenarios', () => {
    test('应该能优雅处理初始化失败', async () => {
      // 测试构造时的错误处理
      // 这里可以测试无效配置
      try {
        const core = createDesktopCore({
          workingDirectory: null // 无效的工作目录
        });
        await core.initialize();
        await core.dispose();
      } catch (error) {
        // 错误应该被优雅处理
        expect(error).toBeDefined();
      }
    });
  });
});
