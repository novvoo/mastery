/**
 * Electron preload script
 * 安全地暴露 IPC 接口到渲染进程
 * 
 * 使用 contextBridge 确保安全性：
 * - 禁用 nodeIntegration
 * - 启用 contextIsolation
 * - 使用白名单机制限制可访问的频道
 */

const { contextBridge, ipcRenderer } = require('electron');

// 定义允许的 IPC 频道（安全性：白名单机制）
const ALLOWED_CHANNELS = {
  // 请求频道（使用 invoke）
  invoke: [
    'ipc:connect',
    'ipc:disconnect',
    'agent:processInput',
    'agent:stop',
    'agent:getState',
    'agent:getTools',
    'agent:getSlashSuggestions',
    'agent:getStats',
    'system:getStats',
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
    'workspace:getFileDiff',
    'activity:undo',
    'activity:review',
    'activity:approve',
    'preview:start',
    'preview:list',
    'preview:stop',
    'llm:getConfigStatus',
    'llm:saveConfig'
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
    'agent:complete',
    'agent:error',
    'agent:thinking',
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
 * @param {string} type - 频道类型（invoke/send/receive）
 * @param {string} channel - 频道名称
 * @returns {boolean} 是否允许
 */
function isValidChannel(type, channel) {
  return ALLOWED_CHANNELS[type]?.includes(channel) || false;
}

/**
 * 创建安全的 IPC 接口
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== 连接管理 ====================
  
  /**
   * 连接到主进程
   * @returns {Promise<Object>} 连接结果
   */
  connect: async () => {
    try {
      const result = await ipcRenderer.invoke('ipc:connect');
      console.log('[Preload] 已连接到主进程:', result);
      return result;
    } catch (error) {
      console.error('[Preload] 连接失败:', error);
      throw error;
    }
  },
  
  /**
   * 断开连接
   */
  disconnect: () => {
    ipcRenderer.send('ipc:disconnect');
    console.log('[Preload] 已断开连接');
  },
  
  // ==================== 通用 IPC 方法 ====================
  
  /**
   * 发送请求（invoke）
   * @param {string} channel - 频道名称
   * @param {...any} args - 参数
   * @returns {Promise<any>} 结果
   */
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
  
  /**
   * 发送消息（send）
   * @param {string} channel - 频道名称
   * @param {any} data - 数据
   */
  send: (channel, data) => {
    if (!isValidChannel('send', channel)) {
      console.error(`[Preload] 不允许的频道: ${channel}`);
      return;
    }
    
    ipcRenderer.send(channel, data);
  },
  
  /**
   * 订阅事件（on）
   * @param {string} channel - 频道名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
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
    
    ipcRenderer.on(channel, listener);
    
    // 返回取消订阅函数
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  
  /**
   * 订阅一次性事件（once）
   * @param {string} channel - 频道名称
   * @param {Function} callback - 回调函数
   * @returns {Promise<any>} 结果
   */
  once: (channel, callback) => {
    if (!isValidChannel('receive', channel)) {
      console.error(`[Preload] 不允许的频道: ${channel}`);
      return Promise.resolve();
    }
    
    return new Promise((resolve) => {
      ipcRenderer.once(channel, (event, data) => {
        try {
          if (callback) callback(data);
          resolve(data);
        } catch (error) {
          console.error(`[Preload] once ${channel} 回调错误:`, error);
          resolve(null);
        }
      });
    });
  },
  
  // ==================== Agent 操作 ====================
  
  /**
   * 处理用户输入
   * @param {string} input - 用户输入
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 结果
   */
  processInput: async (input, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('agent:processInput', { input, options });
      return result;
    } catch (error) {
      console.error('[Preload] processInput 失败:', error);
      throw error;
    }
  },
  
  /**
   * 停止 Agent 执行
   * @returns {Promise<Object>} 结果
   */
  stop: async () => {
    try {
      return await ipcRenderer.invoke('agent:stop');
    } catch (error) {
      console.error('[Preload] stop 失败:', error);
      throw error;
    }
  },
  
  /**
   * 获取 Agent 状态
   * @returns {Promise<Object>} 状态
   */
  getState: async () => {
    try {
      return await ipcRenderer.invoke('agent:getState');
    } catch (error) {
      console.error('[Preload] getState 失败:', error);
      throw error;
    }
  },
  
  /**
   * 获取工具列表
   * @returns {Promise<Array>} 工具列表
   */
  getTools: async () => {
    try {
      return await ipcRenderer.invoke('agent:getTools');
    } catch (error) {
      console.error('[Preload] getTools 失败:', error);
      throw error;
    }
  },

  /**
   * 获取 slash 补全建议
   * @returns {Promise<Array>} 补全建议
   */
  getSlashSuggestions: async () => {
    try {
      return await ipcRenderer.invoke('agent:getSlashSuggestions');
    } catch (error) {
      console.error('[Preload] getSlashSuggestions 失败:', error);
      throw error;
    }
  },
  
  /**
   * 获取统计信息
   * @returns {Promise<Object>} 统计信息
   */
  getStats: async () => {
    try {
      return await ipcRenderer.invoke('agent:getStats');
    } catch (error) {
      console.error('[Preload] getStats 失败:', error);
      throw error;
    }
  },
  
  // ==================== 窗口控制 ====================
  
  /**
   * 最小化窗口
   * @returns {Promise<Object>} 结果
   */
  minimizeWindow: async () => {
    return await ipcRenderer.invoke('window:minimize');
  },
  
  /**
   * 最大化窗口
   * @returns {Promise<Object>} 结果
   */
  maximizeWindow: async () => {
    return await ipcRenderer.invoke('window:maximize');
  },
  
  /**
   * 关闭窗口
   * @returns {Promise<Object>} 结果
   */
  closeWindow: async () => {
    return await ipcRenderer.invoke('window:close');
  },
  
  /**
   * 显示窗口
   * @returns {Promise<Object>} 结果
   */
  showWindow: async () => {
    return await ipcRenderer.invoke('window:show');
  },
  
  /**
   * 隐藏窗口
   * @returns {Promise<Object>} 结果
   */
  hideWindow: async () => {
    return await ipcRenderer.invoke('window:hide');
  },

  /**
   * 获取窗口状态
   * @returns {Promise<Object>} 窗口状态
   */
  getWindowState: async () => {
    return await ipcRenderer.invoke('window:getState');
  },

  /**
   * 监听窗口状态变化
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onWindowStateChange: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },

  onWorkspaceChanged: (callback) => {
    const ipcEventListener = (event, data) => {
      const eventName = data?.metadata?.eventName || data?.payload?.event || data?.payload?.name;
      if (eventName === 'workspace:changed') {
        callback(data?.payload ?? data);
      }
    };
    const directListener = (event, data) => {
      callback(data);
    };
    ipcRenderer.on('ipc:event', ipcEventListener);
    ipcRenderer.on('workspace:changed', directListener);
    return () => {
      ipcRenderer.removeListener('ipc:event', ipcEventListener);
      ipcRenderer.removeListener('workspace:changed', directListener);
    };
  },
  
  // ==================== 文件对话框 ====================
  
  /**
   * 打开文件对话框
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 结果
   */
  openFileDialog: async (options = {}) => {
    try {
      return await ipcRenderer.invoke('dialog:openFile', options);
    } catch (error) {
      console.error('[Preload] openFileDialog 失败:', error);
      throw error;
    }
  },
  
  /**
   * 保存文件对话框
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 结果
   */
  saveFileDialog: async (options = {}) => {
    try {
      return await ipcRenderer.invoke('dialog:saveFile', options);
    } catch (error) {
      console.error('[Preload] saveFileDialog 失败:', error);
      throw error;
    }
  },
  
  /**
   * 打开目录对话框
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 结果
   */
  openDirectoryDialog: async (options = {}) => {
    try {
      return await ipcRenderer.invoke('dialog:openDirectory', options);
    } catch (error) {
      console.error('[Preload] openDirectoryDialog 失败:', error);
      throw error;
    }
  },
  
  // ==================== 通知 ====================
  
  /**
   * 显示通知
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 结果
   */
  showNotification: async (options = {}) => {
    try {
      return await ipcRenderer.invoke('notification:show', options);
    } catch (error) {
      console.error('[Preload] showNotification 失败:', error);
      throw error;
    }
  },
  
  // ==================== 应用信息 ====================
  
  /**
   * 获取应用信息
   * @returns {Promise<Object>} 应用信息
   */
  getAppInfo: async () => {
    try {
      return await ipcRenderer.invoke('app:getInfo');
    } catch (error) {
      console.error('[Preload] getAppInfo 失败:', error);
      throw error;
    }
  },
  
  /**
   * 获取应用路径
   * @param {string} name - 路径名称
   * @returns {Promise<string>} 路径
   */
  getAppPath: async (name) => {
    try {
      return await ipcRenderer.invoke('app:getPath', name);
    } catch (error) {
      console.error('[Preload] getAppPath 失败:', error);
      throw error;
    }
  },
  
  // ==================== 工作空间 ====================
  
  /**
   * 设置工作目录
   * @param {string} directory - 目录路径
   * @returns {Promise<Object>} 结果
   */
  setWorkingDirectory: async (directory) => {
    try {
      return await ipcRenderer.invoke('workspace:setWorkingDirectory', directory);
    } catch (error) {
      console.error('[Preload] setWorkingDirectory 失败:', error);
      throw error;
    }
  },

  startPreview: async (options = {}) => {
    return await ipcRenderer.invoke('preview:start', options);
  },

  listPreviews: async () => {
    return await ipcRenderer.invoke('preview:list');
  },

  stopPreview: async (sessionId) => {
    return await ipcRenderer.invoke('preview:stop', sessionId);
  },

  getFileDiff: async (path) => {
    return await ipcRenderer.invoke('workspace:getFileDiff', { path });
  },

  undoActivity: async (activity, options = {}) => {
    return await ipcRenderer.invoke('activity:undo', { activity, ...options });
  },

  reviewActivity: async (activity) => {
    return await ipcRenderer.invoke('activity:review', { activity });
  },

  approveActivity: async (activity, input = '') => {
    return await ipcRenderer.invoke('activity:approve', { activity, input });
  },

  onPreviewStarted: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('preview:started', listener);
    return () => ipcRenderer.removeListener('preview:started', listener);
  },

  onPreviewStopped: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('preview:stopped', listener);
    return () => ipcRenderer.removeListener('preview:stopped', listener);
  },

  // ==================== LLM 配置 ====================

  /**
   * 获取 LLM 配置状态
   * @returns {Promise<Object>} 配置状态
   */
  getLLMConfigStatus: async () => {
    try {
      return await ipcRenderer.invoke('llm:getConfigStatus');
    } catch (error) {
      console.error('[Preload] getLLMConfigStatus 失败:', error);
      throw error;
    }
  },

  /**
   * 保存 LLM 配置
   * @param {Object} config - LLM 配置
   * @returns {Promise<Object>} 保存结果
   */
  saveLLMConfig: async (config) => {
    try {
      return await ipcRenderer.invoke('llm:saveConfig', config);
    } catch (error) {
      console.error('[Preload] saveLLMConfig 失败:', error);
      throw error;
    }
  },
  
  // ==================== 事件订阅便捷方法 ====================
  
  /**
   * 订阅 Agent 启动事件
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onAgentStart: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('agent:start', listener);
    return () => ipcRenderer.removeListener('agent:start', listener);
  },
  
  /**
   * 订阅 Agent 完成事件
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onAgentComplete: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('agent:complete', listener);
    return () => ipcRenderer.removeListener('agent:complete', listener);
  },
  
  /**
   * 订阅 Agent 错误事件
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onAgentError: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('agent:error', listener);
    return () => ipcRenderer.removeListener('agent:error', listener);
  },
  
  /**
   * 订阅工具调用事件
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onToolCall: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('tool:call', listener);
    return () => ipcRenderer.removeListener('tool:call', listener);
  },
  
  /**
   * 订阅工具结果事件
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onToolResult: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('tool:result', listener);
    return () => ipcRenderer.removeListener('tool:result', listener);
  },
  
  /**
   * 订阅状态更新事件
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onStatusUpdate: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('status:update', listener);
    return () => ipcRenderer.removeListener('status:update', listener);
  },
  
  /**
   * 订阅应用事件（新建任务、项目创建等）
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  onAppEvent: (callback) => {
    const listeners = [];
    
    const events = ['app:newTask', 'app:projectCreated', 'app:projectOpened'];
    for (const event of events) {
      const listener = (e, data) => callback({ type: event, data });
      ipcRenderer.on(event, listener);
      listeners.push({ event, listener });
    }
    
    return () => {
      for (const { event, listener } of listeners) {
        ipcRenderer.removeListener(event, listener);
      }
    };
  },
  
  // ==================== 平台信息 ====================
  
  /**
   * 获取平台信息
   * @returns {Object} 平台信息
   */
  getPlatform: () => {
    return {
      platform: process.platform,
      arch: process.arch,
      isWindows: process.platform === 'win32',
      isMac: process.platform === 'darwin',
      isLinux: process.platform === 'linux'
    };
  },
  
  // ==================== 版本信息 ====================
  
  /**
   * 获取版本信息
   * @returns {Object} 版本信息
   */
  getVersions: () => {
    return {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      v8: process.versions.v8
    };
  }
});

// 在开发模式下输出调试信息
if (process.env.NODE_ENV === 'development') {
  console.log('[Preload] electronAPI 已暴露');
  console.log('[Preload] 允许的 invoke 频道:', ALLOWED_CHANNELS.invoke);
  console.log('[Preload] 允许的 send 频道:', ALLOWED_CHANNELS.send);
  console.log('[Preload] 允许的 receive 频道:', ALLOWED_CHANNELS.receive);
}
