import { describe, expect, test } from 'bun:test';
import {
  extractReasoningFromChoice,
  summarizeReasoning,
} from '../../src/models/reasoning-response.js';

describe('reasoning response helpers', () => {
  test('extracts reasoning content from OpenAI-compatible message fields', () => {
    const reasoning = extractReasoningFromChoice({
      message: {
        content: 'final',
        reasoning_content: '先检查上下文，再决定下一步。',
      },
    });

    expect(reasoning).toMatchObject({
      text: '先检查上下文，再决定下一步。',
      summary: '先检查上下文，再决定下一步。',
      details: [],
    });
  });

  test('extracts reasoning details when direct text is absent', () => {
    const reasoning = extractReasoningFromChoice({
      message: {
        reasoning_details: [
          { type: 'summary', summary: '分析输入' },
          { type: 'summary', summary: '调用工具' },
        ],
      },
    });

    expect(reasoning.text).toContain('分析输入');
    expect(reasoning.text).toContain('调用工具');
    expect(reasoning.details).toHaveLength(2);
  });

  test('returns null when no reasoning is present and truncates long summaries', () => {
    expect(extractReasoningFromChoice({ message: { content: 'final' } })).toBeNull();
    expect(summarizeReasoning('x'.repeat(220))).toHaveLength(160);
  });
});
