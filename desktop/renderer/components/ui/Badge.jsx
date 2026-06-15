/**
 * Badge — 统一标签/徽章组件
 *
 * 变体: default | primary | success | warning | error | info
 * 尺寸: sm | md
 */
import React from 'react';

const VARIANTS = {
  default: { backgroundColor: 'var(--neutral-faint)', color: 'var(--text-muted)' },
  primary: { backgroundColor: 'var(--primary-soft)', color: 'var(--primary-color)' },
  success: { backgroundColor: 'var(--success-soft)', color: 'var(--success-color)' },
  warning: { backgroundColor: 'var(--warning-soft)', color: 'var(--warning-color)' },
  error: { backgroundColor: 'var(--error-soft)', color: 'var(--error-color)' },
  info: { backgroundColor: 'var(--info-soft)', color: 'var(--info-color)' },
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
