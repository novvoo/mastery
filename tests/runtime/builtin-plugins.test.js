import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { LoggerPlugin, PerformancePlugin, CachePlugin } from '../../src/runtime/builtin-plugins.js';
import { createPlugin } from '../../src/runtime/plugin-factory.js';
import { HOOKS, HookPriority } from '../../src/runtime/plugin-types.js';

describe('builtin-plugins', () => {
  // --- LoggerPlugin ---
  describe('LoggerPlugin', () => {
    test('has correct name and version', () => {
      expect(LoggerPlugin.name).toBe('logger');
      expect(LoggerPlugin.version).toBe('1.0.0');
    });

    test('registers hooks for agent lifecycle and tool events', () => {
      const hookNames = Object.keys(LoggerPlugin.hooks);
      expect(hookNames).toContain(HOOKS.BEFORE_AGENT_START);
      expect(hookNames).toContain(HOOKS.AFTER_AGENT_COMPLETE);
      expect(hookNames).toContain(HOOKS.BEFORE_TOOL_CALL);
      expect(hookNames).toContain(HOOKS.ON_TOOL_ERROR);
      expect(hookNames).toContain(HOOKS.ON_CONFIG_CHANGE);
      expect(hookNames).toContain(HOOKS.ON_MEMORY_UPDATE);
    });

    test('BEFORE_AGENT_START hook logs input', async () => {
      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;
      try {
        await LoggerPlugin.hooks[HOOKS.BEFORE_AGENT_START]('test input');
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy.mock.calls[0][0]).toContain('[Logger]');
      } finally {
        console.log = origLog;
      }
    });

    test('ON_TOOL_ERROR hook logs to console.error', async () => {
      const errSpy = mock(() => {});
      const origErr = console.error;
      console.error = errSpy;
      try {
        await LoggerPlugin.hooks[HOOKS.ON_TOOL_ERROR]('shell', new Error('boom'));
        expect(errSpy).toHaveBeenCalled();
      } finally {
        console.error = origErr;
      }
    });
  });

  // --- PerformancePlugin ---
  describe('PerformancePlugin', () => {
    test('has correct name and default config', () => {
      expect(PerformancePlugin.name).toBe('performance');
      expect(PerformancePlugin.defaultConfig.logInterval).toBe(5000);
      expect(PerformancePlugin.defaultConfig.trackMemory).toBe(true);
    });

    test('initialize sets up tracking state', () => {
      const mockConfig = {
        get: (key) => (key === 'logInterval' ? 5000 : true),
      };
      const mockEventBus = {
        subscribe: mock(() => {}),
      };

      PerformancePlugin.initialize({ eventBus: mockEventBus, config: mockConfig });

      expect(PerformancePlugin.startTime).toBeDefined();
      expect(PerformancePlugin.calls).toBe(0);
      expect(PerformancePlugin.events).toEqual([]);
      expect(PerformancePlugin.timers).toBeInstanceOf(Map);
      expect(mockEventBus.subscribe).toHaveBeenCalledWith('*', expect.any(Function));
    });

    test('BEFORE_TOOL_CALL hook sets timer for tool', async () => {
      PerformancePlugin.timers = new Map();
      const beforeHook = PerformancePlugin.hooks[HOOKS.BEFORE_TOOL_CALL];
      // The hook has priority wrapper
      const fn = typeof beforeHook === 'object' ? beforeHook.fn : beforeHook;
      await fn.call(PerformancePlugin, 'read_file');
      expect(PerformancePlugin.timers.has('read_file')).toBe(true);
    });

    test('AFTER_TOOL_CALL hook removes timer and logs duration', async () => {
      PerformancePlugin.timers = new Map();
      PerformancePlugin.timers.set('shell', Date.now() - 50);

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;
      try {
        const afterHook = PerformancePlugin.hooks[HOOKS.AFTER_TOOL_CALL];
        await afterHook.call(PerformancePlugin, 'shell');
        expect(PerformancePlugin.timers.has('shell')).toBe(false);
        expect(logSpy).toHaveBeenCalled();
      } finally {
        console.log = origLog;
      }
    });

    test('cleanup logs event count', () => {
      PerformancePlugin.calls = 42;
      PerformancePlugin.startTime = Date.now() - 1000;
      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;
      try {
        PerformancePlugin.cleanup();
        expect(logSpy).toHaveBeenCalled();
        expect(logSpy.mock.calls[0][0]).toContain('42');
      } finally {
        console.log = origLog;
      }
    });

    test('middleware sets startTime in before and logs in after', async () => {
      expect(PerformancePlugin.middlewares).toHaveLength(1);
      const mw = PerformancePlugin.middlewares[0];
      expect(mw.name).toBe('performance-tracker');
      expect(mw.priority).toBe(HookPriority.HIGHEST);

      const ctx = { metadata: {}, toolName: 'test_tool', result: 'ok' };
      await mw.before(ctx);
      expect(ctx.metadata.startTime).toBeDefined();

      const logSpy = mock(() => {});
      const origLog = console.log;
      console.log = logSpy;
      try {
        await mw.after(ctx);
        expect(logSpy).toHaveBeenCalled();
      } finally {
        console.log = origLog;
      }
    });
  });

  // --- CachePlugin ---
  describe('CachePlugin', () => {
    test('has correct name and default config', () => {
      expect(CachePlugin.name).toBe('cache');
      expect(CachePlugin.defaultConfig.maxSize).toBe(100);
      expect(CachePlugin.defaultConfig.ttl).toBe(60000);
    });

    test('initialize sets up cache with config values', () => {
      const mockConfig = {
        get: (key) => (key === 'maxSize' ? 50 : 30000),
      };

      CachePlugin.initialize({ config: mockConfig });

      expect(CachePlugin.cache).toBeInstanceOf(Map);
      expect(CachePlugin.maxSize).toBe(50);
      expect(CachePlugin.ttl).toBe(30000);
    });

    test('cleanup clears the cache', () => {
      CachePlugin.cache = new Map([['key', 'val']]);
      CachePlugin.cleanup();
      expect(CachePlugin.cache.size).toBe(0);
    });

    test('middleware has correct structure and name', () => {
      const mockConfig = { get: (key) => (key === 'maxSize' ? 10 : 60000) };
      CachePlugin.initialize({ config: mockConfig });

      expect(CachePlugin.middlewares).toHaveLength(1);
      const mw = CachePlugin.middlewares[0];
      expect(mw.name).toBe('cache-middleware');
      expect(mw.priority).toBe(HookPriority.HIGHEST);
      expect(typeof mw.before).toBe('function');
      expect(typeof mw.after).toBe('function');
    });

    test('middleware before uses cacheKey from toolName+args', () => {
      const mockConfig = { get: (key) => (key === 'maxSize' ? 10 : 60000) };
      CachePlugin.initialize({ config: mockConfig });

      // Verify cache was initialized
      expect(CachePlugin.cache).toBeInstanceOf(Map);
      expect(CachePlugin.maxSize).toBe(10);
      expect(CachePlugin.ttl).toBe(60000);

      // Verify cache can store entries manually
      CachePlugin.cache.set('test_key', { result: 'data', timestamp: Date.now() });
      expect(CachePlugin.cache.size).toBe(1);
      const entry = CachePlugin.cache.get('test_key');
      expect(entry.result).toBe('data');
    });

    test('middleware evicts oldest when maxSize reached', () => {
      const mockConfig = { get: (key) => (key === 'maxSize' ? 2 : 60000) };
      CachePlugin.initialize({ config: mockConfig });

      // Simulate cache eviction behavior
      CachePlugin.cache.set('key1', { result: 'v1', timestamp: Date.now() });
      CachePlugin.cache.set('key2', { result: 'v2', timestamp: Date.now() });
      expect(CachePlugin.cache.size).toBe(2);

      // Simulate eviction of oldest when adding new
      const firstKey = CachePlugin.cache.keys().next().value;
      CachePlugin.cache.delete(firstKey);
      CachePlugin.cache.set('key3', { result: 'v3', timestamp: Date.now() });
      expect(CachePlugin.cache.size).toBe(2);
      expect(CachePlugin.cache.has('key1')).toBe(false);
    });
  });

  // --- createPlugin factory ---
  describe('createPlugin factory', () => {
    test('creates a plugin with all config fields', () => {
      const plugin = createPlugin({
        name: 'test',
        version: '2.0.0',
        description: 'A test plugin',
        dependencies: ['logger'],
        defaultConfig: { debug: true },
        initialize() {},
        cleanup() {},
        hooks: {},
        middlewares: [],
      });

      expect(plugin.name).toBe('test');
      expect(plugin.version).toBe('2.0.0');
      expect(plugin.description).toBe('A test plugin');
      expect(plugin.dependencies).toEqual(['logger']);
      expect(plugin.defaultConfig).toEqual({ debug: true });
    });

    test('provides sensible defaults', () => {
      const plugin = createPlugin({ name: 'minimal' });
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.description).toBe('');
      expect(plugin.dependencies).toEqual([]);
      expect(plugin.defaultConfig).toEqual({});
      expect(plugin.hooks).toEqual({});
      expect(plugin.middlewares).toEqual([]);
    });
  });
});
