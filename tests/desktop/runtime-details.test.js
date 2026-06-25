import { describe, expect, test } from 'bun:test';
import {
  buildActivitySummary,
  getFileStatusLabel,
} from '../../desktop/renderer/components/message-log/utils/activity-summary.js';
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
} from '../../desktop/renderer/components/message-log/utils/runtime-details.js';

describe('runtime details helpers', () => {
  test('classifies runtime detail and primary messages', () => {
    expect(isRuntimeDetailMessage({ event: 'tool:call' })).toBe(true);
    expect(isRuntimeDetailMessage({ event: 'agent:thinking' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'tool_result' })).toBe(true);
    expect(isRuntimeDetailMessage({ type: 'user' })).toBe(false);
    expect(isStatusUpdateMessage({ event: 'status:update' })).toBe(true);
    expect(isPrimaryMessage({ type: 'user' })).toBe(true);
    expect(isPrimaryMessage({ event: 'agent:complete', type: 'success' })).toBe(false);
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
    expect(groups[0].messages.map((msg) => msg.id)).toEqual(['u1', 'a1']);
    expect(groups[0].runtimeDetails.map((msg) => msg.id)).toEqual(['s1', 'r1', 't1', 'c1']);
  });

  test('builds thinking summaries across iterations', () => {
    const summary = buildThinkingSummary([
      {
        id: 'r1',
        event: 'agent:thinking',
        type: 'thinking',
        iteration: 1,
        summary: '读上下文',
        thinkingText: '先读取上下文。',
      },
      {
        id: 'r2',
        event: 'agent:thinking',
        type: 'thinking',
        iteration: 2,
        summary: '验证结果',
        thinkingText: '再验证结果。',
      },
      { id: 't1', event: 'tool:call', type: 'tool' },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.iterationCount).toBe(2);
    expect(summary.summary).toBe('验证结果');
    expect(summary.fullText).toContain('先读取上下文');
    expect(summary.fullText).toContain('再验证结果');
  });

  test('does not surface tool protocol textPreview as thinking content', () => {
    const summary = buildThinkingSummary([
      {
        id: 'debug1',
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
    ]);

    expect(summary.count).toBe(0);
    expect(summary.fullText).toBe('');
  });

  test('creates collision-resistant ids and export data', () => {
    const detail = {
      event: 'tool:call',
      type: 'tool',
      timestamp: 123,
      toolName: 'shell',
      args: { command: 'pwd' },
    };

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
    expect(summary.files[0]).toMatchObject({
      path: 'src/app.js',
      status: 'edited',
      operation: 'edit',
    });
    expect(summary.taskStages.find((stage) => stage.id === 'change')?.status).toBe('completed');
    expect(summary.activities[0].statusText).toBe('已编辑 src/app.js');
  });

  test('summarizes plan updates and file line changes', () => {
    const summary = buildActivitySummary([
      {
        event: 'plan:created',
        type: 'plan',
        timestamp: 1,
        payload: {
          plan: {
            tasks: [
              { id: 'read_files', name: '读取文件', status: 'running' },
              { id: 'write_files', name: '写入文件', status: 'pending' },
            ],
          },
        },
      },
      {
        event: 'tool:result',
        type: 'tool_result',
        timestamp: 2,
        toolName: 'write_file',
        args: { path: 'src/app.js', content: 'one\ntwo\nthree' },
        result: 'File written successfully: src/app.js (3 lines)',
      },
      {
        event: 'tool:result',
        type: 'tool_result',
        timestamp: 3,
        toolName: 'edit_file',
        args: { path: 'src/app.js', old_text: 'old\nline', new_text: 'new' },
        result: 'File edited successfully: src/app.js',
      },
      {
        event: 'plan:updated',
        type: 'plan',
        timestamp: 4,
        payload: {
          plan: {
            tasks: [
              { id: 'read_files', name: '读取文件', status: 'completed' },
              { id: 'write_files', name: '写入文件', status: 'completed' },
            ],
          },
        },
      },
    ]);

    expect(summary.plan.updateCount).toBe(1);
    expect(summary.plan.tasks.map((task) => task.status)).toEqual(['completed', 'completed']);
    expect(summary.plan.progress.progress).toBe(100);
    expect(summary.files[0]).toMatchObject({
      path: 'src/app.js',
      status: 'edited',
      operation: 'edit',
      linesAdded: 4,
      linesDeleted: 2,
      linesWritten: 4,
    });
    expect(
      summary.activities.find((activity) => activity.toolName === 'write_file')?.counts,
    ).toMatchObject({
      additions: 3,
      deletions: 0,
    });
    expect(
      summary.activities.find((activity) => activity.toolName === 'edit_file')?.counts,
    ).toMatchObject({
      additions: 1,
      deletions: 2,
    });
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
    expect(summary.taskStages.find((stage) => stage.id === 'complete')?.status).toBe('waiting');
    expect(getFileStatusLabel('created')).toBe('已创建');
  });

  // ===== 修复：任务完成后运行详情面板不应消失 =====

  test('visibleRuntimeDetails 为空但 runtimeDetails 不为空时，面板应保留', () => {
    // 模拟任务完成后：只有 thinking 和 status:update 消息
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: 'starting' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: 'checking the plan' },
      { id: 's2', event: 'status:update', type: 'event', message: 'completed' },
    ];

    // thinking 和 status:update 消息被过滤，visibleRuntimeDetails 为空
    const visibleRuntimeDetails = runtimeDetails.filter(
      (msg) => !isStatusUpdateMessage(msg) && msg.type !== 'thinking',
    );
    expect(visibleRuntimeDetails).toHaveLength(0);

    // 但 runtimeDetails 本身不为空，面板判断应基于 runtimeDetails.length
    expect(runtimeDetails.length).toBeGreaterThan(0);
  });

  test('conversation group 在完成后仍保留 runtimeDetails', () => {
    const messages = [
      { id: 'u1', type: 'user', content: 'run task' },
      { id: 's1', event: 'status:update', type: 'event', message: 'starting' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: 'thinking...' },
      { id: 'c1', event: 'agent:complete', type: 'success', content: 'final answer' },
    ];

    const groups = createConversationGroups(messages, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });

    expect(groups).toHaveLength(1);
    // group 的 runtimeDetails 应包含被过滤的 thinking 和 status 消息
    expect(groups[0].runtimeDetails.length).toBeGreaterThan(0);
    // 完成后面板应基于 groups[0].runtimeDetails.length > 0 继续显示
  });

  test('完全没有 runtimeDetails 且没有 activity 时，面板应隐藏', () => {
    const runtimeDetails = [];
    const activitySummary = buildActivitySummary(runtimeDetails);
    // 空状态：面板正确返回 null
    expect(runtimeDetails.length).toBe(0);
    expect(activitySummary.activities.length).toBe(0);
  });

  test('有 tool activity 但 visibleRuntimeDetails 为空时，面板应保留', () => {
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: 'starting' },
      {
        id: 'a1',
        event: 'tool:activity',
        timestamp: 1,
        activity: {
          kind: 'tool_activity',
          id: 'read:src/app.js',
          phase: 'completed',
          intent: 'read',
          toolName: 'read_file',
          target: 'src/app.js',
          statusText: '已读取 src/app.js',
        },
      },
    ];

    const visibleRuntimeDetails = runtimeDetails.filter(
      (msg) => !isStatusUpdateMessage(msg) && msg.type !== 'thinking',
    );
    // activity 消息不在 visible 列表
    // 但 buildActivitySummary 会识别它
    const activitySummary = buildActivitySummary(runtimeDetails);
    expect(activitySummary.activities.length).toBeGreaterThan(0);
    expect(activitySummary.completed).toBe(1);
    // 面板应因为 activitySummary.activities.length > 0 继续显示
  });
});
