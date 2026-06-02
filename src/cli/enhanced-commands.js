/**
 * Enhanced CLI Commands
 * 增强版命令处理器 - 支持交互式菜单、表格显示、更好的格式化
 */

import { input, select, confirm } from '@inquirer/prompts';
import { Separator } from '@inquirer/core';
import { enhancedUI, createTable, formatStatus, formatPriority, formatTime, formatDuration, truncate } from './enhanced-ui.js';

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
  const messageBus = schedulerEngine.getMessageBus();
  const mcpClient = options.mcpClient || null;
  const tokenJuice = options.tokenJuice || null;
  const experienceMemory = options.experienceMemory || null;
  const securityPolicy = options.securityPolicy || null;
  const intelligentReasoning = options.intelligentReasoning || null;
  const automationEngine = options.automationEngine || null;
  const registerMcpTools = options.registerMcpTools || null;
  const theme = enhancedUI.theme;

  async function runGit(args) {
    const { spawnSync } = await import('child_process');
    const result = spawnSync('git', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(output.trim() || `git exited with status ${result.status}`);
    }
    return output;
  }

  return {
    /**
     * 显示交互式主菜单
     */
    async showMainMenu() {
      const action = await select({
        message: 'Select action:',
        choices: [
          { name: '📋 Task Management', value: 'tasks' },
          { name: '⏰ Schedule Management', value: 'schedules' },
          { name: '🤖 SubAgent Management', value: 'subagents' },
          { name: '🌿 Git Operations', value: 'git' },
          { name: '🔗 MCP Management', value: 'mcp' },
          { name: '🔒 Security', value: 'security' },
          { name: '🧠 Experience Memory', value: 'experience' },
          { name: '🎯 Intelligent Reasoning', value: 'reasoning' },
          { name: '⚙️  Automation', value: 'automation' },
          { name: '📊 View Statistics', value: 'stats' },
          { name: '💬 Message Bus', value: 'messages' },
          { name: '❌ Exit', value: 'exit' },
        ],
      });

      return action;
    },

    /**
     * 任务管理菜单
     */
    async showTaskMenu() {
      const action = await select({
        message: 'Task Management:',
        choices: [
          { name: '📋 List Tasks', value: 'list' },
          { name: '➕ Create Task', value: 'create' },
          { name: '🔍 View Task Details', value: 'detail' },
          { name: '🗑️  Cancel Task', value: 'cancel' },
          { name: '🔁 Retry Failed Task', value: 'retry' },
          { name: '⬅️  Back', value: 'back' },
        ],
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
        const duration = task.startedAt && task.completedAt
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
        `${formatStatus('failed')}: ${stats.failed}`
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
        choices: [
          { name: '🔴 Critical', value: 0 },
          { name: '🟠 High', value: 1 },
          { name: '🔵 Normal', value: 2 },
          { name: '🟢 Low', value: 3 },
          { name: '⚪ Background', value: 4 },
        ],
        default: 2,
      });
      
      const dependsOnStr = await input({
        message: 'Depends on (comma-separated task IDs, optional):',
      });
      const dependsOn = dependsOnStr.split(',').map(s => s.trim()).filter(Boolean);

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
        choices: tasks.map(t => ({
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
        details.push(['Completed Deps', Array.from(task.completedDependencies).join(', ') || 'None']);
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
        const resultStr = typeof task.result === 'object'
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
      const tasks = taskQueue.list({ status: 'pending' }).concat(taskQueue.list({ status: 'running' }));
      if (tasks.length === 0) {
        enhancedUI.info('No cancellable tasks');
        return;
      }

      const taskId = await select({
        message: 'Select task to cancel:',
        choices: tasks.map(t => ({
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
        choices: tasks.map(t => ({
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

    /**
     * 调度计划管理菜单
     */
    async showScheduleMenu() {
      const action = await select({
        message: 'Schedule Management:',
        choices: [
          { name: '📋 List Schedules', value: 'list' },
          { name: '➕ Create Schedule', value: 'create' },
          { name: '🔍 View Schedule Details', value: 'detail' },
          { name: '⏯️  Toggle Schedule', value: 'toggle' },
          { name: '⬅️  Back', value: 'back' },
        ],
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
        ['Total', stats.taskQueue.total]
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
        ['Total', stats.cronScheduler.totalSchedules]
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
        ['Total', stats.subAgentPool.total]
      );
      console.log(agentTable.toString());

      // 自动清理状态
      const cleanupStatus = subAgentPool.getAutoCleanupStatus?.();
      if (cleanupStatus) {
        console.log(enhancedUI.theme.primaryBold('\n🧹 Auto Cleanup:'));
        console.log(`  Status: ${cleanupStatus.enabled ? formatStatus('enabled') : formatStatus('disabled')}`);
        console.log(`  Running: ${cleanupStatus.running ? 'Yes' : 'No'}`);
        console.log(`  Interval: ${formatDuration(cleanupStatus.intervalMs)}`);
      }

      console.log('');
    },

    // ─── Git 命令处理 ─────────────────────────────────────────

    /**
     * 处理 /git 命令
     * @param {string} args - 命令参数
     */
    async handleGitCommand(args) {
      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'status':
          await this.gitStatus(args.slice(1));
          break;
        case 'diff':
          await this.gitDiff(args.slice(1));
          break;
        case 'add':
          await this.gitAdd(args.slice(1));
          break;
        case 'commit':
          await this.gitCommit(args.slice(1));
          break;
        case 'branch':
          await this.gitBranch(args.slice(1));
          break;
        case 'log':
          await this.gitLog(args.slice(1));
          break;
        case 'push':
          await this.gitPush(args.slice(1));
          break;
        case 'pull':
          await this.gitPull(args.slice(1));
          break;
        case 'stash':
          await this.gitStash(args.slice(1));
          break;
        case 'reset':
          await this.gitReset(args.slice(1));
          break;
        case 'menu':
          await this.showGitMenu();
          break;
        default:
          if (!subcommand) {
            await this.gitStatus([]);
          } else {
            enhancedUI.error(`Unknown git subcommand: ${subcommand}`);
            enhancedUI.info('Available: status, diff, add, commit, branch, log, push, pull, stash, reset, menu');
          }
      }
    },

    /**
     * Git 交互式菜单
     */
    async showGitMenu() {
      const action = await select({
        message: 'Git Operations:',
        choices: [
          { name: '📋 Status', value: 'status' },
          { name: '📝 Diff', value: 'diff' },
          { name: '➕ Add', value: 'add' },
          { name: '💾 Commit', value: 'commit' },
          { name: '🌿 Branch', value: 'branch' },
          { name: '📜 Log', value: 'log' },
          { name: '⬆️  Push', value: 'push' },
          { name: '⬇️  Pull', value: 'pull' },
          { name: '📦 Stash', value: 'stash' },
          { name: '↩️  Reset', value: 'reset' },
          { name: '⬅️  Back', value: 'back' },
        ],
      });

      if (action === 'back') return;
      await this.handleGitCommand([action]);
    },

    async gitStatus(args) {
      const spinner = enhancedUI.spinner('Getting git status...');
      spinner.start();
      try {
        const output = await runGit(['status', '--porcelain=v1', '--branch']);
        spinner.stop();

        if (!output.trim()) {
          enhancedUI.success('Working tree is clean');
          return;
        }

        console.log(enhancedUI.createHeader('Git Status'));

        // 解析分支信息
        const lines = output.trim().split('\n');
        const branchLine = lines[0];
        if (branchLine.startsWith('##')) {
          console.log(theme.primaryBold('  Branch: ') + branchLine.replace('## ', ''));
          console.log('');
        }

        // 解析文件状态
        const staged = [];
        const modified = [];
        const untracked = [];

        for (const line of lines.slice(1)) {
          if (!line.trim()) continue;
          const status = line.substring(0, 2).trim();
          const file = line.substring(3);
          if (status.startsWith('?')) {
            untracked.push(file);
          } else if (status[0] !== ' ' && status[0] !== '') {
            staged.push({ status: status[0], file });
          } else {
            modified.push({ status: status[1] || status[0], file });
          }
        }

        if (staged.length > 0) {
          console.log(theme.successBold('  Staged changes:'));
          for (const { status, file } of staged) {
            console.log(`    ${theme.success('  ' + status)} ${file}`);
          }
          console.log('');
        }
        if (modified.length > 0) {
          console.log(theme.warningBold('  Modified (not staged):'));
          for (const { status, file } of modified) {
            console.log(`    ${theme.warning('  ' + status)} ${file}`);
          }
          console.log('');
        }
        if (untracked.length > 0) {
          console.log(theme.errorBold('  Untracked:'));
          for (const file of untracked) {
            console.log(`    ${theme.error('  ?')} ${file}`);
          }
          console.log('');
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Not a git repository or git error: ${error.message.replace(/\n/g, ' ')}`);
      }
    },

    async gitDiff(args) {
      const spinner = enhancedUI.spinner('Getting diff...');
      spinner.start();
      try {
        const isStaged = args.includes('--staged') || args.includes('--cached');
        const isStat = args.includes('--stat');
        const files = args.filter(a => !a.startsWith('--'));
        const gitArgs = ['diff'];
        if (isStaged) {
          gitArgs.push('--cached');
        }
        if (isStat) {
          gitArgs.push('--stat');
        }
        if (files.length > 0) {
          gitArgs.push('--', ...files);
        }

        const output = await runGit(gitArgs);
        spinner.stop();

        if (!output.trim()) {
          enhancedUI.info('No changes');
          return;
        }

        console.log(enhancedUI.createHeader(`Diff${isStaged ? ' (staged)' : ''}`));
        // 用 diffstat 风格着色
        const colored = output
          .replace(/^(\+\+\+ .+)$/gm, theme.success('$1'))
          .replace(/^(\-\-\- .+)$/gm, theme.error('$1'))
          .replace(/^(\+.+)$/gm, theme.success('$1'))
          .replace(/^(\-.+)$/gm, theme.error('$1'))
          .replace(/^(@@ .+ @@)$/gm, theme.primary('$1'));
        console.log(colored);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitAdd(args) {
      if (args.length === 0) {
        const mode = await select({
          message: 'What to add?',
          choices: [
            { name: 'All changes (-A)', value: 'all' },
            { name: 'Specify files...', value: 'files' },
          ],
        });
        if (mode === 'all') args = ['-A'];
        else {
          const filesStr = await input({
            message: 'File paths (space-separated):',
          });
          args = filesStr.split(/\s+/).filter(Boolean);
        }
      }

      const spinner = enhancedUI.spinner('Adding files...');
      spinner.start();
      try {
        const isAll = args.includes('-A') || args.includes('--all');
        await runGit(isAll ? ['add', '-A'] : ['add', ...args]);
        spinner.stop();
        enhancedUI.success(isAll ? 'All changes added to staging area' : `${args.length} file(s) added`);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitCommit(args) {
      let message = args.join(' ');
      if (!message) {
        const msg = await input({
          message: 'Commit message:',
        });
        message = msg;
      }
      if (!message.trim()) {
        enhancedUI.error('Commit message is required');
        return;
      }

      const spinner = enhancedUI.spinner('Committing...');
      spinner.start();
      try {
        await runGit(['commit', '-m', message]);
        const hash = (await runGit(['rev-parse', '--short', 'HEAD'])).trim();
        spinner.stop();
        enhancedUI.success(`Committed: ${hash} - ${message}`);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitBranch(args) {
      const action = args[0] || 'list';
      try {
        if (action === 'list' || !action) {
          const output = await runGit(['branch', '-a', '--color=never']);
          const current = (await runGit(['branch', '--show-current'])).trim();
          console.log(enhancedUI.createHeader('Branches'));
          for (const line of output.trim().split('\n')) {
            const name = line.replace(/^\* /, '').trim();
            if (name === current) {
              console.log(theme.success('  * ') + theme.successBold(name));
            } else {
              console.log(theme.dim('    ') + name);
            }
          }
          console.log('');
        } else if (action === 'create' || action === 'checkout' || action === 'switch') {
          const branchName = args[1];
          if (!branchName) {
            const name = await input({
              message: 'Branch name:',
            });
            args[1] = name;
          }
          const gitArgs = action === 'create'
            ? ['checkout', '-b', args[1]]
            : ['checkout', args[1]];
          await runGit(gitArgs);
          enhancedUI.success(`Switched to branch: ${args[1]}`);
        } else if (action === 'delete') {
          const branchName = args[1];
          if (!branchName) {
            enhancedUI.error('Usage: /git delete <branch-name>');
            return;
          }
          await runGit(['branch', '-d', branchName]);
          enhancedUI.success(`Deleted branch: ${branchName}`);
        }
      } catch (error) {
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitLog(args) {
      const spinner = enhancedUI.spinner('Getting log...');
      spinner.start();
      try {
        const limit = (args.find(a => a.startsWith('-n')) || '-n 15').replace('-n', '').trim();
        const files = args.filter(a => !a.startsWith('-'));
        const gitArgs = ['log', '--oneline', '--decorate', '--graph', '-n', limit];
        if (files.length > 0) {
          gitArgs.push('--', ...files);
        }

        const output = await runGit(gitArgs);
        spinner.stop();

        console.log(enhancedUI.createHeader('Commit Log'));
        const colored = output
          .replace(/^(\* .+)$/gm, theme.success('$1'))
          .replace(/^(\| .+)$/gm, theme.dim('$1'));
        console.log(colored);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitPush(args) {
      const spinner = enhancedUI.spinner('Pushing...');
      spinner.start();
      try {
        const remote = args[0] || 'origin';
        const branch = args[1] || '';
        const setUpstream = args.includes('-u') || args.includes('--set-upstream');
        const force = args.includes('-f') || args.includes('--force');

        const gitArgs = ['push'];
        if (force) {
          gitArgs.push('--force');
        }
        if (setUpstream) {
          gitArgs.push('-u');
        }
        gitArgs.push(remote);
        if (branch) {
          gitArgs.push(branch);
        }

        const output = await runGit(gitArgs);
        spinner.stop();
        enhancedUI.success('Push successful');
        if (output.trim()) {
          console.log(theme.dim(output.trim()));
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitPull(args) {
      const spinner = enhancedUI.spinner('Pulling...');
      spinner.start();
      try {
        const rebase = args.includes('--rebase');
        const remote = args.find(a => !a.startsWith('-')) || 'origin';
        const branch = args.filter(a => !a.startsWith('-') && a !== remote)[0] || '';

        const gitArgs = ['pull'];
        if (rebase) {
          gitArgs.push('--rebase');
        }
        gitArgs.push(remote);
        if (branch) {
          gitArgs.push(branch);
        }

        const output = await runGit(gitArgs);
        spinner.stop();
        enhancedUI.success('Pull successful');
        if (output.trim()) {
          console.log(theme.dim(output.trim()));
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitStash(args) {
      const action = args[0] || 'list';
      try {
        let gitArgs;
        switch (action) {
          case 'push':
            gitArgs = ['stash', 'push'];
            if (args.includes('-m')) {
              const idx = args.indexOf('-m');
              gitArgs.push('-m', args[idx + 1] || 'auto stash');
            }
            break;
          case 'pop':
            gitArgs = ['stash', 'pop', `stash@{${args[1] || 0}}`];
            break;
          case 'list':
            gitArgs = ['stash', 'list'];
            break;
          case 'drop':
            gitArgs = ['stash', 'drop', `stash@{${args[1] || 0}}`];
            break;
          case 'clear':
            gitArgs = ['stash', 'clear'];
            break;
          default:
            gitArgs = ['stash', 'list'];
        }

        const output = await runGit(gitArgs);
        if (!output.trim()) {
          enhancedUI.info('No stashes');
        } else {
          console.log(enhancedUI.createHeader(`Stash ${action}`));
          console.log(output.trim());
        }
        enhancedUI.success(`Stash ${action} done`);
      } catch (error) {
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    async gitReset(args) {
      const mode = args.find(a => ['--soft', '--mixed', '--hard'].includes(a)) || '--mixed';
      const target = args.find(a => !a.startsWith('-')) || 'HEAD';
      const files = args.filter(a => !a.startsWith('-') && a !== target);

      const confirmed = await confirm({
        message: `Reset ${mode} ${target}${files.length > 0 ? ' (' + files.join(', ') + ')' : ''}?`,
        default: false,
      });
      if (!confirmed) {
        enhancedUI.info('Cancelled');
        return;
      }

      try {
        const gitArgs = ['reset', mode, target];
        if (files.length > 0) {
          gitArgs.push('--', ...files);
        }
        await runGit(gitArgs);
        enhancedUI.success(`Reset ${mode} ${target} done`);
      } catch (error) {
        enhancedUI.error(error.message.replace(/\n/g, ' '));
      }
    },

    // ─── MCP 命令处理 ─────────────────────────────────────────

    /**
     * 处理 /mcp 命令
     * @param {string} args - 命令参数
     */
    async handleMcpCommand(args) {
      if (!mcpClient) {
        enhancedUI.error('MCP client not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'status':
          await this.mcpStatus();
          break;
        case 'list':
        case 'servers':
          await this.mcpListServers();
          break;
        case 'tools':
          await this.mcpListTools();
          break;
        case 'resources':
          await this.mcpListResources();
          break;
        case 'connect':
          await this.mcpConnect(args.slice(1));
          break;
        case 'disconnect':
          await this.mcpDisconnect(args.slice(1));
          break;
        case 'call':
          await this.mcpCallTool(args.slice(1));
          break;
        case 'menu':
          await this.showMcpMenu();
          break;
        default:
          if (!subcommand) {
            await this.mcpStatus();
          } else {
            enhancedUI.error(`Unknown mcp subcommand: ${subcommand}`);
            enhancedUI.info('Available: status, list, tools, resources, connect, disconnect, call, menu');
          }
      }
    },

    /**
     * MCP 交互式菜单
     */
    async showMcpMenu() {
      const action = await select({
        message: 'MCP Management:',
        choices: [
          { name: '📊 Status', value: 'status' },
          { name: '🌐 List Servers', value: 'list' },
          { name: '🔧 List Tools', value: 'tools' },
          { name: '📂 List Resources', value: 'resources' },
          { name: '🔗 Connect Server', value: 'connect' },
          { name: '✂️  Disconnect Server', value: 'disconnect' },
          { name: '⚡ Call Tool', value: 'call' },
          { name: '⬅️  Back', value: 'back' },
        ],
      });

      if (action === 'back') return;
      await this.handleMcpCommand([action]);
    },

    async mcpStatus() {
      console.log(enhancedUI.createHeader('MCP Status'));

      const table = createTable({ colWidths: [25, 30] });
      table.push(
        [
          enhancedUI.theme.primaryBold('Connected'),
          (typeof mcpClient.isConnected === 'function'
            ? mcpClient.isConnected()
            : Boolean(mcpClient.isConnected || mcpClient.getConnectedServers().length > 0))
            ? formatStatus('enabled')
            : formatStatus('disabled')
        ],
        [enhancedUI.theme.primaryBold('Servers'), mcpClient.getConnectedServers().length],
        [enhancedUI.theme.primaryBold('Tools'), mcpClient.getTools().length],
        [enhancedUI.theme.primaryBold('Resources'), mcpClient.getResources().length],
      );
      console.log(table.toString());
      console.log('');
    },

    async mcpListServers() {
      const servers = mcpClient.getConnectedServers();
      console.log(enhancedUI.createHeader('MCP Servers'));

      if (servers.length === 0) {
        enhancedUI.info('No connected servers');
        return;
      }

      for (const name of servers) {
        console.log(theme.success('  ✓ ') + theme.white(name));
      }
      console.log('');
    },

    async mcpListTools() {
      const tools = mcpClient.getTools();
      console.log(enhancedUI.createHeader('MCP Tools'));

      if (tools.length === 0) {
        enhancedUI.info('No tools available (connect to an MCP server first)');
        return;
      }

      const table = createTable({
        head: ['Tool Name', 'Description'],
        colWidths: [35, 50],
      });
      for (const tool of tools) {
        table.push([
          theme.secondary(tool.fullName || tool.name),
          truncate(tool.description || '', 48),
        ]);
      }
      console.log(table.toString());
      console.log('');
    },

    async mcpListResources() {
      const resources = mcpClient.getResources();
      console.log(enhancedUI.createHeader('MCP Resources'));

      if (resources.length === 0) {
        enhancedUI.info('No resources available');
        return;
      }

      const table = createTable({
        head: ['Resource', 'Description', 'MIME Type'],
        colWidths: [30, 30, 25],
      });
      for (const resource of resources) {
        table.push([
          theme.secondary(resource.name),
          truncate(resource.description || '', 28),
          resource.mimeType || 'N/A',
        ]);
      }
      console.log(table.toString());
      console.log('');
    },

    async mcpConnect(args) {
      let name, command, cmdArgs = [], env = {};

      if (args.length >= 2) {
        name = args[0];
        command = args[1];
        cmdArgs = args.slice(2);
      } else {
        name = await input({
          message: 'Server name:',
          validate: v => v.trim() !== '' || 'Required',
        });
        command = await input({
          message: 'Command (e.g., npx, python):',
          validate: v => v.trim() !== '' || 'Required',
        });
        const argsStr = await input({
          message: 'Arguments (comma-separated):',
        });
        cmdArgs = argsStr.split(',').map(s => s.trim()).filter(Boolean);
      }

      const spinner = enhancedUI.spinner(`Connecting to ${name}...`);
      spinner.start();
      try {
        const success = await mcpClient.connect(name, { command, args: cmdArgs, env });
        spinner.stop();
        if (success) {
          const registered = typeof registerMcpTools === 'function' ? registerMcpTools(name) : 0;
          enhancedUI.success(`Connected to MCP server: ${name}`);
          const tools = mcpClient.getTools().filter(t => t.serverName === name || t.fullName?.startsWith(name + '/'));
          if (tools.length > 0) {
            const registeredSuffix = registered ? `; registered ${registered} for agent use` : '';
            enhancedUI.info(`Loaded ${tools.length} tool(s): ${tools.map(t => t.fullName || `${name}/${t.name}`).join(', ')}${registeredSuffix}`);
          }
        } else {
          enhancedUI.error(`Failed to connect to ${name}`);
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Connection error: ${error.message}`);
      }
    },

    async mcpDisconnect(args) {
      const servers = mcpClient.getConnectedServers();
      if (servers.length === 0) {
        enhancedUI.info('No connected servers');
        return;
      }

      let name = args[0];
      if (!name) {
        const selected = await select({
          message: 'Select server to disconnect:',
          choices: servers,
        });
        name = selected;
      }

      try {
        await mcpClient.disconnect(name);
        enhancedUI.success(`Disconnected from ${name}`);
      } catch (error) {
        enhancedUI.error(`Disconnect error: ${error.message}`);
      }
    },

    async mcpCallTool(args) {
      const tools = mcpClient.getTools();
      if (tools.length === 0) {
        enhancedUI.info('No tools available. Connect to an MCP server first.');
        return;
      }

      let toolName = args[0];
      if (!toolName) {
        const selected = await select({
          message: 'Select tool:',
          choices: tools.map(t => {
            const fullName = t.fullName || t.name;
            return { name: `${fullName} - ${truncate(t.description || '', 40)}`, value: fullName };
          }),
        });
        toolName = selected;
      }

      // 获取工具参数 schema
      const tool = tools.find(t => (t.fullName || t.name) === toolName);
      let toolArgs = {};
      if (tool?.parameters?.properties) {
        for (const [key, schema] of Object.entries(tool.parameters.properties)) {
          const value = await input({
            message: `${key} (${schema.description || schema.type}):`,
            default: schema.default,
          });
          toolArgs[key] = schema.type === 'number' ? Number(value) : value;
        }
      }

      const spinner = enhancedUI.spinner(`Calling ${toolName}...`);
      spinner.start();
      try {
        const result = await mcpClient.callTool(toolName, toolArgs);
        spinner.stop();
        console.log(enhancedUI.createHeader(`Result: ${toolName}`));
        console.log(typeof result === 'string' ? result : enhancedUI.formatJSON(result, 2));
        console.log('');
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Tool call error: ${error.message}`);
      }
    },

    // ─── Security 命令处理 ─────────────────────────────────────────

    /**
     * 处理 /security 命令
     */
    async handleSecurityCommand(args) {
      if (!securityPolicy) {
        enhancedUI.error('Security policy not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'report':
        case 'status':
          await this.securityReport();
          break;
        case 'policy':
          await this.securityPolicyDetail(args[1]);
          break;
        case 'list':
          await this.securityListTools();
          break;
        case 'menu':
          await this.showSecurityMenu();
          break;
        default:
          if (!subcommand) {
            await this.securityReport();
          } else {
            enhancedUI.error(`Unknown security subcommand: ${subcommand}`);
            enhancedUI.info('Available: report, policy <tool>, list, menu');
          }
      }
    },

    async showSecurityMenu() {
      const action = await select({
        message: 'Security Management:',
        choices: [
          { name: '📊 Security Report', value: 'report' },
          { name: '🔍 Tool Policy Detail', value: 'policy' },
          { name: '📋 List Tools by Permission', value: 'list' },
          { name: '⬅️  Back', value: 'back' },
        ],
      });
      if (action === 'back') return;
      await this.handleSecurityCommand([action]);
    },

    async securityReport() {
      const report = securityPolicy.getSecurityReport();
      console.log(enhancedUI.createHeader('Security Report'));

      const table = createTable({ colWidths: [30, 20] });
      table.push(
        [enhancedUI.theme.primaryBold('Total Tools'), report.totalTools],
        [enhancedUI.theme.primaryBold('Requires Approval'), report.approvalRequired.length],
        [enhancedUI.theme.primaryBold('Not Concurrency Safe'), report.notConcurrencySafe.length],
        [enhancedUI.theme.primaryBold('Has External Effects'), report.withExternalEffects.length],
      );
      console.log(table.toString());
      console.log('');

      if (report.approvalRequired.length > 0) {
        console.log(enhancedUI.theme.warningBold('  ⚠️  Tools requiring approval:'));
        for (const name of report.approvalRequired) {
          console.log(`    ${enhancedUI.theme.warning('  !')} ${name}`);
        }
        console.log('');
      }

      console.log('  Permission distribution:');
      for (const [level, tools] of Object.entries(report.byPermission)) {
        const icon = level === 'dangerous' ? '🔴' : level === 'execute' ? '🟠' : level === 'write' ? '🟡' : level === 'readonly' ? '🟢' : '⚪';
        console.log(`    ${icon} ${level}: ${tools.length} tool(s)`);
      }
      console.log('');
    },

    async securityPolicyDetail(toolName) {
      if (!toolName) {
        const tool = await input({
          message: 'Tool name:',
        });
        toolName = tool;
      }

      const policy = securityPolicy.getPolicy(toolName);
      console.log(enhancedUI.createHeader(`Security Policy: ${toolName}`));

      const table = createTable({ colWidths: [25, 30] });
      table.push(
        [enhancedUI.theme.primaryBold('Permission Level'), policy.permissionLevel],
        [enhancedUI.theme.primaryBold('Scope'), policy.scope],
        [enhancedUI.theme.primaryBold('Concurrency Safe'), formatStatus(policy.isConcurrencySafe)],
        [enhancedUI.theme.primaryBold('External Effect'), formatStatus(policy.hasExternalEffect)],
        [enhancedUI.theme.primaryBold('Max Result Chars'), policy.maxResultChars.toLocaleString()],
        [enhancedUI.theme.primaryBold('Requires Approval'), formatStatus(policy.requiresApproval)],
      );
      console.log(table.toString());
      console.log('');
    },

    async securityListTools() {
      const report = securityPolicy.getSecurityReport();
      console.log(enhancedUI.createHeader('Tools by Permission Level'));

      for (const [level, tools] of Object.entries(report.byPermission)) {
        if (tools.length === 0) continue;
        const icon = level === 'dangerous' ? '🔴' : level === 'execute' ? '🟠' : level === 'write' ? '🟡' : level === 'readonly' ? '🟢' : '⚪';
        console.log(`\n  ${icon} ${enhancedUI.theme.whiteBold(level.toUpperCase())} (${tools.length})`);
        for (const name of tools) {
          console.log(`    ${name}`);
        }
      }
      console.log('');
    },

    // ─── Experience 命令处理 ─────────────────────────────────────────

    /**
     * 处理 /experience 命令
     */
    async handleExperienceCommand(args) {
      if (!experienceMemory) {
        enhancedUI.error('Experience memory not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'stats':
        case 'status':
          await this.experienceStats();
          break;
        case 'list':
          await this.experienceList(parseInt(args[1]) || 10);
          break;
        case 'search':
          await this.experienceSearch(args.slice(1).join(' '));
          break;
        case 'clear':
          const confirmed = await confirm({
            message: 'Clear all experiences?',
            default: false,
          });
          if (confirmed) {
            experienceMemory.clear();
            enhancedUI.success('Experience memory cleared');
          }
          break;
        case 'menu':
          await this.showExperienceMenu();
          break;
        default:
          if (!subcommand) {
            await this.experienceStats();
          } else {
            enhancedUI.error(`Unknown experience subcommand: ${subcommand}`);
            enhancedUI.info('Available: stats, list [n], search <query>, clear, menu');
          }
      }
    },

    async showExperienceMenu() {
      const action = await select({
        message: 'Experience Memory:',
        choices: [
          { name: '📊 Statistics', value: 'stats' },
          { name: '📋 List Recent', value: 'list' },
          { name: '🔍 Search', value: 'search' },
          { name: '🗑️  Clear All', value: 'clear' },
          { name: '⬅️  Back', value: 'back' },
        ],
      });
      if (action === 'back') return;
      await this.handleExperienceCommand([action]);
    },

    async experienceStats() {
      const stats = experienceMemory.getStats();
      console.log(enhancedUI.createHeader('Experience Memory Stats'));

      const table = createTable({ colWidths: [25, 20] });
      table.push(
        [enhancedUI.theme.primaryBold('Total Experiences'), stats.total],
        [enhancedUI.theme.successBold('Successes'), stats.successes],
        [enhancedUI.theme.errorBold('Failures'), stats.failures],
        [enhancedUI.theme.warningBold('Partial'), stats.partial],
        [enhancedUI.theme.primaryBold('Used (recalled)'), stats.used],
        [enhancedUI.theme.dim('Unused'), stats.unused],
      );
      console.log(table.toString());
      console.log('');
    },

    async experienceList(limit) {
      const all = experienceMemory.getAll().slice(0, limit);
      console.log(enhancedUI.createHeader(`Recent Experiences (top ${limit})`));

      if (all.length === 0) {
        enhancedUI.info('No experiences recorded yet');
        return;
      }

      for (const exp of all) {
        const icon = exp.outcome === 'success' ? '✅' : exp.outcome === 'failure' ? '❌' : '⚠️';
        const time = new Date(exp.timestamp).toLocaleString();
        console.log(`  ${icon} [${exp.tool || 'general'}] ${exp.lesson}`);
        console.log(`     ${enhancedUI.theme.dim(`${time} | used: ${exp.usageCount}`)}`);
      }
      console.log('');
    },

    async experienceSearch(query) {
      if (!query) {
        const q = await input({
          message: 'Search query:',
        });
        query = q;
      }
      if (!query) return;

      const results = experienceMemory.recall(query);
      console.log(enhancedUI.createHeader(`Search: "${query}"`));

      if (results.length === 0) {
        enhancedUI.info('No relevant experiences found');
        return;
      }

      for (const exp of results) {
        const icon = exp.outcome === 'success' ? '✅' : exp.outcome === 'failure' ? '❌' : '⚠️';
        console.log(`  ${icon} [score: ${exp.score.toFixed(2)}] ${exp.lesson}`);
        if (exp.tool) console.log(`     Tool: ${exp.tool}`);
      }
      console.log('');
    },

    // ─── Reasoning 命令处理 ─────────────────────────────────────────

    async handleReasonCommand(args) {
      if (!intelligentReasoning) {
        enhancedUI.error('Intelligent reasoning not initialized');
        return;
      }

      if (typeof args === 'string') {
        args = args.split(/\s+/).filter(Boolean);
      }
      const subcommand = args[0];

      switch (subcommand) {
        case 'intent':
          await this.analyzeIntent(args.slice(1).join(' '));
          break;
        case 'tools':
          await this.recommendTools(args.slice(1).join(' '));
          break;
        case 'decompose':
          await this.decomposeTask(args.slice(1).join(' '));
          break;
        case 'menu':
          await this.showReasonMenu();
          break;
        default:
          if (!subcommand) {
            enhancedUI.info('Usage: /reason <intent|tools|decompose> <text>');
            enhancedUI.info('Use /reason menu for the interactive reasoning menu.');
          } else {
            // 默认当作意图分析
            await this.analyzeIntent(args.join(' '));
          }
      }
    },

    async showReasonMenu() {
      const action = await select({
        message: 'Intelligent Reasoning:',
        choices: [
          { name: '🎯 Analyze Intent', value: 'intent' },
          { name: '🔧 Recommend Tools', value: 'tools' },
          { name: '📋 Decompose Task', value: 'decompose' },
          { name: '⬅️  Back', value: 'back' },
        ],
      });
      if (action === 'back') return;
      
      const inputText = await input({
        message: 'Enter text:',
      });
      await this.handleReasonCommand([action, inputText]);
    },

    async analyzeIntent(text) {
      if (!text) {
        const t = await input({
          message: 'Enter text to analyze:',
        });
        text = t;
      }
      if (!text) return;

      const intent = await intelligentReasoning.analyzeIntent(text);
      console.log(enhancedUI.createHeader('Intent Analysis'));
      console.log(`  Input: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      console.log(`  Primary Intent: ${enhancedUI.theme.primaryBold(intent.primary)}`);
      console.log(`  Confidence: ${(intent.confidence * 100).toFixed(0)}%`);
      console.log('');
      console.log('  Detected intents:');
      for (const [k, v] of Object.entries(intent.intents)) {
        if (v) console.log(`    ✓ ${k.replace('is', '')}`);
      }
      console.log('');
      console.log(`  Keywords: ${intent.keywords.join(', ') || 'none'}`);
      console.log('');
    },

    async recommendTools(text) {
      if (!text) {
        const t = await input({
          message: 'Enter task description:',
        });
        text = t;
      }
      if (!text) return;

      const intent = await intelligentReasoning.analyzeIntent(text);
      const tools = await intelligentReasoning.selectTools(text, intent);
      const strategy = intelligentReasoning.generateStrategy(text, tools);

      console.log(enhancedUI.createHeader('Tool Recommendations'));
      console.log(`  Strategy: ${enhancedUI.theme.primaryBold(strategy.type)}`);
      console.log(`  Reasoning: ${strategy.reasoning}`);
      console.log('');
      console.log('  Recommended tools:');
      for (const t of tools) {
        const bar = '█'.repeat(Math.round(t.confidence * 10)) + '░'.repeat(10 - Math.round(t.confidence * 10));
        console.log(`    ${t.name.padEnd(20)} ${bar} ${(t.confidence * 100).toFixed(0)}%`);
      }
      console.log('');
    },

    async decomposeTask(text) {
      if (!text) {
        const t = await input({
          message: 'Enter complex task:',
        });
        text = t;
      }
      if (!text) return;

      const subtasks = await intelligentReasoning.decomposeTask(text);
      console.log(enhancedUI.createHeader('Task Decomposition'));
      console.log(`  Original: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
      console.log('');
      console.log(`  Decomposed into ${subtasks.length} subtask(s):`);
      for (const st of subtasks) {
        const deps = st.dependencies.length > 0 ? ` (depends: ${st.dependencies.join(', ')})` : '';
        const par = st.parallel ? ' [parallel]' : '';
        console.log(`    ${st.order}. ${st.description}${deps}${par}`);
      }
      console.log('');
    },

    // ─── Automation 命令处理 ─────────────────────────────────────────

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
        choices: [
          { name: status.isRunning ? '⏹️  Stop Engine' : '▶️  Start Engine', value: 'toggle' },
          { name: '📊 Status', value: 'status' },
          { name: '🔗 Triggers', value: 'triggers' },
          { name: '📋 Workflows', value: 'workflows' },
          { name: '🔄 Background Tasks', value: 'background' },
          { name: '⬅️  Back', value: 'back' },
        ],
      });
      if (action === 'back') return;
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
        ['/doc add [path-or-url]', 'Index a local document or URL'],
        ['/doc search <query>', 'Search indexed documents'],
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
        ['/doc add [path-or-url]', 'Index PDF, DOCX, text, or URL documents'],
        ['/doc search <query>', 'Search indexed document chunks'],
        ['/doc list', 'List indexed documents'],
        ['/doc clear [id]', 'Clear indexed document context'],
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
              enhancedUI.success(`Schedule ${args[1]} is now ${schedule.enabled ? 'enabled' : 'disabled'}`);
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
        `${formatStatus('failed')}: ${stats.failed}`
      );
      console.log('');
    },

    async showScheduleDetailInteractive() {
      const schedules = cronScheduler.list();
      if (schedules.length === 0) {
        enhancedUI.info('No schedules available');
        return;
      }

      const scheduleId = await select({
        message: 'Select schedule:',
        choices: schedules.map(s => ({
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
        [enhancedUI.theme.primaryBold('Status'), schedule.enabled ? formatStatus('enabled') : formatStatus('disabled')],
        [enhancedUI.theme.primaryBold('Cron'), schedule.cron],
        [enhancedUI.theme.primaryBold('Next Run'), schedule.nextRunAt ? formatTime(schedule.nextRunAt) : 'N/A'],
        [enhancedUI.theme.primaryBold('Last Run'), schedule.lastRunAt ? formatTime(schedule.lastRunAt) : 'N/A'],
        [enhancedUI.theme.primaryBold('Run Count'), `${schedule.runCount}${schedule.maxRuns ? '/' + schedule.maxRuns : ''}`],
        [enhancedUI.theme.primaryBold('Task Type'), schedule.taskType]
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
        choices: schedules.map(s => ({
          name: `${truncate(s.id, 15)} - ${s.name} (${s.enabled ? 'enabled' : 'disabled'})`,
          value: s.id,
        })),
      });

      const schedule = await cronScheduler.toggle(scheduleId);
      if (schedule) {
        enhancedUI.success(`Schedule ${scheduleId} is now ${schedule.enabled ? 'enabled' : 'disabled'}`);
      } else {
        enhancedUI.error(`Schedule ${scheduleId} not found`);
      }
    },
  };
}

export default createEnhancedCommands;
