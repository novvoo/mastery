const FILE_ARG_KEYS = ['path', 'file', 'file_path', 'filename', 'target', 'targetPath'];

const READ_TOOLS = new Set([
  'read_file',
  'read_files',
  'list_dir',
  'glob',
  'search',
  'semantic_search',
  'check_file',
]);
const WRITE_TOOLS = new Set(['write_file', 'mkdir']);
const EDIT_TOOLS = new Set(['edit_file', 'git_apply_patch']);
const DELETE_TOOLS = new Set(['delete_file', 'rename_file']);
const REVIEW_TOOLS = new Set(['review', 'verify', 'coverage_check']);

export function describeToolActivity(toolName, args = {}, phase = 'running', result = null) {
  const name = String(toolName || 'unknown');
  const normalizedPhase = normalizePhase(phase);
  const target = inferTarget(name, args);
  const intent = inferIntent(name, args);
  const action = actionLabel(intent, normalizedPhase);
  const subject = target || toolDisplayName(name, args);
  const statusText = statusLabel(intent, normalizedPhase, subject);
  const counts = inferCounts(name, args, result);

  return {
    id: activityId(name, args),
    kind: 'tool_activity',
    phase: normalizedPhase,
    intent,
    toolName: name,
    target,
    title: `${action}${subject ? ` ${subject}` : ''}`,
    statusText,
    detail: detailText(name, args, result),
    counts,
    canReview: canReview(intent, normalizedPhase),
    canUndo: canUndo(intent, normalizedPhase),
    requiresInteraction: intent === 'interaction',
    timestamp: Date.now(),
  };
}

/**
 * 创建工具进度活动描述（用于心跳/进度推送）
 * @param {string} toolName - 工具名称
 * @param {Object} args - 工具参数
 * @param {number} progress - 进度百分比 (0-100)
 * @param {string} [statusText] - 自定义状态文本
 */
export function describeToolProgress(toolName, args = {}, progress = 0, statusText = null) {
  const name = String(toolName || 'unknown');
  const target = inferTarget(name, args);
  const intent = inferIntent(name, args);
  const subject = target || toolDisplayName(name, args);
  const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return {
    id: activityId(name, args),
    kind: 'tool_activity',
    phase: 'running',
    intent,
    toolName: name,
    target,
    progress: clampedProgress,
    title: `正在${subject ? ` ${subject}` : ''}`,
    statusText: statusText || `进度: ${clampedProgress}%`,
    detail: detailText(name, args, null),
    timestamp: Date.now(),
  };
}

export function summarizeActivityForCLI(activity) {
  if (!activity) {
    return '';
  }
  const prefix =
    activity.phase === 'completed'
      ? 'done'
      : activity.phase === 'failed'
        ? 'failed'
        : activity.phase === 'waiting'
          ? 'waiting'
          : 'doing';
  return `${prefix}: ${activity.statusText || activity.title}`;
}

function normalizePhase(phase) {
  if (phase === 'success') {
    return 'completed';
  }
  if (phase === 'error') {
    return 'failed';
  }
  if (['queued', 'running', 'completed', 'failed', 'waiting', 'skipped'].includes(phase)) {
    return phase;
  }
  return 'running';
}

function inferIntent(toolName, args) {
  if (READ_TOOLS.has(toolName)) {
    return 'read';
  }
  if (WRITE_TOOLS.has(toolName)) {
    return 'write';
  }
  if (EDIT_TOOLS.has(toolName)) {
    return 'edit';
  }
  if (DELETE_TOOLS.has(toolName)) {
    return 'delete';
  }
  if (REVIEW_TOOLS.has(toolName)) {
    return 'review';
  }
  if (toolName === 'ask_user' || toolName === 'request_user_input') {
    return 'interaction';
  }
  if (toolName === 'shell') {
    return inferShellIntent(args?.command);
  }
  if (toolName?.startsWith('git_')) {
    return 'version_control';
  }
  if (toolName?.includes('web') || toolName?.includes('browser')) {
    return 'browse';
  }
  return 'tool';
}

function inferShellIntent(command = '') {
  const value = String(command || '').trim();
  if (!value) {
    return 'command';
  }
  if (
    /(^|\s)(npm|pnpm|yarn|bun)\s+(test|run\s+test|lint|run\s+lint|build|run\s+build)\b/.test(
      value,
    ) ||
    /(^|\s)(pytest|vitest|jest|eslint|tsc)\b/.test(value)
  ) {
    return 'verify';
  }
  if (
    /\b(apply_patch|python|node|perl|sed)\b[\s\S]*(>|writeFile|fs\.writeFile|replace\(|rename\(|unlink\(|rm\s+-|mv\s+)/.test(
      value,
    )
  ) {
    return 'edit';
  }
  if (/(^|\s)(cat|sed|awk|rg|grep|find|ls|pwd)\b/.test(value)) {
    return 'read';
  }
  if (/(^|\s)(git\s+diff|git\s+status|git\s+show)\b/.test(value)) {
    return 'review';
  }
  if (
    /(^|\s)(git\s+add|git\s+commit|git\s+push|git\s+checkout|git\s+merge|git\s+rebase)\b/.test(
      value,
    )
  ) {
    return 'version_control';
  }
  return 'command';
}

function inferTarget(toolName, args = {}) {
  if (!args || typeof args !== 'object') {
    return '';
  }
  for (const key of FILE_ARG_KEYS) {
    if (typeof args[key] === 'string' && args[key].trim()) {
      return args[key].trim();
    }
  }
  if (toolName === 'shell') {
    return inferShellTarget(args.command);
  }
  if (typeof args.pattern === 'string') {
    return args.pattern;
  }
  if (typeof args.query === 'string') {
    return args.query;
  }
  if (typeof args.url === 'string') {
    return args.url;
  }
  return '';
}

function inferShellTarget(command = '') {
  const value = String(command || '');
  const fileMatch = value.match(
    /(?:^|\s)(?:cat|sed|awk|rg|grep|node|python|eslint|tsc)\b[\s\S]*?(['"]?)([./~\w-][^'"\n\r]*?\.(?:js|jsx|ts|tsx|mjs|cjs|json|md|css|html|py|yml|yaml|txt))\1/,
  );
  if (fileMatch?.[2]) {
    return fileMatch[2].trim();
  }
  const cdMatch = value.match(/\bcd\s+([^;&|]+)/);
  if (cdMatch?.[1]) {
    return cdMatch[1].trim();
  }
  return truncate(value, 80);
}

function actionLabel(intent, phase) {
  if (phase === 'completed') {
    return (
      {
        read: '已读取',
        write: '已写入',
        edit: '已编辑',
        delete: '已变更',
        review: '已审核',
        verify: '已验证',
        interaction: '已响应',
        browse: '已访问',
        version_control: '已执行 Git',
        command: '已执行',
        tool: '已完成',
      }[intent] || '已完成'
    );
  }
  if (phase === 'failed') {
    return (
      {
        read: '读取失败',
        write: '写入失败',
        edit: '编辑失败',
        delete: '变更失败',
        review: '审核失败',
        verify: '验证失败',
        interaction: '交互失败',
        browse: '访问失败',
        version_control: 'Git 失败',
        command: '执行失败',
        tool: '工具失败',
      }[intent] || '失败'
    );
  }
  if (phase === 'waiting') {
    return '等待';
  }
  return (
    {
      read: '正在读取',
      write: '正在写入',
      edit: '正在编辑',
      delete: '正在变更',
      review: '正在审核',
      verify: '正在验证',
      interaction: '等待交互',
      browse: '正在访问',
      version_control: '正在执行 Git',
      command: '正在执行',
      tool: '正在调用',
    }[intent] || '正在处理'
  );
}

function statusLabel(intent, phase, subject) {
  const action = actionLabel(intent, phase);
  if (!subject) {
    return action;
  }
  return `${action} ${subject}`;
}

function detailText(toolName, args, result) {
  if (toolName === 'shell' && args?.command) {
    return truncate(args.command, 220);
  }
  if (result !== null && result !== undefined) {
    return truncate(typeof result === 'string' ? result : JSON.stringify(result), 220);
  }
  return truncate(JSON.stringify(args || {}), 220);
}

function inferCounts(toolName, args = {}, result = null) {
  if (toolName === 'write_file' && typeof args?.content === 'string') {
    const lines = countLines(args.content);
    return { files: 1, lines, additions: lines, deletions: 0 };
  }

  if (toolName === 'edit_file') {
    const additions = typeof args?.new_text === 'string' ? countLines(args.new_text) : 0;
    const deletions = typeof args?.old_text === 'string' ? countLines(args.old_text) : 0;
    if (additions || deletions) {
      return { files: 1, lines: additions, additions, deletions };
    }
  }

  const text = typeof result === 'string' ? result : '';
  if (!text) {
    return null;
  }

  const write = text.match(/File written successfully:\s+.+?\((\d+)\s+lines?/i);
  if (write) {
    const lines = Number(write[1] || 0);
    return { files: 1, lines, additions: lines, deletions: 0 };
  }

  const diff = text.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/i,
  );
  if (diff) {
    return {
      files: Number(diff[1] || 0),
      additions: Number(diff[2] || 0),
      deletions: Number(diff[3] || 0),
    };
  }

  const unified = countUnifiedDiffLines(text);
  if (unified.additions > 0 || unified.deletions > 0) {
    return {
      files: 1,
      lines: unified.additions,
      additions: unified.additions,
      deletions: unified.deletions,
    };
  }
  return null;
}

function countLines(text) {
  if (text === '') {
    return 0;
  }
  return String(text).split('\n').length;
}

function countUnifiedDiffLines(text) {
  const counts = { additions: 0, deletions: 0 };
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      counts.additions++;
    } else if (line.startsWith('-')) {
      counts.deletions++;
    }
  }
  return counts;
}

function canReview(intent, phase) {
  return phase === 'completed' && ['write', 'edit', 'delete', 'version_control'].includes(intent);
}

function canUndo(intent, phase) {
  return phase === 'completed' && ['write', 'edit', 'delete'].includes(intent);
}

function toolDisplayName(toolName, args) {
  if (toolName === 'shell') {
    return truncate(args?.command || 'shell', 80);
  }
  return toolName;
}

function activityId(toolName, args) {
  return `${toolName}:${inferTarget(toolName, args) || JSON.stringify(args || {}).slice(0, 80)}`;
}

function truncate(value, maxLength) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
