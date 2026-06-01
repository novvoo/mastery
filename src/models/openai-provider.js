/**
 * OpenAI-compatible Model Provider
 * 提供 OpenAI API 兼容的模型支持
 */

import { getLocalModelCapabilities, isLongContextCapabilities } from './model-capabilities.js';

export class OpenAIModelProvider {
  #apiKey;
  #baseURL;
  #model;
  #isLongContext;
  #contextWindow;
  #capabilities;

  constructor(apiKey, baseURL, model = 'gpt-4', useLongContext = false, options = {}) {
    this.#apiKey = apiKey;
    this.#baseURL = baseURL;
    this.#model = model;
    this.#capabilities = options.capabilities || getLocalModelCapabilities('openai', model);
    this.#isLongContext = useLongContext || isLongContextCapabilities(this.#capabilities);
    this.#contextWindow = this.#capabilities.contextWindow;
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

  getCapabilities() {
    return { ...this.#capabilities };
  }

  dispose() {
    // 清理资源
  }
}

export default OpenAIModelProvider;
