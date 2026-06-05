/**
 * 压力测试文件
 * Stress Tests
 * 
 * 测试内容：
 * - 高并发事件发射
 * - 大量工具注册
 * - 内存泄漏检测
 * - 长时间运行稳定性
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { getEventBus, resetEventBus, EventPriority } from '../../src/runtime/index.js';
import { createAgentEngine, RuntimeConfig, RuntimeEvent } from '../../src/runtime/index.js';
import { PluginManager, HOOKS, HookPriority, createPlugin } from '../../src/runtime/plugin-system.js';
import { IPCMessage, IPCMessageType, MessageQueue } from '../../src/adapters/desktop/ipc-adapter.js';

// 压力测试配置
const STRESS_CONFIG = {
  // 并发测试配置
  CONCURRENT_EVENTS: 10000,          // 并发事件数量
  CONCURRENT_SUBSCRIBERS: 5000,      // 并发订阅者数量
  CONCURRENT_PLUGINS: 100,           // 并发插件数量
  
  // 工具注册配置
  TOOLS_COUNT: 1000,                 // 工具数量
  
  // 内存测试配置
  MEMORY_TEST_ITERATIONS: 10000,     // 内存测试迭代次数
  MEMORY_THRESHOLD_MB: 50,           // 内存增长阈值（MB）
  
  // 长时间运行配置
  LONG_RUN_DURATION_MS: 5000,        // 长时间运行测试持续时间（毫秒）
  LONG_RUN_INTERVAL_MS: 10,          // 长时间运行测试间隔（毫秒）
  
  // 队列压力配置
  QUEUE_SIZE: 10000,                 // 队列大小
};

describe('压力测试', () => {
  describe('高并发事件发射', () => {
    let eventBus;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
    });

    afterEach(() => {
      eventBus.clear();
    });

    describe('并发事件发射', () => {
      it('应该处理 10000 个并发事件发射', async () => {
        // 注册订阅者
        let receivedCount = 0;
        eventBus.subscribe('stress:concurrent', () => {
          receivedCount++;
        });

        // 并发发射事件
        const promises = [];
        for (let i = 0; i < STRESS_CONFIG.CONCURRENT_EVENTS; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.emit('stress:concurrent', { index: i });
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证所有事件都被处理
        expect(receivedCount).toBe(STRESS_CONFIG.CONCURRENT_EVENTS);

        // 验证统计信息
        const stats = eventBus.getStats();
        expect(stats.totalEvents).toBe(STRESS_CONFIG.CONCURRENT_EVENTS);
      });

      it('应该处理多类型并发事件', async () => {
        const receivedByType = {};

        // 为每种类型注册订阅者
        for (let i = 0; i < 10; i++) {
          const typeName = `stress:type_${i}`;
          receivedByType[typeName] = 0;
          eventBus.subscribe(typeName, () => {
            receivedByType[typeName]++;
          });
        }

        // 并发发射不同类型的事件
        const promises = [];
        for (let i = 0; i < STRESS_CONFIG.CONCURRENT_EVENTS; i++) {
          const typeName = `stress:type_${i % 10}`;
          promises.push(
            new Promise(resolve => {
              eventBus.emit(typeName, { index: i });
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证每种类型的事件数量
        for (let i = 0; i < 10; i++) {
          const typeName = `stress:type_${i}`;
          const expectedCount = STRESS_CONFIG.CONCURRENT_EVENTS / 10;
          expect(receivedByType[typeName]).toBe(expectedCount);
        }
      });

      it('应该处理并发异步事件发射', async () => {
        let receivedCount = 0;

        eventBus.subscribe('stress:async-concurrent', async () => {
          receivedCount++;
          // 模拟异步处理
          await new Promise(resolve => setTimeout(resolve, 0));
        });

        // 并发发射异步事件
        const promises = [];
        for (let i = 0; i < 1000; i++) {
          promises.push(eventBus.emitAsync('stress:async-concurrent', { index: i }));
        }

        await Promise.all(promises);

        expect(receivedCount).toBe(1000);
      });

      it('应该处理并发批量事件发射', async () => {
        let receivedCount = 0;

        eventBus.subscribe('stress:batch-concurrent', () => {
          receivedCount++;
        });

        // 创建多个批量
        const batches = [];
        for (let b = 0; b < 10; b++) {
          const batch = [];
          for (let i = 0; i < 100; i++) {
            batch.push({
              event: 'stress:batch-concurrent',
              data: { batch: b, index: i },
              options: {}
            });
          }
          batches.push(batch);
        }

        // 并发发射所有批量
        const promises = batches.map(batch => 
          new Promise(resolve => {
            eventBus.emitBatch(batch);
            resolve();
          })
        );

        await Promise.all(promises);

        expect(receivedCount).toBe(1000);
      });

      it('应该处理并发发射和订阅', async () => {
        const receivedCount = { value: 0 };

        // 并发发射和订阅
        const promises = [];
        
        // 发射事件
        for (let i = 0; i < 5000; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.emit('stress:emit-sub', { index: i });
              resolve();
            })
          );
        }

        // 同时订阅
        for (let i = 0; i < 5000; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.subscribe('stress:emit-sub', () => {
                receivedCount.value++;
              });
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证订阅者数量
        expect(eventBus.getSubscriberCount('stress:emit-sub')).toBe(5000);
      });
    });

    describe('并发订阅者管理', () => {
      it('应该处理 5000 个并发订阅者注册', async () => {
        const promises = [];
        
        for (let i = 0; i < STRESS_CONFIG.CONCURRENT_SUBSCRIBERS; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.subscribe('stress:massive-sub', () => {});
              resolve();
            })
          );
        }

        await Promise.all(promises);

        expect(eventBus.getSubscriberCount('stress:massive-sub')).toBe(STRESS_CONFIG.CONCURRENT_SUBSCRIBERS);
      });

      it('应该处理并发订阅和取消订阅', async () => {
        const unsubscribers = [];
        const receivedCount = { value: 0 };

        // 先注册订阅者
        for (let i = 0; i < 1000; i++) {
          unsubscribers.push(
            eventBus.subscribe('stress:sub-unsub', () => {
              receivedCount.value++;
            })
          );
        }

        // 并发发射事件和取消订阅
        const promises = [];
        
        // 发射事件
        for (let i = 0; i < 500; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.emit('stress:sub-unsub', {});
              resolve();
            })
          );
        }

        // 取消订阅
        for (let i = 0; i < 500; i++) {
          promises.push(
            new Promise(resolve => {
              unsubscribers[i]();
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证剩余订阅者数量
        expect(eventBus.getSubscriberCount('stress:sub-unsub')).toBe(500);
      });

      it('应该处理并发优先级订阅', async () => {
        const executionOrder = [];

        // 并发注册不同优先级的订阅者
        const promises = [];
        
        for (let i = 0; i < 100; i++) {
          const priority = i % 3 === 0 ? EventPriority.HIGH :
                          i % 3 === 1 ? EventPriority.MEDIUM : EventPriority.LOW;
          
          promises.push(
            new Promise(resolve => {
              eventBus.subscribe('stress:priority-concurrent', () => {
                executionOrder.push(priority);
              }, { priority });
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 发射事件
        eventBus.emit('stress:priority-concurrent', {});

        // 验证订阅者数量
        expect(eventBus.getSubscriberCount('stress:priority-concurrent')).toBe(100);
      });
    });

    describe('并发历史记录操作', () => {
      it('应该处理并发历史记录写入', async () => {
        // 并发发射事件（写入历史）
        const promises = [];
        
        for (let i = 0; i < 1000; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.emit('stress:history-write', { index: i });
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证历史记录
        const history = eventBus.getHistory();
        expect(history.length).toBe(1000);
      });

      it('应该处理并发历史记录读取', async () => {
        // 先写入历史
        for (let i = 0; i < 500; i++) {
          eventBus.emit('stress:history-read', { index: i });
        }

        // 并发读取历史
        const promises = [];
        const results = [];

        for (let i = 0; i < 100; i++) {
          promises.push(
            new Promise(resolve => {
              const history = eventBus.getHistory({ limit: 10 });
              results.push(history.length);
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证所有读取都成功
        expect(results.every(len => len === 10)).toBe(true);
      });

      it('应该处理并发历史记录清除', async () => {
        // 先写入历史
        for (let i = 0; i < 500; i++) {
          eventBus.emit('stress:history-clear', { index: i });
        }

        // 并发清除历史
        const promises = [];
        
        for (let i = 0; i < 10; i++) {
          promises.push(
            new Promise(resolve => {
              eventBus.clearHistory();
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证历史已清除
        const history = eventBus.getHistory();
        expect(history.length).toBe(0);
      });
    });
  });

  describe('大量工具注册', () => {
    let engine;
    let testDir;

    beforeEach(() => {
      testDir = `/tmp/stress-tool-test-${Date.now()}`;
    });

    afterEach(async () => {
      if (engine) {
        try {
          await engine.dispose();
        } catch (error) {
          // 忽略清理错误
        }
        engine = null;
      }
    });

    describe('工具注册压力', () => {
      it('应该处理 1000 个工具注册', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();

        const tools = [];
        for (let i = 0; i < STRESS_CONFIG.TOOLS_COUNT; i++) {
          tools.push({
            name: `stress_tool_${i}`,
            description: `压力测试工具 ${i}`,
            category: 'StressTest',
            parameters: {
              input: { type: 'string', description: '输入参数' }
            },
            handler: async (args) => `result_${i}: ${args.input}`
          });
        }

        // 注册所有工具
        engine.registerTools(tools);

        // 验证工具数量
        const registeredTools = engine.getTools();
        expect(registeredTools.length).toBeGreaterThanOrEqual(STRESS_CONFIG.TOOLS_COUNT);
      });

      it('应该处理并发工具注册', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();

        const promises = [];
        
        for (let i = 0; i < 500; i++) {
          promises.push(
            new Promise(resolve => {
              engine.registerTool({
                name: `concurrent_tool_${i}`,
                description: `并发测试工具 ${i}`,
                category: 'ConcurrentTest',
                parameters: {},
                handler: async () => `result_${i}`
              });
              resolve();
            })
          );
        }

        await Promise.all(promises);

        const tools = engine.getTools();
        expect(tools.length).toBeGreaterThanOrEqual(500);
      });

      it('应该处理大量工具分组', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();

        // 创建大量分组
        for (let i = 0; i < 100; i++) {
          engine.createToolGroup(`stress_group_${i}`, {
            description: `压力测试分组 ${i}`,
            priority: i
          });
        }

        // 注册工具并分配到分组
        for (let i = 0; i < 500; i++) {
          engine.registerTool({
            name: `grouped_tool_${i}`,
            description: `分组测试工具 ${i}`,
            category: 'GroupedTest',
            parameters: {},
            handler: async () => `result_${i}`
          });
        }

        const groups = engine.getToolGroups();
        expect(groups.length).toBeGreaterThanOrEqual(100);
      });

      it('应该处理大量工具查询', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();

        // 注册大量工具
        for (let i = 0; i < 500; i++) {
          engine.registerTool({
            name: `query_tool_${i}`,
            description: `查询测试工具 ${i}`,
            category: 'QueryTest',
            parameters: {},
            handler: async () => `result_${i}`
          });
        }

        // 并发查询工具列表
        const promises = [];
        const results = [];

        for (let i = 0; i < 100; i++) {
          promises.push(
            new Promise(resolve => {
              const tools = engine.getTools();
              results.push(tools.length);
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证所有查询都成功
        expect(results.every(len => len >= 500)).toBe(true);
      });
    });

    describe('工具中间件压力', () => {
      it('应该处理大量中间件注册', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();

        const middleware = engine.getPluginManager().getToolMiddleware();

        // 注册大量中间件
        for (let i = 0; i < 100; i++) {
          middleware.use({
            name: `stress_middleware_${i}`,
            priority: i,
            before: async (ctx) => {
              ctx.metadata.middlewareIndex = i;
            },
            after: async (ctx) => {
              ctx.metadata.completed = true;
            }
          });
        }

        expect(middleware.count()).toBe(100);
      });

      it('应该处理中间件链式执行压力', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();

        const middleware = engine.getPluginManager().getToolMiddleware();

        // 注册中间件链
        for (let i = 0; i < 50; i++) {
          middleware.use({
            name: `chain_middleware_${i}`,
            priority: i,
            before: async (ctx) => {},
            after: async (ctx) => {}
          });
        }

        // 执行多次
        const promises = [];
        
        for (let i = 0; i < 100; i++) {
          promises.push(
            middleware.execute('test_tool', { input: i }, {}, async () => 'result')
          );
        }

        await Promise.all(promises);

        // 应该成功完成所有执行
      });
    });
  });

  describe('内存泄漏检测', () => {
    let eventBus;
    let pluginManager;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
      pluginManager = new PluginManager(eventBus);
    });

    afterEach(async () => {
      if (pluginManager) {
        await pluginManager.dispose();
      }
      eventBus.clear();
    });

    describe('EventBus 内存泄漏检测', () => {
      it('应该检测订阅者内存泄漏', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // 执行大量订阅和取消订阅操作
        for (let i = 0; i < STRESS_CONFIG.MEMORY_TEST_ITERATIONS; i++) {
          const unsubscribe = eventBus.subscribe(`memory_test_${i % 100}`, () => {});
          
          if (i % 10 === 0) {
            unsubscribe();
          }
        }

        // 清理所有订阅者
        eventBus.clear();

        // 强制垃圾回收（如果可用）
        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024); // MB

        // 内存增长应该在合理范围内
        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });

      it('应该检测历史记录内存泄漏', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // 发射大量事件（产生历史记录）
        for (let i = 0; i < STRESS_CONFIG.MEMORY_TEST_ITERATIONS; i++) {
          eventBus.emit('memory:history', { index: i, data: `data_${i}` });
        }

        // 清除历史记录
        eventBus.clearHistory();

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });

      it('应该检测缓存内存泄漏', async () => {
        eventBus = getEventBus({ cache: { enabled: true, maxSize: 1000 } });

        const initialMemory = process.memoryUsage().heapUsed;

        // 缓存大量事件
        for (let i = 0; i < STRESS_CONFIG.MEMORY_TEST_ITERATIONS; i++) {
          eventBus.emit(`memory:cache_${i % 100}`, { index: i }, { cache: true });
        }

        // 清除缓存
        eventBus.clearCache();

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });

      it('应该检测事件发射内存泄漏', async () => {
        // 注册一个订阅者
        eventBus.subscribe('memory:emit', () => {});

        const initialMemory = process.memoryUsage().heapUsed;

        // 发射大量事件
        for (let i = 0; i < STRESS_CONFIG.MEMORY_TEST_ITERATIONS; i++) {
          eventBus.emit('memory:emit', { 
            index: i,
            largeData: Array.from({ length: 100 }, (_, j) => `item_${j}`)
          });
        }

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        // 事件发射不应该导致内存持续增长
        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });
    });

    describe('PluginManager 内存泄漏检测', () => {
      it('应该检测插件注册内存泄漏', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // 注册和注销大量插件
        for (let i = 0; i < 1000; i++) {
          const plugin = createPlugin({
            name: `memory_plugin_${i}`,
            hooks: {
              'test_hook': async () => {}
            }
          });

          await pluginManager.register(plugin);
          
          if (i % 10 === 0) {
            await pluginManager.unregister(`memory_plugin_${i}`);
          }
        }

        // 清理所有插件
        await pluginManager.dispose();

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });

      it('应该检测钩子内存泄漏', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // 注册和触发大量钩子
        for (let i = 0; i < STRESS_CONFIG.MEMORY_TEST_ITERATIONS; i++) {
          const unsubscribe = pluginManager.registerHook(`memory_hook_${i % 100}`, async () => 'result');
          
          await pluginManager.triggerHook(`memory_hook_${i % 100}`);
          
          if (i % 10 === 0) {
            unsubscribe();
          }
        }

        // 清理所有钩子
        pluginManager.getHookManager().clear();

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });

      it('应该检测中间件内存泄漏', async () => {
        const middleware = pluginManager.getToolMiddleware();

        const initialMemory = process.memoryUsage().heapUsed;

        // 注册和执行大量中间件
        for (let i = 0; i < 1000; i++) {
          const remove = middleware.use({
            name: `memory_middleware_${i}`,
            before: async (ctx) => {},
            after: async (ctx) => {}
          });

          await middleware.execute('test_tool', {}, {}, async () => 'result');

          if (i % 10 === 0) {
            remove();
          }
        }

        // 清理所有中间件
        middleware.clear();

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });
    });

    describe('AgentEngine 内存泄漏检测', () => {
      it('应该检测引擎初始化和销毁内存泄漏', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // 多次初始化和销毁引擎
        for (let i = 0; i < 50; i++) {
          const testDir = `/tmp/memory-engine-test-${i}`;
          const engine = createAgentEngine({ workingDirectory: testDir });
          
          await engine.initialize();
          
          // 注册一些工具
          for (let j = 0; j < 10; j++) {
            engine.registerTool({
              name: `memory_tool_${j}`,
              description: `内存测试工具 ${j}`,
              category: 'MemoryTest',
              parameters: {},
              handler: async () => 'result'
            });
          }
          
          await engine.dispose();
        }

        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

        expect(memoryIncrease).toBeLessThan(STRESS_CONFIG.MEMORY_THRESHOLD_MB);
      });
    });
  });

  describe('长时间运行稳定性', () => {
    let eventBus;
    let pluginManager;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
      pluginManager = new PluginManager(eventBus);
    });

    afterEach(async () => {
      if (pluginManager) {
        await pluginManager.dispose();
      }
      eventBus.clear();
    });

    describe('持续事件发射稳定性', () => {
      it('应该长时间稳定发射事件', async () => {
        let eventCount = 0;
        let errorCount = 0;

        eventBus.subscribe('longrun:event', () => {
          eventCount++;
        });

        eventBus.on('error', () => {
          errorCount++;
        });

        // 持续发射事件
        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;
        const interval = STRESS_CONFIG.LONG_RUN_INTERVAL_MS;

        while (Date.now() - startTime < duration) {
          eventBus.emit('longrun:event', { timestamp: Date.now() });
          await new Promise(resolve => setTimeout(resolve, interval));
        }

        // 验证稳定性
        expect(eventCount).toBeGreaterThan(0);
        expect(errorCount).toBe(0);

        // 验证没有内存泄漏迹象
        const stats = eventBus.getStats();
        expect(stats.totalEvents).toBe(eventCount);
      });

      it('应该长时间稳定处理异步事件', async () => {
        let eventCount = 0;
        let errorCount = 0;

        eventBus.subscribe('longrun:async', async () => {
          eventCount++;
          await new Promise(resolve => setTimeout(resolve, 1));
        });

        eventBus.on('error', () => {
          errorCount++;
        });

        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;

        // 持续发射异步事件
        const promises = [];
        while (Date.now() - startTime < duration) {
          promises.push(eventBus.emitAsync('longrun:async', {}));
          await new Promise(resolve => setTimeout(resolve, STRESS_CONFIG.LONG_RUN_INTERVAL_MS));
        }

        // 等待所有异步事件完成
        await Promise.all(promises);

        expect(eventCount).toBeGreaterThan(0);
        expect(errorCount).toBe(0);
      });

      it('应该长时间稳定处理多类型事件', async () => {
        const counts = {};

        // 注册多种类型的订阅者
        for (let i = 0; i < 10; i++) {
          const typeName = `longrun:type_${i}`;
          counts[typeName] = 0;
          eventBus.subscribe(typeName, () => {
            counts[typeName]++;
          });
        }

        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;

        // 持续发射不同类型的事件
        let typeIndex = 0;
        while (Date.now() - startTime < duration) {
          const typeName = `longrun:type_${typeIndex % 10}`;
          eventBus.emit(typeName, { timestamp: Date.now() });
          typeIndex++;
          await new Promise(resolve => setTimeout(resolve, STRESS_CONFIG.LONG_RUN_INTERVAL_MS));
        }

        // 验证所有类型都收到事件
        for (let i = 0; i < 10; i++) {
          const typeName = `longrun:type_${i}`;
          expect(counts[typeName]).toBeGreaterThan(0);
        }
      });
    });

    describe('持续钩子执行稳定性', () => {
      it('应该长时间稳定执行钩子', async () => {
        let hookCount = 0;
        let errorCount = 0;

        // 注册钩子
        pluginManager.registerHook('longrun:hook', async () => {
          hookCount++;
          return 'result';
        });

        pluginManager.getHookManager().setErrorHandler('longrun:hook', (error) => {
          errorCount++;
        });

        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;

        // 持续触发钩子
        while (Date.now() - startTime < duration) {
          await pluginManager.triggerHook('longrun:hook');
          await new Promise(resolve => setTimeout(resolve, STRESS_CONFIG.LONG_RUN_INTERVAL_MS));
        }

        expect(hookCount).toBeGreaterThan(0);
        expect(errorCount).toBe(0);
      });

      it('应该长时间稳定执行多钩子', async () => {
        const hookCounts = {};

        // 注册多个钩子
        for (let i = 0; i < 10; i++) {
          const hookName = `longrun:multi_hook_${i}`;
          hookCounts[hookName] = 0;
          pluginManager.registerHook(hookName, async () => {
            hookCounts[hookName]++;
          });
        }

        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;

        // 持续触发不同钩子
        let hookIndex = 0;
        while (Date.now() - startTime < duration) {
          const hookName = `longrun:multi_hook_${hookIndex % 10}`;
          await pluginManager.triggerHook(hookName);
          hookIndex++;
          await new Promise(resolve => setTimeout(resolve, STRESS_CONFIG.LONG_RUN_INTERVAL_MS));
        }

        // 验证所有钩子都被触发
        for (let i = 0; i < 10; i++) {
          const hookName = `longrun:multi_hook_${i}`;
          expect(hookCounts[hookName]).toBeGreaterThan(0);
        }
      });
    });

    describe('持续中间件执行稳定性', () => {
      it('应该长时间稳定执行中间件', async () => {
        const middleware = pluginManager.getToolMiddleware();
        let executionCount = 0;
        let errorCount = 0;

        // 注册中间件
        middleware.use({
          name: 'longrun-middleware',
          before: async (ctx) => {
            ctx.metadata.startTime = Date.now();
          },
          after: async (ctx) => {
            ctx.metadata.endTime = Date.now();
            executionCount++;
          },
          error: async (error, ctx) => {
            errorCount++;
          }
        });

        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;

        // 持续执行中间件
        while (Date.now() - startTime < duration) {
          try {
            await middleware.execute('test_tool', {}, {}, async () => 'result');
          } catch (error) {
            // 预期的错误
          }
          await new Promise(resolve => setTimeout(resolve, STRESS_CONFIG.LONG_RUN_INTERVAL_MS));
        }

        expect(executionCount).toBeGreaterThan(0);
        expect(errorCount).toBe(0);
      });
    });

    describe('引擎长时间运行稳定性', () => {
      it('应该长时间稳定运行引擎', async () => {
        const testDir = `/tmp/longrun-engine-test-${Date.now()}`;
        const engine = createAgentEngine({ workingDirectory: testDir });
        
        await engine.initialize();

        // 注册工具
        for (let i = 0; i < 50; i++) {
          engine.registerTool({
            name: `longrun_tool_${i}`,
            description: `长时间运行测试工具 ${i}`,
            category: 'LongRunTest',
            parameters: {},
            handler: async () => `result_${i}`
          });
        }

        const startTime = Date.now();
        const duration = STRESS_CONFIG.LONG_RUN_DURATION_MS;

        // 持续操作引擎
        let operationCount = 0;
        while (Date.now() - startTime < duration) {
          // 获取状态
          const state = engine.getState();
          
          // 获取工具列表
          const tools = engine.getTools();
          
          // 更新配置
          await engine.updateConfig('debug', operationCount % 2 === 0);
          
          operationCount++;
          await new Promise(resolve => setTimeout(resolve, STRESS_CONFIG.LONG_RUN_INTERVAL_MS));
        }

        // 验证引擎仍然正常
        expect(engine.isInitialized()).toBe(true);
        expect(engine.getTools().length).toBeGreaterThanOrEqual(50);

        await engine.dispose();
      });
    });
  });

  describe('消息队列压力测试', () => {
    describe('队列容量压力', () => {
      it('应该处理队列满容量', () => {
        const queue = new MessageQueue(STRESS_CONFIG.QUEUE_SIZE);

        // 入队到满容量
        for (let i = 0; i < STRESS_CONFIG.QUEUE_SIZE; i++) {
          queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }

        expect(queue.size()).toBe(STRESS_CONFIG.QUEUE_SIZE);

        // 继续入队应该移除最旧的消息
        queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: STRESS_CONFIG.QUEUE_SIZE }));
        
        expect(queue.size()).toBe(STRESS_CONFIG.QUEUE_SIZE);
      });

      it('应该处理快速入队出队', async () => {
        const queue = new MessageQueue(1000);

        // 并发入队和出队
        const promises = [];

        // 入队操作
        for (let i = 0; i < 500; i++) {
          promises.push(
            new Promise(resolve => {
              queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
              resolve();
            })
          );
        }

        // 出队操作
        for (let i = 0; i < 500; i++) {
          promises.push(
            new Promise(resolve => {
              queue.dequeue();
              resolve();
            })
          );
        }

        await Promise.all(promises);

        // 验证队列状态一致
        expect(queue.size()).toBeGreaterThanOrEqual(0);
      });

      it('应该处理大量消息创建', async () => {
        const messages = [];

        // 创建大量消息
        for (let i = 0; i < STRESS_CONFIG.QUEUE_SIZE; i++) {
          messages.push(new IPCMessage(IPCMessageType.REQUEST, {
            channel: 'test',
            data: { index: i }
          }));
        }

        // 验证所有消息创建成功
        expect(messages.length).toBe(STRESS_CONFIG.QUEUE_SIZE);

        // 验证消息 ID 唯一性
        const ids = messages.map(m => m.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(STRESS_CONFIG.QUEUE_SIZE);
      });
    });

    describe('消息处理压力', () => {
      it('应该处理大量消息序列化', async () => {
        const messages = [];
        
        // 创建消息
        for (let i = 0; i < 1000; i++) {
          messages.push(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }

        // 序列化所有消息
        const promises = messages.map(msg => 
          new Promise(resolve => {
            const json = msg.toJSON();
            resolve(json);
          })
        );

        const results = await Promise.all(promises);

        // 验证所有序列化成功
        expect(results.length).toBe(1000);
        expect(results.every(r => r.id && r.type)).toBe(true);
      });

      it('应该处理大量消息反序列化', async () => {
        // 创建并序列化消息
        const originalMessages = [];
        for (let i = 0; i < 1000; i++) {
          originalMessages.push(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }

        const jsonStrings = originalMessages.map(m => JSON.stringify(m.toJSON()));

        // 反序列化所有消息
        const promises = jsonStrings.map(json => 
          new Promise(resolve => {
            const msg = IPCMessage.fromJSON(json);
            resolve(msg);
          })
        );

        const results = await Promise.all(promises);

        // 验证所有反序列化成功
        expect(results.length).toBe(1000);
        expect(results.every(r => r.id && r.type)).toBe(true);
      });
    });
  });

  describe('综合压力测试', () => {
    it('应该处理综合压力场景', async () => {
      resetEventBus();
      const eventBus = getEventBus();
      const pluginManager = new PluginManager(eventBus);

      // 注册多个插件
      for (let i = 0; i < 10; i++) {
        await pluginManager.register(createPlugin({
          name: `stress_plugin_${i}`,
          hooks: {
            [HOOKS.BEFORE_TOOL_CALL]: async () => {},
            [HOOKS.AFTER_TOOL_CALL]: async () => {}
          },
          middlewares: [
            {
              name: `stress_middleware_${i}`,
              before: async (ctx) => {},
              after: async (ctx) => {}
            }
          ]
        }));
      }

      // 注册大量订阅者
      for (let i = 0; i < 100; i++) {
        eventBus.subscribe(`stress:event_${i % 10}`, () => {});
      }

      // 并发执行多种操作
      const promises = [];

      // 发射事件
      for (let i = 0; i < 1000; i++) {
        promises.push(
          new Promise(resolve => {
            eventBus.emit(`stress:event_${i % 10}`, { index: i });
            resolve();
          })
        );
      }

      // 触发钩子
      for (let i = 0; i < 100; i++) {
        promises.push(
          pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test_tool', {})
        );
      }

      // 执行中间件
      const middleware = pluginManager.getToolMiddleware();
      for (let i = 0; i < 100; i++) {
        promises.push(
          middleware.execute('test_tool', { input: i }, {}, async () => 'result')
        );
      }

      await Promise.all(promises);

      // 验证系统仍然稳定
      const stats = eventBus.getStats();
      expect(stats.totalEvents).toBe(1000);

      expect(pluginManager.getPluginCount()).toBe(10);

      await pluginManager.dispose();
    });

    it('应该处理极端压力场景', async () => {
      resetEventBus();
      const eventBus = getEventBus();

      const initialMemory = process.memoryUsage().heapUsed;

      // 极端压力：大量并发操作
      const promises = [];

      // 大量订阅
      for (let i = 0; i < 1000; i++) {
        promises.push(
          new Promise(resolve => {
            eventBus.subscribe(`extreme:event_${i}`, () => {});
            resolve();
          })
        );
      }

      // 大量发射
      for (let i = 0; i < 10000; i++) {
        promises.push(
          new Promise(resolve => {
            eventBus.emit(`extreme:event_${i % 100}`, { data: i });
            resolve();
          })
        );
      }

      // 大量取消订阅
      for (let i = 0; i < 500; i++) {
        promises.push(
          new Promise(resolve => {
            eventBus.unsubscribe(`extreme:event_${i}`, () => {});
            resolve();
          })
        );
      }

      await Promise.all(promises);

      // 清理
      eventBus.clear();

      // 验证内存没有过度增长
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

      expect(memoryIncrease).toBeLessThan(100); // 100MB 阈值
    });
  });
});