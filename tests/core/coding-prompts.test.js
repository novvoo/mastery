import { describe, test, expect } from 'bun:test';
import {
  buildSemanticRiskGuidance,
  buildCodingTaskOperatingPrompt,
  buildCodingCompletionGatePrompt,
} from '../../src/core/prompts/coding-prompts.js';

describe('coding-prompts', () => {
  describe('buildSemanticRiskGuidance', () => {
    test('returns empty string when domains is empty array', () => {
      expect(buildSemanticRiskGuidance([])).toBe('');
    });

    test('returns empty string when domains is undefined', () => {
      expect(buildSemanticRiskGuidance()).toBe('');
    });

    test('returns guidance string with single domain', () => {
      const domains = [{ label: 'units/time', checklist: 'verify timing behavior' }];
      const result = buildSemanticRiskGuidance(domains);
      expect(result).toContain('Semantic/API risk review is required');
      expect(result).toContain('- units/time: verify timing behavior');
    });

    test('returns guidance string with multiple domains', () => {
      const domains = [
        { label: 'API semantics', checklist: 'confirm parameter meanings' },
        { label: 'state transitions', checklist: 'verify state invariants' },
      ];
      const result = buildSemanticRiskGuidance(domains);
      expect(result).toContain('- API semantics: confirm parameter meanings');
      expect(result).toContain('- state transitions: verify state invariants');
    });

    test('does not force a ceremonial review call', () => {
      const domains = [{ label: 'test', checklist: 'check' }];
      const result = buildSemanticRiskGuidance(domains);
      expect(result).toContain('Use review only when it adds real semantic evidence');
      expect(result).not.toContain('CALL review');
    });

    test('includes risk domains section', () => {
      const domains = [{ label: 'security', checklist: 'validate boundaries' }];
      const result = buildSemanticRiskGuidance(domains);
      expect(result).toContain('Risk domains:');
    });
  });

  describe('buildCodingTaskOperatingPrompt', () => {
    test('returns non-empty string with userInput', () => {
      const result = buildCodingTaskOperatingPrompt({ userInput: 'fix the bug' });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('includes user input in prompt', () => {
      const result = buildCodingTaskOperatingPrompt({ userInput: 'implement auth module' });
      expect(result).toContain('implement auth module');
    });

    test('uses profile risk level', () => {
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'test',
        profile: { riskLevel: 'high' },
      });
      expect(result).toContain('high');
    });

    test('defaults to medium risk level when profile is empty', () => {
      const result = buildCodingTaskOperatingPrompt({ userInput: 'test', profile: {} });
      expect(result).toContain('medium');
    });

    test('directs managed dependency changes through ecosystem commands when available', () => {
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'add eslint config and install vite',
      });

      expect(result).toContain('prefer the ecosystem tool over hand-editing when a command exists');
      expect(result).toContain(
        'use the detected package manager (npm/pnpm/yarn/bun) to add/remove dependencies',
      );
      expect(result).toContain(
        'instead of manually editing package.json, package-lock.json, ' +
          'pnpm-lock.yaml, yarn.lock, or bun.lock',
      );
    });

    test('requires install or sync command after manual manifest edits', () => {
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'manually update package.json and cargo manifest',
      });

      expect(result).toContain(
        'If you must edit a managed config/manifest directly, run the corresponding ' +
          'apply/sync command before verification or completion',
      );
      expect(result).toContain(
        'npm install, pnpm install, yarn install, bun install, go mod tidy, cargo update',
      );
      expect(result).toContain(
        'Do not claim the config change is active until that command succeeds',
      );
    });

    test('includes selective methodology guidance when hasMethodologyTools is true', () => {
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'test',
        hasMethodologyTools: true,
      });
      expect(result).toContain('Use methodology tools selectively');
      expect(result).not.toContain('All coding tasks follow the same methodology flow');
    });

    test('includes fallback methodology line when hasMethodologyTools is false', () => {
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'test',
        hasMethodologyTools: false,
      });
      expect(result).toContain('Methodology tools are not registered');
    });

    test('includes semantic risk guidance when profile requires it', () => {
      const guidance = 'Custom semantic risk guidance text';
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'test',
        profile: { requiresSemanticRiskReview: true },
        semanticRiskGuidance: guidance,
      });
      expect(result).toContain(guidance);
    });

    test('omits semantic risk guidance when profile does not require it', () => {
      const guidance = 'Should not appear';
      const result = buildCodingTaskOperatingPrompt({
        userInput: 'test',
        profile: { requiresSemanticRiskReview: false },
        semanticRiskGuidance: guidance,
      });
      expect(result).not.toContain(guidance);
    });

    test('includes verification rules section', () => {
      const result = buildCodingTaskOperatingPrompt({ userInput: 'test' });
      expect(result).toContain('Verification expectations');
      expect(result).toContain('runtime verification');
    });
  });

  describe('buildCodingCompletionGatePrompt', () => {
    test('includes user input', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'fix the login bug',
        gate: { reason: 'no_tool_evidence', evidence: [] },
      });
      expect(result).toContain('fix the login bug');
    });

    test('maps no_tool_evidence reason to Chinese/English text', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'no_tool_evidence', evidence: [] },
      });
      expect(result).toContain('without any successful tool evidence');
    });

    test('maps missing_methodology_step to evidence language', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'missing_methodology_step', evidence: [] },
      });
      expect(result).toContain('missing enough planning, review, or verification evidence');
      expect(result).not.toContain('built-in coding methodology');
    });

    test('maps missing_code_change reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'missing_code_change', evidence: [] },
      });
      expect(result).toContain('successful code/file change');
    });

    test('maps missing_verification reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'missing_verification', evidence: [] },
      });
      expect(result).toContain('not verified the result');
    });

    test('maps verification before latest mutation reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'no_runtime_verification_after_last_mutation', evidence: [] },
      });
      expect(result).toContain('not after it');
    });

    test('maps managed_config_sync_missing reason to actionable package-manager guidance', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'update package.json dependency',
        gate: { reason: 'managed_config_sync_missing', evidence: [] },
      });

      expect(result).toContain('managed_config_sync_missing');
      expect(result).toContain('npm install');
      expect(result).toContain('pnpm install');
      expect(result).toContain('bun install');
      expect(result.toLowerCase()).toContain('run');
    });

    test('maps missing_semantic_risk_review reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'missing_semantic_risk_review', evidence: [] },
      });
      expect(result).toContain('high-risk behavior semantics');
    });

    test('maps final_answer_missing_verification_summary reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'final_answer_missing_verification_summary', evidence: [] },
      });
      expect(result).toContain('does not summarize verification');
    });

    test('maps automatic_plan_incomplete reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'automatic_plan_incomplete', evidence: [] },
      });
      expect(result).toContain('automatic task orchestration plan');
    });

    test('falls back to raw reason for unknown gate reason', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'custom_unknown_reason', evidence: [] },
      });
      expect(result).toContain('custom_unknown_reason');
    });

    test('includes stringified evidence', () => {
      const evidence = [{ type: 'tool_call', name: 'read_file' }];
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'no_tool_evidence', evidence },
      });
      expect(result).toContain(JSON.stringify(evidence));
    });

    test('includes semantic risk guidance when requiresSemanticRiskReview is true', () => {
      const guidance = 'Review API semantics before completing';
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'no_tool_evidence', evidence: [] },
        requiresSemanticRiskReview: true,
        semanticRiskGuidance: guidance,
      });
      expect(result).toContain(guidance);
    });

    test('omits semantic risk guidance when requiresSemanticRiskReview is false', () => {
      const guidance = 'Should not appear';
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'no_tool_evidence', evidence: [] },
        requiresSemanticRiskReview: false,
        semanticRiskGuidance: guidance,
      });
      expect(result).not.toContain(guidance);
    });

    test('includes continue working instruction', () => {
      const result = buildCodingCompletionGatePrompt({
        userInput: 'test',
        gate: { reason: 'no_tool_evidence', evidence: [] },
      });
      expect(result).toContain('Continue working now');
      expect(result).toContain('Choose the next evidence-producing step');
      expect(result).not.toContain('call write_file or edit_file next');
    });
  });
});
