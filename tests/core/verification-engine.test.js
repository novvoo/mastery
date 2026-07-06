/**
 * VerificationEngine 单元测试。
 *
 * 覆盖：
 *   - 测试结果验证（exit code, 失败关键词）
 *   - Plan 覆盖度检查
 *   - 综合完成验证
 *   - 无 mutation 跳过
 *   - 无测试事件跳过
 */

import { describe, test, expect } from 'bun:test';
import { verifyTestResults, verifyPlanCoverage, verifyCompletion, detectRepeatedMutationWithoutVerification, checkFileCoverage } from '../../src/core/runtime/agent/support/verification-engine.js';
import { isRuntimeVerificationEvent, isMutationEvent } from '../../src/core/runtime/agent/support/evidence-verifier.js';

// ============================================================
// 辅助：构造工具事件
// ============================================================

function shellEvent(resultPreview, extra = {}) {
  return {
    name: 'shell',
    success: true,
    resultPreview,
    ...extra,
  };
}

function editEvent(path, extra = {}) {
  return {
    name: 'edit_file',
    success: true,
    args: { path },
    ...extra,
  };
}

function readEvent(path, extra = {}) {
  return {
    name: 'read_file',
    success: true,
    args: { path },
    ...extra,
  };
}

// ============================================================
// Tests
// ============================================================

describe('isRuntimeVerificationEvent', () => {
  test('detects test commands', () => {
    expect(isRuntimeVerificationEvent({ name: 'shell', args: { command: 'npm test' } })).toBe(true);
    expect(isRuntimeVerificationEvent({ name: 'shell', args: { command: 'bun test' } })).toBe(true);
    expect(isRuntimeVerificationEvent({ name: 'shell', args: { command: 'pytest' } })).toBe(true);
    expect(isRuntimeVerificationEvent({ name: 'shell', args: { command: 'vitest run' } })).toBe(true);
  });

  test('ignores non-test commands', () => {
    expect(isRuntimeVerificationEvent({ name: 'shell', args: { command: 'ls -la' } })).toBe(false);
    expect(isRuntimeVerificationEvent({ name: 'edit_file', args: { path: 'a.js' } })).toBe(false);
  });
});

// ============================================================
// 日志复现：循环修改不验证模式
// ============================================================

describe('detectRepeatedMutationWithoutVerification', () => {
  test('detects 12 writes to same file without verification (来自日志)', () => {
    // 模拟完整日志：1 shell test → 3 reads → 12 writes to same file, no second test
    const events = [
      // 第一步：跑了 npm test
      shellEvent('Command completed.\n ❯ snake.test.js  (10 tests | 1 failed)\n Tests  2 failed | 18 passed (20)', { args: { command: 'npm test' } }),
      // 第二步：读取文件
      { name: 'read_file', success: true, args: { path: 'snake.js' } },
      { name: 'read_file', success: true, args: { path: 'tests/Snake.test.js' } },
      { name: 'read_file', success: true, args: { path: 'src/game/Snake.js' } },
    ];

    // 12 次写入同一文件，不再跑测试
    for (let i = 0; i < 12; i++) {
      events.push(editEvent('src/game/Snake.js'));
    }

    const r = detectRepeatedMutationWithoutVerification(events);
    expect(r.repeated).toBe(true);
    expect(r.writes.length).toBe(12);
    expect(r.lastVerifyAt).toBe(0);
  });

  test('passes when verification follows mutation', () => {
    const events = [
      editEvent('src/game/Snake.js'),
      shellEvent('Command passed with exit code 0\ntests passed', { args: { command: 'npm test' } }),
      editEvent('snake.js'),
      shellEvent('Command passed with exit code 0\ntests passed', { args: { command: 'npm test' } }),
    ];
    const r = detectRepeatedMutationWithoutVerification(events);
    expect(r.repeated).toBe(false);
  });

  test('passes with single write followed by test', () => {
    const events = [
      editEvent('src/game/Snake.js'),
      shellEvent('Command passed with exit code 0', { args: { command: 'npm test' } }),
    ];
    const r = detectRepeatedMutationWithoutVerification(events);
    expect(r.repeated).toBe(false);
  });

  test('handles empty events', () => {
    expect(detectRepeatedMutationWithoutVerification([]).repeated).toBe(false);
    expect(detectRepeatedMutationWithoutVerification(null).repeated).toBe(false);
  });
});

describe('checkFileCoverage', () => {
  test('detects missing files', () => {
    const events = [
      editEvent('src/game/Snake.js'),
    ];
    const r = checkFileCoverage(['snake.js', 'src/Snake.js', 'src/game/Snake.js'], events);
    expect(r.allCovered).toBe(false);
    expect(r.missing).toEqual(['snake.js', 'src/Snake.js']);
    expect(r.covered).toEqual(['src/game/Snake.js']);
  });

  test('allCovered when all files modified', () => {
    const events = [
      editEvent('snake.js'),
      editEvent('src/Snake.js'),
      editEvent('src/game/Snake.js'),
    ];
    const r = checkFileCoverage(['snake.js', 'src/Snake.js', 'src/game/Snake.js'], events);
    expect(r.allCovered).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe('verifyCompletion: 日志复现场景', () => {
  test('blocks 12 identical writes without re-running tests', () => {
    const events = [
      shellEvent('npm test output: 3 failed 3', { args: { command: 'npm test 2>&1' } }),
      editEvent('src/game/Snake.js'),
      editEvent('src/game/Snake.js'),
      editEvent('src/game/Snake.js'),
      editEvent('src/game/Snake.js'),
    ];
    const r = verifyCompletion({ toolEvents: events });
    expect(r.passed).toBe(false);
    expect(r.guidance).toContain('VERIFICATION FAILED');
    expect(r.guidance).toContain('Repeated mutations');
    expect(r.guidance).toContain('without verification');
  });

  test('allows 2 writes then verification', () => {
    const events = [
      editEvent('src/game/Snake.js'),
      editEvent('snake.js'),
      shellEvent('Command passed with exit code 0\nstdout: Tests 20 passed (20)', { args: { command: 'npm test' } }),
    ];
    const r = verifyCompletion({ toolEvents: events });
    expect(r.passed).toBe(true);
  });
});

describe('isMutationEvent', () => {
  test('detects mutation tools', () => {
    expect(isMutationEvent({ name: 'edit_file' })).toBe(true);
    expect(isMutationEvent({ name: 'write_file' })).toBe(true);
  });

  test('ignores read tools', () => {
    expect(isMutationEvent({ name: 'read_file' })).toBe(false);
    expect(isMutationEvent({ name: 'list_dir' })).toBe(false);
    expect(isMutationEvent({ name: 'shell', args: { command: 'npm test' } })).toBe(false);
  });
});

describe('verifyTestResults', () => {
  test('detects exit code > 0 as failure', () => {
    const events = [
      shellEvent('Command failed with exit code 1\nstderr: FAIL test/snake.test.js\n  ● snake moves down\n    expect(received).toBe(expected)\n', { args: { command: 'npm test' } }),
    ];
    const r = verifyTestResults(events);
    expect(r.passed).toBe(false);
    expect(r.failedEvents).toHaveLength(1);
    expect(r.failedEvents[0].exitCode).toBe(1);
  });

  test('passes when exit code is 0', () => {
    const events = [
      shellEvent('Command passed with exit code 0\nstdout: Tests 10 passed (10)', { args: { command: 'npm test' } }),
    ];
    const r = verifyTestResults(events);
    expect(r.passed).toBe(true);
    expect(r.failedEvents).toHaveLength(0);
  });

  test('detects failure text without exit code', () => {
    const events = [
      shellEvent('snake moves down: expected { x: 10, y: 9 } to deeply equal { x: 10, y: 11 }\nFAILED', { args: { command: 'bun test Snake.test.js' } }),
    ];
    const r = verifyTestResults(events);
    expect(r.passed).toBe(false);
    expect(r.failedEvents).toHaveLength(1);
  });

  test('passes "0 failed" text', () => {
    const events = [
      shellEvent('Tests: 0 failed, 10 passed (10)', { args: { command: 'npm test' } }),
    ];
    const r = verifyTestResults(events);
    expect(r.passed).toBe(true);
  });

  test('ignores non-test events', () => {
    const events = [
      shellEvent('Command failed with exit code 127', { args: { command: 'ls nonexistent' } }),
    ];
    const r = verifyTestResults(events);
    // ls 不是测试命令，所以 isRuntimeVerificationEvent 返回 false
    expect(r.passed).toBe(true);
    expect(r.failedEvents).toHaveLength(0);
  });

  test('returns passed when no test events', () => {
    const events = [readEvent('a.txt')];
    const r = verifyTestResults(events);
    expect(r.passed).toBe(true);
  });

  test('passes "all tests passed" text', () => {
    const events = [
      shellEvent('All tests passed! stdout: Tests 10 passed (10)', { args: { command: 'npm test' } }),
    ];
    const r = verifyTestResults(events);
    expect(r.passed).toBe(true);
  });
});

describe('verifyPlanCoverage', () => {
  test('matches plan steps to modifications', () => {
    const steps = [
      { name: 'Fix snake.js', files: ['src/snake.js'] },
    ];
    const events = [editEvent('src/snake.js')];
    const r = verifyPlanCoverage(steps, events);
    expect(r.matched).toBe(true);
    expect(r.unmatchedSteps).toHaveLength(0);
  });

  test('reports unmatched steps', () => {
    const steps = [
      { name: 'Fix snake.js', files: ['src/snake.js'] },
      { name: 'Update test', files: ['snake.test.js'] },
    ];
    // 只修了 src/snake.js，没改测试
    const events = [editEvent('src/snake.js')];
    const r = verifyPlanCoverage(steps, events);
    expect(r.matched).toBe(false);
    expect(r.unmatchedSteps).toContain('Update test');
  });

  test('handles empty inputs', () => {
    expect(verifyPlanCoverage(null, []).matched).toBe(false);
    expect(verifyPlanCoverage([], null).matched).toBe(false);
  });
});

describe('verifyCompletion', () => {
  test('skips when no mutation events', () => {
    const events = [readEvent('a.txt'), shellEvent('ls', { args: { command: 'ls' } })];
    const r = verifyCompletion({ toolEvents: events });
    expect(r.passed).toBe(true);
    expect(r.guidance).toBe('');
  });

  test('blocks when tests fail', () => {
    const events = [
      editEvent('Snake.js'),
      shellEvent('Command failed with exit code 1\nstderr: FAIL snake moves down', { args: { command: 'npm test' } }),
    ];
    const r = verifyCompletion({ toolEvents: events });
    expect(r.passed).toBe(false);
    expect(r.guidance).toContain('VERIFICATION FAILED');
    expect(r.guidance).toContain('exit code 1');
  });

  test('passes when mutation + passing tests', () => {
    const events = [
      editEvent('Snake.js'),
      shellEvent('Command passed with exit code 0\nstdout: Tests 10 passed (10)', { args: { command: 'npm test' } }),
    ];
    const r = verifyCompletion({ toolEvents: events });
    expect(r.passed).toBe(true);
  });
});
