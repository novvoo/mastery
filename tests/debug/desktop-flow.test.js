// 模拟 desktop + runtime + engine 完整流程
import { describe, test, expect } from 'bun:test';
import { bootstrapRuntime } from '../../src/core/runtime/runtime-bootstrap.js';

const workingDir = process.cwd();

describe('Desktop Flow (debug)', () => {
  test('bootstrapRuntime + engine API + processInput without/with modelProvider', async () => {
    // Step 1: bootstrapRuntime
    const runtime = await bootstrapRuntime({
      workingDirectory: workingDir,
      maxIterations: 60,
      debug: false,
      securityPolicy: 'full',
      metrics: { enabled: false },
      modelProvider: null,
    });
    expect(runtime.engine).toBeDefined();
    expect(runtime.toolRegistry).toBeDefined();
    expect(runtime.workspaceState).toBeDefined();

    // Step 2: Engine API 检查
    const engine = runtime.engine;
    expect(typeof engine.getState).toBe('function');
    expect(typeof engine.getTools).toBe('function');
    expect(typeof engine.processInput).toBe('function');
    expect(typeof engine.attachModelProvider).toBe('function');
    expect(engine.getModelProvider()).toBeNull();

    // Step 3: processInput without modelProvider — 应返回错误结果而非抛出
    const resultNoProvider = await engine.processInput('厦门天气', {
      debug: false,
      maxIterations: 60,
      autoSave: true,
    });
    expect(resultNoProvider.success).toBe(false);
    expect(resultNoProvider.status).toBe('error');

    // Step 4: attachModelProvider
    engine.attachModelProvider({
      name: 'mock',
      async chat(messages, options) {
        return { finishReason: 'stop', text: '测试答案', toolCalls: [] };
      },
    });
    expect(engine.getModelProvider()?.name).toBe('mock');

    // Step 5: processInput with modelProvider
    const resultWithProvider = await engine.processInput('厦门天气', {
      debug: false,
      maxIterations: 60,
      autoSave: true,
    });
    expect(resultWithProvider.success).toBe(true);
    expect(typeof resultWithProvider.answer).toBe('string');
  }, 30000);
});
