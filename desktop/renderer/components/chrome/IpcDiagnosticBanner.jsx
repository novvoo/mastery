import React from 'react';
import { t } from '../../i18n.js';

export function IpcDiagnosticBanner({ diagnostic, onDismiss }) {
  if (!diagnostic || diagnostic.hasElectronAPI) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      right: 18,
      bottom: 18,
      zIndex: 1200,
      width: 'min(380px, calc(100vw - 36px))',
      background: 'var(--surface-color)',
      color: 'var(--text-color)',
      padding: '12px 14px',
      fontSize: 12,
      lineHeight: 1.5,
      border: '1px solid var(--border-card)',
      borderRadius: 12,
      boxShadow: '0 10px 30px rgba(0,0,0,.2), 0 2px 8px rgba(0,0,0,.12)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{t('diagnostic.ipc_unavailable_title', {}, 'IPC 连接不可用：')}</strong>{' '}
        当前是浏览器预览模式，Agent、文件和终端功能仅在桌面应用中可用。
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          flex: '0 0 auto',
          background: 'transparent',
          border: '1px solid var(--border-card)',
          color: 'var(--text-muted)',
          padding: '3px 9px',
          borderRadius: 6,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {t('common.close')}
      </button>
    </div>
  );
}
