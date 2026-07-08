import { describe, test, expect, beforeEach } from 'bun:test';

import {
  FlowPlanCoordinator,
  UnifiedWorkflow,
  WorkflowType,
  WorkflowStatus,
  WorkflowEvent,
} from '../../src/core/runtime/agent/support/workflow-coordinator.js';
import { AutonomyFlow, FlowStatus, StepStatus } from '../../src/core/runtime/agent/support/autonomy-flow.js';
import { ExecutionPlanManager } from '../../src/core/runtime/agent/execution-plan-manager.js';
import { ExecutionPlan, TaskStatus } from '../../src/planner/graph-planner.js';

describe('UnifiedWorkflow', () => {
  test('creates a workflow with correct defaults', () => {
    const wf = new UnifiedWorkflow({
      name: 'Test Workflow',
      type: WorkflowType.PLAN,
    });

    expect(wf.name).toBe('Test Workflow');
    expect(wf.type).toBe(WorkflowType.PLAN);
    expect(wf.status).toBe(WorkflowStatus.PENDING);
    expect(wf.isActive).toBe(true);
    expect(wf.isComplete).toBe(false);
    expect(wf.getProgress()).toBe(0);
  });

  test('start transitions to running', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    expect(wf.status).toBe(WorkflowStatus.RUNNING);
    expect(wf.startedAt).toBeDefined();
  });

  test('start throws if not pending', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    expect(() => wf.start()).toThrow(/Cannot start workflow in status/);
  });

  test('pause transitions to paused', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    const result = wf.pause();
    expect(result).toBe(true);
    expect(wf.status).toBe(WorkflowStatus.PAUSED);
  });

  test('resume from paused transitions to running', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    wf.pause();
    const result = wf.resume();
    expect(result).toBe(true);
    expect(wf.status).toBe(WorkflowStatus.RUNNING);
  });

  test('cancel marks workflow as cancelled', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    const result = wf.cancel();
    expect(result).toBe(true);
    expect(wf.status).toBe(WorkflowStatus.CANCELLED);
    expect(wf.endedAt).toBeDefined();
    expect(wf.isComplete).toBe(true);
    expect(wf.isActive).toBe(false);
  });

  test('context get/set works', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN, context: { foo: 'bar' } });
    expect(wf.getContext('foo')).toBe('bar');
    wf.setContext('baz', 42);
    expect(wf.getContext('baz')).toBe(42);
    expect(wf.context).toEqual({ foo: 'bar', baz: 42 });
  });

  test('mergeContext merges new values', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN, context: { a: 1 } });
    wf.mergeContext({ b: 2, c: 3 });
    expect(wf.getContext('a')).toBe(1);
    expect(wf.getContext('b')).toBe(2);
    expect(wf.getContext('c')).toBe(3);
  });

  test('markCompleted transitions to completed', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    wf.markCompleted({ result: 'success' });
    expect(wf.status).toBe(WorkflowStatus.COMPLETED);
    expect(wf.endedAt).toBeDefined();
    expect(wf.isComplete).toBe(true);
  });

  test('markStepFailed transitions to failed', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    wf.markStepFailed('step-1', 'something went wrong');
    expect(wf.status).toBe(WorkflowStatus.FAILED);
    expect(wf.endedAt).toBeDefined();
    expect(wf.isComplete).toBe(true);
  });

  test('retry resets workflow to pending', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    wf.start();
    wf.markCompleted();
    expect(wf.isComplete).toBe(true);
    wf.retry();
    expect(wf.status).toBe(WorkflowStatus.PENDING);
    expect(wf.endedAt).toBeNull();
    expect(wf.isActive).toBe(true);
  });
});

describe('FlowPlanCoordinator', () => {
  let coordinator;

  beforeEach(() => {
    coordinator = new FlowPlanCoordinator();
  });

  test('register adds a workflow', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    const result = coordinator.register(wf);
    expect(result.id).toBe(wf.id);
    expect(coordinator.workflows.length).toBe(1);
    expect(coordinator.getWorkflow(wf.id)).toBe(wf);
  });

  test('register throws for non-UnifiedWorkflow', () => {
    expect(() => coordinator.register({})).toThrow(TypeError);
  });

  test('unregister removes a workflow', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    coordinator.register(wf);
    expect(coordinator.workflows.length).toBe(1);
    const result = coordinator.unregister(wf.id);
    expect(result).toBe(true);
    expect(coordinator.workflows.length).toBe(0);
    expect(coordinator.getWorkflow(wf.id)).toBeNull();
  });

  test('getWorkflowsByType filters correctly', () => {
    const plan = new UnifiedWorkflow({ name: 'plan', type: WorkflowType.PLAN });
    const flow = new UnifiedWorkflow({ name: 'flow', type: WorkflowType.FLOW });
    coordinator.register(plan);
    coordinator.register(flow);

    expect(coordinator.getWorkflowsByType(WorkflowType.PLAN).length).toBe(1);
    expect(coordinator.getWorkflowsByType(WorkflowType.FLOW).length).toBe(1);
  });

  test('activeWorkflows returns only active ones', () => {
    const active = new UnifiedWorkflow({ name: 'active', type: WorkflowType.PLAN });
    const done = new UnifiedWorkflow({ name: 'done', type: WorkflowType.PLAN });
    coordinator.register(active);
    coordinator.register(done);
    active.start();
    done.start();
    done.markCompleted();

    expect(coordinator.activeWorkflows.length).toBe(1);
    expect(coordinator.activeWorkflows[0].id).toBe(active.id);
  });

  test('shareContext shares between workflows', () => {
    const a = new UnifiedWorkflow({ name: 'a', type: WorkflowType.PLAN, context: { shared: 'value' } });
    const b = new UnifiedWorkflow({ name: 'b', type: WorkflowType.FLOW });
    coordinator.register(a);
    coordinator.register(b);

    const result = coordinator.shareContext(a.id, b.id, ['shared']);
    expect(result.shared).toBe('value');
    expect(b.getContext('shared')).toBe('value');
  });

  test('shareContext with no keys shares everything', () => {
    const a = new UnifiedWorkflow({ name: 'a', type: WorkflowType.PLAN, context: { x: 1, y: 2 } });
    const b = new UnifiedWorkflow({ name: 'b', type: WorkflowType.FLOW });
    coordinator.register(a);
    coordinator.register(b);

    coordinator.shareContext(a.id, b.id);
    expect(b.getContext('x')).toBe(1);
    expect(b.getContext('y')).toBe(2);
  });

  test('context pool sync works', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN, context: { key: 'val' } });
    coordinator.register(wf);

    coordinator.syncToPool(wf.id);

    const other = new UnifiedWorkflow({ name: 'other', type: WorkflowType.FLOW });
    coordinator.register(other);
    coordinator.syncFromPool(other.id);
    expect(other.getContext('key')).toBe('val');
  });

  test('registerTrigger fires on step completion', () => {
    const source = new UnifiedWorkflow({ name: 'source', type: WorkflowType.PLAN });
    coordinator.register(source);
    source.start();

    let triggered = false;
    coordinator.registerTrigger(source.id, 'test-step', WorkflowType.FLOW, { goal: 'triggered' });
    coordinator.on(WorkflowEvent.TRIGGERED, () => {
      triggered = true;
    });

    source.markStepCompleted('test-step');
    expect(triggered).toBe(true);
  });

  test('getStatus returns all workflows with status', () => {
    const wf = new UnifiedWorkflow({ name: 'test', type: WorkflowType.PLAN });
    coordinator.register(wf);
    const status = coordinator.getStatus();
    expect(status.length).toBe(1);
    expect(status[0].name).toBe('test');
    expect(status[0].type).toBe(WorkflowType.PLAN);
    expect(status[0].isActive).toBe(true);
    expect(status[0].isComplete).toBe(false);
  });

  test('triggerWorkflow emits triggered event', () => {
    const source = new UnifiedWorkflow({ name: 'source', type: WorkflowType.PLAN });
    coordinator.register(source);
    source.start();

    let eventData = null;
    coordinator.on(WorkflowEvent.TRIGGERED, (data) => {
      eventData = data;
    });

    const result = coordinator.triggerWorkflow(source.id, WorkflowType.FLOW, { goal: 'new flow' });
    expect(result.targetType).toBe(WorkflowType.FLOW);
    expect(result.sourceWorkflowId).toBe(source.id);
    expect(eventData).not.toBeNull();
    expect(eventData.targetType).toBe(WorkflowType.FLOW);
  });
});

describe('FlowPlanCoordinator + AutonomyFlow', () => {
  let coordinator;

  beforeEach(() => {
    coordinator = new FlowPlanCoordinator();
  });

  test('registerFlow wraps AutonomyFlow as UnifiedWorkflow', () => {
    const flow = new AutonomyFlow({
      goal: 'Test Flow Goal',
      steps: [
        { name: 'step1', prompt: 'do step 1' },
        { name: 'step2', prompt: 'do step 2' },
      ],
    });

    const wf = coordinator.registerFlow(flow);
    expect(wf.type).toBe(WorkflowType.FLOW);
    expect(wf.name).toBe('Test Flow Goal');
    expect(wf.getProgress()).toBe(0);
    expect(wf.getSteps().length).toBe(2);
  });

  test('flow advancement reflects in unified workflow', () => {
    const flow = new AutonomyFlow({
      goal: 'test',
      steps: [{ name: 'step1', prompt: 'p1' }, { name: 'step2', prompt: 'p2' }],
    });

    const wf = coordinator.registerFlow(flow);
    flow.start();
    flow.markStepRunning('run-1');

    const currentStep = wf.getCurrentStep();
    expect(currentStep).not.toBeNull();
    expect(currentStep.name).toBe('step1');

    flow.advanceStep('result1');
    expect(wf.getProgress()).toBeGreaterThan(0);
    expect(wf.getCurrentStep().name).toBe('step2');
  });

  test('flow completion marks unified workflow completed', () => {
    const flow = new AutonomyFlow({
      goal: 'test',
      steps: [{ name: 'step1', prompt: 'p1' }],
    });

    const wf = coordinator.registerFlow(flow);
    let completed = false;
    coordinator.on(WorkflowEvent.COMPLETED, () => {
      completed = true;
    });

    flow.start();
    flow.markStepRunning('run-1');
    flow.advanceStep();

    expect(completed).toBe(true);
    expect(wf.status).toBe(WorkflowStatus.COMPLETED);
    expect(wf.isComplete).toBe(true);
  });

  test('flow failure marks unified workflow failed', () => {
    const flow = new AutonomyFlow({
      goal: 'test',
      steps: [{ name: 'step1', prompt: 'p1' }],
    });

    const wf = coordinator.registerFlow(flow);
    let failed = false;
    coordinator.on(WorkflowEvent.FAILED, () => {
      failed = true;
    });

    flow.start();
    flow.markStepRunning('run-1');
    flow.markStepFailed('oops');

    expect(failed).toBe(true);
    expect(wf.status).toBe(WorkflowStatus.FAILED);
  });
});

describe('FlowPlanCoordinator + ExecutionPlanManager', () => {
  let coordinator;
  let planManager;

  beforeEach(() => {
    coordinator = new FlowPlanCoordinator();
    planManager = new ExecutionPlanManager({
      debugEvent: () => {},
      sessionManager: {
        getHistory: () => [],
        addMessage: () => {},
        length: 0,
      },
    });
  });

  test('registerPlan wraps ExecutionPlan as UnifiedWorkflow', () => {
    const plan = new ExecutionPlan({
      id: 'plan-1',
      name: 'Test Plan',
      context: { planType: 'standard' },
    });
    planManager.setPlan(plan);

    const wf = coordinator.registerPlan(planManager, plan);
    expect(wf.type).toBe(WorkflowType.PLAN);
    expect(wf.name).toBe('Test Plan');
    expect(wf.metadata.planType).toBe('standard');
  });

  test('plan tasks reflect in unified workflow steps', () => {
    const plan = new ExecutionPlan({
      id: 'plan-1',
      name: 'Test Plan',
      context: { planType: 'standard' },
    });
    plan.addTask({ id: 'task1', name: 'Explore', status: TaskStatus.COMPLETED });
    plan.addTask({ id: 'task2', name: 'Implement', status: TaskStatus.RUNNING });
    plan.addTask({ id: 'task3', name: 'Verify', status: TaskStatus.PENDING });
    planManager.setPlan(plan);

    const wf = coordinator.registerPlan(planManager, plan);
    const steps = wf.getSteps();
    expect(steps.length).toBe(3);
    expect(wf.getProgress()).toBeCloseTo(1 / 3, 1);
    expect(wf.getCurrentStep().name).toBe('Implement');
  });

  test('plan task progress reflects in unified workflow', () => {
    const plan = new ExecutionPlan({
      id: 'plan-1',
      name: 'Test Plan',
      context: { planType: 'standard' },
    });
    plan.addTask({ id: 'task1', name: 'Explore', status: TaskStatus.RUNNING });
    plan.addTask({ id: 'task2', name: 'Implement', status: TaskStatus.PENDING });
    planManager.setPlan(plan);

    const wf = coordinator.registerPlan(planManager, plan);
    expect(wf.getProgress()).toBe(0);
    expect(wf.getCurrentStep().name).toBe('Explore');

    // Mark first task completed (simulating progress)
    plan.tasks.get('task1').status = TaskStatus.COMPLETED;
    plan.tasks.get('task2').status = TaskStatus.RUNNING;

    // The unified workflow reads live state from the plan
    expect(wf.getProgress()).toBeCloseTo(0.5, 1);
    expect(wf.getCurrentStep().name).toBe('Implement');
    expect(wf.isActive).toBe(true);

    // Mark all tasks completed
    plan.tasks.get('task2').status = TaskStatus.COMPLETED;
    plan.status = TaskStatus.COMPLETED;

    expect(wf.getProgress()).toBe(1);
  });
});

describe('Plan + Flow Coordination: No Conflicts', () => {
  let coordinator;

  beforeEach(() => {
    coordinator = new FlowPlanCoordinator();
  });

  test('plan and flow can coexist in same coordinator', () => {
    const plan = new UnifiedWorkflow({ id: 'plan-1', name: 'Plan A', type: WorkflowType.PLAN });
    const flow = new AutonomyFlow({ goal: 'Flow B', steps: [{ name: 's1', prompt: 'p1' }] });

    coordinator.register(plan);
    const flowWf = coordinator.registerFlow(flow);

    expect(coordinator.workflows.length).toBe(2);
    expect(coordinator.getWorkflowsByType(WorkflowType.PLAN).length).toBe(1);
    expect(coordinator.getWorkflowsByType(WorkflowType.FLOW).length).toBe(1);

    // Both are active
    expect(coordinator.activeWorkflows.length).toBe(2);
  });

  test('plan and flow have independent lifecycle', () => {
    const plan = new UnifiedWorkflow({ id: 'plan-1', name: 'Plan', type: WorkflowType.PLAN });
    const flow = new AutonomyFlow({ goal: 'Flow', steps: [{ name: 's1', prompt: 'p1' }] });

    coordinator.register(plan);
    const flowWf = coordinator.registerFlow(flow);

    // Start plan
    plan.start();
    expect(plan.status).toBe(WorkflowStatus.RUNNING);
    // Flow is still pending
    expect(flow.status).toBe(FlowStatus.QUEUED);

    // Start flow independently
    flow.start();
    expect(flow.status).toBe(FlowStatus.RUNNING);
    expect(plan.status).toBe(WorkflowStatus.RUNNING);

    // Complete plan independently
    plan.markCompleted();
    expect(plan.isComplete).toBe(true);
    expect(flowWf.isActive).toBe(true);
    expect(flow.status).toBe(FlowStatus.RUNNING);
  });

  test('plan and flow share context without side effects', () => {
    const plan = new UnifiedWorkflow({
      id: 'plan-1',
      name: 'Plan',
      type: WorkflowType.PLAN,
      context: { planData: 'from-plan' },
    });
    const flow = new AutonomyFlow({ goal: 'Flow', steps: [{ name: 's1', prompt: 'p1' }] });

    coordinator.register(plan);
    const flowWf = coordinator.registerFlow(flow);

    // Share from plan to flow
    coordinator.shareContext('plan-1', flowWf.id, ['planData']);
    expect(flowWf.getContext('planData')).toBe('from-plan');

    // Modify flow context does not affect plan
    flowWf.setContext('flowData', 'from-flow');
    expect(plan.getContext('flowData')).toBeUndefined();

    // Share from flow to plan
    coordinator.shareContext(flowWf.id, 'plan-1', ['flowData']);
    expect(plan.getContext('flowData')).toBe('from-flow');
  });

  test('plan completion triggers flow (cross-workflow trigger)', () => {
    const plan = new UnifiedWorkflow({ id: 'plan-1', name: 'Plan', type: WorkflowType.PLAN });
    coordinator.register(plan);
    plan.start();

    let triggered = false;
    coordinator.registerTrigger('plan-1', '*', WorkflowType.FLOW, { goal: 'auto-flow' });
    coordinator.on(WorkflowEvent.TRIGGERED, (data) => {
      if (data.targetType === WorkflowType.FLOW && data.options.goal === 'auto-flow') {
        triggered = true;
      }
    });

    // Simulate a step completion (the trigger watches for step pattern '*')
    plan.markStepStarted('verify-step', {});
    plan.markStepCompleted('verify-step');

    expect(triggered).toBe(true);
  });

  test('context pool allows indirect sharing across multiple workflows', () => {
    const plan = new UnifiedWorkflow({
      id: 'plan-1',
      name: 'Plan',
      type: WorkflowType.PLAN,
      context: { shared: 'global-value' },
    });
    const flow1 = new AutonomyFlow({ goal: 'Flow 1', steps: [{ name: 's1', prompt: 'p1' }] });
    const flow2 = new AutonomyFlow({ goal: 'Flow 2', steps: [{ name: 's1', prompt: 'p1' }] });

    coordinator.register(plan);
    const wf1 = coordinator.registerFlow(flow1);
    const wf2 = coordinator.registerFlow(flow2);

    // Plan syncs to pool
    coordinator.syncToPool('plan-1');

    // Both flows read from pool
    coordinator.syncFromPool(wf1.id);
    coordinator.syncFromPool(wf2.id);

    expect(wf1.getContext('shared')).toBe('global-value');
    expect(wf2.getContext('shared')).toBe('global-value');

    // Flow1 updates pool
    wf1.setContext('flow1Data', 'from-flow1');
    coordinator.syncToPool(wf1.id, ['flow1Data']);

    // Flow2 sees the update
    coordinator.syncFromPool(wf2.id, ['flow1Data']);
    expect(wf2.getContext('flow1Data')).toBe('from-flow1');

    // Plan is unaffected by flow's extra data (explicit keys only)
    expect(plan.getContext('flow1Data')).toBeUndefined();
  });

  test('multiple flows do not interfere with each other', () => {
    const flow1 = new AutonomyFlow({ goal: 'Flow 1', steps: [{ name: 'step1', prompt: 'p1' }] });
    const flow2 = new AutonomyFlow({ goal: 'Flow 2', steps: [{ name: 'stepA', prompt: 'pA' }] });

    const wf1 = coordinator.registerFlow(flow1);
    const wf2 = coordinator.registerFlow(flow2);

    flow1.start();
    flow2.start();
    flow1.markStepRunning('run-1');
    flow2.markStepRunning('run-2');

    // Different step names
    expect(wf1.getCurrentStep().name).toBe('step1');
    expect(wf2.getCurrentStep().name).toBe('stepA');

    // Advance flow1 only
    flow1.advanceStep('done');
    expect(wf1.getProgress()).toBe(1);
    expect(wf1.isComplete).toBe(true);
    // flow2 is still running
    expect(wf2.getProgress()).toBe(0);
    expect(wf2.isActive).toBe(true);
  });

  test('getStatus returns both plan and flow with correct types', () => {
    const plan = new UnifiedWorkflow({ id: 'plan-1', name: 'The Plan', type: WorkflowType.PLAN });
    const flow = new AutonomyFlow({ goal: 'The Flow', steps: [] });
    coordinator.register(plan);
    coordinator.registerFlow(flow);

    const status = coordinator.getStatus();
    const planStatus = status.find((s) => s.type === WorkflowType.PLAN);
    const flowStatus = status.find((s) => s.type === WorkflowType.FLOW);

    expect(planStatus).toBeDefined();
    expect(planStatus.name).toBe('The Plan');
    expect(flowStatus).toBeDefined();
    expect(flowStatus.name).toBe('The Flow');
    expect(planStatus.id).not.toBe(flowStatus.id);
  });
});
