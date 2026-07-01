/**
 * Enhanced CLI Commands
 * 增强版命令处理器 - 支持交互式菜单、表格显示、更好的格式化
 *
 * 此文件是组合层，将各命令组模块聚合为统一的命令处理器对象。
 * 各命令组的实现位于 ./commands/ 目录下。
 */

import { select } from '@inquirer/prompts';
import {
  enhancedUI,
  createTable,
  formatStatus,
  formatTime,
  formatDuration,
  truncate,
} from './enhanced-ui.js';
import { MAIN_MENU_CHOICES } from './enhanced-command-utils.js';

import { createTaskCommands } from './commands/task-commands.js';
import { createScheduleCommands } from './commands/schedule-commands.js';
import { createMcpCommands } from './commands/mcp-commands.js';
import { createGitCommands } from './commands/git-commands.js';
import {
  createExperienceCommands,
  createReasoningCommands,
  createSecurityCommands,
} from './commands/experience-commands.js';
import { createAutomationCommands } from './commands/automation-commands.js';

/**
 * 创建增强版命令处理器
 * @param {SchedulerEngine} schedulerEngine - 调度引擎实例
 * @param {Object} options - 附加选项
 * @param {import('../../mcp/mcp-client.js').MCPClient} [options.mcpClient] - MCP 客户端
 * @param {import('../../core/token-juice.js').TokenJuice} [options.tokenJuice] - Token 压缩引擎
 * @param {import('../../core/experience-memory.js').ExperienceMemory} [options.experienceMemory] - 经验记忆
 * @param {import('../../core/security-policy.js').SecurityPolicy} [options.securityPolicy] - 安全策略
 * @returns {Object} 命令处理器对象
 */
export function createEnhancedCommands(schedulerEngine, options = {}) {
  const taskQueue = schedulerEngine.getTaskQueue();
  const cronScheduler = schedulerEngine.getCronScheduler();
  const subAgentPool = schedulerEngine.getSubAgentPool();
  const mcpClient = options.mcpClient || null;
  const experienceMemory = options.experienceMemory || null;
  const securityPolicy = options.securityPolicy || null;
  const intelligentReasoning = options.intelligentReasoning || null;
  const automationEngine = options.automationEngine || null;
  const registerMcpTools = options.registerMcpTools || null;
  const theme = enhancedUI.theme;

  // 创建各命令组
  const taskCmds = createTaskCommands({ taskQueue });
  const scheduleCmds = createScheduleCommands({ cronScheduler });
  const mcpCmds = createMcpCommands({ mcpClient, registerMcpTools });
  const gitCmds = createGitCommands({});
  const experienceCmds = createExperienceCommands({ experienceMemory });
  const reasoningCmds = createReasoningCommands({ intelligentReasoning });
  const securityCmds = createSecurityCommands({ securityPolicy });
  const automationCmds = createAutomationCommands({ automationEngine });

  return {
    // ─── 主菜单 ─────────────────────────────────────────

    /**
     * 显示交互式主菜单
     */
    async showMainMenu() {
      const action = await select({
        message: 'Select action:',
        choices: MAIN_MENU_CHOICES,
      });

      return action;
    },

    // ─── 统计与帮助 ─────────────────────────────────────────

    /**
     * 显示统计信息
     */
    async showStatistics() {
      console.log(enhancedUI.createHeader('System Statistics'));

      const stats = schedulerEngine.getStats();

      // 任务统计
      console.log(enhancedUI.theme.primaryBold('\n📋 Tasks:'));
      const taskTable = createTable({
        colWidths: [25, 15],
      });
      taskTable.push(
        ['Pending', stats.taskQueue.pending],
        ['Waiting', stats.taskQueue.waiting],
        ['Running', stats.taskQueue.running],
        ['Completed', stats.taskQueue.completed],
        ['Failed', stats.taskQueue.failed],
        ['Cancelled', stats.taskQueue.cancelled],
        ['Total', stats.taskQueue.total],
      );
      console.log(taskTable.toString());

      // 调度计划统计
      console.log(enhancedUI.theme.primaryBold('\n⏰ Schedules:'));
      const scheduleTable = createTable({
        colWidths: [25, 15],
      });
      scheduleTable.push(
        ['Enabled', stats.cronScheduler.enabledSchedules],
        ['Disabled', stats.cronScheduler.disabledSchedules],
        ['Total', stats.cronScheduler.totalSchedules],
      );
      console.log(scheduleTable.toString());

      // SubAgent 统计
      console.log(enhancedUI.theme.primaryBold('\n🤖 SubAgents:'));
      const agentTable = createTable({
        colWidths: [25, 15],
      });
      agentTable.push(
        ['Idle', stats.subAgentPool.idle],
        ['Running', stats.subAgentPool.running],
        ['Completed', stats.subAgentPool.completed],
        ['Failed', stats.subAgentPool.failed],
        ['Total', stats.subAgentPool.total],
      );
      console.log(agentTable.toString());

      // 自动清理状态
      const cleanupStatus = subAgentPool.getAutoCleanupStatus?.();
      if (cleanupStatus) {
        console.log(enhancedUI.theme.primaryBold('\n🧹 Auto Cleanup:'));
        console.log(
          `  Status: ${cleanupStatus.enabled ? formatStatus('enabled') : formatStatus('disabled')}`,
        );
        console.log(`  Running: ${cleanupStatus.running ? 'Yes' : 'No'}`);
        console.log(`  Interval: ${formatDuration(cleanupStatus.intervalMs)}`);
      }

      console.log('');
    },

    // ─── SubAgent 命令 ─────────────────────────────────────────

    async handleSubAgentCommand(args) {
      if (typeof args === 'string') {
        args = args.split(' ').filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case undefined:
        case 'list':
          await this.showSubAgentList();
          break;
        case 'stop':
          if (args[1]) {
            try {
              await subAgentPool.remove(args[1]);
              enhancedUI.success(`SubAgent ${args[1]} stopped`);
            } catch (error) {
              enhancedUI.error(error.message);
            }
          } else {
            enhancedUI.error('Usage: /subagent stop <id>');
          }
          break;
        default:
          enhancedUI.error(`Unknown subagent subcommand: ${subcommand}`);
          enhancedUI.info('Available: list, stop');
      }
    },

    async showSubAgentList() {
      const agents = subAgentPool.list();

      if (agents.length === 0) {
        enhancedUI.info('No active subagents');
        return;
      }

      console.log(enhancedUI.createHeader('SubAgents'));

      const table = createTable({
        head: ['ID', 'Status', 'Parent', 'Started', 'Duration'],
        colWidths: [22, 12, 15, 18, 12],
      });

      for (const agent of agents) {
        const duration = agent.startTime
          ? formatDuration((agent.endTime || Date.now()) - agent.startTime)
          : 'N/A';

        table.push([
          truncate(agent.id, 20),
          formatStatus(agent.status),
          agent.parentId ? truncate(agent.parentId, 13) : 'N/A',
          agent.startTime ? formatTime(agent.startTime) : 'N/A',
          duration,
        ]);
      }

      console.log(table.toString());
      console.log('');

      const stats = subAgentPool.getStats();
      console.log(
        `  ${formatStatus('running')}: ${stats.running}  ` +
          `${formatStatus('idle')}: ${stats.idle}  ` +
          `${formatStatus('completed')}: ${stats.completed}  ` +
          `${formatStatus('failed')}: ${stats.failed}`,
      );
      console.log('');
    },

    // ─── 帮助信息 ─────────────────────────────────────────

    /**
     * 显示帮助信息
     */
    showHelp() {
      console.log(enhancedUI.createHeader('Available Commands'));

      const commands = [
        ['Command', 'Description'],
        ['exit, quit, /exit', 'Exit the agent'],
        ['/clear, /reset', 'Clear current session'],
        ['/tools, /help', 'Show available tools'],
        ['/context, /memory', 'Show memory context'],
        ['/menu', 'Open interactive menu'],
        ['/model', 'Show current model'],
        ['/model switch', 'Switch model interactively'],
        ['/model <provider>:<model>', 'Switch model directly'],
        ['/doc', 'Document RAG commands'],
        ['/doc init', 'Initialize and diagnose document RAG'],
        ['/doc add [--ocr] [path-or-url]', 'Index a local document, image, PDF, or URL'],
        ['/doc search <query>', 'Search indexed documents'],
        ['/ocr', 'Show OCR runtime and model status'],
        ['/ocr init', 'Download OCR models and initialize runtime'],
        ['/ocr <image-path>', 'Run OCR on a local image'],
        ['/tasks', 'Task management commands'],
        ['/schedules', 'Schedule management commands'],
        ['/subagents', 'SubAgent management commands'],
        ['/stats', 'Show system statistics'],
        ['', ''],
        ['Task Commands', ''],
        ['/task list [--status=] [--limit=]', 'List tasks'],
        ['/task status <id>', 'Show task details'],
        ['/task cancel <id>', 'Cancel a task'],
        ['', ''],
        ['Schedule Commands', ''],
        ['/schedule list [--enabled]', 'List schedules'],
        ['/schedule toggle <id>', 'Enable/disable schedule'],
        ['', ''],
        ['SubAgent Commands', ''],
        ['/subagent list', 'List active subagents'],
        ['/subagent stop <id>', 'Stop a subagent'],
        ['', ''],
        ['Git Commands', ''],
        ['/git', 'Show working tree status'],
        ['/git menu', 'Open Git interactive menu'],
        ['/git status', 'Show working tree status'],
        ['/git diff [--staged] [--stat]', 'Show file changes'],
        ['/git add [-A | <files...>]', 'Stage files'],
        ['/git commit <message>', 'Commit staged changes'],
        ['/git branch [list|create|delete]', 'Branch management'],
        ['/git log [-n N]', 'Show commit history'],
        ['/git push [remote] [branch]', 'Push to remote'],
        ['/git pull [--rebase]', 'Pull from remote'],
        ['/git stash [push|pop|list|drop]', 'Stash management'],
        ['/git reset [--soft|--mixed|--hard]', 'Reset changes'],
        ['', ''],
        ['MCP Commands', ''],
        ['/mcp', 'Show MCP client status'],
        ['/mcp menu', 'Open MCP interactive menu'],
        ['/mcp status', 'Show MCP client status'],
        ['/mcp list', 'List connected servers'],
        ['/mcp tools', 'List available MCP tools'],
        ['/mcp connect <name> <cmd>', 'Connect to MCP server'],
        ['/mcp disconnect <name>', 'Disconnect MCP server'],
        ['/mcp call <tool-name>', 'Call an MCP tool'],
        ['', ''],
        ['Security Commands', ''],
        ['/security', 'Show security report'],
        ['/security menu', 'Open security interactive menu'],
        ['/security report', 'Show security report'],
        ['/security policy <tool>', 'View tool security policy'],
        ['/security list', 'List tools by permission level'],
        ['', ''],
        ['Experience Commands', ''],
        ['/experience', 'Show experience statistics'],
        ['/experience menu', 'Open experience interactive menu'],
        ['/experience stats', 'Show experience statistics'],
        ['/experience list [n]', 'List recent experiences'],
        ['/experience search <q>', 'Search experiences'],
        ['', ''],
        ['Utility Commands', ''],
        ['/doc init', 'Show embedding runtime, model, and download status'],
        ['/doc add [--ocr] [path-or-url]', 'Index PDF, DOCX, images, text, or URL documents'],
        ['/doc search <query>', 'Search indexed document chunks'],
        ['/doc list', 'List indexed documents'],
        ['/doc clear [id]', 'Clear indexed document context'],
        ['/ocr', 'Show OCR runtime, model, and download status'],
        ['/ocr init', 'Download missing OCR model files'],
        ['/ocr <image-path>', 'Extract text from an image with OCR'],
        ['/compress <text>', 'Compress text with TokenJuice'],
        ['/debug', 'Toggle debug mode on/off'],
        ['', ''],
        ['Reasoning Commands', ''],
        ['/reason', 'Show reasoning usage'],
        ['/reason menu', 'Open reasoning interactive menu'],
        ['/reason intent <text>', 'Analyze user intent'],
        ['/reason tools <task>', 'Recommend tools for task'],
        ['/reason decompose <task>', 'Decompose complex task'],
        ['', ''],
        ['Automation Commands', ''],
        ['/auto', 'Show automation status'],
        ['/auto menu', 'Open automation interactive menu'],
        ['/auto start', 'Start automation engine'],
        ['/auto stop', 'Stop automation engine'],
        ['/auto status', 'Show automation status'],
        ['/auto triggers', 'List triggers'],
        ['/auto workflows', 'List workflows'],
        ['/auto background', 'List background tasks'],
      ];

      const table = createTable({
        colWidths: [35, 50],
      });

      for (let i = 1; i < commands.length; i++) {
        const [cmd, desc] = commands[i];
        if (cmd === '' && desc === '') {
          table.push([{ colSpan: 2, content: '' }]);
        } else if (desc === '') {
          table.push([{ colSpan: 2, content: enhancedUI.theme.primaryBold(cmd) }]);
        } else {
          table.push([enhancedUI.theme.secondary(cmd), desc]);
        }
      }

      console.log(table.toString());
      console.log('');
    },

    // ─── 组合各命令组 ─────────────────────────────────────────

    // Task commands
    showTaskMenu: taskCmds.showTaskMenu,
    showTaskList: taskCmds.showTaskList,
    interactiveCreateTask: taskCmds.interactiveCreateTask,
    showTaskDetailInteractive: taskCmds.showTaskDetailInteractive,
    showTaskDetail: taskCmds.showTaskDetail,
    cancelTaskInteractive: taskCmds.cancelTaskInteractive,
    retryTaskInteractive: taskCmds.retryTaskInteractive,
    handleTaskCommand: taskCmds.handleTaskCommand,

    // Schedule commands
    showScheduleMenu: scheduleCmds.showScheduleMenu,
    showScheduleList: scheduleCmds.showScheduleList,
    interactiveCreateSchedule: scheduleCmds.interactiveCreateSchedule,
    showScheduleDetailInteractive: scheduleCmds.showScheduleDetailInteractive,
    toggleScheduleInteractive: scheduleCmds.toggleScheduleInteractive,
    handleScheduleCommand: scheduleCmds.handleScheduleCommand,

    // MCP commands
    handleMcpCommand: mcpCmds.handleMcpCommand,
    showMcpMenu: mcpCmds.showMcpMenu,
    mcpStatus: mcpCmds.mcpStatus,
    mcpListServers: mcpCmds.mcpListServers,
    mcpListTools: mcpCmds.mcpListTools,
    mcpListResources: mcpCmds.mcpListResources,
    mcpConnect: mcpCmds.mcpConnect,
    mcpDisconnect: mcpCmds.mcpDisconnect,
    mcpCallTool: mcpCmds.mcpCallTool,

    // Git commands
    handleGitCommand: gitCmds.handleGitCommand,
    showGitMenu: gitCmds.showGitMenu,
    gitStatus: gitCmds.gitStatus,
    gitDiff: gitCmds.gitDiff,
    gitAdd: gitCmds.gitAdd,
    gitCommit: gitCmds.gitCommit,
    gitBranch: gitCmds.gitBranch,
    gitLog: gitCmds.gitLog,
    gitPush: gitCmds.gitPush,
    gitPull: gitCmds.gitPull,
    gitStash: gitCmds.gitStash,
    gitReset: gitCmds.gitReset,

    // Experience commands
    handleExperienceCommand: experienceCmds.handleExperienceCommand,
    showExperienceMenu: experienceCmds.showExperienceMenu,
    experienceStats: experienceCmds.experienceStats,
    experienceList: experienceCmds.experienceList,
    experienceSearch: experienceCmds.experienceSearch,

    // Reasoning commands
    handleReasonCommand: reasoningCmds.handleReasonCommand,
    showReasonMenu: reasoningCmds.showReasonMenu,
    analyzeIntent: reasoningCmds.analyzeIntent,
    recommendTools: reasoningCmds.recommendTools,
    decomposeTask: reasoningCmds.decomposeTask,

    // Security commands
    handleSecurityCommand: securityCmds.handleSecurityCommand,
    showSecurityMenu: securityCmds.showSecurityMenu,
    securityReport: securityCmds.securityReport,
    securityPolicyDetail: securityCmds.securityPolicyDetail,
    securityListTools: securityCmds.securityListTools,

    // Automation commands
    handleAutoCommand: automationCmds.handleAutoCommand,
    showAutoMenu: automationCmds.showAutoMenu,
    autoStatus: automationCmds.autoStatus,
    autoListTriggers: automationCmds.autoListTriggers,
    autoListWorkflows: automationCmds.autoListWorkflows,
    autoListBackground: automationCmds.autoListBackground,
  };
}

export default createEnhancedCommands;
