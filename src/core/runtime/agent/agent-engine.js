/**
 * AgentEngine — 真正的内核 API 层
 *
 * 架构目标：让 CLI、Desktop、Web 只 import 这一个文件，
 * 不再直接依赖 src/core/* 的内部实现。
 *
 * Runtime Layer (agent-engine.js)
 *   ├─ TaskClassifier        — 任务类型 / 语义风险 / 迭代预算
 *   ├─ ExecutionPlanManager  — 执行计划 (inspect→plan→implement→verify)
 *   ├─ ToolExecutor          — 工具规范化执行 / 安全策略 / 缓存
 *   ├─ ContextManager        — 上下文窗口裁剪 / 工作区摘要
 *   └─ StagnationDetector    — 停滞 nudge / 进度检查点
 *
 * 对外 API：
 *   engine.run(userInput)      — 主循环入口
 *   engine.stop()              — 中断当前 run
 *   engine.getRunResult()      — 返回最近一次 run 的结构化结果
 *   engine.dispose()           — 释放资源
 */

import { SessionManager } from '../../session-manager.js';
import { buildSystemPrompt } from '../../../prompts/system-prompt.js';
import { RetryStrategy, withTimeout } from '../../../errors/error-handler.js';
import { TextToolParser } from '../../text-tool-parser.js';
import { IntentClassifier } from '../../intent-classifier.js';
import { DynamicContextPruning } from '../../dynamic-context-pruning.js';
import { WorkspaceIndex } from '../../workspace-index.js';
import { selectToolsForRequest, shouldUseIntentClassifier } from './tool-router.js';
import { WorkspaceState } from '../../workspace-state.js';
import { ObservationSummarizer } from '../../observation-summarizer.js';
import { ContentAddressableStore, FileAnalyzer } from '../../harness/content-addressing.js';
import { Patcher, InMemorySnapshotStore, HashlineBridge, DiskFilesystem } from '../../harness/hashline.js';
import { ServerManager } from '../../../lsp/lsp-manager.js';
import { createLSPTools } from '../../../lsp/lsp-tools.js';
import { registerCodeTools } from './tools/index.js';
import { withRoutedToolContext } from '../../routed-tool-context.js';
import { TokenScope } from './support/token-scope.js';
import { quickAssess, computeIterationBudget } from './support/risk-budget.js';
import { ExecutionPlanManager } from './execution-plan-manager.js';
import { ToolExecutor } from './tool-executor.js';
import { ContextManager } from './context-manager.js';
import { metricsSink } from '../metrics-sink.js';
import { MemoryManager } from '../../../memory/memory-manager.js';
import { AgentMemory } from '../../../memory/agent-memory.js';
import {
  buildToolSyntaxCorrectionPrompt,
  buildToolUseCorrectionPrompt,
  buildCodingTaskOperatingPrompt,
  buildCodingCompletionGatePrompt,
  suggestVerificationStrategy,
  isTermination as isTerminationResponse,
  extractFinalAnswer,
  normalizeFinalAnswer,
  containsUnparsedToolSyntax as containsUnparsedSyntax,
  shouldCorrectToolRefusal as shouldCorrectRefusal,
  shouldBlockCodingFinal,
} from './support/prompt-builder.js';
import { StagnationDetector } from './termination-detector.js';
import { TaskStatus } from '../../../planner/graph-planner.js';
import { MAX_ITERATIONS_DEFAULT } from '../../agent-constants.js';

/**
 * AgentEngine 工厂函数。供 CLI/Desktop 调用。
 *
 * @param {object} options
 * @param {object} options.modelProvider     — 必须。实现 chat(messages, opts)
 * @param {object} options.toolRegistry      — 必须。实现 get(name) / getAll() / toFunctionDefinitions()
 * @param {object} [options.memoryManager]   — 可选。记忆管理器
 * @param {object} [options.config]          — { workingDirectory, maxIterations, maxTokens, securityPolicy, intentClassification }
 * @param {object} [options.ui]              — UI 回调。默认无输出（quiet）。
 * @returns {AgentEngine}
 */
export function createAgentEngine({ modelProvider, toolRegistry, memoryManager = null, config = {}, ui = null }) {
  return new AgentEngine({ modelProvider, toolRegistry, memoryManager, config, ui });
}

function createEmptyToolRegistry() {
  return {
    size: 0,
    get() { return null; },
    getAll() { return []; },
    toFunctionDefinitions() { return []; },
  };
}

function normalizeModelResponse(response = {}) {
  const text = typeof response.text === 'string'
    ? response.text
    : typeof response.content === 'string'
      ? response.content
      : typeof response.answer === 'string'
        ? response.answer
        : '';

  // 支持两种字段命名：toolCalls (camelCase) 和 tool_calls (OpenAI snake_case)
  const rawToolCalls = Array.isArray(response.toolCalls) && response.toolCalls.length > 0
    ? response.toolCalls
    : Array.isArray(response.tool_calls) && response.tool_calls.length > 0
      ? response.tool_calls
      : [];

  // 统一归一化：将 OpenAI 原生格式 { id, type, function: { name, arguments } }
  // 转换为简化格式 { name, arguments }，便于下游 ToolExecutor 统一处理
  const toolCalls = rawToolCalls.map(call => {
    if (!call || typeof call !== 'object') {return call;}

    // 简化格式：已有 name 字段
    if (call.name) {
      let args = call.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      return { ...call, arguments: args || {} };
    }

    // OpenAI 原生格式：function.name + function.arguments
    if (call.function?.name) {
      let args = {};
      if (call.function.arguments) {
        if (typeof call.function.arguments === 'object') {
          args = call.function.arguments;
        } else if (typeof call.function.arguments === 'string') {
          try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
        }
      }
      return {
        id: call.id,
        name: call.function.name,
        arguments: args,
        source: call.type || 'native_tool_call',
        raw: call,
      };
    }

    return call;
  }).filter(call => call && (call.name || (call.function && call.function.name)));

  return {
    ...response,
    text,
    content: typeof response.content === 'string' ? response.content : text,
    toolCalls,
    finishReason: response.finishReason || response.finish_reason || 'stop',
  };
}

export class AgentEngine {
  // ============ 子系统 ============
  #modelProvider;
  #toolRegistry;
  #memoryManager;
  #config;
  #ui;
  #sessionManager;
  #retryStrategy;
  #textToolParser;
  #intentClassifier;
  #executionPlanManager;
  #toolExecutor;
  #contextManager;
  #stagnationDetector;
  #workspaceIndex;
  #workspaceState;
  #observationSummarizer;
  #contentStore;
  #fileAnalyzer;
  #snapshotStore;
  #hashlinePatcher;
  #hashlineBridge;
  #lspManager;
  #contextPruner;
  #tokenScope;

  // ============ 运行态 ============
  #stopRequested = false;
  #lastRunResult = null;
  #systemPromptInitialized = false;

  constructor({ modelProvider, toolRegistry, memoryManager, config, ui }) {
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry || createEmptyToolRegistry();
    // memoryManager 可选：没传时默认创建 AgentMemory（含结构化记忆、检索、校验），
    // fallback 到 MemoryManager 确保兼容性
    const cwd = config?.workingDirectory || process.cwd();
    this.#memoryManager = memoryManager || (() => {
      try { return new AgentMemory(cwd, modelProvider); }
      catch {
        try { return new MemoryManager(cwd); }
        catch { return null; }
      }
    })();
    this.#config = {
      maxIterations: config.maxIterations || MAX_ITERATIONS_DEFAULT,
      workingDirectory: config.workingDirectory || process.cwd(),
      toolResultCacheEnabled: config.toolResultCacheEnabled !== false,
      securityPolicy: config.securityPolicy || null,
      intentClassification: config.intentClassification || false,
      tokenBudget: config.tokenBudget || null,
      tokenBudgetWarningThreshold: config.tokenBudgetWarningThreshold ?? 70,
      maxTokens: config.maxTokens || 2048,
      ...config,
    };
    this.#ui = ui || {
      toolCall: () => {}, toolResult: () => {}, toolError: () => {},
      iteration: () => {}, finalAnswer: () => {},
      warn: () => {}, debug: () => {}, debugEvent: () => {},
      onTextDelta: () => {}, onReasoningDelta: () => {}, onToolCallDelta: () => {},
    };

    // ============ 子系统初始化 ============
    this.#sessionManager = new SessionManager({ model: this.#config.session?.model });
    this.#retryStrategy = new RetryStrategy();
    this.#textToolParser = new TextToolParser(this.#toolRegistry);
    this.#intentClassifier = this.#config.intentClassification
      ? new IntentClassifier(modelProvider, this.#toolRegistry, this.#config.intentClassifier || {})
      : null;
    this.#executionPlanManager = new ExecutionPlanManager();
    this.#contextPruner = new DynamicContextPruning();
    this.#tokenScope = this.#config.tokenScope || new TokenScope({
      budgetLimits: this.#config.tokenBudget ? {
        global: {
          limit: this.#config.tokenBudget,
          warningThreshold: this.#config.tokenBudgetWarningThreshold,
        },
      } : null,
      onBudgetWarning: (info) => this.#ui.debugEvent?.('Token budget warning', info),
      onBudgetExceeded: (info) => {
        this.#ui.debugEvent?.('Token budget exceeded - stopping', info);
        this.#stopRequested = true;
      },
    });
    this.#workspaceState = new WorkspaceState();
    this.#observationSummarizer = new ObservationSummarizer(this.#workspaceState);
    this.#workspaceIndex = new WorkspaceIndex(this.#config.workingDirectory);
    this.#contentStore = new ContentAddressableStore();
    this.#fileAnalyzer = new FileAnalyzer(this.#contentStore);

    // ============ Hashline 子系统初始化 ============
    // SnapshotStore: 管理文件快照历史，支持 stale tag recovery
    this.#snapshotStore = new InMemorySnapshotStore();
    // HashlineBridge: 把 Patcher 的事件桥接到 ContentAddressableStore
    this.#hashlineBridge = new HashlineBridge(this.#contentStore, this.#fileAnalyzer);
    // Patcher: 完整的 Hashline patch 应用器（含 preflight / recovery / 3-way merge）
    this.#hashlinePatcher = new Patcher({
      fs: new DiskFilesystem(this.#config.workingDirectory),
      snapshots: this.#snapshotStore,
      autoRecord: true,
      allowRecovery: true,
      bridge: this.#hashlineBridge,
    });

    // ============ LSP 子系统初始化 ============
    // ServerManager: 管理多语言 LSP server 生命周期
    this.#lspManager = new ServerManager({
      workspaceRoot: this.#config.workingDirectory,
    });

    // ============ 统一工具注册 ============
    // 通过 registerCodeTools 注册文件系统、Hashline 和 LSP 工具
    registerCodeTools(this.#toolRegistry, {
      lspManager: this.#lspManager,
      contentStore: this.#contentStore,
      hashlinePatcher: this.#hashlinePatcher,
    });

    this.#toolExecutor = new ToolExecutor({
      toolRegistry: this.#toolRegistry,
      securityPolicy: this.#config.securityPolicy,
      textToolParser: this.#textToolParser,
      ui: this.#ui,
      config: this.#config,
      contentStore: this.#contentStore,
      fileAnalyzer: this.#fileAnalyzer,
      snapshotStore: this.#snapshotStore,
      hashlinePatcher: this.#hashlinePatcher,
      lspManager: this.#lspManager,
    });
    this.#contextManager = null; // 在 run() 中懒创建（需要 sessionManager 就绪）
    this.#stagnationDetector = new StagnationDetector();

    // ============ 公共 getter ============
    this.getLSPManager = () => this.#lspManager;
  }

  // ============================================================
  // 对外 API
  // ============================================================

  /**
   * 主入口：接受用户输入，运行完整的 ReAct 循环，返回最终答案或结构化错误。
   *
   * @param {string} userInput
   * @returns {Promise<{success:boolean,status:string,answer:string,reason:string|null,iterations:number,durationMs:number,toolEvents:object[],error?:string,userInputRequest?:string}>}
   */
  async run(userInput) {
    const runStartedAt = Date.now();
    // —— Metrics: 会话级标记（每次 run 都有独立的 runId）——
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.#lastRunResult = {
      runId,
      success: false,
      status: 'running',
      answer: '',
      reason: null,
      iterations: 0,
      durationMs: 0,
      toolEvents: [],
    };
    try { metricsSink.startRun(runId); } catch (_) { /* 忽略 */ }
    this.#stopRequested = false;
    this.#ui.debugEvent?.('Agent run started', {
      inputPreview: this.#preview(userInput, 240),
      workingDirectory: this.#config.workingDirectory,
      maxIterations: this.#config.maxIterations,
    });

    // 首次 run：设置 system prompt
    if (!this.#systemPromptInitialized || this.#sessionManager.length === 0) {
      // 初始化结构化记忆（AgentMemory 异步加载并构建索引）
      if (this.#memoryManager && typeof this.#memoryManager.initialize === 'function') {
        try { await this.#memoryManager.initialize(); } catch { /* 静默失败 */ }
      }

      // 路径作用域懒加载：当前 workingDirectory 下的规则
      if (this.#memoryManager && typeof this.#memoryManager.ensureRulesForPath === 'function') {
        try {
          const cwd = this.#config.workingDirectory || process.cwd();
          const { hasNewRules } = this.#memoryManager.ensureRulesForPath(cwd);
          if (hasNewRules) {
            this.#ui.debugEvent?.('Path-scoped rules loaded', { cwd });
          }
        } catch { /* 静默 */ }
      }

      // 生成记忆上下文：AgentMemory → getMemoryContext(userInput)，MemoryManager → toPromptFragment()
      let memoryContext = '';
      if (this.#memoryManager && typeof this.#memoryManager.getMemoryContext === 'function') {
        try {
          const inputPreview = typeof userInput === 'string' ? userInput.substring(0, 200) : '';
          memoryContext = this.#memoryManager.getMemoryContext(inputPreview);
        } catch { /* 静默失败 */ }
      }

      const systemPrompt = buildSystemPrompt(
        this.#memoryManager,
        this.#toolRegistry,
        this.#config.workingDirectory,
        memoryContext,
      );

      // 注入自动记忆提示
      if (this.#memoryManager && typeof this.#memoryManager.getAutoMemoryPrompt === 'function') {
        try {
          const autoPrompt = this.#memoryManager.getAutoMemoryPrompt({
            toolEvents: this.#lastRunResult?.toolEvents || [],
          });
          if (autoPrompt) {
            this.#sessionManager.addSystemMessage(autoPrompt);
          }
        } catch { /* 静默 */ }
      }

      this.#sessionManager.setSystemPrompt(systemPrompt);
      const toolInstructions = this.#textToolParser.generateToolPrompt([]);
      this.#sessionManager.addSystemMessage(toolInstructions);
      this.#systemPromptInitialized = true;
      this.#ui.debugEvent?.('Session initialized', {
        toolCount: this.#toolRegistry.size,
        systemPromptChars: systemPrompt.length,
        toolInstructionChars: toolInstructions.length,
      });

      // —— 注入初始工作区上下文（多文件聚合）——
      if (this.#workspaceState && typeof this.#workspaceState.aggregateContext === 'function') {
        const wsCtx = this.#workspaceState.aggregateContext({ maxFiles: 5, maxCharsPerFile: 400, maxTotalChars: 2000 });
        if (wsCtx && wsCtx.files && wsCtx.files.length > 0) {
          const prefix = `<!-- workspace-context: files=${wsCtx.files.join(',')} -->\n${wsCtx.summary || ''}`;
          this.#sessionManager.addSystemMessage(prefix);
        }
      }
    }

    // ========== Step 1：意图识别（仅当显式开启时才调用 LLM 预分类） ==========
    const intent = (this.#intentClassifier && shouldUseIntentClassifier(userInput))
      ? await this.#intentClassifier.classify(userInput, {
          recentMessages: this.#sessionManager.getRecentExchanges(3),
        })
      : null;

    if (intent) {
      this.#ui.debugEvent?.('Intent classified', {
        intent: intent.intent,
        confidence: intent.confidence,
        recommendedTools: intent.recommendedTools,
      });
    } else {
      this.#ui.debugEvent?.('Intent classifier skipped', { reason: 'local_task_router' });
    }

    // ========== Step 2：任务分类（合并进 IntentClassifier，消除一层路由） ==========
    const taskProfile = this.#intentClassifier?.classifyTask?.(userInput, intent)
      ?? quickAssess(userInput);

    // ========== Step 3：准备运行上下文 ==========
    this.#sessionManager.addUserMessage(userInput);
    const routingPrompt = this.#intentClassifier?.buildRoutingPrompt?.(intent);
    if (routingPrompt) {this.#sessionManager.addUserMessage(routingPrompt);}

    this.#stagnationDetector.reset();
    this.#toolExecutor.reset();
    this.#executionPlanManager.plan; // 触发 plan 初始化（下面会实际创建）

    const executionPlan = this.#executionPlanManager.createIfNeeded(userInput, taskProfile);
    const maxIterations = this.#intentClassifier?.budgetFor?.(taskProfile)
      ?? computeIterationBudget(taskProfile.riskLevel, this.#config.maxIterations);
    this.#contextManager = new ContextManager({
      sessionManager: this.#sessionManager,
      contextPruner: this.#contextPruner,
      tokenScope: this.#tokenScope,
      workspaceState: this.#workspaceState,
      observationSummarizer: this.#observationSummarizer,
      config: { maxTokens: this.#config.maxTokens },
    });

    // ========== Step 4：编码任务增强 ==========
    let toolUseCorrections = 0;
    let codingGateCorrections = 0;
    let lastResponseText = '';

    if (taskProfile.isCodingTask) {
      this.#ui.debugEvent?.('Coding task mode enabled', taskProfile);
      const basePrompt = buildCodingTaskOperatingPrompt(userInput);
      const strategy = await suggestVerificationStrategy(userInput, { workingDirectory: this.#config.workingDirectory });
      this.#sessionManager.addUserMessage(`${basePrompt}\n\nVerification strategy:\n${strategy}`);
    }

    if (executionPlan) {
      this.#ui.debugEvent?.('Automatic task orchestration enabled', { plan: executionPlan.toJSON() });
      this.#ui.debugEvent?.('Execution plan created', {
        plan: executionPlan.toJSON(),
        summary: this.#planSummary(executionPlan),
      });
      this.#sessionManager.addUserMessage(this.#executionPlanManager.buildPrompt());
    }

    // 异步预热工作目录索引（不阻塞首轮迭代）
    if (taskProfile.isCodingTask) {
      this.#workspaceIndex.warm().then(summary => {
        if (summary && this.#sessionManager) {
          this.#sessionManager.addUserMessage(summary);
        }
      }).catch(err => {
        this.#ui.debugEvent?.('Workspace index warm failed', { error: err.message });
      });
      this.#workspaceIndex.startPeriodicSync();
    }

    // ============================================================
    // 主循环：Thought → Action → Observation
    // ============================================================
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      if (this.#stopRequested) {
        return this.#completeRun({
          success: false, status: 'cancelled', answer: '', reason: 'user_stop',
          iterations: iteration, startedAt: runStartedAt,
        });
      }
      this.#ui.iteration?.(iteration, maxIterations);

      // 停滞检测：注入 nudge 或进度检查点
      const planSummary = executionPlan ? this.#planSummary(executionPlan) : null;
      const nudge = this.#stagnationDetector.nudge(iteration, maxIterations, { planSummary });
      if (nudge?.message) {
        this.#sessionManager.addUserMessage(nudge.message);
      }

      this.#ui.debugEvent?.('Iteration started', {
        iteration,
        maxIterations,
        sessionMessages: this.#sessionManager.getHistory().length,
        estimatedTokens: this.#sessionManager.getTokenCount?.() ?? 0,
      });

      // ========== 上下文窗口管理 ==========
      this.#contextManager.manage(iteration, maxIterations);

      // ========== Step 5：2 层路由 (intent → tool-router) ==========
      const currentPhase = this.#executionPlanManager.plan?.status === TaskStatus.RUNNING
        ? this.#phaseFromIteration(iteration, maxIterations)
        : null;

      // 扁平化：统一使用 tool-router 做最终工具选择
      const routedTools = selectToolsForRequest(this.#toolRegistry.getAll(), {
        userInput, taskProfile, intent, currentPhase,
      });
      const activeRoutedToolNames = new Set(routedTools.map(tool => tool.name));
      const functions = this.#toolRegistry.toFunctionDefinitions(routedTools);
      const messages = withRoutedToolContext(
        this.#sessionManager.getMessages(),
        this.#textToolParser.generateToolPrompt(routedTools),
        currentPhase,
      );

      // —— 注入本轮工作区上下文（多文件聚合快照）——
      if (this.#workspaceState && typeof this.#workspaceState.aggregateContext === 'function') {
        const wsCtx = this.#workspaceState.aggregateContext({ maxFiles: 6, maxCharsPerFile: 500, maxTotalChars: 2400 });
        if (wsCtx && wsCtx.files && wsCtx.files.length > 0) {
          messages.push({
            role: 'system',
            content: `<!-- workspace-context: files=${wsCtx.files.join(',')} -->\n${wsCtx.summary || ''}`,
          });
        }
      }

      // ========== Step 6：LLM 调用（带重试 + 超时） ==========
      if (!this.#modelProvider || typeof this.#modelProvider.chat !== 'function') {
        this.#ui.warn?.('缺少 modelProvider，请在初始化时传入。engine.attachModelProvider() 可在运行时绑定');
        return this.#completeRun({
          success: false,
          status: 'error',
          answer: null,
          reason: '未配置 modelProvider — 无法调用 LLM。请在初始化时传入 modelProvider，或通过 engine.attachModelProvider() 注入。',
          iterations: 0,
          startedAt: runStartedAt,
          userInputRequest: userInput,
        });
      }
      const llmStartedAt = Date.now();
      const llmAttemptsStart = 0;
      let llmAttempts = 0;
      let llmError = null;
      this.#ui.debugEvent?.('LLM request', {
        modelProvider: this.#modelProvider.constructor?.name || 'unknown',
        messageCount: messages.length,
        toolDefinitions: functions.length,
        routedToolNames: functions.map(tool => tool.name),
        currentPhase,
        maxTokens: this.#config.maxTokens,
      });

      let response;
      try {
        const supportsStreaming = typeof this.#modelProvider.chatStream === 'function'
          && process.env.AGENT_DISABLE_STREAMING !== 'true';

        let streamResult = null;
        if (supportsStreaming) {
          try {
            streamResult = await this.#modelProvider.chatStream(messages, {
              functions,
              maxTokens: this.#config.maxTokens,
            });
          } catch (_) {
            streamResult = null;
          }
        }
        const hasValidStream = streamResult
          && typeof streamResult.stream === 'function'
          && typeof streamResult.finalize === 'function';

        if (hasValidStream) {
          // ===== 优先走流式分支：逐 token 推送增量到 UI =====
          response = await this.#retryStrategy.executeWithRetry(async () => {
            llmAttempts++;
            return await withTimeout(
              async () => {
                // 迭代增量事件，转发到 UI
                for await (const evt of streamResult.stream()) {
                  if (!evt) {continue;}
                  if (evt.type === 'text_delta' && evt.text) {
                    this.#ui.onTextDelta?.(evt.text);
                  } else if (evt.type === 'reasoning_delta' && evt.text) {
                    this.#ui.onReasoningDelta?.(evt.text);
                  } else if (evt.type === 'tool_call_delta') {
                    this.#ui.onToolCallDelta?.({
                      index: evt.index,
                      name: evt.name,
                      arguments: evt.arguments,
                    });
                  }
                  // usage / finish 不转发 UI
                }
                // finalize() 返回 chat() 同结构的完整响应
                return await streamResult.finalize();
              },
              120000,
              'LLM streaming call',
            );
          });
        } else {
          // ===== 原有非流式分支 =====
          response = await this.#retryStrategy.executeWithRetry(async () => {
            llmAttempts++;
            return withTimeout(
              () => this.#modelProvider.chat(messages, {
                functions,
                maxTokens: this.#config.maxTokens,
              }),
              120000,
              'LLM call',
            );
          });
        }
        response = normalizeModelResponse(response);
        // —— LLM 成功 metrics ——
        try {
          const modelName = this.#modelProvider.getModelName?.() || this.#modelProvider.constructor?.name || 'unknown';
          metricsSink.recordLLMRequest({
            runId: this.#lastRunResult?.runId,
            model: modelName,
            durationMs: Date.now() - llmStartedAt,
            tokensIn: response.usage?.inputTokens,
            tokensOut: response.usage?.outputTokens,
            success: true,
            attempt: llmAttempts,
          });
        } catch (_) { /* 忽略 */ }
      } catch (error) {
        llmError = error instanceof Error ? error.message : String(error);
        // —— LLM 失败 metrics ——
        try {
          metricsSink.recordLLMRequest({
            runId: this.#lastRunResult?.runId,
            model: this.#modelProvider.getModelName?.() || this.#modelProvider.constructor?.name || 'unknown',
            durationMs: Date.now() - llmStartedAt,
            success: false,
            error: llmError,
            attempt: llmAttempts,
          });
        } catch (_) { /* 忽略 */ }
        throw error;
      }
      lastResponseText = response?.text || '';

      this.#ui.debugEvent?.('LLM response', {
        durationMs: Date.now() - llmStartedAt,
        attempts: llmAttempts,
        failureReason: llmError,
        finishReason: response.finishReason,
        textPreview: this.#preview(response.text, 300),
        nativeToolCalls: response.toolCalls?.length || 0,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      });

      // TokenScope: 记录 token 成本
      try {
        const modelName = this.#modelProvider.getModelName?.() || this.#modelProvider.constructor?.name || 'unknown';
        let inputTokens;
        let outputTokens;
        if (response.usage && response.usage.inputTokens != null) {
          inputTokens = response.usage.inputTokens;
          outputTokens = response.usage.outputTokens || Math.ceil((response.text || '').length / 4);
        } else {
          let inputChars = 0;
          for (const msg of messages) {
            inputChars += (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')).length;
          }
          inputTokens = Math.ceil(inputChars / 4);
          outputTokens = Math.ceil((response.text || '').length / 4);
        }
        this.#tokenScope.recordRequest({
          model: modelName, inputTokens, outputTokens, userId: 'global',
          metadata: { source: 'agent-run', iteration: iteration },
        });
      } catch { /* Token accounting best-effort, 不影响主循环 */ }

      this.#ui.debug?.(`Response: ${(response.text || '').substring(0, 200)}...`);

      // ========== Step 7：工具调用解析（native + text-based） ==========
      const nativeToolCalls = response.toolCalls || [];
      const parsedToolCalls = nativeToolCalls.length === 0
        ? this.#textToolParser.parse(response.text)
        : [];
      const allToolCalls = [...nativeToolCalls, ...parsedToolCalls];

      if (allToolCalls.length > 0) {
        this.#ui.debugEvent?.('Tool calls detected', {
          native: nativeToolCalls.map(call => ({ name: call.name, arguments: call.arguments })),
          parsed: parsedToolCalls.map(call => ({ name: call.name, arguments: call.arguments, source: call.source })),
        });
      }

      // -------- 短路 1：ExecutionPlan 完成 + provider 说 stop --------
      if (
        allToolCalls.length === 0 &&
        response.finishReason === 'stop' &&
        response.text?.trim() &&
        this.#executionPlanManager.isCompleted
      ) {
        const answer = isTerminationResponse(response.text)
          ? extractFinalAnswer(response.text)
          : response.text.trim();
        this.#ui.debugEvent?.('Final answer emitted', {
          iteration, totalDurationMs: Date.now() - runStartedAt,
          reason: 'completed_plan_provider_stop_without_marker',
          answerPreview: this.#preview(answer, 300),
        });
        this.#ui.finalAnswer?.(answer);
        this.#sessionManager.addAssistantMessage(response.text);
        return this.#completeRun({
          success: true, status: 'completed', answer, reason: 'completed_plan_provider_stop_without_marker',
          iterations: iteration, startedAt: runStartedAt,
        });
      }

      // -------- 短路 2：工具语法纠正（LLM 返回不合法工具调用格式） --------
      if (
        allToolCalls.length === 0 &&
        response.text?.trim() && toolUseCorrections < 2 &&
        containsUnparsedSyntax(this.#textToolParser, response.text)
      ) {
        toolUseCorrections++;
        this.#ui.debugEvent?.('Tool syntax correction requested', {
          iteration, correction: toolUseCorrections,
          responsePreview: this.#preview(response.text, 300),
        });
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(buildToolSyntaxCorrectionPrompt(this.#textToolParser, this.#toolRegistry, response.text));
        continue;
      }

      // -------- 短路 3：工具使用纠正（LLM 说"我没有工具"） --------
      if (
        allToolCalls.length === 0 &&
        response.text?.trim() && toolUseCorrections < 2 &&
        shouldCorrectRefusal(this.#toolRegistry, userInput, response.text)
      ) {
        toolUseCorrections++;
        this.#ui.debugEvent?.('Tool use correction requested', {
          iteration, correction: toolUseCorrections,
          responsePreview: this.#preview(response.text, 300),
          userInputPreview: this.#preview(userInput, 160),
        });
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(buildToolUseCorrectionPrompt(this.#toolRegistry, userInput));
        continue;
      }

      // -------- 短路 4：编码任务完成门（还没工具证据 / 没走完 plan 就说完成） --------
      const shouldBlockFinal = allToolCalls.length === 0 &&
        codingGateCorrections < 3 &&
        shouldBlockCodingFinal(userInput, response.text, {
          taskProfile,
          toolEvents: this.#toolExecutor.events,
          executionPlanIsCompleted: this.#executionPlanManager.isCompleted,
          planSummary,
        });

      if (shouldBlockFinal.block) {
        codingGateCorrections++;
        this.#ui.debugEvent?.('Coding completion gate requested', {
          iteration, correction: codingGateCorrections,
          reason: shouldBlockFinal.reason,
          evidence: shouldBlockFinal.evidence,
          responsePreview: this.#preview(response.text, 300),
        });
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(
          buildCodingCompletionGatePrompt(userInput, shouldBlockFinal)
        );
        continue;
      }

      // -------- 短路 5：FINAL_ANSWER 标记终止 --------
      if (isTerminationResponse(response.text)) {
        const answer = normalizeFinalAnswer(extractFinalAnswer(response.text));
        this.#ui.debugEvent?.('Final answer emitted', {
          iteration, totalDurationMs: Date.now() - runStartedAt,
          answerPreview: this.#preview(answer, 300),
        });
        this.#ui.finalAnswer?.(answer);
        this.#sessionManager.addAssistantMessage(response.text);
        return this.#completeRun({
          success: true, status: 'completed', answer, reason: 'final_answer_marker',
          iterations: iteration, startedAt: runStartedAt,
        });
      }

      // -------- 短路 6：无工具调用但 provider 说 stop → 视作最终回答 --------
      if (allToolCalls.length === 0 && response.finishReason === 'stop' && response.text?.trim()) {
        const answer = normalizeFinalAnswer(response.text);
        this.#ui.debugEvent?.('Final answer emitted', {
          iteration, totalDurationMs: Date.now() - runStartedAt,
          answerPreview: this.#preview(answer, 300),
          reason: 'provider_stop_no_tools',
        });
        this.#ui.finalAnswer?.(answer);
        this.#sessionManager.addAssistantMessage(response.text);
        return this.#completeRun({
          success: true, status: 'completed', answer, reason: 'provider_stop_no_tools',
          iterations: iteration, startedAt: runStartedAt,
        });
      }

      // -------- 常规路径：执行工具调用 --------
      this.#sessionManager.addAssistantMessage(response.text);

      if (allToolCalls.length === 0) {
        // provider 没触发 stop，也没有工具调用 → 轻推一下避免死循环
        if (iteration >= maxIterations - 1) {
          const answer = response.text.trim();
          this.#ui.finalAnswer?.(answer);
          return this.#completeRun({
            success: true, status: 'completed', answer, reason: 'iteration_budget_exhausted',
            iterations: iteration, startedAt: runStartedAt,
          });
        }
        this.#sessionManager.addUserMessage(
          'Please either provide a FINAL_ANSWER or call a tool to continue.'
        );
        continue;
      }

      // 执行每个工具调用（ToolExecutor 统一处理：安全策略、缓存、规范化）
      for (const toolCall of allToolCalls) {
        const toolStart = Date.now();
        const execResult = await this.#toolExecutor.execute(
          toolCall,
          {
            memoryManager: this.#memoryManager,
            sessionManager: this.#sessionManager,
            modelProvider: this.#modelProvider,
            debug: this.#config.debug || false,
          },
          {
            resultMode: 'tool',
            emitObservation: (id, name, observation, _mode) => {
              this.#sessionManager.addUserMessage(
                `[Tool ${name}] ${observation}`
              );
            },
          },
        );
        const toolDuration = Date.now() - toolStart;
        if (typeof execResult === 'object' && execResult !== null) {
          execResult.durationMs = toolDuration;
        }
        this.#ui.debugEvent?.('tool_result', {
          toolName: execResult.name,
          success: !execResult.error && !execResult.skipped,
          durationMs: toolDuration,
          error: execResult.error ? String(execResult.error).substring(0, 200) : null,
        });

        // —— 工具调用 metrics ——
        try {
          metricsSink.recordToolCall({
            runId: this.#lastRunResult?.runId,
            toolName: execResult.name,
            durationMs: toolDuration,
            success: !execResult.error && !execResult.skipped,
            error: execResult.error ? String(execResult.error) : null,
            skipped: !!execResult.skipped,
          });
        } catch (_) { /* 忽略 */ }

        // 记录到停滞检测
        this.#stagnationDetector.recordTool(execResult.name, toolCall.arguments, iteration, (name, _args) => {
          const mutationNames = new Set([
            'write_file', 'edit_file', 'delete_file', 'rename_file', 'git_apply_patch',
            'git_commit', 'git_add', 'git_push', 'harness_replace', 'harness_insert', 'harness_delete',
          ]);
          return mutationNames.has(name);
        });

        // 工作区状态更新
        if (this.#workspaceState && typeof this.#workspaceState.onToolEvent === 'function') {
          this.#workspaceState.onToolEvent(execResult);
        }

        // 推进执行计划
        if (this.#executionPlanManager.plan) {
          const planUpdate = this.#executionPlanManager.advance(execResult.name, toolCall.arguments, execResult.result);
          if (planUpdate) {
            this.#ui.debugEvent?.('Execution plan updated', {
              toolName: execResult.name,
              update: planUpdate,
              plan: this.#executionPlanManager.plan.toJSON(),
              summary: this.#planSummary(this.#executionPlanManager.plan),
            });
          }
        }
      }
    }

    // 达到迭代上限仍未完成
    const lastText = lastResponseText.trim();
    const fallback = lastText || 'Agent 达到迭代上限仍未完成任务。';
    this.#ui.finalAnswer?.(fallback);
    return this.#completeRun({
      success: false, status: 'iteration_limit', answer: fallback,
      reason: 'max_iterations_exceeded', iterations: maxIterations, startedAt: runStartedAt,
    });
  }

  /** 中断当前 run（在下一次 while 循环检查时退出） */
  stop() { this.#stopRequested = true; }

  /** 挂载 modelProvider（支持两步初始化：先构造引擎，再连模型） */
  attachModelProvider(provider) { this.#modelProvider = provider; }

  /** 动态更新工作目录。下次 run/processInput 将使用新路径 */
  setWorkingDirectory(directory) {
    if (!this.#config || typeof directory !== 'string' || !directory.trim()) {return;}
    this.#config.workingDirectory = directory;

    // 同步更新依赖组件，确保目录切换后所有子系统都在新目录下工作
    if (typeof this.#workspaceIndex?.setWorkingDirectory === 'function') {
      this.#workspaceIndex.setWorkingDirectory(directory);
    }

    // 重置 ToolExecutor 缓存状态，确保下次工具调用从新目录加载缓存
    if (typeof this.#toolExecutor?.reset === 'function') {
      this.#toolExecutor.reset();
    }
  }

  /** 访问当前配置（只读，工作目录等信息可用于 UI 展示） */
  getConfig() { return this.#config; }

  /** 访问当前 ToolRegistry（用于调试 / 动态注册） */
  getToolRegistry() { return this.#toolRegistry; }

  /** 访问当前 SecurityPolicy（用于只读展示） */
  getSecurityPolicy() { return this.#config.securityPolicy || null; }

  /** 访问当前 WorkspaceState（用于外部订阅 / 聚和上下文） */
  getWorkspaceState() { return this.#workspaceState; }

  /** 最近一次 run 的结果 */
  getRunResult() { return this.#lastRunResult ? { ...this.#lastRunResult } : null; }

  /** 当前使用的路由工具名集合（用于调试 / UI 展示） */
  getActiveToolNames() {
    const profile = quickAssess('');
    return selectToolsForRequest(this.#toolRegistry.getAll(), {
      userInput: '', taskProfile: profile,
      currentPhase: this.#phaseFromIteration(0, this.#config.maxIterations),
    }).map(t => t.name);
  }

  /** 工作区摘要（调试 / UI 展示） */
  getWorkspaceSummary() {
    return {
      state: this.#workspaceState.getSummary?.() ?? null,
      criticalFacts: this.#workspaceState.getCriticalFacts?.() ?? [],
      workspaceDescription: this.#observationSummarizer?.generateWorkspaceDescription?.() || '',
    };
  }

  // ============================================================
  // 兼容层：供 DesktopCore / CLI / IPC 调用
  // ============================================================

  /** 幂等初始化（DesktopCore 在 initialize() 中调用） */
  initialize() { return this; }

  /** 引擎是否已初始化（兼容旧 API） */
  isInitialized() {
    return true;
  }

  /** 返回引擎状态（idle / running / stopped / error） */
  getState() {
    return {
      state: this.#stopRequested ? 'stopped' : (this.#lastRunResult?.status || 'idle'),
      workingDirectory: this.#config.workingDirectory,
      maxIterations: this.#config.maxIterations,
      toolCount: this.#toolRegistry.size,
    };
  }

  /** 返回所有已注册工具（name + description） */
  getTools() {
    try {
      const all = this.#toolRegistry.getAll?.() || [];
      return all.map(t => ({
        name: t.name || String(t),
        description: t.description || '',
        category: t.category || 'general'
      }));
    } catch { return []; }
  }

  /** 注册单个工具（直接转发到 toolRegistry） */
  registerTool(tool) {
    try { this.#toolRegistry.register(tool); } catch (_) {}
    return this;
  }

  /** 批量注册工具 */
  registerTools(tools) {
    if (!Array.isArray(tools)) {return this;}
    for (const t of tools) {this.registerTool(t);}
    return this;
  }

  /** 与旧 API 兼容：processInput 等价于 run */
  async processInput(input, options = {}) {
    const text = (typeof input === 'string') ? input : (input?.text || JSON.stringify(input));
    return this.run(text);
  }

  /** 返回最近一次 modelProvider（可能为 null） */
  getModelProvider() { return this.#modelProvider || null; }

  /** 返回工具分组（兼容旧 API：按 tool name 的前缀分组） */
  getToolGroups() {
    try {
      const tools = this.#toolRegistry.getAll?.() || [];
      const groups = new Map();
      for (const t of tools) {
        const name = typeof t === 'string' ? t : (t.name || 'tool');
        const prefix = name.includes('_') ? name.split('_')[0] : 'misc';
        if (!groups.has(prefix)) {groups.set(prefix, { group: prefix, tools: [] });}
        groups.get(prefix).tools.push(name);
      }
      return Array.from(groups.values());
    } catch (_) {
      return [];
    }
  }

  /** 释放资源 */
  dispose() {
    try { this.#modelProvider.dispose?.(); } catch {}
    try { this.#workspaceIndex?.stopPeriodicSync?.(); } catch {}
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  #completeRun({ success, status, answer, reason, iterations, startedAt, error, userInputRequest }) {
    try { this.#workspaceIndex?.stopPeriodicSync?.(); } catch {}
    const durationMs = Date.now() - startedAt;
    const toolEvents = this.#toolExecutor.events.map(event => ({ ...event }));
    const result = {
      runId: this.#lastRunResult?.runId,
      success, status, answer, reason, iterations,
      durationMs,
      toolEvents,
    };
    if (error) {result.error = error;}
    if (userInputRequest) {result.userInputRequest = userInputRequest;}
    this.#lastRunResult = result;

    // —— Metrics: 会话结束标记 ——
    try {
      metricsSink.finishRun(result.runId, {
        success, iterations, durationMs,
        reason: error ? String(error) : reason,
        toolCount: toolEvents.length,
      });
    } catch (_) { /* 忽略 */ }

    // —— Auto-Memory: 分析本轮会话，自动沉淀高置信度记忆（fire-and-forget）——
    if (this.#memoryManager && typeof this.#memoryManager.autoWriteMemory === 'function') {
      // 不 await，避免阻塞 main loop
      (async () => {
        try {
          const errors = (toolEvents || []).filter(e => e.error || e.result?.error).map(e => (e.error || e.result?.error)?.toString()).filter(Boolean);
          const { written, deferred } = await this.#memoryManager.autoWriteMemory({
            finalAnswer: answer,
            corrections: success ? [] : (error ? [String(error)] : []),
            toolEvents: toolEvents || [],
          });
          if (written.length > 0) {
            this.#ui.debugEvent?.('Auto-memory written', { count: written.length, topics: written.map(w => w.topic) });
          }
          if (deferred.length > 0) {
            this.#ui.debugEvent?.('Auto-memory deferred', { count: deferred.length });
          }
        } catch { /* 静默 */ }
      })();
    } else if (this.#memoryManager && typeof this.#memoryManager.autoSuggestMemory === 'function') {
      // fallback：旧版仅建议模式
      try {
        const errors = (toolEvents || []).filter(e => e.error || e.result?.error).map(e => (e.error || e.result?.error)?.toString()).filter(Boolean);
        const { shouldSuggest, suggestions } = this.#memoryManager.autoSuggestMemory({
          finalAnswer: answer,
          corrections: success ? [] : (error ? [String(error)] : []),
          toolEvents: toolEvents || [],
        });
        if (shouldSuggest) {
          this.#ui.debugEvent?.('Auto-memory suggestions', { count: suggestions.length });
        }
      } catch { /* 静默 */ }
    }

    return result;
  }

  #preview(value, maxLength = 200) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }

  #phaseFromIteration(iteration, maxIterations) {
    if (!this.#executionPlanManager.plan) {return null;}
    const ratio = maxIterations > 0 ? iteration / maxIterations : 0;
    if (ratio < 0.15) {return 'exploration';}
    if (ratio < 0.35) {return 'planning';}
    if (ratio < 0.65) {return 'implementation';}
    if (ratio < 0.85) {return 'inspection';}
    return 'verification';
  }

  #planSummary(plan) {
    const tasks = plan.toJSON().tasks;
    const byName = tasks.map(t => `  - ${t.id}: ${t.status}`).join('\n');
    return `Tasks: ${tasks.length}\n${byName}`;
  }
}

// 兼容 ReActAgent 类名（老代码 import 不破坏）
export { AgentEngine as ReActAgent };
export default AgentEngine;
