import { describe, test, expect, mock } from 'bun:test';

// Mock intent-classifier (optional dependency)
mock.module('../../../src/core/intent-classifier.js', () => ({
  IntentClassifier: class IntentClassifier {
    constructor() {}
    async classify() {
      return null;
    }
    classifyTask() {
      return null;
    }
  },
}));

// Mock tool-router
mock.module('../../../src/core/tool-router.js', () => ({
  selectToolsForRequest: () => [],
}));

import { IntelligentReasoning } from '../../../src/core/intelligent-reasoning.js';

function makeMockToolRegistry(tools = []) {
  return {
    getAll: mock(() => tools),
    get: mock((name) => tools.find((t) => t.name === name)),
  };
}

function makeMockExperienceMemory(entries = []) {
  return {
    recall: mock(() => entries),
    store: mock(async () => {}),
  };
}

function makeMockIntentClassifier(classifyResult = null) {
  return {
    classify: mock(async () => classifyResult),
    classifyTask: mock(() => null),
  };
}

describe('IntelligentReasoning', () => {
  test('constructs with no options (defaults)', () => {
    const ir = new IntelligentReasoning();
    expect(ir).toBeDefined();
  });

  test('constructs with custom config', () => {
    const ir = new IntelligentReasoning({
      config: { maxCandidates: 3, confidenceThreshold: 0.9 },
    });
    expect(ir).toBeDefined();
  });

  test('constructs with intentClassifier option', () => {
    const classifier = makeMockIntentClassifier();
    const ir = new IntelligentReasoning({ intentClassifier: classifier });
    expect(ir).toBeDefined();
  });
});

describe('IntelligentReasoning.analyzeIntent', () => {
  test('returns fallback analysis when no intentClassifier', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.analyzeIntent('What is the meaning of life?');
    expect(result).toBeDefined();
    expect(result.intents).toBeDefined();
    expect(result.primary).toBeDefined();
    expect(result.keywords).toBeDefined();
  });

  test('detects question intent via fallback regex', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.analyzeIntent('What is Node.js?');
    expect(result.intents.isQuestion).toBe(true);
  });

  test('detects action intent via fallback regex', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.analyzeIntent('Create a new file');
    expect(result.intents.isAction).toBe(true);
  });

  test('detects search intent via fallback regex', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.analyzeIntent('Find all TODO comments');
    expect(result.intents.isSearch).toBe(true);
  });

  test('delegates to intentClassifier when available', async () => {
    const classifier = makeMockIntentClassifier({
      intent: 'coding_task',
      confidence: 0.9,
      requiresCodeModification: true,
      requiresFreshData: false,
    });
    const ir = new IntelligentReasoning({ intentClassifier: classifier });
    const result = await ir.analyzeIntent('Write a function');
    expect(result).toBeDefined();
    expect(result.confidence).toBe(0.9);
    expect(result.intents.isAction).toBe(true);
  });

  test('falls back when intentClassifier returns null', async () => {
    const classifier = makeMockIntentClassifier(null);
    const ir = new IntelligentReasoning({ intentClassifier: classifier });
    const result = await ir.analyzeIntent('How does this work?');
    expect(result).toBeDefined();
    expect(result.intents.isQuestion).toBe(true);
  });
});

describe('IntelligentReasoning.decomposeTask', () => {
  test('returns single main task for simple input', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.decomposeTask('Do something simple');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('main');
    expect(result[0].description).toBe('Do something simple');
  });

  test('splits sequential tasks with "then" keyword', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.decomposeTask('First step then second step then third step');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1].dependencies).toContain('sub_1');
  });

  test('splits parallel tasks with "and" keyword', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.decomposeTask('Task A and Task B and Task C');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((r) => r.parallel === true)).toBe(true);
  });

  test('handles Chinese sequential connectors', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.decomposeTask('第一步 然后 第二步');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('returns main task for empty-ish split parts', async () => {
    const ir = new IntelligentReasoning();
    const result = await ir.decomposeTask('SingleTask');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('main');
  });
});

describe('IntelligentReasoning.evaluateResult', () => {
  test('returns excellent quality for clean result', async () => {
    const ir = new IntelligentReasoning();
    const evaluation = await ir.evaluateResult('task', 'All done successfully');
    expect(evaluation.success).toBe(true);
    expect(evaluation.quality).toBe('excellent');
    expect(evaluation.completeness).toBe(1.0);
    expect(evaluation.issues).toHaveLength(0);
  });

  test('flags error in result string', async () => {
    const ir = new IntelligentReasoning();
    const evaluation = await ir.evaluateResult('task', 'Error: something failed');
    expect(evaluation.success).toBe(false);
    expect(evaluation.issues).toContain('Execution reported error');
  });

  test('flags empty result', async () => {
    const ir = new IntelligentReasoning();
    const evaluation = await ir.evaluateResult('task', '');
    expect(evaluation.completeness).toBe(0.0);
    expect(evaluation.issues).toContain('Empty result');
  });

  test('flags truncated result', async () => {
    const ir = new IntelligentReasoning();
    const evaluation = await ir.evaluateResult('task', 'Some result [truncated]');
    expect(evaluation.completeness).toBe(0.8);
    expect(evaluation.issues).toContain('Result was truncated');
  });

  test('uses experienceMemory for suggestions on past failures', async () => {
    const memory = makeMockExperienceMemory([
      { outcome: 'failure', lesson: 'Avoid timeout on large files' },
    ]);
    const ir = new IntelligentReasoning({ experienceMemory: memory });
    const evaluation = await ir.evaluateResult('task', 'Error occurred');
    expect(evaluation.suggestions.length).toBeGreaterThan(0);
    expect(evaluation.suggestions[0]).toContain('Avoid timeout');
  });

  test('handles object result by stringifying', async () => {
    const ir = new IntelligentReasoning();
    const evaluation = await ir.evaluateResult('task', { data: 'ok' });
    expect(evaluation).toBeDefined();
    expect(evaluation.success).toBe(true);
  });
});

describe('IntelligentReasoning.generateStrategy', () => {
  test('returns direct type when no tools', () => {
    const ir = new IntelligentReasoning();
    const strategy = ir.generateStrategy('task', []);
    expect(strategy.type).toBe('direct');
  });

  test('returns single_tool type for high confidence tool', () => {
    const ir = new IntelligentReasoning();
    const strategy = ir.generateStrategy('task', [{ name: 'read_file', confidence: 0.9 }]);
    expect(strategy.type).toBe('single_tool');
    expect(strategy.tool).toBe('read_file');
  });

  test('returns tool_chain type for multiple medium-confidence tools', () => {
    const ir = new IntelligentReasoning();
    const strategy = ir.generateStrategy('task', [
      { name: 'read_file', confidence: 0.6 },
      { name: 'search', confidence: 0.5 },
    ]);
    expect(strategy.type).toBe('tool_chain');
    expect(strategy.tools).toHaveLength(2);
  });

  test('returns exploratory type for low confidence tools', () => {
    const ir = new IntelligentReasoning();
    const strategy = ir.generateStrategy('task', [
      { name: 'tool_a', confidence: 0.2 },
      { name: 'tool_b', confidence: 0.1 },
    ]);
    expect(strategy.type).toBe('exploratory');
  });
});

describe('IntelligentReasoning.selectTools', () => {
  test('returns fallback tools when no intentClassifier', async () => {
    const tools = [
      { name: 'git_status', description: 'Show git status' },
      { name: 'read_file', description: 'Read a file' },
    ];
    const registry = makeMockToolRegistry(tools);
    const ir = new IntelligentReasoning({ toolRegistry: registry });
    const result = await ir.selectTools('git commit', null);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  test('returns empty array when no tools match', async () => {
    const registry = makeMockToolRegistry([]);
    const ir = new IntelligentReasoning({ toolRegistry: registry });
    const result = await ir.selectTools('something random', null);
    expect(result).toHaveLength(0);
  });
});
