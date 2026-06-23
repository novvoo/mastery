/**
 * CLI UI Adapter
 * Bridges runtime events to the CLI user interface
 */

import { RuntimeEvent } from '../../runtime/types.js';
import { describeToolActivity, summarizeActivityForCLI } from '../../core/tool-activity.js';
import {
  buildActivitySummary,
  getActivityTone,
  getFileStatusLabel,
  formatDuration,
} from '../../core/activity-summary.js';
import {
  isRuntimeDetailMessage,
  isThinkingMessage,
  isStatusUpdateMessage,
} from '../../core/runtime-details.js';
import { getRuntimeStatusText } from '../../core/runtime-status.js';
import { enhancedUI } from '../../cli/enhanced-ui.js';

export class CLIUIAdapter {
  #eventBus;
  #ui;
  #subscriptions;
  #runtimeDetails = [];
  #lastStatusText = '';
  #currentPlanTasks = [];

  constructor(eventBus, cliUI) {
    this.#eventBus = eventBus;
    this.#ui = cliUI;
    this.#subscriptions = [];
  }

  /**
   * Attach to event bus and start listening
   */
  attach() {
    this.#subscriptions = [
      this.#eventBus.subscribe(RuntimeEvent.AGENT_START, this.#onAgentStart.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, this.#onAgentComplete.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.AGENT_ERROR, this.#onAgentError.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.TOOL_CALL, this.#onToolCall.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.TOOL_RESULT, this.#onToolResult.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.TOOL_ERROR, this.#onToolError.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, this.#onStatusUpdate.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.EXECUTION_PLAN_CREATED, this.#onPlanCreated.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.PLAN_DECOMPOSED, this.#onPlanDecomposed.bind(this)),
      this.#eventBus.subscribe(RuntimeEvent.EXECUTION_PLAN_UPDATED, this.#onPlanUpdated.bind(this)),
    ];
  }

  /**
   * Detach from event bus
   */
  detach() {
    this.#subscriptions.forEach((unsubscribe) => unsubscribe());
    this.#subscriptions = [];
  }

  /**
   * Get current activity summary (for CLI commands like /stats)
   */
  getActivitySummary() {
    return buildActivitySummary(this.#runtimeDetails);
  }

  /**
   * Get collected runtime details (for export/debug)
   */
  getRuntimeDetails() {
    return this.#runtimeDetails;
  }

  /**
   * Reset runtime details for a new conversation
   */
  resetRuntimeDetails() {
    this.#runtimeDetails = [];
    this.#lastStatusText = '';
  }

  /**
   * Print a summary of activities to console (CLI /summary command)
   */
  printActivitySummary() {
    const summary = this.getActivitySummary();
    if (summary.total === 0) {
      console.log('\n  暂无活动记录\n');
      return;
    }

    console.log('\n  ── 活动摘要 ──────────────────────────────');
    console.log(`  状态: ${this.#lastStatusText || '完成'}`);
    console.log(
      `  进度: ${summary.progress}%  |  完成: ${summary.completed}  运行: ${summary.running}  失败: ${summary.failed}`,
    );

    if (summary.taskStages.length > 0) {
      const stageLabels = summary.taskStages.map((s) => {
        const mark =
          s.status === 'completed'
            ? '✓'
            : s.status === 'failed'
              ? '✗'
              : s.status === 'running'
                ? '…'
                : '·';
        return `${mark} ${s.label}`;
      });
      console.log(`  阶段: ${stageLabels.join(' → ')}`);
    }

    if (summary.files.length > 0) {
      console.log(`  文件: ${summary.fileCount} 个`);
      summary.files.slice(0, 5).forEach((f) => {
        console.log(`    ${f.path}  ${getFileStatusLabel(f.status)}`);
      });
      if (summary.files.length > 5) {
        console.log(`    ... +${summary.files.length - 5} 更多`);
      }
    }

    console.log('  ─────────────────────────────────────────\n');
  }

  /**
   * Handle agent start
   */
  #onAgentStart(event) {
    this.resetRuntimeDetails();
    this.#runtimeDetails.push({ ...event, event: 'agent:start', timestamp: Date.now() });
    if (this.#ui && typeof this.#ui.showBanner === 'function') {
      this.#ui.showBanner();
    }
  }

  /**
   * Handle agent complete
   */
  #onAgentComplete(event) {
    this.#runtimeDetails.push({ ...event, event: 'agent:complete', timestamp: Date.now() });
    if (this.#ui && this.#ui.showResult) {
      this.#ui.showResult(event.result);
    }
  }

  /**
   * Handle agent error
   */
  #onAgentError(event) {
    this.#runtimeDetails.push({ ...event, event: 'agent:error', timestamp: Date.now() });
    if (this.#ui && this.#ui.showError) {
      this.#ui.showError(new Error(event.error));
    }
  }

  /**
   * Handle tool call
   */
  #onToolCall(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'tool:call',
      type: 'tool',
      timestamp: Date.now(),
    });
    if (this.#ui && this.#ui.theme) {
      const { dim } = this.#ui.theme;
      const activity =
        event.activity || describeToolActivity(event.toolName, event.args, 'running');
      console.log(dim(`\n${summarizeActivityForCLI(activity)}`));
    }
  }

  /**
   * Handle tool result
   */
  #onToolResult(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'tool:result',
      type: 'tool_result',
      timestamp: Date.now(),
    });
    if (this.#ui && this.#ui.theme) {
      const { success } = this.#ui.theme;
      const activity =
        event.activity || describeToolActivity(event.toolName, {}, 'completed', event.result);
      console.log(success(summarizeActivityForCLI(activity)));
    }
  }

  /**
   * Handle tool error
   */
  #onToolError(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'tool:error',
      type: 'tool_result',
      timestamp: Date.now(),
    });
    if (this.#ui && this.#ui.showError) {
      const activity =
        event.activity || describeToolActivity(event.toolName, {}, 'failed', event.error);
      this.#ui.showError(new Error(summarizeActivityForCLI(activity)));
    }
  }

  /**
   * Handle plan:created event
   */
  #onPlanCreated(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'plan:created',
      type: 'plan',
      timestamp: Date.now(),
    });

    const plan = event.plan || {};
    this.#currentPlanTasks = plan.tasks || [];

    const { theme } = enhancedUI;
    console.log('\n' + theme.dim('┌' + '─'.repeat(60) + '┐'));
    console.log(
      theme.dim('│') +
        theme.primaryBold('  📋 执行计划已创建') +
        theme.dim(' '.repeat(41) + '│'),
    );
    console.log(
      theme.dim('│') +
        '  ' +
        theme.white(plan.name || '未知计划') +
        theme.dim(' '.repeat(Math.max(0, 56 - (plan.name || '').length)) + '│'),
    );
    if (plan.description) {
      console.log(
        theme.dim('│') +
          theme.muted(`  ${plan.description.substring(0, 52)}`) +
          theme.dim(' '.repeat(4) + '│'),
      );
    }
    console.log(theme.dim('└' + '─'.repeat(60) + '┘') + '\n');
  }

  /**
   * Handle plan:decomposed event
   */
  #onPlanDecomposed(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'plan:decomposed',
      type: 'plan',
      timestamp: Date.now(),
    });

    const subtasks = event.subtasks || [];
    this.#currentPlanTasks = subtasks;

    const { theme } = enhancedUI;
    console.log(
      theme.dim('\n┌─ 任务分解 ───────────────────────────────────────────────┐'),
    );

    if (subtasks.length === 0) {
      console.log(
        theme.dim('│') + theme.muted('  无子任务') + theme.dim(' '.repeat(52) + '│'),
      );
    } else {
      subtasks.forEach((task, i) => {
        const isLast = i === subtasks.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const statusIcon =
          task.status === 'completed'
            ? theme.success('✓')
            : task.status === 'running'
              ? theme.warning('⏳')
              : task.status === 'failed'
                ? theme.error('✗')
                : theme.dim('○');
        const deps =
          task.dependencies && task.dependencies.length > 0
            ? theme.dim(` [依赖: ${task.dependencies.join(', ')}]`)
            : '';
        console.log(
          theme.dim(`│  ${prefix} `) +
            statusIcon +
            ' ' +
            theme.white(task.name || task.id) +
            deps +
            theme.dim(' '.repeat(Math.max(0, 48 - (task.name || task.id || '').length - (deps ? deps.length : 0))) + '│'),
        );
      });
    }
    console.log(theme.dim('└──────────────────────────────────────────────────────────┘\n'));
  }

  /**
   * Handle plan:updated event
   */
  #onPlanUpdated(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'plan:updated',
      type: 'plan',
      timestamp: Date.now(),
    });

    const plan = event.plan || {};
    const tasks = plan.tasks || [];
    this.#currentPlanTasks = tasks;

    const { theme } = enhancedUI;

    // 统计任务状态
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const running = tasks.filter((t) => t.status === 'running').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const total = tasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    const progressBar = enhancedUI.createProgressBar(completed, total, 40);

    // 只在有变化时渲染详情（避免在 plan:created 后立即重复渲染）
    if (total > 0 && (event.update || completed > 0 || running > 0)) {
      console.log(
        theme.dim('\n┌─ 计划进度 ───────────────────────────────────────────────┐'),
      );
      console.log(
        theme.dim('│ ') +
          theme.white(plan.name || '执行计划') +
          theme.dim(' '.repeat(Math.max(0, 52 - (plan.name || '').length)) + '│'),
      );
      console.log(
        theme.dim('│ ') +
          `完成: ${completed}/${total}` +
          (running > 0 ? `  运行中: ${running}` : '') +
          (failed > 0 ? `  失败: ${failed}` : '') +
          theme.dim(' '.repeat(6) + '│'),
      );
      console.log(theme.dim('│ ') + progressBar + theme.dim(' │'));

      // 显示最近的任务状态
      const recent = tasks.slice(-6);
      recent.forEach((task, i) => {
        const statusIcon =
          task.status === 'completed'
            ? theme.success('✓')
            : task.status === 'running'
              ? theme.warning('⏳')
              : task.status === 'failed'
                ? theme.error('✗')
                : theme.dim('○');
        console.log(
          theme.dim('│  ') +
            statusIcon +
            ' ' +
            theme.white(task.name || task.id) +
            theme.dim(' '.repeat(Math.max(0, 52 - (task.name || task.id || '').length)) + '│'),
        );
      });
      if (tasks.length > 6) {
        console.log(
          theme.dim('│  ') +
            theme.muted(`... 还有 ${tasks.length - 6} 个任务`) +
            theme.dim(' '.repeat(36) + '│'),
        );
      }
      console.log(theme.dim('└──────────────────────────────────────────────────────────┘\n'));
    }
  }

  /**
   * Handle status update
   */
  #onStatusUpdate(event) {
    this.#runtimeDetails.push({
      ...event,
      event: 'status:update',
      type: 'event',
      timestamp: Date.now(),
    });

    if (!this.#ui) {
      return;
    }

    const { message, level, eventName, data } = event;

    // Track status text for summary
    if (message) {
      this.#lastStatusText = message;
    }

    if (eventName && this.#ui.debugEvent) {
      this.#ui.debugEvent(eventName, data);
      return;
    }

    switch (level) {
      case 'success':
        if (this.#ui.success) {
          this.#ui.success(message);
        }
        break;
      case 'error':
        if (this.#ui.error) {
          this.#ui.error(message);
        }
        break;
      case 'info':
      default:
        if (this.#ui.info) {
          this.#ui.info(message);
        }
        break;
    }
  }
}
