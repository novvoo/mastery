/**
 * IPC Hook
 * 提供 Electron IPC 通信的封装方法
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * IPC Hook
 * 管理 Electron IPC 连接和通信
 * @returns {Object} IPC 状态和方法
 */
export function useIPC() {
  // 状态
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState(null);
  const [error, setError] = useState(null);
  
  // 引用
  const subscriptionsRef = useRef([]);
  const isConnectedRef = useRef(false);
  
  // 检查 electronAPI 是否可用
  const hasElectronAPI = useCallback(() => {
    return typeof window !== 'undefined' && window.electronAPI;
  }, []);
  
  // 连接到主进程
  const connect = useCallback(async () => {
    if (!hasElectronAPI()) {
      console.warn('[useIPC] electronAPI 不可用，可能不在 Electron 环境中');
      isConnectedRef.current = false;
      setIsConnected(false);
      return null;
    }
    
    try {
      const result = await window.electronAPI.connect();
      
      isConnectedRef.current = true;
      setIsConnected(true);
      setConnectionInfo(result);
      setError(null);
      
      console.log('[useIPC] 已连接到主进程:', result);
      
      return result;
    } catch (err) {
      console.error('[useIPC] 连接失败:', err);
      
      isConnectedRef.current = false;
      setIsConnected(false);
      setError(err.message);
      
      throw err;
    }
  }, [hasElectronAPI]);
  
  // 断开连接
  const disconnect = useCallback(() => {
    if (!hasElectronAPI()) return;
    
    try {
      window.electronAPI.disconnect();
      
      // 清理所有订阅
      subscriptionsRef.current.forEach(unsub => {
        if (typeof unsub === 'function') {
          unsub();
        }
      });
      subscriptionsRef.current = [];
      
      isConnectedRef.current = false;
      setIsConnected(false);
      setConnectionInfo(null);
      
      console.log('[useIPC] 已断开连接');
    } catch (err) {
      console.error('[useIPC] 断开连接失败:', err);
    }
  }, [hasElectronAPI]);
  
  // 发送请求（invoke）
  const invoke = useCallback(async (channel, ...args) => {
    if (!hasElectronAPI()) {
      throw new Error('electronAPI 不可用');
    }
    
    if (!isConnectedRef.current) {
      throw new Error('未连接到主进程');
    }
    
    try {
      return await window.electronAPI.invoke(channel, ...args);
    } catch (err) {
      console.error(`[useIPC] invoke ${channel} 失败:`, err);
      throw err;
    }
  }, [hasElectronAPI]);
  
  // 发送消息（send）
  const send = useCallback((channel, data) => {
    if (!hasElectronAPI()) {
      console.warn('[useIPC] electronAPI 不可用');
      return;
    }
    
    try {
      window.electronAPI.send(channel, data);
    } catch (err) {
      console.error(`[useIPC] send ${channel} 失败:`, err);
    }
  }, [hasElectronAPI]);
  
  // 订阅事件
  const subscribe = useCallback((channel, callback) => {
    if (!hasElectronAPI()) {
      console.warn('[useIPC] electronAPI 不可用');
      return () => {};
    }
    
    try {
      const unsub = window.electronAPI.on(channel, callback);
      
      // 保存订阅引用
      subscriptionsRef.current.push(unsub);
      
      return unsub;
    } catch (err) {
      console.error(`[useIPC] subscribe ${channel} 失败:`, err);
      return () => {};
    }
  }, [hasElectronAPI]);
  
  // 订阅一次性事件
  const once = useCallback((channel, callback) => {
    if (!hasElectronAPI()) {
      console.warn('[useIPC] electronAPI 不可用');
      return Promise.resolve(null);
    }
    
    return window.electronAPI.once(channel, callback);
  }, [hasElectronAPI]);
  
  // ==================== 便捷方法 ====================
  
  // 处理用户输入
  const processInput = useCallback(async (input, options = {}) => {
    return invoke('agent:processInput', { input, options });
  }, [invoke]);
  
  // 停止 Agent
  const stop = useCallback(async () => {
    return invoke('agent:stop');
  }, [invoke]);
  
  // 获取状态
  const getState = useCallback(async () => {
    return invoke('agent:getState');
  }, [invoke]);
  
  // 获取工具列表
  const getTools = useCallback(async () => {
    return invoke('agent:getTools');
  }, [invoke]);
  
  // 获取统计信息
  const getStats = useCallback(async () => {
    return invoke('agent:getStats');
  }, [invoke]);
  
  // 最小化窗口
  const minimizeWindow = useCallback(async () => {
    return invoke('window:minimize');
  }, [invoke]);
  
  // 最大化窗口
  const maximizeWindow = useCallback(async () => {
    return invoke('window:maximize');
  }, [invoke]);
  
  // 关闭窗口
  const closeWindow = useCallback(async () => {
    return invoke('window:close');
  }, [invoke]);
  
  // 显示窗口
  const showWindow = useCallback(async () => {
    return invoke('window:show');
  }, [invoke]);
  
  // 隐藏窗口
  const hideWindow = useCallback(async () => {
    return invoke('window:hide');
  }, [invoke]);

  // 获取窗口状态
  const getWindowState = useCallback(async () => {
    return invoke('window:getState');
  }, [invoke]);
  
  // 打开文件对话框
  const openFileDialog = useCallback(async (options = {}) => {
    return invoke('dialog:openFile', options);
  }, [invoke]);
  
  // 保存文件对话框
  const saveFileDialog = useCallback(async (options = {}) => {
    return invoke('dialog:saveFile', options);
  }, [invoke]);
  
  // 打开目录对话框
  const openDirectoryDialog = useCallback(async (options = {}) => {
    return invoke('dialog:openDirectory', options);
  }, [invoke]);
  
  // 显示通知
  const showNotification = useCallback(async (options = {}) => {
    return invoke('notification:show', options);
  }, [invoke]);
  
  // 获取应用信息
  const getAppInfo = useCallback(async () => {
    return invoke('app:getInfo');
  }, [invoke]);
  
  // 获取应用路径
  const getAppPath = useCallback(async (name) => {
    return invoke('app:getPath', name);
  }, [invoke]);

  // 打开外部链接
  const openExternal = useCallback(async (url) => {
    return invoke('app:openExternal', url);
  }, [invoke]);
  
  // 设置工作目录
  const setWorkingDirectory = useCallback(async (directory) => {
    return invoke('workspace:setWorkingDirectory', directory);
  }, [invoke]);

  // 列出工作目录内容
  const listDirectory = useCallback(async (path = '') => {
    return invoke('workspace:listDirectory', { path });
  }, [invoke]);

  const startPreview = useCallback(async (options = {}) => {
    return invoke('preview:start', options);
  }, [invoke]);

  const listPreviews = useCallback(async () => {
    return invoke('preview:list');
  }, [invoke]);

  const stopPreview = useCallback(async (sessionId) => {
    return invoke('preview:stop', sessionId);
  }, [invoke]);

  // 获取 LLM 配置状态
  const getLLMConfigStatus = useCallback(async () => {
    return invoke('llm:getConfigStatus');
  }, [invoke]);

  // 保存 LLM 配置
  const saveLLMConfig = useCallback(async (config) => {
    return invoke('llm:saveConfig', config);
  }, [invoke]);
  
  // ==================== 事件订阅便捷方法 ====================
  
  // 订阅 Agent 启动事件
  const onAgentStart = useCallback((callback) => {
    return subscribe('agent:start', callback);
  }, [subscribe]);
  
  // 订阅 Agent 完成事件
  const onAgentComplete = useCallback((callback) => {
    return subscribe('agent:complete', callback);
  }, [subscribe]);
  
  // 订阅 Agent 错误事件
  const onAgentError = useCallback((callback) => {
    return subscribe('agent:error', callback);
  }, [subscribe]);
  
  // 订阅工具调用事件
  const onToolCall = useCallback((callback) => {
    return subscribe('tool:call', callback);
  }, [subscribe]);
  
  // 订阅工具结果事件
  const onToolResult = useCallback((callback) => {
    return subscribe('tool:result', callback);
  }, [subscribe]);
  
  // 订阅状态更新事件
  const onStatusUpdate = useCallback((callback) => {
    return subscribe('status:update', callback);
  }, [subscribe]);

  // 订阅窗口状态变化事件
  const onWindowStateChange = useCallback((callback) => {
    if (!hasElectronAPI() || !window.electronAPI.onWindowStateChange) {
      return subscribe('window:state', callback);
    }

    const unsub = window.electronAPI.onWindowStateChange(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [hasElectronAPI, subscribe]);

  const onWorkspaceChanged = useCallback((callback) => {
    if (!hasElectronAPI() || !window.electronAPI.onWorkspaceChanged) {
      return subscribe('workspace:changed', callback);
    }

    const unsub = window.electronAPI.onWorkspaceChanged(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [hasElectronAPI, subscribe]);

  const onPreviewStarted = useCallback((callback) => {
    if (!hasElectronAPI() || !window.electronAPI.onPreviewStarted) {
      return subscribe('preview:started', callback);
    }

    const unsub = window.electronAPI.onPreviewStarted(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [hasElectronAPI, subscribe]);

  const onPreviewStopped = useCallback((callback) => {
    if (!hasElectronAPI() || !window.electronAPI.onPreviewStopped) {
      return subscribe('preview:stopped', callback);
    }

    const unsub = window.electronAPI.onPreviewStopped(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [hasElectronAPI, subscribe]);
  
  // ==================== 平台信息 ====================
  
  // 获取平台信息
  const getPlatform = useCallback(() => {
    if (!hasElectronAPI()) {
      return {
        platform: 'web',
        arch: 'unknown',
        isWindows: false,
        isMac: false,
        isLinux: false
      };
    }
    
    return window.electronAPI.getPlatform();
  }, [hasElectronAPI]);
  
  // 获取版本信息
  const getVersions = useCallback(() => {
    if (!hasElectronAPI()) {
      return {
        electron: 'unknown',
        node: 'unknown',
        chrome: 'unknown',
        v8: 'unknown'
      };
    }
    
    return window.electronAPI.getVersions();
  }, [hasElectronAPI]);
  
  // 清理订阅
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach(unsub => {
        if (typeof unsub === 'function') {
          unsub();
        }
      });
      subscriptionsRef.current = [];
    };
  }, []);
  
  return {
    // 状态
    isConnected,
    connectionInfo,
    error,
    
    // 核心方法
    connect,
    disconnect,
    invoke,
    send,
    subscribe,
    once,
    
    // Agent 操作
    processInput,
    stop,
    getState,
    getTools,
    getStats,
    
    // 窗口控制
    minimizeWindow,
    maximizeWindow,
    closeWindow,
    showWindow,
    hideWindow,
    getWindowState,
    
    // 文件对话框
    openFileDialog,
    saveFileDialog,
    openDirectoryDialog,
    
    // 通知
    showNotification,
    
    // 应用信息
    getAppInfo,
    getAppPath,
    openExternal,
    
    // 工作空间
    setWorkingDirectory,
    listDirectory,
    startPreview,
    listPreviews,
    stopPreview,

    // LLM 配置
    getLLMConfigStatus,
    saveLLMConfig,
    
    // 事件订阅
    onAgentStart,
    onAgentComplete,
    onAgentError,
    onToolCall,
    onToolResult,
    onStatusUpdate,
    onWindowStateChange,
    onWorkspaceChanged,
    onPreviewStarted,
    onPreviewStopped,
    
    // 平台信息
    getPlatform,
    getVersions,
    
    // 检查方法
    hasElectronAPI
  };
}

export default useIPC;
