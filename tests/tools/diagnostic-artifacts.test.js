import { describe, expect, test } from 'bun:test';
import createAnalyzeTestFailureTool from '../../src/tools/skills/analyze-test-failure.js';
import createDecideRepairPlanTool from '../../src/tools/skills/decide-repair-plan.js';

describe('strict repair diagnostic artifact tools', () => {
  test('accepts a fact/hypothesis-separated failure analysis', async () => {
    const result = await createAnalyzeTestFailureTool().handler({
      command: 'bun test tests/game.test.js',
      primary_error: 'TypeError: null.getContext',
      failure_location: 'js/main.js:12',
      observed_facts: ['Game was constructed without a canvas id.'],
      hypotheses: [
        {
          cause: 'The constructor receives undefined.',
          evidence: ['tests/game.test.js', 'js/main.js'],
          confidence: 'high',
        },
      ],
      downstream_risks: ['start() may still be missing.'],
    });
    expect(result.ok).toBe(true);
    expect(result.analysis.hypotheses[0].confidence).toBe('high');
  });

  test('rejects hypotheses without evidence', async () => {
    const result = await createAnalyzeTestFailureTool().handler({
      command: 'bun test',
      primary_error: 'TypeError',
      failure_location: 'main.js:1',
      observed_facts: ['test failed'],
      hypotheses: [{ cause: 'maybe canvas', evidence: [], confidence: 'high' }],
      downstream_risks: [],
    });
    expect(result.ok).toBe(false);
  });

  test('accepts a concrete repair decision with verification', async () => {
    const result = await createDecideRepairPlanTool().handler({
      root_causes: ['Constructor and test contracts disagree.'],
      selected_approach: 'Inject canvas dependencies and isolate browser bootstrap.',
      alternatives: [{ name: 'Only mock tests', rejected_because: 'Leaves production broken.' }],
      changes: [{ target: 'js/main.js', behavior: 'Guard DOM bootstrap.' }],
      verification: ['bun test tests/game.test.js', 'bun test'],
      scope_exclusions: ['stale multiplayer API'],
    });
    expect(result.ok).toBe(true);
    expect(result.decision.verification).toHaveLength(2);
  });
});
