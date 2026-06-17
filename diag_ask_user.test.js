import { createAgentEngine, RuntimeEvent, getEventBus, resetEventBus } from './src/runtime/index.js';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

describe('Diagnostic Test — ask_user', () => {
  let engine;

  beforeEach(() => {
    resetEventBus();
    const eb = getEventBus();
    eb.clear();
  });

  afterEach(async () => {
    if (engine) {
      await engine.dispose();
      engine = null;
    }
  });

  it('应该在 ask_user 请求补充信息时停在等待用户输入状态', async () => {
    engine = createAgentEngine({ workingDirectory: '/tmp/diag', maxIterations: 3 });
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
              reason: '缺少验收标准，继续实现会引入猜测。',
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
    console.log('[DIAG] result.status =', result?.status);
    console.log('[DIAG] result.success =', result?.success);
    console.log('[DIAG] result.answer (first 200) =', result?.answer?.substring(0, 200));
    console.log('[DIAG] state.status =', engine.getState().status);
    console.log('[DIAG] userInputRequest =', JSON.stringify(result?.userInputRequest).substring(0, 300));

    expect(result.status).toBe('needs_user_input');
  });
});
