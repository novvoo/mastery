export const DOUBLE_PRESS_WINDOW_MS = 1200;

export function createComposerInteractionState() {
  return {
    lastEscapeAt: 0,
    lastRiskConfirmAt: 0,
    lastRiskConfirmValue: '',
    historyIndex: -1,
    draftBeforeHistory: '',
    notice: null,
  };
}

function hasModifier(event) {
  return Boolean(event?.ctrlKey || event?.metaKey);
}

function normalizeHistory(history = []) {
  const seen = new Set();
  return history
    .map((item) =>
      typeof item === 'string' ? item : item?.input || item?.content || item?.title || '',
    )
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

export function handleComposerKey(event, state, context = {}) {
  const now = context.now || Date.now();
  const value = String(context.value || '');
  const status = context.status || 'idle';
  const history = normalizeHistory(context.history);
  const nextState = { ...state, notice: null };

  if (event.key === 'Enter' && hasModifier(event)) {
    const risk = assessPromptRisk(value);
    const requiresConfirmation = risk.level === 'high';
    const isConfirmed =
      requiresConfirmation &&
      state.lastRiskConfirmValue === value &&
      now - (state.lastRiskConfirmAt || 0) <= DOUBLE_PRESS_WINDOW_MS;

    if (requiresConfirmation && !isConfirmed && value.trim() && status !== 'running') {
      return {
        state: {
          ...nextState,
          lastRiskConfirmAt: now,
          lastRiskConfirmValue: value,
          notice: {
            tone: 'warning',
            text: `${risk.label}. Press Ctrl+Enter again to send.`,
          },
        },
        action: 'notice',
        risk,
      };
    }

    return {
      state: {
        ...nextState,
        lastRiskConfirmAt: 0,
        lastRiskConfirmValue: '',
        historyIndex: -1,
        draftBeforeHistory: '',
      },
      action: value.trim() && status !== 'running' ? 'submit' : 'noop',
      risk,
    };
  }

  if (event.key === 'Enter' && event.shiftKey) {
    return { state: nextState, action: 'insert_newline' };
  }

  if (event.key === 'Escape' && value.trim()) {
    const isSecondPress =
      state.lastEscapeAt > 0 && now - state.lastEscapeAt <= DOUBLE_PRESS_WINDOW_MS;
    if (isSecondPress) {
      return {
        state: {
          ...nextState,
          lastEscapeAt: 0,
          lastRiskConfirmAt: 0,
          lastRiskConfirmValue: '',
          historyIndex: -1,
          draftBeforeHistory: '',
        },
        action: 'clear',
      };
    }
    return {
      state: {
        ...nextState,
        lastEscapeAt: now,
        notice: {
          tone: 'warning',
          text: 'Esc again to clear draft',
        },
      },
      action: 'notice',
    };
  }

  if (event.key?.toLowerCase() === 'k' && hasModifier(event)) {
    return {
      state: { ...nextState, historyIndex: -1, draftBeforeHistory: '' },
      action: value ? 'clear' : 'noop',
    };
  }

  if (event.key === 'ArrowUp' && !value.trim() && history.length > 0) {
    const nextIndex =
      state.historyIndex < 0 ? 0 : Math.min(state.historyIndex + 1, history.length - 1);
    return {
      state: {
        ...nextState,
        historyIndex: nextIndex,
        draftBeforeHistory: state.historyIndex < 0 ? value : state.draftBeforeHistory,
      },
      action: 'replace_input',
      value: history[nextIndex],
    };
  }

  if (event.key === 'ArrowDown' && state.historyIndex >= 0) {
    const nextIndex = state.historyIndex - 1;
    return {
      state: {
        ...nextState,
        historyIndex: nextIndex,
      },
      action: 'replace_input',
      value: nextIndex >= 0 ? history[nextIndex] : state.draftBeforeHistory,
    };
  }

  return { state: nextState, action: 'noop' };
}

export function getComposerSubmitTransition({
  value,
  status = 'idle',
  clearInput = true,
  keepWhenBusy = true,
} = {}) {
  const input = String(value || '').trim();
  if (!input) {
    return {
      accepted: false,
      input: '',
      nextValue: String(value || ''),
      restoreValue: String(value || ''),
      focus: false,
      showSuggestions: String(value || '')
        .trimStart()
        .startsWith('/'),
    };
  }

  if (status === 'running') {
    const nextValue = keepWhenBusy ? input : String(value || '');
    return {
      accepted: false,
      input,
      nextValue,
      restoreValue: nextValue,
      focus: keepWhenBusy,
      showSuggestions: nextValue.trimStart().startsWith('/'),
    };
  }

  return {
    accepted: true,
    input,
    nextValue: clearInput ? '' : String(value || ''),
    restoreValue: input,
    focus: false,
    showSuggestions: clearInput
      ? false
      : String(value || '')
          .trimStart()
          .startsWith('/'),
  };
}

export function canEditComposerDraft() {
  return true;
}

export function hasUnsavedFileDraft(openFile, fileDraft) {
  if (!openFile) {
    return false;
  }
  return String(fileDraft ?? '') !== String(openFile.content ?? '');
}

const HIGH_RISK_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\b(drop|truncate)\s+(database|table)\b/i,
  /\bdelete\s+(all|everything|database|table|production)\b/i,
  /\bwipe\b/i,
  /\bformat\s+(disk|drive|volume)\b/i,
  /\bforce\s+push\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bdeploy\s+(to\s+)?prod(uction)?\b/i,
];

const MEDIUM_RISK_PATTERNS = [
  /\b(write|edit|modify|overwrite|patch|refactor)\b/i,
  /\binstall\b/i,
  /\bnpm\s+install\b/i,
  /\bbun\s+add\b/i,
  /\bgit\s+(commit|push|reset|stash|checkout)\b/i,
  /\b(shell|terminal|command|script)\b/i,
  /修改|编辑|写入|删除|提交|推送|安装|运行命令/,
];

export function assessPromptRisk(input = '') {
  const text = String(input || '').trim();
  if (!text) {
    return {
      level: 'idle',
      label: 'No task yet',
      reasons: [],
    };
  }

  const highReasons = HIGH_RISK_PATTERNS.filter((pattern) => pattern.test(text)).map(
    (pattern) => pattern.source,
  );
  if (highReasons.length > 0) {
    return {
      level: 'high',
      label: 'High-risk action detected',
      reasons: highReasons,
    };
  }

  const mediumReasons = MEDIUM_RISK_PATTERNS.filter((pattern) => pattern.test(text)).map(
    (pattern) => pattern.source,
  );
  if (mediumReasons.length > 0) {
    return {
      level: 'medium',
      label: 'Workspace-changing task',
      reasons: mediumReasons,
    };
  }

  return {
    level: 'low',
    label: 'Read or reasoning task',
    reasons: [],
  };
}

export function getShortcutHints({ hasHistory = false, status = 'idle' } = {}) {
  return [
    { key: 'Ctrl+Enter', label: status === 'running' ? 'busy' : 'send' },
    { key: 'Shift+Enter', label: 'newline' },
    { key: 'Esc Esc', label: 'clear draft' },
    { key: 'Ctrl+K', label: 'clear now' },
    { key: 'Up', label: hasHistory ? 'history' : 'history empty' },
    { key: '/', label: 'commands' },
  ];
}

export function getComposerAssistText({ status, value, notice }) {
  if (notice?.text) return notice.text;
  if (status === 'running') return 'Agent is running. Use the stop button to interrupt safely.';
  if (
    String(value || '')
      .trimStart()
      .startsWith('/')
  )
    return 'Command palette is open. Pick a command or keep typing.';
  return 'Ctrl+Enter sends. Shift+Enter adds a line. Esc twice clears. Up recalls history.';
}

export function deriveInteractionStages({ status = 'idle', messages = [] } = {}) {
  const hasUserInput = messages.some((message) => message.type === 'user');
  const hasThinking = messages.some(
    (message) => message.type === 'thinking' || message.type === 'assistant_stream',
  );
  const hasTool = messages.some((message) =>
    ['tool', 'tool_result', 'event'].includes(message.type),
  );
  const hasAnswer = messages.some((message) => ['result', 'success'].includes(message.type));
  const isRunning = status === 'running';
  const needsInput = status === 'needs_user_input';
  const hasError = status === 'error' || messages.some((message) => message.type === 'error');

  return [
    {
      key: 'input',
      label: 'Input',
      state: hasUserInput ? 'done' : 'idle',
      detail: hasUserInput ? 'captured' : 'waiting',
    },
    {
      key: 'reason',
      label: 'Reason',
      state: isRunning && !hasTool ? 'active' : hasThinking ? 'done' : 'idle',
      detail: isRunning && !hasTool ? 'thinking' : hasThinking ? 'summarized' : 'queued',
    },
    {
      key: 'tools',
      label: 'Tools',
      state: hasTool && isRunning ? 'active' : hasTool ? 'done' : 'idle',
      detail: getToolActivitySummary(messages).label,
    },
    {
      key: 'answer',
      label: needsInput ? 'Input Needed' : hasError ? 'Review' : 'Answer',
      state: needsInput
        ? 'attention'
        : hasError
          ? 'error'
          : hasAnswer
            ? 'done'
            : isRunning
              ? 'active'
              : 'idle',
      detail: needsInput
        ? 'waiting for you'
        : hasError
          ? 'needs attention'
          : hasAnswer
            ? 'ready'
            : 'forming',
    },
  ];
}

export function getToolActivitySummary(messages = []) {
  const toolMessages = messages.filter(
    (message) =>
      message.type === 'tool' ||
      message.type === 'tool_result' ||
      message.event?.startsWith?.('tool:') ||
      message.activity?.toolName,
  );
  const running = toolMessages.filter(
    (message) => message.activity?.phase === 'running' || message.type === 'tool',
  ).length;
  const completed = toolMessages.filter(
    (message) => message.activity?.phase === 'completed' || message.type === 'tool_result',
  ).length;
  const errored = toolMessages.filter(
    (message) => message.type === 'error' && message.toolName,
  ).length;
  const latest = toolMessages.at(-1);
  const latestTool = latest?.toolName || latest?.activity?.toolName || 'none';

  if (toolMessages.length === 0) {
    return { count: 0, running: 0, completed: 0, errored: 0, latestTool, label: 'none yet' };
  }

  const parts = [];
  if (running > 0) parts.push(`${running} running`);
  if (completed > 0) parts.push(`${completed} done`);
  if (errored > 0) parts.push(`${errored} error`);

  return {
    count: toolMessages.length,
    running,
    completed,
    errored,
    latestTool,
    label: `${latestTool} · ${parts.join(', ') || `${toolMessages.length} events`}`,
  };
}

export function createRunNarrative({ status = 'idle', messages = [] } = {}) {
  const toolSummary = getToolActivitySummary(messages);
  const lastMessage = messages.at(-1);

  if (status === 'running') {
    if (toolSummary.count > 0) {
      return `Running ${toolSummary.latestTool}: ${toolSummary.label}`;
    }
    return 'Running: reasoning before the next visible action';
  }

  if (status === 'needs_user_input') {
    return 'Paused: waiting for your answer before continuing';
  }

  if (status === 'error') {
    return `Review needed${lastMessage?.content ? `: ${String(lastMessage.content).slice(0, 80)}` : ''}`;
  }

  if (status === 'completed') {
    return toolSummary.count > 0
      ? `Completed with ${toolSummary.count} tool events`
      : 'Completed without tool calls';
  }

  return 'Ready for the next task';
}
