/**
 * 第 9 阶段：完成条件验证 — 单元测试
 * 
 * 验证 Subtask.validateCompletion()、canBeAdvancedBy() 和 PlanExecutor.executeTask()
 * 的严格性，防止虚假完成（一个工具调用不应同时推进多个任务）
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TaskStatus, Subtask, PlanExecutor, ExecutionPlan } from '../../src/planner/graph-planner.js';

describe('Phase 9: Strict Completion Validation', () => {

  // ==================== Subtask.validateCompletion ====================

  describe('Subtask.validateCompletion()', () => {

    test('should reject task with no tool calls', () => {
      const task = new Subtask({
        id: 'test_task',
        name: 'Test Task',
        allowedTools: ['write_file'],
        requiredToolIntents: ['write'],
      });

      const validation = task.validateCompletion({ strictMode: true });
      
      expect(validation.completed).toBe(false);
      expect(validation.missingRequirements).toContain('tool_calls');
    });

    test('should detect missing requiredToolIntents', () => {
      const task = new Subtask({
        id: 'inspect_workspace',
        name: 'Inspect Workspace',
        allowedTools: ['read_file', 'write_file'],
        requiredToolIntents: ['read', 'write'],
      });

      // Only call read_file, missing write
      task.recordToolCall('read_file', { path: './README.md' }, { success: true });
      
      const validation = task.validateCompletion({ strictMode: true });
      
      expect(validation.completed).toBe(false);
      expect(validation.missingRequirements.some(r => r.includes('missing_intents'))).toBe(true);
    });

    test('should pass when all requiredToolIntents are satisfied', () => {
      const task = new Subtask({
        id: 'implement_changes',
        name: 'Implement Changes',
        allowedTools: ['read_file', 'write_file'],
        requiredToolIntents: ['write'],
      });

      task.recordToolCall('write_file', { path: './src/index.js' }, { success: true });
      
      const validation = task.validateCompletion({ strictMode: true });
      
      expect(validation.completed).toBe(true);
      expect(validation.reason).toBe('Task completion validated');
    });

    test('should detect missing requiredMutationPaths', () => {
      const task = new Subtask({
        id: 'implement_feature',
        name: 'Implement Feature',
        allowedTools: ['write_file'],
        requiredMutationPaths: ['./src/main.js', './src/utils.js'],
        requiredToolIntents: ['write'],
      });

      task.recordToolCall('write_file', { path: './src/main.js' }, { success: true });
      
      const validation = task.validateCompletion({ strictMode: true });
      
      expect(validation.completed).toBe(false);
      expect(validation.missingRequirements.some(r => r.includes('missing_mutations'))).toBe(true);
    });

    test('should pass when all mutation paths are covered', () => {
      const task = new Subtask({
        id: 'implement_feature',
        name: 'Implement Feature',
        allowedTools: ['write_file'],
        requiredMutationPaths: ['./src/main.js'],
        requiredToolIntents: ['write'],
      });

      task.recordToolCall('write_file', { path: './src/main.js' }, { success: true });
      
      const validation = task.validateCompletion({ strictMode: true });
      
      expect(validation.completed).toBe(true);
    });

    test('non-strict mode should be more lenient', () => {
      const task = new Subtask({
        id: 'test_task',
        name: 'Test',
        allowedTools: ['read_file', 'write_file'],
        requiredToolIntents: ['read', 'write'],
      });

      task.recordToolCall('read_file', { path: './README.md' }, { success: true });
      
      // Non-strict mode doesn't check requiredToolIntents
      const validation = task.validateCompletion({ strictMode: false });
      
      expect(validation.completed).toBe(true);
    });

  });

  // ==================== Subtask.canBeAdvancedBy ====================

  describe('Subtask.canBeAdvancedBy() with enhanced predicates', () => {

    test('should reject tool not in allowedTools', () => {
      const task = new Subtask({
        id: 'implement_changes',
        name: 'Implement',
        allowedTools: ['write_file', 'edit_file'],
        completionPredicate: (ctx) => ctx.toolName === 'write_file',
      });

      expect(task.canBeAdvancedBy('read_file', {})).toBe(false);
      expect(task.canBeAdvancedBy('shell', {})).toBe(false);
    });

    test('function predicate should receive full context including result', () => {
      let receivedContext = null;
      const task = new Subtask({
        id: 'test_predicate',
        name: 'Test Predicate',
        allowedTools: ['write_file'],
        completionPredicate: (ctx) => {
          receivedContext = ctx;
          return ctx.result?.success === true && ctx.toolName === 'write_file';
        },
      });

      // Should fail when result indicates failure
      expect(task.canBeAdvancedBy('write_file', {}, { success: false, error: 'EACCES' })).toBe(false);
      expect(receivedContext).not.toBeNull();
      expect(receivedContext.toolName).toBe('write_file');
      expect(receivedContext.result.success).toBe(false);

      // Should pass when result indicates success
      expect(task.canBeAdvancedBy('write_file', {}, { success: true })).toBe(true);
    });

    test('predicate should have access to toolCallsHistory', () => {
      const task = new Subtask({
        id: 'history_aware',
        name: 'History Aware',
        allowedTools: ['read_file', 'write_file'],
        completionPredicate: (ctx) => {
          // Requires at least 2 tool calls in history
          return ctx.toolCallsHistory?.length >= 2;
        },
      });

      task.recordToolCall('read_file', { path: './a.js' }, {});
      expect(task.canBeAdvancedBy('write_file', {})).toBe(false); // only 1 call in history

      task.recordToolCall('write_file', { path: './b.js' }, { success: true });
      expect(task.canBeAdvancedBy('write_file', {})).toBe(true); // now 2 calls
    });

    test('string predicate evaluation should work with result context', () => {
      const task = new Subtask({
        id: 'string_pred',
        name: 'String Predicate',
        allowedTools: ['write_file'],
        completionPredicate: 'toolName:write_file && success:true',
      });

      expect(task.canBeAdvancedBy('write_file', {}, { success: true })).toBe(true);
      expect(task.canBeAdvancedBy('write_file', {}, { success: false })).toBe(false);
      expect(task.canBeAdvancedBy('read_file', {})).toBe(false);
    });

  });

  // ==================== PlanExecutor.executeTask strict validation ====================

  describe('PlanExecutor.executeTask() with Phase 9 strict validation', () => {

    let plan;
    let executor;

    beforeEach(() => {
      plan = new ExecutionPlan({ name: 'Test Plan' });
      
      plan.addTask({
        id: 'inspect_readme',
        name: 'Read README',
        description: 'Read the README file',
        dependencies: [],
        phase: 'exploration',
        allowedTools: ['read_file'],
        requiredToolIntents: ['read'],
        completionPredicate: (ctx) => 
          ctx.toolName === 'read_file' && (ctx.args?.path || '').includes('README'),
      });

      plan.addTask({
        id: 'implement_changes',
        name: 'Implement Changes',
        description: 'Make code changes',
        dependencies: ['inspect_readme'],
        phase: 'implementation',
        allowedTools: ['write_file', 'edit_file'],
        requiredToolIntents: ['write'],
        completionPredicate: (ctx) =>
          ['write_file', 'edit_file'].includes(ctx.toolName) &&
          ctx?.result?.success === true,
      });

      plan.addTask({
        id: 'verify_result',
        name: 'Verify Result',
        description: 'Verify the changes',
        dependencies: ['implement_changes'],
        phase: 'verification',
        allowedTools: ['shell'],
        requiredToolIntents: ['execute'],
      });

      executor = new PlanExecutor(plan, { maxToolCallsPerTask: 10 });
    });

    test('initial state should select first ready task', () => {
      const currentTask = executor.getCurrentRunnableTask();
      expect(currentTask).not.toBeNull();
      expect(currentTask.id).toBe('inspect_readme');
      expect(currentTask.status).toBe(TaskStatus.READY);
    });

    test('should NOT complete task when predicate not matched', async () => {
      // Call read_file but on a different file - should NOT complete inspect_readme
      const result = await executor.executeTask(
        'inspect_readme',
        { name: 'read_file', args: { path: './package.json' } }, // Not README!
        { content: '{}' },
      );

      expect(result).toBe(false); // Task should NOT be completed

      const currentTask = executor.getCurrentRunnableTask();
      expect(currentTask).not.toBeNull();
      expect(currentTask.id).toBe('inspect_readme'); // Still on same task
    });

    test('should complete task when predicate IS matched', async () => {
      // First call the right file
      const result = await executor.executeTask(
        'inspect_readme',
        { name: 'read_file', args: { path: './README.md' } }, // This matches the predicate!
        { content: '# Test README' },
      );

      expect(result).toBe(true); // Task SHOULD be completed

      // Should have advanced to next task
      const nextTask = executor.getCurrentRunnableTask();
      expect(nextTask).not.toBeNull();
      expect(nextTask.id).toBe('implement_changes');
    });

    test('implementation task requires successful write_file result', async () => {
      // Set up: first complete inspect_readme
      await executor.executeTask(
        'inspect_readme',
        { name: 'read_file', args: { path: './README.md' } },
        { content: '# Test' },
      );

      // Now try to complete implement with failed write
      const failResult = await executor.executeTask(
        'implement_changes',
        { name: 'write_file', args: { path: './src/test.js' } },
        { success: false, error: 'EACCES: Permission denied' },
      );

      expect(failResult).toBe(false); // Should NOT complete with failed result

      // One successful write_file satisfies both the predicate and requiredToolIntents
      const successResult = await executor.executeTask(
        'implement_changes',
        { name: 'write_file', args: { path: './src/test.js' } },
        { success: true, bytesWritten: 128 },
      );

      expect(successResult).toBe(true); // Should complete now

      const nextTask = executor.getCurrentRunnableTask();
      expect(nextTask.id).toBe('verify_result');
    });

    test('tool outside allowedTools should be rejected', async () => {
      const result = await executor.executeTask(
        'inspect_readme',
        { name: 'write_file', args: { path: './test.js' } }, // Not in allowedTools for inspect_readme!
        { success: true },
      );

      expect(result).toBe(false); // Rejected because tool not allowed
    });

    test('progress tracking should reflect accurate state', async () => {
      // Complete all tasks sequentially
      await executor.executeTask(
        'inspect_readme',
        { name: 'read_file', args: { path: './README.md' } },
        { content: '# Test' },
      );

      let progress = executor.getProgress();
      expect(progress.completed).toBe(1);
      expect(progress.total).toBe(3);

      // One successful write_file completes implement_changes (see above test)
      const successResult = await executor.executeTask(
        'implement_changes',
        { name: 'write_file', args: { path: './src/test.js' } },
        { success: true },
      );

      progress = executor.getProgress();
      expect(progress.completed).toBe(2);

      expect(executor.getCurrentRunnableTask().id).toBe('verify_result');
    });

    test('stalled event should fire after max tool calls without completion', async () => {
      let stallEventFired = false;
      let stallData = null;
      executor.on('task:stalled', (data) => {
        stallEventFired = true;
        stallData = data;
      });

      // Make many calls that don't satisfy the predicate (inspect_readme needs README path)
      for (let i = 0; i < 15; i++) {
        await executor.executeTask(
          'inspect_readme',
          { name: 'read_file', args: { path: `./file${i}.js` } },
          { content: '' },
        );

        if (stallEventFired) break;
      }

      expect(stallEventFired).toBe(true);
      expect(stallData.taskId).toBe('inspect_readme');
      expect(stallData.toolCallCount).toBeGreaterThanOrEqual(10);
    });

  });

  // ==================== False Completion Prevention ====================

  describe('False completion prevention', () => {

    test('one read_file should not complete multiple exploration tasks', () => {
      const plan = new ExecutionPlan({ name: 'Multi-exploration plan' });
      
      plan.addTask({
        id: 'inspect_readme',
        name: 'Read README',
        description: 'Read README',
        dependencies: [],
        phase: 'exploration',
        allowedTools: ['read_file'],
        completionPredicate: (ctx) => 
          ctx.toolName === 'read_file' && (ctx.args?.path || '').toLowerCase().includes('readme'),
      });

      plan.addTask({
        id: 'inspect_config',
        name: 'Inspect Config',
        description: 'Inspect config files',
        dependencies: ['inspect_readme'],
        phase: 'exploration',
        allowedTools: ['read_file'],
        completionPredicate: (ctx) =>
          ctx.toolName === 'read_file' && (ctx.args?.path || '').toLowerCase().includes('config'),
      });

      const executor = new PlanExecutor(plan);

      // One read_file of README should ONLY complete inspect_readme, not inspect_config
      const currentBefore = executor.getCurrentRunnableTask();
      expect(currentBefore.id).toBe('inspect_readme');

      executor.executeTask(
        'inspect_readme',
        { name: 'read_file', args: { path: './README.md' } },
        { content: '# README' },
      );

      const currentAfter = executor.getCurrentRunnableTask();
      // Should advance to inspect_config (dependency satisfied), NOT skip it
      expect(currentAfter.id).toBe('inspect_config');
      // inspect_config should still be pending/running, NOT completed
      expect(currentAfter.status).not.toBe(TaskStatus.COMPLETED);
    });

    test('task with requiredMutationPaths should not complete without modifying those files', () => {
      const task = new Subtask({
        id: 'multi_file_edit',
        name: 'Multi File Edit',
        allowedTools: ['write_file', 'edit_file'],
        requiredMutationPaths: ['./src/a.js', './src/b.js'],
        requiredToolIntents: ['write'],
      });

      // Only modified one file
      task.recordToolCall('write_file', { path: './src/a.js' }, { success: true });
      
      const validation = task.validateCompletion({ strictMode: true });
      expect(validation.completed).toBe(false);
      expect(validation.missingRequirements.length).toBeGreaterThan(0);

      // Modify second file
      task.recordToolCall('edit_file', { path: './src/b.js' }, { success: true });
      
      const validation2 = task.validateCompletion({ strictMode: true });
      expect(validation2.completed).toBe(true);
    });

  });

});
