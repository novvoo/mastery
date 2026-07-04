/**
 * 统一的应用错误基类
 *
 * 参考 oh-my-pi 的错误分类设计：
 * - 每个错误有唯一的 code（错误码）
 * - 有 severity 分级（fatal / error / warning）
 * - 有 retryable 标记（是否可重试）
 * - 有 details 字段（结构化附加信息）
 *
 * 所有自定义错误都应继承自此基类，确保错误处理的一致性。
 */

export const ErrorSeverity = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

export const ErrorCode = {
  // 通用错误
  UNKNOWN: 'UNKNOWN',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INTERNAL: 'INTERNAL',
  UNAVAILABLE: 'UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',

  // 工具相关
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  TOOL_INVALID_PARAMS: 'TOOL_INVALID_PARAMS',

  // 会话相关
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_CORRUPTED: 'SESSION_CORRUPTED',

  // Hashline 相关
  PATCH_PARSE_ERROR: 'PATCH_PARSE_ERROR',
  PATCH_APPLY_ERROR: 'PATCH_APPLY_ERROR',
  STALE_ANCHOR: 'STALE_ANCHOR',
};

export class AppError extends Error {
  /**
   * @param {string} message - 人类可读的错误消息
   * @param {object} options
   * @param {string} [options.code] - 错误码（机器可读）
   * @param {string} [options.severity] - 严重级别
   * @param {boolean} [options.retryable] - 是否可重试
   * @param {object} [options.details] - 结构化附加信息
   * @param {Error} [options.cause] - 原始错误（错误链）
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || ErrorCode.UNKNOWN;
    this.severity = options.severity || ErrorSeverity.ERROR;
    this.retryable = options.retryable ?? false;
    this.details = options.details || {};
    this.cause = options.cause || null;
    this.timestamp = Date.now();

    // 保持正确的堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 将错误转换为可序列化的对象
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      retryable: this.retryable,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause
        ? this.cause.toJSON
          ? this.cause.toJSON()
          : { message: this.cause.message }
        : null,
    };
  }

  /**
   * 从普通 Error 创建 AppError
   * @param {Error} error
   * @param {object} [options]
   * @returns {AppError}
   */
  static from(error, options = {}) {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError(error.message || String(error), {
      code: ErrorCode.INTERNAL,
      cause: error,
      ...options,
    });
  }

  /**
   * 快速创建 InvalidArgument 错误
   */
  static invalidArgument(message, details) {
    return new AppError(message, {
      code: ErrorCode.INVALID_ARGUMENT,
      severity: ErrorSeverity.ERROR,
      retryable: false,
      details,
    });
  }

  /**
   * 快速创建 NotFound 错误
   */
  static notFound(message, details) {
    return new AppError(message, {
      code: ErrorCode.NOT_FOUND,
      severity: ErrorSeverity.ERROR,
      retryable: false,
      details,
    });
  }

  /**
   * 快速创建 Internal 错误
   */
  static internal(message, details) {
    return new AppError(message, {
      code: ErrorCode.INTERNAL,
      severity: ErrorSeverity.FATAL,
      retryable: false,
      details,
    });
  }
}
