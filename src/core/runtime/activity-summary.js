/**
 * Activity summary builder - aggregates runtime events into structured activity summaries.
 * 纯数据转换模块，不依赖 React/Electron，可被 Desktop 和 CLI 共享。
 */
import { describeToolActivity } from './tool-activity.js';

export function buildActivitySummary(runtimeDetails = []) {
  const activities = [];
  const byKey = new Map();
  const fileStates = new Map();
  let waitingForUser = false;
  const planEvents = [];

  for (const detail of runtimeDetails) {
    if (
      detail?.payload?.status === 'needs_user_input' ||
      detail?.payload?.result?.status === 'needs_user_input' ||
      detail?.status === 'needs_user_input'
    ) {
      waitingForUser = true;
    }

    const planEvent = getPlanEventFromDetail(detail);
    if (planEvent) {
      planEvents.push(planEvent);
    }

    const activity = getActivityFromDetail(detail);
    if (!activity || activity.kind !== 'tool_activity') {
      continue;
    }

    const key = activity.id || `${activity.toolName}:${activity.target || activities.length}`;
    const previous = byKey.get(key);
    const next = {
      ...previous,
      ...activity,
      startedAt: previous?.startedAt || detail.timestamp || activity.timestamp,
      updatedAt: detail.timestamp || activity.timestamp || Date.now(),
      // 保留最高进度值
      progress:
        activity.progress !== null && activity.progress !== undefined
          ? Math.max(previous?.progress || 0, activity.progress)
          : previous?.progress,
      counts: mergeCounts(previous?.counts, activity.counts),
    };
    byKey.set(key, next);
  }

  for (const activity of byKey.values()) {
    activities.push(activity);
    updateFileState(fileStates, activity);
  }

  const taskStages = buildTaskStages(activities, waitingForUser);
  const completed = activities.filter((activity) => activity.phase === 'completed').length;
  const failed = activities.filter((activity) => activity.phase === 'failed').length;
  const running = activities.filter(
    (activity) => activity.phase === 'running' || activity.phase === 'waiting',
  ).length;
  const reviewable = activities.filter((activity) => activity.canReview).length;
  const undoable = activities.filter((activity) => activity.canUndo).length;
  const fileTargets = new Set(
    activities
      .filter(
        (activity) =>
          ['read', 'write', 'edit', 'delete'].includes(activity.intent) && activity.target,
      )
      .map((activity) => activity.target),
  );

  return {
    activities: activities.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)),
    plan: buildPlanSummary(planEvents),
    taskStages,
    progress:
      taskStages.length > 0
        ? Math.round(
            (taskStages.filter((stage) => stage.status === 'completed').length /
              taskStages.length) *
              100,
          )
        : 0,
    files: Array.from(fileStates.values()).sort((a, b) =>
      (a.path || '').localeCompare(b.path || ''),
    ),
    completed,
    failed,
    running,
    reviewable,
    undoable,
    fileCount: fileTargets.size,
    waitingForUser,
    total: activities.length,
  };
}

function getPlanEventFromDetail(detail) {
  if (!detail || !['plan:created', 'plan:updated'].includes(detail.event)) {
    return null;
  }

  const payload = detail.payload || {};
  const plan = detail.plan || payload.plan || payload;
  const tasks = normalizePlanTasks(plan?.tasks || detail.planTasks);
  const completed = tasks.filter((task) => task.displayStatus === 'completed').length;
  const running = tasks.filter((task) => task.displayStatus === 'running').length;
  const failed = tasks.filter((task) => task.displayStatus === 'failed').length;
  const needsRepair = tasks.filter((task) => task.displayStatus === 'needs_repair').length;
  const total = tasks.length;

  return {
    id:
      detail.id ||
      `${detail.event}:${detail.timestamp || plan?.id || plan?.name || planEventsKey(plan)}`,
    type: detail.event === 'plan:created' ? 'created' : 'updated',
    title:
      detail.content || (detail.event === 'plan:created' ? '执行计划已创建' : '执行计划已更新'),
    tasks,
    progress: {
      total,
      completed,
      running,
      failed,
      needsRepair,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    update: detail.planUpdate || payload.update || null,
    toolName: detail.toolName || payload.toolName || '',
    timestamp: detail.timestamp || payload.timestamp || Date.now(),
  };
}

function normalizePlanTasks(tasks) {
  if (!Array.isArray(tasks)) {
    if (tasks && typeof tasks === 'object') {
      return Object.values(tasks).map(normalizePlanTask);
    }
    return [];
  }
  return tasks.map(normalizePlanTask);
}

function normalizePlanTask(task) {
  const status = String(task?.status || 'pending').toLowerCase();
  const displayStatus = String(task?.displayStatus || task?.result?.displayStatus || status).toLowerCase();
  return {
    id: task?.id || task?.name || '',
    name: task?.name || task?.id || 'Task',
    description: task?.description || '',
    status,
    displayStatus,
    statusReason: task?.statusReason || task?.result?.statusReason || '',
    cycleLabel: task?.cycleLabel || '',
  };
}

function buildPlanSummary(planEvents) {
  const events = planEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const latest = events.at(-1) || null;
  return {
    events,
    latest,
    tasks: latest?.tasks || [],
    progress: latest?.progress || { total: 0, completed: 0, running: 0, failed: 0, progress: 0 },
    created: events.some((event) => event.type === 'created'),
    updateCount: events.filter((event) => event.type === 'updated').length,
  };
}

function planEventsKey(plan) {
  return JSON.stringify(plan || {}).slice(0, 80);
}

function getActivityFromDetail(detail) {
  const explicitActivity =
    detail?.activity ||
    detail?.payload?.activity ||
    (detail?.event === 'tool:activity' ? detail.payload : null);
  if (explicitActivity?.kind === 'tool_activity') {
    return explicitActivity;
  }

  const toolName =
    detail?.toolName || detail?.name || detail?.payload?.toolName || detail?.payload?.name;
  if (!toolName) {
    return null;
  }

  if (detail?.event === 'tool:error') {
    return describeToolActivity(
      toolName,
      getToolArgs(detail),
      'failed',
      detail?.error ?? detail?.payload?.error,
    );
  }

  if (detail?.event === 'tool:call' || detail?.type === 'tool') {
    return describeToolActivity(toolName, getToolArgs(detail), 'running');
  }

  if (detail?.event === 'tool:result' || detail?.type === 'tool_result') {
    return describeToolActivity(
      toolName,
      getToolArgs(detail),
      'completed',
      detail?.result ?? detail?.payload?.result,
    );
  }

  return null;
}

function getToolArgs(detail) {
  const args =
    detail?.args ?? detail?.arguments ?? detail?.payload?.args ?? detail?.payload?.arguments;
  return args && typeof args === 'object' ? args : {};
}

function mergeCounts(previous, next) {
  if (!previous) {
    return next || null;
  }
  if (!next) {
    return previous || null;
  }
  return {
    ...previous,
    ...next,
    additions: Math.max(Number(previous.additions || 0), Number(next.additions || 0)),
    deletions: Math.max(Number(previous.deletions || 0), Number(next.deletions || 0)),
    lines: Math.max(Number(previous.lines || 0), Number(next.lines || 0)),
    files: Math.max(Number(previous.files || 0), Number(next.files || 0)),
  };
}

export function getActivityTone(activity) {
  if (activity.phase === 'failed') {
    return 'failed';
  }
  if (activity.phase === 'completed') {
    return 'completed';
  }
  if (activity.phase === 'waiting') {
    return 'waiting';
  }
  return 'running';
}

function buildTaskStages(activities, waitingForUser) {
  const stages = [
    { id: 'inspect', label: '读取上下文', intents: ['read', 'browse'] },
    { id: 'change', label: '写入/编辑', intents: ['write', 'edit', 'delete'] },
    { id: 'verify', label: '验证结果', intents: ['verify', 'review'] },
    { id: 'complete', label: '完成收口', intents: [] },
  ];

  return stages.map((stage) => {
    if (stage.id === 'complete') {
      if (waitingForUser) {
        return { ...stage, status: 'waiting' };
      }
      const hasFailure = activities.some((activity) => activity.phase === 'failed');
      const hasRunning = activities.some((activity) =>
        ['running', 'waiting'].includes(activity.phase),
      );
      const hasAny = activities.length > 0;
      return {
        ...stage,
        status: hasFailure ? 'failed' : hasRunning ? 'running' : hasAny ? 'completed' : 'pending',
      };
    }

    const matching = activities.filter((activity) => stage.intents.includes(activity.intent));
    if (matching.length === 0) {
      return { ...stage, status: 'pending' };
    }
    if (matching.some((activity) => activity.phase === 'failed')) {
      return { ...stage, status: 'failed' };
    }
    if (matching.some((activity) => ['running', 'waiting'].includes(activity.phase))) {
      return { ...stage, status: 'running' };
    }
    return { ...stage, status: 'completed' };
  });
}

function updateFileState(fileStates, activity) {
  if (!activity?.target || !['read', 'write', 'edit', 'delete'].includes(activity.intent)) {
    return;
  }

  const previous = fileStates.get(activity.target) || {
    path: activity.target,
    status: 'pending',
    operation: 'pending',
    reads: 0,
    writes: 0,
    edits: 0,
    deletes: 0,
    linesAdded: 0,
    linesDeleted: 0,
    linesWritten: 0,
  };

  if (activity.intent === 'read') {
    previous.reads++;
    previous.operation = 'read';
  } else if (activity.intent === 'write') {
    previous.writes++;
    previous.operation = 'write';
  } else if (activity.intent === 'edit') {
    previous.edits++;
    previous.operation = 'edit';
  } else if (activity.intent === 'delete') {
    previous.deletes++;
    previous.operation = 'delete';
  }

  if (activity.counts) {
    previous.linesAdded += Number(activity.counts.additions || 0);
    previous.linesDeleted += Number(activity.counts.deletions || 0);
    previous.linesWritten += Number(activity.counts.lines || activity.counts.additions || 0);
  }

  previous.status = fileStatusForActivity(activity);
  previous.updatedAt = activity.updatedAt || activity.timestamp || Date.now();
  fileStates.set(activity.target, previous);
}

function fileStatusForActivity(activity) {
  if (activity.phase === 'failed') {
    return 'failed';
  }
  if (activity.phase === 'running') {
    return 'running';
  }
  if (activity.phase === 'waiting') {
    return 'waiting';
  }
  if (activity.phase === 'completed') {
    if (activity.intent === 'read') {
      return 'read';
    }
    if (activity.intent === 'edit') {
      return 'edited';
    }
    if (activity.intent === 'write') {
      return 'created';
    }
    if (activity.intent === 'delete') {
      return 'deleted';
    }
    return 'completed';
  }
  return 'completed';
}

export function getFileStatusLabel(status) {
  return (
    {
      read: '已读',
      write: '写入',
      edit: '编辑',
      delete: '删除',
      edited: '已编辑',
      created: '已创建',
      deleted: '已删除',
      completed: '已完成',
      running: '进行中',
      waiting: '等待确认',
      failed: '失败',
      pending: '待处理',
    }[status] || status
  );
}

/**
 * 根据文件扩展名返回类型图标文字
 */
export function getFileTypeIcon(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '🗎';
  }
  const ext = filePath.split('.').pop().toLowerCase();
  const iconMap = {
    js: 'JS',
    jsx: 'JX',
    ts: 'TS',
    tsx: 'TX',
    mjs: 'MJ',
    cjs: 'CJ',
    json: '{}',
    jsonc: '{}',
    json5: '{}',
    html: 'HT',
    htm: 'HT',
    css: 'CS',
    scss: 'SC',
    less: 'LS',
    md: 'MD',
    mdx: 'MX',
    txt: 'TX',
    csv: 'CV',
    py: 'PY',
    rb: 'RB',
    go: 'GO',
    rs: 'RS',
    java: 'JV',
    kt: 'KT',
    sh: 'SH',
    bash: 'SH',
    zsh: 'SH',
    fish: 'SH',
    yml: 'YL',
    yaml: 'YL',
    toml: 'TM',
    ini: 'IN',
    env: 'EN',
    sql: 'SQ',
    graphql: 'GQ',
    prisma: 'PR',
    png: 'IM',
    jpg: 'IM',
    jpeg: 'IM',
    gif: 'IM',
    svg: 'SV',
    webp: 'IM',
    ico: 'IM',
    woff: 'WF',
    woff2: 'WF',
    ttf: 'TF',
    eot: 'TF',
    zip: 'ZP',
    tar: 'ZP',
    gz: 'ZP',
    rar: 'ZP',
    lock: 'LK',
    log: 'LG',
    map: 'MP',
    dockerfile: 'DK',
    gitignore: 'GI',
  };
  return iconMap[ext] || '🗎';
}

/**
 * 格式化时长（毫秒 → 可读字符串）
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || ms < 0) {
    return '';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m${sec > 0 ? ` ${sec}s` : ''}`;
}
