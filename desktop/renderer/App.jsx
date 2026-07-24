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
import { ManagementPage } from './components/management/ManagementPage.jsx';
import { ChromeCapsules } from './components/chrome/ChromeCapsules.jsx';
import { IpcDiagnosticBanner } from './components/chrome/IpcDiagnosticBanner.jsx';
import { CapabilityStatusBar } from './components/chrome/CapabilityStatusBar.jsx';
import { ActionFeedback } from './components/chrome/ActionFeedback.jsx';
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
import { useCapabilities } from './hooks/useCapabilities.js';
import { useTheme } from './hooks/useTheme.js';
import { useModelConfig } from './hooks/useModelConfig.js';
import { useMcpServers } from './hooks/useMcpServers.js';
import { useConfirmDialog } from './hooks/useConfirmDialog.js';
import { useContextMenu } from './hooks/useContextMenu.js';
import { useLayout } from './hooks/useLayout.js';
import { useProjectTree } from './hooks/useProjectTree.js';
import { usePreview } from './hooks/usePreview.js';
import { useRagDocuments } from './hooks/useRagDocuments.js';
import { useSessionManager } from './hooks/useSessionManager.js';
import { useChatComposer } from './hooks/useChatComposer.js';
import { LLM_PROVIDER_OPTIONS } from './app/config/index.js';
import {
  ACTIVE_AGENT_SESSION_STORAGE_KEY,
  AGENT_HISTORY_STORAGE_KEY,
  AGENT_HISTORY_UPDATED_EVENT,
  AGENT_SESSIONS_STORAGE_KEY,
  AGENT_SESSIONS_UPDATED_EVENT,
  createAgentErrorPrompt,
  createAgentSessionId,
  findAgentSession,
  readAgentHistory,
} from './app/session/session-storage.js';
import {
  createComposerInteractionState,
} from './app/interaction/interaction-model.js';
import { styles } from './app/styles.js';
import { WorkbenchControls } from './components/workbench/controls/WorkbenchControls.jsx';
import { LLMSetupModal } from './components/LLMSetupModal.jsx';
import { useFileOperations } from './hooks/useFileOperations.js';
import { downloadConversationMarkdown } from './app/export-conversation.js';
import { ActionLifecycleProvider } from './contexts/ActionLifecycleContext.jsx';
import './index.css';

function App() {
  // ── 主题/语言 ────────────────────────────────────────────
  const { theme, toggleTheme, language, handleLanguageChange } = useTheme();

  // ── Runtime / IPC ────────────────────────────────────────
  const runtime = useRuntime();
  const ipc = useIPC();
  const capabilities = useCapabilities(ipc);

  // ── 布局状态 (sidebar / inspector / terminal) ───────────
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    summaryPanelVisible,
    setSummaryPanelVisible,
    activeInspectorTab,
    setActiveInspectorTab,
    inspectorPanelWidth,
    workbenchLayoutMode,
    inspectorExpanded,
    handleInspectorResizeStart,
    handleInspectorResizeKeyDown,
    handleInspectorExpandToggle,
    terminalClosed,
    terminalOpen,
    terminalPanelHeight,
    setTerminalPanelHeight,
    activeTerminalTab,
    setActiveTerminalTab,
    toggleTerminalPanel,
    handleTerminalOpenChange,
    handleTerminalClose,
  } = useLayout();

  // ── 模型配置 ─────────────────────────────────────────────
  const {
    llmConfigStatus,
    setLLMConfigStatus,
    showLLMSetup,
    setShowLLMSetup,
    llmForm,
    setLLMForm,
    llmSetupError,
    llmSetupSaving,
    modelConfigs,
    setModelConfigs,
    toggleModelError,
    toggleModelSuccess,
    handleLLMProviderChange,
    handleLLMFormChange,
    handleSaveLLMConfig,
    handleAddModel,
    handleUpdateModel,
    handleDeleteModel,
    handleToggleModel,
  } = useModelConfig(ipc);

  // ── MCP 服务器 ───────────────────────────────────────────
  const {
    mcpServers,
    handleAddMcpServer,
    handleDeleteMcpServer,
    handleToggleMcpServer,
    handleConnectMcpServer,
  } = useMcpServers();

  // ── 确认对话框 / 右键菜单 ────────────────────────────────
  const { confirmDialog, requestConfirm } = useConfirmDialog();
  const { globalContextMenu, setGlobalContextMenu } = useContextMenu();

  // ── App 级状态 ───────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('agent');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [fileServerUrl, setFileServerUrl] = useState('');
  const [showManagement, setShowManagement] = useState(false);
  const [platformInfo, setPlatformInfo] = useState(null);
  const [windowState, setWindowState] = useState({ isFullScreen: false, isMaximized: false });
  const [ipcDiagnostic, setIpcDiagnostic] = useState(null);
  const [agentOptions, setAgentOptions] = useState({ debug: false, maxIterations: 60, autoSave: true });
  const [actionFeedback, setActionFeedback] = useState(null);

  const chatInputRef = useRef(null);

  // ── 会话管理 ──────────────────────────────────────────────
  const {
    activeAgentSessionId,
    sessions,
    loading,
    searchQuery,
    setSearchQuery,
    hasMore,
    loadMore,
    handleNewTask,
    handleClearHistory,
    handleRestoreHistory,
    handleSelectSession,
    handleDeleteSession,
    handleDeleteSessions,
    handleRenameSession,
    handleForkSession,
    handleRefreshSessions,
  } = useSessionManager(runtime, workingDirectory);

  // ── 项目目录树 ───────────────────────────────────────────
  const {
    directoryChildren,
    expandedDirectories,
    loadingDirectories,
    projectTreeStatus,
    projectTreeError,
    handleProjectDirectoryToggle,
    handleProjectTreeRefresh,
    resetProjectTree,
  } = useProjectTree(ipc, workingDirectory);

  // ── 预览会话 ─────────────────────────────────────────────
  const {
    previewSession,
    setPreviewSession,
    previewStatus,
    setPreviewStatus,
    previewFrameKey,
    setPreviewFrameKey,
    activePreviewUrl,
    previewUrlDraft,
    setPreviewUrlDraft,
    followPreviewUrl,
    handleStartPreview,
    handleStopPreview,
    handlePreviewUrlSubmit,
    handleRefreshPreviewFrame,
    showPreviewPanel,
  } = usePreview(ipc, runtime, { setSummaryPanelVisible, setActiveInspectorTab });

  // ── 聊天输入 / Composer ──────────────────────────────────
  const {
    chatInput,
    inputNotice,
    inputFocused,
    showSuggestions,
    setInputFocused,
    handleChatInputChange,
    handleCommandSelect,
    handleSuggestionsClose,
    handleChatKeyDown,
    handleInsertText,
    handleInsertDocSearch,
    handleSendMessage,
    handleContinueAgentInput,
    handleSubmitAgentInput,
    clearInput,
    canEditComposer,
    queueCount,
  } = useChatComposer(runtime, agentOptions, activeAgentSessionId, {
    setPreviewSession,
    followPreviewUrl,
    showPreviewPanel,
    setPreviewStatus,
    setPreviewFrameKey,
  });

  // ── RAG 文档 ─────────────────────────────────────────────
  const {
    ragDocs,
    ragStatus,
    refreshRagDocuments,
    handleAddRagDocuments,
    handleInitializeRagIndex,
    handleRemoveRagDocument,
    handleResetRag,
    resetRag,
  } = useRagDocuments(ipc, workingDirectory);

  // ── 文件操作 ─────────────────────────────────────────────
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
    createFile,
    createDirectory,
    deleteItem,
    renameItem,
  } = useFileOperations({ ipc, onAfterSave: handleProjectTreeRefresh });

  // ── IPC 初始化 ───────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    let unsubscribeWindowState = null;
    let unsubscribeProjectCreated = null;
    let unsubscribeProjectOpened = null;
    let unsubscribeMenuAction = null;
    let unsubscribeCapabilityRefresh = null;

    const syncWorkingDirectoryFromEvent = (payload = {}) => {
      const nextDirectory = payload?.path || payload?.workingDirectory || payload;
      if (!isMounted || !nextDirectory) return;
      setWorkingDirectory(nextDirectory);
      ipc.getAppInfo().then((info) => {
        if (isMounted && info?.fileServerUrl) setFileServerUrl(info.fileServerUrl);
      }).catch(() => {});
      resetProjectTree();
      resetRag();
      runtime.loadTools();
      runtime.refreshState();
    };

    ipc.connect().then((connection) => {
      if (!isMounted) return;

      if (!connection) {
        try {
          const diag = typeof ipc.diagnose === 'function'
            ? ipc.diagnose()
            : { hasElectronAPI: false, url: typeof window !== 'undefined' ? window.location?.href : null };
          console.warn('[App] IPC 诊断:', diag);
          const isElectronShell = typeof navigator !== 'undefined'
            && /Electron/i.test(navigator.userAgent || '');
          setIpcDiagnostic(isElectronShell ? diag : null);
        } catch (_) {
          const isElectronShell = typeof navigator !== 'undefined'
            && /Electron/i.test(navigator.userAgent || '');
          setIpcDiagnostic(isElectronShell
            ? { hasElectronAPI: false, reason: 'preload 未暴露 electronAPI' }
            : null);
        }
        return;
      }

      console.log('[App] 已连接到主进程');
      setPlatformInfo(ipc.getPlatform());
      capabilities.refresh();
      unsubscribeCapabilityRefresh = ipc.subscribe('agent:stop', () => {
        setTimeout(() => capabilities.refresh(), 300);
      });

      ipc.getWindowState().then((state) => {
        if (isMounted && state) setWindowState(state);
      }).catch((error) => console.error('[App] 获取窗口状态失败:', error));

      unsubscribeWindowState = ipc.onWindowStateChange((state) => {
        if (isMounted && state) setWindowState(state);
      });

      unsubscribeProjectCreated = ipc.subscribe('app:projectCreated', syncWorkingDirectoryFromEvent);
      unsubscribeProjectOpened = ipc.subscribe('app:projectOpened', syncWorkingDirectoryFromEvent);

      unsubscribeMenuAction = ipc.subscribe('app:menuAction', ({ command, ...payload }) => {
        if (!isMounted) return;
        switch (command) {
          case 'stopAgent': runtime.stop(); break;
          case 'focusInput': chatInputRef.current?.focus(); break;
          case 'newTask': clearInput(); chatInputRef.current?.focus(); break;
          case 'clearConversation': runtime.clearMessages(); break;
          case 'insertDocSearch': handleInsertDocSearch(); chatInputRef.current?.focus(); break;
          case 'openModelConfig': setShowLLMSetup(true); break;
          case 'saveSession': handleRefreshSessions(); break;
          case 'exportConversation': handleExport(); break;
          case 'refreshProjectTree': handleProjectTreeRefresh(); break;
          case 'refreshRagDocs': refreshRagDocuments(); break;
          case 'startPreview':
            setSummaryPanelVisible(true);
            setActiveInspectorTab('preview');
            handleStartPreview();
            break;
          case 'showAgent': setActiveTab('agent'); setSidebarCollapsed(false); break;
          case 'showTools': setActiveTab('tools'); setSidebarCollapsed(false); break;
          case 'insertCommand':
            if (payload?.value) { handleInsertText(payload.value); chatInputRef.current?.focus(); }
            break;
        }
      });

      ipc.getAppInfo().then((info) => {
        if (!isMounted) return;
        console.log('[App] 应用信息:', info);
        setWorkingDirectory(info.workingDirectory);
        if (info.fileServerUrl) setFileServerUrl(info.fileServerUrl);
      });

      ipc.getLLMConfigStatus().then((status) => {
        if (!isMounted || !status) return;
        setLLMConfigStatus(status);
        setLLMForm((prev) => ({
          ...prev,
          provider: status.provider || prev.provider,
          model: status.model || LLM_PROVIDER_OPTIONS[status.provider]?.defaultModel || prev.model,
          baseUrl: status.baseUrl || LLM_PROVIDER_OPTIONS[status.provider]?.defaultBaseUrl || prev.baseUrl,
        }));
        if (!status.configured) setShowLLMSetup(true);
      }).catch((error) => console.error('[App] 获取 LLM 配置状态失败:', error));

      ipc.invoke('llm:list-models').then((configs) => {
        if (isMounted && Array.isArray(configs) && configs.length > 0) setModelConfigs(configs);
      }).catch(() => {});

      runtime.loadTools();
      runtime.refreshState();
    }).catch((error) => console.error('[App] 连接失败:', error));

    return () => {
      isMounted = false;
      unsubscribeWindowState?.();
      unsubscribeProjectCreated?.();
      unsubscribeProjectOpened?.();
      unsubscribeMenuAction?.();
      unsubscribeCapabilityRefresh?.();
      ipc.disconnect();
    };
  }, []);

  // ── 模型配置持久化 ───────────────────────────────────────
  useEffect(() => {
    if (modelConfigs.length > 0 && ipc.isConnected) {
      ipc.invoke('llm:save-all-models', { models: modelConfigs }).catch(() => {});
    }
  }, [modelConfigs, ipc.isConnected]);

  // ── 工作目录切换 ─────────────────────────────────────────
  const [workingDirectorySyncMessage, setWorkingDirectorySyncMessage] = useState('');
  const handleWorkingDirectoryChange = useCallback(async () => {
    const result = await ipc.openDirectoryDialog({ title: '选择工作目录' });
    if (!result.canceled && result.filePaths.length > 0) {
      const newDir = result.filePaths[0];
      const workspaceResult = await ipc.setWorkingDirectory(newDir);
      setWorkingDirectory(workspaceResult?.workingDirectory || newDir);
      if (workspaceResult?.fileServerUrl) setFileServerUrl(workspaceResult.fileServerUrl);
      if (workspaceResult?.envSynced) {
        setWorkingDirectorySyncMessage(
          workspaceResult.envPath
            ? `✅ 工作目录已切换到 ${workspaceResult.workingDirectory}，配置已同步到 .env`
            : `✅ 工作目录已切换到 ${workspaceResult.workingDirectory}`
        );
        setTimeout(() => setWorkingDirectorySyncMessage(''), 5000);
      }
      resetProjectTree();
      resetRag();
      runtime.loadTools();
    }
  }, [ipc, runtime, resetProjectTree, resetRag]);

  // ── 新建任务 ─────────────────────────────────────────────
  const handleNewTaskCallback = useCallback(() => {
    handleNewTask(clearInput);
  }, [handleNewTask, clearInput]);

  // ── 窗口控制 ─────────────────────────────────────────────
  const handleMinimize = useCallback(() => ipc.minimizeWindow(), [ipc]);
  const handleMaximize = useCallback(() => ipc.maximizeWindow(), [ipc]);
  const handleClose = useCallback(() => ipc.closeWindow(), [ipc]);

  // ── 导出对话 ─────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (runtime.messages.length === 0) {
      setActionFeedback({ tone: 'info', message: '当前没有可导出的对话' });
      return false;
    }
    downloadConversationMarkdown(runtime.messages, workingDirectory);
    setActionFeedback({ tone: 'success', message: '对话已导出为 Markdown 文件' });
    return true;
  }, [runtime.messages, workingDirectory]);

  const handleClearMessages = useCallback(() => {
    if (runtime.messages.length === 0) {
      setActionFeedback({ tone: 'info', message: '当前对话已经是空的' });
      return false;
    }
    runtime.clearMessages();
    setActionFeedback({ tone: 'success', message: '当前对话已清空' });
    return true;
  }, [runtime]);

  const handleStarterPrompt = useCallback((prompt) => {
    handleInsertText(prompt);
    requestAnimationFrame(() => chatInputRef.current?.focus());
  }, [handleInsertText]);

  // ── Ask agent from message ────────────────────────────────
  const handleAskAgentFromMessage = useCallback(
    async (message) => {
      const prompt = createAgentErrorPrompt(message);
      await handleSubmitAgentInput(prompt);
    },
    [handleSubmitAgentInput],
  );

  // ── 外部链接 ─────────────────────────────────────────────
  const handleOpenExternal = useCallback((url) => {
    if (url) ipc.openExternal?.(url);
  }, [ipc]);

  // ── 渲染 ─────────────────────────────────────────────────
  return (
    <ActionLifecycleProvider
      capabilityGraph={capabilities.graph}
      contentCount={runtime.messages.length}
      onFeedback={setActionFeedback}
    >
      <div className="mastery-shell" style={styles.container}>
      <ChromeCapsules
        platformInfo={platformInfo}
        windowState={windowState}
        toolCount={runtime.tools.length}
        stats={runtime.stats}
        appVersion={pkg.version}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
      />

      <IpcDiagnosticBanner diagnostic={ipcDiagnostic} onDismiss={() => setIpcDiagnostic(null)} />
      <CapabilityStatusBar capabilityState={capabilities} />

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
        onClearMessages={handleClearMessages}
        capabilityGraph={capabilities.graph}
        messageCount={runtime.messages.length}
      />

      <div
        className="mastery-workbench"
        data-layout-mode={workbenchLayoutMode}
        style={{
          ...styles.mainContentWrapper,
          '--mastery-inspector-width': `${inspectorPanelWidth}px`,
        }}
      >
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
            onNewTask={handleNewTaskCallback}
            onWorkingDirectoryChange={handleWorkingDirectoryChange}
            workingDirectorySyncMessage={workingDirectorySyncMessage}
            onOpenFile={handleOpenWorkspaceFile}
            onCloseFile={handleCloseFileWorkbench}
            activeOpenFile={openFile}
            projectTree={{
              directoryChildren,
              expandedDirectories,
              loadingDirectories,
              status: projectTreeStatus,
              error: projectTreeError,
              onToggleDirectory: handleProjectDirectoryToggle,
              onRefresh: handleProjectTreeRefresh,
              onCreateFile: createFile,
              onCreateDirectory: createDirectory,
              onDeleteItem: deleteItem,
              onRenameItem: renameItem,
              workingDirectory,
            }}
            sessions={sessions}
            activeSessionId={activeAgentSessionId}
            onSelectSession={(id) => handleSelectSession(id, clearInput)}
            onDeleteSession={handleDeleteSession}
            onClearSessions={handleClearHistory(window.confirm, clearInput)}
            onShowTools={() => setActiveTab('tools')}
            onSettings={() => setShowManagement(true)}
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

        <div className="mastery-chat-frame" style={styles.chatAreaWrapper}>
          <ChatWorkspace
            runtime={runtime}
            chatInput={chatInput}
            chatInputRef={chatInputRef}
            inputNotice={inputNotice}
            inputFocused={inputFocused}
            inputEditable={canEditComposer && capabilities.graph.ui.agent.enabled}
            capability={capabilities.graph.ui.agent}
            showSuggestions={showSuggestions}
            queueCount={queueCount}
            onAskAgentFromMessage={handleAskAgentFromMessage}
            onChatInputChange={handleChatInputChange}
            onChatKeyDown={handleChatKeyDown}
            onCommandSelect={handleCommandSelect}
            onSuggestionsClose={handleSuggestionsClose}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onSendMessage={handleSendMessage}
            onContinue={handleContinueAgentInput}
            onStarterPrompt={handleStarterPrompt}
            onExport={handleExport}
            onClear={handleClearMessages}
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
              capability={capabilities.graph.ui.terminal}
            />
          )}
        </div>

        {summaryPanelVisible && (
          <div className="mastery-inspector-overlay">
          <InspectorPanel
            activeInspectorTab={activeInspectorTab}
            activePreviewUrl={activePreviewUrl}
            inspectorExpanded={inspectorExpanded}
            inspectorPanelWidth={inspectorPanelWidth}
            ipc={ipc}
            messages={runtime.messages}
            previewFrameKey={previewFrameKey}
            previewSession={previewSession}
            previewStatus={previewStatus}
            previewUrlDraft={previewUrlDraft}
            ragDocs={ragDocs}
            ragStatus={ragStatus}
            sessions={sessions}
            activeSessionId={activeAgentSessionId}
            sessionLoading={loading}
            sessionHasMore={hasMore}
            sessionSearchQuery={searchQuery}
            workingDirectory={workingDirectory}
            fileServerUrl={fileServerUrl}
            onAddDocuments={handleAddRagDocuments}
            onClose={() => setSummaryPanelVisible(false)}
            onClearHistory={handleClearHistory(window.confirm, clearInput)}
            onDeleteSession={handleDeleteSession}
            onDeleteSessions={handleDeleteSessions}
            onExpandToggle={handleInspectorExpandToggle}
            onForkSession={handleForkSession}
            onInitializeIndex={handleInitializeRagIndex}
            onInsertDocSearch={handleInsertDocSearch}
            onLoadMoreSessions={loadMore}
            onNewSession={handleNewTaskCallback}
            onOpenExternal={handleOpenExternal}
            onPreviewUrlDraftChange={setPreviewUrlDraft}
            onPreviewUrlSubmit={handlePreviewUrlSubmit}
            onRefreshFrame={handleRefreshPreviewFrame}
            onRemoveDocument={handleRemoveRagDocument}
            onResetRag={handleResetRag}
            onResizeStart={handleInspectorResizeStart}
            onResizeKeyDown={handleInspectorResizeKeyDown}
            onSearchSessions={setSearchQuery}
            onStartPreview={handleStartPreview}
            onStopPreview={handleStopPreview}
            onSwitchSession={(id) => handleSelectSession(id, clearInput)}
            onTabChange={setActiveInspectorTab}
          />
          </div>
        )}
      </div>

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
      <ActionFeedback
        feedback={actionFeedback}
        onDismiss={() => setActionFeedback(null)}
      />
    </div>
    </ActionLifecycleProvider>
  );
}

export default App;
