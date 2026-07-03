/**
 * task-tools.js
 * 任务管理工具定义
 */

import { ToolCategory } from '../../core/types/index.js';
import { TaskPriority } from '../../scheduler/task-queue/Task.js';

/**
 * 创建任务管理工具
 * @param {SchedulerEngine} schedulerEngine - 调度引擎实例
 * @returns {Array<Object>} 工具定义数组
 */
export function createTaskTools(schedulerEngine) {
  const taskQueue = schedulerEngine.getTaskQueue();

  return [
    {
      name: 'task_create',
      description: '创建新任务',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '任务类型',
          },
          payload: {
            type: 'object',
            description: '任务载荷数据',
          },
          priority: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'BACKGROUND'],
            description: '任务优先级',
          },
        },
        required: ['type', 'payload'],
      },
      handler: async ({ type, payload, priority = 'NORMAL' }) => {
        const priorityValue = TaskPriority[priority] ?? TaskPriority.NORMAL;
        const task = await taskQueue.add({
          type,
          payload,
          priority: priorityValue,
        });
        return {
          success: true,
          task: task.toJSON(),
        };
      },
    },
    {
      name: 'task_list',
      description: '列出任务，支持按状态过滤',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
            description: '按状态过滤',
          },
          limit: {
            type: 'number',
            description: '返回数量限制',
          },
        },
      },
      handler: async ({ status, limit }) => {
        const options = {};
        if (status) {
          options.status = status;
        }
        if (limit && limit > 0) {
          options.limit = limit;
        }
        const tasks = taskQueue.list(options);
        return {
          success: true,
          count: tasks.length,
          tasks: tasks.map((task) => task.toJSON()),
        };
      },
    },
    {
      name: 'task_status',
      description: '获取任务详细状态信息',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '任务ID',
          },
        },
        required: ['id'],
      },
      handler: async ({ id }) => {
        const task = taskQueue.get(id);
        if (!task) {
          return {
            success: false,
            error: `Task ${id} not found`,
          };
        }
        return {
          success: true,
          task: task.toJSON(),
        };
      },
    },
    {
      name: 'task_cancel',
      description: '取消任务',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '任务ID',
          },
        },
        required: ['id'],
      },
      handler: async ({ id }) => {
        try {
          const task = await taskQueue.cancel(id);
          if (!task) {
            return {
              success: false,
              error: `Task ${id} not found`,
            };
          }
          return {
            success: true,
            task: task.toJSON(),
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }
      },
    },
  ];
}

export default createTaskTools;
