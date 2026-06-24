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
    expect(isRuntimeDetailMessage({ type: 'user' })).toBe(false);
    expect(isRuntimeDetailMessage({ event: 'tool:call' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:thinking' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'status:update' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'tool' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'debug' })).toBe(true);
    expect(isRuntimeDetailMessage({ runtimeDetail: true })).toBe(true);
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
    expect(isPrimaryMessage({ type: 'user', content: 'hi' })).toBe(true);
    expect(isPrimaryMessage({ type: 'assistant', content: 'hello' })).toBe(true);
    expect(isPrimaryMessage({ event: 'tool:call' })).toBe(false);
    expect(isPrimaryMessage({ event: 'agent:complete', type: 'success' })).toBe(false);
    expect(isPrimaryMessage({ event: 'agent:complete', type: 'tool' })).toBe(false);
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
