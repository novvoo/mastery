import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  UI_ACTION_GRAPH,
  UI_ACTION_STATUS,
  resolveUiActionState,
} from '../../desktop/renderer/app/actions/ui-action-graph.js';

describe('UI action graph', () => {
  test('primary actions declare a visible outcome and feedback target', () => {
    expect(Object.keys(UI_ACTION_GRAPH).length).toBeGreaterThanOrEqual(15);
    for (const [id, action] of Object.entries(UI_ACTION_GRAPH)) {
      expect(id).toContain('.');
      expect(action.surface).toBeTruthy();
      expect(action.outcome).toBeTruthy();
      expect(action.feedback).toBeTruthy();
    }
  });

  test('content actions are blocked when they would otherwise look ineffective', () => {
    expect(resolveUiActionState('workbench.export', { contentCount: 0 })).toEqual({
      status: UI_ACTION_STATUS.BLOCKED,
      reason: '当前没有可操作的内容',
    });
    expect(resolveUiActionState('workbench.clear', { contentCount: 2 }).status)
      .toBe(UI_ACTION_STATUS.READY);
  });

  test('capability actions expose the capability failure reason', () => {
    const capabilityGraph = {
      get: () => ({ status: 'unavailable', reason: '策略禁止终端执行' }),
    };
    expect(resolveUiActionState('workbench.toggle-terminal', { capabilityGraph })).toEqual({
      status: UI_ACTION_STATUS.BLOCKED,
      reason: '策略禁止终端执行',
    });
  });

  test('empty-state suggestions are semantic, registered actions', () => {
    const source = readFileSync(
      path.resolve(import.meta.dir, '../../desktop/renderer/components/MessageLog.jsx'),
      'utf8',
    );
    expect(source).toContain('className="mastery-starter-action"');
    expect(source).toContain('data-action-id={`composer.starter.${id}`}');
    expect(source).not.toContain('<span style={styles.emptyChip}>解释这个项目</span>');
  });
});
