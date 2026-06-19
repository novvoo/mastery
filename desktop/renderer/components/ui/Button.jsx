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
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-color)',
    border: '1px solid var(--glass-border)',
  },
  primary: {
    backgroundColor: 'var(--primary-color)',
    color: 'var(--text-on-primary)',
    border: '1px solid var(--primary-strong)',
  },
  danger: {
    backgroundColor: 'var(--error-color)',
    color: 'var(--text-on-primary)',
    border: '1px solid var(--error-color)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid transparent',
  },
  icon: {
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-muted)',
    border: '1px solid var(--glass-border)',
  },
};

const SIZES = {
  sm: { height: '28px', padding: '0 10px', fontSize: '12px', borderRadius: '999px', minWidth: '28px' },
  md: { height: '32px', padding: '0 13px', fontSize: '13px', borderRadius: '999px' },
  lg: { height: '40px', padding: '0 16px', fontSize: '14px', borderRadius: '999px' },
};

const ICON_SIZES = {
  sm: { width: '28px', height: '28px', padding: 0, fontSize: '14px', borderRadius: '999px' },
  md: { width: '32px', height: '32px', padding: 0, fontSize: '15px', borderRadius: '999px' },
  lg: { width: '40px', height: '40px', padding: 0, fontSize: '18px', borderRadius: '999px' },
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
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        transition: 'all var(--transition-fast)',
        opacity: disabled ? 0.5 : 1,
        boxShadow: variant === 'ghost' ? 'none' : 'var(--shadow-button)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        ':hover': {
          transform: 'translateY(-1px)',
          boxShadow: variant === 'ghost' ? 'none' : 'var(--shadow-button-hover)'
        },
        ':active': {
          transform: 'translateY(0)',
          boxShadow: variant === 'ghost' ? 'none' : 'var(--shadow-button)'
        },
        ...sizeStyles,
        ...variantStyles,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(-1px)';
          if (variant !== 'ghost') {
            e.currentTarget.style.boxShadow = 'var(--shadow-button-hover)';
          }
          if (variant === 'ghost') {
            e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)';
            e.currentTarget.style.color = 'var(--text-color)';
          }
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        if (variant !== 'ghost') {
          e.currentTarget.style.boxShadow = 'var(--shadow-button)';
        }
        if (variant === 'ghost') {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--text-muted)';
        }
      }}
      onMouseDown={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(0)';
          if (variant !== 'ghost') {
            e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
          }
        }
      }}
      onMouseUp={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(-1px)';
          if (variant !== 'ghost') {
            e.currentTarget.style.boxShadow = 'var(--shadow-button-hover)';
          }
        }
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
