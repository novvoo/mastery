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
import StatusBar from './components/StatusBar.jsx';
import { SettingsMenu } from './components/SettingsMenu.jsx';
import { LLMSetupModal } from './components/LLMSetupModal.jsx';
import { ActivityRail } from './components/workbench/ActivityRail.jsx';
import { ChatWorkspace } from './components/workbench/ChatWorkspace.jsx';
import { InspectorPanel } from './components/workbench/InspectorPanel.jsx';
import { SidebarPanel } from './components/workbench/SidebarPanel.jsx';
import { TopBar } from './components/workbench/TopBar.jsx';
import { useRuntime } from './hooks/useRuntime.js';
import { useIPC } from './hooks/useIPC.js';
import { formatPreviewUrlInput, normalizePreviewUrlInput } from './preview-url.js';
import { getRuntimeStatusMeta } from './runtime-status.js';
import { LAYOUT, LLM_PROVIDER_OPTIONS } from './app/config.js';
import {
  ACTIVE_AGENT_SESSION_STORAGE_KEY,
  AGENT_HISTORY_STORAGE_KEY,
  AGENT_HISTORY_UPDATED_EVENT,
  AGENT_SESSIONS_STORAGE_KEY,
  AGENT_SESSIONS_UPDATED_EVENT,
  createAgentErrorPrompt,
  clampInspectorWidth,
  createAgentSessionId,
  DESKTOP_LAYOUT_STORAGE_KEY,
  findAgentSession,
  getAgentSessionTitle,
  getDocumentDisplayName,
  mergeRagDocuments,
  normalizeRagDocuments,
  PREVIEW_URL_STORAGE_KEY,
  PROJECT_TREE_REFRESH_CONCURRENCY,
  readAgentSessions,
  readDesktopLayout,
  readStoredInspectorTab,
  readStoredPreviewUrl,
  saveAgentInputHistory,
  upsertAgentSession,
} from './app/session-storage.js';
import { styles } from './app/styles.js';
import { getI18n, t as i18nT } from './i18n.js';
import './index.css';

// Codex 2026 风格布局常量
// 样式定义
// Codex 风格的菜单定义


// 技能包定义 (Codex 2026 Style)
/**
 * 主应用组件
 */
const DESKTOP_THEME_STORAGE_KEY = 'ai-agent-desktop-theme';

function App() {
  // 状态管理
  const [theme, setTheme] = useState(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(DESKTOP_THEME_STORAGE_KEY) : null;
    return stored || 'light';
  });
  const [language, setLanguage] = useState(() => getI18n().getLanguage());
  const [, forceUpdate] = useState(0);
  const [activeTab, setActiveTab] = useState('agent');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [fileServerUrl, setFileServerUrl] = useState('');
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
  
  // Codex 风格新状态 — 默认折叠侧边栏和 Inspector，突出聊天区
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = readDesktopLayout().sidebarCollapsed;
    return stored === undefined ? true : Boolean(stored);
  });
  const [summaryPanelVisible, setSummaryPanelVisible] = useState(() => {
    const stored = readDesktopLayout().summaryPanelVisible;
    return stored === undefined ? false : Boolean(stored);
  });
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
  const runtimeStatusMeta = getRuntimeStatusMeta(runtime.status);
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
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  // I18n 订阅 — 监听语言变化并重新渲染
  useEffect(() => {
    const i18n = getI18n();
    const unsub = i18n.subscribe((lang) => {
      setLanguage(lang);
      forceUpdate((n) => n + 1);
    });
    return unsub;
  }, []);

  const handleLanguageChange = useCallback((lang) => {
    const i18n = getI18n();
    i18n.setLanguage(lang);
    setLanguage(lang);
  }, []);

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
    let unsubscribeMenuAction = null;

    const syncWorkingDirectoryFromEvent = (payload = {}) => {
      const nextDirectory = payload?.path || payload?.workingDirectory || payload;
      if (!isMounted || !nextDirectory) {
        return;
      }

      setWorkingDirectory(nextDirectory);
      ipc.getAppInfo().then(info => {
        if (isMounted && info?.fileServerUrl) {
          setFileServerUrl(info.fileServerUrl);
        }
      }).catch(() => {});
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
      
      // 监听菜单动作事件（来自 Electron 主进程的 app:menuAction）
      unsubscribeMenuAction = ipc.subscribe('app:menuAction', ({ command, ...payload }) => {
        if (!isMounted) return;
        switch (command) {
          case 'stopAgent':
            runtime.stop();
            break;
          case 'focusInput':
            chatInputRef.current?.focus();
            break;
          case 'newTask':
            setChatInput('');
            chatInputRef.current?.focus();
            break;
          case 'clearConversation':
            runtime.clearMessages();
            break;
          case 'insertDocSearch':
            setChatInput('/doc search ');
            chatInputRef.current?.focus();
            break;
          case 'openModelConfig':
            setShowLLMSetup(true);
            break;
          case 'toggleSidebar':
            setSidebarCollapsed(prev => !prev);
            break;
          case 'toggleSummary':
            setSummaryPanelVisible(prev => !prev);
            break;
          case 'showAgent':
            setActiveTab('agent');
            setSidebarCollapsed(false);
            break;
          case 'showTools':
            setActiveTab('tools');
            setSidebarCollapsed(false);
            break;
          case 'insertCommand':
            if (payload?.value) {
              setChatInput(payload.value);
              chatInputRef.current?.focus();
            }
            break;
          default:
            console.log('[App] Unhandled menu action:', command);
        }
      });
      
      // 获取应用信息
      ipc.getAppInfo().then(info => {
        if (!isMounted) {
          return;
        }
        console.log('[App] 应用信息:', info);
        setWorkingDirectory(info.workingDirectory);
        if (info.fileServerUrl) {
          setFileServerUrl(info.fileServerUrl);
        }
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
      if (typeof unsubscribeMenuAction === 'function') {
        unsubscribeMenuAction();
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

  const handleContinueAgentInput = useCallback(async (input) => {
    await handleSubmitAgentInput(input, { clearInput: false });
  }, [handleSubmitAgentInput]);

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

  const handleAddRagDocuments = useCallback(async () => {
    try {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.openFileDialog({ properties: ['openFile', 'multiSelections'] });
      const paths = result?.filePaths || result || [];
      const files = (paths || []).map(path => ({
        name: getDocumentDisplayName(path),
        path,
        indexed: false,
      }));
      setRagDocs(prev => mergeRagDocuments(prev, files));
    } catch (error) {
      console.error('选择文件失败', error);
    }
  }, []);

  const handleInitializeRagIndex = useCallback(async () => {
    if (ragDocs.length === 0) return;
    setRagStatus('indexing');
    setRagIndexProgress(0);
    try {
      const paths = ragDocs.map(doc => doc.path);
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
    } catch (error) {
      console.error('RAG 初始化失败', error);
      setRagStatus('error');
    }
  }, [ipc, ragDocs, refreshRagDocuments]);

  const handleRemoveRagDocument = useCallback(async (doc, index) => {
    if (doc.indexed && doc.id && ipc.processInput) {
      await ipc.processInput(`/doc clear ${doc.id}`);
      await refreshRagDocuments();
      return;
    }
    setRagDocs(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  }, [ipc, refreshRagDocuments]);

  const handleInsertDocSearch = useCallback(() => {
    setChatInput('/doc search ');
    chatInputRef.current?.focus();
  }, []);

  const handleResetRag = useCallback(async () => {
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
  }, [ipc]);

  const handleOpenExternal = useCallback((url) => {
    if (url) {
      ipc.openExternal?.(url);
    }
  }, [ipc]);

  const handleRefreshPreviewFrame = useCallback(() => {
    setPreviewFrameKey(prev => prev + 1);
  }, []);


  return (
    <div style={styles.container}>
      <TopBar
        platformInfo={platformInfo}
        windowState={windowState}
        runtimeStatusMeta={runtimeStatusMeta}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
      />

      <main style={styles.mainContent}>
        <ActivityRail
          activeTab={activeTab}
          sidebarCollapsed={sidebarCollapsed}
          onShowAgent={() => {
            setActiveTab('agent');
            setSidebarCollapsed(false);
          }}
          onShowTools={() => {
            setActiveTab('tools');
            setSidebarCollapsed(false);
          }}
          onToggleSettings={() => setShowSettings(prev => !prev)}
        />

        {!sidebarCollapsed && (
          <SidebarPanel
            activeTab={activeTab}
            runtime={runtime}
            workingDirectory={workingDirectory}
            agentOptions={agentOptions}
            onOptionsChange={setAgentOptions}
            onInsertText={handleInsertText}
            sessions={sessions}
            activeSessionId={activeAgentSessionId}
            onSwitchSession={handleRestoreHistory}
            onRestoreHistory={handleRestoreHistory}
            onClearHistory={handleClearAgentHistory}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            onNewTask={handleNewTask}
            onCollapse={() => setSidebarCollapsed(true)}
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
        )}

        <ChatWorkspace
          runtime={runtime}
          chatInput={chatInput}
          chatInputRef={chatInputRef}
          inputFocused={inputFocused}
          showSuggestions={showSuggestions}
          onAskAgentFromMessage={handleAskAgentFromMessage}
          onChatInputChange={handleChatInputChange}
          onChatKeyDown={handleChatKeyDown}
          onCommandSelect={handleCommandSelect}
          onSuggestionsClose={handleSuggestionsClose}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onSendMessage={handleSendMessage}
          onContinue={handleContinueAgentInput}
          onExport={handleExport}
          onOpenPreview={() => {
            setSummaryPanelVisible(true);
            setActiveInspectorTab('preview');
          }}
          onToggleInspector={() => setSummaryPanelVisible(prev => !prev)}
          summaryPanelVisible={summaryPanelVisible}
          workingDirectory={workingDirectory}
          fileServerUrl={fileServerUrl}
        />

        {summaryPanelVisible && (
          <InspectorPanel
            activeInspectorTab={activeInspectorTab}
            activePreviewUrl={activePreviewUrl}
            inspectorExpanded={inspectorExpanded}
            inspectorPanelWidth={inspectorPanelWidth}
            ipc={ipc}
            previewFrameKey={previewFrameKey}
            previewSession={previewSession}
            previewStatus={previewStatus}
            previewUrlDraft={previewUrlDraft}
            ragDocs={ragDocs}
            ragStatus={ragStatus}
            onAddDocuments={handleAddRagDocuments}
            onExpandToggle={handleInspectorExpandToggle}
            onInitializeIndex={handleInitializeRagIndex}
            onInsertDocSearch={handleInsertDocSearch}
            onOpenExternal={handleOpenExternal}
            onPreviewUrlDraftChange={setPreviewUrlDraft}
            onPreviewUrlSubmit={handlePreviewUrlSubmit}
            onRefreshFrame={handleRefreshPreviewFrame}
            onRemoveDocument={handleRemoveRagDocument}
            onResetRag={handleResetRag}
            onResizeStart={handleInspectorResizeStart}
            onStartPreview={handleStartPreview}
            onStopPreview={handleStopPreview}
            onTabChange={setActiveInspectorTab}
          />
        )}
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
        <SettingsMenu
          agentOptions={agentOptions}
          setAgentOptions={setAgentOptions}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setShowSettings(false)}
          onOpenLLMSetup={() => setShowLLMSetup(true)}
          language={language}
          onChangeLanguage={handleLanguageChange}
        />
      )}
      {showLLMSetup && (
        <LLMSetupModal
          llmConfigStatus={llmConfigStatus}
          llmForm={llmForm}
          llmSetupError={llmSetupError}
          llmSetupSaving={llmSetupSaving}
          onClose={() => setShowLLMSetup(false)}
          onFormChange={handleLLMFormChange}
          onProviderChange={handleLLMProviderChange}
          onSave={handleSaveLLMConfig}
        />
      )}
    </div>
  );
}

export default App;
