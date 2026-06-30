import React, { useEffect, useCallback } from 'react';
import { t } from '../../i18n.js';

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    animation: 'fadeIn 0.15s ease-out',
  },
  dialog: {
    backgroundColor: 'var(--bg-primary)',
    borderRadius: '12px',
    padding: '20px 24px',
    minWidth: '320px',
    maxWidth: '400px',
    boxShadow: 'var(--shadow-modal)',
    border: '1px solid var(--border-color)',
    animation: 'slideUp 0.2s ease-out',
  },
  header: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: '12px',
  },
  message: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    marginBottom: '20px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    transition: 'all var(--transition-fast)',
  },
  cancelButton: {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-secondary)',
  },
  confirmButton: {
    backgroundColor: 'var(--primary-color)',
    color: 'var(--text-on-primary)',
  },
  dangerButton: {
    backgroundColor: 'var(--error-color)',
    color: 'var(--text-on-primary)',
  },
};

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  cancelText = t('common.cancel'),
  confirmText = t('common.confirm'),
  danger = false,
  onCancel,
  onConfirm,
}) {
  const handleKeyDown = useCallback(
    (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onCancel?.();
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        onConfirm?.();
      }
    },
    [isOpen, onCancel, onConfirm]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div id="confirm-dialog-title" style={styles.header}>
          {title}
        </div>
        <div style={styles.message}>{message}</div>
        <div style={styles.footer}>
          <button style={{ ...styles.button, ...styles.cancelButton }} onClick={onCancel}>
            {cancelText}
          </button>
          <button
            style={{ ...styles.button, ...(danger ? styles.dangerButton : styles.confirmButton) }}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}