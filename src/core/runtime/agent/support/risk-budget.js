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
 */

import { MAX_ITERATIONS_DEFAULT } from '../../../agent-constants.js';
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

export const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

export const ITERATION_RATIO = {
  [RISK_LEVEL.LOW]: 0.5,
  [RISK_LEVEL.MEDIUM]: 0.7,
  [RISK_LEVEL.HIGH]: 0.9,
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
    test: (t) => /\b(bug|error|crash|hang|stuck|broken|fail|报错|错误|崩溃|卡住|修复)\b/.test(t),
  },
  { id: 'explicit_refactor', weight: 3, test: (t) => /\b(refactor|重构|重写|rewrite)\b/.test(t) },
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
    /\b(bug|error|exception|failed|failing|broken|hang|stuck|报错|错误|失败|崩溃|卡住|没响应|修复)\b/.test(
      text,
    );

  const isLikelyTrivial = isCodingTask && TRIVIAL_TEXT_PATTERNS.some((p) => p.test(text));

  const isDocumentationTask =
    !cliCommand &&
    /\b(文档|readme|说明|指南|教程|docs?|document|guide|tutorial|manual)\b/i.test(text);

  const isAnalysisTask =
    !cliCommand &&
    /\b(分析|审计|审查|评估|review|audit|analyze|evaluate|inspect)\b/i.test(text);

  const isResearchTask =
    !cliCommand &&
    /\b(研究|调研|探索|搜索|查找|research|explore|search|investigate)\b/i.test(text);

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

  return {
    riskLevel,
    score,
    reasons,
    semanticDomains,
    isCodingTask,
    isModificationTask,
    isBugTask,
    isDocumentationTask,
    isAnalysisTask,
    isResearchTask,
    isLikelyTrivial,
    requiresPlanning,
    inPlanBlacklist,
    isInformationalQuery: !isCodingTask,
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

  return {
    ...quickResult,
    isCodingTask: finalIsCoding,
    isModificationTask: finalIsModification,
    riskLevel,
    score,
    reasons,
    semanticDomains,
    intentMerged: true,
    intentSource: intentName,
    isInformationalQuery:
      intentName === 'explanation' || intentName === 'general_chat'
        ? true
        : quickResult.isInformationalQuery ?? !finalIsCoding,
  };
}

export function computeIterationBudget(
  riskLevelOrProfile,
  maxIterationsDefault = MAX_ITERATIONS_DEFAULT,
) {
  const level =
    typeof riskLevelOrProfile === 'string' ? riskLevelOrProfile : riskLevelOrProfile?.riskLevel;

  const ratio = ITERATION_RATIO[level] ?? ITERATION_RATIO[RISK_LEVEL.MEDIUM];
  return Math.max(4, Math.round(maxIterationsDefault * ratio));
}

export function getCompletionGates(riskLevel, profile = {}) {
  const gates = {
    requireMutation: profile.isModificationTask !== false,
    requireRuntimeVerification: true,
    requireMethodologyTool: profile.isModificationTask !== false,
    requireSemanticRiskReview: (profile.semanticDomains || []).length > 0,
  };

  return gates;
}

export function getMethodologyGuidance(riskLevel, profile = {}) {
  const domains = profile.semanticDomains || [];

  const lines = [
    'All coding tasks follow the same methodology flow, driven by execution phases:',
    '- Exploration: use brainstorm/grill/zoom_out/architect if the scope is unclear.',
    '- Planning: use brainstorm/grill/architect/tdd to design the approach.',
    '- Implementation: make focused edits; use diagnose if you encounter issues.',
    '- Inspection: review changed files for correctness.',
    '- Verification: verify/review/coverage_check with real runtime evidence.',
    '',
    'The execution plan advances automatically; just follow the DAG.',
    'You MUST run a functional test at the final step before finishing — this is mandatory for all coding tasks.',
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
};

export {
  CODING_CONTEXT_KEYWORDS,
  CODING_VERB_CONTEXT_PATTERNS,
  CODING_KEYWORDS,
  MODIFICATION_VERB_PATTERNS,
  READ_ONLY_PATTERNS,
  PLAN_BLACKLIST_PATTERNS,
};