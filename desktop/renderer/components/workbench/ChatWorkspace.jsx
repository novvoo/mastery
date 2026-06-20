import React, { useState } from 'react';
import CommandSuggestions from '../CommandSuggestions.jsx';
import MessageLog from '../MessageLog.jsx';
import { InteractionConsole } from './InteractionConsole.jsx';
import { getSendButtonMotionClass } from '../../app/animation-system.js';
import { styles } from '../../app/styles.js';
import { t } from '../../i18n.js';

export function ChatWorkspace({
  runtime,
  chatInput,
  chatInputRef,
  inputNotice,
  inputFocused,
  showSuggestions,
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

  const handleContinue = async () => {
    const value = continuationInput.trim();
    if (!value) {
      return;
    }
    await onContinue?.(value);
    setContinuationInput('');
  };
  return (
    <div style={styles.chatArea}>
      <div style={styles.chatHeader}>
        <div style={styles.chatTitle}>
          <span style={styles.chatTitleMark}>AI</span>
          <span>{t('chat.title')}</span>
          <span style={styles.chatMessageCount}>
            {t('chat.message_count', { count: runtime.messages.length })}
          </span>
        </div>
      </div>

      <div style={styles.messageContainer} role="log" aria-label={t('ui.root')} aria-live="polite" tabIndex={0}>
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
        {needsUserInput && (
          <div style={styles.userInputRequestPanel}>
            <div style={styles.userInputRequestHeader}>
              <span>{t('chat.waiting_input')}</span>
              <span style={styles.userInputRequestMeta}>{t('chat.continue_round')}</span>
            </div>
            <div style={styles.userInputRequestBody}>
              <textarea
                style={styles.userInputRequestTextarea}
                value={continuationInput}
                onChange={(event) => setContinuationInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    handleContinue();
                  }
                }}
                placeholder={t('chat.supplementary')}
              />
              <button
                type="button"
                style={{
                  ...styles.userInputRequestButton,
                  ...(!continuationInput.trim() ? styles.userInputRequestButtonDisabled : {})
                }}
                onClick={handleContinue}
                disabled={!continuationInput.trim()}
              >
                {t('chat.continue')}
              </button>
            </div>
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
              ...(inputFocused ? styles.inputTextareaFocused : {})
            }}
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={onChatKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={t('chat.placeholder')}
            disabled={runtime.status === 'running'}
          />
          <button
            className={getSendButtonMotionClass(runtime.status, chatInput)}
            style={{
              ...styles.sendButton,
              ...(runtime.status === 'running'
                ? { backgroundColor: 'var(--warning-color)', color: 'var(--text-on-primary)' }
                : !chatInput.trim()
                  ? styles.sendButtonDisabled
                  : {})
            }}
            onClick={runtime.status === 'running' ? () => runtime.stop() : onSendMessage}
            disabled={runtime.status !== 'running' && !chatInput.trim()}
            title={runtime.status === 'running' ? t('chat.stop_running') : t('chat.send_message')}
            aria-label={runtime.status === 'running' ? t('ui.stop') : t('ui.send_message')}
          >
            {runtime.status === 'running' ? '■' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}
