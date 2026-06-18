// 分层验证工具调用流程
import { createAgentEngine } from '../src/core/agent-engine.js';
import { createDefaultToolRegistry } from '../src/core/runtime-bootstrap.js';
import { ToolExecutor } from '../src/core/tool-executor.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const tmpDir = process.cwd() + '/tmp-debug-tool-calls';
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// === 第 1 层：验证 normalizeModelResponse ===
console.log('=== 第 1 层：normalizeModelResponse ===\n');

// 通过间接方式测试 —— 用一个 mock model provider 触发响应
// 直接手动模拟各层：

// --- 测试 OpenAI 原生 tool_calls 格式 ---
const openaiNativeFormat = {
  text: '',
  tool_calls: [
    {
      id: 'call_abc',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({ path: tmpDir + '/layer1-native.txt', content: 'hello from native format' })
      }
    }
  ],
  finish_reason: 'tool_calls'
};

console.log('OpenAI 原生格式 tool_calls:');
console.log('  字段:', Object.keys(openaiNativeFormat));
console.log('  tool_calls[0]:', JSON.stringify(openaiNativeFormat.tool_calls[0], null, 2));

// normalizeModelResponse 实际在 src/core/agent-engine.js:81-97
// 我们重新模拟它的行为
function simulateNormalize(response = {}) {
  const text = typeof response.text === 'string'
    ? response.text
    : typeof response.content === 'string'
      ? response.content
      : typeof response.answer === 'string'
        ? response.answer
        : '';
  return {
    ...response,
    text,
    content: typeof response.content === 'string' ? response.content : text,
    toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
    finishReason: response.finishReason || response.finish_reason || 'stop',
  };
}

console.log('\n--- 使用 tool_calls (snake_case) 字段 ---');
let normalized = simulateNormalize(openaiNativeFormat);
console.log('  normalized.toolCalls.length =', normalized.toolCalls.length);
console.log('  normalized.toolCalls =', JSON.stringify(normalized.toolCalls, null, 2));

console.log('\n--- 使用 toolCalls (camelCase) 字段（简化格式） ---');
const simplifiedFormat = {
  text: '',
  toolCalls: [{ name: 'write_file', arguments: { path: tmpDir + '/layer1-simple.txt', content: 'hello' } }],
  finishReason: 'tool_calls'
};
normalized = simulateNormalize(simplifiedFormat);
console.log('  normalized.toolCalls.length =', normalized.toolCalls.length);
console.log('  normalized.toolCalls =', JSON.stringify(normalized.toolCalls, null, 2));

console.log('\n--- 使用 toolCalls (camelCase) 字段（OpenAI 原生格式） ---');
const mixedFormat = {
  text: '',
  toolCalls: [
    {
      id: 'call_abc',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({ path: tmpDir + '/layer1-mixed.txt', content: 'hello' })
      }
    }
  ],
  finishReason: 'tool_calls'
};
normalized = simulateNormalize(mixedFormat);
console.log('  normalized.toolCalls.length =', normalized.toolCalls.length);
console.log('  normalized.toolCalls =', JSON.stringify(normalized.toolCalls, null, 2));

// === 第 2 层：验证 ToolExecutor.normalizeToolCall ===
console.log('\n=== 第 2 层：ToolExecutor normalizeToolCall ===\n');

const registry = createDefaultToolRegistry({ workingDirectory: tmpDir });
console.log('registry 中 tool 数量:', registry.size);
console.log('registry 中的工具:', registry.getAll().map(t => t.name).slice(0, 10));

const executor = new ToolExecutor({
  toolRegistry: registry,
  textToolParser: null,
  ui: {
    toolCall: (name, args) => console.log(`[UI toolCall] ${name}:`, JSON.stringify(args).substring(0, 80)),
    toolResult: (name, result) => console.log(`[UI toolResult] ${name}:`, String(result).substring(0, 120)),
    toolError: (name, error) => console.log(`[UI toolError] ${name}:`, error),
    warn: (m) => console.log(`[UI warn]`, m),
    debug: () => {},
  },
  config: { workingDirectory: tmpDir, debug: true, toolResultCacheEnabled: false },
});

// 测试 3 种不同格式的 tool call
const toolCallFormats = [
  {
    name: '简化格式 { name, arguments }',
    call: { name: 'write_file', arguments: { path: tmpDir + '/fmt1.txt', content: 'from simplified format' } }
  },
  {
    name: 'OpenAI 原生格式 { id, type, function: { name, arguments } }',
    call: {
      id: 'call_1',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({ path: tmpDir + '/fmt2.txt', content: 'from native format' })
      }
    }
  },
  {
    name: '简化格式 + string arguments',
    call: { name: 'write_file', arguments: JSON.stringify({ path: tmpDir + '/fmt3.txt', content: 'from string args' }) }
  },
];

for (const { name, call } of toolCallFormats) {
  console.log(`\n--- ${name} ---`);
  console.log('  输入 call:', JSON.stringify(call).substring(0, 200));
  try {
    const result = await executor.execute(call, {}, {
      resultMode: 'tool',
      emitObservation: () => {},
    });
    console.log('  执行成功 ✓, result:', JSON.stringify(result).substring(0, 200));
  } catch (e) {
    console.log('  执行异常 ✗:', e.message);
  }
}

// === 第 3 层：端到端 AgentEngine 测试 ===
console.log('\n=== 第 3 层：AgentEngine 端到端测试 ===\n');

// 测试 1：返回简化格式 tool calls（和之前 debug 脚本一致）
const fakeModelProviderSimple = {
  chat: async () => ({
    text: '',
    toolCalls: [{ name: 'write_file', arguments: { path: tmpDir + '/end2end-simple.txt', content: '✓ end2end simple format works' } }],
    finishReason: 'tool_calls',
  }),
  chatStream: async () => null,
  getModelName: () => 'fake-simple',
};

const engine1 = createAgentEngine({
  modelProvider: fakeModelProviderSimple,
  toolRegistry: createDefaultToolRegistry({ workingDirectory: tmpDir }),
  memoryManager: null,
  config: {
    workingDirectory: tmpDir,
    maxIterations: 30,
    debug: true,
    toolResultCacheEnabled: false,
  },
  ui: {
    toolCall: (name, args) => console.log(`[engine.ui toolCall] ${name}`),
    toolResult: (name, result) => console.log(`[engine.ui toolResult] ${name}:`, typeof result === 'string' ? result.substring(0, 60) : JSON.stringify(result).substring(0, 60)),
    toolError: (name, err) => console.log(`[engine.ui toolError] ${name}:`, err),
    iteration: () => {},
    finalAnswer: (ans) => console.log(`[engine.ui finalAnswer] ${String(ans).substring(0, 100)}`),
    warn: (m) => console.log(`[engine.ui warn]`, m),
    debug: () => {},
    debugEvent: (name, data) => {
      if (name === 'Tool calls detected') console.log(`[engine.ui debugEvent] ${name}:`, JSON.stringify(data).substring(0, 300));
    },
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCallDelta: () => {},
  },
});

try {
  await engine1.run('请创建一个文件，内容为 hello world');
  console.log('\n✓ 测试 1 完成');
} catch (e) {
  console.log('\n✗ 测试 1 异常:', e.message);
  console.log(e.stack);
}

// 测试 2：返回 OpenAI 原生格式 tool_calls
const fakeModelProviderNative = {
  chat: async () => ({
    text: '',
    tool_calls: [
      {
        id: 'call_native_1',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: tmpDir + '/end2end-native.txt', content: '✓ end2end native format works' })
        }
      }
    ],
    finish_reason: 'tool_calls',
  }),
  chatStream: async () => null,
  getModelName: () => 'fake-native',
};

const engine2 = createAgentEngine({
  modelProvider: fakeModelProviderNative,
  toolRegistry: createDefaultToolRegistry({ workingDirectory: tmpDir }),
  memoryManager: null,
  config: {
    workingDirectory: tmpDir,
    maxIterations: 30,
    debug: true,
    toolResultCacheEnabled: false,
  },
  ui: {
    toolCall: (name, args) => console.log(`[engine2.ui toolCall] ${name}`),
    toolResult: (name, result) => console.log(`[engine2.ui toolResult] ${name}:`, typeof result === 'string' ? result.substring(0, 60) : JSON.stringify(result).substring(0, 60)),
    toolError: (name, err) => console.log(`[engine2.ui toolError] ${name}:`, err),
    iteration: () => {},
    finalAnswer: (ans) => console.log(`[engine2.ui finalAnswer] ${String(ans).substring(0, 100)}`),
    warn: (m) => console.log(`[engine2.ui warn]`, m),
    debug: () => {},
    debugEvent: (name, data) => {
      if (name === 'Tool calls detected') console.log(`[engine2.ui debugEvent] ${name}:`, JSON.stringify(data).substring(0, 300));
    },
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCallDelta: () => {},
  },
});

try {
  await engine2.run('请创建一个文件，内容为 hello world');
  console.log('\n✓ 测试 2 完成');
} catch (e) {
  console.log('\n✗ 测试 2 异常:', e.message);
  console.log(e.stack);
}

// 测试 3：混合格式（chat() 返回 toolCalls，内部用 OpenAI 原生对象）
const fakeModelProviderMixed = {
  chat: async () => ({
    text: '',
    toolCalls: [
      {
        id: 'call_mixed_1',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: tmpDir + '/end2end-mixed.txt', content: '✓ end2end mixed format works' })
        }
      }
    ],
    finishReason: 'tool_calls',
  }),
  chatStream: async () => null,
  getModelName: () => 'fake-mixed',
};

const engine3 = createAgentEngine({
  modelProvider: fakeModelProviderMixed,
  toolRegistry: createDefaultToolRegistry({ workingDirectory: tmpDir }),
  memoryManager: null,
  config: {
    workingDirectory: tmpDir,
    maxIterations: 30,
    debug: true,
    toolResultCacheEnabled: false,
  },
  ui: {
    toolCall: (name, args) => console.log(`[engine3.ui toolCall] ${name}`),
    toolResult: (name, result) => console.log(`[engine3.ui toolResult] ${name}:`, typeof result === 'string' ? result.substring(0, 60) : JSON.stringify(result).substring(0, 60)),
    toolError: (name, err) => console.log(`[engine3.ui toolError] ${name}:`, err),
    iteration: () => {},
    finalAnswer: (ans) => console.log(`[engine3.ui finalAnswer] ${String(ans).substring(0, 100)}`),
    warn: (m) => console.log(`[engine3.ui warn]`, m),
    debug: () => {},
    debugEvent: (name, data) => {
      if (name === 'Tool calls detected') console.log(`[engine3.ui debugEvent] ${name}:`, JSON.stringify(data).substring(0, 300));
    },
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCallDelta: () => {},
  },
});

try {
  await engine3.run('请创建一个文件，内容为 hello world');
  console.log('\n✓ 测试 3 完成');
} catch (e) {
  console.log('\n✗ 测试 3 异常:', e.message);
  console.log(e.stack);
}

// === 验证：检查文件是否被写入 ===
console.log('\n=== 验证：文件系统检查 ===\n');
const expectedFiles = [
  tmpDir + '/end2end-simple.txt',
  tmpDir + '/end2end-native.txt',
  tmpDir + '/end2end-mixed.txt',
];

for (const f of expectedFiles) {
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, 'utf8');
    console.log(`✓ ${path.basename(f)} 存在，内容: "${content}"`);
  } else {
    console.log(`✗ ${path.basename(f)} 不存在！`);
  }
}

console.log('\n=== 调试完成 ===');
