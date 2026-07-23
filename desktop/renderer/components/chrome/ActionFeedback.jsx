import React, { useEffect } from 'react';
import { Icon } from '../ui/index.js';

export function ActionFeedback({ feedback, onDismiss }) {
  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = window.setTimeout(onDismiss, 3200);
    return () => window.clearTimeout(timeout);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  return (
    <div
      className={`mastery-action-feedback is-${feedback.tone || 'info'}`}
      role={feedback.tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <Icon name={feedback.tone === 'error' ? 'error' : 'success'} size={15} />
      <span>{feedback.message}</span>
      <button type="button" aria-label="关闭提示" onClick={onDismiss}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
