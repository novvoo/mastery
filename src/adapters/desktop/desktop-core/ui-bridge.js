import { RuntimeEvent } from '../../../runtime/types.js';
import { createRendererProcessIPCAdapter } from '../ipc-adapter.js';

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
  #coreRef;

  constructor(config = {}) {
    this.#listeners = new Map();
    this.#messageQueue = [];
    this.#pendingCallbacks = new Map();
    this.#config = {
      maxQueueSize: config.maxQueueSize || 100,
      autoProcessQueue: config.autoProcessQueue !== false,
      debug: config.debug || false,
    };
    this.#isConnected = false;
    this.#ipcAdapter = null;
    this.#coreRef = null;
  }

  /**
   * 连接到 IPC 适配器（渲染进程）
   */
  async connect(ipcRenderer) {
    if (!ipcRenderer) {
      throw new Error('ipcRenderer 参数必须提供');
    }

    this.#ipcAdapter = createRendererProcessIPCAdapter(ipcRenderer, {
      debug: this.#config.debug,
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
    if (!this.#ipcAdapter) {
      return;
    }

    // 监听所有运行时事件
    const events = [
      // 代理生命周期
      RuntimeEvent.AGENT_START,
      RuntimeEvent.AGENT_STOP,
      RuntimeEvent.AGENT_COMPLETE,
      RuntimeEvent.AGENT_ERROR,
      RuntimeEvent.AGENT_THINKING,

      // 流式输出由 useRuntime 直接处理，UIBridge 不重复订阅
      // (AGENT_TEXT_DELTA, AGENT_REASONING_DELTA, AGENT_TOOL_CALL_DELTA)

      // 工具调用
      RuntimeEvent.TOOL_CALL,
      RuntimeEvent.TOOL_RESULT,
      RuntimeEvent.TOOL_ERROR,
      RuntimeEvent.TOOL_ACTIVITY,
      RuntimeEvent.TOOL_PROGRESS,

      // 状态与配置
      RuntimeEvent.STATUS_UPDATE,
      RuntimeEvent.CONFIG_CHANGE,

      // 执行计划（右侧 Plan 面板）
      RuntimeEvent.EXECUTION_PLAN_CREATED,
      RuntimeEvent.EXECUTION_PLAN_UPDATED,
      RuntimeEvent.PLAN_DECOMPOSED,
      RuntimeEvent.PLAN_EXECUTED,

      // 子代理与交互
      RuntimeEvent.SUBAGENT_UPDATE,
      RuntimeEvent.AGENT_INTERACTION_REQUEST,
      RuntimeEvent.AGENT_INTERACTION_CANCEL,

      // 记忆更新
      RuntimeEvent.MEMORY_UPDATE,
      RuntimeEvent.MEMORY_CLEAR,

      // 用户输入与会话
      RuntimeEvent.MESSAGE_RECEIVED,
      RuntimeEvent.MESSAGE_SENT,
      RuntimeEvent.SESSION_CHANGE,
    ];

    for (const eventName of events) {
      this.#ipcAdapter.subscribe(eventName, (data) => {
        this.onMessage({
          type: eventName,
          data,
          timestamp: Date.now(),
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
   * 附加 DesktopCore 引用（直接模式，无需 IPC）
   */
  attachCoreRef(core) {
    this.#coreRef = core;
    this.#isConnected = true;
  }

  /**
   * 便捷方法：处理输入
   */
  async processInput(input, options = {}) {
    if (this.#coreRef) {
      return this.#coreRef.processInput(input, options);
    }
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.processInput(input, options);
    }
    throw new Error('未连接到 DesktopCore 或 IPC 适配器');
  }

  /**
   * 便捷方法：停止执行
   */
  async stop() {
    if (this.#coreRef) {
      return this.#coreRef.stop();
    }
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.stop();
    }
    throw new Error('未连接到 DesktopCore 或 IPC 适配器');
  }

  /**
   * 便捷方法：获取状态
   */
  getState() {
    if (this.#coreRef) {
      return this.#coreRef.getState();
    }
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.getState();
    }
    throw new Error('未连接到 DesktopCore 或 IPC 适配器');
  }

  /**
   * 便捷方法：获取工具列表
   */
  getTools() {
    if (this.#coreRef) {
      return this.#coreRef.getTools();
    }
    if (this.#ipcAdapter) {
      return this.#ipcAdapter.getTools();
    }
    throw new Error('未连接到 DesktopCore 或 IPC 适配器');
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
    return this.#messageQueue.filter((msg) => msg.type === type);
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
      isConnected: this.isConnected.bind(this),
    };
  }
}
