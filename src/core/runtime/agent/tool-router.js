import { CODING_CONTEXT_KEYWORDS, CODING_VERB_CONTEXT_PATTERNS, MODIFICATION_VERB_PATTERNS, isCliCommand } from './support/risk-budget.js';

const CORE_READ_TOOLS = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'web_search',
  'web_fetch',
];

const CORE_WRITE_TOOLS = [
  'write_file',
  'edit_file',
];

const TERMINAL_TOOLS = [
  'shell',
  'pty_start',
  'pty_write',
  'pty_read',
  'pty_stop',
];

const WEB_TOOLS = [
  'web_search',
  'web_fetch',
  'browser_open',
  'preview_start',
  'preview_stop',
  'preview_list',
];

// Legacy methodology tool tiers — kept for reference but no longer used
// since tool selection is now driven by PHASE_CANDIDATE_TOOLS.
// const MINIMAL_METHOD_TOOLS = ['ask_user', 'review', 'verify', 'diagnose'];
// const EXTENDED_PLANNING_TOOLS = ['brainstorm', 'grill', 'zoom_out', 'architect', 'tdd'];
// const ADVANCED_METHOD_TOOLS = ['coverage_check', 'handoff'];

const DOC_PRODUCT_TOOLS = [
  'to_prd',
  'to_issues',
  'setup',
];

// See PHASE_CANDIDATE_TOOLS above for phase-driven tool selection.

const GENERAL_METHODOLOGY_TOOLS = [
  'ask_user',
  'review',
  'verify',
  'diagnose',
  'brainstorm',
];

const GIT_READ_TOOLS = [
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
];

const GIT_MUTATION_TOOLS = [
  'git_add',
  'git_commit',
  'git_push',
  'git_pull',
  'git_stash',
  'git_reset',
];

// State-Centric / Hash-Anchored tools.
// - harness_analyze: create content-addressable anchors for a file
// - harness_replace: content-addressed edit (replace via anchor hash)
// - harness_insert: insert after a given anchor hash
// - harness_delete: delete by anchor hash
// - harness_query: inspect store/anchors
// - harness_rollback: roll back to a prior state
// These are *exposed* but the default edit_file also uses the same
// hash-anchored patcher internally so the baseline path is deterministic.
const HARNESS_STATE_TOOLS = [
  'harness_analyze',
  'harness_replace',
  'harness_insert',
  'harness_delete',
  'harness_query',
  'harness_rollback',
];

const TASK_TOOLS = [
  'task_create',
  'task_list',
  'task_status',
  'task_cancel',
];

const SCHEDULE_TOOLS = [
  'schedule_create',
  'schedule_list',
  'schedule_delete',
  'schedule_toggle',
];

const SUBAGENT_TOOLS = [
  'subagent_spawn',
  'subagent_get_result',
  'subagent_list',
  'subagent_stop',
  'subagent_create_nested',
];

const MCP_TOOLS = [
  'mcp_connect',
  'mcp_disconnect',
  'mcp_list_servers',
  'mcp_list_tools',
  'mcp_list_resources',
  'mcp_call_tool',
  'mcp_read_resource',
  'mcp_status',
];

const COMPRESS_TOOLS = [
  'caveman',
  'handoff',
];

// =============================================================
// Phase-aware methodology tool selection
//
// 核心思想：方法论工具按执行阶段动态加载，所有编码任务走完整流程。
// - 探索阶段：需要 brainstorm/architect/zoom_out，不需要 verify/review
// - 规划阶段：需要 brainstorm/grill/architect/tdd，不需要 verify/review
// - 实现阶段：需要 diagnose，不需要 brainstorm/architect
// - 检查阶段：需要 review/diagnose，不需要 brainstorm/architect
// - 验证阶段：需要 verify/review/coverage_check，不需要 brainstorm/architect
//
// 风险等级不再限制工具可见性，仅影响迭代预算和完成门严格度。
// =============================================================

export const PHASE = {
  EXPLORATION: 'exploration',
  PLANNING: 'planning',
  IMPLEMENTATION: 'implementation',
  INSPECTION: 'inspection',
  VERIFICATION: 'verification',
};

// 每个执行阶段适用的方法论工具候选集
const PHASE_CANDIDATE_TOOLS = {
  [PHASE.EXPLORATION]: ['ask_user', 'brainstorm', 'grill', 'zoom_out', 'architect'],
  [PHASE.PLANNING]: ['ask_user', 'brainstorm', 'grill', 'zoom_out', 'architect', 'tdd'],
  [PHASE.IMPLEMENTATION]: ['ask_user', 'diagnose'],
  [PHASE.INSPECTION]: ['ask_user', 'review', 'diagnose'],
  [PHASE.VERIFICATION]: ['ask_user', 'review', 'verify', 'diagnose', 'coverage_check'],
};

// 注意：风险等级不再限制方法论工具可见性。
// 工具可见性完全由执行阶段决定（PHASE_CANDIDATE_TOOLS）。
// 风险等级仅影响迭代预算和完成门严格度。

/**
 * Select the smallest useful set of tools for the current request.
 * This is deliberately local and cheap: it avoids a preflight LLM call on
 * obvious coding tasks, while still exposing broad capabilities when needed.
 */
export function selectToolsForRequest(allTools, {
  userInput = '',
  taskProfile = null,
  intent = null,
  currentPhase = null,
  maxTools = 32,
} = {}) {
  const byName = new Map(allTools.map(tool => [tool.name, tool]));
  const selected = new Map();
  const input = String(userInput || '').toLowerCase();

  const add = (names) => {
    for (const name of names) {
      const tool = byName.get(name);
      if (tool) {
        selected.set(name, tool);
      }
    }
  };

  const asksForFreshData = Boolean(intent?.requiresFreshData) || [
    /天气|气温|新闻|最新|今天|现在|当前|实时|汇率|价格|股价|比分|赛程|政策|法规/,
    /\b(weather|news|latest|today|now|current|real[- ]?time|price|stock|exchange rate|schedule|score|law|regulation)\b/,
  ].some(pattern => pattern.test(input));

  const asksForBrowser = [
    /打开.*(网页|页面|浏览器|url|链接)|浏览器|截图|localhost|本地页面/,
    /\b(open|browser|screenshot|localhost|127\.0\.0\.1|web page|url)\b/,
  ].some(pattern => pattern.test(input));

  const asksForGit = [
    /提交|推送|合并|分支|远程|commit|push|merge|branch|git|diff|status/,
  ].some(pattern => pattern.test(input));

  const asksForMcp = [
    /\bmcp\b|连接.*服务器|资源.*工具/,
  ].some(pattern => pattern.test(input));

  const asksForScheduling = [
    /创建任务|任务列表|任务状态|取消任务|定时任务|计划任务|提醒|后台任务|子代理|子agent|subagent|schedule|scheduler|reminder|automation|background task/,
  ].some(pattern => pattern.test(input));

  const asksForCompression = [
    /压缩上下文|handoff|交接|暂停|稍后继续|记忆压缩|compress|continue later/,
  ].some(pattern => pattern.test(input));

  // Tiered exposure for coding tasks based on execution phase.
  // All coding tasks get the same complete methodology flow;
  // phase determines which tools are visible at each step.
  if (taskProfile?.isCodingTask) {
    add(CORE_READ_TOOLS);
    add(CORE_WRITE_TOOLS);
    add(TERMINAL_TOOLS);
    add(GIT_READ_TOOLS);

    // State-centric / hash-anchored tools — always available for coding tasks
    add(HARNESS_STATE_TOOLS);

    // Phase-aware methodology tool selection:
    // 工具可见性完全由执行阶段决定。
    // - 有 currentPhase → 按阶段动态暴露（所有编码任务都有阶段）
    // - 无 currentPhase → 退化为基础方法论集（非编码任务）
    if (currentPhase) {
      const phaseCandidates = PHASE_CANDIDATE_TOOLS[currentPhase] || [];
      add(phaseCandidates);
    } else {
      // 非编码任务或无 ExecutionPlan 的降级路径：暴露基础方法论
      add(GENERAL_METHODOLOGY_TOOLS);
    }

    // Bug-focused tasks get coverage_check (heuristic: only when bug-like)
    if (taskProfile?.isBugTask || /bug|报错|错误|失败|崩溃|卡住|test failing|failing test/i.test(input)) {
      add(['coverage_check']);
    }

    // User explicitly asked for doc/product artifacts
    const asksForDocs = [
      /prd|产品|需求文档|issue|工单|写文档|docs|specification|design doc/,
      /\b(prd|issue|requirements|spec|design doc)\b/,
    ].some(pattern => pattern.test(input));
    if (asksForDocs) {
      add(DOC_PRODUCT_TOOLS);
    }

    if (asksForGit) {
      add(GIT_MUTATION_TOOLS);
    }
    if (asksForFreshData) {
      add(WEB_TOOLS);
    }
    if (asksForBrowser) {
      add(['browser_open']);
    }
  } else if (asksForFreshData) {
    add(WEB_TOOLS);
    add(['review', 'verify']);
  } else {
    add(CORE_READ_TOOLS);
    add(GENERAL_METHODOLOGY_TOOLS);
    if (asksForBrowser) {
      add(['browser_open']);
    }
  }

  if (intent?.recommendedTools?.length) {
    add(intent.recommendedTools);
  }
  if (intent?.firstActionHint?.tool) {
    add([intent.firstActionHint.tool]);
  }
  if (asksForGit) {
    add(GIT_READ_TOOLS);
    add(GIT_MUTATION_TOOLS);
  }
  if (asksForMcp) {
    add(MCP_TOOLS);
  }
  if (asksForScheduling) {
    add(TASK_TOOLS);
    add(SCHEDULE_TOOLS);
    add(SUBAGENT_TOOLS);
  }
  if (asksForCompression) {
    add(COMPRESS_TOOLS);
  }

  if (selected.size === 0) {
    add(CORE_READ_TOOLS);
    add(GENERAL_METHODOLOGY_TOOLS);
    add(WEB_TOOLS);
  }

  const selectedTools = Array.from(selected.values());
  if (selectedTools.length <= maxTools) {
    return selectedTools;
  }

  return selectedTools.slice(0, maxTools);
}

export function shouldUseIntentClassifier(userInput) {
  const input = String(userInput || '').toLowerCase();

  // CLI 命令：不调用 LLM 意图识别
  if (isCliCommand(userInput)) {
    return false;
  }

  // 非常明确的写操作任务（如"写一个 python 游戏"、"创建一个 html 文件"）：
  // 可以跳过意图分类器，quickAssess 已能正确识别
  const explicitlyModifying = MODIFICATION_VERB_PATTERNS.some(p => p.test(input));

  // 但是：如果任务中包含"查看/检查/看下/看一下/检查一下"这类可能是纯检查
  // 或条件式修改的措辞（如"看下 index.html，如果没有 init() 就添加一个"），
  // 那就应该调用意图分类器，让 LLM 准确判断 requiresCodeModification
  const possiblyReadOnly = [
    /查看|检查|看下|看一下|分析一下|浏览|阅读|检查一下|检查是否|看下是否|查看是否|先看|先检查/,
    /\b(inspect|check|view|read|list|count|show|search|find|browse|analyze|review|look at|take a look)\b/,
  ].some(pattern => pattern.test(input));

  if (explicitlyModifying && !possiblyReadOnly) {
    // 纯写操作，不需要意图分类器
    return false;
  }

  // 外部查询类（天气、新闻、实时数据等）：需要意图分类器路由
  const asksForFreshData = [
    /天气|气温|新闻|最新|今天|现在|当前|实时|汇率|价格|股价|比分|赛程|政策|法规/,
    /\b(weather|news|latest|today|now|current|real[- ]?time|price|stock|exchange rate|schedule|score|law|regulation)\b/,
  ].some(pattern => pattern.test(input));

  if (asksForFreshData) {
    return true;
  }

  // 模棱两可的编码任务（含"查看/检查"或仅提到代码语言/文件）：
  // 调用意图分类器来判断是否需要修改
  const hasCodingContext = [
    ...CODING_CONTEXT_KEYWORDS,
    ...CODING_VERB_CONTEXT_PATTERNS,
  ].some(pattern => pattern.test(input));

  if (hasCodingContext) {
    // 有编码上下文但不是明确写操作 → 调用意图分类器让 LLM 判断
    return true;
  }

  // 完全非编码的一般对话类任务 → 也可以调用意图分类器做 routing
  return true;
}
