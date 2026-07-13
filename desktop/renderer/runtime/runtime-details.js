const DETAIL_TYPES = new Set(['tool', 'tool_call', 'tool_result', 'tool_error', 'thinking', 'status', 'activity']);

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
      });
    } else {
      groups.at(-1).details.push(message);
      groups.at(-1).runtimeDetails.push(message);
      groups.at(-1).messages.push(message);
    }
  }
  return groups;
}

export function buildRuntimeDetailsExportData(messages = []) {
  return messages.map((message, index) => ({ id: createRuntimeDetailId(message, index), ...message }));
}
