import { ToolCategory } from '../../core/types/index.js';

/**
 * auto_research - Metric-driven research loop planner.
 *
 * Inspired by Karpathy-style autoresearch: formulate hypotheses, run bounded
 * experiments, keep only evidence-backed improvements, and record what changed.
 */
export default function autoResearch() {
  return {
    name: 'auto_research',
    description:
      'Metric-driven research methodology for uncertain, open-ended engineering or information tasks. Builds a bounded research loop with hypotheses, retrieval/experiment actions, a single success metric, anti-gaming checks, rollback/ratchet rules, and a final report plan.',
    category: ToolCategory.skill_engineering,
    params: {
      question: {
        type: 'string',
        description: 'Research question, optimization goal, or uncertain decision to investigate.',
      },
      objective_metric: {
        type: 'string',
        description:
          'Primary measurable success metric, e.g. test pass rate, latency p95, benchmark score, coverage delta, answer confidence, source coverage.',
      },
      budget: {
        type: 'string',
        description:
          'Time, iteration, cost, or command budget. Example: "3 iterations", "30 minutes", "one narrow benchmark run".',
      },
      evidence_sources: {
        type: 'string',
        description:
          'Comma-separated source types available for the loop: code, tests, docs, web, logs, benchmark, user, database.',
      },
      constraints: {
        type: 'string',
        description:
          'Constraints and guardrails, such as no production writes, do not change benchmark, cite sources, no synthetic data, keep diff small.',
      },
    },
    required: ['question'],
    handler: async ({
      question,
      objective_metric = '',
      budget = '',
      evidence_sources = '',
      constraints = '',
    }) => {
      const sourceList = splitList(evidence_sources);
      const constraintList = splitList(constraints);
      const metric = inferMetric(question, objective_metric);
      const loopBudget = budget || inferBudget(question);
      const hypotheses = generateHypotheses(question, sourceList);
      const actions = generateActions(question, sourceList, metric);
      const guards = generateIntegrityGuards(metric, constraintList);

      return formatAutoResearchPlan({
        question,
        metric,
        budget: loopBudget,
        sourceList,
        constraintList,
        hypotheses,
        actions,
        guards,
      });
    },
  };
}

function splitList(value) {
  return String(value || '')
    .split(/\n|[,，;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferMetric(question, explicitMetric) {
  if (explicitMetric && explicitMetric.trim()) {
    return explicitMetric.trim();
  }

  const lower = String(question || '').toLowerCase();
  if (/performance|latency|slow|speed|fps|吞吐|延迟|性能|速度/.test(lower)) {
    return 'A real benchmark or runtime measurement improves without weakening the benchmark.';
  }
  if (/bug|failure|error|regression|失败|错误|回归|报错/.test(lower)) {
    return 'A targeted reproduction fails before the change and passes after the change.';
  }
  if (/coverage|test|测试|覆盖/.test(lower)) {
    return 'Meaningful test coverage or assertion coverage increases without trivial assertions.';
  }
  if (/research|compare|evaluate|recommend|调研|比较|推荐|评估/.test(lower)) {
    return 'Required facts are covered by independent sources and unresolved uncertainty is named.';
  }
  return 'A single user-relevant success metric is measured before and after each iteration.';
}

function inferBudget(question) {
  const lower = String(question || '').toLowerCase();
  if (/quick|small|简单|快速/.test(lower)) {
    return '1-2 focused iterations';
  }
  if (/overnight|long|batch|大规模|长期/.test(lower)) {
    return 'bounded background run with checkpointed reports';
  }
  return '3 bounded iterations or the narrowest useful verification cycle';
}

function generateHypotheses(question, sources) {
  const hasWeb = sources.some((s) => /web|paper|news|docs?/i.test(s));
  const hasCode = sources.some((s) => /code|repo|tests?|benchmark|logs?/i.test(s));
  const hypotheses = [
    `H1: The current best answer/change is constrained by missing evidence for "${question}".`,
    'H2: A smaller, measurable experiment can de-risk the next implementation or answer.',
  ];
  if (hasWeb) {
    hypotheses.push(
      'H3: Fresh external sources may change the recommendation or invalidate cached assumptions.',
    );
  }
  if (hasCode) {
    hypotheses.push(
      'H4: Existing tests, logs, or benchmarks can provide a real scalar score for the loop.',
    );
  }
  return hypotheses;
}

function generateActions(question, sources, metric) {
  const actions = [
    `Define baseline: record current state for metric: ${metric}`,
    'Choose one hypothesis and one smallest intervention per iteration.',
    'Run the narrowest retrieval, test, benchmark, or inspection command that can falsify the hypothesis.',
  ];
  if (sources.some((s) => /web|paper|docs?/i.test(s))) {
    actions.push(
      'Use coverage_check first, then web_search/web_fetch or document_search for missing facts.',
    );
  }
  if (sources.some((s) => /code|repo|tests?|benchmark|logs?/i.test(s))) {
    actions.push(
      'Use read/search/LSP tools to inspect only the affected code, then shell/verify for measurement.',
    );
  }
  actions.push(
    'Keep the change or conclusion only if the metric improves and integrity checks pass.',
  );
  return actions;
}

function generateIntegrityGuards(metric, constraints) {
  const guards = [
    'Do not edit the metric, benchmark, fixture, or scoring command to make the result easier.',
    'Do not count synthetic or self-referential evidence as independent support.',
    'Record negative results; they are useful evidence, not a reason to hide the iteration.',
    'If the metric improves but user-visible behavior worsens, reject the iteration.',
  ];
  if (constraints.length) {
    guards.push(...constraints.map((constraint) => `Respect constraint: ${constraint}`));
  }
  if (/coverage|test/i.test(metric)) {
    guards.push('New tests must assert behavior, not only execute code or assert true.');
  }
  return guards;
}

function formatAutoResearchPlan({
  question,
  metric,
  budget,
  sourceList,
  constraintList,
  hypotheses,
  actions,
  guards,
}) {
  const lines = [
    '# Auto Research Loop',
    '',
    '## Research Question',
    `- ${question}`,
    '',
    '## Success Metric',
    `- ${metric}`,
    '',
    '## Budget',
    `- ${budget}`,
    '',
    '## Evidence Sources',
    `- ${sourceList.length ? sourceList.join(', ') : 'code/context, tests, docs, web, or user evidence as available'}`,
    '',
    '## Constraints',
    `- ${constraintList.length ? constraintList.join('; ') : 'Keep the loop bounded, measurable, and honest.'}`,
    '',
    '## Candidate Hypotheses',
    ...hypotheses.map((item) => `- ${item}`),
    '',
    '## Loop Actions',
    ...actions.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## Integrity Guards',
    ...guards.map((item) => `- ${item}`),
    '',
    '## Stop Conditions',
    '- Stop when the budget is exhausted, the metric is stable across two iterations, or a blocking fact requires user input.',
    '- Final answer must include: best hypothesis, evidence gathered, metric result, rejected attempts, and remaining uncertainty.',
  ];
  return lines.join('\n');
}
