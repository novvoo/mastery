import { ToolCategory } from '../../core/types/index.js';

/**
 * grill - Deep alignment before coding, expose assumptions.
 * Generates an alignment document that surfaces explicit and implicit
 * assumptions, boundary conditions, and acceptance criteria.
 */
export default function grill() {
  return {
    name: 'grill',
    description:
      'Deep alignment tool invoked before coding to expose assumptions, boundary conditions, and acceptance criteria. Surfaces both explicit and implicit assumptions with risk ratings to prevent misalignment.',
    category: ToolCategory.skill_engineering,
    params: {
      task: {
        type: 'string',
        description: 'The task or feature to be implemented',
      },
      assumptions: {
        type: 'string',
        description: 'Comma-separated list of known assumptions about the task',
      },
    },
    required: ['task'],
    handler: async (params, ctx) => {
      const { task, assumptions = '' } = params;

      const explicitAssumptions = assumptions
        ? assumptions
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : [];

      const implicitAssumptions = inferImplicitAssumptions(task, explicitAssumptions);

      const allAssumptions = [
        ...explicitAssumptions.map((text) => ({
          source: 'Explicit',
          text,
          riskRating: rateAssumptionRisk(text),
        })),
        ...implicitAssumptions,
      ];

      const boundaryConditions = generateBoundaryConditions(task);

      const acceptanceCriteria = generateAcceptanceCriteria(task, allAssumptions);

      const questions = generateQuestions(task, allAssumptions, boundaryConditions);

      return formatAlignmentDocument(
        task,
        allAssumptions,
        boundaryConditions,
        acceptanceCriteria,
        questions,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferImplicitAssumptions(task, explicitList) {
  const implicit = [];
  const taskLower = task.toLowerCase();

  // Infer common implicit assumptions based on task keywords
  if (taskLower.includes('api') || taskLower.includes('endpoint') || taskLower.includes('route')) {
    implicit.push({
      source: 'Implicit',
      text: 'The API will follow RESTful conventions unless otherwise specified',
      riskRating: 'Medium',
    });
    implicit.push({
      source: 'Implicit',
      text: 'Input validation and error handling are expected on all endpoints',
      riskRating: 'High',
    });
  }

  if (taskLower.includes('database') || taskLower.includes('data') || taskLower.includes('store')) {
    implicit.push({
      source: 'Implicit',
      text: 'Data persistence is expected to be reliable (no data loss on restart)',
      riskRating: 'High',
    });
    implicit.push({
      source: 'Implicit',
      text: 'Database schema migrations will be handled as part of deployment',
      riskRating: 'Medium',
    });
  }

  if (taskLower.includes('user') || taskLower.includes('auth') || taskLower.includes('login')) {
    implicit.push({
      source: 'Implicit',
      text: 'User input is untrusted and must be sanitized',
      riskRating: 'High',
    });
    implicit.push({
      source: 'Implicit',
      text: 'Authentication state persists across sessions',
      riskRating: 'Medium',
    });
  }

  if (taskLower.includes('test') || taskLower.includes('spec')) {
    implicit.push({
      source: 'Implicit',
      text: 'Tests should be deterministic and repeatable',
      riskRating: 'Medium',
    });
  }

  // General implicit assumptions
  implicit.push({
    source: 'Implicit',
    text: 'The existing codebase conventions and patterns should be followed',
    riskRating: 'Medium',
  });

  implicit.push({
    source: 'Implicit',
    text: 'Changes should not break existing functionality (backward compatibility)',
    riskRating: 'High',
  });

  implicit.push({
    source: 'Implicit',
    text: 'Error messages should be informative to developers (and end-users where applicable)',
    riskRating: 'Low',
  });

  // Filter out any that overlap with explicit assumptions
  return implicit.filter(
    (ia) => !explicitList.some((ea) => ea.toLowerCase() === ia.text.toLowerCase()),
  );
}

function rateAssumptionRisk(text) {
  const textLower = text.toLowerCase();
  const highRiskKeywords = [
    'security',
    'data loss',
    'breaking',
    'untrusted',
    'reliable',
    'persistence',
  ];
  const mediumRiskKeywords = ['performance', 'compatibility', 'convention', 'migration', 'session'];

  if (highRiskKeywords.some((kw) => textLower.includes(kw))) {
    return 'High';
  }
  if (mediumRiskKeywords.some((kw) => textLower.includes(kw))) {
    return 'Medium';
  }
  return 'Low';
}

function generateBoundaryConditions(task) {
  const taskLower = task.toLowerCase();
  const conditions = [];

  conditions.push({
    category: 'Input',
    condition: 'Empty or null input handling',
    question: 'What should happen when the input is empty, null, or undefined?',
  });

  conditions.push({
    category: 'Input',
    condition: 'Malformed or unexpected input types',
    question: 'How should the system handle input that does not match expected types or formats?',
  });

  if (
    taskLower.includes('list') ||
    taskLower.includes('array') ||
    taskLower.includes('collection')
  ) {
    conditions.push({
      category: 'Scale',
      condition: 'Empty collection',
      question: 'What is the expected behavior when operating on an empty collection?',
    });
    conditions.push({
      category: 'Scale',
      condition: 'Very large collection',
      question: 'Is there an upper bound on collection size? What happens at the limit?',
    });
  }

  conditions.push({
    category: 'Concurrency',
    condition: 'Concurrent access',
    question: 'What happens if multiple operations occur simultaneously on the same resource?',
  });

  conditions.push({
    category: 'Error',
    condition: 'Downstream dependency failure',
    question:
      'How should the system behave if an external dependency (API, database, service) is unavailable?',
  });

  conditions.push({
    category: 'Edge Case',
    condition: 'Unicode and special characters',
    question: 'Have unicode, emoji, and special characters been considered in string handling?',
  });

  return conditions;
}

function generateAcceptanceCriteria(task, assumptions) {
  const criteria = [];

  criteria.push({
    id: 'AC-1',
    criterion: `The implementation satisfies the core requirement: "${task}"`,
    verification: 'Functional test demonstrating the primary use case',
  });

  criteria.push({
    id: 'AC-2',
    criterion: 'All High-risk assumptions are validated through tests or documentation',
    verification: 'Review high-risk assumptions in the alignment section above',
  });

  criteria.push({
    id: 'AC-3',
    criterion: 'Boundary conditions are handled explicitly (no silent failures)',
    verification: 'Edge case tests for each boundary condition identified',
  });

  criteria.push({
    id: 'AC-4',
    criterion: 'Error states produce clear, actionable error messages',
    verification: 'Test error paths and verify message quality',
  });

  criteria.push({
    id: 'AC-5',
    criterion: 'Existing tests continue to pass (no regressions)',
    verification: 'Run full test suite after implementation',
  });

  criteria.push({
    id: 'AC-6',
    criterion: 'Code follows existing project conventions and patterns',
    verification: 'Code review using the review tool',
  });

  return criteria;
}

function generateQuestions(task, assumptions, boundaries) {
  const questions = [];

  const highRiskAssumptions = assumptions.filter((a) => a.riskRating === 'High');
  if (highRiskAssumptions.length > 0) {
    questions.push({
      id: 'Q-1',
      question: `The following High-risk assumptions need explicit confirmation. Can you verify each one?`,
      items: highRiskAssumptions.map((a) => `- [ ] ${a.text} (${a.source})`),
    });
  }

  questions.push({
    id: 'Q-2',
    question:
      'Are there any stakeholders or downstream consumers of this change who should be notified?',
    items: ['- [ ] No downstream impact', '- [ ] Yes (specify who)'],
  });

  questions.push({
    id: 'Q-3',
    question: 'Is there a rollback plan if the implementation causes unexpected issues?',
    items: [
      '- [ ] Yes, rollback plan documented',
      '- [ ] No rollback needed (greenfield)',
      '- [ ] Need to define rollback plan',
    ],
  });

  questions.push({
    id: 'Q-4',
    question:
      'Are there any non-functional requirements (performance, accessibility, i18n) that apply?',
    items: ['- [ ] No NFRs beyond basic functionality', '- [ ] Yes (specify requirements)'],
  });

  return questions;
}

function formatAlignmentDocument(task, assumptions, boundaries, criteria, questions) {
  const lines = [
    '# Alignment Document',
    '',
    '> **PURPOSE**: Deep alignment before coding. Every assumption must be surfaced and validated.',
    '',
    '---',
    '',
    '## 1. Task Goal Confirmation',
    '',
    `**Task**: ${task}`,
    '',
    '> Confirm: Is this description accurate and complete? If not, clarify before proceeding.',
    '',
    '---',
    '',
    '## 2. Assumption Register',
    '',
    '| # | Source | Assumption | Risk Rating |',
    '|---|--------|------------|-------------|',
  ];

  assumptions.forEach((a, i) => {
    const badge =
      a.riskRating === 'High'
        ? ':red_circle:'
        : a.riskRating === 'Medium'
          ? ':yellow_circle:'
          : ':green_circle:';
    lines.push(`| ${i + 1} | ${a.source} | ${a.text} | ${badge} **${a.riskRating}** |`);
  });

  lines.push(
    '',
    '---',
    '',
    '## 3. Boundary Conditions',
    '',
    '| Category | Condition | Open Question |',
    '|----------|-----------|---------------|',
  );

  boundaries.forEach((b) => {
    lines.push(`| ${b.category} | ${b.condition} | ${b.question} |`);
  });

  lines.push('', '---', '', '## 4. Acceptance Criteria', '');

  criteria.forEach((c) => {
    lines.push(`### ${c.id}: ${c.criterion}`);
    lines.push(`- **Verification**: ${c.verification}`);
    lines.push('');
  });

  lines.push('---', '', '## 5. Questions for User', '');

  questions.forEach((q) => {
    lines.push(`### ${q.id}: ${q.question}`);
    q.items.forEach((item) => {
      lines.push(item);
    });
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '> **Next Steps**: Resolve all High-risk assumptions and answer open questions, then proceed with implementation using the tdd tool.',
    '',
  );

  return lines.join('\n');
}
