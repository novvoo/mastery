import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useIPC } from '../../hooks/useIPC.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const promptForDirectory = (workingDirectory) => {
  if (!workingDirectory) return 'workspace';
  const normalized = workingDirectory.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).slice(-1)[0] || normalized;
};

const INITIAL_LINES = [
  { type: 'system', text: 'Mastery Terminal v1.0.0' },
  { type: 'blank', text: '' },
];

async function createCommandOutput(command, workingDirectory, ipcInvoke) {
  const normalized = command.trim();
  if (!normalized) return [];
  
  try {
    const result = await ipcInvoke('terminal:execute', {
      command: normalized,
      cwd: workingDirectory,
    });
    
    const output = [];
    if (result.stdout) {
      const stdoutLines = result.stdout.trim().split('\n');
      stdoutLines.forEach(line => {
        if (line) output.push({ text: line, isError: false });
      });
    }
    if (result.stderr) {
      const stderrLines = result.stderr.trim().split('\n');
      stderrLines.forEach(line => {
        if (line) output.push({ text: line, isError: true });
      });
    }
    if (!result.stdout && !result.stderr) {
      return [];
    }
    return output;
  } catch (error) {
    return [{ text: `${normalized}: ${error.message || 'Execution error'}`, isError: true }];
  }
}

function TerminalLine({ line }) {
  const color = line.type === 'command'
    ? '#E8F0F0'
    : line.type === 'error'
      ? '#E88A9A'
      : line.type === 'muted'
        ? '#8A9696'
        : line.type === 'system'
          ? '#7FB8D9'
          : line.type === 'success'
            ? '#7BD3B8'
            : '#E8F0F0';

  if (line.type === 'blank') {
    return <div style={styles.lineRow}>&nbsp;</div>;
  }

  return (
    <div style={styles.lineRow}>
      <span style={{
        minHeight: '19px',
        color,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        minWidth: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        lineHeight: '1.5',
      }}>
        {line.text}
      </span>
    </div>
  );
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
  const [showCursor, setShowCursor] = useState(true);
  const terminalBodyRef = useRef(null);
  const inputRef = useRef(null);
  const resizeStateRef = useRef(null);
  const promptLabel = promptForDirectory(workingDirectory);

  const problems = useMemo(() => ([
    { level: 'warning', file: 'desktop/renderer/App.jsx', text: 'Terminal transport is mocked until PTY IPC is connected.' },
    { level: 'info', file: 'terminal session', text: 'stdout/stderr are mirrored into the AI context buffer.' },
  ]), []);

  const outputLines = useMemo(() => ([
    'Architecture:',
    'UI drawer -> terminal emulator -> terminal transport -> shell/container',
    '',
    `Workspace: ${workingDirectory || 'not selected'}`,
    `Panel: ${isOpen ? `${height}px` : 'collapsed'}`,
    `Context buffer: ${lines.length} terminal events captured`,
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
    const cursorInterval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530);
    return () => clearInterval(cursorInterval);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const delta = resizeState.startY - event.clientY;
      onHeightChange(clamp(resizeState.startHeight + delta, 180, 520));
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) return;
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

  const streamCommandOutput = async (command) => {
    if (command.trim() === 'clear') {
      setLines([]);
      return;
    }

    setIsStreaming(true);
    const output = await createCommandOutput(command, workingDirectory, ipc.invoke);
    for (const item of output) {
      await new Promise(resolve => setTimeout(resolve, 40));
      setLines(prev => [...prev, { type: item.isError ? 'error' : 'output', text: item.text }]);
    }
    setIsStreaming(false);
  };

  const handleKeyDown = useCallback((event) => {
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
    } else if (event.key === 'Tab') {
      event.preventDefault();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = input.trim();
      if (!command || isStreaming) return;
      setLines(prev => [...prev, { type: 'command', text: `${promptLabel} $ ${command}` }]);
      setCommandHistory(prev => [...prev, command]);
      setHistoryIndex(-1);
      setInput('');
      streamCommandOutput(command);
    }
  }, [commandHistory, historyIndex, input, isStreaming, promptLabel, streamCommandOutput]);

  const handleResizeStart = (event) => {
    event.preventDefault();
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: height,
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const tabs = [
    { id: 'terminal', label: 'Terminal', meta: isStreaming ? 'run' : '' },
    { id: 'problems', label: 'Problems', meta: String(problems.length) },
    { id: 'output', label: 'Output', meta: '' },
  ];

  const handleClear = () => {
    setLines([]);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <section style={{ ...styles.panel, height }} aria-label="Bottom terminal panel">
      <div style={styles.resizeHandle} onPointerDown={handleResizeStart} />
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
                <span>{tab.label}</span>
                {tab.meta && (
                  <span style={{
                    ...styles.tabMeta,
                    ...(activeTab === tab.id ? styles.tabMetaActive : {})
                  }}>{tab.meta}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.headerMeta}>
          <button type="button" style={styles.iconButton} title="Clear terminal" onClick={handleClear}>
            C
          </button>
          <button type="button" style={styles.iconButton} title="Collapse terminal" onClick={() => onOpenChange(false)}>
            _
          </button>
          <button type="button" style={styles.iconButton} title="Close terminal" onClick={onClose}>
            x
          </button>
        </div>
      </div>

      {activeTab === 'terminal' && (
        <div style={styles.terminalSurface} onClick={() => inputRef.current?.focus()}>
          <div ref={terminalBodyRef} style={styles.terminalBody}>
            {lines.map((line, index) => (
              <TerminalLine key={`${line.type}-${index}-${line.text}`} line={line} />
            ))}
            {isStreaming && <TerminalLine line={{ type: 'muted', text: '\u2588' }} />}
          </div>
          <div style={styles.inputRow}>
            <span style={styles.prompt}>{promptLabel} $ </span>
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
          </div>
        </div>
      )}

      {activeTab === 'problems' && (
        <div style={styles.listSurface}>
          {problems.map(problem => (
            <div key={`${problem.file}-${problem.text}`} style={styles.problemRow}>
              <span style={{
                ...styles.problemBadge,
                ...(problem.level === 'warning' ? styles.problemWarning : styles.problemInfo)
              }}>
                {problem.level}
              </span>
              <div style={styles.problemCopy}>
                <strong>{problem.file}</strong>
                <span>{problem.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'output' && (
        <div style={styles.outputSurface}>
          {outputLines.map((line, index) => (
            <div key={`${line}-${index}`} style={styles.outputLine}>{line}</div>
          ))}
        </div>
      )}
    </section>
  );
}

const styles = {
  panel: {
    flexShrink: 0,
    minHeight: '180px',
    maxHeight: '520px',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    borderTop: '1px solid rgba(0, 0, 0, 0.5)',
    backgroundColor: '#0D1117',
    boxShadow: 'none',
  },
  resizeHandle: {
    position: 'absolute',
    top: '-4px',
    left: 0,
    right: 0,
    height: '8px',
    cursor: 'row-resize',
    zIndex: 3,
    backgroundColor: 'transparent',
  },
  header: {
    minHeight: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 8px',
    borderBottom: '1px solid rgba(0, 0, 0, 0.5)',
    backgroundColor: '#161B22',
  },
  headerLeft: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
    minWidth: 0,
    padding: 0,
    borderRadius: 0,
    border: 'none',
    backgroundColor: 'transparent',
  },
  tab: {
    height: '32px',
    borderRadius: 0,
    border: 'none',
    borderRight: '1px solid rgba(0, 0, 0, 0.3)',
    backgroundColor: '#161B22',
    color: '#8B949E',
    padding: '0 12px',
    fontSize: '11px',
    fontWeight: 400,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
  },
  tabActive: {
    color: '#E6EDF3',
    backgroundColor: '#0D1117',
  },
  tabMeta: {
    minWidth: '18px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    borderRadius: '3px',
    backgroundColor: 'rgba(240, 147, 25, 0.15)',
    color: '#F0931B',
    fontSize: '10px',
    fontWeight: 600,
  },
  tabMetaActive: {
    backgroundColor: 'rgba(240, 147, 25, 0.2)',
    color: '#F0931B',
  },
  headerMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2px',
    minWidth: 0,
    color: '#8B949E',
    fontSize: '11px',
    whiteSpace: 'nowrap',
  },
  iconButton: {
    width: '24px',
    height: '24px',
    borderRadius: '3px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: '#8B949E',
    padding: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  terminalSurface: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0D1117',
    overflowY: 'auto',
  },
  terminalBody: {
    padding: '8px 0',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '13px',
    lineHeight: 1.4,
  },
  lineRow: {
    minHeight: '18px',
    padding: '0 12px',
  },
  inputRow: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    minHeight: '28px',
    padding: '4px 12px',
    backgroundColor: '#0D1117',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '13px',
  },
  prompt: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    color: '#58A6FF',
    fontSize: '13px',
    fontWeight: 400,
    whiteSpace: 'nowrap',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
  },
  inputContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  },
  terminalInput: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    boxShadow: 'none',
    padding: '0',
    color: '#E6EDF3',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '13px',
    outline: 'none',
  },
  listSurface: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    backgroundColor: '#0D1117',
  },
  problemRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '6px 0',
    borderRadius: 0,
    border: 'none',
    borderBottom: '1px solid rgba(0, 0, 0, 0.3)',
    backgroundColor: 'transparent',
  },
  problemBadge: {
    flexShrink: 0,
    minWidth: '50px',
    textAlign: 'center',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    fontFamily: 'var(--font-mono)',
  },
  problemWarning: {
    color: '#F0883E',
    backgroundColor: 'rgba(240, 136, 62, 0.1)',
  },
  problemInfo: {
    color: '#58A6FF',
    backgroundColor: 'rgba(88, 166, 255, 0.1)',
  },
  problemCopy: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    color: '#8B949E',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
  },
  outputSurface: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '12px',
    color: '#8B949E',
    backgroundColor: '#0D1117',
  },
  outputLine: {
    minHeight: '18px',
    whiteSpace: 'pre-wrap',
  },
};
