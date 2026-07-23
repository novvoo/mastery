import React from 'react';
import { Button, Icon } from '../../ui/index.js';
import { styles } from '../../../app/styles.js';
import { t as i18nT } from '../../../i18n.js';
import { resolveUiActionState } from '../../../app/actions/ui-action-graph.js';

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
  capabilityGraph,
  messageCount = 0,
}) {
  const previewAction = resolveUiActionState('workbench.preview', { capabilityGraph });
  const terminalAction = resolveUiActionState('workbench.toggle-terminal', { capabilityGraph });
  const exportAction = resolveUiActionState('workbench.export', { contentCount: messageCount });
  const clearAction = resolveUiActionState('workbench.clear', { contentCount: messageCount });
  const iconButton = {
    width: '28px',
    height: '28px',
    minWidth: '28px',
    padding: 0,
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
  };
  const textButton = {
    height: '28px', padding: '0 10px', borderRadius: '8px', fontSize: '12px', gap: '6px',
    border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-card)',
  };
  const activeButton = {
    backgroundColor: 'var(--primary-faint)',
    borderColor: 'var(--primary-border)',
    color: 'var(--primary-color)',
  };

  return (
    <div className="mastery-top-controls" style={styles.workspaceControls}>
      <Button actionId="workbench.preview" variant="ghost" size="sm" style={textButton} onClick={onOpenPreview} disabled={previewAction.status === 'blocked'} title={previewAction.reason || i18nT('chat.preview')} ariaLabel={i18nT('chat.preview')}>
        <Icon name="preview" size={14} />
        <span>打开预览</span>
      </Button>
      <Button actionId="workbench.export" variant="ghost" size="sm" style={iconButton} onClick={onExport} disabled={exportAction.status === 'blocked'} title={exportAction.reason || i18nT('chat.export')} ariaLabel={i18nT('chat.export')}>
        <Icon name="download" size={14} />
      </Button>
      <span style={styles.chatHeaderActionDivider} />
      <Button
        variant="icon"
        actionId="workbench.toggle-sidebar"
        size="sm"
        style={{ ...iconButton, ...(!sidebarCollapsed ? activeButton : {}) }}
        onClick={onToggleSidebar}
        pressed={!sidebarCollapsed}
        title={sidebarCollapsed ? i18nT('window.expand_sidebar') : i18nT('window.collapse_sidebar')}
        ariaLabel={i18nT('window.toggle_sidebar')}
      >
        <Icon name="sidebar" size={15} />
      </Button>
      <Button
        variant="icon"
        actionId="workbench.toggle-terminal"
        size="sm"
        style={{ ...iconButton, ...(isTerminalVisible ? activeButton : {}) }}
        onClick={onToggleTerminal}
        disabled={terminalAction.status === 'blocked'}
        pressed={isTerminalVisible}
        title={terminalAction.reason || (isTerminalVisible ? '收起终端' : '打开终端')}
        ariaLabel={isTerminalVisible ? '收起终端' : '打开终端'}
      >
        <Icon name="terminal" size={15} />
      </Button>
      <Button
        variant="icon"
        actionId="workbench.toggle-inspector"
        size="sm"
        style={{ ...iconButton, ...(summaryPanelVisible ? activeButton : {}) }}
        onClick={onToggleInspector}
        pressed={summaryPanelVisible}
        title={summaryPanelVisible ? '收起详情面板' : '打开详情面板'}
        ariaLabel={summaryPanelVisible ? '收起详情面板' : '打开详情面板'}
      >
        <Icon name="inspector" size={15} />
      </Button>
      <Button actionId="workbench.clear" variant="ghost" size="sm" style={iconButton} onClick={onClearMessages} disabled={clearAction.status === 'blocked'} title={clearAction.reason || i18nT('chat.clear_messages')} ariaLabel={i18nT('chat.clear_messages')}><Icon name="trash" size={14} /></Button>
    </div>
  );
}
