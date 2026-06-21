import React from 'react';
import AgentControl from '../AgentControl.jsx';
import ToolPanel from '../ToolPanel.jsx';
import { Button, Icon, Panel, PanelHeader } from '../ui/index.js';
import { LAYOUT } from '../../app/config/index.js';
import { t } from '../../i18n.js';

export function SidebarPanel({
  activeTab,
  runtime,
  workingDirectory,
  agentOptions,
  onOptionsChange,
  onInsertText,
  sessions,
  activeSessionId,
  onSwitchSession,
  onRestoreHistory,
  onClearHistory,
  onWorkingDirectoryChange,
  onNewTask,
  projectTree,
  onOpenFile,
  activeOpenFile,
}) {
  const content = activeTab === 'tools' ? (
    <ToolPanel
      tools={runtime.tools}
      loading={runtime.loading}
      messages={runtime.messages}
    />
  ) : (
    <AgentControl
      runtime={runtime}
      workingDirectory={workingDirectory}
      onWorkingDirectoryChange={onWorkingDirectoryChange}
      agentOptions={agentOptions}
      onOpenFile={onOpenFile}
      activeOpenFile={activeOpenFile}
      onOptionsChange={onOptionsChange}
      onInsertText={onInsertText}
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSwitchSession={onSwitchSession}
      onRestoreHistory={onRestoreHistory}
      onClearHistory={onClearHistory}
      projectTree={projectTree}
    />
  );

  return (
    <Panel variant="sidebar" width={LAYOUT.sidebarWidth} ariaLabel="sidebar">
      <PanelHeader
        title={activeTab === 'tools' ? t('sidebar.tools') : t('sidebar.sessions')}
        actions={
          <>
            {activeTab !== 'tools' && (
              <Button variant="icon" size="sm" onClick={onNewTask} title="new" ariaLabel="new">
                <Icon name="plus" size={14} />
              </Button>
            )}
          </>
        }
      />
      {content}
    </Panel>
  );
}
