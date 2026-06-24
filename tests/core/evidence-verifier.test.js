import { describe, test, expect } from 'bun:test';
import {
  isMutationEvent,
  isRuntimeVerificationEvent,
  isMethodologyEvent,
  isSemanticRiskReviewEvent,
  summarizeEvidence,
  checkCompletionGates,
  crossCheckVerifyClaim,
  finalAnswerMentionsVerification,
} from '../../src/core/evidence-verifier.js';

describe('evidence-verifier', () => {
  describe('isMutationEvent', () => {
    test('write_file is a mutation', () => {
      expect(isMutationEvent({ name: 'write_file', success: true })).toBe(true);
    });

    test('edit_file is a mutation', () => {
      expect(isMutationEvent({ name: 'edit_file', success: true })).toBe(true);
    });

    test('failed mutation does not count', () => {
      expect(isMutationEvent({ name: 'write_file', success: false })).toBe(false);
    });

    test('read_file is not a mutation', () => {
      expect(isMutationEvent({ name: 'read_file', success: true })).toBe(false);
    });

    test('shell with write command is a mutation', () => {
      expect(
        isMutationEvent({ name: 'shell', args: { command: 'npm install' }, success: true }),
      ).toBe(true);
    });

    test('shell with read-only command is not a mutation', () => {
      expect(isMutationEvent({ name: 'shell', args: { command: 'ls -la' }, success: true })).toBe(
        false,
      );
    });

    test('null/undefined event is not a mutation', () => {
      expect(isMutationEvent(null)).toBe(false);
      expect(isMutationEvent(undefined)).toBe(false);
    });
  });

  describe('isRuntimeVerificationEvent', () => {
    test('verify tool is runtime verification', () => {
      expect(isRuntimeVerificationEvent({ name: 'verify', success: true })).toBe(true);
    });

    test('shell with test command is verification', () => {
      expect(
        isRuntimeVerificationEvent({ name: 'shell', args: { command: 'bun test' }, success: true }),
      ).toBe(true);
    });

    test('shell with build command is verification', () => {
      expect(
        isRuntimeVerificationEvent({
          name: 'shell',
          args: { command: 'npm run build' },
          success: true,
        }),
      ).toBe(true);
    });

    test('shell with lint command is verification', () => {
      expect(
        isRuntimeVerificationEvent({
          name: 'shell',
          args: { command: 'eslint src/' },
          success: true,
        }),
      ).toBe(true);
    });

    test('read_file is not verification', () => {
      expect(isRuntimeVerificationEvent({ name: 'read_file', success: true })).toBe(false);
    });

    test('failed event is not verification', () => {
      expect(isRuntimeVerificationEvent({ name: 'verify', success: false })).toBe(false);
    });
  });

  describe('isMethodologyEvent', () => {
    test('review is methodology', () => {
      expect(isMethodologyEvent({ name: 'review', success: true })).toBe(true);
    });

    test('brainstorm is methodology', () => {
      expect(isMethodologyEvent({ name: 'brainstorm', success: true })).toBe(true);
    });

    test('read_file is not methodology', () => {
      expect(isMethodologyEvent({ name: 'read_file', success: true })).toBe(false);
    });
  });

  describe('isSemanticRiskReviewEvent', () => {
    test('review without focus_areas counts', () => {
      expect(isSemanticRiskReviewEvent({ name: 'review', args: {}, success: true })).toBe(true);
    });

    test('review with semantic focus_areas counts', () => {
      expect(
        isSemanticRiskReviewEvent({
          name: 'review',
          args: { focus_areas: 'security' },
          success: true,
        }),
      ).toBe(true);
    });

    test('review with non-semantic focus_areas does not count', () => {
      expect(
        isSemanticRiskReviewEvent({
          name: 'review',
          args: { focus_areas: 'formatting' },
          success: true,
        }),
      ).toBe(false);
    });

    test('non-review tool is not semantic review', () => {
      expect(isSemanticRiskReviewEvent({ name: 'shell', success: true })).toBe(false);
    });
  });

  describe('summarizeEvidence', () => {
    test('summarizes tool events correctly', () => {
      const events = [
        { name: 'write_file', success: true },
        { name: 'shell', args: { command: 'bun test' }, success: true },
        { name: 'review', success: true },
      ];
      const summary = summarizeEvidence(events);
      expect(summary.hasMutation).toBe(true);
      expect(summary.hasRuntimeVerification).toBe(true);
      expect(summary.hasMethodologyTool).toBe(true);
    });

    test('empty events returns all false', () => {
      const summary = summarizeEvidence([]);
      expect(summary.hasMutation).toBe(false);
      expect(summary.hasRuntimeVerification).toBe(false);
    });
  });

  describe('checkCompletionGates', () => {
    test('blocks when mutation required but missing', () => {
      const result = checkCompletionGates(
        [{ name: 'read_file', success: true }],
        { requireMutation: true, requireRuntimeVerification: true },
        { isModificationTask: true },
      );
      expect(result.block).toBe(true);
      expect(result.missing).toContain('no_code_mutation');
    });

    test('blocks when verification missing after mutation', () => {
      const result = checkCompletionGates(
        [{ name: 'write_file', success: true }],
        { requireMutation: true, requireRuntimeVerification: true },
        { isModificationTask: true },
      );
      expect(result.block).toBe(true);
      expect(result.missing).toContain('no_runtime_verification');
    });

    test('passes when all gates satisfied', () => {
      const result = checkCompletionGates(
        [
          { name: 'write_file', success: true },
          { name: 'shell', args: { command: 'bun test' }, success: true },
          { name: 'review', success: true },
        ],
        {
          requireMutation: true,
          requireRuntimeVerification: true,
          requireMethodologyTool: true,
          requireSemanticRiskReview: true,
        },
        { isModificationTask: true },
      );
      expect(result.block).toBe(false);
    });
  });

  describe('crossCheckVerifyClaim', () => {
    test('warns when claim mentions tests but no verification event', () => {
      const result = crossCheckVerifyClaim('all tests pass', []);
      expect(result.isSelfConsistent).toBe(false);
      expect(result.warnings).toContain('claim_mentions_tests_but_no_runtime_verification_event');
    });

    test('warns when claim mentions mutation but no mutation event', () => {
      const result = crossCheckVerifyClaim('I modified the code', []);
      expect(result.isSelfConsistent).toBe(false);
      expect(result.warnings).toContain('claim_mentions_mutation_but_no_mutation_event');
    });

    test('passes when claim matches evidence', () => {
      const result = crossCheckVerifyClaim('all tests pass', [
        { name: 'shell', args: { command: 'bun test' }, success: true },
      ]);
      expect(result.isSelfConsistent).toBe(true);
    });
  });

  describe('finalAnswerMentionsVerification', () => {
    test('ok when no mutation needed', () => {
      expect(finalAnswerMentionsVerification('done', false).ok).toBe(true);
    });

    test('ok when verification is mentioned', () => {
      expect(finalAnswerMentionsVerification('tests pass', true).ok).toBe(true);
    });

    test('not ok when mutation exists but no verification mention', () => {
      expect(finalAnswerMentionsVerification('I wrote the code', true).ok).toBe(false);
    });
  });
});
