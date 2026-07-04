/**
 * 工具中间件集合
 *
 * 参考 oh-my-pi 的设计理念：
 * - 日志、审计、限流、缓存、参数校验等横切关注点通过中间件实现
 * - 每个中间件职责单一，可以自由组合
 * - 中间件按注册顺序执行
 *
 * 使用方式：
 *   const registry = new ToolRegistry();
 *   registry.use(createLoggerMiddleware());
 *   registry.use(createValidationMiddleware());
 *   registry.use(createTimingMiddleware());
 */

// ============================================================================
// 计时中间件 — 记录工具执行时间
// ============================================================================

/**
 * 创建计时中间件
 * 执行结果中已经有 durationMs，这个中间件可以在上下文中记录
 * @param {object} [options]
 * @param {number} [options.slowThresholdMs=1000] - 慢调用阈值（毫秒），超过会警告
 * @param {(info: object) => void} [options.onSlow] - 慢调用回调
 * @returns {Function} 中间件函数
 */
export function createTimingMiddleware(options = {}) {
  const slowThresholdMs = options.slowThresholdMs ?? 1000;
  const onSlow = options.onSlow || null;

  return async function timingMiddleware(ctx, next) {
    const start = Date.now();
    try {
      const result = await next();
      const duration = Date.now() - start;
      ctx._durationMs = duration;
      if (duration > slowThresholdMs && onSlow) {
        onSlow({
          toolName: ctx.toolName,
          args: ctx.args,
          durationMs: duration,
        });
      }
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      ctx._durationMs = duration;
      throw err;
    }
  };
}

// ============================================================================
// 日志中间件 — 记录工具调用日志
// ============================================================================

/**
 * 创建日志中间件
 * @param {object} [options]
 * @param {boolean} [options.logArgs=true] - 是否记录参数
 * @param {boolean} [options.logResult=false] - 是否记录返回值
 * @param {number} [options.maxArgLength=200] - 参数日志最大长度
 * @param {(level: string, msg: string, data: object) => void} [options.logger] - 自定义 logger
 * @returns {Function} 中间件函数
 */
export function createLoggerMiddleware(options = {}) {
  const logArgs = options.logArgs ?? true;
  const logResult = options.logResult ?? false;
  const maxArgLength = options.maxArgLength ?? 200;
  const logger = options.logger || null;

  const log = (level, msg, data) => {
    if (logger) {
      logger(level, msg, data);
    } else {
      const prefix = `[Tool:${data.toolName}]`;
      if (level === 'error') {
        console.error(prefix, msg, data.error || '');
      } else if (level === 'warn') {
        console.warn(prefix, msg);
      }
    }
  };

  const truncate = (obj) => {
    if (typeof obj === 'string') {
      return obj.length > maxArgLength ? obj.slice(0, maxArgLength) + '...' : obj;
    }
    try {
      const str = JSON.stringify(obj);
      return str.length > maxArgLength ? str.slice(0, maxArgLength) + '...' : str;
    } catch {
      return String(obj);
    }
  };

  return async function loggerMiddleware(ctx, next) {
    const { toolName, args } = ctx;
    const logData = { toolName, args: logArgs ? truncate(args) : '[hidden]' };

    log('info', 'executing', logData);

    try {
      const result = await next();
      const resultData = { ...logData };
      if (logResult) {
        resultData.result = truncate(result);
      }
      if (ctx._durationMs !== undefined) {
        resultData.durationMs = ctx._durationMs;
      }
      log('info', 'completed', resultData);
      return result;
    } catch (err) {
      log('error', 'failed', {
        ...logData,
        error: err?.message || String(err),
      });
      throw err;
    }
  };
}

// ============================================================================
// 参数校验中间件 — 在执行前校验参数
// ============================================================================

/**
 * 创建参数校验中间件
 * 注意：需要 ToolRegistry 在 ctx 中提供 validateAndCoerceArgs 方法
 * 或者直接传入校验函数
 *
 * @param {object} [options]
 * @param {(toolName: string, args: object) => { valid: boolean, errors: string[], coercedArgs: object }} [options.validator]
 * @param {'error'|'warn'|'silent'} [options.onInvalid='error'] - 校验失败时的行为
 * @returns {Function} 中间件函数
 */
export function createValidationMiddleware(options = {}) {
  const validator = options.validator || null;
  const onInvalid = options.onInvalid || 'error';

  return async function validationMiddleware(ctx, next) {
    const { toolName, args, tool } = ctx;

    // 尝试从 ctx.registry 或 tool 上获取校验方法
    let validateFn = validator;
    if (!validateFn && ctx.registry?.validateAndCoerceArgs) {
      validateFn = (name, a) => ctx.registry.validateAndCoerceArgs(name, a);
    }
    if (!validateFn && tool?.validateArgs) {
      validateFn = (_name, a) => tool.validateArgs(a);
    }

    if (!validateFn) {
      return next();
    }

    const result = validateFn(toolName, args);
    if (!result.valid && result.errors?.length > 0) {
      if (onInvalid === 'error') {
        const err = new Error(`参数校验失败 (${toolName}): ${result.errors.join('; ')}`);
        err.validationErrors = result.errors;
        err.toolName = toolName;
        throw err;
      }
      if (onInvalid === 'warn') {
        console.warn(`[Tool:${toolName}] 参数警告: ${result.errors.join('; ')}`);
      }
    }

    // 使用 coerced args 替换原 args
    if (result.coercedArgs) {
      ctx.args = result.coercedArgs;
    }

    return next();
  };
}

// ============================================================================
// 错误归一化中间件 — 将各种错误转换为统一格式
// ============================================================================

/**
 * 创建错误归一化中间件
 * @param {object} [options]
 * @param {(err: Error, ctx: object) => Error} [options.transform] - 自定义错误转换
 * @returns {Function} 中间件函数
 */
export function createErrorNormalizeMiddleware(options = {}) {
  const transform = options.transform || null;

  return async function errorNormalizeMiddleware(ctx, next) {
    try {
      return await next();
    } catch (err) {
      let normalized = err;

      // 确保是 Error 实例
      if (!(normalized instanceof Error)) {
        normalized = new Error(String(normalized));
      }

      // 添加工具上下文
      if (!normalized.toolName) {
        normalized.toolName = ctx.toolName;
      }
      if (!normalized.toolArgs) {
        normalized.toolArgs = ctx.args;
      }

      // 自定义转换
      if (transform) {
        normalized = transform(normalized, ctx) || normalized;
      }

      throw normalized;
    }
  };
}

// ============================================================================
// 限频中间件 — 限制工具调用频率
// ============================================================================

/**
 * 创建限频中间件（简单的令牌桶实现）
 * @param {object} [options]
 * @param {number} [options.maxCalls=100] - 时间窗口内最大调用次数
 * @param {number} [options.windowMs=60000] - 时间窗口（毫秒），默认 1 分钟
 * @param {string[]} [options.exclude=[]] - 排除的工具名称
 * @returns {Function} 中间件函数
 */
export function createRateLimitMiddleware(options = {}) {
  const maxCalls = options.maxCalls ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const exclude = new Set(options.exclude || []);

  const callTimestamps = new Map(); // toolName -> timestamp[]

  return async function rateLimitMiddleware(ctx, next) {
    const { toolName } = ctx;

    if (exclude.has(toolName)) {
      return next();
    }

    const now = Date.now();
    const windowStart = now - windowMs;

    // 获取该工具的调用历史
    let timestamps = callTimestamps.get(toolName);
    if (!timestamps) {
      timestamps = [];
      callTimestamps.set(toolName, timestamps);
    }

    // 清理窗口外的记录
    while (timestamps.length > 0 && timestamps[0] < windowStart) {
      timestamps.shift();
    }

    // 检查是否超限
    if (timestamps.length >= maxCalls) {
      const err = new Error(
        `Rate limit exceeded for tool "${toolName}": ${maxCalls} calls per ${windowMs}ms`,
      );
      err.code = 'RATE_LIMIT_EXCEEDED';
      err.toolName = toolName;
      err.retryAfterMs = timestamps[0] + windowMs - now;
      throw err;
    }

    // 记录本次调用
    timestamps.push(now);

    return next();
  };
}

// ============================================================================
// 重试中间件 — 失败时自动重试
// ============================================================================

/**
 * 创建重试中间件
 * @param {object} [options]
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {number} [options.delayMs=100] - 重试延迟（毫秒）
 * @param {number} [options.backoff=2] - 退避因子
 * @param {(err: Error, attempt: number) => boolean} [options.shouldRetry] - 是否重试的判断函数
 * @returns {Function} 中间件函数
 */
export function createRetryMiddleware(options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const delayMs = options.delayMs ?? 100;
  const backoff = options.backoff ?? 2;
  const shouldRetry =
    options.shouldRetry ||
    ((err) => {
      // 默认对网络/超时类错误重试
      const msg = err?.message || String(err);
      return /timeout|network|econnreset|econnrefused|etimedout|5\d{2}/i.test(msg);
    });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return async function retryMiddleware(ctx, next) {
    let lastError;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await next();
      } catch (err) {
        lastError = err;
        attempt++;

        if (attempt > maxRetries || !shouldRetry(err, attempt)) {
          break;
        }

        const waitMs = delayMs * Math.pow(backoff, attempt - 1);
        await sleep(waitMs);
      }
    }

    if (lastError) {
      lastError.attempts = attempt;
      throw lastError;
    }
  };
}

// ============================================================================
// 快捷：创建默认中间件组合
// ============================================================================

/**
 * 创建默认的中间件组合（计时 + 错误归一化 + 日志）
 * @param {object} [options]
 * @returns {Function[]} 中间件数组
 */
export function createDefaultToolMiddleware(options = {}) {
  const middleware = [];

  // 最外层：错误归一化
  middleware.push(createErrorNormalizeMiddleware(options.errorNormalize));

  // 计时
  middleware.push(createTimingMiddleware(options.timing));

  // 参数校验（可选）
  if (options.validation?.enabled) {
    middleware.push(createValidationMiddleware(options.validation));
  }

  // 日志（可选）
  if (options.logger?.enabled) {
    middleware.push(createLoggerMiddleware(options.logger));
  }

  // 限频（可选）
  if (options.rateLimit?.enabled) {
    middleware.push(createRateLimitMiddleware(options.rateLimit));
  }

  // 重试（可选）
  if (options.retry?.enabled) {
    middleware.push(createRetryMiddleware(options.retry));
  }

  return middleware;
}

export default {
  createTimingMiddleware,
  createLoggerMiddleware,
  createValidationMiddleware,
  createErrorNormalizeMiddleware,
  createRateLimitMiddleware,
  createRetryMiddleware,
  createDefaultToolMiddleware,
};
