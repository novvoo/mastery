import { useState, useEffect, useRef, useCallback } from 'react';
import { styles } from '../app/styles.js';

export function AskUserFloatingCapsule({ askUserInfo, onContinue }) {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const inputRef = useRef(null);
  const capsuleRef = useRef(null);

  const hasActiveRequest = !!(askUserInfo?.message || askUserInfo?.answer);
  const isExpanded = hasActiveRequest || manuallyExpanded;

  useEffect(() => {
    if (isExpanded) {
      setInputValue('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    }
  }, [isExpanded]);

  useEffect(() => {
    if (!hasActiveRequest && !manuallyExpanded) return;
    const handleClickOutside = (e) => {
      if (capsuleRef.current && !capsuleRef.current.contains(e.target)) {
        setManuallyExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [hasActiveRequest, manuallyExpanded]);

  const handleSubmit = useCallback(() => {
    if (!inputValue.trim()) return;
    onContinue(inputValue.trim());
    setInputValue('');
    setManuallyExpanded(false);
  }, [inputValue, onContinue]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCollapsedClick = () => {
    setManuallyExpanded(true);
  };

  const handleCollapse = () => {
    setManuallyExpanded(false);
  };

  if (!isExpanded) {
    return (
      <div
        style={styles.askUserFloatingCapsuleCollapsed}
        title={hasActiveRequest ? 'Agent 正在等待你的回答' : '点击展开交互面板'}
        onClick={handleCollapsedClick}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
    );
  }

  const displayMessage = askUserInfo?.message || askUserInfo?.answer || '';

  return (
    <div ref={capsuleRef} style={{ ...styles.askUserFloatingCapsule, ...styles.askUserFloatingCapsuleVisible }}>
      <div style={styles.askUserIconWrapper} onClick={handleCollapse} title="收起">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>

      <div style={styles.askUserContent}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={styles.askUserTitle}>需要你的回答</div>
          <button
            onClick={handleCollapse}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '2px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              fontSize: '16px',
            }}
            title="收起"
          >
            ×
          </button>
        </div>
        {displayMessage ? (
          <div style={styles.askUserMessage} title={displayMessage}>
            {displayMessage}
          </div>
        ) : (
          <div style={{ ...styles.askUserMessage, color: 'var(--text-dark)' }}>
            暂无待回答的问题，等待 Agent 提问...
          </div>
        )}

        {hasActiveRequest && (
          <div
            style={{
              ...styles.askUserInputWrapper,
              ...(isFocused ? styles.askUserInputWrapperFocused : {}),
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的回答..."
              style={styles.askUserInput}
            />
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              style={{
                ...styles.askUserButton,
                ...(!inputValue.trim() ? styles.askUserButtonDisabled : {}),
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
