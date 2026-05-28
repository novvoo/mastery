/**
 * Zhipu AI Model Provider
 * 提供智谱 AI 模型支持
 */

const MODEL_CONTEXT_SIZES = {
  'glm-4': 128000,
  'glm-4-flash': 128000,
  'glm-4-plus': 128000,
  'glm-3-turbo': 128000,
  'glm-3': 128000,
};

export class ZhipuModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #contextSize;

  constructor(apiKey, baseURL = 'https://open.bigmodel.cn/api/paas/v4', model = 'glm-4') {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#contextSize = MODEL_CONTEXT_SIZES[model] || 128000;
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
      throw new Error(`Zhipu API request failed: ${response.status} ${response.statusText}`);
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
    return true;
  }

  dispose() {
    // 清理资源
  }
}

export default ZhipuModelProvider;
