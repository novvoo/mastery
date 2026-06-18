export const MOTION_MODES = {
  IDLE: 'idle',
  REQUESTING: 'requesting',
  THINKING: 'thinking',
  TOOL_USE: 'tool-use',
  RESPONDING: 'responding',
  WAITING: 'waiting',
  STALLED: 'stalled',
  ERROR: 'error',
  COMPLETE: 'complete',
};

export function getAnimationMode({ status = 'idle', messages = [], riskLevel = 'idle', notice = null } = {}) {
  if (notice?.tone === 'warning' || riskLevel === 'high') return MOTION_MODES.WAITING;
  if (status === 'error' || messages.some(message => message.type === 'error')) return MOTION_MODES.ERROR;
  if (status === 'needs_user_input') return MOTION_MODES.WAITING;
  if (status === 'completed') return MOTION_MODES.COMPLETE;
  if (status !== 'running') return MOTION_MODES.IDLE;

  const latest = messages.at(-1);
  if (!latest) return MOTION_MODES.REQUESTING;
  if (latest.type === 'tool' || latest.activity?.phase === 'running') return MOTION_MODES.TOOL_USE;
  if (latest.type === 'assistant_stream' || latest.type === 'result') return MOTION_MODES.RESPONDING;
  if (latest.type === 'thinking') return MOTION_MODES.THINKING;

  const hasAnyOutput = messages.some(message => ['thinking', 'tool', 'tool_result', 'assistant_stream'].includes(message.type));
  return hasAnyOutput ? MOTION_MODES.THINKING : MOTION_MODES.REQUESTING;
}

export function getMotionClassNames(mode, { reducedMotion = false } = {}) {
  const base = ['agent-motion', `agent-motion--${mode || MOTION_MODES.IDLE}`];
  if (reducedMotion) {
    base.push('agent-motion--reduced');
  }
  return base.join(' ');
}

export function getStageMotionClass(stageState) {
  switch (stageState) {
    case 'active':
      return 'agent-stage--active';
    case 'attention':
      return 'agent-stage--attention';
    case 'error':
      return 'agent-stage--error';
    case 'done':
      return 'agent-stage--done';
    default:
      return 'agent-stage--idle';
  }
}

export function getSendButtonMotionClass(status, value = '') {
  if (status === 'running') return 'agent-send--stop';
  if (String(value || '').trim()) return 'agent-send--ready';
  return 'agent-send--idle';
}

