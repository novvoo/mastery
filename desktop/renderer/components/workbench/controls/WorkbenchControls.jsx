import React from 'react';
import { Button, Icon } from '../../ui/index.js';
import { styles } from '../../../app/styles.js';
import { t as i18nT } from '../../../i18n.js';

export const TERMINAL_PANEL_STORAGE_KEY = 'ai-agent-terminal-panel';

export function WorkbenchControls({
  sidebarCollapsed,
  isTerminalVisible,
  summaryPanelVisible,
  onExport,
  onOpenPreview,
  onToggleSidebar,
  onToggleTerminal,
  onToggleInspector,
  onClearMessages,
}) {
  const iconButton = {
    width: '28px',
    height: '28px',
    minWidth: '28px',
    padding: 0,
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
  };
  const activeButton = {
    backgroundColor: 'var(--primary-faint)',
    borderColor: 'var(--primary-border)',
    color: 'var(--primary-color)',
  };

  return (
    <div style={styles.workspaceControls}>
      <Button variant="ghost" size="sm" style={iconButton} onClick={onExport} title={i18nT('chat.export')} ariaLabel={i18nT('chat.export')}>
        <Icon name="download" size={15} />
      </Button>
      <Button variant="ghost" size="sm" style={iconButton} onClick={onOpenPreview} title={i18nT('chat.preview')} ariaLabel={i18nT('chat.preview')}>
        <Icon name="preview" size={15} />
      </Button>
      <span style={styles.chatHeaderActionDivider} />
      <Button
        variant="icon"
        size="sm"
        style={{ ...iconButton, ...(!sidebarCollapsed ? activeButton : {}) }}
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? i18nT('window.expand_sidebar') : i18nT('window.collapse_sidebar')}
        ariaLabel={i18nT('window.toggle_sidebar')}
      >
        <Icon name="sidebar" size={15} />
      </Button>
      <Button
        variant="icon"
        size="sm"
        style={{ ...iconButton, ...(isTerminalVisible ? activeButton : {}) }}
        onClick={onToggleTerminal}
        title="Bottom terminal"
        ariaLabel="Bottom terminal"
      >
        <Icon name="terminal" size={15} />
      </Button>
      <Button
        variant="icon"
        size="sm"
        style={{ ...iconButton, ...(summaryPanelVisible ? activeButton : {}) }}
        onClick={onToggleInspector}
        title="toggle-inspector"
        ariaLabel="toggle-inspector"
      >
        <Icon name="inspector" size={15} />
      </Button>
      <Button variant="ghost" size="sm" style={iconButton} onClick={onClearMessages} title={i18nT('chat.clear_messages')} ariaLabel={i18nT('chat.clear_messages')}>
        <Icon name="close" size={15} />
      </Button>
    </div>
  );
}

export function readTerminalPanelLayout() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    return JSON.parse(localStorage.getItem(TERMINAL_PANEL_STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

export function clampTerminalHeight(height) {
  const numeric = Number(height);
  if (!Number.isFinite(numeric)) {
    return 280;
  }
  return Math.min(520, Math.max(180, numeric));
}
