/**
 * OpenAI-compatible Model Provider
 * 提供 OpenAI API 兼容的模型支持
 */

import { getLocalModelCapabilities, isLongContextCapabilities } from './model-capabilities.js';
import { extractReasoningFromChoice } from './reasoning-response.js';

const DEFAULT_API_TIMEOUT_MS = 5 * 60 * 1000; // 默认5分钟超时
const MAX_RETRIES = 3; // 最多重试3次
const RETRY_DELAY_MS = 1000; // 重试延迟

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
    const timeoutMs = options.timeoutMs || DEFAULT_API_TIMEOUT_MS;
    
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const startedAt = Date.now();
      let heartbeat;

      if (traceEnabled) {
        console.log(`🔍 [model:${requestId}] request attempt=${attempt}/${MAX_RETRIES} url=${url} model=${this.#model} messages=${messages.length} maxTokens=${options.maxTokens ?? 'default'}`);
        heartbeat = setInterval(() => {
          const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.log(`🔍 [model:${requestId}] waiting for response ${elapsedSeconds}s`);
        }, 5000);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
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
            signal: controller.signal,
          });

          if (traceEnabled) {
            const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.log(`🔍 [model:${requestId}] response status=${response.status} ${response.statusText} after=${elapsedSeconds}s`);
          }

          if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();

          const choice = data.choices?.[0] || {};
          const reasoning = extractReasoningFromChoice(choice);

          if (traceEnabled) {
            console.log(`🔍 [model:${requestId}] parsed finishReason=${choice?.finish_reason ?? 'none'} contentChars=${choice?.message?.content?.length ?? 0} reasoningChars=${reasoning?.text?.length ?? 0} toolCalls=${choice?.message?.tool_calls?.length ?? 0}`);
          }

          return {
            text: choice?.message?.content || '',
            toolCalls: choice?.message?.tool_calls || [],
            finishReason: choice?.finish_reason,
            reasoning,
            usage: data.usage
              ? {
                  inputTokens: data.usage.prompt_tokens,
                  outputTokens: data.usage.completion_tokens,
                  totalTokens: data.usage.total_tokens,
                }
              : null,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error;
        
        // 判断是否可以重试
        const isRetryable = this.#isRetryableError(error);
        if (!isRetryable || attempt >= MAX_RETRIES) {
          throw error;
        }
        
        console.warn(`🔍 [model:${requestId}] request failed, retrying in ${RETRY_DELAY_MS}ms... (attempt ${attempt}/${MAX_RETRIES})`);
        await this.#sleep(RETRY_DELAY_MS * attempt);
      } finally {
        if (heartbeat) {
          clearInterval(heartbeat);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * 判断错误是否可重试
   */
  #isRetryableError(error) {
    if (error.name === 'AbortError') {return false;} // 超时不重试
    if (error.message?.includes('401') || error.message?.includes('403')) {return false;} // 认证错误不重试
    if (error.message?.includes('429')) {return true;} // 速率限制可重试
    if (error.message?.includes('5')) {return true;} // 5xx 服务器错误可重试
    return true; // 其他网络错误可重试
  }

  /**
   * 延迟函数
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
