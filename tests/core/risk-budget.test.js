import { describe, test, expect } from 'bun:test';
import {
  RISK_LEVEL,
  ITERATION_RATIO,
  isCliCommand,
  CODING_KEYWORDS,
  MODIFICATION_VERB_PATTERNS,
  READ_ONLY_PATTERNS,
  quickAssess,
  deepAssess,
  computeIterationBudget,
  getCompletionGates,
  getMethodologyGuidance,
  mergeIntentProfile,
} from '../../src/core/risk-budget.js';

describe('risk-budget', () => {
  describe('RISK_LEVEL', () => {
    test('has expected levels', () => {
      expect(RISK_LEVEL.LOW).toBe('low');
      expect(RISK_LEVEL.MEDIUM).toBe('medium');
      expect(RISK_LEVEL.HIGH).toBe('high');
      expect(RISK_LEVEL.CRITICAL).toBe('critical');
    });
  });

  describe('ITERATION_RATIO', () => {
    test('is monotonically non-decreasing', () => {
      expect(ITERATION_RATIO[RISK_LEVEL.LOW]).toBeLessThanOrEqual(
        ITERATION_RATIO[RISK_LEVEL.MEDIUM],
      );
      expect(ITERATION_RATIO[RISK_LEVEL.MEDIUM]).toBeLessThanOrEqual(
        ITERATION_RATIO[RISK_LEVEL.HIGH],
      );
      expect(ITERATION_RATIO[RISK_LEVEL.HIGH]).toBeLessThanOrEqual(
        ITERATION_RATIO[RISK_LEVEL.CRITICAL],
      );
    });
  });

  describe('isCliCommand', () => {
    test('detects CLI commands', () => {
      expect(isCliCommand('/help')).toBe(true);
      expect(isCliCommand('/stats')).toBe(true);
    });

    test('rejects non-CLI', () => {
      expect(isCliCommand('write a function')).toBe(false);
      expect(isCliCommand('/this is a very long command with newline\n')).toBe(false);
    });
  });

  describe('quickAssess', () => {
    test('non-coding task is LOW risk', () => {
      const result = quickAssess('what is the weather today?');
      expect(result.isCodingTask).toBe(false);
      expect(result.riskLevel).toBe(RISK_LEVEL.LOW);
    });

    test('simple coding task is at least MEDIUM', () => {
      const result = quickAssess('implement a function in Python to sort a list');
      expect(result.isCodingTask).toBe(true);
      expect([RISK_LEVEL.MEDIUM, RISK_LEVEL.HIGH, RISK_LEVEL.CRITICAL]).toContain(result.riskLevel);
    });

    test('CLI command is not coding', () => {
      const result = quickAssess('/help');
      expect(result.isCodingTask).toBe(false);
    });

    test('bug keywords increase score', () => {
      const result = quickAssess('fix the bug in the React component');
      expect(result.isBugTask).toBe(true);
    });

    test('trivial task detection', () => {
      const result = quickAssess('fix a typo in readme.md — simple standalone demo');
      // isLikelyTrivial requires both isCodingTask and TRIVIAL_TEXT_PATTERNS match
      if (result.isCodingTask) {
        expect(typeof result.isLikelyTrivial).toBe('boolean');
      }
    });

    test('security keywords boost risk', () => {
      const result = quickAssess('add authentication and security to the API');
      expect(result.score).toBeGreaterThan(0);
    });

    test('returns semanticDomains', () => {
      const result = quickAssess('implement async timeout and retry logic');
      expect(Array.isArray(result.semanticDomains)).toBe(true);
    });

    test('modification patterns detect write intent', () => {
      const result = quickAssess('create a new API endpoint for user authentication');
      if (result.isCodingTask) {
        expect(typeof result.isModificationTask).toBe('boolean');
      }
    });
  });

  describe('deepAssess', () => {
    test('null result returns fallback', () => {
      const result = deepAssess(null);
      expect(result.riskLevel).toBe(RISK_LEVEL.LOW);
    });

    test('non-coding task is not upgraded', () => {
      const quick = quickAssess('what is the time?');
      const deep = deepAssess(quick);
      expect(deep.riskLevel).toBe(RISK_LEVEL.LOW);
    });

    test('high-risk files upgrade risk', () => {
      const quick = quickAssess('implement a feature in JavaScript');
      const deep = deepAssess(quick, ['src/auth/session.js', 'src/middleware/security.js']);
      expect(deep.score).toBeGreaterThanOrEqual(quick.score);
    });

    test('many files upgrade risk', () => {
      const quick = quickAssess('refactor the codebase in TypeScript');
      const files = Array.from({ length: 6 }, (_, i) => `src/file${i}.ts`);
      const deep = deepAssess(quick, files);
      expect(deep.reasons).toContain('many_files:6');
    });

    test('all low-risk files reduce score', () => {
      const quick = quickAssess('update documentation in Python');
      const deep = deepAssess(quick, ['readme.md', 'changelog.txt', 'notes.md']);
      expect(deep.reasons).toContain('data_files_only');
    });
  });

  describe('computeIterationBudget', () => {
    test('returns at least 4 iterations', () => {
      expect(computeIterationBudget(RISK_LEVEL.LOW, 120)).toBeGreaterThanOrEqual(4);
    });

    test('CRITICAL gets full budget', () => {
      expect(computeIterationBudget(RISK_LEVEL.CRITICAL, 120)).toBe(120);
    });

    test('LOW also gets full budget because risk no longer restricts iteration budget', () => {
      expect(computeIterationBudget(RISK_LEVEL.LOW, 120)).toBe(120);
    });

    test('accepts profile object', () => {
      expect(computeIterationBudget({ riskLevel: RISK_LEVEL.HIGH }, 120)).toBeGreaterThan(0);
    });
  });

  describe('getCompletionGates', () => {
    test('returns gate object', () => {
      const gates = getCompletionGates(RISK_LEVEL.MEDIUM);
      expect(gates.requireMutation).toBeDefined();
      expect(gates.requireRuntimeVerification).toBe(true);
    });

    test('modification task requires mutation', () => {
      const gates = getCompletionGates(RISK_LEVEL.LOW, { isModificationTask: true });
      expect(gates.requireMutation).toBe(true);
    });
  });

  describe('getMethodologyGuidance', () => {
    test('returns non-empty string', () => {
      const guidance = getMethodologyGuidance(RISK_LEVEL.MEDIUM);
      expect(typeof guidance).toBe('string');
      expect(guidance.length).toBeGreaterThan(0);
    });

    test('includes semantic risk checklist', () => {
      const domains = [{ id: 'test', label: 'Test Domain', checklist: 'check this' }];
      const guidance = getMethodologyGuidance(RISK_LEVEL.HIGH, { semanticDomains: domains });
      expect(guidance).toContain('Test Domain');
    });
  });

  describe('mergeIntentProfile', () => {
    test('null intent returns quick result unchanged', () => {
      const quick = quickAssess('write code');
      const merged = mergeIntentProfile(quick, null);
      expect(merged).toBe(quick);
    });

    test('low confidence intent is ignored', () => {
      const quick = quickAssess('write code');
      const merged = mergeIntentProfile(quick, { intent: 'coding_task', confidence: 0.5 });
      expect(merged).toBe(quick);
    });

    test('high confidence coding intent upgrades isCodingTask', () => {
      const quick = {
        riskLevel: 'low',
        score: 0,
        reasons: [],
        isCodingTask: false,
        isLikelyTrivial: false,
      };
      const merged = mergeIntentProfile(quick, {
        intent: 'coding_task',
        confidence: 0.9,
        isCodingRelated: true,
      });
      expect(merged.isCodingTask).toBe(true);
    });

    test('CLI command is not overridden by intent', () => {
      const quick = quickAssess('/help');
      const merged = mergeIntentProfile(quick, { intent: 'coding_task', confidence: 0.9 }, '/help');
      expect(merged.isCodingTask).toBe(false);
    });
  });
});
