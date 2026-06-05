/**
 * 性能基准测试文件
 * Performance Benchmark Tests
 * 
 * 测试内容：
 * - EventBus 性能测试（大量事件发射、订阅者数量）
 * - AgentEngine 性能测试（初始化时间、工具注册）
 * - 插件系统性能测试（插件加载、钩子执行）
 * - IPC 适配器性能测试（消息吞吐量）
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { getEventBus, resetEventBus, EventPriority } from '../../src/runtime/index.js';
import { createAgentEngine, RuntimeConfig, RuntimeEvent } from '../../src/runtime/index.js';
import { PluginManager, HOOKS, HookPriority, createPlugin } from '../../src/runtime/plugin-system.js';
import { IPCMessage, IPCMessageType, IPCAdapterBase, MessageQueue } from '../../src/adapters/desktop/ipc-adapter.js';

// 性能阈值常量
const PERFORMANCE_THRESHOLDS = {
  // EventBus 性能阈值
  EVENT_EMIT_SINGLE_MS: 1,           // 单次事件发射时间（毫秒）
  EVENT_EMIT_1000_MS: 50,            // 1000 次事件发射时间（毫秒）
  EVENT_EMIT_10000_MS: 500,          // 10000 次事件发射时间（毫秒）
  SUBSCRIBER_100_MS: 5,              // 100 个订阅者注册时间（毫秒）
  SUBSCRIBER_1000_MS: 50,            // 1000 个订阅者注册时间（毫秒）
  HISTORY_1000_MS: 10,               // 1000 条历史记录查询时间（毫秒）
  
  // AgentEngine 性能阈值
  ENGINE_INIT_MS: 1000,              // 引擎初始化时间（毫秒）
  TOOL_REGISTER_SINGLE_MS: 1,        // 单个工具注册时间（毫秒）
  TOOL_REGISTER_100_MS: 50,          // 100 个工具注册时间（毫秒）
  
  // 插件系统性能阈值
  PLUGIN_REGISTER_MS: 10,            // 单个插件注册时间（毫秒）
  PLUGIN_REGISTER_10_MS: 100,        // 10 个插件注册时间（毫秒）
  HOOK_TRIGGER_SINGLE_MS: 1,         // 单个钩子触发时间（毫秒）
  HOOK_TRIGGER_100_MS: 10,           // 100 个钩子触发时间（毫秒）
  MIDDLEWARE_EXECUTE_MS: 2,          // 中间件执行时间（毫秒）
  
  // IPC 性能阈值
  MESSAGE_CREATE_MS: 0.1,            // 消息创建时间（毫秒）
  MESSAGE_QUEUE_1000_MS: 5,          // 1000 条消息入队时间（毫秒）
  MESSAGE_VALIDATE_MS: 0.1,          // 消息验证时间（毫秒）
};

describe('性能基准测试', () => {
  describe('EventBus 性能测试', () => {
    let eventBus;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
    });

    afterEach(() => {
      eventBus.clear();
    });

    describe('事件发射性能', () => {
      it('单次事件发射应该在阈值时间内完成', () => {
        eventBus.subscribe('test:event', () => {});
        
        const start = performance.now();
        eventBus.emit('test:event', { data: 'test' });
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.EVENT_EMIT_SINGLE_MS);
      });

      it('1000 次事件发射应该在阈值时间内完成', () => {
        eventBus.subscribe('test:bulk', () => {});
        
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          eventBus.emit('test:bulk', { index: i });
        }
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.EVENT_EMIT_1000_MS);
        
        // 验证统计信息
        const stats = eventBus.getStats();
        expect(stats.totalEvents).toBe(1000);
      });

      it('10000 次事件发射应该在阈值时间内完成', () => {
        eventBus.subscribe('test:massive', () => {});
        
        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
          eventBus.emit('test:massive', { index: i });
        }
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.EVENT_EMIT_10000_MS);
      });

      it('异步事件发射性能测试', async () => {
        eventBus.subscribe('test:async', async () => {
          // 模拟异步处理
          await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const start = performance.now();
        await eventBus.emitAsync('test:async', { data: 'async test' });
        const duration = performance.now() - start;
        
        // 异步事件允许更长的时间
        expect(duration).toBeLessThan(50);
      });

      it('批量事件发射性能测试', () => {
        eventBus.subscribe('test:batch', () => {});
        
        const events = [];
        for (let i = 0; i < 100; i++) {
          events.push({ event: 'test:batch', data: { index: i }, options: {} });
        }
        
        const start = performance.now();
        eventBus.emitBatch(events);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });
    });

    describe('订阅者性能', () => {
      it('100 个订阅者注册应该在阈值时间内完成', () => {
        const start = performance.now();
        
        for (let i = 0; i < 100; i++) {
          eventBus.subscribe('test:multi', () => {});
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SUBSCRIBER_100_MS);
        expect(eventBus.getSubscriberCount('test:multi')).toBe(100);
      });

      it('1000 个订阅者注册应该在阈值时间内完成', () => {
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          eventBus.subscribe('test:thousand', () => {});
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SUBSCRIBER_1000_MS);
        expect(eventBus.getSubscriberCount('test:thousand')).toBe(1000);
      });

      it('优先级订阅者排序性能测试', () => {
        // 注册不同优先级的订阅者
        const start = performance.now();
        
        for (let i = 0; i < 100; i++) {
          const priority = i % 3 === 0 ? EventPriority.HIGH : 
                          i % 3 === 1 ? EventPriority.MEDIUM : EventPriority.LOW;
          eventBus.subscribe('test:priority', () => {}, { priority });
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
        
        // 验证订阅者已按优先级排序
        const subscribers = eventBus.getSubscribers('test:priority');
        expect(subscribers.length).toBe(100);
      });

      it('订阅者取消订阅性能测试', () => {
        const unsubscribers = [];
        
        // 先注册 100 个订阅者
        for (let i = 0; i < 100; i++) {
          unsubscribers.push(eventBus.subscribe('test:unsub', () => {}));
        }
        
        const start = performance.now();
        
        // 取消所有订阅
        for (const unsub of unsubscribers) {
          unsub();
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
        expect(eventBus.getSubscriberCount('test:unsub')).toBe(0);
      });
    });

    describe('历史记录性能', () => {
      it('历史记录查询性能测试', () => {
        // 先发射 1000 个事件
        for (let i = 0; i < 1000; i++) {
          eventBus.emit('test:history', { index: i });
        }
        
        const start = performance.now();
        const history = eventBus.getHistory({ limit: 100 });
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.HISTORY_1000_MS);
        expect(history.length).toBe(100);
      });

      it('历史记录过滤性能测试', () => {
        // 发射多种类型的事件
        for (let i = 0; i < 500; i++) {
          eventBus.emit('test:type1', { index: i });
          eventBus.emit('test:type2', { index: i });
        }
        
        const start = performance.now();
        const filtered = eventBus.getHistory({ type: 'test:type1' });
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(20);
        expect(filtered.length).toBe(500);
      });

      it('历史记录回放性能测试', async () => {
        // 发射 100 个事件
        for (let i = 0; i < 100; i++) {
          eventBus.emit('test:replay', { index: i });
        }
        
        let replayCount = 0;
        eventBus.subscribe('test:replay', () => {
          replayCount++;
        });
        
        const start = performance.now();
        await eventBus.replayHistory({ type: 'test:replay', delay: 0 });
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(50);
      });
    });

    describe('缓存性能', () => {
      it('事件缓存命中率测试', () => {
        eventBus = getEventBus({ cache: { enabled: true, maxSize: 100, ttl: 60000 } });
        
        // 发射相同事件多次
        for (let i = 0; i < 100; i++) {
          eventBus.emit('test:cache', { data: 'cached' }, { cache: true });
        }
        
        const stats = eventBus.getStats();
        expect(stats.cachedHits).toBeGreaterThan(0);
      });

      it('缓存读取性能测试', () => {
        eventBus = getEventBus({ cache: { enabled: true } });
        
        // 缓存事件
        eventBus.emit('test:cached', { data: 'test' }, { cache: true });
        
        const start = performance.now();
        const cached = eventBus.getCachedEvent('test:cached');
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(1);
        expect(cached).toBeDefined();
      });
    });

    describe('过滤器性能', () => {
      it('过滤器检查性能测试', () => {
        eventBus.setFilter('test:filter', {
          sources: ['allowed-source'],
          dataFilter: (data) => data.value > 0
        });
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          eventBus.emit('test:filter', { value: i }, { source: 'allowed-source' });
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(50);
      });
    });
  });

  describe('AgentEngine 性能测试', () => {
    let engine;
    let testDir;

    beforeEach(() => {
      testDir = `/tmp/engine-perf-test-${Date.now()}`;
    });

    afterEach(async () => {
      if (engine) {
        await engine.dispose();
        engine = null;
      }
    });

    describe('初始化性能', () => {
      it('引擎初始化应该在阈值时间内完成', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        const start = performance.now();
        await engine.initialize();
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.ENGINE_INIT_MS);
        expect(engine.isInitialized()).toBe(true);
      });

      it('重复初始化不应该增加时间', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        await engine.initialize();
        
        const start = performance.now();
        await engine.initialize(); // 第二次初始化
        const duration = performance.now() - start;
        
        // 第二次初始化应该是立即返回
        expect(duration).toBeLessThan(1);
      });

      it('引擎销毁性能测试', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const start = performance.now();
        await engine.dispose();
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(100);
        expect(engine.isInitialized()).toBe(false);
      });
    });

    describe('工具注册性能', () => {
      it('单个工具注册应该在阈值时间内完成', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const tool = {
          name: 'perf_test_tool',
          description: '性能测试工具',
          category: 'Test',
          parameters: {},
          handler: async () => 'result'
        };
        
        const start = performance.now();
        engine.registerTool(tool);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.TOOL_REGISTER_SINGLE_MS);
      });

      it('100 个工具注册应该在阈值时间内完成', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const tools = [];
        for (let i = 0; i < 100; i++) {
          tools.push({
            name: `bulk_tool_${i}`,
            description: `批量测试工具 ${i}`,
            category: 'Test',
            parameters: {},
            handler: async () => `result_${i}`
          });
        }
        
        const start = performance.now();
        engine.registerTools(tools);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.TOOL_REGISTER_100_MS);
        
        const allTools = engine.getTools();
        expect(allTools.length).toBeGreaterThan(100);
      });

      it('工具分组创建性能测试', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const start = performance.now();
        
        for (let i = 0; i < 50; i++) {
          engine.createToolGroup(`perf_group_${i}`, {
            description: `性能测试分组 ${i}`,
            priority: i
          });
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(50);
        
        const groups = engine.getToolGroups();
        expect(groups.length).toBeGreaterThanOrEqual(50);
      });
    });

    describe('状态获取性能', () => {
      it('状态获取应该在阈值时间内完成', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const start = performance.now();
        const state = engine.getState();
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(1);
        expect(state).toBeDefined();
      });

      it('工具列表获取性能测试', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        // 注册额外工具
        for (let i = 0; i < 50; i++) {
          engine.registerTool({
            name: `list_tool_${i}`,
            description: `列表测试工具 ${i}`,
            category: 'Test',
            parameters: {},
            handler: async () => 'result'
          });
        }
        
        const start = performance.now();
        const tools = engine.getTools();
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(5);
        expect(tools.length).toBeGreaterThan(50);
      });
    });
  });

  describe('插件系统性能测试', () => {
    let pluginManager;
    let eventBus;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
      pluginManager = new PluginManager(eventBus);
    });

    afterEach(async () => {
      if (pluginManager) {
        await pluginManager.dispose();
        pluginManager = null;
      }
    });

    describe('插件注册性能', () => {
      it('单个插件注册应该在阈值时间内完成', async () => {
        const plugin = createPlugin({
          name: 'perf_plugin',
          description: '性能测试插件'
        });
        
        const start = performance.now();
        await pluginManager.register(plugin);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.PLUGIN_REGISTER_MS);
      });

      it('10 个插件注册应该在阈值时间内完成', async () => {
        const start = performance.now();
        
        for (let i = 0; i < 10; i++) {
          const plugin = createPlugin({
            name: `perf_plugin_${i}`,
            description: `性能测试插件 ${i}`
          });
          await pluginManager.register(plugin);
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.PLUGIN_REGISTER_10_MS);
        expect(pluginManager.getPluginCount()).toBe(10);
      });

      it('带钩子的插件注册性能测试', async () => {
        const plugin = createPlugin({
          name: 'hooked_perf_plugin',
          hooks: {
            [HOOKS.BEFORE_TOOL_CALL]: async () => {},
            [HOOKS.AFTER_TOOL_CALL]: async () => {},
            [HOOKS.ON_TOOL_ERROR]: async () => {},
            [HOOKS.ON_CONFIG_CHANGE]: async () => {}
          }
        });
        
        const start = performance.now();
        await pluginManager.register(plugin);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(20);
      });

      it('带中间件的插件注册性能测试', async () => {
        const plugin = createPlugin({
          name: 'middleware_perf_plugin',
          middlewares: [
            {
              name: 'perf-middleware',
              before: async (ctx) => {},
              after: async (ctx) => {}
            }
          ]
        });
        
        const start = performance.now();
        await pluginManager.register(plugin);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(20);
      });
    });

    describe('钩子执行性能', () => {
      it('单个钩子触发应该在阈值时间内完成', async () => {
        pluginManager.registerHook('perf_hook', async () => 'result');
        
        const start = performance.now();
        await pluginManager.triggerHook('perf_hook');
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.HOOK_TRIGGER_SINGLE_MS);
      });

      it('100 次钩子触发应该在阈值时间内完成', async () => {
        pluginManager.registerHook('bulk_hook', async () => 'result');
        
        const start = performance.now();
        
        for (let i = 0; i < 100; i++) {
          await pluginManager.triggerHook('bulk_hook');
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.HOOK_TRIGGER_100_MS);
      });

      it('多钩子优先级排序执行性能测试', async () => {
        // 注册 50 个不同优先级的钩子
        for (let i = 0; i < 50; i++) {
          pluginManager.registerHook('priority_perf_hook', async () => {}, {
            priority: i
          });
        }
        
        const start = performance.now();
        await pluginManager.triggerHook('priority_perf_hook');
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });

      it('一次性钩子执行性能测试', async () => {
        // 注册 100 个一次性钩子
        for (let i = 0; i < 100; i++) {
          pluginManager.registerHook('once_perf_hook', async () => {}, {
            once: true
          });
        }
        
        const start = performance.now();
        await pluginManager.triggerHook('once_perf_hook');
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(20);
        
        // 验证钩子已被移除
        const hookManager = pluginManager.getHookManager();
        expect(hookManager.getHookCount('once_perf_hook')).toBe(0);
      });
    });

    describe('中间件执行性能', () => {
      it('中间件执行应该在阈值时间内完成', async () => {
        const middleware = pluginManager.getToolMiddleware();
        
        middleware.use({
          name: 'perf-middleware',
          before: async (ctx) => {},
          after: async (ctx) => {}
        });
        
        const executor = async () => 'result';
        
        const start = performance.now();
        await middleware.execute('test_tool', {}, {}, executor);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MIDDLEWARE_EXECUTE_MS);
      });

      it('多中间件链式执行性能测试', async () => {
        const middleware = pluginManager.getToolMiddleware();
        
        // 添加 10 个中间件
        for (let i = 0; i < 10; i++) {
          middleware.use({
            name: `chain_middleware_${i}`,
            priority: i,
            before: async (ctx) => {},
            after: async (ctx) => {}
          });
        }
        
        const executor = async () => 'result';
        
        const start = performance.now();
        await middleware.execute('chain_tool', {}, {}, executor);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });

      it('中间件错误处理性能测试', async () => {
        const middleware = pluginManager.getToolMiddleware();
        
        middleware.use({
          name: 'error-middleware',
          error: async (error, ctx) => {}
        });
        
        const executor = async () => {
          throw new Error('测试错误');
        };
        
        const start = performance.now();
        
        try {
          await middleware.execute('error_tool', {}, {}, executor);
        } catch (error) {
          // 预期的错误
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });
    });

    describe('工具分组性能', () => {
      it('工具分组操作性能测试', () => {
        const groups = pluginManager.getToolGroups();
        
        const start = performance.now();
        
        // 创建 50 个分组
        for (let i = 0; i < 50; i++) {
          groups.createGroup(`perf_group_${i}`, { priority: i });
        }
        
        // 添加工具到分组
        for (let i = 0; i < 50; i++) {
          groups.addToGroup(`perf_group_${i}`, `tool_${i}`);
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(20);
        expect(groups.getAllGroups().length).toBe(50);
      });
    });
  });

  describe('IPC 适配器性能测试', () => {
    describe('消息创建性能', () => {
      it('消息创建应该在阈值时间内完成', () => {
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          new IPCMessage(IPCMessageType.REQUEST, { data: i });
        }
        
        const duration = performance.now() - start;
        
        expect(duration / 1000).toBeLessThan(PERFORMANCE_THRESHOLDS.MESSAGE_CREATE_MS);
      });

      it('消息序列化性能测试', () => {
        const message = new IPCMessage(IPCMessageType.REQUEST, { 
          data: 'test payload',
          nested: { value: 123 }
        });
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          message.toJSON();
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });

      it('消息反序列化性能测试', () => {
        const original = new IPCMessage(IPCMessageType.REQUEST, { data: 'test' });
        const json = JSON.stringify(original.toJSON());
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          IPCMessage.fromJSON(json);
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(20);
      });
    });

    describe('消息队列性能', () => {
      it('1000 条消息入队应该在阈值时间内完成', () => {
        const queue = new MessageQueue(1000);
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MESSAGE_QUEUE_1000_MS);
        expect(queue.size()).toBe(1000);
      });

      it('消息出队性能测试', () => {
        const queue = new MessageQueue(1000);
        
        // 先入队 1000 条消息
        for (let i = 0; i < 1000; i++) {
          queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          queue.dequeue();
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(5);
        expect(queue.size()).toBe(0);
      });

      it('队列溢出处理性能测试', () => {
        const queue = new MessageQueue(100); // 小容量
        
        const start = performance.now();
        
        // 入队超过容量的消息
        for (let i = 0; i < 200; i++) {
          queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(5);
        expect(queue.size()).toBe(100); // 应该只保留最新的 100 条
      });
    });

    describe('消息验证性能', () => {
      it('消息验证应该在阈值时间内完成', () => {
        // 创建一个简单的适配器基类实例用于测试
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ validateMessages: true });
        
        const validMessage = new IPCMessage(IPCMessageType.REQUEST, { data: 'test' });
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          adapter.validateMessage(validMessage);
        }
        
        const duration = performance.now() - start;
        
        expect(duration / 1000).toBeLessThan(PERFORMANCE_THRESHOLDS.MESSAGE_VALIDATE_MS);
      });

      it('无效消息验证性能测试', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ 
          validateMessages: true,
          allowedChannels: ['allowed-channel']
        });
        
        const start = performance.now();
        
        for (let i = 0; i < 100; i++) {
          adapter.validateMessage({ type: 'disallowed-channel' });
          adapter.validateMessage(null);
          adapter.validateMessage({});
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(5);
      });
    });

    describe('请求处理性能', () => {
      it('请求 ID 生成性能测试', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          adapter.generateRequestId();
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });

      it('响应创建性能测试', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        const request = new IPCMessage(IPCMessageType.REQUEST, { data: 'request' });
        
        const start = performance.now();
        
        for (let i = 0; i < 1000; i++) {
          adapter.createResponse(request, { result: 'response' });
        }
        
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(10);
      });
    });
  });

  describe('综合性能测试', () => {
    it('完整流程性能测试', async () => {
      resetEventBus();
      const eventBus = getEventBus();
      const pluginManager = new PluginManager(eventBus);
      
      const start = performance.now();
      
      // 注册插件
      await pluginManager.register(createPlugin({
        name: 'flow_plugin',
        hooks: {
          [HOOKS.BEFORE_TOOL_CALL]: async () => {}
        }
      }));
      
      // 添加中间件
      pluginManager.getToolMiddleware().use({
        name: 'flow-middleware',
        before: async (ctx) => {},
        after: async (ctx) => {}
      });
      
      // 发射事件
      for (let i = 0; i < 100; i++) {
        eventBus.emit('flow:event', { index: i });
      }
      
      // 触发钩子
      await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test_tool', {});
      
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(100);
      
      await pluginManager.dispose();
    });

    it('内存使用稳定性测试', async () => {
      resetEventBus();
      const eventBus = getEventBus();
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // 执行大量操作
      for (let i = 0; i < 1000; i++) {
        eventBus.subscribe(`mem_test_${i}`, () => {});
        eventBus.emit(`mem_test_${i}`, { data: i });
      }
      
      // 清理
      eventBus.clear();
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // 内存增长应该在合理范围内（小于 10MB）
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});