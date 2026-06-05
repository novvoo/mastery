#!/usr/bin/env bun
/**
 * Runtime Layer Usage Example
 * 示例：如何使用新的 Runtime Layer
 */

import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  RuntimeEvent
} from '../src/runtime/index.js';
import { OpenAIModelProvider } from '../src/models/openai-provider.js';

// 1. 创建一个简单的事件监听器
function setupEventLogging() {
  const eventBus = getEventBus();
  
  console.log('📋 Setting up event listeners...\n');
  
  eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (event) => {
    const prefix = {
      'info': 'ℹ️',
      'success': '✅',
      'error': '❌',
      'debug': '🔧'
    }[event.level] || '📢';
    console.log(`${prefix} ${event.message}`);
  });
  
  eventBus.subscribe(RuntimeEvent.TOOL_CALL, (event) => {
    console.log(`\n🔧 Calling tool: ${event.toolName}`);
    if (Object.keys(event.args || {}).length > 0) {
      console.log('   Args:', JSON.stringify(event.args, null, 2));
    }
  });
  
  eventBus.subscribe(RuntimeEvent.TOOL_RESULT, (event) => {
    console.log('   ✅ Tool executed successfully');
  });
  
  eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, (event) => {
    console.log('\n🎉 Agent complete!');
    console.log('   Result:', event.result);
  });
  
  eventBus.subscribe(RuntimeEvent.AGENT_ERROR, (event) => {
    console.log('\n❌ Agent error:', event.error);
  });
}

// 2. 示例：使用 Runtime Layer 的简单场景
async function basicUsageExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 1: Basic Runtime Usage');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // 创建引擎
  const engine = createAgentEngine({
    platform: PlatformType.CLI,
    workingDirectory: process.cwd(),
    debug: true,
    maxIterations: 5
  });
  
  // 初始化
  console.log('Step 1: Initializing engine...');
  await engine.initialize();
  
  // 显示当前状态
  console.log('Step 2: Engine initialized. Current state:');
  console.log('   Status:', engine.getState().status);
  
  // 查看已注册的工具
  const tools = engine.getTools();
  console.log(`   Loaded ${tools.length} tools`);
  console.log('   Tool names:', tools.map(t => t.name).slice(0, 10).join(', '), '...');
  
  // 清理
  console.log('\nStep 3: Cleaning up...');
  engine.dispose();
  console.log('   Done!');
  
  console.log('\n✅ Example 1 complete!\n');
}

// 3. 示例：如何注册自定义工具
async function customToolExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 2: Registering Custom Tools');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const engine = createAgentEngine({
    workingDirectory: process.cwd()
  });
  
  await engine.initialize();
  
  // 创建自定义工具
  const customTool = {
    name: 'greet_user',
    description: 'Greet the user with a message',
    category: 'Utils',
    parameters: {
      name: { type: 'string', description: 'User name' }
    },
    required: ['name'],
    handler: async (args) => {
      return {
        message: `Hello, ${args.name}! Welcome to the Runtime Layer.`,
        timestamp: new Date().toISOString()
      };
    }
  };
  
  // 注册自定义工具
  console.log('Step 1: Registering custom tool...');
  engine.registerTool(customTool);
  console.log('   ✅ Custom tool registered!');
  
  // 验证工具已注册
  const tools = engine.getTools();
  const customToolFound = tools.find(t => t.name === 'greet_user');
  if (customToolFound) {
    console.log('   Found custom tool in registry!');
  }
  
  // 批量注册工具
  console.log('\nStep 2: Registering multiple tools...');
  const moreTools = [
    {
      name: 'calculate_square',
      description: 'Calculate the square of a number',
      category: 'Math',
      parameters: {
        num: { type: 'number', description: 'Number to square' }
      },
      required: ['num'],
      handler: async (args) => {
        return { result: args.num * args.num };
      }
    },
    {
      name: 'get_current_time',
      description: 'Get the current time',
      category: 'Utils',
      parameters: {},
      required: [],
      handler: async () => {
        return { time: new Date().toLocaleString() };
      }
    }
  ];
  
  engine.registerTools(moreTools);
  console.log('   ✅ Multiple tools registered!');
  
  // 清理
  engine.dispose();
  
  console.log('\n✅ Example 2 complete!\n');
}

// 4. 示例：使用事件总线
async function eventBusExample() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Example 3: Using the Event Bus');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const eventBus = getEventBus();
  
  // 创建多个监听器
  const eventsReceived = [];
  
  const unsubscribe1 = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (event) => {
    eventsReceived.push({ source: 'Listener 1', event });
  });
  
  const unsubscribe2 = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (event) => {
    eventsReceived.push({ source: 'Listener 2', event });
  });
  
  // 发送事件
  console.log('Step 1: Emitting events...');
  eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
    message: 'First event',
    level: 'info'
  });
  
  eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
    message: 'Second event',
    level: 'success'
  });
  
  // 显示事件
  console.log('\nStep 2: Events received:');
  eventsReceived.forEach((received, index) => {
    console.log(`   ${index + 1}. ${received.source}: "${received.event.message}"`);
  });
  
  // 验证订阅者计数
  console.log('\nStep 3: Subscriber counts:');
  console.log('   Before unsubscribe:', eventBus.getSubscriberCount(RuntimeEvent.STATUS_UPDATE));
  
  // 取消一个监听器
  unsubscribe1();
  console.log('   After unsubscribe1:', eventBus.getSubscriberCount(RuntimeEvent.STATUS_UPDATE));
  
  // 取消另一个监听器
  unsubscribe2();
  console.log('   After unsubscribe2:', eventBus.getSubscriberCount(RuntimeEvent.STATUS_UPDATE));
  
  // 清理所有
  eventBus.clear();
  
  console.log('\n✅ Example 3 complete!\n');
}

// 5. 主函数
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Runtime Layer Usage Examples                            ║');
  console.log('║       运行时架构使用示例                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  try {
    // 运行所有示例
    await basicUsageExample();
    await customToolExample();
    await eventBusExample();
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   🎉 All examples completed successfully!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('📚 Next steps:');
    console.log('   1. See docs/architecture-migration-guide.md for migration guide');
    console.log('   2. Check src/runtime/ for the core runtime layer');
    console.log('   3. Use npm run test:all to run all tests');
    console.log('   4. Check src/adapters/ for platform-specific adapters');
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Example error:', error);
    process.exit(1);
  }
}

// 运行示例
main();
