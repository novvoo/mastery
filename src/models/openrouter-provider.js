/**
 * OpenRouter Model Provider
 * 提供 OpenRouter 统一接入支持
 */

import { getLocalModelCapabilities, isLongContextCapabilities } from './model-capabilities.js';

export class OpenRouterModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #contextSize;
  #capabilities;

  constructor(apiKey, baseURL = 'https://openrouter.ai/api/v1', model = 'anthropic/claude-3.5-sonnet', options = {}) {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#capabilities = options.capabilities || getLocalModelCapabilities('openrouter', model);
    this.#contextSize = this.#capabilities.contextWindow;
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
    return isLongContextCapabilities(this.#capabilities);
  }

  getCapabilities() {
    return { ...this.#capabilities };
  }

  dispose() {
    // 清理资源
  }
}

export default OpenRouterModelProvider;
