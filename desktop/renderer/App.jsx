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
import pkg from '../../package.json';
import { SettingsMenu } from './components/SettingsMenu.jsx';
import { LLMSetupModal } from './components/LLMSetupModal.jsx';
import { ManagementPage } from './components/management/ManagementPage.jsx';
import { ChromeCapsules } from './components/chrome/ChromeCapsules.jsx';
import { IpcDiagnosticBanner } from './components/chrome/IpcDiagnosticBanner.jsx';
import { ActivityRail } from './components/workbench/ActivityRail.jsx';
import { BottomTerminalPanel } from './components/workbench/BottomTerminalPanel.jsx';
import { FileWorkbench } from './components/workbench/FileWorkbench.jsx';
import { ChatWorkspace } from './components/workbench/ChatWorkspace.jsx';
import { InspectorPanel } from './components/workbench/InspectorPanel.jsx';
import { SidebarPanel } from './components/workbench/SidebarPanel.jsx';
import { ConfirmDialog } from './components/ui/index.js';
import { ContextMenu } from './components/ui/ContextMenu.jsx';
import { useRuntime } from './hooks/useRuntime.js';
import { useIPC } from './hooks/useIPC.js';
import { formatPreviewUrlInput, normalizePreviewUrlInput } from './runtime/preview-url.js';
import { getRuntimeStatusMeta } from './runtime/runtime-status.js';
import { LAYOUT, LLM_PROVIDER_OPTIONS } from './app/config/index.js';
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
  readAgentHistory,
  readAgentSessions,
  readDesktopLayout,
  readStoredInspectorTab,
  readStoredPreviewUrl,
  saveAgentInputHistory,
  upsertAgentSession,
} from './app/session/session-storage.js';
import {
  canEditComposerDraft,
  createComposerInteractionState,
  getComposerSubmitTransition,
  handleComposerKey,
} from './app/interaction/interaction-model.js';
import { styles } from './app/styles.js';
import {
  WorkbenchControls,
  TERMINAL_PANEL_STORAGE_KEY,
  readTerminalPanelLayout,
  clampTerminalHeight,
} from './components/workbench/controls/WorkbenchControls.jsx';
import { getI18n, t as i18nT } from './i18n.js';
import { useFileOperations } from './hooks/useFileOperations.js';
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
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(DESKTOP_THEME_STORAGE_KEY) : null;
    return stored || 'light';
  });
  const [language, setLanguage] = useState(() => getI18n().getLanguage());
  const [, forceUpdate] = useState(0);
  const [activeTab, setActiveTab] = useState('agent');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [fileServerUrl, setFileServerUrl] = useState('');
  const [llmConfigStatus, setLLMConfigStatus] = useState(null);
  const [showLLMSetup, setShowLLMSetup] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [globalContextMenu, setGlobalContextMenu] = useState(null); // { x, y, text }
  const [llmForm, setLLMForm] = useState({
    provider: 'openai',
    apiKey: '',
    model: LLM_PROVIDER_OPTIONS.openai.defaultModel,
    baseUrl: LLM_PROVIDER_OPTIONS.openai.defaultBaseUrl,
  });
  const [llmSetupError, setLLMSetupError] = useState('');
  const [llmSetupSaving, setLLMSetupSaving] = useState(false);
  const [modelConfigs, setModelConfigs] = useState([]);
  const [toggleModelError, setToggleModelError] = useState(null);
  const [toggleModelSuccess, setToggleModelSuccess] = useState(null);
  const [mcpServers, setMcpServers] = useState([]);
  const [platformInfo, setPlatformInfo] = useState(null);
  const [windowState, setWindowState] = useState({
    isFullScreen: false,
    isMaximized: false,
  });
  const [ipcDiagnostic, setIpcDiagnostic] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

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
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(() =>
    clampInspectorWidth(readDesktopLayout().inspectorPanelWidth),
  );
  const [inspectorExpanded, setInspectorExpanded] = useState(() =>
    Boolean(readDesktopLayout().inspectorExpanded),
  );
  const [terminalClosed, setTerminalClosed] = useState(() =>
    Boolean(readTerminalPanelLayout().closed),
  );
  const [terminalOpen, setTerminalOpen] = useState(() => readTerminalPanelLayout().open !== false);
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(() =>
    clampTerminalHeight(readTerminalPanelLayout().height),
  );
  const [activeTerminalTab, setActiveTerminalTab] = useState(
    () => readTerminalPanelLayout().activeTab || 'terminal',
  );
  const [chatInput, setChatInput] = useState('');
  const [inputNotice, setInputNotice] = useState(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [agentOptions, setAgentOptions] = useState({
    debug: false,
    maxIterations: 60,
    autoSave: true,
  });
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(
    () => localStorage.getItem(ACTIVE_AGENT_SESSION_STORAGE_KEY) || createAgentSessionId(),
  );
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
  const composerInteractionRef = useRef(createComposerInteractionState());
  const workspaceRefreshTimerRef = useRef(null);
  const directoryChildrenRef = useRef(directoryChildren);
  const skipNextSessionPersistRef = useRef(false);
  const inspectorResizeRef = useRef(null);

  useEffect(() => {
    directoryChildrenRef.current = directoryChildren;
  }, [directoryChildren]);

  // 全局右键菜单监听（支持选中文字复制）
  useEffect(() => {
    const handleContextMenu = (e) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText) {
        e.preventDefault();
        setGlobalContextMenu({ x: e.clientX, y: e.clientY, text: selectedText });
      }
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      DESKTOP_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        sidebarCollapsed,
        summaryPanelVisible,
        activeInspectorTab,
        inspectorPanelWidth,
        inspectorExpanded,
      }),
    );
  }, [
    activeInspectorTab,
    inspectorExpanded,
    inspectorPanelWidth,
    sidebarCollapsed,
    summaryPanelVisible,
  ]);

  useEffect(() => {
    localStorage.setItem(
      TERMINAL_PANEL_STORAGE_KEY,
      JSON.stringify({
        activeTab: activeTerminalTab,
        closed: terminalClosed,
        height: terminalPanelHeight,
        open: terminalOpen,
      }),
    );
  }, [activeTerminalTab, terminalClosed, terminalOpen, terminalPanelHeight]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const handleTerminalOpenChange = useCallback((open) => {
    setTerminalClosed(false);
    setTerminalOpen(Boolean(open));
    if (open) {
      setActiveTerminalTab('terminal');
    }
  }, []);

  const toggleTerminalPanel = useCallback(() => {
    setTerminalClosed(false);
    setTerminalOpen((prev) => !prev);
    setActiveTerminalTab('terminal');
  }, []);

  const handleTerminalClose = useCallback(() => {
    setTerminalClosed(true);
    setTerminalOpen(false);
  }, []);

  useEffect(() => {
    const handleTerminalShortcut = (event) => {
      const isBacktick = event.key === '`' || event.code === 'Backquote';
      if (!isBacktick || !(event.ctrlKey || event.metaKey || event.shiftKey)) {
        return;
      }
      event.preventDefault();
      setTerminalClosed(false);
      setTerminalOpen((prev) => !prev);
      setActiveTerminalTab('terminal');
    };

    window.addEventListener('keydown', handleTerminalShortcut);
    return () => {
      window.removeEventListener('keydown', handleTerminalShortcut);
    };
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
    if (activePreviewUrl) {
      localStorage.setItem(PREVIEW_URL_STORAGE_KEY, activePreviewUrl);
      return;
    }
    localStorage.removeItem(PREVIEW_URL_STORAGE_KEY);
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

    const firstInput = runtime.messages
      .find(
        (message) =>
          typeof message?.content === 'string' && message.content.startsWith('用户输入:'),
      )
      ?.content?.replace(/^用户输入:\s*/, '');

    upsertAgentSession({
      id: activeAgentSessionId,
      title: getAgentSessionTitle(firstInput, runtime.messages),
      workingDirectory,
      messages: runtime.messages,
      updatedAt: Date.now(),
    });
    window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
  }, [activeAgentSessionId, runtime.messages, workingDirectory]);

  const refreshRagDocuments = useCallback(async () => {
    if (!ipc.isConnected || !ipc.processInput) {
      return null;
    }

    try {
      const result = await ipc.processInput('/doc list');
      const persistedDocs = normalizeRagDocuments(
        result?.data?.documents || result?.documents || [],
      );
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
      ipc
        .getAppInfo()
        .then((info) => {
          if (isMounted && info?.fileServerUrl) {
            setFileServerUrl(info.fileServerUrl);
          }
        })
        .catch(() => {});
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
    ipc
      .connect()
      .then((connection) => {
        if (!isMounted) {
          return;
        }

        if (!connection) {
          // electronAPI 不可用 — 记录诊断信息供 UI 渲染降级横幅
          try {
            const diag =
              typeof ipc.diagnose === 'function'
                ? ipc.diagnose()
                : {
                    hasElectronAPI: false,
                    url: typeof window !== 'undefined' ? window.location?.href : null,
                  };
            console.warn('[App] IPC 诊断:', diag);
            setIpcDiagnostic(diag);
          } catch (_) {
            setIpcDiagnostic({ hasElectronAPI: false, reason: 'preload 未暴露 electronAPI' });
          }
          return;
        }

        console.log('[App] 已连接到主进程');
        setPlatformInfo(ipc.getPlatform());

        ipc
          .getWindowState()
          .then((state) => {
            if (!isMounted || !state) {
              return;
            }
            setWindowState(state);
          })
          .catch((error) => {
            console.error('[App] 获取窗口状态失败:', error);
          });

        unsubscribeWindowState = ipc.onWindowStateChange((state) => {
          if (!isMounted || !state) {
            return;
          }
          setWindowState(state);
        });

        unsubscribeProjectCreated = ipc.subscribe(
          'app:projectCreated',
          syncWorkingDirectoryFromEvent,
        );
        unsubscribeProjectOpened = ipc.subscribe(
          'app:projectOpened',
          syncWorkingDirectoryFromEvent,
        );

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
              setSidebarCollapsed((prev) => !prev);
              break;
            case 'toggleSummary':
              setSummaryPanelVisible((prev) => !prev);
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
        ipc.getAppInfo().then((info) => {
          if (!isMounted) {
            return;
          }
          console.log('[App] 应用信息:', info);
          setWorkingDirectory(info.workingDirectory);
          if (info.fileServerUrl) {
            setFileServerUrl(info.fileServerUrl);
          }
        });

        ipc
          .getLLMConfigStatus()
          .then((status) => {
            if (!isMounted || !status) {
              return;
            }
            setLLMConfigStatus(status);
            setLLMForm((prev) => ({
              ...prev,
              provider: status.provider || prev.provider,
              model:
                status.model || LLM_PROVIDER_OPTIONS[status.provider]?.defaultModel || prev.model,
              baseUrl:
                status.baseUrl ||
                LLM_PROVIDER_OPTIONS[status.provider]?.defaultBaseUrl ||
                prev.baseUrl,
            }));
            if (!status.configured) {
              setShowLLMSetup(true);
            }
          })
          .catch((error) => {
            console.error('[App] 获取 LLM 配置状态失败:', error);
          });

        // 加载多模型配置
        ipc
          .invoke('llm:list-models')
          .then((configs) => {
            if (isMounted && Array.isArray(configs) && configs.length > 0) {
              setModelConfigs(configs);
            }
          })
          .catch(() => {});

        // 获取工具列表
        runtime.loadTools();

        // 获取初始状态
        runtime.refreshState();
      })
      .catch((error) => {
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

  // 模型配置变更时持久化保存
  useEffect(() => {
    if (modelConfigs.length > 0 && ipc.isConnected) {
      ipc.invoke('llm:save-all-models', modelConfigs).catch(() => {});
    }
  }, [modelConfigs, ipc.isConnected]);

  // 处理工作目录变更
  const handleWorkingDirectoryChange = useCallback(async () => {
    const result = await ipc.openDirectoryDialog({
      title: '选择工作目录',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const newDir = result.filePaths[0];
      const workspaceResult = await ipc.setWorkingDirectory(newDir);
      const nextDirectory = workspaceResult?.workingDirectory || newDir;
      setWorkingDirectory(nextDirectory);
      if (workspaceResult?.fileServerUrl) {
        setFileServerUrl(workspaceResult.fileServerUrl);
      }
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

    ipc
      .listDirectory('')
      .then((result) => {
        if (cancelled) return;
        if (!result?.success) {
          setProjectTreeStatus('error');
          setProjectTreeError(result?.error || '无法读取工作目录');
          return;
        }
        setDirectoryChildren({ '': result.entries || [] });
        setProjectTreeStatus('ready');
      })
      .catch((error) => {
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

  const loadProjectDirectory = useCallback(
    async (directoryPath = '') => {
      if (!ipc.listDirectory) {
        return null;
      }

      setLoadingDirectories((prev) => new Set(prev).add(directoryPath));
      setProjectTreeError('');

      try {
        const result = await ipc.listDirectory(directoryPath);
        if (!result?.success) {
          setProjectTreeError(result?.error || '无法读取目录');
          return null;
        }

        setDirectoryChildren((prev) => ({
          ...prev,
          [directoryPath]: result.entries || [],
        }));
        setProjectTreeStatus('ready');
        return result;
      } catch (error) {
        setProjectTreeError(error.message || '无法读取目录');
        return null;
      } finally {
        setLoadingDirectories((prev) => {
          const next = new Set(prev);
          next.delete(directoryPath);
          return next;
        });
      }
    },
    [ipc],
  );

  const handleProjectDirectoryToggle = useCallback(
    async (directoryPath) => {
      const isExpanded = expandedDirectories.has(directoryPath);
      if (isExpanded) {
        setExpandedDirectories((prev) => {
          const next = new Set(prev);
          next.delete(directoryPath);
          return next;
        });
        return;
      }

      setExpandedDirectories((prev) => new Set(prev).add(directoryPath));
      if (!directoryChildren[directoryPath]) {
        await loadProjectDirectory(directoryPath);
      }
    },
    [directoryChildren, expandedDirectories, loadProjectDirectory],
  );

  const handleProjectTreeRefresh = useCallback(async () => {
    setDirectoryChildren({});
    setExpandedDirectories(new Set(['']));
    setProjectTreeStatus('loading');
    await loadProjectDirectory('');
  }, [loadProjectDirectory]);

  // 文件操作 Hook
  const {
    openFile,
    fileDraft,
    fileMode,
    fileStatus,
    fileError,
    setFileDraft,
    readWorkspaceFile: handleOpenWorkspaceFile,
    writeWorkspaceFile: handleSaveWorkspaceFile,
    closeFile: handleCloseFileWorkbench,
    handleFileModeToggle,
    setAfterSaveCallback,
    // 文件 CRUD
    createFile,
    createDirectory,
    deleteItem,
    renameItem,
  } = useFileOperations({ ipc });

  // 设置保存后的回调
  setAfterSaveCallback(handleProjectTreeRefresh);

  const followPreviewUrl = useCallback((url) => {
    const normalizedUrl = normalizePreviewUrlInput(url);
    if (!normalizedUrl) return;
    setActivePreviewUrl(normalizedUrl);
    setPreviewUrlDraft(formatPreviewUrlInput(normalizedUrl));
  }, []);

  const handleStartPreview = useCallback(
    async (target = '.') => {
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
        setPreviewFrameKey((prev) => prev + 1);
        return preview;
      } catch (error) {
        setPreviewStatus('error');
        runtime.addMessage?.({
          type: 'error',
          content: `预览启动失败: ${error.message}`,
        });
        return null;
      }
    },
    [followPreviewUrl, ipc, runtime],
  );

  const handleStopPreview = useCallback(async () => {
    if (!previewSession?.session_id || !ipc.stopPreview) {
      return;
    }

    await ipc.stopPreview(previewSession.session_id);
    setPreviewSession(null);
    setActivePreviewUrl(null);
    setPreviewUrlDraft('');
    setPreviewStatus('idle');
  }, [ipc, previewSession]);

  const handlePreviewUrlSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const normalizedUrl = normalizePreviewUrlInput(previewUrlDraft);
      if (!normalizedUrl) {
        setPreviewStatus('error');
        return;
      }
      setPreviewStatus('ready');
      setActivePreviewUrl(normalizedUrl);
      setPreviewUrlDraft(formatPreviewUrlInput(normalizedUrl));
      setPreviewFrameKey((prev) => prev + 1);
    },
    [previewUrlDraft],
  );

  const refreshLoadedProjectDirectories = useCallback(async () => {
    if (!ipc.listDirectory) {
      return;
    }

    const loadedPaths = Object.keys(directoryChildrenRef.current);
    const pathsToRefresh = loadedPaths.length > 0 ? loadedPaths : [''];
    setProjectTreeError('');

    try {
      const results = [];
      for (
        let index = 0;
        index < pathsToRefresh.length;
        index += PROJECT_TREE_REFRESH_CONCURRENCY
      ) {
        const batch = pathsToRefresh.slice(index, index + PROJECT_TREE_REFRESH_CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (directoryPath) => {
            const result = await ipc.listDirectory(directoryPath);
            return { directoryPath, result };
          }),
        );
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

      setDirectoryChildren((prev) => {
        const next = {
          ...prev,
          ...nextChildren,
        };
        for (const missingPath of missingDirectories) {
          if (missingPath !== '') {
            delete next[missingPath];
          }
        }
        return next;
      });
      if (missingDirectories.size > 0) {
        setExpandedDirectories((prev) => {
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

    ipc
      .listPreviews?.()
      .then((result) => {
        const previews = result?.previews || [];
        if (previews.length > 0) {
          setPreviewSession(previews[0]);
          followPreviewUrl(previews[0].url);
          setSummaryPanelVisible(true);
          setActiveInspectorTab('preview');
          setPreviewStatus('ready');
        }
      })
      .catch(() => {});

    if (ipc.onPreviewStarted) {
      unsubscribeStarted = ipc.onPreviewStarted((preview) => {
        setPreviewSession(preview);
        followPreviewUrl(preview.url);
        setSummaryPanelVisible(true);
        setActiveInspectorTab('preview');
        setPreviewStatus('ready');
        setPreviewFrameKey((prev) => prev + 1);
      });
    }

    if (ipc.onPreviewStopped) {
      unsubscribeStopped = ipc.onPreviewStopped((result) => {
        if (result?.stopped === previewSession?.session_id) {
          setPreviewSession(null);
          setActivePreviewUrl(null);
          setPreviewUrlDraft('');
          setPreviewStatus('idle');
        }
      });
    }

    return () => {
      unsubscribeStarted?.();
      unsubscribeStopped?.();
    };
  }, [
    followPreviewUrl,
    ipc.isConnected,
    ipc.listPreviews,
    ipc.onPreviewStarted,
    ipc.onPreviewStopped,
    previewSession?.session_id,
  ]);

  // 处理新建任务
  const handleNewTask = useCallback(() => {
    setActiveAgentSessionId(createAgentSessionId());
    runtime.clearMessages();
    setChatInput('');
  }, [runtime]);

  const requestConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmDialog({
        ...options,
        onCancel: () => {
          setConfirmDialog(null);
          resolve(false);
        },
        onConfirm: () => {
          setConfirmDialog(null);
          resolve(true);
        },
      });
    });
  }, []);

  const handleClearAgentHistory = useCallback(async () => {
    if (
      !(await requestConfirm({
        title: '清空历史记录',
        message: '确定要清空所有会话和历史记录吗？此操作无法撤销。',
        confirmText: '清空',
        danger: true,
      }))
    ) {
      return;
    }
    localStorage.removeItem(AGENT_HISTORY_STORAGE_KEY);
    localStorage.removeItem(AGENT_SESSIONS_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_AGENT_SESSION_STORAGE_KEY);
    skipNextSessionPersistRef.current = true;
    setActiveAgentSessionId(createAgentSessionId());
    runtime.clearMessages();
    setSessions([]);
    setChatInput('');
    setShowSuggestions(false);
    setInputNotice(null);
    composerInteractionRef.current = createComposerInteractionState();
    window.dispatchEvent(
      new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, {
        detail: [],
      }),
    );
    window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
  }, [requestConfirm, runtime]);

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
      '# 对话记录',
      '',
      `- Exported: ${new Date().toISOString()}`,
      `- Working directory: ${workingDirectory || '未设置'}`,
      '',
      ...runtime.messages.map((message, index) =>
        [
          `## ${index + 1}. ${message.type || 'message'}`,
          '',
          String(message.content || message.result || message.details || '').trim() || '(empty)',
          '',
        ].join('\n'),
      ),
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

  const handleSubmitAgentInput = useCallback(
    async (rawInput, options = {}) => {
      const transition = getComposerSubmitTransition({
        value: rawInput,
        status: runtime.status,
        clearInput: options.clearInput !== false,
        keepWhenBusy: options.keepWhenBusy !== false,
      });
      const { input } = transition;

      if (!transition.accepted) {
        if (input && transition.focus && options.updateComposer !== false) {
          setChatInput(transition.nextValue);
          setShowSuggestions(transition.showSuggestions);
          chatInputRef.current?.focus();
        }
        return;
      }

      if (options.updateComposer !== false) {
        setChatInput(transition.nextValue);
        setShowSuggestions(transition.showSuggestions);
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
          setAgentOptions((prev) => ({
            ...prev,
            debug: result.debug,
          }));
        }
        if (result?.command === '/preview' && result.url) {
          setPreviewSession(result);
          followPreviewUrl(result.url);
          setSummaryPanelVisible(true);
          setActiveInspectorTab('preview');
          setPreviewStatus('ready');
          setPreviewFrameKey((prev) => prev + 1);
        }
        setInputNotice(null);
        composerInteractionRef.current = createComposerInteractionState();
      } catch (error) {
        console.error('[App] 发送消息失败:', error);
        if (options.updateComposer !== false) {
          setChatInput(transition.restoreValue);
          setShowSuggestions(transition.restoreValue.trimStart().startsWith('/'));
          chatInputRef.current?.focus();
        }
      }
    },
    [activeAgentSessionId, agentOptions, followPreviewUrl, runtime],
  );

  const handleSendMessage = useCallback(async () => {
    await handleSubmitAgentInput(chatInput);
  }, [chatInput, handleSubmitAgentInput]);

  const handleContinueAgentInput = useCallback(
    async (input) => {
      await handleSubmitAgentInput(input, { clearInput: false, updateComposer: false });
    },
    [handleSubmitAgentInput],
  );

  const handleAskAgentFromMessage = useCallback(
    async (message) => {
      const prompt = createAgentErrorPrompt(message);
      await handleSubmitAgentInput(prompt);
    },
    [handleSubmitAgentInput],
  );

  const handleChatInputChange = useCallback((value) => {
    setChatInput(value);
    setInputNotice(null);
    composerInteractionRef.current = {
      ...composerInteractionRef.current,
      historyIndex: -1,
      notice: null,
    };
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

  const handleChatKeyDown = useCallback(
    (e) => {
      const interaction = handleComposerKey(e, composerInteractionRef.current, {
        value: chatInput,
        status: runtime.status,
        history: readAgentHistory(),
        now: Date.now(),
      });

      composerInteractionRef.current = interaction.state;
      setInputNotice(interaction.state.notice);

      if (interaction.action === 'submit') {
        e.preventDefault();
        handleSendMessage();
        return;
      }

      if (interaction.action === 'clear') {
        e.preventDefault();
        setChatInput('');
        setShowSuggestions(false);
        return;
      }

      if (interaction.action === 'replace_input') {
        e.preventDefault();
        setChatInput(interaction.value || '');
        setShowSuggestions(
          String(interaction.value || '')
            .trimStart()
            .startsWith('/'),
        );
        return;
      }

      if (interaction.action === 'notice') {
        e.preventDefault();
        return;
      }

      // 隐藏命令提示当按下 Escape 或 Enter(非 Ctrl)
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.ctrlKey && !showSuggestions)) {
        setShowSuggestions(false);
      }
    },
    [chatInput, handleSendMessage, runtime.status, showSuggestions],
  );

  const handleInspectorResizeStart = useCallback(
    (event) => {
      event.preventDefault();
      inspectorResizeRef.current = {
        startX: event.clientX,
        startWidth: inspectorPanelWidth,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [inspectorPanelWidth],
  );

  const handleInspectorExpandToggle = useCallback(() => {
    setInspectorPanelWidth((prev) => {
      if (inspectorExpanded) {
        return clampInspectorWidth(LAYOUT.inspectorPanelWidth);
      }
      return clampInspectorWidth(Math.max(prev, LAYOUT.inspectorExpandedWidth));
    });
    setInspectorExpanded((prev) => !prev);
    setSummaryPanelVisible(true);
  }, [inspectorExpanded]);

  const handleLLMProviderChange = useCallback((provider) => {
    const option = LLM_PROVIDER_OPTIONS[provider] || LLM_PROVIDER_OPTIONS.openai;
    setLLMSetupError('');
    setLLMForm((prev) => ({
      ...prev,
      provider,
      model: option.defaultModel,
      baseUrl: option.defaultBaseUrl,
    }));
  }, []);

  const handleLLMFormChange = useCallback((key, value) => {
    setLLMSetupError('');
    setLLMForm((prev) => ({
      ...prev,
      [key]: value,
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
      setLLMForm((prev) => ({ ...prev, apiKey: '' }));
    } catch (error) {
      setLLMSetupError(error.message || '保存 LLM 配置失败');
    } finally {
      setLLMSetupSaving(false);
    }
  }, [ipc, llmForm]);

  // ===== 模型管理 Handlers =====
  const handleAddModel = useCallback((config) => {
    setModelConfigs((prev) => [...prev, config]);
  }, []);

  const handleUpdateModel = useCallback((id, updated) => {
    setModelConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
  }, []);

  const handleDeleteModel = useCallback((id) => {
    setModelConfigs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleToggleModel = useCallback(
    async (id) => {
      try {
        setToggleModelError(null);
        setToggleModelSuccess(null);
        const config = modelConfigs.find((c) => c.id === id);
        if (!config) return;

        const previousConfigs = modelConfigs;
        const newEnabled = !config.enabled;

        // 如果要启用某个模型，先禁用所有其他模型
        if (newEnabled) {
          setModelConfigs((prev) =>
            prev.map((c) => ({
              ...c,
              enabled: c.id === id ? true : false,
            })),
          );
        } else {
          // 如果要禁用当前激活的模型，不允许
          if (config.enabled) {
            setToggleModelError('不能禁用当前激活的模型，请先启用其他模型');
            return;
          }
          setModelConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: false } : c)));
        }

        // 调用后端保存
        const result = await ipc.toggleModel(id, newEnabled);

        if (!result.success) {
          setToggleModelError(result.error || '操作失败');
          setModelConfigs(previousConfigs);
        } else {
          if (Array.isArray(result.configs)) {
            setModelConfigs(result.configs);
          }
          // 显示成功信息
          if (result.provider && result.model) {
            setToggleModelSuccess(
              `✅ 已切换到 ${result.provider}:${result.model}，配置已同步到 .env`,
            );
            // 3秒后清除成功提示
            setTimeout(() => setToggleModelSuccess(null), 3000);
          }
        }
      } catch (error) {
        setToggleModelError(error.message);
        setModelConfigs(modelConfigs);
      }
    },
    [modelConfigs],
  );

  // ===== MCP 管理 Handlers =====
  const handleAddMcpServer = useCallback((server) => {
    setMcpServers((prev) => [...prev, server]);
  }, []);

  const handleDeleteMcpServer = useCallback((id) => {
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleToggleMcpServer = useCallback((id) => {
    setMcpServers((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: s.status === 'connected' ? 'disconnected' : 'connected' } : s,
      ),
    );
  }, []);

  const handleConnectMcpServer = useCallback((id) => {
    setMcpServers((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'connecting' } : s)));
  }, []);

  const handleInsertText = useCallback((text) => {
    setChatInput(text);
    setShowSuggestions(text.trimStart().startsWith('/'));
    chatInputRef.current?.focus();
  }, []);

  const handleRestoreHistory = useCallback(
    (item) => {
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
    },
    [handleInsertText, runtime],
  );

  const handleAddRagDocuments = useCallback(async () => {
    try {
      if (!ipc.hasElectronAPI()) return;
      const result = await ipc.openFileDialog({ properties: ['openFile', 'multiSelections'] });
      const paths = result?.filePaths || result || [];
      const files = (paths || []).map((path) => ({
        name: getDocumentDisplayName(path),
        path,
        indexed: false,
      }));
      setRagDocs((prev) => mergeRagDocuments(prev, files));
    } catch (error) {
      console.error('选择文件失败', error);
    }
  }, [ipc]);

  const handleInitializeRagIndex = useCallback(async () => {
    if (ragDocs.length === 0) return;
    setRagStatus('indexing');
    setRagIndexProgress(0);
    try {
      const paths = ragDocs.map((doc) => doc.path);
      if (ipc.processInput) {
        const result = await ipc.processInput('init_rag', { docs: paths });
        const indexedDocs = normalizeRagDocuments(result?.documents || []);
        if (indexedDocs.length > 0) {
          setRagDocs((prev) => mergeRagDocuments(prev, indexedDocs));
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

  const handleRemoveRagDocument = useCallback(
    async (doc, index) => {
      if (doc.indexed && doc.id && ipc.processInput) {
        await ipc.processInput(`/doc clear ${doc.id}`);
        await refreshRagDocuments();
        return;
      }
      setRagDocs((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    },
    [ipc, refreshRagDocuments],
  );

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

  const handleOpenExternal = useCallback(
    (url) => {
      if (url) {
        ipc.openExternal?.(url);
      }
    },
    [ipc],
  );

  const handleRefreshPreviewFrame = useCallback(() => {
    setPreviewFrameKey((prev) => prev + 1);
  }, []);

  return (
    <div style={styles.container}>
      <ChromeCapsules
        platformInfo={platformInfo}
        windowState={windowState}
        runtimeStatusMeta={runtimeStatusMeta}
        runtimeStatus={runtime.status}
        isConnected={ipc.isConnected}
        toolCount={runtime.tools.length}
        stats={runtime.stats}
        appVersion={pkg.version}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
      />

      <IpcDiagnosticBanner diagnostic={ipcDiagnostic} onDismiss={() => setIpcDiagnostic(null)} />

      <WorkbenchControls
        sidebarCollapsed={sidebarCollapsed}
        isTerminalVisible={!terminalClosed && terminalOpen}
        summaryPanelVisible={summaryPanelVisible}
        onExport={handleExport}
        onOpenPreview={() => {
          setSummaryPanelVisible(true);
          setActiveInspectorTab('preview');
        }}
        onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
        onToggleTerminal={toggleTerminalPanel}
        onToggleInspector={() => setSummaryPanelVisible((prev) => !prev)}
        onClearMessages={runtime.clearMessages}
      />

      <div style={styles.mainContentWrapper}>
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
          onToggleSettings={() => setShowManagement((prev) => !prev)}
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
            onOpenFile={handleOpenWorkspaceFile}
            activeOpenFile={openFile}
            projectTree={{
              directoryChildren,
              expandedDirectories,
              loadingDirectories,
              status: projectTreeStatus,
              error: projectTreeError,
              onToggleDirectory: handleProjectDirectoryToggle,
              onRefresh: handleProjectTreeRefresh,
              // 文件 CRUD
              onCreateFile: createFile,
              onCreateDirectory: createDirectory,
              onDeleteItem: deleteItem,
              onRenameItem: renameItem,
              workingDirectory,
            }}
          />
        )}

        {openFile && (
          <FileWorkbench
            openFile={openFile}
            fileDraft={fileDraft}
            fileMode={fileMode}
            fileStatus={fileStatus}
            fileError={fileError}
            onClose={handleCloseFileWorkbench}
            onSave={handleSaveWorkspaceFile}
            onModeToggle={handleFileModeToggle}
            onDraftChange={(event) => setFileDraft(event.target.value)}
          />
        )}

        <div style={styles.chatAreaWrapper}>
          <ChatWorkspace
            runtime={runtime}
            chatInput={chatInput}
            chatInputRef={chatInputRef}
            inputNotice={inputNotice}
            inputFocused={inputFocused}
            inputEditable={canEditComposerDraft(runtime.status)}
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
            workingDirectory={workingDirectory}
            fileServerUrl={fileServerUrl}
          />
          {!terminalClosed && (
            <BottomTerminalPanel
              activeTab={activeTerminalTab}
              height={terminalPanelHeight}
              isOpen={terminalOpen}
              workingDirectory={workingDirectory}
              onActiveTabChange={setActiveTerminalTab}
              onClose={handleTerminalClose}
              onHeightChange={setTerminalPanelHeight}
              onOpenChange={handleTerminalOpenChange}
            />
          )}
        </div>

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
      </div>

      {/* 管理设置页面 */}
      {showManagement && (
        <ManagementPage
          agentOptions={agentOptions}
          setAgentOptions={setAgentOptions}
          theme={theme}
          onToggleTheme={toggleTheme}
          language={language}
          onChangeLanguage={handleLanguageChange}
          modelConfigs={modelConfigs}
          onAddModel={handleAddModel}
          onUpdateModel={handleUpdateModel}
          onDeleteModel={handleDeleteModel}
          onToggleModel={handleToggleModel}
          toggleError={toggleModelError}
          toggleSuccess={toggleModelSuccess}
          mcpServers={mcpServers}
          onAddMcpServer={handleAddMcpServer}
          onDeleteMcpServer={handleDeleteMcpServer}
          onToggleMcpServer={handleToggleMcpServer}
          onConnectMcpServer={handleConnectMcpServer}
          onClose={() => setShowManagement(false)}
        />
      )}
      {/* LLM 设置弹窗 */}
      {showLLMSetup && (
        <LLMSetupModal
          llmConfigStatus={llmConfigStatus}
          llmForm={llmForm}
          llmSetupError={llmSetupError}
          llmSetupSaving={llmSetupSaving}
          modelConfigs={modelConfigs}
          onClose={() => setShowLLMSetup(false)}
          onFormChange={handleLLMFormChange}
          onProviderChange={handleLLMProviderChange}
          onSave={handleSaveLLMConfig}
        />
      )}
      {confirmDialog && (
        <ConfirmDialog
          isOpen
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          danger={confirmDialog.danger}
          onCancel={confirmDialog.onCancel}
          onConfirm={confirmDialog.onConfirm}
        />
      )}
      {globalContextMenu && (
        <ContextMenu
          x={globalContextMenu.x}
          y={globalContextMenu.y}
          items={[
            {
              id: 'copy',
              label: '复制',
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              ),
              onClick: () => {
                navigator.clipboard.writeText(globalContextMenu.text);
                setGlobalContextMenu(null);
              },
            },
          ]}
          onClose={() => setGlobalContextMenu(null)}
        />
      )}
    </div>
  );
}

export default App;
