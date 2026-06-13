import React from 'react';
import CommandSuggestions from '../CommandSuggestions.jsx';
import MessageLog from '../MessageLog.jsx';
import { Button } from '../ui/index.js';
import { styles } from '../../app/styles.js';

export function ChatWorkspace({
  runtime,
  chatInput,
  chatInputRef,
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
  onExport,
  onOpenPreview,
  onToggleInspector,
  summaryPanelVisible,
}) {
  return (
    <div style={styles.chatArea}>
      <div style={styles.chatHeader}>
        <div style={styles.chatTitle}>
          <span style={styles.chatTitleMark}>AI</span>
          <span>对话</span>
          <span style={styles.chatMessageCount}>
            {runtime.messages.length} 条消息
          </span>
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button variant="ghost" size="sm" onClick={onExport} title="导出对话" ariaLabel="导出对话">导出</Button>
          <Button variant="ghost" size="sm" onClick={onOpenPreview} title="打开预览" ariaLabel="打开预览">Preview</Button>
          <Button variant="ghost" size="sm" onClick={onToggleInspector} title="切换 Inspector" ariaLabel="切换 Inspector">
            {summaryPanelVisible ? '隐藏' : '显示'} Inspector
          </Button>
          <Button variant="ghost" size="sm" onClick={runtime.clearMessages} title="清除对话" ariaLabel="清除对话">清除</Button>
        </div>
      </div>

      <div style={styles.messageContainer} role="log" aria-label="对话消息" aria-live="polite" tabIndex={0}>
        <MessageLog
          messages={runtime.messages}
          status={runtime.status}
          onClear={runtime.clearMessages}
          onAskAgent={onAskAgentFromMessage}
        />
      </div>

      <div style={styles.inputArea}>
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
            placeholder="输入消息... (Ctrl+Enter 发送 | 输入 / 查看命令)"
            disabled={runtime.status === 'running'}
          />
          <button
            style={{
              ...styles.sendButton,
              ...(runtime.status === 'running'
                ? { backgroundColor: 'var(--warning-color)', color: '#000' }
                : !chatInput.trim()
                  ? styles.sendButtonDisabled
                  : {})
            }}
            onClick={runtime.status === 'running' ? () => runtime.stop() : onSendMessage}
            disabled={runtime.status !== 'running' && !chatInput.trim()}
            title={runtime.status === 'running' ? '停止执行 (Cmd+Ctrl+.)' : '发送消息 (Ctrl+Enter)'}
            aria-label={runtime.status === 'running' ? '停止执行' : '发送消息'}
          >
            {runtime.status === 'running' ? '■' : '↑'}
          </button>
        </div>
        <div style={styles.inputHint}>
          按 <kbd className="kbd-hint">Ctrl+Enter</kbd> 发送 | 输入 <kbd className="kbd-hint">/技能名</kbd> 快速调用技能
        </div>
      </div>
    </div>
  );
}
