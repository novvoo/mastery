/**
 * Input — 统一输入框组件
 *
 * 变体: default | textarea
 * 尺寸: sm | md | lg
 */
import React, { useRef, useEffect } from 'react';

const SIZES = {
  sm: { minHeight: '32px', padding: '6px 10px', fontSize: '12px', borderRadius: 'var(--radius-md)' },
  md: { minHeight: '48px', padding: '12px 14px', fontSize: '14px', borderRadius: '12px' },
  lg: { minHeight: '56px', padding: '14px 16px', fontSize: '15px', borderRadius: '14px' },
};

export default function Input({
  variant = 'default',
  size = 'md',
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder,
  disabled,
  autoFocus,
  style,
  textareaRef,
  maxRows = 8,
  ariaLabel,
  ...rest
}) {
  const internalRef = useRef(null);
  const ref = textareaRef || internalRef;

  // 自动调整高度
  useEffect(() => {
    if (variant !== 'textarea' || !ref.current) {return;}
    const el = ref.current;
    el.style.height = 'auto';
    const maxHeight = SIZES[size].minHeight.replace('px', '') * maxRows;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, [value, variant, size, maxRows, ref]);

  const sizeStyles = SIZES[size] || SIZES.md;
  const baseStyle = {
    width: '100%',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    border: 'none',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
    ...sizeStyles,
    ...style,
  };

  if (variant === 'textarea') {
    return (
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel || placeholder}
        style={baseStyle}
        rows={1}
        {...rest}
      />
    );
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel || placeholder}
      style={baseStyle}
      {...rest}
    />
  );
}
