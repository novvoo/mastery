#!/usr/bin/env bun
/**
 * Plugin System Example
 * 插件系统使用示例
 */

import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  RuntimeEvent,
  PluginManager,
  HOOKS,
  createPlugin,
  LoggerPlugin,
  PerformancePlugin
} from '../src/runtime/index.js';

/**
 * Example 1: Basic plugin usage
 * 示例 1: 基本插件使用
 */
async function basicPluginExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 1: Basic Plugin Usage');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Create engine
  const engine = createAgentEngine({
    platform: PlatformType.CLI,
    workingDirectory: process.cwd(),
    debug: true,
    maxIterations: 5
  });
  
  // Initialize
  await engine.initialize();
  
  // Get plugin manager
  const pluginManager = engine.getPluginManager();
  
  // Register plugins
  console.log('📦 Registering plugins...');
  pluginManager.register(LoggerPlugin);
  pluginManager.register(PerformancePlugin);
  
  // Show plugin count
  console.log(`\n✅ ${pluginManager.getPluginCount()} plugins registered`);
  
  // Show plugin list
  console.log('\n📋 Plugin list:');
  for (const plugin of pluginManager.getAllPlugins()) {
    console.log(`   - ${plugin.name} (v${plugin.version}): ${plugin.description}`);
  }
  
  // Test a hook trigger
  console.log('\n🔄 Triggering "BEFORE_TOOL_CALL" hook...');
  await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test_tool', { foo: 'bar' });
  
  // Cleanup
  await engine.dispose();
  console.log('\n✅ Example 1 complete!\n');
}

/**
 * Example 2: Create custom plugin
 * 示例 2: 创建自定义插件
 */
async function customPluginExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 2: Custom Plugin');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Create a custom plugin
  const CustomPlugin = createPlugin({
    name: 'custom_example',
    version: '1.0.0',
    description: 'A custom plugin example',
    
    initialize({ eventBus }) {
      console.log('🔧 Custom plugin initialized!');
      this.counter = 0;
      
      // Listen to events
      this.unsubscribe = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (event) => {
        this.counter++;
        console.log(`📡 Custom plugin received status update #${this.counter}:`, event.message);
      });
    },
    
    cleanup() {
      console.log('🧹 Custom plugin cleaning up...');
      if (this.unsubscribe) {
        this.unsubscribe();
      }
    },
    
    hooks: {
      [HOOKS.BEFORE_AGENT_START]: async (input) => {
        console.log(`🎬 Custom plugin - agent is about to start with input: "${input}"`);
      },
      [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
        console.log(`✅ Custom plugin - agent completed with result:`, result);
      },
      [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
        console.log(`🛠️  Custom plugin - calling tool: ${toolName}`, args);
      }
    }
  });
  
  // Create engine and register plugin
  const engine = createAgentEngine({
    platform: PlatformType.CLI,
    workingDirectory: process.cwd()
  });
  
  await engine.initialize();
  const pluginManager = engine.getPluginManager();
  pluginManager.register(CustomPlugin);
  
  // Get the plugin
  const plugin = pluginManager.getPlugin('custom_example');
  console.log(`\n📦 Custom plugin "${plugin.name}" registered!`);
  
  // Trigger some hooks
  await pluginManager.triggerHook(HOOKS.BEFORE_AGENT_START, 'Hello world!');
  await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'list_files', { path: '.' });
  
  // Cleanup
  await engine.dispose();
  console.log('\n✅ Example 2 complete!\n');
}

/**
 * Example 3: Multiple plugins together
 * 示例 3: 多个插件一起使用
 */
async function multiplePluginsExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 3: Multiple Plugins');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Create engine
  const engine = createAgentEngine({
    platform: PlatformType.CLI,
    workingDirectory: process.cwd()
  });
  
  await engine.initialize();
  const pluginManager = engine.getPluginManager();
  
  // Create several plugins
  const metricsPlugin = createPlugin({
    name: 'metrics',
    version: '1.0.0',
    description: 'Track metrics',
    initialize() {
      this.stats = {
        toolCalls: 0,
        errors: 0,
        startTime: Date.now()
      };
    },
    hooks: {
      [HOOKS.BEFORE_TOOL_CALL]: async () => { this.stats.toolCalls++; },
      [HOOKS.ON_TOOL_ERROR]: async () => { this.stats.errors++; }
    },
    cleanup() {
      console.log('\n📊 Metrics plugin stats:', this.stats);
    }
  });
  
  const analyticsPlugin = createPlugin({
    name: 'analytics',
    version: '1.0.0',
    description: 'Track analytics events',
    initialize() {
      this.events = [];
    },
    hooks: {
      [HOOKS.BEFORE_AGENT_START]: async (input) => {
        this.events.push({ type: 'start', input, time: Date.now() });
      },
      [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
        this.events.push({ type: 'complete', result, time: Date.now() });
      }
    },
    cleanup() {
      console.log('📈 Analytics plugin captured', this.events.length, 'events');
    }
  });
  
  // Register all plugins
  pluginManager.register(metricsPlugin);
  pluginManager.register(analyticsPlugin);
  pluginManager.register(LoggerPlugin);
  
  console.log(`\n✅ ${pluginManager.getPluginCount()} plugins registered`);
  
  // Trigger some hooks
  await pluginManager.triggerHook(HOOKS.BEFORE_AGENT_START, 'Hello');
  await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'tool1', {});
  await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'tool2', {});
  await pluginManager.triggerHook(HOOKS.AFTER_AGENT_COMPLETE, 'done');
  
  // Cleanup (will trigger cleanup hooks)
  await engine.dispose();
  console.log('\n✅ Example 3 complete!\n');
}

/**
 * Main
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          Plugin System Examples                                ║');
  console.log('║          插件系统使用示例                                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  try {
    await basicPluginExample();
    await customPluginExample();
    await multiplePluginsExample();
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   🎉 All plugin examples complete!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('📚 Learn more about plugins:');
    console.log('   - Check src/runtime/plugin-system.js');
    console.log('   - Use HOOKS constants to register hooks');
    console.log('   - Use createPlugin() to create your own plugins');
    console.log('   - Call registerPlugin() on the engine\'s plugin manager');
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error in examples:', error);
    process.exit(1);
  }
}

// Run
main();
