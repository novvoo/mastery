/**
 * Task Management Commands
 * 任务管理命令 - 交互式菜单、表格显示、详情查看等
 */

import { input, select } from '@inquirer/prompts';
import {
  enhancedUI,
  createTable,
  formatStatus,
  formatPriority,
  formatTime,
  formatDuration,
  truncate,
} from '../enhanced-ui.js';
import { TASK_MENU_CHOICES, TASK_PRIORITY_CHOICES } from '../enhanced-command-utils.js';

/**
 * 创建任务管理命令
 * @param {Object} deps - 依赖项
 * @param {import('../../scheduler/task-queue.js').TaskQueue} deps.taskQueue - 任务队列
 * @returns {Object} 任务管理命令方法
 */
export function createTaskCommands(deps) {
  const { taskQueue } = deps;

  return {
    /**
     * 任务管理菜单
     */
    async showTaskMenu() {
      const action = await select({
        message: 'Task Management:',
        choices: TASK_MENU_CHOICES,
      });

      switch (action) {
        case 'list':
          await this.showTaskList();
          break;
        case 'create':
          await this.interactiveCreateTask();
          break;
        case 'detail':
          await this.showTaskDetailInteractive();
          break;
        case 'cancel':
          await this.cancelTaskInteractive();
          break;
        case 'retry':
          await this.retryTaskInteractive();
          break;
      }
    },

    /**
     * 显示任务列表（表格格式）
     */
    async showTaskList() {
      const tasks = taskQueue.list({ limit: 50 });

      if (tasks.length === 0) {
        enhancedUI.info('No tasks found');
        return;
      }

      console.log(enhancedUI.createHeader('Task List'));

      const table = createTable({
        head: ['ID', 'Type', 'Status', 'Priority', 'Created', 'Duration'],
        colWidths: [22, 20, 15, 15, 15, 12],
      });

      for (const task of tasks) {
        const duration =
          task.startedAt && task.completedAt
            ? formatDuration(task.completedAt - task.startedAt)
            : task.startedAt
              ? formatDuration(Date.now() - task.startedAt) + ' (running)'
              : 'N/A';

        table.push([
          truncate(task.id, 20),
          truncate(task.type, 18),
          formatStatus(task.status),
          formatPriority(task.priority),
          formatTime(task.createdAt),
          duration,
        ]);
      }

      console.log(table.toString());
      console.log('');
      enhancedUI.info(`Total: ${tasks.length} tasks`);

      // 显示统计
      const stats = taskQueue.getStats();
      console.log(
        `  ${formatStatus('pending')}: ${stats.pending}  ` +
          `${formatStatus('waiting')}: ${stats.waiting}  ` +
          `${formatStatus('running')}: ${stats.running}  ` +
          `${formatStatus('completed')}: ${stats.completed}  ` +
          `${formatStatus('failed')}: ${stats.failed}`,
      );
      console.log('');
    },

    /**
     * 交互式创建任务
     */
    async interactiveCreateTask() {
      const type = await input({
        message: 'Task type:',
        validate: (input) => input.trim() !== '' || 'Type is required',
      });

      const description = await input({
        message: 'Description:',
      });

      const priority = await select({
        message: 'Priority:',
        choices: TASK_PRIORITY_CHOICES,
        default: 2,
      });

      const dependsOnStr = await input({
        message: 'Depends on (comma-separated task IDs, optional):',
      });
      const dependsOn = dependsOnStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        const task = await taskQueue.add({
          type: type,
          payload: { description: description },
          priority: priority,
          dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
        });

        enhancedUI.success(`Task created: ${task.id}`);
      } catch (error) {
        enhancedUI.error(`Failed to create task: ${error.message}`);
      }
    },

    /**
     * 交互式查看任务详情
     */
    async showTaskDetailInteractive() {
      const tasks = taskQueue.list({ limit: 20 });
      if (tasks.length === 0) {
        enhancedUI.info('No tasks available');
        return;
      }

      const taskId = await select({
        message: 'Select task:',
        choices: tasks.map((t) => ({
          name: `${truncate(t.id, 15)} - ${t.type} (${t.status})`,
          value: t.id,
        })),
      });

      await this.showTaskDetail(taskId);
    },

    /**
     * 显示任务详情
     */
    async showTaskDetail(taskId) {
      const task = taskQueue.get(taskId);
      if (!task) {
        enhancedUI.error(`Task ${taskId} not found`);
        return;
      }

      console.log(enhancedUI.createHeader(`Task: ${truncate(task.id, 40)}`));

      const details = [
        ['Type', task.type],
        ['Status', formatStatus(task.status)],
        ['Priority', formatPriority(task.priority)],
        ['Created', formatTime(task.createdAt)],
        ['Updated', formatTime(task.updatedAt)],
      ];

      if (task.startedAt) {
        details.push(['Started', formatTime(task.startedAt)]);
      }

      if (task.completedAt) {
        details.push(['Completed', formatTime(task.completedAt)]);
        details.push(['Duration', formatDuration(task.completedAt - task.startedAt)]);
      }

      details.push(['Retries', `${task.retryCount}/${task.maxRetries}`]);

      if (task.parentId) {
        details.push(['Parent ID', task.parentId]);
      }

      if (task.scheduleId) {
        details.push(['Schedule ID', task.scheduleId]);
      }

      if (task.dependsOn && task.dependsOn.length > 0) {
        details.push(['Dependencies', task.dependsOn.join(', ')]);
        details.push([
          'Completed Deps',
          Array.from(task.completedDependencies).join(', ') || 'None',
        ]);
      }

      const table = createTable({
        colWidths: [20, 50],
      });

      for (const [key, value] of details) {
        table.push([enhancedUI.theme.primaryBold(key), value]);
      }

      console.log(table.toString());

      if (Object.keys(task.payload).length > 0) {
        console.log('');
        console.log(enhancedUI.theme.primaryBold('Payload:'));
        console.log(enhancedUI.formatJSON(task.payload, 2));
      }

      if (task.result !== null) {
        console.log('');
        console.log(enhancedUI.theme.successBold('Result:'));
        const resultStr =
          typeof task.result === 'object'
            ? enhancedUI.formatJSON(task.result, 2)
            : String(task.result);
        console.log(resultStr);
      }

      if (task.error) {
        console.log('');
        console.log(enhancedUI.theme.errorBold('Error:'));
        console.log(enhancedUI.theme.error(task.error));
      }

      console.log('');
    },

    /**
     * 交互式取消任务
     */
    async cancelTaskInteractive() {
      const tasks = taskQueue
        .list({ status: 'pending' })
        .concat(taskQueue.list({ status: 'running' }));
      if (tasks.length === 0) {
        enhancedUI.info('No cancellable tasks');
        return;
      }

      const taskId = await select({
        message: 'Select task to cancel:',
        choices: tasks.map((t) => ({
          name: `${truncate(t.id, 15)} - ${t.type} (${t.status})`,
          value: t.id,
        })),
      });

      try {
        await taskQueue.cancel(taskId);
        enhancedUI.success(`Task ${taskId} cancelled`);
      } catch (error) {
        enhancedUI.error(`Failed to cancel: ${error.message}`);
      }
    },

    /**
     * 交互式重试任务
     */
    async retryTaskInteractive() {
      const tasks = taskQueue.list({ status: 'failed' });
      if (tasks.length === 0) {
        enhancedUI.info('No failed tasks to retry');
        return;
      }

      const taskId = await select({
        message: 'Select task to retry:',
        choices: tasks.map((t) => ({
          name: `${truncate(t.id, 15)} - ${t.type} (${t.retryCount}/${t.maxRetries} retries)`,
          value: t.id,
        })),
      });

      try {
        await taskQueue.retry(taskId);
        enhancedUI.success(`Task ${taskId} queued for retry`);
      } catch (error) {
        enhancedUI.error(`Failed to retry: ${error.message}`);
      }
    },

    // 保留原有的命令处理方法以兼容旧版 CLI
    async handleTaskCommand(args) {
      if (typeof args === 'string') {
        args = args.split(' ').filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case undefined:
        case 'list':
          await this.showTaskList();
          break;
        case 'status':
          if (args[1]) {
            await this.showTaskDetail(args[1]);
          } else {
            await this.showTaskDetailInteractive();
          }
          break;
        case 'cancel':
          if (args[1]) {
            try {
              await taskQueue.cancel(args[1]);
              enhancedUI.success(`Task ${args[1]} cancelled`);
            } catch (error) {
              enhancedUI.error(error.message);
            }
          } else {
            await this.cancelTaskInteractive();
          }
          break;
        case 'retry':
          if (args[1]) {
            try {
              await taskQueue.retry(args[1]);
              enhancedUI.success(`Task ${args[1]} queued for retry`);
            } catch (error) {
              enhancedUI.error(error.message);
            }
          } else {
            await this.retryTaskInteractive();
          }
          break;
        default:
          enhancedUI.error(`Unknown task subcommand: ${subcommand}`);
          enhancedUI.info('Available: list, status, cancel, retry');
      }
    },
  };
}
