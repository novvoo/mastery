import { describe, expect, test } from 'bun:test';
import {
  extractReasoningFromChoice,
  summarizeReasoning,
} from '../../src/models/reasoning-response.js';

describe('reasoning-response integration', () => {
  // --- extractReasoningFromChoice edge cases ---

  test('picks message.reasoning_content over message.thinking', () => {
    const result = extractReasoningFromChoice({
      message: {
        reasoning_content: 'from reasoning_content',
        thinking: 'from thinking',
      },
    });
    expect(result.text).toBe('from reasoning_content');
  });

  test('falls back to choice-level reasoning fields', () => {
    const result = extractReasoningFromChoice({
      message: {},
      reasoning: 'choice-level reasoning',
    });
    expect(result.text).toBe('choice-level reasoning');
  });

  test('prefers direct text over details text', () => {
    const result = extractReasoningFromChoice({
      message: {
        reasoning_content: 'direct text',
        reasoning_details: [{ type: 'text', text: 'detail text' }],
      },
    });
    expect(result.text).toBe('direct text');
    expect(result.details).toHaveLength(1);
  });

  test('normalizes string details into { type: "text", text } objects', () => {
    const result = extractReasoningFromChoice({
      message: {
        reasoning_details: ['step one', 'step two'],
      },
    });
    expect(result.details).toEqual([
      { type: 'text', text: 'step one' },
      { type: 'text', text: 'step two' },
    ]);
  });

  test('filters out null/invalid detail entries', () => {
    const result = extractReasoningFromChoice({
      message: {
        reasoning_details: [null, undefined, 42, { type: 'valid', text: 'ok' }],
      },
    });
    expect(result.details).toHaveLength(1);
    expect(result.details[0].text).toBe('ok');
  });

  test('detail objects with missing text/content/reasoning yield empty text', () => {
    const result = extractReasoningFromChoice({
      message: {
        reasoning_details: [{ type: 'reasoning' }],
      },
    });
    // detail text will be empty string via firstNonEmptyString, filter(Boolean) removes it
    expect(result.details).toHaveLength(1);
    expect(result.details[0].text).toBe('');
  });

  test('returns null when no reasoning content is present', () => {
    expect(extractReasoningFromChoice({ message: {} })).toBeNull();
    // extractReasoningFromChoice defaults choice to {}, so these work
    expect(extractReasoningFromChoice({})).toBeNull();
  });

  test('handles empty string reasoning fields (treated as absent)', () => {
    const result = extractReasoningFromChoice({
      message: { reasoning_content: '   ' },
    });
    // whitespace-only strings are trimmed to empty by firstNonEmptyString
    expect(result).toBeNull();
  });

  // --- summarizeReasoning edge cases ---

  test('returns empty string for empty input', () => {
    expect(summarizeReasoning('')).toBe('');
    // null becomes "null" via String()
    expect(summarizeReasoning(null)).toBe('null');
    // undefined uses default param text=''
    expect(summarizeReasoning(undefined)).toBe('');
  });

  test('returns text unchanged if 160 chars or fewer', () => {
    const short = 'a'.repeat(160);
    expect(summarizeReasoning(short)).toBe(short);
  });

  test('truncates to 157 chars + "..." for text > 160 chars', () => {
    const long = 'x'.repeat(200);
    const result = summarizeReasoning(long);
    expect(result).toHaveLength(160);
    expect(result.endsWith('...')).toBe(true);
    expect(result.slice(0, 157)).toBe('x'.repeat(157));
  });

  test('collapses whitespace before truncating', () => {
    const spaced = 'a   b   c';
    expect(summarizeReasoning(spaced)).toBe('a b c');
  });

  // --- combined integration: extract + summarize pipeline ---

  test('summary field is derived from extracted text', () => {
    const longReasoning = 'r'.repeat(200);
    const result = extractReasoningFromChoice({
      message: { reasoning_content: longReasoning },
    });
    expect(result.text).toBe(longReasoning);
    expect(result.summary).toBe(summarizeReasoning(longReasoning));
    expect(result.summary).toHaveLength(160);
  });

  test('summary from details text when no direct text', () => {
    const result = extractReasoningFromChoice({
      message: {
        reasoning_details: [
          { type: 'text', text: 'detail one' },
          { type: 'text', text: 'detail two' },
        ],
      },
    });
    expect(result.text).toContain('detail one');
    expect(result.text).toContain('detail two');
    // summarizeReasoning collapses whitespace
    expect(result.summary).toBe(summarizeReasoning(result.text));
  });
});
