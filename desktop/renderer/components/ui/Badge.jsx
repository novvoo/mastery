/**
 * Badge — 统一标签/徽章组件
 *
 * 变体: default | primary | success | warning | error | info
 * 尺寸: sm | md
 */
import React from 'react';

const VARIANTS = {
  default: { backgroundColor: 'rgba(245, 240, 235, 0.06)', color: 'var(--text-muted)' },
  primary: { backgroundColor: 'var(--primary-soft)', color: 'var(--primary-color)' },
  success: { backgroundColor: 'rgba(93, 211, 158, 0.12)', color: 'var(--success-color)' },
  warning: { backgroundColor: 'rgba(246, 200, 95, 0.12)', color: 'var(--warning-color)' },
  error: { backgroundColor: 'rgba(255, 107, 122, 0.12)', color: 'var(--error-color)' },
  info: { backgroundColor: 'rgba(157, 183, 212, 0.12)', color: 'var(--info-color)' },
};

const SIZES = {
  sm: { padding: '1px 6px', fontSize: '11px', borderRadius: '4px' },
  md: { padding: '2px 8px', fontSize: '12px', borderRadius: 'var(--radius-sm)' },
};

export default function Badge({ variant = 'default', size = 'md', children, style, ...rest }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...SIZES[size],
        ...VARIANTS[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
