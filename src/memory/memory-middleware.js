export class MemoryMiddleware {
  #memoryManager;
  #enabled;

  constructor(memoryManager) {
    this.#memoryManager = memoryManager;
    this.#enabled = true;
  }

  enable() {
    this.#enabled = true;
  }

  disable() {
    this.#enabled = false;
  }

  isEnabled() {
    return this.#enabled;
  }

  async augmentPrompt(prompt, context = {}) {
    if (!this.#enabled || !this.#memoryManager) {
      return prompt;
    }

    const memoryContext = this.#memoryManager.getMemoryContext(context.currentTask || '');

    if (!memoryContext || memoryContext.trim().length === 0) {
      return prompt;
    }

    const augmented = `${prompt}\n\n${memoryContext}`;
    return augmented;
  }

  async augmentSystemPrompt(systemPrompt, context = {}) {
    if (!this.#enabled || !this.#memoryManager) {
      return systemPrompt;
    }

    const indexSummary = this.#memoryManager.getMemoryContext();

    if (!indexSummary || indexSummary.trim().length === 0) {
      return systemPrompt;
    }

    const augmented = `${systemPrompt}\n\n${indexSummary}`;
    return augmented;
  }

  async handleAfterToolCall(toolEvent, context = {}) {
    if (!this.#enabled || !this.#memoryManager) {
      return;
    }

    if (toolEvent.name === 'write_memory') {
      this.#memoryManager.flush();
    }
  }
}
