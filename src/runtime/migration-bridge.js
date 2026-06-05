/**
 * Migration Bridge - 迁移桥接层
 * 提供旧 API 到新 API 的映射，支持渐进式迁移
 * 
 * 功能：
 * - 旧 API 到新 API 的完整映射
 * - 运行时架构切换
 * - 迁移进度跟踪
 * - 向后兼容支持
 * - 自动检测运行环境
 */

import { AgentEngine } from './agent-engine.js';
import { PlatformType, RuntimeConfig, RuntimeEvent } from './types.js';
import { getEventBus } from './event-bus.js';

// 导入旧架构组件
import { ReActAgent } from '../core/agent.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { SecurityPolicy } from '../core/security-policy.js';
import { SessionManager } from '../core/session-manager.js';
import { TokenJuice } from '../core/token-juice.js';
import { ExperienceMemory } from '../core/experience-memory.js';
import { IntelligentReasoning } from '../core/intelligent-reasoning.js';
import { AutomationEngine } from '../core/automation-engine.js';
import { Embedder } from '../core/embedder.js';

// 导入模型提供者
import { OpenAIModelProvider } from '../models/openai-provider.js';
import { LlamaModelProvider } from '../models/llama-provider.js';
import { ZhipuModelProvider } from '../models/zhipu-provider.js';
import { DeepSeekModelProvider } from '../models/deepseek-provider.js';
import { OpenRouterModelProvider } from '../models/openrouter-provider.js';

/**
 * 创建 AgentEngine 实例的便捷函数
 */
export function createAgentEngine(config = {}) {
  return new AgentEngine(config);
}

/**
 * 检测运行环境
 * @returns {string} 'cli' | 'desktop' | 'web'
 */
export function detectPlatform() {
  // 检测 Electron 环境
  if (process.versions?.electron) {
    return PlatformType.DESKTOP;
  }
  
  // 检测 Web 环境（浏览器）
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return PlatformType.WEB;
  }
  
  // 默认为 CLI 环境
  return PlatformType.CLI;
}

/**
 * Migration Bridge - 迁移桥接类
 * 管理新旧架构之间的切换和兼容
 */
export class MigrationBridge {
  #useNewArch;
  #engine;
  #oldComponents;
  #progress;
  #platform;

  constructor(options = {}) {
    this.#useNewArch = options.useNewArchitecture || process.env.USE_NEW_ARCH === 'true';
    this.#oldComponents = {};
    this.#progress = new MigrationProgress();
    this.#platform = options.platform || detectPlatform();
  }

  /**
   * 初始化桥接层
   * 根据配置选择使用新架构或旧架构
   */
  async initialize() {
    if (this.#useNewArch) {
      console.log('🔄 使用新架构初始化...');
      this.#engine = createAgentEngine({
        platform: this.#platform,
        workingDirectory: process.env.WORKING_DIRECTORY || process.cwd(),
        debug: process.env.DEBUG === 'true',
        maxIterations: parseInt(process.env.MAX_ITERATIONS || '180'),
        autoDownloadModels: process.env.AUTO_DOWNLOAD_MODELS !== 'false'
      });
      await this.#engine.initialize();
      console.log('✅ 新架构已就绪');
    } else {
      console.log('🔄 使用旧架构初始化...');
      await this.#initializeOldArchitecture();
      console.log('✅ 旧架构已就绪');
    }
  }

  /**
   * 初始化旧架构组件
   */
  async #initializeOldArchitecture() {
    const workingDir = process.env.WORKING_DIRECTORY || process.cwd();
    
    // 初始化旧架构组件
    this.#oldComponents.toolRegistry = new ToolRegistry();
    this.#oldComponents.memoryManager = new MemoryManager(workingDir);
    this.#oldComponents.securityPolicy = new SecurityPolicy();
    this.#oldComponents.sessionManager = new SessionManager();
    this.#oldComponents.tokenJuice = new TokenJuice({
      maxChars: parseInt(process.env.MAX_RESULT_CHARS || '4000')
    });
    this.#oldComponents.experienceMemory = new ExperienceMemory({
      filePath: workingDir + '/.agent-data/experience-memory.json',
      maxExperiences: 500
    });
    
    await this.#oldComponents.memoryManager.load();
  }

  /**
   * 获取引擎实例（新架构）
   */
  getEngine() {
    if (!this.#useNewArch) {
      console.warn('⚠️  当前使用旧架构，引擎不可用');
      return null;
    }
    return this.#engine;
  }

  /**
   * 获取旧组件（旧架构）
   */
  getOldComponents() {
    return this.#oldComponents;
  }

  /**
   * 存储旧组件引用
   */
  setOldComponents(components) {
    this.#oldComponents = { ...this.#oldComponents, ...components };
  }

  /**
   * 获取组件（兼容新旧架构）
   */
  getComponent(componentName) {
    if (this.#useNewArch) {
      // 新架构组件映射
      const newArchMap = {
        toolRegistry: () => this.#engine?.getToolRegistry(),
        memoryManager: () => this.#engine?.getMemoryManager(),
        securityPolicy: () => this.#engine?.getSecurityPolicy(),
        sessionManager: () => this.#engine?.getSessionManager(),
        tokenJuice: () => this.#engine?.getTokenJuice(),
        experienceMemory: () => this.#engine?.getExperienceMemory(),
        intelligentReasoning: () => this.#engine?.getIntelligentReasoning(),
        automationEngine: () => this.#engine?.getAutomationEngine(),
        embedder: () => this.#engine?.getEmbedder(),
        mcpClient: () => this.#engine?.getMcpClient(),
        schedulerEngine: () => this.#engine?.getSchedulerEngine(),
        pluginManager: () => this.#engine?.getPluginManager(),
        eventBus: () => this.#engine?.getEventBus(),
        modelProvider: () => this.#engine?.getModelProvider(),
        agent: () => this.#engine?.getAgent(),
        config: () => this.#engine?.getConfig(),
        state: () => this.#engine?.getState(),
      };
      
      const getter = newArchMap[componentName];
      return getter ? getter() : this.#oldComponents[componentName];
    }
    
    return this.#oldComponents[componentName];
  }

  /**
   * 检查是否使用新架构
   */
  isUsingNewArchitecture() {
    return this.#useNewArch;
  }

  /**
   * 获取当前平台类型
   */
  getPlatform() {
    return this.#platform;
  }

  /**
   * 切换架构（运行时切换）
   */
  async toggleArchitecture(useNewArch) {
    if (this.#useNewArch === useNewArch) {
      return;
    }
    
    console.log(`🔄 切换到 ${useNewArch ? '新' : '旧'}架构...`);
    
    // 清理当前架构
    if (this.#engine) {
      await this.#engine.dispose();
      this.#engine = null;
    }
    
    // 清理旧组件
    this.#oldComponents = {};
    
    this.#useNewArch = useNewArch;
    
    // 重新初始化
    await this.initialize();
  }

  /**
   * 创建 Agent（兼容新旧架构）
   */
  async createAgent(modelProvider, options = {}) {
    if (this.#useNewArch) {
      // 新架构：设置模型提供者
      this.#engine.attachModelProvider(modelProvider);
      return this.#engine;
    }
    
    // 旧架构：创建 ReActAgent
    const agent = new ReActAgent(
      modelProvider,
      this.#oldComponents.toolRegistry,
      this.#oldComponents.memoryManager,
      {
        maxIterations: options.maxIterations || parseInt(process.env.MAX_ITERATIONS || '180'),
        workingDirectory: options.workingDirectory || process.cwd(),
        debug: options.debug || process.env.DEBUG === 'true',
        securityPolicy: this.#oldComponents.securityPolicy,
        tokenJuice: this.#oldComponents.tokenJuice,
        model: options.model,
        intentClassification: options.intentClassification !== false
      },
      options.ui
    );
    
    this.#oldComponents.agent = agent;
    return agent;
  }

  /**
   * 运行 Agent（兼容新旧架构）
   */
  async runAgent(input, options = {}) {
    if (this.#useNewArch) {
      return await this.#engine.processInput(input, options);
    }
    
    const agent = this.#oldComponents.agent;
    if (!agent) {
      throw new Error('Agent 未创建，请先调用 createAgent()');
    }
    
    return await agent.run(input);
  }

  /**
   * 创建模型提供者
   */
  createModelProvider(provider, config = {}) {
    const providerMap = {
      openai: () => new OpenAIModelProvider(
        config.apiKey || process.env.OPENAI_API_KEY,
        config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        config.model || process.env.OPENAI_MODEL || 'gpt-4',
        config.debug || false
      ),
      llama: () => new LlamaModelProvider(
        config.model || 'llama-2-7b',
        { temperature: config.temperature || 0.7, debug: config.debug }
      ),
      zhipu: () => new ZhipuModelProvider(
        config.apiKey || process.env.ZHIPU_API_KEY,
        config.baseUrl || process.env.ZHIPU_BASE_URL,
        config.model || 'glm-4'
      ),
      deepseek: () => new DeepSeekModelProvider(
        config.apiKey || process.env.DEEPSEEK_API_KEY,
        config.baseUrl || process.env.DEEPSEEK_BASE_URL,
        config.model || 'deepseek-chat'
      ),
      openrouter: () => new OpenRouterModelProvider(
        config.apiKey || process.env.OPENROUTER_API_KEY,
        config.baseUrl || process.env.OPENROUTER_BASE_URL,
        config.model || 'openai/gpt-4'
      )
    };
    
    const factory = providerMap[provider.toLowerCase()];
    if (!factory) {
      throw new Error(`未知的模型提供者: ${provider}`);
    }
    
    return factory();
  }

  /**
   * 注册工具（兼容新旧架构）
   */
  registerTool(tool) {
    if (this.#useNewArch) {
      this.#engine.registerTool(tool);
    } else {
      this.#oldComponents.toolRegistry.register(tool);
    }
  }

  /**
   * 注册多个工具（兼容新旧架构）
   */
  registerTools(tools) {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * 获取所有工具（兼容新旧架构）
   */
  getTools() {
    if (this.#useNewArch) {
      return this.#engine.getTools();
    }
    return this.#oldComponents.toolRegistry.getAll();
  }

  /**
   * 获取工具摘要（兼容新旧架构）
   */
  getToolSummary() {
    if (this.#useNewArch) {
      return this.#engine.getToolSummary();
    }
    return this.#oldComponents.toolRegistry.getToolSummary();
  }

  /**
   * 迁移工具定义（旧格式转新格式）
   */
  migrateTool(oldTool) {
    return {
      name: oldTool.name,
      description: oldTool.description,
      category: oldTool.category || 'general',
      parameters: oldTool.parameters || oldTool.params || {},
      required: oldTool.required || [],
      handler: oldTool.handler || oldTool.execute,
      metadata: oldTool.metadata || {}
    };
  }

  /**
   * 迁移配置（旧格式转新格式）
   */
  migrateConfig(oldConfig) {
    return new RuntimeConfig({
      platform: this.#platform,
      workingDirectory: oldConfig.workingDirectory || oldConfig.workingDir || process.cwd(),
      debug: oldConfig.debug || false,
      maxIterations: oldConfig.maxIterations || 180,
      autoDownloadModels: oldConfig.autoDownloadModels !== false,
      modelProvider: oldConfig.modelProvider,
      model: oldConfig.model,
      intentClassification: oldConfig.intentClassification !== false,
      requireApproval: oldConfig.requireApproval || false
    });
  }

  /**
   * 获取迁移进度
   */
  getProgress() {
    return this.#progress.getProgress();
  }

  /**
   * 开始迁移任务
   */
  startMigrationTask(name, description) {
    this.#progress.addTask(name, description);
  }

  /**
   * 完成迁移任务
   */
  completeMigrationTask(index) {
    this.#progress.completeTask(index);
  }

  /**
   * 获取迁移状态报告
   */
  getStatusReport() {
    return {
      usingNewArchitecture: this.#useNewArch,
      platform: this.#platform,
      engineAvailable: !!this.#engine,
      oldComponents: Object.keys(this.#oldComponents),
      progress: this.#progress.getProgress(),
      timestamp: Date.now()
    };
  }

  /**
   * 销毁桥接层并清理资源
   */
  async dispose() {
    if (this.#engine) {
      await this.#engine.dispose();
    }
    this.#oldComponents = {};
    this.#progress.reset();
  }
}

/**
 * Migration Progress - 迁移进度跟踪类
 */
export class MigrationProgress {
  #total;
  #completed;
  #tasks;

  constructor() {
    this.#total = 0;
    this.#completed = 0;
    this.#tasks = [];
  }

  /**
   * 添加迁移任务
   */
  addTask(name, description) {
    this.#tasks.push({
      name,
      description,
      status: 'pending',
      startTime: null,
      endTime: null,
      error: null
    });
    this.#total++;
    return this.#tasks.length - 1; // 返回任务索引
  }

  /**
   * 开始任务
   */
  startTask(index) {
    if (this.#tasks[index]) {
      this.#tasks[index].status = 'in_progress';
      this.#tasks[index].startTime = Date.now();
    }
  }

  /**
   * 完成任务
   */
  completeTask(index) {
    if (this.#tasks[index]) {
      this.#tasks[index].status = 'completed';
      this.#tasks[index].endTime = Date.now();
      this.#completed++;
    }
  }

  /**
   * 任务失败
   */
  failTask(index, error) {
    if (this.#tasks[index]) {
      this.#tasks[index].status = 'failed';
      this.#tasks[index].endTime = Date.now();
      this.#tasks[index].error = error?.message || String(error);
    }
  }

  /**
   * 获取进度信息
   */
  getProgress() {
    return {
      total: this.#total,
      completed: this.#completed,
      failed: this.#tasks.filter(t => t.status === 'failed').length,
      pending: this.#tasks.filter(t => t.status === 'pending').length,
      inProgress: this.#tasks.filter(t => t.status === 'in_progress').length,
      percentage: this.#total > 0 ? Math.round((this.#completed / this.#total) * 100) : 0,
      tasks: this.#tasks.map(t => ({
        name: t.name,
        description: t.description,
        status: t.status,
        duration: t.startTime && t.endTime ? t.endTime - t.startTime : null,
        error: t.error
      }))
    };
  }

  /**
   * 重置进度
   */
  reset() {
    this.#total = 0;
    this.#completed = 0;
    this.#tasks = [];
  }
}

/**
 * 创建兼容层
 * 提供同时兼容新旧架构的接口
 */
export function createCompatibilityLayer(options = {}) {
  const bridge = new MigrationBridge(options);
  
  return {
    bridge,
    
    /**
     * 初始化
     */
    async initialize() {
      await bridge.initialize();
    },
    
    /**
     * 获取工具注册表
     */
    getToolRegistry() {
      return bridge.getComponent('toolRegistry');
    },
    
    /**
     * 获取内存管理器
     */
    getMemoryManager() {
      return bridge.getComponent('memoryManager');
    },
    
    /**
     * 获取安全策略
     */
    getSecurityPolicy() {
      return bridge.getComponent('securityPolicy');
    },
    
    /**
     * 获取插件管理器（仅新架构）
     */
    getPluginManager() {
      return bridge.getComponent('pluginManager');
    },
    
    /**
     * 获取事件总线（仅新架构）
     */
    getEventBus() {
      return bridge.getComponent('eventBus');
    },
    
    /**
     * 获取调度器引擎（仅新架构）
     */
    getSchedulerEngine() {
      return bridge.getComponent('schedulerEngine');
    },
    
    /**
     * 获取 MCP 客户端（仅新架构）
     */
    getMcpClient() {
      return bridge.getComponent('mcpClient');
    },
    
    /**
     * 注册工具
     */
    registerTool(tool) {
      bridge.registerTool(tool);
    },
    
    /**
     * 注册多个工具
     */
    registerTools(tools) {
      bridge.registerTools(tools);
    },
    
    /**
     * 获取所有工具
     */
    getTools() {
      return bridge.getTools();
    },
    
    /**
     * 创建 Agent
     */
    async createAgent(modelProvider, options = {}) {
      return await bridge.createAgent(modelProvider, options);
    },
    
    /**
     * 运行 Agent
     */
    async runAgent(input, options = {}) {
      return await bridge.runAgent(input, options);
    },
    
    /**
     * 检查是否使用新架构
     */
    isUsingNewArchitecture() {
      return bridge.isUsingNewArchitecture();
    },
    
    /**
     * 切换架构
     */
    async toggleArchitecture(useNewArch) {
      await bridge.toggleArchitecture(useNewArch);
    },
    
    /**
     * 获取状态报告
     */
    getStatusReport() {
      return bridge.getStatusReport();
    },
    
    /**
     * 销毁
     */
    async dispose() {
      await bridge.dispose();
    }
  };
}

/**
 * API 映射表 - 旧 API 到新 API 的映射
 */
export const API_MAPPING = {
  // Agent 相关
  'ReActAgent.run': 'AgentEngine.processInput',
  'ReActAgent.clearSession': 'AgentEngine.clearSession',
  'ReActAgent.setModelProvider': 'AgentEngine.setModelProvider',
  'ReActAgent.setDebugMode': 'AgentEngine.setDebugMode',
  'ReActAgent.getTools': 'AgentEngine.getTools',
  'ReActAgent.memoryManager': 'AgentEngine.getMemoryManager',
  
  // 工具相关
  'ToolRegistry.register': 'AgentEngine.registerTool',
  'ToolRegistry.get': 'AgentEngine.getToolRegistry().get',
  'ToolRegistry.getAll': 'AgentEngine.getTools',
  'ToolRegistry.has': 'AgentEngine.getToolRegistry().has',
  'ToolRegistry.execute': 'AgentEngine.getToolRegistry().execute',
  
  // 内存相关
  'MemoryManager.load': 'AgentEngine.getMemoryManager().load',
  'MemoryManager.save': 'AgentEngine.getMemoryManager().save',
  'MemoryManager.updateTask': 'AgentEngine.getMemoryManager().updateTask',
  'MemoryManager.addDecision': 'AgentEngine.getMemoryManager().addDecision',
  
  // 安全相关
  'SecurityPolicy.registerPolicy': 'AgentEngine.getSecurityPolicy().registerPolicy',
  'SecurityPolicy.requiresApproval': 'AgentEngine.getSecurityPolicy().requiresApproval',
  
  // 新架构独有 API
  'PluginManager.register': 'AgentEngine.registerPlugin',
  'PluginManager.unregister': 'AgentEngine.unregisterPlugin',
  'EventBus.subscribe': 'AgentEngine.getEventBus().subscribe',
  'EventBus.emit': 'AgentEngine.getEventBus().emit',
  'SchedulerEngine.schedule': 'AgentEngine.getSchedulerEngine().schedule',
  'MCPClient.connect': 'AgentEngine.connectMcpServer'
};

/**
 * 获取 API 映射
 */
export function getApiMapping(oldApi) {
  return API_MAPPING[oldApi] || null;
}

/**
 * 获取所有 API 映射
 */
export function getAllApiMappings() {
  return { ...API_MAPPING };
}

// 默认导出
export default {
  MigrationBridge,
  MigrationProgress,
  createCompatibilityLayer,
  detectPlatform,
  migrateConfig: (oldConfig) => new MigrationBridge().migrateConfig(oldConfig),
  migrateTool: (oldTool) => new MigrationBridge().migrateTool(oldTool),
  getApiMapping,
  getAllApiMappings,
  API_MAPPING
};