/**
 * CLI UI Adapter
 * Bridges runtime events to the CLI user interface
 */

import { RuntimeEvent } from '../../runtime/types.js';

export class CLIUIAdapter {
  #eventBus;
  #ui;
  #subscriptions;

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
   * Handle agent start
   */
  #onAgentStart(event) {
    if (this.#ui && typeof this.#ui.showBanner === 'function') {
      this.#ui.showBanner();
    }
  }

  /**
   * Handle agent complete
   */
  #onAgentComplete(event) {
    if (this.#ui && this.#ui.showResult) {
      this.#ui.showResult(event.result);
    }
  }

  /**
   * Handle agent error
   */
  #onAgentError(event) {
    if (this.#ui && this.#ui.showError) {
      this.#ui.showError(new Error(event.error));
    }
  }

  /**
   * Handle tool call
   */
  #onToolCall(event) {
    if (this.#ui && this.#ui.theme) {
      const { dim } = this.#ui.theme;
      console.log(dim(`\n🔧 Calling tool: ${event.toolName}`));
    }
  }

  /**
   * Handle tool result
   */
  #onToolResult(event) {
    // Can log if needed, but tools typically handle their own output
  }

  /**
   * Handle tool error
   */
  #onToolError(event) {
    if (this.#ui && this.#ui.showError) {
      this.#ui.showError(new Error(`Tool ${event.toolName} failed: ${event.error}`));
    }
  }

  /**
   * Handle status update
   */
  #onStatusUpdate(event) {
    if (!this.#ui) return;

    const { message, level, eventName, data } = event;

    if (eventName && this.#ui.debugEvent) {
      this.#ui.debugEvent(eventName, data);
      return;
    }

    switch (level) {
      case 'success':
        if (this.#ui.success) this.#ui.success(message);
        break;
      case 'error':
        if (this.#ui.error) this.#ui.error(message);
        break;
      case 'info':
      default:
        if (this.#ui.info) this.#ui.info(message);
        break;
    }
  }
}
