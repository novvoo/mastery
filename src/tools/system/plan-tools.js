import { ToolCategory } from '../../core/types/index.js';

const PLAN_CHANGE_MODES = ['replace', 'insertBefore', 'insertAfter', 'append'];

function normalizeTasks(tasks) {
  if (Array.isArray(tasks)) {
    return tasks;
  }
  if (typeof tasks !== 'string' || !tasks.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(tasks);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createPlanTools() {
  return [
    {
      name: 'change_plan',
      description:
        'Dynamically update the active execution plan when the task scope changes, a blocker is discovered, verification fails, or the current plan is no longer the right next step. Supports append, replace, insertBefore, and insertAfter.',
      category: ToolCategory.SYSTEM,
      params: {
        mode: {
          type: 'string',
          enum: PLAN_CHANGE_MODES,
          description:
            'How to apply the change: append new tasks, replace unfinished tasks, insert before a target task, or insert after a target task.',
        },
        tasks: {
          type: 'array',
          items: { type: 'object' },
          description:
            'Tasks to add. Each task should include id, name, description, phase, optional dependencies, optional allowedTools, and optional scopeFiles.',
        },
        targetTaskId: {
          type: 'string',
          description: 'Task id used by insertBefore or insertAfter.',
        },
        reason: {
          type: 'string',
          description: 'Short explanation for why the plan needs to change.',
        },
      },
      required: ['mode', 'tasks', 'reason'],
      handler: async ({ mode = 'append', tasks = [], targetTaskId = null, reason = '' }, ctx) => {
        const planManager = ctx.activePlanManager || ctx.planner || null;
        if (!planManager || typeof planManager.changePlan !== 'function') {
          return {
            success: false,
            error: 'No active plan manager is available for this run.',
          };
        }

        const normalizedTasks = normalizeTasks(tasks);
        if (!PLAN_CHANGE_MODES.includes(mode)) {
          return {
            success: false,
            error: `Unsupported plan change mode: ${mode}`,
            supportedModes: PLAN_CHANGE_MODES,
          };
        }
        if (normalizedTasks.length === 0) {
          return {
            success: false,
            error: 'change_plan requires at least one task.',
          };
        }

        const result = planManager.changePlan({
          mode,
          tasks: normalizedTasks,
          targetTaskId,
          reason,
        });

        if (!result?.success) {
          return result;
        }

        return {
          success: true,
          planStatus: result.planStatus,
          insertedTasks: result.insertedTasks,
          message: `Plan changed with mode "${mode}". Continue with the current ready task.`,
        };
      },
    },
  ];
}
