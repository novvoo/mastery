import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getRuntimeStatusMeta } from '../runtime/runtime-status.js';
import { useIPC } from '../hooks/useIPC.js';
import { ProjectTree } from './workbench/ProjectTree.jsx';

const ACTIVE_AGENT_SESSION_STORAGE_KEY = 'activeAgentConversationSessionId';

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },

  section: {
    padding: '14px',
    borderBottom: 'none',
  },

  sectionTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    marginBottom: '10px',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  statusContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },

  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 0',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '500',
    gap: '4px',
  },

  statusRunning: {
    backgroundColor: 'transparent',
    color: 'var(--warning-color)',
    border: 'none',
  },

  statusIdle: {
    backgroundColor: 'transparent',
    color: 'var(--success-color)',
    border: 'none',
  },

  statusError: {
    backgroundColor: 'transparent',
    color: 'var(--error-color)',
    border: 'none',
  },

  statusCompleted: {
    backgroundColor: 'transparent',
    color: 'var(--info-color)',
    border: 'none',
  },

  statusWaiting: {
    backgroundColor: 'transparent',
    color: 'var(--warning-color)',
    border: 'none',
  },

  workingDirectory: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 0 8px',
    borderRadius: 0,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border-subtle)',
  },

  directoryIcon: {
    fontSize: '10px',
    color: 'var(--text-dark)',
    fontWeight: '800',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },

  directoryText: {
    flex: 1,
    fontSize: '12px',
    color: 'var(--text-color)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  changeButton: {
    padding: '3px 2px',
    borderRadius: '4px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all var(--transition-fast)',
  },
  projectExplorer: {
    marginTop: '10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-hover)',
    overflow: 'hidden',
    flex: 1,
    minHeight: 0,
  },

  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  textareaWrapper: {
    position: 'relative',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    boxShadow: 'var(--glass-inner-hl), var(--shadow-inset)',
    transition: 'all var(--transition-fast)',
  },

  textareaWrapperFocused: {
    border: '1px solid var(--primary-strong)',
    boxShadow: '0 0 0 3px var(--primary-soft), var(--glass-inner-hl)',
  },

  textarea: {
    width: '100%',
    minHeight: '118px',
    maxHeight: '300px',
    padding: '12px',
    paddingRight: '80px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    fontSize: '13px',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: '1.5',
    outline: 'none',
  },

  textareaControls: {
    position: 'absolute',
    right: '8px',
    bottom: '8px',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },

  charCount: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    padding: '2px 4px',
  },

  charCountWarning: {
    color: 'var(--warning-color)',
  },

  clearButton: {
    padding: '2px 6px',
    borderRadius: '3px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s',
  },

  suggestionsContainer: {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    right: '0',
    backgroundColor: 'var(--glass-bg-strong)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid var(--glass-border)',
    borderRadius: '10px',
    maxHeight: '150px',
    overflowY: 'auto',
    boxShadow: 'var(--glass-shadow-lg)',
    zIndex: 10,
  },

  suggestionItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--text-color)',
    transition: 'all var(--transition-fast)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  suggestionItemActive: {
    backgroundColor: 'var(--glass-bg-light)',
  },

  suggestionIcon: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },

  suggestionText: {
    flex: 1,
  },

  suggestionType: {
    fontSize: '11px',
    color: 'var(--text-dark)',
    padding: '2px 6px',
    borderRadius: '3px',
    backgroundColor: 'var(--background-color)',
  },

  buttonGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },

  button: {
    flex: 1,
    height: '36px',
    padding: '0 12px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all var(--transition-fast)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    minWidth: '80px',
  },

  primaryButton: {
    backgroundColor: 'var(--primary-color)',
    border: '1px solid var(--primary-color)',
    color: 'var(--text-on-primary)',
  },

  disabledButton: {
    backgroundColor: 'var(--glass-bg-light)',
    border: 'none',
    color: 'var(--text-dark)',
    cursor: 'not-allowed',
  },

  templatesPanel: {
    backgroundColor: 'var(--glass-bg-light)',
    borderRadius: '10px',
    padding: '8px',
    marginTop: '8px',
    border: '1px solid var(--glass-border)',
  },

  templatesHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },

  templatesTitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: '500',
  },

  templatesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },

  templateItem: {
    padding: '8px',
    borderRadius: '4px',
    backgroundColor: 'var(--background-color)',
    cursor: 'pointer',
    fontSize: '12px',
    color: 'var(--text-color)',
    transition: 'background-color 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  templateIcon: {
    fontSize: '14px',
  },

  templateName: {
    fontWeight: '500',
  },

  templateDesc: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginLeft: '4px',
  },

  optionsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: 'var(--primary-color)',
  },

  label: {
    fontSize: '13px',
    color: 'var(--text-color)',
    cursor: 'pointer',
  },

  numberInput: {
    width: '60px',
    padding: '4px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '12px',
  },

};

const INPUT_TEMPLATES = [
  {
    icon: 'BUG',
    name: 'Bug修复',
    desc: '描述并修复bug',
    template:
      '发现一个bug:\n位置: {file}\n描述: {description}\n预期行为: {expected}\n请帮我修复这个问题',
  },
  {
    icon: 'NEW',
    name: '功能开发',
    desc: '开发新功能',
    template: '开发新功能:\n功能名称: {name}\n需求: {requirements}\n请帮我实现这个功能',
  },
  {
    icon: 'REF',
    name: '代码重构',
    desc: '重构现有代码',
    template: '重构代码:\n目标文件: {file}\n重构目标: {goal}\n请帮我重构这段代码',
  },
  {
    icon: 'REV',
    name: '代码审查',
    desc: '审查代码质量',
    template: '审查代码:\n文件: {file}\n请检查代码质量、潜在问题和改进建议',
  },
  {
    icon: 'TST',
    name: '测试编写',
    desc: '编写单元测试',
    template: '编写测试:\n目标: {target}\n请为这个功能编写单元测试',
  },
];

function AgentControl({
  runtime,
  workingDirectory,
  onWorkingDirectoryChange,
  workingDirectorySyncMessage,
  agentOptions,
  onOptionsChange,
  onInsertText,
  projectTree,
  onOpenFile,
  activeOpenFile,
}) {
  const ipc = useIPC();

  const [showTemplates, setShowTemplates] = useState(false);

  const handleQuickCommandClick = useCallback(
    (cmd) => {
      if (onInsertText) {
        onInsertText(cmd.template);
      }
    },
    [onInsertText],
  );

  const handleTemplateClick = useCallback(
    (template) => {
      if (onInsertText) {
        onInsertText(template.template);
      }
      setShowTemplates(false);
    },
    [onInsertText],
  );

  const handleOptionChange = useCallback(
    (key, value) => {
      if (onOptionsChange) {
        onOptionsChange((prev) => ({
          ...prev,
          [key]: value,
        }));
      }
    },
    [onOptionsChange],
  );

  const getStatusStyle = () => {
    const statusMeta = getRuntimeStatusMeta(runtime.status);
    switch (runtime.status) {
      case 'running':
      case 'initializing':
        return { ...styles.statusBadge, ...styles.statusRunning };
      case 'idle':
      case 'ready':
        return { ...styles.statusBadge, ...styles.statusIdle };
      case 'error':
        return { ...styles.statusBadge, ...styles.statusError };
      case 'completed':
        return { ...styles.statusBadge, ...styles.statusCompleted };
      case 'needs_user_input':
        return { ...styles.statusBadge, ...styles.statusWaiting };
      default:
        return {
          ...styles.statusBadge,
          color: statusMeta.tone === 'muted' ? 'var(--text-muted)' : 'var(--text-color)',
          backgroundColor: 'transparent',
        };
    }
  };

  const getStatusText = () => {
    return getRuntimeStatusMeta(runtime.status).text;
  };

  const rootName = workingDirectory
    ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || workingDirectory
    : '未设置';

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.statusContainer}>
          <div style={getStatusStyle()}>{getStatusText()}</div>

          {runtime.status === 'running' && runtime.stats?.startTime && (
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              已运行: {Math.floor((Date.now() - runtime.stats.startTime) / 1000)}秒
            </div>
          )}
        </div>

        <div style={styles.workingDirectory}>
          <span style={styles.directoryIcon}>Workspace</span>
          <span style={styles.directoryText}>{workingDirectory || '未设置'}</span>
          <button
            style={styles.changeButton}
            onClick={onWorkingDirectoryChange}
            title="更改工作目录"
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-color)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            更改
          </button>
        </div>
        {workingDirectory && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '0 0 8px', marginTop: '-4px' }}>
            已同步到 CLI 共享的 .env 文件
          </div>
        )}
        {workingDirectorySyncMessage && (
          <div style={{
            padding: '8px 12px',
            marginBottom: '10px',
            backgroundColor: 'var(--success-soft)',
            borderRadius: '6px',
            border: '1px solid var(--success-color)',
            fontSize: '12px',
            color: 'var(--success-color)',
            animation: 'fadeIn 0.3s ease-in-out',
          }}>
            {workingDirectorySyncMessage}
          </div>
        )}
        <div style={{ ...styles.projectExplorer, marginTop: '12px' }}>
          <ProjectTree
            projectTree={projectTree}
            workingDirectory={workingDirectory}
            onOpenFile={onOpenFile}
            activeOpenFile={activeOpenFile}
          />
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <span>输入任务</span>
          <button
            style={styles.clearButton}
            onClick={() => setShowTemplates(!showTemplates)}
            title="显示输入模板"
          >
            {showTemplates ? '隐藏模板' : '模板'}
          </button>
        </div>

        {showTemplates && (
          <div style={styles.templatesPanel}>
            <div style={styles.templatesHeader}>
              <span style={styles.templatesTitle}>输入模板</span>
            </div>
            <div style={styles.templatesList}>
              {INPUT_TEMPLATES.map((template, index) => (
                <div
                  key={index}
                  style={styles.templateItem}
                  onClick={() => handleTemplateClick(template)}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = 'var(--glass-bg-strong)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)')
                  }
                >
                  <span style={styles.templateIcon}>{template.icon}</span>
                  <span style={styles.templateName}>{template.name}</span>
                  <span style={styles.templateDesc}>{template.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <span>执行选项</span>
        </div>

        <div style={styles.optionsContainer}>
          <div style={styles.optionRow}>
            <input
              type="checkbox"
              style={styles.checkbox}
              checked={agentOptions.autoSave}
              onChange={(e) => handleOptionChange('autoSave', e.target.checked)}
            />
            <label
              style={styles.label}
              onClick={() => handleOptionChange('autoSave', !agentOptions.autoSave)}
            >
              自动保存结果
            </label>
          </div>

          <div style={styles.optionRow}>
            <label style={{ ...styles.label, width: '100px' }}>最大迭代:</label>
            <input
              type="number"
              style={styles.numberInput}
              value={agentOptions.maxIterations}
              onChange={(e) => handleOptionChange('maxIterations', parseInt(e.target.value) || 60)}
              min={1}
              max={500}
            />
          </div>
        </div>
      </div>

    </div>
  );
}

export default AgentControl;
