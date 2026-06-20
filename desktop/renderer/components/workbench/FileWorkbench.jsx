import { useCallback, useState } from 'react';

const CODE_KEYWORD_PATTERN = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|async|await|try|catch|throw|new|switch|case|break|default|true|false|null|undefined)\b/g;

function splitCodeLine(line) {
  const segments = [];
  const pattern = /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:import|export|from|const|let|var|function|return|if|else|for|while|class|extends|async|await|try|catch|throw|new|switch|case|break|default|true|false|null|undefined)\b)/g;
  let lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), type: 'plain' });
    }
    const text = match[0];
    const type = text.startsWith('//') || text.startsWith('#')
      ? 'comment'
      : text.startsWith('"') || text.startsWith("'") || text.startsWith('`')
      ? 'string'
      : /^\d/.test(text)
      ? 'number'
      : CODE_KEYWORD_PATTERN.test(text)
      ? 'keyword'
      : 'plain';
    CODE_KEYWORD_PATTERN.lastIndex = 0;
    segments.push({ text, type });
    lastIndex = match.index + text.length;
  }
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), type: 'plain' });
  }
  return segments.length > 0 ? segments : [{ text: ' ', type: 'plain' }];
}

function getCodeTokenStyle(type, styles) {
  if (type === 'keyword') return styles.codeKeyword;
  if (type === 'string') return styles.codeString;
  if (type === 'comment') return styles.codeComment;
  if (type === 'number') return styles.codeNumber;
  return null;
}

function getFileLanguage(path = '') {
  const ext = path.split('.').pop()?.toLowerCase();
  return {
    js: 'JavaScript',
    jsx: 'React',
    ts: 'TypeScript',
    tsx: 'React TS',
    json: 'JSON',
    css: 'CSS',
    md: 'Markdown',
    html: 'HTML',
    py: 'Python',
    sh: 'Shell',
  }[ext] || 'Text';
}

const fileStyles = {
  workbench: {
    width: '340px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
    borderRight: '1px solid var(--border-color)',
    backgroundColor: 'var(--surface-color)',
  },
  header: {
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderBottom: '1px solid transparent',
    flexShrink: 0,
  },
  title: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    fontSize: '12px',
    fontWeight: 800,
  },
  meta: {
    flexShrink: 0,
    color: 'var(--text-dark)',
    fontSize: '10px',
    fontWeight: 700,
  },
  actionButton: {
    height: '24px',
    padding: '0 6px',
    borderRadius: '4px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '10px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  editorBody: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: 1.55,
    backgroundColor: 'var(--surface-color)',
  },
  codeLine: {
    display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr)',
    minHeight: '18px',
  },
  codeLineNumber: {
    paddingRight: '8px',
    color: 'var(--text-dark)',
    textAlign: 'right',
    userSelect: 'none',
    borderRight: '1px solid transparent',
  },
  codeLineContent: {
    padding: '0 8px 0 10px',
    whiteSpace: 'pre',
    color: 'var(--text-muted)',
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  codeKeyword: {
    color: 'var(--info-color)',
    fontWeight: 800,
  },
  codeString: {
    color: 'var(--success-color)',
  },
  codeComment: {
    color: 'var(--text-dark)',
    fontStyle: 'italic',
  },
  codeNumber: {
    color: 'var(--warning-color)',
  },
  textarea: {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: 1.55,
    padding: '10px',
    outline: 'none',
    resize: 'none',
  },
  empty: {
    textAlign: 'center',
    padding: '24px',
    color: 'var(--text-dark)',
    fontSize: '12px',
  },
};

function CodePreview({ openFile }) {
  const content = openFile?.content || '';
  const lines = content.split('\n');
  return (
    <div style={fileStyles.editorBody}>
      {lines.map((line, index) => (
        <div key={`${index}_${line.slice(0, 16)}`} style={fileStyles.codeLine}>
          <span style={fileStyles.codeLineNumber}>{index + 1}</span>
          <code style={fileStyles.codeLineContent}>
            {splitCodeLine(line).map((segment, segmentIndex) => (
              <span key={`${segmentIndex}_${segment.text}`} style={getCodeTokenStyle(segment.type, fileStyles)}>
                {segment.text}
              </span>
            ))}
          </code>
        </div>
      ))}
    </div>
  );
}

function EditorTextarea({ value, onChange }) {
  return (
    <textarea
      style={fileStyles.textarea}
      value={value}
      onChange={onChange}
      spellCheck={false}
    />
  );
}

export function FileWorkbench({
  openFile,
  fileDraft,
  fileMode,
  fileStatus,
  fileError,
  onClose,
  onSave,
  onModeToggle,
  onDraftChange,
}) {
  if (!openFile) return null;

  const isDirty = fileDraft !== openFile.content;
  const language = getFileLanguage(openFile.path);
  const isLoading = fileStatus === 'loading';
  const isSaving = fileStatus === 'saving';

  return (
    <div style={fileStyles.workbench}>
      <div style={fileStyles.header}>
        <span style={fileStyles.title} title={openFile.path}>
          {openFile.name || openFile.path}
        </span>
        <span style={fileStyles.meta}>{language}</span>
        {isDirty && <span style={fileStyles.meta}>modified</span>}
        <button
          type="button"
          style={fileStyles.actionButton}
          onClick={onModeToggle}
          disabled={isLoading || isSaving}
        >
          {fileMode === 'edit' ? 'View' : 'Edit'}
        </button>
        {fileMode === 'edit' && (
          <button
            type="button"
            style={fileStyles.actionButton}
            onClick={onSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? 'Saving' : 'Save'}
          </button>
        )}
        <button type="button" style={fileStyles.actionButton} onClick={onClose}>
          x
        </button>
      </div>
      {isLoading && <div style={fileStyles.empty}>正在打开文件...</div>}
      {fileStatus === 'error' && <div style={fileStyles.empty}>{fileError}</div>}
      {!isLoading && fileStatus !== 'error' && fileMode === 'preview' && <CodePreview openFile={openFile} />}
      {!isLoading && fileStatus !== 'error' && fileMode === 'edit' && (
        <EditorTextarea value={fileDraft} onChange={onDraftChange} />
      )}
    </div>
  );
}
