/**
 * AI Agent Desktop - 主应用组件
 * React 主应用入口，整合所有 UI 组件
 */

import React, { useState, useEffect, useCallback } from 'react';
import AgentControl from './components/AgentControl.jsx';
import ToolPanel from './components/ToolPanel.jsx';
import MessageLog from './components/MessageLog.jsx';
import StatusBar from './components/StatusBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import { useRuntime } from './hooks/useRuntime.js';
import { useIPC } from './hooks/useIPC.js';
import './index.css';

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
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: '52px',
    paddingTop: '0',
    paddingRight: '18px',
    paddingBottom: '0',
    paddingLeft: '18px',
    backgroundColor: '#11161e',
    borderBottom: '1px solid var(--border-subtle)',
    boxShadow: 'var(--shadow-sm)'
  },
  
  title: {
    fontSize: '15px',
    fontWeight: '650',
    color: 'var(--text-color)',
    letterSpacing: '0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  headerButtons: {
    display: 'flex',
    gap: '6px'
  },
  
  headerButton: {
    width: '30px',
    height: '28px',
    padding: '0',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },

  macHeader: {
    paddingLeft: '86px'
  },
  
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  
  sidebar: {
    width: '304px',
    backgroundColor: 'var(--surface-color)',
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '18px',
    backgroundColor: 'var(--background-color)'
  },
  
  footer: {
    backgroundColor: '#11161e',
    borderTop: '1px solid var(--border-subtle)'
  },
  
  logoIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '7px',
    backgroundColor: 'var(--primary-soft)',
    border: '1px solid rgba(76, 201, 240, 0.22)',
    color: 'var(--primary-color)',
    fontSize: '12px',
    fontWeight: '750'
  },

  tabNav: {
    display: 'flex',
    gap: '4px',
    padding: '10px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: '#141922'
  },

  tabButton: {
    flex: 1,
    height: '34px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },

  tabButtonActive: {
    backgroundColor: 'var(--surface-hover)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-color)'
  },

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
  
  // 使用自定义 Hooks
  const runtime = useRuntime();
  const ipc = useIPC();
  
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
    setActiveTab('agent');
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
    // TODO: 实现加载任务功能
  }, []);
  
  // 处理保存任务
  const handleSaveTask = useCallback(() => {
    console.log('[App] 保存任务');
    // TODO: 实现保存任务功能
  }, []);
  
  // 处理导出
  const handleExport = useCallback(() => {
    console.log('[App] 导出');
    // TODO: 实现导出功能
  }, []);
  
  // 处理帮助
  const handleHelp = useCallback(() => {
    console.log('[App] 帮助');
    // TODO: 实现帮助功能
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

  const shouldReserveMacTrafficLightSpace = platformInfo?.isMac
    && !windowState.isFullScreen
    && !windowState.isMaximized;
  
  return (
    <div style={styles.container}>
      {/* 头部 */}
      <header style={{
        ...styles.header,
        ...(shouldReserveMacTrafficLightSpace ? styles.macHeader : {})
      }}>
        <div style={styles.title}>
          <span style={styles.logoIcon}>AI</span>
          AI Agent Desktop
        </div>
        
        {!platformInfo?.isMac && (
        <div style={styles.headerButtons}>
          <button 
            style={styles.headerButton}
            onClick={handleMinimize}
            title="最小化"
          >
            -
          </button>
          
          <button 
            style={styles.headerButton}
            onClick={handleMaximize}
            title="最大化"
          >
            □
          </button>
          
          <button 
            style={{ ...styles.headerButton, color: 'var(--error-color)' }}
            onClick={handleClose}
            title="关闭"
          >
            ×
          </button>
        </div>
        )}
      </header>
      
      {/* 工具栏 */}
      <Toolbar
        status={runtime.status}
        taskCount={runtime.messages.length}
        onNewTask={handleNewTask}
        onLoadTask={handleLoadTask}
        onSaveTask={handleSaveTask}
        onExport={handleExport}
        onSettings={() => setShowSettings(true)}
        onHelp={handleHelp}
      />
      
      {/* 主体内容 */}
      <main style={styles.main}>
        {/* 侧边栏 */}
        <aside style={styles.sidebar}>
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
          {renderSidebarContent()}
        </aside>
        
        {/* 主内容区 */}
        <div style={styles.content}>
          <MessageLog
            messages={runtime.messages}
            status={runtime.status}
            onClear={runtime.clearMessages}
          />
        </div>
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
      
      {/* 设置面板（可选） */}
      {showSettings && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'var(--surface-color)',
          padding: '24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          zIndex: 1000,
          minWidth: '400px'
        }}>
          <h3 style={{ color: 'var(--primary-color)', marginBottom: '16px' }}>⚙️ 设置</h3>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-color)' }}>
              工作目录:
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={workingDirectory}
                readOnly
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--background-color)',
                  color: 'var(--text-color)'
                }}
              />
              <button
                style={styles.headerButton}
                onClick={handleWorkingDirectoryChange}
              >
                选择
              </button>
            </div>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-color)' }}>
              最大迭代次数:
            </label>
            <input
              type="number"
              defaultValue={180}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--background-color)',
                color: 'var(--text-color)'
              }}
            />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              style={styles.headerButton}
              onClick={() => setShowSettings(false)}
            >
              关闭
            </button>
            <button
              style={{ ...styles.headerButton, backgroundColor: 'var(--primary-color)' }}
              onClick={() => setShowSettings(false)}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
