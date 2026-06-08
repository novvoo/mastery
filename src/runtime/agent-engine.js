/**
 * Enhanced AgentEngine - Full-featured version
 * 完善的 AgentEngine 版本 - 集成插件系统、中间件、工具分组等
 * 
 * 功能：
 * - 集成 ToolRegistry、MemoryManager、SecurityPolicy 等核心模块
 * - 支持插件系统和钩子机制
 * - 工具分组和中间件支持
 * - 事件总线通信
 * - 向后兼容旧架构
 */

import { RuntimeConfig, AgentState, RuntimeEvent } from './types.js';
import { getEventBus } from './event-bus.js';
import { PluginManager, HOOKS } from './plugin-system.js';

// Import core components - 核心模块导入
import { ReActAgent } from '../core/agent.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { SecurityPolicy } from '../core/security-policy.js';
import { ExperienceMemory } from '../core/experience-memory.js';
import { TokenJuice } from '../core/token-juice.js';
import { SessionManager } from '../core/session-manager.js';
import { IntelligentReasoning } from '../core/intelligent-reasoning.js';
import { AutomationEngine } from '../core/automation-engine.js';
import { Embedder } from '../core/embedder.js';

// Import tools - 工具导入
import { createFileSystemTools } from '../tools/filesystem/filesystem-tools.js';
import { createShellTool } from '../tools/system/shell.js';
import { createPtyTools } from '../tools/system/pty.js';
import { createWorkspaceKnowledgeTools } from '../tools/system/workspace-knowledge.js';
import { createStateCentricTools } from '../tools/harness/state-centric-tools.js';
import { createSemanticSearchTool } from '../tools/memory/semantic-search.js';
import { createDocumentRagTools } from '../tools/memory/document-rag.js';
import { createGitTools } from '../tools/git/git-tools.js';
import { createWebTools } from '../tools/web/web-tools.js';
import { createPreviewTools } from '../tools/web/preview-tools.js';
import { createMCPTools } from '../tools/mcp/mcp-tools.js';
import { createTaskTools } from '../tools/scheduler/task-tools.js';
import { createScheduleTools } from '../tools/scheduler/schedule-tools.js';
import { createSubAgentTools } from '../tools/scheduler/subagent-tools.js';

// Import skill tools - 技能工具导入
import createBrainstormTool from '../tools/skills/brainstorm.js';
import createGrillTool from '../tools/skills/grill.js';
import createTddTool from '../tools/skills/tdd.js';
import createDiagnoseTool from '../tools/skills/diagnose.js';
import createVerifyTool from '../tools/skills/verify.js';
import createCoverageCheckTool from '../tools/skills/coverage_check.js';
import createAskUserTool from '../tools/skills/ask_user.js';
import createReviewTool from '../tools/skills/review.js';
import createArchitectTool from '../tools/skills/architect.js';
import createZoomOutTool from '../tools/skills/zoom_out.js';
import createCavemanTool from '../tools/skills/caveman.js';
import createHandoffTool from '../tools/skills/handoff.js';
import createToPrdTool from '../tools/skills/to_prd.js';
import createToIssuesTool from '../tools/skills/to_issues.js';
import createSetupTool from '../tools/skills/setup.js';

// Import MCP client - MCP客户端导入
import { MCPClient } from '../mcp/mcp-client.js';

// Import scheduler - 调度器导入
import { SchedulerEngine } from '../scheduler/SchedulerEngine.js';

export class AgentEngine {
  // 核心配置和状态
  #config;
  #eventBus;
  #state;
  #isInitialized;
  
  // 核心组件
  #agent;
  #toolRegistry;
  #memoryManager;
  #securityPolicy;
  #experienceMemory;
  #sessionManager;
  #tokenJuice;
  #intelligentReasoning;
  #automationEngine;
  #embedder;
  
  // 扩展组件
  #pluginManager;
  #modelProvider;
  #toolGroups;
  #toolLoader;
  #mcpClient;
  #schedulerEngine;
  
  // UI 适配器
  #uiAdapter;

  constructor(config) {
    this.#config = config instanceof RuntimeConfig ? config : new RuntimeConfig(config);
    this.#eventBus = getEventBus();
    this.#pluginManager = new PluginManager(this.#eventBus, {
      config: this.#config.pluginConfig
    });
    this.#state = new AgentState();
    this.#isInitialized = false;
    this.#modelProvider = null;
    this.#toolGroups = new Map();
    this.#uiAdapter = null;
  }

  /**
   * 初始化 Agent 引擎
   * 按顺序初始化所有核心组件和扩展组件
   */
  async initialize() {
    if (this.#isInitialized) {
      return;
    }

    // 触发初始化前钩子
    await this.#pluginManager.triggerHook(HOOKS.BEFORE_INIT, this.#config);

    this.#eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: 'initializing',
      message: '正在初始化 AI Agent...'
    });

    // 1. 初始化核心组件
    this.#toolRegistry = new ToolRegistry();
    this.#memoryManager = new MemoryManager(this.#config.workingDirectory);
    this.#securityPolicy = new SecurityPolicy({
      requireApproval: this.#config.requireApproval || false
    });
    this.#sessionManager = new SessionManager({
      model: this.#config.model
    });
    
    // 设置插件管理器的工具注册表
    this.#pluginManager.setToolRegistry(this.#toolRegistry);
    
    // 加载内存
    await this.#memoryManager.load();
    
    // 2. 初始化经验内存
    const experienceDir = this.#config.workingDirectory + '/.agent-data';
    this.#experienceMemory = new ExperienceMemory({
      filePath: experienceDir + '/experience-memory.json',
      maxExperiences: 500
    });

    // 3. 初始化 TokenJuice（结果压缩）
    this.#tokenJuice = new TokenJuice({
      maxChars: parseInt(process.env.MAX_RESULT_CHARS || '4000')
    });

    // 4. 初始化智能推理引擎
    this.#intelligentReasoning = new IntelligentReasoning({
      toolRegistry: this.#toolRegistry,
      experienceMemory: this.#experienceMemory,
      config: {
        maxCandidates: 5,
        confidenceThreshold: 0.7
      }
    });

    // 5. 初始化自动化引擎
    this.#automationEngine = new AutomationEngine({
      checkIntervalMs: 5000,
      maxConcurrentWorkflows: 5,
      dataDir: experienceDir + '/.automation'
    });

    // 6. 初始化嵌入器（用于文档 RAG）
    // 在测试环境或 autoDownloadModels=false 时跳过模型下载
    this.#embedder = new Embedder();
    if (this.#config.autoDownloadModels && process.env.NODE_ENV !== 'test') {
      // 异步准备模型，不阻塞初始化
      this.#embedder.prepareModel().catch(error => {
        console.warn('嵌入模型准备失败，将使用备用方案:', error.message);
      });
    }

    // 7. 初始化 MCP 客户端
    this.#mcpClient = new MCPClient();

    // 8. 初始化调度器引擎（如果模型提供者已附加）
    if (this.#modelProvider) {
      this.#schedulerEngine = new SchedulerEngine(
        {
          workingDirectory: this.#config.workingDirectory,
          dataDir: experienceDir,
          checkIntervalMs: 60000,
          maxAgents: 10,
          securityPolicy: this.#securityPolicy
        },
        this.#modelProvider,
        this.#toolRegistry,
        this.#memoryManager
      );
      await this.#schedulerEngine.initialize();
    }

    // 9. 注册所有工具
    await this.#registerAllTools();
    
    // 10. 初始化工具分组
    this.#initializeToolGroups();
    
    // 11. 注册安全策略
    this.#securityPolicy.registerDefaultPolicies(this.#toolRegistry.getAll());

    this.#isInitialized = true;
    
    // 触发初始化后钩子
    await this.#pluginManager.triggerHook(HOOKS.AFTER_INIT, this);

    this.#eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: 'ready',
      message: 'AI Agent 已就绪'
    });
  }

  /**
   * 初始化工具分组
   * 将工具按类别分组以便管理
   */
  #initializeToolGroups() {
    const toolGroups = this.#pluginManager.getToolGroups();
    
    // 创建默认分组
    toolGroups.createGroup('filesystem', {
      description: '文件系统操作工具',
      priority: 10
    });
    
    toolGroups.createGroup('shell', {
      description: 'Shell 命令执行工具',
      priority: 20
    });
    
    toolGroups.createGroup('git', {
      description: 'Git 版本控制工具',
      priority: 30
    });
    
    toolGroups.createGroup('skills', {
      description: '专业技能工具',
      priority: 40
    });
    
    toolGroups.createGroup('memory', {
      description: '内存和搜索工具',
      priority: 50
    });
    
    toolGroups.createGroup('web', {
      description: 'Web 和网络工具',
      priority: 60
    });
    
    toolGroups.createGroup('mcp', {
      description: 'MCP 协议工具',
      priority: 70
    });
    
    toolGroups.createGroup('scheduler', {
      description: '调度和任务工具',
      priority: 80
    });
    
    // 将工具添加到分组
    const tools = this.#toolRegistry.getAll();
    for (const tool of tools) {
      const category = tool.category?.toLowerCase() || 'general';
      
      if (category.includes('file') || category.includes('filesystem')) {
        toolGroups.addToGroup('filesystem', tool.name);
      } else if (category.includes('shell') || category.includes('system') || category.includes('pty')) {
        toolGroups.addToGroup('shell', tool.name);
      } else if (category.includes('git')) {
        toolGroups.addToGroup('git', tool.name);
      } else if (category.includes('skill')) {
        toolGroups.addToGroup('skills', tool.name);
      } else if (category.includes('memory') || category.includes('search') || category.includes('document')) {
        toolGroups.addToGroup('memory', tool.name);
      } else if (category.includes('web') || category.includes('network')) {
        toolGroups.addToGroup('web', tool.name);
      } else if (category.includes('mcp')) {
        toolGroups.addToGroup('mcp', tool.name);
      } else if (category.includes('scheduler') || category.includes('task') || category.includes('subagent')) {
        toolGroups.addToGroup('scheduler', tool.name);
      }
    }
  }

  /**
   * 注册所有工具
   * 包括文件系统、Shell、Git、技能、Web、MCP、调度等工具
   */
  async #registerAllTools() {
    const registeredTools = [];
    
    // 1. 文件系统工具
    try {
      const fsTools = createFileSystemTools();
      for (const tool of fsTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('文件系统工具注册失败:', error.message);
    }

    // 2. Shell 工具
    try {
      const shellTool = createShellTool();
      this.#toolRegistry.register(shellTool);
      registeredTools.push(shellTool.name);
    } catch (error) {
      console.warn('Shell 工具注册失败:', error.message);
    }

    // 2.1 工作区知识工具（用于查询工作区状态）
    try {
      const workspaceKnowledgeTools = createWorkspaceKnowledgeTools(null); // 传入 null，稍后在 Agent 中设置
      for (const tool of workspaceKnowledgeTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('工作区知识工具注册失败:', error.message);
    }

    // 2.2 State-Centric 编辑工具（基于哈希锚点的状态驱动编辑）
    try {
      const stateCentricTools = createStateCentricTools();
      for (const tool of stateCentricTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('状态驱动编辑工具注册失败:', error.message);
    }

    // 3. PTY 工具（交互式终端）
    try {
      const ptyTools = createPtyTools();
      for (const tool of ptyTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('PTY 工具注册失败:', error.message);
    }

    // 4. 语义搜索和文档 RAG 工具
    try {
      const searchTool = createSemanticSearchTool();
      this.#toolRegistry.register(searchTool);
      registeredTools.push(searchTool.name);
    } catch (error) {
      console.warn('语义搜索工具注册失败:', error.message);
    }
    
    try {
      const docRagTools = createDocumentRagTools();
      for (const tool of docRagTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('文档 RAG 工具注册失败:', error.message);
    }
    
    // 5. Git 工具
    try {
      const gitTools = createGitTools();
      for (const tool of gitTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('Git 工具注册失败:', error.message);
    }
    
    // 6. Web 工具
    try {
      const webTools = createWebTools();
      for (const tool of webTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
      const previewTools = createPreviewTools();
      for (const tool of previewTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('Web 工具注册失败:', error.message);
    }
    
    // 7. MCP 工具
    try {
      const mcpTools = createMCPTools(this.#mcpClient);
      for (const tool of mcpTools) {
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      }
    } catch (error) {
      console.warn('MCP 工具注册失败:', error.message);
    }
    
    // 8. 调度器工具（如果调度器已初始化）
    if (this.#schedulerEngine) {
      try {
        const taskTools = createTaskTools(this.#schedulerEngine);
        for (const tool of taskTools) {
          this.#toolRegistry.register(tool);
          registeredTools.push(tool.name);
        }
      } catch (error) {
        console.warn('任务工具注册失败:', error.message);
      }
      
      try {
        const scheduleTools = createScheduleTools(this.#schedulerEngine);
        for (const tool of scheduleTools) {
          this.#toolRegistry.register(tool);
          registeredTools.push(tool.name);
        }
      } catch (error) {
        console.warn('调度工具注册失败:', error.message);
      }
      
      try {
        const subAgentTools = createSubAgentTools(this.#schedulerEngine);
        for (const tool of subAgentTools) {
          this.#toolRegistry.register(tool);
          registeredTools.push(tool.name);
        }
      } catch (error) {
        console.warn('子代理工具注册失败:', error.message);
      }
    }
    
    // 9. 技能工具
    const skillToolCreators = [
      createBrainstormTool,
      createGrillTool,
      createTddTool,
      createDiagnoseTool,
      createVerifyTool,
      createCoverageCheckTool,
      createAskUserTool,
      createReviewTool,
      createArchitectTool,
      createZoomOutTool,
      createCavemanTool,
      createHandoffTool,
      createToPrdTool,
      createToIssuesTool,
      createSetupTool
    ];
    
    for (const creator of skillToolCreators) {
      try {
        const tool = creator();
        this.#toolRegistry.register(tool);
        registeredTools.push(tool.name);
      } catch (error) {
        console.warn(`技能工具 ${creator.name || 'unknown'} 注册失败:`, error.message);
      }
    }
    
    // 批量触发工具注册钩子
    for (const toolName of registeredTools) {
      try {
        await this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, toolName, this.#toolRegistry.get(toolName));
      } catch (error) {
        // 钩子触发失败不影响工具注册
      }
    }
  }

  /**
   * 注册调度器工具（在 attachModelProvider 后调用）
   */
  async #registerSchedulerTools() {
    if (!this.#schedulerEngine) {return;}
    
    try {
      const taskTools = createTaskTools(this.#schedulerEngine);
      for (const tool of taskTools) {
        this.#toolRegistry.register(tool);
        await this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
      }
    } catch (error) {
      console.warn('任务工具注册失败:', error.message);
    }
    
    try {
      const scheduleTools = createScheduleTools(this.#schedulerEngine);
      for (const tool of scheduleTools) {
        this.#toolRegistry.register(tool);
        await this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
      }
    } catch (error) {
      console.warn('调度工具注册失败:', error.message);
    }
    
    try {
      const subAgentTools = createSubAgentTools(this.#schedulerEngine);
      for (const tool of subAgentTools) {
        this.#toolRegistry.register(tool);
        await this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
      }
    } catch (error) {
      console.warn('子代理工具注册失败:', error.message);
    }
  }

  /**
   * 附加模型提供者
   */
  attachModelProvider(modelProvider) {
    this.#modelProvider = modelProvider;
    this.#config.modelProvider = modelProvider;
    
    // 如果已初始化但没有 schedulerEngine，创建它
    if (this.#isInitialized && !this.#schedulerEngine) {
      const experienceDir = this.#config.workingDirectory + '/.agent-data';
      this.#schedulerEngine = new SchedulerEngine(
        {
          workingDirectory: this.#config.workingDirectory,
          dataDir: experienceDir,
          checkIntervalMs: 60000,
          maxAgents: 10,
          securityPolicy: this.#securityPolicy
        },
        this.#modelProvider,
        this.#toolRegistry,
        this.#memoryManager
      );
      // 初始化 schedulerEngine
      this.#schedulerEngine.initialize().then(() => {
        // 注册调度器工具
        this.#registerSchedulerTools();
      }).catch(error => {
        console.warn('调度器引擎初始化失败:', error.message);
      });
    }
    
    // 触发配置变更钩子
    this.#pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, 'modelProvider', modelProvider);
  }

  /**
   * 注册插件
   */
  async registerPlugin(plugin, options = {}) {
    return this.#pluginManager.register(plugin, options);
  }

  /**
   * 注销插件
   */
  async unregisterPlugin(pluginName) {
    return this.#pluginManager.unregister(pluginName);
  }

  /**
   * 获取插件管理器
   */
  getPluginManager() {
    return this.#pluginManager;
  }

  /**
   * 动态加载工具
   */
  async loadTool(toolModule, options = {}) {
    const loader = this.#pluginManager.getToolLoader();
    if (!loader) {
      throw new Error('工具加载器未初始化');
    }
    return loader.loadTool(toolModule, options);
  }

  /**
   * 动态卸载工具
   */
  async unloadTool(toolName) {
    const loader = this.#pluginManager.getToolLoader();
    if (!loader) {
      return false;
    }
    return loader.unloadTool(toolName);
  }

  /**
   * 创建工具分组
   */
  createToolGroup(name, options = {}) {
    const groups = this.#pluginManager.getToolGroups();
    return groups.createGroup(name, options);
  }

  /**
   * 获取工具分组
   */
  getToolGroups() {
    const groups = this.#pluginManager.getToolGroups();
    return groups.getAllGroups();
  }

  /**
   * 获取分组中的工具
   */
  getGroupTools(groupName) {
    const groups = this.#pluginManager.getToolGroups();
    return groups.getGroupTools(groupName);
  }

  /**
   * 添加工具中间件
   */
  addToolMiddleware(middleware) {
    const toolMiddleware = this.#pluginManager.getToolMiddleware();
    return toolMiddleware.use(middleware);
  }

  /**
   * 注册钩子
   */
  registerHook(hookName, fn, options = {}) {
    return this.#pluginManager.registerHook(hookName, fn, options);
  }

  /**
   * 处理用户输入并运行 Agent
   * 这是主要的执行入口点
   */
  async processInput(input, options = {}) {
    if (!this.#isInitialized) {
      await this.initialize();
    }

    if (!this.#modelProvider) {
      throw new Error('模型提供者未附加。请先使用 attachModelProvider() 方法。');
    }

    if (typeof options.debug === 'boolean') {
      this.setDebugMode(options.debug);
    }

    this.#state.status = 'running';
    this.#state.currentTask = input;
    this.#state.startTime = Date.now();
    this.#state.iteration = 0;

    // 触发输入接收钩子
    await this.#pluginManager.triggerHook(HOOKS.ON_INPUT_RECEIVED, input);

    // 触发 Agent 启动前钩子
    await this.#pluginManager.triggerHook(HOOKS.BEFORE_AGENT_START, input);

    this.#eventBus.emit(RuntimeEvent.AGENT_START, {
      task: input,
      timestamp: this.#state.startTime
    });

    // 创建 UI 门面（使用传入的 UI 适配器或默认门面）
    const uiFacade = this.#uiAdapter || this.#createUIFacade();

    // 创建 Agent 实例（复用 AgentEngine 中的 sessionManager）
    this.#agent = new ReActAgent(
      this.#modelProvider,
      this.#toolRegistry,
      this.#memoryManager,
      {
        maxIterations: this.#config.maxIterations,
        workingDirectory: this.#config.workingDirectory,
        debug: this.#config.debug,
        securityPolicy: this.#securityPolicy,
        tokenJuice: this.#tokenJuice,
        model: this.#config.model,
        intentClassification: this.#config.intentClassification !== false,
        session: this.#sessionManager  // 传递已有的 sessionManager，保留会话历史
      },
      uiFacade
    );

    let result;
    try {
      // 包装工具调用以触发钩子和中间件
      this.#wrapToolCalls();

      // 运行 Agent（使用 run 方法）
      result = await this.#agent.run(input);
      
      this.#state.status = result?.status === 'needs_user_input' ? 'needs_user_input' : 'completed';
      this.#eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result });
      
      // 触发输出生成钩子
      await this.#pluginManager.triggerHook(HOOKS.ON_OUTPUT_GENERATED, result);
      
      // 触发 Agent 完成钩子
      await this.#pluginManager.triggerHook(HOOKS.AFTER_AGENT_COMPLETE, result);
      
      return result;
    } catch (error) {
      this.#state.setError(error);
      this.#eventBus.emit(RuntimeEvent.AGENT_ERROR, { error: error.message });
      
      // 触发工具错误钩子
      await this.#pluginManager.triggerHook(HOOKS.ON_TOOL_ERROR, null, error);
      
      throw error;
    } finally {
      this.#state.lastActivity = Date.now();
    }
  }

  /**
   * 设置 UI 适配器
   * 用于自定义 UI 输出（CLI、Desktop 等）
   */
  setUIAdapter(adapter) {
    this.#uiAdapter = adapter;
  }

  /**
   * 创建 Agent 的 UI 门面 - 默认实现
   * 将 UI 操作转换为事件总线事件
   */
  #createUIFacade() {
    const eventBus = this.#eventBus;

    return {
      info: (message) => {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'info' });
      },
      success: (message) => {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'success' });
      },
      error: (message) => {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'error' });
      },
      warn: (message) => {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'warn' });
      },
      debug: (message) => {
        if (this.#config.debug) {
          eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'debug' });
        }
      },
      debugEvent: (eventName, data) => {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { 
          message: `[${eventName}]`, 
          level: 'debug', 
          data 
        });
      },
      toolCall: (name, args) => {
        eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: name, args });
      },
      toolResult: (name, result) => {
        eventBus.emit(RuntimeEvent.TOOL_RESULT, { toolName: name, result });
      },
      toolError: (name, error) => {
        eventBus.emit(RuntimeEvent.TOOL_ERROR, { toolName: name, error });
      },
      finalAnswer: (answer) => {
        eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { answer });
      },
      iteration: (current, max) => {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { 
          message: `迭代 ${current}/${max}`, 
          level: 'info' 
        });
      },
      theme: {
        dim: (text) => text,
        success: (text) => text,
        error: (text) => text,
        info: (text) => text,
        warn: (text) => text
      },
      isDebugEnabled: () => this.#config.debug === true
    };
  }

  /**
   * 包装工具调用以触发钩子和中间件
   */
  #wrapToolCalls() {
    const originalExecute = this.#toolRegistry.execute.bind(this.#toolRegistry);
    const eventBus = this.#eventBus;
    const pluginManager = this.#pluginManager;
    const toolMiddleware = pluginManager.getToolMiddleware();
    
    this.#toolRegistry.execute = async (toolName, args, context) => {
      // 使用中间件执行
      return toolMiddleware.execute(
        toolName,
        args,
        context,
        async (name, arguments_, ctx) => {
          // 触发工具调用前钩子
          await pluginManager.triggerHook(HOOKS.BEFORE_TOOL_CALL, name, arguments_);
          
          eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: name, args: arguments_ });
          
          try {
            const result = await originalExecute(name, arguments_, ctx);
            eventBus.emit(RuntimeEvent.TOOL_RESULT, { toolName: name, result });
            
            // 触发工具调用后钩子
            await pluginManager.triggerHook(HOOKS.AFTER_TOOL_CALL, name, result);
            
            return result;
          } catch (error) {
            eventBus.emit(RuntimeEvent.TOOL_ERROR, { toolName: name, error: error.message });
            
            // 触发工具错误钩子
            await pluginManager.triggerHook(HOOKS.ON_TOOL_ERROR, name, error);
            
            throw error;
          }
        }
      );
    };
  }

  /**
   * 更新内存并触发钩子
   */
  async updateMemory(operation, data) {
    // 触发内存更新钩子
    await this.#pluginManager.triggerHook(HOOKS.ON_MEMORY_UPDATE, operation, data);
    
    this.#eventBus.emit(RuntimeEvent.MEMORY_UPDATE, { operation, data });
  }

  /**
   * 清除内存并触发钩子
   */
  async clearMemory() {
    // 触发内存清除钩子
    await this.#pluginManager.triggerHook(HOOKS.ON_MEMORY_CLEAR);
    
    // 内存管理器可能没有 clear 方法，使用安全检查
    if (this.#memoryManager && typeof this.#memoryManager.clear === 'function') {
      await this.#memoryManager.clear();
    } else if (this.#memoryManager && typeof this.#memoryManager.reset === 'function') {
      await this.#memoryManager.reset();
    }
    
    this.#eventBus.emit(RuntimeEvent.MEMORY_CLEAR, {});
  }

  /**
   * 更新配置并触发钩子
   */
  async updateConfig(key, value) {
    this.#config.update(key, value);
    
    // 触发配置变更钩子
    await this.#pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, key, value);
    
    this.#eventBus.emit(RuntimeEvent.CONFIG_CHANGE, { key, value });
  }

  // Getters for compatibility - 兼容性 getter 方法
  getState() { return { ...this.#state }; }
  getToolRegistry() { return this.#toolRegistry; }
  getMemoryManager() { return this.#memoryManager; }
  getSecurityPolicy() { return this.#securityPolicy; }
  getExperienceMemory() { return this.#experienceMemory; }
  getSessionManager() { return this.#sessionManager; }
  getTokenJuice() { return this.#tokenJuice; }
  getIntelligentReasoning() { return this.#intelligentReasoning; }
  getAutomationEngine() { return this.#automationEngine; }
  getEmbedder() { return this.#embedder; }
  getMcpClient() { return this.#mcpClient; }
  getSchedulerEngine() { return this.#schedulerEngine; }
  getEventBus() { return this.#eventBus; }
  getModelProvider() { return this.#modelProvider; }
  isInitialized() { return this.#isInitialized; }
  getConfig() { return this.#config; }
  getAgent() { return this.#agent; }

  // API methods for tests and usage - API 方法供测试和使用
  registerTool(tool) {
    this.#toolRegistry.register(tool);
    // 触发工具注册钩子
    this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
  }

  registerTools(tools) {
    for (const tool of tools) {
      this.#toolRegistry.register(tool);
      this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
    }
  }

  getTools() {
    return this.#toolRegistry.getAll();
  }

  /**
   * 获取工具信息（包含分组信息）
   */
  getToolsWithGroups() {
    const tools = this.#toolRegistry.getAll();
    const groups = this.#pluginManager.getToolGroups();
    
    return tools.map(tool => ({
      ...tool,
      group: groups.getToolGroup(tool.name)
    }));
  }

  /**
   * 获取工具摘要（按类别分组）
   */
  getToolSummary() {
    return this.#toolRegistry.getToolSummary();
  }

  /**
   * 停止当前 Agent 执行
   */
  async stop() {
    // 触发停止前钩子
    await this.#pluginManager.triggerHook(HOOKS.BEFORE_AGENT_STOP);
    
    if (this.#agent && typeof this.#agent.stop === 'function') {
      this.#agent.stop();
    }
    this.#state.status = 'idle';
    this.#eventBus.emit(RuntimeEvent.AGENT_STOP, {});
    
    // 触发停止后钩子
    await this.#pluginManager.triggerHook(HOOKS.AFTER_AGENT_STOP);
  }

  /**
   * 清除 Agent 会话
   */
  clearSession() {
    if (this.#agent && typeof this.#agent.clearSession === 'function') {
      this.#agent.clearSession();
    }
  }

  /**
   * 设置调试模式
   */
  setDebugMode(enabled) {
    this.#config.debug = Boolean(enabled);
    if (this.#modelProvider && typeof this.#modelProvider.setDebugMode === 'function') {
      this.#modelProvider.setDebugMode(enabled);
    }
    if (this.#agent && typeof this.#agent.setDebugMode === 'function') {
      this.#agent.setDebugMode(enabled);
    }
  }

  getDebugMode() {
    return this.#config.debug === true;
  }

  /**
   * 切换模型提供者
   */
  setModelProvider(modelProvider, options = {}) {
    this.#modelProvider = modelProvider;
    this.#config.modelProvider = modelProvider;
    
    if (options.model) {
      this.#config.model = options.model;
    }
    
    if (this.#agent && typeof this.#agent.setModelProvider === 'function') {
      this.#agent.setModelProvider(modelProvider, options);
    }
    
    // 更新调度器引擎的模型提供者
    if (this.#schedulerEngine) {
      this.#schedulerEngine.modelProvider = modelProvider;
    }
    
    // 触发配置变更钩子
    this.#pluginManager.triggerHook(HOOKS.ON_CONFIG_CHANGE, 'modelProvider', modelProvider);
  }

  /**
   * 连接 MCP 服务器
   */
  async connectMcpServer(name, config) {
    if (!this.#mcpClient) {
      throw new Error('MCP 客户端未初始化');
    }
    
    const success = await this.#mcpClient.connect(name, config);
    if (success) {
      // 注册 MCP 工具
      this.#registerMcpTools(name);
    }
    return success;
  }

  /**
   * 注册 MCP 服务器的工具
   */
  #registerMcpTools(serverName) {
    const tools = this.#mcpClient.getTools().filter(t => t.serverName === serverName);
    
    for (const mcpTool of tools) {
      if (this.#toolRegistry.has(mcpTool.fullName)) {
        continue;
      }
      
      const tool = {
        name: mcpTool.fullName,
        description: mcpTool.description,
        category: 'MCP',
        parameters: mcpTool.inputSchema.properties || {},
        required: mcpTool.inputSchema.required || [],
        handler: async (args) => {
          return await this.#mcpClient.callTool(mcpTool.fullName, args);
        }
      };
      
      this.#toolRegistry.register(tool);
      this.#pluginManager.triggerHook(HOOKS.ON_TOOL_REGISTER, tool.name, tool);
    }
  }

  /**
   * 销毁引擎并清理资源
   */
  async dispose() {
    // 触发销毁前钩子
    await this.#pluginManager.triggerHook(HOOKS.BEFORE_DISPOSE, this);
    
    await this.stop();
    this.#isInitialized = false;
    
    // 停止调度器
    if (this.#schedulerEngine) {
      await this.#schedulerEngine.stop();
    }
    
    // 清理 MCP 客户端
    if (this.#mcpClient) {
      await this.#mcpClient.dispose();
    }
    
    // 清理自动化引擎
    if (this.#automationEngine && typeof this.#automationEngine.stop === 'function') {
      await this.#automationEngine.stop();
    }
    
    // 清理 Agent
    if (this.#agent && typeof this.#agent.dispose === 'function') {
      this.#agent.dispose();
    }
    
    // 清理所有插件
    await this.#pluginManager.dispose();
    
    // 清理事件总线
    this.#eventBus.clear();
    
    // 触发销毁后钩子
    await this.#pluginManager.triggerHook(HOOKS.AFTER_DISPOSE);
  }
}
