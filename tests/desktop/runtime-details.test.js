import { describe, expect, test } from 'bun:test';
import {
  buildRuntimeDetailsExportData,
  createConversationGroups,
  createRuntimeDetailId,
  getRuntimeDetailContent,
  getRuntimeDetailPreviewText,
  isPrimaryMessage,
  isRuntimeDetailMessage,
  isStatusUpdateMessage,
} from '../../desktop/renderer/components/message-log/runtime-details.js';

describe('runtime details helpers', () => {
  test('classifies runtime detail and primary messages', () => {
    expect(isRuntimeDetailMessage({ event: 'tool:call' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'tool_result' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'user' })).toBe(false);
    expect(isStatusUpdateMessage({ event: 'status:update' })).toBe(true);
    expect(isPrimaryMessage({ type: 'user' })).toBe(true);
    expect(isPrimaryMessage({ event: 'agent:complete', type: 'success' })).toBe(true);
  });

  test('builds stable runtime detail content and previews', () => {
    const msg = {
      type: 'tool_result',
      toolName: 'read_file',
      args: { path: 'src/index.js' },
      result: '[src/index.js] → 90% match\nline 1\nline 2',
    };

    expect(getRuntimeDetailPreviewText(msg)).toBe('工具: read_file');
    expect(getRuntimeDetailContent(msg)).toContain('工具: read_file');
    expect(getRuntimeDetailContent(msg)).toContain('参数:');
    expect(getRuntimeDetailContent(msg)).toContain('结果:');
    expect(getRuntimeDetailContent(msg)).not.toContain('90% match');
  });

  test('groups runtime details under the surrounding conversation', () => {
    const messages = [
      { id: 'u1', type: 'user', content: 'run task' },
      { id: 's1', event: 'status:update', type: 'event', message: 'starting' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'shell' },
      { id: 'a1', type: 'agent', content: 'done' },
      { id: 'c1', event: 'agent:complete', type: 'success', content: 'final answer' },
    ];

    const groups = createConversationGroups(messages, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].messages.map(msg => msg.id)).toEqual(['u1', 'a1', 'c1']);
    expect(groups[0].runtimeDetails.map(msg => msg.id)).toEqual(['s1', 't1']);
  });

  test('creates collision-resistant ids and export data', () => {
    const detail = { event: 'tool:call', type: 'tool', timestamp: 123, toolName: 'shell', args: { command: 'pwd' } };

    expect(createRuntimeDetailId('group', detail, 0)).toBe('group_tool:call_123_0');
    expect(createRuntimeDetailId('group', detail, 1)).toBe('group_tool:call_123_1');

    const exported = buildRuntimeDetailsExportData([detail]);
    expect(exported[0]).toMatchObject({
      event: 'tool:call',
      type: 'tool',
      toolName: 'shell',
      args: { command: 'pwd' },
    });
  });
});
