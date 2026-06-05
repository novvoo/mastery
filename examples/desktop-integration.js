#!/usr/bin/env bun
/**
 * Desktop Integration Example
 * 桌面集成使用示例
 */

import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  RuntimeEvent,
  HOOKS
} from '../src/runtime/index.js';
import {
  DesktopCore,
  UIBridge,
  DesktopPlugin,
  createDesktopCore
} from '../src/adapters/desktop/desktop-core.js';

/**
 * Example 1: Basic desktop core usage
 * 示例 1: 基本桌面核心使用
 */
async function basicDesktopExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 1: Basic Desktop Core');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Create desktop core
  const desktopCore = createDesktopCore({
    workingDirectory: process.cwd(),
    debug: true
  });
  
  // Initialize
  await desktopCore.initialize();
  
  // Create UI bridge
  const uiBridge = new UIBridge();
  
  // Attach UI bridge to desktop core
  desktopCore.attachUIBridge(uiBridge);
  
  // Subscribe to UI bridge messages
  const unsubscribe1 = uiBridge.subscribe('status_update', (message) => {
    console.log(`📡 UI received status update:`, message.data.message);
  });
  
  const unsubscribe2 = uiBridge.subscribe('agent_complete', (message) => {
    console.log(`🎉 UI received agent complete:`, message.data.result);
  });
  
  // Check state
  const state = desktopCore.getState();
  console.log('📊 Desktop core state:', state);
  
  // Get available tools
  const tools = desktopCore.getTools();
  console.log(`\n🔧 ${tools.length} tools available in desktop core`);
  
  // Show first 5 tools
  console.log('\n🔧 First 5 tools:');
  tools.slice(0, 5).forEach((tool, index) => {
    console.log(`   ${index + 1}. ${tool.name} (${tool.category})`);
  });
  
  // Cleanup
  unsubscribe1();
  unsubscribe2();
  await desktopCore.dispose();
  
  console.log('\n✅ Example 1 complete!\n');
}

/**
 * Example 2: Desktop with plugin
 * 示例 2: 使用插件的桌面
 */
async function desktopWithPluginExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 2: Desktop with Plugins');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Create and initialize
  const desktopCore = createDesktopCore({
    workingDirectory: process.cwd()
  });
  
  await desktopCore.initialize();
  
  // Get engine and plugin manager
  const engine = desktopCore.getEngine();
  const pluginManager = engine.getPluginManager();
  
  // Register desktop plugin
  pluginManager.register(DesktopPlugin);
  
  // Create a custom desktop plugin
  const UINotificationPlugin = {
    name: 'ui_notification',
    version: '1.0.0',
    description: 'Send UI notifications',
    
    hooks: {
      [HOOKS.BEFORE_AGENT_START]: async (input) => {
        console.log(`🔔 UI Notification: Agent starting with "${input}"`);
      },
      [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
        console.log(`🔔 UI Notification: Agent complete!`);
      },
      [HOOKS.BEFORE_TOOL_CALL]: async (toolName, args) => {
        console.log(`🔔 UI Notification: Calling ${toolName}`);
      }
    }
  };
  
  pluginManager.register(UINotificationPlugin);
  
  // Show plugins
  console.log(`\n📦 ${pluginManager.getPluginCount()} plugins registered:`);
  for (const plugin of pluginManager.getAllPlugins()) {
    console.log(`   - ${plugin.name} (${plugin.description})`);
  }
  
  // Trigger some hooks
  await pluginManager.triggerHook(HOOKS.BEFORE_AGENT_START, 'Test input');
  await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, 'test_tool', { foo: 'bar' });
  
  // Cleanup
  await desktopCore.dispose();
  
  console.log('\n✅ Example 2 complete!\n');
}

/**
 * Example 3: Simulated UI interaction
 * 示例 3: 模拟 UI 交互
 */
async function simulatedUIExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 3: Simulated UI Interaction');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Create everything
  const desktopCore = createDesktopCore({
    workingDirectory: process.cwd()
  });
  
  await desktopCore.initialize();
  
  const uiBridge = new UIBridge();
  desktopCore.attachUIBridge(uiBridge);
  
  // Setup simulated UI
  const simulatedUI = {
    console: [],
    
    log(message) {
      this.console.push(message);
      console.log(`💻 Simulated UI: ${message}`);
    },
    
    renderStatus(status) {
      this.log(`Status: ${status}`);
    },
    
    renderToolCall(toolName) {
      this.log(`Calling tool: ${toolName}`);
    },
    
    renderResult(result) {
      this.log(`Result received`);
    }
  };
  
  // Subscribe UI bridge to events
  uiBridge.subscribe('status_update', (msg) => {
    simulatedUI.renderStatus(msg.data.message);
  });
  
  uiBridge.subscribe('tool_call', (msg) => {
    simulatedUI.renderToolCall(msg.data.toolName);
  });
  
  uiBridge.subscribe('agent_complete', (msg) => {
    simulatedUI.renderResult(msg.data.result);
  });
  
  // Simulate some events
  console.log('\n🖥️  Simulating desktop UI events...\n');
  
  const eventBus = getEventBus();
  
  // Simulate status update
  eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
    message: 'Loading model...',
    level: 'info'
  });
  
  // Simulate tool call
  eventBus.emit(RuntimeEvent.TOOL_CALL, {
    toolName: 'list_files',
    args: { path: './' }
  });
  
  // Show UI console
  console.log(`\n💻 Simulated UI console has ${simulatedUI.console.length} entries`);
  
  // Cleanup
  await desktopCore.dispose();
  
  console.log('\n✅ Example 3 complete!\n');
}

/**
 * Example 4: Full desktop app setup
 * 示例 4: 完整桌面应用设置
 */
async function fullDesktopAppExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 4: Full Desktop App Setup');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('📦 Setting up desktop app structure...\n');
  
  // Step 1: Initialize core
  console.log('1️⃣  Initializing Desktop Core...');
  const desktopCore = createDesktopCore({
    workingDirectory: process.cwd(),
    maxIterations: 100,
    debug: true
  });
  
  await desktopCore.initialize();
  
  // Step 2: Create UI bridge
  console.log('2️⃣  Setting up UI Bridge...');
  const uiBridge = new UIBridge();
  desktopCore.attachUIBridge(uiBridge);
  
  // Step 3: Register plugins
  console.log('3️⃣  Registering plugins...');
  const engine = desktopCore.getEngine();
  const pluginManager = engine.getPluginManager();
  pluginManager.register(DesktopPlugin);
  
  // Step 4: Display setup complete
  const state = desktopCore.getState();
  console.log(`\n✅ Desktop app setup complete!`);
  console.log(`   - Initialized: ${state.initialized}`);
  console.log(`   - Tools available: ${desktopCore.getTools().length}`);
  console.log(`   - Plugins active: ${pluginManager.getPluginCount()}`);
  
  // Step 5: Show what's available
  console.log(`\n📋 Desktop app features:`);
  console.log(`   ✅ Core engine`);
  console.log(`   ✅ Event-driven UI communication`);
  console.log(`   ✅ Plugin system`);
  console.log(`   ✅ Tool registry`);
  console.log(`   ✅ Memory management`);
  
  // Cleanup
  await desktopCore.dispose();
  
  console.log('\n✅ Example 4 complete!\n');
}

/**
 * Main
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          Desktop Integration Examples                          ║');
  console.log('║          桌面集成使用示例                                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  try {
    await basicDesktopExample();
    await desktopWithPluginExample();
    await simulatedUIExample();
    await fullDesktopAppExample();
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   🎉 All desktop integration examples complete!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('📚 Desktop integration files:');
    console.log('   - src/adapters/desktop/desktop-core.js');
    console.log('   - src/adapters/desktop/ipc-adapter.js (placeholder)');
    console.log('   - Check examples/ for usage');
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error in examples:', error);
    process.exit(1);
  }
}

// Run
main();
