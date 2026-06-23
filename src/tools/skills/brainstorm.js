import { ToolCategory } from '../../core/types.js';

/**
 * brainstorm - HARD-GATE design exploration before coding.
 * Generates a structured design document with candidate approaches,
 * risks, and decision points requiring user confirmation.
 */
export default function brainstorm() {
  return {
    name: 'brainstorm',
    description:
      'HARD-GATE design exploration tool. Must be invoked before coding to generate a structured design document with candidate approaches, pros/cons, risks, and decision points. Updates memory with the design decision.',
    category: ToolCategory.skill_engineering,
    params: {
      problem: {
        type: 'string',
        description: 'The problem statement or feature requirement to explore',
      },
      constraints: {
        type: 'string',
        description:
          'Known constraints such as performance targets, tech stack limits, timeline, or compatibility requirements',
      },
      approach: {
        type: 'string',
        description:
          'Preferred or initial approach direction, if any (leave empty for open exploration)',
      },
    },
    required: ['problem'],
    handler: async (params, ctx) => {
      const { problem, constraints = '', approach = '' } = params;
      const { memoryManager } = ctx;

      const constraintsList = constraints
        ? constraints
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : [];

      const approaches = generateApproaches(problem, constraintsList, approach);

      const recommendation = selectRecommendation(approaches);

      const risks = generateRisks(approaches, constraintsList);

      const decisionPoints = generateDecisionPoints(approaches, recommendation);

      // Store design decision in memory
      if (memoryManager) {
        await memoryManager.addDecision(
          `Design: ${problem}`,
          `Recommended: ${recommendation.name}. Approaches considered: ${approaches.map((a) => a.name).join(', ')}`,
        );
      }

      return formatDesignDocument(
        problem,
        constraintsList,
        approaches,
        recommendation,
        risks,
        decisionPoints,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateApproaches(problem, constraints, preferred) {
  const candidates = [
    {
      name: 'Approach A: Straightforward Implementation',
      description: `Direct implementation addressing "${problem}" with minimal abstraction.`,
      pros: [
        'Simple to understand and maintain',
        'Fastest path to a working solution',
        'Low cognitive overhead for future contributors',
      ],
      cons: [
        'May not scale well under evolving requirements',
        'Limited flexibility for future extensions',
        'Potential for duplicated logic if requirements expand',
      ],
      fit: preferred
        ? preferred.toLowerCase().includes('simple') || preferred.toLowerCase().includes('direct')
          ? 'HIGH'
          : 'MEDIUM'
        : 'MEDIUM',
    },
    {
      name: 'Approach B: Modular / Plugin Architecture',
      description: `Decompose "${problem}" into well-defined modules with clear interfaces and extension points.`,
      pros: [
        'High extensibility and composability',
        'Easier to test individual components in isolation',
        'Supports incremental feature additions',
      ],
      cons: [
        'Higher initial development cost',
        'More indirection to navigate during debugging',
        'Risk of over-engineering if requirements stay simple',
      ],
      fit: preferred
        ? preferred.toLowerCase().includes('modular') || preferred.toLowerCase().includes('plugin')
          ? 'HIGH'
          : 'MEDIUM'
        : 'MEDIUM',
    },
    {
      name: 'Approach C: Convention-Based / Config-Driven',
      description: `Solve "${problem}" through conventions and configuration, reducing code duplication.`,
      pros: [
        'Reduces boilerplate for repetitive patterns',
        'New cases can often be added via config only',
        'Consistent behavior across similar scenarios',
      ],
      cons: [
        'Debugging can be harder when behavior is config-driven',
        'Learning curve for understanding conventions',
        'May require a migration path if conventions change',
      ],
      fit: preferred
        ? preferred.toLowerCase().includes('config') ||
          preferred.toLowerCase().includes('convention')
          ? 'HIGH'
          : 'LOW'
        : 'LOW',
    },
  ];

  // Adjust fit based on constraints
  if (constraints.some((c) => c.toLowerCase().includes('performance'))) {
    candidates[0].fit = 'HIGH';
    candidates[1].cons.push('Additional abstraction layers may impact performance');
  }
  if (
    constraints.some(
      (c) => c.toLowerCase().includes('extensib') || c.toLowerCase().includes('scalab'),
    )
  ) {
    candidates[1].fit = 'HIGH';
  }
  if (
    constraints.some(
      (c) => c.toLowerCase().includes('timeline') || c.toLowerCase().includes('fast'),
    )
  ) {
    candidates[0].fit = 'HIGH';
  }

  return candidates;
}

function selectRecommendation(approaches) {
  const sorted = [...approaches].sort((a, b) => {
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return (rank[b.fit] || 0) - (rank[a.fit] || 0);
  });
  const best = sorted[0];
  return {
    name: best.name,
    reasoning: `Selected based on constraint fit rating (${best.fit}). This approach offers the best balance of implementation speed, maintainability, and alignment with stated constraints. If constraints change, revisit this decision using the brainstorm tool.`,
  };
}

function generateRisks(approaches, constraints) {
  const risks = [
    {
      description: 'Requirements ambiguity leading to rework',
      probability: 'Medium',
      impact: 'High',
      mitigation: 'Validate assumptions with the grill tool before proceeding to implementation.',
    },
    {
      description: 'Scope creep expanding beyond initial design',
      probability: 'Medium',
      impact: 'Medium',
      mitigation:
        'Define clear acceptance criteria using the verify tool. Re-run brainstorm if scope changes significantly.',
    },
    {
      description: 'Integration issues with existing codebase',
      probability: 'Low-Medium',
      impact: 'High',
      mitigation: 'Use the zoom_out tool to understand system-level context before making changes.',
    },
  ];

  if (constraints.some((c) => c.toLowerCase().includes('performance'))) {
    risks.push({
      description: 'Performance regression under load',
      probability: 'Medium',
      impact: 'High',
      mitigation:
        'Establish performance benchmarks before and after implementation. Use the verify tool with measurable criteria.',
    });
  }

  return risks;
}

function generateDecisionPoints(approaches, recommendation) {
  return [
    {
      id: 'DP-1',
      question: `Do you agree with the recommended approach: "${recommendation.name}"?`,
      options: ['Yes, proceed', 'No, choose a different approach', 'Need more information'],
    },
    {
      id: 'DP-2',
      question:
        'Are the identified risks acceptable, or do additional mitigations need to be put in place?',
      options: ['Risks are acceptable', 'Add more mitigations', 'Re-evaluate approach'],
    },
    {
      id: 'DP-3',
      question:
        'Should any additional constraints or requirements be considered before implementation begins?',
      options: ['No, proceed as designed', 'Yes, add constraints (specify in follow-up)'],
    },
  ];
}

function formatDesignDocument(
  problem,
  constraints,
  approaches,
  recommendation,
  risks,
  decisionPoints,
) {
  const lines = [
    '# Design Exploration Document',
    '',
    '> **HARD-GATE**: This design document must be reviewed and approved before any implementation begins.',
    '',
    '---',
    '',
    '## 1. Problem Analysis',
    '',
    `**Problem**: ${problem}`,
    '',
  ];

  if (constraints.length > 0) {
    lines.push('**Constraints**:');
    constraints.forEach((c) => {
      lines.push(`- ${c}`);
    });
    lines.push('');
  }

  lines.push('---', '', '## 2. Candidate Approaches', '');

  approaches.forEach((a, i) => {
    lines.push(`### ${a.name}`);
    lines.push('');
    lines.push(`**Fit Rating**: ${a.fit}`);
    lines.push('');
    lines.push(a.description);
    lines.push('');
    lines.push('| Pros | Cons |');
    lines.push('|------|------|');
    const maxLen = Math.max(a.pros.length, a.cons.length);
    for (let j = 0; j < maxLen; j++) {
      const pro = a.pros[j] || '';
      const con = a.cons[j] || '';
      lines.push(`| ${pro} | ${con} |`);
    }
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '## 3. Recommendation',
    '',
    `**Recommended**: ${recommendation.name}`,
    '',
    `**Reasoning**: ${recommendation.reasoning}`,
    '',
    '---',
    '',
    '## 4. Risks and Mitigations',
    '',
    '| Risk | Probability | Impact | Mitigation |',
    '|------|-------------|--------|------------|',
  );

  risks.forEach((r) => {
    lines.push(`| ${r.description} | ${r.probability} | ${r.impact} | ${r.mitigation} |`);
  });

  lines.push('', '---', '', '## 5. Decision Points (Require User Confirmation)', '');

  decisionPoints.forEach((dp) => {
    lines.push(`### ${dp.id}: ${dp.question}`);
    lines.push('');
    lines.push('Options:');
    dp.options.forEach((o) => {
      lines.push(`- [ ] ${o}`);
    });
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '> **Next Steps**: Confirm decision points above, then proceed with the grill tool for deep alignment before coding.',
    '',
  );

  return lines.join('\n');
}
