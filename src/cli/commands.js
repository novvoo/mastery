/**
 * commands.js
 * CLI 调度器命令处理
 */

import { ui } from './ui.js';

/**
 * 创建调度器命令处理器
 * @param {SchedulerEngine} schedulerEngine - 调度引擎实例
 * @returns {Object} 命令处理器对象
 */
export function createSchedulerCommands(schedulerEngine) {
  const taskQueue = schedulerEngine.getTaskQueue();
  const cronScheduler = schedulerEngine.getCronScheduler();
  const subAgentPool = schedulerEngine.getSubAgentPool();

  return {
    /**
     * 处理任务相关命令
     * @param {Array<string>} args - 命令参数
     */
    async handleTaskCommand(args) {
      const subcommand = args[0];

      switch (subcommand) {
        case 'list': {
          // 解析过滤参数
          const status = args.find((arg) => arg.startsWith('--status='))?.split('=')[1];
          const limit =
            parseInt(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1]) || 20;

          const options = {};
          if (status) {
            options.status = status;
          }
          options.limit = limit;

          const tasks = taskQueue.list(options);

          ui.header('Tasks');
          if (tasks.length === 0) {
            ui.info('No tasks found');
            return;
          }

          console.log(
            `  ${ui.brand('ID')} | ${'Type'.padEnd(20)} | ${'Status'.padEnd(10)} | ${'Priority'.padEnd(8)} | Created`,
          );
          console.log('  ' + '─'.repeat(90));

          for (const task of tasks) {
            const statusColor =
              {
                pending: (s) => s,
                running: (s) => ui.brand(s),
                completed: (s) => ui.success(s),
                failed: (s) => ui.error(s),
                cancelled: (s) => ui.warn(s),
              }[task.status] || ((s) => s);

            const priorityLabels = ['CRIT', 'HIGH', 'NORM', 'LOW', 'BG'];
            const priority = priorityLabels[task.priority] || String(task.priority);

            console.log(
              `  ${task.id.substring(0, 20).padEnd(20)} | ` +
                `${task.type.substring(0, 20).padEnd(20)} | ` +
                `${statusColor(task.status).padEnd(10)} | ` +
                `${priority.padEnd(8)} | ` +
                `${new Date(task.createdAt).toLocaleString()}`,
            );
          }
          console.log('');
          ui.info(`Total: ${tasks.length} tasks`);
          break;
        }

        case 'status': {
          const taskId = args[1];
          if (!taskId) {
            ui.error('Usage: task status <task-id>');
            return;
          }

          const task = taskQueue.get(taskId);
          if (!task) {
            ui.error(`Task ${taskId} not found`);
            return;
          }

          ui.header(`Task: ${task.id}`);
          console.log(`  ${ui.brand('Type:')}        ${task.type}`);
          console.log(`  ${ui.brand('Status:')}      ${task.status}`);
          console.log(`  ${ui.brand('Priority:')}    ${task.priority}`);
          console.log(`  ${ui.brand('Created:')}     ${new Date(task.createdAt).toLocaleString()}`);
          console.log(`  ${ui.brand('Updated:')}     ${new Date(task.updatedAt).toLocaleString()}`);

          if (task.startedAt) {
            console.log(
              `  ${ui.brand('Started:')}     ${new Date(task.startedAt).toLocaleString()}`,
            );
          }

          if (task.completedAt) {
            console.log(
              `  ${ui.brand('Completed:')}   ${new Date(task.completedAt).toLocaleString()}`,
            );
          }

          console.log(`  ${ui.brand('Retries:')}     ${task.retryCount}/${task.maxRetries}`);

          if (task.scheduleId) {
            console.log(`  ${ui.brand('Schedule ID:')} ${task.scheduleId}`);
          }

          if (task.parentId) {
            console.log(`  ${ui.brand('Parent ID:')}   ${task.parentId}`);
          }

          if (Object.keys(task.payload).length > 0) {
            console.log(`  ${ui.brand('Payload:')}`);
            console.log(
              JSON.stringify(task.payload, null, 4)
                .split('\n')
                .map((l) => '    ' + l)
                .join('\n'),
            );
          }

          if (task.result !== null) {
            console.log(`  ${ui.brand('Result:')}`);
            const resultStr =
              typeof task.result === 'object'
                ? JSON.stringify(task.result, null, 2)
                : String(task.result);
            console.log(
              resultStr
                .split('\n')
                .map((l) => '    ' + l)
                .join('\n'),
            );
          }

          if (task.error) {
            console.log(`  ${ui.error('Error:')}       ${task.error}`);
          }
          break;
        }

        case 'cancel': {
          const taskId = args[1];
          if (!taskId) {
            ui.error('Usage: task cancel <task-id>');
            return;
          }

          try {
            const task = await taskQueue.cancel(taskId);
            if (task) {
              ui.success(`Task ${taskId} cancelled successfully`);
            } else {
              ui.error(`Task ${taskId} not found`);
            }
          } catch (error) {
            ui.error(`Failed to cancel task: ${error.message}`);
          }
          break;
        }

        default:
          ui.error(`Unknown task subcommand: ${subcommand}`);
          ui.info('Available subcommands: list, status, cancel');
      }
    },

    /**
     * 处理调度计划相关命令
     * @param {Array<string>} args - 命令参数
     */
    async handleScheduleCommand(args) {
      const subcommand = args[0];

      switch (subcommand) {
        case 'list': {
          const enabledOnly = args.includes('--enabled');
          const options = {};
          if (enabledOnly) {
            options.enabled = true;
          }

          const schedules = cronScheduler.list(options);

          ui.header('Schedules');
          if (schedules.length === 0) {
            ui.info('No schedules found');
            return;
          }

          console.log(
            `  ${ui.brand('ID')} | ${'Name'.padEnd(20)} | ${'Status'.padEnd(8)} | ${'Cron'.padEnd(15)} | ${'Next Run'.padEnd(20)} | Runs`,
          );
          console.log('  ' + '─'.repeat(110));

          for (const schedule of schedules) {
            const statusStr = schedule.enabled ? ui.success('enabled') : ui.warn('disabled');
            const nextRun = schedule.nextRunAt
              ? new Date(schedule.nextRunAt).toLocaleString()
              : 'N/A';

            console.log(
              `  ${schedule.id.substring(0, 15).padEnd(15)} | ` +
                `${schedule.name.substring(0, 20).padEnd(20)} | ` +
                `${statusStr.padEnd(8)} | ` +
                `${schedule.cron.padEnd(15)} | ` +
                `${nextRun.padEnd(20)} | ` +
                `${schedule.runCount}${schedule.maxRuns ? '/' + schedule.maxRuns : ''}`,
            );
          }
          console.log('');
          ui.info(`Total: ${schedules.length} schedules`);
          break;
        }

        case 'toggle': {
          const scheduleId = args[1];
          if (!scheduleId) {
            ui.error('Usage: schedule toggle <schedule-id>');
            return;
          }

          const schedule = await cronScheduler.toggle(scheduleId);
          if (schedule) {
            const status = schedule.enabled ? 'enabled' : 'disabled';
            ui.success(`Schedule ${scheduleId} is now ${status}`);
          } else {
            ui.error(`Schedule ${scheduleId} not found`);
          }
          break;
        }

        default:
          ui.error(`Unknown schedule subcommand: ${subcommand}`);
          ui.info('Available subcommands: list, toggle');
      }
    },

    /**
     * 处理子代理相关命令
     * @param {Array<string>} args - 命令参数
     */
    async handleSubAgentCommand(args) {
      const subcommand = args[0];

      switch (subcommand) {
        case 'list': {
          const agents = subAgentPool.list();

          ui.header('SubAgents');
          if (agents.length === 0) {
            ui.info('No active subagents');
            return;
          }

          console.log(
            `  ${ui.brand('ID')} | ${'Status'.padEnd(10)} | ${'Parent'.padEnd(15)} | ${'Started'.padEnd(20)} | Iterations`,
          );
          console.log('  ' + '─'.repeat(90));

          for (const agent of agents) {
            const statusColor =
              {
                idle: (s) => s,
                running: (s) => ui.brand(s),
                completed: (s) => ui.success(s),
                failed: (s) => ui.error(s),
                stopped: (s) => ui.warn(s),
              }[agent.status] || ((s) => s);

            console.log(
              `  ${agent.id.substring(0, 20).padEnd(20)} | ` +
                `${statusColor(agent.status).padEnd(10)} | ` +
                `${(agent.parentId || 'N/A').substring(0, 15).padEnd(15)} | ` +
                `${new Date(agent.createdAt).toLocaleString().padEnd(20)} | ` +
                `${agent.iterationCount || 0}`,
            );
          }
          console.log('');
          ui.info(`Total: ${agents.length} active subagents`);

          // 显示统计信息
          const stats = subAgentPool.getStats();
          console.log('');
          ui.info(
            `Stats: ${stats.running} running, ${stats.idle} idle, ${stats.completed} completed, ${stats.failed} failed`,
          );
          break;
        }

        case 'stop': {
          const agentId = args[1];
          if (!agentId) {
            ui.error('Usage: subagent stop <agent-id>');
            return;
          }

          try {
            const result = await subAgentPool.remove(agentId);
            if (result) {
              ui.success(`SubAgent ${agentId} stopped and removed successfully`);
            } else {
              ui.error(`SubAgent ${agentId} not found`);
            }
          } catch (error) {
            ui.error(`Failed to stop subagent: ${error.message}`);
          }
          break;
        }

        default:
          ui.error(`Unknown subagent subcommand: ${subcommand}`);
          ui.info('Available subcommands: list, stop');
      }
    },
  };
}

export default createSchedulerCommands;
