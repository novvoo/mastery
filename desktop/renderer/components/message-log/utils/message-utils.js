export function getStableMessageId(msg = {}, index, scope = 'list') {
  if (msg.id) {return String(msg.id);}
  const timestamp = msg.timestamp || msg.createdAt || '';
  const type = msg.type || msg.event || 'message';
  const contentSeed = [
    msg.toolName,
    msg.name,
    typeof msg.content === 'string' ? msg.content.slice(0, 80) : '',
    typeof msg.message === 'string' ? msg.message.slice(0, 80) : '',
    typeof msg.result === 'string' ? msg.result.slice(0, 80) : '',
  ].filter(Boolean).join(':');
  return `${scope}_${type}_${timestamp}_${index}_${contentSeed}`.replace(/\s+/g, '_');
}

export function safeStringify(value, fallback = '') {
  if (value == null) {return fallback;}
  if (typeof value === 'string') {return value;}
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) {return '[Circular]';}
        seen.add(item);
      }
      if (typeof item === 'function') {return `[Function ${item.name || 'anonymous'}]`;}
      return item;
    }, 2);
  } catch (error) {
    return fallback || String(value);
  }
}

function stripVisibleToolProtocol(text) {
  if (typeof text !== 'string') {
    return text;
  }

  return text
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/```(?:json|tool)?\s*\{[\s\S]*?\}\s*```/gi, '')
    .split('\n')
    .filter((line) => !/^\s*CALL\s+[A-Za-z_][\w.-]*\s*\(/.test(line))
    .join('\n')
    .trim();
}

export function getMessageDisplayText(msg = {}) {
  const candidates = [
    msg.content,
    msg.message,
    msg.answer,
    msg.text,
    msg.response,
    msg.result,
    msg.result?.answer,
    msg.result?.response,
    msg.result?.text,
    msg.resultMeta?.answer,
    msg.resultMeta?.content,
    msg.resultMeta?.result,
    msg.resultMeta?.result?.answer,
    msg.resultMeta?.result?.response,
    msg.resultMeta?.result?.text,
    msg.payload?.answer,
    msg.payload?.content,
    msg.payload?.message,
    msg.payload?.text,
    msg.payload?.chunk,
    msg.payload?.result?.answer,
    msg.payload?.result?.response,
    msg.payload?.result?.text,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return stripVisibleToolProtocol(value);
    }
  }

  if (msg.event === 'agent:complete' || msg.streamComplete) {
    return '任务执行完成';
  }

  if (msg.isStreaming || msg.type === 'assistant_stream') {
    return '';
  }

  return '';
}

export function getMessageSerializableText(msg = {}) {
  return getMessageDisplayText(msg)
    || safeStringify(msg.content)
    || safeStringify(msg.message)
    || safeStringify(msg.result)
    || safeStringify(msg.payload)
    || safeStringify(msg.raw)
    || '';
}
