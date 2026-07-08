import { describe, test, expect } from 'bun:test';

// Import the function we're testing
let normalizeRuntimeEventMessage;

try {
  const mod = await import('../../desktop/renderer/hooks/useRuntime.js');
  normalizeRuntimeEventMessage = mod.normalizeRuntimeEventMessage;
} catch {
  // Fallback: define inline if import fails in test runner
}

describe('normalizeRuntimeEventMessage', () => {
  // ========== status:update — 胶囊展开的关键事件 ==========

  test('status:update with needs_user_input returns message with info type (without answer field)', () => {
    const result = normalizeRuntimeEventMessage('status:update', {
      status: 'needs_user_input',
      level: 'info',
      message: '需要你补充一点信息后继续',
      data: { reason: 'test', questions: ['q1'] },
    });
    // status:update 有专门的 case 分支，返回 { message: { type: info, content: '...' } }
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('info');
    expect(result.message.content).toContain('需要你补充一点信息后继续');
  });

  test('status:update with needs_user_input and answer field returns result type', () => {
    const result = normalizeRuntimeEventMessage('status:update', {
      status: 'needs_user_input',
      level: 'info',
      message: '需要你补充一点信息后继续',
      answer: '请告诉我你的选择',
      data: { reason: 'test', questions: ['q1'] },
    });
    // 当 payload 包含 answer 时，status:update 返回 event:agent:complete 风格的 result
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('result');
    expect(result.message.event).toBe('agent:complete');
    expect(result.message.content).toBe('请告诉我你的选择');
  });

  test('status:update with running returns message', () => {
    const result = normalizeRuntimeEventMessage('status:update', {
      status: 'running',
    });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    // level 不存在时 type 为 'info'
    expect(result.message.type).toBe('info');
  });

  test('status:update with completed returns message', () => {
    const result = normalizeRuntimeEventMessage('status:update', {
      status: 'completed',
      message: '任务完成',
      level: 'success',
    });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('success');
    expect(result.message.content).toContain('任务完成');
  });

  test('status:update with error returns message', () => {
    const result = normalizeRuntimeEventMessage('status:update', {
      status: 'error',
      message: '发生错误',
      level: 'error',
    });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('error');
    expect(result.message.content).toContain('发生错误');
  });

  test('status:update always returns a message (IPC handler must check eventName directly, not rely on normalized.message)', () => {
    // 验证：对任何 status:update 事件，normalized.message 都存在
    // 这意味着 if (normalized.message) 守卫不能过滤掉 status:update
    const cases = [
      { status: 'needs_user_input', message: '等待输入', level: 'info' },
      { status: 'running' },
      { status: 'completed', message: '完成', level: 'success' },
      { status: 'error', message: '错误', level: 'error' },
    ];
    for (const payload of cases) {
      const result = normalizeRuntimeEventMessage('status:update', payload);
      expect(result).toBeDefined();
      expect(result.message).toBeDefined();
    }
  });

  // ========== 其他事件正常返回 — 回归确认 ==========

  test('agent:start returns message with agent type', () => {
    const result = normalizeRuntimeEventMessage('agent:start', { task: 'test task' });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('agent');
    expect(result.message.content).toContain('test task');
  });

  test('agent:complete with needs_user_input status returns warning type', () => {
    const result = normalizeRuntimeEventMessage('agent:complete', {
      answer: '需要你补充信息',
      result: { status: 'needs_user_input' },
    });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('warning');
    expect(result.message.content).toContain('需要你补充信息');
  });

  test('agent:complete with normal answer returns result type', () => {
    const result = normalizeRuntimeEventMessage('agent:complete', {
      answer: '任务已全部完成',
    });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('result');
    expect(result.message.content).toContain('任务已全部完成');
  });

  test('agent:complete with no answer returns success type with default text', () => {
    const result = normalizeRuntimeEventMessage('agent:complete', {});
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('success');
    expect(result.message.content).toContain('任务执行完成');
  });

  test('agent:error returns error type', () => {
    const result = normalizeRuntimeEventMessage('agent:error', { error: 'Timeout' });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('error');
    expect(result.message.content).toContain('Timeout');
  });

  test('agent:stop returns warning type', () => {
    const result = normalizeRuntimeEventMessage('agent:stop', {});
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('warning');
    expect(result.message.content).toContain('已停止');
  });

  test('tool:call returns stats.toolCall and tool type', () => {
    const result = normalizeRuntimeEventMessage('tool:call', {
      name: 'read_file',
      args: { path: 'test.js' },
    });
    expect(result).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.stats.toolCall).toBe(true);
    expect(result.message.type).toBe('tool');
    expect(result.message.toolName).toBe('read_file');
  });

  test('tool:result returns tool_result type', () => {
    const result = normalizeRuntimeEventMessage('tool:result', {
      name: 'read_file',
      result: 'file content',
    });
    expect(result).toBeDefined();
    expect(result.message.type).toBe('tool_result');
    expect(result.message.result).toBe('file content');
  });

  test('tool:error returns error type', () => {
    const result = normalizeRuntimeEventMessage('tool:error', {
      name: 'edit_file',
      error: 'old_text not found',
    });
    expect(result).toBeDefined();
    expect(result.message.type).toBe('error');
    expect(result.message.content).toContain('old_text not found');
  });

  test('tool:activity returns event type', () => {
    const result = normalizeRuntimeEventMessage('tool:activity', {
      statusText: '正在构建...',
    });
    expect(result).toBeDefined();
    expect(result.message.type).toBe('event');
    expect(result.message.content).toContain('正在构建');
  });

  test('plan:created returns type plan', () => {
    const result = normalizeRuntimeEventMessage('plan:created', {
      planId: 'plan-123',
      taskCount: 3,
    });
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.type).toBe('plan');
    expect(result.message.planId).toBe('plan-123');
  });

  test('unknown event returns default message', () => {
    const result = normalizeRuntimeEventMessage('unknown:event', {});
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.event).toBe('unknown:event');
  });

  test('workspace:changed returns message: null', () => {
    const result = normalizeRuntimeEventMessage('workspace:changed', {});
    expect(result).toBeDefined();
    expect(result.message).toBeNull();
  });

  // ========== 边界情况 ==========

  test('handles null payload gracefully', () => {
    const result = normalizeRuntimeEventMessage('tool:result', null);
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
  });

  test('handles undefined payload gracefully', () => {
    const result = normalizeRuntimeEventMessage('agent:start', undefined);
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
  });

  test('handles empty string event name', () => {
    const result = normalizeRuntimeEventMessage('', {});
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    // 空字符串走 default 分支，返回 event 类型
    expect(result.message.type).toBe('event');
  });
});
