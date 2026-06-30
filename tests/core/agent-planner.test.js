import { describe, test, expect, mock } from 'bun:test';
import { AgentPlanner } from '../../src/core/agent-planner.js';
import { ExecutionPlan, TaskStatus } from '../../src/planner/graph-planner.js';

// Helper: create a minimal AgentPlanner with mock dependencies
function createPlanner(overrides = {}) {
  const debugEvent = mock(() => {});
  const sessionManager = { addUserMessage: mock(() => {}) };
  const onPlanAdvance = overrides.onPlanAdvance || null;
  const planner = new AgentPlanner({ debugEvent, sessionManager, onPlanAdvance });
  return { planner, debugEvent, sessionManager, onPlanAdvance };
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

    const taskIds = Array.from(plan.tasks.keys());
    expect(taskIds).toEqual([
      'inspect_workspace',
      'profile_project',
      'tdd_reproduce',
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

  test('createIfNeeded honors explicit quick plan type', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      'plan:quick 修改 src/app.js 文案',
      standardProfile({ planType: 'quick', isModificationTask: true }),
    );

    expect(plan.context.planType).toBe('quick');
    expect(Array.from(plan.tasks.keys())).toEqual([
      'implement_changes',
      'inspect_changes',
      'verify_result',
    ]);
    expect(plan.getTask('implement_changes').status).toBe(TaskStatus.RUNNING);
  });

  test('createIfNeeded selects documentation plan for documentation profile', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '编写 README 文档',
      standardProfile({ isDocumentationTask: true, isModificationTask: true }),
    );

    expect(plan.context.planType).toBe('documentation');
    expect(plan.getTask('implement_changes')).toBeDefined();
    expect(plan.getTask('profile_project')).toBeUndefined();
  });

  test('createIfNeeded creates read-only analysis plan without verification by default', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '分析 src/app.js',
      standardProfile({
        isCodingTask: false,
        isModificationTask: false,
        isAnalysisTask: true,
        requiresAutomaticPlanning: true,
      }),
    );

    expect(plan.context.planType).toBe('analysis');
    expect(Array.from(plan.tasks.keys())).toEqual([
      'inspect_workspace',
      'analyze_findings',
      'generate_report',
    ]);
    expect(plan.getTask('verify_result')).toBeUndefined();
  });

  test('createIfNeeded selects refactor plan with behavior-preserving steps', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '重构 auth service',
      standardProfile({ isCodingTask: true, isModificationTask: true, planType: 'refactor' }),
    );

    expect(plan.context.planType).toBe('refactor');
    expect(plan.getTask('inspect_workspace')).toBeDefined();
    expect(plan.getTask('implement_changes')).toBeDefined();
    expect(plan.getTask('verify_result')).toBeDefined();
  });

  test('createIfNeeded selects security plan with semantic review task', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '修复 auth token 权限绕过',
      standardProfile({ isCodingTask: true, isModificationTask: true, planType: 'security' }),
    );

    expect(plan.context.planType).toBe('security');
    expect(plan.getTask('semantic_risk_review')).toBeDefined();
    expect(plan.getTask('semantic_risk_review').name).toContain('risk review');
    expect(plan.getTask('verify_result')).toBeDefined();
  });

  test('security semantic review task advances with security_review', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '修复 auth token 权限绕过',
      standardProfile({ isCodingTask: true, isModificationTask: true, planType: 'security' }),
    );

    planner.advance('list_dir', { path: 'src' }, 'auth.js');
    planner.advance('project_profile', { task: 'auth fix' }, 'profiled project');
    planner.advance('test_strategy', {}, 'targeted auth permission regression');
    planner.advance('security_review', { surface: 'auth token' }, 'reviewed auth surface');
    planner.advance('write_file', { path: 'auth.js' }, 'success: written');
    planner.advance('security_review', { surface: 'auth token' }, 'reviewed changed auth surface');
    planner.advance('security_review', { surface: 'auth token' }, 'reviewed semantic risk');

    expect(plan.getTask('semantic_risk_review').status).toBe(TaskStatus.COMPLETED);
    expect(plan.getTask('verify_result').status).toBe(TaskStatus.RUNNING);
  });

  test('createIfNeeded gives UI plans UI acceptance methodology', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '调整 React 组件布局',
      standardProfile({ isCodingTask: true, isModificationTask: true, planType: 'ui' }),
    );

    expect(plan.context.planType).toBe('ui');
    expect(plan.getTask('plan_solution')).toBeDefined();
    expect(plan.getTask('inspect_changes')).toBeDefined();
    expect(plan.getTask('verify_result')).toBeDefined();
  });

  test('createIfNeeded attaches professional plan strategy metadata', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded(
      '调整 React 组件布局',
      standardProfile({ isCodingTask: true, isModificationTask: true, planType: 'ui' }),
    );

    expect(plan.context.strategy).toMatchObject({
      version: 1,
      type: 'ui',
      label: 'UI acceptance',
      planningArchitecture: 'dag',
      planningArchitectureLabel: 'DAG orchestration',
      architecture: 'dag',
      verificationStrength: 'visual',
      recommendedReview: 'ui_acceptance',
      mutation: true,
    });
    expect(plan.context.strategy.phaseCount).toBeGreaterThanOrEqual(4);
    expect(['medium', 'high']).toContain(plan.context.strategy.parallelPotential);
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
    expect(prompt).toContain('Hashline and plan are one execution loop');
    expect(prompt).toContain('apply_hashline_patch is the preferred fast edit vehicle');
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
    // profile_project should be started before planning
    expect(planner.activePlan.getTask('profile_project').status).toBe(TaskStatus.RUNNING);
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

    // Phase 2: profile_project
    planner.advance('project_profile', { task: 'edit app.js' }, 'project profile output');
    expect(plan.getTask('profile_project').status).toBe(TaskStatus.COMPLETED);

    // Phase 3: tdd_reproduce
    planner.advance('test_strategy', {}, 'targeted check');
    expect(plan.getTask('tdd_reproduce').status).toBe(TaskStatus.COMPLETED);

    // Phase 4: plan_solution
    planner.advance('brainstorm', {}, 'some plan output');
    expect(plan.getTask('plan_solution').status).toBe(TaskStatus.COMPLETED);

    // Phase 5: implement_changes
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
    planner.advance('read_file', { path: 'package.json' }, '{"scripts":{"test":"bun test"}}');
    planner.advance('test_strategy', {}, 'targeted check');
    planner.advance('brainstorm', {}, 'plan output');
    planner.advance('write_file', { path: 'app.js' }, 'success: written');
    planner.advance('read_file', { path: 'app.js' }, 'file content');
    planner.advance('shell', { command: 'bun test' }, 'all tests passed');

    expect(planner.isCompleted()).toBe(true);
    expect(planner.activePlan.status).toBe(TaskStatus.COMPLETED);
  });

  test('advance respects task completionPredicate (Phase 9)', () => {
    const { planner, debugEvent } = createPlanner();
    planner.createIfNeeded('edit app.js', standardProfile());

    const inspectTask = planner.activePlan.getTask('inspect_workspace');
    // 设置严格的完成条件：只有 semantic_search 才能结束 inspect_workspace
    inspectTask.completionPredicate = ({ toolName }) => toolName === 'semantic_search';

    // list_dir 满足类型谓词但不满足 completionPredicate → 不完成
    planner.advance('list_dir', { path: '/src' }, 'file1.js\nfile2.js');
    expect(inspectTask.status).toBe(TaskStatus.RUNNING);
    expect(inspectTask.toolCallsHistory.some((call) => call.toolName === 'list_dir')).toBe(false);

    // semantic_search 同时满足类型谓词和 completionPredicate → 完成
    planner.advance('semantic_search', { query: 'foo' }, ['result']);
    expect(inspectTask.status).toBe(TaskStatus.COMPLETED);
    expect(inspectTask.toolCallsHistory.some((call) => call.toolName === 'semantic_search')).toBe(
      true,
    );
    expect(planner.activePlan.getTask('profile_project').status).toBe(TaskStatus.RUNNING);
  });

  test('advance records tool history only on the matched running task', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded('edit app.js', standardProfile());

    planner.advance('list_dir', { path: '/src' }, 'file1.js');
    planner.advance('project_profile', { task: 'edit app.js' }, 'package.json scripts test');

    const tddTask = plan.getTask('tdd_reproduce');
    const planTask = plan.getTask('plan_solution');
    expect(tddTask.status).toBe(TaskStatus.RUNNING);
    expect(planTask.status).toBe(TaskStatus.RUNNING);

    planner.advance('architect', {}, 'planned change');

    expect(planTask.status).toBe(TaskStatus.COMPLETED);
    expect(tddTask.status).toBe(TaskStatus.RUNNING);
    expect(tddTask.toolCallsHistory.some((call) => call.toolName === 'architect')).toBe(false);
    expect(planTask.toolCallsHistory.some((call) => call.toolName === 'architect')).toBe(true);
  });

  test('changePlan replace preserves completed tasks and replaces unfinished work', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded('edit app.js', standardProfile());
    plan.getTask('inspect_workspace').updateStatus(TaskStatus.COMPLETED);

    const result = planner.changePlan({
      mode: 'replace',
      reason: 'scope changed',
      tasks: [
        {
          id: 'diagnose_new_scope',
          name: 'Diagnose new scope',
          description: 'Read the new files before editing',
          phase: 'exploration',
        },
        {
          id: 'implement_new_scope',
          name: 'Implement new scope',
          description: 'Apply the new change',
          phase: 'implementation',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(plan.getTask('inspect_workspace').status).toBe(TaskStatus.COMPLETED);
    expect(plan.getTask('plan_solution')).toBeUndefined();
    expect(plan.getTask('diagnose_new_scope')).not.toBeUndefined();
    expect(plan.getTask('diagnose_new_scope').dependencies.has('inspect_workspace')).toBe(true);
    expect(plan.getTask('implement_new_scope').dependencies.has('diagnose_new_scope')).toBe(true);
  });

  test('changePlan insertBefore pauses target and runs inserted task first', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded('edit app.js', standardProfile());
    plan.getTask('inspect_workspace').updateStatus(TaskStatus.COMPLETED);
    plan.getTask('profile_project').updateStatus(TaskStatus.COMPLETED);
    const planTask = plan.getTask('plan_solution');
    planTask.updateStatus(TaskStatus.RUNNING);

    const result = planner.changePlan({
      mode: 'insertBefore',
      targetTaskId: 'plan_solution',
      tasks: [
        {
          id: 'clarify_scope',
          name: 'Clarify scope',
          description: 'Clarify missing details',
          phase: 'planning',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(plan.getTask('clarify_scope').dependencies.has('profile_project')).toBe(true);
    expect(plan.getTask('plan_solution').dependencies.has('clarify_scope')).toBe(true);
    expect(plan.getTask('plan_solution').status).toBe(TaskStatus.PENDING);
    expect(plan.getTask('clarify_scope').status).toBe(TaskStatus.RUNNING);
  });

  test('changePlan insertAfter reconnects downstream dependencies', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded('edit app.js', standardProfile());

    const result = planner.changePlan({
      mode: 'insertAfter',
      targetTaskId: 'plan_solution',
      tasks: [
        {
          id: 'review_design',
          name: 'Review design',
          description: 'Review the design before implementation',
          phase: 'planning',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(plan.getTask('review_design').dependencies.has('plan_solution')).toBe(true);
    expect(plan.getTask('implement_changes').dependencies.has('review_design')).toBe(true);
    expect(plan.getTask('implement_changes').dependencies.has('plan_solution')).toBe(false);
  });

  test('changePlan emits refreshed full plan progress', () => {
    const onPlanAdvance = mock(() => {});
    const { planner } = createPlanner({ onPlanAdvance });
    planner.createIfNeeded('edit app.js', standardProfile());
    onPlanAdvance.mockClear();

    const result = planner.changePlan({
      mode: 'append',
      reason: 'add extra verification',
      tasks: [
        {
          id: 'manual_verify',
          name: 'Manual verify',
          description: 'Manually verify the behavior',
          phase: 'verification',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(onPlanAdvance).toHaveBeenCalled();
    const payload = onPlanAdvance.mock.calls.at(-1)[0];
    expect(payload.planChanged).toBe(true);
    expect(payload.change.insertedTasks).toEqual(['manual_verify']);
    expect(payload.plan.tasks.map((task) => task.id)).toContain('manual_verify');
    expect(payload.plan.strategy).toMatchObject({
      planningArchitecture: 'reflexion',
      planningArchitectureLabel: 'Reflective repair',
      dynamicReplanning: true,
    });
  });

  test('changePlan failure leaves existing plan unchanged', () => {
    const { planner } = createPlanner();
    const plan = planner.createIfNeeded('edit app.js', standardProfile());
    plan.getTask('inspect_workspace').updateStatus(TaskStatus.COMPLETED);
    const before = plan.toJSON();

    const result = planner.changePlan({
      mode: 'insertBefore',
      targetTaskId: 'inspect_workspace',
      tasks: [{ id: 'illegal_task', name: 'Illegal task' }],
    });

    expect(result.success).toBe(false);
    expect(plan.toJSON()).toEqual(before);
    expect(plan.getTask('illegal_task')).toBeUndefined();
  });
});
