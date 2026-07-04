import {
  CODING_CONTEXT_KEYWORDS,
  CODING_VERB_CONTEXT_PATTERNS,
  MODIFICATION_VERB_PATTERNS,
  isCliCommand,
} from '../../../utils/patterns.js';

const CORE_READ_TOOLS = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'web_search',
  'web_fetch',
];

const CORE_WRITE_TOOLS = ['write_file', 'edit_file'];

// Hashline-based atomic patching — the recommended edit path when available.
// Applies multi-file, content-hash-anchored patches with preflight + LSP sync + diagnostics gate.
const HASHLINE_TOOLS = ['apply_hashline_patch'];

// LSP code navigation tools — the recommended exploration path when available.
// These replace read_file/list_dir for locating code, finding references,
// tracing call chains, and understanding types/symbols.
const LSP_NAV_TOOLS = [
  'lsp_diagnostics', // instant error/warning location
  'lsp_definition', // jump to definition (replaces grep + read_file)
  'lsp_references', // find all usages (replaces multi-file search)
  'lsp_call_hierarchy', // trace incoming/outgoing call chains
  'lsp_symbols', // workspace-wide symbol search
  'lsp_hover', // type info and documentation at cursor
  'lsp_type_definition', // type definition (replaces reading type files)
  'lsp_implementation', // find interface/abstract implementations
];

// LSP editing tools — code modifications with full Hashline transaction pipeline.
const LSP_EDIT_TOOLS = [
  'lsp_rename', // rename + sync references + barrel/alias
  'lsp_code_action', // quick fixes, organize imports, etc.
  'lsp_workspace_edit', // cross-file workspace edits (move/rename/update-imports)
];

const TERMINAL_TOOLS = ['shell', 'pty_start', 'pty_write', 'pty_read', 'pty_stop'];

const WEB_TOOLS = ['web_search', 'web_fetch', 'preview_start', 'preview_stop', 'preview_list'];

const BROWSER_TOOLS = ['browser_open'];

const DOC_PRODUCT_TOOLS = ['to_prd', 'to_issues', 'setup'];

// See PHASE_CANDIDATE_TOOLS above for phase-driven tool selection.

const GENERAL_METHODOLOGY_TOOLS = [
  'ask_user',
  'review',
  'verify',
  'diagnose',
  'brainstorm',
  'project_profile',
  'risk_check',
  'impact_map',
  'test_strategy',
  'auto_research',
];

const ADVANCED_METHODOLOGY_TOOLS = [
  'impact_map',
  'project_profile',
  'risk_check',
  'test_strategy',
  'migration_plan',
  'release_checklist',
  'ui_acceptance',
  'data_contract_check',
  'security_review',
  'auto_research',
];

const GIT_READ_TOOLS = ['git_status', 'git_diff', 'git_log', 'git_branch'];

const GIT_MUTATION_TOOLS = [
  'git_add',
  'git_commit',
  'git_push',
  'git_pull',
  'git_stash',
  'git_reset',
];

// State-Centric / Hash-Anchored tools.
const HARNESS_STATE_TOOLS = [
  'harness_analyze',
  'harness_replace',
  'harness_insert',
  'harness_delete',
  'harness_query',
  'harness_rollback',
];

// On-Demand Context Expansion tools — 按需上下文扩展
// - context_index: 索引项目文件，构建符号索引和依赖图
// - context_assess: 评估当前上下文置信度
// - context_expand: 按需扩展上下文（加载定义、依赖、类型信息）
// - context_range: 批量扩展多个目标的上下文
// 这些工具让 agent 在置信度不足时主动请求更多上下文，
// 而非逐文件探索。由 OnDemandContextExpansion 引擎驱动。
const CONTEXT_EXPANSION_TOOLS = [
  'context_index',
  'context_assess',
  'context_expand',
  'context_range',
];

const TASK_TOOLS = ['task_create', 'task_list', 'task_status', 'task_cancel'];

const SCHEDULE_TOOLS = ['schedule_create', 'schedule_list', 'schedule_delete', 'schedule_toggle'];

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

const COMPRESS_TOOLS = ['caveman', 'handoff'];

const PLAN_ORCHESTRATION_TOOLS = ['change_plan'];

// Plan execution needs a stable engineering substrate, but methodology tools
// should come from the current phase, explicit user intent, or the task's own
// allowedTools. Keeping them out of the base avoids ceremonial tool calls.
const PLAN_TASK_EXECUTION_TOOLS = [
  ...CORE_READ_TOOLS,
  ...CORE_WRITE_TOOLS,
  ...HASHLINE_TOOLS,
  ...LSP_NAV_TOOLS,
  ...LSP_EDIT_TOOLS,
  ...TERMINAL_TOOLS,
  ...WEB_TOOLS,
  ...GIT_READ_TOOLS,
  ...HARNESS_STATE_TOOLS,
  ...CONTEXT_EXPANSION_TOOLS,
  'read_files',
  'tree',
  'lsp_format',
  'git_show',
];

// =============================================================
// Phase-aware methodology tool selection
//
// 核心思想：方法论工具按执行阶段和明确意图动态加载。
// - 探索/规划阶段可以暴露设计与风险工具
// - 实现阶段只保留必要的诊断/风险工具
// - 检查/验证阶段暴露审查、验证和覆盖工具
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
  [PHASE.EXPLORATION]: [
    'ask_user',
    'brainstorm',
    'grill',
    'zoom_out',
    'architect',
    'auto_research',
    'impact_map',
    'project_profile',
    'risk_check',
  ],
  [PHASE.PLANNING]: [
    'ask_user',
    'brainstorm',
    'grill',
    'zoom_out',
    'architect',
    'tdd',
    'auto_research',
    'impact_map',
    'project_profile',
    'risk_check',
    'test_strategy',
    'migration_plan',
    'release_checklist',
    'ui_acceptance',
    'data_contract_check',
    'security_review',
    'setup',
    'capture_requirements',
  ],
  [PHASE.IMPLEMENTATION]: ['ask_user', 'diagnose', 'risk_check'],
  [PHASE.INSPECTION]: [
    'ask_user',
    'review',
    'diagnose',
    'impact_map',
    'risk_check',
    'security_review',
    'data_contract_check',
    'ui_acceptance',
  ],
  [PHASE.VERIFICATION]: [
    'ask_user',
    'review',
    'verify',
    'diagnose',
    'coverage_check',
    'auto_research',
    'test_strategy',
    'release_checklist',
    'security_review',
    'data_contract_check',
    'ui_acceptance',
    'browser_open',
  ],
};

// 风险等级影响迭代预算和完成门严格度；工具可见性由 phase、
// explicit intent、currentTask.allowedTools 共同决定。

/**
 * Select the smallest useful set of tools for the current request.
 * This is deliberately local and cheap: it avoids a preflight LLM call on
 * obvious coding tasks, while still exposing broad capabilities when needed.
 *
 * Supports currentTask.allowedTools as task-intent guidance while preserving
 * the broader execution substrate needed for real coding work.
 */
export function selectToolsForRequest(
  allTools,
  {
    userInput = '',
    taskProfile = null,
    intent = null,
    currentPhase = null,
    currentTask = null,
    maxTools = 32,
  } = {},
) {
  const debugRouter = process.env.DEBUG === 'true' || process.env.AGENT_TRACE === 'true';
  if (debugRouter) {
    console.log(
      `[tool-router] selectToolsForRequest: currentPhase=${currentPhase}, currentTask=${currentTask?.id || 'none'}, allToolsCount=${allTools.length}`,
    );
  }
  const byName = new Map(allTools.map((tool) => [tool.name, tool]));
  const selected = new Map();
  const input = String(userInput || '').toLowerCase();

  // 诊断：检查核心工具是否存在于 allTools 中
  const criticalTools = ['write_file', 'edit_file', 'shell', 'read_file', 'list_dir'];
  const allToolNames = allTools.map((t) => t.name);
  const missingCriticalTools = criticalTools.filter((name) => !byName.has(name));
  if (missingCriticalTools.length > 0) {
    if (debugRouter) {
      console.warn(
        `[tool-router] Critical tools not registered: ${missingCriticalTools.join(', ')}. ` +
          `allTools count: ${allTools.length}, registered: ${allToolNames.slice(0, 20).join(', ')}${allToolNames.length > 20 ? '...' : ''}`,
      );
    }
  }

  const add = (names) => {
    for (const name of names) {
      const tool = byName.get(name);
      if (tool) {
        selected.set(name, tool);
      }
    }
  };

  const asksForFreshData =
    Boolean(intent?.requiresFreshData) ||
    [
      /天气|气温|新闻|最新|今天|现在|当前|实时|汇率|价格|股价|比分|赛程|政策|法规/,
      /\b(weather|news|latest|today|now|current|real[- ]?time|price|stock|exchange rate|schedule|score|law|regulation)\b/,
    ].some((pattern) => pattern.test(input));

  const asksForBrowser = [
    /打开.*(网页|页面|浏览器|url|链接)|浏览器|截图|localhost|本地页面/,
    /\b(open|browser|screenshot|localhost|127\.0\.0\.1|web page|url)\b/,
  ].some((pattern) => pattern.test(input));

  const asksForGit = [/提交|推送|合并|分支|远程|commit|push|merge|branch|git|diff|status/].some(
    (pattern) => pattern.test(input),
  );

  const asksForMcp = [/\bmcp\b|连接.*服务器|资源.*工具/].some((pattern) => pattern.test(input));

  const asksForScheduling = [
    /创建任务|任务列表|任务状态|取消任务|定时任务|计划任务|提醒|后台任务|子代理|子agent|subagent|schedule|scheduler|reminder|automation|background task/,
  ].some((pattern) => pattern.test(input));

  const asksForCompression = [
    /压缩上下文|handoff|交接|暂停|稍后继续|记忆压缩|compress|continue later/,
  ].some((pattern) => pattern.test(input));

  const asksForDocs = [
    /prd|产品|需求文档|issue|工单|写文档|docs|specification|design doc/,
    /\b(prd|issue|requirements|spec|design doc)\b/,
  ].some((pattern) => pattern.test(input));

  if (currentTask && currentTask.allowedTools && currentTask.allowedTools.length > 0) {
    add(PLAN_ORCHESTRATION_TOOLS);
    add(PLAN_TASK_EXECUTION_TOOLS);
    add(CORE_READ_TOOLS);
    add(CORE_WRITE_TOOLS);
    add(LSP_NAV_TOOLS);
    add(LSP_EDIT_TOOLS);
    add(HASHLINE_TOOLS);
    add(TERMINAL_TOOLS);
    add(GIT_READ_TOOLS);
    add(HARNESS_STATE_TOOLS);
    add(CONTEXT_EXPANSION_TOOLS);
    add(currentTask.allowedTools);

    if (currentPhase) {
      const phaseCandidates = PHASE_CANDIDATE_TOOLS[currentPhase] || [];
      add(phaseCandidates);
    }

    if (asksForGit) {
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

    return Array.from(selected.values());
  }

  // Coding tasks get a complete execution base. Methodology tools are available
  // as optional evidence helpers; phase only adds useful bias, not ceremony.
  if (taskProfile?.isCodingTask) {
    add(PLAN_ORCHESTRATION_TOOLS);
    add(CORE_READ_TOOLS);
    add(CORE_WRITE_TOOLS);
    // LSP + Hashline — dramatically reduces exploration rounds.
    // lsp_diagnostics pinpoints errors instantly; lsp_definition/lsp_references
    // replace grep+read_file chains; apply_hashline_patch provides atomic,
    // transactional edits with preflight+LSP-sync+diagnostics-gate.
    add(LSP_NAV_TOOLS);
    add(LSP_EDIT_TOOLS);
    add(HASHLINE_TOOLS);
    add(TERMINAL_TOOLS);
    add(GIT_READ_TOOLS);

    // State-centric / hash-anchored tools — always available for coding tasks
    add(HARNESS_STATE_TOOLS);

    // Context expansion tools — always available for coding tasks
    // so agent can request more context on-demand instead of exploring file-by-file
    add(CONTEXT_EXPANSION_TOOLS);

    // Phase-aware methodology tool selection:
    // 方法论工具按阶段暴露；无 phase 时只保留最小澄清/诊断工具。
    if (currentTask) {
      if (currentPhase) {
        const phaseCandidates = PHASE_CANDIDATE_TOOLS[currentPhase] || [];
        add(phaseCandidates);
      } else {
        add(['ask_user', 'diagnose']);
      }
    } else if (currentPhase) {
      // 非计划态：按阶段动态暴露
      const phaseCandidates = PHASE_CANDIDATE_TOOLS[currentPhase] || [];
      add(phaseCandidates);
    } else {
      // 无 ExecutionPlan 的降级路径：只保留澄清/诊断，避免规划仪式化
      add(['ask_user', 'diagnose']);
    }

    // Bug-focused tasks get coverage_check (heuristic: only when bug-like)
    if (
      taskProfile?.isBugTask ||
      /bug|报错|错误|失败|崩溃|卡住|test failing|failing test/i.test(input)
    ) {
      add(['coverage_check']);
    }

    // User explicitly asked for doc/product artifacts
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
    add(PLAN_ORCHESTRATION_TOOLS);
    add(WEB_TOOLS);
    add(['ask_user', 'coverage_check', 'review', 'verify']);
    add(CORE_READ_TOOLS);
    if (asksForBrowser) {
      add(['browser_open']);
    }
  } else {
    add(PLAN_ORCHESTRATION_TOOLS);
    add(CORE_READ_TOOLS);
    add(['ask_user']);
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
    add(['ask_user']);
    add(WEB_TOOLS);
  }

  const priorityNames = [
    ...PLAN_ORCHESTRATION_TOOLS,
    ...(currentPhase ? PHASE_CANDIDATE_TOOLS[currentPhase] || [] : ['ask_user', 'diagnose']),
    ...(taskProfile?.isBugTask ||
    /bug|报错|错误|失败|崩溃|卡住|test failing|failing test/i.test(input)
      ? ['coverage_check']
      : []),
    ...CORE_READ_TOOLS,
    ...CORE_WRITE_TOOLS,
    ...(asksForGit ? [...GIT_READ_TOOLS, ...GIT_MUTATION_TOOLS] : []),
    ...(asksForMcp ? MCP_TOOLS : []),
    ...(asksForScheduling ? [...TASK_TOOLS, ...SCHEDULE_TOOLS, ...SUBAGENT_TOOLS] : []),
    ...(asksForCompression ? COMPRESS_TOOLS : []),
    ...(asksForFreshData ? WEB_TOOLS : []),
    ...(asksForBrowser ? ['browser_open'] : []),
    ...(asksForDocs ? DOC_PRODUCT_TOOLS : []),
    ...HASHLINE_TOOLS,
    ...LSP_NAV_TOOLS,
    ...LSP_EDIT_TOOLS,
    ...TERMINAL_TOOLS,
    ...GIT_READ_TOOLS,
    ...HARNESS_STATE_TOOLS,
    ...CONTEXT_EXPANSION_TOOLS,
    ...ADVANCED_METHODOLOGY_TOOLS,
  ];

  const priority = new Map();
  priorityNames.forEach((name, index) => {
    if (!priority.has(name)) {
      priority.set(name, index);
    }
  });
  const selectedTools = Array.from(selected.values()).sort((a, b) => {
    const ai = priority.has(a.name) ? priority.get(a.name) : Number.MAX_SAFE_INTEGER;
    const bi = priority.has(b.name) ? priority.get(b.name) : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
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
  const explicitlyModifying = MODIFICATION_VERB_PATTERNS.some((p) => p.test(input));

  // 但是：如果任务中包含"查看/检查/看下/看一下/检查一下"这类可能是纯检查
  // 或条件式修改的措辞（如"看下 index.html，如果没有 init() 就添加一个"），
  // 那就应该调用意图分类器，让 LLM 准确判断 requiresCodeModification
  const possiblyReadOnly = [
    /查看|检查|看下|看一下|分析一下|浏览|阅读|检查一下|检查是否|看下是否|查看是否|先看|先检查/,
    /\b(inspect|check|view|read|list|count|show|search|find|browse|analyze|review|look at|take a look)\b/,
  ].some((pattern) => pattern.test(input));

  if (explicitlyModifying && !possiblyReadOnly) {
    // 纯写操作，不需要意图分类器
    return false;
  }

  // 外部查询类（天气、新闻、实时数据等）：需要意图分类器路由
  const asksForFreshData = [
    /天气|气温|新闻|最新|今天|现在|当前|实时|汇率|价格|股价|比分|赛程|政策|法规/,
    /\b(weather|news|latest|today|now|current|real[- ]?time|price|stock|exchange rate|schedule|score|law|regulation)\b/,
  ].some((pattern) => pattern.test(input));

  if (asksForFreshData) {
    return true;
  }

  // 模棱两可的编码任务（含"查看/检查"或仅提到代码语言/文件）：
  // 调用意图分类器来判断是否需要修改
  const hasCodingContext = [...CODING_CONTEXT_KEYWORDS, ...CODING_VERB_CONTEXT_PATTERNS].some(
    (pattern) => pattern.test(input),
  );

  if (hasCodingContext) {
    // 有编码上下文但不是明确写操作 → 调用意图分类器让 LLM 判断
    return true;
  }

  // 完全非编码的一般对话类任务 → 也可以调用意图分类器做 routing
  return true;
}
