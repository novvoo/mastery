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

export default function Button({
  variant = 'default',
  size = 'md',
  children,
  disabled,
  style,
  className = '',
  title,
  ariaLabel,
  onClick,
  actionId,
  pressed,
  busy = false,
  type = 'button',
  ...rest
}) {
  const classes = ['btn', `btn-${variant}`, `btn-${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      style={style}
      disabled={disabled || busy}
      title={title}
      aria-label={ariaLabel || title}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      data-action-id={actionId}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
