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

import {
  RUNTIME_VERIFICATION_COMMAND_PATTERNS,
  isRuntimeVerificationCommand,
} from '../../../../utils/patterns.js';
import { isStrictMutation as isSemanticsStrictMutation } from './tool-semantics.js';

const RUNTIME_VERIFICATION_TOOL_NAMES = new Set(['verify']);

const MUTATION_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'git_apply_patch',
  'git_commit',
  'git_push',
]);

const METHODOLOGY_TOOL_NAMES = new Set([
  'coverage_check',
  'auto_research',
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
  'impact_map',
  'project_profile',
  'risk_check',
  'test_strategy',
  'migration_plan',
  'release_checklist',
  'ui_acceptance',
  'data_contract_check',
  'security_review',
  'caveman',
  'handoff',
  'resolve_test_contract',
]);

const SEMANTIC_REVIEW_TOOL_NAMES = new Set(['review']);

function extractCommand(event) {
  if (!event || !event.args) {
    return '';
  }
  return String(
    event.args.command || event.args.input || event.args.text || event.args.cmd || '',
  ).toLowerCase();
}

function isVerificationCommandEvent(event) {
  if (!event || !event.name) return false;
  if (!['shell', 'pty_start', 'pty_write', 'pty_read'].includes(event.name)) return false;
  const command = extractCommand(event);
  return Boolean(command) && isRuntimeVerificationCommand(command);
}

function normalizeVerificationCommand(event) {
  return extractCommand(event).replace(/\s+/g, ' ').trim();
}

function commandRunner(command) {
  return (
    normalizeVerificationCommand({ args: { command } })
      .match(/^(npm|bun|pnpm|yarn)\b/i)?.[1]
      ?.toLowerCase() || null
  );
}

function isObservedFailure(event) {
  if (event?.success === false) return true;
  const preview = String(event?.resultPreview || event?.result || '');
  return (
    /"?(exitCode|exit_code)"?\s*[:=]\s*[1-9]\d*/i.test(preview) ||
    /\b(?:tests? failed|failures?:|referenceerror|typeerror|assertionerror)\b/i.test(preview)
  );
}

const MANAGED_CONFIG_PATH_RE =
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|pyproject\.toml|poetry\.lock|requirements(?:-[\w.-]+)?\.txt)$/i;

const MANAGED_CONFIG_SYNC_COMMAND_RE =
  /\b((npm|pnpm|yarn|bun)\s+(install|i|add|remove|uninstall|update)|go\s+(mod\s+tidy|get|mod\s+download)|cargo\s+(update|add|remove|fetch|build|test)|poetry\s+(install|add|remove|update)|uv\s+sync|pipenv\s+install|pip\s+install)\b/i;

function extractPathCandidates(event) {
  const args = event?.args || {};
  const candidates = [
    args.path,
    args.file_path,
    args.file,
    args.filename,
    args.filePath,
    args.target,
  ].filter(Boolean);

  const patchText = String(args.patch || args.content || '');
  for (const match of patchText.matchAll(/^\[([^#\]\r\n]+)#/gm)) {
    candidates.push(match[1]);
  }

  return candidates.map((candidate) => String(candidate).replace(/\\/g, '/'));
}

export function isManagedConfigMutationEvent(event) {
  if (!isMutationEvent(event)) {
    return false;
  }
  return extractPathCandidates(event).some((candidate) => MANAGED_CONFIG_PATH_RE.test(candidate));
}

export function isManagedConfigSyncEvent(event) {
  if (!event || event.success === false) {
    return false;
  }
  if (
    event.name !== 'shell' &&
    event.name !== 'pty_start' &&
    event.name !== 'pty_write' &&
    event.name !== 'pty_read'
  ) {
    return false;
  }
  return MANAGED_CONFIG_SYNC_COMMAND_RE.test(extractCommand(event));
}

export function isMutationEvent(event) {
  if (!event || !event.name) {
    return false;
  }
  if (event.success === false) {
    return false;
  }

  // 委托给 tool-semantics.js 的 isStrictMutation（事件级别包装：含 success 检查）
  return isSemanticsStrictMutation(event.name, event.args);
}

export function isRuntimeVerificationEvent(event) {
  if (!event || !event.name) {
    return false;
  }
  if (event.success === false) {
    return false;
  }

  if (RUNTIME_VERIFICATION_TOOL_NAMES.has(event.name)) {
    return true;
  }

  if (
    event.name === 'shell' ||
    event.name === 'pty_start' ||
    event.name === 'pty_write' ||
    event.name === 'pty_read'
  ) {
    const cmd = extractCommand(event);
    if (!cmd) {
      return false;
    }
    return isRuntimeVerificationCommand(cmd);
  }

  return false;
}

export function isMethodologyEvent(event) {
  if (!event || !event.name) {
    return false;
  }
  if (event.success === false) {
    return false;
  }
  return METHODOLOGY_TOOL_NAMES.has(event.name);
}

export function isSemanticRiskReviewEvent(event) {
  if (!event || event.name !== 'review') {
    return false;
  }
  if (event.success === false) {
    return false;
  }

  const focusAreas = String(event.args?.focus_areas || '').toLowerCase();
  if (!focusAreas) {
    return true;
  }

  const semanticKeywords = [
    'semantic',
    'api',
    'security',
    'state',
    'concurrency',
    'async',
    'timing',
    'unit',
    'invariant',
    'boundary',
    '语义',
    '安全',
    '状态',
    '并发',
    '边界',
  ];
  return semanticKeywords.some((k) => focusAreas.includes(k));
}

function eventOrder(event) {
  return Number.isFinite(event?.sequence)
    ? event.sequence
    : Number.isFinite(event?.iteration)
      ? event.iteration
      : Number.isFinite(event?.timestamp)
        ? event.timestamp
        : -1;
}

function hasRuntimeVerificationAfterLastMutation(events) {
  let lastMutationIndex = -1;
  let lastMutationOrder = -1;

  events.forEach((event, index) => {
    if (!isMutationEvent(event)) {
      return;
    }
    lastMutationIndex = index;
    lastMutationOrder = Math.max(lastMutationOrder, eventOrder(event));
  });

  if (lastMutationIndex < 0) {
    return false;
  }

  return events.some((event, index) => {
    if (!isRuntimeVerificationEvent(event)) {
      return false;
    }
    const order = eventOrder(event);
    if (lastMutationOrder >= 0 && order >= 0) {
      return order > lastMutationOrder;
    }
    return index > lastMutationIndex;
  });
}

function strictRepairEvidence(events) {
  const firstMutationIndex = events.findIndex(isMutationEvent);
  let lastMutationIndex = -1;
  events.forEach((event, index) => {
    if (isMutationEvent(event)) lastMutationIndex = index;
  });

  const baselineEvents = events.filter(
    (event, index) =>
      index < firstMutationIndex && isVerificationCommandEvent(event) && isObservedFailure(event),
  );
  const postMutationEvents = events.filter(
    (event, index) =>
      index > lastMutationIndex && event.success !== false && isRuntimeVerificationEvent(event),
  );
  const postMutationCommands = [
    ...new Set(postMutationEvents.map(normalizeVerificationCommand).filter(Boolean)),
  ];
  const postMutationRunners = [...new Set(postMutationCommands.map(commandRunner).filter(Boolean))];
  const decisionIndex = events.findIndex(
    (event) => event.name === 'resolve_test_contract' && event.success !== false,
  );
  const decisionEvent = decisionIndex >= 0 ? events[decisionIndex] : null;
  const selectedRunner = String(decisionEvent?.args?.authoritative_runner || '')
    .trim()
    .toLowerCase();
  const declaredRunners = Array.isArray(decisionEvent?.args?.declared_runners)
    ? decisionEvent.args.declared_runners.map((runner) => String(runner).trim().toLowerCase())
    : [];
  const hasValidContractDecision = Boolean(
    decisionEvent &&
    decisionIndex < firstMutationIndex &&
    declaredRunners.length >= 2 &&
    declaredRunners.includes(selectedRunner) &&
    String(decisionEvent.args?.rationale || '').trim().length >= 12 &&
    Array.isArray(decisionEvent.args?.sync_targets),
  );
  const syncTargets = hasValidContractDecision
    ? decisionEvent.args.sync_targets.map((target) => String(target).replace(/\\/g, '/'))
    : [];
  const mutatedPaths = new Set(events.filter(isMutationEvent).flatMap(extractPathCandidates));
  const missingContractSyncTargets = syncTargets.filter((target) => !mutatedPaths.has(target));

  return {
    hasPreMutationBaseline: firstMutationIndex > 0 && baselineEvents.length > 0,
    baselineCommands: [...new Set(baselineEvents.map(normalizeVerificationCommand))],
    postMutationVerificationCount: postMutationCommands.length,
    postMutationVerificationCommands: postMutationCommands,
    postMutationRunners,
    hasValidContractDecision,
    authoritativeTestRunner: hasValidContractDecision ? selectedRunner : null,
    contractDecisionSyncTargets: syncTargets,
    missingContractSyncTargets,
  };
}

function hasManagedConfigSyncAfterLastMutation(events) {
  let lastManagedConfigMutationIndex = -1;
  let lastManagedConfigMutationOrder = -1;

  events.forEach((event, index) => {
    if (!isManagedConfigMutationEvent(event)) {
      return;
    }
    lastManagedConfigMutationIndex = index;
    lastManagedConfigMutationOrder = Math.max(lastManagedConfigMutationOrder, eventOrder(event));
  });

  if (lastManagedConfigMutationIndex < 0) {
    return false;
  }

  return events.some((event, index) => {
    if (!isManagedConfigSyncEvent(event)) {
      return false;
    }
    const order = eventOrder(event);
    if (lastManagedConfigMutationOrder >= 0 && order >= 0) {
      return order > lastManagedConfigMutationOrder;
    }
    return index > lastManagedConfigMutationIndex;
  });
}

export function summarizeEvidence(toolEvents = []) {
  const events = Array.isArray(toolEvents) ? toolEvents : [];

  const successful = events.filter((e) => e.success !== false);
  const mutations = successful.filter(isMutationEvent);
  const runtimeVerifications = successful.filter(isRuntimeVerificationEvent);
  const methodologyEvents = successful.filter(isMethodologyEvent);
  const semanticRiskReviews = successful.filter(isSemanticRiskReviewEvent);
  const managedConfigMutations = successful.filter(isManagedConfigMutationEvent);
  const managedConfigSyncEvents = successful.filter(isManagedConfigSyncEvent);

  return {
    totalSuccessfulEvents: successful.length,
    mutationEvents: mutations.map((e) => ({ name: e.name, preview: e.resultPreview })),
    runtimeVerificationEvents: runtimeVerifications.map((e) => ({
      name: e.name,
      preview: e.resultPreview,
    })),
    methodologyEvents: methodologyEvents.map((e) => ({ name: e.name })),
    semanticRiskReviewEvents: semanticRiskReviews.map((e) => ({ name: e.name })),
    hasMutation: mutations.length > 0,
    hasRuntimeVerification: runtimeVerifications.length > 0,
    hasRuntimeVerificationAfterLastMutation: hasRuntimeVerificationAfterLastMutation(successful),
    hasManagedConfigMutation: managedConfigMutations.length > 0,
    hasManagedConfigSync: managedConfigSyncEvents.length > 0,
    hasManagedConfigSyncAfterLastMutation: hasManagedConfigSyncAfterLastMutation(successful),
    hasMethodologyTool: methodologyEvents.length > 0,
    hasSemanticRiskReview: semanticRiskReviews.length > 0,
    verificationCommands: [
      ...new Set(runtimeVerifications.map((e) => extractCommand(e)).filter(Boolean)),
    ].slice(0, 10),
    ...strictRepairEvidence(events),
  };
}

export function checkCompletionGates(toolEvents, gates, profile = {}) {
  const summary = summarizeEvidence(toolEvents);
  const missing = [];

  if (gates.requireMutation && profile.isModificationTask !== false) {
    if (!summary.hasMutation) {
      missing.push('no_code_mutation');
    }
  }

  if (gates.requireRuntimeVerification && summary.hasMutation) {
    if (!summary.hasRuntimeVerification) {
      missing.push('no_runtime_verification');
    } else if (!summary.hasRuntimeVerificationAfterLastMutation) {
      missing.push('no_runtime_verification_after_last_mutation');
    }
  }

  if (
    gates.requireManagedConfigSync !== false &&
    summary.hasManagedConfigMutation &&
    !summary.hasManagedConfigSyncAfterLastMutation
  ) {
    missing.push('managed_config_sync_missing');
  }
  if (gates.requireMethodologyTool && !summary.hasMethodologyTool) {
    missing.push('no_methodology_tool');
  }

  if (gates.requireSemanticRiskReview && !summary.hasSemanticRiskReview) {
    missing.push('no_semantic_risk_review');
  }

  if (gates.requirePreMutationBaseline && summary.hasMutation && !summary.hasPreMutationBaseline) {
    missing.push('no_pre_mutation_failure_baseline');
  }

  const requiredPostMutationVerifications = Number(gates.requiredPostMutationVerifications || 0);
  if (
    summary.hasMutation &&
    requiredPostMutationVerifications > 0 &&
    summary.postMutationVerificationCount < requiredPostMutationVerifications
  ) {
    missing.push('insufficient_post_mutation_verification_matrix');
  }

  const requiredRunners = Array.isArray(gates.requiredTestRunners) ? gates.requiredTestRunners : [];
  if (gates.requireTestContractDecision && !summary.hasValidContractDecision) {
    missing.push('test_contract_decision_missing_or_late');
  }
  if (
    gates.requireTestContractDecision &&
    summary.hasValidContractDecision &&
    summary.missingContractSyncTargets.length > 0
  ) {
    missing.push(`test_contract_sync_missing:${summary.missingContractSyncTargets.join(',')}`);
  }
  const effectiveRequiredRunners = summary.hasValidContractDecision
    ? [summary.authoritativeTestRunner]
    : requiredRunners;
  const missingRunners = effectiveRequiredRunners.filter(
    (runner) => !summary.postMutationRunners.includes(String(runner).toLowerCase()),
  );
  if (summary.hasMutation && missingRunners.length > 0) {
    missing.push(`declared_test_runners_not_verified:${missingRunners.join(',')}`);
  }

  return {
    block: missing.length > 0,
    missing,
    reason: missing.length > 0 ? missing.join(', ') : null,
    summary,
  };
}

export function crossCheckVerifyClaim(claimText, toolEvents = []) {
  const warnings = [];
  const summary = summarizeEvidence(toolEvents);
  const text = String(claimText || '').toLowerCase();

  const impliesTestPass =
    /(test.*pass|pass.*test|all test|测试通过|测试成功|build.*success|编译通过|lint.*ok)/i.test(
      text,
    );
  if (impliesTestPass && !summary.hasRuntimeVerification) {
    warnings.push('claim_mentions_tests_but_no_runtime_verification_event');
  }

  const impliesMutation =
    /(change|modified|created|added|implement|fixed|wrote|写了|创建|修改|实现|修复)/i.test(text);
  if (impliesMutation && !summary.hasMutation) {
    warnings.push('claim_mentions_mutation_but_no_mutation_event');
  }

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

export function finalAnswerMentionsVerification(finalAnswerText, hasMutation) {
  if (!hasMutation) {
    return { ok: true };
  }

  const text = String(finalAnswerText || '').toLowerCase();
  const mentions = [
    /\b(test|tests|testing|ran test|pass|fail)\b/i,
    /\b(lint|eslint|typecheck|tsc|build|compile)\b/i,
    /\b(verify|verified|verification|checked|check)\b/i,
    /(验证|测试|检查|编译|构建)/i,
  ].some((p) => p.test(text));

  return { ok: mentions, reason: mentions ? null : 'final_answer_missing_verification_summary' };
}

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

// 注意：MUTATION_SHELL_COMMAND_PATTERNS 已不再从此模块 re-export
//（mutation 判断已统一委托给 tool-semantics.js）
// 如需外部使用，请直接从 utils/patterns.js 导入，或使用 tool-semantics.js 的 getToolEffect()
export { RUNTIME_VERIFICATION_COMMAND_PATTERNS };
