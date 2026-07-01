import { describe, expect, test } from 'bun:test';
import {
  mergePlanMessageList,
  normalizeRuntimeEventMessage,
  safeStringify,
} from '../desktop/renderer/hooks/useRuntime.js';

describe('runtime event normalization', () => {
  test('safeStringify handles circular payloads without throwing', () => {
    const payload = { name: 'root' };
    payload.self = payload;

    const text = safeStringify(payload, { space: 2 });

    expect(text).toContain('"name": "root"');
    expect(text).toContain('[Circular]');
  });

  test('safeStringify handles BigInt, functions, and truncation', () => {
    const text = safeStringify(
      {
        count: 10n,
        handler() {},
        long: 'x'.repeat(80),
      },
      { maxChars: 60 },
    );

    expect(text).toContain('"10"');
    expect(text).toContain('[Function handler]');
    expect(text).toContain('truncated');
  });

  test('normalizeRuntimeEventMessage does not crash on circular tool payload', () => {
    const payload = {
      toolName: 'read_file',
      activity: { phase: 'running' },
    };
    payload.activity.parent = payload;

    const normalized = normalizeRuntimeEventMessage('tool:call', payload);

    expect(normalized.stats.toolCall).toBe(true);
    expect(normalized.message.type).toBe('tool');
    expect(normalized.message.payloadSummary).toContain('[Circular]');
    expect(normalized.message.details).toContain('[Circular]');
  });

  test('normalizeRuntimeEventMessage renders execution plan events as plan messages', () => {
    const normalized = normalizeRuntimeEventMessage('plan:created', {
      plan: {
        id: 'plan_123',
        name: 'Automatic coding task plan',
        tasks: [
          { id: 'inspect_workspace', name: 'Inspect workspace', status: 'completed' },
          { id: 'implement_changes', name: 'Implement changes', status: 'running' },
          { id: 'verify_result', name: 'Verify result', status: 'pending' },
        ],
      },
      summary: '- inspect_workspace: completed\n- implement_changes: running',
    });

    expect(normalized.message.type).toBe('plan');
    expect(normalized.message.planId).toBe('plan_123');
    expect(normalized.message.planKey).toBe('plan_123');
    expect(normalized.message.runtimeDetail).toBeUndefined();
    expect(normalized.message.planTasks).toHaveLength(3);
    expect(normalized.message.planProgress).toMatchObject({
      total: 3,
      completed: 1,
      running: 1,
      progress: 33,
    });
  });

  test('mergePlanMessageList keeps planning and plan updates in one dynamic bubble', () => {
    const first = normalizeRuntimeEventMessage('plan:updated', {
      plan: {
        tasks: [{ id: 'planning', name: '规划任务', status: 'running' }],
      },
      summary: '正在规划',
    }).message;
    const second = normalizeRuntimeEventMessage('plan:updated', {
      plan: {
        id: 'plan_real',
        tasks: [
          { id: 'planning', name: '规划任务', status: 'completed' },
          { id: 'implement', name: '实现', status: 'running' },
        ],
      },
      summary: '执行计划已更新',
    }).message;

    const messages = mergePlanMessageList(mergePlanMessageList([], first), second);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('plan');
    expect(messages[0].planKey).toBe('plan_real');
    expect(messages[0].planSnapshots).toHaveLength(2);
    expect(messages[0].planTasks).toHaveLength(2);
  });

  test('mergePlanMessageList keeps distinct real plans separated', () => {
    const first = normalizeRuntimeEventMessage('plan:created', {
      plan: { id: 'plan_one', tasks: [] },
    }).message;
    const second = normalizeRuntimeEventMessage('plan:created', {
      plan: { id: 'plan_two', tasks: [] },
    }).message;

    const messages = mergePlanMessageList(mergePlanMessageList([], first), second);

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.planKey)).toEqual(['plan_one', 'plan_two']);
  });

  test('normalizeRuntimeEventMessage extracts assistant content from common response shapes', () => {
    const direct = normalizeRuntimeEventMessage('agent:complete', {
      content: '来自 content 的回复',
    });
    const choice = normalizeRuntimeEventMessage('agent:complete', {
      choices: [{ message: { content: '来自 choices 的回复' } }],
    });
    const finalAnswer = normalizeRuntimeEventMessage('agent:complete', {
      result: { finalAnswer: '来自 finalAnswer 的回复' },
    });

    expect(direct.message.type).toBe('result');
    expect(direct.message.content).toBe('来自 content 的回复');
    expect(choice.message.type).toBe('result');
    expect(choice.message.content).toBe('来自 choices 的回复');
    expect(finalAnswer.message.type).toBe('result');
    expect(finalAnswer.message.content).toBe('来自 finalAnswer 的回复');
  });

  test('normalizeRuntimeEventMessage renders completed status answers as assistant results', () => {
    const normalized = normalizeRuntimeEventMessage('status:update', {
      status: 'completed',
      answer: '这是最终回复',
    });

    expect(normalized.message.event).toBe('agent:complete');
    expect(normalized.message.type).toBe('result');
    expect(normalized.message.content).toBe('这是最终回复');
  });
});
