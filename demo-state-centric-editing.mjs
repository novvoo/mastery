#!/usr/bin/env bun
/**
 * 演示：State-Centric Editing vs Context-Centric Editing
 * 
 * 这个脚本展示了 oh-my-pi 风格的架构改进如何解决传统 Agent 编辑的问题
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { ContentAddressableStore, FileAnalyzer } from './src/core/harness/content-addressing.js';
import { HashAnchoredPatcher, PatchIntentBuilder, StateGraph } from './src/core/harness/hash-anchored-patch.js';

console.log('=' . repeat(80));
console.log('  State-Centric Editing vs Context-Centric Editing Demo');
console.log('=' . repeat(80));
console.log('');

// 准备测试文件
const testDir = './test-temp';
if (!existsSync(testDir)) {
  await mkdir(testDir);
}

const demoFile = join(testDir, 'demo-file.js');

// 创建初始文件
const initialContent = `// Demo File: Simple Calculator
// This file demonstrates hash-anchored patching

function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

module.exports = {
  add,
  subtract,
  multiply,
  divide
};
`;

await writeFile(demoFile, initialContent, 'utf-8');
console.log('✅ Created test file:', demoFile);
console.log('');

console.log('=' . repeat(80));
console.log('  1. Context-Centric Editing (传统方式 - 问题演示)');
console.log('=' . repeat(80));
console.log('');

console.log('问题：');
console.log('  - 需要将完整文件内容放入上下文');
console.log('  - 每次修改都要重新生成完整代码');
console.log('  - 依赖模型记住行号');
console.log('  - 上下文裁剪会丢失信息');
console.log('  - 文件越大，编辑成本越高 (O(file size))');
console.log('');

console.log('模拟传统 edit_file 调用...');
console.log('→ 需要找到第 20-26 行 (divide 函数)');
console.log('→ 生成完整的新函数代码');
console.log('→ 替换整个范围');
console.log('');

console.log('=' . repeat(80));
console.log('  2. State-Centric Editing (新方式 - 改进演示)');
console.log('=' . repeat(80));
console.log('');

// 初始化 Harness 系统
console.log('初始化 Harness 系统...');
const store = new ContentAddressableStore();
const patcher = new HashAnchoredPatcher(store);
const patchBuilder = new PatchIntentBuilder(store);
const stateGraph = new StateGraph(store);

console.log('✅ Content Addressable Store initialized');
console.log('✅ Hash-Anchored Patcher initialized');
console.log('✅ State Graph initialized');
console.log('');

// 分析文件并创建锚点
console.log('步骤 1: 分析文件并创建内容锚点 (harness_analyze)');
console.log('-'.repeat(80));
const analysis = patcher.initializeFile('demo-file.js', initialContent);
const initialNode = stateGraph.createInitialNode('demo-file.js', initialContent);

console.log(`File Hash: ${analysis.fileHash.substring(0, 16)}...`);
console.log(`Anchors created: ${analysis.anchors.length}`);
console.log('');

// 显示一些锚点
console.log('锚点预览 (前 8 个):');
for (let i = 0; i < Math.min(8, analysis.anchors.length); i++) {
  const anchor = analysis.anchors[i];
  const hashPreview = anchor.hash.substring(0, 16) + '...';
  const textPreview = anchor.text.substring(0, 50).replace(/\n/g, ' ↵ ');
  console.log(`  [${i}] ${hashPreview}: "${textPreview}"`);
}
console.log('');

// 找到 divide 函数的锚点
let divideAnchorHash = null;
console.log('查找 divide 函数的锚点...');
for (const anchor of analysis.anchors) {
  if (anchor.text.includes('function divide')) {
    divideAnchorHash = anchor.hash;
    console.log(`✅ Found divide function anchor: ${anchor.hash.substring(0, 16)}...`);
    break;
  }
}
console.log('');

// 应用补丁
console.log('步骤 2: 应用哈希锚点补丁 (harness_replace)');
console.log('-'.repeat(80));
const newDivideFunction = `function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  const result = a / b;
  // Round to 2 decimal places for consistency
  return Math.round(result * 100) / 100;
}`;

const intent = patchBuilder.replace(
  divideAnchorHash!, 
  newDivideFunction,
  'Add rounding to divide function'
);

console.log('Patch Intent:');
console.log(`  Type: ${intent.type}`);
console.log(`  Anchor: ${intent.anchorHash.substring(0, 16)}...`);
console.log(`  Description: ${intent.description}`);
console.log('');

const result = patcher.applyPatch(initialContent, intent);

if (result.success) {
  console.log('✅ Patch applied successfully!');
  console.log(`Changes: ${result.changes}`);
  console.log('');
  
  // 更新文件
  await writeFile(demoFile, result.newContent, 'utf-8');
  
  // 创建状态图节点
  stateGraph.createNodeFromPatch(initialNode, intent, result.newContent);
  
  console.log('新的 divide 函数:');
  console.log(result.newContent.split('function divide')[1].split('module.exports')[0].trim());
  console.log('');
  
  // 再次修改 - 展示可以跨步骤引用
  console.log('步骤 3: 第二次修改 - 在同一个锚点基础上');
  console.log('-'.repeat(80));
  
  // 重新分析获取新锚点
  const analysis2 = patcher.initializeFile('demo-file.js', result.newContent);
  
  // 查找新的 divide 函数锚点
  let newDivideAnchorHash = null;
  for (const anchor of analysis2.anchors) {
    if (anchor.text.includes('function divide')) {
      newDivideAnchorHash = anchor.hash;
      break;
    }
  }
  
  // 添加注释
  const intent2 = patchBuilder.insertAfter(
    newDivideAnchorHash!,
    '\n// Improved with input validation',
    'Add comment after divide function'
  );
  
  console.log('插入注释在 divide 函数后...');
  const result2 = patcher.applyPatch(result.newContent, intent2);
  
  if (result2.success) {
    await writeFile(demoFile, result2.newContent, 'utf-8');
    stateGraph.createNodeFromPatch(stateGraph.getCurrentHead()!, intent2, result2.newContent);
    console.log('✅ Second patch applied!');
  }
  console.log('');
  
  // 显示状态历史
  console.log('步骤 4: 查询状态历史 (harness_query history)');
  console.log('-'.repeat(80));
  const history = stateGraph.getHistory(5);
  
  console.log('Edit History:');
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const patchInfo = entry.patch 
      ? `${entry.patch.type} ${entry.patch.anchorHash.substring(0, 16)}...`
      : '(initial)';
    console.log(`  [${i}] ${entry.hash.substring(0, 16)}... - ${patchInfo}`);
  }
  console.log('');
  
  // 回滚演示
  console.log('步骤 5: 回滚功能演示 (harness_rollback)');
  console.log('-'.repeat(80));
  
  console.log('Rolling back to initial state...');
  if (stateGraph.rollbackTo(initialNode)) {
    const rolledBackContent = stateGraph.getNodeContent(initialNode);
    await writeFile(demoFile, rolledBackContent!, 'utf-8');
    console.log('✅ Rollback successful!');
  }
  console.log('');
}

console.log('=' . repeat(80));
console.log('  3. 优势总结');
console.log('=' . repeat(80));
console.log('');
console.log('State-Centric Editing 优势:');
console.log('  1. ✅ 编辑成本: O(change size), 而非 O(file size)');
console.log('  2. ✅ 定位稳定: 基于内容哈希, 不依赖行号');
console.log('  3. ✅ 状态连续性: 第四轮可以引用第一轮的锚点');
console.log('  4. ✅ 上下文减少: 无需将完整文件放入上下文');
console.log('  5. ✅ 可回滚: 内置版本控制');
console.log('  6. ✅ 职责分离: 模型只描述变化, Harness 负责执行');
console.log('');

console.log('对比表:');
console.log('  Feature              | Context-Centric | State-Centric');
console.log('---------------------|----------------|----------------');
console.log('  编辑成本            | O(file size)   | O(change size)');
console.log('  定位依赖            | 行号           | 内容哈希');
console.log('  状态连续性          | ❌ 依赖上下文  | ✅ 状态图');
console.log('  上下文要求          | 完整文件       | 锚点+变化');
console.log('  回滚能力            | ❌ 困难        | ✅ 内置');
console.log('  职责分离            | ❌ 模型做全部  | ✅ 分离');
console.log('');

console.log('=' . repeat(80));
console.log('  4. 使用场景总结');
console.log('=' . repeat(80));
console.log('');

console.log('新工具集:');
console.log('  harness_analyze     - 分析文件，创建内容锚点');
console.log('  harness_replace     - 替换锚点内容');
console.log('  harness_insert      - 在锚点后插入内容');
console.log('  harness_delete      - 删除锚点内容');
console.log('  harness_query       - 查询状态/历史/锚点');
console.log('  harness_rollback    - 回滚到之前状态');
console.log('');

console.log('工作流程示例:');
console.log('  1. harness_analyze file.js');
console.log('  2. (查看锚点，确定目标)');
console.log('  3. harness_replace path anchor_hash new_content');
console.log('  4. (可选) harness_query history 查看历史');
console.log('  5. (可选) harness_rollback 回滚');
console.log('');

console.log('=' . repeat(80));
console.log('  演示完成！');
console.log('=' . repeat(80));

// 清理
import { rm } from 'fs/promises';
if (existsSync(testDir)) {
  try {
    await rm(testDir, { recursive: true });
  } catch (e) {
    // 忽略
  }
}
