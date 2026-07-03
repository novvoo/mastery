import { describe, test, expect, mock } from 'bun:test';
import { AgentPlanner } from '../../src/core/runtime/agent/agent-planner.js';
import { ExecutionPlan, TaskStatus, GraphPlanner } from '../../src/planner/graph-planner.js';
import { IntentClassifier } from '../../src/core/intent-classifier.js';
import { WorkspaceState } from '../../src/core/workspace/workspace-state.js';

function createPlanner() {
  const debugEvent = mock(() => {});
  const sessionManager = { addUserMessage: mock(() => {}) };
  const planner = new AgentPlanner({ debugEvent, sessionManager });
  return { planner, debugEvent, sessionManager };
}

function standardProfile(overrides = {}) {
  return {
    isCodingTask: true,
    isModificationTask: false,
    isBugTask: false,
    isDocumentationTask: false,
    riskLevel: 'low',
    semanticRiskDomains: [],
    requiresSemanticRiskReview: false,
    requiresAutomaticPlanning: true,
    ...overrides,
  };
}

describe('Intent Analysis and Plan Creation Integration', () => {
  describe('IntentClassifier', () => {
    test('classifies bug fix tasks correctly', () => {
      const classifier = new IntentClassifier();
      const profile = classifier.classifyTask('修复 login 功能的 bug');
      expect(profile.isBugTask).toBe(true);
      expect(profile.isCodingTask).toBe(true);
    });

    test('classifies documentation tasks correctly', () => {
      const classifier = new IntentClassifier();
      const profile = classifier.classifyTask('编写 README 文档');
      expect(profile.isDocumentationTask).toBe(true);
      expect(profile.planType).toBe('documentation');
    });

    test('supports explicit selectable plan type hints', () => {
      const classifier = new IntentClassifier();
      const profile = classifier.classifyTask('plan:quick 修改首页标题');
      expect(profile.explicitPlanType).toBe('quick');
      expect(profile.planType).toBe('quick');
      expect(profile.availablePlanTypes.map((type) => type.id)).toContain('bug_fix');
    });

    test('adds task signals and ranked plan selection to profile', () => {
      const classifier = new IntentClassifier();
      const profile = classifier.classifyTask('重构 React 组件并补测试');
      expect(profile.taskSignals.refactor).toBe(true);
      expect(profile.taskSignals.ui).toBe(true);
      expect(profile.taskSignals.tests).toBe(true);
      expect(profile.planSelection.ranked[0].score).toBeGreaterThan(0);
    });

    test('classifies code review tasks correctly', () => {
      const classifier = new IntentClassifier();
      const profile = classifier.classifyTask('审查代码');
      expect(profile.isCodingTask).toBe(true);
    });

    test('classifies modification tasks correctly', () => {
      const classifier = new IntentClassifier();
      const profile = classifier.classifyTask('修改用户注册功能，添加邮箱验证');
      expect(profile.isModificationTask).toBe(true);
      expect(profile.isCodingTask).toBe(true);
    });

    test('classifies with intent result enhances profile', () => {
      const mockModelProvider = {
        chat: mock(() => ({
          text: JSON.stringify({
            intent: 'code_modification',
            confidence: 0.9,
            normalizedTask: '修改用户注册功能',
            requiresCodeModification: true,
            recommendedTools: ['read_file', 'edit_file'],
          }),
        })),
      };
      const classifier = new IntentClassifier(mockModelProvider, {});
      const intent = classifier.classify('修改用户注册功能');
      const profile = classifier.classifyTask('修改用户注册功能', intent);
      expect(profile.isModificationTask).toBe(true);
      expect(profile.isCodingTask).toBe(true);
    });
  });

  describe('AgentPlanner #adjustPlanByTaskProfile', () => {
    test('adds missing inspect_workspace task to external plan', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'External Plan',
        description: 'Test plan',
      });
      externalPlan.addTask({
        id: 'plan_solution',
        name: 'Plan solution',
        description: 'Plan the solution',
        dependencies: [],
      });

      planner.setPlan(externalPlan);
      planner.createIfNeeded('test task', standardProfile());

      expect(externalPlan.getTask('inspect_workspace')).not.toBeNull();
    });

    test('preserves external plan across run reset', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'External Plan',
        description: 'Runtime-created plan',
      });
      externalPlan.addTask({
        id: 'runtime_task',
        name: 'Runtime task',
        description: 'Created before ReActAgent.run',
        dependencies: [],
      });

      planner.setPlan(externalPlan);
      planner.reset({ preserveExternalPlan: true });

      const plan = planner.createIfNeeded('test task', standardProfile());
      expect(plan).toBe(externalPlan);
      expect(plan.getTask('runtime_task')).not.toBeNull();
    });

    test('adds semantic_risk_review when required', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'External Plan',
        description: 'Test plan',
      });
      externalPlan.addTask({
        id: 'inspect_workspace',
        name: 'Inspect workspace',
        description: 'Inspect',
        dependencies: [],
      });
      externalPlan.addTask({
        id: 'inspect_changes',
        name: 'Inspect changes',
        description: 'Inspect changes',
        dependencies: ['inspect_workspace'],
      });

      planner.setPlan(externalPlan);
      planner.createIfNeeded(
        'test task',
        standardProfile({
          requiresSemanticRiskReview: true,
          semanticRiskDomains: [{ label: 'API' }],
        }),
      );

      expect(externalPlan.getTask('semantic_risk_review')).not.toBeNull();
    });

    test('does not duplicate existing tasks', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'External Plan',
        description: 'Test plan',
      });
      externalPlan.addTask({
        id: 'inspect_workspace',
        name: 'Inspect workspace',
        description: 'Inspect',
        dependencies: [],
      });
      externalPlan.addTask({
        id: 'plan_solution',
        name: 'Plan solution',
        description: 'Plan',
        dependencies: ['inspect_workspace'],
      });

      planner.setPlan(externalPlan);
      const initialTaskCount = Array.from(externalPlan.tasks.keys()).length;

      planner.createIfNeeded('test task', standardProfile());

      const finalTaskCount = Array.from(externalPlan.tasks.keys()).length;
      expect(finalTaskCount).toBeGreaterThanOrEqual(initialTaskCount);
      expect(externalPlan.getTask('inspect_workspace')).not.toBeNull();
    });

    test('adds all required tasks to minimal external plan', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'External Plan',
        description: 'Test plan',
      });

      planner.setPlan(externalPlan);
      planner.createIfNeeded('test task', standardProfile());

      expect(externalPlan.getTask('inspect_workspace')).not.toBeNull();
      expect(externalPlan.getTask('plan_solution')).not.toBeNull();
      expect(externalPlan.getTask('implement_changes')).not.toBeNull();
      expect(externalPlan.getTask('inspect_changes')).not.toBeNull();
      expect(externalPlan.getTask('verify_result')).not.toBeNull();
    });
  });

  describe('GraphPlanner decomposeTaskLLM with taskProfile', () => {
    test('accepts taskProfile in options', async () => {
      const mockModelProvider = {
        chat: mock(() => ({
          text: JSON.stringify([
            {
              name: 'inspect_workspace',
              description: 'Inspect workspace',
              dependencies: [],
              scope_files: [],
            },
          ]),
        })),
      };
      const planner = new GraphPlanner();

      const result = await planner.decomposeTaskLLM('修复 bug', mockModelProvider, {
        availableTools: ['read_file', 'write_file'],
        taskProfile: {
          isBugTask: true,
          riskLevel: 'high',
        },
      });

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    test('handles null taskProfile gracefully', async () => {
      const mockModelProvider = {
        chat: mock(() => ({
          text: JSON.stringify([
            {
              name: 'inspect_workspace',
              description: 'Inspect workspace',
              dependencies: [],
              scope_files: [],
            },
          ]),
        })),
      };
      const planner = new GraphPlanner();

      const result = await planner.decomposeTaskLLM('测试任务', mockModelProvider, {
        availableTools: ['read_file'],
        taskProfile: null,
      });

      expect(result).toBeDefined();
    });

    test('deduplicates repeated semantic task ids from LLM plans', async () => {
      const mockModelProvider = {
        chat: mock(() => ({
          text: JSON.stringify([
            {
              id: 'inspect_workspace',
              name: 'Inspect workspace',
              description: 'Inspect workspace',
              dependencies: [],
              scope_files: ['/'],
            },
            {
              id: 'implement_changes',
              name: 'Implement core changes',
              description: 'Implement runtime fix',
              dependencies: ['inspect_workspace'],
              scope_files: ['src/runtime/a.js'],
            },
            {
              id: 'implement_changes',
              name: 'Implement UI changes',
              description: 'Implement UI fix',
              dependencies: ['inspect_workspace'],
              scope_files: ['desktop/renderer/App.jsx'],
            },
            {
              id: 'verify_result',
              name: 'Verify result',
              description: 'Run tests',
              dependencies: ['implement_changes'],
              scope_files: [],
            },
          ]),
        })),
      };
      const planner = new GraphPlanner();

      const result = await planner.decomposeTaskLLM('修复核心能力', mockModelProvider, {
        availableTools: ['read_file', 'write_file', 'shell'],
      });

      const implementTasks = result.filter((task) => task.id === 'implement_changes');
      expect(implementTasks.length).toBe(1);
      expect(implementTasks[0].description).toContain('Implement runtime fix');
      expect(implementTasks[0].description).toContain('Implement UI fix');
      expect(implementTasks[0].scopeFiles).toContain('src/runtime/a.js');
      expect(implementTasks[0].scopeFiles).toContain('desktop/renderer/App.jsx');
      expect(result.find((task) => task.id === 'verify_result').dependencies).toEqual([
        'implement_changes',
      ]);
    });
  });

  describe('End-to-End Integration', () => {
    test('intent analysis result affects plan creation', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'External Plan',
        description: '修复用户登录的 bug',
      });

      planner.setPlan(externalPlan);

      const bugProfile = standardProfile({
        isBugTask: true,
        riskLevel: 'high',
      });

      const resultPlan = planner.createIfNeeded('修复用户登录的 bug', bugProfile);

      expect(resultPlan).not.toBeNull();
      expect(resultPlan.context.planType).toBe('bug_fix');
      expect(resultPlan.getTask('inspect_workspace')).not.toBeNull();
      expect(resultPlan.getTask('verify_result')).not.toBeNull();
    });

    test('normal coding task gets correct plan structure', () => {
      const { planner } = createPlanner();

      const profile = standardProfile({
        isCodingTask: true,
        isModificationTask: true,
      });

      const plan = planner.createIfNeeded('修改首页样式', profile);

      expect(plan).not.toBeNull();
      const taskIds = Array.from(plan.tasks.keys());
      expect(taskIds).toContain('inspect_workspace');
      expect(taskIds).toContain('plan_solution');
      expect(taskIds).toContain('implement_changes');
      expect(taskIds).toContain('verify_result');
    });

    test('external plan with code_review template gets adjusted', () => {
      const { planner } = createPlanner();

      const externalPlan = new ExecutionPlan({
        name: 'Code Review Plan',
        description: '审查代码',
      });
      externalPlan.addTask({
        id: 'analyze_code',
        name: 'Analyze code',
        description: 'Analyze code structure',
        dependencies: [],
      });
      externalPlan.addTask({
        id: 'check_style',
        name: 'Check style',
        description: 'Check code style',
        dependencies: ['analyze_code'],
      });

      planner.setPlan(externalPlan);
      const profile = standardProfile({
        isCodingTask: true,
      });

      planner.createIfNeeded('审查代码', profile);

      expect(externalPlan.getTask('inspect_workspace')).not.toBeNull();
      expect(externalPlan.getTask('verify_result')).not.toBeNull();
    });
  });

  describe('Tool Results Should Not Be Emitted As Messages', () => {
    test('WorkspaceState.recordToolResult stores result without emitting', () => {
      const ws = new WorkspaceState();

      ws.recordToolResult('read_file', { path: '/test/file.txt' }, { text: 'Hello World' }, true);

      const snapshot = ws.getFileSnapshot('/test/file.txt');
      expect(snapshot).not.toBeNull();
      expect(snapshot.content).toBe('Hello World');

      const facts = ws.queryFacts('tool_result');
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].type).toBe('tool_result');
    });

    test('WorkspaceState.recordToolResult handles write_file correctly', () => {
      const ws = new WorkspaceState();

      ws.recordToolResult(
        'write_file',
        { path: '/test/output.txt', content: 'New content' },
        null,
        true,
      );

      const snapshot = ws.getFileSnapshot('/test/output.txt');
      expect(snapshot).not.toBeNull();
      expect(snapshot.content).toBe('New content');
    });

    test('WorkspaceState.recordToolResult handles list_dir correctly', () => {
      const ws = new WorkspaceState();

      ws.recordToolResult(
        'list_dir',
        { path: '/test' },
        { entries: ['file1.txt', 'file2.txt'] },
        true,
      );

      const exists = ws.checkPathExists('/test');
      expect(exists).toBe('exists');

      const facts = ws.queryFacts('directory_listing');
      expect(facts.length).toBeGreaterThan(0);
    });

    test('WorkspaceState.recordToolResult truncates large results', () => {
      const ws = new WorkspaceState();

      const largeContent = 'x'.repeat(1000);
      ws.recordToolResult('read_file', { path: '/test/large.txt' }, { text: largeContent }, true);

      const facts = ws.queryFacts('tool_result');
      expect(facts.length).toBeGreaterThan(0);

      const resultStr = String(facts[0].value.result);
      expect(resultStr.length).toBeLessThanOrEqual(510);
      expect(resultStr).toContain('...');
    });

    test('WorkspaceState.aggregateContext includes tool results', () => {
      const ws = new WorkspaceState();

      ws.recordToolResult('read_file', { path: '/test/file1.txt' }, { text: 'Content 1' }, true);
      ws.recordToolResult('read_file', { path: '/test/file2.txt' }, { text: 'Content 2' }, true);

      const ctx = ws.aggregateContext({ maxFiles: 2 });

      expect(ctx.files.length).toBeGreaterThan(0);
      expect(ctx.summary).toContain('file1.txt');
    });

    test('WorkspaceState.recordToolResult normalizes args (truncates content)', () => {
      const ws = new WorkspaceState();

      const largeContent = 'x'.repeat(5000);
      ws.recordToolResult(
        'write_file',
        { path: '/test/large.txt', content: largeContent },
        null,
        true,
      );

      const facts = ws.queryFacts('tool_result');
      expect(facts.length).toBeGreaterThan(0);

      const argsStr = JSON.stringify(facts[0].value.args);
      expect(argsStr).not.toContain(largeContent);
      expect(argsStr).toContain('[content truncated to 5000 chars]');
    });
  });
});
