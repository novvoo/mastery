/**
 * Electron IPC — 纯函数核心（不依赖 React Hook，便于测试 & SSR）
 *
 * 设计原则：
 *   - 所有对 window.electronAPI 的直接访问都封装在
 *     getWindowObject / getElectronAPI / hasElectronAPI / waitForElectronAPI 中
 *   - connectElectronAPI / invokeElectronAPI 是两条真正的"运行路径"，
 *     生产代码和测试代码共用同一份实现——保证"能测出来"
 *   - React Hook (useIPC) 仅做状态同步 & 生命周期管理，不重复实现逻辑
 */

import { createLogger } from '../utils/logger.js';
const logger = createLogger('useIPC');

function getWindowObject() {
  return (typeof window !== 'undefined' && window != null) ? window : null;
}

export function getElectronAPI() {
  const win = getWindowObject();
  return win && win.electronAPI ? win.electronAPI : null;
}

export function hasElectronAPI() {
  return !!getElectronAPI();
}

export function waitForElectronAPI(timeoutMs = 3000, pollIntervalMs = 50) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (hasElectronAPI()) {
        resolve(true);
        return;
      }
      if (!getWindowObject()) {
        resolve(false);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, pollIntervalMs);
    };
    check();
  });
}

function makeUnavailableError() {
  const win = getWindowObject();
  const detail = win
    ? `window.electronAPI=${typeof win.electronAPI}, url=${win.location?.href}`
    : '无 window 对象';
  return new Error(`electronAPI 不可用：请在 Electron 环境中运行此应用 (${detail})`);
}

export async function connectElectronAPI(ctx = {}) {
  const { isConnectedRef, connectionInfoRef, onConnected } = ctx;
  if (isConnectedRef && isConnectedRef.current) {
    return connectionInfoRef ? connectionInfoRef.current : null;
  }

  let api = null;

  if (!hasElectronAPI()) {
    logger.debug('window.electronAPI 暂不可用，轮询等待 3000ms...');
    try {
      logger.debug('IPC-DIAG[renderer] before wait:', diagnoseIPC());
    } catch (_) {}
    const apiAvailable = await waitForElectronAPI(3000);
    if (!apiAvailable) {
      logger.warn('electronAPI 不可用，可能不在 Electron 环境中');
      try {
        logger.debug('IPC-DIAG[renderer] after wait timeout:', diagnoseIPC());
      } catch (_) {}
      if (isConnectedRef) {isConnectedRef.current = false;}
      return null;
    }
    logger.debug('window.electronAPI 轮询成功，可以连接');
  }

  api = getElectronAPI();
  if (!api) {
    logger.warn('electronAPI 不可用，可能不在 Electron 环境中');
    if (isConnectedRef) {isConnectedRef.current = false;}
    return null;
  }

  try {
    logger.debug('调用 electronAPI.connect() ...');
    const result = await api.connect();
    if (isConnectedRef) {isConnectedRef.current = true;}
    if (connectionInfoRef) {connectionInfoRef.current = result;}
    if (typeof onConnected === 'function') {onConnected(result);}

    logger.debug('已连接到主进程:', result);
    return result;
  } catch (err) {
    logger.error('连接失败:', err);
    if (isConnectedRef) {isConnectedRef.current = false;}
    return null;
  }
}

export function diagnoseIPC() {
  const win = getWindowObject();
  const api = win?.electronAPI;
  const preloadDiag = (() => {
    try {
      if (typeof win?.__masteryPreloadDiag?.get === 'function') {
        return win.__masteryPreloadDiag.get();
      }
      return win?.__masteryPreloadDiag || null;
    } catch (error) {
      return { error: error?.message || '读取 preload 诊断失败' };
    }
  })();
  const apiKeys = (() => {
    try {
      return api ? Object.keys(api).sort() : [];
    } catch (_) {
      return [];
    }
  })();
  const result = {
    hasWindow: !!win,
    hasElectronAPI: hasElectronAPI(),
    electronAPIType: typeof api,
    electronAPIKeys: apiKeys,
    connectFn: typeof api?.connect,
    invokeFn: typeof api?.invoke,
    diagFn: typeof api?.diagnose,
    diag: api?.__diag || null,
    apiDiagnose: typeof api?.diagnose === 'function' ? api.diagnose() : null,
    preloadDiag,
    url: win?.location?.href || null,
    protocol: win?.location?.protocol || null,
    origin: win?.location?.origin || null,
    readyState: win?.document?.readyState || null,
    userAgent: win?.navigator?.userAgent || null,
    isElectronUA: /Electron/i.test(win?.navigator?.userAgent || ''),
    timestamp: new Date().toISOString()
  };
  logger.debug('IPC 诊断:', result);
  return result;
}

export async function invokeElectronAPI(channel, ...args) {
  if (!hasElectronAPI()) {
    const apiAvailable = await waitForElectronAPI(3000);
    if (!apiAvailable) {
      throw makeUnavailableError();
    }
  }

  const api = getElectronAPI();
  if (!api) {
    throw makeUnavailableError();
  }

  try {
    return await api.invoke(channel, ...args);
  } catch (err) {
    logger.error(`invoke ${channel} 失败:`, err);
    throw err;
  }
}

// ============================================================
// React Hook 薄包装层（同步 React state + 生命周期管理）
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';

export function useIPC() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState(null);
  const [error, setError] = useState(null);

  const subscriptionsRef = useRef([]);
  const isConnectedRef = useRef(false);
  const connectionInfoRef = useRef(null);

  const connect = useCallback(async () => {
    const result = await connectElectronAPI({
      isConnectedRef,
      connectionInfoRef,
      onConnected: (info) => {
        setIsConnected(true);
        setConnectionInfo(info);
        setError(null);
      },
    });

    if (result === null) {
      setIsConnected(false);
      try { diagnoseIPC(); } catch (e) { /* ignore */ }
    }
    return result;
  }, []);

  const disconnect = useCallback(() => {
    const api = getElectronAPI();
    if (!api) {return;}
    try {
      api.disconnect();
      subscriptionsRef.current.forEach((unsub) => {
        if (typeof unsub === 'function') {unsub();}
      });
      subscriptionsRef.current = [];
      isConnectedRef.current = false;
      setIsConnected(false);
      setConnectionInfo(null);
      logger.debug('已断开连接');
    } catch (err) {
      logger.error('断开连接失败:', err);
    }
  }, []);

  const invoke = useCallback(async (channel, ...args) => {
    return invokeElectronAPI(channel, ...args);
  }, []);

  const send = useCallback((channel, data) => {
    const api = getElectronAPI();
    if (!api) {
      logger.warn('electronAPI 不可用');
      return;
    }
    try {
      api.send(channel, data);
    } catch (err) {
      logger.error(`send ${channel} 失败:`, err);
    }
  }, []);

  const subscribe = useCallback((channel, callback) => {
    const api = getElectronAPI();
    if (!api) {
      logger.warn('electronAPI 不可用');
      return () => {};
    }
    try {
      const unsub = api.on(channel, callback);
      subscriptionsRef.current.push(unsub);
      return unsub;
    } catch (err) {
      logger.error(`subscribe ${channel} 失败:`, err);
      return () => {};
    }
  }, []);

  const once = useCallback((channel, callback) => {
    const api = getElectronAPI();
    if (!api) {
      logger.warn('electronAPI 不可用');
      return Promise.resolve(null);
    }
    return api.once(channel, callback);
  }, []);

  const processInput = useCallback(async (input, options = {}) => {
    return invoke('agent:processInput', { input, options });
  }, [invoke]);

  const stop = useCallback(async () => {
    return invoke('agent:stop');
  }, [invoke]);

  const getState = useCallback(async () => {
    return invoke('agent:getState');
  }, [invoke]);

  const getTools = useCallback(async () => {
    return invoke('agent:getTools');
  }, [invoke]);

  const getStats = useCallback(async () => {
    return invoke('system:getStats');
  }, [invoke]);

  const getCapabilities = useCallback(async () => {
    return invoke('capabilities:list');
  }, [invoke]);

  const getCommandContracts = useCallback(async () => {
    return invoke('contracts:list');
  }, [invoke]);

  const minimizeWindow = useCallback(async () => {
    return invoke('window:minimize');
  }, [invoke]);

  const maximizeWindow = useCallback(async () => {
    return invoke('window:maximize');
  }, [invoke]);

  const closeWindow = useCallback(async () => {
    return invoke('window:close');
  }, [invoke]);

  const showWindow = useCallback(async () => {
    return invoke('window:show');
  }, [invoke]);

  const hideWindow = useCallback(async () => {
    return invoke('window:hide');
  }, [invoke]);

  const getWindowState = useCallback(async () => {
    return invoke('window:getState');
  }, [invoke]);

  const openFileDialog = useCallback(async (options = {}) => {
    return invoke('dialog:openFile', options);
  }, [invoke]);

  const saveFileDialog = useCallback(async (options = {}) => {
    return invoke('dialog:saveFile', options);
  }, [invoke]);

  const openDirectoryDialog = useCallback(async (options = {}) => {
    return invoke('dialog:openDirectory', options);
  }, [invoke]);

  const showNotification = useCallback(async (options = {}) => {
    return invoke('notification:show', options);
  }, [invoke]);

  const getAppInfo = useCallback(async () => {
    return invoke('app:getInfo');
  }, [invoke]);

  const getAppPath = useCallback(async (name) => {
    return invoke('app:getPath', name);
  }, [invoke]);

  const openExternal = useCallback(async (url) => {
    return invoke('app:openExternal', url);
  }, [invoke]);

  const setWorkingDirectory = useCallback(async (directory) => {
    return invoke('workspace:setWorkingDirectory', directory);
  }, [invoke]);

  const listDirectory = useCallback(async (path = '') => {
    return invoke('workspace:listDirectory', { path });
  }, [invoke]);

  const readWorkspaceFile = useCallback(async (path, options = {}) => {
    return invoke('workspace:readFile', { path, ...options });
  }, [invoke]);

  const writeWorkspaceFile = useCallback(async (path, content, options = {}) => {
    return invoke('workspace:writeFile', { path, content, ...options });
  }, [invoke]);

  // 文件 CRUD
  const createWorkspaceFile = useCallback(async (path, content = '') => {
    return invoke('workspace:createFile', { path, content });
  }, [invoke]);

  const createWorkspaceDirectory = useCallback(async (path) => {
    return invoke('workspace:createDirectory', { path });
  }, [invoke]);

  const deleteWorkspaceFile = useCallback(async (path) => {
    return invoke('workspace:deleteFile', { path });
  }, [invoke]);

  const renameWorkspaceItem = useCallback(async (path, newPath) => {
    return invoke('workspace:rename', { path, newPath });
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

  const getFileDiff = useCallback(async (path) => {
    return invoke('workspace:getFileDiff', { path });
  }, [invoke]);

  const isGitRepo = useCallback(async () => {
    return invoke('workspace:isGitRepo');
  }, [invoke]);

  const undoActivity = useCallback(async (activity, options = {}) => {
    return invoke('activity:undo', { activity, ...options });
  }, [invoke]);

  const reviewActivity = useCallback(async (activity) => {
    return invoke('activity:review', { activity });
  }, [invoke]);

  const approveActivity = useCallback(async (activity, input = '') => {
    return invoke('activity:approve', { activity, input });
  }, [invoke]);

  const getLLMConfigStatus = useCallback(async () => {
    return invoke('llm:getConfigStatus');
  }, [invoke]);

  const saveLLMConfig = useCallback(async (config) => {
    return invoke('llm:saveConfig', config);
  }, [invoke]);

  const toggleModel = useCallback(async (id, enabled) => {
    return invoke('llm:toggle-model', { id, enabled });
  }, [invoke]);

  const listSessions = useCallback(async (options = {}) => invoke('session:list', options), [invoke]);
  const loadSession = useCallback(async (sessionId) => invoke('session:load', { sessionId }), [invoke]);
  const getSessionMeta = useCallback(async (sessionId) => invoke('session:meta', { sessionId }), [invoke]);
  const deleteSession = useCallback(async (sessionId) => invoke('session:delete', { sessionId }), [invoke]);
  const renameSession = useCallback(async (sessionId, title) => invoke('session:rename', { sessionId, title }), [invoke]);
  const forkSession = useCallback(async (sessionId, options = {}) => invoke('session:fork', { sessionId, ...options }), [invoke]);
  const searchSessions = useCallback(async (query, limit = 20) => invoke('session:search', { query, limit }), [invoke]);
  const getSessionPreview = useCallback(async (sessionId, previewLength) => invoke('session:preview', { sessionId, previewLength }), [invoke]);
  const getSessionLineage = useCallback(async (sessionId) => invoke('session:lineage', { sessionId }), [invoke]);
  const getSessionChildren = useCallback(async (sessionId) => invoke('session:children', { sessionId }), [invoke]);
  const countSessions = useCallback(async () => invoke('session:count', {}), [invoke]);

  const onAgentStart = useCallback((callback) => {
    return subscribe('agent:start', callback);
  }, [subscribe]);

  const onAgentComplete = useCallback((callback) => {
    return subscribe('agent:complete', callback);
  }, [subscribe]);

  const onAgentError = useCallback((callback) => {
    return subscribe('agent:error', callback);
  }, [subscribe]);

  const onToolCall = useCallback((callback) => {
    return subscribe('tool:call', callback);
  }, [subscribe]);

  const onToolResult = useCallback((callback) => {
    return subscribe('tool:result', callback);
  }, [subscribe]);

  const onStatusUpdate = useCallback((callback) => {
    return subscribe('status:update', callback);
  }, [subscribe]);

  const onWindowStateChange = useCallback((callback) => {
    const api = getElectronAPI();
    if (!api || !api.onWindowStateChange) {
      return subscribe('window:state', callback);
    }
    const unsub = api.onWindowStateChange(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [subscribe]);

  const onWorkspaceChanged = useCallback((callback) => {
    const api = getElectronAPI();
    if (!api || !api.onWorkspaceChanged) {
      return subscribe('workspace:changed', callback);
    }
    const unsub = api.onWorkspaceChanged(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [subscribe]);

  const onPreviewStarted = useCallback((callback) => {
    const api = getElectronAPI();
    if (!api || !api.onPreviewStarted) {
      return subscribe('preview:started', callback);
    }
    const unsub = api.onPreviewStarted(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [subscribe]);

  const onPreviewStopped = useCallback((callback) => {
    const api = getElectronAPI();
    if (!api || !api.onPreviewStopped) {
      return subscribe('preview:stopped', callback);
    }
    const unsub = api.onPreviewStopped(callback);
    subscriptionsRef.current.push(unsub);
    return unsub;
  }, [subscribe]);

  const getPlatform = useCallback(() => {
    const api = getElectronAPI();
    if (!api) {
      return { platform: 'web', arch: 'unknown', isWindows: false, isMac: false, isLinux: false };
    }
    return api.getPlatform();
  }, []);

  const getVersions = useCallback(() => {
    const api = getElectronAPI();
    if (!api) {
      return { electron: 'unknown', node: 'unknown', chrome: 'unknown', v8: 'unknown' };
    }
    return api.getVersions();
  }, []);

  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach((unsub) => {
        if (typeof unsub === 'function') {unsub();}
      });
      subscriptionsRef.current = [];
    };
  }, []);

  return {
    isConnected,
    connectionInfo,
    error,

    connect,
    disconnect,
    invoke,
    send,
    subscribe,
    once,
    hasElectronAPI,
    waitForElectronAPI,
    diagnose: diagnoseIPC,

    processInput,
    stop,
    getState,
    getTools,
    getStats,
    getCapabilities,
    getCommandContracts,

    minimizeWindow,
    maximizeWindow,
    closeWindow,
    showWindow,
    hideWindow,
    getWindowState,

    openFileDialog,
    saveFileDialog,
    openDirectoryDialog,

    showNotification,

    getAppInfo,
    getAppPath,
    openExternal,

    setWorkingDirectory,
    listDirectory,
    readWorkspaceFile,
    writeWorkspaceFile,
    // 文件 CRUD
    createWorkspaceFile,
    createWorkspaceDirectory,
    deleteWorkspaceFile,
    renameWorkspaceItem,
    startPreview,
    listPreviews,
    stopPreview,
    getFileDiff,
    isGitRepo,
    undoActivity,
    reviewActivity,
    approveActivity,

    getLLMConfigStatus,
    saveLLMConfig,
    toggleModel,

    listSessions,
    loadSession,
    getSessionMeta,
    deleteSession,
    renameSession,
    forkSession,
    searchSessions,
    getSessionPreview,
    getSessionLineage,
    getSessionChildren,
    countSessions,

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

    getPlatform,
    getVersions,
  };
}

export default useIPC;
