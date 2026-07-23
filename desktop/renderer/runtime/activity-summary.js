import { buildToolRuntimeCollections } from './runtime-details.js';

export function formatDuration(ms) {
  const value = Number(ms || 0);
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

export function getActivityTone(activity) {
  const phase = String(activity?.phase || activity?.status || '').toLowerCase();
  if (activity?.error || ['failed', 'error'].includes(phase)) return 'failed';
  if (['running', 'started'].includes(phase)) return 'running';
  if (['completed', 'success'].includes(phase)) return 'completed';
  return 'pending';
}

export function getFileTypeIcon(path = '') {
  if (/\.(jsx?|tsx?)$/i.test(path)) return 'JS';
  if (/\.py$/i.test(path)) return 'PY';
  if (/\.(md|txt)$/i.test(path)) return 'TXT';
  if (/\.json$/i.test(path)) return '{}';
  return 'FILE';
}

export function getFileStatusLabel(file) {
  return file?.status || (file?.deleted ? '删除' : file?.created ? '新增' : '修改');
}

function extractActivityFromMessage(message) {
  if (!message) return null;
  const type = message.type || message.event || '';
  const isTool = type.startsWith('tool') || type === 'tool_call' || type === 'activity';

  if (!isTool && message.tool === undefined && message.toolName === undefined) {
    return null;
  }

  const toolName = message.toolName || message.tool || message.name || type;
  const phase = message.phase || message.status ||
    (type.includes('start') || type.includes('_call') ? 'running' :
     type.includes('end') || type.includes('_result') ? 'completed' :
     type.includes('error') ? 'failed' : 'pending');
  const intent = message.intent || message.category || (toolName.includes('read') ? 'explore' :
    toolName.includes('write') || toolName.includes('edit') ? 'modify' :
    toolName.includes('search') || toolName.includes('grep') ? 'explore' : 'execute');

  return {
    id: message.id || `${toolName}-${message.timestamp || Date.now()}`,
    toolName,
    title: message.title || message.description || toolName,
    detail: message.detail || message.target || message.content || message.result || '',
    statusText: message.statusText || message.message || '',
    phase,
    intent,
    error: message.error || null,
    target: message.target || message.path || '',
    durationMs: message.durationMs || message.duration || 0,
    timestamp: message.timestamp || Date.now(),
  };
}

function extractFilesFromMessage(message) {
  if (!message) return [];
  const files = message.files || message.changedFiles || [];
  if (Array.isArray(files)) {
    return files.map((f) => (typeof f === 'string' ? { path: f, status: 'modified' } : f));
  }
  if (message.path || message.file) {
    return [{
      path: message.path || message.file,
      status: message.operation || message.status || 'modified',
      linesAdded: message.linesAdded || 0,
      linesDeleted: message.linesDeleted || 0,
      operation: message.operation || '',
    }];
  }
  return [];
}

export function buildActivitySummary(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const toolCollections = buildToolRuntimeCollections(list);
  const toolMessageIds = new Set(
    toolCollections.flatMap((collection) => collection.messages.map((message) => message.id).filter(Boolean)),
  );
  const activities = toolCollections.map((collection) => ({
    id: collection.id,
    toolName: collection.toolName,
    title: collection.toolName,
    detail: collection.resultPreview || collection.statusText || '',
    statusText: collection.statusText || '',
    phase: collection.phase,
    intent: collection.request?.intent || collection.request?.category || (
      collection.toolName.includes('read') || collection.toolName.includes('search') ? 'explore' :
      collection.toolName.includes('write') || collection.toolName.includes('edit') ? 'modify' :
      'execute'
    ),
    error: collection.error?.error || null,
    target: collection.args?.path || collection.args?.file || collection.args?.query || collection.request?.target || '',
    durationMs: collection.durationMs || 0,
    timestamp: collection.startedAt || collection.timestamp,
    toolCollection: collection,
  }));
  const filesMap = new Map();

  for (const msg of list) {
    if (msg?.id && toolMessageIds.has(msg.id)) {
      const files = extractFilesFromMessage(msg);
      for (const f of files) {
        const key = f.path || String(f);
        if (!filesMap.has(key)) {
          filesMap.set(key, { path: key, ...f });
        }
      }
      continue;
    }
    const activity = extractActivityFromMessage(msg);
    if (activity) {
      activities.push(activity);
    }
    const files = extractFilesFromMessage(msg);
    for (const f of files) {
      const key = f.path || String(f);
      if (!filesMap.has(key)) {
        filesMap.set(key, { path: key, ...f });
      }
    }
  }

  const fileList = Array.from(filesMap.values());

  return {
    activities,
    files: fileList,
    total: activities.length,
  };
}
