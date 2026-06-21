import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styles } from './message-log/styles/MessageLog.styles.js';

const AUTO_LINK_RE = /(?<!<)(?<!\]\()(?<!\[)(\b(?:https?:\/\/|www\.)[^\s<>\]\[()"']+[^\s<>\]\[()"'\.,;!?\n])/gi;
const MARKDOWN_STYLE = {
  maxHeight: 'none',
  overflowY: 'visible',
};
const REMARK_PLUGINS = [remarkGfm];
const FENCE_LINE_RE = /^```/gm;
const FENCED_BLOCK_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
const XML_DECL_RE = /<\?xml[\s\S]*?\?>/gi;
const XML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const CDATA_RE = /<!\[CDATA\[[\s\S]*?\]\]>/g;
const XML_TAG_RE = /<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\/?>/g;
const XML_PAIR_RE = /<([A-Za-z_][\w:.-]*)(?:\s+[^<>]*?)?>[\s\S]*?<\/\1>/;

function toUrl(src, workingDirectory, fileServerUrl) {
  if (!src) return src;
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (/^data:/i.test(src)) return src;

  let relative;
  if (/^[a-zA-Z]:[\\\/]/.test(src) || src.startsWith('/')) {
    const cleanAbs = src.replace(/\\/g, '/');
    const cleanWd = (workingDirectory || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (cleanWd && cleanAbs.startsWith(cleanWd + '/')) {
      relative = cleanAbs.slice(cleanWd.length + 1);
    } else {
      relative = cleanAbs.replace(/^\/+/, '');
    }
  } else {
    relative = src.replace(/^\.?\//, '').replace(/\\/g, '/');
  }

  if (fileServerUrl) {
    const base = fileServerUrl.replace(/\/$/, '');
    return `${base}/${relative.split('/').map(encodeURIComponent).join('/')}`;
  }

  let absPath;
  if (/^[a-zA-Z]:/.test(src) || src.startsWith('/')) {
    absPath = src.replace(/\\/g, '/');
  } else {
    absPath = workingDirectory
      ? `${workingDirectory.replace(/[\\\/]+$/, '').replace(/\\/g, '/')}/${relative}`
      : relative;
  }
  return `file://${absPath.startsWith('/') ? '' : '/'}${absPath}`;
}

function preprocessTextForLinks(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(AUTO_LINK_RE, (match) => `[${match}](${match})`);
}

function escapeMarkupToken(token) {
  return token
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlLikeMarkup(text) {
  if (!text || typeof text !== 'string') return text;

  return text
    .split(FENCED_BLOCK_RE)
    .map((part) => {
      if (/^(```|~~~)/.test(part)) return part;
      return part
        .replace(XML_DECL_RE, escapeMarkupToken)
        .replace(XML_COMMENT_RE, escapeMarkupToken)
        .replace(CDATA_RE, escapeMarkupToken)
        .replace(XML_TAG_RE, escapeMarkupToken);
    })
    .join('');
}

function preprocessImagePaths(text, workingDirectory, fileServerUrl) {
  if (!text || typeof text !== 'string') return text;
  let next = text;
  next = next.replace(
    /(!\[[^\]]*\]\()(\s*)([^)\s]+)(\s*([^)]*)\))/g,
    (match, prefix, sp1, src, sp2, rest) => {
      const resolved = toUrl(src, workingDirectory, fileServerUrl);
      return `${prefix}${sp1}${resolved}${sp2}${rest}`;
    }
  );
  next = next.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)("[^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const resolved = toUrl(src, workingDirectory, fileServerUrl);
      return `${prefix}${resolved}${suffix}`;
    }
  );
  next = next.replace(
    /(<img\b[^>]*\bsrc=')([^']+)('[^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const resolved = toUrl(src, workingDirectory, fileServerUrl);
      return `${prefix}${resolved}${suffix}`;
    }
  );
  return next;
}

function stabilizeStreamingMarkdown(text) {
  if (!text || typeof text !== 'string') return text;

  const fenceCount = (text.match(FENCE_LINE_RE) || []).length;
  if (fenceCount % 2 === 1) {
    return `${text}\n\`\`\``;
  }
  return text;
}

function looksLikeMarkupBlock(text) {
  const clean = String(text || '').trim();
  if (!clean || clean.length > 40000) return false;
  if (!clean.startsWith('<')) return false;
  if (clean.startsWith('<!--') || /^<\?xml\b/i.test(clean)) return true;
  return XML_PAIR_RE.test(clean) || /^<[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\/?>$/.test(clean);
}

function guessMarkupLanguage(text) {
  return /^<(!doctype\s+html|html\b)/i.test(String(text || '').trim())
    ? 'html'
    : 'xml';
}

export const MarkdownMessageContent = React.memo(function MarkdownMessageContent({
  text,
  isCollapsed,
  isUser,
  isStreaming,
  workingDirectory,
  fileServerUrl,
  markdownComponents,
  onLinkClick,
}) {
  const markupBlock = useMemo(() => {
    if (isCollapsed) return null;
    if (!looksLikeMarkupBlock(text)) return null;
    return {
      language: guessMarkupLanguage(text),
      content: String(text || '').trim(),
    };
  }, [text, isCollapsed]);

  const markdownText = useMemo(() => {
    const stableText = isStreaming ? stabilizeStreamingMarkdown(text || '') : (text || '');
    const visibleMarkupText = escapeXmlLikeMarkup(stableText);
    const linked = preprocessTextForLinks(visibleMarkupText);
    return preprocessImagePaths(linked, workingDirectory, fileServerUrl);
  }, [text, isStreaming, workingDirectory, fileServerUrl]);

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
        {markupBlock ? (
          <pre className="markup-block" data-language={markupBlock.language}>
            <code>{markupBlock.content}</code>
          </pre>
        ) : (
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            components={markdownComponents}
            remarkPluginSettings={{ gfm: true }}
          >
            {markdownText}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
});
