/**
 * Button — 统一按钮组件
 *
 * 变体:
 *   default  默认灰色背景
 *   primary  主色填充
 *   danger   危险操作
 *   ghost    透明无边框
 *   icon     正方形图标按钮
 *
 * 尺寸:
 *   sm (28px)  md (32px)  lg (40px)
 */
import React from 'react';

const VARIANTS = {
  default: {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)',
    border: '1px solid var(--border-subtle)',
  },
  primary: {
    backgroundColor: 'var(--primary-color)',
    color: '#061018',
    border: '1px solid rgba(255, 255, 255, 0.12)',
  },
  danger: {
    backgroundColor: 'var(--error-color)',
    color: '#fff',
    border: '1px solid rgba(255, 255, 255, 0.12)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
  },
  icon: {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-subtle)',
  },
};

const SIZES = {
  sm: { height: '28px', padding: '0 8px', fontSize: '12px', borderRadius: 'var(--radius-md)', minWidth: '28px' },
  md: { height: '32px', padding: '0 12px', fontSize: '13px', borderRadius: 'var(--radius-md)' },
  lg: { height: '40px', padding: '0 16px', fontSize: '14px', borderRadius: 'var(--radius-lg)' },
};

const ICON_SIZES = {
  sm: { width: '28px', height: '28px', padding: 0, fontSize: '14px', borderRadius: 'var(--radius-md)' },
  md: { width: '32px', height: '32px', padding: 0, fontSize: '15px', borderRadius: 'var(--radius-md)' },
  lg: { width: '40px', height: '40px', padding: 0, fontSize: '18px', borderRadius: 'var(--radius-lg)' },
};

export default function Button({
  variant = 'default',
  size = 'md',
  children,
  disabled,
  style,
  title,
  ariaLabel,
  onClick,
  ...rest
}) {
  const isIcon = variant === 'icon';
  const sizeStyles = isIcon ? ICON_SIZES[size] : SIZES[size];
  const variantStyles = VARIANTS[variant] || VARIANTS.default;

  return (
    <button
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        transition: 'all var(--transition-fast)',
        opacity: disabled ? 0.5 : 1,
        boxShadow: variant === 'ghost' ? 'none' : 'var(--shadow-sm)',
        ...sizeStyles,
        ...variantStyles,
        ...style,
      }}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
