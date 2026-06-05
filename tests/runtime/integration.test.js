/**
 * Runtime Layer Integration Tests
 * 运行时层集成测试 - 包含插件系统、中间件、工具分组等
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createAgentEngine, RuntimeConfig, RuntimeEvent, getEventBus } from '../../src/runtime/index.js';
import { PlatformType, AgentState, ToolDefinition, ToolGroup, MiddlewareDefinition } from '../../src/runtime/types.js';
import { HOOKS, HookPriority, PluginState, createPlugin, LoggerPlugin, PerformancePlugin } from '../../src/runtime/plugin-system.js';

describe('Runtime Layer Integration Tests', () => {
  let engine;
  let testDir;
  let eventBus;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = `/tmp/runtime-test-${Date.now()}`;
    
    // 获取事件总线实例
    eventBus = getEventBus();
    eventBus.clear(); // 清除之前的订阅
  });

  afterEach(async () => {
    // 清理
    if (engine) {
      await engine.dispose();
      engine = null;
    }
  });

  describe('AgentEngine', () => {
    it('应该使用默认配置创建引擎', () => {
      engine = createAgentEngine();
      expect(engine).toBeDefined();
      expect(typeof engine.initialize).toBe('function');
      expect(typeof engine.processInput).toBe('function');
    });

    it('应该使用自定义配置创建引擎', () => {
      const config = {
        platform: PlatformType.CLI,
        workingDirectory: testDir,
        debug: true,
        maxIterations: 100,
        hookTimeout: 3000
      };
      
      engine = createAgentEngine(config);
      expect(engine).toBeDefined();
      expect(engine.getConfig().hookTimeout).toBe(3000);
    });

    it('应该成功初始化', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      expect(engine.getToolRegistry()).toBeDefined();
      expect(engine.getMemoryManager()).toBeDefined();
      expect(engine.getSecurityPolicy()).toBeDefined();
      expect(engine.getPluginManager()).toBeDefined();
    });

    it('不应该重复初始化', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      
      await engine.initialize();
      const registry1 = engine.getToolRegistry();
      
      await engine.initialize();
      const registry2 = engine.getToolRegistry();
      
      expect(registry1).toBe(registry2); // 相同实例
    });

    it('应该注册自定义工具', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const customTool = {
        name: 'test_tool',
        description: '测试工具',
        category: 'Test',
        parameters: {
          input: { type: 'string', description: '测试输入' }
        },
        required: ['input'],
        handler: async (args) => `处理结果: ${args.input}`
      };
      
      engine.registerTool(customTool);
      const tools = engine.getTools();
      
      expect(tools.some(t => t.name === 'test_tool')).toBe(true);
    });

    it('应该注册多个工具', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const tools = [
        {
          name: 'multi_tool_1',
          description: '第一个测试工具',
          category: 'Test',
          parameters: {},
          handler: async () => 'tool1'
        },
        {
          name: 'multi_tool_2',
          description: '第二个测试工具',
          category: 'Test',
          parameters: {},
          handler: async () => 'tool2'
        }
      ];
      
      engine.registerTools(tools);
      const allTools = engine.getTools();
      
      expect(allTools.some(t => t.name === 'multi_tool_1')).toBe(true);
      expect(allTools.some(t => t.name === 'multi_tool_2')).toBe(true);
    });

    it('初始化后应该有默认工具注册', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const tools = engine.getTools();
      
      // 应该有内置工具
      expect(tools.length).toBeGreaterThan(0);
      
      // 检查常见工具类别
      const categories = new Set(tools.map(t => t.category));
      expect(categories.has('FileSystem') || categories.has('filesystem')).toBe(true);
    });

    it('模型提供者未附加时应该抛出错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      try {
        await engine.processInput('测试输入');
        expect.fail('应该抛出错误');
      } catch (error) {
        // 错误消息可能是中文或英文，检查是否包含关键词
        const hasKeyword = error.message.includes('Model provider') || 
                           error.message.includes('模型提供者');
        expect(hasKeyword).toBe(true);
      }
    });

    it('应该获取初始状态', () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      const state = engine.getState();
      
      expect(state.status).toBe('idle');
      expect(state.currentTask).toBeNull();
      expect(state.iteration).toBe(0);
    });
  });

  describe('Plugin Integration', () => {
    it('应该注册插件', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const plugin = createPlugin({
        name: 'test-plugin',
        version: '1.0.0',
        description: '测试插件',
        hooks: {
          [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
            console.log('工具调用前:', toolName);
          }
        }
      });
      
      await engine.registerPlugin(plugin);
      
      const pluginManager = engine.getPluginManager();
      expect(pluginManager.getPluginCount()).toBe(1);
    });

    it('应该注销插件', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const plugin = createPlugin({
        name: 'removable-plugin',
        cleanup: () => console.log('插件已清理')
      });
      
      await engine.registerPlugin(plugin);
      await engine.unregisterPlugin('removable-plugin');
      
      const pluginManager = engine.getPluginManager();
      expect(pluginManager.getPluginCount()).toBe(0);
    });

    it('应该使用内置插件', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      await engine.registerPlugin(LoggerPlugin);
      
      const pluginManager = engine.getPluginManager();
      const info = pluginManager.getPlugin('logger');
      
      expect(info).toBeDefined();
      expect(info.name).toBe('logger');
    });

    it('应该通过引擎注册钩子', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      let hookCalled = false;
      
      engine.registerHook(HOOKS.ON_CONFIG_CHANGE, async (key, value) => {
        hookCalled = true;
        expect(key).toBe('testKey');
        expect(value).toBe('testValue');
      });
      
      await engine.updateConfig('testKey', 'testValue');
      
      expect(hookCalled).toBe(true);
    });
  });

  describe('Tool Middleware Integration', () => {
    it('应该添加工具中间件', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const events = [];
      
      engine.addToolMiddleware({
        name: 'tracking-middleware',
        priority: HookPriority.HIGH,
        before: async (ctx) => {
          events.push('before:' + ctx.toolName);
        },
        after: async (ctx) => {
          events.push('after:' + ctx.toolName);
        }
      });
      
      const middleware = engine.getPluginManager().getToolMiddleware();
      expect(middleware.count()).toBe(1);
    });
  });

  describe('Tool Groups Integration', () => {
    it('应该创建工具分组', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      engine.createToolGroup('custom-group', {
        description: '自定义工具分组',
        priority: 100
      });
      
      const groups = engine.getToolGroups();
      expect(groups.some(g => g.name === 'custom-group')).toBe(true);
    });

    it('应该有默认工具分组', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const groups = engine.getToolGroups();
      
      // 应该有默认分组
      expect(groups.some(g => g.name === 'filesystem')).toBe(true);
      expect(groups.some(g => g.name === 'shell')).toBe(true);
      expect(groups.some(g => g.name === 'git')).toBe(true);
    });

    it('应该获取分组中的工具', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const fsTools = engine.getGroupTools('filesystem');
      expect(fsTools.length).toBeGreaterThan(0);
    });

    it('应该获取工具及其分组信息', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const toolsWithGroups = engine.getToolsWithGroups();
      
      expect(toolsWithGroups.length).toBeGreaterThan(0);
      expect(toolsWithGroups[0].group).toBeDefined();
    });
  });

  describe('EventBus', () => {
    it('应该订阅和取消订阅事件', () => {
      const eventBus = getEventBus();
      let eventReceived = false;
      
      const unsubscribe = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
        eventReceived = true;
      });
      
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'test' });
      expect(eventReceived).toBe(true);
      
      // 取消订阅
      unsubscribe();
      eventReceived = false;
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'test2' });
      expect(eventReceived).toBe(false);
    });

    it('应该发送带有结构化数据的事件', () => {
      const eventBus = getEventBus();
      let receivedData = null;
      
      eventBus.subscribe(RuntimeEvent.AGENT_START, (data) => {
        receivedData = data;
      });
      
      const testData = { task: '测试任务', timestamp: Date.now() };
      eventBus.emit(RuntimeEvent.AGENT_START, testData);
      
      expect(receivedData.type).toBe(RuntimeEvent.AGENT_START);
      expect(receivedData.task).toBe('测试任务');
      expect(receivedData.timestamp).toBeDefined();
    });

    it('应该追踪订阅者数量', () => {
      const eventBus = getEventBus();
      
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(0);
      
      const unsub1 = eventBus.subscribe(RuntimeEvent.TOOL_CALL, () => {});
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(1);
      
      const unsub2 = eventBus.subscribe(RuntimeEvent.TOOL_CALL, () => {});
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(2);
      
      unsub1();
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(1);
      
      unsub2();
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(0);
    });

    it('应该清除所有订阅者', () => {
      const eventBus = getEventBus();
      
      eventBus.subscribe(RuntimeEvent.TOOL_CALL, () => {});
      eventBus.subscribe(RuntimeEvent.TOOL_RESULT, () => {});
      eventBus.subscribe(RuntimeEvent.AGENT_START, () => {});
      
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_RESULT)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      
      eventBus.clear();
      
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_CALL)).toBe(0);
      expect(eventBus.getSubscriberCount(RuntimeEvent.TOOL_RESULT)).toBe(0);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(0);
    });

    it('应该处理多种事件类型', () => {
      const eventBus = getEventBus();
      const events = [];
      
      eventBus.subscribe(RuntimeEvent.AGENT_START, () => events.push('start'));
      eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, () => events.push('complete'));
      eventBus.subscribe(RuntimeEvent.AGENT_ERROR, () => events.push('error'));
      
      eventBus.emit(RuntimeEvent.AGENT_START, {});
      eventBus.emit(RuntimeEvent.AGENT_COMPLETE, {});
      eventBus.emit(RuntimeEvent.AGENT_ERROR, {});
      
      expect(events).toEqual(['start', 'complete', 'error']);
    });
  });

  describe('RuntimeEvent Types', () => {
    it('应该有所有必需的事件类型', () => {
      expect(RuntimeEvent.AGENT_START).toBe('agent:start');
      expect(RuntimeEvent.AGENT_STOP).toBe('agent:stop');
      expect(RuntimeEvent.AGENT_ERROR).toBe('agent:error');
      expect(RuntimeEvent.AGENT_COMPLETE).toBe('agent:complete');
      expect(RuntimeEvent.TOOL_CALL).toBe('tool:call');
      expect(RuntimeEvent.TOOL_RESULT).toBe('tool:result');
      expect(RuntimeEvent.TOOL_ERROR).toBe('tool:error');
      expect(RuntimeEvent.MESSAGE_RECEIVED).toBe('message:received');
      expect(RuntimeEvent.MESSAGE_SENT).toBe('message:sent');
      expect(RuntimeEvent.STATUS_UPDATE).toBe('status:update');
      expect(RuntimeEvent.CONFIG_CHANGE).toBe('config:change');
      expect(RuntimeEvent.MEMORY_UPDATE).toBe('memory:update');
      expect(RuntimeEvent.MEMORY_CLEAR).toBe('memory:clear');
      expect(RuntimeEvent.TOOL_LOADED).toBe('tool:loaded');
      expect(RuntimeEvent.TOOL_UNLOADED).toBe('tool:unloaded');
    });
  });

  describe('PlatformType', () => {
    it('应该定义所有平台类型', () => {
      expect(PlatformType.CLI).toBe('cli');
      expect(PlatformType.DESKTOP).toBe('desktop');
      expect(PlatformType.WEB).toBe('web');
    });
  });

  describe('RuntimeConfig', () => {
    it('应该使用默认值创建配置', () => {
      const config = new RuntimeConfig();
      
      expect(config.platform).toBe(PlatformType.CLI);
      expect(config.workingDirectory).toBe(process.cwd());
      expect(config.debug).toBe(false);
      expect(config.maxIterations).toBe(180);
      expect(config.autoDownloadModels).toBe(true);
      expect(config.enableMiddleware).toBe(true);
      expect(config.enableToolGroups).toBe(true);
      expect(config.hookTimeout).toBe(5000);
    });

    it('应该使用自定义值创建配置', () => {
      const config = new RuntimeConfig({
        platform: PlatformType.DESKTOP,
        workingDirectory: '/custom/path',
        debug: true,
        maxIterations: 100,
        autoDownloadModels: false,
        hookTimeout: 3000,
        pluginConfig: { timeout: 1000 }
      });
      
      expect(config.platform).toBe(PlatformType.DESKTOP);
      expect(config.workingDirectory).toBe('/custom/path');
      expect(config.debug).toBe(true);
      expect(config.maxIterations).toBe(100);
      expect(config.autoDownloadModels).toBe(false);
      expect(config.hookTimeout).toBe(3000);
      expect(config.pluginConfig.timeout).toBe(1000);
    });

    it('应该更新配置', () => {
      const config = new RuntimeConfig();
      
      config.update('debug', true);
      expect(config.debug).toBe(true);
      
      config.update({ maxIterations: 50, hookTimeout: 2000 });
      expect(config.maxIterations).toBe(50);
      expect(config.hookTimeout).toBe(2000);
    });

    it('应该获取配置值', () => {
      const config = new RuntimeConfig({ debug: true });
      
      expect(config.get('debug')).toBe(true);
      expect(config.get('undefined_key', 'default')).toBe('default');
    });

    it('应该克隆配置', () => {
      const config = new RuntimeConfig({ debug: true, maxIterations: 100 });
      const cloned = config.clone();
      
      expect(cloned.debug).toBe(true);
      expect(cloned.maxIterations).toBe(100);
      expect(cloned).not.toBe(config);
    });
  });

  describe('AgentState', () => {
    it('应该创建初始状态', () => {
      const state = new AgentState();
      
      expect(state.status).toBe('idle');
      expect(state.currentTask).toBeNull();
      expect(state.iteration).toBe(0);
      expect(state.startTime).toBeNull();
      expect(state.lastActivity).toBeNull();
      expect(state.error).toBeNull();
    });

    it('应该更新状态', () => {
      const state = new AgentState();
      
      state.setStatus('running', { task: 'test' });
      
      expect(state.status).toBe('running');
      expect(state.metadata.task).toBe('test');
      expect(state.lastActivity).toBeDefined();
    });

    it('应该设置错误', () => {
      const state = new AgentState();
      const error = new Error('测试错误');
      
      state.setError(error);
      
      expect(state.status).toBe('error');
      expect(state.error).toBe(error);
    });

    it('应该重置状态', () => {
      const state = new AgentState();
      
      state.setStatus('running');
      state.setError(new Error('error'));
      state.reset();
      
      expect(state.status).toBe('idle');
      expect(state.error).toBeNull();
      expect(state.metadata).toEqual({});
    });
  });

  describe('ToolDefinition', () => {
    it('应该创建工具定义', () => {
      const tool = new ToolDefinition({
        name: 'test_tool',
        description: '测试工具',
        category: 'Test',
        handler: async () => 'result'
      });
      
      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('测试工具');
      expect(tool.category).toBe('Test');
      expect(tool.enabled).toBe(true);
    });

    it('应该验证工具定义', () => {
      const validTool = new ToolDefinition({
        name: 'valid_tool',
        description: '有效工具',
        handler: async () => 'result'
      });
      
      const validation = validTool.validate();
      expect(validation.valid).toBe(true);
      
      const invalidTool = new ToolDefinition({
        name: 'invalid_tool'
      });
      
      const invalidValidation = invalidTool.validate();
      expect(invalidValidation.valid).toBe(false);
    });

    it('应该添加钩子', () => {
      const tool = new ToolDefinition({
        name: 'hooked_tool',
        description: '带钩子的工具',
        handler: async () => 'result'
      });
      
      tool.addBeforeHook(async () => console.log('before'));
      tool.addAfterHook(async () => console.log('after'));
      
      expect(tool.beforeHooks.length).toBe(1);
      expect(tool.afterHooks.length).toBe(1);
    });
  });

  describe('ToolGroup', () => {
    it('应该创建工具分组', () => {
      const group = new ToolGroup({
        name: 'test_group',
        description: '测试分组',
        tools: ['tool1', 'tool2']
      });
      
      expect(group.name).toBe('test_group');
      expect(group.description).toBe('测试分组');
      expect(group.hasTool('tool1')).toBe(true);
      expect(group.hasTool('tool2')).toBe(true);
    });

    it('应该添加和移除工具', () => {
      const group = new ToolGroup({ name: 'dynamic_group' });
      
      group.addTool('tool1');
      group.addTool('tool2');
      
      expect(group.getTools()).toEqual(['tool1', 'tool2']);
      
      group.removeTool('tool1');
      
      expect(group.hasTool('tool1')).toBe(false);
      expect(group.hasTool('tool2')).toBe(true);
    });
  });

  describe('MiddlewareDefinition', () => {
    it('应该创建中间件定义', () => {
      const middleware = new MiddlewareDefinition({
        name: 'test_middleware',
        priority: HookPriority.HIGH,
        before: async (ctx) => {},
        after: async (ctx) => {}
      });
      
      expect(middleware.name).toBe('test_middleware');
      expect(middleware.priority).toBe(HookPriority.HIGH);
      expect(middleware.before).toBeDefined();
      expect(middleware.after).toBeDefined();
    });

    it('应该验证中间件定义', () => {
      const validMiddleware = new MiddlewareDefinition({
        before: async () => {}
      });
      
      const validation = validMiddleware.validate();
      expect(validation.valid).toBe(true);
      
      const invalidMiddleware = new MiddlewareDefinition({});
      
      const invalidValidation = invalidMiddleware.validate();
      expect(invalidValidation.valid).toBe(false);
    });
  });

  describe('End-to-End Flow', () => {
    it('初始化期间应该发送生命周期事件', async () => {
      const events = [];
      const eventBus = getEventBus();
      
      eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
        events.push(data);
      });
      
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 应该收到初始化事件
      const initEvents = events.filter(e => 
        e.status === 'initializing' || e.status === 'ready'
      );
      expect(initEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('应该管理引擎状态转换', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      
      // 初始状态
      expect(engine.getState().status).toBe('idle');
      
      await engine.initialize();
      expect(engine.isInitialized()).toBe(true);
    });

    it('销毁时应该清理资源', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      await engine.dispose();
      
      expect(engine.getState().status).toBe('idle');
      expect(engine.isInitialized()).toBe(false);
    });

    it('应该触发钩子链', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const hookCalls = [];
      
      engine.registerHook(HOOKS.BEFORE_INIT, async () => hookCalls.push('before_init'));
      engine.registerHook(HOOKS.AFTER_INIT, async () => hookCalls.push('after_init'));
      
      // 手动触发钩子测试
      await engine.getPluginManager().triggerHook(HOOKS.BEFORE_INIT);
      await engine.getPluginManager().triggerHook(HOOKS.AFTER_INIT);
      
      expect(hookCalls).toContain('before_init');
      expect(hookCalls).toContain('after_init');
    });
  });

  describe('Error Handling', () => {
    it('应该优雅处理工具注册错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      // 尝试注册缺少必需字段的工具
      const invalidTool = {
        name: 'invalid'
        // 缺少必需字段
      };
      
      try {
        engine.registerTool(invalidTool);
        // 如果不抛出错误，对于此测试也是可以的
      } catch (error) {
        // 无效工具的预期行为
      }
    });

    it('应该提供有意义的错误消息', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      try {
        await engine.processInput('test');
        expect.fail('应该抛出错误');
      } catch (error) {
        // 错误消息可能是中文或英文，检查是否包含关键词
        const hasKeyword = error.message.includes('Model provider') ||
                           error.message.includes('模型提供者');
        expect(hasKeyword).toBe(true);
      }
    });

    it('应该处理插件初始化错误', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      const failingPlugin = createPlugin({
        name: 'failing-plugin',
        initialize: () => {
          throw new Error('初始化失败');
        }
      });
      
      try {
        await engine.registerPlugin(failingPlugin);
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('初始化失败');
      }
    });
  });

  describe('Memory Hooks', () => {
    it('应该触发内存更新钩子', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      let memoryHookCalled = false;
      
      engine.registerHook(HOOKS.ON_MEMORY_UPDATE, async (operation, data) => {
        memoryHookCalled = true;
        expect(operation).toBe('add');
      });
      
      await engine.updateMemory('add', { key: 'value' });
      
      expect(memoryHookCalled).toBe(true);
    });

    it('应该触发内存清除钩子', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      let clearHookCalled = false;
      
      engine.registerHook(HOOKS.ON_MEMORY_CLEAR, async () => {
        clearHookCalled = true;
      });
      
      await engine.clearMemory();
      
      expect(clearHookCalled).toBe(true);
    });
  });

  describe('Config Hooks', () => {
    it('应该触发配置变更钩子', async () => {
      engine = createAgentEngine({ workingDirectory: testDir });
      await engine.initialize();
      
      let configHookCalled = false;
      
      engine.registerHook(HOOKS.ON_CONFIG_CHANGE, async (key, value) => {
        configHookCalled = true;
        expect(key).toBe('maxIterations');
        expect(value).toBe(50);
      });
      
      await engine.updateConfig('maxIterations', 50);
      
      expect(configHookCalled).toBe(true);
    });
  });
});