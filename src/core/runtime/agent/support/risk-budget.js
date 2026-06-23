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

// =============================================================
// 风险等级
// =============================================================
export const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

// 各风险等级对应的默认迭代预算占比
// 设计原则：每个风险等级都需要至少一次工具调用 + 一次生成最终答案
// 保守值 (0.5 ~ 1.0)：确保不会过度限制简单任务
export const ITERATION_RATIO = {
  [RISK_LEVEL.LOW]: 0.5,
  [RISK_LEVEL.MEDIUM]: 0.7,
  [RISK_LEVEL.HIGH]: 0.9,
  [RISK_LEVEL.CRITICAL]: 1.0,
};

// =============================================================
// 共享关键词模式 —— 从 agent.js / tool-router.js / intent-classifier.js 解耦
// 保证同一套判断逻辑在整个链路一致
// =============================================================

// CLI 命令（以 / 开头的一行指令）属于系统命令，非编码任务
export function isCliCommand(userInput) {
  const trimmed = String(userInput || '').trim();
  return trimmed.startsWith('/') && trimmed.length <= 40 && !trimmed.includes('\n');
}

// 明确的编码相关关键词（语言、框架、方法论）
// 这些词的存在 = 高概率是编码任务
export const CODING_CONTEXT_KEYWORDS = [
  // 中文：明确的编码关键词
  /代码|程序|脚本|html|css|javascript|typescript|js|单元测试|集成测试|函数|模块|功能|框架|库|接口|游戏引擎|游戏开发/,
  // 英文：明确的语言/框架关键词
  /\b(html|css|javascript|typescript|jsx|tsx|python|java|go|golang|rust|c\+\+|c#|ruby|php|shell|bash|sql|json|yaml|yml|markdown|nodejs|node\.js|react|vue|angular|django|flask|spring|express|pygame|pandas|numpy|tensorflow|pytorch|api|cli|sdk|library|framework)\b/,
  // 英文：明确的编码方法论关键词
  /\b(code|coding|refactor|unit test|integration test|write tests?|add tests?|debug|compile|build|deploy)\b/,
];

// 写操作动词 + 编码上下文（判定 isModificationTask，即"真正需要改代码"）
export const MODIFICATION_VERB_PATTERNS = [
  /(写|创建|新建|修改|修复|实现|生成|开发|重构|编写|制作|做|做一个|添加|增加|更新|调试|重构|优化|改进|变更|删除|移除|插入|替换).*(代码|文件|程序|脚本|html|css|js|功能|模块|函数|游戏|库|框架|插件|扩展|接口|配置|工具|命令行|cli|网站|应用|系统|平台)/,
  /\b(implement|create|build|write|develop|generate|add|edit|modify|fix|update|refactor|debug|compile|deploy|remove|delete|insert|replace|change|improve|optimize)\b.*\b(file|files|code|program|script|function|module|class|component|feature|api|endpoint|service|database|db|table|schema|test|auth|login|jwt|token|route|router|server|client|middleware|model|config|setting|pipeline|workflow|plugin|extension|library|framework|dependency|game|app|application|website|site|page|ui|interface|command|cli|tool|package)\b/,
];

// 通用动词 + 编码上下文的更完整匹配（用于 quickAssess 的 isCodingTask 判断）
export const CODING_VERB_CONTEXT_PATTERNS = [
  // 中文通用动词必须配合编码上下文
  /写.*(代码|程序|文件|脚本|html|css|js|功能|模块|函数|游戏|库|框架|插件|扩展|接口|配置|工具|命令行|cli)|(创建|新建|修改|修复|实现|生成|开发|重构|编写|制作|做|做一个|添加|增加|更新|调试).*(代码|文件|程序|脚本|html|css|js|功能|模块|函数|游戏|库|框架|插件|扩展|接口|配置|工具|命令行|cli|网站|应用|系统|平台)/,
  // 英文通用动词必须配合编码上下文（双向）
  /\b(implement|create|build|write|develop|generate|add|edit|modify|fix|update)\b.*\b(file|files|code|program|script|function|module|class|component|feature|api|endpoint|service|database|db|table|schema|test|auth|login|jwt|token|route|router|server|client|middleware|model|config|setting|pipeline|workflow|plugin|extension|library|framework|dependency|game|app|application|website|site|page|ui|interface|command|cli|tool|package)\b/,
  /\b(file|files|code|program|script|function|module|class|component|feature|api|endpoint|service|database|db|table|schema|test|auth|login|jwt|token|route|router|server|client|middleware|model|config|setting|pipeline|workflow|plugin|extension|library|framework|dependency|game|app|application|website|site|page|ui|interface|command|cli|tool|package)\b.*\b(implement|create|build|write|develop|generate|add|edit|modify|fix|update)\b/,
];

// 合并所有编码识别关键词（用于 quickAssess）
export const CODING_KEYWORDS = [...CODING_CONTEXT_KEYWORDS, ...CODING_VERB_CONTEXT_PATTERNS];

// 只读检查关键词（用于区分 inspection vs modification）
export const READ_ONLY_PATTERNS = [
  /查看|检查|看下|分析|阅读|读|统计|列出|浏览|查找|搜索/,
  /\b(inspect|check|view|read|list|count|show|search|find|browse|analyze|review)\b/,
];

// =============================================================
// 语义风险域（从 agent.js 解耦出来，保持内容一致）
// =============================================================
export const SEMANTIC_RISK_DOMAINS = [
  {
    id: 'units_timing',
    label: 'units/time/animation semantics',
    weight: 3,
    pattern:
      /时间|速度|帧|毫秒|秒|定时|计时|循环|动画|游戏|物理|实时|fps|frame|clock|tick|speed|interval|timeout|timer|animation|game|physics|realtime|real-time/i,
    checklist:
      'track units in variable names and API arguments; separate render FPS from simulation/update intervals; verify user-visible timing or movement behavior',
  },
  {
    id: 'api_semantics',
    label: 'third-party API semantics',
    weight: 3,
    pattern:
      /api|sdk|库|框架|pygame|three\.js|react|vue|express|fastapi|requestanimationframe|setinterval|settimeout|websocket|http|fetch/i,
    checklist:
      'confirm parameter meanings, return values, lifecycle constraints, and error behavior before treating a call as correct',
  },
  {
    id: 'state_transitions',
    label: 'state transition invariants',
    weight: 3,
    pattern:
      /状态|状态机|胜负|分数|移动|碰撞|合并|撤销|重试|缓存|session|state|fsm|transition|score|collision|merge|retry|cache/i,
    checklist:
      'verify state invariants, edge transitions, reset behavior, and repeated-action behavior',
  },
  {
    id: 'concurrency_io',
    label: 'async/concurrency/io semantics',
    weight: 4,
    pattern:
      /并发|异步|队列|锁|流|文件|网络|超时|重试|async|await|promise|concurrent|parallel|queue|lock|stream|file|network|timeout|retry/i,
    checklist:
      'check ordering, cancellation, timeout/retry behavior, idempotency, and partial failure handling',
  },
  {
    id: 'security_boundary',
    label: 'security/input boundary semantics',
    weight: 5,
    pattern:
      /安全|权限|认证|登录|密钥|token|注入|沙箱|secret|password|auth|permission|sanitize|injection|sandbox|xss|csrf/i,
    checklist:
      'validate trust boundaries, secrets handling, escaping/sanitization, and permission checks',
  },
];

// =============================================================
// 风险因子 - 每个因子有评分权重
// =============================================================
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

// 文件名风险模式（用于 deepAssess 实际涉及的文件时做升级判定）
const HIGH_RISK_FILE_PATTERNS = [
  /(index|main|app|server|router|route|controller|service|middleware|handler)\.(js|ts|jsx|tsx|py|go|rs)$/i,
  /(auth|security|permission|session|token|secret|password)\.(js|ts|jsx|tsx|py|go)$/i,
  /(package\.json|tsconfig\.json|webpack\.config|vite\.config|babel\.config|\.eslintrc|\.gitignore)$/i,
  /\.(test|spec)\.(js|ts|jsx|tsx|py)$/i,
];

// 低风险文件名模式（单个独立文件，不涉及项目核心结构）
const LOW_RISK_FILE_PATTERNS = [
  /\.(md|txt|csv|log|yml|yaml|toml)$/i,
  /(readme|changelog|todo|notes?)\./i,
];

// 从文本中识别"看起来像独立小文件创建"的模式
const TRIVIAL_TEXT_PATTERNS = [
  /\b(typo|拼写|文案|注释|comment|rename only|只改名)\b/i,
  /\b(simple|standalone|single[- ]file|demo|示例|quick|小)\b/i,
  /(创建|新建|写)\s*(一个|单个|独立)?\s*(html|\.html)\s*(文件)?/i,
];

// =============================================================
// 辅助：从文本中推断语义风险域
// =============================================================
function inferSemanticRiskDomains(userInput) {
  const text = String(userInput || '');
  return SEMANTIC_RISK_DOMAINS.filter((domain) => domain.pattern.test(text)).map(
    ({ id, label, weight, checklist }) => ({ id, label, weight, checklist }),
  );
}

// =============================================================
// 阶段 1：文本快速评估 —— <5ms，零工具调用
// 输入: userInput
// 输出: { riskLevel, score, reasons, semanticDomains, isCodingTask, isLikelyTrivial }
// =============================================================
export function quickAssess(userInput) {
  const text = String(userInput || '').toLowerCase();

  const cliCommand = isCliCommand(userInput);

  // 判定是不是编码任务 —— 用共享关键词模式
  const isCodingTask = !cliCommand && CODING_KEYWORDS.some((p) => p.test(text));

  // 判定是否需要修改代码 —— 写操作动词 + 编码上下文
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

  const requiresPlanning = !cliCommand;

  // 计算风险评分
  let score = 0;
  const reasons = [];

  // 对于 coding 任务，默认给 3 分基础分（进入 MEDIUM 风险门槛）
  // 这样才能保证至少暴露 review/verify/diagnose 等核心方法论工具
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

  const semanticDomains = inferSemanticRiskDomains(userInput);
  if (semanticDomains.length > 0 && !isLikelyTrivial) {
    const domainScore = semanticDomains.reduce((acc, d) => acc + d.weight, 0);
    score += domainScore;
    reasons.push(`semantic_domains:${semanticDomains.map((d) => d.id).join(',')}`);
  }

  // "看起来像多个产物"的文本信号
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

  // "工程化"、"架构"、"生产级" 等关键词 → 高风险标记
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

  // 基于评分 → 风险等级
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
  };
}

// =============================================================
// 阶段 2：代码层评估（异步，不阻塞首步行动）
// 输入: quickAssess 结果 + 实际发现的文件路径数组
// 输出: 升级/降级后的 riskLevel + 补充 reasons
//
// 注意：这个函数接收已探索到的文件路径数组（由调用方用 glob/read_file 获得）
// 不自己做文件系统访问，保持纯函数可测试。
// =============================================================
export function deepAssess(quickResult, filePaths = []) {
  if (!quickResult || quickResult.riskLevel === undefined) {
    return quickResult || { riskLevel: RISK_LEVEL.LOW, score: 0, reasons: [] };
  }

  // 非编码任务不升级
  if (!quickResult.isCodingTask) {
    return quickResult;
  }

  let score = quickResult.score;
  const reasons = [...quickResult.reasons];

  const paths = Array.isArray(filePaths) ? filePaths : [];

  // 核心文件触碰 → 升级
  const touchedHighRisk = paths.filter((p) =>
    HIGH_RISK_FILE_PATTERNS.some((pattern) => pattern.test(p)),
  );
  if (touchedHighRisk.length > 0) {
    score += touchedHighRisk.length * 3;
    reasons.push(`core_files:${touchedHighRisk.length}`);
  }

  // 文件数量多 → 升级
  if (paths.length >= 5) {
    score += 3;
    reasons.push(`many_files:${paths.length}`);
  } else if (paths.length >= 3) {
    score += 1;
  }

  // 全是低风险文件（纯文档/纯数据）→ 不升级
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
  };
}

// =============================================================
// Intent 合并：将 IntentClassifier 的结果合并到 quickAssess 结果中
// 核心原则：
//   1) 如果有 LLM intent 结果且置信度够高 → 优先使用 LLM 判定的
//      isCodingRelated 和 requiresCodeModification（智能化判断）
//   2) 没有 intent 或置信度不够 → 保留 quickAssess 的硬编码 pattern 结果
//
// 这样："帮我看下 index.html 中有没有 init()，没有就添加一个" 这种任务，
// 即使硬编码 pattern 没匹配到写操作，LLM 的 requiresCodeModification=true
// 也能正确识别为 modification 任务。
//
// 置信度阈值：>=0.75 才覆盖，否则保留 quickAssess 结果
// =============================================================
const INTENT_CONFIDENCE_THRESHOLD = 0.75;

const CODING_INTENTS = new Set(['coding_task', 'local_file_task', 'terminal_task', 'git_task']);
const MODIFICATION_INTENTS = new Set(['coding_task', 'git_task']);

export function mergeIntentProfile(quickResult, intent, userInput = '') {
  // 没 intent 或置信度低：保留 quickAssess 结果
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
    // CLI 命令强制非编码，不被 intent 覆盖
    return quickResult;
  }

  // 优先使用 LLM 直接判定的 isCodingRelated 和 requiresCodeModification
  // fallback 到旧的 intent name + pattern 组合，以兼容旧版 IntentClassifier
  let isCodingByIntent = CODING_INTENTS.has(intentName);
  let isModificationByIntent = false;

  if (typeof intent.isCodingRelated === 'boolean') {
    isCodingByIntent = intent.isCodingRelated;
  }
  if (typeof intent.requiresCodeModification === 'boolean') {
    isModificationByIntent = intent.requiresCodeModification;
  } else {
    // fallback: 用 pattern + intent name 判断（保留旧逻辑，不丢失功能）
    const normalizedText = String(intent.normalizedTask || userInput || '').toLowerCase();
    isModificationByIntent =
      MODIFICATION_INTENTS.has(intentName) ||
      MODIFICATION_VERB_PATTERNS.some((p) => p.test(normalizedText)) ||
      CODING_VERB_CONTEXT_PATTERNS.some((p) => p.test(normalizedText));

    // 只读模式兜底
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

  // LLM 判定是编码任务但评分偏低 → 给一个基础分确保走正常流程
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

  // 重新计算 riskLevel（基于最终评分）
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
  };
}

// =============================================================
// 迭代预算：基于风险等级算最大迭代次数上限
// 原则：够用就好，不浪费；也不卡复杂任务
// 保底：任何任务都至少有 4 次迭代（工具调用 + 至少一次生成最终答案）
// =============================================================
export function computeIterationBudget(
  riskLevelOrProfile,
  maxIterationsDefault = MAX_ITERATIONS_DEFAULT,
) {
  const level =
    typeof riskLevelOrProfile === 'string' ? riskLevelOrProfile : riskLevelOrProfile?.riskLevel;

  const ratio = ITERATION_RATIO[level] ?? ITERATION_RATIO[RISK_LEVEL.MEDIUM];
  return Math.max(4, Math.round(maxIterationsDefault * ratio));
}

// =============================================================
// 各风险等级的工具白名单已移除。
// 工具选择现在由 tool-router.js 的阶段感知逻辑驱动，
// 不再按风险等级分层暴露工具。
// =============================================================

// =============================================================
// 各风险等级的必做 gate（决定 completion gate 检查哪些证据）
// 返回: 一个描述"完成前必须满足"的约束对象
// =============================================================
export function getCompletionGates(riskLevel, profile = {}) {
  // 统一完成门：所有编码修改任务走相同的质量标准
  // 风险等级不再决定门的开关，只影响迭代预算
  const gates = {
    requireMutation: profile.isModificationTask !== false,
    requireRuntimeVerification: true,
    requireMethodologyTool: profile.isModificationTask !== false,
    requireSemanticRiskReview: (profile.semanticDomains || []).length > 0,
  };

  return gates;
}

// =============================================================
// 给 coding task operating prompt 用的：统一方法论使用建议
// 不再按风险等级分层——所有编码任务走相同的完整流程，
// 工具按阶段按需加载，方法论按阶段按需使用。
// 风险等级仅影响迭代预算和完成门严格度。
// =============================================================
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

// =============================================================
// 纯函数默认导出（兼容现有 import 风格）
// =============================================================
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
