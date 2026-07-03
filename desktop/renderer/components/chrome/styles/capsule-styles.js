/**
 * Chrome capsule style primitives.
 *
 * These are intentionally React-free so the tone mapping and positioning can be
 * covered by bun:test without a DOM renderer.
 */

export const STATUS_TONE = {
  warning: { color: 'var(--ds-status-warning)' },
  error: { color: 'var(--ds-status-error)', pulse: false },
  success: { color: 'var(--ds-status-success)', pulse: false },
  info: { color: 'var(--ds-brand)', pulse: false },
  muted: { color: 'var(--ds-text-tertiary)', pulse: false },
};

export const ACTIVE_PULSE_STATUSES = new Set([
  'running',
  'initializing',
  'needs_user_input',
]);

export function getCapsuleTone(meta) {
  const tone = meta?.tone;
  return tone && STATUS_TONE[tone] ? tone : 'muted';
}

export const CAPSULE_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  WebkitAppRegion: 'no-drag',
  backgroundColor: 'var(--ds-bg-raised)',
  border: '1px solid var(--ds-border-l1)',
  boxShadow: 'var(--shadow-sm), var(--glass-inner-hl)',
  color: 'var(--ds-text-primary)',
};

export const CAPSULE_PRIMARY = {
  ...CAPSULE_BASE,
  gap: '4px',
  fontSize: '11px',
  borderRadius: 'var(--radius-md)',
  padding: '3px 10px',
};

export const CAPSULE_SECONDARY = {
  ...CAPSULE_BASE,
  gap: '4px',
  fontSize: '10px',
  borderRadius: 'var(--radius-md)',
  padding: '2px 9px',
  backgroundColor: 'var(--ds-bg-raised)',
  color: 'var(--ds-text-tertiary)',
};

export const CAPSULE_CHROMELESS = {
  backgroundColor: 'transparent',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
  borderColor: 'transparent',
  boxShadow: 'none',
};

export const CAPSULE_TOGGLE = {
  ...CAPSULE_BASE,
  width: '30px',
  height: '22px',
  justifyContent: 'center',
  borderRadius: 'var(--radius-md)',
  padding: 0,
  fontSize: '14px',
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
};

export const CAPSULE_POSITIONS = {
  status: (isMac) => ({
    position: 'absolute',
    bottom: '0px',
    left: '12px',
    zIndex: 30,
  }),
  stats: {
    position: 'absolute',
    bottom: '0px',
    right: '12px',
    zIndex: 30,
  },
  windowControls: (isMac) => isMac ? null : ({
    position: 'absolute',
    top: '7px',
    right: '12px',
    zIndex: 30,
  }),
};

export const DRAG_REGION = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: '40px',
  WebkitAppRegion: 'drag',
  zIndex: 1,
};

export function isStatusPulseEnabled(status) {
  return ACTIVE_PULSE_STATUSES.has(status);
}

export function statusDotStyle(tone, status) {
  const toneMeta = STATUS_TONE[tone] || STATUS_TONE.muted;
  const base = {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: toneMeta.color,
    display: 'inline-block',
    flexShrink: 0,
  };
  return isStatusPulseEnabled(status) ? { ...base, animation: 'capsule-pulse 1s infinite' } : base;
}

export function connectionDotStyle(isConnected) {
  return {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: isConnected ? 'var(--ds-status-success)' : 'var(--ds-status-error)',
    display: 'inline-block',
    flexShrink: 0,
  };
}
