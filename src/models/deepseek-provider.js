/**
 * DeepSeek Model Provider
 * 提供 DeepSeek 模型支持
 */

import { getLocalModelCapabilities, isLongContextCapabilities } from './model-capabilities.js';

export class DeepSeekModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #contextSize;
  #capabilities;

  constructor(apiKey, baseURL = 'https://api.deepseek.com/v1', model = 'deepseek-chat', options = {}) {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#capabilities = options.capabilities || getLocalModelCapabilities('deepseek', model);
    this.#contextSize = this.#capabilities.contextWindow;
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
    return isLongContextCapabilities(this.#capabilities, 32000);
  }

  getCapabilities() {
    return { ...this.#capabilities };
  }

  dispose() {
    // 清理资源
  }
}

export default DeepSeekModelProvider;
