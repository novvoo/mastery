/**
 * schedule-tools.js
 * 调度计划管理工具定义
 */

import { ToolCategory } from '../../core/types.js';
import { CronExpression } from '../../scheduler/cron/CronExpression.js';

/**
 * 创建调度计划管理工具
 * @param {SchedulerEngine} schedulerEngine - 调度引擎实例
 * @returns {Array<Object>} 工具定义数组
 */
export function createScheduleTools(schedulerEngine) {
  const cronScheduler = schedulerEngine.getCronScheduler();

  return [
    {
      name: 'schedule_create',
      description: '创建新的调度计划',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '计划名称',
          },
          cron: {
            type: 'string',
            description: 'Cron表达式 (例如: "0 9 * * *" 表示每天9点)',
          },
          taskType: {
            type: 'string',
            description: '任务类型',
          },
          taskPayload: {
            type: 'object',
            description: '任务载荷数据',
          },
          enabled: {
            type: 'boolean',
            description: '是否启用',
            default: true,
          },
        },
        required: ['name', 'cron', 'taskType', 'taskPayload'],
      },
      handler: async ({ name, cron, taskType, taskPayload, enabled = true }) => {
        // 验证cron表达式
        try {
          new CronExpression(cron);
        } catch (error) {
          return {
            success: false,
            error: `Invalid cron expression: ${error.message}`,
          };
        }

        try {
          const schedule = await cronScheduler.add({
            name,
            cron,
            taskType,
            taskPayload,
            enabled,
          });
          return {
            success: true,
            schedule: schedule.toJSON(),
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    },
    {
      name: 'schedule_list',
      description: '列出所有调度计划',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: '按启用状态过滤',
          },
        },
      },
      handler: async ({ enabled }) => {
        const options = {};
        if (enabled !== undefined) {
          options.enabled = enabled;
        }
        const schedules = cronScheduler.list(options);
        return {
          success: true,
          count: schedules.length,
          schedules: schedules.map((schedule) => schedule.toJSON()),
        };
      },
    },
    {
      name: 'schedule_delete',
      description: '删除调度计划',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '计划ID',
          },
        },
        required: ['id'],
      },
      handler: async ({ id }) => {
        const result = await cronScheduler.delete(id);
        if (!result) {
          return {
            success: false,
            error: `Schedule ${id} not found`,
          };
        }
        return {
          success: true,
          message: `Schedule ${id} deleted successfully`,
        };
      },
    },
    {
      name: 'schedule_toggle',
      description: '启用或禁用调度计划',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '计划ID',
          },
        },
        required: ['id'],
      },
      handler: async ({ id }) => {
        const schedule = await cronScheduler.toggle(id);
        if (!schedule) {
          return {
            success: false,
            error: `Schedule ${id} not found`,
          };
        }
        return {
          success: true,
          schedule: schedule.toJSON(),
          message: `Schedule ${id} is now ${schedule.enabled ? 'enabled' : 'disabled'}`,
        };
      },
    },
  ];
}

export default createScheduleTools;
