import { describe, expect, test } from 'bun:test';
import {
  buildActivitySummary,
  getFileStatusLabel,
} from '../../desktop/renderer/components/message-log/activity-summary.js';
import {
  buildThinkingSummary,
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
    expect(isRuntimeDetailMessage({ event: 'agent:thinking' })).toBe(true);
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
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: 'checking the plan' },
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
    expect(groups[0].runtimeDetails.map(msg => msg.id)).toEqual(['s1', 'r1', 't1']);
  });

  test('builds thinking summaries across iterations', () => {
    const summary = buildThinkingSummary([
      { id: 'r1', event: 'agent:thinking', type: 'thinking', iteration: 1, summary: '读上下文', thinkingText: '先读取上下文。' },
      { id: 'r2', event: 'agent:thinking', type: 'thinking', iteration: 2, summary: '验证结果', thinkingText: '再验证结果。' },
      { id: 't1', event: 'tool:call', type: 'tool' },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.iterationCount).toBe(2);
    expect(summary.summary).toBe('验证结果');
    expect(summary.fullText).toContain('先读取上下文');
    expect(summary.fullText).toContain('再验证结果');
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

  test('summarizes runtime activity state', () => {
    const details = [
      {
        event: 'tool:call',
        timestamp: 1,
        activity: {
          kind: 'tool_activity',
          id: 'edit_file:src/app.js',
          phase: 'running',
          intent: 'edit',
          toolName: 'edit_file',
          target: 'src/app.js',
          statusText: '正在编辑 src/app.js',
        },
      },
      {
        event: 'tool:result',
        timestamp: 2,
        activity: {
          kind: 'tool_activity',
          id: 'edit_file:src/app.js',
          phase: 'completed',
          intent: 'edit',
          toolName: 'edit_file',
          target: 'src/app.js',
          statusText: '已编辑 src/app.js',
          canReview: true,
          canUndo: true,
        },
      },
    ];

    const summary = buildActivitySummary(details);
    expect(summary.total).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.fileCount).toBe(1);
    expect(summary.reviewable).toBe(1);
    expect(summary.undoable).toBe(1);
    expect(summary.progress).toBeGreaterThan(0);
    expect(summary.files[0]).toMatchObject({ path: 'src/app.js', status: 'edited' });
    expect(summary.taskStages.find(stage => stage.id === 'change')?.status).toBe('completed');
    expect(summary.activities[0].statusText).toBe('已编辑 src/app.js');
  });

  test('summarizes waiting-for-user interaction state', () => {
    const summary = buildActivitySummary([
      {
        event: 'agent:complete',
        timestamp: 3,
        payload: {
          result: { status: 'needs_user_input' },
        },
      },
    ]);

    expect(summary.waitingForUser).toBe(true);
    expect(summary.taskStages.find(stage => stage.id === 'complete')?.status).toBe('waiting');
    expect(getFileStatusLabel('created')).toBe('已创建');
  });
});
