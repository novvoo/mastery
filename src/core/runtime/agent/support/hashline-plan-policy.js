export const HASHLINE_PLAN_COORDINATION_GUIDANCE =
  `Hashline and plan are one execution loop: the current plan task defines intent, scope, and completion criteria; apply_hashline_patch is the preferred fast edit vehicle once the task has enough context.\n` +
  `Use methodology tools to shape or validate the patch when the task is ambiguous, cross-module, risky, or has similar competing flows; then use hashline for the concrete code edit instead of bypassing the plan.\n` +
  `After every hashline edit, inspect/review/verify according to the next plan task. If hashline reports stale tags, conflicts, rollback, diagnostics failure, or the patch no longer matches the plan, call change_plan before continuing.`;

export const HASHLINE_PATCH_TOOL = 'apply_hashline_patch';

export function isHashlinePatchTool(toolName) {
  return String(toolName || '') === HASHLINE_PATCH_TOOL;
}

export function extractHashlinePatchPaths(args = {}) {
  const patch = typeof args?.patch === 'string' ? args.patch : '';
  if (!patch.trim()) {
    return [];
  }

  const paths = new Set();
  const sectionPattern = /^\[([^#\]\r\n]+)#[^\]\r\n]+\]/gm;
  let match;
  while ((match = sectionPattern.exec(patch)) !== null) {
    const path = match[1]?.trim();
    if (path) {
      paths.add(path);
    }
  }
  return Array.from(paths);
}

export function analyzeHashlinePatchResult(toolName, args = {}, result = null, error = null) {
  const isHashline = isHashlinePatchTool(toolName);
  const affectedFiles = isHashline ? extractHashlinePatchPaths(args) : [];
  if (!isHashline) {
    return {
      isHashline: false,
      ok: null,
      affectedFiles,
      conflictType: null,
      recovered: false,
      rolledBack: false,
      diagnosticsGate: null,
      usedOrchestrator: false,
      fallbackMode: false,
    };
  }

  const resultText = typeof result === 'string' ? result : result ? JSON.stringify(result) : '';
  const errorText = error
    ? typeof error === 'string'
      ? error
      : error.message || JSON.stringify(error)
    : '';
  const text = `${resultText}\n${errorText}`;
  const lower = text.toLowerCase();

  const rolledBack = /rolled back|rollback/.test(lower);
  const recovered = /recovered|auto-repaired|retry succeeded|自动修复/.test(lower);
  const fallbackMode = /patcher fallback|without lsp diagnostics gate/.test(lower);
  const usedOrchestrator = /editorchestrator/.test(lower);
  const diagnosticsGate = /diagnostics gate/.test(lower)
    ? /diagnostics gate:\s*passed|no new errors introduced/.test(lower)
    : null;

  let conflictType = null;
  if (/tag mismatch|tag_mismatch|stale tag/.test(lower)) {
    conflictType = 'tag_mismatch';
  } else if (/patch rejected|patch_rejected|preflight failed|apply failed/.test(lower)) {
    conflictType = 'patch_rejected';
  } else if (/diagnostics gate:.*new errors|new error|introduced/.test(lower)) {
    conflictType = 'diag_new_errors';
  } else if (/recovery failed|rollback/.test(lower)) {
    conflictType = 'recovery_failed';
  }

  const ok =
    !/^error[:\s]/i.test(resultText.trim()) &&
    !/hashline patch (?:failed|preflight failed|apply failed)/i.test(resultText) &&
    !rolledBack &&
    !error;

  return {
    isHashline: true,
    ok,
    affectedFiles,
    conflictType,
    recovered,
    rolledBack,
    diagnosticsGate,
    usedOrchestrator,
    fallbackMode,
  };
}
