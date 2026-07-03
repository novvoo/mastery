import { describe, test, expect } from 'bun:test';
import {
  isRuntimeDetailMessage,
  isThinkingMessage,
  isStatusUpdateMessage,
  isPrimaryMessage,
  formatRuntimeDetailValue,
  compactToolResult,
  getRuntimeDetailContent,
  buildThinkingSummary,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  createConversationGroups,
  createRuntimeDetailId,
  buildRuntimeDetailsExportData,
} from '../../src/core/runtime-details.js';

describe('runtime-details (src/core)', () => {
  test('isRuntimeDetailMessage classifies messages correctly', () => {
    expect(isRuntimeDetailMessage(null)).toBe(false);
    expect(isRuntimeDetailMessage(undefined)).toBe(false);
    expect(isRuntimeDetailMessage('string')).toBe(false);
    expect(isRuntimeDetailMessage(123)).toBe(false);
    expect(isRuntimeDetailMessage([])).toBe(false);
    expect(isRuntimeDetailMessage({ type: 'user' })).toBe(false);
    expect(isRuntimeDetailMessage({ type: 'assistant', content: 'Hello user' })).toBe(false);
    expect(
      isRuntimeDetailMessage({ type: 'assistant', content: 'This is a normal response' }),
    ).toBe(false);

    expect(isRuntimeDetailMessage({ event: 'tool:call' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'tool:result' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'tool:error' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'tool:activity' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:thinking' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:start' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:complete' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:error' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:stop' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'status:update' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'plan:created' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'plan:updated' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'workspace:changed' })).toBe(true);

    expect(isRuntimeDetailMessage({ type: 'tool' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'tool_result' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'debug' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'event' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'thinking' })).toBe(true);

    expect(isRuntimeDetailMessage({ runtimeDetail: true })).toBe(true);
    expect(isRuntimeDetailMessage({ internal: true })).toBe(true);
    expect(isRuntimeDetailMessage({ hidden: true })).toBe(true);

    expect(isRuntimeDetailMessage({ role: 'system', content: 'You are a tool...' })).toBe(true);
    expect(isRuntimeDetailMessage({ role: 'system', content: 'System prompt' })).toBe(true);
    expect(isRuntimeDetailMessage({ role: 'developer', content: 'Developer instruction' })).toBe(
      true,
    );

    expect(isRuntimeDetailMessage({ source: 'tool_instruction' })).toBe(true);
    expect(isRuntimeDetailMessage({ source: 'system_instruction' })).toBe(true);
    expect(isRuntimeDetailMessage({ source: 'internal' })).toBe(true);

    expect(isRuntimeDetailMessage({ level: 'debug' })).toBe(true);
    expect(isRuntimeDetailMessage({ level: 'trace' })).toBe(true);
    expect(isRuntimeDetailMessage({ level: 'info' })).toBe(true);

    expect(isRuntimeDetailMessage({ toolName: 'read_file' })).toBe(true);
    expect(isRuntimeDetailMessage({ toolCallId: 'call_123' })).toBe(true);
    expect(isRuntimeDetailMessage({ toolCalls: [{ name: 'read_file' }] })).toBe(true);
    expect(isRuntimeDetailMessage({ args: { path: '/file' } })).toBe(true);
    expect(isRuntimeDetailMessage({ arguments: { path: '/file' } })).toBe(true);
    expect(isRuntimeDetailMessage({ result: 'output' })).toBe(true);
    expect(isRuntimeDetailMessage({ activity: { kind: 'tool_activity' } })).toBe(true);
    expect(isRuntimeDetailMessage({ activity: { intent: 'tool' } })).toBe(true);

    expect(isRuntimeDetailMessage({ type: 'assistant', content: 'You are a tool...' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'assistant', content: 'You are a skill...' })).toBe(true);
    expect(
      isRuntimeDetailMessage({ type: 'assistant', content: '[SYSTEM] Internal message' }),
    ).toBe(true);
    expect(
      isRuntimeDetailMessage({ type: 'assistant', content: '[INTERNAL] Tool instruction' }),
    ).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'assistant', content: '[DEVELOPER] Instruction' })).toBe(
      true,
    );
    expect(
      isRuntimeDetailMessage({
        type: 'assistant',
        content: '<!-- workspace-context: files=foo.js -->',
      }),
    ).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'assistant', content: '/* Internal comment */' })).toBe(
      true,
    );

    expect(isRuntimeDetailMessage({ text: 'You are a tool...' })).toBe(true);
    expect(isRuntimeDetailMessage({ text: '[SYSTEM] Internal' })).toBe(true);
  });

  test('isThinkingMessage detects thinking type', () => {
    expect(isThinkingMessage({ type: 'thinking' })).toBe(true);
    expect(isThinkingMessage({ event: 'agent:thinking' })).toBe(true);
    expect(isThinkingMessage({ type: 'tool' })).toBe(false);
  });

  test('isStatusUpdateMessage detects status updates', () => {
    expect(isStatusUpdateMessage({ event: 'status:update' })).toBe(true);
    expect(isStatusUpdateMessage({ event: 'tool:call' })).toBe(false);
  });

  test('isPrimaryMessage identifies user-visible messages', () => {
    expect(isPrimaryMessage(null)).toBe(false);
    expect(isPrimaryMessage(undefined)).toBe(false);
    expect(isPrimaryMessage({ type: 'user', content: 'hi' })).toBe(true);
    expect(isPrimaryMessage({ type: 'assistant', content: 'hello' })).toBe(true);
    expect(
      isPrimaryMessage({ type: 'assistant', content: 'This is a normal response to user' }),
    ).toBe(true);
    expect(isPrimaryMessage({ type: 'result', content: 'Task completed successfully' })).toBe(true);

    expect(isPrimaryMessage({ event: 'tool:call' })).toBe(false);
    expect(isPrimaryMessage({ event: 'agent:complete', type: 'success' })).toBe(false);
    expect(isPrimaryMessage({ event: 'agent:complete', type: 'tool' })).toBe(false);

    expect(
      isPrimaryMessage({ internal: true, type: 'assistant', content: 'You are a tool...' }),
    ).toBe(false);
    expect(isPrimaryMessage({ hidden: true, type: 'assistant', content: 'Hidden message' })).toBe(
      false,
    );
    expect(
      isPrimaryMessage({ runtimeDetail: true, type: 'assistant', content: 'Internal message' }),
    ).toBe(false);

    expect(isPrimaryMessage({ role: 'system', content: 'System instruction' })).toBe(false);
    expect(isPrimaryMessage({ role: 'developer', content: 'Developer instruction' })).toBe(false);

    expect(
      isPrimaryMessage({
        source: 'tool_instruction',
        type: 'assistant',
        content: 'You are a tool...',
      }),
    ).toBe(false);
    expect(
      isPrimaryMessage({
        source: 'system_instruction',
        type: 'assistant',
        content: 'System instruction',
      }),
    ).toBe(false);

    expect(isPrimaryMessage({ type: 'assistant', content: 'You are a tool...' })).toBe(false);
    expect(isPrimaryMessage({ type: 'assistant', content: 'You are a skill...' })).toBe(false);
    expect(isPrimaryMessage({ type: 'assistant', content: '[SYSTEM] Internal' })).toBe(false);
    expect(
      isPrimaryMessage({
        type: 'assistant',
        content: 'You are an AI Engineering Mastery Agent — a coding assistant.',
      }),
    ).toBe(false);
    expect(
      isPrimaryMessage({
        type: 'assistant',
        content: '**ANTI-PROCRASTINATION:** After describing what you will do...',
      }),
    ).toBe(false);
    expect(isPrimaryMessage({ type: 'assistant', content: '<!-- workspace-context -->' })).toBe(
      false,
    );
    expect(
      isPrimaryMessage({
        type: 'assistant',
        content:
          '## 📋 Current Execution Task (STRICT CONSTRAINTS)\n\n### ⚡ STRICT RULES FOR THIS TASK\n\n**Allowed Tools (ONLY use these):**',
      }),
    ).toBe(false);
    expect(
      isPrimaryMessage({
        type: 'assistant',
        content: '  **Allowed Tools (ONLY use these):**\n- read_file\n- list_dir',
      }),
    ).toBe(false);
    expect(
      isPrimaryMessage({
        type: 'assistant',
        content:
          '## Current Execution Focus\n\nTask ID: implement_changes\nTask name: Implement changes\n\n### Tools exposed for this request\n- read_file\n- write_file',
      }),
    ).toBe(false);

    expect(isPrimaryMessage({ toolName: 'read_file', type: 'assistant' })).toBe(false);
    expect(isPrimaryMessage({ args: {}, type: 'assistant' })).toBe(false);
    expect(isPrimaryMessage({ activity: { kind: 'tool_activity' }, type: 'assistant' })).toBe(
      false,
    );
  });

  test('formatRuntimeDetailValue handles various types', () => {
    expect(formatRuntimeDetailValue(null)).toBe('');
    expect(formatRuntimeDetailValue('')).toBe('');
    expect(formatRuntimeDetailValue('text')).toBe('text');
    expect(formatRuntimeDetailValue({ key: 'val' })).toBe('{\n  "key": "val"\n}');
  });

  test('compactToolResult truncates long results', () => {
    const short = 'hello';
    expect(compactToolResult(short)).toBe('hello');

    const long = Array(25).fill('line of text').join('\n');
    const result = compactToolResult(long);
    expect(result).toContain('截断');
  });

  test('getRuntimeDetailContent extracts content from messages', () => {
    expect(getRuntimeDetailContent({ content: 'hello' })).toBe('hello');
    expect(getRuntimeDetailContent({ toolName: 'read_file', content: 'data' })).toContain(
      'read_file',
    );
  });

  test('buildThinkingSummary aggregates thinking messages', () => {
    const details = [
      { type: 'thinking', content: 'first thought', summary: 'thinking step 1', iteration: 1 },
      { type: 'thinking', content: 'second thought', summary: 'thinking step 2', iteration: 2 },
    ];
    const summary = buildThinkingSummary(details);
    expect(summary.count).toBe(2);
    expect(summary.iterationCount).toBe(2);
    expect(summary.fullText).toContain('first thought');
    expect(summary.latest.content).toBe('second thought');
  });

  test('buildThinkingSummary excludes debug LLM previews masquerading as thinking', () => {
    const summary = buildThinkingSummary([
      {
        event: 'agent:thinking',
        type: 'thinking',
        content: '正在分析上下文',
        payload: {
          eventName: 'LLM response',
          data: {
            textPreview: '```read_file\n{"path":"index.html"}\n```',
          },
        },
      },
      {
        event: 'agent:thinking',
        type: 'thinking',
        summary: '读取上下文',
        thinkingText: '正在读取项目结构。',
      },
    ]);

    expect(summary.count).toBe(1);
    expect(summary.fullText).not.toContain('read_file');
    expect(summary.summary).toBe('读取上下文');
  });

  test('getRuntimeDetailPreviewText provides one-line preview', () => {
    expect(getRuntimeDetailPreviewText({ content: 'line1\nline2' })).toBe('line1');
    expect(getRuntimeDetailPreviewText({ toolName: 'read' })).toBe('工具: read');
    expect(getRuntimeDetailPreviewText({ result: 'output' })).toBe('output');
    expect(getRuntimeDetailPreviewText({})).toBe('(无内容)');
  });

  test('getStatusUpdateText returns meaningful text', () => {
    expect(getStatusUpdateText(null)).toBe('准备执行');
    expect(getStatusUpdateText({ content: 'running' })).toBe('running');
    expect(getStatusUpdateText({ message: 'processing' })).toBe('processing');
  });

  test('createConversationGroups groups messages correctly', () => {
    const messages = [
      { id: 'u1', type: 'user', content: 'hello' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'read_file' },
      { id: 'a1', type: 'assistant', content: 'response' },
    ];
    const groups = createConversationGroups(messages, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });
    expect(groups.length).toBeGreaterThan(0);
    // Should have runtimeDetails in some group
    const allRuntimeDetails = groups.flatMap((g) => g.runtimeDetails);
    expect(allRuntimeDetails.length).toBeGreaterThan(0);
  });

  test('createRuntimeDetailId creates stable IDs', () => {
    const id1 = createRuntimeDetailId('g1', { id: 'm1' }, 0);
    const id2 = createRuntimeDetailId('g1', { id: 'm1' }, 0);
    expect(id1).toBe(id2);
    expect(id1).toBe('g1_m1');
  });

  test('buildRuntimeDetailsExportData normalizes details', () => {
    const details = [
      { event: 'tool:call', type: 'tool', timestamp: 1000, toolName: 'read', content: 'test' },
    ];
    const exported = buildRuntimeDetailsExportData(details);
    expect(exported.length).toBe(1);
    expect(exported[0].event).toBe('tool:call');
    expect(exported[0].timestamp).toBe('1970-01-01T00:00:01.000Z');
  });
});
