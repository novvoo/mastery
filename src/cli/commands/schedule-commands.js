/**
 * Schedule Management Commands
 * 调度计划管理命令 - 交互式菜单、创建、列表、切换、删除等
 */

import { input, select, confirm } from '@inquirer/prompts';
import {
  enhancedUI,
  createTable,
  formatStatus,
  formatTime,
  formatDuration,
  truncate,
} from '../enhanced-ui.js';
import { SCHEDULE_MENU_CHOICES } from '../enhanced-command-utils.js';

/**
 * 创建调度计划管理命令
 * @param {Object} deps - 依赖项
 * @param {import('../../scheduler/cron-scheduler.js').CronScheduler} deps.cronScheduler - 调度器
 * @returns {Object} 调度计划管理命令方法
 */
export function createScheduleCommands(deps) {
  const { cronScheduler } = deps;

  return {
    /**
     * 调度计划管理菜单
     */
    async showScheduleMenu() {
      const action = await select({
        message: 'Schedule Management:',
        choices: SCHEDULE_MENU_CHOICES,
      });

      switch (action) {
        case 'list':
          await this.showScheduleList();
          break;
        case 'create':
          await this.interactiveCreateSchedule();
          break;
        case 'detail':
          await this.showScheduleDetailInteractive();
          break;
        case 'toggle':
          await this.toggleScheduleInteractive();
          break;
      }
    },

    /**
     * 显示调度计划列表
     */
    async showScheduleList() {
      const schedules = cronScheduler.list();

      if (schedules.length === 0) {
        enhancedUI.info('No schedules found');
        return;
      }

      console.log(enhancedUI.createHeader('Schedule List'));

      const table = createTable({
        head: ['ID', 'Name', 'Status', 'Cron', 'Next Run', 'Runs'],
        colWidths: [18, 20, 12, 18, 18, 10],
      });

      for (const schedule of schedules) {
        table.push([
          truncate(schedule.id, 16),
          truncate(schedule.name, 18),
          schedule.enabled ? formatStatus('enabled') : formatStatus('disabled'),
          schedule.cron,
          schedule.nextRunAt ? formatTime(schedule.nextRunAt) : 'N/A',
          `${schedule.runCount}${schedule.maxRuns ? '/' + schedule.maxRuns : ''}`,
        ]);
      }

      console.log(table.toString());
      console.log('');
      enhancedUI.info(`Total: ${schedules.length} schedules`);
    },

    /**
     * 交互式创建调度计划
     */
    async interactiveCreateSchedule() {
      const name = await input({
        message: 'Schedule name:',
        validate: (input) => input.trim() !== '' || 'Name is required',
      });

      const cron = await input({
        message: 'Cron expression (e.g., "0 9 * * *" for daily at 9am):',
        validate: (input) => input.trim() !== '' || 'Cron expression is required',
      });

      const taskType = await input({
        message: 'Task type to execute:',
        validate: (input) => input.trim() !== '' || 'Task type is required',
      });

      const enabled = await confirm({
        message: 'Enable immediately?',
        default: true,
      });

      try {
        const schedule = await cronScheduler.add({
          name: name,
          cron: cron,
          taskType: taskType,
          taskPayload: {},
          enabled: enabled,
        });

        enhancedUI.success(`Schedule created: ${schedule.id}`);
      } catch (error) {
        enhancedUI.error(`Failed to create schedule: ${error.message}`);
      }
    },

    async showScheduleDetailInteractive() {
      const schedules = cronScheduler.list();
      if (schedules.length === 0) {
        enhancedUI.info('No schedules available');
        return;
      }

      const scheduleId = await select({
        message: 'Select schedule:',
        choices: schedules.map((s) => ({
          name: `${truncate(s.id, 15)} - ${s.name}`,
          value: s.id,
        })),
      });

      const schedule = cronScheduler.get(scheduleId);
      if (!schedule) {
        enhancedUI.error('Schedule not found');
        return;
      }

      console.log(enhancedUI.createHeader(`Schedule: ${schedule.name}`));

      const table = createTable({
        colWidths: [20, 50],
      });

      table.push(
        [enhancedUI.theme.primaryBold('ID'), schedule.id],
        [enhancedUI.theme.primaryBold('Name'), schedule.name],
        [
          enhancedUI.theme.primaryBold('Status'),
          schedule.enabled ? formatStatus('enabled') : formatStatus('disabled'),
        ],
        [enhancedUI.theme.primaryBold('Cron'), schedule.cron],
        [
          enhancedUI.theme.primaryBold('Next Run'),
          schedule.nextRunAt ? formatTime(schedule.nextRunAt) : 'N/A',
        ],
        [
          enhancedUI.theme.primaryBold('Last Run'),
          schedule.lastRunAt ? formatTime(schedule.lastRunAt) : 'N/A',
        ],
        [
          enhancedUI.theme.primaryBold('Run Count'),
          `${schedule.runCount}${schedule.maxRuns ? '/' + schedule.maxRuns : ''}`,
        ],
        [enhancedUI.theme.primaryBold('Task Type'), schedule.taskType],
      );

      console.log(table.toString());
      console.log('');
    },

    async toggleScheduleInteractive() {
      const schedules = cronScheduler.list();
      if (schedules.length === 0) {
        enhancedUI.info('No schedules available');
        return;
      }

      const scheduleId = await select({
        message: 'Select schedule to toggle:',
        choices: schedules.map((s) => ({
          name: `${truncate(s.id, 15)} - ${s.name} (${s.enabled ? 'enabled' : 'disabled'})`,
          value: s.id,
        })),
      });

      const schedule = await cronScheduler.toggle(scheduleId);
      if (schedule) {
        enhancedUI.success(
          `Schedule ${scheduleId} is now ${schedule.enabled ? 'enabled' : 'disabled'}`,
        );
      } else {
        enhancedUI.error(`Schedule ${scheduleId} not found`);
      }
    },

    async handleScheduleCommand(args) {
      if (typeof args === 'string') {
        args = args.split(' ').filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case undefined:
        case 'list':
          await this.showScheduleList();
          break;
        case 'toggle':
          if (args[1]) {
            const schedule = await cronScheduler.toggle(args[1]);
            if (schedule) {
              enhancedUI.success(
                `Schedule ${args[1]} is now ${schedule.enabled ? 'enabled' : 'disabled'}`,
              );
            } else {
              enhancedUI.error(`Schedule ${args[1]} not found`);
            }
          } else {
            await this.toggleScheduleInteractive();
          }
          break;
        default:
          enhancedUI.error(`Unknown schedule subcommand: ${subcommand}`);
          enhancedUI.info('Available: list, toggle');
      }
    },
  };
}
