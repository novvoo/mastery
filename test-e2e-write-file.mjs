
// 端到端测试：模拟 agent-engine 流程，验证 write_file 能否真实写文件
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createAgentEngine } from './src/core/runtime/agent/agent-engine.js';
import { ToolRegistry } from './src/core/runtime/agent/tool-registry.js';
import { createFileSystemTools } from './src/tools/filesystem/filesystem-tools.js';

// 准备临时目录
const tmpDir = join(process.cwd(), '.test-e2e-write-file');
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

// 准备工具注册表
const toolRegistry = new ToolRegistry();
for (const tool of createFileSystemTools()) {
  toolRegistry.register(tool);
}

// 准备 mock modelProvider，让它输出一个 write_file tool_call
const firstCall = {
  text: '',
  finishReason: 'tool_calls',
  toolCalls: [{
    id: 'call-1',
    name: 'write_file',
    arguments: { path: 'hello.txt', content: 'Hello from agent-engine!' },
  }],
};

const secondCall = {
  text: 'FINAL_ANSWER: 文件已创建。',
  finishReason: 'stop',
  toolCalls: [],
};

let callCount = 0;
const modelProvider = {
  chat: async (messages, opts) => {
    callCount++;
    console.log(`[mock-chat] #${callCount} 被调用，messages=${messages.length}, functions=${opts?.functions?.length || 0}`);
    if (callCount === 1) return firstCall;
    return secondCall;
  },
  getModelName: () => 'mock',
};

// UI 回调，打印进度
const ui = {
  toolCall: (name, args) => console.log(`[ui] 调用工具: ${name}`, args),
  toolResult: (name, result) => console.log(`[ui] 工具完成: ${name} -> ${String(result).substring(0, 120)}`),
  toolError: (name, err) => console.log(`[ui] 工具错误: ${name} -> ${err}`),
  iteration: (i, max) => console.log(`[ui] 迭代: ${i}/${max}`),
  finalAnswer: (ans) => console.log(`[ui] 最终答案: ${ans.substring(0, 200)}`),
  warn: (m) => console.log(`[ui-warn] ${m}`),
  debug: (m) => console.log(`[ui-debug] ${m}`),
  debugEvent: (label, data) => console.log(`[ui-event] ${label}:`, JSON.stringify(data).substring(0, 120)),
  onTextDelta: (t) => {},
  onReasoningDelta: (t) => {},
  onToolCallDelta: (d) => {},
};

const engine = createAgentEngine({
  modelProvider,
  toolRegistry,
  config: { workingDirectory: tmpDir, maxIterations: 10 },
  ui,
});

console.log('=== 启动 agent-engine run() ===');
const result = await engine.run('创建一个文件 hello.txt');
console.log('=== 引擎完成 ===');
console.log('result:', { ...result, toolEvents: result.toolEvents?.length });

// 验证文件是否真正写入磁盘
const targetFile = join(tmpDir, 'hello.txt');
console.log('\n=== 验证 ===');
console.log('文件存在?', existsSync(targetFile));
if (existsSync(targetFile)) {
  console.log('文件内容:', readFileSync(targetFile, 'utf-8'));
} else {
  console.log('❌ 失败：文件没有被创建！');
  console.log('目录列表:', listDir(tmpDir));
}

// 清理
rmSync(tmpDir, { recursive: true, force: true });

function listDir(dir) {
  try {
    const fs = require('fs');
    return fs.readdirSync(dir);
  } catch { return []; }
}
