// 测试 normalizeModelResponse 对各种 tool call 格式的处理
import { createAgentEngine } from '../../src/core/runtime/agent/agent-engine.js';
import { createDefaultToolRegistry } from '../../src/core/runtime/runtime-bootstrap.js';
import { ToolExecutor } from '../../src/core/runtime/agent/tool-executor.js';

const tmpDir = process.cwd() + '/tmp-test-normalize';

// 手动测试 normalizeModelResponse 的逻辑
// 直接复制 normalizeModelResponse 函数进行测试
function normalizeModelResponse(response = {}) {
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

// 测试用例
const testCases = [
  {
    name: '简化格式 tool calls',
    response: {
      text: '',
      toolCalls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'hi' } }],
      finishReason: 'tool_calls',
    },
  },
  {
    name: 'OpenAI 原生格式 tool calls',
    response: {
      text: '',
      tool_calls: [{
        id: 'call_123',
        type: 'function',
        function: { name: 'write_file', arguments: '{"path":"b.txt","content":"hello"}' }
      }],
      finish_reason: 'tool_calls',
    },
  },
  {
    name: 'OpenAI chat() 返回格式 (有 text 字段)',
    response: {
      text: '',
      toolCalls: [{
        id: 'call_456',
        type: 'function',
        function: { name: 'write_file', arguments: '{"path":"c.txt","content":"world"}' }
      }],
      finishReason: 'tool_calls',
    },
  },
  {
    name: '有 reasoning content 的格式',
    response: {
      text: '',
      reasoning: { text: '我来分析一下' },
      toolCalls: [{ name: 'list_dir', arguments: {} }],
      finishReason: 'tool_calls',
    },
  },
  {
    name: '没有 tool calls 但有 finishReason',
    response: {
      text: '这是最终答案',
      finishReason: 'stop',
    },
  },
];

console.log('=== 测试 normalizeModelResponse ===\n');
for (const tc of testCases) {
  const normalized = normalizeModelResponse(tc.response);
  console.log(`[${tc.name}]`);
  console.log('  toolCalls.length:', normalized.toolCalls.length);
  console.log('  toolCalls:', JSON.stringify(normalized.toolCalls, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  console.log('  finishReason:', normalized.finishReason);
  console.log('  text:', JSON.stringify(normalized.text));
  console.log('');
}

// 现在测试 ToolExecutor 对不同格式 tool call 的 normalize
console.log('=== 测试 ToolExecutor normalizeToolCall ===\n');

const registry = createDefaultToolRegistry({ workingDirectory: tmpDir });

const executor = new ToolExecutor({
  toolRegistry: registry,
  textToolParser: null,
  ui: {
    toolCall: (name, args) => console.log(`[UI toolCall] ${name}:`, JSON.stringify(args)),
    toolResult: (name, result) => console.log(`[UI toolResult] ${name}:`, String(result)),
    toolError: (name, error) => console.log(`[UI toolError] ${name}:`, error),
    warn: (m) => console.log(`[UI warn]`, m),
    debug: () => {},
  },
  config: { workingDirectory: tmpDir, debug: true, toolResultCacheEnabled: false },
});

// 测试各种 tool call 格式
const toolCallFormats = [
  { name: '简化格式', call: { name: 'write_file', arguments: { path: 'f1.txt', content: 'from simplified' } } },
  { name: 'OpenAI 原生格式', call: { id: '1', type: 'function', function: { name: 'write_file', arguments: '{"path":"f2.txt","content":"from native"}' } } },
  { name: '混合格式 - 简化格式但有 id', call: { id: '2', name: 'write_file', arguments: { path: 'f3.txt', content: 'from mixed' } } },
  { name: '只有 name 没有 arguments', call: { name: 'list_dir' } },
];

(async () => {
  for (const { name, call } of toolCallFormats) {
    console.log(`\n--- ${name} ---`);
    try {
      const result = await executor.execute(call, {}, {
        resultMode: 'tool',
        emitObservation: () => {},
      });
      console.log('  执行成功:', result);
    } catch (e) {
      console.log('  执行异常:', e.message);
    }
  }
  console.log('\n=== 全部完成 ===');
})();
