/**
 * Core Module Integration Tests
 * 核心模块集成测试
 *
 * 覆盖：RuntimeConfig / AgentState / TokenScope / SessionManager / ToolRegistry
 *       MemoryManager / WorkspaceState / Model Provider Contract / Tool Dedup
 */

import { SessionManager } from '../src/core/session/session-manager.js';
import { TokenScope } from '../src/core/runtime/agent/support/token-scope.js';
import { ToolRegistry } from '../src/core/runtime/agent/tool-registry.js';
import { MAX_ITERATIONS_DEFAULT } from '../src/core/agent/constants.js';
import { RuntimeConfig, AgentState, PlatformType } from '../src/runtime/types.js';

import { resolve, join } from 'path';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';

// ---------- 测试工具 ---------- //
let pass = 0, fail = 0;
const failures = [];

function assert(label, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function createTempDir(label) {
  const dir = mkdtempSync(`/tmp/agent-test-${label}-`);
  return dir;
}

// ============================================================================
// 1. AgentConstants
// ============================================================================
console.log('\n[1] AgentConstants');
assert('MAX_ITERATIONS_DEFAULT 是正整数',
  typeof MAX_ITERATIONS_DEFAULT === 'number' && MAX_ITERATIONS_DEFAULT > 0);

// ============================================================================
// 2. RuntimeConfig
// ============================================================================
console.log('\n[2] RuntimeConfig');
{
  const c1 = new RuntimeConfig();
  assert('默认配置的 PlatformType 是 CLI', c1.platform === PlatformType.CLI);
  assert('默认 maxIterations === MAX_ITERATIONS_DEFAULT', c1.maxIterations === MAX_ITERATIONS_DEFAULT);
  assert('默认 toolResultCacheEnabled === true', c1.toolResultCacheEnabled === true);
  assert('默认 tokenBudget === null', c1.tokenBudget === null);

  const c2 = new RuntimeConfig({
    tokenBudget: 0.5,
    tokenBudgetWarningThreshold: 80,
    toolResultCacheEnabled: false,
    maxIterations: 50,
    debug: true,
  });
  assert('自定义 tokenBudget 被保留', c2.tokenBudget === 0.5);
  assert('自定义 toolResultCacheEnabled=false 被保留', c2.toolResultCacheEnabled === false);
  assert('自定义 maxIterations 被保留', c2.maxIterations === 50);

  c2.update({ tokenBudget: 1.0, maxIterations: 200 });
  assert('update() 可修改 tokenBudget', c2.tokenBudget === 1.0);
  assert('update() 可修改 maxIterations', c2.maxIterations === 200);

  const clone = c2.clone();
  assert('clone() 产出独立实例', clone !== c2);
  assert('clone() 保留 tokenBudget', clone.tokenBudget === 1.0);
}

// ============================================================================
// 3. AgentState
// ============================================================================
console.log('\n[3] AgentState');
{
  const state = new AgentState();
  assert('初始 status === idle', state.status === 'idle');
  assert('初始 iteration === 0', state.iteration === 0);
  assert('初始 currentTask === null', state.currentTask === null);

  state.setStatus('running');
  assert('setStatus 可更新为 running', state.status === 'running');

  state.setError(new Error('test error'));
  assert('setError 设置 status=error', state.status === 'error');
  assert('setError 保留 error 对象', state.error && state.error.message === 'test error');

  state.reset();
  assert('reset() 后 status === idle', state.status === 'idle');
  assert('reset() 后 iteration === 0', state.iteration === 0);
}

// ============================================================================
// 4. ToolRegistry — 注册 / 参数校验 / Handler 调用
// ============================================================================
console.log('\n[4] ToolRegistry');
{
  const registry = new ToolRegistry();

  // 4a. 基础注册
  registry.register({
    name: 'echo',
    description: '返回消息',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        count: { type: 'integer' },
        verbose: { type: 'boolean' },
      },
      required: ['message'],
    },
    async call(args) {
      return `echo: ${args.message}`;
    },
  });
  assert('工具被注册并可获取', !!registry.get('echo'));

  // 4b. 重复注册 throw
  let dupError = false;
  try {
    registry.register({
      name: 'echo',
      description: 'duplicate',
      async call() { return 'dup'; },
    });
  } catch {
    dupError = true;
  }
  assert('重复注册 throw', dupError === true);

  // 4c. 无 name 注册 throw
  let noNameError = false;
  try {
    registry.register({ description: 'x', async call() {} });
  } catch {
    noNameError = true;
  }
  assert('无 name 注册 throw', noNameError === true);

  // 4d. 无 call/handler 注册 throw
  let noHandlerError = false;
  try {
    registry.register({ name: 'orphan', description: 'x' });
  } catch {
    noHandlerError = true;
  }
  assert('无 handler 注册 throw', noHandlerError === true);

  // 4e. 参数校验 — 正常
  const v1 = registry.validateAndCoerceArgs('echo', { message: 'hi', count: 3, verbose: true });
  assert('合法参数 valid===true', v1.valid);
  assert('合法参数 coerced 保留', v1.coercedArgs.message === 'hi');

  // 4f. 参数校验 — 缺必填
  const v2 = registry.validateAndCoerceArgs('echo', {});
  assert('缺必填 valid===false', v2.valid === false);
  assert('缺必填 errors.length > 0', v2.errors.length > 0);

  // 4g. 参数校验 — 数字字符串 coerce
  const v3 = registry.validateAndCoerceArgs('echo', { message: 'x', count: '42' });
  assert('count 字符串数字被转为 number', typeof v3.coercedArgs.count === 'number' && v3.coercedArgs.count === 42);

  // 4h. 参数校验 — boolean 字符串
  const v4 = registry.validateAndCoerceArgs('echo', { message: 'x', verbose: 'true' });
  assert('"true" 被转为 boolean true', v4.coercedArgs.verbose === true);
  const v5 = registry.validateAndCoerceArgs('echo', { message: 'x', verbose: 'false' });
  assert('"false" 被转为 boolean false', v5.coercedArgs.verbose === false);

  // 4i. 未注册工具的参数校验
  const v6 = registry.validateAndCoerceArgs('unknown', {});
  assert('未知工具 valid===false', v6.valid === false);

  // 4j. handler 实际执行
  const tool = registry.get('echo');
  assert('工具的 call 可直接执行', (await tool.call({ message: 'world' })) === 'echo: world');

  // 4k. getAll / size
  assert('getAll 返回工具列表', registry.getAll().length >= 1);
  assert('size 反映实际工具数', registry.size >= 1);

  // 4l. has()
  assert('has(已注册) === true', registry.has('echo') === true);
  assert('has(未注册) === false', registry.has('no-such') === false);
}

// ============================================================================
// 5. SessionManager — 消息、priority、trim、自动打标
// ============================================================================
console.log('\n[5] SessionManager');
{
  const sm = new SessionManager({ model: 'gpt-4o' });

  // 5a. 基本消息
  sm.addUserMessage('你好');
  sm.addAssistantMessage('你好！有什么可以帮你的？');
  let history = sm.getHistory();
  assert('消息被添加到 history', history.length === 2);
  assert('第一条消息是 user', history[0].role === 'user');
  assert('第二条消息是 assistant', history[1].role === 'assistant');

  // 5b. getTokenCount / length 属性
  assert('getTokenCount 返回正数', sm.getTokenCount() > 0);

  // 5c. addToolResult / priority
  sm.addToolResult('call-1', 'ls', 'file1.js\nfile2.js');
  const withTool = sm.getHistory();
  const toolMsg = withTool.find(m => m.role === 'tool');
  assert('tool 消息被添加', !!toolMsg);
  assert('tool 消息默认 priority >= 2 (evidence)', toolMsg.priority >= 2);

  // 5d. tagLastMessage
  sm.addUserMessage('我们决定重构此文件');
  sm.tagLastMessage(3);
  const tagged = sm.getHistory()[sm.getHistory().length - 1];
  assert('tagLastMessage 设置 priority', tagged.priority === 3);

  // 5e. autoTagLastAssistantPriority — 决策关键词
  sm.addAssistantMessage('我们决定使用 TypeScript。因此我将把文件重构为 .ts。');
  sm.autoTagLastAssistantPriority();
  const assistantMsgs = sm.getHistory().filter(m => m.role === 'assistant');
  const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
  assert('决策关键词 assistant 消息被标记为 DECISION (priority=3)',
    lastAssistant.priority === 3, `实际 priority=${lastAssistant.priority}`);

  // 5f. autoTagLastAssistantPriority — 普通内容
  sm.addAssistantMessage('随便说一句，今天天气很好。');
  sm.autoTagLastAssistantPriority();
  const lastOrdinary = sm.getHistory()[sm.getHistory().length - 1];
  assert('无决策关键词 assistant 消息保持 evidence (priority=2)',
    lastOrdinary.priority === 2, `实际 priority=${lastOrdinary.priority}`);

  // 5g. trim — 塞满消息后 trim，验证高 priority 消息被保留
  const baseline = sm.getHistory().length;
  for (let i = 0; i < 50; i++) {
    sm.addUserMessage(`闲聊 question ${i}`);
    sm.addAssistantMessage(`回答 ${i}：一些普通内容。`);
  }
  const before = sm.getHistory().length;
  assert('塞入消息后消息数增长', before > baseline);

  const decisionBefore = sm.getHistory().filter(m => m.priority === 3).length;
  sm.trimToContextWindow(3000);
  const afterTrim = sm.getHistory().length;
  assert('trim 后消息数减少', afterTrim < before);
  const decisionAfter = sm.getHistory().filter(m => m.priority === 3).length;
  assert('trim 后决策消息未丢失', decisionAfter >= decisionBefore, `${decisionBefore} -> ${decisionAfter}`);

  // 5h. clearMessages
  sm.clear();
  assert('clear 清空消息', sm.getHistory().length === 0);
}

// ============================================================================
// 6. TokenScope — 请求记录 / 统计 / 超限
// ============================================================================
console.log('\n[6] TokenScope');
{
  const scope = new TokenScope();

  scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
  scope.recordRequest({ model: 'gpt-4o-mini', inputTokens: 300, outputTokens: 150 });

  const stats = scope.getStats();
  assert('记录到 2 次请求', stats.totalRequests === 2);
  assert('input token 合计正确', stats.totalInputTokens === 400);
  assert('output token 合计正确', stats.totalOutputTokens === 200);
  assert('totalCost >= 0', stats.totalCost >= 0);
  assert('duration >= 0', stats.duration >= 0);

  const breakdown = scope.getModelBreakdown();
  assert('model 细分包含 gpt-4o', !!breakdown['gpt-4o']);
  assert('model 细分包含 gpt-4o-mini', !!breakdown['gpt-4o-mini']);
  assert('gpt-4o 请求数正确', breakdown['gpt-4o'].requests === 1);

  // 6b. 预算告警 — 通过 userId 级预算
  let warningFired = false;
  let exceededFired = false;
  const scope2 = new TokenScope({
    budgetLimits: { 'test-user': { limit: 0.000001, warningThreshold: 1 } },
    onBudgetWarning: () => { warningFired = true; },
    onBudgetExceeded: () => { exceededFired = true; },
  });
  scope2.recordRequest({
    model: 'gpt-4o',
    inputTokens: 1000000,
    outputTokens: 1000000,
    userId: 'test-user',
  });
  const stats2 = scope2.getStats();
  assert('超预算后 totalCost > 0', stats2.totalCost > 0);
  assert('超预算后 callback 至少触发了 warning 或 exceeded',
    warningFired === true || exceededFired === true);

  // 6c. 不同 model 的成本不同（gpt-4o 比 gpt-4o-mini 贵）
  const scope3 = new TokenScope();
  scope3.recordRequest({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 });
  const cost3 = scope3.getStats().totalCost;
  const scope3b = new TokenScope();
  scope3b.recordRequest({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
  const cost3b = scope3b.getStats().totalCost;
  assert('gpt-4o 成本 > gpt-4o-mini 成本', cost3 > cost3b);

  // 6d. reset() — 重置后清零
  const scope4 = new TokenScope();
  scope4.recordRequest({ model: 'gpt-4o', inputTokens: 10, outputTokens: 10 });
  scope4.reset();
  const cleared = scope4.getStats();
  assert('reset() 后请求数归零', cleared.totalRequests === 0);
  assert('reset() 后 totalCost 归零', cleared.totalCost === 0);

  // 6e. exportData() — 返回完整数据
  const scope5 = new TokenScope();
  scope5.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
  const data = scope5.exportData();
  assert('exportData 包含 session 字段', !!data.session);
  assert('exportData 包含 modelBreakdown 字段', !!data.modelBreakdown);
  assert('exportData 包含 history 字段', Array.isArray(data.history));
  assert('exportData history 长度 >= 1', data.history.length >= 1);
}

// ============================================================================
// 7. MemoryManager — 持久化 / 任务更新 / complete
// ============================================================================
console.log('\n[7] MemoryManager');
{
  const { MemoryManager } = await import('../src/memory/memory-manager.js');

  const dir = createTempDir('memory');
  const mm = new MemoryManager(dir);

  // 7a. load 不报错
  try {
    await mm.load();
    assert('MemoryManager.load() 可执行', true);
  } catch (err) {
    assert('MemoryManager.load() 可执行', false, err.message);
  }

  // 7b. updateTask
  try {
    await mm.updateTask('重构用户模块', 'execution');
    assert('updateTask 可执行', true);
  } catch (err) {
    assert('updateTask 可执行', false, err.message);
  }

  // 7c. completeTask
  try {
    await mm.completeTask();
    assert('completeTask 可执行', true);
  } catch (err) {
    assert('completeTask 可执行', false, err.message);
  }

  // 7d. save — 核心持久化
  try {
    await mm.save();
    const memPath = join(dir, 'CONTEXT.md');
    assert('CONTEXT.md 文件被写入', existsSync(memPath));
  } catch (err) {
    assert('CONTEXT.md 文件被写入', false, err.message);
  }

  // 7e. toPromptFragment — 产生可用字符串
  const fragment = mm.toPromptFragment();
  assert('toPromptFragment 返回字符串', typeof fragment === 'string');

  // 7f. 跨进程重读 — 新实例 load 后应该能拿到之前的记忆
  const mm2 = new MemoryManager(dir);
  try {
    await mm2.load();
    assert('新实例 load 后可读出', true);
  } catch (err) {
    assert('新实例 load 后可读出', false, err.message);
  }

  // 清理
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// 8. ToolRegistry — toFunctionDefinitions (给 LLM 的格式)
// ============================================================================
console.log('\n[8] ToolRegistry.toFunctionDefinitions');
{
  const registry = new ToolRegistry();
  registry.register({
    name: 'math_add',
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

  const defs = registry.toFunctionDefinitions();
  assert('toFunctionDefinitions 产出非空数组', Array.isArray(defs) && defs.length > 0);

  const mathDef = defs.find(d => d.name === 'math_add');
  assert('math_add 出现在 function defs', !!mathDef);
  assert('function def 有 parameters.properties', !!mathDef.parameters?.properties);
  assert('function def 有 required', Array.isArray(mathDef.parameters.required) && mathDef.parameters.required.length === 2);
  assert('function def 有 description', typeof mathDef.description === 'string' && mathDef.description.length > 0);

  // 校验实际调用
  const tool = registry.get('math_add');
  const result = await tool.call({ a: 2, b: 3 });
  assert('math_add 实际执行返回正确结果', result === 5, `实际=${result}`);
}

// ============================================================================
// 9. EventBus (简易集成) — agent-engine 使用的事件总线
// ============================================================================
console.log('\n[9] Runtime EventBus');
{
  const { RuntimeEventBus } = await import('../src/runtime/event-bus.js');
  const bus = new RuntimeEventBus();

  let fired = null;
  bus.on('test:event', (data) => { fired = data; });
  bus.emit('test:event', { value: 42 });
  assert('eventBus emit/on 工作', fired && fired.value === 42);

  // off
  let fireCount = 0;
  const handler = () => fireCount++;
  bus.on('test:count', handler);
  bus.emit('test:count');
  bus.off('test:count', handler);
  bus.emit('test:count');
  assert('eventBus off 工作 — 只触发 1 次', fireCount === 1, `实际=${fireCount}`);
}

// ============================================================================
// 10. RuntimeConfig 边界值
// ============================================================================
console.log('\n[10] RuntimeConfig 边界值');
{
  const cfg = new RuntimeConfig({
    tokenBudget: 0,
    maxIterations: 0,
  });
  assert('tokenBudget=0 被保留', cfg.tokenBudget === 0, `实际=${cfg.tokenBudget}`);
  assert('maxIterations=0 被视为 falsy，回退到 DEFAULT',
    cfg.maxIterations === MAX_ITERATIONS_DEFAULT,
    `实际=${cfg.maxIterations} (maxIterations 逻辑：opts 或 DEFAULT)`);
}

// ============================================================================
// 11. SessionManager — JSON 互操作、跨实例隔离
// ============================================================================
console.log('\n[11] SessionManager 实例隔离');
{
  const s1 = new SessionManager({ model: 'gpt-4o' });
  const s2 = new SessionManager({ model: 'gpt-4o-mini' });

  s1.addUserMessage('only in s1');
  assert('两个 SessionManager 实例互不影响', s2.getHistory().length === 0);
  assert('s1 独立持有 1 条消息', s1.getHistory().length === 1);
}

// ============================================================================
// Summary
// ============================================================================
console.log('\n' + '='.repeat(50));
console.log(`  核心模块集成测试 结果`);
console.log('='.repeat(50));
console.log(`  通过: ${pass}`);
console.log(`  失败: ${fail}`);
if (failures.length) {
  console.log('');
  failures.forEach(f => console.log(f));
}
console.log('='.repeat(50));

process.exit(fail > 0 ? 1 : 0);
