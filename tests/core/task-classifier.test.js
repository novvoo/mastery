import { describe, test, expect } from 'bun:test';
import { TaskClassifier } from '../../src/core/classification/task-classifier.js';

describe('TaskClassifier', () => {
  test('classify returns task profile', () => {
    const tc = new TaskClassifier();
    const result = tc.classify('write a Python function to sort a list');
    expect(result).toBeDefined();
    expect(result.riskLevel).toBeDefined();
  });

  test('budgetFor returns iteration budget', () => {
    const tc = new TaskClassifier();
    const budget = tc.budgetFor({ riskLevel: 'high' });
    expect(budget).toBeGreaterThan(0);
  });

  test('inferSemanticRiskDomains returns array', () => {
    const tc = new TaskClassifier();
    const domains = tc.inferSemanticRiskDomains('implement async timeout logic');
    expect(Array.isArray(domains)).toBe(true);
  });

  test('deep returns deep assessment', () => {
    const tc = new TaskClassifier();
    const result = tc.deep('fix a bug in the authentication code');
    expect(result).toBeDefined();
  });

  test('completionGates returns gates object', () => {
    const tc = new TaskClassifier();
    const gates = tc.completionGates({ riskLevel: 'high' });
    expect(gates).toBeDefined();
    // completionGates returns an object with requireMutation etc.
    expect(typeof gates).toBe('object');
  });

  test('iterationBudget returns number', () => {
    const tc = new TaskClassifier();
    const budget = tc.iterationBudget({ riskLevel: 'critical' });
    expect(typeof budget).toBe('number');
    expect(budget).toBeGreaterThan(0);
  });
});
