import { ToolCategory } from '../../core/types.js';

/**
 * diagnose - Systematic debugging workflow.
 * Generates a structured diagnosis report with hypothesis ranking,
 * verification steps, and root cause analysis.
 */
export default function diagnose() {
  return {
    name: 'diagnose',
    description:
      'Systematic debugging workflow tool. Generates a structured diagnosis report with symptom analysis, ranked hypotheses, verification steps, and root cause analysis. Includes the 3-Fix Rule warning to prevent shotgun debugging.',
    category: ToolCategory.skill_engineering,
    params: {
      symptom: {
        type: 'string',
        description: 'The observable symptom or bug description',
      },
      error_output: {
        type: 'string',
        description: 'Error messages, stack traces, or logs related to the symptom',
      },
      context: {
        type: 'string',
        description:
          'Context about the environment, system state, or conditions when the symptom occurs',
      },
      recent_changes: {
        type: 'string',
        description:
          'Recent code changes, deployments, or configuration modifications that may be related',
      },
    },
    required: ['symptom'],
    handler: async (params, ctx) => {
      const { symptom, error_output = '', context = '', recent_changes = '' } = params;

      const symptomSummary = analyzeSymptom(symptom, error_output);

      const infoPlan = generateInfoCollectionPlan(symptom, context);

      const hypotheses = generateHypotheses(symptom, error_output, context, recent_changes);

      const rootCauseTemplate = generateRootCauseTemplate();

      return formatDiagnosisReport(symptomSummary, infoPlan, hypotheses, rootCauseTemplate);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function analyzeSymptom(symptom, errorOutput) {
  const symptomLower = symptom.toLowerCase();
  const errorLower = (errorOutput || '').toLowerCase();

  let severity = 'Medium';
  let category = 'Functional';

  if (
    symptomLower.includes('crash') ||
    symptomLower.includes('segfault') ||
    symptomLower.includes('fatal')
  ) {
    severity = 'Critical';
    category = 'Stability';
  } else if (
    symptomLower.includes('slow') ||
    symptomLower.includes('timeout') ||
    symptomLower.includes('hang')
  ) {
    severity = 'High';
    category = 'Performance';
  } else if (
    symptomLower.includes('wrong') ||
    symptomLower.includes('incorrect') ||
    symptomLower.includes('unexpected')
  ) {
    severity = 'Medium';
    category = 'Correctness';
  } else if (
    symptomLower.includes('leak') ||
    symptomLower.includes('memory') ||
    symptomLower.includes('oom')
  ) {
    severity = 'High';
    category = 'Resource';
  } else if (
    symptomLower.includes('security') ||
    symptomLower.includes('vulnerability') ||
    symptomLower.includes('xss')
  ) {
    severity = 'Critical';
    category = 'Security';
  }

  if (
    errorLower.includes('typeerror') ||
    errorLower.includes('referenceerror') ||
    errorLower.includes('cannot read')
  ) {
    category = 'Runtime Error';
  } else if (
    errorLower.includes('enoent') ||
    errorLower.includes('eacces') ||
    errorLower.includes('permission')
  ) {
    category = 'File System / Permissions';
  } else if (
    errorLower.includes('econnrefused') ||
    errorLower.includes('timeout') ||
    errorLower.includes('network')
  ) {
    category = 'Network / Connectivity';
  }

  return {
    description: symptom,
    severity,
    category,
    errorOutput: errorOutput || '(none provided)',
    keyObservation: errorOutput
      ? extractKeyObservation(errorOutput)
      : 'No error output provided - additional logging may be needed to capture the failure',
  };
}

function extractKeyObservation(errorOutput) {
  const lines = errorOutput.split('\n').filter((l) => l.trim());
  if (lines.length === 0) {
    return 'Empty error output';
  }

  // Look for error type lines
  const errorLine = lines.find((l) => /error|exception|failed|panic|fatal/i.test(l));
  if (errorLine) {
    return errorLine.trim();
  }

  return lines[0].trim();
}

function generateInfoCollectionPlan(symptom, context) {
  const steps = [
    {
      id: 'IC-1',
      action: 'Capture exact reproduction steps',
      detail:
        'Write down the precise sequence of actions that triggers the symptom. Include inputs, state, and timing.',
      priority: 'HIGH',
    },
    {
      id: 'IC-2',
      action: 'Collect relevant logs',
      detail:
        'Gather application logs, system logs, and any third-party service logs from the time the symptom occurred.',
      priority: 'HIGH',
    },
    {
      id: 'IC-3',
      action: 'Check environment state',
      detail:
        'Verify environment variables, configuration files, dependency versions, and system resources.',
      priority: 'HIGH',
    },
    {
      id: 'IC-4',
      action: 'Review recent changes',
      detail:
        'Examine git history, deployment logs, and configuration changes made around the time the symptom first appeared.',
      priority: 'HIGH',
    },
    {
      id: 'IC-5',
      action: 'Isolate the failure',
      detail:
        'Determine the narrowest reproduction case. Can the symptom be reproduced in isolation (unit test, minimal script)?',
      priority: 'MEDIUM',
    },
    {
      id: 'IC-6',
      action: 'Compare with known-good state',
      detail:
        'If available, compare the failing state with a known-working version to identify differences.',
      priority: 'MEDIUM',
    },
  ];

  if (context) {
    steps.unshift({
      id: 'IC-0',
      action: 'Analyze provided context',
      detail: `Review the provided context: "${context}". This may contain clues about the conditions under which the symptom occurs.`,
      priority: 'HIGH',
    });
  }

  return steps;
}

function generateHypotheses(symptom, errorOutput, context, recentChanges) {
  const symptomLower = symptom.toLowerCase();
  const errorLower = (errorOutput || '').toLowerCase();
  const hypotheses = [];

  // Hypothesis 1: Recent change introduced the bug
  if (recentChanges) {
    hypotheses.push({
      id: 'H-1',
      hypothesis: 'A recent change introduced the bug',
      probability: 'High',
      reasoning: `Recent changes were reported: "${recentChanges}". The most common cause of new symptoms is recent modifications.`,
      verificationSteps: [
        'Revert the recent change and check if the symptom disappears',
        'Use git bisect to identify the exact commit that introduced the issue',
        'Review the diff of the recent change for logic errors',
      ],
    });
  }

  // Hypothesis 2: State/environment issue
  hypotheses.push({
    id: 'H-2',
    hypothesis: 'Environment or state mismatch',
    probability: 'Medium',
    reasoning:
      'The symptom may be caused by incorrect environment configuration, stale state, or resource exhaustion.',
    verificationSteps: [
      'Check environment variables and configuration files',
      'Clear caches, temp files, and restart services',
      'Compare environment with a known-working instance',
      'Check disk space, memory usage, and file descriptors',
    ],
  });

  // Hypothesis 3: Logic error
  if (
    errorLower.includes('typeerror') ||
    errorLower.includes('referenceerror') ||
    symptomLower.includes('wrong') ||
    symptomLower.includes('incorrect')
  ) {
    hypotheses.push({
      id: 'H-3',
      hypothesis: 'Logic error in the code path',
      probability: 'High',
      reasoning:
        'The error output suggests a runtime type or reference error, indicating a logic issue in the affected code path.',
      verificationSteps: [
        'Add debug logging at key points in the affected code path',
        'Write a failing test that reproduces the exact error',
        'Trace the execution path step by step',
        'Check for off-by-one errors, null/undefined handling, and type coercion issues',
      ],
    });
  }

  // Hypothesis 4: Integration/dependency issue
  hypotheses.push({
    id: 'H-4',
    hypothesis: 'Integration or dependency issue',
    probability: 'Medium',
    reasoning:
      'The symptom may be caused by a breaking change in a dependency, API incompatibility, or service degradation.',
    verificationSteps: [
      'Check dependency versions and changelogs for recent breaking changes',
      'Test with a known-compatible version of the dependency',
      'Check API contracts and response formats',
      'Verify network connectivity to external services',
    ],
  });

  // Hypothesis 5: Race condition / concurrency
  if (
    symptomLower.includes('intermittent') ||
    symptomLower.includes('sometimes') ||
    symptomLower.includes('race') ||
    symptomLower.includes('concurrent')
  ) {
    hypotheses.push({
      id: 'H-5',
      hypothesis: 'Race condition or concurrency issue',
      probability: 'High',
      reasoning:
        'The intermittent nature of the symptom suggests a timing-dependent issue, possibly a race condition.',
      verificationSteps: [
        'Add synchronization or locking to the suspected shared resource',
        'Run the reproduction steps under load to increase frequency',
        'Use debugging tools to detect concurrent access patterns',
        'Review async/await usage for missing awaits or callback issues',
      ],
    });
  }

  // Hypothesis 6: Data corruption
  hypotheses.push({
    id: 'H-6',
    hypothesis: 'Corrupted or invalid data',
    probability: 'Low',
    reasoning:
      'The symptom could be caused by corrupted data in a database, cache, or file that the system is consuming.',
    verificationSteps: [
      'Inspect the data being processed when the symptom occurs',
      'Check for data migration issues or schema mismatches',
      'Validate data integrity with checksums or consistency checks',
    ],
  });

  // Sort by probability
  const probOrder = { High: 3, Medium: 2, Low: 1 };
  hypotheses.sort((a, b) => (probOrder[b.probability] || 0) - (probOrder[a.probability] || 0));

  return hypotheses;
}

function generateRootCauseTemplate() {
  return {
    sections: [
      {
        title: 'Root Cause',
        prompt: 'Once identified, describe the exact root cause in one sentence.',
      },
      {
        title: 'Why It Happened',
        prompt:
          'Explain the chain of events that led to the symptom. What was the original mistake or oversight?',
      },
      {
        title: "Why It Wasn't Caught",
        prompt:
          'Explain why existing tests, reviews, or checks did not catch this issue. What gap in the process allowed it?',
      },
      {
        title: 'Fix Description',
        prompt:
          'Describe the minimal fix that resolves the root cause without introducing new issues.',
      },
      {
        title: 'Prevention',
        prompt:
          'What test, check, or process change would prevent this class of bug from recurring?',
      },
    ],
  };
}

function formatDiagnosisReport(symptomSummary, infoPlan, hypotheses, rootCauseTemplate) {
  const lines = [
    '# Diagnosis Report',
    '',
    '---',
    '',
    '## 1. Symptom Summary',
    '',
    `**Symptom**: ${symptomSummary.description}`,
    '',
    `**Severity**: ${symptomSummary.severity}`,
    '',
    `**Category**: ${symptomSummary.category}`,
    '',
    `**Key Observation**: ${symptomSummary.keyObservation}`,
    '',
    '---',
    '',
    '> ## 3-Fix Rule Warning',
    '> ',
    '> **If you have tried 3 fixes and the symptom persists, STOP.**',
    '> ',
    '> You are likely "shotgun debugging" -- making changes based on frustration rather than evidence.',
    '> ',
    '> Instead:',
    '> 1. Revert all experimental changes',
    '> 2. Return to the Information Collection plan above',
    '> 3. Gather more evidence before forming a new hypothesis',
    '> 4. Consider asking a colleague for a fresh perspective',
    '',
    '---',
    '',
    '## 2. Information Collection Plan',
    '',
    '| ID | Action | Detail | Priority |',
    '|----|--------|--------|----------|',
  ];

  infoPlan.forEach((step) => {
    lines.push(`| ${step.id} | ${step.action} | ${step.detail} | **${step.priority}** |`);
  });

  lines.push('', '---', '', '## 3. Hypotheses (Ranked by Probability)', '');

  hypotheses.forEach((h) => {
    lines.push(`### ${h.id}: ${h.hypothesis}`);
    lines.push('');
    lines.push(`- **Probability**: ${h.probability}`);
    lines.push(`- **Reasoning**: ${h.reasoning}`);
    lines.push('');
    lines.push('**Verification Steps**:');
    h.verificationSteps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '## 4. Root Cause Analysis Template',
    '',
    '> Fill in each section once the root cause has been identified.',
    '',
  );

  rootCauseTemplate.sections.forEach((section) => {
    lines.push(`### ${section.title}`);
    lines.push('');
    lines.push(`*${section.prompt}*`);
    lines.push('');
    lines.push('<!-- Your analysis here -->');
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '> **Next Steps**: Follow the Information Collection Plan, then verify hypotheses in order of probability. Document findings in the Root Cause Analysis section.',
    '',
  );

  return lines.join('\n');
}
