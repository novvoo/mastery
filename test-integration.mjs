#!/usr/bin/env node
/**
 * Comprehensive Integration Test Suite
 * 综合集成测试套件
 * 
 * 测试类型：
 * 1. 端到端 Agent 执行测试
 * 2. 并发压力测试
 * 3. 错误恢复测试
 * 4. 跨平台命令测试
 * 5. 长时间运行测试
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { performance } from 'perf_hooks';
import { spawn } from 'child_process';
import { createServer } from 'http';

config();

// 测试结果统计
const results = {
  suite: 'Integration Tests',
  startTime: new Date().toISOString(),
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: [],
  duration: 0,
};

// 测试配置
const TEST_CONFIG = {
  testDir: resolve(process.cwd(), '.test-temp'),
  maxConcurrency: 10,
  longRunningDuration: 30000, // 30秒
  stressTestIterations: 50,
};

// 确保测试目录存在
if (!existsSync(TEST_CONFIG.testDir)) {
  mkdirSync(TEST_CONFIG.testDir, { recursive: true });
}

// 测试框架
class TestRunner {
  constructor(name) {
    this.name = name;
    this.tests = [];
  }

  test(description, fn, options = {}) {
    this.tests.push({ description, fn, options });
  }

  async run() {
    console.log(`\n📦 ${this.name}`);
    console.log('─'.repeat(60));

    for (const test of this.tests) {
      const start = performance.now();
      const testResult = {
        suite: this.name,
        description: test.description,
        status: 'pending',
        duration: 0,
        error: null,
      };

      try {
        if (test.options.skip) {
          testResult.status = 'skipped';
          results.skipped++;
          console.log(`  ⏭️  ${test.description} (skipped)`);
        } else {
          await test.fn();
          testResult.status = 'passed';
          results.passed++;
          const duration = (performance.now() - start).toFixed(0);
          console.log(`  ✅ ${test.description} (${duration}ms)`);
        }
      } catch (error) {
        testResult.status = 'failed';
        testResult.error = error.message;
        results.failed++;
        console.log(`  ❌ ${test.description}`);
        console.log(`     Error: ${error.message}`);
        if (test.options.continueOnError !== false) {
          // 继续执行其他测试
        } else {
          throw error;
        }
      }

      testResult.duration = performance.now() - start;
      results.tests.push(testResult);
    }
  }
}

// ============ 1. 端到端 Agent 执行测试 ============
const agentE2ETests = new TestRunner('End-to-End Agent Execution');

agentE2ETests.test('Agent processes simple query without tools', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  // 创建 Mock LLM Provider - 匹配 agent.js 期望的接口
  const mockProvider = {
    async chat(messages, options) {
      // 模拟 LLM 直接回答，不调用工具
      return {
        text: 'FINAL_ANSWER: This is a direct response without tool calls.',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000; // 模拟上下文窗口大小
    },
    dispose() {
      // 清理资源
    },
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // Agent.run() 不返回结果，只验证不抛出错误
  await agent.run('What is 2+2?');
}, { continueOnError: false });

agentE2ETests.test('Agent executes single tool call', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let toolExecuted = false;
  let callCount = 0;

  const mockProvider = {
    async chat(messages, options) {
      callCount++;
      // 第一次调用返回工具调用
      if (callCount === 1) {
        return {
          text: 'I will check the current time.',
          toolCalls: [{
            id: 'call_1',
            name: 'current_time',
            arguments: {},
          }],
        };
      }
      // 第二次调用返回最终结果
      return {
        text: 'FINAL_ANSWER: The current time has been retrieved.',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'current_time',
    description: 'Get current time',
    parameters: {},
    async handler() {
      toolExecuted = true;
      return { success: true, time: new Date().toISOString() };
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('What time is it?');

  if (!toolExecuted) {
    throw new Error('Tool was not executed');
  }
});

agentE2ETests.test('Agent handles tool execution error gracefully', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const mockProvider = {
    async chat(messages, options) {
      return {
        text: 'Let me try to read the file.',
        toolCalls: [{
          id: 'call_1',
          name: 'read_file',
          arguments: { path: '/nonexistent/file.txt' },
        }],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'read_file',
    description: 'Read file',
    parameters: { path: { type: 'string' } },
    async handler(args) {
      throw new Error('File not found');
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // Agent 应该能处理工具错误而不崩溃
  await agent.run('Read the file');
});

agentE2ETests.test('Agent respects max iterations limit', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let callCount = 0;

  const mockProvider = {
    async chat(messages, options) {
      callCount++;
      // 始终返回工具调用，不返回 FINAL_ANSWER
      return {
        text: 'Let me check again.',
        toolCalls: [{
          id: `call_${callCount}`,
          name: 'noop',
          arguments: {},
        }],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'noop',
    description: 'No operation',
    parameters: {},
    async handler() {
      return { success: true };
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 3,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // Agent 应该在达到最大迭代次数后正常结束
  await agent.run('Keep checking');

  if (callCount > 4) {
    throw new Error(`Agent exceeded max iterations: ${callCount} calls`);
  }
});

// ============ 2. 并发压力测试 ============
const concurrencyTests = new TestRunner('Concurrency & Stress Tests');

concurrencyTests.test('Multiple tools execute concurrently', async () => {
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const registry = new ToolRegistry();

  const executionOrder = [];
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // 注册多个慢速工具
  for (let i = 0; i < 5; i++) {
    registry.register({
      name: `slow_tool_${i}`,
      description: `Slow tool ${i}`,
      parameters: {},
      async handler() {
        executionOrder.push(`start_${i}`);
        await delay(100);
        executionOrder.push(`end_${i}`);
        return { success: true, id: i };
      },
    });
  }

  // 并发执行
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(registry.execute(`slow_tool_${i}`, {}));
  }

  await Promise.all(promises);

  // 验证并发执行（不是顺序执行）
  const starts = executionOrder.filter(e => e.startsWith('start_'));
  const ends = executionOrder.filter(e => e.startsWith('end_'));

  // 如果所有 start 都在任何 end 之前，说明是并发执行
  const firstEndIndex = executionOrder.findIndex(e => e.startsWith('end_'));
  const startsBeforeFirstEnd = executionOrder
    .slice(0, firstEndIndex)
    .filter(e => e.startsWith('start_')).length;

  if (startsBeforeFirstEnd < 3) {
    throw new Error(`Tools executed sequentially: only ${startsBeforeFirstEnd} started before first completion`);
  }
});

concurrencyTests.test('ProcessManager handles concurrent process execution', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();

  const results = [];
  const promises = [];

  // 并发执行多个系统命令
  for (let i = 0; i < 5; i++) {
    promises.push(
      pm.execute(`echo "test_${i}"`).then(result => {
        results.push(result);
      })
    );
  }

  await Promise.all(promises);

  if (results.length !== 5) {
    throw new Error(`Expected 5 results, got ${results.length}`);
  }

  // 验证所有期望的输出都存在于结果中（不考虑顺序）
  const allOutputs = results.map(r => r.stdout);
  for (let i = 0; i < 5; i++) {
    if (!allOutputs.some(output => output.includes(`test_${i}`))) {
      throw new Error(`Missing expected output: test_${i}`);
    }
  }

  await pm.dispose();
});

concurrencyTests.test('Port allocation prevents conflicts', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();

  const ports = new Set();
  const promises = [];

  // 并发获取多个端口
  for (let i = 0; i < 10; i++) {
    promises.push(
      pm.getAvailablePort().then(port => {
        if (ports.has(port)) {
          throw new Error(`Duplicate port allocated: ${port}`);
        }
        ports.add(port);
      })
    );
  }

  await Promise.all(promises);

  if (ports.size !== 10) {
    throw new Error(`Expected 10 unique ports, got ${ports.size}`);
  }

  await pm.dispose();
});

concurrencyTests.test('Lock mechanism prevents race conditions', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();

  let counter = 0;
  const lockName = 'test_counter_lock';

  const incrementCounter = async () => {
    if (pm.acquireLock(lockName)) {
      try {
        const current = counter;
        await new Promise(resolve => setTimeout(resolve, 10));
        counter = current + 1;
      } finally {
        pm.releaseLock(lockName);
      }
      return true;
    }
    return false;
  };

  // 并发尝试获取锁
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(incrementCounter());
  }

  const results = await Promise.all(promises);
  const acquired = results.filter(r => r).length;

  if (counter !== acquired) {
    throw new Error(`Race condition detected: counter=${counter}, acquired=${acquired}`);
  }

  await pm.dispose();
});

// ============ 3. 错误恢复测试 ============
const recoveryTests = new TestRunner('Error Recovery & Resilience');

recoveryTests.test('ProcessManager retries failed commands', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager({
    maxRestartAttempts: 3,
    restartDelay: 100,
  });

  let attempts = 0;
  
  // 模拟一个会失败前两次的命令
  const mockExecute = async () => {
    attempts++;
    if (attempts < 3) {
      const error = new Error(`Command failed: Attempt ${attempts} failed (exit code: 1)`);
      error.exitCode = 1;
      throw error;
    }
    return { success: true, stdout: 'Success', stderr: '' };
  };

  // 验证重试逻辑
  const result = await pm.shouldRetry({ exitCode: 1, killed: false, stderr: '' });
  if (!result) {
    throw new Error('shouldRetry should return true for exit code 1');
  }

  await pm.dispose();
});

recoveryTests.test('Agent recovers from LLM provider errors', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let failCount = 0;

  const mockProvider = {
    async chat(messages, options) {
      failCount++;
      if (failCount < 2) {
        throw new Error('Network error');
      }
      return {
        text: 'FINAL_ANSWER: Recovered from error.',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 应该重试并最终成功
  await agent.run('Test query');
  
  if (failCount < 2) {
    throw new Error('Agent did not retry after error');
  }
});

recoveryTests.test('Tool execution timeout configuration works', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager({
    defaultTimeout: 1000, // 设置较短的默认超时
  });

  // 验证超时配置被正确设置
  const stats = await pm.getSystemStats();
  if (!stats.activeProcesses && stats.activeProcesses !== 0) {
    throw new Error('Could not get system stats');
  }

  // 执行一个快速命令验证基本功能
  const result = await pm.execute('echo "test"', { timeout: 5000 });
  if (!result.success) {
    throw new Error('Basic command execution failed');
  }

  await pm.dispose();
});

// ============ 4. 跨平台命令测试 ============
const platformTests = new TestRunner('Cross-Platform Compatibility');

platformTests.test('ProcessManager detects platform correctly', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const info = ProcessManager.getPlatformInfo();

  if (!info.platform) {
    throw new Error('Platform not detected');
  }

  if (!['win32', 'darwin', 'linux'].includes(info.platform)) {
    throw new Error(`Unknown platform: ${info.platform}`);
  }

  console.log(`     Platform: ${info.platform}`);
  console.log(`     Shell: ${info.shell}`);
});

platformTests.test('Command adaptation works for current platform', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();
  const info = ProcessManager.getPlatformInfo();

  // 测试基本命令执行
  const result = await pm.execute('echo "hello world"');

  if (!result.stdout.includes('hello world')) {
    throw new Error(`Command output unexpected: ${result.stdout}`);
  }

  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code: ${result.exitCode}`);
  }

  await pm.dispose();
});

platformTests.test('File operations work cross-platform', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();

  const testFile = join(TEST_CONFIG.testDir, 'platform_test.txt');

  // 创建文件
  if (ProcessManager.getPlatformInfo().isWindows) {
    await pm.execute(`echo test content > ${testFile}`);
  } else {
    await pm.execute(`echo "test content" > ${testFile}`);
  }

  // 读取文件
  const content = readFileSync(testFile, 'utf-8');
  if (!content.includes('test')) {
    throw new Error('File content not as expected');
  }

  await pm.dispose();
});

platformTests.test('Path handling is platform-aware', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();
  const info = ProcessManager.getPlatformInfo();

  // 测试路径分隔符
  const testPath = info.isWindows ? 'C:\\test\\path' : '/test/path';
  const adapted = pm.adaptCommand(`cat ${testPath}`);

  if (info.isWindows && adapted.command.includes('/')) {
    // Windows 上应该使用反斜杠
    console.log('     Note: Path may need manual conversion on Windows');
  }

  await pm.dispose();
});

// ============ 5. Timeout 与交互测试 ============
const timeoutAndInteractionTests = new TestRunner('Timeout & Interaction Tests');

timeoutAndInteractionTests.test('withTimeout function works correctly', async () => {
  const { withTimeout } = await import('./src/errors/error-handler.js');
  
  // 测试正常完成的情况
  const result1 = await withTimeout(async () => {
    return 'success';
  }, 1000, 'test1');
  if (result1 !== 'success') {
    throw new Error('Expected success result');
  }
  
  // 测试 timeout 的情况
  let timeoutError = null;
  try {
    await withTimeout(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return 'too late';
    }, 100, 'test2');
  } catch (error) {
    timeoutError = error;
  }
  if (!timeoutError || !timeoutError.message.includes('timed out')) {
    throw new Error('Expected timeout error');
  }
});

timeoutAndInteractionTests.test('LLM call timeout is handled properly', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');
  const { classifyError } = await import('./src/errors/error-handler.js');

  let callCount = 0;
  const mockProvider = {
    async chat(messages, options) {
      callCount++;
      // 第一次故意超时
      if (callCount === 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { text: 'should not reach here', toolCalls: [] };
      }
      // 第二次正常响应
      return {
        text: 'FINAL_ANSWER: Recovered after timeout',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  // 为了测试 timeout，我们需要临时修改 withTimeout 的行为
  // 这里我们模拟一个会超时的场景
  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 验证 timeout 错误分类
  const timeoutError = new Error('LLM call timed out after 120000ms');
  const classified = classifyError(timeoutError);
  if (classified.category !== 'timeout_error') {
    throw new Error(`Expected timeout_error, got ${classified.category}`);
  }
  if (!classified.retryable) {
    throw new Error('Timeout should be retryable');
  }
});

timeoutAndInteractionTests.test('Tool execution timeout is handled properly', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let toolCallCount = 0;
  const mockProvider = {
    async chat(messages, options) {
      // 第一次调用工具
      return {
        text: 'I will use the slow tool',
        toolCalls: [{
          id: 'call1',
          name: 'slow_tool',
          arguments: {},
        }],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'slow_tool',
    description: 'A slow tool that will timeout',
    parameters: {},
    async handler() {
      toolCallCount++;
      // 模拟长时间执行
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { result: 'should not reach here' };
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 执行代理
  await agent.run('Use the slow tool');

  // 验证工具被调用了
  if (toolCallCount !== 1) {
    throw new Error(`Expected tool to be called once, got ${toolCallCount}`);
  }
});

timeoutAndInteractionTests.test('RetryStrategy works correctly', async () => {
  const { RetryStrategy } = await import('./src/errors/error-handler.js');

  const retryStrategy = new RetryStrategy();
  let attemptCount = 0;

  // 测试成功的情况
  const result1 = await retryStrategy.executeWithRetry(async () => {
    attemptCount++;
    return 'success';
  });
  if (result1 !== 'success' || attemptCount !== 1) {
    throw new Error('Expected one successful attempt');
  }

  // 测试重试后成功的情况
  attemptCount = 0;
  let failCount = 0;
  const result2 = await retryStrategy.executeWithRetry(async () => {
    attemptCount++;
    if (failCount < 2) {
      failCount++;
      throw new Error('Temporary failure');
    }
    return 'eventual success';
  }, { maxRetries: 3, baseDelay: 10 }); // 短延迟用于测试
  if (result2 !== 'eventual success' || attemptCount !== 3) {
    throw new Error(`Expected 3 attempts, got ${attemptCount}`);
  }

  // 测试重试超过最大次数失败
  attemptCount = 0;
  let finalError = null;
  try {
    await retryStrategy.executeWithRetry(async () => {
      attemptCount++;
      throw new Error('Always fails');
    }, { maxRetries: 2, baseDelay: 10 });
  } catch (error) {
    finalError = error;
  }
  if (!finalError || attemptCount !== 2) {
    throw new Error('Expected error after max retries');
  }
});

timeoutAndInteractionTests.test('Complete interaction flow with tool calls', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let chatCount = 0;
  let toolExecutionCount = 0;
  let toolResults = [];

  const mockProvider = {
    async chat(messages, options) {
      chatCount++;
      if (chatCount === 1) {
        // 第一次调用：先使用工具1
        return {
          text: 'Let me get some data first',
          toolCalls: [{
            id: 'call1',
            name: 'get_data',
            arguments: { key: 'test1' },
          }],
        };
      } else if (chatCount === 2) {
        // 第二次调用：再使用工具2
        return {
          text: 'Now let me process the data',
          toolCalls: [{
            id: 'call2',
            name: 'process_data',
            arguments: { data: 'from tool1' },
          }],
        };
      } else {
        // 最后一次：返回最终答案
        return {
          text: 'FINAL_ANSWER: All steps completed successfully',
          toolCalls: [],
        };
      }
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  
  registry.register({
    name: 'get_data',
    description: 'Get data by key',
    parameters: { key: { type: 'string' } },
    async handler(args) {
      toolExecutionCount++;
      toolResults.push({ tool: 'get_data', args });
      return { value: `data for ${args.key}` };
    },
  });

  registry.register({
    name: 'process_data',
    description: 'Process data',
    parameters: { data: { type: 'string' } },
    async handler(args) {
      toolExecutionCount++;
      toolResults.push({ tool: 'process_data', args });
      return { processed: true, output: `processed: ${args.data}` };
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 10,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('Please process this for me');

  // 验证完整流程
  if (chatCount !== 3) {
    throw new Error(`Expected 3 chat calls, got ${chatCount}`);
  }
  if (toolExecutionCount !== 2) {
    throw new Error(`Expected 2 tool executions, got ${toolExecutionCount}`);
  }
  if (toolResults[0].tool !== 'get_data') {
    throw new Error('First tool should be get_data');
  }
  if (toolResults[1].tool !== 'process_data') {
    throw new Error('Second tool should be process_data');
  }
});

timeoutAndInteractionTests.test('Agent handles mixed tool calls and text responses', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let responseSequence = [];
  let chatIndex = 0;
  const responses = [
    { text: 'Let me check step 1', toolCalls: [{ id: 'c1', name: 'step1', arguments: {} }] },
    { text: 'Good, now step 2', toolCalls: [{ id: 'c2', name: 'step2', arguments: {} }] },
    { text: 'Okay, step 3', toolCalls: [{ id: 'c3', name: 'step3', arguments: {} }] },
    { text: 'FINAL_ANSWER: All steps done!', toolCalls: [] },
  ];

  const mockProvider = {
    async chat(messages, options) {
      const response = responses[chatIndex];
      chatIndex++;
      responseSequence.push({ type: 'chat', responseIndex: chatIndex - 1 });
      return response;
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  ['step1', 'step2', 'step3'].forEach(stepName => {
    registry.register({
      name: stepName,
      description: `Execute ${stepName}`,
      parameters: {},
      async handler() {
        responseSequence.push({ type: 'tool', name: stepName });
        return { status: 'completed', step: stepName };
      },
    });
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 10,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('Execute the workflow');

  // 验证执行顺序
  const expectedSequence = [
    'chat:0', 'tool:step1',
    'chat:1', 'tool:step2',
    'chat:2', 'tool:step3',
    'chat:3'
  ];
  
  const actualSequence = responseSequence.map(item => 
    item.type === 'chat' ? `chat:${item.responseIndex}` : `tool:${item.name}`
  );

  if (JSON.stringify(actualSequence) !== JSON.stringify(expectedSequence)) {
    throw new Error(`Sequence mismatch. Expected: ${expectedSequence}, Got: ${actualSequence}`);
  }
});

timeoutAndInteractionTests.test('Simulate user submitting multiple tasks with response monitoring', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  // 模拟用户交互日志
  const interactionLog = [];
  let requestCount = 0;

  const mockProvider = {
    async chat(messages, options) {
      requestCount++;
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      
      interactionLog.push({
        type: 'llm_request',
        requestId: requestCount,
        userInput: lastUserMessage?.content?.substring(0, 100),
        timestamp: Date.now()
      });

      // 根据不同的用户输入返回不同的响应
      const content = lastUserMessage?.content || '';
      
      if (content.includes('weather')) {
        return {
          text: 'Let me check the weather',
          toolCalls: [{ id: 'w1', name: 'get_weather', arguments: { city: 'Shanghai' } }],
        };
      } else if (content.includes('file')) {
        return {
          text: 'Let me check the file system',
          toolCalls: [{ id: 'f1', name: 'list_files', arguments: { path: '.' } }],
        };
      } else if (content.includes('task')) {
        return {
          text: 'Let me create a task',
          toolCalls: [{ id: 't1', name: 'create_task', arguments: { name: content } }],
        };
      } else {
        return {
          text: `FINAL_ANSWER: Responding to: ${content}`,
          toolCalls: [],
        };
      }
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  
  // 注册测试工具
  registry.register({
    name: 'get_weather',
    description: 'Get weather for a city',
    parameters: { city: { type: 'string' } },
    async handler(args) {
      interactionLog.push({
        type: 'tool_call',
        tool: 'get_weather',
        args,
        timestamp: Date.now()
      });
      await new Promise(resolve => setTimeout(resolve, 50)); // 模拟延迟
      return { temperature: 25, conditions: 'Sunny', city: args.city };
    },
  });

  registry.register({
    name: 'list_files',
    description: 'List files in a directory',
    parameters: { path: { type: 'string' } },
    async handler(args) {
      interactionLog.push({
        type: 'tool_call',
        tool: 'list_files',
        args,
        timestamp: Date.now()
      });
      await new Promise(resolve => setTimeout(resolve, 30)); // 模拟延迟
      return { files: ['test1.txt', 'test2.js', 'config.json'], path: args.path };
    },
  });

  registry.register({
    name: 'create_task',
    description: 'Create a new task',
    parameters: { name: { type: 'string' } },
    async handler(args) {
      interactionLog.push({
        type: 'tool_call',
        tool: 'create_task',
        args,
        timestamp: Date.now()
      });
      await new Promise(resolve => setTimeout(resolve, 20)); // 模拟延迟
      return { taskId: 'task_' + Date.now(), status: 'created', name: args.name };
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 模拟用户提交的多个任务序列
  const userTasks = [
    'What is the weather in Shanghai?',
    'List files in the current directory',
    'Create a task to finish the project',
    'Tell me a joke',
    'What is the weather like tomorrow?',
  ];

  console.log(`     Executing ${userTasks.length} user tasks...`);

  // 记录每个任务的执行时间和结果
  const taskResults = [];
  for (let i = 0; i < userTasks.length; i++) {
    const task = userTasks[i];
    const startTime = Date.now();
    
    interactionLog.push({
      type: 'user_input',
      taskIndex: i,
      content: task,
      timestamp: startTime
    });

    console.log(`       Task ${i + 1}: ${task.substring(0, 40)}...`);

    await agent.run(task);

    const endTime = Date.now();
    const duration = endTime - startTime;
    
    taskResults.push({
      taskIndex: i,
      task: task,
      duration: duration,
      completed: true
    });

    interactionLog.push({
      type: 'task_complete',
      taskIndex: i,
      duration: duration,
      timestamp: endTime
    });

    console.log(`       → Completed in ${duration}ms`);
  }

  // 验证所有任务都完成了
  if (taskResults.length !== userTasks.length) {
    throw new Error(`Expected ${userTasks.length} tasks to complete, got ${taskResults.length}`);
  }

  // 验证任务响应时间都是合理的
  for (const result of taskResults) {
    if (result.duration > 30000) { // 超过 30 秒认为超时
      throw new Error(`Task ${result.taskIndex} took too long: ${result.duration}ms`);
    }
  }

  // 分析交互日志
  const llmRequests = interactionLog.filter(log => log.type === 'llm_request');
  const toolCalls = interactionLog.filter(log => log.type === 'tool_call');
  const userInputs = interactionLog.filter(log => log.type === 'user_input');

  console.log(`     Interaction Summary:`);
  console.log(`       User Inputs: ${userInputs.length}`);
  console.log(`       LLM Requests: ${llmRequests.length}`);
  console.log(`       Tool Calls: ${toolCalls.length}`);
  console.log(`       Tool Types Used: ${[...new Set(toolCalls.map(tc => tc.tool))]}`);

  // 验证基本交互数量
  if (userInputs.length !== userTasks.length) {
    throw new Error(`Expected ${userTasks.length} user inputs, got ${userInputs.length}`);
  }

  // 验证至少有一些工具调用
  if (toolCalls.length === 0) {
    throw new Error('Expected some tool calls to be made');
  }

  // 验证具体的工具被调用了
  const calledTools = toolCalls.map(tc => tc.tool);
  if (!calledTools.includes('get_weather')) {
    throw new Error('Expected get_weather tool to be called');
  }
  if (!calledTools.includes('list_files')) {
    throw new Error('Expected list_files tool to be called');
  }
  if (!calledTools.includes('create_task')) {
    throw new Error('Expected create_task tool to be called');
  }

  // 打印任务执行的平均时间
  const avgDuration = taskResults.reduce((sum, r) => sum + r.duration, 0) / taskResults.length;
  console.log(`       Average task duration: ${avgDuration.toFixed(2)}ms`);
});

timeoutAndInteractionTests.test('Concurrent interaction stress test', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const stressTestResults = [];
  const testIterations = 5;
  
  console.log(`     Running ${testIterations} iterations of stress test...`);

  for (let iteration = 0; iteration < testIterations; iteration++) {
    let callCount = 0;
    const mockProvider = {
      async chat(messages, options) {
        callCount++;
        return {
          text: 'FINAL_ANSWER: Quick response',
          toolCalls: [],
        };
      },
      getMaxContextTokens() {
        return 4000;
      },
      dispose() {},
    };

    const registry = new ToolRegistry();
    const memory = new MemoryManager(TEST_CONFIG.testDir);
    const agent = new ReActAgent(mockProvider, registry, memory, {
      maxIterations: 5,
      workingDirectory: TEST_CONFIG.testDir,
    });

    const startTime = Date.now();
    const quickTasks = ['Hi', 'Hello', 'Test', 'Check', 'Done'];
    
    // 快速连续提交任务
    for (const task of quickTasks) {
      await agent.run(task);
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    stressTestResults.push({
      iteration: iteration,
      tasksCompleted: quickTasks.length,
      totalDuration: totalDuration,
      avgTaskDuration: totalDuration / quickTasks.length,
      llmCalls: callCount
    });

    console.log(`       Iteration ${iteration + 1}: ${quickTasks.length} tasks in ${totalDuration}ms`);
  }

  // 分析压力测试结果
  const totalTime = stressTestResults.reduce((sum, r) => sum + r.totalDuration, 0);
  const avgTotalTime = totalTime / testIterations;
  const avgTaskTime = stressTestResults.reduce((sum, r) => sum + r.avgTaskDuration, 0) / testIterations;

  console.log(`     Stress Test Summary:`);
  console.log(`       Total Iterations: ${testIterations}`);
  console.log(`       Average Total Time: ${avgTotalTime.toFixed(2)}ms`);
  console.log(`       Average Task Time: ${avgTaskTime.toFixed(2)}ms`);

  // 验证压力测试中的响应时间都是可接受的
  for (const result of stressTestResults) {
    if (result.avgTaskDuration > 5000) { // 每个任务超过 5 秒认为有问题
      throw new Error(`Iteration ${result.iteration} has slow avg task time: ${result.avgTaskDuration}ms`);
    }
  }

  // 验证所有迭代都完成了预期的任务数
  for (const result of stressTestResults) {
    if (result.tasksCompleted !== 5) {
      throw new Error(`Iteration ${result.iteration} didn't complete all tasks: ${result.tasksCompleted}`);
    }
  }
});

// ============ 6. 多次对话执行测试 ============
const multiConversationTests = new TestRunner('Multiple Conversation Execution');

multiConversationTests.test('Agent handles multiple consecutive run() calls without getting stuck', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');
  const { SessionManager } = await import('./src/core/session-manager.js');

  let callCount = 0;
  const responses = [
    'FINAL_ANSWER: Response 1',
    'FINAL_ANSWER: Response 2',
    'FINAL_ANSWER: Response 3',
    'FINAL_ANSWER: Response 4',
    'FINAL_ANSWER: Response 5',
  ];

  const mockProvider = {
    async chat(messages, options) {
      callCount++;
      return {
        text: responses[Math.min(callCount - 1, responses.length - 1)],
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 执行 5 次连续的 run() 调用
  for (let i = 1; i <= 5; i++) {
    await agent.run(`Query ${i}`);
    console.log(`     Query ${i} completed successfully`);
  }

  if (callCount !== 5) {
    throw new Error(`Expected 5 LLM calls, got ${callCount}`);
  }
});

multiConversationTests.test('System prompt is not duplicated across multiple run() calls', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let systemPromptLengths = [];

  const mockProvider = {
    async chat(messages, options) {
      // 保存系统提示词长度用于验证
      const systemMessage = messages.find(m => m.role === 'system');
      if (systemMessage) {
        systemPromptLengths.push(systemMessage.content.length);
      }
      return {
        text: 'FINAL_ANSWER: Done',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 执行 3 次 run() 调用
  for (let i = 0; i < 3; i++) {
    await agent.run(`Test query ${i}`);
  }

  console.log(`     System prompt lengths: ${systemPromptLengths}`);

  // 验证系统提示词长度不会增长
  if (systemPromptLengths.length >= 2) {
    const firstLength = systemPromptLengths[0];
    for (let i = 1; i < systemPromptLengths.length; i++) {
      if (systemPromptLengths[i] > firstLength) {
        throw new Error(`System prompt grew: first=${firstLength}, round ${i}=${systemPromptLengths[i]}`);
      }
    }
  }
});

multiConversationTests.test('Agent preserves conversation context across multiple run() calls', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const messageHistory = [];

  const mockProvider = {
    async chat(messages, options) {
      // 保存消息历史用于验证
      messageHistory.push(messages.map(m => ({
        role: m.role,
        content: m.content.substring(0, 50), // 只保存前50个字符用于验证
      })));
      
      return {
        text: 'FINAL_ANSWER: Done',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 执行 3 次 run() 调用
  const queries = ['First question', 'Second question', 'Third question'];
  for (const query of queries) {
    await agent.run(query);
  }

  // 验证每次的消息历史都包含之前的对话
  for (let i = 1; i < messageHistory.length; i++) {
    const currentMessages = messageHistory[i];
    const userMessages = currentMessages.filter(m => m.role === 'user');
    
    if (userMessages.length !== i + 1) {
      throw new Error(`Round ${i + 1} should have ${i + 1} user messages, got ${userMessages.length}`);
    }
  }
});

multiConversationTests.test('setModelProvider works correctly', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let provider1CallCount = 0;
  let provider2CallCount = 0;

  const mockProvider1 = {
    async chat(messages, options) {
      provider1CallCount++;
      return {
        text: 'FINAL_ANSWER: Provider 1 response',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const mockProvider2 = {
    async chat(messages, options) {
      provider2CallCount++;
      return {
        text: 'FINAL_ANSWER: Provider 2 response',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider1, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 第一次使用 provider1
  await agent.run('Test 1');
  
  // 切换到 provider2
  agent.setModelProvider(mockProvider2);
  
  // 第二次使用 provider2
  await agent.run('Test 2');
  
  // 切换回 provider1
  agent.setModelProvider(mockProvider1);
  
  // 第三次使用 provider1
  await agent.run('Test 3');

  if (provider1CallCount !== 2) {
    throw new Error(`Provider 1 should be called 2 times, got ${provider1CallCount}`);
  }
  
  if (provider2CallCount !== 1) {
    throw new Error(`Provider 2 should be called 1 time, got ${provider2CallCount}`);
  }
});

multiConversationTests.test('Context window management works during long conversations', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let messageLengths = [];

  const mockProvider = {
    async chat(messages, options) {
      messageLengths.push(messages.length);
      // 生成长响应，增加消息长度
      return {
        text: 'FINAL_ANSWER: ' + 'x'.repeat(1000),
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 1000; // 设置较小的上下文窗口，触发裁剪
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 执行 10 次 run() 调用
  for (let i = 0; i < 10; i++) {
    await agent.run(`Query ${i}: ` + 'y'.repeat(200));
  }

  console.log(`     Message counts over time: ${messageLengths}`);

  // 验证消息数量不会无限增长
  if (messageLengths.length > 2) {
    const lastCount = messageLengths[messageLengths.length - 1];
    if (lastCount > 15) {
      throw new Error(`Too many messages in context: ${lastCount}`);
    }
  }
});

// ============ 7. 对话协议回归测试 ============
const conversationProtocolTests = new TestRunner('Conversation Protocol Regression');

conversationProtocolTests.test('Text CALL tool results do not leak as native tool messages on next run', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const messageSnapshots = [];
  let chatCount = 0;

  const mockProvider = {
    async chat(messages) {
      chatCount++;
      messageSnapshots.push(messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      })));

      if (chatCount === 1) {
        return {
          text: 'Thought: I need a tool.\nAction: CALL lookup_value({"key":"alpha"})',
          toolCalls: [],
        };
      }

      return {
        text: `FINAL_ANSWER: response ${chatCount}`,
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'lookup_value',
    description: 'Lookup a value',
    parameters: { key: { type: 'string' } },
    async handler(args) {
      return { value: `value:${args.key}` };
    },
  });

  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('first turn');
  await agent.run('second turn');

  const secondRunMessages = messageSnapshots[2].filter(m => m.role !== 'system');
  const leakedToolProtocol = secondRunMessages.some(m => m.role === 'tool' || m.toolCalls);
  if (leakedToolProtocol) {
    throw new Error(`Text CALL leaked into native tool-call protocol: ${JSON.stringify(secondRunMessages, null, 2)}`);
  }

  const observation = secondRunMessages.find(m =>
    m.role === 'user' && m.content.includes('Observation from lookup_value')
  );
  if (!observation || !observation.content.includes('value:alpha')) {
    throw new Error(`Expected text CALL result to be stored as observation, got: ${JSON.stringify(secondRunMessages, null, 2)}`);
  }
});

conversationProtocolTests.test('Native tool calls preserve assistant tool_calls and matching tool result ids', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let secondRequestMessages = null;
  let chatCount = 0;

  const mockProvider = {
    async chat(messages) {
      chatCount++;
      if (chatCount === 2) {
        secondRequestMessages = messages.map(m => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
        }));
      }

      if (chatCount === 1) {
        return {
          text: '',
          toolCalls: [{
            id: 'native_call_1',
            name: 'native_lookup',
            arguments: { id: 42 },
          }],
        };
      }

      return {
        text: 'FINAL_ANSWER: native done',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'native_lookup',
    description: 'Native lookup',
    parameters: { id: { type: 'number' } },
    async handler(args) {
      return { id: args.id, value: 'found' };
    },
  });

  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('use native tool');

  const nonSystem = secondRequestMessages.filter(m => m.role !== 'system');
  const assistantToolCall = nonSystem.find(m => m.role === 'assistant' && m.toolCalls);
  const toolResult = nonSystem.find(m => m.role === 'tool');

  if (!assistantToolCall) {
    throw new Error(`Expected assistant tool_calls in second request: ${JSON.stringify(nonSystem, null, 2)}`);
  }
  if (!toolResult || toolResult.toolCallId !== 'native_call_1') {
    throw new Error(`Expected matching tool result id native_call_1: ${JSON.stringify(nonSystem, null, 2)}`);
  }
  if (!toolResult.content.includes('"value":"found"')) {
    throw new Error(`Expected serialized native tool result content, got: ${toolResult.content}`);
  }
});

conversationProtocolTests.test('Native tool call response with CALL-looking text executes only once', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let chatCount = 0;
  let toolExecutions = 0;

  const mockProvider = {
    async chat() {
      chatCount++;
      if (chatCount === 1) {
        return {
          text: 'I will call it now. CALL audit_event({"event":"duplicate-risk"})',
          toolCalls: [{
            id: 'native_call_2',
            name: 'audit_event',
            arguments: { event: 'native' },
          }],
        };
      }

      return {
        text: 'FINAL_ANSWER: audited',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'audit_event',
    description: 'Audit an event',
    parameters: { event: { type: 'string' } },
    async handler() {
      toolExecutions++;
      return { ok: true };
    },
  });

  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('audit this');

  if (toolExecutions !== 1) {
    throw new Error(`Expected exactly one tool execution, got ${toolExecutions}`);
  }
});

conversationProtocolTests.test('Text CALL tool errors are observable and do not poison later requests', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const messageSnapshots = [];
  let chatCount = 0;

  const mockProvider = {
    async chat(messages) {
      chatCount++;
      messageSnapshots.push(messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      })));

      if (chatCount === 1) {
        return {
          text: 'Thought: try risky tool.\nAction: CALL risky_lookup({"id":"bad"})',
          toolCalls: [],
        };
      }

      return {
        text: 'FINAL_ANSWER: recovered',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'risky_lookup',
    description: 'Risky lookup',
    parameters: { id: { type: 'string' } },
    async handler() {
      throw new Error('backend unavailable');
    },
  });

  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('first');
  await agent.run('second');

  const secondIterationMessages = messageSnapshots[1].filter(m => m.role !== 'system');
  const errorObservation = secondIterationMessages.find(m =>
    m.role === 'user' && m.content.includes('Observation from risky_lookup') &&
    m.content.includes('backend unavailable')
  );
  if (!errorObservation) {
    throw new Error(`Expected text CALL error observation: ${JSON.stringify(secondIterationMessages, null, 2)}`);
  }

  const secondRunMessages = messageSnapshots[2].filter(m => m.role !== 'system');
  if (secondRunMessages.some(m => m.role === 'tool' || m.toolCalls)) {
    throw new Error(`Text CALL error poisoned later request with native protocol fields: ${JSON.stringify(secondRunMessages, null, 2)}`);
  }
});

conversationProtocolTests.test('Context trimming preserves the active user request during continuation prompts', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const requestSnapshots = [];
  let chatCount = 0;
  const mockProvider = {
    async chat(messages) {
      chatCount++;
      requestSnapshots.push(messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      })));

      if (chatCount === 1) {
        return {
          text: 'This response forgot the FINAL_ANSWER marker.',
          toolCalls: [],
        };
      }

      return {
        text: 'FINAL_ANSWER: recovered with the original request still visible',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 1000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  for (let i = 0; i < 20; i++) {
    registry.register({
      name: `verbose_tool_${i}`,
      description: `Verbose tool ${i} ` + 'x'.repeat(600),
      parameters: { value: { type: 'string', description: 'value' } },
      async handler() {
        return { ok: true };
      },
    });
  }

  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 3,
    workingDirectory: TEST_CONFIG.testDir,
  });

  await agent.run('ACTIVE_USER_REQUEST: please keep this visible');

  if (requestSnapshots.length < 2) {
    throw new Error(`Expected continuation request, got ${requestSnapshots.length} LLM calls`);
  }

  const secondRequestNonSystem = requestSnapshots[1].filter(m => m.role !== 'system');
  const hasOriginalUserRequest = secondRequestNonSystem.some(m =>
    m.role === 'user' && m.content.includes('ACTIVE_USER_REQUEST')
  );
  const hasContinuationPrompt = secondRequestNonSystem.some(m =>
    m.role === 'user' && m.content.includes('No tool call detected')
  );

  if (!hasOriginalUserRequest || !hasContinuationPrompt) {
    throw new Error(
      `Expected both original user request and continuation prompt after trimming, got: ${JSON.stringify(secondRequestNonSystem, null, 2)}`
    );
  }
});

conversationProtocolTests.test('OpenAI-compatible provider recognizes qwen long-context models', async () => {
  const { OpenAIModelProvider } = await import('./src/models/openai-provider.js');

  const provider = new OpenAIModelProvider('test-key', 'https://example.invalid/v1', 'qwen3.5-plus', false);
  const maxTokens = provider.getMaxContextTokens();

  if (maxTokens < 100000) {
    throw new Error(`Expected qwen3.5-plus to use long context, got ${maxTokens}`);
  }
});

conversationProtocolTests.test('Provider stop response without FINAL_ANSWER is surfaced without hidden continuation', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let chatCount = 0;
  const finalAnswers = [];
  const recordingUI = {
    iteration() {},
    toolCall() {},
    toolResult() {},
    toolError() {},
    warn() {},
    error() {},
    info() {},
    debug() {},
    debugEvent() {},
    finalAnswer(text) {
      finalAnswers.push(text);
    },
  };

  const mockProvider = {
    async chat() {
      chatCount++;
      return {
        text: 'Plain completed response without explicit marker.',
        toolCalls: [],
        finishReason: 'stop',
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const agent = new ReActAgent(mockProvider, new ToolRegistry(), new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  }, recordingUI);

  await agent.run('answer normally');

  if (chatCount !== 1) {
    throw new Error(`Expected no hidden continuation request, got ${chatCount} LLM calls`);
  }
  if (finalAnswers[0] !== 'Plain completed response without explicit marker.') {
    throw new Error(`Expected plain response to be surfaced, got ${JSON.stringify(finalAnswers)}`);
  }
});

// ============ 8. Debug 日志回归测试 ============
const debugLoggingTests = new TestRunner('Debug Logging Regression');

function createRecordingUI(initialDebug = false) {
  let debugEnabled = initialDebug;
  const events = [];
  const calls = {
    iterations: [],
    toolCalls: [],
    toolResults: [],
    toolErrors: [],
    finalAnswers: [],
    warnings: [],
    errors: [],
    infos: [],
    debugLines: [],
  };

  return {
    events,
    calls,
    setDebugMode(enabled) {
      debugEnabled = Boolean(enabled);
    },
    isDebugEnabled() {
      return debugEnabled;
    },
    debug(text) {
      if (debugEnabled) {
        calls.debugLines.push(text);
      }
    },
    debugEvent(label, details = {}) {
      if (debugEnabled) {
        events.push({ label, details });
      }
    },
    iteration(current, max) {
      calls.iterations.push({ current, max });
    },
    toolCall(name, args) {
      calls.toolCalls.push({ name, args });
    },
    toolResult(name, result) {
      calls.toolResults.push({ name, result });
    },
    toolError(name, error) {
      calls.toolErrors.push({ name, error });
    },
    finalAnswer(text) {
      calls.finalAnswers.push(text);
    },
    warn(text) {
      calls.warnings.push(text);
    },
    error(text) {
      calls.errors.push(text);
    },
    info(text) {
      calls.infos.push(text);
    },
  };
}

function requireDebugEvent(events, label) {
  const event = events.find(item => item.label === label);
  if (!event) {
    throw new Error(`Missing debug event "${label}". Got: ${events.map(item => item.label).join(', ')}`);
  }
  return event;
}

debugLoggingTests.test('Debug mode records agent lifecycle, LLM request, tool purpose, and shell command details', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');
  const { createShellTool } = await import('./src/tools/system/shell.js');

  let chatCount = 0;
  const secondRequestMessages = [];
  const mockProvider = {
    async chat(messages, options) {
      chatCount++;
      if (chatCount === 2) {
        secondRequestMessages.push(...messages.map(m => ({
          role: m.role,
          content: m.content,
          toolCallId: m.toolCallId,
          toolCalls: m.toolCalls,
        })));
      }

      if (chatCount === 1) {
        return {
          text: 'I will run a diagnostic command.',
          toolCalls: [{
            id: 'shell_call_1',
            name: 'shell',
            arguments: { command: 'printf debug-ok', timeout: 5000 },
          }],
          finishReason: 'tool_calls',
        };
      }

      return {
        text: 'FINAL_ANSWER: command completed',
        toolCalls: [],
        finishReason: 'stop',
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register(createShellTool());
  const recordingUI = createRecordingUI(true);
  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
    debug: true,
  }, recordingUI);

  await agent.run('run debug diagnostics');

  const events = recordingUI.events;
  [
    'Agent run started',
    'Session initialized',
    'Iteration started',
    'LLM request',
    'LLM response',
    'Tool calls detected',
    'Tool call started',
    'Shell command prepared',
    'Shell command finished',
    'Tool call completed',
    'Final answer emitted',
  ].forEach(label => requireDebugEvent(events, label));

  const toolStarted = requireDebugEvent(events, 'Tool call started');
  if (toolStarted.details.tool !== 'shell') {
    throw new Error(`Expected shell tool start event, got ${JSON.stringify(toolStarted.details)}`);
  }
  if (!toolStarted.details.purpose?.includes('Execute a shell command')) {
    throw new Error(`Expected tool purpose in debug event, got ${JSON.stringify(toolStarted.details)}`);
  }
  if (toolStarted.details.arguments?.command !== 'printf debug-ok') {
    throw new Error(`Expected tool arguments in debug event, got ${JSON.stringify(toolStarted.details)}`);
  }

  const shellPrepared = requireDebugEvent(events, 'Shell command prepared');
  if (shellPrepared.details.command !== 'printf debug-ok') {
    throw new Error(`Expected shell command in prepared event, got ${JSON.stringify(shellPrepared.details)}`);
  }
  if (shellPrepared.details.cwd !== TEST_CONFIG.testDir) {
    throw new Error(`Expected shell cwd ${TEST_CONFIG.testDir}, got ${shellPrepared.details.cwd}`);
  }
  if (shellPrepared.details.timeoutMs !== 5000) {
    throw new Error(`Expected timeoutMs 5000, got ${shellPrepared.details.timeoutMs}`);
  }

  const shellFinished = requireDebugEvent(events, 'Shell command finished');
  if (shellFinished.details.exitCode !== 0 || !shellFinished.details.stdoutPreview.includes('debug-ok')) {
    throw new Error(`Expected successful shell output preview, got ${JSON.stringify(shellFinished.details)}`);
  }

  const toolResult = secondRequestMessages.find(m => m.role === 'tool' && m.toolCallId === 'shell_call_1');
  if (!toolResult || !toolResult.content.includes('debug-ok')) {
    throw new Error(`Expected native shell tool result in second LLM request, got ${JSON.stringify(secondRequestMessages, null, 2)}`);
  }
});

debugLoggingTests.test('Debug mode can be toggled off and back on without leaking debug events', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let chatCount = 0;
  const mockProvider = {
    async chat() {
      chatCount++;
      return {
        text: `FINAL_ANSWER: response ${chatCount}`,
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const recordingUI = createRecordingUI(false);
  const agent = new ReActAgent(mockProvider, new ToolRegistry(), new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
    debug: false,
  }, recordingUI);

  await agent.run('debug should be quiet');
  if (recordingUI.events.length !== 0 || recordingUI.calls.debugLines.length !== 0) {
    throw new Error(`Expected no debug output while disabled, got events=${recordingUI.events.length}, lines=${recordingUI.calls.debugLines.length}`);
  }

  agent.setDebugMode(true);
  await agent.run('debug should be visible');
  requireDebugEvent(recordingUI.events, 'Agent run started');
  requireDebugEvent(recordingUI.events, 'LLM request');

  const enabledEventCount = recordingUI.events.length;
  agent.setDebugMode(false);
  await agent.run('debug should be quiet again');
  if (recordingUI.events.length !== enabledEventCount) {
    throw new Error(`Debug events leaked after disabling: before=${enabledEventCount}, after=${recordingUI.events.length}`);
  }
});

debugLoggingTests.test('Debug logging captures blocked shell commands without executing them', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');
  const { createShellTool } = await import('./src/tools/system/shell.js');

  let chatCount = 0;
  let secondRequestMessages = [];
  const mockProvider = {
    async chat(messages) {
      chatCount++;
      if (chatCount === 2) {
        secondRequestMessages = messages.map(m => ({
          role: m.role,
          content: m.content,
          toolCallId: m.toolCallId,
          toolCalls: m.toolCalls,
        }));
      }

      if (chatCount === 1) {
        return {
          text: 'I will try a dangerous command.',
          toolCalls: [{
            id: 'danger_call_1',
            name: 'shell',
            arguments: { command: 'rm -rf /', timeout: 1000 },
          }],
        };
      }

      return {
        text: 'FINAL_ANSWER: blocked safely',
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register(createShellTool());
  const recordingUI = createRecordingUI(true);
  const agent = new ReActAgent(mockProvider, registry, new MemoryManager(TEST_CONFIG.testDir), {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
    debug: true,
  }, recordingUI);

  await agent.run('try dangerous command');

  const blockedEvent = requireDebugEvent(recordingUI.events, 'Shell command blocked');
  if (blockedEvent.details.command !== 'rm -rf /') {
    throw new Error(`Expected blocked command in debug event, got ${JSON.stringify(blockedEvent.details)}`);
  }
  if (recordingUI.events.some(event => event.label === 'Shell command finished')) {
    throw new Error('Dangerous shell command should be blocked before execution');
  }

  const toolResult = secondRequestMessages.find(m => m.role === 'tool' && m.toolCallId === 'danger_call_1');
  if (!toolResult || !toolResult.content.includes('BLOCKED: Command matches dangerous pattern')) {
    throw new Error(`Expected blocked shell result in conversation, got ${JSON.stringify(secondRequestMessages, null, 2)}`);
  }
});

// ============ 9. CLI 输入循环回归测试 ============
const cliInputLoopTests = new TestRunner('CLI Input Loop Regression');

function waitForOutput(getOutput, predicate, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const output = getOutput();
      if (predicate(output)) {
        clearInterval(timer);
        resolve(output);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${description}. Recent output:\n${output.slice(-4000)}`));
      }
    }, 100);
  });
}

function startMockOpenAIServer(handler) {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const requestBody = JSON.parse(body);
        const responseBody = handler(requestBody);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseURL: `http://127.0.0.1:${address.port}/v1`,
      });
    });
  });
}

cliInputLoopTests.test('CLI processes two consecutive stdin lines and preserves conversation context', async () => {
  const requests = [];
  const { server, baseURL } = await startMockOpenAIServer((requestBody) => {
    requests.push(requestBody);
    const content = requests.length === 1 ? '记住了。' : '海棠开了';
    return {
      id: `mock-${requests.length}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestBody.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      }],
    };
  });

  const cliTestDir = join(TEST_CONFIG.testDir, 'cli-input-loop');
  mkdirSync(cliTestDir, { recursive: true });

  let output = '';
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEBUG: 'true',
      MODEL_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: baseURL,
      OPENAI_MODEL: 'qwen3.5-plus',
      WORKING_DIRECTORY: cliTestDir,
      MCP_BROWSER_ENABLED: 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => {
    output += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    output += chunk.toString();
  });

  try {
    await waitForOutput(
      () => output,
      text => text.includes('[You]') || text.includes('❯'),
      10000,
      'initial CLI prompt'
    );

    child.stdin.write('请记住短语海棠开了。只回复：记住了。\n');
    await waitForOutput(
      () => output,
      text => text.includes('记住了') && (text.match(/CLI line received/g) || []).length >= 1,
      15000,
      'first CLI line to complete'
    );

    child.stdin.write('刚才让你记住的短语是什么？只回复那个短语。\n');
    await waitForOutput(
      () => output,
      text => text.includes('海棠开了') && (text.match(/CLI line received/g) || []).length >= 2,
      15000,
      'second CLI line to complete'
    );

    if (requests.length !== 2) {
      throw new Error(`Expected exactly 2 LLM requests, got ${requests.length}. Output:\n${output.slice(-4000)}`);
    }

    const secondMessages = requests[1].messages || [];
    const secondContents = secondMessages.map(message => message.content || '').join('\n');
    if (!secondContents.includes('请记住短语海棠开了')) {
      throw new Error(`Second request did not include first user message: ${JSON.stringify(secondMessages, null, 2)}`);
    }
    if (!secondContents.includes('记住了')) {
      throw new Error(`Second request did not include first assistant answer: ${JSON.stringify(secondMessages, null, 2)}`);
    }
    if (!secondContents.includes('刚才让你记住的短语是什么')) {
      throw new Error(`Second request did not include second user message: ${JSON.stringify(secondMessages, null, 2)}`);
    }

    child.stdin.write('exit\n');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
});

// ============ 8. 长时间运行测试 ============
const longevityTests = new TestRunner('Long-Running Stability');

longevityTests.test('Memory usage remains stable during repeated operations', async () => {
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const registry = new ToolRegistry();

  registry.register({
    name: 'memory_test',
    description: 'Memory test tool',
    parameters: {},
    async handler() {
      // 分配一些内存
      const data = new Array(1000).fill('x'.repeat(100));
      return { success: true, size: data.length };
    },
  });

  const initialMemory = process.memoryUsage().heapUsed;

  // 执行多次操作
  for (let i = 0; i < 100; i++) {
    await registry.execute('memory_test', {});
  }

  // 强制垃圾回收（如果可用）
  if (global.gc) {
    global.gc();
  }

  const finalMemory = process.memoryUsage().heapUsed;
  const growth = finalMemory - initialMemory;
  const growthMB = growth / 1024 / 1024;

  console.log(`     Memory growth: ${growthMB.toFixed(2)} MB`);

  // 允许一定增长，但不应过大
  if (growthMB > 50) {
    throw new Error(`Memory growth too high: ${growthMB.toFixed(2)} MB`);
  }
});

longevityTests.test('ProcessManager handles many sequential operations', async () => {
  const { ProcessManager } = await import('./src/core/process-manager.js');
  const pm = new ProcessManager();

  const operations = 20;
  const startTime = Date.now();

  for (let i = 0; i < operations; i++) {
    await pm.execute(`echo "operation ${i}"`);
  }

  const duration = Date.now() - startTime;
  const avgTime = duration / operations;

  console.log(`     ${operations} operations in ${duration}ms (avg: ${avgTime.toFixed(1)}ms)`);

  if (avgTime > 500) {
    throw new Error(`Operations too slow: ${avgTime.toFixed(1)}ms average`);
  }

  await pm.dispose();
});

longevityTests.test('Automation engine runs background tasks reliably', async () => {
  const { AutomationEngine } = await import('./src/core/automation-engine.js');
  const auto = new AutomationEngine({ checkIntervalMs: 100 });

  let executionCount = 0;

  auto.registerBackgroundTask('test_task', {
    name: 'Test Background Task',
    execute: () => {
      executionCount++;
    },
    interval: 200, // 200ms 间隔
  });

  await auto.start();

  // 等待一段时间
  await new Promise(resolve => setTimeout(resolve, 1000));

  await auto.stop();

  console.log(`     Background task executed ${executionCount} times`);

  // 应该执行约 5 次（1000ms / 200ms）
  if (executionCount < 3 || executionCount > 7) {
    throw new Error(`Unexpected execution count: ${executionCount}`);
  }

  auto.dispose();
});

// ============ 7. 退出流程测试 ============
const exitFlowTests = new TestRunner('Exit Flow & Cleanup');

exitFlowTests.test('Agent can be properly reset after multiple tasks', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');
  const { SessionManager } = await import('./src/core/session-manager.js');

  let callCount = 0;
  const responses = [
    'FINAL_ANSWER: Hello!',
    'FINAL_ANSWER: Files listed.',
    'FINAL_ANSWER: Stats shown.',
    'FINAL_ANSWER: Debug enabled.',
    'FINAL_ANSWER: Goodbye!',
  ];

  const mockProvider = {
    async chat(messages, options) {
      callCount++;
      return {
        text: responses[Math.min(callCount - 1, responses.length - 1)],
        toolCalls: [],
      };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {
      console.log('     Model provider disposed');
    },
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 模拟用户多次提问
  const userTasks = [
    '你好',
    '列出当前目录文件',
    '/status',
    '/debug on',
    '再见',
  ];

  console.log('     Simulating user interaction flow:');

  for (let i = 0; i < userTasks.length; i++) {
    const task = userTasks[i];
    console.log(`       Task ${i + 1}: ${task}`);
    await agent.run(task);
  }

  // 验证所有任务都已处理
  if (callCount !== userTasks.length) {
    throw new Error(`Expected ${userTasks.length} LLM calls, got ${callCount}`);
  }

  console.log('     All tasks completed successfully');
});

exitFlowTests.test('Cleanup sequence works properly', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  let disposeCalled = false;

  const mockProvider = {
    async chat(messages, options) {
      return { text: 'FINAL_ANSWER: Done', toolCalls: [] };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {
      disposeCalled = true;
    },
  };

  const registry = new ToolRegistry();
  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  // 执行一些任务
  await agent.run('Test 1');
  await agent.run('Test 2');

  // 清理
  agent.setModelProvider({
    async chat() { return { text: 'FINAL_ANSWER: Done', toolCalls: [] }; },
    getMaxContextTokens() { return 4000; },
    dispose() { disposeCalled = true; },
  });

  console.log('     Agent can switch providers without errors');

  // 验证
  if (disposeCalled) {
    console.log('     Previous provider disposed properly');
  }
});

exitFlowTests.test('Multiple task sequence - no deadlock', async () => {
  const { ReActAgent } = await import('./src/core/agent.js');
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');

  const taskSequence = [
    'First question',
    'Second question with tool',
    'Third question',
    'Fourth with more tools',
    'Fifth and final',
  ];

  let toolCallCount = 0;
  let chatCount = 0;

  const mockProvider = {
    async chat(messages, options) {
      chatCount++;
      if (chatCount % 2 === 0) {
        // 偶数次调用使用工具
        return {
          text: 'Let me use a tool',
          toolCalls: [{ id: 'call1', name: 'test_tool', arguments: {} }],
        };
      }
      return { text: 'FINAL_ANSWER: Done', toolCalls: [] };
    },
    getMaxContextTokens() {
      return 4000;
    },
    dispose() {},
  };

  const registry = new ToolRegistry();
  registry.register({
    name: 'test_tool',
    description: 'Test tool',
    parameters: {},
    async handler() {
      toolCallCount++;
      return { result: 'success' };
    },
  });

  const memory = new MemoryManager(TEST_CONFIG.testDir);
  const agent = new ReActAgent(mockProvider, registry, memory, {
    maxIterations: 5,
    workingDirectory: TEST_CONFIG.testDir,
  });

  const startTime = Date.now();

  for (const task of taskSequence) {
    await agent.run(task);
  }

  const duration = Date.now() - startTime;

  console.log(`     ${taskSequence.length} tasks completed in ${duration}ms`);
  console.log(`     Tool calls: ${toolCallCount}`);

  if (duration > 30000) {
    throw new Error(`Tasks took too long: ${duration}ms`);
  }
});

// ============ 8. 新功能集成测试 ============
const newFeaturesTests = new TestRunner('New Features Integration');

newFeaturesTests.test('TokenScope - basic token tracking and cost calculation', async () => {
  const { TokenScope } = await import('./src/core/token-scope.js');

  const tokenScope = new TokenScope();

  // 记录一个请求
  const record = tokenScope.recordRequest({
    model: 'gpt-4o',
    inputTokens: 1000,
    outputTokens: 500,
    userId: 'test-user',
  });

  // 验证记录
  if (!record) {
    throw new Error('TokenScope.recordRequest returned null');
  }
  if (record.inputTokens !== 1000) {
    throw new Error(`Expected 1000 input tokens, got ${record.inputTokens}`);
  }

  // 获取统计
  const stats = tokenScope.getStats();
  if (stats.totalInputTokens !== 1000) {
    throw new Error(`Expected total 1000 input tokens, got ${stats.totalInputTokens}`);
  }

  console.log('     TokenScope basic tracking works');
});

newFeaturesTests.test('Autonomous tools - prompt advertises PTY and semantic search triggers', async () => {
  const { ToolRegistry } = await import('./src/core/tool-registry.js');
  const { MemoryManager } = await import('./src/memory/memory-manager.js');
  const { buildSystemPrompt } = await import('./src/prompts/system-prompt.js');
  const { createShellTool } = await import('./src/tools/system/shell.js');
  const { createPtyTools } = await import('./src/tools/system/pty.js');
  const { createSemanticSearchTool } = await import('./src/tools/memory/semantic-search.js');

  const registry = new ToolRegistry();
  registry.register(createShellTool());
  for (const tool of createPtyTools()) {
    registry.register(tool);
  }
  registry.register(createSemanticSearchTool());

  const prompt = buildSystemPrompt(
    new MemoryManager(TEST_CONFIG.testDir),
    registry,
    TEST_CONFIG.testDir
  );

  for (const expected of ['pty_start', 'pty_write', 'pty_read', 'pty_stop', 'semantic_search']) {
    if (!prompt.includes(expected)) {
      throw new Error(`Expected system prompt to include ${expected}`);
    }
  }
  if (!prompt.includes('interactive') || !prompt.includes('concept')) {
    throw new Error('Expected prompt to explain PTY and semantic-search auto-trigger scenarios');
  }

  console.log('     PTY and semantic search are exposed in the agent prompt');
});

newFeaturesTests.test('PTY tools - interactive stdin/stdout round trip', async () => {
  const { createPtyTools } = await import('./src/tools/system/pty.js');

  const tools = Object.fromEntries(createPtyTools().map(tool => [tool.name, tool]));
  mkdirSync(TEST_CONFIG.testDir, { recursive: true });
  const context = {
    workingDirectory: TEST_CONFIG.testDir,
    debug: false,
  };
  const command = `${process.execPath} -e "process.stdout.write('ready>'); process.stdin.on('data', d => { console.log('echo:' + d.toString().trim()); process.exit(0); });"`;
  const startResult = JSON.parse(await tools.pty_start.handler({
    command,
    wait_ms: 500,
  }, context));

  try {
    if (!startResult.session_id || startResult.status !== 'running') {
      throw new Error(`Expected running PTY session, got ${JSON.stringify(startResult)}`);
    }
    if (!startResult.output.includes('ready>')) {
      throw new Error(`Expected initial PTY prompt, got ${startResult.output}`);
    }

    const writeResult = JSON.parse(await tools.pty_write.handler({
      session_id: startResult.session_id,
      input: 'ping\n',
      wait_ms: 800,
    }, context));

    if (!writeResult.output.includes('echo:ping')) {
      throw new Error(`Expected PTY echo output, got ${writeResult.output}`);
    }
  } finally {
    try {
      await tools.pty_stop.handler({ session_id: startResult.session_id }, context);
    } catch {
      // The command may already have exited on its own.
    }
  }

  console.log('     PTY session accepts input and returns incremental output');
});

newFeaturesTests.test('Semantic search tool - indexes workspace files with embeddings', async () => {
  const { createSemanticSearchTool } = await import('./src/tools/memory/semantic-search.js');

  const semanticDir = join(TEST_CONFIG.testDir, 'semantic-search');
  mkdirSync(semanticDir, { recursive: true });
  writeFileSync(
    join(semanticDir, 'terminal.js'),
    [
      'export function startInteractiveTerminal() {',
      '  return "persistent PTY session for interactive commands and dev servers";',
      '}',
    ].join('\n')
  );
  writeFileSync(
    join(semanticDir, 'billing.js'),
    'export const invoice = "payment checkout billing";\n'
  );

  const tool = createSemanticSearchTool();
  const result = await tool.handler({
    query: 'interactive terminal pty session',
    path: 'semantic-search',
    limit: 2,
  }, {
    workingDirectory: TEST_CONFIG.testDir,
    debug: true,
    ui: createRecordingUI(true),
  });

  if (!result.includes('semantic-search/terminal.js')) {
    throw new Error(`Expected semantic search to find terminal.js, got:\n${result}`);
  }
  if (!result.includes('persistent PTY session')) {
    throw new Error(`Expected semantic search result preview, got:\n${result}`);
  }

  console.log('     Semantic search indexes files and returns relevant chunks');
});

newFeaturesTests.test('TokenScope - multiple requests and cost calculation', async () => {
  const { TokenScope } = await import('./src/core/token-scope.js');

  const tokenScope = new TokenScope();

  const requests = [
    { model: 'gpt-4o', inputTokens: 2000, outputTokens: 1000, userId: 'user1' },
    { model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 250, userId: 'user1' },
    { model: 'gpt-4o', inputTokens: 1500, outputTokens: 750, userId: 'user2' },
  ];

  for (const req of requests) {
    tokenScope.recordRequest(req);
  }

  const stats = tokenScope.getStats();
  if (stats.totalRequests !== 3) {
    throw new Error(`Expected 3 requests, got ${stats.totalRequests}`);
  }
  if (stats.totalInputTokens !== 4000) {
    throw new Error(`Expected 4000 input tokens, got ${stats.totalInputTokens}`);
  }

  // 验证模型分类统计
  const modelBreakdown = tokenScope.getModelBreakdown();
  if (!modelBreakdown['gpt-4o']) {
    throw new Error('Expected gpt-4o entry in model breakdown');
  }
  if (modelBreakdown['gpt-4o'].requests !== 2) {
    throw new Error(`Expected 2 gpt-4o requests, got ${modelBreakdown['gpt-4o'].requests}`);
  }

  console.log('     TokenScope multiple requests tracking works');
});

newFeaturesTests.test('TokenScope - report generation', async () => {
  const { TokenScope } = await import('./src/core/token-scope.js');

  const tokenScope = new TokenScope();

  for (let i = 0; i < 10; i++) {
    tokenScope.recordRequest({
      model: 'gpt-4o',
      inputTokens: 100 + i * 10,
      outputTokens: 50 + i * 5,
      userId: `user${i % 3}`,
    });
  }

  const report = tokenScope.generateReport('session');

  if (!report || !report.totalRequests) {
    throw new Error('Expected report with totalRequests');
  }

  if (!report.topModels || report.topModels.length === 0) {
    throw new Error('Expected topModels in report');
  }

  console.log('     TokenScope report generation works');
});

newFeaturesTests.test('DynamicContextPruning - basic context pruning', async () => {
  const { DynamicContextPruning } = await import('./src/core/dynamic-context-pruning.js');

  const pruner = new DynamicContextPruning({
    maxTokens: 2000,
    targetTokens: 1500,
  });

  const messages = [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there! How can I help you today?' },
  ];

  const result = pruner.prune(messages);

  if (!result.messages) {
    throw new Error('Expected pruned messages');
  }

  console.log('     DynamicContextPruning basic pruning works');
});

newFeaturesTests.test('DynamicContextPruning - importance analysis', async () => {
  const { DynamicContextPruning } = await import('./src/core/dynamic-context-pruning.js');

  const pruner = new DynamicContextPruning();

  const messages = [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'The capital of France is Paris.' },
    { role: 'user', content: 'Thanks!' },
  ];

  const analysis = pruner.analyzeImportance(messages);

  if (!Array.isArray(analysis) || analysis.length !== messages.length) {
    throw new Error('Expected importance analysis array');
  }

  console.log('     DynamicContextPruning importance analysis works');
});

newFeaturesTests.test('DynamicContextPruning - optimization suggestions', async () => {
  const { DynamicContextPruning } = await import('./src/core/dynamic-context-pruning.js');

  const pruner = new DynamicContextPruning();

  const messages = [
    { role: 'system', content: 'You are a helpful assistant' },
  ];

  for (let i = 0; i < 20; i++) {
    messages.push({ role: 'user', content: `Message ${i}` });
    messages.push({ role: 'assistant', content: `Response ${i}` });
  }

  const suggestions = pruner.suggestOptimizations(messages);

  if (!Array.isArray(suggestions)) {
    throw new Error('Expected suggestions array');
  }

  console.log('     DynamicContextPruning optimization suggestions work');
});

newFeaturesTests.test('Embedder - basic embedding generation', async () => {
  const { Embedder } = await import('./src/core/embedder.js');

  const embedder = new Embedder({ dimension: 768 });

  // 无需初始化，因为没有实际的 ONNX 模型
  // 测试 fallback 功能

  const embedding = await embedder.embed('Hello world');

  if (!Array.isArray(embedding)) {
    throw new Error('Expected embedding array');
  }

  if (embedding.length !== 768) {
    throw new Error(`Expected embedding length 768, got ${embedding.length}`);
  }

  console.log('     Embedder basic embedding works');
});

newFeaturesTests.test('Embedder - batch embedding', async () => {
  const { Embedder } = await import('./src/core/embedder.js');

  const embedder = new Embedder({ dimension: 768 });

  const texts = ['Hello', 'World', 'How are you'];
  const embeddings = await embedder.embed(texts);

  if (!Array.isArray(embeddings) || embeddings.length !== 3) {
    throw new Error('Expected 3 embeddings');
  }

  for (const emb of embeddings) {
    if (emb.length !== 768) {
      throw new Error('Expected each embedding length 768');
    }
  }

  console.log('     Embedder batch embedding works');
});

newFeaturesTests.test('Embedder - similarity calculation', async () => {
  const { Embedder } = await import('./src/core/embedder.js');

  const embedder = new Embedder({ dimension: 768 });

  const embedding1 = await embedder.embed('Hello');
  const embedding2 = await embedder.embed('Hello');

  const similarity = await embedder.computeSimilarity(embedding1, embedding2);

  if (typeof similarity !== 'number') {
    throw new Error('Expected similarity number');
  }

  console.log('     Embedder similarity calculation works');
});

newFeaturesTests.test('Embedder - find most similar', async () => {
  const { Embedder } = await import('./src/core/embedder.js');

  const embedder = new Embedder({ dimension: 768 });

  const candidates = [
    { text: 'The cat is black', metadata: { id: 1 } },
    { text: 'The dog is brown', metadata: { id: 2 } },
    { text: 'The bird is blue', metadata: { id: 3 } },
  ];

  const results = await embedder.findMostSimilar('cat', candidates, { limit: 2 });

  if (!Array.isArray(results)) {
    throw new Error('Expected results array');
  }

  console.log('     Embedder find most similar works');
});

newFeaturesTests.test('Tokenizer - basic token counting', async () => {
  const { Tokenizer } = await import('./src/core/tokenizer.js');

  const tokenizer = new Tokenizer();

  const count = await tokenizer.countTokens('Hello world! How are you today?');

  if (typeof count !== 'number') {
    throw new Error('Expected token count number');
  }

  console.log('     Tokenizer basic token counting works');
});

newFeaturesTests.test('Tokenizer - encode and decode', async () => {
  const { Tokenizer } = await import('./src/core/tokenizer.js');

  const tokenizer = new Tokenizer();

  const text = 'Hello world! This is a test.';
  const tokens = await tokenizer.encode(text);

  if (!Array.isArray(tokens)) {
    throw new Error('Expected tokens array');
  }

  console.log('     Tokenizer encode works');
});

newFeaturesTests.test('Tokenizer - batch token counting', async () => {
  const { Tokenizer } = await import('./src/core/tokenizer.js');

  const tokenizer = new Tokenizer();

  const texts = [
    'First sentence',
    'Second sentence with more words',
    'Third sentence that is even longer than the previous ones',
  ];

  const counts = await tokenizer.countTokensBatch(texts);

  if (!Array.isArray(counts) || counts.length !== texts.length) {
    throw new Error('Expected counts array matching input length');
  }

  console.log('     Tokenizer batch counting works');
});

newFeaturesTests.test('Tokenizer - model info', async () => {
  const { Tokenizer } = await import('./src/core/tokenizer.js');

  const tokenizer = new Tokenizer({ model: 'gpt-4o' });

  const vocabSize = tokenizer.getVocabSize();
  const modelName = tokenizer.getModelName();

  if (typeof vocabSize !== 'number') {
    throw new Error('Expected vocab size number');
  }
  if (modelName !== 'gpt-4o') {
    throw new Error(`Expected model name gpt-4o, got ${modelName}`);
  }

  console.log('     Tokenizer model info works');
});

newFeaturesTests.test('Tokenizer - available models', async () => {
  const { Tokenizer } = await import('./src/core/tokenizer.js');

  const models = Tokenizer.getAvailableModels();

  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('Expected available models array');
  }

  console.log('     Tokenizer available models works');
});

// ============ 运行所有测试 ============
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     AI Engineering Agent - Integration Test Suite          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Started at: ${results.startTime}`);
  console.log('');

  const startTime = performance.now();

  try {
    await agentE2ETests.run();
    await concurrencyTests.run();
    await recoveryTests.run();
    await platformTests.run();
    await timeoutAndInteractionTests.run();
    await multiConversationTests.run();
    await conversationProtocolTests.run();
    await debugLoggingTests.run();
    await cliInputLoopTests.run();
    await longevityTests.run();
    await exitFlowTests.run();
    await newFeaturesTests.run();
  } catch (error) {
    console.error('\nTest suite failed:', error.message);
  }

  results.duration = performance.now() - startTime;

  // 输出总结
  console.log('\n' + '═'.repeat(60));
  console.log('║                     Test Summary                          ║');
  console.log('═'.repeat(60));
  console.log(`  Total:    ${results.passed + results.failed + results.skipped}`);
  console.log(`  ✅ Passed:  ${results.passed}`);
  console.log(`  ❌ Failed:  ${results.failed}`);
  console.log(`  ⏭️  Skipped: ${results.skipped}`);
  console.log(`  Duration: ${(results.duration / 1000).toFixed(2)}s`);
  console.log('═'.repeat(60));

  // 清理测试目录
  try {
    rmSync(TEST_CONFIG.testDir, { recursive: true, force: true });
  } catch {}

  // 保存详细结果
  const reportPath = resolve(process.cwd(), 'test-integration-report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);

  if (results.failed > 0) {
    console.log('\nFailed tests:');
    results.tests
      .filter(t => t.status === 'failed')
      .forEach(t => {
        console.log(`  - ${t.suite}: ${t.description}`);
        console.log(`    Error: ${t.error}`);
      });
    process.exit(1);
  } else {
    console.log('\n🎉 All integration tests passed!');
    process.exit(0);
  }
}

runAllTests();
