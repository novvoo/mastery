/**
 * Runtime detail message classification and formatting.
 * 纯数据转换模块，不依赖 React/Electron，可被 Desktop 和 CLI 共享。
 */

const RUNTIME_DETAIL_ROLES = new Set(['system', 'developer']);
const RUNTIME_DETAIL_TYPES = new Set(['tool', 'tool_result', 'debug', 'event', 'thinking']);
const RUNTIME_DETAIL_SOURCES = new Set(['tool_instruction', 'system_instruction', 'internal']);
const RUNTIME_DETAIL_LEVELS = new Set(['debug', 'trace', 'info']);
const EVENT_PREFIXES = ['agent:', 'tool:', 'status:', 'workspace:', 'plan:'];
const TOOL_RELATED_FIELDS = [
  'toolName',
  'toolCallId',
  'toolCalls',
  'args',
  'arguments',
  'result',
  'activity',
];

const INTERNAL_CONTENT_PATTERNS = [
  /^You are a tool/i,
  /^You are a skill/i,
  /^\[SYSTEM\]/i,
  /^\[INTERNAL\]/i,
  /^\[DEVELOPER\]/i,
  /^<!--.*-->/,
  /^\/\*.*\*\//,
];

export function isRuntimeDetailMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return false;
  }

  if (msg.type === 'plan' || typeof msg.plan !== 'undefined' || Array.isArray(msg.planTasks)) {
    return false;
  }

  if (msg.runtimeDetail === true || msg.internal === true || msg.hidden === true) {
    return true;
  }

  if (RUNTIME_DETAIL_ROLES.has(msg.role)) {
    return true;
  }

  if (RUNTIME_DETAIL_TYPES.has(msg.type)) {
    return true;
  }

  if (RUNTIME_DETAIL_SOURCES.has(msg.source)) {
    return true;
  }

  if (RUNTIME_DETAIL_LEVELS.has(msg.level)) {
    return true;
  }

  if (typeof msg.event === 'string') {
    if (EVENT_PREFIXES.some((prefix) => msg.event.startsWith(prefix))) {
      return true;
    }
  }

  if (typeof msg.content === 'string') {
    if (INTERNAL_CONTENT_PATTERNS.some((pattern) => pattern.test(msg.content))) {
      return true;
    }
  }

  if (typeof msg.text === 'string') {
    if (INTERNAL_CONTENT_PATTERNS.some((pattern) => pattern.test(msg.text))) {
      return true;
    }
  }

  for (const field of TOOL_RELATED_FIELDS) {
    if (msg[field] !== undefined && msg[field] !== null) {
      return true;
    }
  }

  if (typeof msg.activity === 'object' && msg.activity !== null) {
    if (msg.activity.kind === 'tool_activity' || msg.activity.intent === 'tool') {
      return true;
    }
  }

  return false;
}

export function isThinkingMessage(msg) {
  return msg?.type === 'thinking' || msg?.event === 'agent:thinking';
}

function isDebugThinkingEvent(msg) {
  const payload = msg?.payload || msg?.raw || {};
  const hasDebugPayload = Boolean(payload?.eventName || payload?.data);
  const hasThinkingText = Boolean(
    (typeof msg?.thinkingText === 'string' && msg.thinkingText.trim()) ||
    (typeof payload?.text === 'string' && payload.text.trim()) ||
    (typeof payload?.reasoning === 'string' && payload.reasoning.trim()),
  );

  return isThinkingMessage(msg) && hasDebugPayload && !hasThinkingText;
}

export function isStatusUpdateMessage(msg) {
  return msg?.event === 'status:update';
}

export function isPrimaryMessage(msg) {
  if (!msg) {
    return false;
  }
  return !isRuntimeDetailMessage(msg);
}

export function formatRuntimeDetailValue(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function compactToolResult(resultText) {
  const lines = resultText.split('\n');
  const isScoreLine = lines.length > 1 && /^\[.+?\] → \d+% match/.test(lines[0].trim());
  let clean = isScoreLine ? lines.slice(1).join('\n').trim() : resultText;
  const allLines = clean.split('\n');
  if (allLines.length > 20) {
    clean = `${allLines.slice(0, 12).join('\n')}\n... [截断 ${allLines.length - 15} 行] ...\n${allLines.slice(-3).join('\n')}`;
  }
  return clean;
}

export function getRuntimeDetailContent(msg) {
  const sections = [];
  const primaryText = formatRuntimeDetailValue(msg.content || msg.message || msg.details);

  if (primaryText) {
    sections.push(primaryText);
  }

  if (msg.toolName) {
    sections.push(`工具: ${msg.toolName}`);
  }

  if (msg.activity?.statusText) {
    sections.push(`状态: ${msg.activity.statusText}`);
  }

  const argsText = formatRuntimeDetailValue(msg.args);
  if (argsText) {
    sections.push(`参数:\n${argsText}`);
  }

  const resultText = formatRuntimeDetailValue(msg.result);
  if (resultText) {
    sections.push(`结果:\n${compactToolResult(resultText)}`);
  }

  const payloadText = formatRuntimeDetailValue(msg.payload || msg.raw);
  if (payloadText && !sections.includes(payloadText)) {
    sections.push(`事件数据:\n${payloadText}`);
  }

  const fallbackFields = {
    event: msg.event,
    type: msg.type,
    status: msg.status,
    level: msg.level,
    source: msg.source,
    payloadSummary: msg.payloadSummary,
  };
  const fallbackText = formatRuntimeDetailValue(
    Object.fromEntries(
      Object.entries(fallbackFields).filter(([, value]) => value !== undefined && value !== ''),
    ),
  );

  return sections.join('\n\n') || fallbackText || '(无内容)';
}

export function buildThinkingSummary(runtimeDetails = []) {
  const thinkingMessages = runtimeDetails.filter(
    (msg) => isThinkingMessage(msg) && !isDebugThinkingEvent(msg),
  );
  const iterations = thinkingMessages
    .map((msg) => msg.iteration)
    .filter((value) => value !== null && value !== undefined);
  const latest = thinkingMessages.at(-1);
  const fullText = thinkingMessages
    .map((msg) => msg.thinkingText || msg.content || msg.message || '')
    .filter(Boolean)
    .join('\n\n');
  const summaries = thinkingMessages.map((msg) => msg.summary || msg.content || '').filter(Boolean);
  const summary = latest?.summary || summarizeText(summaries.join(' '), 180);

  return {
    messages: thinkingMessages,
    count: thinkingMessages.length,
    iterationCount: new Set(iterations).size,
    latest,
    summary,
    fullText,
  };
}

function summarizeText(text = '', limit = 180) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '';
  }
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, limit - 3))}...`;
}

export function getRuntimeDetailPreviewText(msg) {
  const directText = msg?.content || msg?.message || msg?.details;
  if (directText) {
    return String(directText).split('\n')[0].trim();
  }
  if (msg?.toolName) {
    return `工具: ${msg.toolName}`;
  }
  if (msg?.result) {
    return String(msg.result).split('\n')[0].trim();
  }
  const payload = msg?.payload || msg?.raw;
  if (payload) {
    return typeof payload === 'string'
      ? payload.split('\n')[0].trim()
      : JSON.stringify({
          event: msg.event,
          type: msg.type,
          status: msg.status,
          source: msg.source,
        });
  }
  return '(无内容)';
}

export function getStatusUpdateText(msg) {
  if (!msg) {
    return '准备执行';
  }
  const payload = msg.payload || msg.raw || {};
  return (
    msg.content || msg.message || payload.message || payload.status || msg.status || '状态更新'
  );
}

export function createConversationGroups(messages, { messageIsVisible, messageMatchesSearch }) {
  const groups = [];
  let currentGroup = null;

  const createGroup = (anchor, index) => ({
    id: `conversation_${anchor || index}`,
    messages: [],
    runtimeDetails: [],
  });

  messages.forEach((msg, index) => {
    const isPrimary = isPrimaryMessage(msg);

    if (isRuntimeDetailMessage(msg)) {
      if (!currentGroup) {
        currentGroup = createGroup(msg.id || msg.timestamp || 'runtime', index);
        groups.push(currentGroup);
      }
      if (!isPrimary && messageMatchesSearch(msg)) {
        currentGroup.runtimeDetails.push(msg);
      }
    }

    if (!isPrimary || !messageIsVisible(msg)) {
      return;
    }

    if (!currentGroup || msg.type === 'user') {
      currentGroup = createGroup(msg.id || msg.timestamp || 'message', index);
      groups.push(currentGroup);
    }
    currentGroup.messages.push(msg);
  });

  return groups.filter((group) => group.messages.length > 0 || group.runtimeDetails.length > 0);
}

export function createRuntimeDetailId(groupId, msg, index) {
  const stablePart =
    msg.id || `${msg.event || msg.type || 'runtime'}_${msg.timestamp || 'no_time'}_${index}`;
  return `${groupId}_${stablePart}`;
}

export function buildRuntimeDetailsExportData(details) {
  return details.map((msg) => ({
    event: msg.event || msg.type || 'unknown',
    type: msg.type || 'unknown',
    timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : null,
    toolName: msg.toolName || null,
    content: msg.content || msg.message || null,
    args: msg.args || null,
    result: msg.result || null,
    payload: msg.payload || null,
    activity: msg.activity || null,
  }));
}
