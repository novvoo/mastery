/**
 * 工具调用调试脚本 - 从 LLM 响应到工具执行的完整追踪
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { bootstrapRuntime } from '../../src/core/runtime-bootstrap.js';
import { createAgentEngine } from '../../src/core/agent-engine.js';

const tmpDir = join(tmpdir(), 'agent-debug-tool-calls');
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

console.log('工作目录:', tmpDir);
console.log('');

// ======== 模拟 model provider：直接返回工具调用 ========
// 测试1：返回简化格式的 tool calls
const fakeModelProviderSimple = {
  chat: async () => ({
    text: '',
    toolCalls: [{ name: 'write_file', arguments: { path: 'test1.txt', content: 'Hello from simple format!' } }],
    finishReason: 'tool_calls',
  }),
  chatStream: async () => null,  // 返回 null，应回退到 chat()
  getModelName: () => 'fake-simple',
};

// 测试2：返回 OpenAI 原生格式的 tool calls
const fakeModelProviderNative = {
  chat: async () => ({
    text: '',
    toolCalls: [{
      id: 'call_abc',
      type: 'function',
      function: { name: 'write_file', arguments: '{"path": "test2.txt", "content": "Hello from native format!"}' },
    }],
    finishReason: 'tool_calls',
  }),
  chatStream: async () => null,
  getModelName: () => 'fake-native',
};

// 测试3：流式返回 + tool calls（有 chatStream）
const fakeModelProviderStreaming = {
  chat: async () => ({
    text: '',
    toolCalls: [{ name: 'write_file', arguments: { path: 'test3.txt', content: 'Hello from streaming fallback!' } }],
    finishReason: 'tool_calls',
  }),
  chatStream: async () => ({
    stream: async function* () {
      yield { type: 'tool_call_delta', index: 0, name: 'write_file' };
      yield { type: 'tool_call_delta', index: 0, arguments: '{"path": ' };
      yield { type: 'tool_call_delta', index: 0, arguments: '"test3.txt", ' };
      yield { type: 'tool_call_delta', index: 0, arguments: '"content": "Hello from streaming!"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    },
    finalize: async () => ({
      text: '',
      toolCalls: [{ name: 'write_file', arguments: { path: 'test3.txt', content: 'Hello from streaming finalize!' } }],
      finishReason: 'tool_calls',
    }),
    abort: () => {},
  }),
  getModelName: () => 'fake-streaming',
};

async function runTest(name, modelProvider, expectedFile) {
  console.log(`\n========== ${name} ==========`);
  const testDir = join(tmpDir, name.replace(/\s+/g, '-'));
  mkdirSync(testDir, { recursive: true });

  const toolCallEvents = [];

  const engine = createAgentEngine({
    modelProvider,
    toolRegistry: (await import('../../src/core/runtime-bootstrap.js'))
      .createDefaultToolRegistry({ workingDirectory: testDir }),
    config: {
      workingDirectory: testDir,
      maxIterations: 5,
      debug: true,
      toolResultCacheEnabled: false,
    },
    ui: {
      toolCall: (name, args) => {
        console.log(`[UI toolCall] ${name}:`, JSON.stringify(args));
        toolCallEvents.push({ type: 'toolCall', name, args });
      },
      toolResult: (name, result) => {
        console.log(`[UI toolResult] ${name}:`, String(result).substring(0, 100));
        toolCallEvents.push({ type: 'toolResult', name, result });
      },
      toolError: (name, error) => {
        console.log(`[UI toolError] ${name}:`, error);
        toolCallEvents.push({ type: 'toolError', name, error });
      },
      iteration: (i, max) => console.log(`[UI iteration] ${i}/${max}`),
      finalAnswer: (a) => console.log(`[UI finalAnswer]`, String(a).substring(0, 200)),
      warn: (m) => console.log(`[UI warn]`, m),
      debug: (m) => console.log(`[UI debug]`, String(m).substring(0, 150)),
      debugEvent: (name, data) => {
        const short = data ? JSON.stringify(data).substring(0, 150) : '';
        if (name.includes('tool') || name.includes('Tool') || name.includes('LLM')) {
          console.log(`[UI debugEvent] ${name}`, short);
        }
      },
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallDelta: () => {},
    },
  });

  try {
    await engine.run('创建测试文件');
  } catch (e) {
    console.log('引擎异常:', e.message);
  }

  const targetFile = join(testDir, expectedFile);
  console.log(`\n文件 ${expectedFile} 存在:`, existsSync(targetFile));
  return {
    testName: name,
    fileExists: existsSync(targetFile),
    toolCallCount: toolCallEvents.filter(e => e.type === 'toolCall').length,
    toolResultCount: toolCallEvents.filter(e => e.type === 'toolResult').length,
    toolErrorCount: toolCallEvents.filter(e => e.type === 'toolError').length,
  };
}

async function main() {
  const results = [];

  results.push(await runTest(
    '测试1：简化格式 tool calls + 无 streaming',
    fakeModelProviderSimple,
    'test1.txt'
  ));

  results.push(await runTest(
    '测试2：OpenAI 原生格式 tool calls',
    fakeModelProviderNative,
    'test2.txt'
  ));

  results.push(await runTest(
    '测试3：流式返回（streaming 分支）',
    fakeModelProviderStreaming,
    'test3.txt'
  ));

  console.log('\n\n========== 总结 ==========');
  console.table(results);
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
