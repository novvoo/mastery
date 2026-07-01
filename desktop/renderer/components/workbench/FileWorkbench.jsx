import { useCallback, useState, useEffect, useRef } from 'react';

// ── Legacy regex-based highlighting (fallback when LSP unavailable) ─────────

const CODE_KEYWORD_PATTERN = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|async|await|try|catch|throw|new|switch|case|break|default|true|false|null|undefined|as|type|interface|enum|implements|extends|public|private|protected|readonly|static|abstract)\b/g;

function splitCodeLineRegex(line) {
  const segments = [];
  const pattern = /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:import|export|from|const|let|var|function|return|if|else|for|while|class|extends|async|await|try|catch|throw|new|switch|case|break|default|true|false|null|undefined|as|type|interface|enum|implements|extends|public|private|protected|readonly|static|abstract)\b)/g;
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

// ── LSP Semantic Token → CSS type mapping ──────────────────────────────────

const SEMANTIC_TOKEN_TO_STYLE = {
  // Types
  namespace: 'keyword', type: 'keyword', class: 'keyword', enum: 'keyword',
  interface: 'keyword', struct: 'keyword', typeParameter: 'keyword',
  // Variables & properties
  parameter: 'plain', variable: 'plain', property: 'plain', enumMember: 'plain',
  // Functions
  function: 'keyword', method: 'keyword', macro: 'keyword',
  // Language
  keyword: 'keyword', modifier: 'keyword',
  // Literals
  comment: 'comment', string: 'string', number: 'number', regexp: 'string',
  // Other
  operator: 'plain', decorator: 'keyword',
};

/**
 * Decode LSP relative semantic tokens into per-line colored segments.
 * data: [deltaLine, deltaStart, length, tokenType, tokenModifiers, ...]
 */
function decodeSemanticTokens(tokens, lines, tokenLegend) {
  if (!tokens || !tokens.data || tokens.data.length === 0) {return null;}
  const { tokenTypes } = tokenLegend;

  const perLine = Array.from({ length: lines.length }, () => []);

  let line = 0;
  let start = 0;
  for (let i = 0; i < tokens.data.length; i += 5) {
    const deltaLine = tokens.data[i];
    const deltaStart = tokens.data[i + 1];
    const length = tokens.data[i + 2];
    const typeIdx = tokens.data[i + 3];
    // modifiersIdx = tokens.data[i + 4]; // reserved for future use

    line = deltaLine === 0 ? line : line + deltaLine;
    start = deltaStart === 0 ? start : start + deltaStart;

    if (line >= lines.length) {break;}

    const tokenName = tokenTypes[typeIdx] || 'plain';
    const styleType = SEMANTIC_TOKEN_TO_STYLE[tokenName] || 'plain';

    const lineText = lines[line];
    const end = Math.min(start + length, lineText.length);
    if (start < lineText.length) {
      perLine[line].push({ start, end, type: styleType });
    }

    start = end;
  }

  return perLine;
}

/**
 * Merge semantic token ranges into segments array.
 */
function applySemanticSegments(lineText, tokenRanges) {
  if (!tokenRanges || tokenRanges.length === 0) {
    return [{ text: lineText || ' ', type: 'plain' }];
  }
  // Sort by start position
  const sorted = [...tokenRanges].sort((a, b) => a.start - b.start);
  const segments = [];
  let pos = 0;
  for (const r of sorted) {
    if (r.start > pos) {
      segments.push({ text: lineText.slice(pos, r.start), type: 'plain' });
    }
    segments.push({ text: lineText.slice(r.start, r.end), type: r.type });
    pos = r.end;
  }
  if (pos < lineText.length) {
    segments.push({ text: lineText.slice(pos), type: 'plain' });
  }
  return segments.length > 0 ? segments : [{ text: ' ', type: 'plain' }];
}

// ── CSS helpers ────────────────────────────────────────────────────────────

function getCodeTokenStyle(type, styles) {
  if (type === 'keyword') {return styles.codeKeyword;}
  if (type === 'string') {return styles.codeString;}
  if (type === 'comment') {return styles.codeComment;}
  if (type === 'number') {return styles.codeNumber;}
  return null;
}

function getFileLanguage(path = '') {
  const ext = path.split('.').pop()?.toLowerCase();
  return {
    js: 'JavaScript', jsx: 'React JSX', ts: 'TypeScript', tsx: 'React TSX',
    json: 'JSON', css: 'CSS', md: 'Markdown', html: 'HTML',
    py: 'Python', pyi: 'Python', sh: 'Shell', go: 'Go',
    rs: 'Rust', java: 'Java', vue: 'Vue', svelte: 'Svelte',
    scss: 'SCSS', less: 'Less', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    mjs: 'JS Module', cjs: 'JS CJS', mts: 'TS Module', cts: 'TS CJS',
  }[ext] || 'Text';
}

function diagnosticSeverityClass(severity) {
  if (severity === 1) {return 'diag-error';}    // Error
  if (severity === 2) {return 'diag-warning';}  // Warning
  if (severity === 3) {return 'diag-info';}     // Information
  if (severity === 4) {return 'diag-hint';}     // Hint
  return '';
}

// ── Styles ─────────────────────────────────────────────────────────────────

const fileStyles = {
  workbench: {
    width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column',
    minWidth: 0, overflow: 'hidden',
    borderRight: '1px solid var(--border-color)',
    backgroundColor: 'var(--surface-color)',
  },
  header: {
    minHeight: '36px', display: 'flex', alignItems: 'center', gap: '8px',
    padding: '6px 10px', borderBottom: '1px solid transparent', flexShrink: 0,
  },
  title: {
    minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', color: 'var(--text-color)', fontSize: '12px', fontWeight: 800,
  },
  meta: {
    flexShrink: 0, color: 'var(--text-dark)', fontSize: '10px', fontWeight: 700,
  },
  metaError: {
    flexShrink: 0, fontSize: '10px', fontWeight: 700,
    color: 'var(--danger-color)',
  },
  metaWarn: {
    flexShrink: 0, fontSize: '10px', fontWeight: 700,
    color: 'var(--warning-color)',
  },
  actionButton: {
    height: '24px', padding: '0 6px', borderRadius: '4px',
    border: '1px solid transparent', backgroundColor: 'transparent',
    color: 'var(--text-muted)', fontSize: '10px', fontWeight: 800, cursor: 'pointer',
  },
  editorBody: {
    flex: 1, minHeight: 0, overflow: 'auto',
    fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.55,
    cursor: 'text', userSelect: 'text', backgroundColor: 'var(--surface-color)',
  },
  codeLine: {
    display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)',
    minHeight: '18px', position: 'relative',
  },
  codeLineDiag: {
    backgroundColor: 'rgba(255, 0, 0, 0.04)',
  },
  codeLineNumber: {
    paddingRight: '8px', color: 'var(--text-dark)', textAlign: 'right',
    userSelect: 'none', borderRight: '1px solid transparent',
  },
  codeLineContent: {
    padding: '0 8px 0 10px', whiteSpace: 'pre',
    color: 'var(--text-muted)', border: 'none', borderRadius: 0,
    backgroundColor: 'transparent', cursor: 'text', userSelect: 'text',
    position: 'relative',
  },
  codeKeyword: { color: 'var(--info-color)', fontWeight: 800 },
  codeString: { color: 'var(--success-color)' },
  codeComment: { color: 'var(--text-dark)', fontStyle: 'italic' },
  codeNumber: { color: 'var(--warning-color)' },
  // Diagnostic wavy underline
  diagUnderline: {
    position: 'absolute', bottom: 0, height: '2px',
    backgroundImage: 'repeating-linear-gradient(90deg, currentColor, currentColor 2px, transparent 2px, transparent 4px)',
    pointerEvents: 'none',
  },
  diagUnderlineError: { color: 'var(--danger-color)' },
  diagUnderlineWarning: { color: 'var(--warning-color)' },
  diagUnderlineInfo: { color: 'var(--info-color)' },
  // Hover tooltip
  hoverTooltip: {
    position: 'fixed', zIndex: 10000,
    maxWidth: '400px', backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--border-color)', borderRadius: '6px',
    padding: '8px 10px', fontSize: '11px', lineHeight: 1.45,
    color: 'var(--text-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  textarea: {
    width: '100%', height: '100%', border: 'none', borderRadius: 0,
    backgroundColor: 'transparent', color: 'var(--text-color)',
    fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.55,
    padding: '10px', outline: 'none', resize: 'none',
  },
  empty: {
    textAlign: 'center', padding: '24px', color: 'var(--text-dark)', fontSize: '12px',
  },
  lspBadge: {
    fontSize: '9px', fontWeight: 700, padding: '0 4px', borderRadius: '3px',
    border: '1px solid',
  },
  lspBadgeActive: {
    color: 'var(--success-color)', borderColor: 'var(--success-color)',
  },
  lspBadgeInactive: {
    color: 'var(--text-dark)', borderColor: 'var(--text-dark)',
  },
};

// ── DiagnosticTooltip ──────────────────────────────────────────────────────

function DiagnosticTooltip({ diagnostic, anchorRect }) {
  if (!diagnostic || !anchorRect) {return null;}
  return (
    <div style={{
      ...fileStyles.hoverTooltip,
      left: Math.min(anchorRect.right + 6, window.innerWidth - 412),
      top: Math.min(anchorRect.bottom + 2, window.innerHeight - 120),
    }}>
      <div style={{ fontWeight: 800, marginBottom: 2, color: diagnostic.severity === 1 ? 'var(--danger-color)' : 'var(--warning-color)' }}>
        {diagnostic.severity === 1 ? '🔴 Error' : diagnostic.severity === 2 ? '🟡 Warning' : 'ℹ️ Info'}
        {diagnostic.code ? ` [${diagnostic.code}]` : ''}
      </div>
      <div>{diagnostic.message}</div>
      {diagnostic.source && <div style={{ color: 'var(--text-dark)', marginTop: 4, fontSize: 10 }}>source: {diagnostic.source}</div>}
    </div>
  );
}

// ── CodePreview with LSP integration ───────────────────────────────────────

function CodePreview({ openFile, useLSP }) {
  const content = openFile?.content || '';
  const filePath = openFile?.path || '';
  const lines = content.split('\n');

  // LSP state
  const [semanticPerLine, setSemanticPerLine] = useState(null);
  const [diagnostics, setDiagnostics] = useState([]);
  const [hoveredDiag, setHoveredDiag] = useState(null);
  const [hoveredAnchor, setHoveredAnchor] = useState(null);
  const [lspLoaded, setLspLoaded] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [warnCount, setWarnCount] = useState(0);

  // Refs to avoid re-entry
  const syncedRef = useRef(null);

  // Fetch LSP data when file changes
  useEffect(() => {
    if (!useLSP || !filePath || !window.electronAPI) {
      setLspLoaded(false);
      setSemanticPerLine(null);
      setDiagnostics([]);
      setErrorCount(0);
      setWarnCount(0);
      return;
    }

    let cancelled = false;
    const api = window.electronAPI;

    async function fetchLSP() {
      try {
        // Sync document to LSP
        await api.syncLSPDocument(filePath, content);
        if (cancelled) {return;}

        // Fetch semantic tokens for highlighting
        const tokenResult = await api.getLSPSemanticTokens(filePath);
        if (!cancelled && tokenResult?.success && tokenResult.tokens) {
          const decoded = decodeSemanticTokens(
            tokenResult.tokens,
            lines,
            tokenResult.tokens.legend || { tokenTypes: [] }
          );
          setSemanticPerLine(decoded);
        } else {
          setSemanticPerLine(null);
        }

        // Fetch diagnostics
        const diagResult = await api.getLSPDiagnostics(filePath);
        if (!cancelled && diagResult?.success) {
          const diags = diagResult.diagnostics || [];
          setDiagnostics(diags);
          setErrorCount(diags.filter(d => d.severity === 1).length);
          setWarnCount(diags.filter(d => d.severity === 2).length);
        }

        setLspLoaded(true);
      } catch {
        if (!cancelled) {
          setLspLoaded(false);
        }
      }
    }

    fetchLSP();
    syncedRef.current = filePath;

    return () => { cancelled = true; };
  }, [filePath, content, useLSP, lines]);

  // Map diagnostics to line ranges for underline rendering
  const diagByLine = {};
  const diagById = {};
  for (const d of diagnostics) {
    const startLine = d.range?.start?.line ?? 0;
    if (!diagByLine[startLine]) {diagByLine[startLine] = [];}
    diagByLine[startLine].push(d);
    diagById[`${startLine}:${d.range?.start?.character ?? 0}`] = d;
  }

  // Use LSP semantic tokens if available, otherwise fallback to regex
  const shouldUseLSPSemantics = semanticPerLine !== null;

  return (
    <div style={fileStyles.editorBody} className="lsp-code-preview">
      {lines.map((lineText, lineIdx) => {
        // Determine segments
        let segments;
        if (shouldUseLSPSemantics) {
          segments = applySemanticSegments(lineText, semanticPerLine[lineIdx] || []);
        } else {
          segments = splitCodeLineRegex(lineText);
        }

        // Diagnostic underlines for this line
        const lineDiags = diagByLine[lineIdx] || [];
        const hasError = lineDiags.some(d => d.severity === 1);
        const hasWarning = lineDiags.some(d => d.severity === 2);

        return (
          <div
            key={`${lineIdx}_${lineText.slice(0, 16)}`}
            style={{
              ...fileStyles.codeLine,
              ...(hasError ? fileStyles.codeLineDiag : {}),
            }}
          >
            <span style={fileStyles.codeLineNumber}>
              {hasError ? '●' : hasWarning ? '●' : ''}
              <span style={{ opacity: hasError || hasWarning ? 1 : undefined, color: hasError ? 'var(--danger-color)' : hasWarning ? 'var(--warning-color)' : undefined }}>
                {hasError || hasWarning ? '' : lineIdx + 1}
              </span>
            </span>
            <code style={fileStyles.codeLineContent}>
              {segments.map((seg, segIdx) => (
                <span key={`${segIdx}_${seg.text}`} style={getCodeTokenStyle(seg.type, fileStyles)}>
                  {seg.text}
                </span>
              ))}
              {/* Diagnostic wavy underlines */}
              {lineDiags.map((d, dIdx) => (
                <span
                  key={dIdx}
                  style={{
                    ...fileStyles.diagUnderline,
                    ...(d.severity === 1 ? fileStyles.diagUnderlineError : d.severity === 2 ? fileStyles.diagUnderlineWarning : fileStyles.diagUnderlineInfo),
                    left: `${(d.range?.start?.character ?? 0) * 6.6}px`,
                    width: `${Math.max(((d.range?.end?.character ?? 0) - (d.range?.start?.character ?? 0)) * 6.6, 20)}px`,
                  }}
                  title={d.message}
                  onMouseEnter={(e) => {
                    setHoveredDiag(d);
                    setHoveredAnchor(e.currentTarget.getBoundingClientRect());
                  }}
                  onMouseLeave={() => {
                    setHoveredDiag(null);
                    setHoveredAnchor(null);
                  }}
                />
              ))}
            </code>
          </div>
        );
      })}
      {hoveredDiag && <DiagnosticTooltip diagnostic={hoveredDiag} anchorRect={hoveredAnchor} />}
    </div>
  );
}

// ── EditorTextarea ─────────────────────────────────────────────────────────

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

// ── FileWorkbench (main export) ────────────────────────────────────────────

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
  const [lspAvailable, setLspAvailable] = useState(false);

  if (!openFile) {return null;}

  const isDirty = fileDraft !== openFile.content;
  const language = getFileLanguage(openFile.path);
  const isLoading = fileStatus === 'loading';
  const isSaving = fileStatus === 'saving';

  // Check LSP availability on mount/file change
  useEffect(() => {
    if (!window.electronAPI) {
      setLspAvailable(false);
      return;
    }
    window.electronAPI.getLSPSupportedLanguages().then(result => {
      if (result?.success && result.languages?.length > 0) {
        // Check if the current file's language is in the supported list
        const ext = openFile.path?.split('.').pop()?.toLowerCase();
        const langMap = {
          ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
          mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
          py: 'python', pyi: 'python', rs: 'rust', go: 'go',
        };
        const langId = langMap[ext];
        setLspAvailable(!!langId && result.languages.includes(langId));
      } else {
        setLspAvailable(false);
      }
    }).catch(() => setLspAvailable(false));
  }, [openFile?.path]);

  return (
    <div style={fileStyles.workbench}>
      <div style={fileStyles.header}>
        <span style={fileStyles.title} title={openFile.path}>
          {openFile.name || openFile.path}
        </span>
        <span style={fileStyles.meta}>{language}</span>
        {lspAvailable && (
          <span style={{ ...fileStyles.lspBadge, ...fileStyles.lspBadgeActive }}>LSP</span>
        )}
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
      {!isLoading && fileStatus !== 'error' && fileMode === 'preview' && (
        <CodePreview openFile={openFile} useLSP={lspAvailable} />
      )}
      {!isLoading && fileStatus !== 'error' && fileMode === 'edit' && (
        <EditorTextarea value={fileDraft} onChange={onDraftChange} />
      )}
    </div>
  );
}
