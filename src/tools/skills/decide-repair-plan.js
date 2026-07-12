import { ToolCategory } from '../../core/types/index.js';

function strings(values) {
  return Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [];
}

export default function createDecideRepairPlanTool() {
  return {
    name: 'decide_repair_plan',
    description:
      'Record the evidence-based repair decision after analyze_test_failure and before any code mutation. State root causes, selected approach, rejected alternatives, concrete changes, verification paths, and explicit scope exclusions.',
    category: ToolCategory.skill_engineering,
    params: {
      root_causes: { type: 'array', description: 'Root causes supported by the failure analysis.' },
      selected_approach: { type: 'string', description: 'Smallest complete repair approach.' },
      alternatives: {
        type: 'array',
        description: 'Rejected alternatives as objects with name and rejected_because.',
      },
      changes: {
        type: 'array',
        description: 'Planned changes as objects with target and behavior.',
      },
      verification: {
        type: 'array',
        description: 'Commands or behavior-level checks proving the repair.',
      },
      scope_exclusions: {
        type: 'array',
        description: 'Explicitly excluded adjacent work; may be empty.',
      },
    },
    required: [
      'root_causes',
      'selected_approach',
      'alternatives',
      'changes',
      'verification',
      'scope_exclusions',
    ],
    handler: async (args) => {
      const errors = [];
      const rootCauses = strings(args.root_causes);
      const selectedApproach = String(args.selected_approach || '').trim();
      const alternatives = Array.isArray(args.alternatives)
        ? args.alternatives
            .map((entry) => ({
              name: String(entry?.name || '').trim(),
              rejectedBecause: String(entry?.rejected_because || '').trim(),
            }))
            .filter((entry) => entry.name && entry.rejectedBecause)
        : [];
      const changes = Array.isArray(args.changes)
        ? args.changes
            .map((entry) => ({
              target: String(entry?.target || '').trim(),
              behavior: String(entry?.behavior || '').trim(),
            }))
            .filter((entry) => entry.target && entry.behavior)
        : [];
      const verification = strings(args.verification);
      const scopeExclusions = strings(args.scope_exclusions);
      if (rootCauses.length === 0) errors.push('root_causes must not be empty.');
      if (selectedApproach.length < 12)
        errors.push('selected_approach must describe a concrete repair.');
      if (changes.length === 0)
        errors.push('changes must include at least one target and behavior.');
      if (verification.length === 0)
        errors.push('verification must include at least one proof path.');
      if (!Array.isArray(args.alternatives)) errors.push('alternatives must be an array.');
      if (!Array.isArray(args.scope_exclusions)) errors.push('scope_exclusions must be an array.');
      if (errors.length)
        return { ok: false, error: `decide_repair_plan rejected: ${errors.join(' ')}` };
      return {
        ok: true,
        decision: {
          rootCauses,
          selectedApproach,
          alternatives,
          changes,
          verification,
          scopeExclusions,
          decidedAt: Date.now(),
        },
      };
    },
  };
}
