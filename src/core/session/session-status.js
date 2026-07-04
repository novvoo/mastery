export const SessionStatus = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  INTERRUPTED: 'interrupted',
  ERROR: 'error',
  UNKNOWN: 'unknown',
});

export function deriveSessionStatus(messages = [], meta = {}) {
  if (meta.status) {
    return meta.status;
  }

  const hasMessages = Array.isArray(messages) && messages.length > 0;

  if (!hasMessages) {
    return SessionStatus.PENDING;
  }

  const lastMessage = messages[messages.length - 1];
  const lastType = lastMessage?.type || lastMessage?.role || '';

  if (lastType === 'result' || lastType === 'success') {
    return SessionStatus.COMPLETE;
  }

  if (lastType === 'error') {
    return SessionStatus.ERROR;
  }

  const hasTool = messages.some((m) => (m?.type || m?.role) === 'tool' || m?.type === 'tool_call');
  const hasUser = messages.some((m) => (m?.type || m?.role) === 'user');
  const hasAssistant = messages.some((m) => (m?.type || m?.role) === 'assistant');

  if (hasTool && !isTerminalMessage(lastMessage)) {
    return SessionStatus.INTERRUPTED;
  }

  if (hasUser && !hasAssistant) {
    return SessionStatus.INTERRUPTED;
  }

  return SessionStatus.UNKNOWN;
}

function isTerminalMessage(message) {
  if (!message) return false;
  const type = message?.type || message?.role || '';
  return (
    type === 'result' ||
    type === 'success' ||
    type === 'error' ||
    type === 'complete' ||
    type === 'interrupted'
  );
}

export function isFinalStatus(status) {
  return (
    status === SessionStatus.COMPLETE ||
    status === SessionStatus.INTERRUPTED ||
    status === SessionStatus.ERROR
  );
}

export function isActiveStatus(status) {
  return status === SessionStatus.RUNNING || status === SessionStatus.PENDING;
}

export function getStatusLabel(status) {
  const map = {
    [SessionStatus.PENDING]: '待开始',
    [SessionStatus.RUNNING]: '运行中',
    [SessionStatus.COMPLETE]: '已完成',
    [SessionStatus.INTERRUPTED]: '已中断',
    [SessionStatus.ERROR]: '出错',
    [SessionStatus.UNKNOWN]: '未知',
  };
  return map[status] || map[SessionStatus.UNKNOWN];
}

export function getStatusColor(status) {
  const map = {
    [SessionStatus.PENDING]: 'muted',
    [SessionStatus.RUNNING]: 'primary',
    [SessionStatus.COMPLETE]: 'success',
    [SessionStatus.INTERRUPTED]: 'warning',
    [SessionStatus.ERROR]: 'error',
    [SessionStatus.UNKNOWN]: 'muted',
  };
  return map[status] || map[SessionStatus.UNKNOWN];
}
