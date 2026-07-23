import React, { useEffect, useMemo, useRef, useState } from 'react';
import AgentControl from '../AgentControl.jsx';
import ToolPanel from '../ToolPanel.jsx';
import { Icon } from '../ui/index.js';

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
  onCloseFile,
  activeOpenFile,
  sessions = [],
  activeSessionId,
  onSelectSession,
  onShowTools,
  onSettings,
}) {
  const [section, setSection] = useState(activeTab === 'tools' ? 'tools' : 'tasks');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef(null);
  const recentSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return sessions
      .filter((session) => !query || sessionTitle(session).toLocaleLowerCase().includes(query))
      .slice(0, 14);
  }, [searchQuery, sessions]);
  const workspaceName = useMemo(() => String(workingDirectory || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .at(-1) || '未选择项目', [workingDirectory]);

  useEffect(() => {
    if (activeTab === 'tools') {
      setSection('tools');
    }
  }, [activeTab]);

  useEffect(() => {
    if (searchVisible) {
      searchRef.current?.focus();
    }
  }, [searchVisible]);

  return (
    <aside className="codex-task-sidebar" aria-label="任务导航">
      <div className="codex-sidebar-brand">
        <strong>Mastery</strong>
        <button
          type="button"
          aria-label={searchVisible ? '关闭任务搜索' : '搜索任务'}
          aria-pressed={searchVisible}
          onClick={() => {
            setSearchVisible((visible) => !visible);
            if (searchVisible) { setSearchQuery(''); }
          }}
        >
          <Icon name={searchVisible ? 'close' : 'search'} size={17} />
        </button>
      </div>

      <nav className="codex-primary-nav" aria-label="工作区">
        <button type="button" className="codex-nav-item" data-action-id="navigation.new-task" onClick={onNewTask}>
          <Icon name="plus" size={17} /><span>新建任务</span>
        </button>
        <button
          type="button"
          className={`codex-nav-item${section === 'project' ? ' is-active' : ''}`}
          data-action-id="navigation.open-project"
          aria-current={section === 'project' ? 'page' : undefined}
          onClick={() => {
            setSection('project');
            if (!workingDirectory) onWorkingDirectoryChange?.();
          }}
        >
          <Icon name="folder" size={17} /><span>{workingDirectory ? '项目' : '打开项目'}</span>
        </button>
        <button type="button" className={`codex-nav-item${section === 'tasks' ? ' is-active' : ''}`} aria-current={section === 'tasks' ? 'page' : undefined} onClick={() => setSection('tasks')}>
          <Icon name="timeline" size={17} /><span>已安排</span>
        </button>
        <button type="button" data-action-id="navigation.show-tools" className={`codex-nav-item${section === 'tools' ? ' is-active' : ''}`} aria-current={section === 'tools' ? 'page' : undefined} onClick={() => { setSection('tools'); onShowTools?.(); }}>
          <Icon name="tools" size={17} /><span>工具</span>
        </button>
      </nav>

      {searchVisible && (
        <div className="codex-sidebar-search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchVisible(false);
                setSearchQuery('');
              }
            }}
            aria-label="搜索任务"
            placeholder="搜索任务"
          />
        </div>
      )}

      {section === 'project' ? (
        <div className="codex-sidebar-body">
          <AgentControl
            runtime={runtime}
            workingDirectory={workingDirectory}
            workingDirectorySyncMessage={workingDirectorySyncMessage}
            onWorkingDirectoryChange={onWorkingDirectoryChange}
            agentOptions={agentOptions}
            onOpenFile={onOpenFile}
            onCloseFile={onCloseFile}
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
              <div className="codex-session-empty">
                {searchQuery ? '没有匹配的任务' : '新任务会显示在这里'}
              </div>
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
        <button type="button" data-action-id="navigation.open-settings" onClick={onSettings}><span className="codex-avatar">L</span><span><strong>本地账户</strong><small>{workspaceName}</small></span><Icon name="settings" size={16} /></button>
      </div>
    </aside>
  );
}
