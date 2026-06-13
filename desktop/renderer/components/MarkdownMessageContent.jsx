import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styles } from './MessageLog.styles.js';

const AUTO_LINK_RE = /(?<!<)(?<!\]\()(?<!\[)(\b(?:https?:\/\/|www\.)[^\s<>\]\[()"']+[^\s<>\]\[()"'\.,;!?\n])/gi;
const MARKDOWN_STYLE = {
  maxHeight: 'none',
  overflowY: 'visible',
};
const REMARK_PLUGINS = [remarkGfm];

function preprocessTextForLinks(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(AUTO_LINK_RE, (match) => `[${match}](${match})`);
}

export const MarkdownMessageContent = React.memo(function MarkdownMessageContent({
  text,
  isCollapsed,
  isUser,
  markdownComponents,
  onLinkClick,
}) {
  const markdownText = useMemo(() => preprocessTextForLinks(text || ''), [text]);

  if (!text) {
    return null;
  }

  return (
    <div style={{
      ...styles.messageContent,
      ...(isCollapsed ? styles.messageContentCollapsed : {}),
      ...(isUser ? { textAlign: 'right' } : {})
    }}>
      <div
        className="markdown"
        style={MARKDOWN_STYLE}
        onClick={onLinkClick}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={markdownComponents}
          remarkPluginSettings={{ gfm: true }}
        >
          {markdownText}
        </ReactMarkdown>
      </div>
    </div>
  );
});


