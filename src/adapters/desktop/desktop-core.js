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

import { getEventBus, RuntimeEvent } from '../../runtime/index.js';
import {
  bootstrapRuntime,
  attachModelProvider as attachRuntimeModelProvider,
  initializeMCPServersFromEnv,
} from '../../core/runtime/runtime-bootstrap.js';
import { createMainProcessIPCAdapter } from './ipc-adapter.js';
import { metricsSink } from '../../core/runtime/metrics-sink.js';
import { DesktopPlugin } from './desktop-core/desktop-plugin.js';
import { UIBridge } from './desktop-core/ui-bridge.js';

export { DesktopPlugin } from './desktop-core/desktop-plugin.js';
export { UIBridge } from './desktop-core/ui-bridge.js';

/**
 * Desktop 状态类型
 */
export const DesktopState = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  READY: 'ready',
  RUNNING: 'running',
  ERROR: 'error',
  DISPOSED: 'disposed',
};

/**
 * Desktop 配置默认值
 */
const DEFAULT_DESKTOP_CONFIG = {
  workingDirectory: process.cwd(),
  debug: false,
  maxIterations: 60,
  autoDownloadModels: true,

  // IPC 配置
  ipc: {
    enabled: true,
    requestTimeout: 30000,
    heartbeatInterval: 30000,
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
    enableQueue: true,
    validateMessages: true,
  },

  // UI 配置
  ui: {
    autoAttach: true,
    eventBuffering: true,
    maxBufferSize: 100,
  },
};

/**
 * DesktopCore - 桌面应用核心类
 * 管理整个桌面应用的生命周期和状态
 */
export class DesktopCore {
  #config;
  #engine;
  #runtime; // runtime-bootstrap 产物：{ engine, toolRegistry, securityPolicy, workspaceState, metricsSink, mcpClient }
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
      ui: { ...DEFAULT_DESKTOP_CONFIG.ui, ...config.ui },
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

      const uiAdapter = this.#createUiAdapter();

      this.#runtime = await bootstrapRuntime({
        workingDirectory: this.#config.workingDirectory,
        maxIterations: this.#config.maxIterations || 60,
        debug: !!this.#config.debug,
        securityPolicy: this.#config.securityPolicy || 'full',
        metrics: {
          enabled: this.#config.metrics?.enabled !== false,
          logDir: this.#config.metrics?.logDir || null,
        },
        modelProvider: this.#config.modelProvider || null,
        memoryManager: this.#config.memoryManager || null,
        ui: uiAdapter,
      });
      this.#engine = this.#runtime.engine;

      // MCP：自动发现 & 注册
      try {
        await initializeMCPServersFromEnv(this.#runtime.mcpClient, this.#runtime.toolRegistry);
      } catch (err) {
        if (this.#config.debug) {
          console.log('[DesktopCore] MCP 初始化跳过:', err.message);
        }
      }

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
   * 创建 UI 适配器：把 agent-engine 的 ui 回调转成 EventBus 事件，
   * 再由 #setupEventForwarding() 转发到 IPC。这是"运行详情面板"
   * 能收到 tool_call / tool_result / final_answer 等事件的关键。
   */
  #createUiAdapter() {
    const eventBus = this.#eventBus;
    const isDebug = !!this.#config.debug;

    return {
      toolCall(name, args) {
        const eventData = {
          name,
          arguments: args,
          timestamp: Date.now(),
        };
        if (isDebug) {
          console.log('[UiAdapter] tool:call', name);
        }
        eventBus.emit(RuntimeEvent.TOOL_CALL, eventData);
      },
      toolResult(name, result, args = {}) {
        const eventData = {
          name,
          arguments: args,
          args,
          result: typeof result === 'string' ? result : (result?.result ?? result),
          timestamp: Date.now(),
        };
        if (isDebug) {
          console.log('[UiAdapter] tool:result', name);
        }
        eventBus.emit(RuntimeEvent.TOOL_RESULT, eventData);
      },
      toolError(name, error) {
        const eventData = {
          name,
          error: typeof error === 'string' ? error : (error?.message ?? String(error)),
          timestamp: Date.now(),
        };
        if (isDebug) {
          console.log('[UiAdapter] tool:error', name, eventData.error);
        }
        eventBus.emit(RuntimeEvent.TOOL_ERROR, eventData);
      },
      iteration(iteration, maxIterations) {
        const eventData = {
          iteration,
          maxIterations,
          timestamp: Date.now(),
        };
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, eventData);
      },
      waitingForUserInput(info) {
        if (isDebug) {
          console.log('[UiAdapter] waitingForUserInput');
        }
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          message: '需要你补充一点信息后继续',
          level: 'info',
          status: 'needs_user_input',
          data: info,
        });
      },
      finalAnswer(answer) {
        if (isDebug) {
          console.log('[UiAdapter] agent:complete');
        }
        // 只发 AGENT_COMPLETE 用于流式消息收口，不设 status='completed'
        // status 由 processInput 返回后才变为 completed，避免运行时详情面板提前折叠
        eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { answer, timestamp: Date.now() });
      },
      warn(message) {
        // Warnings are not errors — they are expected skip/block observations
        // (e.g. "file previously checked and does not exist"). Emitting them as
        // AGENT_ERROR would pollute the error log and set agent status to 'error'.
        // Use STATUS_UPDATE with level:'warn' instead, matching session-state.js.
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          level: 'warn',
          message: typeof message === 'string' ? message : (message?.message ?? String(message)),
          timestamp: Date.now(),
        });
      },
      debug(message) {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
          level: 'debug',
          message: typeof message === 'string' ? message : String(message),
          timestamp: Date.now(),
        });
      },
      debugEvent(name, data) {
        if (name === 'Agent run started') {
          eventBus.emit(RuntimeEvent.AGENT_START, {
            ...(data || {}),
            timestamp: Date.now(),
          });
          if (isDebug) {
            console.log('[UiAdapter] agent:start');
          }
        } else if (name === 'Execution plan created') {
          eventBus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, {
            ...(data || {}),
            eventName: name,
            timestamp: Date.now(),
          });
        } else if (name === 'Execution plan updated') {
          eventBus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
            ...(data || {}),
            eventName: name,
            timestamp: Date.now(),
          });
        } else {
          eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
            level: 'debug',
            message: `[${name}]`,
            eventName: name,
            data: data || null,
            timestamp: Date.now(),
          });
        }
      },
      planProgress(progress) {
        const plan = progress.plan || {};
        const planId = progress.planId || plan.id;
        const tasks = progress.tasks || plan.tasks || [];
        eventBus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
          planId,
          plan: {
            id: planId,
            name: plan.name,
            description: plan.description,
            tasks: tasks.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.displayStatus || t.status,
              description: t.description,
            })),
            status: progress.planStatus || plan.status,
            createdAt: plan.createdAt,
            decompositionMethod: plan.decompositionMethod,
          },
          summary: `进度: ${progress.completed}/${progress.total}`,
          timestamp: Date.now(),
        });
        if (isDebug) {
          console.log('[UiAdapter] plan:progress', progress.completed, '/', progress.total);
        }
      },
      onTextDelta(text) {
        eventBus.emit(RuntimeEvent.AGENT_TEXT_DELTA, { text, timestamp: Date.now() });
      },
      onReasoningDelta(text) {
        eventBus.emit(RuntimeEvent.AGENT_REASONING_DELTA, { text, timestamp: Date.now() });
      },
      onToolCallDelta(delta) {
        eventBus.emit(RuntimeEvent.AGENT_TOOL_CALL_DELTA, { ...delta, timestamp: Date.now() });
      },
    };
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
      RuntimeEvent.AGENT_THINKING,
      RuntimeEvent.AGENT_TEXT_DELTA,
      RuntimeEvent.AGENT_REASONING_DELTA,
      RuntimeEvent.AGENT_TOOL_CALL_DELTA,
      RuntimeEvent.EXECUTION_PLAN_CREATED,
      RuntimeEvent.EXECUTION_PLAN_UPDATED,
      RuntimeEvent.PLAN_DECOMPOSED,
      RuntimeEvent.TOOL_CALL,
      RuntimeEvent.TOOL_RESULT,
      RuntimeEvent.TOOL_ERROR,
      RuntimeEvent.TOOL_ACTIVITY,
      RuntimeEvent.STATUS_UPDATE,
      RuntimeEvent.CONFIG_CHANGE,
      RuntimeEvent.MESSAGE_RECEIVED,
      RuntimeEvent.MESSAGE_SENT,
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
      timestamp: Date.now(),
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
      previousStatus: oldState,
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
      timestamp: Date.now(),
    };

    this.#eventBus.emit(RuntimeEvent.AGENT_ERROR, errorInfo);

    if (this.#uiBridge) {
      this.#uiBridge.onMessage({
        type: 'error',
        data: errorInfo,
        timestamp: Date.now(),
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

    // 如果已附加同一适配器，直接返回
    if (this.#ipcAdapter) {
      return this.#ipcAdapter;
    }

    this.#ipcAdapter = createMainProcessIPCAdapter(ipcMain, this.#eventBus, {
      ...this.#config.ipc,
      debug: this.#config.debug,
    });

    // 初始化 IPC 适配器（建立连接、注册处理器、设置心跳等）
    this.#ipcAdapter.initialize();

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

    // 建立直接连接模式（无 IPC 时也能获取工具/状态）
    bridge.attachCoreRef(this);

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
      status: 'pending',
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
        endTime: Date.now(),
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
        endTime: Date.now(),
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
          endTime: Date.now(),
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
      uiBridgeAttached: this.#uiBridge !== null,
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
        maxIterations: this.#config.maxIterations,
      },
      pendingOperations: Array.from(this.#pendingOperations.entries()).map(([id, op]) => ({
        id,
        input: op.input,
        status: op.status,
        duration: op.endTime ? op.endTime - op.startTime : Date.now() - op.startTime,
      })),
      eventBuffer: this.#eventBuffer.slice(-10), // 最近 10 个事件
      ipcStats: this.#ipcAdapter ? this.#ipcAdapter.getStats() : null,
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
   * 获取 LSP Manager 实例（用于编辑器集成）。
   */
  getLSPManager() {
    return this.#engine ? this.#engine.getLSPManager() : null;
  }

  /**
   * 附加模型提供者
   */
  attachModelProvider(modelProvider) {
    if (this.#engine) {
      attachRuntimeModelProvider(this.#engine, modelProvider);
    }
  }

  /**
   * 动态更新工作目录。下一次 processInput 将使用新路径。
   */
  setWorkingDirectory(directory) {
    if (!directory || typeof directory !== 'string') {
      return;
    }
    this.#config.workingDirectory = directory;
    if (this.#engine && typeof this.#engine.setWorkingDirectory === 'function') {
      this.#engine.setWorkingDirectory(directory);
    }
  }

  /** 访问 runtime-bootstrap 产物（只读） */
  getRuntime() {
    return this.#runtime;
  }
  getWorkspaceState() {
    return this.#runtime?.workspaceState;
  }
  getMetricsSink() {
    return metricsSink;
  }
  getMcpClient() {
    return this.#runtime?.mcpClient;
  }
  getSecurityPolicy() {
    return this.#runtime?.securityPolicy;
  }
  getToolRegistry() {
    return this.#runtime?.toolRegistry;
  }

  getSessionFileStore() {
    return this.#runtime?.sessionFileStore || null;
  }

  getSessionManager() {
    return this.#engine ? this.#engine.getSessionManager?.() : null;
  }

  getSessionStore() {
    return this.getSessionManager();
  }

  getSessionId() {
    return this.#engine ? this.#engine.getSessionId?.() : null;
  }

  setSessionId(sessionId) {
    if (this.#engine && typeof this.#engine.setSessionId === 'function') {
      this.#engine.setSessionId(sessionId);
    }
  }

  async flushSession() {
    if (this.#engine && typeof this.#engine.flushSession === 'function') {
      await this.#engine.flushSession();
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

    // 通知状态监听器（在清理前通知）
    for (const listener of this.#stateListeners) {
      try {
        listener({
          oldState: previousState,
          newState: DesktopState.DISPOSED,
          timestamp: Date.now(),
        });
      } catch (error) {
        // 忽略监听器自身错误，确保清理流程继续
      }
    }

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

      // 清理状态监听器（通知完成后再清理）
      this.#stateListeners.clear();

      // 断开 IPC 适配器
      if (this.#ipcAdapter) {
        this.#ipcAdapter.disconnect();
        this.#ipcAdapter = null;
      }

      // 断开 UI Bridge
      if (this.#uiBridge) {
        this.#uiBridge.disconnect();
        this.#uiBridge = null;
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
        previousStatus: previousState,
      });

      if (this.#config.debug) {
        try {
          console.log('[DesktopCore] 已销毁');
        } catch {
          /* EIO: pipe already closed during shutdown */
        }
      }
    } catch (error) {
      this.#handleError(error, 'dispose');
      throw error;
    }
  }
}

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
  createUIBridge,
};
