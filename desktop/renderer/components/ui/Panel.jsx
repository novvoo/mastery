/**
 * Panel — 统一面板/抽屉容器组件
 *
 * 变体:
 *   sidebar  左侧边栏
 *   inspector 右侧 Inspector
 *   card     通用卡片
 *
 * 当 variant 为 sidebar/inspector 时，collapsed=true 隐藏面板
 */
import React from 'react';

const VARIANTS = {
  sidebar: {
    backgroundColor: 'var(--surface-color)',
    borderRight: 'none',
  },
  inspector: {
    backgroundColor: 'var(--surface-color)',
    borderLeft: 'none',
  },
  card: {
    backgroundColor: 'var(--surface-color)',
    border: 'none',
    borderRadius: 'var(--radius-lg)',
  },
};

export function PanelHeader({ title, actions, style }) {
  return (
    <div
      style={{
        minHeight: '42px',
        padding: '0 var(--spacing-md)',
        borderBottom: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--spacing-sm)',
        backgroundColor: 'var(--surface-raised)',
        ...style,
      }}
    >
      {title && (
        <span style={{
          fontSize: '12px',
          fontWeight: 800,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {title}
        </span>
      )}
      {actions && <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}

export default function Panel({
  variant = 'card',
  collapsed = false,
  width,
  children,
  style,
  ariaLabel,
  ...rest
}) {
  if (collapsed) return null;

  const variantStyles = VARIANTS[variant] || VARIANTS.card;

  return (
    <aside
      role="complementary"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        ...(width ? { width: `${width}px`, flexShrink: 0 } : {}),
        ...variantStyles,
        ...style,
      }}
      {...rest}
    >
      {children}
    </aside>
  );
}
