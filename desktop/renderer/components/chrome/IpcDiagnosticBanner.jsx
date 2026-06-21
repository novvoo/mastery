import React from 'react';
import { t } from '../../i18n.js';

export function IpcDiagnosticBanner({ diagnostic, onDismiss }) {
  if (!diagnostic || diagnostic.hasElectronAPI) {
    return null;
  }

  return (
    <div style={{
      background: 'linear-gradient(90deg, #8a6d3b, #b98b3c)',
      color: '#f8f4e8',
      padding: '8px 16px',
      fontSize: 13,
      borderBottom: '1px solid rgba(0,0,0,0.15)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{t('diagnostic.ipc_unavailable_title', {}, 'IPC 连接不可用：')}</strong>{' '}
        {t('diagnostic.ipc_unavailable_body', {}, 'preload 脚本未能成功暴露')} <code>window.electronAPI</code>
        {t('diagnostic.ipc_unavailable_suffix', {}, '，所有与主进程的通信功能将不可用。')}
        <div style={{
          marginTop: 4,
          fontSize: 12,
          opacity: 0.9,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          wordBreak: 'break-all',
        }}>
          {t('diagnostic.detail', {}, '诊断')}: {JSON.stringify(diagnostic)}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          flex: '0 0 auto',
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.4)',
          color: 'inherit',
          padding: '4px 10px',
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
