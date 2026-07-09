import React, { useState } from 'react';
import CommandSuggestions from '../CommandSuggestions.jsx';
import MessageLog from '../MessageLog.jsx';
import { InteractionConsole } from './InteractionConsole.jsx';
import { AskUserFloatingCapsule } from '../AskUserFloatingCapsule.jsx';
import { getSendButtonMotionClass } from '../../app/interaction/animation-system.js';
import { getQueuePreview } from '../../app/message-queue.js';
import { styles } from '../../app/styles.js';
import { t } from '../../i18n.js';

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
}) {
  const [continuationInput, setContinuationInput] = useState('');
  const needsUserInput = runtime.status === 'needs_user_input';
  const askInfo = runtime.askUserInfo;
  const queuePreview = queueCount > 0 ? getQueuePreview(3, 80) : [];

  const handleContinue = async () => {
    const value = continuationInput.trim();
    if (!value) {
      return;
    }
    setContinuationInput('');
    try {
      await onContinue?.(value);
    } catch {
      setContinuationInput(value);
    }
  };
  return (
    <div style={styles.chatArea}>
      <AskUserFloatingCapsule
        askUserInfo={askInfo}
        onContinue={handleContinue}
        onDismiss={runtime.dismissAskUser}
      />
      <div style={styles.chatHeader}>
        <div style={styles.chatTitle}>
          <span style={styles.chatTitleMark}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2.5C5.51472 2.5 3.5 4.51472 3.5 7C3.5 7.88564 3.74512 8.71387 4.16602 9.41602L3.91699 11.083L5.58496 10.834C6.28711 11.2549 7.11436 11.5 8 11.5C10.4853 11.5 12.5 9.48528 12.5 7C12.5 4.51472 10.4853 2.5 8 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 5.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M6.5 7H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <span>{t('chat.title')}</span>
          <span style={styles.chatMessageCount}>
            {t('chat.message_count', { count: runtime.messages.length })}
          </span>
        </div>
      </div>

      <div
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

      <div style={styles.inputArea}>
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
        <div style={styles.inputWrapper}>
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
            disabled={needsUserInput}
          />
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
              disabled={runtime.status !== 'running' && !chatInput.trim()}
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
