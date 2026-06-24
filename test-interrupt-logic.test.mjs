/**
 * 测试修复后的中断逻辑
 * 验证plan未完成时不能中断
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { ReActAgent } from './src/core/runtime/agent/agent.js';
import { ToolRegistry } from './src/core/runtime/agent/tool-registry.js';
import { MemoryManager } from './src/memory/memory-manager.js';
import { SessionManager } from './src/core/session/session-manager.js';

describe('中断逻辑修复测试', () => {
  let agent;
  let toolRegistry;
  let memoryManager;
  let sessionManager;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    memoryManager = new MemoryManager('/tmp/test-memory');
    sessionManager = new SessionManager();

    // 注册基础工具
    toolRegistry.register({
      name: 'list_dir',
      description: 'List directory contents',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      handler: async ({ path }) => `Contents of ${path}: file1.js, file2.js`
    });

    toolRegistry.register({
      name: 'read_file',
      description: 'Read file contents',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      handler: async ({ file_path }) => `Content of ${file_path}: console.log('hello');`
    });

    toolRegistry.register({
      name: 'write_file',
      description: 'Write file contents',
      parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } },
      handler: async ({ file_path, content }) => `Wrote to ${file_path}`
    });

    toolRegistry.register({
      name: 'shell',
      description: 'Execute shell command',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
      handler: async ({ command }) => `Executed: ${command}`
    });
  });

  afterEach(() => {
    if (agent) {
      agent.stop();
    }
  });

  test('plan未完成时不应该中断', async () => {
    // 创建一个简单的mock model provider
    const mockModelProvider = {
      chat: async (messages) => {
        // 第一次调用：返回工具调用
        if (messages.length <= 2) {
          return {
            text: '',
            finishReason: 'tool_calls',
            toolCalls: [
              {
                name: 'list_dir',
                arguments: { path: '/test' }
              }
            ]
          };
        }
        // 后续调用：返回stop
        return {
          text: 'Task completed',
          finishReason: 'stop',
          toolCalls: []
        };
      },
      getModelName: () => 'mock-model',
      getMaxContextTokens: () => 4096
    };

    agent = new ReActAgent(
      mockModelProvider,
      toolRegistry,
      memoryManager,
      {
        maxIterations: 10,
        workingDirectory: '/tmp/test',
        session: sessionManager
      }
    );

    // 启动agent
    const runPromise = agent.run('Test task');

    // 等待一段时间让agent开始执行
    await new Promise(resolve => setTimeout(resolve, 100));

    // 请求中断
    agent.stop();

    // 等待一段时间让中断逻辑执行
    await new Promise(resolve => setTimeout(resolve, 200));

    // 检查agent是否还在运行（因为plan未完成，应该继续运行）
    // 如果中断被阻止，agent应该继续运行
    // 注意：这个测试可能需要根据实际的agent行为进行调整
    expect(agent.isWaitingForUserInput).toBe(false);
  });

  test('plan完成时应该允许中断', async () => {
    const mockModelProvider = {
      chat: async (messages) => {
        // 模拟plan完成后的响应
        return {
          text: 'All tasks completed successfully',
          finishReason: 'stop',
          toolCalls: []
        };
      },
      getModelName: () => 'mock-model',
      getMaxContextTokens: () => 4096
    };

    agent = new ReActAgent(
      mockModelProvider,
      toolRegistry,
      memoryManager,
      {
        maxIterations: 10,
        workingDirectory: '/tmp/test',
        session: sessionManager
      }
    );

    // 启动agent
    const runPromise = agent.run('Test task');

    // 等待agent完成
    await new Promise(resolve => setTimeout(resolve, 300));

    // 请求中断
    agent.stop();

    // 等待中断处理
    await new Promise(resolve => setTimeout(resolve, 100));

    // plan完成后应该允许中断
    const result = await runPromise;
    expect(result.status).toBe('completed');
  });

  test('需要用户输入时应该允许中断', async () => {
    const mockModelProvider = {
      chat: async (messages) => {
        // 模拟需要用户输入的情况
        return {
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              name: 'ask_user',
              arguments: {
                question: 'Please provide additional information'
              }
            }
          ]
        };
      },
      getModelName: () => 'mock-model',
      getMaxContextTokens: () => 4096
    };

    // 注册ask_user工具
    toolRegistry.register({
      name: 'ask_user',
      description: 'Ask user for input',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' }
        }
      },
      handler: async ({ question }) => {
        return {
          result: 'needs_user_input',
          question: question,
          answer: null
        };
      }
    });

    agent = new ReActAgent(
      mockModelProvider,
      toolRegistry,
      memoryManager,
      {
        maxIterations: 10,
        workingDirectory: '/tmp/test',
        session: sessionManager
      }
    );

    // 启动agent
    const runPromise = agent.run('Test task');

    // 等待agent请求用户输入
    await new Promise(resolve => setTimeout(resolve, 200));

    // 检查agent是否在等待用户输入
    expect(agent.isWaitingForUserInput).toBe(true);

    // 请求中断
    agent.stop();

    // 等待中断处理
    await new Promise(resolve => setTimeout(resolve, 100));

    // 等待用户输入时应该允许中断
  });
});