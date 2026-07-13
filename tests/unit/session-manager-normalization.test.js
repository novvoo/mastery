import { describe, expect, test } from 'bun:test';
import { normalizeOmpSessionMessages } from '../../desktop/renderer/hooks/useSessionManager.js';

describe('normalizeOmpSessionMessages', () => {
  test('converts OMP user and assistant content blocks for the renderer', () => {
    const result = normalizeOmpSessionMessages([
      { role: 'user', content: [{ type: 'text', text: '修复测试' }] },
      { role: 'assistant', content: [{ type: 'text', text: '已经完成' }] },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('input');
    expect(result[0].content).toBe('用户输入: 修复测试');
    expect(result[1].type).toBe('result');
    expect(result[1].content).toBe('已经完成');
  });

  test('preserves renderer-native messages', () => {
    const message = { id: 'existing', type: 'result', content: 'ok' };
    expect(normalizeOmpSessionMessages([message])[0]).toBe(message);
  });
});
