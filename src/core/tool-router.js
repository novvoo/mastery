const CORE_READ_TOOLS = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
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
];

const CODING_METHODOLOGY_TOOLS = [
  'setup',
  'grill',
  'brainstorm',
  'zoom_out',
  'architect',
  'diagnose',
  'tdd',
  'review',
  'verify',
  'to_prd',
  'to_issues',
];

const GENERAL_METHODOLOGY_TOOLS = [
  'grill',
  'brainstorm',
  'diagnose',
  'review',
  'verify',
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

/**
 * Select the smallest useful set of tools for the current request.
 * This is deliberately local and cheap: it avoids a preflight LLM call on
 * obvious coding tasks, while still exposing broad capabilities when needed.
 */
export function selectToolsForRequest(allTools, {
  userInput = '',
  taskProfile = null,
  intent = null,
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

  if (taskProfile?.isCodingTask) {
    add(CORE_READ_TOOLS);
    add(CORE_WRITE_TOOLS);
    add(TERMINAL_TOOLS);
    add(CODING_METHODOLOGY_TOOLS);
    add(GIT_READ_TOOLS);
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
    add(['grill']);
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

  const clearlyCoding = [
    /写.*代码|写.*html|写.*js|写.*css|创建.*文件|新建.*文件|修改.*代码|改.*代码|修复|实现|开发|重构|集成测试|单元测试/,
    /\b(code|coding|implement|fix|bug|refactor|unit test|integration test|write tests?|add tests?|html|css|javascript|typescript)\b/,
  ].some(pattern => pattern.test(input));
  if (clearlyCoding) {
    return false;
  }

  return [
    /天气|气温|新闻|最新|今天|现在|当前|实时|汇率|价格|股价|比分|赛程|政策|法规/,
    /\b(weather|news|latest|today|now|current|real[- ]?time|price|stock|exchange rate|schedule|score|law|regulation)\b/,
  ].some(pattern => pattern.test(input));
}
