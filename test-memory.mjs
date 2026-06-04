#!/usr/bin/env bun
/**
 * Agent Memory System Integration Tests
 * 生产级记忆系统的完整测试套件
 */

import { resolve } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import {
  WorkingContext,
  ProjectMemory,
  PatternLearning,
  AgentMemory,
} from './src/memory/agent-memory.js';

const TEST_CONFIG = {
  testDir: resolve(process.cwd(), '.test-memory'),
};

// 确保测试目录存在
if (!existsSync(TEST_CONFIG.testDir)) {
  mkdirSync(TEST_CONFIG.testDir, { recursive: true });
}

// 测试工具函数
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function testWorkingContext() {
  console.log('\n📦 WorkingContext Tests\n' + '─'.repeat(50));
  
  const testDir = resolve(TEST_CONFIG.testDir, 'working-context');
  mkdirSync(testDir, { recursive: true });
  
  const ctx = new WorkingContext(testDir);
  
  // 测试 1: 默认创建
  assert(ctx.getContext().activeFiles.length === 0, 'Should start with empty active files');
  console.log('✅ Default context created');

  // 测试 2: 追踪文件
  ctx.trackFile('src/index.js');
  ctx.trackFile('src/app.js');
  ctx.trackFile('src/index.js'); // 重复追踪
  
  const recent = ctx.getContext().recentFiles;
  assert(recent.length === 2, 'Should track unique files');
  assertEqual(recent[0].path, 'src/index.js', 'Most recent should be first');
  console.log('✅ File tracking works');

  // 测试 3: 设置任务
  ctx.setTask('Implement user authentication', 'implementation');
  const taskCtx = ctx.getContext();
  assertEqual(taskCtx.currentTask, 'Implement user authentication', 'Task should be set');
  assertEqual(taskCtx.taskPhase, 'implementation', 'Phase should be set');
  console.log('✅ Task management works');

  // 测试 4: 添加决策
  ctx.addDecision('Use JWT for authentication', 'Industry standard, stateless');
  ctx.addDecision('Store refresh tokens in httpOnly cookies', 'Security best practice');
  
  const decisions = ctx.getContext().keyDecisions;
  assert(decisions.length === 2, 'Should have 2 decisions');
  assert(decisions[0].reason.includes('Industry standard'), 'Decision should have reason');
  console.log('✅ Decision tracking works');

  // 测试 5: 约束管理
  ctx.addConstraint('Must be backward compatible');
  ctx.addConstraint('API responses must be JSON');
  
  const constraints = ctx.getContext().constraints;
  assert(constraints.length === 2, 'Should have 2 constraints');
  ctx.removeConstraint('Must be backward compatible');
  assert(ctx.getContext().constraints.length === 1, 'Constraint should be removed');
  console.log('✅ Constraint management works');

  // 测试 6: 持久化
  const ctx2 = new WorkingContext(testDir);
  assertEqual(ctx2.getContext().currentTask, 'Implement user authentication', 'Data should persist');
  assertEqual(ctx2.getContext().constraints.length, 1, 'Constraints should persist');
  console.log('✅ Persistence works');

  // 测试 7: 提示生成
  const fragment = ctx.toPromptFragment();
  assert(fragment.includes('Current Task'), 'Should include task in fragment');
  assert(fragment.includes('JWT'), 'Should include decision in fragment');
  console.log('✅ Prompt fragment generation works');

  // 测试 8: 清除
  ctx.clear();
  assertEqual(ctx.getContext().activeFiles.length, 0, 'Should clear all data');
  console.log('✅ Clear works');

  console.log('✅ WorkingContext: All tests passed!\n');
}

async function testProjectMemory() {
  console.log('\n📦 ProjectMemory Tests\n' + '─'.repeat(50));
  
  const testDir = resolve(TEST_CONFIG.testDir, 'project-memory');
  mkdirSync(testDir, { recursive: true });
  
  const memory = new ProjectMemory(testDir);
  
  // 测试 1: 默认创建
  assert(memory.getMemory().projectName, 'Should have project name');
  console.log('✅ Default memory created');

  // 测试 2: 更新结构
  memory.updateStructure({
    language: 'javascript',
    framework: 'react',
    packageManager: 'npm',
    hasTests: true,
  });
  
  const structure = memory.getMemory().structure;
  assertEqual(structure.language, 'javascript', 'Language should be set');
  assertEqual(structure.framework, 'react', 'Framework should be set');
  assert(structure.hasTests, 'Should have tests flag');
  console.log('✅ Structure update works');

  // 测试 3: 文件映射
  memory.addFileMapping('src/App.jsx', 'Main application component', 'component');
  memory.addFileMapping('src/api/users.js', 'User API endpoints', 'api');
  memory.addFileMapping('src/App.jsx', 'Updated purpose', 'component'); // 更新
  
  const fileMap = memory.getMemory().fileMap;
  assert(fileMap.length === 2, 'Should have 2 file mappings');
  assertEqual(fileMap[0].purpose, 'Updated purpose', 'Should update existing mapping');
  console.log('✅ File mapping works');

  // 测试 4: 编码规范
  memory.addConvention('Use camelCase for variable names');
  memory.addConvention('Use PascalCase for component names');
  memory.addConvention('Use camelCase for variable names'); // 重复
  
  const conventions = memory.getMemory().conventions;
  assert(conventions.length === 2, 'Should deduplicate conventions');
  console.log('✅ Conventions work');

  // 测试 5: 项目模式
  memory.addPattern('Use custom hooks for reusable logic', true);
  memory.addPattern('Use context for global state', false);
  
  const patterns = memory.getMemory().patterns;
  assert(patterns.length === 2, 'Should record patterns');
  console.log('✅ Patterns work');

  // 测试 6: API 端点
  memory.addApiEndpoint('GET', '/api/users', 'Get all users');
  memory.addApiEndpoint('POST', '/api/users', 'Create new user');
  memory.addApiEndpoint('GET', '/api/users', 'Duplicate endpoint'); // 重复
  
  const endpoints = memory.getMemory().apiEndpoints;
  assert(endpoints.length === 2, 'Should deduplicate endpoints');
  console.log('✅ API endpoints work');

  // 测试 7: 持久化
  const memory2 = new ProjectMemory(testDir);
  assertEqual(memory2.getMemory().structure.framework, 'react', 'Structure should persist');
  assertEqual(memory2.getMemory().conventions.length, 2, 'Conventions should persist');
  console.log('✅ Persistence works');

  // 测试 8: 提示生成
  const fragment = memory.toPromptFragment();
  assert(fragment.includes('react'), 'Should include framework');
  assert(fragment.includes('camelCase'), 'Should include convention');
  console.log('✅ Prompt fragment works');

  console.log('✅ ProjectMemory: All tests passed!\n');
}

async function testPatternLearning() {
  console.log('\n📦 PatternLearning Tests\n' + '─'.repeat(50));
  
  const testDir = resolve(TEST_CONFIG.testDir, 'patterns');
  mkdirSync(testDir, { recursive: true });
  
  const learning = new PatternLearning(testDir);
  
  // 测试 1: 记录成功
  learning.recordSuccess('Use dependency injection for better testing', 'Easier to mock', 'shell');
  learning.recordSuccess('Write tests before refactoring', 'Prevents regressions');
  
  const successes = learning.getStats();
  assertEqual(successes.successes, 2, 'Should have 2 successes');
  console.log('✅ Success recording works');

  // 测试 2: 记录失败
  learning.recordFailure('Hardcode configuration values', 'Makes deployment inflexible', 'file_write');
  learning.recordFailure('Ignore error handling', 'Leads to silent failures');
  
  const failures = learning.getStats();
  assertEqual(failures.failures, 2, 'Should have 2 failures');
  console.log('✅ Failure recording works');

  // 测试 3: 反模式
  learning.recordAntiPattern('Copy-paste code', 'Duplication leads to maintenance nightmares');
  learning.recordAntiPattern('Premature optimization', 'Complexity without benefit');
  
  const antiPatterns = learning.getStats();
  assertEqual(antiPatterns.antiPatterns, 2, 'Should have 2 anti-patterns');
  console.log('✅ Anti-pattern recording works');

  // 测试 4: 相关模式查询
  const relevant = learning.getRelevantPatterns('testing');
  assert(relevant.length > 0, 'Should find relevant patterns');
  assert(relevant[0].type === 'success', 'Should find success patterns');
  console.log('✅ Pattern query works');

  // 测试 5: 标记使用
  const allPatterns = learning.getRelevantPatterns('injection');
  if (allPatterns.length > 0) {
    learning.markUsed(allPatterns[0].id);
    const afterMark = learning.getRelevantPatterns('injection');
    assertEqual(afterMark[0].usageCount, 1, 'Usage count should increment');
  }
  console.log('✅ Usage tracking works');

  // 测试 6: 提示生成
  const fragment = learning.toPromptFragment();
  assert(fragment.includes('Learned Patterns'), 'Should include pattern section');
  assert(fragment.includes('✅'), 'Should include success icon');
  console.log('✅ Prompt generation works');

  // 测试 7: 带查询的提示
  const queryFragment = learning.toPromptFragment('testing');
  assert(queryFragment.includes('Relevant Patterns'), 'Should include relevant section');
  console.log('✅ Query-based prompt works');

  // 测试 8: 统计
  const stats = learning.getStats();
  assert(stats.successes === 2, 'Should count successes');
  assert(stats.failures === 2, 'Should count failures');
  console.log('✅ Statistics work');

  console.log('✅ PatternLearning: All tests passed!\n');
}

async function testAgentMemory() {
  console.log('\n📦 AgentMemory Integration Tests\n' + '─'.repeat(50));
  
  const testDir = resolve(TEST_CONFIG.testDir, 'agent-memory');
  mkdirSync(testDir, { recursive: true });
  
  const memory = new AgentMemory(testDir);
  
  // 测试 1: 初始化
  await memory.initialize();
  console.log('✅ Initialization works');

  // 测试 2: 获取记忆上下文
  const context = memory.getMemoryContext('Implement user authentication');
  assert(context.length > 0, 'Should return non-empty context');
  console.log('✅ Memory context generation works');

  // 测试 3: 追踪文件
  memory.trackFile('src/auth/Login.jsx');
  const workingCtx = memory.getWorkingContext();
  assert(workingCtx.recentFiles.length === 1, 'Should track file');
  console.log('✅ File tracking integration works');

  // 测试 4: 设置任务
  memory.setTask('Implement user authentication', 'implementation');
  const taskCtx = memory.getWorkingContext();
  assertEqual(taskCtx.currentTask, 'Implement user authentication', 'Task should be set');
  console.log('✅ Task management works');

  // 测试 5: 添加决策
  memory.addDecision('Use OAuth 2.0 for authentication', 'Industry standard');
  const projectMem = memory.getProjectMemory();
  assert(projectMem.patterns.length === 1, 'Decision should create pattern');
  console.log('✅ Decision integration works');

  // 测试 6: 约束
  memory.addConstraint('Must support mobile clients');
  const wCtx = memory.getWorkingContext();
  assert(wCtx.constraints.includes('Must support mobile clients'), 'Constraint should be added');
  console.log('✅ Constraint integration works');

  // 测试 7: 记录成功
  memory.recordSuccess('Use JWT with refresh tokens', 'Secure and scalable');
  const stats = memory.getPatternStats();
  assert(stats.successes === 1, 'Should record success');
  console.log('✅ Success recording works');

  // 测试 8: 记录失败
  memory.recordFailure('Store passwords in plain text', 'Security vulnerability');
  const failStats = memory.getPatternStats();
  assert(failStats.failures === 1, 'Should record failure');
  console.log('✅ Failure recording works');

  // 测试 9: 编码规范
  memory.addConvention('Use async/await over promises');
  const projMem = memory.getProjectMemory();
  assert(projMem.conventions.length === 1, 'Convention should be added');
  console.log('✅ Convention integration works');

  // 测试 10: API 端点
  memory.addApiEndpoint('POST', '/api/auth/login', 'User login');
  const apiMem = memory.getProjectMemory();
  assert(apiMem.apiEndpoints.length === 1, 'API endpoint should be added');
  console.log('✅ API endpoint integration works');

  // 测试 11: 完整记忆上下文
  const fullContext = memory.getMemoryContext();
  assert(fullContext.includes('Project'), 'Should include project info');
  assert(fullContext.includes('OAuth 2.0'), 'Should include decisions');
  assert(fullContext.includes('JWT'), 'Should include patterns');
  console.log('✅ Full memory context works');

  // 测试 12: 清除所有
  memory.clearAll();
  const clearedStats = memory.getPatternStats();
  assertEqual(clearedStats.successes, 0, 'Should clear all successes');
  assertEqual(clearedStats.failures, 0, 'Should clear all failures');
  console.log('✅ Clear all works');

  console.log('✅ AgentMemory: All integration tests passed!\n');
}

async function testMemoryPersistence() {
  console.log('\n📦 Memory Persistence Tests\n' + '─'.repeat(50));
  
  const testDir = resolve(TEST_CONFIG.testDir, 'persistence');
  mkdirSync(testDir, { recursive: true });
  
  // 写入阶段
  const memory1 = new AgentMemory(testDir);
  await memory1.initialize();
  memory1.trackFile('src/main.js');
  memory1.trackFile('src/renderer.js');
  memory1.setTask('Build electron app', 'planning');
  memory1.addDecision('Use electron-forge for packaging', 'Better DX');
  memory1.addConstraint('Support Windows, Mac, Linux');
  memory1.recordSuccess('Use preload scripts for IPC', 'Secure and clean');
  memory1.recordFailure('Expose node APIs to renderer', 'Security risk');
  memory1.addConvention('Use ES modules');
  memory1.addApiEndpoint('GET', '/api/status', 'Check app status');
  
  // 读取阶段（模拟新实例）
  const memory2 = new AgentMemory(testDir);
  await memory2.initialize();
  
  // 验证持久化
  const wCtx = memory2.getWorkingContext();
  assertEqual(wCtx.currentTask, 'Build electron app', 'Task should persist');
  assert(wCtx.recentFiles.length >= 2, 'Recent files should persist');
  assertEqual(wCtx.constraints[0], 'Support Windows, Mac, Linux', 'Constraints should persist');
  
  const pMem = memory2.getProjectMemory();
  assert(pMem.conventions.length === 1, 'Conventions should persist');
  assert(pMem.apiEndpoints.length === 1, 'API endpoints should persist');
  
  const stats = memory2.getPatternStats();
  assertEqual(stats.successes, 1, 'Successes should persist');
  assertEqual(stats.failures, 1, 'Failures should persist');
  
  console.log('✅ Cross-instance persistence works');

  // 验证记忆上下文
  const context = memory2.getMemoryContext();
  assert(context.includes('electron'), 'Should include project info');
  assert(context.includes('Build electron app'), 'Should include task');
  assert(context.includes('electron-forge'), 'Should include decisions');
  assert(context.includes('✅'), 'Should include success patterns');
  console.log('✅ Context recovery works');

  console.log('✅ Memory Persistence: All tests passed!\n');
}

async function runAllTests() {
  console.log('\n' + '═'.repeat(60));
  console.log('   Agent Memory System - Integration Test Suite');
  console.log('═'.repeat(60));
  
  const startTime = Date.now();
  let passed = 0;
  let failed = 0;

  const tests = [
    { name: 'WorkingContext', fn: testWorkingContext },
    { name: 'ProjectMemory', fn: testProjectMemory },
    { name: 'PatternLearning', fn: testPatternLearning },
    { name: 'AgentMemory', fn: testAgentMemory },
    { name: 'MemoryPersistence', fn: testMemoryPersistence },
  ];

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (error) {
      console.error(`❌ ${test.name} failed:`, error.message);
      failed++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('═'.repeat(60));
  console.log(`   Test Summary: ${passed} passed, ${failed} failed (${duration}s)`);
  console.log('═'.repeat(60));

  // 清理测试目录
  try {
    rmSync(TEST_CONFIG.testDir, { recursive: true, force: true });
    console.log('\n🧹 Test directory cleaned up');
  } catch (error) {
    console.error('Failed to clean up test directory:', error.message);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

// 运行测试
runAllTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
