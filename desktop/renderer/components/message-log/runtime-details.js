export function isRuntimeDetailMessage(msg) {
  if (!msg) {
    return false;
  }
  return (
    msg.runtimeDetail === true ||
    msg.event === 'agent:start' ||
    msg.event === 'agent:complete' ||
    msg.event === 'agent:error' ||
    msg.event === 'agent:stop' ||
    msg.event === 'status:update' ||
    msg.event === 'tool:call' ||
    msg.event === 'tool:result' ||
    msg.event === 'tool:error' ||
    ['tool', 'tool_result', 'debug', 'event'].includes(msg.type)
  );
}

export function isStatusUpdateMessage(msg) {
  return msg?.event === 'status:update';
}

export function isPrimaryMessage(msg) {
  if (!msg) {
    return false;
  }
  if (!isRuntimeDetailMessage(msg)) {
    return true;
  }
  return msg.event === 'agent:complete' && ['result', 'warning', 'success'].includes(msg.type);
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
  const fallbackText = formatRuntimeDetailValue(Object.fromEntries(
    Object.entries(fallbackFields).filter(([, value]) => value !== undefined && value !== '')
  ));

  return sections.join('\n\n') || fallbackText || '(无内容)';
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
    msg.content ||
    msg.message ||
    payload.message ||
    payload.status ||
    msg.status ||
    '状态更新'
  );
}

export function createConversationGroups(messages, {
  messageIsVisible,
  messageMatchesSearch,
}) {
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

  return groups.filter(group => group.messages.length > 0 || group.runtimeDetails.length > 0);
}

export function createRuntimeDetailId(groupId, msg, index) {
  const stablePart = msg.id || `${msg.event || msg.type || 'runtime'}_${msg.timestamp || 'no_time'}_${index}`;
  return `${groupId}_${stablePart}`;
}

export function buildRuntimeDetailsExportData(details) {
  return details.map(msg => ({
    event: msg.event || msg.type || 'unknown',
    type: msg.type || 'unknown',
    timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : null,
    toolName: msg.toolName || null,
    content: msg.content || msg.message || null,
    args: msg.args || null,
    result: msg.result || null,
    payload: msg.payload || null,
  }));
}
