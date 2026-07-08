/**
 * Standardized error types for tool execution.
 *
 * Tools should throw these instead of returning error text.
 * The agent loop catches and renders them appropriately.
 *
 * 参考 oh-my-pi 的 tool-errors.ts 实现。
 */

/**
 * Base error for tool execution failures.
 * Override render() for custom LLM-facing formatting.
 */
export class ToolError extends Error {
  constructor(message, context = null) {
    super(message);
    this.name = 'ToolError';
    this.context = context;
  }

  /** Render error for LLM consumption. Override for custom formatting. */
  render() {
    return this.message;
  }

  /** Get structured error info for logging/debugging */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * Error thrown when a tool operation is aborted (e.g., via AbortSignal).
 */
export class ToolAbortError extends Error {
  static MESSAGE = 'Operation aborted';

  constructor(message = ToolAbortError.MESSAGE) {
    super(message);
    this.name = 'ToolAbortError';
  }
}

/**
 * Error thrown when a tool operation requires user permission but was denied.
 */
export class ToolPermissionDeniedError extends ToolError {
  constructor(message = 'Permission denied by user', context = null) {
    super(message, context);
    this.name = 'ToolPermissionDeniedError';
  }

  render() {
    return `PERMISSION_DENIED: ${this.message}. The user has denied this operation. Please try a different approach or ask the user for guidance.`;
  }
}

/**
 * Error thrown when a tool operation fails due to invalid parameters.
 */
export class ToolValidationError extends ToolError {
  constructor(message, context = null) {
    super(message, context);
    this.name = 'ToolValidationError';
  }

  render() {
    return `VALIDATION_ERROR: ${this.message}. Please check your parameters and try again.`;
  }
}

/**
 * Error thrown when a tool operation fails due to external service issues.
 * These errors are typically retryable.
 */
export class ToolExternalError extends ToolError {
  constructor(message, context = null) {
    super(message, context);
    this.name = 'ToolExternalError';
    this.retryable = true;
  }

  render() {
    return `EXTERNAL_ERROR: ${this.message}. This is an external service error that may be retryable.`;
  }
}

/**
 * Error thrown when a tool operation fails due to rate limiting.
 */
export class ToolRateLimitError extends ToolError {
  constructor(message, context = null) {
    super(message, context);
    this.name = 'ToolRateLimitError';
    this.retryable = true;
  }

  render() {
    return `RATE_LIMITED: ${this.message}. Please wait before retrying this operation.`;
  }
}

/**
 * Error thrown when a tool operation fails due to resource not found.
 */
export class ToolNotFoundError extends ToolError {
  constructor(message, context = null) {
    super(message, context);
    this.name = 'ToolNotFoundError';
  }

  render() {
    return `NOT_FOUND: ${this.message}. The requested resource does not exist.`;
  }
}

/**
 * Error thrown when a tool operation fails due to file/content conflict.
 */
export class ToolConflictError extends ToolError {
  constructor(message, context = null) {
    super(message, context);
    this.name = 'ToolConflictError';
  }

  render() {
    return `CONFLICT: ${this.message}. There is a conflict with existing content. Please review and resolve.`;
  }
}

/**
 * Error thrown when a tool is blocked due to scope/boundary restrictions.
 */
export class ToolScopeBlockedError extends ToolError {
  constructor(message, context = null) {
    super(message, context);
    this.name = 'ToolScopeBlockedError';
  }

  render() {
    return `SCOPE_BLOCKED: ${this.message}. This operation is outside the allowed scope for this task.`;
  }
}

/**
 * Throw ToolAbortError if the signal is aborted.
 * Use this instead of signal?.throwIfAborted() to get consistent error types.
 */
export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason : undefined;
    throw reason instanceof ToolAbortError ? reason : new ToolAbortError();
  }
}

/**
 * Render an error for LLM consumption.
 * Handles ToolError.render() and falls back to message/string.
 */
export function renderError(e) {
  if (e instanceof ToolError) {
    return e.render();
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

/**
 * Classify an error into a category for retry/abort decisions.
 *
 * @param {Error} e - The error to classify
 * @returns {{ category: string, retryable: boolean, userFacing: boolean }}
 */
export function classifyError(e) {
  if (e instanceof ToolAbortError) {
    return { category: 'abort', retryable: false, userFacing: false };
  }
  if (e instanceof ToolPermissionDeniedError) {
    return { category: 'permission_denied', retryable: false, userFacing: true };
  }
  if (e instanceof ToolValidationError) {
    return { category: 'validation', retryable: false, userFacing: false };
  }
  if (e instanceof ToolRateLimitError) {
    return { category: 'rate_limit', retryable: true, userFacing: false };
  }
  if (e instanceof ToolExternalError) {
    return { category: 'external', retryable: true, userFacing: false };
  }
  if (e instanceof ToolNotFoundError) {
    return { category: 'not_found', retryable: false, userFacing: false };
  }
  if (e instanceof ToolConflictError) {
    return { category: 'conflict', retryable: false, userFacing: true };
  }
  if (e instanceof ToolScopeBlockedError) {
    return { category: 'scope_blocked', retryable: false, userFacing: false };
  }
  if (e instanceof ToolError) {
    return { category: 'tool', retryable: false, userFacing: false };
  }
  // Generic error classification
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes('rate limit') || message.includes('429')) {
    return { category: 'rate_limit', retryable: true, userFacing: false };
  }
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return { category: 'timeout', retryable: true, userFacing: false };
  }
  if (message.includes('permission') || message.includes('denied')) {
    return { category: 'permission_denied', retryable: false, userFacing: true };
  }
  return { category: 'unknown', retryable: false, userFacing: false };
}

/**
 * Determine if an error should trigger a retry.
 *
 * @param {Error} e - The error to check
 * @param {number} attemptCount - Number of attempts so far
 * @param {number} maxRetries - Maximum allowed retries
 * @returns {{ shouldRetry: boolean, delayMs: number }}
 */
export function shouldRetryError(e, attemptCount = 0, maxRetries = 3) {
  const classification = classifyError(e);

  if (!classification.retryable) {
    return { shouldRetry: false, delayMs: 0 };
  }

  if (attemptCount >= maxRetries) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // Exponential backoff with jitter
  const baseDelay = classification.category === 'rate_limit' ? 1000 : 500;
  const exponentialDelay = baseDelay * Math.pow(2, attemptCount);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  const delayMs = Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds

  return { shouldRetry: true, delayMs };
}

export default {
  ToolError,
  ToolAbortError,
  ToolPermissionDeniedError,
  ToolValidationError,
  ToolExternalError,
  ToolRateLimitError,
  ToolNotFoundError,
  ToolConflictError,
  ToolScopeBlockedError,
  throwIfAborted,
  renderError,
  classifyError,
  shouldRetryError,
};
