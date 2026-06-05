#!/usr/bin/env bun
/**
 * Performance Tests and Benchmarks
 * 性能测试和基准测试
 */

import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  PluginManager,
  HOOKS,
  createPlugin
} from '../src/runtime/index.js';

/**
 * Performance Benchmark Helper
 */
class Benchmark {
  constructor(name) {
    this.name = name;
    this.tests = [];
  }

  async test(name, fn, iterations = 10) {
    const times = [];
    let memoryBefore, memoryAfter;
    
    for (let i = 0; i < iterations; i++) {
      if (i === 0) {
        memoryBefore = process.memoryUsage();
      }
      
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
      
      if (i === iterations - 1) {
        memoryAfter = process.memoryUsage();
      }
    }
    
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const memoryUsed = {
      rss: memoryAfter.rss - memoryBefore.rss,
      heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
      heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed
    };
    
    this.tests.push({
      name,
      iterations,
      times,
      avg,
      min,
      max,
      memoryUsed
    });
    
    return { avg, min, max, memoryUsed };
  }

  report() {
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`   📊 Benchmark Report: ${this.name}`);
    console.log(`═══════════════════════════════════════════════════════════════`);
    
    for (const test of this.tests) {
      console.log(`\n📋 ${test.name} (${test.iterations} iterations):`);
      console.log(`   ⏱️  Avg: ${test.avg.toFixed(2)}ms`);
      console.log(`   📉 Min: ${test.min.toFixed(2)}ms`);
      console.log(`   📈 Max: ${test.max.toFixed(2)}ms`);
      console.log(`   💾 Memory: ${Math.round(test.memoryUsed.heapUsed / 1024)} KB`);
    }
    
    return this.tests;
  }
}

/**
 * Test 1: Engine Initialization
 */
async function benchInitialization() {
  console.log('\n⚡ Running Initialization Benchmarks...');
  
  const bench = new Benchmark('Engine Initialization');
  
  await bench.test('Create and initialize engine', async () => {
    const engine = createAgentEngine({
      platform: PlatformType.CLI,
      workingDirectory: process.cwd()
    });
    await engine.initialize();
    await engine.dispose();
  }, 5);
  
  return bench.report();
}

/**
 * Test 2: Event Bus Throughput
 */
async function benchEventBus() {
  console.log('\n⚡ Running Event Bus Benchmarks...');
  
  const bench = new Benchmark('Event Bus');
  const eventBus = getEventBus();
  
  await bench.test('Subscribe 10 listeners', async () => {
    for (let i = 0; i < 10; i++) {
      eventBus.subscribe('test_event', () => {});
    }
    eventBus.clear();
  }, 20);
  
  await bench.test('Emit 100 events', async () => {
    const unsub = eventBus.subscribe('test_event', () => {});
    for (let i = 0; i < 100; i++) {
      eventBus.emit('test_event', { data: i });
    }
    unsub();
  }, 20);
  
  await bench.test('Subscribe and unsubscribe', async () => {
    for (let i = 0; i < 50; i++) {
      const unsub = eventBus.subscribe('test', () => {});
      unsub();
    }
  }, 20);
  
  return bench.report();
}

/**
 * Test 3: Plugin System
 */
async function benchPluginSystem() {
  console.log('\n⚡ Running Plugin System Benchmarks...');
  
  const bench = new Benchmark('Plugin System');
  const eventBus = getEventBus();
  const pluginManager = new PluginManager(eventBus);
  
  const testPlugin = createPlugin({
    name: 'test_bench',
    version: '1.0.0',
    description: 'Test plugin',
    hooks: {}
  });
  
  await bench.test('Register 1 plugin', async () => {
    pluginManager.register(testPlugin);
  }, 50);
  
  await bench.test('Register 10 plugins', async () => {
    for (let i = 0; i < 10; i++) {
      pluginManager.register(createPlugin({
        name: `test_${i}`,
        version: '1.0.0'
      }));
    }
  }, 20);
  
  await bench.test('Trigger hook 100 times', async () => {
    for (let i = 0; i < 100; i++) {
      await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test', {});
    }
  }, 20);
  
  return bench.report();
}

/**
 * Test 4: Tool Registry Performance
 */
async function benchToolRegistry() {
  console.log('\n⚡ Running Tool Registry Benchmarks...');
  
  const bench = new Benchmark('Tool Registry');
  const engine = createAgentEngine({ workingDirectory: process.cwd() });
  await engine.initialize();
  const toolRegistry = engine.getToolRegistry();
  
  // Create test tools
  const testTools = [];
  for (let i = 0; i < 50; i++) {
    testTools.push({
      name: `test_tool_${i}`,
      description: `Test tool ${i}`,
      category: 'Test',
      parameters: {},
      required: [],
      handler: async () => ({ result: 'ok' })
    });
  }
  
  await bench.test('Register 50 tools', async () => {
    for (const tool of testTools) {
      toolRegistry.register(tool);
    }
  }, 10);
  
  await bench.test('Get all tools', async () => {
    toolRegistry.getAll();
  }, 100);
  
  await engine.dispose();
  return bench.report();
}

/**
 * Test 5: Complete Workflow
 */
async function benchCompleteWorkflow() {
  console.log('\n⚡ Running Complete Workflow Benchmarks...');
  
  const bench = new Benchmark('Complete Workflow');
  
  await bench.test('Full engine lifecycle', async () => {
    const engine = createAgentEngine({ workingDirectory: process.cwd() });
    await engine.initialize();
    const toolRegistry = engine.getToolRegistry();
    const memoryManager = engine.getMemoryManager();
    toolRegistry.getAll();
    await engine.dispose();
  }, 5);
  
  return bench.report();
}

/**
 * Main Benchmark Runner
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          Performance Benchmarks                                ║');
  console.log('║          性能基准测试                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  try {
    // Run all benchmarks
    await benchInitialization();
    await benchEventBus();
    await benchPluginSystem();
    await benchToolRegistry();
    await benchCompleteWorkflow();
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   🎉 All benchmarks complete!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('📊 Summary:');
    console.log('   - Engine initialization tested');
    console.log('   - Event bus throughput tested');
    console.log('   - Plugin system performance tested');
    console.log('   - Tool registry performance tested');
    console.log('   - Complete workflow benchmarked');
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Benchmark error:', error);
    process.exit(1);
  }
}

// Run
main();
