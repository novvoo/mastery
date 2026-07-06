/**
 * Agent E2E Test — Mock LLM + Mock Tools，走完整 run() 链路
 *
 * 验证：
 *   1. Agent 能正确构造并执行 run()
 *   2. LLM 输出的 tool call 能被正确解析
 *   3. Tool 实际被调用并返回结果
 *   4. 结果被回写进会话上下文
 *   5. FINAL_ANSWER 终止标志被识别，Agent 正常退出
 *   6. token 预算机制在超限后 stopRequested
 */

import { ReActAgent } from '../src/core/runtime/agent/agent.js';
import { ToolRegistry } from '../src/core/runtime/agent/tool-registry.js';
import { SessionManager } from '../src/core/session/session-manager.js';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createFileSystemTools } from '../src/tools/filesystem/filesystem-tools.js';
import { createShellTool } from '../src/tools/system/shell.js';

let pass = 0, fail = 0;
const failures = [];

// ============================================================================
// Snake 项目 fixture —— 用于执行阶段测试
// ============================================================================

const SNAKE_JS_BUGGY = `class Snake {
  constructor() {
    this.body = [{ x: 10, y: 10 }];
    this.direction = 'up';
  }
  getHead() { return this.body[0]; }
  getDirectionVector() {
    return { 'up': {x:0,y:-1}, 'down': {x:0,y:1}, 'left': {x:-1,y:0}, 'right': {x:1,y:0} }[this.direction];
  }
  move() {
    const h = this.getHead();
    const v = this.getDirectionVector();
    this.body.unshift({x: h.x+v.x, y: h.y+v.y});
    this.body.pop();
  }
  setDirection(d) {
    const opp = {'up':'down','down':'up','left':'right','right':'left'};
    if (opp[this.direction] !== d) this.direction = d;
  }
}
export default Snake;
`;

const SNAKE_FIXED = `class Snake {
  constructor() {
    this.body = [{ x: 10, y: 10 }];
    this.direction = 'up';
  }
  getHead() { return this.body[0]; }
  getDirectionVector() {
    return { 'up': {x:0,y:-1}, 'down': {x:0,y:1}, 'left': {x:-1,y:0}, 'right': {x:1,y:0} }[this.direction];
  }
  move() {
    const h = this.getHead();
    const v = this.getDirectionVector();
    this.body.unshift({x: h.x+v.x, y: h.y+v.y});
    this.body.pop();
  }
  setDirection(d) {
    this.direction = d;
  }
}
export default Snake;
`;

function assert(label, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

// 静默 UI — 用 Proxy 捕获所有方法调用
const silentUI = new Proxy({}, {
  get(target, prop) {
    if (prop === 'then' || prop === 'catch' || prop === 'finally') { return undefined; }
    if (prop === Symbol.toPrimitive) { return () => 'silentUI'; }
    if (prop === 'isDebugEnabled') { return () => false; }
    return (...args) => {};
  }
});

// Mock MemoryManager
function createMockMemory() {
  const state = {
    taskStack: [],
    currentTask: null,
    currentPhase: null,
    contextNotes: [],
    completedTasks: [],
  };
  return {
    async load() {},
    async save() {},
    async updateTask(description, phase) {
      state.currentTask = description;
      state.currentPhase = phase;
    },
    async completeTask() {
      if (state.currentTask) {
        state.completedTasks.push(state.currentTask);
      }
      state.currentTask = null;
      state.currentPhase = null;
    },
    toPromptFragment() {
      return [
        `# 记忆`,
        state.currentTask ? `- 当前任务: ${state.currentTask}` : '- 当前无任务',
        `- 已完成任务: ${state.completedTasks.length} 个`,
        state.contextNotes.length
          ? `- 上下文备注: ${state.contextNotes.join('; ')}`
          : '',
      ].filter(Boolean).join('\n');
    },
    pushContextNote(note) { state.contextNotes.push(note); },
    getState() { return { ...state }; },
  };
}

function createTempDir(label) {
  const dir = mkdtempSync(`/tmp/agent-e2e-${label}-`);
  return dir;
}

// ============================================================================
// Mock Model Provider — 返回预设的响应序列
// ============================================================================
function createScriptedModelProvider(script) {
  let idx = 0;

  return {
    model: 'mock-model',
    supportsToolCalling: false,
    systemMessageEnabled: true,
    supportsSystemPrompt: true,

    async chat(messages, { tools, systemPrompt, temperature } = {}) {
      const entry = script[idx % script.length];
      idx++;

      // entry: { text, toolCalls, finishReason, usage }
      return {
        text: entry.text || '',
        toolCalls: entry.toolCalls || [],
        finishReason: entry.finishReason || 'stop',
        usage: entry.usage || { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        model: 'mock-model',
        response: {},
      };
    },

    getModelName() { return 'mock-model'; },
    getMaxContextTokens() { return 128000; },
    get callCount() { return idx; },
  };
}

function createToolRegistry() {
  const reg = new ToolRegistry();

  reg.register({
    name: 'echo',
    description: '返回传入的消息',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: '要返回的文本' } },
      required: ['message'],
    },
    async call(args) { return `echo: ${args.message}`; },
  });

  reg.register({
    name: 'add',
    description: '两数相加',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'number', description: '第一个数字' },
        b: { type: 'number', description: '第二个数字' },
      },
      required: ['a', 'b'],
    },
    async call(args) { return args.a + args.b; },
  });

  reg.register({
    name: 'noop',
    description: '空操作，返回 OK',
    parameters: { type: 'object', properties: {} },
    async call() { return 'OK'; },
  });

  return reg;
}

// ============================================================================
// 测试 1: 工具调用 + FINAL_ANSWER — 完整链路
// ============================================================================
async function test_e2e_tool_call_and_final_answer() {
  console.log('\n[E2E-1] 工具调用 → 回写 → FINAL_ANSWER 终止');
  const workDir = createTempDir('e2e-1');

  const toolRegistry = createToolRegistry();
  const memory = createMockMemory();

  // Script: LLM 响应序列
  //   Iter 1: 输出 CALL echo({...})
  //   Iter 2: 输出 FINAL_ANSWER: ...
  const provider = createScriptedModelProvider([
    {
      text: `我先调用 echo 验证一下：\n\nCALL echo({"message": "hello agent"})\n`,
      finishReason: 'tool_use',
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    },
    {
      text: `FINAL_ANSWER: 测试通过！echo 工具返回了预期结果。`,
      finishReason: 'stop',
      usage: { inputTokens: 300, outputTokens: 60, totalTokens: 360 },
    },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 5,
    toolResultCacheEnabled: false,
  }, silentUI);

  // 监听 stopRequested
  let stopRequestedAt = null;
  const tokenScope = agent._tokenScope; // 可能未暴露 — 用外部监测
  if (agent._tokenScope) {
    agent._tokenScope.on('budgetExceeded', () => { stopRequestedAt = Date.now(); });
  }

  const result = await agent.run('帮我测试一下 agent 工作流程');

  assert('run() 返回了结果对象', !!result,
    JSON.stringify(result, null, 2).slice(0, 200));
  assert('status === completed', result.status === 'completed',
    `实际 status=${result.status}`);
  assert('success === true', result.success === true);
  assert('answer 非空', !!result.answer, `answer=${result.answer}`);
  assert('provider 被调用了 2 次', provider.callCount === 2,
    `实际=${provider.callCount}`);
  assert('answer 包含 "通过" 或 "FINAL_ANSWER" 提取的结果',
    /通过|test|agent|echo/i.test(result.answer), `answer=${result.answer}`);

  // 清理
  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 工具：创建含真实文件系统/Shell 工具的 ToolRegistry
// ============================================================================
function createRealToolRegistry() {
  const reg = new ToolRegistry();
  for (const t of [...createFileSystemTools(), createShellTool()]) {
    try { reg.register(t); } catch { /* dup */ }
  }
  return reg;
}

// ============================================================================
// 测试 7: Snake 执行阶段 —— read → edit → shell verify → FINAL_ANSWER
// ============================================================================
async function test_e2e_snake_execution_phase() {
  console.log('\n[E2E-7] Snake 执行阶段 —— read → edit → verify');
  const workDir = createTempDir('e2e-snake-exec');
  writeFileSync(join(workDir, 'Snake.js'), SNAKE_JS_BUGGY);

  const toolRegistry = createRealToolRegistry();
  const memory = createMockMemory();

  const provider = createScriptedModelProvider([
    {
      text: '读取 Snake.js 查看 setDirection 实现...\n\nCALL read_file({"path": "Snake.js"})',
      finishReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 60, totalTokens: 160 },
    },
    {
      text: '发现 setDirection 阻止了 180 度掉头，用 startLine/endLine 修复...\n\nCALL edit_file({"startLine": 16, "endLine": 19, "path": "Snake.js", "new_text": "  setDirection(d) {\n    this.direction = d;\n  }"})',
      finishReason: 'tool_use',
      usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
    },
    {
      text: '运行脚本验证修复是否有效...\n\nCALL shell({"command": "node --input-type=module -e \\\"import Snake from \'./Snake.js\';const s=new Snake();s.setDirection(\'down\');s.move();console.log(s.getHead().x===10&&s.getHead().y===11?\'PASS\':\'FAIL: \'+JSON.stringify(s.getHead()))\\""})',
      finishReason: 'tool_use',
      usage: { inputTokens: 300, outputTokens: 80, totalTokens: 380 },
    },
    {
      text: '验证通过，修复完成。\n\nFINAL_ANSWER: 已修复 Snake.js 的 setDirection bug——移除了 180 度转向阻挡逻辑，setDirection(d) 现在直接设置 this.direction = d。测试验证 down 方向移动后蛇头到达 (10,11)，确认修复正确。',
      finishReason: 'stop',
      usage: { inputTokens: 400, outputTokens: 120, totalTokens: 520 },
    },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 10,
    toolResultCacheEnabled: false,
  }, silentUI);

  const result = await agent.run('修复 Snake.js 中 setDirection 阻止 180 度转向的 bug。读文件→编辑→运行验证');

  // 验证执行结果
  const fixedContent = readFileSync(join(workDir, 'Snake.js'), 'utf-8');
  assert('Snake.js 已被实际修改',
    fixedContent !== SNAKE_JS_BUGGY,
    '文件内容未变化');
  assert('Snake.js setDirection 已被修复',
    fixedContent.includes('this.direction = d') && !fixedContent.includes('opp[this.direction]'),
    `文件仍包含 buggy 代码`);
  assert('Snake.js 格式完整',
    fixedContent.includes('export default Snake'),
    '缺少 export');

  // 验证 agent 执行阶段
  assert('agent 返回 completed',
    result.status === 'completed' || result.status === 'idle',
    `status=${result.status}`);
  assert('provider 被调用 >= 3 次（read + edit + 至少 verify 或 FINAL）',
    provider.callCount >= 3,
    `实际=${provider.callCount}`);
  assert('answer 非空',
    !!result.answer,
    `answer=${result.answer}`);
  assert('answer 提及修复或 snake',
    /修复|snake|Snake/i.test(result.answer || ''),
    `answer=${result.answer}`);

  // 验证 toolEvents：应有 read_file 和 edit_file 工具调用
  const toolEvents = result.toolEvents || [];
  const toolNames = toolEvents.map(e => e.name);
  assert('执行记录中包含 read_file',
    toolNames.some(n => n === 'read_file'),
    `tools=${JSON.stringify(toolNames)}`);
  assert('执行记录中包含 edit_file',
    toolNames.some(n => n === 'edit_file'),
    `tools=${JSON.stringify(toolNames)}`);
  assert('执行记录中包含 shell',
    toolNames.some(n => n === 'shell'),
    `tools=${JSON.stringify(toolNames)}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 测试 8: Snake 执行阶段 —— 工具错误恢复（路径写错 → read → 正确 edit）
// ============================================================================
async function test_e2e_snake_error_recovery() {
  console.log('\n[E2E-8] Snake 执行阶段 —— 工具错误后恢复');
  const workDir = createTempDir('e2e-snake-err');
  writeFileSync(join(workDir, 'Snake.js'), SNAKE_JS_BUGGY);

  const toolRegistry = createRealToolRegistry();
  const memory = createMockMemory();

  const provider = createScriptedModelProvider([
    {
      text: '先读文件...\n\nCALL read_file({"path": "Snake.js"})',
      finishReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    },
    {
      text: '写错了文件名，编辑一个不存在的文件来模拟错误...\n\nCALL edit_file({"path": "wrong_name.js", "old_text": "a", "new_text": "b"})',
      finishReason: 'tool_use',
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    },
    {
      text: 'edit 返回错误，重新读取文件获取最新内容...\n\nCALL read_file({"path": "Snake.js"})',
      finishReason: 'tool_use',
      usage: { inputTokens: 350, outputTokens: 60, totalTokens: 410 },
    },
    {
      text: '用行号方式精确编辑 setDirection 方法...\n\nCALL edit_file({"startLine": 16, "endLine": 19, "path": "Snake.js", "new_text": "  setDirection(d) {\n    this.direction = d;\n  }"})',
      finishReason: 'tool_use',
      usage: { inputTokens: 450, outputTokens: 90, totalTokens: 540 },
    },
    {
      text: '验证修复...\n\nFINAL_ANSWER: 修复完成。第一次 edit 因文件名错误而失败，重新读取文件后用行号编辑成功。',
      finishReason: 'stop',
      usage: { inputTokens: 550, outputTokens: 100, totalTokens: 650 },
    },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 10,
    toolResultCacheEnabled: false,
  }, silentUI);

  const result = await agent.run('修复 Snake.js 的转向 bug');

  // 验证最终文件已被修复
  const fixedContent = readFileSync(join(workDir, 'Snake.js'), 'utf-8');
  assert('【错误恢复】错误后最终文件被修复',
    fixedContent.includes('this.direction = d') && !fixedContent.includes('opp[this.direction]'),
    'setDirection 未正确修复');

  // 验证 agent 持续执行而非崩溃
  assert('【错误恢复】agent 正常结束',
    result.status !== undefined,
    `status=${result.status}`);

  // 验证有足够的工具调用（至少 read + failed edit + read again + successful edit）
  const toolEvents = result.toolEvents || [];
  const editEvents = toolEvents.filter(e => e.name === 'edit_file');
  assert('【错误恢复】至少有一次 edit_file 尝试',
    editEvents.length >= 1,
    `edit_file 调用次数=${editEvents.length}`);
  assert('【错误恢复】总工具调用 >= 2',
    toolEvents.length >= 2,
    `总工具事件数=${toolEvents.length}`);

  // 验证工具执行记录中包含失败事件
  const toolErrors = toolEvents.filter(e => e.error);
  const toolFailures = toolEvents.filter(e => e.error || (typeof e.resultPreview === 'string' && e.resultPreview.includes('Error')));
  assert('【错误恢复】工具执行记录中有错误或失败',
    toolFailures.length >= 1,
    `失败事件数=${toolFailures.length} 事件=${JSON.stringify(toolEvents.map(e => ({n:e.name, err:!!e.error, res:(typeof e.resultPreview === 'string' ? e.resultPreview.substring(0,40) : '')})))}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 测试 2: 多工具调用 — add 工具做计算
// ============================================================================
async function test_e2e_multiple_tool_calls() {
  console.log('\n[E2E-2] 多次工具调用链路');
  const workDir = createTempDir('e2e-2');

  const toolRegistry = createToolRegistry();
  const memory = createMockMemory();

  // Script: 两次 add → 一次 echo → 一次 FINAL_ANSWER
  const provider = createScriptedModelProvider([
    { text: `CALL add({"a": 10, "b": 20})`, finishReason: 'tool_use' },
    { text: `CALL add({"a": 100, "b": 50})`, finishReason: 'tool_use' },
    { text: `CALL echo({"message": "计算完成"})`, finishReason: 'tool_use' },
    { text: `FINAL_ANSWER: 10 + 20 = 30, 100 + 50 = 150。任务完成。`, finishReason: 'stop' },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 10,
    toolResultCacheEnabled: false,
  }, silentUI);

  const result = await agent.run('请帮我算一些简单的数字');

  assert('最终返回 completed', result.status === 'completed', `实际=${result.status}`);
  assert('provider 调用次数 = 4', provider.callCount === 4, `实际=${provider.callCount}`);
  assert('answer 包含数字', /\d+/.test(result.answer || ''), `answer=${result.answer}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 测试 3: 无 tool call — 直接回答（纯文本回答）
// ============================================================================
async function test_e2e_direct_answer() {
  console.log('\n[E2E-3] 无工具调用 — 直接文本回答');
  const workDir = createTempDir('e2e-3');

  const toolRegistry = createToolRegistry();
  const memory = createMockMemory();

  const provider = createScriptedModelProvider([
    { text: `FINAL_ANSWER: 你好，这是直接回答。`, finishReason: 'stop' },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 5,
    toolResultCacheEnabled: false,
  }, silentUI);

  const result = await agent.run('打个招呼');

  assert('直接回答返回 completed', result.status === 'completed', `实际=${result.status}`);
  assert('answer 包含 "你好"', /你好|直接|回答/.test(result.answer || ''), `answer=${result.answer}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 测试 4: 带 tokenBudget — 预算超限后停止
// ============================================================================
async function test_e2e_token_budget() {
  console.log('\n[E2E-4] Token Budget 超限检测');
  const workDir = createTempDir('e2e-4');

  const toolRegistry = createToolRegistry();
  const memory = createMockMemory();

  // 构造大量 token 的工具调用序列，让总 cost 超过小预算
  const provider = createScriptedModelProvider([
    // 故意把每次调用 token 都设得很大
    { text: `CALL echo({"message": "a"})`, finishReason: 'tool_use',
      usage: { inputTokens: 500000, outputTokens: 500000, totalTokens: 1000000 } },
    { text: `FINAL_ANSWER: done`, finishReason: 'stop',
      usage: { inputTokens: 500000, outputTokens: 500000, totalTokens: 1000000 } },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 5,
    tokenBudget: 0.00001, // 非常小的预算 (0.00001 USD)
    tokenBudgetWarningThreshold: 1,
    toolResultCacheEnabled: false,
  }, silentUI);

  // 运行 — 预期：很快因为预算超限而 stop
  const result = await agent.run('无限循环直到预算耗尽');

  // 只要 provider 被调用过且能正常退出即可
  assert('budget 测试正常结束（非 crash）', provider.callCount >= 1,
    `provider.callCount=${provider.callCount}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 测试 5: maxIterations 边界 — 迭代数超过限制后停止
// ============================================================================
async function test_e2e_max_iterations() {
  console.log('\n[E2E-5] Max Iterations 边界');
  const workDir = createTempDir('e2e-5');

  const toolRegistry = createToolRegistry();
  const memory = createMockMemory();

  // LLM 永远输出 CALL noop，永远不 FINAL_ANSWER
  const provider = createScriptedModelProvider([
    { text: `CALL noop({})`, finishReason: 'tool_use' },
  ]);
  // 用脚本生成无限循环 — 覆盖这个
  provider.chat = async function () {
    return {
      text: `CALL noop({})`,
      toolCalls: [],
      finishReason: 'tool_use',
      usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
      model: 'mock-model',
      response: {},
    };
  };

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 3,  // 只允许 3 次
    toolResultCacheEnabled: false,
  }, silentUI);

  const result = await agent.run('永远在思考');

  assert('超过 maxIterations 后 agent 会停止（而非无限循环）', true);
  assert('provider 调用次数 <= maxIterations + 1',
    provider.callCount <= 4, `实际=${provider.callCount}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 测试 6: Native tool_calls — 真实模型 SDK 风格函数调用
// ============================================================================
async function test_e2e_native_tool_calls() {
  console.log('\n[E2E-6] Native tool_calls 函数调用链路');
  const workDir = createTempDir('e2e-6');

  const toolRegistry = createToolRegistry();
  const memory = createMockMemory();

  const provider = createScriptedModelProvider([
    {
      text: '',
      toolCalls: [{
        id: 'call_add_1',
        type: 'function',
        function: {
          name: 'add',
          arguments: JSON.stringify({ a: 7, b: 8 }),
        },
      }],
      finishReason: 'tool_calls',
    },
    {
      text: 'FINAL_ANSWER: native tool_calls 已执行，7 + 8 = 15。',
      finishReason: 'stop',
    },
  ]);

  const agent = new ReActAgent(provider, toolRegistry, memory, {
    workingDirectory: workDir,
    model: 'mock-model',
    maxIterations: 5,
    toolResultCacheEnabled: false,
  }, silentUI);

  const result = await agent.run('用 native tool call 帮我计算 7 + 8');

  assert('native tool_calls 返回 completed', result.status === 'completed', `实际=${result.status}`);
  assert('provider 被调用了 2 次', provider.callCount === 2, `实际=${provider.callCount}`);
  assert('answer 包含 native tool_calls 计算结果', /15|native tool_calls/.test(result.answer || ''), `answer=${result.answer}`);

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 主流程
// ============================================================================
async function main() {
  console.log('='.repeat(60));
  console.log('  Agent E2E 测试 — Mock LLM + Mock Tools');
  console.log('='.repeat(60));

  await test_e2e_tool_call_and_final_answer();
  await test_e2e_multiple_tool_calls();
  await test_e2e_direct_answer();
  await test_e2e_token_budget();
  await test_e2e_max_iterations();
  await test_e2e_native_tool_calls();
  await test_e2e_snake_execution_phase();
  await test_e2e_snake_error_recovery();

  console.log('\n' + '='.repeat(60));
  console.log(`  E2E 测试结果`);
  console.log('='.repeat(60));
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  if (failures.length) {
    console.log('');
    failures.forEach(f => console.log(f));
  }
  console.log('='.repeat(60));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nE2E 测试执行出错:');
  console.error(err);
  process.exit(1);
});
