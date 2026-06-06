/**
 * Error handling: taxonomy, retry strategy, and fallback handler
 */

import { ErrorCategory, ErrorSeverity } from '../core/types.js';

// ============ Error Classification ============

/**
 * @param {unknown} error
 * @returns {{ category: string, severity: string, message: string, originalError: Error, retryable: boolean }}
 */
export function classifyError(error) {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message;
  const normalizedMessage = message.toLowerCase();

  // Model errors
  if (normalizedMessage.includes('api key') || normalizedMessage.includes('api_key') ||
      normalizedMessage.includes('authentication') ||
      normalizedMessage.includes('unauthorized') || normalizedMessage.includes('401') ||
      normalizedMessage.includes('rate limit') || normalizedMessage.includes('model') ||
      normalizedMessage.includes('context_length') || normalizedMessage.includes('token')) {
    const isAuthError = normalizedMessage.includes('api key') ||
      normalizedMessage.includes('api_key') ||
      normalizedMessage.includes('authentication') ||
      normalizedMessage.includes('unauthorized') ||
      normalizedMessage.includes('401');

    return {
      category: ErrorCategory.MODEL_ERROR,
      severity: isAuthError ? ErrorSeverity.FATAL : (normalizedMessage.includes('rate limit') ? ErrorSeverity.RECOVERABLE : ErrorSeverity.DEGRADED),
      message,
      originalError: err,
      retryable: !isAuthError,
    };
  }

  // Timeout errors
  if (message.includes('timeout') || message.includes('timed out') ||
      message.includes('ETIMEDOUT') || message.includes('abort')) {
    return {
      category: ErrorCategory.TIMEOUT_ERROR,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      originalError: err,
      retryable: true,
    };
  }

  // File system errors
  if (message.includes('ENOENT') || message.includes('EACCES') || message.includes('EPERM')) {
    return {
      category: ErrorCategory.FILESYSTEM_ERROR,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      originalError: err,
      retryable: false,
    };
  }

  // Shell errors
  if (message.includes('command not found') || message.includes('exit code')) {
    return {
      category: ErrorCategory.SHELL_ERROR,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      originalError: err,
      retryable: false,
    };
  }

  // Validation errors
  if (message.includes('validation') || message.includes('required') || message.includes('invalid')) {
    return {
      category: ErrorCategory.VALIDATION_ERROR,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      originalError: err,
      retryable: false,
    };
  }

  // Default
  return {
    category: ErrorCategory.TOOL_ERROR,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    originalError: err,
    retryable: true,
  };
}

// ============ Retry Strategy ============

export class RetryStrategy {
  #config = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
  };

  /**
   * @param {() => Promise<T>} fn
   * @param {Partial<typeof this.#config>} [options]
   * @returns {Promise<T>}
   * @template T
   */
  async executeWithRetry(fn, options) {
    const config = { ...this.#config, ...options };
    /** @type {Error} */
    let lastError;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const agentError = classifyError(error);

        if (!agentError.retryable || attempt >= config.maxRetries) {
          throw lastError;
        }

        const delay = this.calculateDelay(attempt, config);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * @param {number} attempt
   * @param {typeof this.#config} config
   * @returns {number}
   */
  calculateDelay(attempt, config) {
    const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(delay, config.maxDelay);
    const jitter = config.jitter ? Math.random() * 1000 : 0;
    return Math.floor(cappedDelay + jitter);
  }

  /** @param {number} ms @returns {Promise<void>} */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Timeout Wrapper ============

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<T>}
 */
export async function withTimeout(fn, ms, label = 'operation') {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {clearTimeout(timer);}
  }
}
