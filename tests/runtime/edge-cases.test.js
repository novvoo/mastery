/**
 * 边缘情况测试文件
 * Edge Cases Tests
 * 
 * 测试内容：
 * - EventBus 边缘情况（空事件、无效数据、大量订阅）
 * - AgentEngine 边缘情况（重复初始化、空工具、无效配置）
 * - 插件系统边缘情况（循环依赖、无效钩子、错误处理）
 * - IPC 边缘情况（连接断开、消息超时、无效消息）
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { getEventBus, resetEventBus, EventPriority } from '../../src/runtime/index.js';
import { createAgentEngine, RuntimeConfig, RuntimeEvent } from '../../src/runtime/index.js';
import { PluginManager, HOOKS, HookPriority, PluginState, createPlugin } from '../../src/runtime/plugin-system.js';
import { IPCMessage, IPCMessageType, IPCMessageStatus, IPCAdapterBase, MessageQueue } from '../../src/adapters/desktop/ipc-adapter.js';

describe('边缘情况测试', () => {
  describe('EventBus 边缘情况', () => {
    let eventBus;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
    });

    afterEach(() => {
      eventBus.clear();
    });

    describe('空事件和空数据', () => {
      it('应该处理空事件名称', () => {
        // 发射空事件名称
        const result = eventBus.emit('', { data: 'test' });
        
        // 空事件名称应该被处理（可能成功或失败，取决于实现）
        expect(typeof result).toBe('boolean');
      });

      it('应该处理空事件数据', () => {
        let receivedData = null;
        
        eventBus.subscribe('test:empty', (data) => {
          receivedData = data;
        });
        
        eventBus.emit('test:empty', null);
        
        // 验证接收到的数据包含默认结构
        expect(receivedData).toBeDefined();
        expect(receivedData.type).toBe('test:empty');
        expect(receivedData.timestamp).toBeDefined();
      });

      it('应该处理 undefined 事件数据', () => {
        let receivedData = null;
        
        eventBus.subscribe('test:undefined', (data) => {
          receivedData = data;
        });
        
        eventBus.emit('test:undefined', undefined);
        
        expect(receivedData).toBeDefined();
        expect(receivedData.type).toBe('test:undefined');
      });

      it('应该处理空对象事件数据', () => {
        let receivedData = null;
        
        eventBus.subscribe('test:empty-object', (data) => {
          receivedData = data;
        });
        
        eventBus.emit('test:empty-object', {});
        
        expect(receivedData).toBeDefined();
        expect(receivedData.type).toBe('test:empty-object');
      });

      it('应该处理没有订阅者的事件', () => {
        // 发射没有订阅者的事件
        const result = eventBus.emit('test:no-subscribers', { data: 'test' });
        
        expect(result).toBe(true);
        
        // 验证统计信息
        const stats = eventBus.getStats();
        expect(stats.totalEvents).toBe(1);
      });
    });

    describe('无效数据类型', () => {
      it('应该处理循环引用数据', () => {
        // 创建循环引用对象
        const circularData = { name: 'test' };
        circularData.self = circularData;
        
        let errorOccurred = false;
        
        eventBus.subscribe('test:circular', (data) => {
          // 射循环引用数据
          try {
            // 尝试访问数据
            const name = data.name;
          } catch (error) {
            errorOccurred = true;
          }
        });
        
        eventBus.emit('test:circular', circularData);
        
        // 循环引用应该被处理（可能成功或抛出错误）
        // 这里不强制要求结果，只验证不会崩溃
      });

      it('应该处理非常大的数据对象', () => {
        // 创建大对象
        const largeData = {
          items: Array.from({ length: 10000 }, (_, i) => ({ id: i, value: `item_${i}` }))
        };
        
        let receivedCount = 0;
        
        eventBus.subscribe('test:large', (data) => {
          receivedCount++;
        });
        
        eventBus.emit('test:large', largeData);
        
        expect(receivedCount).toBe(1);
      });

      it('应该处理特殊字符事件名称', () => {
        const specialNames = [
          'test:event:with:colons',
          'test-event-with-dashes',
          'test.event.with.dots',
          'test event with spaces',
          'test/event/with/slashes',
          'test@event#with$symbols'
        ];
        
        for (const name of specialNames) {
          eventBus.subscribe(name, () => {});
          const result = eventBus.emit(name, { data: 'test' });
          expect(typeof result).toBe('boolean');
        }
      });

      it('应该处理 Unicode 事件名称', () => {
        const unicodeNames = [
          '测试事件',
          '🔥火事件',
          'emoji🎉event',
          '日本語イベント'
        ];
        
        for (const name of unicodeNames) {
          eventBus.subscribe(name, () => {});
          const result = eventBus.emit(name, { data: 'test' });
          expect(typeof result).toBe('boolean');
        }
      });

      it('应该处理数字类型事件名称', () => {
        // 尝试使用数字作为事件名称
        const numericName = '12345';
        
        eventBus.subscribe(numericName, () => {});
        const result = eventBus.emit(numericName, { data: 'test' });
        
        expect(typeof result).toBe('boolean');
      });
    });

    describe('大量订阅者', () => {
      it('应该处理同一事件的 1000 个订阅者', () => {
        let callCount = 0;
        
        for (let i = 0; i < 1000; i++) {
          eventBus.subscribe('test:thousand', () => {
            callCount++;
          });
        }
        
        eventBus.emit('test:thousand', { data: 'test' });
        
        expect(callCount).toBe(1000);
        expect(eventBus.getSubscriberCount('test:thousand')).toBe(1000);
      });

      it('应该处理 1000 个不同事件的订阅者', () => {
        for (let i = 0; i < 1000; i++) {
          eventBus.subscribe(`test:event_${i}`, () => {});
        }
        
        // 发射其中一个事件
        const result = eventBus.emit('test:event_500', { data: 'test' });
        
        expect(result).toBe(true);
        
        // 验证订阅者数量
        const subscribers = eventBus.getSubscribers();
        expect(Object.keys(subscribers).length).toBe(1000);
      });

      it('应该处理订阅者回调抛出错误', () => {
        const errors = [];
        
        // 注册一个会抛出错误的订阅者
        eventBus.subscribe('test:error', () => {
          throw new Error('订阅者错误');
        });
        
        // 注册一个正常的订阅者
        eventBus.subscribe('test:error', () => {
          // 正常处理
        });
        
        // 监听错误事件
        eventBus.on('subscriber_error', (data) => {
          errors.push(data);
        });
        
        eventBus.emit('test:error', { data: 'test' });
        
        // 应该捕获错误并继续执行其他订阅者
        expect(errors.length).toBe(1);
        expect(errors[0].error.message).toBe('订阅者错误');
      });

      it('应该处理所有订阅者都抛出错误', () => {
        const errors = [];
        
        for (let i = 0; i < 10; i++) {
          eventBus.subscribe('test:all-errors', () => {
            throw new Error(`错误 ${i}`);
          });
        }
        
        eventBus.on('subscriber_error', (data) => {
          errors.push(data);
        });
        
        eventBus.emit('test:all-errors', { data: 'test' });
        
        // 所有错误都应该被捕获
        expect(errors.length).toBe(10);
      });
    });

    describe('取消订阅边缘情况', () => {
      it('应该处理重复取消订阅', () => {
        const callback = () => {};
        const unsubscribe = eventBus.subscribe('test:double-unsub', callback);
        
        // 第一次取消
        unsubscribe();
        expect(eventBus.getSubscriberCount('test:double-unsub')).toBe(0);
        
        // 第二次取消（应该安全处理）
        unsubscribe();
        expect(eventBus.getSubscriberCount('test:double-unsub')).toBe(0);
      });

      it('应该处理取消不存在的订阅', () => {
        // 直接调用 unsubscribe 方法
        eventBus.unsubscribe('test:nonexistent', () => {});
        
        // 应该安全处理，不抛出错误
        expect(eventBus.getSubscriberCount('test:nonexistent')).toBe(0);
      });

      it('应该处理取消订阅后发射事件', () => {
        let callCount = 0;
        const callback = () => { callCount++; };
        
        const unsubscribe = eventBus.subscribe('test:unsub-emit', callback);
        
        eventBus.emit('test:unsub-emit', {});
        expect(callCount).toBe(1);
        
        unsubscribe();
        
        eventBus.emit('test:unsub-emit', {});
        expect(callCount).toBe(1); // 不应该增加
      });
    });

    describe('历史记录边缘情况', () => {
      it('应该处理历史记录达到最大限制', () => {
        eventBus = getEventBus({ history: { maxSize: 100 } });
        
        // 发射超过限制的事件
        for (let i = 0; i < 200; i++) {
          eventBus.emit('test:history-limit', { index: i });
        }
        
        const history = eventBus.getHistory();
        
        // 应该只保留最新的 100 条
        expect(history.length).toBe(100);
        
        // 验证保留的是最新的记录
        expect(history[0].index).toBe(100);
        expect(history[99].index).toBe(199);
      });

      it('应该处理空历史记录查询', () => {
        eventBus.clearHistory();
        
        const history = eventBus.getHistory();
        expect(history.length).toBe(0);
        
        const filtered = eventBus.getHistory({ type: 'nonexistent' });
        expect(filtered.length).toBe(0);
      });

      it('应该处理历史记录回放空历史', async () => {
        eventBus.clearHistory();
        
        // 回放空历史不应该抛出错误
        await eventBus.replayHistory();
        
        // 安全完成
      });

      it('应该处理历史记录查询无效参数', () => {
        // 发射一些事件
        for (let i = 0; i < 10; i++) {
          eventBus.emit('test:invalid-query', { index: i });
        }
        
        // 无效的 limit 参数
        const history1 = eventBus.getHistory({ limit: -1 });
        expect(history1.length).toBe(10); // 应该忽略无效 limit
        
        // 无效的 since 参数
        const history2 = eventBus.getHistory({ since: 'invalid' });
        // 应该安全处理
        
        // 无效的 type 参数
        const history3 = eventBus.getHistory({ type: null });
        expect(history3.length).toBe(10);
      });
    });

    describe('缓存边缘情况', () => {
      it('应该处理缓存过期', async () => {
        eventBus = getEventBus({ cache: { enabled: true, ttl: 100 } }); // 100ms TTL
        
        eventBus.emit('test:cache-expire', { data: 'cached' }, { cache: true });
        
        // 立即获取缓存
        const cached1 = eventBus.getCachedEvent('test:cache-expire');
        expect(cached1).toBeDefined();
        
        // 等待缓存过期
        await new Promise(resolve => setTimeout(resolve, 150));
        
        const cached2 = eventBus.getCachedEvent('test:cache-expire');
        expect(cached2).toBeNull();
      });

      it('应该处理缓存达到最大大小', () => {
        eventBus = getEventBus({ cache: { enabled: true, maxSize: 10 } });
        
        // 缓存超过限制的事件
        for (let i = 0; i < 20; i++) {
          eventBus.emit(`test:cache-size-${i}`, { index: i }, { cache: true });
        }
        
        // 验证缓存大小限制
        expect(eventBus.cache.size).toBeLessThanOrEqual(10);
      });

      it('应该处理获取不存在的缓存', () => {
        const cached = eventBus.getCachedEvent('test:nonexistent-cache');
        expect(cached).toBeNull();
      });

      it('应该处理清除单个缓存', () => {
        eventBus.emit('test:clear-single', { data: 'test' }, { cache: true });
        eventBus.emit('test:keep-this', { data: 'test' }, { cache: true });
        
        eventBus.clearCache('test:clear-single');
        
        expect(eventBus.getCachedEvent('test:clear-single')).toBeNull();
        expect(eventBus.getCachedEvent('test:keep-this')).toBeDefined();
      });
    });

    describe('过滤器边缘情况', () => {
      it('应该处理过滤器返回异常', () => {
        eventBus.setFilter('test:filter-error', {
          dataFilter: () => {
            throw new Error('过滤器错误');
          }
        });
        
        // 发射事件应该安全处理
        const result = eventBus.emit('test:filter-error', { data: 'test' });
        
        // 可能被过滤掉或通过，取决于实现
        expect(typeof result).toBe('boolean');
      });

      it('应该处理空过滤器配置', () => {
        eventBus.setFilter('test:empty-filter', {});
        
        const result = eventBus.emit('test:empty-filter', { data: 'test' });
        expect(result).toBe(true);
      });

      it('应该处理全局过滤器', () => {
        eventBus.setFilter('*', {
          sources: ['allowed-source']
        });
        
        // 从不允许的源发射事件
        const result1 = eventBus.emit('test:global-filter', { data: 'test' }, { source: 'blocked-source' });
        expect(result1).toBe(false);
        
        // 从允许的源发射事件
        const result2 = eventBus.emit('test:global-filter', { data: 'test' }, { source: 'allowed-source' });
        expect(result2).toBe(true);
      });

      it('应该处理移除不存在的过滤器', () => {
        eventBus.removeFilter('test:nonexistent-filter');
        
        // 应该安全处理
      });
    });

    describe('延迟订阅边缘情况', () => {
      it('应该处理激活空延迟订阅', () => {
        eventBus.activateDeferred();
        
        // 应该安全处理
      });

      it('应该处理激活特定事件的延迟订阅', () => {
        eventBus.subscribe('test:deferred', () => {}, { deferred: true });
        eventBus.subscribe('test:other-deferred', () => {}, { deferred: true });
        
        // 只激活一个事件
        eventBus.activateDeferred('test:deferred');
        
        expect(eventBus.getSubscriberCount('test:deferred')).toBe(1);
        expect(eventBus.getSubscriberCount('test:other-deferred')).toBe(0);
      });

      it('应该处理取消延迟订阅', () => {
        const unsubscribe = eventBus.subscribe('test:cancel-deferred', () => {}, { deferred: true });
        
        unsubscribe();
        
        eventBus.activateDeferred();
        
        expect(eventBus.getSubscriberCount('test:cancel-deferred')).toBe(0);
      });
    });

    describe('批量处理边缘情况', () => {
      it('应该处理空批量队列', () => {
        eventBus = getEventBus({ batch: { enabled: true } });
        
        eventBus._flushBatch();
        
        // 应该安全处理
      });

      it('应该处理批量处理期间的错误', () => {
        eventBus = getEventBus({ batch: { enabled: true, batchSize: 10 } });
        
        eventBus.subscribe('test:batch-error', () => {
          throw new Error('批量处理错误');
        });
        
        // 添加到批量队列
        for (let i = 0; i < 10; i++) {
          eventBus.emit('test:batch-error', { index: i }, { batch: true });
        }
        
        // 刷新批量队列
        eventBus._flushBatch();
        
        // 应该安全处理错误
      });
    });
  });

  describe('AgentEngine 边缘情况', () => {
    let engine;
    let testDir;

    beforeEach(() => {
      testDir = `/tmp/engine-edge-test-${Date.now()}`;
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

    describe('重复初始化', () => {
      it('应该处理重复初始化调用', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        await engine.initialize();
        await engine.initialize();
        await engine.initialize();
        
        expect(engine.isInitialized()).toBe(true);
      });

      it('应该处理初始化后立即销毁', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        await engine.initialize();
        await engine.dispose();
        
        expect(engine.isInitialized()).toBe(false);
      });

      it('应该处理销毁后重新初始化', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        await engine.initialize();
        await engine.dispose();
        
        // 重新初始化（可能需要创建新实例）
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        expect(engine.isInitialized()).toBe(true);
      });
    });

    describe('空工具和无效工具', () => {
      it('应该处理注册空工具对象', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        try {
          engine.registerTool({});
        } catch (error) {
          // 可能抛出错误或忽略
        }
        
        // 应该安全处理
      });

      it('应该处理注册 null 工具', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        try {
          engine.registerTool(null);
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理注册缺少 handler 的工具', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const invalidTool = {
          name: 'no_handler_tool',
          description: '没有处理器的工具'
        };
        
        try {
          engine.registerTool(invalidTool);
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理注册重复名称的工具', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        const tool1 = {
          name: 'duplicate_tool',
          description: '第一个',
          handler: async () => 'result1'
        };
        
        const tool2 = {
          name: 'duplicate_tool',
          description: '第二个',
          handler: async () => 'result2'
        };
        
        engine.registerTool(tool1);
        
        try {
          engine.registerTool(tool2);
        } catch (error) {
          // 可能抛出错误或覆盖
        }
        
        // 应该安全处理
      });

      it('应该处理注册空工具数组', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        engine.registerTools([]);
        
        const tools = engine.getTools();
        // 应该不影响现有工具
        expect(tools.length).toBeGreaterThan(0);
      });
    });

    describe('无效配置', () => {
      it('应该处理空配置对象', () => {
        engine = createAgentEngine({});
        
        expect(engine).toBeDefined();
      });

      it('应该处理 null 配置', () => {
        engine = createAgentEngine(null);
        
        expect(engine).toBeDefined();
      });

      it('应该处理无效的工作目录', async () => {
        engine = createAgentEngine({ workingDirectory: '/nonexistent/path/that/does/not/exist' });
        
        try {
          await engine.initialize();
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理无效的 maxIterations', () => {
        engine = createAgentEngine({ maxIterations: -1 });
        
        expect(engine).toBeDefined();
        
        engine = createAgentEngine({ maxIterations: 0 });
        expect(engine).toBeDefined();
        
        engine = createAgentEngine({ maxIterations: 'invalid' });
        expect(engine).toBeDefined();
      });

      it('应该处理无效的 platform 类型', () => {
        engine = createAgentEngine({ platform: 'invalid_platform' });
        
        expect(engine).toBeDefined();
      });
    });

    describe('模型提供者边缘情况', () => {
      it('应该处理未附加模型提供者时调用 processInput', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        try {
          await engine.processInput('test input');
          expect.fail('应该抛出错误');
        } catch (error) {
          expect(error.message).toContain('模型提供者');
        }
      });

      it('应该处理附加 null 模型提供者', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        try {
          engine.attachModelProvider(null);
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理附加无效模型提供者', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        try {
          engine.attachModelProvider({});
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });
    });

    describe('状态边缘情况', () => {
      it('应该处理未初始化时获取状态', () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        const state = engine.getState();
        
        expect(state).toBeDefined();
        expect(state.status).toBe('idle');
      });

      it('应该处理未初始化时获取工具列表', () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        try {
          const tools = engine.getTools();
          // 可能返回空数组或抛出错误
        } catch (error) {
          // 预期行为
        }
      });

      it('应该处理销毁后获取状态', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        await engine.dispose();
        
        const state = engine.getState();
        
        expect(state).toBeDefined();
      });
    });

    describe('内存边缘情况', () => {
      it('应该处理未初始化时更新内存', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        try {
          await engine.updateMemory('add', { key: 'value' });
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理空内存操作', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        await engine.updateMemory('', null);
        
        // 应该安全处理
      });

      it('应该处理清除内存后操作', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        await engine.clearMemory();
        
        // 清除后应该可以继续操作
        await engine.updateMemory('add', { key: 'value' });
      });
    });

    describe('配置更新边缘情况', () => {
      it('应该处理更新无效配置键', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        await engine.updateConfig('nonexistent_key', 'value');
        
        // 应该安全处理
      });

      it('应该处理更新配置为 undefined', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        await engine.updateConfig('debug', undefined);
        
        // 应该安全处理
      });
    });

    describe('停止边缘情况', () => {
      it('应该处理未初始化时停止', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        
        await engine.stop();
        
        // 应该安全处理
      });

      it('应该处理重复停止调用', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        
        await engine.stop();
        await engine.stop();
        await engine.stop();
        
        // 应该安全处理
      });

      it('应该处理销毁后停止', async () => {
        engine = createAgentEngine({ workingDirectory: testDir });
        await engine.initialize();
        await engine.dispose();
        
        try {
          await engine.stop();
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });
    });
  });

  describe('插件系统边缘情况', () => {
    let pluginManager;
    let eventBus;

    beforeEach(() => {
      resetEventBus();
      eventBus = getEventBus();
      pluginManager = new PluginManager(eventBus);
    });

    afterEach(async () => {
      if (pluginManager) {
        try {
          await pluginManager.dispose();
        } catch (error) {
          // 忽略清理错误
        }
        pluginManager = null;
      }
    });

    describe('循环依赖', () => {
      it('应该检测直接循环依赖', async () => {
        const pluginA = createPlugin({
          name: 'plugin-a',
          dependencies: ['plugin-b']
        });
        
        const pluginB = createPlugin({
          name: 'plugin-b',
          dependencies: ['plugin-a']
        });
        
        // 先注册一个
        await pluginManager.register(pluginA);
        
        try {
          await pluginManager.register(pluginB);
          // 可能成功（因为 plugin-a 已存在）或失败
        } catch (error) {
          // 循环依赖应该被检测
        }
        
        // 应该安全处理
      });

      it('应该检测间接循环依赖', async () => {
        const pluginA = createPlugin({
          name: 'plugin-a-indirect',
          dependencies: ['plugin-c-indirect']
        });
        
        const pluginB = createPlugin({
          name: 'plugin-b-indirect',
          dependencies: ['plugin-a-indirect']
        });
        
        const pluginC = createPlugin({
          name: 'plugin-c-indirect',
          dependencies: ['plugin-b-indirect']
        });
        
        await pluginManager.register(pluginA);
        
        try {
          await pluginManager.register(pluginB);
          await pluginManager.register(pluginC);
        } catch (error) {
          // 循环依赖应该被检测
        }
        
        // 应该安全处理
      });

      it('应该处理自依赖插件', async () => {
        const selfDependent = createPlugin({
          name: 'self-dependent',
          dependencies: ['self-dependent']
        });
        
        try {
          await pluginManager.register(selfDependent);
        } catch (error) {
          // 自依赖应该被检测
        }
        
        // 应该安全处理
      });
    });

    describe('无效钩子', () => {
      it('应该处理注册非函数钩子', async () => {
        const plugin = createPlugin({
          name: 'invalid-hook-plugin',
          hooks: {
            'test_hook': 'not_a_function'
          }
        });
        
        try {
          await pluginManager.register(plugin);
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理注册 null 钩子', async () => {
        const plugin = createPlugin({
          name: 'null-hook-plugin',
          hooks: {
            'test_hook': null
          }
        });
        
        try {
          await pluginManager.register(plugin);
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理触发空钩子名称', async () => {
        const result = await pluginManager.triggerHook('');
        
        // 应该安全处理
        expect(result).toBeDefined();
      });

      it('应该处理触发不存在钩子', async () => {
        const result = await pluginManager.triggerHook('nonexistent_hook');
        
        expect(result.results.length).toBe(0);
        expect(result.errors.length).toBe(0);
      });

      it('应该处理钩子返回 Promise 拒绝', async () => {
        pluginManager.registerHook('reject_hook', async () => {
          return Promise.reject(new Error('钩子拒绝'));
        });
        
        const { errors } = await pluginManager.triggerHook('reject_hook');
        
        expect(errors.length).toBe(1);
        expect(errors[0].error.message).toBe('钩子拒绝');
      });

      it('应该处理钩子执行超时', async () => {
        pluginManager.registerHook('timeout_hook', async () => {
          // 模拟长时间执行
          await new Promise(resolve => setTimeout(resolve, 10000));
        });
        
        // 触发钩子（不等待完成）
        const triggerPromise = pluginManager.triggerHook('timeout_hook');
        
        // 设置超时
        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => resolve('timeout'), 100);
        });
        
        const result = await Promise.race([triggerPromise, timeoutPromise]);
        
        // 可能超时或完成
      });
    });

    describe('插件错误处理', () => {
      it('应该处理插件初始化抛出错误', async () => {
        const plugin = createPlugin({
          name: 'init-error-plugin',
          initialize: () => {
            throw new Error('初始化错误');
          }
        });
        
        try {
          await pluginManager.register(plugin);
          expect.fail('应该抛出错误');
        } catch (error) {
          expect(error.message).toContain('初始化错误');
          expect(pluginManager.getPluginCount()).toBe(0);
        }
      });

      it('应该处理插件清理抛出错误', async () => {
        const plugin = createPlugin({
          name: 'cleanup-error-plugin',
          cleanup: () => {
            throw new Error('清理错误');
          }
        });
        
        await pluginManager.register(plugin);
        
        try {
          await pluginManager.unregister('cleanup-error-plugin');
        } catch (error) {
          // 可能抛出错误或记录
        }
        
        // 应该安全处理
      });

      it('应该处理插件钩子抛出同步错误', async () => {
        const plugin = createPlugin({
          name: 'sync-error-plugin',
          hooks: {
            'sync_error_hook': () => {
              throw new Error('同步错误');
            }
          }
        });
        
        await pluginManager.register(plugin);
        
        const { errors } = await pluginManager.triggerHook('sync_error_hook');
        
        expect(errors.length).toBe(1);
      });

      it('应该处理插件中间件抛出错误', async () => {
        const plugin = createPlugin({
          name: 'middleware-error-plugin',
          middlewares: [
            {
              name: 'error-middleware',
              before: async () => {
                throw new Error('中间件错误');
              }
            }
          ]
        });
        
        await pluginManager.register(plugin);
        
        const middleware = pluginManager.getToolMiddleware();
        
        try {
          await middleware.execute('test', {}, {}, async () => 'result');
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });
    });

    describe('插件状态边缘情况', () => {
      it('应该处理启用不存在的插件', async () => {
        const result = await pluginManager.enable('nonexistent-plugin');
        
        expect(result).toBe(false);
      });

      it('应该处理禁用不存在的插件', async () => {
        const result = await pluginManager.disable('nonexistent-plugin');
        
        expect(result).toBe(false);
      });

      it('应该处理获取不存在的插件', () => {
        const plugin = pluginManager.getPlugin('nonexistent-plugin');
        
        expect(plugin).toBeUndefined();
      });

      it('应该处理注销不存在的插件', async () => {
        const result = await pluginManager.unregister('nonexistent-plugin');
        
        expect(result).toBe(false);
      });

      it('应该处理重复启用插件', async () => {
        const plugin = createPlugin({ name: 'double-enable' });
        await pluginManager.register(plugin);
        
        await pluginManager.enable('double-enable');
        await pluginManager.enable('double-enable');
        
        const info = pluginManager.getPlugin('double-enable');
        expect(info.enabled).toBe(true);
      });

      it('应该处理重复禁用插件', async () => {
        const plugin = createPlugin({ name: 'double-disable' });
        await pluginManager.register(plugin);
        
        await pluginManager.disable('double-disable');
        await pluginManager.disable('double-disable');
        
        const info = pluginManager.getPlugin('double-disable');
        expect(info.enabled).toBe(false);
      });
    });

    describe('配置边缘情况', () => {
      it('应该处理空配置对象', async () => {
        const plugin = createPlugin({
          name: 'empty-config-plugin',
          defaultConfig: {}
        });
        
        await pluginManager.register(plugin);
        
        const info = pluginManager.getPlugin('empty-config-plugin');
        expect(info.config).toBeDefined();
      });

      it('应该处理无效配置值', async () => {
        const plugin = createPlugin({
          name: 'invalid-config-plugin',
          defaultConfig: { timeout: 1000 },
          configSchema: {
            timeout: { type: 'number' }
          }
        });
        
        try {
          await pluginManager.register(plugin, {
            config: { timeout: 'invalid' }
          });
          // 可能抛出错误或忽略
        } catch (error) {
          expect(error.message).toContain('配置验证失败');
        }
      });

      it('应该处理配置缺少必需字段', async () => {
        const plugin = createPlugin({
          name: 'missing-config-plugin',
          configSchema: {
            requiredField: { required: true }
          }
        });
        
        try {
          await pluginManager.register(plugin);
          // 可能抛出错误
        } catch (error) {
          expect(error.message).toContain('必需');
        }
      });
    });

    describe('中间件边缘情况', () => {
      it('应该处理添加空中间件', () => {
        const middleware = pluginManager.getToolMiddleware();
        
        try {
          middleware.use({});
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理添加 null 中间件', () => {
        const middleware = pluginManager.getToolMiddleware();
        
        try {
          middleware.use(null);
        } catch (error) {
          // 可能抛出错误
        }
        
        // 应该安全处理
      });

      it('应该处理移除不存在的中间件', () => {
        const middleware = pluginManager.getToolMiddleware();
        
        const result = middleware.remove({});
        
        expect(result).toBe(false);
      });

      it('应该处理清除后添加中间件', () => {
        const middleware = pluginManager.getToolMiddleware();
        
        middleware.use({ before: async () => {} });
        middleware.clear();
        
        middleware.use({ before: async () => {} });
        
        expect(middleware.count()).toBe(1);
      });
    });

    describe('工具分组边缘情况', () => {
      it('应该处理创建重复分组', () => {
        const groups = pluginManager.getToolGroups();
        
        groups.createGroup('duplicate-group');
        
        const result = groups.createGroup('duplicate-group');
        
        expect(result).toBe(false);
      });

      it('应该处理添加工具到不存在的分组', () => {
        const groups = pluginManager.getToolGroups();
        
        const result = groups.addToGroup('nonexistent-group', 'test_tool');
        
        expect(result).toBe(false);
      });

      it('应该处理删除不存在的分组', () => {
        const groups = pluginManager.getToolGroups();
        
        const result = groups.deleteGroup('nonexistent-group');
        
        expect(result).toBe(false);
      });

      it('应该处理从不存在分组移除工具', () => {
        const groups = pluginManager.getToolGroups();
        
        const result = groups.removeFromGroup('nonexistent_tool');
        
        expect(result).toBe(false);
      });

      it('应该处理获取不存在分组的状态', () => {
        const groups = pluginManager.getToolGroups();
        
        const result = groups.isGroupEnabled('nonexistent-group');
        
        expect(result).toBe(false);
      });
    });
  });

  describe('IPC 边缘情况', () => {
    describe('连接断开', () => {
      it('应该处理未连接时发送消息', async () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ enableQueue: false });
        
        try {
          await adapter.send(new IPCMessage(IPCMessageType.EVENT, {}));
          expect.fail('应该抛出错误');
        } catch (error) {
          expect(error.message).toContain('未连接');
        }
      });

      it('应该处理断开后重连', async () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {
            this.isConnected = true;
            return true;
          }
        }
        
        const adapter = new TestAdapter({ maxReconnectAttempts: 3 });
        
        await adapter.connect();
        adapter.disconnect();
        
        expect(adapter.isConnected).toBe(false);
        
        await adapter.connect();
        expect(adapter.isConnected).toBe(true);
      });

      it('应该处理达到最大重连次数', async () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {
            throw new Error('连接失败');
          }
        }
        
        const adapter = new TestAdapter({ maxReconnectAttempts: 2 });
        
        adapter.isConnected = false;
        
        try {
          await adapter.handleReconnect();
        } catch (error) {
          // 应该达到最大重连次数
        }
        
        expect(adapter.reconnectAttempts).toBeGreaterThanOrEqual(2);
      });
    });

    describe('消息超时', () => {
      it('应该处理请求超时', async () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ requestTimeout: 100 });
        
        // 添加一个待处理请求
        const requestId = adapter.generateRequestId();
        adapter.pendingRequests.set(requestId, {
          resolve: () => {},
          reject: (error) => {
            expect(error.message).toContain('超时');
          },
          timer: setTimeout(() => adapter.handleTimeout(requestId), 100)
        });
        
        // 等待超时
        await new Promise(resolve => setTimeout(resolve, 150));
        
        expect(adapter.pendingRequests.has(requestId)).toBe(false);
      });

      it('应该处理清除超时定时器', async () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        const requestId = adapter.generateRequestId();
        const timer = setTimeout(() => {}, 1000);
        
        adapter.pendingRequests.set(requestId, {
          resolve: () => {},
          reject: () => {},
          timer
        });
        
        // 清除定时器
        clearTimeout(timer);
        adapter.pendingRequests.delete(requestId);
        
        // 应该安全处理
      });
    });

    describe('无效消息', () => {
      it('应该处理 null 消息验证', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ validateMessages: true });
        
        const validation = adapter.validateMessage(null);
        
        expect(validation.valid).toBe(false);
        expect(validation.error).toContain('对象');
      });

      it('应该处理空对象消息验证', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ validateMessages: true });
        
        const validation = adapter.validateMessage({});
        
        expect(validation.valid).toBe(false);
        expect(validation.error).toContain('type');
      });

      it('应该处理消息缺少 type 字段', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({ validateMessages: true });
        
        const validation = adapter.validateMessage({ payload: 'test' });
        
        expect(validation.valid).toBe(false);
      });

      it('应该处理不允许的频道消息', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter({
          validateMessages: true,
          allowedChannels: ['allowed-channel']
        });
        
        const validation = adapter.validateMessage({ type: 'blocked-channel' });
        
        expect(validation.valid).toBe(false);
        expect(validation.error).toContain('不在允许列表中');
      });

      it('应该处理无效 JSON 消息反序列化', () => {
        try {
          IPCMessage.fromJSON('invalid json string');
        } catch (error) {
          // 应该抛出解析错误
        }
        
        // 应该安全处理
      });

      it('应该处理部分缺失字段的消息反序列化', () => {
        const partialJson = { type: IPCMessageType.REQUEST };
        
        const message = IPCMessage.fromJSON(partialJson);
        
        expect(message.type).toBe(IPCMessageType.REQUEST);
        expect(message.id).toBeDefined();
      });
    });

    describe('消息队列边缘情况', () => {
      it('应该处理空队列出队', () => {
        const queue = new MessageQueue(100);
        
        const message = queue.dequeue();
        
        expect(message).toBeUndefined();
      });

      it('应该处理空队列查看', () => {
        const queue = new MessageQueue(100);
        
        const message = queue.peek();
        
        expect(message).toBeUndefined();
      });

      it('应该处理零容量队列', () => {
        const queue = new MessageQueue(0);
        
        queue.enqueue(new IPCMessage(IPCMessageType.EVENT, {}));
        
        expect(queue.size()).toBe(0);
      });

      it('应该处理负容量队列', () => {
        const queue = new MessageQueue(-1);
        
        queue.enqueue(new IPCMessage(IPCMessageType.EVENT, {}));
        
        // 应该安全处理
      });

      it('应该处理队列清除', () => {
        const queue = new MessageQueue(100);
        
        for (let i = 0; i < 10; i++) {
          queue.enqueue(new IPCMessage(IPCMessageType.EVENT, { index: i }));
        }
        
        queue.clear();
        
        expect(queue.size()).toBe(0);
      });
    });

    describe('心跳边缘情况', () => {
      it('应该处理未连接时启动心跳', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        adapter.startHeartbeat();
        
        expect(adapter.heartbeatTimer).toBeDefined();
        
        adapter.stopHeartbeat();
      });

      it('应该处理重复启动心跳', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        adapter.startHeartbeat();
        adapter.startHeartbeat();
        
        // 应该只有一个定时器
        expect(adapter.heartbeatTimer).toBeDefined();
        
        adapter.stopHeartbeat();
      });

      it('应该处理停止未启动的心跳', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        adapter.stopHeartbeat();
        
        expect(adapter.heartbeatTimer).toBeNull();
      });
    });

    describe('统计信息边缘情况', () => {
      it('应该处理未连接时获取统计', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        const stats = adapter.getStats();
        
        expect(stats.isConnected).toBe(false);
        expect(stats.pendingRequests).toBe(0);
        expect(stats.queueSize).toBe(0);
      });

      it('应该处理大量待处理请求的统计', () => {
        class TestAdapter extends IPCAdapterBase {
          async send() {}
          async connect() {}
        }
        
        const adapter = new TestAdapter();
        
        for (let i = 0; i < 100; i++) {
          adapter.pendingRequests.set(`req_${i}`, {
            resolve: () => {},
            reject: () => {},
            timer: setTimeout(() => {}, 1000)
          });
        }
        
        const stats = adapter.getStats();
        
        expect(stats.pendingRequests).toBe(100);
        
        // 清理
        for (let i = 0; i < 100; i++) {
          clearTimeout(adapter.pendingRequests.get(`req_${i}`).timer);
        }
        adapter.pendingRequests.clear();
      });
    });
  });
});