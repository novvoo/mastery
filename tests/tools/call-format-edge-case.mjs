// 测试 CALL 格式解析的边缘情况 —— 复现用户报告的 bug
// 问题描述：当 LLM 返回含有工具调用格式（如 CALL shell(...)）的响应时，
// 程序没有正确解析/执行，而是将原始文本直接返回给用户。

import { TextToolParser } from '../../src/core/parsing/text-tool-parser.js';

// 模拟工具注册
const mockRegistry = {
  _tools: ['shell', 'read_file', 'write_file', 'list_dir', 'web_search'],
  has(name) { return this._tools.includes(name); },
  getAll() { return this._tools.map(n => ({ name: n, description: 'test' })); },
};

const parser = new TextToolParser(mockRegistry);

// 用例 1: 标准 CALL 格式
const case1 = `CALL shell({"command": "ls -la"})`;
console.log('=== 用例 1: 标准 CALL ===');
console.log('parse:', parser.parse(case1));
console.log('containsUnparsedToolSyntax (via regex):', /\bCALL\s+\/?[A-Za-z_][\w-]*\s*\(/.test(case1));
console.log();

// 用例 2: CALL + 复杂 shell 命令（含代码片段、转义引号）
const case2 = `CALL shell({"command": "cd /Users/jingslunt/workspace && node -e 'const fs = require(\"fs\"); const c = fs.readFileSync(\"snake.js\",\"utf8\");'"})`;
console.log('=== 用例 2: 复杂 shell CALL ===');
console.log('parse:', parser.parse(case2));
console.log();

// 用例 3: CALL 后跟 DSML 结束标签（LLM 可能混合输出）
const case3 = `CALL shell({"command": "ls"})</||DSML||parameter>`;
console.log('=== 用例 3: CALL 后跟 DSML 标签 ===');
console.log('parse:', parser.parse(case3));
console.log();

// 用例 4: 用户实际报告的原始形式
const case4 = `程序遇到如下，没处理直接结束任务，把这个内容返回给用户，处理下 。CALL shell({"command": "cd /Users/jingslunt/workspace && node -e 'const fs = require(\"fs\"); const c = fs.readFileSync(\"snake.js\",\"utf8\"); const checks=[ [\"resetGame\",c.includes(\"function resetGame\")],[\"tick\",c.includes(\"function tick\")],[\"setInterval\",c.includes(\"setInterval(tick,\")],[\"endGame\",c.includes(\"function endGame\")] ]; let all=true; checks.forEach(([n,ok])=>{console.log((ok?\"✓\":\"✗\")+\" \"+n); if(!ok) all=false}); console.log(all?\"\\nAll semantic checks passed!\":\"\\nSome checks FAILED!\");'"})`;
console.log('=== 用例 4: 用户报告的实际原始文本 ===');
console.log('parse:', parser.parse(case4));
console.log();

// 用例 5: CALL 格式中有代码行的换行（真实 LLM 输出常见）
const case5 = `让我执行一个命令来检查。

CALL shell({
  "command": "echo 'hello world'"
})`;
console.log('=== 用例 5: 多行 CALL ===');
console.log('headerRegex match:', case5.match(/CALL\s+\/?([A-Za-z_][\w-]*)\s*\(\s*\{/g));
console.log('parse:', parser.parse(case5));
console.log();

// 用例 6: CALL 中 command 含 JS 代码与大量引号、花括号
const case6 = `CALL shell({"command":"node -e 'const c = \"x\"; const obj = {a: 1}; console.log(c, obj)'"})`;
console.log('=== 用例 6: command 含 code ===');
console.log('parse:', parser.parse(case6));
console.log();

// 用例 7: 检查 containsUnparsedToolSyntax 的正则
const syntaxCheck = [case1, case2, case3, case4, case5, case6];
console.log('=== 用例 7: containsUnparsedToolSyntax 检测 ===');
const detectPatterns = [
  /<tool_code>[\s\S]*?<\/tool_code>/i,
  /<tool_call>[\s\S]*?<\/tool_call>/i,
  /<function_call>[\s\S]*?<\/function_call>/i,
  /```(?:tool|json)?\s*\n\s*\{[\s\S]*?(?:"name"|"action"|"tool")[\s\S]*?\}\s*```/i,
  /\bCALL\s+\/?[A-Za-z_][\w-]*\s*\(/,
  /<(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)\s*\w+/i,
];
syntaxCheck.forEach((c, i) => {
  const matched = detectPatterns.map(p => p.test(c));
  console.log(`case ${i + 1}: any=${matched.some(v => v)}, details=${matched.map((v, j) => `${j}:${v}`).join(',')}`);
});
console.log();

// 用例 8: 回归测试 - 修复后常见格式不应被破坏
console.log('=== 用例 8: 回归测试（常见格式） ===');
const regressions = [
  { label: 'simple CALL', text: 'CALL shell({"command": "ls -la"})',
    check: r => r.length === 1 && r[0].name === 'shell' && r[0].arguments.command === 'ls -la' },
  { label: 'multi-arg CALL', text: 'CALL write_file({"path": "a.txt", "content": "hello"})',
    check: r => r.length === 1 && r[0].arguments.path === 'a.txt' && r[0].arguments.content === 'hello' },
  { label: 'tool codeblock', text: '```tool\n{"name": "shell", "arguments": {"command": "ls"}}\n```',
    check: r => r.length === 1 && r[0].name === 'shell' && r[0].arguments.command === 'ls' },
];
let pass = 0, fail = 0;
for (const rg of regressions) {
  const out = parser.parse(rg.text);
  if (rg.check(out)) { console.log('  ✓', rg.label); pass++; }
  else { console.log('  ✗', rg.label, '->', JSON.stringify(out)); fail++; }
}
console.log('  -- regression summary:', pass, 'passed /', fail, 'failed');
console.log();

// 用例 9: 确认 recover-call-arguments 在包含代码片段时能正确解析
// （核心 bug 修复验证）
console.log('=== 用例 9: 核心 bug 修复验证 ===');
// 这个命令本身不能合法地作为 JSON 解析（因为内部 `require("fs")` 中的 `"` 没有转义），
// 但我们的 recovery 逻辑应该仍然能正确提取出 command 字符串。
const problematic = `CALL shell({"command": "node -e 'console.log(\"hi\");'"})`;
// 先确认 JSON.parse 本身会失败
let nativeFails = false;
try { JSON.parse(problematic.substring(problematic.indexOf('{'), problematic.lastIndexOf('}') + 1)); }
catch (e) { nativeFails = true; }
console.log('  JSON.parse 对原始 payload 失败:', nativeFails ? '是（预期）' : '否');
const recovered = parser.parse(problematic);
console.log('  parser.parse 结果:', recovered.length > 0 ? '解析成功' : '失败');
if (recovered.length > 0) {
  console.log('  arguments.command =', JSON.stringify(recovered[0].arguments.command));
}
