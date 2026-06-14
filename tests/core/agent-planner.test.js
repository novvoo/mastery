import { describe, test, expect, mock } from 'bun:test';
import { AgentPlanner } from '../../src/core/agent-planner.js';
import { ExecutionPlan, TaskStatus } from '../../src/planner/graph-planner.js';

// Helper: create a minimal AgentPlanner with mock dependencies
function createPlanner() {
  const debugEvent = mock(() => {});
  const sessionManager = { addUserMessage: mock(() => {}) };
  const planner = new AgentPlanner({ debugEvent, sessionManager });
  return { planner, debugEvent, sessionManager };
}

// Helper: create a standard task profile
function standardProfile(overrides = {}) {
  return {
    requiresAutomaticPlanning: true,
    requiresSemanticRiskReview: false,
    semanticRiskDomains: [],
    ...overrides,
  };
}

describe('AgentPlanner', () => {
  test('createIfNeeded returns null when requiresAutomaticPlanning is false', () => {
    const { planner } = createPlanner();
    const result = planner.createIfNeeded('edit app.js', { requiresAutomaticPlanning: false });
    expect(result).toBeNull();
    expect(planner.activePlan).toBeNull();
  });

  test('createIfNeeded returns null when profile is null/undefined', () => {
    const { planner } = createPlanner();
    expect(planner.createIfNeeded('edit app.js', null)).toBeNull();
    expect(planner.createIfNeeded('edit app.js', undefined)).toBeNull();
    expect(planner.activePlan).toBeNull();
  });

  test('createIfNeeded creates a plan with correct task structure', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded('edit src/app.js', standardProfile());
    expect(plan).not.toBeNull();
    expect(plan).toBeInstanceOf(ExecutionPlan);
    expect(planner.activePlan).toBe(plan);

    // Should have 5 tasks (no semantic_risk_review)
    const taskIds = Array.from(plan.tasks.keys());
    expect(taskIds).toEqual([
      'inspect_workspace',
      'plan_solution',
      'implement_changes',
      'inspect_changes',
      'verify_result',
    ]);

    // Plan should be RUNNING
    expect(plan.status).toBe(TaskStatus.RUNNING);

    // inspect_workspace should be RUNNING
    expect(plan.getTask('inspect_workspace').status).toBe(TaskStatus.RUNNING);
  });

  test('createIfNeeded includes semantic_risk_review when required', () => {
    const { planner } = createPlanner();
    const profile = standardProfile({
      requiresSemanticRiskReview: true,
      semanticRiskDomains: [{ label: 'Performance' }, { label: 'API' }],
    });
    const plan = planner.createIfNeeded('edit app.js', profile);
    expect(plan).not.toBeNull();

    const taskIds = Array.from(plan.tasks.keys());
    expect(taskIds).toContain('semantic_risk_review');

    // verify_result should depend on semantic_risk_review
    const verifyTask = plan.getTask('verify_result');
    expect(verifyTask.dependencies.has('semantic_risk_review')).toBe(true);
  });

  test('reset clears the active plan', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    expect(planner.activePlan).not.toBeNull();

    planner.reset();
    expect(planner.activePlan).toBeNull();
  });

  test('activePlan getter returns null initially', () => {
    const { planner } = createPlanner();
    expect(planner.activePlan).toBeNull();
  });

  test('deriveCurrentPhase returns null when no active plan', () => {
    const { planner } = createPlanner();
    expect(planner.deriveCurrentPhase()).toBeNull();
  });

  test('deriveCurrentPhase returns exploration when inspect_workspace is running', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    expect(planner.deriveCurrentPhase()).toBe('exploration');
  });

  test('deriveCurrentPhase returns planning when plan_solution is running', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    const plan = planner.activePlan;
    // Complete inspect_workspace → plan_solution becomes RUNNING
    plan.getTask('inspect_workspace').updateStatus(TaskStatus.COMPLETED);
    plan.getTask('plan_solution').updateStatus(TaskStatus.RUNNING);
    expect(planner.deriveCurrentPhase()).toBe('planning');
  });

  test('deriveCurrentPhase returns verification when all tasks completed', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    const plan = planner.activePlan;
    // Complete all tasks
    for (const task of plan.tasks.values()) {
      task.updateStatus(TaskStatus.COMPLETED);
    }
    // Plan still RUNNING (not explicitly closed)
    plan.status = TaskStatus.RUNNING;
    expect(planner.deriveCurrentPhase()).toBe('verification');
  });

  test('buildPrompt returns empty string when no active plan', () => {
    const { planner } = createPlanner();
    expect(planner.buildPrompt('user input')).toBe('');
  });

  test('buildPrompt returns prompt with task list when plan exists', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit src/app.js', standardProfile());
    const prompt = planner.buildPrompt('edit src/app.js');
    expect(prompt).toContain('Automatic task orchestration is active');
    expect(prompt).toContain('edit src/app.js');
    expect(prompt).toContain('inspect_workspace');
    expect(prompt).toContain('plan_solution');
    expect(prompt).toContain('implement_changes');
    expect(prompt).toContain('verify_result');
  });

  test('buildPrompt includes semantic risk guidance when provided', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    const prompt = planner.buildPrompt('edit app.js', 'Semantic risk: check API boundaries');
    expect(prompt).toContain('Semantic risk: check API boundaries');
  });

  test('isCompleted returns false when no plan', () => {
    const { planner } = createPlanner();
    expect(planner.isCompleted()).toBe(false);
  });

  test('isCompleted returns true when plan status is COMPLETED', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    planner.activePlan.status = TaskStatus.COMPLETED;
    expect(planner.isCompleted()).toBe(true);
  });

  test('advance does nothing when no active plan', () => {
    const { planner, debugEvent, sessionManager } = createPlanner();
    planner.advance('list_dir', { path: '/src' }, 'file1.js\nfile2.js');
    expect(debugEvent).not.toHaveBeenCalled();
    expect(sessionManager.addUserMessage).not.toHaveBeenCalled();
  });

  test('advance does nothing when result is an error', () => {
    const { planner, debugEvent, sessionManager } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    planner.advance('list_dir', { path: '/src' }, 'Error: something failed');
    // inspect_workspace should still be RUNNING (not completed)
    expect(planner.activePlan.getTask('inspect_workspace').status).toBe(TaskStatus.RUNNING);
  });

  test('advance completes inspect_workspace on workspace inspection tool', () => {
    const { planner, debugEvent, sessionManager } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    planner.advance('list_dir', { path: '/src' }, 'file1.js\nfile2.js');

    // inspect_workspace should be completed
    expect(planner.activePlan.getTask('inspect_workspace').status).toBe(TaskStatus.COMPLETED);
    // plan_solution should be started
    expect(planner.activePlan.getTask('plan_solution').status).toBe(TaskStatus.RUNNING);
    // debugEvent should have been called
    expect(debugEvent).toHaveBeenCalled();
    expect(sessionManager.addUserMessage).toHaveBeenCalled();
  });

  test('advance progresses through multiple phases', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());
    const plan = planner.activePlan;

    // Phase 1: inspect_workspace
    planner.advance('list_dir', { path: '/src' }, 'file1.js\nfile2.js');
    expect(plan.getTask('inspect_workspace').status).toBe(TaskStatus.COMPLETED);

    // Phase 2: plan_solution
    planner.advance('brainstorm', {}, 'some plan output');
    expect(plan.getTask('plan_solution').status).toBe(TaskStatus.COMPLETED);

    // Phase 3: implement_changes
    planner.advance('write_file', { path: 'app.js' }, 'success: written');
    // implement_changes may still be running if requiredMutationPaths not met
    // With no file paths in input, it completes
    expect(plan.getTask('implement_changes').status).toBe(TaskStatus.COMPLETED);
  });

  test('advance completes plan when all tasks done', () => {
    const { planner } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());

    // Simulate tool calls that complete each phase
    planner.advance('list_dir', { path: '/src' }, 'file1.js');
    planner.advance('brainstorm', {}, 'plan output');
    planner.advance('write_file', { path: 'app.js' }, 'success: written');
    planner.advance('read_file', { path: 'app.js' }, 'file content');
    planner.advance('shell', { command: 'bun test' }, 'all tests passed');

    expect(planner.isCompleted()).toBe(true);
    expect(planner.activePlan.status).toBe(TaskStatus.COMPLETED);
  });
});
