/**
 * 测试辅助工具集
 *
 * 参考 oh-my-pi 的设计理念：
 * - 统一的测试工具入口，避免每个测试文件重复造轮子
 * - 常用的临时目录、mock、断言辅助
 * - 与测试框架无关（适配 bun:test, vitest, jest 等）
 */

import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// 临时目录管理
// ============================================================================

/**
 * 创建一个临时测试目录，测试结束后自动清理
 *
 * 使用方式：
 *   const tmp = createTempDir('my-test');
 *   // 使用 tmp.path
 *   tmp.cleanup();
 *
 * @param {string} [prefix] - 目录名前缀
 * @returns {{ path: string, cleanup: () => void, writeFile: (name: string, content: string) => string, readFile: (name: string) => string, exists: (name: string) => boolean, mkdir: (name: string) => string }}
 */
export function createTempDir(prefix = 'test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 静默 */
    }
  };

  const writeFile = (name, content) => {
    const filePath = join(dir, name);
    const parent = filePath.substring(0, filePath.lastIndexOf('/'));
    if (parent && !existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  };

  const readFile = (name) => {
    return readFileSync(join(dir, name), 'utf-8');
  };

  const exists = (name) => {
    return existsSync(join(dir, name));
  };

  const mkdir = (name) => {
    const dirPath = join(dir, name);
    mkdirSync(dirPath, { recursive: true });
    return dirPath;
  };

  return {
    path: dir,
    cleanup,
    writeFile,
    readFile,
    exists,
    mkdir,
  };
}

/**
 * withTempDir — 自动清理的临时目录包装器
 *
 * 使用方式：
 *   await withTempDir(async (tmp) => {
 *     // 使用 tmp.path
 *   });
 *
 * @param {string|Function} prefixOrFn - 前缀或回调函数
 * @param {Function} [fn] - 回调函数
 * @returns {Promise<void>}
 */
export async function withTempDir(prefixOrFn, fn) {
  const prefix = typeof prefixOrFn === 'string' ? prefixOrFn : 'test-';
  const callback = typeof prefixOrFn === 'function' ? prefixOrFn : fn;

  const tmp = createTempDir(prefix);
  try {
    await callback(tmp);
  } finally {
    tmp.cleanup();
  }
}

// ============================================================================
// Mock 辅助
// ============================================================================

/**
 * 创建一个可记录调用的 mock 函数
 *
 * 使用方式：
 *   const fn = mockFn((x) => x * 2);
 *   fn(3); // 6
 *   fn.calls; // [[3]]
 *   fn.callCount; // 1
 *
 * @param {Function} [implementation] - mock 的实现
 * @returns {Function & { calls: Array, callCount: number, results: Array, reset: () => void }}
 */
export function mockFn(implementation = undefined) {
  const fn = function (...args) {
    fn.calls.push(args);
    fn.callCount++;
    let result;
    let threw = false;
    try {
      if (implementation) {
        result = implementation.apply(this, args);
      } else if (fn._returnValue !== undefined) {
        result = fn._returnValue;
      }
    } catch (err) {
      threw = true;
      fn.results.push({ type: 'throw', value: err });
      throw err;
    }
    if (!threw) {
      fn.results.push({ type: 'return', value: result });
    }
    return result;
  };

  fn.calls = [];
  fn.callCount = 0;
  fn.results = [];
  fn._returnValue = undefined;

  fn.mockReturnValue = (value) => {
    fn._returnValue = value;
    return fn;
  };

  fn.reset = () => {
    fn.calls = [];
    fn.callCount = 0;
    fn.results = [];
  };

  return fn;
}

/**
 * 替换对象的某个方法为 mock，返回恢复函数
 *
 * 使用方式：
 *   const restore = mockMethod(obj, 'method', () => 'mocked');
 *   obj.method(); // 'mocked'
 *   restore();
 *
 * @param {object} obj - 目标对象
 * @param {string} methodName - 方法名
 * @param {Function} [implementation] - mock 实现
 * @returns {() => void} 恢复函数
 */
export function mockMethod(obj, methodName, implementation = undefined) {
  const original = obj[methodName];
  const mock = mockFn(implementation);
  obj[methodName] = mock;
  mock.original = original;

  const restore = () => {
    obj[methodName] = original;
  };

  mock.restore = restore;
  return restore;
}

// ============================================================================
// 断言辅助
// ============================================================================

/**
 * 断言异步函数会抛出错误
 *
 * 使用方式：
 *   await expectThrows(async () => {
 *     throw new Error('oops');
 *   }, 'oops');
 *
 * @param {Function} fn - 要测试的函数
 * @param {string|RegExp} [expectedMessage] - 期望的错误消息
 * @returns {Promise<Error>} 抛出的错误对象
 */
export async function expectThrows(fn, expectedMessage) {
  let thrown = null;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }

  if (!thrown) {
    throw new Error('Expected function to throw, but it did not');
  }

  if (expectedMessage) {
    const msg = thrown.message || String(thrown);
    if (typeof expectedMessage === 'string') {
      if (!msg.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to include "${expectedMessage}", got: "${msg}"`,
        );
      }
    } else if (expectedMessage instanceof RegExp) {
      if (!expectedMessage.test(msg)) {
        throw new Error(
          `Expected error message to match ${expectedMessage}, got: "${msg}"`,
        );
      }
    }
  }

  return thrown;
}

/**
 * 断言同步函数会抛出错误
 * @param {Function} fn
 * @param {string|RegExp} [expectedMessage]
 * @returns {Error}
 */
export function expectThrowsSync(fn, expectedMessage) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }

  if (!thrown) {
    throw new Error('Expected function to throw, but it did not');
  }

  if (expectedMessage) {
    const msg = thrown.message || String(thrown);
    if (typeof expectedMessage === 'string') {
      if (!msg.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to include "${expectedMessage}", got: "${msg}"`,
        );
      }
    } else if (expectedMessage instanceof RegExp) {
      if (!expectedMessage.test(msg)) {
        throw new Error(
          `Expected error message to match ${expectedMessage}, got: "${msg}"`,
        );
      }
    }
  }

  return thrown;
}

/**
 * 延迟一段时间（用于测试异步操作）
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// 随机数据生成
// ============================================================================

/**
 * 生成随机 ID
 * @param {number} [length]
 * @returns {string}
 */
export function randomId(length = 8) {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * 生成随机字符串
 * @param {number} [length]
 * @returns {string}
 */
export function randomString(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================================================
// 快照辅助
// ============================================================================

/**
 * 简单的内联快照比较
 * @param {*} actual
 * @param {*} expected
 * @returns {{ match: boolean, actual: string, expected: string }}
 */
export function compareSnapshot(actual, expected) {
  const actualStr = JSON.stringify(actual, null, 2);
  const expectedStr = JSON.stringify(expected, null, 2);
  return {
    match: actualStr === expectedStr,
    actual: actualStr,
    expected: expectedStr,
  };
}

// ============================================================================
// Bun test 专用辅助
// ============================================================================

/**
 * 创建一个带有自动清理的测试上下文
 * 配合 bun:test 的 beforeEach/afterEach 使用
 *
 * 使用方式：
 *   const ctx = createTestContext();
 *   beforeEach(ctx.beforeEach);
 *   afterEach(ctx.afterEach);
 *
 *   test('my test', () => {
 *     const tmp = ctx.tmp; // 每个测试都有新的临时目录
 *   });
 *
 * @returns {{ beforeEach: () => void, afterEach: () => void, tmp: object, get: (key: string) => *, set: (key: string, value: *) => void }}
 */
export function createTestContext() {
  const state = {
    tmp: null,
    data: {},
    cleanups: [],
  };

  const beforeEach = () => {
    state.tmp = createTempDir('bun-test-');
    state.data = {};
    state.cleanups = [];
  };

  const afterEach = () => {
    for (const cleanup of state.cleanups) {
      try {
        cleanup();
      } catch {
        /* 静默 */
      }
    }
    state.cleanups = [];
    if (state.tmp) {
      state.tmp.cleanup();
      state.tmp = null;
    }
    state.data = {};
  };

  const addCleanup = (fn) => {
    state.cleanups.push(fn);
  };

  const get = (key) => state.data[key];
  const set = (key, value) => {
    state.data[key] = value;
  };

  return {
    beforeEach,
    afterEach,
    addCleanup,
    get,
    set,
    get tmp() {
      return state.tmp;
    },
  };
}

export default {
  createTempDir,
  withTempDir,
  mockFn,
  mockMethod,
  expectThrows,
  expectThrowsSync,
  sleep,
  randomId,
  randomString,
  compareSnapshot,
  createTestContext,
};
