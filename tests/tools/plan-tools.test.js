import { describe, test, expect, mock } from 'bun:test';
import { createPlanTools } from '../../src/tools/system/plan-tools.js';

describe('change_plan tool', () => {
  test('calls active plan manager changePlan', async () => {
    const changePlan = mock(() => ({
      success: true,
      planStatus: 'running',
      insertedTasks: ['inspect_new_scope'],
    }));
    const [tool] = createPlanTools();

    const result = await tool.handler(
      {
        mode: 'append',
        reason: 'new scope discovered',
        tasks: [
          {
            id: 'inspect_new_scope',
            name: 'Inspect new scope',
            description: 'Read newly discovered files.',
            phase: 'exploration',
          },
        ],
      },
      { activePlanManager: { changePlan } },
    );

    expect(result.success).toBe(true);
    expect(result.insertedTasks).toEqual(['inspect_new_scope']);
    expect(changePlan).toHaveBeenCalledWith({
      mode: 'append',
      targetTaskId: null,
      reason: 'new scope discovered',
      tasks: [
        {
          id: 'inspect_new_scope',
          name: 'Inspect new scope',
          description: 'Read newly discovered files.',
          phase: 'exploration',
        },
      ],
    });
  });

  test('returns a useful error without an active plan manager', async () => {
    const [tool] = createPlanTools();
    const result = await tool.handler(
      {
        mode: 'append',
        reason: 'scope changed',
        tasks: [{ id: 'extra', name: 'Extra', description: 'Extra task' }],
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active plan manager');
  });
});
