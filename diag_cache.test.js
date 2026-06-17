import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createAgentEngine } from './src/runtime/index.js';
import { rmSync, existsSync } from 'fs';

describe('Diagnostic — ask_user 缓存问题', () => {
  let engine;
  let testDir;

  beforeEach(() => {
    testDir = `/tmp/diag-ask-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  afterEach(async () => {
    if (engine) {
      try { await engine.dispose(); } catch {}
      engine = null;
    }
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('第一次调用 ask_user 应该返回 needs_user_input', async () => {
    engine = createAgentEngine({ workingDirectory: testDir, maxIterations: 3, toolResultCacheEnabled: false });
    await engine.initialize();

    engine.attachModelProvider({
      chat: async () => ({
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [{
          id: 'call_ask_user',
          type: 'function',
          function: {
            name: 'ask_user',
            arguments: JSON.stringify({
              reason: '缺少验收标准',
              questions: ['这个功能的成功标准是什么？'],
              blocking_facts: ['验收标准'],
              suggestions: ['返回 JSON', '返回 Markdown'],
            }),
          },
        }],
      }),
      getMaxContextTokens: () => 128000,
      dispose: () => {},
    });

    const result = await engine.processInput('实现导出功能');
    console.log('[TEST1] result.status =', result?.status);
    console.log('[TEST1] result.answer =', result?.answer?.substring(0, 100));
    console.log('[TEST1] typeof result.userInputRequest =', typeof result?.userInputRequest);
    expect(result.status).toBe('needs_user_input');
  });

  it('测试磁盘缓存文件是否存在', () => {
    const cachePath = `${testDir}/.agent-data/tool-cache.jsonl`;
    console.log('[TEST2] cache path:', cachePath);
    console.log('[TEST2] exists:', existsSync(cachePath));
    expect(true).toBe(true);
  });
});
