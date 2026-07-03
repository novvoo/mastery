import { describe, expect, test } from 'bun:test';
import { describeToolActivity } from '../../src/core/runtime/tool-activity.js';

describe('tool activity descriptions', () => {
  test('describes file reads', () => {
    const activity = describeToolActivity('read_file', { path: 'src/app.js' }, 'running');
    expect(activity.intent).toBe('read');
    expect(activity.target).toBe('src/app.js');
    expect(activity.statusText).toContain('正在读取');
  });

  test('marks edits as reviewable and undoable after completion', () => {
    const activity = describeToolActivity('edit_file', { path: 'src/app.js' }, 'completed');
    expect(activity.intent).toBe('edit');
    expect(activity.canReview).toBe(true);
    expect(activity.canUndo).toBe(true);
    expect(activity.statusText).toContain('已编辑');
  });

  test('classifies shell verification commands', () => {
    const activity = describeToolActivity('shell', { command: 'npm run lint' }, 'running');
    expect(activity.intent).toBe('verify');
    expect(activity.statusText).toContain('正在验证');
  });
});
