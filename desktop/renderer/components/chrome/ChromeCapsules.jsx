import React from 'react';
import { Button } from '../ui/index.js';
import { t } from '../../i18n.js';
import { DRAG_REGION, CAPSULE_SECONDARY, CAPSULE_CHROMELESS, CAPSULE_POSITIONS } from './styles/capsule-styles.js';

function DragRegion() {
  return <div style={DRAG_REGION} />;
}


function StatsCapsule({ toolCount, stats, appVersion }) {
  const messageCount = stats?.messageCount || 0;
  const toolCalls = stats?.toolCalls || 0;
  if (messageCount === 0 && toolCalls === 0) {
    return null;
  }

  return (
    <div style={{ ...CAPSULE_SECONDARY, ...CAPSULE_CHROMELESS, ...CAPSULE_POSITIONS.stats }}>
      <span>{messageCount} msgs</span>
      {toolCalls > 0 && (
        <>
          <span style={{ opacity: 0.25 }}>·</span>
          <span>{toolCalls} tools</span>
        </>
      )}
    </div>
  );
}

function WindowControls({ isMac, windowState, onMinimize, onMaximize, onClose }) {
  if (isMac) {return null;}
  return (
    <div
      style={{
        ...CAPSULE_POSITIONS.windowControls(isMac),
        display: 'flex',
        gap: '2px',
        padding: '2px',
        borderRadius: '10px',
        backgroundColor: 'var(--glass-control-bg)',
        backdropFilter: 'blur(18px) saturate(180%)',
        WebkitBackdropFilter: 'blur(18px) saturate(180%)',
        border: '1px solid var(--glass-border-strong)',
        boxShadow: 'var(--glass-shadow-soft), var(--glass-inner-hl)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <Button variant="ghost" size="sm" onClick={onMinimize} title={t('window.minimize')}>−</Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onMaximize}
        title={windowState?.isMaximized ? t('window.restore') : t('window.maximize')}
      >
        {windowState?.isMaximized ? '❐' : '□'}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClose} title={t('window.close')} style={{ color: 'var(--error-color)' }}>
        ×
      </Button>
    </div>
  );
}

export function ChromeCapsules({
  platformInfo,
  windowState,
  toolCount,
  stats,
  appVersion,
  onMinimize,
  onMaximize,
  onClose,
}) {
  const platformKnown = Boolean(platformInfo);
  const isMac = platformInfo?.isMac === true;
  return (
    <>
      <DragRegion />
      <StatsCapsule toolCount={toolCount} stats={stats} appVersion={appVersion} />
      {platformKnown && (
        <WindowControls
          isMac={isMac}
          windowState={windowState}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onClose={onClose}
        />
      )}
      <style>{`@keyframes capsule-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </>
  );
}
