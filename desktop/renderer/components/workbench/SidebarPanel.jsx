import React, { useMemo, useState } from 'react';
import AgentControl from '../AgentControl.jsx';
import ToolPanel from '../ToolPanel.jsx';
import { Icon } from '../ui/index.js';

const itemStyle = {
  width: '100%', height: 36, padding: '0 12px', border: 0, borderRadius: 8,
  display: 'flex', alignItems: 'center', gap: 10, background: 'transparent',
  color: 'var(--text-color)', cursor: 'pointer', fontSize: 14, textAlign: 'left',
};

function sessionTitle(session) {
  return session?.title || session?.name || '未命名任务';
}

export function SidebarPanel({
  activeTab,
  runtime,
  workingDirectory,
  workingDirectorySyncMessage,
  agentOptions,
  onOptionsChange,
  onInsertText,
  onWorkingDirectoryChange,
  onNewTask,
  projectTree,
  onOpenFile,
  activeOpenFile,
  sessions = [],
  activeSessionId,
  onSelectSession,
  onShowTools,
  onSettings,
}) {
  const [section, setSection] = useState(activeTab === 'tools' ? 'tools' : 'tasks');
  const recentSessions = useMemo(() => sessions.slice(0, 14), [sessions]);
  const workspaceName = useMemo(() => String(workingDirectory || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .at(-1) || '未选择项目', [workingDirectory]);

  return (
    <aside className="codex-task-sidebar" aria-label="任务导航">
      <div className="codex-sidebar-brand">
        <strong>Mastery</strong>
        <button type="button" aria-label="搜索任务"><Icon name="search" size={18} /></button>
      </div>

      <nav className="codex-primary-nav">
        <button type="button" style={itemStyle} onClick={onNewTask}>
          <Icon name="plus" size={17} /><span>新建任务</span>
        </button>
        <button type="button" style={{ ...itemStyle, background: section === 'project' ? 'rgba(31,35,40,.06)' : 'transparent' }} onClick={() => setSection('project')}>
          <Icon name="folder" size={17} /><span>项目</span><span className="codex-nav-trailing"><Icon name="plus" size={15} /></span>
        </button>
        <button type="button" style={itemStyle} onClick={() => setSection('tasks')}>
          <Icon name="timeline" size={17} /><span>已安排</span>
        </button>
        <button type="button" style={{ ...itemStyle, background: section === 'tools' ? 'rgba(31,35,40,.06)' : 'transparent' }} onClick={() => { setSection('tools'); onShowTools?.(); }}>
          <Icon name="tools" size={17} /><span>工具</span>
        </button>
      </nav>

      {section === 'project' ? (
        <div className="codex-sidebar-body">
          <AgentControl
            runtime={runtime}
            workingDirectory={workingDirectory}
            workingDirectorySyncMessage={workingDirectorySyncMessage}
            onWorkingDirectoryChange={onWorkingDirectoryChange}
            agentOptions={agentOptions}
            onOpenFile={onOpenFile}
            activeOpenFile={activeOpenFile}
            onOptionsChange={onOptionsChange}
            onInsertText={onInsertText}
            projectTree={projectTree}
          />
        </div>
      ) : section === 'tools' ? (
        <div className="codex-sidebar-body"><ToolPanel tools={runtime.tools} loading={runtime.loading} messages={runtime.messages} /></div>
      ) : (
        <div className="codex-session-region">
          <div className="codex-section-label">任务</div>
          <div className="codex-session-list">
            {recentSessions.length === 0 ? (
              <div className="codex-session-empty">新任务会显示在这里</div>
            ) : recentSessions.map((session) => {
              const id = session?.id || session?.sessionId;
              return (
                <button key={id} type="button" className={id === activeSessionId ? 'is-active' : ''} onClick={() => onSelectSession?.(id)} title={sessionTitle(session)}>
                  {sessionTitle(session)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="codex-sidebar-footer">
        <button type="button" onClick={onSettings}><span className="codex-avatar">L</span><span><strong>本地账户</strong><small>{workspaceName}</small></span><Icon name="settings" size={16} /></button>
      </div>
    </aside>
  );
}
