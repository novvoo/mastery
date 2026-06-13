import React from 'react';
import AgentControl from '../AgentControl.jsx';
import ToolPanel from '../ToolPanel.jsx';
import { Button, Panel, PanelHeader } from '../ui/index.js';
import { LAYOUT } from '../../app/config.js';

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
  onCollapse,
  projectTree,
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
    <Panel variant="sidebar" width={LAYOUT.sidebarWidth} ariaLabel="侧边栏">
      <PanelHeader
        title={activeTab === 'tools' ? '工具' : '会话'}
        actions={
          <>
            {activeTab !== 'tools' && (
              <Button variant="icon" size="sm" onClick={onNewTask} title="新对话" ariaLabel="新对话">+</Button>
            )}
            <Button variant="icon" size="sm" onClick={onCollapse} title="收起侧边栏" ariaLabel="收起侧边栏">×</Button>
          </>
        }
      />
      {content}
    </Panel>
  );
}
