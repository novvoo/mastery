/**
 * Llama.cpp Model Provider
 * 提供本地 Llama.cpp 模型支持
 */

const MODEL_CONTEXT_SIZES = {
  'llama-2-7b': 4096,
  'llama-2-13b': 4096,
  'llama-2-70b': 4096,
  'llama-3-8b': 8192,
  'llama-3-70b': 8192,
  'mistral-7b': 8192,
  'mixtral-8x7b': 32768,
  'codellama-7b': 4096,
  'codellama-13b': 4096,
  'codellama-34b': 16384,
};

export class LlamaModelProvider {
  #modelPath;
  #model;
  #contextSize;
  #initialized;

  constructor(modelPath, options = {}) {
    this.#modelPath = modelPath;
    this.#model = options.model || 'default';
    this.#contextSize = options.contextSize || 4096;
    this.#initialized = false;
  }

  async initialize() {
    if (this.#initialized) return;

    const contextSize = MODEL_CONTEXT_SIZES[this.#model] || this.#contextSize;
    this.#contextSize = contextSize;

    this.#initialized = true;
  }

  async chat(messages, options = {}) {
    await this.initialize();

    const prompt = this.#formatPrompt(messages);

    return {
      text: prompt,
      toolCalls: [],
      finishReason: 'stop',
    };
  }

  #formatPrompt(messages) {
    const formattedMessages = messages.map(msg => {
      if (msg.role === 'system') {
        return `<<SYS>>\n${msg.content}\n<</SYS>>`;
      }
      return `[${msg.role.toUpperCase()}] ${msg.content}`;
    }).join('\n');

    return `${formattedMessages}\n[ASSISTANT]`;
  }

  getMaxContextTokens() {
    return this.#contextSize;
  }

  getModelName() {
    return this.#model;
  }

  isLongContext() {
    return this.#contextSize >= 32768;
  }

  dispose() {
    this.#initialized = false;
  }
}

export default LlamaModelProvider;
