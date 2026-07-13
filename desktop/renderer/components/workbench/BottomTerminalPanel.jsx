import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useIPC } from '../../hooks/useIPC.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const promptForDirectory = (workingDirectory) => {
  if (!workingDirectory) { return '~'; }
  const normalized = workingDirectory.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).slice(-1)[0] || '~';
};

const INITIAL_LINES = [
  { type: 'system', text: 'Mastery Terminal' },
  { type: 'blank', text: '' },
];

/* ── ANSI → 内联 style 映射 ── */
const ANSI_CODES = {
  '0':  { color: 'var(--ds-text-primary)', fontWeight: 400, textDecoration: 'none', fontStyle: 'normal', opacity: 1 },
  '1':  { fontWeight: 700 },
  '2':  { opacity: 0.55 },
  '3':  { fontStyle: 'italic' },
  '4':  { textDecoration: 'underline' },
  '7':  { color: '#E8F0F0', background: '#B0BDBD' },
  '30': { color: '#3C3C3C' },
  '31': { color: '#E88A9A' },
  '32': { color: '#7BD3B8' },
  '33': { color: '#E8C46A' },
  '34': { color: '#7FB8D9' },
  '35': { color: '#C9A0DC' },
  '36': { color: '#5CC4BE' },
  '37': { color: '#D4D4D4' },
  '90': { color: '#6E7681' },
  '91': { color: '#F47067' },
  '92': { color: '#57AB5A' },
  '93': { color: '#C69026' },
  '94': { color: '#539BF5' },
  '95': { color: '#B083F0' },
  '96': { color: '#39D2C0' },
  '97': { color: '#ADBAC7' },
};

function parseAnsi(text) {
  const parts = [];
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentStyle = { ...ANSI_CODES['0'] };
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), style: { ...currentStyle } });
    }
    const codes = match[1].split(';').filter(Boolean);
    for (const code of codes) {
      if (code === '0') {
        currentStyle = { ...ANSI_CODES['0'] };
      } else if (ANSI_CODES[code]) {
        currentStyle = { ...currentStyle, ...ANSI_CODES[code] };
      }
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), style: { ...currentStyle } });
  }

  return parts.length > 0 ? parts : [{ text, style: { ...ANSI_CODES['0'] } }];
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function isUrl(text) {
  return /^https?:\/\//i.test(text);
}

function renderAnsiLine(text, baseStyle) {
  const parts = parseAnsi(text);
  return (
    <span style={baseStyle}>
      {parts.map((part, i) => (
        <span key={i} style={part.style}>{part.text}</span>
      ))}
    </span>
  );
}

async function createCommandOutput(command, workingDirectory, ipcInvoke) {
  const normalized = command.trim();
  if (!normalized) { return []; }

  try {
    const result = await ipcInvoke('terminal:execute', {
      command: normalized,
      cwd: workingDirectory,
    });

    const output = [];
    if (result.stdout) {
      output.push({ text: result.stdout, isError: false, raw: true });
    }
    if (result.stderr) {
      output.push({ text: result.stderr, isError: true, raw: true });
    }
    if (!result.stdout && !result.stderr) {
      return [];
    }
    return output;
  } catch (error) {
    return [{ text: `${normalized}: ${error.message || 'Execution error'}`, isError: true }];
  }
}

/* ── 终端行渲染 ── */
function TerminalLine({ line }) {
  if (line.type === 'blank') {
    return <div style={styles.lineRow}><span style={styles.lineEmpty}>&nbsp;</span></div>;
  }

  const colorMap = {
    command: 'var(--ds-text-primary)',
    error: 'var(--ds-status-error)',
    muted: 'var(--ds-text-tertiary)',
    system: 'var(--ds-brand)',
    success: 'var(--ds-status-success)',
    output: 'var(--ds-text-secondary)',
  };
  const color = colorMap[line.type] || 'var(--ds-text-primary)';
  const isCommand = line.type === 'command';

  const baseTextStyle = {
    color,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    minWidth: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.55',
    cursor: 'text',
    userSelect: 'text',
  };

  return (
    <div style={{
      ...styles.lineRow,
      ...(isCommand ? styles.lineRowCommand : {})
    }}>
      {line.raw ? (
        <span style={baseTextStyle}>
          {line.text.split('\n').map((seg, i) => {
            if (!seg) return null;
            return <span key={i}>{renderAnsiLine(seg, {})}{'\n'}</span>;
          })}
        </span>
      ) : (
        <span style={baseTextStyle}>{line.text}</span>
      )}
    </div>
  );
}

/* ── 图标组件（内联 SVG，避免外部依赖） ── */
function TermIcon({ name, size = 14 }) {
  const icons = {
    trash: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 5.5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M12.5 5.5v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-8"/><path d="M3.5 5.5h9"/><line x1="6.5" y1="8" x2="6.5" y2="12"/><line x1="9.5" y1="8" x2="9.5" y2="12"/></svg>,
    minimize: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="3" y1="8" x2="13" y2="8"/></svg>,
    close: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>,
    terminal: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,5 7,8 4,11"/><line x1="8" y1="11" x2="12" y2="11"/></svg>,
    warn: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3L2 13h12L8 3z"/><line x1="8" y1="7" x2="8" y2="9.5"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/></svg>,
    info: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="5" r="0.5" fill="currentColor"/></svg>,
    copy: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 0 1 1.5-1.5H11"/></svg>,
    maxH: <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>,
  };
  return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icons[name] || null}</span>;
}

export function BottomTerminalPanel({
  activeTab,
  isOpen,
  height,
  workingDirectory,
  onActiveTabChange,
  onClose,
  onHeightChange,
  onOpenChange,
}) {
  const ipc = useIPC();
  const [lines, setLines] = useState(INITIAL_LINES);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentDirectory, setCurrentDirectory] = useState(workingDirectory || '.');
  const [completionOptions, setCompletionOptions] = useState([]);
  const [completionIndex, setCompletionIndex] = useState(-1);
  const terminalBodyRef = useRef(null);
  const inputRef = useRef(null);
  const resizeStateRef = useRef(null);
  const promptLabel = promptForDirectory(currentDirectory);

  const problems = useMemo(() => {
    const items = [];
    if (!ipc.isConnected) {
      items.push({ level: 'warning', file: 'transport', text: 'IPC disconnected; commands unavailable in browser preview.' });
    }
    return items;
  }, [ipc.isConnected]);

  const outputLines = useMemo(() => ([
    `workspace: ${workingDirectory || 'not selected'}`,
    `panel: ${isOpen ? `${height}px` : 'collapsed'}`,
    `buffer: ${lines.length} events`,
  ]), [height, isOpen, lines.length, workingDirectory]);

  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [lines, activeTab, isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'terminal') {
      inputRef.current?.focus();
    }
  }, [activeTab, isOpen]);

  useEffect(() => {
    if (workingDirectory) {
      setCurrentDirectory(workingDirectory);
    }
  }, [workingDirectory]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) { return; }
      const delta = resizeState.startY - event.clientY;
      onHeightChange(clamp(resizeState.startHeight + delta, 160, 560));
    };
    const handlePointerUp = () => {
      if (!resizeStateRef.current) { return; }
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onHeightChange]);

  const getCommandCompletions = async (partialCommand) => {
    try {
      const result = await ipc.invoke('terminal:complete', { command: partialCommand, cwd: currentDirectory });
      return result.completions || [];
    } catch {
      return [];
    }
  };

  const streamCommandOutput = async (command) => {
    if (command.trim() === 'clear') {
      setLines([]);
      return;
    }

    setIsStreaming(true);
    const output = await createCommandOutput(command, currentDirectory, ipc.invoke);
    for (const item of output) {
      await new Promise(resolve => setTimeout(resolve, 30));
      const textLines = item.text.split('\n');
      for (const tl of textLines) {
        if (tl) {
          setLines(prev => [...prev, { type: item.isError ? 'error' : 'output', text: tl, raw: item.raw }]);
        }
      }
    }
    setLines(prev => [...prev, { type: 'blank', text: '' }]);
    setIsStreaming(false);

    if (command.trim().startsWith('cd ')) {
      const newPath = command.trim().substring(3).trim();
      if (newPath) {
        try {
          const resolvedPath = await ipc.invoke('terminal:resolvePath', { path: newPath, cwd: currentDirectory });
          if (resolvedPath && resolvedPath.exists) {
            setCurrentDirectory(resolvedPath.path);
          }
        } catch { /* ignore */ }
      }
    }

    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = useCallback(async (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (event.key === 'Escape') {
      setInput('');
      setHistoryIndex(-1);
      setCompletionOptions([]);
      setCompletionIndex(-1);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (completionOptions.length > 0) {
        const newIndex = (completionIndex + 1) % completionOptions.length;
        setCompletionIndex(newIndex);
        const parts = input.split(' ');
        const completion = completionOptions[newIndex];
        if (parts.length === 1) {
          setInput(completion);
        } else {
          parts[parts.length - 1] = completion;
          setInput(parts.join(' '));
        }
      } else {
        const completions = await getCommandCompletions(input);
        if (completions.length > 0) {
          setCompletionOptions(completions);
          setCompletionIndex(0);
          const parts = input.split(' ');
          const completion = completions[0];
          if (parts.length === 1) { setInput(completion); }
          else { parts[parts.length - 1] = completion; setInput(parts.join(' ')); }
        }
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = input.trim();
      if (!command || isStreaming) { return; }
      setLines(prev => [...prev, { type: 'command', text: `${promptLabel} $ ${command}` }]);
      setCommandHistory(prev => [...prev, command]);
      setHistoryIndex(-1);
      setCompletionOptions([]);
      setCompletionIndex(-1);
      setInput('');
      streamCommandOutput(command);
    } else {
      setCompletionOptions([]);
      setCompletionIndex(-1);
    }
  }, [commandHistory, historyIndex, input, isStreaming, promptLabel, streamCommandOutput, completionOptions, completionIndex, getCommandCompletions]);

  const handleResizeStart = (event) => {
    event.preventDefault();
    resizeStateRef.current = { startY: event.clientY, startHeight: height };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const tabs = [
    { id: 'terminal', icon: 'terminal', label: promptForDirectory(workingDirectory), meta: isStreaming ? 'run' : '' },
    { id: 'problems', icon: 'warn', label: '问题', meta: problems.length ? String(problems.length) : '' },
    { id: 'output', icon: 'info', label: '输出', meta: '' },
  ];

  const handleClear = () => { setLines([]); };

  if (!isOpen) { return null; }

  return (
    <section style={{ ...styles.panel, height }} aria-label="Bottom terminal panel">
      {/* resize 拖拽条 */}
      <div style={styles.resizeHandle} onPointerDown={handleResizeStart} />

      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.tabs} role="tablist">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                style={{
                  ...styles.tab,
                  ...(activeTab === tab.id ? styles.tabActive : {})
                }}
                onClick={() => onActiveTabChange(tab.id)}
              >
                <TermIcon name={tab.icon} size={12} />
                <span>{tab.label}</span>
                {tab.meta && (
                  <span style={styles.tabMeta}>{tab.meta}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.headerRight}>
          <button type="button" style={styles.headerBtn} title="Clear" onClick={handleClear}>
            <TermIcon name="trash" size={12} />
          </button>
          <button type="button" style={styles.headerBtn} title="Maximize" onClick={() => onHeightChange(560)}>
            <TermIcon name="maxH" size={12} />
          </button>
          <button type="button" style={styles.headerBtn} title="Minimize" onClick={() => onOpenChange(false)}>
            <TermIcon name="minimize" size={12} />
          </button>
          <div style={styles.headerSep} />
          <button type="button" style={styles.headerBtnClose} title="Close" onClick={onClose}>
            <TermIcon name="close" size={12} />
          </button>
        </div>
      </div>

      {/* Terminal 标签页 */}
      {activeTab === 'terminal' && (
        <div style={styles.terminalSurface} onClick={() => inputRef.current?.focus()}>
          <div ref={terminalBodyRef} style={styles.terminalBody}>
            {lines.map((line, index) => (
              <TerminalLine key={`${index}-${line.type}`} line={line} />
            ))}
            {isStreaming && (
              <div style={styles.lineRow}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--ds-brand)',
                  animation: 'termBlink 1s step-end infinite'
                }}>{'\u2588'}</span>
              </div>
            )}
          </div>

          {/* 输入行 */}
          <div style={styles.inputRow}>
            <span style={styles.promptSymbol}>{'\u203A'}</span>
            <span style={styles.prompt}>{promptLabel}</span>
            <input
              ref={inputRef}
              value={input}
              disabled={isStreaming}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              style={styles.terminalInput}
              aria-label="Terminal command"
              autoComplete="off"
              spellCheck={false}
              placeholder=""
            />
            {completionOptions.length > 0 && (
              <div style={styles.completionPopup}>
                {completionOptions.map((opt, i) => (
                  <div
                    key={opt}
                    style={{
                      ...styles.completionItem,
                      ...(i === completionIndex ? styles.completionItemActive : {})
                    }}
                  >{opt}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Problems 标签页 */}
      {activeTab === 'problems' && (
        <div style={styles.listSurface}>
          {problems.length === 0 ? (
            <div style={styles.emptyList}>
              <TermIcon name="info" size={16} />
              <span>No problems detected.</span>
            </div>
          ) : (
            problems.map(problem => (
              <div key={`${problem.file}-${problem.text}`} style={styles.problemRow}>
                <span style={{
                  ...styles.problemBadge,
                  ...(problem.level === 'warning' ? styles.problemWarning : styles.problemInfo)
                }}>
                  {problem.level === 'warning' ? 'W' : 'I'}
                </span>
                <div style={styles.problemCopy}>
                  <span style={styles.problemFile}>{problem.file}</span>
                  <span style={styles.problemText}>{problem.text}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Output 标签页 */}
      {activeTab === 'output' && (
        <div style={styles.outputSurface}>
          {outputLines.map((line, index) => (
            <div key={`${line}-${index}`} style={styles.outputLine}>{line}</div>
          ))}
        </div>
      )}

      {/* 动画 keyframes */}
      <style>{`
        @keyframes termBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </section>
  );
}

/* ═══════════════════════════════════════════
   样式 — 对齐 TRAE Work 设计系统
   ═══════════════════════════════════════════ */
const styles = {
  panel: {
    flexShrink: 0,
    minHeight: '160px',
    maxHeight: '560px',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    borderTop: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-default)',
    boxShadow: '0 -1px 0 var(--ds-border-l1)',
  },

  resizeHandle: {
    position: 'absolute',
    top: '-3px',
    left: 0,
    right: 0,
    height: '6px',
    cursor: 'row-resize',
    zIndex: 3,
    backgroundColor: 'transparent',
  },

  /* ── 头部 ── */
  header: {
    minHeight: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
    padding: '0 6px',
    borderBottom: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-raised)',
    flexShrink: 0,
  },

  headerLeft: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flex: 1,
    overflow: 'hidden',
  },

  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    minWidth: 0,
    padding: '2px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--ds-bg-overlay-l1)',
    border: 'none',
  },

  tab: {
    height: '24px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--ds-text-tertiary)',
    padding: '0 8px',
    fontSize: '11px',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontFamily: 'var(--font-family)',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    whiteSpace: 'nowrap',
  },

  tabActive: {
    color: 'var(--ds-text-primary)',
    backgroundColor: 'var(--ds-bg-raised)',
    boxShadow: 'var(--shadow-sm)',
  },

  tabMeta: {
    minWidth: '16px',
    height: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--ds-status-warning-s1)',
    color: 'var(--ds-status-warning)',
    fontSize: '9px',
    fontWeight: 700,
    lineHeight: 1,
  },

  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
    flexShrink: 0,
  },

  headerBtn: {
    width: '24px',
    height: '24px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--ds-text-tertiary)',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.1s ease',
  },

  headerBtnClose: {
    width: '24px',
    height: '24px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--ds-text-tertiary)',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.1s ease',
  },

  headerSep: {
    width: '1px',
    height: '14px',
    backgroundColor: 'var(--ds-border-l1)',
    margin: '0 3px',
  },

  /* ── 终端主体 ── */
  terminalSurface: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--ds-bg-default)',
    overflow: 'hidden',
    position: 'relative',
  },

  terminalBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 0',
    fontFamily: 'var(--font-mono)',
    cursor: 'text',
    userSelect: 'text',
  },

  lineRow: {
    minHeight: '18px',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
  },

  lineRowCommand: {
    backgroundColor: 'rgba(47, 143, 128, 0.04)',
  },

  lineEmpty: {
    display: 'block',
    minHeight: '18px',
  },

  /* ── 输入行 ── */
  inputRow: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    minHeight: '28px',
    padding: '3px 10px 6px',
    backgroundColor: 'var(--ds-bg-default)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    position: 'relative',
    borderTop: '1px solid var(--ds-border-l1)',
  },

  promptSymbol: {
    color: 'var(--ds-brand)',
    fontSize: '14px',
    fontWeight: 700,
    marginRight: '4px',
    lineHeight: 1,
  },

  prompt: {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'var(--ds-text-tertiary)',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-mono)',
    marginRight: '6px',
    letterSpacing: '0.02em',
  },

  terminalInput: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    boxShadow: 'none',
    padding: 0,
    color: 'var(--ds-text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    outline: 'none',
    lineHeight: '1.55',
    caretColor: 'var(--ds-brand)',
  },

  /* ── 补全弹出 ── */
  completionPopup: {
    position: 'absolute',
    bottom: '100%',
    left: '10px',
    right: '10px',
    backgroundColor: 'var(--ds-bg-raised)',
    border: '1px solid var(--ds-border-l2)',
    borderRadius: 'var(--radius-md)',
    padding: '4px',
    maxHeight: '120px',
    overflowY: 'auto',
    boxShadow: 'var(--shadow-md)',
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },

  completionItem: {
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--ds-text-secondary)',
    cursor: 'pointer',
  },

  completionItemActive: {
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
  },

  /* ── 列表（Problems / Output） ── */
  listSurface: {
    flex: 1,
    overflowY: 'auto',
    padding: '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    backgroundColor: 'var(--ds-bg-default)',
  },

  emptyList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    color: 'var(--ds-text-tertiary)',
    fontSize: '11px',
  },

  problemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 6px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    backgroundColor: 'transparent',
    transition: 'background-color 0.1s ease',
    cursor: 'default',
  },

  problemBadge: {
    flexShrink: 0,
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    fontSize: '10px',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
  },

  problemWarning: {
    color: 'var(--ds-status-warning)',
    backgroundColor: 'var(--ds-status-warning-s1)',
  },

  problemInfo: {
    color: 'var(--ds-brand)',
    backgroundColor: 'var(--ds-brand-soft)',
  },

  problemCopy: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },

  problemFile: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--ds-text-primary)',
  },

  problemText: {
    fontSize: '11px',
    color: 'var(--ds-text-tertiary)',
    lineHeight: 1.4,
  },

  outputSurface: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--ds-text-tertiary)',
    backgroundColor: 'var(--ds-bg-default)',
    lineHeight: 1.5,
  },

  outputLine: {
    minHeight: '17px',
    whiteSpace: 'pre-wrap',
  },
};
