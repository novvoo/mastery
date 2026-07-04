export const PlanType = Object.freeze({
  STANDARD: 'standard',
  BUG_FIX: 'bug_fix',
  DOCUMENTATION: 'documentation',
  ANALYSIS: 'analysis',
  RESEARCH: 'research',
  VERIFICATION: 'verification',
  QUICK: 'quick',
  REFACTOR: 'refactor',
  TESTING: 'testing',
  CODE_REVIEW: 'code_review',
  MIGRATION: 'migration',
  SETUP: 'setup',
  RELEASE: 'release',
  SECURITY: 'security',
  DATA: 'data',
  UI: 'ui',
});

export const PLAN_TYPE_OPTIONS = Object.freeze([
  {
    id: PlanType.STANDARD,
    label: 'Standard coding plan',
    description: 'Inspect, plan, implement, inspect changes, and verify.',
  },
  {
    id: PlanType.BUG_FIX,
    label: 'Bug fix plan',
    description: 'Diagnose the failure path, implement the fix, inspect changes, and verify.',
  },
  {
    id: PlanType.DOCUMENTATION,
    label: 'Documentation plan',
    description: 'Inspect existing docs, plan structure, write documentation, and review it.',
  },
  {
    id: PlanType.ANALYSIS,
    label: 'Analysis plan',
    description: 'Gather context, analyze findings, and report without modifying files.',
  },
  {
    id: PlanType.RESEARCH,
    label: 'Research plan',
    description: 'Gather enough context to answer accurately without editing files.',
  },
  {
    id: PlanType.VERIFICATION,
    label: 'Verification plan',
    description: 'Inspect verification targets, run checks, and summarize results.',
  },
  {
    id: PlanType.QUICK,
    label: 'Quick edit plan',
    description: 'Use a shorter path for low-risk, obvious edits.',
  },
  {
    id: PlanType.REFACTOR,
    label: 'Refactor plan',
    description: 'Map current behavior, plan refactor slices, edit, review, and verify.',
  },
  {
    id: PlanType.TESTING,
    label: 'Testing plan',
    description: 'Inspect test surface, add or fix tests, run targeted checks, and report.',
  },
  {
    id: PlanType.CODE_REVIEW,
    label: 'Code review plan',
    description: 'Inspect changed code, review risks, and produce actionable findings.',
  },
  {
    id: PlanType.MIGRATION,
    label: 'Migration plan',
    description: 'Inventory old usage, plan migration steps, update code/data, and verify.',
  },
  {
    id: PlanType.SETUP,
    label: 'Setup plan',
    description: 'Inspect environment, configure dependencies, validate setup, and document usage.',
  },
  {
    id: PlanType.RELEASE,
    label: 'Release plan',
    description: 'Inspect release state, run checks, prepare versioning or packaging, and verify.',
  },
  {
    id: PlanType.SECURITY,
    label: 'Security plan',
    description: 'Inspect sensitive surfaces, apply secure changes, review risk, and verify.',
  },
  {
    id: PlanType.DATA,
    label: 'Data plan',
    description:
      'Inspect schemas or datasets, transform/query safely, validate results, and report.',
  },
  {
    id: PlanType.UI,
    label: 'UI plan',
    description: 'Inspect UI structure, implement visual/interaction changes, preview, and verify.',
  },
]);

const PLAN_TYPE_ALIASES = new Map([
  ['standard', PlanType.STANDARD],
  ['标准', PlanType.STANDARD],
  ['coding', PlanType.STANDARD],
  ['code', PlanType.STANDARD],
  ['default', PlanType.STANDARD],
  ['bug', PlanType.BUG_FIX],
  ['修复', PlanType.BUG_FIX],
  ['故障', PlanType.BUG_FIX],
  ['bugfix', PlanType.BUG_FIX],
  ['bug_fix', PlanType.BUG_FIX],
  ['fix', PlanType.BUG_FIX],
  ['diagnose', PlanType.BUG_FIX],
  ['diagnosis', PlanType.BUG_FIX],
  ['doc', PlanType.DOCUMENTATION],
  ['文档', PlanType.DOCUMENTATION],
  ['说明', PlanType.DOCUMENTATION],
  ['docs', PlanType.DOCUMENTATION],
  ['documentation', PlanType.DOCUMENTATION],
  ['readme', PlanType.DOCUMENTATION],
  ['analysis', PlanType.ANALYSIS],
  ['分析', PlanType.ANALYSIS],
  ['审计', PlanType.ANALYSIS],
  ['analyze', PlanType.ANALYSIS],
  ['audit', PlanType.ANALYSIS],
  ['research', PlanType.RESEARCH],
  ['研究', PlanType.RESEARCH],
  ['调研', PlanType.RESEARCH],
  ['answer', PlanType.RESEARCH],
  ['info', PlanType.RESEARCH],
  ['verify', PlanType.VERIFICATION],
  ['验证', PlanType.VERIFICATION],
  ['检查', PlanType.VERIFICATION],
  ['verification', PlanType.VERIFICATION],
  ['test', PlanType.VERIFICATION],
  ['quick', PlanType.QUICK],
  ['快速', PlanType.QUICK],
  ['简单', PlanType.QUICK],
  ['fast', PlanType.QUICK],
  ['simple', PlanType.QUICK],
  ['refactor', PlanType.REFACTOR],
  ['重构', PlanType.REFACTOR],
  ['rewrite', PlanType.REFACTOR],
  ['cleanup', PlanType.REFACTOR],
  ['testing', PlanType.TESTING],
  ['测试', PlanType.TESTING],
  ['tests', PlanType.TESTING],
  ['unit_test', PlanType.TESTING],
  ['code_review', PlanType.CODE_REVIEW],
  ['代码审查', PlanType.CODE_REVIEW],
  ['审查', PlanType.CODE_REVIEW],
  ['review', PlanType.CODE_REVIEW],
  ['review_code', PlanType.CODE_REVIEW],
  ['migration', PlanType.MIGRATION],
  ['迁移', PlanType.MIGRATION],
  ['migrate', PlanType.MIGRATION],
  ['setup', PlanType.SETUP],
  ['配置', PlanType.SETUP],
  ['初始化', PlanType.SETUP],
  ['configure', PlanType.SETUP],
  ['release', PlanType.RELEASE],
  ['发布', PlanType.RELEASE],
  ['部署', PlanType.RELEASE],
  ['deploy', PlanType.RELEASE],
  ['security', PlanType.SECURITY],
  ['安全', PlanType.SECURITY],
  ['认证', PlanType.SECURITY],
  ['auth', PlanType.SECURITY],
  ['data', PlanType.DATA],
  ['数据', PlanType.DATA],
  ['数据库', PlanType.DATA],
  ['database', PlanType.DATA],
  ['db', PlanType.DATA],
  ['ui', PlanType.UI],
  ['界面', PlanType.UI],
  ['前端', PlanType.UI],
  ['frontend', PlanType.UI],
]);

const SIGNAL_DEFINITIONS = Object.freeze({
  bug: [
    /\b(bug|error|exception|failed|failing|broken|crash|hang|stuck|regression)\b/i,
    /(报错|错误|失败|崩溃|卡住|没响应|回归)/i,
  ],
  docs: [/\b(readme|docs?|document|guide|manual|tutorial)\b/i, /(文档|说明|指南|教程|手册)/i],
  tests: [
    /\b(test|tests|unit test|integration test|e2e|jest|vitest|pytest|coverage)\b/i,
    /(测试|单元测试|集成测试|覆盖率)/i,
  ],
  review: [/\b(review|audit|inspect|评估)\b/i, /(审查|审计|检查|评审)/i],
  refactor: [/\b(refactor|rewrite|cleanup|simplify|dedupe)\b/i, /(重构|重写|清理|简化|去重)/i],
  migration: [
    /\b(migrate|migration|upgrade|downgrade|port|compatibility)\b/i,
    /(迁移|升级|降级|兼容)/i,
  ],
  setup: [
    /\b(setup|configure|install|bootstrap|init|environment|env)\b/i,
    /(配置|安装|初始化|环境)/i,
  ],
  release: [
    /\b(release|deploy|publish|package|version|changelog|ci|cd)\b/i,
    /(发布|部署|打包|版本|流水线)/i,
  ],
  security: [
    /\b(security|auth|permission|secret|password|token|csrf|xss|injection|oauth)\b/i,
    /(安全|权限|认证|鉴权|密钥|密码|注入)/i,
  ],
  data: [
    /\b(database|db|sql|schema|migration|csv|json|dataset|etl|query|postgres|redis)\b/i,
    /(数据库|数据|表结构|查询|脚本|迁移)/i,
  ],
  ui: [
    /\b(ui|ux|frontend|react|component|layout|css|style|responsive|animation|button|modal)\b/i,
    /(界面|前端|组件|样式|布局|响应式|动画|按钮|弹窗)/i,
  ],
  api: [/\b(api|endpoint|route|controller|resolver|graphql|rest|webhook)\b/i, /(接口|路由|端点)/i],
  performance: [
    /\b(performance|latency|slow|cache|memory|optimi[sz]e)\b/i,
    /(性能|延迟|很慢|缓存|内存|优化)/i,
  ],
  research: [/\b(research|explore|investigate|find out|look up)\b/i, /(研究|调研|探索|查找|调查)/i],
  verifyOnly: [/\b(verify|validate|check|run tests?|confirm)\b/i, /(验证|确认|跑测试|检查)/i],
});

const PLAN_RULES = Object.freeze([
  {
    type: PlanType.SECURITY,
    weights: { security: 8, auth: 6, bug: 2 },
  },
  {
    type: PlanType.BUG_FIX,
    weights: { bug: 7, tests: 2, api: 1, ui: 1 },
  },
  {
    type: PlanType.REFACTOR,
    weights: { refactor: 7, performance: 2, tests: 1 },
  },
  {
    type: PlanType.TESTING,
    weights: { tests: 7, verifyOnly: 2, bug: 1 },
  },
  {
    type: PlanType.CODE_REVIEW,
    weights: { review: 6, security: 2, performance: 1 },
  },
  {
    type: PlanType.MIGRATION,
    weights: { migration: 7, data: 2, api: 1 },
  },
  {
    type: PlanType.SETUP,
    weights: { setup: 7, release: 1 },
  },
  {
    type: PlanType.RELEASE,
    weights: { release: 7, verifyOnly: 2, tests: 1 },
  },
  {
    type: PlanType.DATA,
    weights: { data: 7, migration: 2 },
  },
  {
    type: PlanType.UI,
    weights: { ui: 7, tests: 1, bug: 1 },
  },
  {
    type: PlanType.DOCUMENTATION,
    weights: { docs: 7, research: 1 },
  },
  {
    type: PlanType.VERIFICATION,
    weights: { verifyOnly: 6, tests: 2 },
  },
  {
    type: PlanType.ANALYSIS,
    weights: { review: 2, research: 2, performance: 1 },
  },
  {
    type: PlanType.RESEARCH,
    weights: { research: 5, docs: 1 },
  },
]);

export function normalizePlanType(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return PLAN_TYPE_ALIASES.get(normalized) || null;
}

export function extractExplicitPlanType(userInput) {
  const text = String(userInput || '');
  const patterns = [
    /\bplan\s*type\s*[:=]\s*([a-zA-Z_-]+)/i,
    /\bplan\s*[:=]\s*([a-zA-Z_-]+)/i,
    /计划类型\s*[:：=]\s*([a-zA-Z_\-\u4e00-\u9fa5]+)/i,
    /使用\s*([a-zA-Z_\-\u4e00-\u9fa5]+)\s*(?:计划|plan)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const type = normalizePlanType(match?.[1]);
    if (type) {
      return type;
    }
  }

  if (/快速计划|快速\s*plan|quick\s*plan/i.test(text)) {
    return PlanType.QUICK;
  }
  if (/文档计划|documentation\s*plan|docs?\s*plan/i.test(text)) {
    return PlanType.DOCUMENTATION;
  }
  if (/分析计划|analysis\s*plan|audit\s*plan/i.test(text)) {
    return PlanType.ANALYSIS;
  }
  if (/验证计划|verification\s*plan|test\s*plan/i.test(text)) {
    return PlanType.VERIFICATION;
  }
  if (/修复计划|bug\s*fix\s*plan|bug\s*plan/i.test(text)) {
    return PlanType.BUG_FIX;
  }
  if (/重构计划|refactor\s*plan/i.test(text)) {
    return PlanType.REFACTOR;
  }
  if (/测试计划|testing\s*plan|test\s*plan/i.test(text)) {
    return PlanType.TESTING;
  }
  if (/安全计划|security\s*plan/i.test(text)) {
    return PlanType.SECURITY;
  }

  return null;
}

export function inferTaskSignals(userInput = '', profile = {}) {
  const text = `${userInput || ''} ${profile?.input || ''}`;
  const signals = {};
  for (const [signal, patterns] of Object.entries(SIGNAL_DEFINITIONS)) {
    signals[signal] = patterns.some((pattern) => pattern.test(text));
  }
  return signals;
}

export function scorePlanTypes(profile = {}, userInput = '') {
  const signals = { ...inferTaskSignals(userInput, profile), ...(profile?.taskSignals || {}) };
  const scores = new Map(PLAN_TYPE_OPTIONS.map((option) => [option.id, 0]));

  for (const rule of PLAN_RULES) {
    let score = scores.get(rule.type) || 0;
    for (const [signal, weight] of Object.entries(rule.weights)) {
      if (signals[signal]) {
        score += weight;
      }
    }
    scores.set(rule.type, score);
  }

  const intent = profile?.intent;
  const mode = profile?.mode;
  // 降低 QUICK 类型的分数，避免过于轻易胜过 STANDARD 类型
  // 只有当任务明确是 trivial（如拼写错误、只改名等）且没有其他复杂信号时才选择 QUICK
  if (profile?.isLikelyTrivial && (profile?.isModificationTask || profile?.allowsMutation)) {
    // 检查是否有复杂信号，如果有则不选择 QUICK
    const hasComplexSignals =
      profile?.isBugTask ||
      profile?.riskScore >= 3 ||
      profile?.requiresVerification ||
      intent === 'diagnosis';
    if (!hasComplexSignals) {
      scores.set(PlanType.QUICK, (scores.get(PlanType.QUICK) || 0) + 5);
    }
  }
  if (profile?.isBugTask || intent === 'diagnosis') {
    scores.set(PlanType.BUG_FIX, (scores.get(PlanType.BUG_FIX) || 0) + 5);
  }
  if (profile?.isDocumentationTask || intent === 'documentation') {
    scores.set(PlanType.DOCUMENTATION, (scores.get(PlanType.DOCUMENTATION) || 0) + 5);
  }
  if (profile?.isAnalysisTask || intent === 'read_only_analysis' || mode === 'inspect') {
    scores.set(PlanType.ANALYSIS, (scores.get(PlanType.ANALYSIS) || 0) + 3);
  }
  if (profile?.isResearchTask || intent === 'project_info' || intent === 'how_to_run') {
    scores.set(PlanType.RESEARCH, (scores.get(PlanType.RESEARCH) || 0) + 4);
  }
  if (intent === 'test_or_verify' || mode === 'verify') {
    scores.set(PlanType.VERIFICATION, (scores.get(PlanType.VERIFICATION) || 0) + 5);
  }
  // 增加 STANDARD 类型的分数，确保编码/修改任务优先使用完整流程
  if (profile?.isCodingTask || profile?.isModificationTask || profile?.allowsMutation) {
    scores.set(PlanType.STANDARD, (scores.get(PlanType.STANDARD) || 0) + 4);
  }
  if (profile?.isInformationalQuery && !profile?.isCodingTask) {
    scores.set(PlanType.RESEARCH, (scores.get(PlanType.RESEARCH) || 0) + 2);
  }

  return Array.from(scores.entries())
    .map(([type, score]) => ({ type, score }))
    .sort((a, b) => b.score - a.score);
}

export function selectPlanType(profile = {}, userInput = '') {
  const explicit =
    normalizePlanType(profile?.planType) ||
    normalizePlanType(profile?.preferredPlanType) ||
    extractExplicitPlanType(userInput || profile?.input);
  if (explicit) {
    return explicit;
  }

  const ranked = scorePlanTypes(profile, userInput);
  const best = ranked[0];
  if (best && best.score > 0) {
    const readOnlyBug =
      best.type === PlanType.BUG_FIX &&
      profile?.allowsMutation === false &&
      !profile?.isCodingTask &&
      !profile?.isModificationTask;
    return readOnlyBug ? PlanType.ANALYSIS : best.type;
  }

  return profile?.isInformationalQuery && !profile?.isCodingTask
    ? PlanType.RESEARCH
    : PlanType.STANDARD;
}

export function getPlanTypeSelection(profile = {}, userInput = '') {
  const explicit =
    normalizePlanType(profile?.planType) ||
    normalizePlanType(profile?.preferredPlanType) ||
    extractExplicitPlanType(userInput || profile?.input);
  const ranked = scorePlanTypes(profile, userInput);
  const selected = explicit || selectPlanType(profile, userInput);
  return {
    selected,
    explicit: explicit || null,
    ranked,
    signals: { ...inferTaskSignals(userInput, profile), ...(profile?.taskSignals || {}) },
  };
}

export function isReadOnlyPlanType(planType) {
  return [
    PlanType.ANALYSIS,
    PlanType.RESEARCH,
    PlanType.VERIFICATION,
    PlanType.CODE_REVIEW,
  ].includes(planType);
}
