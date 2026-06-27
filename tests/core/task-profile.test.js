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
});
