/**
 * Active CommonJS preload entry for sandboxed BrowserWindow renderers.
 *
 * Electron preload script
 * 安全地暴露 IPC 接口到渲染进程
 *
 * 使用 contextBridge 确保安全性：
 * - 禁用 nodeIntegration
 * - 启用 contextIsolation
 * - 使用白名单机制限制可访问的频道
 *
 * 重要：整个脚本被 try-catch 包裹，
 * 确保即使在 sandbox 模式或任何异常情况下，
 * electronAPI 也能被暴露到 window 对象上。
 */

var __masteryPreloadDiag = {
  startedAt: Date.now(),
  stage: 'preload_script_entered',
  source: 'desktop/preload.js',
  exposedElectronAPI: false,
  exposedDiag: false,
  errors: [],
  environment: {}
};

function recordPreloadDiag(stage, extra = {}) {
  try {
    __masteryPreloadDiag.stage = stage;
    __masteryPreloadDiag.updatedAt = Date.now();
    Object.assign(__masteryPreloadDiag, extra);
    console.log('[IPC-DIAG][preload]', stage, extra);
  } catch (_) {
    // 诊断逻辑不能影响 preload 主流程
  }
}

try {
  recordPreloadDiag('top_level_try_entered', {
    environment: {
      hasGlobalThis: typeof globalThis !== 'undefined',
      hasWindow: typeof window !== 'undefined',
      hasSelf: typeof self !== 'undefined',
      hasRequire: typeof require !== 'undefined',
      hasProcess: typeof process !== 'undefined',
      sandboxed: typeof process !== 'undefined' ? process.sandboxed : undefined,
      contextIsolated: typeof process !== 'undefined' ? process.contextIsolated : undefined,
      electronVersion: typeof process !== 'undefined' ? process.versions?.electron : undefined,
      nodeVersion: typeof process !== 'undefined' ? process.versions?.node : undefined,
      chromeVersion: typeof process !== 'undefined' ? process.versions?.chrome : undefined
    }
  });

  // 兼容 sandbox/非 sandbox 的 contextBridge & ipcRenderer 获取策略：
  //   - 优先从全局作用域读取（sandbox 下 Electron 直接注入，无需 require）
  //   - 其次 require('electron')（非 sandbox 环境常规路径）
  //   - 最后从 window/self 读取（兜底）
  //   - 任何一种方式成功即停止尝试；获取失败时输出更详细的诊断信息
  let contextBridge = null;
  let ipcRenderer = null;

  // 方式1：从 globalThis 读取（sandbox 模式首选）
  try {
    if (typeof globalThis !== 'undefined') {
      if (!contextBridge && globalThis.contextBridge) contextBridge = globalThis.contextBridge;
      if (!ipcRenderer && globalThis.ipcRenderer) ipcRenderer = globalThis.ipcRenderer;
    }
  } catch (_) { /* 静默忽略 */ }

  // 方式2：从 window/self 读取（sandbox 下 preload 的"全局"可能是 this/window）
  if (!contextBridge || !ipcRenderer) {
    try {
      const scope = (typeof window !== 'undefined' && window)
        || (typeof self !== 'undefined' && self)
        || (typeof this !== 'undefined' && this)
        || null;
      if (scope) {
        if (!contextBridge && scope.contextBridge) contextBridge = scope.contextBridge;
        if (!ipcRenderer && scope.ipcRenderer) ipcRenderer = scope.ipcRenderer;
      }
    } catch (_) { /* 静默忽略 */ }
  }

  // 方式3：require('electron')（非 sandbox，或 Electron < 20 默认路径）
  if (!contextBridge || !ipcRenderer) {
    try {
      const electron = require('electron');
      if (!contextBridge && electron?.contextBridge) contextBridge = electron.contextBridge;
      if (!ipcRenderer && electron?.ipcRenderer) ipcRenderer = electron.ipcRenderer;
    } catch (_) {
      // 在 sandbox / 严格 ESM / 禁用 nodeIntegration 的环境里会抛错，正常
    }
  }

  if (!contextBridge || !ipcRenderer) {
    throw new Error(
      '无法获取 contextBridge 或 ipcRenderer ('
      + 'contextBridge=' + (!!contextBridge) + ', '
      + 'ipcRenderer=' + (!!ipcRenderer) + ', '
      + 'typeof globalThis.contextBridge=' + (typeof globalThis?.contextBridge) + ', '
      + 'process.platform=' + ((typeof process !== 'undefined' && process?.platform) || 'unknown') + ')'
    );
  }

  recordPreloadDiag('electron_modules_resolved', {
    hasContextBridge: !!contextBridge,
    hasIpcRenderer: !!ipcRenderer
  });
  console.log('[Preload] contextBridge 和 ipcRenderer 获取成功');

  // 定义允许的 IPC 频道（安全性：白名单机制）
  const ALLOWED_CHANNELS = {
    // 请求频道（使用 invoke）
    invoke: [
      'ipc:connect',
      'ipc:diagnose',
      'ipc:disconnect',
      'agent:processInput',
      'agent:stop',
      'agent:steer',
      'agent:followUp',
      'agent:respondInteraction',
      'agent:getState',
      'agent:getTools',
      'agent:getSlashSuggestions',
      'agent:getStats',
      'system:getStats',
      'contracts:list',
      'capabilities:list',
      'window:minimize',
      'window:maximize',
      'window:close',
      'window:show',
      'window:hide',
      'window:getState',
      'dialog:openFile',
      'dialog:saveFile',
      'dialog:openDirectory',
      'notification:show',
      'app:getInfo',
      'app:getPath',
      'app:openExternal',
      'workspace:setWorkingDirectory',
      'workspace:listDirectory',
      'workspace:readFile',
      'workspace:writeFile',
      'workspace:createFile',
      'workspace:createDirectory',
      'workspace:deleteFile',
      'workspace:rename',
      'workspace:getFileDiff',
      'workspace:isGitRepo',
      'terminal:execute',
      'terminal:complete',
      'terminal:resolvePath',
      'activity:undo',
      'activity:review',
      'activity:approve',
      'preview:start',
      'preview:list',
      'preview:stop',
      'llm:getConfigStatus',
      'llm:saveConfig',
      'llm:list-models',
      'llm:save-model',
      'llm:save-all-models',
      'llm:delete-model',
      'llm:toggle-model',
      'omp:getState',
      'omp:getAvailableModels',
      'omp:setModel',
      'omp:cycleModel',
      'omp:setThinkingLevel',
      'omp:cycleThinkingLevel',
      'command:list',
      'command:run',
      'metrics:snapshot',
      'lsp:getDiagnostics',
      'lsp:getSemanticTokens',
      'lsp:getHover',
      'lsp:syncDocument',
      'lsp:supportedLanguages',
      'session:list',
      'session:load',
      'session:meta',
      'session:delete',
      'session:rename',
      'session:fork',
      'session:search',
      'session:preview',
      'session:lineage',
      'session:children',
      'session:count',
      'session:create',
    ],

    // 发送频道（使用 send）
    send: [
      'ipc:disconnect',
      'ipc:subscribe',
      'ipc:unsubscribe',
      'ipc:request',
      'ipc:heartbeat'
    ],

    // 接收频道（使用 on）
    receive: [
      'ipc:response',
      'ipc:error',
      'ipc:event',
      'ipc:heartbeat',
      'app:newTask',
      'app:menuAction',
      'app:projectCreated',
      'app:projectOpened',
      'workspace:changed',
      'activity:undo',
      'activity:review',
      'activity:approve',
      'preview:started',
      'preview:stopped',
      'agent:start',
      'agent:stop',
      'agent:complete',
      'agent:error',
      'agent:thinking',
      'agent:text_delta',
      'agent:reasoning_delta',
      'agent:tool_call_delta',
      'agent:interaction_request',
      'agent:interaction_cancel',
      'session:change',
      'subagent:update',
      'plan:created',
      'plan:updated',
      'tool:call',
      'tool:result',
      'tool:error',
      'tool:activity',
      'tool:progress',
      'agent:stream',
      'status:update',
      'window:state'
    ]
  };

  /**
   * 验证频道是否在白名单中
   */
  function isValidChannel(type, channel) {
    return ALLOWED_CHANNELS[type]?.includes(channel) || false;
  }

  /**
   * 安全的 process 属性访问（sandbox 兼容）
   */
  function safeProcessAccess() {
    try {
      const platform = process?.platform || 'unknown';
      const arch = process?.arch || 'unknown';
      const versions = process?.versions || {};
      return {
        platform,
        arch,
        isWindows: platform === 'win32',
        isMac: platform === 'darwin',
        isLinux: platform === 'linux',
        electron: versions.electron || 'unknown',
        node: versions.node || 'unknown',
        chrome: versions.chrome || 'unknown',
        v8: versions.v8 || 'unknown'
      };
    } catch (e) {
      return {
        platform: 'unknown',
        arch: 'unknown',
        isWindows: false,
        isMac: false,
        isLinux: false,
        electron: 'unknown',
        node: 'unknown',
        chrome: 'unknown',
        v8: 'unknown'
      };
    }
  }

  /**
   * 创建安全的 IPC 接口
   */
  const electronAPI = {
    __diag: __masteryPreloadDiag,
    diagnose: () => ({
      ...__masteryPreloadDiag,
      checkedAt: Date.now()
    }),
    diagnoseMain: async () => {
      try {
        recordPreloadDiag('diagnose_main_invoked');
        const result = await ipcRenderer.invoke('ipc:diagnose');
        recordPreloadDiag('diagnose_main_success');
        return result;
      } catch (error) {
        recordPreloadDiag('diagnose_main_failed', { error: error?.message });
        throw error;
      }
    },
    // ==================== 连接管理 ====================
    connect: async () => {
      try {
        recordPreloadDiag('connect_invoked');
        const result = await ipcRenderer.invoke('ipc:connect');
        recordPreloadDiag('connect_success', { connectResult: result });
        console.log('[Preload] 已连接到主进程:', result);
        return result;
      } catch (error) {
        recordPreloadDiag('connect_failed', { error: error?.message });
        console.error('[Preload] 连接失败:', error);
        throw error;
      }
    },

    disconnect: () => {
      try {
        ipcRenderer.send('ipc:disconnect');
        console.log('[Preload] 已断开连接');
      } catch (error) {
        console.error('[Preload] disconnect 失败:', error);
      }
    },

    // ==================== 通用 IPC 方法 ====================
    invoke: async (channel, ...args) => {
      if (!isValidChannel('invoke', channel)) {
        throw new Error(`不允许的频道: ${channel}`);
      }

      try {
        return await ipcRenderer.invoke(channel, ...args);
      } catch (error) {
        console.error(`[Preload] invoke ${channel} 失败:`, error);
        throw error;
      }
    },

    send: (channel, data) => {
      if (!isValidChannel('send', channel)) {
        console.error(`[Preload] 不允许的频道: ${channel}`);
        return;
      }

      try {
        ipcRenderer.send(channel, data);
      } catch (error) {
        console.error(`[Preload] send ${channel} 失败:`, error);
      }
    },

    on: (channel, callback) => {
      if (!isValidChannel('receive', channel)) {
        console.error(`[Preload] 不允许的频道: ${channel}`);
        return () => {};
      }

      const listener = (event, data) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[Preload] on ${channel} 回调错误:`, error);
        }
      };

      try {
        ipcRenderer.on(channel, listener);
      } catch (error) {
        console.error(`[Preload] on ${channel} 注册失败:`, error);
        return () => {};
      }

      return () => {
        try {
          ipcRenderer.removeListener(channel, listener);
        } catch (error) {
          console.error(`[Preload] removeListener ${channel} 失败:`, error);
        }
      };
    },

    once: (channel, callback) => {
      if (!isValidChannel('receive', channel)) {
        console.error(`[Preload] 不允许的频道: ${channel}`);
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        try {
          ipcRenderer.once(channel, (event, data) => {
            try {
              if (callback) callback(data);
              resolve(data);
            } catch (error) {
              console.error(`[Preload] once ${channel} 回调错误:`, error);
              resolve(null);
            }
          });
        } catch (error) {
          console.error(`[Preload] once ${channel} 注册失败:`, error);
          resolve(null);
        }
      });
    },

    // ==================== Agent 操作 ====================
    processInput: async (input, options = {}) => {
      try {
        return await ipcRenderer.invoke('agent:processInput', { input, options });
      } catch (error) {
        console.error('[Preload] processInput 失败:', error);
        throw error;
      }
    },

    stop: async () => {
      try {
        return await ipcRenderer.invoke('agent:stop');
      } catch (error) {
        console.error('[Preload] stop 失败:', error);
        throw error;
      }
    },

    getState: async () => {
      try {
        return await ipcRenderer.invoke('agent:getState');
      } catch (error) {
        console.error('[Preload] getState 失败:', error);
        throw error;
      }
    },

    getTools: async () => {
      try {
        return await ipcRenderer.invoke('agent:getTools');
      } catch (error) {
        console.error('[Preload] getTools 失败:', error);
        throw error;
      }
    },

    getSlashSuggestions: async () => {
      try {
        return await ipcRenderer.invoke('agent:getSlashSuggestions');
      } catch (error) {
        console.error('[Preload] getSlashSuggestions 失败:', error);
        throw error;
      }
    },

    getStats: async () => {
      try {
        return await ipcRenderer.invoke('agent:getStats');
      } catch (error) {
        console.error('[Preload] getStats 失败:', error);
        throw error;
      }
    },

    // ==================== 窗口控制 ====================
    minimizeWindow: async () => {
      try {
        return await ipcRenderer.invoke('window:minimize');
      } catch (error) {
        console.error('[Preload] minimizeWindow 失败:', error);
        throw error;
      }
    },

    maximizeWindow: async () => {
      try {
        return await ipcRenderer.invoke('window:maximize');
      } catch (error) {
        console.error('[Preload] maximizeWindow 失败:', error);
        throw error;
      }
    },

    closeWindow: async () => {
      try {
        return await ipcRenderer.invoke('window:close');
      } catch (error) {
        console.error('[Preload] closeWindow 失败:', error);
        throw error;
      }
    },

    showWindow: async () => {
      try {
        return await ipcRenderer.invoke('window:show');
      } catch (error) {
        console.error('[Preload] showWindow 失败:', error);
        throw error;
      }
    },

    hideWindow: async () => {
      try {
        return await ipcRenderer.invoke('window:hide');
      } catch (error) {
        console.error('[Preload] hideWindow 失败:', error);
        throw error;
      }
    },

    getWindowState: async () => {
      try {
        return await ipcRenderer.invoke('window:getState');
      } catch (error) {
        console.error('[Preload] getWindowState 失败:', error);
        throw error;
      }
    },

    onWindowStateChange: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onWindowStateChange 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('window:state', listener);
      } catch (error) {
        console.error('[Preload] onWindowStateChange 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('window:state', listener);
        } catch (error) {
          console.error('[Preload] onWindowStateChange cleanup 失败:', error);
        }
      };
    },

    onWorkspaceChanged: (callback) => {
      const ipcEventListener = (event, data) => {
        try {
          const eventName = data?.metadata?.eventName || data?.payload?.event || data?.payload?.name;
          if (eventName === 'workspace:changed') {
            callback(data?.payload ?? data);
          }
        } catch (e) {
          console.error('[Preload] onWorkspaceChanged ipc:event 回调错误:', e);
        }
      };
      const directListener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onWorkspaceChanged workspace:changed 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('ipc:event', ipcEventListener);
        ipcRenderer.on('workspace:changed', directListener);
      } catch (error) {
        console.error('[Preload] onWorkspaceChanged 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('ipc:event', ipcEventListener);
          ipcRenderer.removeListener('workspace:changed', directListener);
        } catch (error) {
          console.error('[Preload] onWorkspaceChanged cleanup 失败:', error);
        }
      };
    },

    // ==================== 文件对话框 ====================
    openFileDialog: async (options = {}) => {
      try {
        return await ipcRenderer.invoke('dialog:openFile', options);
      } catch (error) {
        console.error('[Preload] openFileDialog 失败:', error);
        throw error;
      }
    },

    saveFileDialog: async (options = {}) => {
      try {
        return await ipcRenderer.invoke('dialog:saveFile', options);
      } catch (error) {
        console.error('[Preload] saveFileDialog 失败:', error);
        throw error;
      }
    },

    openDirectoryDialog: async (options = {}) => {
      try {
        return await ipcRenderer.invoke('dialog:openDirectory', options);
      } catch (error) {
        console.error('[Preload] openDirectoryDialog 失败:', error);
        throw error;
      }
    },

    // ==================== 通知 ====================
    showNotification: async (options = {}) => {
      try {
        return await ipcRenderer.invoke('notification:show', options);
      } catch (error) {
        console.error('[Preload] showNotification 失败:', error);
        throw error;
      }
    },

    // ==================== 应用信息 ====================
    getAppInfo: async () => {
      try {
        return await ipcRenderer.invoke('app:getInfo');
      } catch (error) {
        console.error('[Preload] getAppInfo 失败:', error);
        throw error;
      }
    },

    getAppPath: async (name) => {
      try {
        return await ipcRenderer.invoke('app:getPath', name);
      } catch (error) {
        console.error('[Preload] getAppPath 失败:', error);
        throw error;
      }
    },

    openExternal: async (url) => {
      try {
        return await ipcRenderer.invoke('app:openExternal', url);
      } catch (error) {
        console.error('[Preload] openExternal 失败:', error);
        throw error;
      }
    },

    // ==================== 工作空间 ====================
    setWorkingDirectory: async (directory) => {
      try {
        return await ipcRenderer.invoke('workspace:setWorkingDirectory', directory);
      } catch (error) {
        console.error('[Preload] setWorkingDirectory 失败:', error);
        throw error;
      }
    },

    listDirectory: async (path, options) => {
      try {
        return await ipcRenderer.invoke('workspace:listDirectory', { path, options });
      } catch (error) {
        console.error('[Preload] listDirectory 失败:', error);
        throw error;
      }
    },

    startPreview: async (options = {}) => {
      try {
        return await ipcRenderer.invoke('preview:start', options);
      } catch (error) {
        console.error('[Preload] startPreview 失败:', error);
        throw error;
      }
    },

    listPreviews: async () => {
      try {
        return await ipcRenderer.invoke('preview:list');
      } catch (error) {
        console.error('[Preload] listPreviews 失败:', error);
        throw error;
      }
    },

    stopPreview: async (sessionId) => {
      try {
        return await ipcRenderer.invoke('preview:stop', sessionId);
      } catch (error) {
        console.error('[Preload] stopPreview 失败:', error);
        throw error;
      }
    },

    getFileDiff: async (path) => {
      try {
        return await ipcRenderer.invoke('workspace:getFileDiff', { path });
      } catch (error) {
        console.error('[Preload] getFileDiff 失败:', error);
        throw error;
      }
    },

    readWorkspaceFile: async (path, options = {}) => {
      try {
        return await ipcRenderer.invoke('workspace:readFile', { path, ...options });
      } catch (error) {
        console.error('[Preload] readWorkspaceFile 失败:', error);
        throw error;
      }
    },

    writeWorkspaceFile: async (path, content, options = {}) => {
      try {
        return await ipcRenderer.invoke('workspace:writeFile', { path, content, ...options });
      } catch (error) {
        console.error('[Preload] writeWorkspaceFile 失败:', error);
        throw error;
      }
    },

    isGitRepo: async () => {
      try {
        const result = await ipcRenderer.invoke('workspace:isGitRepo');
        return result?.isGitRepo ?? false;
      } catch (error) {
        console.error('[Preload] isGitRepo 失败:', error);
        return false;
      }
    },

    undoActivity: async (activity, options = {}) => {
      try {
        return await ipcRenderer.invoke('activity:undo', { activity, ...options });
      } catch (error) {
        console.error('[Preload] undoActivity 失败:', error);
        throw error;
      }
    },

    reviewActivity: async (activity) => {
      try {
        return await ipcRenderer.invoke('activity:review', { activity });
      } catch (error) {
        console.error('[Preload] reviewActivity 失败:', error);
        throw error;
      }
    },

    approveActivity: async (activity, input = '') => {
      try {
        return await ipcRenderer.invoke('activity:approve', { activity, input });
      } catch (error) {
        console.error('[Preload] approveActivity 失败:', error);
        throw error;
      }
    },

    onPreviewStarted: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onPreviewStarted 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('preview:started', listener);
      } catch (error) {
        console.error('[Preload] onPreviewStarted 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('preview:started', listener);
        } catch (error) {
          console.error('[Preload] onPreviewStarted cleanup 失败:', error);
        }
      };
    },

    onPreviewStopped: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onPreviewStopped 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('preview:stopped', listener);
      } catch (error) {
        console.error('[Preload] onPreviewStopped 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('preview:stopped', listener);
        } catch (error) {
          console.error('[Preload] onPreviewStopped cleanup 失败:', error);
        }
      };
    },

    // ==================== LLM 配置 ====================
    getLLMConfigStatus: async () => {
      try {
        return await ipcRenderer.invoke('llm:getConfigStatus');
      } catch (error) {
        console.error('[Preload] getLLMConfigStatus 失败:', error);
        throw error;
      }
    },

    saveLLMConfig: async (config) => {
      try {
        return await ipcRenderer.invoke('llm:saveConfig', config);
      } catch (error) {
        console.error('[Preload] saveLLMConfig 失败:', error);
        throw error;
      }
    },

    listModels: async () => {
      try {
        return await ipcRenderer.invoke('llm:list-models');
      } catch (error) {
        console.error('[Preload] listModels 失败:', error);
        throw error;
      }
    },

    saveModel: async (model) => {
      try {
        return await ipcRenderer.invoke('llm:save-model', model);
      } catch (error) {
        console.error('[Preload] saveModel 失败:', error);
        throw error;
      }
    },

    saveAllModels: async (models) => {
      try {
        return await ipcRenderer.invoke('llm:save-all-models', { models });
      } catch (error) {
        console.error('[Preload] saveAllModels 失败:', error);
        throw error;
      }
    },

    deleteModel: async (modelId) => {
      try {
        return await ipcRenderer.invoke('llm:delete-model', modelId);
      } catch (error) {
        console.error('[Preload] deleteModel 失败:', error);
        throw error;
      }
    },

    toggleModel: async (modelId, enabled) => {
      try {
        return await ipcRenderer.invoke('llm:toggle-model', { id: modelId, enabled });
      } catch (error) {
        console.error('[Preload] toggleModel 失败:', error);
        throw error;
      }
    },

    // ==================== 事件订阅便捷方法 ====================
    onAgentStart: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onAgentStart 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('agent:start', listener);
      } catch (error) {
        console.error('[Preload] onAgentStart 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('agent:start', listener);
        } catch (error) {
          console.error('[Preload] onAgentStart cleanup 失败:', error);
        }
      };
    },

    onAgentComplete: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onAgentComplete 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('agent:complete', listener);
      } catch (error) {
        console.error('[Preload] onAgentComplete 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('agent:complete', listener);
        } catch (error) {
          console.error('[Preload] onAgentComplete cleanup 失败:', error);
        }
      };
    },

    onAgentError: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onAgentError 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('agent:error', listener);
      } catch (error) {
        console.error('[Preload] onAgentError 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('agent:error', listener);
        } catch (error) {
          console.error('[Preload] onAgentError cleanup 失败:', error);
        }
      };
    },

    onToolCall: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onToolCall 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('tool:call', listener);
      } catch (error) {
        console.error('[Preload] onToolCall 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('tool:call', listener);
        } catch (error) {
          console.error('[Preload] onToolCall cleanup 失败:', error);
        }
      };
    },

    onToolResult: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onToolResult 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('tool:result', listener);
      } catch (error) {
        console.error('[Preload] onToolResult 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('tool:result', listener);
        } catch (error) {
          console.error('[Preload] onToolResult cleanup 失败:', error);
        }
      };
    },

    onStatusUpdate: (callback) => {
      const listener = (event, data) => {
        try {
          callback(data);
        } catch (e) {
          console.error('[Preload] onStatusUpdate 回调错误:', e);
        }
      };
      try {
        ipcRenderer.on('status:update', listener);
      } catch (error) {
        console.error('[Preload] onStatusUpdate 注册失败:', error);
        return () => {};
      }
      return () => {
        try {
          ipcRenderer.removeListener('status:update', listener);
        } catch (error) {
          console.error('[Preload] onStatusUpdate cleanup 失败:', error);
        }
      };
    },

    onAppEvent: (callback) => {
      const listeners = [];

      const events = ['app:newTask', 'app:projectCreated', 'app:projectOpened'];
      for (const event of events) {
        const listener = (e, data) => {
          try {
            callback({ type: event, data });
          } catch (err) {
            console.error(`[Preload] onAppEvent ${event} 回调错误:`, err);
          }
        };
        try {
          ipcRenderer.on(event, listener);
          listeners.push({ event, listener });
        } catch (error) {
          console.error(`[Preload] onAppEvent ${event} 注册失败:`, error);
        }
      }

      return () => {
        for (const { event, listener } of listeners) {
          try {
            ipcRenderer.removeListener(event, listener);
          } catch (error) {
            console.error(`[Preload] onAppEvent cleanup ${event} 失败:`, error);
          }
        }
      };
    },

    // ==================== 命令面板 ====================
    listCommands: async () => {
      try {
        return await ipcRenderer.invoke('command:list');
      } catch (error) {
        console.error('[Preload] listCommands 失败:', error);
        throw error;
      }
    },

    runCommand: async (commandId, args) => {
      try {
        return await ipcRenderer.invoke('command:run', { commandId, args });
      } catch (error) {
        console.error('[Preload] runCommand 失败:', error);
        throw error;
      }
    },

    getMetricsSnapshot: async () => {
      try {
        return await ipcRenderer.invoke('metrics:snapshot');
      } catch (error) {
        console.error('[Preload] getMetricsSnapshot 失败:', error);
        throw error;
      }
    },

    // ==================== LSP 编辑器集成 ====================
    getLSPDiagnostics: async (path) => {
      try {
        return await ipcRenderer.invoke('lsp:getDiagnostics', { path });
      } catch (error) {
        console.error('[Preload] getLSPDiagnostics 失败:', error);
        return { success: false, diagnostics: [] };
      }
    },

    getLSPSemanticTokens: async (path) => {
      try {
        return await ipcRenderer.invoke('lsp:getSemanticTokens', { path });
      } catch (error) {
        console.error('[Preload] getLSPSemanticTokens 失败:', error);
        return { success: false, tokens: null };
      }
    },

    getLSPHover: async (path, position) => {
      try {
        return await ipcRenderer.invoke('lsp:getHover', { path, position });
      } catch (error) {
        console.error('[Preload] getLSPHover 失败:', error);
        return { success: false, hover: null };
      }
    },

    syncLSPDocument: async (path, content) => {
      try {
        return await ipcRenderer.invoke('lsp:syncDocument', { path, content });
      } catch (error) {
        console.error('[Preload] syncLSPDocument 失败:', error);
        return { success: false };
      }
    },

    getLSPSupportedLanguages: async () => {
      try {
        return await ipcRenderer.invoke('lsp:supportedLanguages');
      } catch (error) {
        console.error('[Preload] getLSPSupportedLanguages 失败:', error);
        return { success: false, languages: [] };
      }
    },

    // ==================== 平台信息 ====================
    getPlatform: () => {
      const info = safeProcessAccess();
      return {
        platform: info.platform,
        arch: info.arch,
        isWindows: info.isWindows,
        isMac: info.isMac,
        isLinux: info.isLinux
      };
    },

    getVersions: () => {
      const info = safeProcessAccess();
      return {
        electron: info.electron,
        node: info.node,
        chrome: info.chrome,
        v8: info.v8
      };
    }
  };

  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  __masteryPreloadDiag.exposedElectronAPI = true;
  recordPreloadDiag('electron_api_exposed');

  try {
    contextBridge.exposeInMainWorld('__masteryPreloadDiag', {
      get: () => ({
        ...__masteryPreloadDiag,
        checkedAt: Date.now()
      })
    });
    __masteryPreloadDiag.exposedDiag = true;
    recordPreloadDiag('diag_bridge_exposed');
  } catch (diagExposeError) {
    __masteryPreloadDiag.errors.push({
      stage: 'diag_bridge_expose_failed',
      message: diagExposeError?.message
    });
    recordPreloadDiag('diag_bridge_expose_failed', { error: diagExposeError?.message });
  }

  // 在开发模式下输出调试信息
  try {
    if (process?.env?.NODE_ENV === 'development') {
      console.log('[Preload] electronAPI 已暴露');
      console.log('[Preload] 允许的 invoke 频道:', ALLOWED_CHANNELS.invoke);
      console.log('[Preload] 允许的 send 频道:', ALLOWED_CHANNELS.send);
      console.log('[Preload] 允许的 receive 频道:', ALLOWED_CHANNELS.receive);
    }
  } catch (err) {
    // 静默忽略开发模式输出错误
  }

} catch (fatalError) {
  try {
    __masteryPreloadDiag.errors.push({
      stage: 'fatal',
      message: fatalError?.message,
      stack: fatalError?.stack
    });
    recordPreloadDiag('fatal_error', { error: fatalError?.message });
  } catch (_) {}
  console.error('[Preload] 致命错误 - electronAPI 初始化失败:', fatalError);
  const fallbackAPI = {
    __diag: __masteryPreloadDiag,
    diagnose: () => ({
      ...__masteryPreloadDiag,
      checkedAt: Date.now()
    }),
    connect: async () => ({ success: false, error: 'preload_initialization_failed' }),
    invoke: async () => { throw new Error('preload initialization failed'); },
    send: () => {},
    on: () => () => {},
    once: () => Promise.resolve(),
    disconnect: () => {},
    openFileDialog: async () => { throw new Error('preload initialization failed'); },
    openDirectoryDialog: async () => { throw new Error('preload initialization failed'); },
    saveFileDialog: async () => { throw new Error('preload initialization failed'); },
    processInput: async () => { throw new Error('preload initialization failed'); },
    getState: async () => ({}),
    getTools: async () => [],
    getPlatform: () => ({ platform: 'unknown', arch: 'unknown' }),
    getVersions: () => ({ electron: 'unknown', node: 'unknown' }),
    // LSP fallback
    getLSPDiagnostics: async () => ({ success: false, diagnostics: [] }),
    getLSPSemanticTokens: async () => ({ success: false, tokens: null }),
    getLSPHover: async () => ({ success: false, hover: null }),
    syncLSPDocument: async () => ({ success: false }),
    getLSPSupportedLanguages: async () => ({ success: false, languages: [] }),
    _error: fatalError?.message || 'unknown error'
  };

  let exposed = false;

  // 尝试方案 1: 直接使用全局 contextBridge（sandbox 模式下直接暴露，首选）
  try {
    if (typeof globalThis !== 'undefined' && globalThis.contextBridge?.exposeInMainWorld) {
      globalThis.contextBridge.exposeInMainWorld('electronAPI', fallbackAPI);
      exposed = true;
      console.log('[Preload] 恢复模式方案1成功（globalThis.contextBridge）');
    }
  } catch (recoveryError1) {
    console.warn('[Preload] 恢复模式方案1失败:', recoveryError1?.message);
  }

  // 尝试方案 2: 从作用域变量 contextBridge（preload 作用域可能直接可见）
  if (!exposed) {
    try {
      // eslint-disable-next-line no-undef
      if (typeof contextBridge !== 'undefined' && contextBridge?.exposeInMainWorld) {
        contextBridge.exposeInMainWorld('electronAPI', fallbackAPI);
        exposed = true;
        console.log('[Preload] 恢复模式方案2成功（作用域 contextBridge）');
      }
    } catch (recoveryError2) {
      console.warn('[Preload] 恢复模式方案2失败:', recoveryError2?.message);
    }
  }

  // 尝试方案 3: 使用 require('electron') + contextBridge（非 sandbox 环境）
  if (!exposed) {
    try {
      const electron = require('electron');
      if (electron?.contextBridge?.exposeInMainWorld) {
        electron.contextBridge.exposeInMainWorld('electronAPI', fallbackAPI);
        exposed = true;
        console.log('[Preload] 恢复模式方案3成功（require/contextBridge）');
      }
    } catch (recoveryError3) {
      console.warn('[Preload] 恢复模式方案3失败:', recoveryError3?.message);
    }
  }

  // 尝试方案 4: 直接赋值到 window（contextIsolation=false 或特定版本）
  if (!exposed) {
    try {
      window.electronAPI = fallbackAPI;
      exposed = true;
      console.log('[Preload] 恢复模式方案4成功（直接赋值 window）');
    } catch (recoveryError4) {
      console.warn('[Preload] 恢复模式方案4失败:', recoveryError4?.message);
    }
  }

  // 最后方案: 尝试 globalThis
  if (!exposed) {
    try {
      globalThis.electronAPI = fallbackAPI;
      console.log('[Preload] 恢复模式方案5成功（globalThis）');
    } catch (finalError) {
      console.error('[Preload] 所有恢复方案均失败，electronAPI 将不可用:', finalError?.message);
    }
  }
}
