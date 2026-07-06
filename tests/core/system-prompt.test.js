import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt, buildTaskConstraintPrompt } from '../../src/prompts/system-prompt.js';

describe('buildSystemPrompt', () => {
  test('uses professional tool guidance instead of ceremonial auto-triggers', () => {
    const prompt = buildSystemPrompt(null, null, '/workspace/project', '');

    expect(prompt).toContain('Tool Selection Guide');
    expect(prompt).toContain('decision aids, not ceremonial steps');
    expect(prompt).toContain('Do not call methodology tools ceremonially');
    expect(prompt).not.toContain('Auto-Trigger Rules');
    expect(prompt).not.toContain('MUST proactively call');
    expect(prompt).not.toContain("Call 'brainstorm' first");
    expect(prompt).not.toContain("Use 'tdd' workflow");
    expect(prompt).not.toContain("Call 'review'");
    expect(prompt).not.toContain("Call 'verify' first");
    expect(prompt).not.toContain('ANTI-PROCRASTINATION');
  });

  test('guides numbered line edits instead of large old_text replacements', () => {
    const prompt = buildSystemPrompt(null, null, '/workspace/project', '');

    expect(prompt).toContain('prefer line/startLine/endLine from the latest numbered read');
    expect(prompt).toContain('"startLine": 20, "endLine": 23');
    expect(prompt).not.toContain('"old_text": "async function processPayment(amount)');
  });
});

describe('buildTaskConstraintPrompt', () => {
  test('describes task focus without hard tool-call ceremony', () => {
    const prompt = buildTaskConstraintPrompt(
      {
        id: 'implement_changes',
        name: 'Implement changes',
        description: 'Apply the scoped edit',
        phase: 'implementation',
        completionPredicate: () => true,
      },
      ['read_file', 'write_file', 'shell'],
    );

    expect(prompt).toContain('Current Execution Focus');
    expect(prompt).toContain('Task ID: implement_changes');
    expect(prompt).toContain('Tools exposed for this request');
    expect(prompt).toContain('- write_file');
    expect(prompt).toContain('gather missing context or replan');
    expect(prompt).not.toContain('STRICT CONSTRAINTS');
    expect(prompt).not.toContain('Allowed Tools (ONLY use these)');
    expect(prompt).not.toContain('exactly ONE tool call');
    expect(prompt).not.toContain('Do NOT call tools outside this list');
  });
});
