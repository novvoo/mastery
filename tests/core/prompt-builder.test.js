import { describe, test, expect } from 'bun:test';
import { PromptBuilder, buildToolSyntaxCorrectionPrompt, buildToolUseCorrectionPrompt, buildCodingTaskOperatingPrompt, buildCodingCompletionGatePrompt, buildSemanticRiskGuidance, isTermination, extractFinalAnswer, normalizeFinalAnswer, containsUnparsedToolSyntax, shouldCorrectToolRefusal, shouldBlockCodingFinal } from '../../src/core/prompt-builder.js';

describe('PromptBuilder', () => {
  test('PromptBuilder is an object with all methods', () => {
    expect(PromptBuilder).toBeDefined();
    expect(typeof PromptBuilder.buildToolSyntaxCorrectionPrompt).toBe('function');
    expect(typeof PromptBuilder.buildToolUseCorrectionPrompt).toBe('function');
    expect(typeof PromptBuilder.isTermination).toBe('function');
    expect(typeof PromptBuilder.extractFinalAnswer).toBe('function');
  });
});

describe('buildToolSyntaxCorrectionPrompt', () => {
  test('returns correction prompt with tool names', () => {
    const toolRegistry = { getAll: () => [{ name: 'read_file' }, { name: 'write_file' }] };
    const result = buildToolSyntaxCorrectionPrompt(null, toolRegistry, 'bad tool call');
    expect(result).toContain('read_file');
    expect(result).toContain('FINAL_ANSWER');
  });

  test('includes diagnosis when parser detects malformed call', () => {
    const toolParser = {
      detectMalformedToolCall: () => ({ tag: 'unclosed', opening: '<tool>', closing: null, hint: 'missing closing tag' }),
    };
    const toolRegistry = { getAll: () => [] };
    const result = buildToolSyntaxCorrectionPrompt(toolParser, toolRegistry, 'some text');
    expect(result).toContain('unclosed');
  });
});

describe('buildToolUseCorrectionPrompt', () => {
  test('returns correction prompt with available tools', () => {
    const toolRegistry = { getAll: () => [{ name: 'shell' }] };
    const result = buildToolUseCorrectionPrompt(toolRegistry, 'run ls');
    expect(result).toContain('shell');
    expect(result).toContain('run ls');
  });
});

describe('buildCodingTaskOperatingPrompt', () => {
  test('returns operating prompt', () => {
    const result = buildCodingTaskOperatingPrompt('fix the bug');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('buildCodingCompletionGatePrompt', () => {
  test('returns gate prompt', () => {
    const result = buildCodingCompletionGatePrompt('fix bug', { reason: 'no verification' });
    expect(typeof result).toBe('string');
  });
});

describe('buildSemanticRiskGuidance', () => {
  test('returns empty string for no domains', () => {
    const result = buildSemanticRiskGuidance([]);
    expect(result).toBe('');
  });

  test('returns guidance for risk domains', () => {
    const domains = [{ label: 'API Surface', checklist: ['check API compatibility'] }];
    const result = buildSemanticRiskGuidance(domains);
    expect(typeof result).toBe('string');
  });
});

describe('isTermination', () => {
  test('returns false for null/undefined', () => {
    expect(isTermination(null)).toBe(false);
    expect(isTermination(undefined)).toBe(false);
  });

  test('returns true for FINAL_ANSWER keyword', () => {
    expect(isTermination('FINAL_ANSWER: done')).toBe(true);
  });

  test('returns true for whitespace-only string', () => {
    expect(isTermination('   ')).toBe(true);
  });

  test('returns false for normal text', () => {
    expect(isTermination('working on it')).toBe(false);
  });
});

describe('extractFinalAnswer', () => {
  test('extracts answer after keyword', () => {
    expect(extractFinalAnswer('FINAL_ANSWER: 42')).toContain('42');
  });

  test('returns trimmed text without keyword', () => {
    expect(extractFinalAnswer('  hello  ')).toBe('hello');
  });

  test('returns empty for null', () => {
    expect(extractFinalAnswer(null)).toBe('');
  });
});

describe('normalizeFinalAnswer', () => {
  test('extracts text from JSON with text field', () => {
    const result = normalizeFinalAnswer(JSON.stringify({ text: 'extracted' }));
    expect(result).toBe('extracted');
  });

  test('extracts answer from JSON with answer field', () => {
    const result = normalizeFinalAnswer(JSON.stringify({ answer: 'my answer' }));
    expect(result).toBe('my answer');
  });

  test('returns trimmed plain text', () => {
    expect(normalizeFinalAnswer('  plain text  ')).toBe('plain text');
  });
});

describe('containsUnparsedToolSyntax', () => {
  test('detects tool_code blocks', () => {
    expect(containsUnparsedToolSyntax(null, '<tool_code>test</tool_code>')).toBe(true);
  });

  test('detects action tags', () => {
    expect(containsUnparsedToolSyntax(null, '<action>{"action":"web_search","query":"厦门天气"}</action>')).toBe(true);
  });

  test('returns false for normal text', () => {
    expect(containsUnparsedToolSyntax(null, 'Hello World')).toBe(false);
  });

  test('detects via parser if available', () => {
    const parser = { detectMalformedToolCall: () => ({ tag: 'test' }) };
    expect(containsUnparsedToolSyntax(parser, 'some text')).toBe(true);
  });

  test('returns false when parser finds nothing', () => {
    const parser = { detectMalformedToolCall: () => null };
    expect(containsUnparsedToolSyntax(parser, 'normal text')).toBe(false);
  });
});

describe('shouldCorrectToolRefusal', () => {
  test('returns false for empty registry', () => {
    expect(shouldCorrectToolRefusal({ size: 0 }, 'list files', 'cannot do that')).toBe(false);
  });

  test('returns true when user asks local ops and AI refuses', () => {
    expect(shouldCorrectToolRefusal(
      { size: 5, getAll: () => [] },
      'list files in current directory',
      'I cannot access the local filesystem'
    )).toBe(true);
  });

  test('returns false when not asking local ops', () => {
    expect(shouldCorrectToolRefusal(
      { size: 5, getAll: () => [] },
      'tell me about quantum physics',
      'I cannot access the filesystem'
    )).toBe(false);
  });
});

describe('shouldBlockCodingFinal', () => {
  test('does not block non-modification tasks', () => {
    const result = shouldBlockCodingFinal('fix bug', 'FINAL_ANSWER: done', { taskProfile: { isModificationTask: false } });
    expect(result.block).toBe(false);
  });

  test('blocks modification task without tool evidence', () => {
    const result = shouldBlockCodingFinal('fix bug', 'FINAL_ANSWER: done', {
      taskProfile: { isModificationTask: true },
      toolEvents: [],
    });
    expect(result.block).toBe(true);
  });

  test('does not block when tool evidence exists', () => {
    const result = shouldBlockCodingFinal('fix bug', 'FINAL_ANSWER: done', {
      taskProfile: { isModificationTask: true },
      toolEvents: [{ success: true, name: 'write_file' }],
    });
    expect(result.block).toBe(false);
  });
});
