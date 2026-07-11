import { ToolCategory } from '../../core/types/index.js';

export default function createResolveTestContractTool() {
  return {
    name: 'resolve_test_contract',
    description:
      'Record an explicit decision when project sources disagree about the authoritative test runner. Use before code mutation. Provide all discovered runners, select one authoritative runner, explain the evidence, and list conflicting documentation/configuration files that must be synchronized. This is a structured decision artifact, not a test execution.',
    category: ToolCategory.skill_engineering,
    params: {
      declared_runners: {
        type: 'array',
        description: 'All conflicting runners discovered in package, project docs, ADRs, or CI.',
      },
      authoritative_runner: {
        type: 'string',
        description: 'Selected authoritative runner, for example "bun" or "npm".',
      },
      rationale: {
        type: 'string',
        description:
          'Concrete evidence supporting the decision. Do not infer from method names alone.',
      },
      sync_targets: {
        type: 'array',
        description: 'Conflicting project files that must be updated, or an empty array if none.',
      },
    },
    required: ['declared_runners', 'authoritative_runner', 'rationale', 'sync_targets'],
    handler: async ({ declared_runners, authoritative_runner, rationale, sync_targets }) => {
      const runners = Array.isArray(declared_runners)
        ? [
            ...new Set(
              declared_runners.map((value) => String(value).trim().toLowerCase()).filter(Boolean),
            ),
          ]
        : [];
      const selected = String(authoritative_runner || '')
        .trim()
        .toLowerCase();
      const targets = Array.isArray(sync_targets)
        ? [...new Set(sync_targets.map((value) => String(value).trim()).filter(Boolean))]
        : null;
      const errors = [];
      if (runners.length < 2) errors.push('declared_runners must contain at least two runners.');
      if (!selected || !runners.includes(selected)) {
        errors.push('authoritative_runner must be one of declared_runners.');
      }
      if (typeof rationale !== 'string' || rationale.trim().length < 12) {
        errors.push('rationale must contain concrete evidence (at least 12 characters).');
      }
      if (!targets) errors.push('sync_targets must be an array.');
      if (errors.length) {
        return { ok: false, error: `resolve_test_contract rejected: ${errors.join(' ')}` };
      }
      return {
        ok: true,
        decision: {
          declaredRunners: runners,
          authoritativeRunner: selected,
          rationale: rationale.trim(),
          syncTargets: targets,
          decidedAt: Date.now(),
        },
      };
    },
  };
}
