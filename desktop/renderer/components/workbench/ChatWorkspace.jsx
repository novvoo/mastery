import React, { useState, useRef, useEffect } from 'react';
import CommandSuggestions from '../CommandSuggestions.jsx';
import MessageLog from '../MessageLog.jsx';
import { InteractionConsole } from './InteractionConsole.jsx';
import { AskUserFloatingCapsule } from '../AskUserFloatingCapsule.jsx';
import { getSendButtonMotionClass } from '../../app/interaction/animation-system.js';
import { getQueuePreview } from '../../app/message-queue.js';
import { styles } from '../../app/styles.js';
import { t } from '../../i18n.js';
import { RuntimeSelector } from './RuntimeSelector.jsx';
import { Icon } from '../ui/index.js';
import { downloadConversationMarkdown } from '../../app/export-conversation.js';

export function ChatWorkspace({
  runtime,
  chatInput,
  chatInputRef,
  inputNotice,
  inputEditable = true,
  inputFocused,
  showSuggestions,
  queueCount = 0,
  onAskAgentFromMessage,
  onChatInputChange,
  onChatKeyDown,
  onCommandSelect,
  onSuggestionsClose,
  onFocus,
  onBlur,
  onSendMessage,
  onContinue,
  workingDirectory,
  fileServerUrl,
  capability,
}) {
  const [continuationInput, setContinuationInput] = useState('');
  const [showTaskMenu, setShowTaskMenu] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const taskMenuRef = useRef(null);
  const contextMenuRef = useRef(null);

  const needsUserInput = runtime.status === 'needs_user_input';
  const askInfo = runtime.askUserInfo;
  const queuePreview = queueCount > 0 ? getQueuePreview(3, 80) : [];
  const workspaceName = String(workingDirectory || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .at(-1) || '';
  const firstUserMessage = runtime.messages.find((message) => message?.type === 'user');
  const firstUserText = typeof firstUserMessage?.content === 'string'
    ? firstUserMessage.content
    : typeof firstUserMessage?.message === 'string'
      ? firstUserMessage.message
      : '';
  const taskTitle = firstUserText.trim()
    ? `${firstUserText.trim().slice(0, 46)}${firstUserText.trim().length > 46 ? '…' : ''}`
    : workspaceName || '新任务';

  useEffect(() => {
    if (!showTaskMenu) return;
    const handleClick = (e) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(e.target)) {
        setShowTaskMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTaskMenu]);

  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showContextMenu]);

  const handleExportChat = () => {
    downloadConversationMarkdown(runtime.messages, workingDirectory);
    setShowTaskMenu(false);
  };

  const handleClearChat = () => {
    runtime.clearMessages();
    setShowTaskMenu(false);
  };

  const handleContinue = async (submittedValue, extra = {}) => {
    const value = String(submittedValue || continuationInput).trim();
    if (!value) {
      return false;
    }
    setContinuationInput('');
    try {
      await onContinue?.(value, extra);
      return true;
    } catch {
      setContinuationInput(value);
      return false;
    }
  };

  const menuDropdownStyle = {
    position: 'absolute',
    top: '100%',
    left: 0,
    minWidth: '180px',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--glass-border)',
    borderRadius: '10px',
    boxShadow: 'var(--glass-shadow-lg)',
    padding: '6px 0',
    zIndex: 1000,
  };

  const menuItemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
  };

  const menuItemHoverStyle = {
    backgroundColor: 'var(--glass-bg-light)',
  };

  return (
    <div className="mastery-chat" style={styles.chatArea}>
      <AskUserFloatingCapsule
        askUserInfo={askInfo}
        onContinue={handleContinue}
        onCancel={runtime.cancelInteraction}
        onDismiss={runtime.dismissAskUser}
      />
      <div className="mastery-chat-header" style={styles.chatHeader}>
        <div style={styles.chatTitle}>
          <span className="mastery-chat-title-mark" style={styles.chatTitleMark}><Icon name="folder" size={17} /></span>
          <span title={firstUserText || workspaceName || '新任务'}>{taskTitle}</span>
          <span className="codex-message-count" style={styles.chatMessageCount}>
            {t('chat.message_count', { count: runtime.messages.length })}
          </span>
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              className="codex-title-menu"
              aria-label="任务菜单"
              onClick={() => setShowTaskMenu((prev) => !prev)}
            >
              <Icon name="list" size={15} />
            </button>
            {showTaskMenu && (
              <div ref={taskMenuRef} style={menuDropdownStyle}>
                <button
                  type="button"
                  style={menuItemStyle}
                  onClick={handleExportChat}
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Icon name="download" size={14} />
                  导出对话
                </button>
                <button
                  type="button"
                  style={menuItemStyle}
                  onClick={handleClearChat}
                  onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Icon name="close" size={14} />
                  清除对话
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="mastery-message-stage"
        style={styles.messageContainer}
        role="log"
        aria-label={t('ui.root')}
        aria-live="polite"
        tabIndex={0}
      >
        <MessageLog
          messages={runtime.messages}
          status={runtime.status}
          workingDirectory={workingDirectory}
          fileServerUrl={fileServerUrl}
          onClear={runtime.clearMessages}
          onAskAgent={onAskAgentFromMessage}
        />
      </div>

      <div className="mastery-composer-area" style={styles.inputArea}>
        {!inputEditable && capability?.status && (
          <div className="capability-inline-notice" role="status">
            Agent Runtime {capability.status === 'degraded' ? '正在恢复' : '当前不可用'}
            {capability.reason ? ` · ${capability.reason}` : ''}
          </div>
        )}
        {queueCount > 0 && (
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-divider)',
              backgroundColor: 'var(--surface-raised)',
              fontSize: '12px',
              color: 'var(--text-muted)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '4px',
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 4.5V8L10.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                队列中的消息 ({queueCount})
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-dark)' }}>
                当前任务完成后自动执行
              </span>
            </div>
            {queuePreview.map((item, i) => (
              <div
                key={item.id}
                style={{
                  padding: '3px 8px',
                  marginBottom: '2px',
                  borderRadius: '4px',
                  backgroundColor: i === 0 ? 'var(--primary-soft)' : 'transparent',
                  color: i === 0 ? 'var(--primary-color)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={item.preview}
              >
                {i + 1}. {item.preview}
              </div>
            ))}
            {queueCount > queuePreview.length && (
              <div style={{ fontSize: '11px', color: 'var(--text-dark)', paddingLeft: '8px' }}>
                还有 {queueCount - queuePreview.length} 条...
              </div>
            )}
          </div>
        )}
        <InteractionConsole
          status={runtime.status}
          messages={runtime.messages}
          tools={runtime.tools}
          inputNotice={inputNotice}
          inputValue={chatInput}
        />
        <div className="mastery-composer" style={styles.inputWrapper}>
          {showSuggestions && (
            <CommandSuggestions
              input={chatInput}
              tools={runtime.tools}
              onSelect={onCommandSelect}
              onClose={onSuggestionsClose}
            />
          )}

          <textarea
            ref={chatInputRef}
            style={{
              ...styles.inputTextarea,
              ...(inputFocused ? styles.inputTextareaFocused : {}),
              ...(needsUserInput ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={onChatKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={needsUserInput ? '请在上方浮动胶囊中回答问题...' : t('chat.placeholder')}
            disabled={needsUserInput || !inputEditable}
          />
          <div className="codex-composer-tools">
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button"
                className="codex-composer-plus"
                title="添加上下文"
                aria-label="添加上下文"
                onClick={() => setShowContextMenu((prev) => !prev)}
              >
                <Icon name="plus" size={17} />
              </button>
              {showContextMenu && (
                <div ref={contextMenuRef} style={{ ...menuDropdownStyle, left: 'auto', right: 0, minWidth: '160px' }}>
                  <button
                    type="button"
                    style={menuItemStyle}
                    onClick={() => {
                      onChatInputChange('/doc add ');
                      setShowContextMenu(false);
                      chatInputRef.current?.focus();
                    }}
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    添加文档
                  </button>
                  <button
                    type="button"
                    style={menuItemStyle}
                    onClick={() => {
                      onChatInputChange('/doc search ');
                      setShowContextMenu(false);
                      chatInputRef.current?.focus();
                    }}
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    搜索文档
                  </button>
                  <button
                    type="button"
                    style={menuItemStyle}
                    onClick={() => {
                      onChatInputChange('/debug on');
                      setShowContextMenu(false);
                      chatInputRef.current?.focus();
                    }}
                    onMouseEnter={(e) => Object.assign(e.currentTarget.style, menuItemHoverStyle)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    调试模式
                  </button>
                </div>
              )}
            </div>
            <span className="codex-access-mode"><Icon name="lock" size={13} />完全访问</span>
            <RuntimeSelector runtime={runtime} />
          </div>
          {runtime.status === 'running' && chatInput.trim() ? (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
              <button
                style={styles.sendButtonRunningSecondary}
                onClick={onSendMessage}
                title="加入队列（等当前任务完成后自动执行）"
                aria-label="加入队列"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 3h13"/><path d="M5.5 21h13"/><path d="M12 3v2"/><path d="M12 19v2"/><path d="M7 7l10 10"/><path d="M17 7L7 17"/></svg>
              </button>
              <button
                style={{
                  ...styles.sendButton,
                  ...styles.sendButtonRunning,
                }}
                onClick={() => runtime.stop()}
                title={t('chat.stop_running')}
                aria-label={t('ui.stop')}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="2"/></svg>
              </button>
            </div>
          ) : (
            <button
              className={getSendButtonMotionClass(runtime.status, chatInput)}
              style={{
                ...styles.sendButton,
                ...(runtime.status === 'running'
                  ? { ...styles.sendButtonRunning }
                  : !chatInput.trim()
                    ? styles.sendButtonDisabled
                    : {}),
              }}
              onClick={runtime.status === 'running' ? () => runtime.stop() : onSendMessage}
              disabled={!inputEditable || (runtime.status !== 'running' && !chatInput.trim())}
              title={runtime.status === 'running' ? t('chat.stop_running') : t('chat.send_message')}
              aria-label={runtime.status === 'running' ? t('ui.stop') : t('ui.send_message')}
            >
              {runtime.status === 'running' ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="2"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v12M1 7h12"/></svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
