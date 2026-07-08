import { describe, expect, test } from 'bun:test';
import {
  classifyTask,
  TaskIntent,
  TaskMode,
} from '../../src/core/runtime/agent/support/task-profile.js';

describe('classifyTask', () => {
  test('uses deterministic question routing when llmIntent is present', () => {
    const profile = classifyTask('这个项目怎么运行？', { intent: 'code_modification' });

    expect(profile.intent).toBe(TaskIntent.PROJECT_INFO);
    expect(profile.mode).toBe(TaskMode.ANSWER);
    expect(profile.allowsMutation).toBe(false);
  });

  test('"这个游戏有bug，处理下" → MUTATE + CODE_MODIFICATION', () => {
    const profile = classifyTask('这个游戏有bug，处理下');
    expect(profile.mode).toBe(TaskMode.MUTATE);
    expect(profile.allowsMutation).toBe(true);
    expect(profile.expectedDeliverable).toBe('patch');
  });

  test('"登录页面有问题，帮忙解决下" → MUTATE', () => {
    const profile = classifyTask('登录页面有问题，帮忙解决下');
    expect(profile.mode).toBe(TaskMode.MUTATE);
    expect(profile.allowsMutation).toBe(true);
  });

  test('"报错了，搞定它" → MUTATE', () => {
    const profile = classifyTask('报错了，搞定它');
    expect(profile.mode).toBe(TaskMode.MUTATE);
    expect(profile.allowsMutation).toBe(true);
  });

  test('"这个功能坏了，弄一下" → MUTATE', () => {
    const profile = classifyTask('这个功能坏了，弄一下');
    expect(profile.mode).toBe(TaskMode.MUTATE);
    expect(profile.allowsMutation).toBe(true);
  });

  test('"帮我处理下" → MUTATE', () => {
    const profile = classifyTask('帮我处理下');
    expect(profile.mode).toBe(TaskMode.MUTATE);
    expect(profile.allowsMutation).toBe(true);
  });

  test('"只分析原因，不要修改" → DIAGNOSE (not MUTATE)', () => {
    const profile = classifyTask('只分析原因，不要修改');
    expect(profile.allowsMutation).toBe(false);
  });
});

describe('classifyTask via quickAssess integration', () => {
  test('quickAssess reflects taskProfile for implicit fix intent', async () => {
    const { quickAssess } = await import(
      '../../src/core/runtime/agent/support/risk-budget.js'
    );
    const result = quickAssess('这个游戏有bug，处理下');
    expect(result.isModificationTask).toBe(true);
    expect(result.isBugTask).toBe(true);
    expect(result.isCodingTask).toBe(true);
  });

  test('quickAssess reflects taskProfile for "搞定" intent', async () => {
    const { quickAssess } = await import(
      '../../src/core/runtime/agent/support/risk-budget.js'
    );
    const result = quickAssess('报错了，搞定它');
    expect(result.isModificationTask).toBe(true);
  });
});
