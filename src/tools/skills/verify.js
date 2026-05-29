import { ToolCategory } from '../../core/types.js';

/**
 * verify - Evidence-based verification gate.
 * Enforces the Iron Law: no completion claims without fresh verification evidence.
 */
export default function verify() {
  return {
    name: 'verify',
    description:
      'Evidence-based verification gate. Evaluates claims against criteria with evidence. Enforces the Iron Law: no completion claims without fresh verification evidence. Each criterion is assessed as PASS, FAIL, or NEEDS_CHECK.',
    category: ToolCategory.skill_engineering,
    params: {
      // New format
      claim: {
        type: 'string',
        description: 'The claim or assertion to verify (e.g., "Feature X is complete and working")',
      },
      criteria: {
        type: 'string',
        description: 'Comma-separated list of verification criteria that must be met',
      },
      evidence: {
        type: 'string',
        description: 'Comma-separated list of evidence items supporting the claim',
      },
      // Legacy format for backward compatibility
      task: {
        type: 'string',
        description: '(Legacy) The task that was completed',
      },
      changes: {
        type: 'string',
        description: '(Legacy) The changes that were made',
      },
      verification_passed: {
        type: 'string',
        description: '(Legacy) The verification that was performed',
      },
    },
    required: [], // Make required flexible
    handler: async (params, ctx) => {
      // Support both new and legacy formats
      let claim, criteria, evidence;

      // New format
      if (params.claim || params.criteria) {
        claim = params.claim || 'Task completed';
        criteria = params.criteria || 'Code exists,Function works';
        evidence = params.evidence || '';
      }
      // Legacy format
      else if (params.task || params.changes || params.verification_passed) {
        claim = params.task || 'Task completed';
        criteria = 'Changes made,Verification performed';
        evidence = [
          params.changes,
          params.verification_passed
        ].filter(Boolean).join(', ');
      }
      // Fallback
      else {
        claim = 'Task completed';
        criteria = 'Task done';
        evidence = 'Task completed';
      }

      const criteriaList = (criteria || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      const evidenceList = (evidence || '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      const results = evaluateCriteria(criteriaList, evidenceList);

      const conclusion = drawConclusion(results);

      return formatVerificationReport(claim, criteriaList, evidenceList, results, conclusion);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function evaluateCriteria(criteriaList, evidenceList) {
  return criteriaList.map((criterion, index) => {
    const matchedEvidence = findMatchingEvidence(criterion, evidenceList);

    if (matchedEvidence.length === 0) {
      return {
        id: `VC-${index + 1}`,
        criterion,
        status: 'NEEDS_CHECK',
        evidence: [],
        gap: 'No evidence provided for this criterion. Fresh verification is required.',
      };
    }

    // Check if evidence is stale or generic
    const hasFreshEvidence = matchedEvidence.some((e) => isFreshEvidence(e));
    const hasSpecificEvidence = matchedEvidence.some((e) => isSpecificEvidence(e, criterion));

    if (hasFreshEvidence && hasSpecificEvidence) {
      return {
        id: `VC-${index + 1}`,
        criterion,
        status: 'PASS',
        evidence: matchedEvidence,
        gap: null,
      };
    } else if (hasSpecificEvidence) {
      return {
        id: `VC-${index + 1}`,
        criterion,
        status: 'NEEDS_CHECK',
        evidence: matchedEvidence,
        gap: 'Evidence exists but may be stale. Fresh verification recommended.',
      };
    } else {
      return {
        id: `VC-${index + 1}`,
        criterion,
        status: 'NEEDS_CHECK',
        evidence: matchedEvidence,
        gap: 'Evidence is too generic. Specific verification targeting this criterion is needed.',
      };
    }
  });
}

function findMatchingEvidence(criterion, evidenceList) {
  if (evidenceList.length === 0) return [];

  const criterionWords = criterion.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  return evidenceList.filter((evidence) => {
    const evidenceLower = evidence.toLowerCase();
    // Direct keyword match
    const hasKeywordMatch = criterionWords.some((word) => evidenceLower.includes(word));
    // Also check for test-related evidence patterns
    const isTestEvidence = /test|pass|fail|assert|verify|check|run|output|result/i.test(evidence);
    return hasKeywordMatch || isTestEvidence;
  });
}

function isFreshEvidence(evidence) {
  // Heuristic: evidence that references recent actions is considered fresh
  const freshIndicators = [
    'just ran',
    'verified',
    'confirmed',
    'tested',
    'executed',
    'observed',
    'current',
    'latest',
    'now',
  ];
  const evidenceLower = evidence.toLowerCase();
  return freshIndicators.some((indicator) => evidenceLower.includes(indicator));
}

function isSpecificEvidence(evidence, criterion) {
  // Evidence is specific if it references the criterion's domain
  const criterionLower = criterion.toLowerCase();
  const evidenceLower = evidence.toLowerCase();

  // Extract key domain words from criterion
  const domainWords = criterionLower
    .split(/\s+/)
    .filter((w) => w.length > 4 && !['should', 'must', 'shall', 'needs', 'require', 'ensure', 'verify', 'check'].includes(w));

  return domainWords.some((word) => evidenceLower.includes(word));
}

function drawConclusion(results) {
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const needsCheckCount = results.filter((r) => r.status === 'NEEDS_CHECK').length;

  if (failCount > 0) {
    return {
      verdict: 'FAIL',
      summary: `${failCount} criterion(criteria) failed verification. The claim cannot be accepted.`,
      action: 'Address the failed criteria before re-verification.',
    };
  }

  if (needsCheckCount > 0) {
    return {
      verdict: 'NEED_MORE_INFO',
      summary: `${passCount}/${results.length} criteria passed, but ${needsCheckCount} criterion(criteria) lack sufficient evidence.`,
      action: 'Provide fresh, specific evidence for each NEEDS_CHECK criterion.',
    };
  }

  return {
    verdict: 'PASS',
    summary: `All ${results.length} criteria passed verification with sufficient evidence.`,
    action: 'The claim is verified. Proceed with confidence.',
  };
}

function formatVerificationReport(claim, criteriaList, evidenceList, results, conclusion) {
  const lines = [
    '# Verification Report',
    '',
    '> **Iron Law**: No completion claims without fresh verification evidence.',
    '',
    '---',
    '',
    '## Claim',
    '',
    `> ${claim}`,
    '',
    '---',
    '',
    '## Criteria & Verification Status',
    '',
    '| ID | Criterion | Status | Evidence | Gap |',
    '|----|-----------|--------|----------|-----|',
  ];

  results.forEach((r) => {
    const statusBadge = r.status === 'PASS'
      ? ':white_check_mark: PASS'
      : r.status === 'FAIL'
        ? ':x: FAIL'
        : ':warning: NEEDS_CHECK';

    const evidenceStr = r.evidence.length > 0
      ? r.evidence.join('; ')
      : '(none)';

    const gapStr = r.gap || '-';

    lines.push(`| ${r.id} | ${r.criterion} | ${statusBadge} | ${evidenceStr} | ${gapStr} |`);
  });

  lines.push(
    '',
    '---',
    '',
    '## Evidence Chain',
    ''
  );

  if (evidenceList.length === 0) {
    lines.push('> **No evidence provided.** Verification cannot proceed without evidence.');
  } else {
    lines.push('The following evidence items were submitted:');
    lines.push('');
    evidenceList.forEach((e, i) => {
      lines.push(`${i + 1}. ${e}`);
    });
  }

  lines.push(
    '',
    '---',
    '',
    '## Missing Evidence',
    ''
  );

  const missingEvidence = results.filter((r) => r.status !== 'PASS');
  if (missingEvidence.length === 0) {
    lines.push('No missing evidence. All criteria have sufficient verification.');
  } else {
    missingEvidence.forEach((r) => {
      lines.push(`- **${r.id}**: ${r.gap}`);
    });
  }

  lines.push(
    '',
    '---',
    '',
    '## Conclusion',
    '',
  );

  const verdictBadge = conclusion.verdict === 'PASS'
    ? ':white_check_mark:'
    : conclusion.verdict === 'FAIL'
      ? ':x:'
      : ':warning:';

  lines.push(`### ${verdictBadge} ${conclusion.verdict}`);
  lines.push('');
  lines.push(conclusion.summary);
  lines.push('');
  lines.push(`**Required Action**: ${conclusion.action}`);

  if (conclusion.verdict !== 'PASS') {
    lines.push('');
    lines.push('> **Reminder**: Do not mark this task as complete. The Iron Law requires fresh, specific evidence for every criterion.');
  }

  lines.push('');
  return lines.join('\n');
}
