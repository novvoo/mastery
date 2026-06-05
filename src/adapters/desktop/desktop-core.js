/**
 * Desktop Integration Core - 桌面集成核心
 * 完整的 DesktopCore 类实现
 * 
 * 功能特性：
 * - DesktopCore 类的完整实现
 * - UIBridge 接口实现
 * - 状态管理
 * - IPC 适配器集成
 * - 生命周期管理
 */

import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  RuntimeEvent,
  HOOKS
} from '../../runtime/index.js';
import { createPlugin } from '../../runtime/plugin-system.js';
import {
  MainProcessIPCAdapter,
  RendererProcessIPCAdapter,
  IPCMessageType,
  IPCMessage,
  createMainProcessIPCAdapter,
  createRendererProcessIPCAdapter
} from './ipc-adapter.js';

/**
 * Desktop 状态类型
 */
export const DesktopState = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  READY: 'ready',
  RUNNING: 'running',
  ERROR: 'error',
  DISPOSED: 'disposed'
};

/**
 * Desktop 配置默认值
 */
const DEFAULT_DESKTOP_CONFIG = {
  workingDirectory: process.cwd(),
  debug: false,
  maxIterations: 180,
  autoDownloadModels: true,
  
  // IPC 配置
  ipc: {
    enabled: true,
    requestTimeout: 30000,
    heartbeatInterval: 30000,
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
    enableQueue: true,
    validateMessages: true
  },
  
  // UI 配置
  ui: {
    autoAttach: true,
    eventBuffering: true,
    maxBufferSize: 100
  }
};

/**
 * DesktopCore - 桌面应用核心类
 * 管理整个桌面应用的生命周期和状态
 */
export class DesktopCore {
  #config;
  #engine;
  #eventBus;
  #ipcAdapter;
  #uiBridge;
  #state;
  #eventBuffer;
  #subscriptions;
  #isInitialized;
  #pendingOperations;
  #stateListeners;

  constructor(config = {}) {
    // 合并配置
    this.#config = {
      ...DEFAULT_DESKTOP_CONFIG,
      ...config,
      ipc: { ...DEFAULT_DESKTOP_CONFIG.ipc, ...config.ipc },
      ui: { ...DEFAULT_DESKTOP_CONFIG.ui, ...config.ui }
    };
    
    // 初始化内部状态
    this.#eventBus = getEventBus();
    this.#state = DesktopState.IDLE;
    this.#isInitialized = false;
    this.#eventBuffer = [];
    this.#subscriptions = [];
    this.#pendingOperations = new Map();
    this.#stateListeners = new Set();
    
    if (this.#config.debug) {
      console.log('[DesktopCore] 实例已创建');
    }
  }

  /**
   * 初始化桌面核心
   */
  async initialize() {
    if (this.#isInitialized) {
      if (this.#config.debug) {
        console.log('[DesktopCore] 已经初始化');
      }
      return;
    }

    this.#setState(DesktopState.INITIALIZING);
    
    try {
      if (this.#config.debug) {
        console.log('[DesktopCore] 开始初始化...');
      }

      // 创建并初始化 Agent Engine
      this.#engine = createAgentEngine({
        platform: PlatformType.DESKTOP,
        ...this.#config
      });

      await this.#engine.initialize();
      
      // 设置事件转发
      this.#setupEventForwarding();
      
      // 设置状态监听
      this.#setupStateMonitoring();
      
      this.#isInitialized = true;
      this.#setState(DesktopState.READY);
      
      if (this.#config.debug) {
        console.log('[DesktopCore] 初始化完成');
      }
      
      return this;
    } catch (error) {
      this.#setState(DesktopState.ERROR);
      this.#handleError(error, 'initialize');
      throw error;
    }
  }

  /**
   * 设置事件转发
   */
  #setupEventForwarding() {
    const self = this;
    
    // 定义需要转发的事件
    const eventsToForward = [
      RuntimeEvent.AGENT_START,
      RuntimeEvent.AGENT_STOP,
      RuntimeEvent.AGENT_COMPLETE,
      RuntimeEvent.AGENT_ERROR,
      RuntimeEvent.TOOL_CALL,
      RuntimeEvent.TOOL_RESULT,
      RuntimeEvent.TOOL_ERROR,
      RuntimeEvent.STATUS_UPDATE,
      RuntimeEvent.CONFIG_CHANGE,
      RuntimeEvent.MESSAGE_RECEIVED,
      RuntimeEvent.MESSAGE_SENT
    ];

    // 订阅并转发事件
    for (const eventName of eventsToForward) {
      const unsubscribe = this.#eventBus.subscribe(eventName, (eventData) => {
        self.#forwardEvent(eventName, eventData);
      });
      this.#subscriptions.push(unsubscribe);
    }
  }

  /**
   * 设置状态监听
   */
  #setupStateMonitoring() {
    const self = this;
    
    // 监听引擎状态变化，并保存订阅以便清理
    const unsub1 = this.#eventBus.subscribe(RuntimeEvent.AGENT_START, () => {
      self.#setState(DesktopState.RUNNING);
    });
    this.#subscriptions.push(unsub1);
    
    const unsub2 = this.#eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, () => {
      self.#setState(DesktopState.READY);
    });
    this.#subscriptions.push(unsub2);
    
    const unsub3 = this.#eventBus.subscribe(RuntimeEvent.AGENT_ERROR, () => {
      self.#setState(DesktopState.ERROR);
    });
    this.#subscriptions.push(unsub3);
    
    const unsub4 = this.#eventBus.subscribe(RuntimeEvent.AGENT_STOP, () => {
      self.#setState(DesktopState.READY);
    });
    this.#subscriptions.push(unsub4);
  }

  /**
   * 转发事件到 UI
   */
  #forwardEvent(eventName, eventData) {
    const message = {
      type: eventName,
      data: eventData,
      timestamp: Date.now()
    };
    
    // 缓冲事件
    if (this.#config.ui.eventBuffering) {
      this.#bufferEvent(message);
    }
    
    // 发送到 UI Bridge
    if (this.#uiBridge) {
      this.#uiBridge.onMessage(message);
    }
    
    // 发送到 IPC 适配器
    if (this.#ipcAdapter) {
      this.#ipcAdapter.broadcast(eventName, eventData);
    }
    
    // 如果调试模式，打印日志
    if (this.#config.debug) {
      console.log(`[DesktopCore] 转发事件: ${eventName}`, eventData);
    }
  }

  /**
   * 缓冲事件
   */
  #bufferEvent(message) {
    if (this.#eventBuffer.length >= this.#config.ui.maxBufferSize) {
      // 移除最旧的事件
      this.#eventBuffer.shift();
    }
    this.#eventBuffer.push(message);
  }

  /**
   * 设置状态
   */
  #setState(newState) {
    const oldState = this.#state;
    this.#state = newState;
    
    // 通知状态监听器
    for (const listener of this.#stateListeners) {
      try {
        listener({ oldState, newState, timestamp: Date.now() });
      } catch (error) {
        if (this.#config.debug) {
          console.error('[DesktopCore] 状态监听器错误:', error);
        }
      }
    }
    
    // 发送状态更新事件
    this.#eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: newState,
      previousStatus: oldState
    });
  }

  /**
   * 处理错误
   */
  #handleError(error, operation) {
    const errorInfo = {
      operation,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    };
    
    this.#eventBus.emit(RuntimeEvent.AGENT_ERROR, errorInfo);
    
    if (this.#uiBridge) {
      this.#uiBridge.onMessage({
        type: 'error',
        data: errorInfo,
        timestamp: Date.now()
      });
    }
    
    if (this.#config.debug) {
      console.error(`[DesktopCore] 错误 (${operation}):`, error);
    }
  }

  /**
   * 附加 IPC 适配器（主进程）
   */
  attachIPCAdapter(ipcMain) {
    if (!ipcMain) {
      throw new Error('ipcMain 参数必须提供');
    }
    
    this.#ipcAdapter = createMainProcessIPCAdapter(ipcMain, this.#eventBus, {
      ...this.#config.ipc,
      debug: this.#config.debug
    });
    
    // 附加引擎到 IPC 适配器
    if (this.#engine) {
      this.#ipcAdapter.attachEngine(this.#engine);
    }
    
    if (this.#config.debug) {
      console.log('[DesktopCore] IPC 适配器已附加');
    }
    
    return this.#ipcAdapter;
  }

  /**
   * 附加 UI Bridge
   */
  attachUIBridge(bridge) {
    if (!bridge) {
      throw new Error('bridge 参数必须提供');
    }
    
    this.#uiBridge = bridge;
    
    // 如果有缓冲的事件，发送给 UI
    if (this.#config.ui.eventBuffering && this.#eventBuffer.length > 0) {
      for (const message of this.#eventBuffer) {
        this.#uiBridge.onMessage(message);
      }
      // 清空缓冲
      this.#eventBuffer = [];
    }
    
    if (this.#config.debug) {
      console.log('[DesktopCore] UI Bridge 已附加');
    }
    
    return this;
  }

  /**
   * 处理用户输入
   */
  async processInput(input, options = {}) {
    if (!this.#isInitialized) {
      await this.initialize();
    }
    
    if (this.#state !== DesktopState.READY) {
      throw new Error(`DesktopCore 当前状态为 ${this.#state}，无法处理输入`);
    }
    
    // 创建操作 ID
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 存储待处理操作
    this.#pendingOperations.set(operationId, {
      input,
      startTime: Date.now(),
      status: 'pending'
    });
    
    // 发送输入接收事件
    this.#forwardEvent('input_received', { input, operationId });
    
    try {
      const result = await this.#engine.processInput(input, options);
      
      // 更新操作状态
      this.#pendingOperations.set(operationId, {
        ...this.#pendingOperations.get(operationId),
        status: 'completed',
        result,
        endTime: Date.now()
      });
      
      // 发送输出就绪事件
      this.#forwardEvent('output_ready', { result, operationId });
      
      return result;
    } catch (error) {
      // 更新操作状态
      this.#pendingOperations.set(operationId, {
        ...this.#pendingOperations.get(operationId),
        status: 'error',
        error: error.message,
        endTime: Date.now()
      });
      
      this.#handleError(error, 'processInput');
      throw error;
    }
  }

  /**
   * 停止当前执行
   */
  stop() {
    if (this.#engine) {
      this.#engine.stop();
    }
    
    // 清理待处理操作
    for (const [id, operation] of this.#pendingOperations) {
      if (operation.status === 'pending') {
        this.#pendingOperations.set(id, {
          ...operation,
          status: 'cancelled',
          endTime: Date.now()
        });
      }
    }
    
    this.#setState(DesktopState.READY);
    
    if (this.#config.debug) {
      console.log('[DesktopCore] 执行已停止');
    }
  }

  /**
   * 获取当前状态
   */
  getState() {
    return {
      desktopState: this.#state,
      initialized: this.#isInitialized,
      engineState: this.#engine ? this.#engine.getState() : null,
      pendingOperations: this.#pendingOperations.size,
      eventBufferSize: this.#eventBuffer.length,
      ipcConnected: this.#ipcAdapter ? this.#ipcAdapter.isConnected : false,
      uiBridgeAttached: this.#uiBridge !== null
    };
  }

  /**
   * 获取详细状态信息
   */
  getDetailedState() {
    const state = this.getState();
    
    return {
      ...state,
      config: {
        workingDirectory: this.#config.workingDirectory,
        debug: this.#config.debug,
        maxIterations: this.#config.maxIterations
      },
      pendingOperations: Array.from(this.#pendingOperations.entries()).map(([id, op]) => ({
        id,
        input: op.input,
        status: op.status,
        duration: op.endTime ? op.endTime - op.startTime : Date.now() - op.startTime
      })),
      eventBuffer: this.#eventBuffer.slice(-10), // 最近 10 个事件
      ipcStats: this.#ipcAdapter ? this.#ipcAdapter.getStats() : null
    };
  }

  /**
   * 获取引擎实例
   */
  getEngine() {
    return this.#engine;
  }

  /**
   * 获取 IPC 适配器
   */
  getIPCAdapter() {
    return this.#ipcAdapter;
  }

  /**
   * 获取 UI Bridge
   */
  getUIBridge() {
    return this.#uiBridge;
  }

  /**
   * 获取事件总线
   */
  getEventBus() {
    return this.#eventBus;
  }

  /**
   * 获取工具列表
   */
  getTools() {
    if (this.#engine) {
      return this.#engine.getTools();
    }
    return [];
  }

  /**
   * 注册工具
   */
  registerTool(tool) {
    if (this.#engine) {
      this.#engine.registerTool(tool);
    }
  }

  /**
   * 批量注册工具
   */
  registerTools(tools) {
    if (this.#engine) {
      this.#engine.registerTools(tools);
    }
  }

  /**
   * 附加模型提供者
   */
  attachModelProvider(modelProvider) {
    if (this.#engine) {
      this.#engine.attachModelProvider(modelProvider);
    }
  }

  /**
   * 添加状态监听器
   */
  addStateListener(listener) {
    this.#stateListeners.add(listener);
    
    // 返回移除监听器的函数
    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  /**
   * 获取事件缓冲
   */
  getEventBuffer() {
    return [...this.#eventBuffer];
  }

  /**
   * 清空事件缓冲
   */
  clearEventBuffer() {
    this.#eventBuffer = [];
  }

  /**
   * 等待状态
   */
  async waitForState(targetState, timeout = 30000) {
    if (this.#state === targetState) {
      return true;
    }
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`等待状态 ${targetState} 超时`));
      }, timeout);
      
      const unsubscribe = this.addStateListener(({ newState }) => {
        if (newState === targetState) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  /**
   * 检查是否就绪
   */
  isReady() {
    return this.#isInitialized && this.#state === DesktopState.READY;
  }

  /**
   * 检查是否正在运行
   */
  isRunning() {
    return this.#state === DesktopState.RUNNING;
  }

  /**
   * 销毁并清理资源
   */
  async dispose() {
    if (this.#state === DesktopState.DISPOSED) {
      return;
    }
    
    // 先设置为 DISPOSED 状态，防止后续操作改变状态
    const previousState = this.#state;
    this.#state = DesktopState.DISPOSED;
    
    try {
      // 停止当前执行（不改变状态）
      if (this.#engine) {
        this.#engine.stop();
      }
      
      // 清理订阅
      for (const unsubscribe of this.#subscriptions) {
        unsubscribe();
      }
      this.#subscriptions = [];
      
      // 清理状态监听器
      this.#stateListeners.clear();
      
      // 断开 IPC 适配器
      if (this.#ipcAdapter) {
        this.#ipcAdapter.disconnect();
        this.#ipcAdapter = null;
      }
      
      // 销毁引擎
      if (this.#engine) {
        await this.#engine.dispose();
        this.#engine = null;
      }
      
      // 清理缓冲
      this.#eventBuffer = [];
      this.#pendingOperations.clear();
      
      this.#isInitialized = false;
      
      // 发送状态更新事件（通知 UI）
      this.#eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
        status: DesktopState.DISPOSED,
        previousStatus: previousState
      });
      
      if (this.#config.debug) {
        console.log('[DesktopCore] 已销毁');
      }
    } catch (error) {
      this.#handleError(error, 'dispose');
      throw error;
    }
  }
}

/**
 * UIBridge - UI 通信桥接类
 * 用于渲染进程和桌面核心之间的通信
 */
export class UIBridge {
  #listeners;
  #messageQueue;
  #pendingCallbacks;
  #config;
  #isConnected;
  #ipcAdapter;

  constructor(config = {}) {
    this.#listeners = new Map();
    this.#messageQueue = [];
    this.#pendingCallbacks = new Map();
    this.#config = {
      maxQueueSize: config.maxQueueSize || 100,
      autoProcessQueue: config.autoProcessQueue !== false,
      debug: config.debug || false
    };
    this.#isConnected = false;
    this.#ipcAdapter = null;
  }

  /**
   * 连接到 IPC 适配器（渲染进程）
   */
  async connect(ipcRenderer) {
    if (!ipcRenderer) {
      throw new Error('ipcRenderer 参数必须提供');
    }
    
    this.#ipcAdapter = createRendererProcessIPCAdapter(ipcRenderer, {
      debug: this.#config.debug
    });
    
    await this.#ipcAdapter.initialize();
    this.#isConnected = true;
    
    // 设置 IPC 事件监听
    this.#setupIPCListeners();
    
    if (this.#config.debug) {
      console.log('[UIBridge] 已连接到 IPC');
    }
    
    return this;
  }

  /**
   * 设置 IPC 监听器
   */
  #setupIPCListeners() {
    if (!this.#ipcAdapter) return;
    
    // 监听所有运行时事件
    const events = [
      RuntimeEvent.AGENT_START,
      RuntimeEvent.AGENT_STOP,
      RuntimeEvent.AGENT_COMPLETE,
      RuntimeEvent.AGENT_ERROR,
      RuntimeEvent.TOOL_CALL,
      RuntimeEvent.TOOL_RESULT,
      RuntimeEvent.TOOL_ERROR,
      RuntimeEvent.STATUS_UPDATE,
      RuntimeEvent.CONFIG_CHANGE
    ];
    
    for (const eventName of events) {
      this.#ipcAdapter.subscribe(eventName, (data) => {
        this.onMessage({
          type: eventName,
          data,
          timestamp: Date.now()
        });
      });
    }
  }

  /**
   * 接收来自核心的消息
   */
  onMessage(message) {
    // 缓冲消息
    if (this.#messageQueue.length >= this.#config.maxQueueSize) {
      this.#messageQueue.shift();
    }
    this.#messageQueue.push(message);
    
    // 分发给监听器
    const listeners = this.#listeners.get(message.type) || [];
    for (const listener of listeners) {
      try {
        listener(message);
      } catch (error) {
        if (this.#config.debug) {
          console.error('[UIBridge] 监听器错误:', error);
        }
      }
    }
    
    // 分发给通用监听器
    const allListeners = this.#listeners.get('*') || [];
    for (const listener of allListeners) {
      try {
        listener(message);
      } catch (error) {
        if (this.#config.debug) {
          console.error('[UIBridge] 通用监听器错误:', error);
        }
      }
    }
    
    if (this.#config.debug) {
      console.log(`[UIBridge] 收到消息: ${message.type}`, message.data);
    }
  }

  /**
   * 订阅消息类型
   */
  subscribe(type, callback) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, []);
    }
    this.#listeners.get(type).push(callback);
    
    // 如果有 IPC 适配器，也订阅 IPC 事件
    if (this.#ipcAdapter && type !== '*') {
      this.#ipcAdapter.subscribe(type, callback);
    }
    
    // 返回取消订阅函数
    return () => {
      this.unsubscribe(type, callback);
    };
  }

  /**
   * 取消订阅
   */
  unsubscribe(type, callback) {
    if (this.#listeners.has(type)) {
      const callbacks = this.#listeners.get(type);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
      
      // 如果没有监听器了，删除该类型
      if (callbacks.length === 0) {
        this.#listeners.delete(type);
      }
    }
    
    // 如果有 IPC 适配器，也取消订阅
    if (this.#ipcAdapter && type !== '*') {
      this.#ipcAdapter.unsubscribe(type, callback);
    }
  }

  /**
   * 发送消息到核心
   */
  async sendToCore(type, data) {
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.request(type, data);
    }
    
    // 如果没有 IPC 适配器，只是打印日志
    if (this.#config.debug) {
      console.log(`[UIBridge] 发送到核心: ${type}`, data);
    }
    
    return null;
  }

  /**
   * 便捷方法：处理输入
   */
  async processInput(input, options = {}) {
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.processInput(input, options);
    }
    throw new Error('IPC 适配器未连接');
  }

  /**
   * 便捷方法：停止执行
   */
  async stop() {
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.stop();
    }
    throw new Error('IPC 适配器未连接');
  }

  /**
   * 便捷方法：获取状态
   */
  async getState() {
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.getState();
    }
    throw new Error('IPC 适配器未连接');
  }

  /**
   * 便捷方法：获取工具列表
   */
  async getTools() {
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.getTools();
    }
    throw new Error('IPC 适配器未连接');
  }

  /**
   * 获取消息队列
   */
  getMessageQueue() {
    return [...this.#messageQueue];
  }

  /**
   * 清空消息队列
   */
  clearMessageQueue() {
    this.#messageQueue = [];
  }

  /**
   * 获取最后一条消息
   */
  getLastMessage() {
    return this.#messageQueue[this.#messageQueue.length - 1];
  }

  /**
   * 获取特定类型的消息
   */
  getMessagesByType(type) {
    return this.#messageQueue.filter(msg => msg.type === type);
  }

  /**
   * 检查是否已连接
   */
  isConnected() {
    return this.#isConnected;
  }

  /**
   * 获取 IPC 适配器
   */
  getIPCAdapter() {
    return this.#ipcAdapter;
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.#ipcAdapter) {
      this.#ipcAdapter.disconnect();
      this.#ipcAdapter = null;
    }
    
    this.#isConnected = false;
    this.#listeners.clear();
    this.#messageQueue = [];
    
    if (this.#config.debug) {
      console.log('[UIBridge] 已断开连接');
    }
  }

  /**
   * 创建 React Hooks 兼容的订阅
   */
  createReactHook() {
    return {
      subscribe: this.subscribe.bind(this),
      unsubscribe: this.unsubscribe.bind(this),
      sendMessage: this.sendToCore.bind(this),
      processInput: this.processInput.bind(this),
      stop: this.stop.bind(this),
      getState: this.getState.bind(this),
      getTools: this.getTools.bind(this),
      getMessageQueue: this.getMessageQueue.bind(this),
      isConnected: this.isConnected.bind(this)
    };
  }
}

/**
 * DesktopPlugin - 桌面专用插件
 */
export const DesktopPlugin = createPlugin({
  name: 'desktop',
  version: '1.0.0',
  description: '桌面集成插件 - 提供桌面应用特有的功能',
  
  initialize({ eventBus, engine }) {
    console.log('🖥️  Desktop plugin 已初始化');
    
    // 存储桌面信息
    this.desktopInfo = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions?.electron || 'N/A'
    };
    
    // 注册桌面特有的工具（如果需要）
    this._registerDesktopTools(engine);
  },
  
  // 内部方法：注册桌面工具
  _registerDesktopTools(engine) {
    // 可以在这里注册桌面特有的工具
    // 例如：窗口管理、系统通知、文件对话框等
  },
  
  hooks: {
    [HOOKS.BEFORE_INIT]: async (config) => {
      console.log('🖥️  Desktop plugin - 初始化前检查');
      
      // 验证桌面配置
      if (config.platform !== PlatformType.DESKTOP) {
        console.warn('⚠️  配置的 platform 不是 DESKTOP，将自动调整');
        config.platform = PlatformType.DESKTOP;
      }
    },
    
    [HOOKS.AFTER_INIT]: async (engine) => {
      console.log('🖥️  Desktop plugin - 引擎已初始化');
      
      // 可以在这里添加桌面特有的初始化逻辑
    },
    
    [HOOKS.BEFORE_AGENT_START]: async (input) => {
      console.log('🖥️  Desktop plugin - 代理即将启动');
    },
    
    [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
      console.log('🖥️  Desktop plugin - 代理已完成');
    },
    
    [HOOKS.ON_TOOL_ERROR]: async (toolName, error) => {
      console.error(`🖥️  Desktop plugin - 工具错误: ${toolName}`, error.message);
    }
  }
});

/**
 * 创建 DesktopCore 实例
 */
export function createDesktopCore(config = {}) {
  return new DesktopCore(config);
}

/**
 * 创建 UIBridge 实例
 */
export function createUIBridge(config = {}) {
  return new UIBridge(config);
}

// 导出所有组件
export default {
  DesktopCore,
  UIBridge,
  DesktopPlugin,
  DesktopState,
  createDesktopCore,
  createUIBridge
};