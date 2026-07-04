import { useState, useEffect, useRef } from 'react';
import { styles } from '../app/styles.js';

export function AskUserFloatingCapsule({ askUserInfo, onContinue }) {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (askUserInfo && askUserInfo.message) {
      setInputValue('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    }
  }, [askUserInfo]);

  const handleSubmit = () => {
    if (!inputValue.trim()) return;
    onContinue(inputValue.trim());
    setInputValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isVisible = !!askUserInfo?.message;

  return (
    <div
      style={{
        ...styles.askUserFloatingCapsule,
        ...(isVisible ? styles.askUserFloatingCapsuleVisible : {}),
      }}
    >
      <div style={styles.askUserIconWrapper}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary-color)' }}>
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>

      <div style={styles.askUserContent}>
        <div style={styles.askUserTitle}>需要你的回答</div>
        <div style={styles.askUserMessage} title={askUserInfo?.message}>
          {askUserInfo?.message}
        </div>

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
            disabled={!isVisible}
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
      </div>
    </div>
  );
}