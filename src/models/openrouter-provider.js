/**
 * OpenRouter Model Provider
 * 提供 OpenRouter 统一接入支持
 */

const MODEL_CONTEXT_SIZES = {
  'anthropic/claude-3.5-sonnet': 200000,
  'anthropic/claude-3-opus': 200000,
  'openai/gpt-4o': 128000,
  'openai/gpt-4-turbo': 128000,
  'google/gemini-pro-1.5': 1048576,
  'meta-llama/llama-3-70b': 8192,
  'mistralai/mistral-7b': 32768,
};

export class OpenRouterModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #contextSize;

  constructor(apiKey, baseURL = 'https://openrouter.ai/api/v1', model = 'anthropic/claude-3.5-sonnet') {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#contextSize = this.#getContextSize(model);
  }

  #getContextSize(model) {
    for (const [key, size] of Object.entries(MODEL_CONTEXT_SIZES)) {
      if (model.toLowerCase().includes(key.toLowerCase())) {
        return size;
      }
    }
    return 32000;
  }

  async chat(messages, options = {}) {
    const response = await fetch(`${this.#baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#apiKey}`,
        'HTTP-Referer': 'https://github.com/novvoo/ai-engineering-mastery-agent',
        'X-Title': 'AI Engineering Mastery Agent',
      },
      body: JSON.stringify({
        model: this.#model,
        messages,
        ...options,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
      text: data.choices[0]?.message?.content || '',
      toolCalls: data.choices[0]?.message?.tool_calls || [],
      finishReason: data.choices[0]?.finish_reason,
    };
  }

  getMaxContextTokens() {
    return this.#contextSize;
  }

  getModelName() {
    return this.#model;
  }

  isLongContext() {
    return this.#contextSize >= 128000;
  }

  dispose() {
    // 清理资源
  }
}

export default OpenRouterModelProvider;
