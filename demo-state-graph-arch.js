#!/usr/bin/env node
/**
 * State Graph Architecture Demo
 * 
 * 展示 State Graph 核心思想：
 * - 将状态从 Token Context 提升为 Runtime 维护的 State Graph
 * - Context Projection 是状态图在当前任务下的局部视图
 */

import { ContentAddressableStore, StateGraph } from './src/core/harness/state-graph-core';
import { CompleteIndex } from './src/core/harness/content-addressable-store';
import { ContextProjectionGenerator } from './src/core/harness/context-projection';
import { writeFile, mkdir, existsSync } from 'fs/promises';
import { join, resolve } from 'path';

console.log('='.repeat(80));
console.log('  State Graph Architecture Demo');
console.log('='.repeat(80));
console.log('');

// 创建演示项目
const demoDir = resolve('./demo-state-graph');

async function setupDemo() {
  if (!existsSync(demoDir)) {
    await mkdir(demoDir);
  }
  
  // 创建示例文件
  const files = {
    'math.js': `export function add(a, b) {
  return a + b;
}

export function multiply(a, b) {
  return a * b;
}

export function square(x) {
  return multiply(x, x);
}
`,
    'calculator.js': `import { add, square } from './math.js';

export function computeArea(width, height) {
  return multiply(width, height);
}

export function computeHypotenuse(a, b) {
  const a2 = square(a);
  const b2 = square(b);
  return Math.sqrt(add(a2, b2));
}
`,
    'README.md': `# Calculator Demo

A simple calculator library demonstrating State Graph.
`
  };
  
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(demoDir, name), content, 'utf-8');
  }
  
  console.log('✅ Demo project created at', demoDir);
  console.log();
}

async function runDemo() {
  await setupDemo();
  
  console.log('─'.repeat(80));
  console.log('1. Initializing State Graph');
  console.log('─'.repeat(80));
  console.log();
  
  // 初始化
  const store = new ContentAddressableStore();
  const graph = new StateGraph(store);
  const index = new CompleteIndex(store);
  const projection = new ContextProjectionGenerator(graph, index);
  
  // 初始化状态图
  const initialCommit = graph.initialize({
    project: 'Calculator Demo',
    created: new Date().toISOString()
  });
  
  console.log('✅ State Graph initialized');
  console.log('   Initial commit:', initialCommit.substring(0, 16), '...');
  console.log();
  
  // 索引项目
  console.log('─'.repeat(80));
  console.log('2. Indexing Project (Building State Graph)');
  console.log('─'.repeat(80));
  console.log();
  
  const result = await index.indexProject(demoDir);
  
  console.log('✅ Indexing complete');
  console.log('   Files:', result.filesIndexed);
  console.log('   Symbols:', result.symbolsFound);
  console.log('   Dependencies:', result.dependenciesFound);
  console.log();
  
  const stats = index.getStats();
  console.log('Store objects:', stats.objects);
  console.log();
  
  // 查找符号
  console.log('─'.repeat(80));
  console.log('3. Finding Symbols in State Graph');
  console.log('─'.repeat(80));
  console.log();
  
  const addFunc = index.symbols.findByName('add');
  console.log('Found symbol "add":');
  console.log('  Name:', addFunc[0]?.name);
  console.log('  Type:', addFunc[0]?.type);
  console.log('  File:', addFunc[0]?.file);
  console.log('  Lines:', addFunc[0]?.startLine, '-', addFunc[0]?.endLine);
  console.log();
  
  // 分析依赖
  console.log('─'.repeat(80));
  console.log('4. Analyzing Dependencies');
  console.log('─'.repeat(80));
  console.log();
  
  const impact = index.dependencies.analyzeImpact(join(demoDir, 'math.js'));
  console.log('Impact analysis for "math.js":');
  console.log('  Direct dependencies:', impact.directDeps.length);
  console.log('  Direct dependents:', impact.dependents.length);
  console.log('  Transitive dependencies:', impact.transitiveDeps.length);
  console.log('  Transitive dependents:', impact.transitiveDependents.length);
  console.log();
  
  // 创建投影
  console.log('─'.repeat(80));
  console.log('5. Creating Context Projection');
  console.log('─'.repeat(80));
  console.log();
  
  const projectForEdit = projection.projectSmart('edit', {
    filePath: join(demoDir, 'calculator.js')
  });
  
  console.log('Context Projection for editing:');
  console.log('─'.repeat(40));
  console.log(projectForEdit.substring(0, 800));
  console.log('─'.repeat(40));
  console.log('');
  
  // 提交一些变更
  console.log('─'.repeat(80));
  console.log('6. Making Changes & Committing');
  console.log('─'.repeat(80));
  console.log();
  
  const changes = [
    { type: 'update', nodeId: 'file:math.js' }
  ];
  
  const commit1 = graph.commit(changes, 'Update math.js', 'demo-agent');
  
  console.log('Commit 1 created:', commit1.substring(0, 16), '...');
  console.log('  Message: "Update math.js"');
  console.log();
  
  const commit2 = graph.commit(
    [{ type: 'add', nodeId: 'feature:new-function' }],
    'Add new feature',
    'demo-agent'
  );
  
  console.log('Commit 2 created:', commit2.substring(0, 16), '...');
  console.log('  Message: "Add new feature"');
  console.log();
  
  // 查看历史
  console.log('─'.repeat(80));
  console.log('7. Viewing State Graph History');
  console.log('─'.repeat(80));
  console.log();
  
  const history = graph.getHistory(10);
  
  console.log('State Graph history:');
  for (const node of history) {
    const date = new Date(node.timestamp).toLocaleTimeString();
    console.log(`  [${node.id.substring(0, 8)}] ${date} - ${node.data?.message || 'Commit'}`);
  }
  console.log();
  
  // 回滚演示
  console.log('─'.repeat(80));
  console.log('8. Rolling Back State');
  console.log('─'.repeat(80));
  console.log();
  
  const rollbackSuccess = graph.rollbackTo(initialCommit);
  if (rollbackSuccess) {
    console.log('✅ Rollback successful');
    console.log('   Rolled back to initial commit');
  } else {
    console.log('❌ Rollback failed');
  }
  console.log();
  
  console.log('─'.repeat(80));
  console.log('  Demo Complete!');
  console.log('─'.repeat(80));
  console.log();
  console.log('Key takeaways:');
  console.log('');
  console.log('1. State Graph is the source of truth (NOT Token Context)');
  console.log('2. Context Projection is just a local view of State Graph');
  console.log('3. Content addressing provides stable object identities');
  console.log('4. All changes are tracked in the State Graph history');
  console.log();
  console.log('Read STATE_GRAPH_ARCHITECTURE.md for more details.');
  console.log('='.repeat(80));
}

runDemo().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
