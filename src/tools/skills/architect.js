import { ToolCategory } from '../../core/types/index.js';

/**
 * architect - Architecture review and improvement.
 * Generates a structured architecture report with technical debt inventory,
 * deepening opportunities, and an incremental improvement path.
 */
export default function architect() {
  return {
    name: 'architect',
    description:
      'Architecture review and improvement tool. Analyzes the current architecture, inventories technical debt, identifies deepening opportunities sorted by impact/effort, and recommends an incremental improvement path (never a rewrite).',
    category: ToolCategory.skill_engineering,
    params: {
      scope: {
        type: 'string',
        description:
          'The architectural scope to review (e.g., "entire project", "authentication module", "API layer")',
      },
      pain_points: {
        type: 'string',
        description: 'Comma-separated list of known pain points or architectural concerns',
      },
    },
    required: ['scope'],
    handler: async (params, ctx) => {
      const { scope, pain_points = '' } = params;

      const painList = pain_points
        ? pain_points
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        : [];

      const currentAnalysis = analyzeCurrentArchitecture(scope, painList);

      const techDebt = inventoryTechnicalDebt(scope, painList);

      const opportunities = identifyDeepeningOpportunities(scope, painList);

      const improvementPath = generateImprovementPath(opportunities);

      return formatArchitectureReport(
        scope,
        currentAnalysis,
        techDebt,
        opportunities,
        improvementPath,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function analyzeCurrentArchitecture(scope, painPoints) {
  const scopeLower = scope.toLowerCase();

  // Infer architectural patterns based on scope keywords
  const patterns = [];

  if (
    scopeLower.includes('api') ||
    scopeLower.includes('server') ||
    scopeLower.includes('backend')
  ) {
    patterns.push({
      pattern: 'Client-Server',
      likelihood: 'High',
      notes:
        'Scope suggests a backend/API architecture. Evaluate request handling, middleware chain, and data flow.',
    });
  }

  if (scopeLower.includes('microservice') || scopeLower.includes('service')) {
    patterns.push({
      pattern: 'Microservices',
      likelihood: 'Medium',
      notes:
        'If services are involved, evaluate service boundaries, inter-service communication, and data ownership.',
    });
  }

  if (
    scopeLower.includes('frontend') ||
    scopeLower.includes('ui') ||
    scopeLower.includes('component')
  ) {
    patterns.push({
      pattern: 'Component-Based UI',
      likelihood: 'High',
      notes:
        'Scope suggests a frontend architecture. Evaluate component hierarchy, state management, and data flow.',
    });
  }

  patterns.push({
    pattern: 'Layered Architecture',
    likelihood: 'Medium',
    notes:
      'Most projects follow a layered pattern (presentation, business logic, data access). Verify separation of concerns.',
  });

  const strengths = [
    'Existing codebase provides a working foundation',
    'Pain points are identified and acknowledged (first step to improvement)',
    'Architecture can evolve incrementally without full rewrite',
  ];

  const concerns =
    painPoints.length > 0
      ? painPoints.map((p) => `Known pain point: ${p}`)
      : ['No specific pain points identified - consider running a broader analysis with the team'];

  return {
    scope,
    inferredPatterns: patterns,
    strengths,
    concerns,
  };
}

function inventoryTechnicalDebt(scope, painPoints) {
  const debtItems = [];

  // Common technical debt categories
  debtItems.push({
    id: 'TD-1',
    category: 'Testing',
    description: 'Insufficient test coverage',
    impact: 'High',
    effort: 'Medium',
    indicator: 'Areas without automated tests are risky to modify',
    remediation: 'Use the tdd tool to incrementally add tests. Start with critical paths.',
  });

  debtItems.push({
    id: 'TD-2',
    category: 'Documentation',
    description: 'Missing or outdated architecture documentation',
    impact: 'Medium',
    effort: 'Low',
    indicator: 'New contributors struggle to understand the system',
    remediation: 'Document key architectural decisions, data flows, and module responsibilities.',
  });

  debtItems.push({
    id: 'TD-3',
    category: 'Coupling',
    description: 'Tight coupling between modules',
    impact: 'High',
    effort: 'High',
    indicator: 'Changes in one module frequently break others',
    remediation: 'Introduce interfaces/abstractions between modules. Use dependency injection.',
  });

  debtItems.push({
    id: 'TD-4',
    category: 'Error Handling',
    description: 'Inconsistent error handling patterns',
    impact: 'Medium',
    effort: 'Medium',
    indicator: 'Errors are handled differently across modules',
    remediation: 'Establish a standard error handling pattern and apply it consistently.',
  });

  debtItems.push({
    id: 'TD-5',
    category: 'Configuration',
    description: 'Hardcoded configuration values',
    impact: 'Medium',
    effort: 'Low',
    indicator: 'Environment-specific values are embedded in source code',
    remediation: 'Extract configuration to environment variables or config files.',
  });

  // Add debt items based on pain points
  if (
    painPoints.some(
      (p) => p.toLowerCase().includes('slow') || p.toLowerCase().includes('performance'),
    )
  ) {
    debtItems.push({
      id: 'TD-6',
      category: 'Performance',
      description: 'Performance bottlenecks in critical paths',
      impact: 'High',
      effort: 'High',
      indicator: 'Reported performance issues in production or during testing',
      remediation: 'Profile the application, identify hotspots, and optimize incrementally.',
    });
  }

  if (
    painPoints.some(
      (p) => p.toLowerCase().includes('complex') || p.toLowerCase().includes('hard to understand'),
    )
  ) {
    debtItems.push({
      id: 'TD-7',
      category: 'Complexity',
      description: 'Excessive complexity in core modules',
      impact: 'High',
      effort: 'High',
      indicator: 'High cognitive load to understand and modify core logic',
      remediation:
        'Decompose complex modules into smaller, focused units. Apply design patterns where appropriate.',
    });
  }

  return debtItems;
}

function identifyDeepeningOpportunities(scope, painPoints) {
  const opportunities = [
    {
      id: 'DO-1',
      name: 'Strengthen the test foundation',
      impact: 'High',
      effort: 'Medium',
      ratio: 'High',
      description: 'Build a comprehensive test suite that enables confident refactoring.',
      steps: [
        'Identify critical paths without test coverage',
        'Write characterization tests for existing behavior',
        'Add integration tests for module boundaries',
        'Set up coverage reporting and establish minimum thresholds',
      ],
    },
    {
      id: 'DO-2',
      name: 'Improve module boundaries',
      impact: 'High',
      effort: 'High',
      ratio: 'Medium',
      description: 'Reduce coupling between modules by introducing clear interfaces and contracts.',
      steps: [
        'Map current module dependencies',
        'Identify circular dependencies',
        'Define interfaces for inter-module communication',
        'Introduce dependency injection where appropriate',
      ],
    },
    {
      id: 'DO-3',
      name: 'Standardize error handling',
      impact: 'Medium',
      effort: 'Low',
      ratio: 'High',
      description: 'Establish a consistent error handling pattern across the codebase.',
      steps: [
        'Audit current error handling approaches',
        'Design a standard error type hierarchy',
        'Create utility functions for common error patterns',
        'Migrate existing error handling incrementally',
      ],
    },
    {
      id: 'DO-4',
      name: 'Extract configuration management',
      impact: 'Medium',
      effort: 'Low',
      ratio: 'High',
      description: 'Centralize configuration and eliminate hardcoded values.',
      steps: [
        'Audit for hardcoded configuration values',
        'Create a configuration module with validation',
        'Migrate values to environment variables or config files',
        'Add configuration documentation',
      ],
    },
    {
      id: 'DO-5',
      name: 'Improve observability',
      impact: 'Medium',
      effort: 'Medium',
      ratio: 'Medium',
      description: 'Add structured logging, metrics, and tracing to critical paths.',
      steps: [
        'Identify critical paths that lack observability',
        'Add structured logging with consistent formats',
        'Implement health checks and readiness probes',
        'Set up alerting for key metrics',
      ],
    },
  ];

  // Add opportunities based on pain points
  if (
    painPoints.some(
      (p) => p.toLowerCase().includes('deploy') || p.toLowerCase().includes('release'),
    )
  ) {
    opportunities.push({
      id: 'DO-6',
      name: 'Improve deployment pipeline',
      impact: 'High',
      effort: 'Medium',
      ratio: 'High',
      description: 'Make deployments faster, safer, and more reliable.',
      steps: [
        'Audit current deployment process for pain points',
        'Add automated smoke tests to the pipeline',
        'Implement blue-green or canary deployment strategy',
        'Add rollback automation',
      ],
    });
  }

  // Sort by impact/effort ratio (High first, then Medium, then Low)
  const ratioOrder = { High: 3, Medium: 2, Low: 1 };
  opportunities.sort((a, b) => (ratioOrder[b.ratio] || 0) - (ratioOrder[a.ratio] || 0));

  return opportunities;
}

function generateImprovementPath(opportunities) {
  const phases = [
    {
      phase: 'Phase 1: Quick Wins (Week 1-2)',
      description: 'Low-effort, high-impact improvements that build momentum.',
      items: opportunities.filter((o) => o.ratio === 'High' && o.effort === 'Low'),
    },
    {
      phase: 'Phase 2: Foundation Building (Week 3-6)',
      description: 'Medium-effort improvements that strengthen the architecture.',
      items: opportunities.filter((o) => o.ratio === 'High' && o.effort === 'Medium'),
    },
    {
      phase: 'Phase 3: Structural Improvements (Week 7-12)',
      description: 'Higher-effort changes that address deeper architectural issues.',
      items: opportunities.filter((o) => o.ratio === 'Medium' && o.effort !== 'Low'),
    },
  ];

  return phases.filter((p) => p.items.length > 0);
}

function formatArchitectureReport(scope, analysis, techDebt, opportunities, improvementPath) {
  const lines = [
    '# Architecture Review Report',
    '',
    `**Scope**: ${scope}`,
    '',
    '> **Principle**: Always prefer incremental improvement over rewrite. Every change should leave the system better than it was found.',
    '',
    '---',
    '',
    '## 1. Current Architecture Analysis',
    '',
    '### Inferred Patterns',
    '',
    '| Pattern | Likelihood | Notes |',
    '|---------|-----------|-------|',
  ];

  analysis.inferredPatterns.forEach((p) => {
    lines.push(`| ${p.pattern} | ${p.likelihood} | ${p.notes} |`);
  });

  lines.push('', '### Strengths', '');
  analysis.strengths.forEach((s) => {
    lines.push(`- ${s}`);
  });

  lines.push('', '### Concerns', '');
  analysis.concerns.forEach((c) => {
    lines.push(`- ${c}`);
  });

  lines.push(
    '',
    '---',
    '',
    '## 2. Technical Debt Inventory',
    '',
    '| ID | Category | Description | Impact | Effort | Indicator |',
    '|----|----------|-------------|--------|--------|-----------|',
  );

  techDebt.forEach((d) => {
    lines.push(
      `| ${d.id} | ${d.category} | ${d.description} | ${d.impact} | ${d.effort} | ${d.indicator} |`,
    );
  });

  lines.push('', '### Remediation Summary', '');

  techDebt.forEach((d) => {
    lines.push(`**${d.id}**: ${d.remediation}`);
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '## 3. Deepening Opportunities (Sorted by Impact/Effort)',
    '',
    '| ID | Opportunity | Impact | Effort | Ratio |',
    '|----|-------------|--------|--------|-------|',
  );

  opportunities.forEach((o) => {
    lines.push(`| ${o.id} | ${o.name} | ${o.impact} | ${o.effort} | ${o.ratio} |`);
  });

  lines.push('');

  opportunities.forEach((o) => {
    lines.push(`### ${o.id}: ${o.name}`);
    lines.push('');
    lines.push(o.description);
    lines.push('');
    lines.push('**Steps**:');
    o.steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push('');
  });

  lines.push('---', '', '## 4. Recommended Improvement Path', '');

  improvementPath.forEach((phase) => {
    lines.push(`### ${phase.phase}`);
    lines.push('');
    lines.push(phase.description);
    lines.push('');
    phase.items.forEach((item) => {
      lines.push(`- **${item.id}**: ${item.name} (${item.impact} impact, ${item.effort} effort)`);
    });
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '> **Important**: This is an incremental improvement plan, NOT a rewrite proposal. Each step should be independently valuable and deployable.',
    '',
    '> **Next Steps**: Start with Phase 1 quick wins. Use the tdd tool for test foundation work and the review tool for ongoing quality checks.',
    '',
  );

  return lines.join('\n');
}
