import { describe, test, expect } from 'bun:test';
import { TokenScope } from '../../src/core/runtime/agent/support/token-scope.js';

describe('TokenScope', () => {
  test('constructor initializes with defaults', () => {
    const scope = new TokenScope();
    const stats = scope.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.totalCost).toBe(0);
  });

  test('recordRequest tracks token usage', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 });
    const stats = scope.getStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalInputTokens).toBe(1000);
    expect(stats.totalOutputTokens).toBe(500);
    expect(stats.totalCost).toBeGreaterThan(0);
  });

  test('calculateCost uses fallback for unknown model', () => {
    const scope = new TokenScope();
    const cost = scope.calculateCost('unknown-model', 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
    expect(scope.getUnknownModels()).toContain('unknown-model');
  });

  test('calculateCost computes correct cost for gpt-4o', () => {
    const scope = new TokenScope();
    const cost = scope.calculateCost('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(20.0, 1);
  });

  test('recordRequest with userId tracks by user', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, userId: 'user1' });
    const breakdown = scope.getUserBreakdown();
    expect(breakdown.user1).toBeDefined();
    expect(breakdown.user1.requests).toBe(1);
  });

  test('setBudgetLimit triggers warning callback', () => {
    let warningCalled = false;
    const scope = new TokenScope({
      onBudgetWarning: () => {
        warningCalled = true;
      },
    });
    scope.setBudgetLimit('user1', 0.01, 50);
    scope.recordRequest({
      model: 'gpt-4o',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      userId: 'user1',
    });
    expect(warningCalled).toBe(true);
  });

  test('setBudgetLimit triggers exceeded callback', () => {
    let exceededCalled = false;
    const scope = new TokenScope({
      onBudgetExceeded: () => {
        exceededCalled = true;
      },
    });
    scope.setBudgetLimit('user1', 0.001, 50);
    scope.recordRequest({
      model: 'gpt-4o',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      userId: 'user1',
    });
    expect(exceededCalled).toBe(true);
  });

  test('getModelBreakdown returns model stats', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    scope.recordRequest({ model: 'claude-3-sonnet', inputTokens: 200, outputTokens: 100 });
    const breakdown = scope.getModelBreakdown();
    expect(breakdown['gpt-4o']).toBeDefined();
    expect(breakdown['claude-3-sonnet']).toBeDefined();
    expect(breakdown['gpt-4o'].requests).toBe(1);
  });

  test('getHistory filters by model', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    scope.recordRequest({ model: 'claude-3-sonnet', inputTokens: 200, outputTokens: 100 });
    const history = scope.getHistory({ model: 'gpt-4o' });
    expect(history.length).toBe(1);
    expect(history[0].model).toBe('gpt-4o');
  });

  test('getHistory filters by time range', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, timestamp: 1000 });
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, timestamp: 5000 });
    const history = scope.getHistory({ startTime: 2000 });
    expect(history.length).toBe(1);
  });

  test('generateReport returns report with time range', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    const report = scope.generateReport('session');
    expect(report.timeRange).toBe('session');
    expect(report.totalRequests).toBe(1);
    expect(report.period).toBeDefined();
    expect(report.topModels).toBeDefined();
    expect(report.costTrend).toBeDefined();
  });

  test('reset clears all stats', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
    scope.reset();
    const stats = scope.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.totalCost).toBe(0);
  });

  test('exportData returns complete data', () => {
    const scope = new TokenScope();
    scope.recordRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, userId: 'u1' });
    const data = scope.exportData();
    expect(data.session).toBeDefined();
    expect(data.modelBreakdown).toBeDefined();
    expect(data.userBreakdown).toBeDefined();
    expect(data.history.length).toBe(1);
  });

  test('generateId produces unique ids', () => {
    const scope = new TokenScope();
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(scope.generateId());
    }
    expect(ids.size).toBe(50);
  });
});
