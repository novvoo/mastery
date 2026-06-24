import { RISK_LEVEL, getMethodologyGuidance } from '../risk-budget.js';

export function buildSemanticRiskGuidance(domains = []) {
  if (domains.length === 0) {
    return '';
  }

  const checklist = domains.map((domain) => `- ${domain.label}: ${domain.checklist}`).join('\n');

  return (
    `Semantic/API risk review is required before completion because this task touches high-risk behavior semantics.\n` +
    `Risk domains:\n${checklist}\n` +
    `Do not hardcode isolated API trivia. Instead, inspect the changed code and verify whether variable units, API parameter meanings, state transitions, and user-visible behavior match the requested intent. ` +
    `Prefer CALL review({"file_path":"...","focus_areas":"semantic API semantics, units, timing, state invariants, behavior verification"}) on changed files, then run behavior-level verification.`
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
    : 'Use the same methodology directly in your reasoning because methodology tools are not registered in this runtime.';

  const bugFixGuidance = profile.isBugTask
    ? `BUG FIX TASK: Your job is to FIX the bug, not to write a diagnostic report. Read the code where the bug resides, identify the root cause, apply the fix, then verify. Do NOT spend iterations generating analysis reports — the user wants the bug fixed, not documented. A fixed bug with verification evidence is the only acceptable outcome.\n`
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
    `CODE EDITING STRATEGY (make changes, don't just analyze):\n` +
    `- For single-file changes: use write_file or edit_file.\n` +
    `- For multi-file atomic patches: use apply_hashline_patch (includes preflight+diagnostics-gate).\n` +
    `- Goal is to make the code change and verify it — not to write a diagnostic report.\n` +
    `\n` +
    bugFixGuidance +
    `${methodologyLine}\n` +
    `${profile.requiresSemanticRiskReview ? `${semanticRiskGuidance}\n` : ''}` +
    `For file creation or file edits, prefer write_file/edit_file directly when available; shell is for inspection, commands, and verification, not a substitute for editing files.\n` +
    `Strict verification rules — read these carefully and obey them every time:\n` +
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
      missing_methodology_step: 'You have not used the built-in coding methodology yet.',
      missing_code_change: 'You have not produced a successful code/file change yet.',
      missing_verification:
        'You changed code/files but have not verified the result with fresh evidence.',
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
    `Evidence so far: ${JSON.stringify(gate?.evidence || [])}\n\n` +
    `${requiresSemanticRiskReview ? `${semanticRiskGuidance}\n` : ''}` +
    `Continue working now. If this task creates or modifies a file and write_file/edit_file is available, call write_file or edit_file next to make the change. Inspect your own changes, run a relevant verification command or verify tool, and only then answer with FINAL_ANSWER including what changed and what passed.`
  );
}
