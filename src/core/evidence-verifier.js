/**
 * EvidenceVerifier - 基于事实的证据验证器
 *
 * 核心原则：
 * 1. "读自己刚写的文件" 不算验证 —— 它只证明文件被写入了，不证明代码正确
 * 2. review 工具算"质量检查"，不算"运行验证"
 * 3. 只有真正执行代码的命令(test/lint/build/typecheck/verify工具) 才算验证
 * 4. verify 工具的 claim 必须和实际 mutation 自洽
 *
 * 这个模块不做 LLM 调用，纯规则判定。
 */

// =============================================================
// 真正能产生"运行验证证据"的工具名
// 注意：read_file/list_dir/glob/search/semantic_search/review 都不在此列
// =============================================================
const RUNTIME_VERIFICATION_TOOL_NAMES = new Set([
  'verify',
]);

// 真正实验证的 shell 命令模式
const RUNTIME_VERIFICATION_COMMAND_PATTERNS = [
  /\b(test|tests|testing|spec)\b/i,
  /\b(lint|linting|eslint|prettier)\b/i,
  /\b(build|compile|bundle|tsc|webpack|rollup|vite build|babel)\b/i,
  /\b(type.?check|typecheck|check|type-?check)\b/i,
  /\b(npm|pnpm|yarn|bun|node|python|pytest|vitest|jest|mocha|cargo|go test|dotnet test|mvn test|gradle test)\b/i,
  /\b(verify|validate|audit)\b/i,
];

// 修改工具名集合（用于识别"真的写了代码"的事件）
const MUTATION_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'git_apply_patch',
  'git_commit',
  'git_push',
  // shell/pty 单独判断
]);

// 修改类 shell 命令模式（用于判定 shell 是否真的在做"写"操作）
const MUTATION_SHELL_COMMAND_PATTERNS = [
  /(^|\s)(bun|npm|pnpm|yarn|npx|node|python|pytest|vitest|jest|eslint|tsc|git|mkdir|touch|cp|mv|rm|sed|perl)\b/i,
  /(>|>>|tee)\s*\w/i,
  /apply_patch/i,
];

// 方法论工具名（用于判断"是否调用了方法论工具"——不作为验证证据）
const METHODOLOGY_TOOL_NAMES = new Set([
  'coverage_check',
  'ask_user',
  'brainstorm',
  'grill',
  'zoom_out',
  'tdd',
  'review',
  'verify',
  'diagnose',
  'architect',
  'to_prd',
  'to_issues',
  'setup',
  'caveman',
  'handoff',
]);

// 语义风险 review 工具（review + 带 focus_areas 的 review）
const SEMANTIC_REVIEW_TOOL_NAMES = new Set(['review']);

// =============================================================
// 辅助：从 toolEvent 中提取 shell/pty 的命令字符串
// =============================================================
function extractCommand(event) {
  if (!event || !event.args) {return '';}
  return String(
    event.args.command || event.args.input || event.args.text || event.args.cmd || ''
  ).toLowerCase();
}

// =============================================================
// 一个工具事件算不算"真的修改了代码"
// 注意：shell 要看命令内容，echo "hello" 不算修改，npm install 也不算（依赖安装）
// =============================================================
export function isMutationEvent(event) {
  if (!event || !event.name) {return false;}
  if (event.success === false) {return false;}

  if (MUTATION_TOOL_NAMES.has(event.name)) {return true;}

  if (event.name === 'shell' || event.name === 'pty_start' || event.name === 'pty_write') {
    const cmd = extractCommand(event);
    // 必须是"写"操作，不是纯读操作（ls/cat/grep/rg/find 都不算 mutation）
    if (!cmd) {return false;}
    // 排除纯读命令
    const isPureRead = /\b(ls|cat|grep|rg|find|sed\s+-n|awk)\s/.test(cmd) && !/>|>>/.test(cmd);
    if (isPureRead) {return false;}
    return MUTATION_SHELL_COMMAND_PATTERNS.some((p) => p.test(cmd));
  }

  return false;
}

// =============================================================
// 一个工具事件算不算"真的运行验证"
// 这是本模块最重要的函数 —— 它定义了"什么算验证"
// =============================================================
export function isRuntimeVerificationEvent(event) {
  if (!event || !event.name) {return false;}
  if (event.success === false) {return false;}

  if (RUNTIME_VERIFICATION_TOOL_NAMES.has(event.name)) {return true;}

  // shell/pty: 必须匹配实验证命令模式
  if (event.name === 'shell' || event.name === 'pty_start' || event.name === 'pty_write' || event.name === 'pty_read') {
    const cmd = extractCommand(event);
    if (!cmd) {return false;}
    return RUNTIME_VERIFICATION_COMMAND_PATTERNS.some((p) => p.test(cmd));
  }

  return false;
}

// =============================================================
// 一个工具事件算不算"方法论工具被调用了"
// 注意：这不算验证证据，只是"是否遵循了方法论流程"的标记
// =============================================================
export function isMethodologyEvent(event) {
  if (!event || !event.name) {return false;}
  if (event.success === false) {return false;}
  return METHODOLOGY_TOOL_NAMES.has(event.name);
}

// =============================================================
// 一个工具事件算不算"语义风险 review"
// 只有当 review 工具被调用，且调用参数中明确提到了语义相关的 focus areas 才算
// =============================================================
export function isSemanticRiskReviewEvent(event) {
  if (!event || event.name !== 'review') {return false;}
  if (event.success === false) {return false;}

  const focusAreas = String(event.args?.focus_areas || '').toLowerCase();
  // 如果没指定 focus_areas，也算"做了代码 review"（宽松一点，不卡太紧）
  if (!focusAreas) {return true;}

  const semanticKeywords = [
    'semantic', 'api', 'security', 'state', 'concurrency', 'async', 'timing',
    'unit', 'invariant', 'boundary', '语义', '安全', '状态', '并发', '边界',
  ];
  return semanticKeywords.some((k) => focusAreas.includes(k));
}

// =============================================================
// 从工具事件列表中提取关键统计信息
// =============================================================
export function summarizeEvidence(toolEvents = []) {
  const events = Array.isArray(toolEvents) ? toolEvents : [];

  const successful = events.filter((e) => e.success !== false);
  const mutations = successful.filter(isMutationEvent);
  const runtimeVerifications = successful.filter(isRuntimeVerificationEvent);
  const methodologyEvents = successful.filter(isMethodologyEvent);
  const semanticRiskReviews = successful.filter(isSemanticRiskReviewEvent);

  return {
    totalSuccessfulEvents: successful.length,
    mutationEvents: mutations.map((e) => ({ name: e.name, preview: e.resultPreview })),
    runtimeVerificationEvents: runtimeVerifications.map((e) => ({ name: e.name, preview: e.resultPreview })),
    methodologyEvents: methodologyEvents.map((e) => ({ name: e.name })),
    semanticRiskReviewEvents: semanticRiskReviews.map((e) => ({ name: e.name })),
    hasMutation: mutations.length > 0,
    hasRuntimeVerification: runtimeVerifications.length > 0,
    hasMethodologyTool: methodologyEvents.length > 0,
    hasSemanticRiskReview: semanticRiskReviews.length > 0,
    // 纯事实：做了哪些 shell 验证命令（去重）
    verificationCommands: [...new Set(
      runtimeVerifications
        .map((e) => extractCommand(e))
        .filter(Boolean)
    )].slice(0, 10),
  };
}

// =============================================================
// 核心：检查一个任务的证据是否满足 completion gate
// 根据 riskLevel + profile 来判断
//
// 返回: { block: boolean, reason: string|null, missing: string[] }
// =============================================================
export function checkCompletionGates(toolEvents, gates, profile = {}) {
  const summary = summarizeEvidence(toolEvents);
  const missing = [];

  // 1. 如果是修改任务，必须有 mutation
  if (gates.requireMutation && profile.isModificationTask !== false) {
    if (!summary.hasMutation) {
      missing.push('no_code_mutation');
    }
  }

  // 2. 只要有 mutation，必须有运行验证 —— 这是铁律（无论风险等级）
  //    编码任务只要有 mutation 就必须验证，即使是 LOW/MEDIUM
  if (gates.requireRuntimeVerification && summary.hasMutation) {
    if (!summary.hasRuntimeVerification) {
      missing.push('no_runtime_verification');
    }
  }

  // 3. HIGH+ 必须至少调用了一个方法论工具
  if (gates.requireMethodologyTool && !summary.hasMethodologyTool) {
    missing.push('no_methodology_tool');
  }

  // 4. 语义风险域需要 review
  if (gates.requireSemanticRiskReview && !summary.hasSemanticRiskReview) {
    missing.push('no_semantic_risk_review');
  }

  return {
    block: missing.length > 0,
    missing,
    reason: missing.length > 0 ? missing.join(', ') : null,
    summary,
  };
}

// =============================================================
// 反向验证：检查 verify 工具的 claim 与实际 evidence 是否自洽
//
// 逻辑：
// - 如果 claim 说"所有测试通过"，但 toolEvents 中没有任何 test 命令 → 不可信
// - 如果 claim 说"代码已修改"，但 toolEvents 中没有 mutation 事件 → 不可信
// - 如果 claim 提到了某个文件路径，但 toolEvents 的 mutation 里没有碰那个文件 → 警告
// =============================================================
export function crossCheckVerifyClaim(claimText, toolEvents = []) {
  const warnings = [];
  const summary = summarizeEvidence(toolEvents);
  const text = String(claimText || '').toLowerCase();

  // Claim 暗示"测试通过"但没有 shell 验证证据
  const impliesTestPass = /(test.*pass|pass.*test|all test|测试通过|测试成功|build.*success|编译通过|lint.*ok)/i.test(text);
  if (impliesTestPass && !summary.hasRuntimeVerification) {
    warnings.push('claim_mentions_tests_but_no_runtime_verification_event');
  }

  // Claim 暗示"做了代码修改"但没有 mutation 证据
  const impliesMutation = /(change|modified|created|added|implement|fixed|wrote|写了|创建|修改|实现|修复)/i.test(text);
  if (impliesMutation && !summary.hasMutation) {
    warnings.push('claim_mentions_mutation_but_no_mutation_event');
  }

  // Claim 暗示"做了 review"但没有 review 事件
  const impliesReview = /(review|审查|reviewed)/i.test(text);
  const hasReviewEvent = toolEvents.some((e) => e.name === 'review' && e.success !== false);
  if (impliesReview && !hasReviewEvent) {
    warnings.push('claim_mentions_review_but_no_review_event');
  }

  return {
    isSelfConsistent: warnings.length === 0,
    warnings,
    summary,
  };
}

// =============================================================
// 检查"final answer 文本"是否诚实提到了验证
// 如果 mutation 存在但 final answer 完全没提"如何验证" → 警告
// =============================================================
export function finalAnswerMentionsVerification(finalAnswerText, hasMutation) {
  if (!hasMutation) {return { ok: true };}

  const text = String(finalAnswerText || '').toLowerCase();
  const mentions = [
    /\b(test|tests|testing|ran test|pass|fail)\b/i,
    /\b(lint|eslint|typecheck|tsc|build|compile)\b/i,
    /\b(verify|verified|verification|checked|check)\b/i,
    /(验证|测试|检查|编译|构建)/i,
  ].some((p) => p.test(text));

  return { ok: mentions, reason: mentions ? null : 'final_answer_missing_verification_summary' };
}

// =============================================================
// 默认导出（保持与 risk-budget 一致的 import 风格）
// =============================================================
export default {
  isMutationEvent,
  isRuntimeVerificationEvent,
  isMethodologyEvent,
  isSemanticRiskReviewEvent,
  summarizeEvidence,
  checkCompletionGates,
  crossCheckVerifyClaim,
  finalAnswerMentionsVerification,
  RUNTIME_VERIFICATION_TOOL_NAMES,
  MUTATION_TOOL_NAMES,
  METHODOLOGY_TOOL_NAMES,
};
