import { describe, test, expect, spyOn, mock, beforeEach, afterEach } from 'bun:test';
import { AutomationEngine, TriggerType, WorkflowStatus } from '../../src/core/automation-engine.js';

describe('AutomationEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new AutomationEngine({ checkIntervalMs: 60000 });
  });

  afterEach(async () => {
    if (engine) {
      await engine.stop();
      engine.dispose();
    }
  });

  test('constructor creates instance with default config', () => {
    const e = new AutomationEngine();
    const status = e.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.triggers).toBe(0);
    expect(status.workflows).toBe(0);
    expect(status.conditions).toBe(0);
    expect(status.backgroundTasks).toBe(0);
  });

  test('constructor accepts custom options', () => {
    const e = new AutomationEngine({ checkIntervalMs: 10000, maxConcurrentWorkflows: 3 });
    const stats = e.getStats();
    expect(stats).toBeDefined();
  });

  test('start and stop toggle isRunning state', async () => {
    expect(engine.getStatus().isRunning).toBe(false);
    await engine.start();
    expect(engine.getStatus().isRunning).toBe(true);
    await engine.stop();
    expect(engine.getStatus().isRunning).toBe(false);
  });

  test('start is idempotent - calling twice does not throw', async () => {
    await engine.start();
    await engine.start(); // should not throw or create duplicate intervals
    expect(engine.getStatus().isRunning).toBe(true);
  });

  test('stop is idempotent - calling when not started does not throw', async () => {
    await engine.stop(); // should not throw
    expect(engine.getStatus().isRunning).toBe(false);
  });

  test('registerTrigger adds trigger and emits event', () => {
    const handler = mock(() => {});
    engine.on('trigger:registered', handler);

    const trigger = engine.registerTrigger('t1', {
      type: TriggerType.SCHEDULE,
      action: () => {},
    });

    expect(trigger.id).toBe('t1');
    expect(trigger.type).toBe(TriggerType.SCHEDULE);
    expect(trigger.enabled).toBe(true);
    expect(trigger.triggerCount).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('registerTrigger defaults enabled to true', () => {
    const trigger = engine.registerTrigger('t2', {
      type: TriggerType.EVENT,
    });
    expect(trigger.enabled).toBe(true);
  });

  test('registerTrigger respects enabled: false', () => {
    const trigger = engine.registerTrigger('t3', {
      type: TriggerType.EVENT,
      enabled: false,
    });
    expect(trigger.enabled).toBe(false);
  });

  test('removeTrigger removes existing trigger and emits event', () => {
    engine.registerTrigger('t1', { type: TriggerType.EVENT });
    const handler = mock(() => {});
    engine.on('trigger:removed', handler);

    const result = engine.removeTrigger('t1');
    expect(result).toBe(true);
    expect(engine.listTriggers()).toHaveLength(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('removeTrigger returns false for non-existent trigger', () => {
    const result = engine.removeTrigger('nonexistent');
    expect(result).toBe(false);
  });

  test('listTriggers returns all registered triggers', () => {
    engine.registerTrigger('t1', { type: TriggerType.SCHEDULE });
    engine.registerTrigger('t2', { type: TriggerType.EVENT });
    const list = engine.listTriggers();
    expect(list).toHaveLength(2);
    expect(list.map(t => t.id)).toContain('t1');
    expect(list.map(t => t.id)).toContain('t2');
  });

  test('createWorkflow creates workflow and emits event', () => {
    const handler = mock(() => {});
    engine.on('workflow:created', handler);

    const wf = engine.createWorkflow('wf1', {
      name: 'Test Workflow',
      steps: [{ execute: () => {} }],
    });

    expect(wf.id).toBe('wf1');
    expect(wf.name).toBe('Test Workflow');
    expect(wf.status).toBe(WorkflowStatus.PENDING);
    expect(wf.currentStep).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('createWorkflow sets default values', () => {
    const wf = engine.createWorkflow('wf2', {});
    expect(wf.name).toBe('wf2');
    expect(wf.description).toBe('');
    expect(wf.steps).toEqual([]);
    expect(wf.onError).toBe('stop');
    expect(wf.maxRetries).toBe(3);
  });

  test('executeWorkflow runs steps sequentially', async () => {
    const callOrder = [];
    engine.createWorkflow('wf1', {
      steps: [
        { execute: () => { callOrder.push('step1'); return { a: 1 }; } },
        { execute: (ctx) => { callOrder.push('step2'); expect(ctx.a).toBe(1); } },
      ],
    });

    const result = await engine.executeWorkflow('wf1');
    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(callOrder).toEqual(['step1', 'step2']);
  });

  test('executeWorkflow throws for non-existent workflow', async () => {
    try {
      await engine.executeWorkflow('nonexistent');
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e.message).toContain('Workflow not found');
    }
  });

  test('executeWorkflow with onError stop sets status to failed on error', async () => {
    engine.createWorkflow('wf1', {
      steps: [
        { execute: () => { throw new Error('Step failed'); } },
      ],
      onError: 'stop',
    });

    const result = await engine.executeWorkflow('wf1');
    expect(result.status).toBe(WorkflowStatus.FAILED);
    expect(result.error).toBe('Step failed');
  });

  test('executeWorkflow with onError retry retries on failure', async () => {
    let attempt = 0;
    engine.createWorkflow('wf1', {
      steps: [
        { execute: () => { attempt++; if (attempt < 2) {throw new Error('retry me');} } },
      ],
      onError: 'retry',
      maxRetries: 3,
    });

    const result = await engine.executeWorkflow('wf1');
    // First execution fails, then retry is scheduled (status goes back to PENDING)
    expect(result.retryCount).toBeGreaterThanOrEqual(1);
  });

  test('pauseWorkflow sets status to paused', () => {
    engine.createWorkflow('wf1', { steps: [] });
    const result = engine.pauseWorkflow('wf1');
    expect(result).toBe(true);
    const wf = engine.listWorkflows().find(w => w.id === 'wf1');
    expect(wf.status).toBe(WorkflowStatus.PAUSED);
  });

  test('pauseWorkflow returns false for non-existent workflow', () => {
    const result = engine.pauseWorkflow('nonexistent');
    expect(result).toBe(false);
  });

  test('resumeWorkflow returns false for non-paused workflow', async () => {
    engine.createWorkflow('wf1', { steps: [] });
    const result = await engine.resumeWorkflow('wf1');
    expect(result).toBe(false);
  });

  test('listWorkflows returns all workflows', () => {
    engine.createWorkflow('wf1', { name: 'One' });
    engine.createWorkflow('wf2', { name: 'Two' });
    const list = engine.listWorkflows();
    expect(list).toHaveLength(2);
  });

  test('registerCondition adds condition rule', () => {
    const cond = engine.registerCondition('c1', {
      condition: () => true,
      action: () => {},
    });
    expect(cond.id).toBe('c1');
    expect(cond.enabled).toBe(true);
    expect(cond.priority).toBe(0);
  });

  test('registerBackgroundTask adds task and emits event', () => {
    const handler = mock(() => {});
    engine.on('background:registered', handler);

    const task = engine.registerBackgroundTask('bt1', {
      name: 'Test Task',
      execute: () => {},
      interval: 30000,
    });

    expect(task.id).toBe('bt1');
    expect(task.name).toBe('Test Task');
    expect(task.interval).toBe(30000);
    expect(task.enabled).toBe(true);
    expect(task.runCount).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('toggleBackgroundTask enables/disables task', () => {
    engine.registerBackgroundTask('bt1', { execute: () => {} });
    const result = engine.toggleBackgroundTask('bt1', false);
    expect(result).toBe(true);
    const tasks = engine.listBackgroundTasks();
    expect(tasks[0].enabled).toBe(false);
  });

  test('toggleBackgroundTask returns false for non-existent', () => {
    const result = engine.toggleBackgroundTask('nonexistent', true);
    expect(result).toBe(false);
  });

  test('listBackgroundTasks returns all tasks', () => {
    engine.registerBackgroundTask('bt1', { execute: () => {} });
    engine.registerBackgroundTask('bt2', { execute: () => {} });
    expect(engine.listBackgroundTasks()).toHaveLength(2);
  });

  test('getStatus returns correct counts', () => {
    engine.registerTrigger('t1', { type: TriggerType.EVENT });
    engine.createWorkflow('wf1', { steps: [] });
    engine.registerCondition('c1', { condition: () => true });
    engine.registerBackgroundTask('bt1', { execute: () => {} });

    const status = engine.getStatus();
    expect(status.triggers).toBe(1);
    expect(status.workflows).toBe(1);
    expect(status.conditions).toBe(1);
    expect(status.backgroundTasks).toBe(1);
  });

  test('getStats returns detailed stats', () => {
    engine.registerTrigger('t1', { type: TriggerType.SCHEDULE });
    engine.createWorkflow('wf1', { name: 'WF', steps: [] });
    engine.registerBackgroundTask('bt1', { name: 'BT', execute: () => {} });

    const stats = engine.getStats();
    expect(stats.triggers).toHaveLength(1);
    expect(stats.workflows).toHaveLength(1);
    expect(stats.backgroundTasks).toHaveLength(1);
    expect(stats.triggers[0].id).toBe('t1');
    expect(stats.workflows[0].name).toBe('WF');
    expect(stats.backgroundTasks[0].name).toBe('BT');
  });

  test('dispose clears all resources', async () => {
    engine.registerTrigger('t1', { type: TriggerType.EVENT });
    engine.createWorkflow('wf1', { steps: [] });
    engine.registerCondition('c1', { condition: () => true });
    engine.registerBackgroundTask('bt1', { execute: () => {} });
    await engine.start();

    engine.dispose();
    const status = engine.getStatus();
    expect(status.triggers).toBe(0);
    expect(status.workflows).toBe(0);
    expect(status.conditions).toBe(0);
    expect(status.backgroundTasks).toBe(0);
    expect(status.isRunning).toBe(false);
  });

  test('TriggerType constants are correct', () => {
    expect(TriggerType.FILE_CHANGE).toBe('file_change');
    expect(TriggerType.SCHEDULE).toBe('schedule');
    expect(TriggerType.EVENT).toBe('event');
    expect(TriggerType.CONDITION).toBe('condition');
    expect(TriggerType.WEBHOOK).toBe('webhook');
  });

  test('WorkflowStatus constants are correct', () => {
    expect(WorkflowStatus.PENDING).toBe('pending');
    expect(WorkflowStatus.RUNNING).toBe('running');
    expect(WorkflowStatus.PAUSED).toBe('paused');
    expect(WorkflowStatus.COMPLETED).toBe('completed');
    expect(WorkflowStatus.FAILED).toBe('failed');
  });

  test('executeWorkflow merges initial context', async () => {
    engine.createWorkflow('wf1', {
      steps: [
        { execute: (ctx) => { expect(ctx.key).toBe('value'); return { result: true }; } },
      ],
      context: { existing: true },
    });

    const result = await engine.executeWorkflow('wf1', { key: 'value' });
    expect(result.status).toBe(WorkflowStatus.COMPLETED);
  });

  test('executeWorkflow step function can be the step itself', async () => {
    let called = false;
    engine.createWorkflow('wf1', {
      steps: [
        (ctx) => { called = true; },
      ],
    });

    await engine.executeWorkflow('wf1');
    expect(called).toBe(true);
  });
});
