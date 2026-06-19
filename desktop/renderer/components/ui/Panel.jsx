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
    backgroundColor: 'var(--glass-control-bg)',
    backdropFilter: 'blur(18px) saturate(170%)',
    WebkitBackdropFilter: 'blur(18px) saturate(170%)',
    border: '1px solid var(--glass-border-strong)',
    borderRadius: '16px',
    boxShadow: 'var(--glass-shadow), var(--glass-inner-hl)',
  },
  inspector: {
    backgroundColor: 'var(--glass-control-bg)',
    backdropFilter: 'blur(18px) saturate(170%)',
    WebkitBackdropFilter: 'blur(18px) saturate(170%)',
    border: '1px solid var(--glass-border-strong)',
    borderRadius: '16px',
    boxShadow: 'var(--glass-shadow), var(--glass-inner-hl)',
  },
  card: {
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--glass-inner-hl)',
  },
};

export function PanelHeader({ title, actions, style }) {
  return (
    <div
      style={{
        minHeight: '46px',
        padding: '8px var(--spacing-md)',
        borderBottom: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--spacing-sm)',
        backgroundColor: 'transparent',
        borderTopLeftRadius: 'inherit',
        borderTopRightRadius: 'inherit',
        ...style,
      }}
    >
      {title && (
        <span style={{
          minHeight: '28px',
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0 12px',
          borderRadius: '999px',
          border: '1px solid var(--title-capsule-border)',
          backgroundColor: 'var(--title-capsule-bg)',
          boxShadow: 'var(--glass-inner-hl)',
          fontSize: '12px',
          fontWeight: 800,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {title}
        </span>
      )}
      {actions && (
        <div style={{
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
          padding: '2px',
          borderRadius: '999px',
          border: '1px solid var(--glass-border)',
          backgroundColor: 'var(--glass-control-bg)',
          boxShadow: 'var(--glass-inner-hl)',
        }}>
          {actions}
        </div>
      )}
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
