import { describe, expect, test } from 'bun:test';
import {
  PLAN_ARCHITECTURE_LABELS,
  groupPlanTasksByPhase,
} from '../../desktop/renderer/components/message-log/utils/plan-display.js';

describe('plan display ordering', () => {
  test('shows executed tasks before pending tasks within a phase', () => {
    const groups = groupPlanTasksByPhase([
      { id: 'todo', phase: 'implementation', status: 'pending' },
      { id: 'done', phase: 'implementation', status: 'completed' },
      { id: 'active', phase: 'implementation', status: 'running' },
      { id: 'failed', phase: 'implementation', status: 'failed' },
    ]);

    const implementationTasks = groups.find(([phase]) => phase === 'implementation')?.[1] || [];

    expect(implementationTasks.map((task) => task.id)).toEqual([
      'done',
      'failed',
      'active',
      'todo',
    ]);
  });

  test('uses acceptance language instead of gatekeeping language', () => {
    expect(PLAN_ARCHITECTURE_LABELS['checklist-gated']).toBe('验收清单');
    expect(PLAN_ARCHITECTURE_LABELS['checklist-gated']).not.toContain('门禁');
  });
});
