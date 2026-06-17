/**
 * Switch — 开关切换组件
 *
 * 用于启用/禁用状态切换，替代原生 checkbox。
 * 遵循项目现有的 CSS-in-JS 风格。
 */
import React from 'react';

export default function Switch({
  checked = false,
  onChange,
  disabled = false,
  ariaLabel,
  style,
}) {
  const trackH = 22;
  const trackW = 40;
  const thumbSize = 16;
  const thumbOffset = (trackH - thumbSize) / 2;

  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: `${trackW}px`,
        height: `${trackH}px`,
        padding: 0,
        border: 'none',
        borderRadius: `${trackH / 2}px`,
        backgroundColor: checked
          ? 'var(--primary-color)'
          : 'var(--glass-border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color var(--transition-fast), opacity var(--transition-fast)',
        ...style,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: `${thumbOffset}px`,
          left: checked
            ? `${trackW - thumbSize - thumbOffset}px`
            : `${thumbOffset}px`,
          width: `${thumbSize}px`,
          height: `${thumbSize}px`,
          borderRadius: '50%',
          backgroundColor: 'var(--surface-color)',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--transition-fast)',
        }}
      />
    </button>
  );
}
