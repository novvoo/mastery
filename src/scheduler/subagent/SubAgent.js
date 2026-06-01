/**
 * SubAgent.js
 * 子代理实现 - 用于执行独立任务单元
 * 增强版：支持记忆共享、原生嵌套、自动清理
 */

import { ReActAgent } from '../../core/agent.js';

/**
 * 子代理状态枚举
 */
export const SubAgentStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped'
};

/**
 * 子代理类
 * 封装一个独立的ReActAgent实例，用于执行特定任务
 * 增强功能：
 * 1. 支持从父代理继承记忆
 * 2. 支持直接创建其他SubAgent（原生嵌套）
 * 3. 支持同步结果获取（Promise）
 */
export class SubAgent {
  // 私有字段
  #id;
  #agent;
  #config;
  #status;
  #task;
  #result;
  #error;
  #startTime;
  #endTime;
  #messageBus;
  #parentId;
  #abortController;
  #subAgentPool;      // 嵌套SubAgent支持
  #parentMemory;      // 父代理记忆引用
  #sharedContext;     // 共享上下文
  #executionPromise;  // 执行Promise（用于同步等待）
  #resolveExecution;  // Promise resolve函数
  #rejectExecution;   // Promise reject函数

  /**
   * 创建子代理实例
   * @param {string} id - 子代理唯一标识
   * @param {Object} modelProvider - 模型提供者实例
   * @param {Object} toolRegistry - 工具注册表实例
   * @param {Object} memoryManager - 内存管理器实例
   * @param {Object} config - 配置对象
   * @param {Object} options - 可选参数
   * @param {string} [options.parentId] - 父代理ID
   * @param {MessageBus} [options.messageBus] - 消息总线实例
   * @param {SubAgentPool} [options.subAgentPool] - 子代理池（用于嵌套创建）
   * @param {Object} [options.parentMemory] - 父代理记忆（用于共享）
   * @param {Object} [options.sharedContext] - 共享上下文数据
   */
  constructor(id, modelProvider, toolRegistry, memoryManager, config, options = {}) {
    this.#id = id;
    this.#config = config;
    this.#status = SubAgentStatus.IDLE;
    this.#task = null;
    this.#result = null;
    this.#error = null;
    this.#startTime = null;
    this.#endTime = null;
    this.#parentId = options.parentId || null;
    this.#messageBus = options.messageBus || null;
    this.#abortController = null;
    this.#subAgentPool = options.subAgentPool || null;
    this.#parentMemory = options.parentMemory || null;
    this.#sharedContext = options.sharedContext || {};
    this.#executionPromise = null;
    this.#resolveExecution = null;
    this.#rejectExecution = null;

    // 如果有父记忆，先同步到当前记忆
    if (this.#parentMemory) {
      this.#syncParentMemory(memoryManager);
    }

    // 创建独立的ReActAgent实例
    this.#agent = new ReActAgent(modelProvider, toolRegistry, memoryManager, config);
  }

  /**
   * 同步父代理记忆到当前记忆
   * @private
   * @param {Object} memoryManager - 当前记忆管理器
   */
  #syncParentMemory(memoryManager) {
    try {
      // 同步关键决策
      if (this.#parentMemory.keyDecisions) {
        for (const decision of this.#parentMemory.keyDecisions) {
          memoryManager.addDecision(decision.decision, decision.reason);
        }
      }
      // 同步约束条件
      if (this.#parentMemory.constraints) {
        for (const constraint of this.#parentMemory.constraints) {
          memoryManager.addConstraint(constraint);
        }
      }
      // 同步文件映射
      if (this.#parentMemory.fileMap) {
        for (const [file, info] of Object.entries(this.#parentMemory.fileMap)) {
          memoryManager.updateFileMap(file, info);
        }
      }
      // 同步当前任务信息
      if (this.#parentMemory.currentTask) {
        memoryManager.updateTask(this.#parentMemory.currentTask);
      }
    } catch (error) {
      console.warn(`SubAgent ${this.#id} failed to sync parent memory:`, error);
    }
  }

  /**
   * 获取子代理ID
   * @returns {string}
   */
  get id() {
    return this.#id;
  }

  /**
   * 获取当前状态
   * @returns {string}
   */
  get status() {
    return this.#status;
  }

  /**
   * 获取父代理ID
   * @returns {string|null}
   */
  get parentId() {
    return this.#parentId;
  }

  /**
   * 获取当前任务
   * @returns {Object|null}
   */
  get task() {
    return this.#task;
  }

  /**
   * 获取执行结果
   * @returns {any}
   */
  get result() {
    return this.#result;
  }

  /**
   * 获取错误信息
   * @returns {string|null}
   */
  get error() {
    return this.#error;
  }

  /**
   * 获取执行Promise（用于同步等待结果）
   * @returns {Promise<Object>|null}
   */
  get executionPromise() {
    return this.#executionPromise;
  }

  /**
   * 创建嵌套的子代理（原生嵌套API）
   * @param {Object} options - 创建选项
   * @param {string} [options.id] - 代理ID
   * @param {string} [options.workingDir] - 工作目录
   * @param {Object} [options.sharedContext] - 额外共享上下文
   * @returns {SubAgent} 创建的子代理
   * @throws {Error} 如果没有可用的SubAgentPool
   */
  createSubAgent(options = {}) {
    if (!this.#subAgentPool) {
      throw new Error('SubAgentPool not available. Nested SubAgent creation requires a SubAgentPool.');
    }

    // 合并共享上下文
    const mergedContext = {
      ...this.#sharedContext,
      ...options.sharedContext,
      parentAgentId: this.#id,
      parentTaskId: this.#task?.id
    };

    // 获取当前记忆状态用于共享
    const currentMemory = this.#agent.memoryManager;
    const memorySnapshot = {
      keyDecisions: currentMemory?.context?.keyDecisions || [],
      constraints: currentMemory?.context?.constraints || [],
      fileMap: currentMemory?.context?.fileMap || {},
      currentTask: currentMemory?.context?.currentTask
    };

    return this.#subAgentPool.create({
      ...options,
      parentId: this.#id,
      parentMemory: memorySnapshot,
      sharedContext: mergedContext
    });
  }

  /**
   * 运行任务
   * @param {Object} task - 任务对象
   * @param {string} task.id - 任务ID
   * @param {string} task.type - 任务类型
   * @param {Object} task.payload - 任务载荷
   * @param {Object} options - 运行选项
   * @param {boolean} [options.waitForCompletion=true] - 是否等待完成（同步模式）
   * @param {number} [options.timeout] - 超时时间（毫秒）
   * @returns {Promise<Object>} 执行结果
   */
  async run(task, options = {}) {
    if (this.#status === SubAgentStatus.RUNNING) {
      throw new Error(`SubAgent ${this.#id} is already running`);
    }

    const { waitForCompletion = true, timeout } = options;

    this.#status = SubAgentStatus.RUNNING;
    this.#task = task;
    this.#result = null;
    this.#error = null;
    this.#startTime = Date.now();
    this.#endTime = null;
    this.#abortController = new AbortController();

    // 创建执行Promise（用于同步等待）
    this.#executionPromise = new Promise((resolve, reject) => {
      this.#resolveExecution = resolve;
      this.#rejectExecution = reject;
    });

    // 通知父代理任务开始
    this.#notifyParent('task:started', {
      taskId: task.id,
      taskType: task.type,
      timestamp: this.#startTime
    });

    // 启动执行
    const executionPromise = this.#executeTask(task);

    // 如果设置了超时
    if (timeout && timeout > 0) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Task execution timeout after ${timeout}ms`));
        }, timeout);
      });
      
      return Promise.race([executionPromise, timeoutPromise]);
    }

    // 同步模式：等待完成
    if (waitForCompletion) {
      return executionPromise;
    }

    // 异步模式：立即返回Promise
    return this.#executionPromise;
  }

  /**
   * 执行任务核心逻辑
   * @private
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>}
   */
  async #executeTask(task) {
    try {
      // 构建任务提示
      const prompt = this.#buildPrompt(task);

      // 运行代理
      const agentResult = await this.#agent.run(prompt);

      // 检查是否被中止
      if (this.#abortController?.signal.aborted) {
        throw new Error('Task was aborted');
      }

      // 设置成功结果
      this.#result = {
        taskId: task.id,
        output: agentResult?.answer || '',
        agentResult,
        completedAt: Date.now()
      };
      this.#status = SubAgentStatus.COMPLETED;
      this.#endTime = Date.now();

      // 通知父代理任务完成
      this.#notifyParent('task:completed', {
        taskId: task.id,
        result: this.#result,
        duration: this.#endTime - this.#startTime
      });

      // 解析执行Promise
      if (this.#resolveExecution) {
        this.#resolveExecution(this.#result);
      }

      return this.#result;

    } catch (err) {
      // 设置错误状态
      this.#error = err instanceof Error ? err.message : String(err);
      this.#status = this.#abortController?.signal.aborted 
        ? SubAgentStatus.STOPPED 
        : SubAgentStatus.FAILED;
      this.#endTime = Date.now();

      // 通知父代理任务失败
      this.#notifyParent('task:failed', {
        taskId: task.id,
        error: this.#error,
        duration: this.#endTime - this.#startTime
      });

      // 拒绝执行Promise
      if (this.#rejectExecution) {
        this.#rejectExecution(err);
      }

      throw err;
    }
  }

  /**
   * 停止任务执行
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.#status !== SubAgentStatus.RUNNING) {
      return;
    }

    // 触发中止信号
    if (this.#abortController) {
      this.#abortController.abort();
    }

    this.#status = SubAgentStatus.STOPPED;
    this.#endTime = Date.now();

    // 通知父代理任务被停止
    if (this.#task) {
      this.#notifyParent('task:stopped', {
        taskId: this.#task.id,
        timestamp: this.#endTime
      });
    }

    // 拒绝执行Promise
    if (this.#rejectExecution) {
      this.#rejectExecution(new Error('Task was stopped'));
    }
  }

  /**
   * 构建任务提示
   * @private
   * @param {Object} task - 任务对象
   * @returns {string} 构建的提示
   */
  #buildPrompt(task) {
    const lines = [];

    // 任务标题
    lines.push(`# Task: ${task.type}`);
    lines.push('');

    // 任务ID信息
    lines.push(`Task ID: ${task.id}`);
    if (this.#parentId) {
      lines.push(`Parent Agent: ${this.#parentId}`);
    }
    lines.push(`Agent ID: ${this.#id}`);
    lines.push('');

    // 共享上下文（如果有）
    if (Object.keys(this.#sharedContext).length > 0) {
      lines.push('## Shared Context');
      for (const [key, value] of Object.entries(this.#sharedContext)) {
        lines.push(`- ${key}: ${JSON.stringify(value)}`);
      }
      lines.push('');
    }

    // 任务载荷
    lines.push('## Task Payload');
    if (typeof task.payload === 'object' && task.payload !== null) {
      for (const [key, value] of Object.entries(task.payload)) {
        lines.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    } else {
      lines.push(String(task.payload));
    }
    lines.push('');

    // 指令
    lines.push('## Instructions');
    lines.push('Please complete the task above. Use the available tools as needed.');
    lines.push('When finished, provide a clear summary of what was accomplished.');
    lines.push('If you encounter any issues, document them clearly.');

    return lines.join('\n');
  }

  /**
   * 通知父代理
   * @private
   * @param {string} event - 事件类型
   * @param {Object} data - 事件数据
   */
  #notifyParent(event, data) {
    if (!this.#messageBus || !this.#parentId) {
      return;
    }

    try {
      this.#messageBus.send({
        from: this.#id,
        to: this.#parentId,
        event,
        data
      });
    } catch (error) {
      console.error(`Failed to notify parent ${this.#parentId}:`, error);
    }
  }

  /**
   * 接收消息
   * @param {Object} message - 消息对象
   * @returns {void}
   */
  receiveMessage(message) {
    // 处理来自父代理或其他代理的消息

    switch (message.event) {
      case 'command:stop':
        this.stop();
        break;
      case 'command:pause':
        this.#notifyParent('task:pause_requested', { agentId: this.#id });
        break;
      case 'data:update':
        // 更新共享上下文
        if (message.data?.sharedContext) {
          this.#sharedContext = { ...this.#sharedContext, ...message.data.sharedContext };
        }
        break;
      default:
        this.#notifyParent('message:ignored', { agentId: this.#id, event: message.event });
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const now = Date.now();
    const duration = this.#startTime 
      ? (this.#endTime || now) - this.#startTime 
      : 0;

    return {
      id: this.#id,
      status: this.#status,
      parentId: this.#parentId,
      taskId: this.#task?.id || null,
      startTime: this.#startTime,
      endTime: this.#endTime,
      duration,
      hasExecutionPromise: this.#executionPromise !== null
    };
  }

  /**
   * 释放资源
   */
  dispose() {
    // 停止正在运行的任务
    if (this.#status === SubAgentStatus.RUNNING) {
      this.stop();
    }

    // 释放代理资源
    if (this.#agent) {
      this.#agent.dispose();
    }

    // 清理引用
    this.#task = null;
    this.#result = null;
    this.#error = null;
    this.#messageBus = null;
    this.#abortController = null;
    this.#subAgentPool = null;
    this.#parentMemory = null;
    this.#sharedContext = null;
    this.#executionPromise = null;
    this.#resolveExecution = null;
    this.#rejectExecution = null;
  }
}

export default SubAgent;
