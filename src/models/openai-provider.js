/**
 * OpenAI-compatible Model Provider
 * 提供 OpenAI API 兼容的模型支持
 */

const MODEL_CONTEXT_SIZES = {
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-turbo': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-3.5-sonnet': 200000,
  'claude-3.5-haiku': 200000,
  'qwen3.5-plus': 131072,
  'qwen2.5-plus': 131072,
  'qwen2.5': 32768,
  'qwen-plus': 32768,
  'qwen-turbo': 8192,
  'gemini-pro': 32768,
  'gemini-ultra': 32768,
  'gemini-1.5-pro': 1048576,
  'gemini-1.5-flash': 1048576,
};

const LONG_CONTEXT_MODELS = [
  'gpt-4-turbo',
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3',
  'claude-3.5',
  'qwen3.5',
  'qwen2.5',
  'gemini-1.5',
];

export class OpenAIModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #isLongContext;
  #contextWindow;

  constructor(apiKey, baseURL, model = 'gpt-4', useLongContext = false) {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#isLongContext = useLongContext || this.#isLongContextModel(model);
    this.#contextWindow = this.#getContextWindow(model, this.#isLongContext);
  }

  #isLongContextModel(model) {
    return LONG_CONTEXT_MODELS.some(prefix => model.toLowerCase().includes(prefix.toLowerCase()));
  }

  #getContextWindow(model, isLongContext) {
    if (MODEL_CONTEXT_SIZES[model]) {
      return MODEL_CONTEXT_SIZES[model];
    }

    if (model.toLowerCase().includes('qwen')) {
      return isLongContext ? 131072 : 32768;
    }

    if (model.toLowerCase().includes('claude')) {
      return 200000;
    }

    if (model.toLowerCase().includes('gpt-4')) {
      return isLongContext ? 128000 : 8192;
    }

    if (model.toLowerCase().includes('gemini')) {
      return isLongContext ? 1048576 : 32768;
    }

    return isLongContext ? 128000 : 4096;
  }

  async chat(messages, options = {}) {
    if (!this.#apiKey) {
      throw new Error('OPENAI_API_KEY not set in environment');
    }

    const url = `${this.#baseURL}/chat/completions`;
    const traceEnabled = process.env.AGENT_TRACE === 'true' || process.env.DEBUG === 'true';
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    let heartbeat;

    if (traceEnabled) {
      console.log(`🔍 [model:${requestId}] request start url=${url} model=${this.#model} messages=${messages.length} maxTokens=${options.maxTokens ?? 'default'}`);
      heartbeat = setInterval(() => {
        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`🔍 [model:${requestId}] waiting for response ${elapsedSeconds}s`);
      }, 5000);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.#model,
          messages,
          ...options,
        }),
      });

      if (traceEnabled) {
        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`🔍 [model:${requestId}] response status=${response.status} ${response.statusText} after=${elapsedSeconds}s`);
      }

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (traceEnabled) {
        const choice = data.choices?.[0];
        console.log(`🔍 [model:${requestId}] parsed finishReason=${choice?.finish_reason ?? 'none'} contentChars=${choice?.message?.content?.length ?? 0} toolCalls=${choice?.message?.tool_calls?.length ?? 0}`);
      }

      return {
        text: data.choices[0]?.message?.content || '',
        toolCalls: data.choices[0]?.message?.tool_calls || [],
        finishReason: data.choices[0]?.finish_reason,
      };
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  getMaxContextTokens() {
    return this.#contextWindow;
  }

  getModelName() {
    return this.#model;
  }

  isLongContext() {
    return this.#isLongContext;
  }

  dispose() {
    // 清理资源
  }
}

export default OpenAIModelProvider;
