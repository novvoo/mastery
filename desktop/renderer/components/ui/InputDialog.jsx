/**
 * 输入对话框组件
 */

import React, { useState, useEffect, useRef } from 'react';

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    backgroundColor: 'var(--surface-color)',
    borderRadius: '12px',
    border: '1px solid var(--border-subtle)',
    padding: '20px',
    minWidth: '320px',
    maxWidth: '480px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  },
  title: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-color)',
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    color: 'var(--text-muted)',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginTop: '8px',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '20px',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  buttonPrimary: {
    backgroundColor: 'var(--primary-color)',
    borderColor: 'var(--primary-color)',
    color: 'white',
  },
  buttonDanger: {
    backgroundColor: 'var(--error-color)',
    borderColor: 'var(--error-color)',
    color: 'white',
  },
};

export function InputDialog({
  title,
  label,
  placeholder = '',
  defaultValue = '',
  hint,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel,
  danger = false,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) {return;}
    onConfirm(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onCancel?.();
    }
  };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>{title}</div>
        <label style={styles.label}>{label}</label>
        <input
          ref={inputRef}
          type="text"
          style={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        {hint && <div style={styles.hint}>{hint}</div>}
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.button}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            style={{
              ...styles.button,
              ...(danger ? styles.buttonDanger : styles.buttonPrimary),
            }}
            onClick={handleSubmit}
            disabled={!value.trim()}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InputDialog;
