/**
 * Automation Commands
 * 自动化引擎命令 - 状态、触发器、工作流、后台任务
 */

import { select } from '@inquirer/prompts';
import { enhancedUI, createTable, formatStatus } from '../enhanced-ui.js';
import { automationMenuChoices } from '../enhanced-command-utils.js';

/**
 * 创建自动化引擎命令
 * @param {Object} deps - 依赖项
 * @param {Object} deps.automationEngine - 自动化引擎
 * @returns {Object} 自动化引擎命令方法
 */
export function createAutomationCommands(deps) {
  const { automationEngine } = deps;

  return {
    async handleAutoCommand(args) {
      if (!automationEngine) {
        enhancedUI.error('Automation engine not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'status':
          await this.autoStatus();
          break;
        case 'start':
          await automationEngine.start();
          enhancedUI.success('Automation engine started');
          break;
        case 'stop':
          await automationEngine.stop();
          enhancedUI.success('Automation engine stopped');
          break;
        case 'triggers':
          await this.autoListTriggers();
          break;
        case 'workflows':
          await this.autoListWorkflows();
          break;
        case 'background':
          await this.autoListBackground();
          break;
        case 'menu':
          await this.showAutoMenu();
          break;
        default:
          if (!subcommand) {
            await this.autoStatus();
          } else {
            enhancedUI.error(`Unknown automation subcommand: ${subcommand}`);
            enhancedUI.info('Available: status, start, stop, triggers, workflows, background, menu');
          }
      }
    },

    async showAutoMenu() {
      const status = automationEngine.getStatus();
      const action = await select({
        message: `Automation Engine (${status.isRunning ? '🟢 running' : '🔴 stopped'}):`,
        choices: automationMenuChoices(status.isRunning),
      });
      if (action === 'back') {return;}
      if (action === 'toggle') {
        if (status.isRunning) {
          await automationEngine.stop();
          enhancedUI.success('Automation engine stopped');
        } else {
          await automationEngine.start();
          enhancedUI.success('Automation engine started');
        }
        return;
      }
      await this.handleAutoCommand([action]);
    },

    async autoStatus() {
      const stats = automationEngine.getStats();
      console.log(enhancedUI.createHeader('Automation Engine Status'));

      const table = createTable({ colWidths: [30, 20] });
      table.push(
        [enhancedUI.theme.primaryBold('Running'), formatStatus(stats.status.isRunning)],
        [enhancedUI.theme.primaryBold('Triggers'), stats.status.triggers],
        [enhancedUI.theme.primaryBold('Workflows'), stats.status.workflows],
        [enhancedUI.theme.primaryBold('Conditions'), stats.status.conditions],
        [enhancedUI.theme.primaryBold('Background Tasks'), stats.status.backgroundTasks],
        [enhancedUI.theme.primaryBold('File Watchers'), stats.status.fileWatchers],
      );
      console.log(table.toString());
      console.log('');
    },

    async autoListTriggers() {
      const triggers = automationEngine.listTriggers();
      console.log(enhancedUI.createHeader('Automation Triggers'));

      if (triggers.length === 0) {
        enhancedUI.info('No triggers registered');
        return;
      }

      const table = createTable({
        head: ['ID', 'Type', 'Enabled', 'Trigger Count'],
        colWidths: [20, 15, 10, 15],
      });
      for (const t of triggers) {
        table.push([
          t.id,
          t.type,
          formatStatus(t.enabled),
          t.triggerCount,
        ]);
      }
      console.log(table.toString());
      console.log('');
    },

    async autoListWorkflows() {
      const workflows = automationEngine.listWorkflows();
      console.log(enhancedUI.createHeader('Automation Workflows'));

      if (workflows.length === 0) {
        enhancedUI.info('No workflows created');
        return;
      }

      const table = createTable({
        head: ['ID', 'Name', 'Status', 'Step', 'Total'],
        colWidths: [15, 20, 12, 8, 8],
      });
      for (const w of workflows) {
        table.push([
          w.id,
          w.name,
          w.status,
          w.currentStep + 1,
          w.steps.length,
        ]);
      }
      console.log(table.toString());
      console.log('');
    },

    async autoListBackground() {
      const tasks = automationEngine.listBackgroundTasks();
      console.log(enhancedUI.createHeader('Background Tasks'));

      if (tasks.length === 0) {
        enhancedUI.info('No background tasks registered');
        return;
      }

      const table = createTable({
        head: ['ID', 'Name', 'Enabled', 'Runs', 'Errors'],
        colWidths: [15, 20, 10, 10, 10],
      });
      for (const t of tasks) {
        table.push([
          t.id,
          t.name,
          formatStatus(t.enabled),
          t.runCount,
          t.errorCount,
        ]);
      }
      console.log(table.toString());
      console.log('');
    },
  };
}
