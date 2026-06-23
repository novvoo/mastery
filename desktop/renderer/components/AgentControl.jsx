/**
 * Agent 控制面板组件（增强版）
 * 提供 Agent 的输入、执行控制等功能
 * 
 * 新增功能：
 * - 智能输入提示（自动补全）
 * - 快捷命令面板
 * - 输入历史搜索
 * - 输入模板
 * - 多行输入支持
 * - 字符计数
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { getRuntimeStatusMeta } from '../runtime/runtime-status.js';
import { useIPC } from '../hooks/useIPC.js';
import { ProjectTree } from './workbench/ProjectTree.jsx';

// removed
const ACTIVE_AGENT_SESSION_STORAGE_KEY = 'activeAgentConversationSessionId';

// 样式定义
const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  
  section: {
    padding: '14px',
    borderBottom: 'none'
  },
  
  sectionTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    marginBottom: '10px',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  // 状态区域
  statusContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px'
  },
  
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 0',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '500',
    gap: '4px'
  },
  
  statusRunning: {
    backgroundColor: 'transparent',
    color: 'var(--warning-color)',
    border: 'none'
  },
  
  statusIdle: {
    backgroundColor: 'transparent',
    color: 'var(--success-color)',
    border: 'none'
  },
  
  statusError: {
    backgroundColor: 'transparent',
    color: 'var(--error-color)',
    border: 'none'
  },
  
  statusCompleted: {
    backgroundColor: 'transparent',
    color: 'var(--info-color)',
    border: 'none'
  },

  statusWaiting: {
    backgroundColor: 'transparent',
    color: 'var(--warning-color)',
    border: 'none'
  },
  
  // 工作目录
  workingDirectory: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 0 8px',
    borderRadius: 0,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border-subtle)'
  },
  
  directoryIcon: {
    fontSize: '10px',
    color: 'var(--text-dark)',
    fontWeight: '800',
    letterSpacing: '0.04em',
    textTransform: 'uppercase'
  },
  
  directoryText: {
    flex: 1,
    fontSize: '12px',
    color: 'var(--text-color)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  
  changeButton: {
    padding: '3px 2px',
    borderRadius: '4px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all var(--transition-fast)'
  },
  projectExplorer: {
    marginTop: '10px',
    borderRadius: '0',
    border: 'none',
    backgroundColor: 'transparent',
    overflow: 'hidden',
    flex: 1,
    minHeight: 0,
  },

  
  // 输入区域
  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  
  textareaWrapper: {
    position: 'relative',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    boxShadow: 'var(--glass-inner-hl), var(--shadow-inset)',
    transition: 'all var(--transition-fast)'
  },
  
  textareaWrapperFocused: {
    border: '1px solid var(--primary-strong)',
    boxShadow: '0 0 0 3px var(--primary-soft), var(--glass-inner-hl)'
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
    outline: 'none'
  },
  
  textareaControls: {
    position: 'absolute',
    right: '8px',
    bottom: '8px',
    display: 'flex',
    gap: '4px',
    alignItems: 'center'
  },
  
  charCount: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    padding: '2px 4px'
  },
  
  charCountWarning: {
    color: 'var(--warning-color)'
  },
  
  clearButton: {
    padding: '2px 6px',
    borderRadius: '3px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s'
  },
  
  // 智能提示
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
    zIndex: 10
  },
  
  suggestionItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--text-color)',
    transition: 'all var(--transition-fast)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  suggestionItemActive: {
    backgroundColor: 'var(--glass-bg-light)'
  },
  
  suggestionIcon: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  
  suggestionText: {
    flex: 1
  },
  
  suggestionType: {
    fontSize: '11px',
    color: 'var(--text-dark)',
    padding: '2px 6px',
    borderRadius: '3px',
    backgroundColor: 'var(--background-color)'
  },
  
  // 按钮组
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
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
    minWidth: '80px'
  },
  
  primaryButton: {
    backgroundColor: 'var(--primary-color)',
    border: '1px solid var(--primary-color)',
    color: 'var(--text-on-primary)'
  },
  
  disabledButton: {
    backgroundColor: 'var(--glass-bg-light)',
    border: 'none',
    color: 'var(--text-dark)',
    cursor: 'not-allowed'
  },
  

  
  // 历史记录
  historySection: {
    maxHeight: '200px',
    overflowY: 'auto'
  },
  
  historySearch: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '12px',
    marginBottom: '8px'
  },
  
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  
  historyItem: {
    padding: '8px',
    borderRadius: '4px',
    backgroundColor: 'var(--background-color)',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--text-color)',
    transition: 'background-color 0.2s',
    border: 'none',
    position: 'relative'
  },
  
  historyItemHover: {
    backgroundColor: 'var(--glass-bg-light)',
    border: 'none'
  },
  
  historyItemContent: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '90%'
  },
  
  historyItemTime: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '4px'
  },
  
  historyItemDelete: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    padding: '2px 4px',
    borderRadius: '3px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    opacity: '0',
    transition: 'opacity 0.15s'
  },
  
  historyItemDeleteVisible: {
    opacity: '1'
  },
  
  // 模板面板
  templatesPanel: {
    backgroundColor: 'var(--glass-bg-light)',
    borderRadius: '10px',
    padding: '8px',
    marginTop: '8px',
    border: '1px solid var(--glass-border)'
  },
  
  templatesHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  
  templatesTitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: '500'
  },
  
  templatesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
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
    gap: '8px'
  },
  
  templateIcon: {
    fontSize: '14px'
  },
  
  templateName: {
    fontWeight: '500'
  },
  
  templateDesc: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginLeft: '4px'
  },
  
  // 执行选项
  optionsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: 'var(--primary-color)'
  },
  
  label: {
    fontSize: '13px',
    color: 'var(--text-color)',
    cursor: 'pointer'
  },
  
  numberInput: {
    width: '60px',
    padding: '4px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '12px'
  },
  
  // 空状态
  emptyHistory: {
    textAlign: 'center',
    padding: '16px',
    color: 'var(--text-muted)',
    fontSize: '12px'
  }
};

// 输入模板定义
const INPUT_TEMPLATES = [
  {
    icon: 'BUG',
    name: 'Bug修复',
    desc: '描述并修复bug',
    template: '发现一个bug:\n位置: {file}\n描述: {description}\n预期行为: {expected}\n请帮我修复这个问题'
  },
  {
    icon: 'NEW',
    name: '功能开发',
    desc: '开发新功能',
    template: '开发新功能:\n功能名称: {name}\n需求: {requirements}\n请帮我实现这个功能'
  },
  {
    icon: 'REF',
    name: '代码重构',
    desc: '重构现有代码',
    template: '重构代码:\n目标文件: {file}\n重构目标: {goal}\n请帮我重构这段代码'
  },
  {
    icon: 'REV',
    name: '代码审查',
    desc: '审查代码质量',
    template: '审查代码:\n文件: {file}\n请检查代码质量、潜在问题和改进建议'
  },
  {
    icon: 'TST',
    name: '测试编写',
    desc: '编写单元测试',
    template: '编写测试:\n目标: {target}\n请为这个功能编写单元测试'
  }
];


/**
 * Agent 控制面板组件
 * @param {Object} props - 组件属性
 * @param {Object} props.runtime - Runtime Hook 返回的对象
 * @param {string} props.workingDirectory - 当前工作目录
 * @param {Function} props.onWorkingDirectoryChange - 工作目录变更回调
 * @param {Object} props.agentOptions - 当前执行选项
 * @param {Function} props.onOptionsChange - 执行选项变更回调
 * @param {Function} props.onInsertText - 将文本插入到主消息输入框
 * @param {Object} props.projectTree - 当前项目文件树状态和操作
 */
function AgentControl({
  runtime,
  workingDirectory,
  onWorkingDirectoryChange,
  agentOptions,
  onOptionsChange,
  onInsertText,
  sessions,
  activeSessionId,
  onSwitchSession,
  onRestoreHistory,
  onClearHistory,
  projectTree,
  onOpenFile,
  activeOpenFile
}) {
  // 状态
  const ipc = useIPC();

  const [showTemplates, setShowTemplates] = useState(false);
  const [hoveredHistoryItem, setHoveredHistoryItem] = useState(null);


  

  const handleQuickCommandClick = useCallback((cmd) => {
    if (onInsertText) {
      onInsertText(cmd.template);
    }
  }, [onInsertText]);
  
  const handleTemplateClick = useCallback((template) => {
    if (onInsertText) {
      onInsertText(template.template);
    }
    setShowTemplates(false);
  }, [onInsertText]);
  
  const handleOptionChange = useCallback((key, value) => {
    if (onOptionsChange) {
      onOptionsChange(prev => ({
        ...prev,
        [key]: value
      }));
    }
  }, [onOptionsChange]);

    

  
  // 获取状态样式
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
  
  // 获取状态文本
  const getStatusText = () => {
    return getRuntimeStatusMeta(runtime.status).text;
  };

  const rootName = workingDirectory
    ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || workingDirectory
    : '未设置';

  return (
    <div style={styles.container}>
      {/* 状态显示 */}
      <div style={styles.section}>
        <div style={styles.statusContainer}>
          <div style={getStatusStyle()}>
            {getStatusText()}
          </div>
          
          {/* 运行时间 */}
          {runtime.status === 'running' && runtime.stats?.startTime && (
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)'
            }}>
              已运行: {Math.floor((Date.now() - runtime.stats.startTime) / 1000)}秒
            </div>
          )}
        </div>
        
        {/* 工作目录 */}
        <div style={styles.workingDirectory}>
          <span style={styles.directoryIcon}>Workspace</span>
          <span style={styles.directoryText}>
            {workingDirectory || '未设置'}
          </span>
          <button
            style={styles.changeButton}
            onClick={onWorkingDirectoryChange}
            title="更改工作目录"
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-color)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            更改
          </button>
        </div>
        <div style={{ ...styles.projectExplorer, marginTop: '12px' }}>
          <ProjectTree
            projectTree={projectTree}
            workingDirectory={workingDirectory}
            onOpenFile={onOpenFile}
            activeOpenFile={activeOpenFile}
          />
        </div>
      </div>
      
      {/* 快捷命令面板已移除 */}
      
      {/* 输入区域 */}
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
        
        {/* 模板面板 */}
        {showTemplates && (
          <div style={styles.templatesPanel}>
            <div style={styles.templatesHeader}>
              <span style={styles.templatesTitle}>
                输入模板
              </span>
            </div>
            <div style={styles.templatesList}>
              {INPUT_TEMPLATES.map((template, index) => (
                <div
                  key={index}
                  style={styles.templateItem}
                  onClick={() => handleTemplateClick(template)}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--glass-bg-strong)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)'}
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
      
      {/* 执行选项 */}
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
            <label style={{ ...styles.label, width: '100px' }}>
              最大迭代:
            </label>
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
      
      {/* 历史会话 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          <span>📜</span>
          <span>历史会话</span>
          <span style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginLeft: '4px'
          }}>
            ({sessions.length})
          </span>
          <button
            type="button"
            style={{
              ...styles.clearButton,
              marginLeft: 'auto',
              opacity: sessions.length === 0 ? 0.45 : 1,
              cursor: sessions.length === 0 ? 'not-allowed' : 'pointer'
            }}
            onClick={onClearHistory}
            disabled={sessions.length === 0}
            title="清空所有会话"
          >
            清空
          </button>
        </div>
        
        {/* 列表 */}
        <div style={styles.historySection}>
          <div style={styles.historyList}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  style={{
                    ...styles.historyItem,
                    ...(isActive ? styles.historyItemHover : {}),
                    border: isActive ? 'none' : 'none'
                  }}
                  onClick={() => onSwitchSession(session.id)}
                  title={'切换到会话: ' + (session.title || session.id)}
                >
                  <div style={styles.historyItemContent}>
                    {session.title || '(未命名会话)'}
                  </div>
                  <div style={styles.historyItemTime}>
                    {session.updatedAt ? new Date(session.updatedAt).toLocaleString() : ''}
                    {' · ' + (session.messages ? session.messages.length : 0) + '条消息'}
                    {isActive ? ' · 当前' : ''}
                  </div>
                </div>
              );
            })}
            
            {sessions.length === 0 && (
              <div style={styles.emptyHistory}>
                暂无会话，发送一条消息后会自动创建
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentControl;
