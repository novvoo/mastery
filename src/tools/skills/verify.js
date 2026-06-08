import { ToolCategory } from '../../core/types.js';

/**
 * verify — evidence-based verification gate.
 *
 * RUNTIME-EVIDENCE-ONLY: this tool does NOT trust the user-supplied "evidence"
 * argument. Instead it builds the verification report from the `toolEventsSnapshot`
 * injected by the agent engine into the handler context. Each criterion is then
 * evaluated purely against observable, real tool events.
 *
 * Arguments:
 *   claim  (optional) the claim to verify (e.g. "feature X is complete and working").
 *   criteria (optional) comma-separated criterion list; when absent the tool infers
 *                       a default set based on the task profile.
 *
 * Each criterion is evaluated to PASS / FAIL / NEEDS_CHECK based on tool events only.
 */
export default function verify() {
  return {
    name: 'verify',
    description:
      'Evidence-based verification gate. Evaluates the claim against observable tool events. Each criterion is assessed PASS/FAIL/NEEDS_CHECK based on real runtime events only — NOT on user-supplied text.',
    category: ToolCategory.skill_engineering,
    params: {
      claim: {
        type: 'string',
        description: 'The claim or assertion to verify (e.g. "Feature X is complete and working").',
      },
      criteria: {
        type: 'string',
        description: 'Comma-separated list of verification criteria (e.g. "file edited, test passes, build succeeds").',
      },
      // NOTE: evidence parameter is intentionally IGNORED. We keep it in the schema
      // for legacy callers but treat runtime tool events as the single source of truth.
      evidence: {
        type: 'string',
        description: 'IGNORED. Verification is sourced from runtime tool events only.',
      },
      task: { type: 'string', description: '(Legacy) The task that was completed.' },
      changes: { type: 'string', description: '(Legacy) The changes that were made.' },
      verification_passed: { type: 'string', description: '(Legacy) IGNORED — only runtime tool events count.' },
    },
    required: [],
    handler: async (params, ctx) => {
      const claim = normalizeClaim(params);
      const toolEvents = Array.isArray(ctx?.toolEventsSnapshot) ? ctx.toolEventsSnapshot : [];

      // Build a list of criteria — either user-supplied or inferred from tool events.
      const criteriaList = buildCriteria(params, toolEvents);

      // Compute runtime evidence categories from the tool event stream.
      const evidence = classifyRuntimeEvidence(toolEvents);

      const results = evaluateCriteria(criteriaList, evidence);
      const conclusion = drawConclusion(results);

      return formatVerificationReport(claim, criteriaList, evidence, results, conclusion);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeClaim(params) {
  if (params?.claim) return params.claim;
  if (params?.task) return params.task;
  if (params?.changes) return params.changes;
  return 'Task completion';
}

function buildCriteria(params, toolEvents) {
  const raw = params?.criteria;
  if (raw && typeof raw === 'string' && raw.trim().length > 0) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  // Infer criteria from what tool events happened.
  const inferred = [];
  const has = kind => toolEvents.some(e => e?.kind === kind || e?.name === kind);
  const anySuccessfulWrite = toolEvents.some(e => e?.success && ['write_file', 'edit_file'].includes(e?.name));
  const anyShellSuccess = toolEvents.some(e => e?.success && (e?.name === 'shell' || e?.name === 'pty_start' || e?.name === 'pty_write'));
  if (anySuccessfulWrite) inferred.push('A file was successfully created or edited');
  if (anyShellSuccess) inferred.push('A shell/pty command ran successfully');
  if (toolEvents.length > 0) inferred.push('At least one tool event produced observable output');
  if (inferred.length === 0) inferred.push('Task has observable tool-level evidence');
  return inferred;
}

function classifyRuntimeEvidence(toolEvents) {
  const evidence = {
    mutationEvents: [],        // successful writes/edits
    shellEvents: [],           // any shell/pty invocations
    inspectionEvents: [],      // read-only inspection events
    reviewEvents: [],
    failureEvents: [],         // commands that returned non-zero / failed
    allSuccess: toolEvents.length === 0 ? false : toolEvents.every(e => e?.success === true),
    count: toolEvents.length,
    eventNames: toolEvents.map(e => e?.name || 'unknown'),
  };

  for (const e of toolEvents) {
    if (!e) continue;
    const name = String(e.name || '');
    const success = !!e.success;
    const args = e.args || {};
    const preview = truncate(String(e.resultPreview || ''), 180);
    const command = extractCommand(args);

    const entry = { name, success, command: command || null, preview };

    if (!success) {
      evidence.failureEvents.push(entry);
      continue;
    }
    if (['write_file', 'edit_file', 'git_commit', 'git_push', 'git_add'].includes(name)) {
      evidence.mutationEvents.push(entry);
    } else if (['shell', 'pty_start', 'pty_write', 'pty_read', 'pty_stop'].includes(name)) {
      evidence.shellEvents.push(entry);
    } else if (['read_file', 'list_dir', 'glob', 'search', 'grep', 'semantic_search'].includes(name)) {
      evidence.inspectionEvents.push(entry);
    } else if (['review', 'coverage_check'].includes(name)) {
      evidence.reviewEvents.push(entry);
    }
  }

  // Sub-classify shell events into "looks like verification" vs "looks like something else"
  evidence.verificationShellEvents = evidence.shellEvents.filter(e => isVerificationCommand(e.command));
  evidence.mutatingShellEvents = evidence.shellEvents.filter(e => isMutatingCommand(e.command));

  return evidence;
}

function extractCommand(args) {
  if (!args) return '';
  const v = args.command || args.input || args.text || args.cmd || args.script;
  return v ? String(v) : '';
}

function isVerificationCommand(cmd) {
  if (!cmd) return false;
  const c = String(cmd).toLowerCase();
  return /\b(test|tests|testing|spec|jest|vitest|pytest|mocha|npm test|bun test|node test|lint|linting|eslint|stylelint|check|typecheck|tsc|build|compile|bundle|webpack|rollup|vite build)\b/.test(c);
}

function isMutatingCommand(cmd) {
  if (!cmd) return false;
  const c = String(cmd).toLowerCase();
  return /\b(mkdir|cp|mv|rm|sed|perl|tee|git add|git commit|git push|npm install|pip install|touch|>|>>|apply_patch|echo)\b/.test(c);
}

function evaluateCriteria(criteriaList, evidence) {
  return criteriaList.map(criterion => {
    const status = assessCriterion(criterion, evidence);
    return {
      id: `VC-${criteriaList.indexOf(criterion) + 1}`,
      criterion,
      status, // 'PASS' | 'FAIL' | 'NEEDS_CHECK'
      supportingEvidence: describeEvidenceFor(criterion, evidence, status),
      gap: statusGap(status, criterion, evidence),
    };
  });
}

function assessCriterion(criterion, evidence) {
  const text = String(criterion || '').toLowerCase();

  // Criterion explicitly about a file write/edit — check mutation events.
  if (/(wrote|written|edited|created|file (was|is)|(create|write|edit)(d|s)? the file|file (created|written))/.test(text)
    || /file (has been|was|is) (written|edited|created|saved)/.test(text)
    || /(添加|修改|创建|写入|编辑).*文件/.test(criterion)) {
    return evidence.mutationEvents.length > 0 ? 'PASS' : 'NEEDS_CHECK';
  }

  // Criterion about tests / verification / lint / build / compile
  if (/(test|passes|pass|lint|linting|build|builds|compile|type.?check|typescript|tsc|verify|verification|check|validation)/.test(text)
    || /(测试|构建|编译|验证|检查|通过)/.test(criterion)) {
    if (evidence.verificationShellEvents.length > 0) return 'PASS';
    if (evidence.failureEvents.some(e => isVerificationCommand(e.command))) return 'FAIL';
    return 'NEEDS_CHECK';
  }

  // Criterion about inspection / review
  if (/(reviewed|review|inspect|read back|read the file|confirmed the file|review after)/.test(text)) {
    const reviewed = evidence.inspectionEvents.length > 0 || evidence.reviewEvents.length > 0;
    return reviewed ? 'PASS' : 'NEEDS_CHECK';
  }

  // Catch-all: look for any successful evidence that mentions the criterion verbatim.
  const keyword = extractKeyword(text);
  if (keyword) {
    const mentionsKeyword = (list) => list.some(e =>
      (e.command && e.command.includes(keyword)) ||
      (e.preview && e.preview.toLowerCase().includes(keyword))
    );
    if (mentionsKeyword(evidence.shellEvents) || mentionsKeyword(evidence.inspectionEvents)) return 'PASS';
  }

  // Otherwise: a criterion requires at least one successful runtime event to
  // be treated as "plausibly correct"
  if (evidence.mutationEvents.length + evidence.shellEvents.length + evidence.inspectionEvents.length > 0) {
    return 'NEEDS_CHECK';
  }
  return 'NEEDS_CHECK';
}

function extractKeyword(text) {
  if (!text) return null;
  // Try to pull the longest "word" from the criterion as a likely keyword.
  const words = text.split(/[^a-z0-9_\-]+/).filter(w => w.length >= 4);
  if (words.length === 0) return null;
  return words.sort((a, b) => b.length - a.length)[0];
}

function describeEvidenceFor(criterion, evidence, status) {
  if (status === 'PASS') {
    if (evidence.verificationShellEvents.length > 0) {
      const e = evidence.verificationShellEvents[0];
      return `Verification command "${e.command || 'shell'}" observed.`;
    }
    if (evidence.mutationEvents.length > 0) {
      const e = evidence.mutationEvents[0];
      return `${e.name} event observed.`;
    }
    if (evidence.inspectionEvents.length > 0) return 'Inspection event observed.';
  }
  if (status === 'FAIL') {
    const failed = evidence.failureEvents.find(e => isVerificationCommand(e.command));
    if (failed) return `Verification command "${failed.command || 'shell'}" FAILED.`;
  }
  // NEEDS_CHECK
  const missing = [];
  if (evidence.verificationShellEvents.length === 0) missing.push('no runtime verification command');
  if (evidence.mutationEvents.length === 0) missing.push('no file mutation event');
  if (evidence.failureEvents.length > 0) missing.push(`${evidence.failureEvents.length} failed tool event(s)`);
  return missing.length > 0 ? missing.join('; ') : 'no matching runtime evidence';
}

function statusGap(status, criterion, evidence) {
  if (status === 'PASS') return null;
  if (status === 'FAIL') {
    const firstFail = evidence.failureEvents.find(e => isVerificationCommand(e.command));
    return firstFail
      ? `Command "${firstFail.command || 'shell'}" failed. Re-run the verification after fixing.`
      : `Failed tool events: ${evidence.failureEvents.length}.`;
  }
  // NEEDS_CHECK
  if (evidence.verificationShellEvents.length === 0 && evidence.mutationEvents.length > 0) {
    return `You changed files but have not run any verification command (test/lint/build/typecheck). Run one now to confirm the criterion.`;
  }
  return `No observable tool event matching this criterion. Either invoke the relevant tool or tighten the criterion.`;
}

function drawConclusion(results) {
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const needsCheck = results.filter(r => r.status === 'NEEDS_CHECK').length;

  if (fail > 0) {
    return {
      verdict: 'FAIL',
      summary: `${fail} criterion/criteria FAILED runtime verification.`,
      action: 'Fix the failing verifications and re-run the verification tool to confirm.',
    };
  }
  if (needsCheck > 0) {
    return {
      verdict: 'NEED_MORE_INFO',
      summary: `${pass}/${results.length} criteria have runtime evidence; ${needsCheck} lack observable verification.`,
      action: 'Run a shell/pty command that exercises the criterion — or invoke the relevant tool — then re-run verify.',
    };
  }
  return {
    verdict: 'PASS',
    summary: `All ${results.length} criteria are supported by runtime tool events.`,
    action: 'You may now produce a final answer including a summary of what changed and what passed.',
  };
}

function formatVerificationReport(claim, criteriaList, evidence, results, conclusion) {
  const lines = [];
  lines.push('# Verification Report (runtime tool events only)');
  lines.push('');
  lines.push(`> Claim: ${claim}`);
  lines.push('');
  lines.push(`> **Iron Law**: evidence is sourced only from the tool event stream. User-supplied "evidence" text is ignored.`);
  lines.push('');
  lines.push(`Total tool events observed: ${evidence.count}`);
  lines.push(`Successful mutations: ${evidence.mutationEvents.length} | Successful shells: ${evidence.shellEvents.length} | Verification commands: ${evidence.verificationShellEvents.length} | Inspections: ${evidence.inspectionEvents.length} | Failed events: ${evidence.failureEvents.length}`);
  lines.push('');
  lines.push('## Criteria');
  lines.push('');
  lines.push('| ID | Criterion | Status | Evidence | Gap |');
  lines.push('|----|-----------|--------|----------|-----|');
  for (const r of results) {
    const badge = r.status === 'PASS' ? ':white_check_mark: PASS'
      : r.status === 'FAIL' ? ':x: FAIL'
      : ':warning: NEEDS_CHECK';
    lines.push(`| ${r.id} | ${escapeCell(r.criterion)} | ${badge} | ${escapeCell(r.supportingEvidence)} | ${r.gap ? escapeCell(r.gap) : '-'} |`);
  }
  lines.push('');
  lines.push('## Conclusion');
  lines.push('');
  lines.push(`### ${conclusion.verdict}`);
  lines.push('');
  lines.push(conclusion.summary);
  lines.push('');
  lines.push(`**Action**: ${conclusion.action}`);
  lines.push('');
  lines.push('## Raw tool event names (for debugging)');
  lines.push('');
  lines.push('```');
  lines.push(evidence.eventNames.join(', ') || '(none)');
  lines.push('```');
  return lines.join('\n');
}

function escapeCell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n) + '...';
}
