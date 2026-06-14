/**
 * CLI UI Adapter
 * Bridges runtime events to the CLI user interface
 */

import { RuntimeEvent } from '../../runtime/types.js';
import { describeToolActivity, summarizeActivityForCLI } from '../../core/tool-activity.js';
import { buildActivitySummary, getActivityTone, getFileStatusLabel, formatDuration } from '../../core/activity-summary.js';
import { isRuntimeDetailMessage, isThinkingMessage, isStatusUpdateMessage } from '../../core/runtime-details.js';
import { getRuntimeStatusText } from '../../core/runtime-status.js';

export class CLIUIAdapter {
  #eventBus;
  #ui;
  #subscriptions;
  #runtimeDetails = [];
  #lastStatusText = '';

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
      this.#eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, this.#onStatusUpdate.bind(this))
    ];
  }

  /**
   * Detach from event bus
   */
  detach() {
    this.#subscriptions.forEach(unsubscribe => unsubscribe());
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
    console.log(`  进度: ${summary.progress}%  |  完成: ${summary.completed}  运行: ${summary.running}  失败: ${summary.failed}`);

    if (summary.taskStages.length > 0) {
      const stageLabels = summary.taskStages.map(s => {
        const mark = s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'running' ? '…' : '·';
        return `${mark} ${s.label}`;
      });
      console.log(`  阶段: ${stageLabels.join(' → ')}`);
    }

    if (summary.files.length > 0) {
      console.log(`  文件: ${summary.fileCount} 个`);
      summary.files.slice(0, 5).forEach(f => {
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
    this.#runtimeDetails.push({ ...event, event: 'tool:call', type: 'tool', timestamp: Date.now() });
    if (this.#ui && this.#ui.theme) {
      const { dim } = this.#ui.theme;
      const activity = event.activity || describeToolActivity(event.toolName, event.args, 'running');
      console.log(dim(`\n${summarizeActivityForCLI(activity)}`));
    }
  }

  /**
   * Handle tool result
   */
  #onToolResult(event) {
    this.#runtimeDetails.push({ ...event, event: 'tool:result', type: 'tool_result', timestamp: Date.now() });
    if (this.#ui && this.#ui.theme) {
      const { success } = this.#ui.theme;
      const activity = event.activity || describeToolActivity(event.toolName, {}, 'completed', event.result);
      console.log(success(summarizeActivityForCLI(activity)));
    }
  }

  /**
   * Handle tool error
   */
  #onToolError(event) {
    this.#runtimeDetails.push({ ...event, event: 'tool:error', type: 'tool_result', timestamp: Date.now() });
    if (this.#ui && this.#ui.showError) {
      const activity = event.activity || describeToolActivity(event.toolName, {}, 'failed', event.error);
      this.#ui.showError(new Error(summarizeActivityForCLI(activity)));
    }
  }

  /**
   * Handle status update
   */
  #onStatusUpdate(event) {
    this.#runtimeDetails.push({ ...event, event: 'status:update', type: 'event', timestamp: Date.now() });

    if (!this.#ui) {return;}

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
        if (this.#ui.success) {this.#ui.success(message);}
        break;
      case 'error':
        if (this.#ui.error) {this.#ui.error(message);}
        break;
      case 'info':
      default:
        if (this.#ui.info) {this.#ui.info(message);}
        break;
    }
  }
}
