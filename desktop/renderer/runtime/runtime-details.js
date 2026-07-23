const DETAIL_TYPES = new Set([
  'tool',
  'tool_call',
  'tool_result',
  'tool_error',
  'tool_collection',
  'thinking',
  'status',
  'activity',
]);

export function isThinkingMessage(message) {
  return message?.type === 'thinking' || message?.event === 'agent:thinking';
}

export function isStatusUpdateMessage(message) {
  return message?.type === 'status' || message?.event === 'status:update';
}

export function isRuntimeDetailMessage(message) {
  return isThinkingMessage(message) || isStatusUpdateMessage(message) || DETAIL_TYPES.has(message?.type) ||
    String(message?.event || '').startsWith('tool:');
}

export function isPrimaryMessage(message) {
  return !isRuntimeDetailMessage(message);
}

export function formatRuntimeDetailValue(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ''); }
}

export function compactToolResult(value, limit = 4000) {
  const text = formatRuntimeDetailValue(value);
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

export function getRuntimeDetailContent(message) {
  return compactToolResult(message?.content ?? message?.result ?? message?.error ?? message?.data ?? '');
}

export function buildThinkingSummary(messages = []) {
  const thinkingMessages = Array.isArray(messages) ? messages.filter(isThinkingMessage) : [];
  const iterations = new Set(thinkingMessages.map((message) => message?.iteration).filter(Boolean));
  return {
    count: thinkingMessages.length,
    messages: thinkingMessages,
    summary: thinkingMessages.length ? getRuntimeDetailContent(thinkingMessages.at(-1)) : '',
    latest: thinkingMessages.at(-1) || null,
    iterationCount: iterations.size,
  };
}

export function getRuntimeDetailPreviewText(message) {
  return getRuntimeDetailContent(message).replace(/\s+/g, ' ').slice(0, 160);
}

export function getStatusUpdateText(message) {
  return String(message?.content || message?.message || message?.status || message?.data?.message || '');
}

export function createRuntimeDetailId(message, index = 0) {
  return message?.id || `${message?.event || message?.type || 'detail'}-${message?.timestamp || index}-${index}`;
}

function getToolRuntimeKey(message = {}) {
  return (
    message.toolCallId ||
    message.callId ||
    message.activity?.id ||
    message.raw?.toolCallId ||
    message.raw?.id ||
    message.payload?.toolCallId ||
    message.payload?.id ||
    ''
  );
}

function getToolRuntimeName(message = {}) {
  return (
    message.toolName ||
    message.name ||
    message.tool ||
    message.activity?.toolName ||
    message.raw?.toolName ||
    message.raw?.name ||
    message.payload?.toolName ||
    message.payload?.name ||
    'tool'
  );
}

function isToolLifecycleMessage(message = {}) {
  const event = String(message.event || '');
  return (
    message.type === 'tool' ||
    message.type === 'tool_call' ||
    message.type === 'tool_result' ||
    message.type === 'tool_error' ||
    event.startsWith('tool:')
  );
}

function isToolRequestMessage(message = {}) {
  return message.type === 'tool' || message.type === 'tool_call' || message.event === 'tool:call';
}

function isToolResultMessage(message = {}) {
  return message.type === 'tool_result' || message.event === 'tool:result' || message.toolResult === true;
}

function isToolErrorMessage(message = {}) {
  return message.type === 'tool_error' || message.event === 'tool:error' || message.isError === true;
}

function createToolCollection(message, index) {
  const toolName = getToolRuntimeName(message);
  const key = getToolRuntimeKey(message) || `${toolName}:${index}`;
  const startedAt = message.startedAt || message.timestamp || Date.now();
  return {
    id: `tool:${key}`,
    key,
    type: 'tool_collection',
    toolName,
    request: null,
    result: null,
    error: null,
    updates: [],
    messages: [],
    phase: 'running',
    startedAt,
    updatedAt: startedAt,
    timestamp: startedAt,
  };
}

function attachToolLifecycleMessage(collection, message = {}) {
  collection.messages.push(message);
  collection.updatedAt = message.completedAt || message.timestamp || Date.now();

  if (isToolRequestMessage(message)) {
    collection.request = collection.request || message;
    collection.args = collection.args || message.args || message.arguments;
    collection.startedAt = message.startedAt || message.timestamp || collection.startedAt;
  } else if (isToolErrorMessage(message)) {
    collection.error = message;
    collection.result = collection.result || message;
    collection.phase = 'failed';
  } else if (isToolResultMessage(message)) {
    collection.result = message;
    collection.phase = message.isError ? 'failed' : 'completed';
  } else {
    collection.updates.push(message);
    if (collection.phase !== 'failed' && collection.phase !== 'completed') {
      collection.phase = message.phase || message.activity?.phase || 'running';
    }
  }

  if (message.toolResult === true && !collection.result && !message.isError) {
    collection.result = message;
    collection.phase = 'completed';
  }
  if (message.isError === true) {
    collection.error = message;
    collection.phase = 'failed';
  }
  collection.args = collection.args || message.args || message.arguments || collection.request?.args;
  collection.durationMs = message.durationMs || message.duration || collection.durationMs;
  collection.exitCode = message.exitCode ?? collection.exitCode;
  collection.progress = message.progress ?? collection.progress;
  collection.statusText = message.statusText || message.progressText || collection.statusText;
  return collection;
}

export function buildToolRuntimeCollections(messages = []) {
  const collections = [];
  const byKey = new Map();

  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    if (!isToolLifecycleMessage(message)) {
      continue;
    }

    const toolName = getToolRuntimeName(message);
    const key = getToolRuntimeKey(message) || `${toolName}:latest`;
    let collection = byKey.get(key);
    if (!collection) {
      collection = createToolCollection(message, index);
      byKey.set(key, collection);
      collections.push(collection);
    }
    attachToolLifecycleMessage(collection, message);
  }

  return collections.map((collection) => {
    const resultMessage = collection.error || collection.result;
    const completedAt = resultMessage?.completedAt || resultMessage?.timestamp || collection.updatedAt;
    const startedAt = collection.startedAt || collection.request?.startedAt || collection.timestamp;
    const durationMs = collection.durationMs ?? (
      completedAt && startedAt ? Math.max(0, completedAt - startedAt) : 0
    );
    return {
      ...collection,
      startedAt,
      completedAt: resultMessage ? completedAt : null,
      durationMs,
      duration: durationMs,
      resultValue: collection.error?.error ?? collection.error?.content ?? collection.result?.result ?? collection.result?.content,
      resultPreview: getRuntimeDetailContent(collection.error || collection.result || collection.request || {}).replace(/\s+/g, ' ').slice(0, 220),
      updateCount: collection.updates.length,
      messageCount: collection.messages.length,
    };
  });
}

export function createConversationGroups(messages = []) {
  const groups = [];
  for (const message of messages) {
    if (isPrimaryMessage(message) || groups.length === 0) {
      groups.push({
        id: message?.id || `group-${groups.length}`,
        primary: message,
        primaryMessage: message,
        messages: [message],
        details: [],
        runtimeDetails: [],
        toolCollections: [],
      });
    } else {
      groups.at(-1).details.push(message);
      groups.at(-1).runtimeDetails.push(message);
      groups.at(-1).messages.push(message);
      groups.at(-1).toolCollections = buildToolRuntimeCollections(groups.at(-1).runtimeDetails);
    }
  }
  return groups;
}

export function buildRuntimeDetailsExportData(messages = []) {
  return messages.map((message, index) => ({ id: createRuntimeDetailId(message, index), ...message }));
}
