/**
 * AI Agent Desktop - 主应用组件
 * 
 * 基于 OpenAI Codex 2026 设计理念重新设计:
 * - Chat-centric 布局: 主区域是对话框
 * - 顶部菜单栏: 完整的菜单系统
 * - 右侧摘要面板: 显示计划、来源、产出
 * - 左侧工具面板: 可折叠的工具/技能包
 * - 对话内直接调用工具: 像 CLI 一样显示工具调用和结果
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import AgentControl from './components/AgentControl.jsx';
import ToolPanel from './components/ToolPanel.jsx';
import MessageLog from './components/MessageLog.jsx';
import StatusBar from './components/StatusBar.jsx';
import CommandSuggestions from './components/CommandSuggestions.jsx';
import { useRuntime } from './hooks/useRuntime.js';
import { useIPC } from './hooks/useIPC.js';
import './index.css';

// Codex 2026 风格布局常量
const LAYOUT = {
  sidebarWidth: 280,
  summaryPanelWidth: 300,
  previewPanelWidth: 460,
  headerHeight: 44,
  inputAreaHeight: 140,
};

const REPOSITORY_URL = 'https://github.com/novvoo/ai-engineering-mastery-agent';
const PROJECT_TREE_REFRESH_CONCURRENCY = 12;
const AGENT_HISTORY_STORAGE_KEY = 'agentHistory';
const AGENT_HISTORY_UPDATED_EVENT = 'agent-history-updated';
const AGENT_SESSIONS_STORAGE_KEY = 'agentConversationSessions';
const ACTIVE_AGENT_SESSION_STORAGE_KEY = 'activeAgentConversationSessionId';
const MAX_AGENT_HISTORY_ITEMS = 50;
const MAX_AGENT_SESSIONS = 50;

function readAgentHistory() {
  try {
    const rawHistory = localStorage.getItem(AGENT_HISTORY_STORAGE_KEY);
    if (!rawHistory) return [];
    const parsed = JSON.parse(rawHistory);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[App] 读取输入历史失败:', error);
    return [];
  }
}

function createAgentSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readAgentSessions() {
  try {
    const rawSessions = localStorage.getItem(AGENT_SESSIONS_STORAGE_KEY);
    if (!rawSessions) return [];
    const parsed = JSON.parse(rawSessions);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[App] 读取会话历史失败:', error);
    return [];
  }
}

function writeAgentSessions(sessions) {
  const normalizedSessions = Array.isArray(sessions) ? sessions.slice(0, MAX_AGENT_SESSIONS) : [];
  localStorage.setItem(AGENT_SESSIONS_STORAGE_KEY, JSON.stringify(normalizedSessions));
}

function findAgentSession(sessionId) {
  if (!sessionId) return null;
  return readAgentSessions().find(session => session?.id === sessionId) || null;
}

function getAgentSessionTitle(input, messages = []) {
  const fromInput = String(input || '').trim();
  if (fromInput) return fromInput.slice(0, 80);

  const firstMessage = messages.find(message => typeof message?.content === 'string' && message.content.trim());
  return firstMessage?.content?.replace(/^用户输入:\s*/, '').slice(0, 80) || '未命名会话';
}

function upsertAgentSession(session) {
  if (!session?.id) return;
  const now = Date.now();
  const nextSession = {
    ...session,
    updatedAt: session.updatedAt || now,
    createdAt: session.createdAt || now,
    messages: Array.isArray(session.messages) ? session.messages : []
  };
  const nextSessions = [
    nextSession,
    ...readAgentSessions().filter(item => item?.id !== nextSession.id)
  ].slice(0, MAX_AGENT_SESSIONS);
  writeAgentSessions(nextSessions);
}

function saveAgentInputHistory(input, sessionId) {
  const normalizedInput = String(input || '').trim();
  if (!normalizedInput) return;

  const nextHistory = [
    {
      input: normalizedInput,
      sessionId,
      timestamp: Date.now()
    },
    ...readAgentHistory().filter(item => item?.input !== normalizedInput)
  ].slice(0, MAX_AGENT_HISTORY_ITEMS);

  localStorage.setItem(AGENT_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
  window.dispatchEvent(new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, {
    detail: nextHistory
  }));
}

function getDocumentDisplayName(pathOrTitle = '') {
  const text = String(pathOrTitle || '').trim();
  if (!text) return '未命名文档';
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function normalizeRagDocuments(documents = []) {
  return (documents || []).map(doc => ({
    id: doc.id,
    name: doc.title || getDocumentDisplayName(doc.source),
    path: doc.source || '',
    kind: doc.kind,
    chunks: doc.chunks,
    chars: doc.chars,
    indexed: true,
  }));
}

function mergeRagDocuments(currentDocs = [], nextDocs = []) {
  const merged = new Map();
  for (const doc of currentDocs) {
    const key = doc.id || doc.path || doc.name;
    if (key) merged.set(key, doc);
  }
  for (const doc of nextDocs) {
    const key = doc.id || doc.path || doc.name;
    if (key) merged.set(key, doc);
  }
  return Array.from(merged.values());
}

// 样式定义
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
    overflow: 'hidden'
  },
  
  // ================== 顶部菜单栏 ==================
  menuBar: {
    display: 'flex',
    alignItems: 'center',
    minHeight: `${LAYOUT.headerHeight}px`,
    padding: '0 12px',
    backgroundColor: '#11161e',
    borderBottom: '1px solid var(--border-subtle)',
    gap: '4px'
  },
  
  menuItem: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    height: '32px',
    padding: '0 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.15s'
  },
  
  menuItemHover: {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)'
  },
  
  menuItemActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)'
  },
  
  menuDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    minWidth: '200px',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    padding: '6px 0',
    zIndex: 1000
  },
  
  menuDropdownItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
    transition: 'background-color 0.1s'
  },
  
  menuDropdownShortcut: {
    fontSize: '11px',
    color: 'var(--text-dark)',
    fontFamily: 'monospace'
  },
  
  menuDivider: {
    height: '1px',
    backgroundColor: 'var(--border-subtle)',
    margin: '6px 0'
  },
  
  menuSectionTitle: {
    padding: '6px 14px',
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-dark)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  
  // ================== 主内容区 ==================
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  
  // ================== 左侧工具面板 ==================
  leftSidebar: {
    width: `${LAYOUT.sidebarWidth}px`,
    backgroundColor: 'var(--surface-color)',
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width 0.2s ease'
  },
  
  leftSidebarCollapsed: {
    width: '0px',
    borderRight: 'none'
  },
  
  sidebarToggle: {
    position: 'absolute',
    left: `${LAYOUT.sidebarWidth + 10}px`,
    top: '60px',
    width: '24px',
    height: '48px',
    borderRadius: '0 6px 6px 0',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--border-subtle)',
    borderLeft: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: '12px',
    zIndex: 10,
    transition: 'left 0.2s ease'
  },
  
  sidebarToggleCollapsed: {
    left: '10px'
  },
  
  // ================== 右侧摘要面板 (Codex Style) ==================
  summaryPanel: {
    width: `${LAYOUT.summaryPanelWidth}px`,
    backgroundColor: 'var(--surface-color)',
    borderLeft: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },

  previewPanel: {
    width: `${LAYOUT.previewPanelWidth}px`,
    backgroundColor: 'var(--surface-color)',
    borderLeft: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },

  previewHeader: {
    minHeight: '42px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  previewFrame: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    border: 'none',
    backgroundColor: '#fff'
  },
  
  summarySection: {
    padding: '14px',
    borderBottom: '1px solid var(--border-subtle)'
  },
  
  summarySectionTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    marginBottom: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  
  summaryItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: '6px',
    backgroundColor: 'var(--background-color)',
    marginBottom: '6px',
    fontSize: '12px'
  },
  
  summaryItemIcon: {
    fontSize: '12px',
    flexShrink: 0,
    marginTop: '2px'
  },
  
  summaryItemText: {
    flex: 1,
    color: 'var(--text-color)',
    lineHeight: 1.4
  },
  
  summaryItemEmpty: {
    color: 'var(--text-dark)',
    fontStyle: 'italic'
  },
  button: {
    height: '32px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px'
  },
  
  // ================== 聊天区域 ==================
  chatArea: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: 'var(--background-color)'
  },
  
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-color)'
  },
  
  chatTitle: {
    fontSize: '15px',
    fontWeight: '700',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  chatStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '500',
    border: '1px solid'
  },
  
  statusReady: {
    backgroundColor: 'rgba(93, 211, 158, 0.12)',
    border: '1px solid rgba(93, 211, 158, 0.28)',
    color: 'var(--success-color)'
  },
  
  statusRunning: {
    backgroundColor: 'rgba(246, 200, 95, 0.12)',
    border: '1px solid rgba(246, 200, 95, 0.28)',
    color: 'var(--warning-color)'
  },
  
  // ================== 消息列表 ==================
  messageContainer: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    padding: '0 20px'
  },
  
  // ================== 输入区域 ==================
  inputArea: {
    padding: '16px 20px',
    backgroundColor: 'var(--surface-color)',
    borderTop: '1px solid var(--border-subtle)'
  },
  
  inputWrapper: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-end',
    position: 'relative',
    zIndex: 50
  },
  
  inputTextarea: {
    flex: 1,
    minHeight: '48px',
    maxHeight: '200px',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
    transition: 'border-color 0.2s, box-shadow 0.2s'
  },
  
  inputTextareaFocused: {
    border: '1px solid var(--primary-color)',
    boxShadow: '0 0 0 3px var(--primary-soft)'
  },
  
  sendButton: {
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    border: 'none',
    backgroundColor: 'var(--primary-color)',
    color: '#061018',
    cursor: 'pointer',
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  
  sendButtonDisabled: {
    backgroundColor: 'var(--border-subtle)',
    color: 'var(--text-dark)',
    cursor: 'not-allowed'
  },
  
  inputHint: {
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--text-dark)'
  },
  
  // ================== 技能/工具标签页 ==================
  tabNav: {
    display: 'flex',
    gap: '2px',
    padding: '10px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: '#141922'
  },
  
  tabButton: {
    flex: 1,
    height: '32px',
    borderRadius: '6px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    transition: 'all 0.15s'
  },
  
  tabButtonActive: {
    backgroundColor: 'var(--surface-hover)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-color)'
  },
  
  // ================== 底部状态栏 ==================
  footer: {
    backgroundColor: '#11161e',
    borderTop: '1px solid var(--border-subtle)'
  },
  
  // ================== 模态框样式 ==================
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(5, 8, 13, 0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px'
  },
  
  modal: {
    width: 'min(560px, 100%)',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden'
  },
  
  modalHeader: {
    padding: '18px 20px',
    borderBottom: '1px solid var(--border-subtle)'
  },
  
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--text-color)'
  },
  
  modalSubtitle: {
    margin: '8px 0 0',
    color: 'var(--text-muted)',
    fontSize: '13px',
    lineHeight: 1.5
  },
  
  modalBody: {
    padding: '18px 20px',
    display: 'grid',
    gap: '14px'
  },
  
  formRow: {
    display: 'grid',
    gap: '7px'
  },
  
  formLabel: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)'
  },
  
  formInput: {
    width: '100%',
    height: '36px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    backgroundColor: '#11161e',
    color: 'var(--text-color)',
    padding: '0 10px'
  },
  
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 20px',
    borderTop: '1px solid var(--border-subtle)',
    backgroundColor: '#141922'
  },
  
  modalActions: {
    display: 'flex',
    gap: '8px',
    flexShrink: 0
  },
  
  textButton: {
    height: '34px',
    padding: '0 12px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    minWidth: '86px',
    whiteSpace: 'nowrap'
  },
  
  primaryAction: {
    height: '34px',
    padding: '0 14px',
    borderRadius: '6px',
    border: '1px solid var(--primary-color)',
    backgroundColor: 'var(--primary-color)',
    color: '#061018',
    fontWeight: '700',
    cursor: 'pointer',
    minWidth: '108px',
    whiteSpace: 'nowrap'
  },
  
  formError: {
    color: 'var(--error-color)',
    fontSize: '12px'
  },
  
  formHint: {
    color: 'var(--text-dark)',
    fontSize: '12px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
};

const LLM_PROVIDER_OPTIONS = {
  openai: {
    label: 'OpenAI / OpenAI Compatible',
    keyLabel: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1'
  },
  deepseek: {
    label: 'DeepSeek',
    keyLabel: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1'
  },
  zhipu: {
    label: 'Zhipu',
    keyLabel: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4'
  },
  openrouter: {
    label: 'OpenRouter',
    keyLabel: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    defaultBaseUrl: 'https://openrouter.ai/api/v1'
  }
};

// Codex 风格的菜单定义
const MENU_ITEMS = [
  {
    label: '文件',
    items: [
      { label: '新建任务', shortcut: 'Ctrl+N', command: 'newTask' },
      { label: '切换工作目录...', shortcut: 'Ctrl+O', command: 'changeWorkspace' },
      { type: 'divider' },
      { label: '保存会话快照', shortcut: 'Ctrl+S', command: 'saveSession' },
      { label: '导出对话 Markdown', shortcut: 'Ctrl+E', command: 'exportConversation' },
      { type: 'divider' },
      { label: '退出', shortcut: 'Ctrl+Q', command: 'quit' }
    ]
  },
  {
    label: '视图',
    items: [
      { label: '切换侧边栏', shortcut: 'Ctrl+B', command: 'toggleSidebar' },
      { label: '切换 RAG 面板', shortcut: 'Ctrl+Shift+S', command: 'toggleSummary' },
      { label: '切换预览面板', command: 'togglePreview' },
      { type: 'divider' },
      { label: 'Agent 面板', command: 'showAgent' },
      { label: '工具面板', shortcut: 'Ctrl+T', command: 'showTools' }
    ]
  },
  {
    label: 'Agent',
    items: [
      { label: '聚焦输入', shortcut: 'Ctrl+Enter', command: 'focusInput' },
      { label: '停止执行', shortcut: 'Ctrl+.', command: 'stopAgent' },
      { type: 'divider' },
      { label: '清除对话', command: 'clearConversation' },
      { label: '历史记录', command: 'showHistory' },
      { label: '文档搜索', command: 'insertDocSearch' },
      { type: 'divider' },
      { label: '模型配置...', shortcut: 'Ctrl+,', command: 'openModelConfig' }
    ]
  },
  {
    label: '技能',
    items: [
      { label: '诊断', command: 'insertCommand', value: '/diagnose symptom=' },
      { label: '代码审查', command: 'insertCommand', value: '/review scope=' },
      { label: 'TDD', command: 'insertCommand', value: '/tdd phase=red component=' },
      { label: '架构设计', command: 'insertCommand', value: '/architect goal=' },
      { label: '交接总结', command: 'insertCommand', value: '/handoff session_summary=' }
    ]
  },
  {
    label: '工具',
    items: [
      { label: '查看工具面板', shortcut: 'Ctrl+T', command: 'showTools' },
      { label: '刷新项目文件', command: 'refreshProjectTree' },
      { label: '刷新 RAG 文档', command: 'refreshRagDocs' },
      { label: '预览当前项目', command: 'startPreview' },
      { type: 'divider' },
      { label: '插入 Shell 命令', command: 'insertCommand', value: '请运行命令：' },
      { label: '插入 Web 搜索', command: 'insertCommand', value: '请搜索最新资料：' }
    ]
  },
  {
    label: '帮助',
    items: [
      { label: '文档', command: 'openDocs' },
      { label: '快捷键', command: 'showShortcuts' },
      { label: '报告问题', command: 'openIssues' },
      { type: 'divider' },
      { label: '关于', command: 'showAbout' }
    ]
  }
];

// 技能包定义 (Codex 2026 Style)
const SKILL_BUNDLES = {
  '后端开发': [
    { name: 'architect', desc: '架构设计', icon: '🏗️' },
    { name: 'tdd', desc: '测试驱动开发', icon: '🧪' },
    { name: 'diagnose', desc: '问题诊断', icon: '🔬' }
  ],
  '前端开发': [
    { name: 'grill', desc: 'UI 快速构建', icon: '🔥' },
    { name: 'setup', desc: '项目初始化', icon: '⚡' }
  ],
  '协作': [
    { name: 'review', desc: '代码审查', icon: '👀' },
    { name: 'handoff', desc: '任务交接', icon: '🤝' }
  ]
};

/**
 * 主应用组件
 */
function App() {
  // 状态管理
  const [activeTab, setActiveTab] = useState('agent');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [llmConfigStatus, setLLMConfigStatus] = useState(null);
  const [showLLMSetup, setShowLLMSetup] = useState(false);
  const [llmForm, setLLMForm] = useState({
    provider: 'openai',
    apiKey: '',
    model: LLM_PROVIDER_OPTIONS.openai.defaultModel,
    baseUrl: LLM_PROVIDER_OPTIONS.openai.defaultBaseUrl
  });
  const [llmSetupError, setLLMSetupError] = useState('');
  const [llmSetupSaving, setLLMSetupSaving] = useState(false);
  const [platformInfo, setPlatformInfo] = useState(null);
  const [windowState, setWindowState] = useState({
    isFullScreen: false,
    isMaximized: false
  });
  
  // Codex 风格新状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [summaryPanelVisible, setSummaryPanelVisible] = useState(true);
  const [activeMenu, setActiveMenu] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [agentOptions, setAgentOptions] = useState({
    debug: false,
    maxIterations: 180,
    autoSave: true
  });
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(() => (
    localStorage.getItem(ACTIVE_AGENT_SESSION_STORAGE_KEY) || createAgentSessionId()
  ));
  
  // 摘要面板数据 (Codex Style)
  const [summaryData, setSummaryData] = useState({
    plan: ['分析代码结构', '编写新功能', '运行测试'],
    sources: [
      { type: 'file', name: 'src/agent.js' },
      { type: 'memory', name: '之前的对话上下文' }
    ],
    outputs: [
      '生成 README.md',
      '修复 bug #123'
    ]
  });

  // RAG (Retrieval-Augmented Generation) 面板状态
  const [ragDocs, setRagDocs] = useState([]); // { name, path }
  const [ragStatus, setRagStatus] = useState('idle'); // idle | indexing | ready | error
  const [ragIndexProgress, setRagIndexProgress] = useState(0);
  const [directoryChildren, setDirectoryChildren] = useState({});
  const [expandedDirectories, setExpandedDirectories] = useState(() => new Set(['']));
  const [loadingDirectories, setLoadingDirectories] = useState(() => new Set());
  const [projectTreeStatus, setProjectTreeStatus] = useState('idle');
  const [projectTreeError, setProjectTreeError] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSession, setPreviewSession] = useState(null);
  const [previewStatus, setPreviewStatus] = useState('idle');
  const [previewFrameKey, setPreviewFrameKey] = useState(0);
  
  // 使用自定义 Hooks
  const runtime = useRuntime();
  const ipc = useIPC();
  const chatInputRef = useRef(null);
  const workspaceRefreshTimerRef = useRef(null);
  const directoryChildrenRef = useRef(directoryChildren);
  const skipNextSessionPersistRef = useRef(false);

  useEffect(() => {
    directoryChildrenRef.current = directoryChildren;
  }, [directoryChildren]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_AGENT_SESSION_STORAGE_KEY, activeAgentSessionId);
  }, [activeAgentSessionId]);

  useEffect(() => {
    const activeSession = findAgentSession(activeAgentSessionId);
    if (activeSession?.messages?.length) {
      runtime.restoreMessages(activeSession.messages);
    }
  }, []);

  useEffect(() => {
    if (!activeAgentSessionId || runtime.messages.length === 0) {
      return;
    }

    if (skipNextSessionPersistRef.current) {
      skipNextSessionPersistRef.current = false;
      return;
    }

    const firstInput = runtime.messages.find(message => (
      typeof message?.content === 'string' && message.content.startsWith('用户输入:')
    ))?.content?.replace(/^用户输入:\s*/, '');

    upsertAgentSession({
      id: activeAgentSessionId,
      title: getAgentSessionTitle(firstInput, runtime.messages),
      workingDirectory,
      messages: runtime.messages,
      updatedAt: Date.now()
    });
  }, [activeAgentSessionId, runtime.messages, workingDirectory]);

  const refreshRagDocuments = useCallback(async () => {
    if (!ipc.isConnected || !ipc.processInput) {
      return null;
    }

    try {
      const result = await ipc.processInput('/doc list');
      const persistedDocs = normalizeRagDocuments(result?.data?.documents || result?.documents || []);
      setRagDocs(persistedDocs);
      setRagStatus(persistedDocs.length > 0 ? 'ready' : 'idle');
      setRagIndexProgress(persistedDocs.length > 0 ? 100 : 0);
      return persistedDocs;
    } catch (error) {
      console.error('[App] 加载持久化 RAG 文档失败:', error);
      setRagStatus('error');
      return null;
    }
  }, [ipc.isConnected, ipc.processInput]);
  
  // 初始化
  useEffect(() => {
    let isMounted = true;
    let unsubscribeWindowState = null;
    let unsubscribeProjectCreated = null;
    let unsubscribeProjectOpened = null;

    const syncWorkingDirectoryFromEvent = (payload = {}) => {
      const nextDirectory = payload?.path || payload?.workingDirectory || payload;
      if (!isMounted || !nextDirectory) {
        return;
      }

      setWorkingDirectory(nextDirectory);
      setDirectoryChildren({});
      setExpandedDirectories(new Set(['']));
      setProjectTreeError('');
      setRagDocs([]);
      setRagStatus('idle');
      setRagIndexProgress(0);
      runtime.loadTools();
      runtime.refreshState();
    };

    // 连接到主进程
    ipc.connect().then((connection) => {
      if (!isMounted || !connection) {
        return;
      }

      console.log('[App] 已连接到主进程');
      setPlatformInfo(ipc.getPlatform());

      ipc.getWindowState().then(state => {
        if (!isMounted || !state) {
          return;
        }
        setWindowState(state);
      }).catch(error => {
        console.error('[App] 获取窗口状态失败:', error);
      });

      unsubscribeWindowState = ipc.onWindowStateChange(state => {
        if (!isMounted || !state) {
          return;
        }
        setWindowState(state);
      });

      unsubscribeProjectCreated = ipc.subscribe('app:projectCreated', syncWorkingDirectoryFromEvent);
      unsubscribeProjectOpened = ipc.subscribe('app:projectOpened', syncWorkingDirectoryFromEvent);
      
      // 获取应用信息
      ipc.getAppInfo().then(info => {
        if (!isMounted) {
          return;
        }
        console.log('[App] 应用信息:', info);
        setWorkingDirectory(info.workingDirectory);
      });

      ipc.getLLMConfigStatus().then(status => {
        if (!isMounted || !status) {
          return;
        }
        setLLMConfigStatus(status);
        setLLMForm(prev => ({
          ...prev,
          provider: status.provider || prev.provider,
          model: status.model || LLM_PROVIDER_OPTIONS[status.provider]?.defaultModel || prev.model,
          baseUrl: status.baseUrl || LLM_PROVIDER_OPTIONS[status.provider]?.defaultBaseUrl || prev.baseUrl
        }));
        if (!status.configured) {
          setShowLLMSetup(true);
        }
      }).catch(error => {
        console.error('[App] 获取 LLM 配置状态失败:', error);
      });
      
      // 获取工具列表
      runtime.loadTools();
      
      // 获取初始状态
      runtime.refreshState();
    }).catch(error => {
      console.error('[App] 连接失败:', error);
    });
    
    // 清理
    return () => {
      isMounted = false;
      if (typeof unsubscribeWindowState === 'function') {
        unsubscribeWindowState();
      }
      if (typeof unsubscribeProjectCreated === 'function') {
        unsubscribeProjectCreated();
      }
      if (typeof unsubscribeProjectOpened === 'function') {
        unsubscribeProjectOpened();
      }
      ipc.disconnect();
    };
  }, []);
  
  // 处理工作目录变更
  const handleWorkingDirectoryChange = useCallback(async () => {
    const result = await ipc.openDirectoryDialog({
      title: '选择工作目录'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const newDir = result.filePaths[0];
      await ipc.setWorkingDirectory(newDir);
      setWorkingDirectory(newDir);
      setDirectoryChildren({});
      setExpandedDirectories(new Set(['']));
      setProjectTreeError('');
      setRagDocs([]);
      setRagStatus('idle');
      setRagIndexProgress(0);
      
      // 重新加载工具
      runtime.loadTools();
    }
  }, [ipc, runtime]);

  useEffect(() => {
    if (!workingDirectory || !ipc.isConnected) {
      return;
    }

    refreshRagDocuments();
  }, [workingDirectory, ipc.isConnected, refreshRagDocuments]);

  useEffect(() => {
    if (!workingDirectory || !ipc.isConnected || !ipc.listDirectory) {
      return;
    }

    let cancelled = false;
    setProjectTreeStatus('loading');
    setProjectTreeError('');
    setDirectoryChildren({});
    setExpandedDirectories(new Set(['']));
    setLoadingDirectories(new Set(['']));

    ipc.listDirectory('')
      .then(result => {
        if (cancelled) return;
        if (!result?.success) {
          setProjectTreeStatus('error');
          setProjectTreeError(result?.error || '无法读取工作目录');
          return;
        }
        setDirectoryChildren({ '': result.entries || [] });
        setProjectTreeStatus('ready');
      })
      .catch(error => {
        if (cancelled) return;
        setProjectTreeStatus('error');
        setProjectTreeError(error.message || '无法读取工作目录');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingDirectories(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [workingDirectory, ipc.isConnected]);

  const loadProjectDirectory = useCallback(async (directoryPath = '') => {
    if (!ipc.listDirectory) {
      return null;
    }

    setLoadingDirectories(prev => new Set(prev).add(directoryPath));
    setProjectTreeError('');

    try {
      const result = await ipc.listDirectory(directoryPath);
      if (!result?.success) {
        setProjectTreeError(result?.error || '无法读取目录');
        return null;
      }

      setDirectoryChildren(prev => ({
        ...prev,
        [directoryPath]: result.entries || []
      }));
      setProjectTreeStatus('ready');
      return result;
    } catch (error) {
      setProjectTreeError(error.message || '无法读取目录');
      return null;
    } finally {
      setLoadingDirectories(prev => {
        const next = new Set(prev);
        next.delete(directoryPath);
        return next;
      });
    }
  }, [ipc]);

  const handleProjectDirectoryToggle = useCallback(async (directoryPath) => {
    const isExpanded = expandedDirectories.has(directoryPath);
    if (isExpanded) {
      setExpandedDirectories(prev => {
        const next = new Set(prev);
        next.delete(directoryPath);
        return next;
      });
      return;
    }

    setExpandedDirectories(prev => new Set(prev).add(directoryPath));
    if (!directoryChildren[directoryPath]) {
      await loadProjectDirectory(directoryPath);
    }
  }, [directoryChildren, expandedDirectories, loadProjectDirectory]);

  const handleProjectTreeRefresh = useCallback(async () => {
    setDirectoryChildren({});
    setExpandedDirectories(new Set(['']));
    setProjectTreeStatus('loading');
    await loadProjectDirectory('');
  }, [loadProjectDirectory]);

  const handleStartPreview = useCallback(async (target = '.') => {
    if (!ipc.startPreview) {
      return null;
    }

    setPreviewStatus('starting');
    setPreviewVisible(true);
    try {
      const preview = await ipc.startPreview({ target, kind: 'auto' });
      setPreviewSession(preview);
      setPreviewStatus('ready');
      setPreviewFrameKey(prev => prev + 1);
      return preview;
    } catch (error) {
      setPreviewStatus('error');
      runtime.addMessage?.({
        type: 'error',
        content: `预览启动失败: ${error.message}`
      });
      return null;
    }
  }, [ipc, runtime]);

  const handleStopPreview = useCallback(async () => {
    if (!previewSession?.session_id || !ipc.stopPreview) {
      return;
    }

    await ipc.stopPreview(previewSession.session_id);
    setPreviewSession(null);
    setPreviewStatus('idle');
  }, [ipc, previewSession]);

  const refreshLoadedProjectDirectories = useCallback(async () => {
    if (!ipc.listDirectory) {
      return;
    }

    const loadedPaths = Object.keys(directoryChildrenRef.current);
    const pathsToRefresh = loadedPaths.length > 0 ? loadedPaths : [''];
    setProjectTreeError('');

    try {
      const results = [];
      for (let index = 0; index < pathsToRefresh.length; index += PROJECT_TREE_REFRESH_CONCURRENCY) {
        const batch = pathsToRefresh.slice(index, index + PROJECT_TREE_REFRESH_CONCURRENCY);
        const batchResults = await Promise.all(batch.map(async (directoryPath) => {
          const result = await ipc.listDirectory(directoryPath);
          return { directoryPath, result };
        }));
        results.push(...batchResults);
      }

      const nextChildren = {};
      const missingDirectories = new Set();
      let hasError = false;
      for (const { directoryPath, result } of results) {
        if (result?.success) {
          nextChildren[directoryPath] = result.entries || [];
        } else {
          missingDirectories.add(directoryPath);
          if (directoryPath === '') {
            hasError = true;
          }
        }
      }

      setDirectoryChildren(prev => {
        const next = {
          ...prev,
          ...nextChildren
        };
        for (const missingPath of missingDirectories) {
          if (missingPath !== '') {
            delete next[missingPath];
          }
        }
        return next;
      });
      if (missingDirectories.size > 0) {
        setExpandedDirectories(prev => {
          const next = new Set(prev);
          for (const missingPath of missingDirectories) {
            if (missingPath !== '') {
              next.delete(missingPath);
            }
          }
          return next;
        });
      }
      setProjectTreeStatus(hasError ? 'error' : 'ready');
      if (hasError) {
        setProjectTreeError('工作目录无法刷新');
      } else {
        setProjectTreeError('');
      }
    } catch (error) {
      setProjectTreeStatus('error');
      setProjectTreeError(error.message || '无法刷新项目文件');
    }
  }, [ipc.listDirectory]);

  useEffect(() => {
    if (!ipc.isConnected || !ipc.onWorkspaceChanged) {
      return undefined;
    }

    const unsubscribe = ipc.onWorkspaceChanged(() => {
      clearTimeout(workspaceRefreshTimerRef.current);
      workspaceRefreshTimerRef.current = setTimeout(() => {
        refreshLoadedProjectDirectories();
      }, 120);
    });

    return () => {
      clearTimeout(workspaceRefreshTimerRef.current);
      unsubscribe?.();
    };
  }, [ipc.isConnected, ipc.onWorkspaceChanged, refreshLoadedProjectDirectories]);

  useEffect(() => {
    if (!ipc.isConnected) {
      return undefined;
    }

    let unsubscribeStarted = null;
    let unsubscribeStopped = null;

    ipc.listPreviews?.().then(result => {
      const previews = result?.previews || [];
      if (previews.length > 0) {
        setPreviewSession(previews[0]);
        setPreviewVisible(true);
        setPreviewStatus('ready');
      }
    }).catch(() => {});

    if (ipc.onPreviewStarted) {
      unsubscribeStarted = ipc.onPreviewStarted(preview => {
        setPreviewSession(preview);
        setPreviewVisible(true);
        setPreviewStatus('ready');
        setPreviewFrameKey(prev => prev + 1);
      });
    }

    if (ipc.onPreviewStopped) {
      unsubscribeStopped = ipc.onPreviewStopped(result => {
        if (result?.stopped === previewSession?.session_id) {
          setPreviewSession(null);
          setPreviewStatus('idle');
        }
      });
    }

    return () => {
      unsubscribeStarted?.();
      unsubscribeStopped?.();
    };
  }, [ipc.isConnected, ipc.listPreviews, ipc.onPreviewStarted, ipc.onPreviewStopped, previewSession?.session_id]);
  
  // 处理新建任务
  const handleNewTask = useCallback(() => {
    setActiveAgentSessionId(createAgentSessionId());
    runtime.clearMessages();
    setChatInput('');
  }, [runtime]);
  
  // 处理窗口控制
  const handleMinimize = useCallback(() => {
    ipc.minimizeWindow();
  }, [ipc]);
  
  const handleMaximize = useCallback(() => {
    ipc.maximizeWindow();
  }, [ipc]);
  
  const handleClose = useCallback(() => {
    ipc.closeWindow();
  }, [ipc]);
  
  // 处理保存任务
  const handleSaveTask = useCallback(() => {
    const snapshot = {
      savedAt: new Date().toISOString(),
      workingDirectory,
      messages: runtime.messages,
      ragDocs,
    };
    localStorage.setItem('ai-agent-session-snapshot', JSON.stringify(snapshot));
    ipc.showNotification?.({
      title: '会话已保存',
      body: '已保存到本地浏览器存储，可在当前设备恢复参考。'
    });
  }, [ipc, ragDocs, runtime.messages, workingDirectory]);
  
  // 处理导出
  const handleExport = useCallback(() => {
    const lines = [
      '# AI Agent Conversation',
      '',
      `- Exported: ${new Date().toISOString()}`,
      `- Working directory: ${workingDirectory || '未设置'}`,
      '',
      ...runtime.messages.map((message, index) => [
        `## ${index + 1}. ${message.type || 'message'}`,
        '',
        String(message.content || message.result || message.details || '').trim() || '(empty)',
        ''
      ].join('\n'))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-agent-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [runtime.messages, workingDirectory]);

  const handleLLMProviderChange = useCallback((provider) => {
    const option = LLM_PROVIDER_OPTIONS[provider] || LLM_PROVIDER_OPTIONS.openai;
    setLLMSetupError('');
    setLLMForm(prev => ({
      ...prev,
      provider,
      model: option.defaultModel,
      baseUrl: option.defaultBaseUrl
    }));
  }, []);

  const handleLLMFormChange = useCallback((key, value) => {
    setLLMSetupError('');
    setLLMForm(prev => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const handleSaveLLMConfig = useCallback(async () => {
    if (!llmForm.apiKey.trim()) {
      const keyLabel = LLM_PROVIDER_OPTIONS[llmForm.provider]?.keyLabel || 'API Key';
      setLLMSetupError(`${keyLabel} 不能为空`);
      return;
    }

    if (!llmForm.model.trim()) {
      setLLMSetupError('模型名称不能为空');
      return;
    }

    setLLMSetupSaving(true);
    setLLMSetupError('');

    try {
      const result = await ipc.saveLLMConfig(llmForm);
      if (!result?.success) {
        setLLMSetupError(result?.error || '保存 LLM 配置失败');
        if (result?.status) {
          setLLMConfigStatus(result.status);
        }
        return;
      }

      setLLMConfigStatus(result.status);
      setShowLLMSetup(false);
      setLLMForm(prev => ({ ...prev, apiKey: '' }));
    } catch (error) {
      setLLMSetupError(error.message || '保存 LLM 配置失败');
    } finally {
      setLLMSetupSaving(false);
    }
  }, [ipc, llmForm]);

  const formatEnvPath = useCallback((path) => {
    if (!path) return '~/.config/ai-engineering-mastery-agent/.env';
    return path.replace(/^\/Users\/[^/]+/, '~');
  }, []);

  const handleInsertText = useCallback((text) => {
    setChatInput(text);
    setShowSuggestions(text.trimStart().startsWith('/'));
    chatInputRef.current?.focus();
  }, []);

  const handleRestoreHistory = useCallback((item) => {
    const session = findAgentSession(item?.sessionId);
    if (!session?.messages?.length) {
      handleInsertText(item?.input || '');
      return;
    }

    setActiveAgentSessionId(session.id);
    runtime.restoreMessages(session.messages);
    setSidebarCollapsed(false);
    setActiveTab('agent');
    setChatInput('');
    setShowSuggestions(false);
  }, [handleInsertText, runtime]);

  const handleClearAgentHistory = useCallback(() => {
    localStorage.removeItem(AGENT_HISTORY_STORAGE_KEY);
    localStorage.removeItem(AGENT_SESSIONS_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_AGENT_SESSION_STORAGE_KEY);
    skipNextSessionPersistRef.current = true;
    setActiveAgentSessionId(createAgentSessionId());
    window.dispatchEvent(new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, {
      detail: []
    }));
  }, []);
  
  // ================== Codex 风格菜单处理 ==================
  
  const handleMenuClick = useCallback((label) => {
    setActiveMenu(activeMenu === label ? null : label);
  }, [activeMenu]);
  
  const handleMenuItemClick = useCallback(async (item) => {
    setActiveMenu(null);

    switch (item.command) {
      case 'newTask':
        handleNewTask();
        break;
      case 'changeWorkspace':
        await handleWorkingDirectoryChange();
        break;
      case 'saveSession':
        handleSaveTask();
        break;
      case 'exportConversation':
        handleExport();
        break;
      case 'quit':
        ipc.closeWindow();
        break;
      case 'toggleSidebar':
        setSidebarCollapsed(prev => !prev);
        break;
      case 'toggleSummary':
        setSummaryPanelVisible(prev => !prev);
        break;
      case 'togglePreview':
        setPreviewVisible(prev => !prev);
        break;
      case 'showAgent':
        setSidebarCollapsed(false);
        setActiveTab('agent');
        break;
      case 'showTools':
        setSidebarCollapsed(false);
        setActiveTab('tools');
        break;
      case 'focusInput':
        chatInputRef.current?.focus();
        break;
      case 'stopAgent':
        await runtime.stop();
        break;
      case 'clearConversation':
        handleNewTask();
        break;
      case 'showHistory':
        setSidebarCollapsed(false);
        setActiveTab('agent');
        break;
      case 'insertDocSearch':
        handleInsertText('/doc search ');
        break;
      case 'openModelConfig':
        setShowLLMSetup(true);
        break;
      case 'insertCommand':
        handleInsertText(item.value || '');
        break;
      case 'refreshProjectTree':
        await handleProjectTreeRefresh();
        break;
      case 'refreshRagDocs':
        await refreshRagDocuments();
        break;
      case 'startPreview':
        await handleStartPreview('.');
        break;
      case 'openDocs':
        await ipc.openExternal?.(`${REPOSITORY_URL}#readme`);
        break;
      case 'openIssues':
        await ipc.openExternal?.(`${REPOSITORY_URL}/issues`);
        break;
      case 'showShortcuts':
        window.alert('快捷键\n\nCtrl+Enter: 发送/聚焦输入\nCtrl+B: 切换侧边栏\nCtrl+Shift+S: 切换 RAG 面板\nCtrl+T: 工具面板\nCtrl+.: 停止执行');
        break;
      case 'showAbout':
        window.alert(`AI Agent Desktop\n\nVersion: ${platformInfo?.version || '1.0.15'}\nWorkspace: ${workingDirectory || '未设置'}`);
        break;
      default:
        break;
    }
  }, [
    handleExport,
    handleInsertText,
    handleNewTask,
    handleProjectTreeRefresh,
    handleSaveTask,
    handleStartPreview,
    handleWorkingDirectoryChange,
    ipc,
    platformInfo,
    refreshRagDocuments,
    runtime,
    workingDirectory
  ]);
  
  // 点击菜单外部关闭菜单
  useEffect(() => {
    const handleClickOutside = () => {
      if (activeMenu !== null) {
        setActiveMenu(null);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [activeMenu]);
  
  // ================== 聊天输入处理 ==================
  
  const handleSendMessage = useCallback(async () => {
    const input = chatInput.trim();
    if (!input || runtime.status === 'running') {
      return;
    }
    
    try {
      let sessionId = activeAgentSessionId;
      if (!sessionId) {
        sessionId = createAgentSessionId();
        setActiveAgentSessionId(sessionId);
      }

      saveAgentInputHistory(input, sessionId);
      const result = await runtime.processInput(input, agentOptions);
      if (result?.command === '/debug' && typeof result.debug === 'boolean') {
        setAgentOptions(prev => ({
          ...prev,
          debug: result.debug
        }));
      }
      if (result?.command === '/preview' && result.url) {
        setPreviewSession(result);
        setPreviewVisible(true);
        setPreviewStatus('ready');
        setPreviewFrameKey(prev => prev + 1);
      }
      setChatInput('');
    } catch (error) {
      console.error('[App] 发送消息失败:', error);
    }
  }, [activeAgentSessionId, agentOptions, chatInput, runtime]);
  
  // 命令提示相关
  const handleChatInputChange = useCallback((value) => {
    setChatInput(value);
    setShowSuggestions(value.trimStart().startsWith('/'));
  }, []);
  
  const handleCommandSelect = useCallback((command) => {
    setChatInput(command);
    setShowSuggestions(false);
    chatInputRef.current?.focus();
  }, []);

  const handleSuggestionsClose = useCallback(() => {
    setShowSuggestions(false);
  }, []);
  
  const handleChatKeyDown = useCallback((e) => {
    // Ctrl+Enter 发送消息
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSendMessage();
    }
    // 隐藏命令提示当按下 Escape 或 Enter(非 Ctrl)
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.ctrlKey && !showSuggestions)) {
      setShowSuggestions(false);
    }
  }, [handleSendMessage, showSuggestions]);
  
  // 渲染侧边栏内容
  const renderSidebarContent = () => {
    switch (activeTab) {
      case 'agent':
        return (
          <AgentControl
            runtime={runtime}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            agentOptions={agentOptions}
            onOptionsChange={setAgentOptions}
            onInsertText={handleInsertText}
            onRestoreHistory={handleRestoreHistory}
            onClearHistory={handleClearAgentHistory}
            projectTree={{
              directoryChildren,
              expandedDirectories,
              loadingDirectories,
              status: projectTreeStatus,
              error: projectTreeError,
              onToggleDirectory: handleProjectDirectoryToggle,
              onRefresh: handleProjectTreeRefresh
            }}
          />
        );
      
      case 'tools':
        return (
          <ToolPanel
            tools={runtime.tools}
            loading={runtime.loading}
            messages={runtime.messages}
          />
        );
      
      default:
        return null;
    }
  };

  // ================== 渲染摘要面板 (Codex Style) ==================
  const renderSummaryPanel = () => {
    if (!summaryPanelVisible) return null;

    // RAG 初始化与文档管理面板
    return (
      <aside style={styles.summaryPanel}>
        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>⚙️ RAG 初始化</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            使用检索增强生成（RAG）之前，请上传/选择要索引的文档，并执行索引初始化。
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button
              style={styles.button}
              onClick={async () => {
                try {
                  if (!window.electronAPI) return;
                  const result = await window.electronAPI.openFileDialog({ properties: ['openFile', 'multiSelections'] });
                  const paths = result?.filePaths || result || [];
                  const files = (paths || []).map(p => ({
                    name: getDocumentDisplayName(p),
                    path: p,
                    indexed: false,
                  }));
                  setRagDocs(prev => mergeRagDocuments(prev, files));
                } catch (err) {
                  console.error('选择文件失败', err);
                }
              }}
            >上传文档</button>

            <button
              style={styles.button}
              onClick={async () => {
                if (ragDocs.length === 0) return;
                setRagStatus('indexing');
                setRagIndexProgress(0);
                try {
                  const paths = ragDocs.map(d => d.path);
                  if (ipc.processInput) {
                    const result = await ipc.processInput('init_rag', { docs: paths });
                    const indexedDocs = normalizeRagDocuments(result?.documents || []);
                    if (indexedDocs.length > 0) {
                      setRagDocs(prev => mergeRagDocuments(prev, indexedDocs));
                    }
                    await refreshRagDocuments();
                  }
                  setRagStatus('ready');
                  setRagIndexProgress(100);
                } catch (err) {
                  console.error('RAG 初始化失败', err);
                  setRagStatus('error');
                }
              }}
            >初始化索引</button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ fontSize: '12px' }}>状态:</div>
            <div style={{ fontSize: '12px', fontWeight: 600 }}>{ragStatus}</div>
          </div>
        </div>

        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>📁 已加载文档</div>
          {ragDocs.length === 0 ? (
            <div style={{ ...styles.summaryItem, ...styles.summaryItemEmpty }}>尚未上传文档</div>
          ) : (
            ragDocs.map((doc, i) => (
              <div key={i} style={{ ...styles.summaryItem, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={styles.summaryItemIcon}>📄</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-color)' }}>{doc.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{doc.path}</div>
                </div>
                <button
                  style={styles.button}
                  onClick={async () => {
                    if (doc.indexed && doc.id && ipc.processInput) {
                      await ipc.processInput(`/doc clear ${doc.id}`);
                      await refreshRagDocuments();
                      return;
                    }
                    setRagDocs(prev => prev.filter((_, idx) => idx !== i));
                  }}
                >移除</button>
              </div>
            ))
          )}
        </div>

        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>📌 操作</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              style={styles.button}
              onClick={() => {
                // 用文档搜索命令初始化提示
                setChatInput('/doc search ');
                chatInputRef.current?.focus();
              }}
            >快速创建文档搜索命令</button>
            <button
              style={styles.button}
              onClick={async () => {
                try {
                  if (ipc.processInput) {
                    await ipc.processInput('/doc clear');
                  }
                } catch (error) {
                  console.error('清空 RAG 索引失败', error);
                } finally {
                  setRagDocs([]);
                  setRagStatus('idle');
                  setRagIndexProgress(0);
                }
              }}
            >重置 RAG</button>
          </div>
        </div>
      </aside>
    );
  };

  const renderPreviewPanel = () => {
    if (!previewVisible) return null;

    return (
      <aside style={styles.previewPanel}>
        <div style={styles.previewHeader}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>预览</div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-dark)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {previewSession?.url || (previewStatus === 'starting' ? '正在启动...' : '尚未启动')}
            </div>
          </div>
          <button
            style={styles.button}
            onClick={() => setPreviewFrameKey(prev => prev + 1)}
            disabled={!previewSession?.url}
          >刷新</button>
          <button
            style={styles.button}
            onClick={() => previewSession?.url && ipc.openExternal?.(previewSession.url)}
            disabled={!previewSession?.url}
          >浏览器</button>
          {previewSession?.session_id ? (
            <button style={styles.button} onClick={handleStopPreview}>停止</button>
          ) : (
            <button style={styles.button} onClick={() => handleStartPreview('.')}>启动</button>
          )}
          <button style={styles.button} onClick={() => setPreviewVisible(false)}>关闭</button>
        </div>

        {previewSession?.url ? (
          <iframe
            key={previewFrameKey}
            title="workspace-preview"
            src={previewSession.url}
            style={styles.previewFrame}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          />
        ) : (
          <div style={{
            padding: '18px',
            color: previewStatus === 'error' ? 'var(--error-color)' : 'var(--text-muted)',
            fontSize: '13px'
          }}>
            {previewStatus === 'error'
              ? '预览启动失败，请查看对话中的错误消息。'
              : '点击启动，或在对话里输入 /preview index.html。'}
          </div>
        )}
      </aside>
    );
  };
  
  const shouldReserveMacTrafficLightSpace = platformInfo?.isMac
    && !windowState.isFullScreen
    && !windowState.isMaximized;
  
  return (
    <div style={styles.container}>
      {/* 顶部菜单栏 */}
      <header style={{
        ...styles.menuBar,
        paddingLeft: shouldReserveMacTrafficLightSpace ? '86px' : '12px'
      }}>
        {/* Logo */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          marginRight: '12px',
          fontSize: '14px',
          fontWeight: '700',
          color: 'var(--primary-color)'
        }}>
          <span style={{
            width: '28px',
            height: '28px',
            borderRadius: '7px',
            backgroundColor: 'var(--primary-soft)',
            border: '1px solid rgba(76, 201, 240, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: '750'
          }}>AI</span>
          AI Agent
        </div>
        
        {/* 菜单 */}
        {MENU_ITEMS.map((menu) => (
          <div key={menu.label} style={{ position: 'relative' }}>
            <button
              style={{
                ...styles.menuItem,
                ...(activeMenu === menu.label ? styles.menuItemActive : {})
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleMenuClick(menu.label);
              }}
              onMouseEnter={(e) => {
                if (activeMenu !== null) {
                  e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                  e.currentTarget.style.color = 'var(--text-color)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeMenu !== menu.label) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {menu.label}
            </button>
            
            {/* 下拉菜单 */}
            {activeMenu === menu.label && (
              <div style={styles.menuDropdown} onClick={(e) => e.stopPropagation()}>
                {menu.items.map((item, index) => {
                  if (item.type === 'divider') {
                    return <div key={index} style={styles.menuDivider} />;
                  }
                  return (
                    <button
                      key={index}
                      style={styles.menuDropdownItem}
                      onClick={() => handleMenuItemClick(item)}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span style={styles.menuDropdownShortcut}>{item.shortcut}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        
        {/* 右侧状态 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: '500',
            backgroundColor: runtime.status === 'running' 
              ? 'rgba(246, 200, 95, 0.12)' 
              : 'rgba(93, 211, 158, 0.12)',
            border: `1px solid ${runtime.status === 'running' 
              ? 'rgba(246, 200, 95, 0.28)' 
              : 'rgba(93, 211, 158, 0.28)'}`,
            color: runtime.status === 'running' 
              ? 'var(--warning-color)' 
              : 'var(--success-color)'
          }}>
            <span>{runtime.status === 'running' ? '⚡' : '✓'}</span>
            <span>{runtime.status === 'running' ? '运行中' : '就绪'}</span>
          </div>
          
          {/* 窗口控制按钮 (非 Mac) */}
          {!platformInfo?.isMac && (
            <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
              <button 
                style={{...styles.menuItem, width: '32px', height: '32px', padding: 0}}
                onClick={handleMinimize}
                title="最小化"
              >−</button>
              <button 
                style={{...styles.menuItem, width: '32px', height: '32px', padding: 0}}
                onClick={handleMaximize}
                title="最大化"
              >□</button>
              <button 
                style={{...styles.menuItem, width: '32px', height: '32px', padding: 0, color: 'var(--error-color)'}}
                onClick={handleClose}
                title="关闭"
              >×</button>
            </div>
          )}
        </div>
      </header>
      
      {/* 主体内容 */}
      <main style={styles.mainContent}>
        {/* 左侧工具面板 */}
        <aside style={{
          ...styles.leftSidebar,
          ...(sidebarCollapsed ? styles.leftSidebarCollapsed : {})
        }}>
          {/* 标签导航 */}
          <div style={styles.tabNav}>
            <button
              style={{
                ...styles.tabButton,
                ...(activeTab === 'agent' ? styles.tabButtonActive : {})
              }}
              onClick={() => setActiveTab('agent')}
            >
              Agent
            </button>
            <button
              style={{
                ...styles.tabButton,
                ...(activeTab === 'tools' ? styles.tabButtonActive : {})
              }}
              onClick={() => setActiveTab('tools')}
            >
              工具
            </button>
          </div>
          
          {/* 侧边栏内容 */}
          {!sidebarCollapsed && renderSidebarContent()}
        </aside>
        
        {/* 聊天区域 */}
        <div style={styles.chatArea}>
          {/* 聊天头部 */}
          <div style={styles.chatHeader}>
            <div style={styles.chatTitle}>
              <span>💬</span>
              <span>对话</span>
              <span style={{ 
                fontSize: '12px', 
                fontWeight: '400', 
                color: 'var(--text-muted)',
                marginLeft: '8px'
              }}>
                {runtime.messages.length} 条消息
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                style={styles.tabButton}
                onClick={() => setSummaryPanelVisible(prev => !prev)}
                title="切换摘要面板"
              >
                📊 {summaryPanelVisible ? '隐藏' : '显示'}面板
              </button>
              <button
                style={styles.tabButton}
                onClick={runtime.clearMessages}
                title="清除对话"
              >
                🗑️ 清除
              </button>
            </div>
          </div>
          
          {/* 消息列表 */}
          <div style={styles.messageContainer}>
            <MessageLog
              messages={runtime.messages}
              status={runtime.status}
              onClear={runtime.clearMessages}
            />
          </div>
          
          {/* 输入区域 */}
          <div style={styles.inputArea}>
            <div style={styles.inputWrapper}>
              {/* 命令提示 */}
              {showSuggestions && (
                <CommandSuggestions
                  input={chatInput}
                  tools={runtime.tools}
                  onSelect={handleCommandSelect}
                  onClose={handleSuggestionsClose}
                />
              )}
              
              <textarea
                ref={chatInputRef}
                style={{
                  ...styles.inputTextarea,
                  ...(inputFocused ? styles.inputTextareaFocused : {})
                }}
                value={chatInput}
                onChange={(e) => handleChatInputChange(e.target.value)}
                onKeyDown={handleChatKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="输入消息... (Ctrl+Enter 发送 | 输入 / 查看命令)"
                disabled={runtime.status === 'running'}
              />
              <button
                style={{
                  ...styles.sendButton,
                  ...(runtime.status === 'running' || !chatInput.trim() 
                    ? styles.sendButtonDisabled 
                    : {})
                }}
                onClick={handleSendMessage}
                disabled={runtime.status === 'running' || !chatInput.trim()}
                title="发送消息 (Ctrl+Enter)"
              >
                ↑
              </button>
            </div>
            <div style={styles.inputHint}>
              按 <kbd style={{
                padding: '2px 5px',
                borderRadius: '3px',
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-subtle)',
                fontSize: '10px'
              }}>Ctrl+Enter</kbd> 发送 | 输入 <kbd style={{
                padding: '2px 5px',
                borderRadius: '3px',
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-subtle)',
                fontSize: '10px'
              }}>/技能名</kbd> 快速调用技能
            </div>
          </div>
        </div>
        
        {renderPreviewPanel()}

        {/* 右侧摘要面板 (Codex Style) */}
        {renderSummaryPanel()}
      </main>
      
      {/* 底部状态栏 */}
      <footer style={styles.footer}>
        <StatusBar
          status={runtime.status}
          workingDirectory={workingDirectory}
          toolCount={runtime.tools.length}
          isConnected={ipc.isConnected}
          stats={runtime.stats}
        />
      </footer>

      {/* LLM 首次配置引导 */}
      {showLLMSetup && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>配置模型服务</h2>
              <p style={styles.modalSubtitle}>
                Desktop 需要 LLM 配置后才能执行 Agent 任务。配置会保存到 CLI 共用的用户 .env 文件中。
              </p>
            </div>

            <div style={styles.modalBody}>
              <div style={styles.formRow}>
                <label style={styles.formLabel}>模型提供商</label>
                <select
                  style={styles.formInput}
                  value={llmForm.provider}
                  onChange={(event) => handleLLMProviderChange(event.target.value)}
                  disabled={llmSetupSaving}
                >
                  {Object.entries(LLM_PROVIDER_OPTIONS).map(([value, option]) => (
                    <option key={value} value={value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.formRow}>
                <label style={styles.formLabel}>
                  {LLM_PROVIDER_OPTIONS[llmForm.provider]?.keyLabel || 'API Key'}
                </label>
                <input
                  style={styles.formInput}
                  type="password"
                  value={llmForm.apiKey}
                  onChange={(event) => handleLLMFormChange('apiKey', event.target.value)}
                  placeholder="输入 API Key"
                  disabled={llmSetupSaving}
                />
              </div>

              <div style={styles.formRow}>
                <label style={styles.formLabel}>模型名称</label>
                <input
                  style={styles.formInput}
                  value={llmForm.model}
                  onChange={(event) => handleLLMFormChange('model', event.target.value)}
                  placeholder={LLM_PROVIDER_OPTIONS[llmForm.provider]?.defaultModel}
                  disabled={llmSetupSaving}
                />
              </div>

              <div style={styles.formRow}>
                <label style={styles.formLabel}>Base URL</label>
                <input
                  style={styles.formInput}
                  value={llmForm.baseUrl}
                  onChange={(event) => handleLLMFormChange('baseUrl', event.target.value)}
                  placeholder={LLM_PROVIDER_OPTIONS[llmForm.provider]?.defaultBaseUrl}
                  disabled={llmSetupSaving}
                />
              </div>

              {llmSetupError && (
                <div style={styles.formError}>{llmSetupError}</div>
              )}
            </div>

            <div style={styles.modalFooter}>
              <div style={styles.formHint}>
                保存位置: {formatEnvPath(llmConfigStatus?.userEnvPath)}
              </div>
              <div style={styles.modalActions}>
                <button
                  style={styles.textButton}
                  onClick={() => setShowLLMSetup(false)}
                  disabled={llmSetupSaving}
                >
                  稍后配置
                </button>
                <button
                  style={styles.primaryAction}
                  onClick={handleSaveLLMConfig}
                  disabled={llmSetupSaving}
                >
                  {llmSetupSaving ? '保存中...' : '保存并启用'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
