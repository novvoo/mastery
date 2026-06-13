export function buildActivitySummary(runtimeDetails = []) {
  const activities = [];
  const byKey = new Map();
  const fileStates = new Map();
  let waitingForUser = false;

  for (const detail of runtimeDetails) {
    if (
      detail?.payload?.status === 'needs_user_input' ||
      detail?.payload?.result?.status === 'needs_user_input' ||
      detail?.status === 'needs_user_input'
    ) {
      waitingForUser = true;
    }

    const activity = detail.activity || detail.payload?.activity || (detail.event === 'tool:activity' ? detail.payload : null);
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
    };
    byKey.set(key, next);
  }

  for (const activity of byKey.values()) {
    activities.push(activity);
    updateFileState(fileStates, activity);
  }

  const taskStages = buildTaskStages(activities, waitingForUser);
  const completed = activities.filter(activity => activity.phase === 'completed').length;
  const failed = activities.filter(activity => activity.phase === 'failed').length;
  const running = activities.filter(activity => activity.phase === 'running' || activity.phase === 'waiting').length;
  const reviewable = activities.filter(activity => activity.canReview).length;
  const undoable = activities.filter(activity => activity.canUndo).length;
  const fileTargets = new Set(
    activities
      .filter(activity => ['read', 'write', 'edit', 'delete'].includes(activity.intent) && activity.target)
      .map(activity => activity.target)
  );

  return {
    activities: activities.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)),
    taskStages,
    progress: taskStages.length > 0
      ? Math.round((taskStages.filter(stage => stage.status === 'completed').length / taskStages.length) * 100)
      : 0,
    files: Array.from(fileStates.values()).sort((a, b) => (a.path || '').localeCompare(b.path || '')),
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

export function getActivityTone(activity) {
  if (activity.phase === 'failed') {return 'failed';}
  if (activity.phase === 'completed') {return 'completed';}
  if (activity.phase === 'waiting') {return 'waiting';}
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
      const hasFailure = activities.some(activity => activity.phase === 'failed');
      const hasRunning = activities.some(activity => ['running', 'waiting'].includes(activity.phase));
      const hasAny = activities.length > 0;
      return {
        ...stage,
        status: hasFailure ? 'failed' : hasRunning ? 'running' : hasAny ? 'completed' : 'pending',
      };
    }

    const matching = activities.filter(activity => stage.intents.includes(activity.intent));
    if (matching.length === 0) {
      return { ...stage, status: 'pending' };
    }
    if (matching.some(activity => activity.phase === 'failed')) {
      return { ...stage, status: 'failed' };
    }
    if (matching.some(activity => ['running', 'waiting'].includes(activity.phase))) {
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
    reads: 0,
    writes: 0,
    edits: 0,
    deletes: 0,
  };

  if (activity.intent === 'read') {
    previous.reads++;
  } else if (activity.intent === 'write') {
    previous.writes++;
  } else if (activity.intent === 'edit') {
    previous.edits++;
  } else if (activity.intent === 'delete') {
    previous.deletes++;
  }

  previous.status = fileStatusForActivity(activity, previous);
  previous.updatedAt = activity.updatedAt || activity.timestamp || Date.now();
  fileStates.set(activity.target, previous);
}

function fileStatusForActivity(activity, aggregate) {
  if (activity.phase === 'failed') {
    return 'failed';
  }
  if (activity.phase === 'running') {
    return 'running';
  }
  if (activity.phase === 'waiting') {
    return 'waiting';
  }
  if (aggregate.deletes > 0) {
    return 'deleted';
  }
  if (aggregate.edits > 0) {
    return 'edited';
  }
  if (aggregate.writes > 0) {
    return 'created';
  }
  if (aggregate.reads > 0) {
    return 'read';
  }
  return 'completed';
}

export function getFileStatusLabel(status) {
  return {
    read: '已读',
    edited: '已编辑',
    created: '已创建',
    deleted: '已删除',
    completed: '已完成',
    running: '进行中',
    waiting: '等待确认',
    failed: '失败',
    pending: '待处理',
  }[status] || status;
}
