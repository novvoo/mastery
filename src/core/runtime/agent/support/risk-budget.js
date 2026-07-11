/**
 * RiskBudget - 基于风险的任务分层系统
 *
 * 核心思想：方法论工具不应该是默认流程，而是按"风险预算"按需激活。
 * - LOW:    fast path，读改验，不调用方法论工具
 * - MEDIUM: 修改后触发 review/verify/diagnose
 * - HIGH:   前置 grill/zoom_out，事后 review/verify
 * - CRITICAL: architect + tdd + grill，全流程
 *
 * 风险评估分两阶段：
 * 1) quickAssess - 纯文本，<5ms，零工具调用，决定首步行动
 * 2) deepAssess  - 轻量代码扫描，不阻塞首步，迭代中动态调整
 *
 * 重构说明：
 * - 新增 classifyTask 整合：将纯文本分类与风险评分分离
 * - quickAssess 现在同时返回 riskProfile（旧字段兼容）和 taskProfile（新结构）
 * - 策略决策应优先使用 taskProfile，只有在需要风险评分时才使用 riskProfile
 */

import { MAX_ITERATIONS_DEFAULT } from '../../../agent/constants.js';
import {
  CODING_CONTEXT_KEYWORDS,
  CODING_VERB_CONTEXT_PATTERNS,
  CODING_KEYWORDS,
  MODIFICATION_VERB_PATTERNS,
  READ_ONLY_PATTERNS,
  PLAN_BLACKLIST_PATTERNS,
  SEMANTIC_RISK_DOMAINS,
  HIGH_RISK_FILE_PATTERNS,
  LOW_RISK_FILE_PATTERNS,
  TRIVIAL_TEXT_PATTERNS,
  isCliCommand as isCliCommandUtil,
  isInPlanBlacklist as isInPlanBlacklistUtil,
  inferSemanticRiskDomains as inferSemanticRiskDomainsUtil,
} from '../../../../utils/patterns.js';
import { classifyTask, TaskMode, TaskIntent } from './task-profile.js';

export const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

export const ITERATION_RATIO = {
  [RISK_LEVEL.LOW]: 1.0,
  [RISK_LEVEL.MEDIUM]: 1.0,
  [RISK_LEVEL.HIGH]: 1.0,
  [RISK_LEVEL.CRITICAL]: 1.0,
};

export function isCliCommand(userInput) {
  return isCliCommandUtil(userInput);
}

export function isInPlanBlacklist(userInput) {
  return isInPlanBlacklistUtil(userInput);
}

const TEXT_RISK_FACTORS = [
  {
    id: 'bug_keywords',
    weight: 3,
    test: (t) =>
      /\b(bug|error|crash|hang|stuck|broken|fail)\b/.test(t) ||
      /(报错|错误|崩溃|卡住|修复)/.test(t),
  },
  {
    id: 'explicit_refactor',
    weight: 3,
    test: (t) => /\b(refactor|rewrite)\b/.test(t) || /(重构|重写)/.test(t),
  },
  {
    id: 'multi_artifact_keywords',
    weight: 2,
    test: (t) =>
      /(多个|多文件|拆分|分离|模块化|分层|接口|controller|route|schema|resolver|service|component|module|html.*js|js.*html|css|测试)/i.test(
        t,
      ),
  },
  {
    id: 'test_focus',
    weight: 2,
    test: (t) => /(测试|单元测试|集成测试|test.*pass|failing test|write test|add test)/i.test(t),
  },
  {
    id: 'security_keywords',
    weight: 5,
    test: (t) => /(安全|权限|认证|密钥|secret|auth|injection|xss|csrf|password)/i.test(t),
  },
];

export function quickAssess(userInput) {
  const text = String(userInput || '').toLowerCase();

  const cliCommand = isCliCommand(userInput);

  const isCodingTask = !cliCommand && CODING_KEYWORDS.some((p) => p.test(text));

  const hasModificationIntent = MODIFICATION_VERB_PATTERNS.some((p) => p.test(text));
  const isModificationTask = isCodingTask && hasModificationIntent;

  const isBugTask =
    !cliCommand &&
    (/\b(bug|error|exception|failed|failing|broken|hang|stuck)\b/.test(text) ||
      /(报错|错误|失败|崩溃|卡住|没响应|修复)/.test(text));

  const isLikelyTrivial = isCodingTask && TRIVIAL_TEXT_PATTERNS.some((p) => p.test(text));

  const isDocumentationTask =
    !cliCommand &&
    (/\b(readme|docs?|document|guide|tutorial|manual)\b/i.test(text) ||
      /(文档|说明|指南|教程)/.test(text));

  const isAnalysisTask =
    !cliCommand &&
    (/\b(review|audit|analyze|evaluate|inspect)\b/i.test(text) ||
      /(分析|审计|审查|评估)/.test(text));

  const isResearchTask =
    !cliCommand &&
    (/\b(research|explore|search|investigate)\b/i.test(text) ||
      /(研究|调研|探索|搜索|查找)/.test(text));

  const inPlanBlacklist = isInPlanBlacklist(userInput);
  const requiresPlanning = !cliCommand && !inPlanBlacklist;

  let score = 0;
  const reasons = [];

  if (isCodingTask && !isLikelyTrivial) {
    score += 3;
    reasons.push('coding_task_base');
  }

  for (const factor of TEXT_RISK_FACTORS) {
    if (factor.test(text)) {
      score += factor.weight;
      reasons.push(factor.id);
    }
  }

  const semanticDomains = inferSemanticRiskDomainsUtil(userInput);
  if (semanticDomains.length > 0 && !isLikelyTrivial) {
    const domainScore = semanticDomains.reduce((acc, d) => acc + d.weight, 0);
    score += domainScore;
    reasons.push(`semantic_domains:${semanticDomains.map((d) => d.id).join(',')}`);
  }

  const mentionsMultipleArtifacts =
    /(多个|多文件|拆分|分离|接口|controller|route|schema|resolver|service|component|module|html.*js|js.*html|css|测试)/i.test(
      text,
    ) ||
    /\b(multiple|separate|split|html.*js|js.*html|css|tests?|docs?|route|controller|schema|resolver|endpoint|component|service|module)\b/i.test(
      text,
    );
  if (mentionsMultipleArtifacts && isCodingTask && !isLikelyTrivial) {
    score += 2;
    reasons.push('multi_artifact_text');
  }

  if (
    /工程化|架构|生产级|生产环境|可扩展|可维护|健壮|健壮性|enterprise|production|architecture|scalable|maintainable|robust/i.test(
      text,
    ) &&
    isCodingTask &&
    !isLikelyTrivial
  ) {
    score += 4;
    reasons.push('engineering_keywords');
  }

  let riskLevel;
  if (!isCodingTask) {
    riskLevel = RISK_LEVEL.LOW;
  } else if (isLikelyTrivial) {
    riskLevel = score >= 5 ? RISK_LEVEL.MEDIUM : RISK_LEVEL.LOW;
  } else if (score >= 10) {
    riskLevel = RISK_LEVEL.CRITICAL;
  } else if (score >= 6) {
    riskLevel = RISK_LEVEL.HIGH;
  } else if (score >= 3) {
    riskLevel = RISK_LEVEL.MEDIUM;
  } else {
    riskLevel = RISK_LEVEL.LOW;
  }

  // === 结构化任务分类 (TaskProfile) ===
  // classifyTask 做更精确的意图分类（包括中文隐式修复表达），
  // 它的结果应覆盖 quickAssess 的粗粒度判断。
  const taskProfile = classifyTask(userInput);

  // taskProfile 的分类更精确，覆盖 quickAssess 的粗粒度结果
  const finalIsModificationTask = isModificationTask || taskProfile.mode === TaskMode.MUTATE;
  const finalIsCodingTask =
    isCodingTask ||
    taskProfile.mode === TaskMode.MUTATE ||
    taskProfile.mode === TaskMode.VERIFY ||
    taskProfile.mode === TaskMode.DIAGNOSE;
  const finalIsBugTask = isBugTask || taskProfile.intent === TaskIntent.CODE_MODIFICATION;

  return {
    riskLevel,
    score,
    reasons,
    semanticDomains,
    isCodingTask: finalIsCodingTask,
    isModificationTask: finalIsModificationTask,
    isBugTask: finalIsBugTask,
    isDocumentationTask,
    isAnalysisTask,
    isResearchTask,
    isLikelyTrivial,
    requiresPlanning,
    inPlanBlacklist,
    isInformationalQuery: !finalIsCodingTask,
    // === 结构化字段 ===
    taskProfile,
  };
}

export function deepAssess(quickResult, filePaths = []) {
  if (!quickResult || quickResult.riskLevel === undefined) {
    return quickResult || { riskLevel: RISK_LEVEL.LOW, score: 0, reasons: [] };
  }

  if (!quickResult.isCodingTask) {
    return quickResult;
  }

  let score = quickResult.score;
  const reasons = [...quickResult.reasons];

  const paths = Array.isArray(filePaths) ? filePaths : [];

  const touchedHighRisk = paths.filter((p) =>
    HIGH_RISK_FILE_PATTERNS.some((pattern) => pattern.test(p)),
  );
  if (touchedHighRisk.length > 0) {
    score += touchedHighRisk.length * 3;
    reasons.push(`core_files:${touchedHighRisk.length}`);
  }

  if (paths.length >= 5) {
    score += 3;
    reasons.push(`many_files:${paths.length}`);
  } else if (paths.length >= 3) {
    score += 1;
  }

  const allLowRisk =
    paths.length > 0 &&
    paths.every((p) => LOW_RISK_FILE_PATTERNS.some((pattern) => pattern.test(p)));
  if (allLowRisk) {
    score = Math.max(0, score - 3);
    reasons.push('data_files_only');
  }

  let riskLevel;
  if (quickResult.isLikelyTrivial && score < 5) {
    riskLevel = RISK_LEVEL.LOW;
  } else if (score >= 12) {
    riskLevel = RISK_LEVEL.CRITICAL;
  } else if (score >= 8) {
    riskLevel = RISK_LEVEL.HIGH;
  } else if (score >= 4) {
    riskLevel = RISK_LEVEL.MEDIUM;
  } else {
    riskLevel = RISK_LEVEL.LOW;
  }

  return {
    ...quickResult,
    riskLevel,
    score,
    reasons,
    deepAssessed: true,
    touchedHighRiskFileNames: touchedHighRisk.slice(0, 5),
    inPlanBlacklist: quickResult.inPlanBlacklist || false,
  };
}

const INTENT_CONFIDENCE_THRESHOLD = 0.75;

const CODING_INTENTS = new Set(['coding_task', 'local_file_task', 'terminal_task', 'git_task']);
const MODIFICATION_INTENTS = new Set(['coding_task', 'git_task']);

export function mergeIntentProfile(quickResult, intent, userInput = '') {
  if (!intent || typeof intent !== 'object') {
    return quickResult;
  }
  if (typeof intent.confidence === 'number' && intent.confidence < INTENT_CONFIDENCE_THRESHOLD) {
    return quickResult;
  }

  const intentName = intent.intent;
  if (!intentName || intentName === 'unknown') {
    return quickResult;
  }

  const cli = isCliCommand(userInput);
  if (cli) {
    return quickResult;
  }

  let isCodingByIntent = CODING_INTENTS.has(intentName);
  let isModificationByIntent = false;

  if (typeof intent.isCodingRelated === 'boolean') {
    isCodingByIntent = intent.isCodingRelated;
  }
  if (typeof intent.requiresCodeModification === 'boolean') {
    isModificationByIntent = intent.requiresCodeModification;
  } else {
    const normalizedText = String(intent.normalizedTask || userInput || '').toLowerCase();
    isModificationByIntent =
      MODIFICATION_INTENTS.has(intentName) ||
      MODIFICATION_VERB_PATTERNS.some((p) => p.test(normalizedText)) ||
      CODING_VERB_CONTEXT_PATTERNS.some((p) => p.test(normalizedText));

    const isReadOnly =
      !MODIFICATION_INTENTS.has(intentName) &&
      READ_ONLY_PATTERNS.some((p) => p.test(normalizedText));
    if (isReadOnly) {
      isModificationByIntent = false;
    }
  }

  const finalIsCoding = isCodingByIntent;
  const finalIsModification = finalIsCoding && isModificationByIntent;

  const semanticDomains = (quickResult && quickResult.semanticDomains) || [];
  const baseScore = (quickResult && quickResult.score) || 0;
  const baseReasons = (quickResult && quickResult.reasons) || [];

  let score = baseScore;
  const reasons = [...baseReasons];

  if (finalIsCoding && score < 3) {
    score = Math.max(score, 3);
    reasons.push(`intent:${intentName}`);
  }
  if (finalIsModification) {
    score = Math.max(score, 4);
    reasons.push(`intent:modification`);
  }

  const isLikelyTrivial = (quickResult && quickResult.isLikelyTrivial) || false;
  let riskLevel;
  if (isLikelyTrivial && score < 5) {
    riskLevel = RISK_LEVEL.LOW;
  } else if (score >= 12) {
    riskLevel = RISK_LEVEL.CRITICAL;
  } else if (score >= 8) {
    riskLevel = RISK_LEVEL.HIGH;
  } else if (score >= 4) {
    riskLevel = RISK_LEVEL.MEDIUM;
  } else {
    riskLevel = RISK_LEVEL.LOW;
  }

  // 合并 taskProfile：保留 quickResult 中的 taskProfile（已由 classifyTask 计算）
  const taskProfile = quickResult?.taskProfile;

  // taskProfile 的判断更精确，覆盖 LLM 和 quickAssess 的结果
  const finalIsModificationWithProfile =
    finalIsModification || taskProfile?.mode === TaskMode.MUTATE;
  const finalIsCodingWithProfile =
    finalIsCoding ||
    taskProfile?.mode === TaskMode.MUTATE ||
    taskProfile?.mode === TaskMode.VERIFY ||
    taskProfile?.mode === TaskMode.DIAGNOSE;
  const finalIsBugTask =
    quickResult?.isBugTask || false || taskProfile?.intent === TaskIntent.CODE_MODIFICATION;

  return {
    ...quickResult,
    isCodingTask: finalIsCodingWithProfile,
    isModificationTask: finalIsModificationWithProfile,
    isBugTask: finalIsBugTask,
    riskLevel,
    score,
    reasons,
    semanticDomains,
    intentMerged: true,
    intentSource: intentName,
    isInformationalQuery:
      intentName === 'explanation' || intentName === 'general_chat'
        ? true
        : (quickResult.isInformationalQuery ?? !finalIsCodingWithProfile),
    taskProfile,
  };
}

export function computeIterationBudget(
  riskLevelOrProfile,
  maxIterationsDefault = MAX_ITERATIONS_DEFAULT,
) {
  return Math.max(4, maxIterationsDefault || MAX_ITERATIONS_DEFAULT);
}

export function getCompletionGates(riskLevel, profile = {}) {
  const strictRepair =
    profile.isBugTask === true &&
    (riskLevel === RISK_LEVEL.HIGH || riskLevel === RISK_LEVEL.CRITICAL);
  const gates = {
    requireMutation: profile.isModificationTask !== false,
    requireRuntimeVerification: true,
    requireManagedConfigSync: true,
    requireMethodologyTool: false,
    requireSemanticRiskReview: (profile.semanticDomains || []).length > 0,
    requirePreMutationBaseline: strictRepair,
    requiredPostMutationVerifications: strictRepair ? 2 : 1,
    requiredTestRunners:
      strictRepair && profile.repairContract?.hasRunnerConflict
        ? profile.repairContract.runners
        : [],
    requireTestContractDecision: Boolean(strictRepair && profile.repairContract?.hasRunnerConflict),
  };

  return gates;
}

export function getMethodologyGuidance(riskLevel, profile = {}) {
  const domains = profile.semanticDomains || [];

  const lines = [
    'Use methodology tools selectively when they create useful evidence for the current risk:',
    '- Explore or design only when scope, architecture, or tradeoffs are unclear.',
    '- Make focused edits once the target is clear.',
    '- Inspect changed files for correctness.',
    '- Verify with tests, builds, scripts, or behavior-level checks before finishing.',
    '',
    'The execution plan is scheduling metadata, not a substitute for judgment.',
    'Before finishing a coding change, run the most relevant verification available and report its exact outcome.',
  ];

  if (domains.length > 0) {
    const checklist = domains.map((d) => `- ${d.label}: ${d.checklist}`).join('\n');
    lines.push(
      'Semantic risk domains detected. Before finishing, verify these specifically:\n' + checklist,
    );
  }

  return lines.join('\n');
}

export default {
  RISK_LEVEL,
  ITERATION_RATIO,
  SEMANTIC_RISK_DOMAINS,
  quickAssess,
  deepAssess,
  computeIterationBudget,
  getCompletionGates,
  getMethodologyGuidance,
  // 新增导出
  classifyTask,
  TaskMode,
  TaskIntent,
};

export {
  CODING_CONTEXT_KEYWORDS,
  CODING_VERB_CONTEXT_PATTERNS,
  CODING_KEYWORDS,
  MODIFICATION_VERB_PATTERNS,
  READ_ONLY_PATTERNS,
  PLAN_BLACKLIST_PATTERNS,
};
