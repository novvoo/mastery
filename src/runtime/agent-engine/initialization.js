/**
 * AgentEngine 初始化模块
 *
 * 设计：子模块函数通过显式 ctx 参数接收组件引用。
 * 主类 AgentEngine 在调用时组装 ctx 并传入。
 *
 * 职责：
 *   - 构造期配置解析（createInitialConfig / buildFieldState）
 *   - 运行期 initialize() 序列
 *   - 工具分组初始化
 */

import { RuntimeConfig, AgentState } from '../types.js';
import { getEventBus } from '../event-bus.js';
import { PluginManager, HOOKS } from '../plugin-system.js';
import { ToolRegistry } from '../../core/tool-registry.js';
import { MemoryManager } from '../../memory/memory-manager.js';
import { SecurityPolicy } from '../../core/security-policy.js';
import { ExperienceMemory } from '../../core/experience-memory.js';
import { TokenJuice } from '../../core/token-juice.js';
import { TokenScope } from '../../core/token-scope.js';
import { SessionManager } from '../../core/session-manager.js';
import { IntelligentReasoning } from '../../core/intelligent-reasoning.js';
import { AutomationEngine } from '../../core/automation-engine.js';
import { Embedder } from '../../core/embedder.js';
import { MCPClient } from '../../mcp/mcp-client.js';
import { SchedulerEngine } from '../../scheduler/SchedulerEngine.js';
import GraphPlanner from '../../planner/graph-planner.js';
import { RuntimeEvent } from '../types.js';

/**
 * 构造期字段初始化。返回一个包含所有初始字段值的对象，
 * 由主类 AgentEngine 分配到私有字段。
 */
export function buildInitialFields(rawConfig) {
  const config = rawConfig instanceof RuntimeConfig ? rawConfig : new RuntimeConfig(rawConfig);
  const eventBus = getEventBus();
  const pluginManager = new PluginManager(eventBus, { config: config.pluginConfig });
  return {
    config,
    eventBus,
    pluginManager,
    state: new AgentState(),
    isInitialized: false,
    modelProvider: null,
    toolGroups: new Map(),
    toolCallsWrapped: false,
    uiAdapter: null,
    graphPlanner: new GraphPlanner({
      maxConcurrency: 5,
      enableRetry: true,
      enableDynamicPlanning: true,
    }),
  };
}

/**
 * 初始化工具分组。按 tool.category 分配到预定义分组。
 * ctx 需要包含：toolRegistry, pluginManager
 */
export function initializeToolGroups(ctx) {
  const toolGroups = ctx.pluginManager.getToolGroups();

  const groupDefs = [
    ['filesystem', '文件系统操作工具', 10, /file|filesystem/],
    ['shell', 'Shell 命令执行工具', 20, /shell|system|pty/],
    ['git', 'Git 版本控制工具', 30, /git/],
    ['skills', '专业技能工具', 40, /skill/],
    ['memory', '内存和搜索工具', 50, /memory|search|document/],
    ['web', 'Web 和网络工具', 60, /web|network/],
    ['mcp', 'MCP 协议工具', 70, /mcp/],
    ['scheduler', '调度和任务工具', 80, /scheduler|task|subagent/],
  ];
  for (const [id, description, priority] of groupDefs) {
    toolGroups.createGroup(id, { description, priority });
  }

  const tools = ctx.toolRegistry.getAll();
  for (const tool of tools) {
    const category = tool.category?.toLowerCase() || 'general';
    for (const [id, , , pattern] of groupDefs) {
      if (pattern.test(category)) {
        toolGroups.addToGroup(id, tool.name);
        break;
      }
    }
  }
}

/**
 * 运行完整的初始化序列。由 AgentEngine.initialize() 调用。
 *
 * ctx 需包含：
 *   - config, eventBus, pluginManager, state
 *   - [out] toolRegistry, memoryManager, securityPolicy, sessionManager,
 *     experienceMemory, tokenJuice, tokenScope, intelligentReasoning,
 *     automationEngine, embedder, mcpClient, schedulerEngine, isInitialized
 */
export async function runInitialization(ctx, registerAllToolsFn, wrapToolCallsFn) {
  if (ctx.isInitialized) return;

  await ctx.pluginManager.triggerHook(HOOKS.BEFORE_INIT, ctx.config);

  ctx.eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
    status: 'initializing',
    message: '正在初始化 AI Agent...'
  });

  // 1. 核心组件
  ctx.toolRegistry = new ToolRegistry();
  ctx.memoryManager = new MemoryManager(ctx.config.workingDirectory);
  ctx.securityPolicy = new SecurityPolicy({
    requireApproval: ctx.config.requireApproval || false
  });
  ctx.sessionManager = new SessionManager({ model: ctx.config.model });

  ctx.pluginManager.setToolRegistry(ctx.toolRegistry);
  await ctx.memoryManager.load();

  // 2. 经验内存
  const experienceDir = ctx.config.workingDirectory + '/.agent-data';
  ctx.experienceMemory = new ExperienceMemory({
    filePath: experienceDir + '/experience-memory.json',
    maxExperiences: 500
  });

  // 3. TokenJuice
  ctx.tokenJuice = new TokenJuice({
    maxChars: parseInt(process.env.MAX_RESULT_CHARS || '4000')
  });

  // 3.1 TokenScope
  const tokenBudget = ctx.config.tokenBudget ?? (parseFloat(process.env.TOKEN_BUDGET) || null);
  ctx.tokenScope = new TokenScope({
    ...(tokenBudget ? {
      budgetLimits: {
        global: {
          limit: tokenBudget,
          warningThreshold: ctx.config.tokenBudgetWarningThreshold ?? 70,
        },
      },
      onBudgetWarning: (info) => {
        console.warn(`[TokenScope] 预算警告: ${(info.cost).toFixed(4)} / ${info.limit} (${info.percentage}%)`);
      },
      onBudgetExceeded: (info) => {
        console.warn(`[TokenScope] 预算超限: ${(info.cost).toFixed(4)} / ${info.limit} — 停止任务`);
      },
    } : {}),
  });

  // 4. 智能推理引擎
  ctx.intelligentReasoning = new IntelligentReasoning({
    toolRegistry: ctx.toolRegistry,
    experienceMemory: ctx.experienceMemory,
    intentClassifier: null,
    config: { maxCandidates: 5, confidenceThreshold: 0.7 }
  });

  // 5. 自动化引擎
  ctx.automationEngine = new AutomationEngine({
    checkIntervalMs: 5000,
    maxConcurrentWorkflows: 5,
    dataDir: experienceDir + '/.automation'
  });

  // 6. 嵌入器
  ctx.embedder = new Embedder();
  if (ctx.config.autoDownloadModels && process.env.NODE_ENV !== 'test') {
    ctx.embedder.prepareModel().catch(error => {
      console.warn('嵌入模型准备失败，将使用备用方案:', error.message);
    });
  }

  // 7. MCP 客户端
  ctx.mcpClient = new MCPClient();

  // 8. 调度器引擎
  if (ctx.modelProvider) {
    ctx.schedulerEngine = new SchedulerEngine(
      {
        workingDirectory: ctx.config.workingDirectory,
        dataDir: experienceDir,
        checkIntervalMs: 60000,
        maxAgents: 10,
        securityPolicy: ctx.securityPolicy
      },
      ctx.modelProvider,
      ctx.toolRegistry,
      ctx.memoryManager
    );
    await ctx.schedulerEngine.initialize();
  }

  // 9. 注册所有工具
  await registerAllToolsFn(ctx);

  // 10. 初始化工具分组
  initializeToolGroups(ctx);

  // 10.5 包装工具调用
  wrapToolCallsFn(ctx);

  // 11. 注册安全策略
  ctx.securityPolicy.registerDefaultPolicies(ctx.toolRegistry.getAll());

  ctx.isInitialized = true;

  await ctx.pluginManager.triggerHook(HOOKS.AFTER_INIT, ctx);

  ctx.eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
    status: 'ready',
    message: 'AI Agent 已就绪'
  });
}
