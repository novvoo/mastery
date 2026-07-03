// 模拟 desktop + runtime + engine 完整流程
import { bootstrapRuntime } from '../../src/core/runtime/runtime-bootstrap.js';

const workingDir = process.cwd();

console.log('=== Step 1: bootstrapRuntime ===');
const runtime = await bootstrapRuntime({
  workingDirectory: workingDir,
  maxIterations: 60,
  debug: false,
  securityPolicy: 'full',
  metrics: { enabled: false },
  modelProvider: null,
});
console.log('engine exists:', !!runtime.engine);
console.log('toolRegistry size:', runtime.toolRegistry.size);
console.log('workspaceState exists:', !!runtime.workspaceState);

console.log('\n=== Step 2: Engine API 检查 ===');
const engine = runtime.engine;
console.log('has getState:', typeof engine.getState === 'function');
console.log('has getTools:', typeof engine.getTools === 'function');
console.log('has processInput:', typeof engine.processInput === 'function');
console.log('has attachModelProvider:', typeof engine.attachModelProvider === 'function');
console.log('current modelProvider:', engine.getModelProvider());

console.log('\n=== Step 3: processInput without modelProvider ===');
try {
  const result = await engine.processInput('厦门天气', {
    debug: false,
    maxIterations: 60,
    autoSave: true,
  });
  console.log('result:', JSON.stringify(result).substring(0, 400));
} catch (err) {
  console.log('ERROR:', err.message);
}

console.log('\n=== Step 4: attachModelProvider ===');
engine.attachModelProvider({
  name: 'mock',
  async chat(messages, options) {
    return { finishReason: 'stop', text: '测试答案', toolCalls: [] };
  },
});
console.log('modelProvider now:', engine.getModelProvider()?.name || 'null');

console.log('\n=== Step 5: processInput with modelProvider ===');
try {
  const result = await engine.processInput('厦门天气', {
    debug: false,
    maxIterations: 60,
    autoSave: true,
  });
  console.log('success:', result.success);
  console.log('status:', result.status);
  console.log('answer:', (result.answer || '').substring(0, 200));
  console.log('iterations:', result.iterations);
} catch (err) {
  console.log('ERROR:', err.message);
  console.log('STACK:', err.stack);
}
