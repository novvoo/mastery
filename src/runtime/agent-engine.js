/**
 * AgentEngine 主类
 *
 * 架构：Facade 模式
 *   主类作为协调器，拥有私有字段和完整状态（ctx）。
 *   每个关注点（初始化、工具编排、会话管理、插件桥接、
 *   事件发射、图规划、安全策略与资源释放）由独立的子模块实现。
 *
 * 子模块目录：
 *   - ./agent-engine/initialization.js
 *   - ./agent-engine/tool-orchestration.js
 *   - ./agent-engine/session-state.js
 *   - ./agent-engine/plugin-bridge.js
 *   - ./agent-engine/event-emission.js
 *   - ./agent-engine/graph-planning.js
 *   - ./agent-engine/safety-enforcement.js
 *
 * 对外 API 与原始单文件实现 100% 兼容。
 */

import {
  buildInitialFields,
  runInitialization,
  initializeToolGroups,
} from './agent-engine/initialization.js';

import {
  registerAllTools,
  registerSchedulerTools,
  wrapToolCalls,
  loadTool,
  unloadTool,
  createToolGroup,
  getToolGroups,
  getGroupTools,
  addToolMiddleware,
  getToolSummary,
  getToolsWithGroups,
  registerMcpTools,
} from './agent-engine/tool-orchestration.js';

import {
  processInput,
  stopAgent,
  clearSession,
  setDebugMode,
  getDebugMode,
} from './agent-engine/session-state.js';

import {
  registerPlugin,
  unregisterPlugin,
  getPluginManager,
  registerHook,
} from './agent-engine/plugin-bridge.js';

import { setUIAdapter, getEventBus, emit } from './agent-engine/event-emission.js';

import {
  attachModelProvider,
  setModelProvider,
  connectMcpServer,
  getGraphPlanner,
} from './agent-engine/graph-planning.js';

import {
  updateMemory,
  clearMemory,
  updateConfig,
  dispose,
} from './agent-engine/safety-enforcement.js';

import { HOOKS } from './plugin-system.js';
import { RuntimeEvent } from './types.js';

/**
 * 主类 — 作为状态容器与协调器。
 * 所有字段都在构造期间通过 buildInitialFields() 生成，
 * 之后由子模块函数以 ctx 形式读写。
 */
export class AgentEngine {
  // ——— 核心配置与事件总线 ———
  #config;
  #eventBus;
  #state;
  #isInitialized;

  // ——— 核心组件（由 initialize() 分配）———
  #agent;
  #toolRegistry;
  #memoryManager;
  #securityPolicy;
  #sessionManager;
  #experienceMemory;
  #tokenJuice;
  #tokenScope;
  #intelligentReasoning;
  #automationEngine;
  #embedder;

  // ——— 扩展组件 ———
  #pluginManager;
  #modelProvider;
  #toolGroups;
  #mcpClient;
  #schedulerEngine;
  #graphPlanner;

  // ——— 工具调用包装状态 ———
  #toolCallsWrapped;

  // ——— UI 适配器 ———
  #uiAdapter;

  constructor(config) {
    const fields = buildInitialFields(config);
    this.#config = fields.config;
    this.#eventBus = fields.eventBus;
    this.#pluginManager = fields.pluginManager;
    this.#state = fields.state;
    this.#isInitialized = fields.isInitialized;
    this.#modelProvider = fields.modelProvider;
    this.#toolGroups = fields.toolGroups;
    this.#toolCallsWrapped = fields.toolCallsWrapped;
    this.#uiAdapter = fields.uiAdapter;
    this.#graphPlanner = fields.graphPlanner;
  }

  /**
   * 将私有字段打包为 ctx 对象供子模块函数使用。
   * 注意：ctx 对象是同一引用，子模块写入会直接反映到私有字段。
   */
  #ctx() {
    const ctx = {
      config: this.#config,
      eventBus: this.#eventBus,
      pluginManager: this.#pluginManager,
      state: this.#state,
      isInitialized: this.#isInitialized,
      modelProvider: this.#modelProvider,
      toolGroups: this.#toolGroups,
      toolCallsWrapped: this.#toolCallsWrapped,
      uiAdapter: this.#uiAdapter,
      graphPlanner: this.#graphPlanner,
      // 运行期字段（initialize 之后存在）
      toolRegistry: this.#toolRegistry,
      memoryManager: this.#memoryManager,
      securityPolicy: this.#securityPolicy,
      sessionManager: this.#sessionManager,
      experienceMemory: this.#experienceMemory,
      tokenJuice: this.#tokenJuice,
      tokenScope: this.#tokenScope,
      intelligentReasoning: this.#intelligentReasoning,
      automationEngine: this.#automationEngine,
      embedder: this.#embedder,
      mcpClient: this.#mcpClient,
      schedulerEngine: this.#schedulerEngine,
      agent: this.#agent,
    };

    // 写入回传代理：ctx.xxx = y 也会同步到 this.#xxx
    return new Proxy(ctx, {
      set: (target, prop, value) => {
        target[prop] = value;
        const privateKey = `#${prop}`;
        // 只在匹配的字段名上同步
        if (prop === 'isInitialized') {
          this.#isInitialized = value;
        } else if (prop === 'toolRegistry') {
          this.#toolRegistry = value;
        } else if (prop === 'memoryManager') {
          this.#memoryManager = value;
        } else if (prop === 'securityPolicy') {
          this.#securityPolicy = value;
        } else if (prop === 'sessionManager') {
          this.#sessionManager = value;
        } else if (prop === 'experienceMemory') {
          this.#experienceMemory = value;
        } else if (prop === 'tokenJuice') {
          this.#tokenJuice = value;
        } else if (prop === 'tokenScope') {
          this.#tokenScope = value;
        } else if (prop === 'intelligentReasoning') {
          this.#intelligentReasoning = value;
        } else if (prop === 'automationEngine') {
          this.#automationEngine = value;
        } else if (prop === 'embedder') {
          this.#embedder = value;
        } else if (prop === 'mcpClient') {
          this.#mcpClient = value;
        } else if (prop === 'schedulerEngine') {
          this.#schedulerEngine = value;
        } else if (prop === 'toolCallsWrapped') {
          this.#toolCallsWrapped = value;
        } else if (prop === 'modelProvider') {
          this.#modelProvider = value;
        } else if (prop === 'uiAdapter') {
          this.#uiAdapter = value;
        } else if (prop === 'agent') {
          this.#agent = value;
        }
        return true;
      },
    });
  }

  // ——— 初始化 ———
  async initialize() {
    const ctx = this.#ctx();
    await runInitialization(ctx, registerAllTools, wrapToolCalls);
  }

  // ——— 模型提供者 ———
  attachModelProvider(modelProvider) {
    const ctx = this.#ctx();
    attachModelProvider(ctx, modelProvider);
  }

  setModelProvider(modelProvider, options = {}) {
    const ctx = this.#ctx();
    setModelProvider(ctx, modelProvider, options);
  }

  // ——— 插件系统 ———
  async registerPlugin(plugin, options = {}) {
    return registerPlugin(this.#ctx(), plugin, options);
  }

  async unregisterPlugin(pluginName) {
    return unregisterPlugin(this.#ctx(), pluginName);
  }

  getPluginManager() {
    return this.#pluginManager;
  }

  registerHook(hookName, fn, options = {}) {
    return registerHook(this.#ctx(), hookName, fn, options);
  }

  // ——— 工具与工具分组 ———
  async loadTool(toolModule, options = {}) {
    return loadTool(this.#ctx(), toolModule, options);
  }

  async unloadTool(toolName) {
    return unloadTool(this.#ctx(), toolName);
  }

  createToolGroup(name, options = {}) {
    return createToolGroup(this.#ctx(), name, options);
  }

  getToolGroups() {
    return getToolGroups(this.#ctx());
  }
  getGroupTools(groupName) {
    return getGroupTools(this.#ctx(), groupName);
  }

  addToolMiddleware(middleware) {
    return addToolMiddleware(this.#ctx(), middleware);
  }

  registerTool(tool) {
    this.#toolRegistry.register(tool);
    this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
    this.#eventBus.emit(RuntimeEvent.TOOL_LOADED, { toolName: tool.name, tool });
  }

  registerTools(tools) {
    for (const tool of tools) {
      this.#toolRegistry.register(tool);
      this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
      this.#eventBus.emit(RuntimeEvent.TOOL_LOADED, { toolName: tool.name, tool });
    }
  }

  getTools() {
    return this.#toolRegistry.getAll();
  }
  getToolsWithGroups() {
    return getToolsWithGroups(this.#ctx());
  }
  getToolSummary() {
    return getToolSummary(this.#ctx());
  }

  // ——— MCP ———
  async connectMcpServer(name, config) {
    const ctx = this.#ctx();
    return connectMcpServer(ctx, name, config);
  }

  // ——— 会话与执行 ———
  async processInput(input, options = {}) {
    const ctx = this.#ctx();
    // 若未初始化，自动先初始化（保留原行为）
    if (!ctx.isInitialized) {
      await runInitialization(ctx, registerAllTools, wrapToolCalls);
    }
    return processInput(ctx, input, options);
  }

  async stop() {
    return stopAgent(this.#ctx());
  }

  clearSession() {
    return clearSession(this.#ctx());
  }

  setDebugMode(enabled) {
    return setDebugMode(this.#ctx(), enabled);
  }
  getDebugMode() {
    return getDebugMode(this.#ctx());
  }

  setUIAdapter(adapter) {
    return setUIAdapter(this.#ctx(), adapter);
  }

  setWorkingDirectory(directory) {
    if (this.#config && typeof directory === 'string' && directory.trim()) {
      this.#config.workingDirectory = directory;
    }
  }

  // ——— 执行计划 (Plan) ———
  /**
   * 创建并智能分解执行计划（async）
   *
   * 为给定的任务描述生成结构化执行计划。
   * - 有 modelProvider → LLM 驱动任务分解 + 方法论工具建议
   * - 无 modelProvider → 回退到模板规则分解
   *
   * 通过 EventBus 发射 plan:created / plan:decomposed / plan:updated 事件
   *
   * @param {string} taskDescription - 任务描述
   * @param {Object} options - { template?, priority?, context?, modelProvider? }
   * @returns {Promise<Object>} { plan, tasks, method: 'llm'|'template' }
   */
  async plan(taskDescription, options = {}) {
    const ctx = this.#ctx();

    if (!ctx.graphPlanner) {
      throw new Error('GraphPlanner 未初始化，请先调用 initialize()');
    }

    const modelProvider = options.modelProvider || ctx.modelProvider;

    // 1. 创建执行计划
    const plan = ctx.graphPlanner.createPlan(
      taskDescription,
      `执行计划: ${taskDescription}`,
      { taskDescription, ...(options.context || {}) },
    );

    // 2. 发射 plan:created 事件
    ctx.eventBus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, {
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        tasks: [],
        status: plan.status,
        createdAt: plan.createdAt,
      },
      summary: `执行计划已创建: ${plan.name}`,
    });

    // 3. 智能分解任务（LLM 驱动 或 模板回退）
    let subtaskDefs;
    let decompositionMethod;

    if (modelProvider && typeof modelProvider.chat === 'function') {
      // LLM 驱动分解：带方法论工具建议 + Hashline 工具感知
      const availableTools = ctx.toolRegistry
        ? ctx.toolRegistry.getAll().map((t) => t.name)
        : [];

      ctx.eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
        message: 'AI 正在分析任务并生成执行计划...',
        level: 'info',
      });

      subtaskDefs = await ctx.graphPlanner.decomposeTaskLLM(
        taskDescription,
        modelProvider,
        {
          availableTools,
          workingDirectory: ctx.config?.workingDirectory,
          priority: options.priority,
          template: options.template,
        },
      );
      decompositionMethod = 'llm';
    } else {
      // 模板回退
      subtaskDefs = ctx.graphPlanner.decomposeTask(
        plan.id,
        taskDescription,
        { template: options.template, priority: options.priority },
      );
      decompositionMethod = 'template';
    }

    // 4. 将子任务注册到 plan（仅 LLM 路径需手动注册；模板路径 decomposeTask 已注册）
    if (decompositionMethod === 'llm') {
      for (const def of subtaskDefs) {
        plan.addTask(def);
      }
    }

    // 5. 将图规划器内部 task 转为普通对象
    const tasksList = Array.from(plan.tasks.values()).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      status: t.status,
      dependencies: [...t.dependencies],
    }));

    // 6. 发射 plan:decomposed 事件
    ctx.eventBus.emit(RuntimeEvent.PLAN_DECOMPOSED, {
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        tasks: tasksList,
        status: plan.status,
        createdAt: plan.createdAt,
        decompositionMethod,
      },
      summary:
        decompositionMethod === 'llm'
          ? `AI 已分析并分解为 ${tasksList.length} 个子任务`
          : `计划已分解为 ${tasksList.length} 个子任务`,
      subtasks: tasksList,
    });

    // 7. 发射 plan:updated 事件（GUI 用此更新进度卡片）
    ctx.eventBus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        tasks: tasksList,
        status: plan.status,
        createdAt: plan.createdAt,
        decompositionMethod,
      },
      summary: `计划: ${plan.name} (${decompositionMethod === 'llm' ? 'AI分析' : '模板'}，${tasksList.length} 个子任务)`,
      update: { after: `${tasksList.length} 个子任务，方法=${decompositionMethod}` },
    });

    return {
      plan,
      tasks: tasksList,
      method: decompositionMethod,
    };
  }

  // ——— 内存与配置 ———
  async updateMemory(operation, data) {
    return updateMemory(this.#ctx(), operation, data);
  }
  async clearMemory() {
    return clearMemory(this.#ctx());
  }
  async updateConfig(key, value) {
    return updateConfig(this.#ctx(), key, value);
  }

  // ——— Getters ———
  getState() {
    return { ...this.#state };
  }
  getToolRegistry() {
    return this.#toolRegistry;
  }
  getMemoryManager() {
    return this.#memoryManager;
  }
  getSecurityPolicy() {
    return this.#securityPolicy;
  }
  getExperienceMemory() {
    return this.#experienceMemory;
  }
  getSessionManager() {
    return this.#sessionManager;
  }
  getTokenJuice() {
    return this.#tokenJuice;
  }
  getTokenScope() {
    return this.#tokenScope;
  }
  getIntelligentReasoning() {
    return this.#intelligentReasoning;
  }
  getAutomationEngine() {
    return this.#automationEngine;
  }
  getEmbedder() {
    return this.#embedder;
  }
  getMcpClient() {
    return this.#mcpClient;
  }
  getSchedulerEngine() {
    return this.#schedulerEngine;
  }
  getGraphPlanner() {
    return this.#graphPlanner;
  }
  getEventBus() {
    return this.#eventBus;
  }
  getModelProvider() {
    return this.#modelProvider;
  }
  isInitialized() {
    return this.#isInitialized;
  }
  getConfig() {
    return this.#config;
  }
  getAgent() {
    return this.#agent;
  }

  // ——— 资源释放 ———
  async dispose() {
    return dispose(this.#ctx());
  }
}

// 向后兼容：确保旧文件直接引用也能工作
export default AgentEngine;
