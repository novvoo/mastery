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
import { formatPreviewUrlInput, normalizePreviewUrlInput } from './preview-url.js';
import './index.css';

// Codex 2026 风格布局常量
const LAYOUT = {
  activityRailWidth: 52,
  sidebarWidth: 300,
  inspectorPanelWidth: 380,
  inspectorMinWidth: 320,
  inspectorMaxWidth: 860,
  inspectorExpandedWidth: 720,
  headerHeight: 44,
  inputAreaHeight: 140,
};

const REPOSITORY_URL = 'https://github.com/novvoo/ai-engineering-mastery-agent';
const PROJECT_TREE_REFRESH_CONCURRENCY = 12;
const AGENT_HISTORY_STORAGE_KEY = 'agentHistory';
const AGENT_HISTORY_UPDATED_EVENT = 'agent-history-updated';
const AGENT_SESSIONS_STORAGE_KEY = 'agentConversationSessions';
const ACTIVE_AGENT_SESSION_STORAGE_KEY = 'activeAgentConversationSessionId';
const DESKTOP_LAYOUT_STORAGE_KEY = 'desktopWorkbenchLayout';
const AGENT_SESSIONS_UPDATED_EVENT = 'agent-sessions-updated';
const PREVIEW_URL_STORAGE_KEY = 'desktopPreviewUrl';
const MAX_AGENT_HISTORY_ITEMS = 50;
const MAX_AGENT_SESSIONS = 50;

function readDesktopLayout() {
  try {
    const raw = localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredPreviewUrl() {
  try {
    return normalizePreviewUrlInput(localStorage.getItem(PREVIEW_URL_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readStoredInspectorTab() {
  const tab = readDesktopLayout().activeInspectorTab;
  return ['rag', 'preview'].includes(tab) ? tab : 'rag';
}

function clampInspectorWidth(width) {
  const viewportLimit = typeof window === 'undefined'
    ? LAYOUT.inspectorMaxWidth
    : Math.max(LAYOUT.inspectorMinWidth, Math.min(LAYOUT.inspectorMaxWidth, Math.floor(window.innerWidth * 0.72)));
  const numericWidth = Number(width) || LAYOUT.inspectorPanelWidth;
  return Math.max(LAYOUT.inspectorMinWidth, Math.min(viewportLimit, numericWidth));
}

function createAgentErrorPrompt(message) {
  const content = String(message?.content || message?.message || message?.details || '').trim();
  const payload = message?.payload || message?.raw;
  const payloadText = payload
    ? `\n\n附加上下文:\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`
    : '';
  return `请帮我分析并修复下面这个错误。请先判断信息是否足够；如果不够，明确说明还缺什么；如果足够，请给出原因、修复步骤和需要验证的命令。\n\n错误信息:\n${content || '(无错误文本)'}${payloadText}`;
}

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

  activityRail: {
    width: `${LAYOUT.activityRailWidth}px`,
    flexShrink: 0,
    backgroundColor: '#0b0f15',
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 6px',
    gap: '6px'
  },

  activityButton: {
    width: '38px',
    height: '38px',
    borderRadius: '8px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-dark)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0
  },

  activityButtonActive: {
    backgroundColor: 'var(--primary-soft)',
    border: '1px solid rgba(76, 201, 240, 0.24)',
    color: 'var(--primary-color)'
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

  sidebarHeader: {
    minHeight: '42px',
    padding: '0 12px',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    backgroundColor: '#141922'
  },

  sidebarTitle: {
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase'
  },
  
  // ================== 右侧 Inspector 面板 ==================
  summaryPanel: {
    backgroundColor: 'var(--surface-color)',
    borderLeft: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative'
  },

  inspectorResizeHandle: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '6px',
    cursor: 'col-resize',
    zIndex: 2,
    backgroundColor: 'transparent'
  },

  inspectorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: '#141922'
  },

  previewHeader: {
    minHeight: '42px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  inspectorTabs: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
    gap: '4px',
    minWidth: 0
  },

  inspectorTab: {
    height: '30px',
    borderRadius: '6px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700'
  },

  inspectorTabActive: {
    backgroundColor: 'var(--surface-hover)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-color)'
  },

  iconButton: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flex: '0 0 auto'
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
  
  // ================== 通用标签按钮 ==================
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

  headerActionButton: {
    height: '32px',
    padding: '0 12px',
    borderRadius: '6px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap'
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
  const [showSettings, setShowSettings] = useState(false);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Boolean(readDesktopLayout().sidebarCollapsed));
  const [summaryPanelVisible, setSummaryPanelVisible] = useState(() => Boolean(readDesktopLayout().summaryPanelVisible));
  const [activeInspectorTab, setActiveInspectorTab] = useState(readStoredInspectorTab);
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(() => clampInspectorWidth(readDesktopLayout().inspectorPanelWidth));
  const [inspectorExpanded, setInspectorExpanded] = useState(() => Boolean(readDesktopLayout().inspectorExpanded));
  const [chatInput, setChatInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [agentOptions, setAgentOptions] = useState({
    debug: false,
    maxIterations: 60,
    autoSave: true
  });
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(() => (
    localStorage.getItem(ACTIVE_AGENT_SESSION_STORAGE_KEY) || createAgentSessionId()
  ));
  const [sessions, setSessions] = useState([]);
  
  // RAG (Retrieval-Augmented Generation) 面板状态
  const [ragDocs, setRagDocs] = useState([]); // { name, path }
  const [ragStatus, setRagStatus] = useState('idle'); // idle | indexing | ready | error
  const [ragIndexProgress, setRagIndexProgress] = useState(0);
  const [directoryChildren, setDirectoryChildren] = useState({});
  const [expandedDirectories, setExpandedDirectories] = useState(() => new Set(['']));
  const [loadingDirectories, setLoadingDirectories] = useState(() => new Set());
  const [projectTreeStatus, setProjectTreeStatus] = useState('idle');
  const [projectTreeError, setProjectTreeError] = useState('');
  const [previewSession, setPreviewSession] = useState(null);
  const [previewStatus, setPreviewStatus] = useState('idle');
  const [previewFrameKey, setPreviewFrameKey] = useState(0);
  const [activePreviewUrl, setActivePreviewUrl] = useState(readStoredPreviewUrl);
  const [previewUrlDraft, setPreviewUrlDraft] = useState(() => {
    const storedUrl = readStoredPreviewUrl();
    return storedUrl ? formatPreviewUrlInput(storedUrl) : '';
  });
  
  // 使用自定义 Hooks
  const runtime = useRuntime();
  const ipc = useIPC();
  const chatInputRef = useRef(null);
  const workspaceRefreshTimerRef = useRef(null);
  const directoryChildrenRef = useRef(directoryChildren);
  const skipNextSessionPersistRef = useRef(false);
  const inspectorResizeRef = useRef(null);

  useEffect(() => {
    directoryChildrenRef.current = directoryChildren;
  }, [directoryChildren]);

  useEffect(() => {
    localStorage.setItem(DESKTOP_LAYOUT_STORAGE_KEY, JSON.stringify({
      sidebarCollapsed,
      summaryPanelVisible,
      activeInspectorTab,
      inspectorPanelWidth,
      inspectorExpanded
    }));
  }, [activeInspectorTab, inspectorExpanded, inspectorPanelWidth, sidebarCollapsed, summaryPanelVisible]);

  useEffect(() => {
    if (!activePreviewUrl) return;
    localStorage.setItem(PREVIEW_URL_STORAGE_KEY, activePreviewUrl);
  }, [activePreviewUrl]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_AGENT_SESSION_STORAGE_KEY, activeAgentSessionId);
  }, [activeAgentSessionId]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = inspectorResizeRef.current;
      if (!resizeState) {
        return;
      }
      const nextWidth = resizeState.startWidth + (resizeState.startX - event.clientX);
      setInspectorPanelWidth(clampInspectorWidth(nextWidth));
      setInspectorExpanded(false);
    };

    const handlePointerUp = () => {
      inspectorResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const activeSession = findAgentSession(activeAgentSessionId);
    if (activeSession?.messages?.length) {
      runtime.restoreMessages(activeSession.messages);
    }
  }, []);

  // 同步会话列表
  useEffect(() => {
    const syncSessions = () => {
      setSessions(readAgentSessions());
    };
    syncSessions();
    window.addEventListener(AGENT_SESSIONS_UPDATED_EVENT, syncSessions);
    window.addEventListener(AGENT_HISTORY_UPDATED_EVENT, syncSessions);
    return () => {
      window.removeEventListener(AGENT_SESSIONS_UPDATED_EVENT, syncSessions);
      window.removeEventListener(AGENT_HISTORY_UPDATED_EVENT, syncSessions);
    };
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
    window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
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

  const followPreviewUrl = useCallback((url) => {
    const normalizedUrl = normalizePreviewUrlInput(url);
    if (!normalizedUrl) return;
    setActivePreviewUrl(normalizedUrl);
    setPreviewUrlDraft(formatPreviewUrlInput(normalizedUrl));
  }, []);

  const handleStartPreview = useCallback(async (target = '.') => {
    if (!ipc.startPreview) {
      return null;
    }

    setPreviewStatus('starting');
    setSummaryPanelVisible(true);
    setActiveInspectorTab('preview');
    try {
      const preview = await ipc.startPreview({ target, kind: 'auto' });
      setPreviewSession(preview);
      followPreviewUrl(preview.url);
      setPreviewStatus('ready');
      setSummaryPanelVisible(true);
      setActiveInspectorTab('preview');
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
  }, [followPreviewUrl, ipc, runtime]);

  const handleStopPreview = useCallback(async () => {
    if (!previewSession?.session_id || !ipc.stopPreview) {
      return;
    }

    await ipc.stopPreview(previewSession.session_id);
    setPreviewSession(null);
    setPreviewStatus('idle');
  }, [ipc, previewSession]);

  const handlePreviewUrlSubmit = useCallback((event) => {
    event.preventDefault();
    const normalizedUrl = normalizePreviewUrlInput(previewUrlDraft);
    if (!normalizedUrl) {
      setPreviewStatus('error');
      return;
    }
    setPreviewStatus('ready');
    setActivePreviewUrl(normalizedUrl);
    setPreviewUrlDraft(formatPreviewUrlInput(normalizedUrl));
    setPreviewFrameKey(prev => prev + 1);
  }, [previewUrlDraft]);

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
        followPreviewUrl(previews[0].url);
        setSummaryPanelVisible(true);
        setActiveInspectorTab('preview');
        setPreviewStatus('ready');
      }
    }).catch(() => {});

    if (ipc.onPreviewStarted) {
      unsubscribeStarted = ipc.onPreviewStarted(preview => {
        setPreviewSession(preview);
        followPreviewUrl(preview.url);
        setSummaryPanelVisible(true);
        setActiveInspectorTab('preview');
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
  }, [followPreviewUrl, ipc.isConnected, ipc.listPreviews, ipc.onPreviewStarted, ipc.onPreviewStopped, previewSession?.session_id]);
  
  // 处理新建任务
  const handleNewTask = useCallback(() => {
    setActiveAgentSessionId(createAgentSessionId());
    runtime.clearMessages();
    setChatInput('');
  }, [runtime]);

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
            sessions={sessions}
            activeSessionId={activeAgentSessionId}
            onSwitchSession={handleRestoreHistory}
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

  const handleSubmitAgentInput = useCallback(async (rawInput, options = {}) => {
    const input = String(rawInput || '').trim();
    if (!input || runtime.status === 'running') {
      if (input && options.keepWhenBusy !== false) {
        setChatInput(input);
        chatInputRef.current?.focus();
      }
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
        followPreviewUrl(result.url);
        setSummaryPanelVisible(true);
        setActiveInspectorTab('preview');
        setPreviewStatus('ready');
        setPreviewFrameKey(prev => prev + 1);
      }
      if (options.clearInput !== false) {
        setChatInput('');
      }
    } catch (error) {
      console.error('[App] 发送消息失败:', error);
    }
  }, [activeAgentSessionId, agentOptions, followPreviewUrl, runtime]);

  const handleSendMessage = useCallback(async () => {
    await handleSubmitAgentInput(chatInput);
  }, [chatInput, handleSubmitAgentInput]);

  const handleAskAgentFromMessage = useCallback(async (message) => {
    const prompt = createAgentErrorPrompt(message);
    await handleSubmitAgentInput(prompt);
  }, [handleSubmitAgentInput]);

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

  const handleInspectorResizeStart = useCallback((event) => {
    event.preventDefault();
    inspectorResizeRef.current = {
      startX: event.clientX,
      startWidth: inspectorPanelWidth
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [inspectorPanelWidth]);

  const handleInspectorExpandToggle = useCallback(() => {
    setInspectorPanelWidth(prev => {
      if (inspectorExpanded) {
        return clampInspectorWidth(LAYOUT.inspectorPanelWidth);
      }
      return clampInspectorWidth(Math.max(prev, LAYOUT.inspectorExpandedWidth));
    });
    setInspectorExpanded(prev => !prev);
    setSummaryPanelVisible(true);
  }, [inspectorExpanded]);

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


  // ================== 渲染 Inspector 面板 ==================
  const renderSummaryPanel = () => {
    if (!summaryPanelVisible) return null;

    const tabLabels = [
      { id: 'rag', label: 'RAG' },
      { id: 'preview', label: 'Preview' }
    ];

    const renderRagTab = () => (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>RAG 初始化</div>
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
          <div style={styles.summarySectionTitle}>已加载文档</div>
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
          <div style={styles.summarySectionTitle}>操作</div>
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
      </div>
    );

    const renderPreviewTab = () => (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
              {activePreviewUrl || (previewStatus === 'starting' ? '正在启动...' : '尚未启动')}
            </div>
          </div>
          <button
            style={styles.button}
            onClick={() => setPreviewFrameKey(prev => prev + 1)}
            disabled={!activePreviewUrl}
          >刷新</button>
          <button
            style={styles.button}
            onClick={() => activePreviewUrl && ipc.openExternal?.(activePreviewUrl)}
            disabled={!activePreviewUrl}
          >浏览器</button>
          <button
            style={styles.iconButton}
            onClick={handleInspectorExpandToggle}
            title={inspectorExpanded ? '还原预览区域' : '放大预览区域'}
            aria-label={inspectorExpanded ? '还原预览区域' : '放大预览区域'}
          >
            {inspectorExpanded ? '↙' : '⛶'}
          </button>
          {previewSession?.session_id ? (
            <button style={styles.button} onClick={handleStopPreview}>停止</button>
          ) : (
            <button style={styles.button} onClick={() => handleStartPreview('.')}>启动</button>
          )}
        </div>

        <form
          style={{
            display: 'flex',
            gap: '8px',
            padding: '8px 10px',
            borderBottom: '1px solid var(--border-subtle)'
          }}
          onSubmit={handlePreviewUrlSubmit}
        >
          <input
            style={{
              flex: 1,
              minWidth: 0,
              height: '30px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--background-color)',
              color: 'var(--text-color)',
              padding: '0 10px',
              fontSize: '12px'
            }}
            value={previewUrlDraft}
            onChange={(event) => setPreviewUrlDraft(event.target.value)}
            placeholder="127.0.0.1:41730"
          />
          <button style={styles.button} type="submit">前往</button>
        </form>

        {previewSession?.pipeline?.length ? (
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            gap: '6px',
            overflowX: 'auto'
          }}>
            {previewSession.pipeline.map((stage) => (
              <div
                key={`${stage.name}-${stage.command}`}
                title={stage.command}
                style={{
                  flex: '0 0 auto',
                  maxWidth: '180px',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  color: stage.status === 'failed' ? 'var(--error-color)' : 'var(--text-muted)',
                  backgroundColor: stage.status === 'running' ? 'rgba(79, 140, 255, 0.08)' : 'var(--surface-color)',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {stage.name}: {stage.status}
              </div>
            ))}
          </div>
        ) : null}

        {activePreviewUrl ? (
          <iframe
            key={previewFrameKey}
            title="workspace-preview"
            src={activePreviewUrl}
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
      </div>
    );

    return (
      <aside style={{
        ...styles.summaryPanel,
        width: `${inspectorPanelWidth}px`,
        minWidth: `${LAYOUT.inspectorMinWidth}px`,
        maxWidth: `${LAYOUT.inspectorMaxWidth}px`
      }}>
        <div
          style={styles.inspectorResizeHandle}
          onPointerDown={handleInspectorResizeStart}
          title="拖拽调整 Inspector 宽度"
        />
        <div style={styles.inspectorHeader}>
          <div style={styles.inspectorTabs}>
            {tabLabels.map(tab => (
              <button
                key={tab.id}
                style={{
                  ...styles.inspectorTab,
                  ...(activeInspectorTab === tab.id ? styles.inspectorTabActive : {})
                }}
                onClick={() => setActiveInspectorTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            style={styles.iconButton}
            onClick={handleInspectorExpandToggle}
            title={inspectorExpanded ? '还原子窗口宽度' : '放大子窗口'}
            aria-label={inspectorExpanded ? '还原子窗口宽度' : '放大子窗口'}
          >
            {inspectorExpanded ? '↙' : '⛶'}
          </button>
        </div>

        {activeInspectorTab === 'rag' && renderRagTab()}
        {activeInspectorTab === 'preview' && renderPreviewTab()}
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
        paddingLeft: shouldReserveMacTrafficLightSpace ? '86px' : '12px',
        WebkitAppRegion: 'drag'
      }}>
        {/* 切换边栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
          <button
            style={{
              width: '28px', height: '28px', borderRadius: '7px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onClick={() => setSidebarCollapsed(prev => !prev)}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? '☰' : '✕'}
          </button>
        </div>
        
        {/* 右侧状态 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
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
                title={windowState.isMaximized ? '还原' : '最大化'}
              >{windowState.isMaximized ? '❐' : '□'}</button>
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
        <nav style={styles.activityRail} aria-label="工作区导航">
          <button
            style={{
              ...styles.activityButton,
              ...(activeTab === 'agent' && !sidebarCollapsed ? styles.activityButtonActive : {})
            }}
            onClick={() => {
              setActiveTab('agent');
              setSidebarCollapsed(false);
            }}
            title="Agent"
          >
            AG
          </button>
          <button
            style={{
              ...styles.activityButton,
              ...(activeTab === 'tools' && !sidebarCollapsed ? styles.activityButtonActive : {})
            }}
            onClick={() => {
              setActiveTab('tools');
              setSidebarCollapsed(false);
            }}
            title="工具"
          >
            TL
          </button>
          <button
            style={{
              ...styles.activityButton,
              marginTop: 'auto'
            }}
            onClick={() => setShowSettings(prev => !prev)}
            title="设置"
          >
            ⚙️
          </button>
        </nav>

        {!sidebarCollapsed && (
          <aside style={styles.leftSidebar}>
            <div style={styles.sidebarHeader}>
              <span style={styles.sidebarTitle}>{activeTab === 'tools' ? '工具' : '会话'}</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {activeTab !== 'tools' && (
                  <button
                    style={{ ...styles.button, width: '26px', height: '26px', padding: 0, fontSize: '14px' }}
                    onClick={handleNewTask}
                    title="新对话"
                  >
                    +
                  </button>
                )}
                <button
                  style={{ ...styles.button, width: '26px', height: '26px', padding: 0, fontSize: '14px' }}
                  onClick={() => setSidebarCollapsed(true)}
                  title="收起侧边栏"
                >
                  ×
                </button>
              </div>
            </div>
            {renderSidebarContent()}
        </aside>
        )}
        
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
                style={styles.headerActionButton}
                onClick={handleExport}
                title="导出对话"
              >
                导出
              </button>
              <button
                style={styles.headerActionButton}
                onClick={() => {
                  setSummaryPanelVisible(true);
                  setActiveInspectorTab('preview');
                }}
                title="打开预览"
              >
                Preview
              </button>
              <button
                style={styles.headerActionButton}
                onClick={() => setSummaryPanelVisible(prev => !prev)}
                title="切换 Inspector"
              >
                {summaryPanelVisible ? '隐藏' : '显示'} Inspector
              </button>
              <button
                style={styles.headerActionButton}
                onClick={runtime.clearMessages}
                title="清除对话"
              >
                清除
              </button>
            </div>
          </div>
          
          {/* 消息列表 */}
          <div style={styles.messageContainer}>
            <MessageLog
              messages={runtime.messages}
              status={runtime.status}
              onClear={runtime.clearMessages}
              onAskAgent={handleAskAgentFromMessage}
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
        
        {/* 右侧 Inspector 面板 */}
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

                  {/* 设置下拉菜单 */}
      {showSettings && (
        <div style={{
          position: 'fixed', left: '56px', bottom: '44px',
          width: '220px', backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)', borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 1000,
          padding: '8px', fontSize: '12px', color: 'var(--text-color)'
        }}>
          <div style={{padding:'4px 8px 8px',borderBottom:'1px solid var(--border-subtle)',marginBottom:'6px',fontWeight:'700',fontSize:'11px',color:'var(--text-muted)',textTransform:'uppercase'}}>
            ROOT
          </div>

          <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
            onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
            onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
            <input type="checkbox" checked={agentOptions.autoSave}
              onChange={(e)=>setAgentOptions(p=>({...p,autoSave:e.target.checked}))}
              style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
            Auto Save
          </label>

          <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
            onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
            onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
            <input type="checkbox" checked={agentOptions.autoScroll !== false}
              onChange={(e)=>setAgentOptions(p=>({...p,autoScroll:e.target.checked}))}
              style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
            Autoscroll
          </label>

          <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
            onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
            onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
            <input type="checkbox" checked={agentOptions.debug || false}
              onChange={(e)=>setAgentOptions(p=>({...p,debug:e.target.checked}))}
              style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
            Developer Mode
          </label>

          <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
            onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
            onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
            <input type="checkbox" checked={agentOptions.verbose || false}
              onChange={(e)=>setAgentOptions(p=>({...p,verbose:e.target.checked}))}
              style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
            Verbose logging
          </label>

          <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px'}}>
            <span style={{fontSize:'11px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>Max iterations</span>
            <input type="number" value={agentOptions.maxIterations}
              onChange={(e)=>setAgentOptions(p=>({...p,maxIterations:parseInt(e.target.value)||60}))}
              style={{width:'56px',height:'24px',borderRadius:'4px',border:'1px solid var(--border-subtle)',backgroundColor:'#11161e',color:'var(--text-color)',padding:'0 6px',fontSize:'11px'}}
              min={1} max={500}/>
          </div>

          <div style={{borderTop:'1px solid var(--border-subtle)',margin:'6px 0',padding:'6px 8px 0'}}>
            <button style={{width:'100%',height:'28px',borderRadius:'5px',border:'1px solid var(--border-subtle)',backgroundColor:'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:'11px',textAlign:'center'}}
              onClick={()=>{setShowSettings(false);setShowLLMSetup(true);}}
              onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
              onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
              设置...
            </button>
          </div>
        </div>
      )}
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
