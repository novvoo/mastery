import { RISK_LEVEL, getMethodologyGuidance } from '../runtime/agent/support/risk-budget.js';

export function buildSemanticRiskGuidance(domains = []) {
  if (domains.length === 0) {
    return '';
  }

  const checklist = domains.map((domain) => `- ${domain.label}: ${domain.checklist}`).join('\n');

  return (
    `Semantic/API risk review is required before completion because this task touches high-risk behavior semantics.\n` +
    `Risk domains:\n${checklist}\n` +
    `Do not hardcode isolated API trivia. Instead, inspect the changed code and verify whether variable units, API parameter meanings, state transitions, and user-visible behavior match the requested intent. ` +
    `Use review only when it adds real semantic evidence on changed files; then run behavior-level verification.`
  );
}

export function buildCodingTaskOperatingPrompt({
  userInput,
  hasMethodologyTools,
  profile = {},
  semanticRiskGuidance = '',
}) {
  const riskLevel = profile.riskLevel || RISK_LEVEL.MEDIUM;
  const methodologyLine = hasMethodologyTools
    ? getMethodologyGuidance(riskLevel, profile)
    : 'Methodology tools are not registered in this runtime; rely on direct repository evidence, focused edits, and runtime verification.';

  const strictRepair =
    profile.isBugTask && (riskLevel === RISK_LEVEL.HIGH || riskLevel === RISK_LEVEL.CRITICAL);
  const bugFixGuidance = strictRepair
    ? `STRICT BUG FIX TASK: Reproduce the failure first. Before any mutation, call analyze_test_failure to separate observed facts from evidence-backed hypotheses, then call decide_repair_plan to record supported root causes, the smallest complete approach, concrete changes, verification paths, and exclusions. These are engine-state artifacts, not report files. Only then implement and verify.\n`
    : profile.isBugTask
      ? `BUG FIX TASK: Read the relevant code, identify the root cause, apply the smallest complete fix, then verify. Do not create standalone report files unless requested.\n`
      : '';

  return (
    `Coding task mode is active for the previous user request:\n${userInput}\n\n` +
    `Risk level: ${riskLevel}. Act like a responsible coding agent.\n` +
    `\n` +
    `The engine has already pre-computed and injected workspace structure, LSP diagnostics, ` +
    `project memory, and import graph context. An execution plan with per-subtask file scope ` +
    `may also be active — the engine enforces file scope at the tool execution level.\n` +
    `\n` +
    `\n` +
    `- For refactoring/renames: use lsp_rename (auto-syncs all references+imports+barrels).\n` +
    `- For quick fixes: use lsp_code_action (organize imports, fix lint, etc.).\n` +
    `\n` +
    `CODE EDITING STRATEGY:\n` +
    `- For existing single-file changes: prefer edit_file or apply_hashline_patch after reading the relevant code. Use write_file only for new files, or for intentional full-file replacement with overwrite=true and overwrite_reason.\n` +
    `- For multi-file atomic patches: use apply_hashline_patch (includes preflight+diagnostics-gate).\n` +
    `- For managed project configuration and dependency manifests, prefer the ecosystem tool over hand-editing when a command exists: use the detected package manager (npm/pnpm/yarn/bun) to add/remove dependencies and update lockfiles instead of manually editing package.json, package-lock.json, pnpm-lock.yaml, yarn.lock, or bun.lock.\n` +
    `- If you must edit a managed config/manifest directly, run the corresponding apply/sync command before verification or completion when the ecosystem requires it (for example npm install, pnpm install, yarn install, bun install, go mod tidy, cargo update, or the framework's config-generation command). Do not claim the config change is active until that command succeeds or you report why it could not be run.\n` +
    `- When the user asked for a code change, make the smallest useful change and verify it; when a required fact is missing, gather that fact before editing.\n` +
    `\n` +
    bugFixGuidance +
    `${methodologyLine}\n` +
    `${profile.requiresSemanticRiskReview ? `${semanticRiskGuidance}\n` : ''}` +
    `For file creation, prefer write_file directly when available. For existing-file edits, prefer edit_file/apply_hashline_patch; shell is for inspection, commands, and verification, not a substitute for editing files.\n` +
    `Verification expectations:\n` +
    `1. Any code/file you write or edit MUST be inspected after creation (read_file, list_dir, or equivalent) to confirm the content matches your intent.\n` +
    `2. Inspection-only tools (read_file, list_dir, glob, search, semantic_search, review) are NOT runtime verification. Reading your own file back proves only that the file was written; it does NOT prove the code runs, compiles, passes tests, or behaves correctly.\n` +
    `3. True runtime verification means executing code against a real tool / shell command. Acceptable runtime verification evidence includes: a test runner (jest, vitest, pytest, cargo test, go test, mvn test, etc.), a linter (eslint, tsc --noEmit, flake8, golangci-lint, etc.), a build / compile step (npm run build, tsc, cargo build, go build, webpack, etc.), a node/python/go/java script that exercises the changed code, or the verify tool.\n` +
    `4. After every successful mutation (write_file, edit_file, shell/pty that writes code), you MUST produce at least one successful runtime verification observation before FINAL_ANSWER. Do not finish the task by only reading the file back.\n` +
    `5. If verification fails (tests fail, build errors, lint errors), fix the failure and re-verify. Do not report "completed" while verification is failing or un-run.\n` +
    `6. For files that cannot be run (pure data: .md, .txt, etc.), inspect the file with read_file/list_dir/parsing and honestly report that verification is inspection-only; do not claim "tested" or "verified" for a markdown or plain-text file.\n` +
    `7. The verify tool, if available, is especially valuable after editing because it produces an evidence-based report. Consider calling verify on the changed paths near the end of the task.\n` +
    `8. When this task has semantic risk domains (units/timing, API semantics, state transitions, concurrency/IO, security boundaries), run dedicated review or verification that exercises those behaviors, not just a syntax check.\n` +
    `Final answers must explicitly mention: (a) what files changed and how, (b) which runtime verification step was run and what it reported (command + outcome), and (c) any caveats or open issues. Never state "it works" without fresh runtime verification evidence from this session.`
  );
}

export function buildCodingCompletionGatePrompt({
  userInput,
  gate,
  semanticRiskGuidance = '',
  requiresSemanticRiskReview = false,
}) {
  const reasonText =
    {
      no_tool_evidence:
        'You are trying to finish a coding task without any successful tool evidence.',
      missing_methodology_step:
        'The final answer is missing enough planning, review, or verification evidence for this task.',
      missing_code_change: 'You have not produced a successful code/file change yet.',
      missing_verification:
        'You changed code/files but have not verified the result with fresh evidence.',
      no_runtime_verification_after_last_mutation:
        'You ran verification before the latest code/file change, but not after it.',
      managed_config_sync_missing:
        'A managed config or dependency manifest was edited manually, but no later ecosystem install/sync command succeeded.',
      test_failure_analysis_missing_invalid_or_late:
        'A strict bug fix requires a structured failure analysis tied to the observed failing command before code mutation.',
      repair_decision_missing_invalid_or_late:
        'A strict bug fix requires an evidence-based repair decision after failure analysis and before code mutation.',
      missing_semantic_risk_review:
        'This task touches high-risk behavior semantics but has no semantic/API risk review evidence yet.',
      final_answer_missing_verification_summary:
        'Your final answer claims completion but does not summarize verification.',
      automatic_plan_incomplete: 'The automatic task orchestration plan is not complete yet.',
    }[gate?.reason] ||
    gate?.reason ||
    'insufficient evidence';

  return (
    `Coding completion gate blocked the final answer.\n` +
    `Original user request: ${userInput}\n` +
    `Reason: ${reasonText}\n` +
    `Reason code: ${gate?.reason || 'unknown'}\n` +
    `Evidence so far: ${JSON.stringify(gate?.evidence || [])}\n\n` +
    `${requiresSemanticRiskReview ? `${semanticRiskGuidance}\n` : ''}` +
    `Continue working now. Choose the next evidence-producing step: make a scoped edit if the target is clear, inspect one missing fact if it is not, update the plan if the approach changed, run the required ecosystem install/sync command after managed config or manifest edits (for example npm install, pnpm install, yarn install, bun install), or run relevant runtime verification after a mutation. Only answer with FINAL_ANSWER after the evidence supports what changed, what was verified, and any caveats.`
  );
}
