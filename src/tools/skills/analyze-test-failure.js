import { ToolCategory } from '../../core/types/index.js';

function strings(values) {
  return Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
}

export default function createAnalyzeTestFailureTool() {
  return {
    name: 'analyze_test_failure',
    description:
      'Create the structured diagnostic artifact required after reproducing a failing test and before proposing or applying a fix. Separate observed facts from hypotheses, record the primary error and location, and identify downstream failures hidden by the first error.',
    category: ToolCategory.skill_engineering,
    params: {
      command: { type: 'string', description: 'Exact command that reproduced the failure.' },
      primary_error: {
        type: 'string',
        description: 'Primary observed error, without speculation.',
      },
      failure_location: {
        type: 'string',
        description: 'Best available file, symbol, or stack location.',
      },
      observed_facts: {
        type: 'array',
        description: 'Facts directly supported by code or command output.',
      },
      hypotheses: {
        type: 'array',
        description:
          'Objects with cause, evidence (non-empty array), and confidence (low/medium/high).',
      },
      downstream_risks: {
        type: 'array',
        description: 'Likely later failures currently masked by the primary failure.',
      },
    },
    required: [
      'command',
      'primary_error',
      'failure_location',
      'observed_facts',
      'hypotheses',
      'downstream_risks',
    ],
    handler: async (args) => {
      const errors = [];
      const command = String(args.command || '').trim();
      const primaryError = String(args.primary_error || '').trim();
      const failureLocation = String(args.failure_location || '').trim();
      const observedFacts = strings(args.observed_facts);
      const downstreamRisks = strings(args.downstream_risks);
      const hypotheses = Array.isArray(args.hypotheses)
        ? args.hypotheses
            .map((entry) => ({
              cause: String(entry?.cause || '').trim(),
              evidence: strings(entry?.evidence),
              confidence: String(entry?.confidence || '')
                .trim()
                .toLowerCase(),
            }))
            .filter((entry) => entry.cause)
        : [];
      if (!command) errors.push('command is required.');
      if (!primaryError) errors.push('primary_error is required.');
      if (!failureLocation) errors.push('failure_location is required.');
      if (observedFacts.length === 0) errors.push('observed_facts must contain direct evidence.');
      if (hypotheses.length === 0) errors.push('hypotheses must contain at least one hypothesis.');
      if (
        hypotheses.some(
          (entry) =>
            entry.evidence.length === 0 || !['low', 'medium', 'high'].includes(entry.confidence),
        )
      ) {
        errors.push('every hypothesis requires evidence and low/medium/high confidence.');
      }
      if (errors.length)
        return { ok: false, error: `analyze_test_failure rejected: ${errors.join(' ')}` };
      return {
        ok: true,
        analysis: {
          command,
          primaryError,
          failureLocation,
          observedFacts,
          hypotheses,
          downstreamRisks,
          analyzedAt: Date.now(),
        },
      };
    },
  };
}
