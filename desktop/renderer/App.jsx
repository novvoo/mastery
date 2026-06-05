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
import { useRuntime } from './hooks/useRuntime.js';
import { useIPC } from './hooks/useIPC.js';
import './index.css';

// Codex 2026 风格布局常量
const LAYOUT = {
  sidebarWidth: 280,
  summaryPanelWidth: 300,
  headerHeight: 44,
  inputAreaHeight: 140,
};

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
  
  // ================== 聊天区域 ==================
  chatArea: {
    flex: 1,
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
    alignItems: 'flex-end'
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
      { label: '新建任务', shortcut: 'Ctrl+N' },
      { label: '打开任务...', shortcut: 'Ctrl+O' },
      { label: '保存任务', shortcut: 'Ctrl+S' },
      { type: 'divider' },
      { label: '导出对话...', shortcut: 'Ctrl+E' },
      { type: 'divider' },
      { label: '退出', shortcut: 'Ctrl+Q' }
    ]
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', shortcut: 'Ctrl+Z' },
      { label: '重做', shortcut: 'Ctrl+Y' },
      { type: 'divider' },
      { label: '剪切', shortcut: 'Ctrl+X' },
      { label: '复制', shortcut: 'Ctrl+C' },
      { label: '粘贴', shortcut: 'Ctrl+V' },
      { type: 'divider' },
      { label: '全选', shortcut: 'Ctrl+A' }
    ]
  },
  {
    label: '视图',
    items: [
      { label: '切换侧边栏', shortcut: 'Ctrl+B' },
      { label: '切换摘要面板', shortcut: 'Ctrl+Shift+S' },
      { type: 'divider' },
      { label: '放大', shortcut: 'Ctrl++' },
      { label: '缩小', shortcut: 'Ctrl+-' },
      { label: '重置缩放', shortcut: 'Ctrl+0' },
      { type: 'divider' },
      { label: '全屏', shortcut: 'F11' }
    ]
  },
  {
    label: 'Agent',
    items: [
      { label: '开始执行', shortcut: 'Ctrl+Enter' },
      { label: '停止执行', shortcut: 'Ctrl+.' },
      { type: 'divider' },
      { label: '清除对话' },
      { label: '清除历史记录' },
      { type: 'divider' },
      { label: '执行选项...', shortcut: 'Ctrl+,' }
    ]
  },
  {
    label: '技能',
    items: [
      { label: '💡 诊断 (diagnose)', desc: '诊断问题根因' },
      { label: '🔍 审查 (review)', desc: '代码审查' },
      { label: '📝 TDD 测试驱动', desc: 'TDD 开发流程' },
      { label: '🏗️ 架构 (architect)', desc: '系统架构设计' },
      { label: '🎯 汇总 (handoff)', desc: '任务交接' },
      { type: 'divider' },
      { label: '查看所有技能...' }
    ]
  },
  {
    label: '工具',
    items: [
      { label: '🔧 文件系统工具' },
      { label: '🌐 Web 搜索工具' },
      { label: '🔗 Web 获取工具' },
      { label: '🐚 Shell 工具' },
      { label: '📊 代码搜索工具' },
      { type: 'divider' },
      { label: '查看所有工具...', shortcut: 'Ctrl+T' }
    ]
  },
  {
    label: '帮助',
    items: [
      { label: '📖 文档' },
      { label: '⌨️ 快捷键' },
      { label: '🐛 报告问题' },
      { type: 'divider' },
      { label: '🔄 检查更新' },
      { label: 'ℹ️ 关于' }
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
  const [showSettings, setShowSettings] = useState(false);
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
  
  // 使用自定义 Hooks
  const runtime = useRuntime();
  const ipc = useIPC();
  const chatInputRef = useRef(null);
  
  // 初始化
  useEffect(() => {
    let isMounted = true;
    let unsubscribeWindowState = null;

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
      
      // 重新加载工具
      runtime.loadTools();
    }
  }, [ipc, runtime]);
  
  // 处理新建任务
  const handleNewTask = useCallback(() => {
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
  
  // 处理加载任务
  const handleLoadTask = useCallback(() => {
    console.log('[App] 加载任务');
  }, []);
  
  // 处理保存任务
  const handleSaveTask = useCallback(() => {
    console.log('[App] 保存任务');
  }, []);
  
  // 处理导出
  const handleExport = useCallback(() => {
    console.log('[App] 导出');
  }, []);

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
  
  // ================== Codex 风格菜单处理 ==================
  
  const handleMenuClick = useCallback((label) => {
    setActiveMenu(activeMenu === label ? null : label);
  }, [activeMenu]);
  
  const handleMenuItemClick = useCallback((item) => {
    console.log('[App] 菜单项点击:', item.label);
    setActiveMenu(null);
    
    // 根据菜单项执行相应操作
    switch (item.label) {
      case '新建任务':
        handleNewTask();
        break;
      case '保存任务':
        handleSaveTask();
        break;
      case '导出对话...':
        handleExport();
        break;
      case '清除对话':
        runtime.clearMessages();
        break;
      case '切换侧边栏':
        setSidebarCollapsed(prev => !prev);
        break;
      case '切换摘要面板':
        setSummaryPanelVisible(prev => !prev);
        break;
      case '开始执行':
        if (chatInputRef.current) {
          chatInputRef.current.focus();
        }
        break;
      default:
        break;
    }
  }, [handleNewTask, handleSaveTask, handleExport, runtime]);
  
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
    if (!chatInput.trim() || runtime.status === 'running') {
      return;
    }
    
    try {
      await runtime.processInput(chatInput.trim());
      setChatInput('');
    } catch (error) {
      console.error('[App] 发送消息失败:', error);
    }
  }, [chatInput, runtime]);
  
  const handleChatKeyDown = useCallback((e) => {
    // Ctrl+Enter 发送消息
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);
  
  // 渲染侧边栏内容
  const renderSidebarContent = () => {
    switch (activeTab) {
      case 'agent':
        return (
          <AgentControl
            runtime={runtime}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
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
    
    return (
      <aside style={styles.summaryPanel}>
        {/* 当前计划 */}
        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>
            📋 当前计划
          </div>
          {summaryData.plan.length > 0 ? (
            summaryData.plan.map((item, i) => (
              <div key={i} style={styles.summaryItem}>
                <span style={styles.summaryItemIcon}>▶️</span>
                <span style={styles.summaryItemText}>{item}</span>
              </div>
            ))
          ) : (
            <div style={{...styles.summaryItem, ...styles.summaryItemEmpty}}>
              暂无计划
            </div>
          )}
        </div>
        
        {/* 数据来源 */}
        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>
            📚 数据来源
          </div>
          {summaryData.sources.length > 0 ? (
            summaryData.sources.map((source, i) => (
              <div key={i} style={styles.summaryItem}>
                <span style={styles.summaryItemIcon}>
                  {source.type === 'file' ? '📄' : 
                   source.type === 'web' ? '🌐' : 
                   source.type === 'memory' ? '🧠' : '📌'}
                </span>
                <span style={styles.summaryItemText}>{source.name}</span>
              </div>
            ))
          ) : (
            <div style={{...styles.summaryItem, ...styles.summaryItemEmpty}}>
              暂无来源
            </div>
          )}
        </div>
        
        {/* 产出 */}
        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>
            📤 产出
          </div>
          {summaryData.outputs.length > 0 ? (
            summaryData.outputs.map((output, i) => (
              <div key={i} style={styles.summaryItem}>
                <span style={styles.summaryItemIcon}>✅</span>
                <span style={styles.summaryItemText}>{output}</span>
              </div>
            ))
          ) : (
            <div style={{...styles.summaryItem, ...styles.summaryItemEmpty}}>
              暂无产出
            </div>
          )}
        </div>
        
        {/* 快捷技能包 */}
        <div style={styles.summarySection}>
          <div style={styles.summarySectionTitle}>
            🎯 技能包
          </div>
          {Object.entries(SKILL_BUNDLES).map(([category, skills]) => (
            <div key={category} style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-dark)', marginBottom: '6px' }}>
                {category}
              </div>
              {skills.slice(0, 3).map((skill) => (
                <div 
                  key={skill.name} 
                  style={{ 
                    ...styles.summaryItem,
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    setChatInput(`/${skill.name} `);
                    chatInputRef.current?.focus();
                  }}
                >
                  <span style={styles.summaryItemIcon}>{skill.icon}</span>
                  <span style={styles.summaryItemText}>{skill.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
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
              <textarea
                ref={chatInputRef}
                style={{
                  ...styles.inputTextarea,
                  ...(inputFocused ? styles.inputTextareaFocused : {})
                }}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="输入消息... (Ctrl+Enter 发送)"
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
