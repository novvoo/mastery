import { describe, test, expect } from 'bun:test';

/**
 * 测试 #suspendForUserInput 中的计划延续 (plan-continuation nudge) 逻辑。
 *
 * 在 agent.js 中，#suspendForUserInput 会在检测到以下条件时跳过挂起：
 * 1. 存在活跃计划且未完成 (hasPlanWithPendingTasks)
 * 2. ask_user 的问题是空泛的 (hasGenericQuestion: 没问题或问题很短)
 *
 * 此时返回计划延续 nudge，让 LLM 继续执行已有计划。
 */

function shouldSkipSuspend(planStatus, isCompleted, questions) {
  const hasPlanWithPendingTasks =
    planStatus === 'RUNNING' && !isCompleted;
  const hasGenericQuestion =
    !questions || questions.length === 0 || questions.every((q) => q.length < 10);
  return hasPlanWithPendingTasks && hasGenericQuestion;
}

describe('suspendForUserInput - plan-continuation nudge', () => {
  // ========== 应该跳过（返回 nudge）的场景 ========== //

  test('skips suspend when plan is RUNNING with empty questions', () => {
    expect(shouldSkipSuspend('RUNNING', false, [])).toBe(true);
  });

  test('skips suspend when plan is RUNNING with very short questions', () => {
    expect(shouldSkipSuspend('RUNNING', false, ['OK?'])).toBe(true);
  });

  test('skips suspend when plan is RUNNING with a mix of short questions', () => {
    expect(shouldSkipSuspend('RUNNING', false, ['ok?', 'yes?'])).toBe(true);
  });

  test('skips suspend when plan is RUNNING with single short question', () => {
    expect(shouldSkipSuspend('RUNNING', false, ['Hi'])).toBe(true);
  });

  // ========== 不应该跳过（需要真正挂起等待用户）的场景 ========== //

  test('does NOT skip when plan is RUNNING with meaningful questions', () => {
    expect(shouldSkipSuspend(
      'RUNNING', false,
      ['Which authentication strategy should I use?'],
    )).toBe(false);
  });

  test('does NOT skip when plan is RUNNING with multiple meaningful questions', () => {
    expect(shouldSkipSuspend(
      'RUNNING', false,
      ['What port should I use?', 'Should I use REST or GraphQL?'],
    )).toBe(false);
  });

  test('does NOT skip when plan is completed (no pending tasks)', () => {
    expect(shouldSkipSuspend('COMPLETED', true, [])).toBe(false);
  });

  test('does NOT skip when there is no active plan', () => {
    expect(shouldSkipSuspend(null, false, [])).toBe(false);
  });

  test('does NOT skip when plan is not RUNNING', () => {
    expect(shouldSkipSuspend('PENDING', false, [])).toBe(false);
  });

  test('does NOT skip when plan is BLOCKED', () => {
    expect(shouldSkipSuspend('BLOCKED', false, [])).toBe(false);
  });

  test('does NOT skip when plan is FAILED', () => {
    expect(shouldSkipSuspend('FAILED', false, [])).toBe(false);
  });

  test('does NOT skip with meaningful questions even if plan exists', () => {
    expect(shouldSkipSuspend(
      'RUNNING', false,
      ['What is the user\'s preferred database?'],
    )).toBe(false);
  });

  test('does NOT skip with specific technical questions', () => {
    expect(shouldSkipSuspend(
      'RUNNING', false,
      ['Do you want me to use JWT or session-based auth?'],
    )).toBe(false);
  });

  // ========== 边界情况 ========== //

  test('handles undefined questions gracefully', () => {
    expect(shouldSkipSuspend('RUNNING', false, undefined)).toBe(true);
  });

  test('handles null questions gracefully', () => {
    expect(shouldSkipSuspend('RUNNING', false, null)).toBe(true);
  });

  test('9-char question is generic (< 10)', () => {
    expect(shouldSkipSuspend('RUNNING', false, ['123456789'])).toBe(true);
  });

  test('10-char question is NOT generic (>= 10)', () => {
    expect(shouldSkipSuspend('RUNNING', false, ['1234567890'])).toBe(false);
  });

  test('plan status COMPLETED should not suspend with empty questions', () => {
    // 计划已完成 + 空问题 → 不跳过（因为没有pending任务了）
    expect(shouldSkipSuspend('COMPLETED', true, [])).toBe(false);
  });

  test('plan status RUNNING + isCompleted = true → no pending tasks', () => {
    expect(shouldSkipSuspend('RUNNING', true, [])).toBe(false);
  });
});
