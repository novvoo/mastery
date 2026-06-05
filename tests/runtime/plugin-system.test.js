/**
 * Plugin System Tests
 * 插件系统测试
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import {
  PluginManager,
  PluginConfig,
  PluginState,
  HookPriority,
  HOOKS,
  createPlugin,
  LoggerPlugin,
  PerformancePlugin,
  CachePlugin
} from '../../src/runtime/plugin-system.js';
import { getEventBus } from '../../src/runtime/event-bus.js';

describe('Plugin System Tests', () => {
  let pluginManager;
  let eventBus;

  beforeEach(() => {
    eventBus = getEventBus();
    eventBus.clear();
    pluginManager = new PluginManager(eventBus);
  });

  afterEach(async () => {
    if (pluginManager) {
      await pluginManager.dispose();
      pluginManager = null;
    }
  });

  describe('PluginConfig', () => {
    it('应该创建配置并获取默认值', () => {
      const config = new PluginConfig({ timeout: 1000, debug: false });
      
      expect(config.get('timeout')).toBe(1000);
      expect(config.get('debug')).toBe(false);
      expect(config.get('undefined_key', 'default')).toBe('default');
    });

    it('应该设置配置值', () => {
      const config = new PluginConfig({ timeout: 1000 });
      
      config.set('timeout', 2000);
      expect(config.get('timeout')).toBe(2000);
      
      config.set({ debug: true, level: 'info' });
      expect(config.get('debug')).toBe(true);
      expect(config.get('level')).toBe('info');
    });

    it('应该重置为默认值', () => {
      const config = new PluginConfig({ timeout: 1000 });
      
      config.set('timeout', 2000);
      config.reset();
      
      expect(config.get('timeout')).toBe(1000);
    });

    it('应该验证配置', () => {
      const schema = {
        timeout: { required: true, type: 'number' },
        level: { enum: ['info', 'warn', 'error'] }
      };
      
      const config = new PluginConfig({ timeout: 1000, level: 'info' }, schema);
      const validation = config.validate();
      
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('应该检测配置验证错误', () => {
      const schema = {
        timeout: { required: true, type: 'number' },
        level: { enum: ['info', 'warn', 'error'] }
      };
      
      const config = new PluginConfig({ timeout: 'invalid', level: 'unknown' }, schema);
      const validation = config.validate();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('PluginManager - 基础功能', () => {
    it('应该注册插件', async () => {
      const plugin = createPlugin({
        name: 'test-plugin',
        version: '1.0.0',
        description: '测试插件'
      });
      
      const result = await pluginManager.register(plugin);
      expect(result).toBe(true);
      expect(pluginManager.getPluginCount()).toBe(1);
    });

    it('应该拒绝没有名称的插件', async () => {
      try {
        await pluginManager.register({});
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('name');
      }
    });

    it('应该拒绝重复注册的插件', async () => {
      const plugin = createPlugin({ name: 'duplicate-plugin' });
      
      await pluginManager.register(plugin);
      const result = await pluginManager.register(plugin);
      
      expect(result).toBe(false);
    });

    it('应该注销插件', async () => {
      const plugin = createPlugin({
        name: 'removable-plugin',
        cleanup: () => console.log('清理完成')
      });
      
      await pluginManager.register(plugin);
      expect(pluginManager.getPluginCount()).toBe(1);
      
      await pluginManager.unregister('removable-plugin');
      expect(pluginManager.getPluginCount()).toBe(0);
    });

    it('应该获取插件信息', async () => {
      const plugin = createPlugin({
        name: 'info-plugin',
        version: '2.0.0',
        description: '信息测试插件'
      });
      
      await pluginManager.register(plugin);
      const info = pluginManager.getPlugin('info-plugin');
      
      expect(info.name).toBe('info-plugin');
      expect(info.version).toBe('2.0.0');
      expect(info.description).toBe('信息测试插件');
      expect(info.state).toBe(PluginState.ACTIVE);
    });

    it('应该获取所有插件', async () => {
      await pluginManager.register(createPlugin({ name: 'plugin1' }));
      await pluginManager.register(createPlugin({ name: 'plugin2' }));
      
      const allPlugins = pluginManager.getAllPlugins();
      expect(allPlugins.length).toBe(2);
    });
  });

  describe('PluginManager - 生命周期', () => {
    it('应该调用 initialize 函数', async () => {
      let initialized = false;
      
      const plugin = createPlugin({
        name: 'init-plugin',
        initialize: (context) => {
          initialized = true;
          expect(context.eventBus).toBeDefined();
          expect(context.config).toBeDefined();
        }
      });
      
      await pluginManager.register(plugin);
      expect(initialized).toBe(true);
    });

    it('应该调用 cleanup 函数', async () => {
      let cleaned = false;
      
      const plugin = createPlugin({
        name: 'cleanup-plugin',
        cleanup: () => {
          cleaned = true;
        }
      });
      
      await pluginManager.register(plugin);
      await pluginManager.unregister('cleanup-plugin');
      
      expect(cleaned).toBe(true);
    });

    it('应该处理初始化失败', async () => {
      const plugin = createPlugin({
        name: 'fail-plugin',
        initialize: () => {
          throw new Error('初始化失败');
        }
      });
      
      try {
        await pluginManager.register(plugin);
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('初始化失败');
        expect(pluginManager.getPluginCount()).toBe(0);
      }
    });

    it('应该启用和禁用插件', async () => {
      const plugin = createPlugin({ name: 'toggle-plugin' });
      
      await pluginManager.register(plugin);
      expect(pluginManager.getPlugin('toggle-plugin').enabled).toBe(true);
      
      await pluginManager.disable('toggle-plugin');
      expect(pluginManager.getPlugin('toggle-plugin').enabled).toBe(false);
      expect(pluginManager.getPlugin('toggle-plugin').state).toBe(PluginState.DISABLED);
      
      await pluginManager.enable('toggle-plugin');
      expect(pluginManager.getPlugin('toggle-plugin').enabled).toBe(true);
      expect(pluginManager.getPlugin('toggle-plugin').state).toBe(PluginState.ACTIVE);
    });
  });

  describe('PluginManager - 依赖管理', () => {
    it('应该检查依赖是否存在', async () => {
      const dependentPlugin = createPlugin({
        name: 'dependent-plugin',
        dependencies: ['base-plugin']
      });
      
      try {
        await pluginManager.register(dependentPlugin);
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('缺少依赖');
      }
    });

    it('应该在依赖存在时成功注册', async () => {
      await pluginManager.register(createPlugin({ name: 'base-plugin' }));
      
      const dependentPlugin = createPlugin({
        name: 'dependent-plugin',
        dependencies: ['base-plugin']
      });
      
      const result = await pluginManager.register(dependentPlugin);
      expect(result).toBe(true);
    });

    it('应该阻止注销被依赖的插件', async () => {
      await pluginManager.register(createPlugin({ name: 'base-plugin' }));
      await pluginManager.register(createPlugin({
        name: 'dependent-plugin',
        dependencies: ['base-plugin']
      }));
      
      try {
        await pluginManager.unregister('base-plugin');
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('依赖它');
      }
    });

    it('应该按依赖顺序注销插件', async () => {
      await pluginManager.register(createPlugin({ name: 'base-plugin' }));
      await pluginManager.register(createPlugin({
        name: 'dependent-plugin',
        dependencies: ['base-plugin']
      }));
      
      // 先注销依赖插件
      await pluginManager.unregister('dependent-plugin');
      expect(pluginManager.getPluginCount()).toBe(1);
      
      // 然后可以注销基础插件
      await pluginManager.unregister('base-plugin');
      expect(pluginManager.getPluginCount()).toBe(0);
    });
  });

  describe('PluginManager - 配置系统', () => {
    it('应该应用用户配置', async () => {
      const plugin = createPlugin({
        name: 'config-plugin',
        defaultConfig: { timeout: 1000, retries: 3 },
        configSchema: {
          timeout: { type: 'number' },
          retries: { type: 'number' }
        }
      });
      
      await pluginManager.register(plugin, {
        config: { timeout: 5000 }
      });
      
      const info = pluginManager.getPlugin('config-plugin');
      expect(info.config.get('timeout')).toBe(5000);
      expect(info.config.get('retries')).toBe(3); // 默认值
    });

    it('应该验证配置', async () => {
      const plugin = createPlugin({
        name: 'strict-config-plugin',
        defaultConfig: { level: 'info' },
        configSchema: {
          level: { enum: ['info', 'warn', 'error'] }
        }
      });
      
      try {
        await pluginManager.register(plugin, {
          config: { level: 'invalid' }
        });
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).toContain('配置验证失败');
      }
    });
  });

  describe('Hook System', () => {
    it('应该注册和触发钩子', async () => {
      let hookCalled = false;
      let receivedArg = null;
      
      pluginManager.registerHook('test_hook', async (arg) => {
        hookCalled = true;
        receivedArg = arg;
      });
      
      await pluginManager.triggerHook('test_hook', 'test_data');
      
      expect(hookCalled).toBe(true);
      expect(receivedArg).toBe('test_data');
    });

    it('应该按优先级执行钩子', async () => {
      const order = [];
      
      pluginManager.registerHook('priority_test', async () => {
        order.push('low');
      }, { priority: HookPriority.LOW });
      
      pluginManager.registerHook('priority_test', async () => {
        order.push('high');
      }, { priority: HookPriority.HIGH });
      
      pluginManager.registerHook('priority_test', async () => {
        order.push('normal');
      }, { priority: HookPriority.NORMAL });
      
      await pluginManager.triggerHook('priority_test');
      
      expect(order).toEqual(['high', 'normal', 'low']);
    });

    it('应该返回钩子执行结果', async () => {
      pluginManager.registerHook('result_test', async () => 'result1');
      pluginManager.registerHook('result_test', async () => 'result2');
      
      const { results } = await pluginManager.triggerHook('result_test');
      
      expect(results).toContain('result1');
      expect(results).toContain('result2');
    });

    it('应该处理钩子错误', async () => {
      pluginManager.registerHook('error_test', async () => {
        throw new Error('钩子错误');
      });
      
      const { errors } = await pluginManager.triggerHook('error_test');
      
      expect(errors.length).toBe(1);
      expect(errors[0].error.message).toBe('钩子错误');
    });

    it('应该支持一次性钩子', async () => {
      let callCount = 0;
      
      pluginManager.registerHook('once_test', async () => {
        callCount++;
      }, { once: true });
      
      await pluginManager.triggerHook('once_test');
      await pluginManager.triggerHook('once_test');
      
      expect(callCount).toBe(1);
    });

    it('应该能够注销钩子', async () => {
      let callCount = 0;
      
      const unsubscribe = pluginManager.registerHook('unsub_test', async () => {
        callCount++;
      });
      
      await pluginManager.triggerHook('unsub_test');
      expect(callCount).toBe(1);
      
      unsubscribe();
      await pluginManager.triggerHook('unsub_test');
      expect(callCount).toBe(1); // 不应该增加
    });

    it('应该触发所有预定义钩子', async () => {
      const triggeredHooks = [];
      
      // 注册所有钩子类型的监听器
      for (const hookName of Object.values(HOOKS)) {
        pluginManager.registerHook(hookName, async () => {
          triggeredHooks.push(hookName);
        });
      }
      
      // 触发几个钩子
      await pluginManager.triggerHook(HOOKS.BEFORE_INIT);
      await pluginManager.triggerHook(HOOKS.AFTER_INIT);
      await pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, 'key', 'value');
      await pluginManager.triggerHook(HOOKS.ON_MEMORY_UPDATE, 'add', {});
      
      expect(triggeredHooks.length).toBe(4);
    });
  });

  describe('Tool Middleware', () => {
    it('应该添加中间件', () => {
      const middleware = pluginManager.getToolMiddleware();
      
      const remove = middleware.use({
        name: 'test-middleware',
        before: async (ctx) => {},
        after: async (ctx) => {}
      });
      
      expect(middleware.count()).toBe(1);
      
      remove();
      expect(middleware.count()).toBe(0);
    });

    it('应该执行中间件 before 和 after 钩子', async () => {
      const middleware = pluginManager.getToolMiddleware();
      const events = [];
      
      middleware.use({
        name: 'tracking-middleware',
        before: async (ctx) => {
          events.push('before:' + ctx.toolName);
        },
        after: async (ctx) => {
          events.push('after:' + ctx.toolName);
        }
      });
      
      const executor = async (name, args) => 'result';
      await middleware.execute('test_tool', { input: 'test' }, {}, executor);
      
      expect(events).toEqual(['before:test_tool', 'after:test_tool']);
    });

    it('应该执行中间件 error 钩子', async () => {
      const middleware = pluginManager.getToolMiddleware();
      let errorHandled = false;
      
      middleware.use({
        name: 'error-middleware',
        error: async (error, ctx) => {
          errorHandled = true;
        }
      });
      
      const executor = async () => {
        throw new Error('执行错误');
      };
      
      try {
        await middleware.execute('error_tool', {}, {}, executor);
      } catch (error) {
        // 预期的错误
      }
      
      expect(errorHandled).toBe(true);
    });

    it('应该按优先级执行中间件', async () => {
      const middleware = pluginManager.getToolMiddleware();
      const order = [];
      
      middleware.use({
        name: 'low',
        priority: HookPriority.LOW,
        before: async () => order.push('low')
      });
      
      middleware.use({
        name: 'high',
        priority: HookPriority.HIGH,
        before: async () => order.push('high')
      });
      
      await middleware.execute('test', {}, {}, async () => 'result');
      
      expect(order).toEqual(['high', 'low']);
    });
  });

  describe('Tool Groups', () => {
    it('应该创建工具分组', () => {
      const groups = pluginManager.getToolGroups();
      
      const result = groups.createGroup('test-group', {
        description: '测试分组',
        priority: 10
      });
      
      expect(result).toBe(true);
      expect(groups.getAllGroups().length).toBe(1);
    });

    it('应该将工具添加到分组', () => {
      const groups = pluginManager.getToolGroups();
      
      groups.createGroup('fs-group');
      groups.addToGroup('fs-group', 'read_file');
      groups.addToGroup('fs-group', 'write_file');
      
      const tools = groups.getGroupTools('fs-group');
      expect(tools).toContain('read_file');
      expect(tools).toContain('write_file');
    });

    it('应该获取工具所属分组', () => {
      const groups = pluginManager.getToolGroups();
      
      groups.createGroup('shell-group');
      groups.addToGroup('shell-group', 'shell_exec');
      
      expect(groups.getToolGroup('shell_exec')).toBe('shell-group');
    });

    it('应该从分组移除工具', () => {
      const groups = pluginManager.getToolGroups();
      
      groups.createGroup('temp-group');
      groups.addToGroup('temp-group', 'temp_tool');
      
      groups.removeFromGroup('temp_tool');
      
      expect(groups.getToolGroup('temp_tool')).toBe(null);
    });

    it('应该删除分组', () => {
      const groups = pluginManager.getToolGroups();
      
      groups.createGroup('delete-group');
      groups.addToGroup('delete-group', 'tool1');
      
      groups.deleteGroup('delete-group');
      
      expect(groups.getAllGroups().find(g => g.name === 'delete-group')).toBeUndefined();
    });

    it('应该启用和禁用分组', () => {
      const groups = pluginManager.getToolGroups();
      
      groups.createGroup('toggle-group');
      
      expect(groups.isGroupEnabled('toggle-group')).toBe(true);
      
      groups.setGroupEnabled('toggle-group', false);
      expect(groups.isGroupEnabled('toggle-group')).toBe(false);
    });
  });

  describe('Plugin with Hooks', () => {
    it('应该注册插件钩子', async () => {
      const events = [];
      
      const plugin = createPlugin({
        name: 'hook-plugin',
        hooks: {
          [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
            events.push('before:' + toolName);
          },
          [HOOKS.AFTER_TOOL_CALL]: async (toolName, result) => {
            events.push('after:' + toolName);
          }
        }
      });
      
      await pluginManager.register(plugin);
      
      await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test_tool', {});
      await pluginManager.triggerHook(HOOKS.AFTER_TOOL_CALL, 'test_tool', 'result');
      
      expect(events).toEqual(['before:test_tool', 'after:test_tool']);
    });

    it('应该支持钩子优先级配置', async () => {
      const order = [];
      
      const plugin1 = createPlugin({
        name: 'priority-plugin-1',
        hooks: {
          'priority_test': {
            fn: async () => order.push('plugin1'),
            priority: HookPriority.LOW
          }
        }
      });
      
      const plugin2 = createPlugin({
        name: 'priority-plugin-2',
        hooks: {
          'priority_test': {
            fn: async () => order.push('plugin2'),
            priority: HookPriority.HIGH
          }
        }
      });
      
      await pluginManager.register(plugin1);
      await pluginManager.register(plugin2);
      
      await pluginManager.triggerHook('priority_test');
      
      expect(order).toEqual(['plugin2', 'plugin1']);
    });
  });

  describe('Plugin with Middleware', () => {
    it('应该注册插件中间件', async () => {
      const events = [];
      
      const plugin = createPlugin({
        name: 'middleware-plugin',
        middlewares: [
          {
            name: 'tracking',
            before: async (ctx) => events.push('before'),
            after: async (ctx) => events.push('after')
          }
        ]
      });
      
      await pluginManager.register(plugin);
      
      const middleware = pluginManager.getToolMiddleware();
      await middleware.execute('test', {}, {}, async () => 'result');
      
      expect(events).toEqual(['before', 'after']);
    });
  });

  describe('Built-in Plugins', () => {
    it('LoggerPlugin 应该正常工作', async () => {
      await pluginManager.register(LoggerPlugin);
      
      const info = pluginManager.getPlugin('logger');
      expect(info.name).toBe('logger');
      expect(info.state).toBe(PluginState.ACTIVE);
    });

    it('PerformancePlugin 应该正常工作', async () => {
      await pluginManager.register(PerformancePlugin, {
        config: { logInterval: 1000 }
      });
      
      const info = pluginManager.getPlugin('performance');
      expect(info.name).toBe('performance');
      expect(info.config.get('logInterval')).toBe(1000);
    });

    it('CachePlugin 应该正常工作', async () => {
      await pluginManager.register(CachePlugin);
      
      const info = pluginManager.getPlugin('cache');
      expect(info.name).toBe('cache');
      expect(info.config.get('maxSize')).toBe(100);
      expect(info.config.get('ttl')).toBe(60000);
    });
  });

  describe('Dispose', () => {
    it('应该清理所有插件', async () => {
      await pluginManager.register(createPlugin({ name: 'plugin1' }));
      await pluginManager.register(createPlugin({ name: 'plugin2' }));
      
      expect(pluginManager.getPluginCount()).toBe(2);
      
      await pluginManager.dispose();
      
      expect(pluginManager.getPluginCount()).toBe(0);
    });

    it('应该清理所有钩子', async () => {
      pluginManager.registerHook('test', async () => {});
      
      const hookManager = pluginManager.getHookManager();
      expect(hookManager.getHookCount('test')).toBe(1);
      
      await pluginManager.dispose();
      
      expect(hookManager.getHookCount('test')).toBe(0);
    });

    it('应该清理所有中间件', async () => {
      const middleware = pluginManager.getToolMiddleware();
      middleware.use({ before: async () => {} });
      
      expect(middleware.count()).toBe(1);
      
      await pluginManager.dispose();
      
      expect(middleware.count()).toBe(0);
    });
  });
});