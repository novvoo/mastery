/**
 * DeepSeek Model Provider
 * 提供 DeepSeek 模型支持
 */

const MODEL_CONTEXT_SIZES = {
  'deepseek-chat': 64000,
  'deepseek-coder': 64000,
  'deepseek-chat-v2': 64000,
  'deepseek-coder-v2': 64000,
};

export class DeepSeekModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #contextSize;

  constructor(apiKey, baseURL = 'https://api.deepseek.com/v1', model = 'deepseek-chat') {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#contextSize = MODEL_CONTEXT_SIZES[model] || 64000;
  }

  async chat(messages, options = {}) {
    const response = await fetch(`${this.#baseURL}/chat/completions`, {
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

    if (!response.ok) {
      throw new Error(`DeepSeek API request failed: ${response.status} ${response.statusText}`);
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
    return this.#contextSize >= 32000;
  }

  dispose() {
    // 清理资源
  }
}

export default DeepSeekModelProvider;
