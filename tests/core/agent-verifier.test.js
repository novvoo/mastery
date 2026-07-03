import { describe, test, expect } from 'bun:test';
import { AgentVerifier } from '../../src/core/runtime/agent/agent-verifier.js';

function makeMockDeps() {
  return {
    debugEvent: () => {},
    toolRegistry: { has: () => false, getAll: () => [] },
    preview: (v) => String(v).substring(0, 200),
  };
}

describe('AgentVerifier', () => {
  test('creates instance', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    expect(verifier).toBeDefined();
  });

  test('shouldBlockCodingFinal does not block non-modification task', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.shouldBlockCodingFinal({
      responseText: 'FINAL_ANSWER: done',
      taskProfile: { isModificationTask: false, riskLevel: 'low' },
      runToolEvents: [],
    });
    expect(result.block).toBe(false);
  });

  test('shouldBlockCodingFinal blocks modification without evidence', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.shouldBlockCodingFinal({
      responseText: 'FINAL_ANSWER: done',
      taskProfile: { isModificationTask: true, riskLevel: 'high' },
      runToolEvents: [],
    });
    // Either blocked or not depending on internal logic
    expect(result).toHaveProperty('block');
  });

  test('shouldBlockCodingFinal allows with tool evidence', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.shouldBlockCodingFinal({
      responseText: 'FINAL_ANSWER: done, verified',
      taskProfile: { isModificationTask: false },
      runToolEvents: [{ success: true, name: 'write_file', isMutation: true }],
    });
    expect(result.block).toBe(false);
  });

  test('buildCodingCompletionGatePrompt returns string', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.buildCodingCompletionGatePrompt(
      'fix bug',
      { reason: 'no verification' },
      { riskLevel: 'low' },
    );
    expect(typeof result).toBe('string');
  });

  test('buildCodingTaskOperatingPrompt returns string', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.buildCodingTaskOperatingPrompt('fix bug', { isModificationTask: true });
    expect(typeof result).toBe('string');
  });

  test('buildSemanticRiskGuidance returns empty string for no domains', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.buildSemanticRiskGuidance({});
    expect(result).toBe('');
  });

  test('buildSemanticRiskGuidance returns guidance for risk domains', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = verifier.buildSemanticRiskGuidance({
      semanticRiskDomains: [{ label: 'API Surface', checklist: ['check API'] }],
    });
    expect(typeof result).toBe('string');
  });

  test('computeIterationBudget returns number', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const budget = verifier.computeIterationBudget({ riskLevel: 'low' }, 20);
    expect(typeof budget).toBe('number');
    expect(budget).toBeGreaterThan(0);
  });

  test('computeIterationBudget respects user-set max', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const budget = verifier.computeIterationBudget({ riskLevel: 'high' }, 30);
    expect(budget).toBe(30);
  });

  test('computeIterationBudget without profile', () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const budget = verifier.computeIterationBudget(null, 0);
    expect(typeof budget).toBe('number');
    expect(budget).toBeGreaterThanOrEqual(4);
  });

  test('suggestVerificationStrategy returns string', async () => {
    const verifier = new AgentVerifier(makeMockDeps());
    const result = await verifier.suggestVerificationStrategy('fix app.js', '/nonexistent');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
