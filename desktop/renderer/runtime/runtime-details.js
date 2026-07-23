const DETAIL_TYPES = new Set([
  'tool',
  'tool_call',
  'tool_result',
  'tool_error',
  'tool_collection',
  'thinking',
  'status',
  'activity',
  'event',
  'lifecycle',
]);

export function isThinkingMessage(message) {
  return message?.type === 'thinking' || message?.event === 'agent:thinking';
}

export function isStatusUpdateMessage(message) {
  return message?.type === 'status' || message?.event === 'status:update';
}

export function isRuntimeDetailMessage(message) {
  return isThinkingMessage(message) || isStatusUpdateMessage(message) || DETAIL_TYPES.has(message?.type) ||
    String(message?.event || '').startsWith('tool:') ||
    ['agent:start', 'agent:stop'].includes(message?.event) ||
    (message?.event === 'agent:complete' && message?.runtimeDetail === true);
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

export function buildLifecycleGraph(messages = []) {
  const lifecycleMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.type === 'lifecycle' || ['agent:start', 'agent:stop'].includes(message?.event) || (message?.event === 'agent:complete' && message?.runtimeDetail === true))
    .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
  const hasTools = (Array.isArray(messages) ? messages : []).some((message) => (
    message?.type === 'tool' ||
    message?.type === 'tool_result' ||
    String(message?.event || '').startsWith('tool:')
  ));
  const nodes = [];
  const pushNode = (id, label, phase, message = null) => {
    if (!nodes.some((node) => node.id === id)) {
      nodes.push({
        id,
        label,
        phase,
        timestamp: message?.timestamp || null,
        message,
      });
    }
  };

  for (const message of lifecycleMessages) {
    if (message.event === 'agent:start' || message.lifecyclePhase === 'started') {
      pushNode('started', '开始', 'completed', message);
    }
    if (message.event === 'agent:stop' || message.lifecyclePhase === 'stopped') {
      pushNode('stopped', '停止', 'failed', message);
    }
    if (message.event === 'agent:complete' || message.lifecyclePhase === 'completed') {
      pushNode('completed', '完成', 'completed', message);
    }
  }

  if (hasTools) {
    const hasTerminal = nodes.some((node) => node.id === 'completed' || node.id === 'stopped');
    pushNode('tools', '执行', hasTerminal ? 'completed' : 'running');
  }

  if (nodes.length === 0 && hasTools) {
    pushNode('tools', '执行', 'running');
  }

  const order = ['started', 'tools', 'completed', 'stopped'];
  return nodes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
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

function getToolArgs(message = {}) {
  return message.args || message.arguments || message.payload?.args || message.payload?.arguments || null;
}

function getToolTarget(args = {}, message = {}) {
  if (!args || typeof args !== 'object') {
    return message.target || message.path || message.file || '';
  }
  return (
    args.command ||
    args.cmd ||
    args.path ||
    args.file ||
    args.query ||
    args.pattern ||
    args.url ||
    message.target ||
    message.path ||
    message.file ||
    ''
  );
}

function getToolResponseValue(message = {}) {
  return message.result ?? message.error ?? message.content ?? message.message ?? message.payload?.result ?? '';
}

function attachToolLifecycleMessage(collection, message = {}) {
  collection.messages.push(message);
  collection.updatedAt = message.completedAt || message.timestamp || Date.now();

  if (isToolRequestMessage(message)) {
    collection.request = collection.request || message;
    collection.args = collection.args || getToolArgs(message);
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
  collection.args = collection.args || getToolArgs(message) || getToolArgs(collection.request);
  collection.durationMs = message.durationMs || message.duration || collection.durationMs;
  collection.exitCode = message.exitCode ?? collection.exitCode;
  collection.progress = message.progress ?? collection.progress;
  collection.statusText = message.statusText || message.progressText || collection.statusText;
  return collection;
}

export function buildToolRuntimeCollections(messages = []) {
  const collections = [];
  const byKey = new Map();
  const openFallbackByTool = new Map();

  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    if (!isToolLifecycleMessage(message)) {
      continue;
    }

    const toolName = getToolRuntimeName(message);
    const explicitKey = getToolRuntimeKey(message);
    let key = explicitKey;

    if (!key && isToolRequestMessage(message)) {
      key = `fallback:${toolName}:${index}`;
      const openKeys = openFallbackByTool.get(toolName) || [];
      openKeys.push(key);
      openFallbackByTool.set(toolName, openKeys);
    } else if (!key) {
      const openKeys = openFallbackByTool.get(toolName) || [];
      key = openKeys.at(-1) || `unmatched:${toolName}:${index}`;
    }

    let collection = byKey.get(key);
    if (!collection) {
      collection = createToolCollection(message, index);
      collection.id = `tool:${key}`;
      collection.key = key;
      byKey.set(key, collection);
      collections.push(collection);
    }
    attachToolLifecycleMessage(collection, message);

    if (!explicitKey && (isToolResultMessage(message) || isToolErrorMessage(message) || message.toolResult === true)) {
      const openKeys = openFallbackByTool.get(toolName) || [];
      const keyIndex = openKeys.lastIndexOf(key);
      if (keyIndex >= 0) {
        openKeys.splice(keyIndex, 1);
      }
      if (openKeys.length === 0) {
        openFallbackByTool.delete(toolName);
      } else {
        openFallbackByTool.set(toolName, openKeys);
      }
    }
  }

  return collections.map((collection) => {
    const resultMessage = collection.error || collection.result;
    const completedAt = resultMessage?.completedAt || resultMessage?.timestamp || collection.updatedAt;
    const startedAt = collection.startedAt || collection.request?.startedAt || collection.timestamp;
    const durationMs = collection.durationMs ?? (
      completedAt && startedAt ? Math.max(0, completedAt - startedAt) : 0
    );
    const latestProgress = collection.updates.at(-1);
    const requestValue = collection.args
      ? formatRuntimeDetailValue(collection.args)
      : getRuntimeDetailContent(collection.request || {});
    const responseValue = getToolResponseValue(collection.error || collection.result || {});
    const responseText = responseValue ? formatRuntimeDetailValue(responseValue) : '';
    const target = getToolTarget(collection.args, collection.request || {});
    const latestProgressText =
      latestProgress?.activity?.statusText ||
      latestProgress?.statusText ||
      latestProgress?.progressText ||
      collection.statusText ||
      '';
    return {
      ...collection,
      startedAt,
      completedAt: resultMessage ? completedAt : null,
      durationMs,
      duration: durationMs,
      target,
      requestValue,
      responseValue,
      responseText,
      latestProgress,
      latestProgressText,
      displaySubtitle: latestProgressText || target || collection.toolName,
      resultValue: responseValue,
      resultPreview: (responseText || requestValue || target).replace(/\s+/g, ' ').slice(0, 220),
      updateCount: collection.updates.length,
      messageCount: collection.messages.length,
    };
  });
}

function getTurnCorrelationKey(message = {}) {
  return (
    message.turnId ||
    message.runId ||
    message.correlationId ||
    message.metadata?.correlationId ||
    message.raw?.turnId ||
    message.raw?.runId ||
    message.raw?.correlationId ||
    message.payload?.turnId ||
    message.payload?.runId ||
    message.payload?.correlationId ||
    message.resultMeta?.turnId ||
    message.resultMeta?.runId ||
    message.resultMeta?.correlationId ||
    ''
  );
}

function isUserRequestMessage(message = {}) {
  return message.type === 'user';
}

function isTerminalLifecycleMessage(message = {}) {
  return (
    message.lifecyclePhase === 'completed' ||
    message.lifecyclePhase === 'stopped' ||
    message.event === 'agent:stop' ||
    (message.event === 'agent:complete' && message.runtimeDetail === true)
  );
}

function isTerminalResponseMessage(message = {}) {
  if (message.isStreaming || message.type === 'assistant_stream') {
    return message.streamComplete === true;
  }
  if (message.type === 'agent' || message.type === 'assistant') {
    return message.event === 'agent:complete' || message.streamComplete === true;
  }
  return ['result', 'success', 'error', 'warning'].includes(message.type);
}

function deriveConversationTurnStatus(turn) {
  let status = 'running';
  for (const message of turn.messages || []) {
    if (message.lifecyclePhase === 'stopped' || message.event === 'agent:stop') {
      status = 'stopped';
    } else if (message.type === 'error' || message.event === 'agent:error') {
      status = 'failed';
    } else if (message.type === 'warning' || message.lifecyclePhase === 'waiting') {
      status = 'waiting';
    } else if (isTerminalLifecycleMessage(message) || isTerminalResponseMessage(message)) {
      status = 'completed';
    }
  }
  return status;
}

function createConversationTurn({ id, correlationKey = '', requestMessage = null, pendingDetails = [] }) {
  const primaryMessages = requestMessage ? [requestMessage] : [];
  return {
    id,
    correlationId: correlationKey || null,
    requestMessage,
    responseMessage: null,
    responseMessages: [],
    primary: requestMessage,
    primaryMessage: requestMessage,
    primaryMessages,
    messages: requestMessage ? [requestMessage, ...pendingDetails] : [...pendingDetails],
    details: [...pendingDetails],
    runtimeDetails: [...pendingDetails],
    toolCollections: [],
    status: 'running',
  };
}

function attachPrimaryMessage(turn, message) {
  turn.messages.push(message);
  turn.primaryMessages.push(message);
  if (isUserRequestMessage(message) && !turn.requestMessage) {
    turn.requestMessage = message;
  } else if (!isUserRequestMessage(message)) {
    turn.responseMessages.push(message);
    if (message.type !== 'plan' || !turn.responseMessage) {
      turn.responseMessage = message;
    }
  }
  turn.primary = turn.responseMessage || turn.requestMessage || turn.primaryMessages[0] || null;
  turn.primaryMessage = turn.primary;
}

function attachRuntimeDetail(turn, message) {
  turn.details.push(message);
  turn.runtimeDetails.push(message);
  turn.messages.push(message);
}

/**
 * 将有序消息投影为一次用户意图对应的 ConversationTurn。
 * 显式 correlation/run/turn ID 优先；旧消息缺少关联字段时，以 user message 作为 turn 边界。
 */
export function createConversationTurns(messages = []) {
  const turns = [];
  const turnsByCorrelation = new Map();
  const pendingRuntimeDetails = [];
  let activeTurn = null;

  const registerTurn = (turn) => {
    turns.push(turn);
    if (turn.correlationId) {
      turnsByCorrelation.set(turn.correlationId, turn);
    }
    return turn;
  };

  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    const correlationKey = getTurnCorrelationKey(message);
    const correlatedTurn = correlationKey ? turnsByCorrelation.get(correlationKey) : null;

    if (isUserRequestMessage(message)) {
      let turn = correlatedTurn || (
        !correlationKey &&
        activeTurn &&
        !activeTurn.requestMessage &&
        activeTurn.responseMessages.length === 0
          ? activeTurn
          : null
      );
      if (!turn) {
        const pending = pendingRuntimeDetails.splice(0);
        turn = registerTurn(createConversationTurn({
          id: correlationKey ? `turn:${correlationKey}` : `turn:${message.id || index}`,
          correlationKey,
          requestMessage: message,
          pendingDetails: pending,
        }));
      } else {
        attachPrimaryMessage(turn, message);
      }
      activeTurn = turn;
      continue;
    }

    let turn = correlatedTurn || activeTurn;
    if (!turn && !isPrimaryMessage(message) && !correlationKey) {
      pendingRuntimeDetails.push(message);
      continue;
    }
    if (!turn) {
      const pending = pendingRuntimeDetails.splice(0);
      turn = registerTurn(createConversationTurn({
        id: correlationKey ? `turn:${correlationKey}` : `turn:${message.id || index}`,
        correlationKey,
        pendingDetails: pending,
      }));
      activeTurn = turn;
    }

    if (isPrimaryMessage(message)) {
      attachPrimaryMessage(turn, message);
    } else {
      attachRuntimeDetail(turn, message);
    }
  }

  if (turns.length === 0 && pendingRuntimeDetails.length > 0) {
    registerTurn(createConversationTurn({
      id: `runtime-group-${pendingRuntimeDetails[0]?.id || 0}`,
      pendingDetails: pendingRuntimeDetails,
    }));
  }

  return turns.map((turn) => {
    const toolCollections = buildToolRuntimeCollections(turn.runtimeDetails);
    const status = deriveConversationTurnStatus(turn);
    return {
      ...turn,
      primary: turn.responseMessage || turn.requestMessage || turn.primaryMessages[0] || null,
      primaryMessage: turn.responseMessage || turn.requestMessage || turn.primaryMessages[0] || null,
      toolCollections,
      status,
      isTerminal: ['completed', 'failed', 'stopped'].includes(status),
    };
  });
}

// 兼容现有消费者；语义已经从“主消息邻接组”升级为 ConversationTurn。
export function createConversationGroups(messages = []) {
  return createConversationTurns(messages);
}

export function buildRuntimeDetailsExportData(messages = []) {
  return messages.map((message, index) => ({ id: createRuntimeDetailId(message, index), ...message }));
}
