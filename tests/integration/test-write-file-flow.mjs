// 验证文件写入流程的端到端测试脚本
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAgentEngine } from '../../src/core/runtime/agent/agent-engine.js';
import { createDefaultToolRegistry } from '../../src/core/runtime/runtime-bootstrap.js';
import { createFileSystemTools } from '../../src/tools/filesystem/filesystem-tools.js';
import { ToolExecutor } from '../../src/core/runtime/agent/tool-executor.js';
import { ToolRegistry } from '../../src/core/runtime/agent/tool-registry.js';

// 测试阶段 1：直接测试 write_file handler
async function testDirectHandler() {
  console.log('\n=== 测试 1：直接测试 write_file handler ===');
  const tmpDir = join(tmpdir(), 'agent-test-write-1');
  if (existsSync(tmpDir)) {rmSync(tmpDir, { recursive: true, force: true });}
  mkdirSync(tmpDir, { recursive: true });

  const tools = createFileSystemTools();
  const writeFileTool = tools.find(t => t.name === 'write_file');
  console.log('write_file 工具是否存在:', !!writeFileTool);
  console.log('write_file 是否有 handler:', typeof writeFileTool?.handler === 'function');
  console.log('write_file params:', Object.keys(writeFileTool?.params || {}));
  console.log('write_file required:', writeFileTool?.required);

  const result = await writeFileTool.handler(
    { path: 'test1.txt', content: 'Hello World!' },
    { workingDirectory: tmpDir }
  );
  console.log('handler 返回:', result);

  const targetFile = join(tmpDir, 'test1.txt');
  console.log('文件存在:', existsSync(targetFile));
  if (existsSync(targetFile)) {
    console.log('文件内容:', readFileSync(targetFile, 'utf-8'));
  }
}

// 测试阶段 2：通过 ToolRegistry.execute 调用
async function testToolRegistry() {
  console.log('\n=== 测试 2：通过 ToolRegistry 调用 ===');
  const tmpDir = join(tmpdir(), 'agent-test-write-2');
  if (existsSync(tmpDir)) {rmSync(tmpDir, { recursive: true, force: true });}
  mkdirSync(tmpDir, { recursive: true });

  const registry = new ToolRegistry();
  const tools = createFileSystemTools();
  for (const tool of tools) {registry.register(tool);}
  console.log('已注册工具数:', registry.size);
  console.log('write_file 在注册表中:', registry.has('write_file'));

  const tool = registry.get('write_file');
  console.log('获取 write_file:', !!tool);
  console.log('tool.handler 类型:', typeof tool?.handler);

  try {
    const result = await registry.execute('write_file',
      { path: 'test2.txt', content: 'From ToolRegistry!' },
      { workingDirectory: tmpDir }
    );
    console.log('execute 返回:', result);

    const targetFile = join(tmpDir, 'test2.txt');
    console.log('文件存在:', existsSync(targetFile));
    if (existsSync(targetFile)) {
      console.log('文件内容:', readFileSync(targetFile, 'utf-8'));
    }
  } catch (e) {
    console.log('错误:', e.message);
  }
}

// 测试阶段 3：通过 ToolExecutor 调用
async function testToolExecutor() {
  console.log('\n=== 测试 3：通过 ToolExecutor 调用 ===');
  const tmpDir = join(tmpdir(), 'agent-test-write-3');
  if (existsSync(tmpDir)) {rmSync(tmpDir, { recursive: true, force: true });}
  mkdirSync(tmpDir, { recursive: true });

  const registry = new ToolRegistry();
  const tools = createFileSystemTools();
  for (const tool of tools) {registry.register(tool);}

  const executor = new ToolExecutor({
    toolRegistry: registry,
    textToolParser: null,
    ui: {
      toolCall: (name, args) => console.log(`[toolCall] ${name}:`, JSON.stringify(args)),
      toolResult: (name, result) => console.log(`[toolResult] ${name}:`, result),
      toolError: (name, error) => console.log(`[toolError] ${name}:`, error),
      warn: (msg) => console.log('[warn]', msg),
      debug: (msg) => console.log('[debug]', msg),
    },
    config: { workingDirectory: tmpDir, debug: true },
  });

  const result = await executor.execute(
    { name: 'write_file', arguments: { path: 'test3.txt', content: 'From ToolExecutor!' } },
    {},
    { resultMode: 'tool', emitObservation: (id, name, obs) => console.log(`[observation] ${name}:`, obs) }
  );
  console.log('executor.execute 返回:', result);

  const targetFile = join(tmpDir, 'test3.txt');
  console.log('文件存在:', existsSync(targetFile));
  if (existsSync(targetFile)) {
    console.log('文件内容:', readFileSync(targetFile, 'utf-8'));
  }
}

// 测试阶段 4：模拟 AgentEngine 中的工具调用流程
async function testAgentEngineFlow() {
  console.log('\n=== 测试 4：AgentEngine 工具调用流程 ===');
  const tmpDir = join(tmpdir(), 'agent-test-write-4');
  if (existsSync(tmpDir)) {rmSync(tmpDir, { recursive: true, force: true });}
  mkdirSync(tmpDir, { recursive: true });

  // 模拟一个 model provider 直接返回 tool call
  const fakeModelProvider = {
    async chat() {
      return {
        text: '',
        toolCalls: [{ id: 'test-call-1', name: 'write_file', arguments: { path: 'test4.txt', content: 'Hello from AgentEngine!' } }],
        finishReason: 'tool_calls',
      };
    },
    chatStream() { return null; },
    getModelName() { return 'fake'; },
  };

  const engine = createAgentEngine({
    modelProvider: fakeModelProvider,
    toolRegistry: createDefaultToolRegistry({ workingDirectory: tmpDir }),
    config: {
      workingDirectory: tmpDir,
      maxIterations: 10,
      debug: true,
    },
    ui: {
      toolCall: (name, args) => console.log(`[UI toolCall] ${name}:`, JSON.stringify(args)),
      toolResult: (name, result) => console.log(`[UI toolResult] ${name}:`, result),
      toolError: (name, error) => console.log(`[UI toolError] ${name}:`, error),
      iteration: (i, max) => console.log(`[UI iteration] ${i}/${max}`),
      finalAnswer: (a) => console.log(`[UI finalAnswer]`, a),
      warn: (m) => console.log(`[UI warn]`, m),
      debug: (m) => console.log(`[UI debug]`, m),
      debugEvent: (name, data) => console.log(`[UI debugEvent] ${name}`, data ? JSON.stringify(data).substring(0, 200) : ''),
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallDelta: () => {},
    },
  });

  try {
    const result = await engine.run('请创建文件 test4.txt');
    console.log('engine.run 返回:', JSON.stringify(result).substring(0, 300));
  } catch (e) {
    console.log('engine.run 错误:', e.message);
    console.log('错误栈:', e.stack?.substring(0, 400));
  }

  const targetFile = join(tmpDir, 'test4.txt');
  console.log('文件存在:', existsSync(targetFile));
  if (existsSync(targetFile)) {
    console.log('文件内容:', readFileSync(targetFile, 'utf-8'));
  } else {
    console.log('⚠️  文件没有被创建！');
  }
}

// 运行所有测试
async function main() {
  console.log('开始工具写入文件测试...');
  console.log('临时目录基础:', tmpdir());

  await testDirectHandler();
  await testToolRegistry();
  await testToolExecutor();
  await testAgentEngineFlow();
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
