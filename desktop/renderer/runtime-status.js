export const RUNTIME_STATUS_META = {
  running: {
    text: '运行中',
    icon: '⚡',
    badgeVariant: 'warning',
    tone: 'warning',
  },
  initializing: {
    text: '初始化',
    icon: '...',
    badgeVariant: 'warning',
    tone: 'warning',
  },
  needs_user_input: {
    text: '等待输入',
    icon: '?',
    badgeVariant: 'warning',
    tone: 'warning',
  },
  error: {
    text: '错误',
    icon: '!',
    badgeVariant: 'error',
    tone: 'error',
  },
  completed: {
    text: '完成',
    icon: '✓',
    badgeVariant: 'info',
    tone: 'info',
  },
  idle: {
    text: '就绪',
    icon: '✓',
    badgeVariant: 'success',
    tone: 'success',
  },
  ready: {
    text: '就绪',
    icon: '✓',
    badgeVariant: 'success',
    tone: 'success',
  },
};

export function getRuntimeStatusMeta(status) {
  return RUNTIME_STATUS_META[status] || {
    text: '未知',
    icon: '?',
    badgeVariant: 'default',
    tone: 'muted',
  };
}
