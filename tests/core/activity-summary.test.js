import { describe, test, expect } from 'bun:test';
import {
  buildActivitySummary,
  getActivityTone,
  getFileStatusLabel,
  getFileTypeIcon,
  formatDuration,
} from '../../src/core/runtime/activity-summary.js';

describe('activity-summary (src/core)', () => {
  test('buildActivitySummary returns empty summary for no details', () => {
    const summary = buildActivitySummary([]);
    expect(summary.activities).toEqual([]);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.running).toBe(0);
    expect(summary.total).toBe(0);
    expect(summary.progress).toBe(0);
    expect(summary.waitingForUser).toBe(false);
  });

  test('buildActivitySummary aggregates tool activities', () => {
    const details = [
      {
        event: 'tool:activity',
        timestamp: 1,
        payload: {
          kind: 'tool_activity',
          id: 'read:src/app.js',
          phase: 'completed',
          intent: 'read',
          toolName: 'read_file',
          target: 'src/app.js',
          statusText: '已读取 src/app.js',
        },
      },
      {
        event: 'tool:activity',
        timestamp: 2,
        payload: {
          kind: 'tool_activity',
          id: 'edit:src/app.js',
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
    expect(summary.activities.length).toBe(2);
    expect(summary.completed).toBe(2);
    expect(summary.files.length).toBe(1);
    expect(summary.files[0].path).toBe('src/app.js');
    expect(summary.files[0].status).toBe('edited');
    expect(summary.reviewable).toBe(1);
    expect(summary.undoable).toBe(1);
  });

  test('buildActivitySummary synthesizes activities from plain tool events', () => {
    const summary = buildActivitySummary([
      {
        event: 'tool:call',
        type: 'tool',
        timestamp: 1,
        toolName: 'read_file',
        args: { path: 'src/app.js' },
      },
      {
        event: 'tool:result',
        type: 'tool_result',
        timestamp: 2,
        toolName: 'read_file',
        args: { path: 'src/app.js' },
        result: 'file content',
      },
      {
        event: 'tool:error',
        type: 'tool_result',
        timestamp: 3,
        toolName: 'write_file',
        args: { path: 'src/out.js' },
        error: 'permission denied',
      },
    ]);

    expect(summary.activities.length).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.files.map((file) => file.path)).toContain('src/app.js');
    expect(summary.files.find((file) => file.path === 'src/out.js')?.status).toBe('failed');
  });

  test('buildActivitySummary builds task stages', () => {
    const details = [
      {
        event: 'tool:activity',
        timestamp: 1,
        payload: {
          kind: 'tool_activity',
          id: 'read:1',
          phase: 'completed',
          intent: 'read',
          toolName: 'read_file',
          target: 'src/app.js',
        },
      },
      {
        event: 'tool:activity',
        timestamp: 2,
        payload: {
          kind: 'tool_activity',
          id: 'verify:1',
          phase: 'running',
          intent: 'verify',
          toolName: 'shell',
          target: 'bun test',
        },
      },
    ];
    const summary = buildActivitySummary(details);
    expect(summary.taskStages.length).toBe(4);
    const inspect = summary.taskStages.find((s) => s.id === 'inspect');
    const verify = summary.taskStages.find((s) => s.id === 'verify');
    expect(inspect.status).toBe('completed');
    expect(verify.status).toBe('running');
  });

  test('buildActivitySummary detects waiting-for-user', () => {
    const details = [
      {
        event: 'agent:complete',
        timestamp: 1,
        payload: { result: { status: 'needs_user_input' } },
      },
    ];
    const summary = buildActivitySummary(details);
    expect(summary.waitingForUser).toBe(true);
  });

  test('buildActivitySummary preserves completed plan tasks across partial updates', () => {
    const summary = buildActivitySummary([
      {
        event: 'plan:created',
        type: 'plan',
        timestamp: 1,
        payload: {
          plan: {
            tasks: [
              { id: 'inspect', name: '检查上下文', status: 'running' },
              { id: 'edit', name: '修改代码', status: 'pending' },
              { id: 'verify', name: '验证结果', status: 'pending' },
            ],
          },
        },
      },
      {
        event: 'plan:updated',
        type: 'plan',
        timestamp: 2,
        payload: {
          plan: {
            tasks: [
              { id: 'inspect', name: '检查上下文', status: 'completed' },
              { id: 'edit', name: '修改代码', status: 'running' },
            ],
          },
        },
      },
      {
        event: 'plan:updated',
        type: 'plan',
        timestamp: 3,
        payload: {
          plan: {
            tasks: [{ id: 'verify', name: '验证结果', status: 'running' }],
          },
        },
      },
    ]);

    expect(summary.plan.tasks.map((task) => [task.id, task.status])).toEqual([
      ['inspect', 'completed'],
      ['edit', 'running'],
      ['verify', 'running'],
    ]);
    expect(summary.plan.progress).toMatchObject({
      total: 3,
      completed: 1,
      running: 2,
      progress: 33,
    });
  });

  test('getActivityTone returns correct tone', () => {
    expect(getActivityTone({ phase: 'completed' })).toBe('completed');
    expect(getActivityTone({ phase: 'failed' })).toBe('failed');
    expect(getActivityTone({ phase: 'waiting' })).toBe('waiting');
    expect(getActivityTone({ phase: 'running' })).toBe('running');
  });

  test('getFileStatusLabel returns Chinese labels', () => {
    expect(getFileStatusLabel('read')).toBe('已读');
    expect(getFileStatusLabel('edited')).toBe('已编辑');
    expect(getFileStatusLabel('created')).toBe('已创建');
    expect(getFileStatusLabel('deleted')).toBe('已删除');
    expect(getFileStatusLabel('failed')).toBe('失败');
    expect(getFileStatusLabel('unknown')).toBe('unknown');
  });

  test('getFileTypeIcon returns correct icons', () => {
    expect(getFileTypeIcon('app.js')).toBe('JS');
    expect(getFileTypeIcon('app.ts')).toBe('TS');
    expect(getFileTypeIcon('data.json')).toBe('{}');
    expect(getFileTypeIcon('page.html')).toBe('HT');
    expect(getFileTypeIcon('style.css')).toBe('CS');
    expect(getFileTypeIcon('readme.md')).toBe('MD');
    expect(getFileTypeIcon('app.py')).toBe('PY');
    expect(getFileTypeIcon('image.png')).toBe('IM');
    expect(getFileTypeIcon('')).toBe('🗎');
    expect(getFileTypeIcon(null)).toBe('🗎');
  });

  test('formatDuration formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(-1)).toBe('');
  });
});
