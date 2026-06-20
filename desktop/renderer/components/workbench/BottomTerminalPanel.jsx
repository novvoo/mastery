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
    ? 'var(--text-color)'
    : line.type === 'error'
      ? 'var(--error-color)'
      : line.type === 'muted'
        ? 'var(--text-muted)'
        : line.type === 'system'
          ? 'var(--info-color)'
          : line.type === 'success'
            ? 'var(--success-color)'
            : 'var(--text-color)';

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
        cursor: 'text',
        userSelect: 'text',
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
  const [currentDirectory, setCurrentDirectory] = useState(workingDirectory || '.');
  const [completionOptions, setCompletionOptions] = useState([]);
  const [completionIndex, setCompletionIndex] = useState(-1);
  const terminalBodyRef = useRef(null);
  const inputRef = useRef(null);
  const resizeStateRef = useRef(null);
  const promptLabel = promptForDirectory(currentDirectory);

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
    if (workingDirectory) {
      setCurrentDirectory(workingDirectory);
    }
  }, [workingDirectory]);

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

  const getCommandCompletions = async (partialCommand) => {
    try {
      const result = await ipc.invoke('terminal:complete', {
        command: partialCommand,
        cwd: currentDirectory,
      });
      return result.completions || [];
    } catch (error) {
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
      await new Promise(resolve => setTimeout(resolve, 40));
      setLines(prev => [...prev, { type: item.isError ? 'error' : 'output', text: item.text }]);
    }
    setIsStreaming(false);
    
    if (command.trim().startsWith('cd ')) {
      const newPath = command.trim().substring(3).trim();
      if (newPath) {
        try {
          const resolvedPath = await ipc.invoke('terminal:resolvePath', {
            path: newPath,
            cwd: currentDirectory,
          });
          if (resolvedPath && resolvedPath.exists) {
            setCurrentDirectory(resolvedPath.path);
          }
        } catch (error) {
          console.log('Failed to resolve cd path:', error);
        }
      }
    }
    
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
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
        const lastPart = parts[parts.length - 1];
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
          if (parts.length === 1) {
            setInput(completion);
          } else {
            parts[parts.length - 1] = completion;
            setInput(parts.join(' '));
          }
        }
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = input.trim();
      if (!command || isStreaming) return;
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
    borderTop: '1px solid var(--border-color)',
    backgroundColor: 'var(--surface-color)',
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
    borderBottom: '1px solid var(--border-color)',
    backgroundColor: 'var(--surface-raised)',
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
    borderRight: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text-muted)',
    padding: '0 12px',
    fontSize: '11px',
    fontWeight: 400,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
  },
  tabActive: {
    color: 'var(--text-color)',
    backgroundColor: 'var(--surface-color)',
  },
  tabMeta: {
    minWidth: '18px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    borderRadius: '3px',
    backgroundColor: 'var(--warning-soft)',
    color: 'var(--warning-color)',
    fontSize: '10px',
    fontWeight: 600,
  },
  tabMetaActive: {
    backgroundColor: 'var(--warning-soft)',
    color: 'var(--warning-color)',
  },
  headerMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2px',
    minWidth: 0,
    color: 'var(--text-muted)',
    fontSize: '11px',
    whiteSpace: 'nowrap',
  },
  iconButton: {
    width: '24px',
    height: '24px',
    borderRadius: '3px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    padding: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  terminalSurface: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--surface-color)',
    overflowY: 'auto',
  },
  terminalBody: {
    padding: '8px 0',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '13px',
    lineHeight: 1.4,
    cursor: 'text',
    userSelect: 'text',
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
    backgroundColor: 'var(--surface-color)',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '13px',
  },
  prompt: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    color: 'var(--primary-color)',
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
    color: 'var(--text-color)',
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
    backgroundColor: 'var(--surface-color)',
  },
  problemRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '6px 0',
    borderRadius: 0,
    border: 'none',
    borderBottom: '1px solid var(--border-subtle)',
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
    color: 'var(--warning-color)',
    backgroundColor: 'var(--warning-soft)',
  },
  problemInfo: {
    color: 'var(--primary-color)',
    backgroundColor: 'var(--info-soft)',
  },
  problemCopy: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
  },
  outputSurface: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Roboto Mono", monospace',
    fontSize: '12px',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--surface-color)',
  },
  outputLine: {
    minHeight: '18px',
    whiteSpace: 'pre-wrap',
  },
};
