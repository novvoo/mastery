/**
 * Runtime status metadata - status text mapping shared by Desktop and CLI.
 * UI-specific properties (badgeVariant, tone) are kept as optional extensions.
 */

/**
 * 运行时状态元数据映射
 * - text: 状态显示文本（跨平台通用）
 * - icon: 状态图标
 * - badgeVariant / tone: UI 扩展属性（Desktop 渲染器用，CLI 忽略）
 */
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

/**
 * 获取运行时状态元数据
 * @param {string} status - 状态键名
 * @returns {{ text: string, icon: string, badgeVariant?: string, tone?: string }}
 */
export function getRuntimeStatusMeta(status) {
  return RUNTIME_STATUS_META[status] || {
    text: '未知',
    icon: '?',
    badgeVariant: 'default',
    tone: 'muted',
  };
}

/**
 * 获取运行时状态显示文本（CLI 友好，不需要 badgeVariant/tone）
 * @param {string} status - 状态键名
 * @returns {string}
 */
export function getRuntimeStatusText(status) {
  return getRuntimeStatusMeta(status).text;
}
