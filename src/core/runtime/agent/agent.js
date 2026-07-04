/**
 * ReAct Agent Engine
 * Core reasoning loop: Thought -> Action -> Observation -> repeat
 *
 * 架构（v2 — 模块化拆分）:
 *   ReActAgent（协调器）
 *     ├─ AgentPlanner   — 执行计划创建/推进/阶段推导
 *     ├─ AgentVerifier  — 完成门控/验证策略/证据检查
 *     ├─ AgentRouter    — 工具调用执行/安全/缓存/去重
 *     └─ AgentContext   — 上下文管理/工作区状态/停滞检测
 */

import { SessionManager } from '../../session/session-manager.js';
import { buildSystemPrompt, buildTaskConstraintPrompt } from '../../../prompts/system-prompt.js';
import { classifyError, RetryStrategy, withTimeout } from '../../../errors/error-handler.js';
import { ui } from '../../../cli/ui.js';
import { TextToolParser } from '../../parsing/text-tool-parser.js';
import { IntentClassifier } from '../../intent-classifier.js';
import { DynamicContextPruning } from '../../dynamic-context-pruning.js';
import { ConversationSummarizer } from '../../conversation-summarizer.js';
import { WorkspaceIndex } from '../../workspace/workspace-index.js';
import { selectToolsForRequest, shouldUseIntentClassifier } from './tool-router.js';
import { WorkspaceState } from '../../workspace/workspace-state.js';
import { ObservationSummarizer } from '../../observation-summarizer.js';
import { ContentAddressableStore, FileAnalyzer } from '../../harness/content-addressing.js';
import { withRoutedToolContext } from '../../tools/routed-tool-context.js';
import { TokenScope } from './support/token-scope.js';
import { MAX_ITERATIONS_DEFAULT, METHODOLOGY_TOOLS } from '../../agent/constants.js';
import { TaskStatus } from '../../../planner/graph-planner.js';
import { isMutationTool, isSemanticRiskReviewTool } from './execution-plan-manager.js';
import { metricsSink } from '../metrics-sink.js';
import {
  LifecycleEvent,
  AgentPhase,
  createAgentStartEvent,
  createAgentEndEvent,
  createTurnStartEvent,
  createTurnEndEvent,
  createPhaseChangeEvent,
} from '../lifecycle-events.js';
import { RunSummaryCollector } from '../run-summary.js';
import {
  isTermination as isTerminationResponse,
  extractFinalAnswer,
  normalizeFinalAnswer,
  containsUnparsedToolSyntax as containsUnparsedSyntax,
  shouldCorrectToolRefusal as shouldCorrectRefusal,
  shouldBlockCodingFinal,
  buildToolSyntaxCorrectionPrompt,
  buildToolUseCorrectionPrompt,
} from './support/prompt-builder.js';

// 新拆分的子模块
import { AgentPlanner } from './agent-planner.js';
import { AgentVerifier } from './agent-verifier.js';
import { AgentRouter } from './agent-router.js';
import { AgentContext } from './agent-context.js';
import { stripActionBlocks } from './agent-engine.js';

/**
 * Plan 阶段 → AgentPhase 映射
 * @param {string} planPhase
 * @returns {string|null}
 */
function mapPlanPhaseToAgentPhase(planPhase) {
  switch (planPhase) {
    case 'exploration':
      return AgentPhase.EXPLORING;
    case 'planning':
      return AgentPhase.PLANNING;
    case 'implementation':
      return AgentPhase.IMPLEMENTING;
    case 'inspection':
      return AgentPhase.REVIEWING;
    case 'verification':
      return AgentPhase.VERIFYING;
    default:
      return null;
  }
}

export class ReActAgent {
  #modelProvider;
  #toolRegistry;
  #sessionManager;
  #memoryManager;
  #config;
  #retryStrategy;
  #ui;

  // 停滞追踪（轻量，仅用于迭代预算降级判断）
  #stagnationBudgetDowngrade = false;

  // 运行态
  #lastResponse = '';
  #repeatCount = 0;
  #stopRequested = false;
  #lastRunResult = null;
  #activeTaskProfile = null;
  #activeRoutedToolNames = null;
  #runToolEvents = [];
  // ask_user suspend/resume: Promise-based 挂起机制,替代硬中断
  #userInputResolve = null;
  #pendingUserInputRequest = null;
  // plan 进度回调：由外部（session-state）注入，用于推送 plan 更新到 UI 事件总线
  #onPlanAdvance = null;

  // ✅ 新增：实现阶段无代码变更熔断追踪
  #implementationNoMutationIterations = 0;
  #implementationPhaseStarted = false;

  // ✅ 新增：运行统计收集器
  #runSummaryCollector = new RunSummaryCollector();

  // ✅ 新增：生命周期事件回调（由外部注入，如 UI adapter）
  #onLifecycleEvent = null;

  // 当前阶段
  #currentPhase = AgentPhase.INITIALIZING;

  // 子系统
  #textToolParser;
  #intentClassifier;
  #tokenScope;
  #workspaceIndex;
  #workspaceState;
  #contentStore;
  #fileAnalyzer;
  #contextPruner;
  #tokenJuice;
  #conversationSummarizer;

  // 新拆分的子模块
  #planner;
  #verifier;
  #router;
  #agentContext;

  constructor(modelProvider, toolRegistry, memoryManager, config = {}, customUI = ui) {
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry;
    this.#memoryManager = memoryManager;
    this.#config = {
      maxIterations: config.maxIterations || MAX_ITERATIONS_DEFAULT,
      workingDirectory: config.workingDirectory || process.cwd(),
      ...config,
    };

    if (config.session instanceof SessionManager) {
      this.#sessionManager = config.session;
    } else {
      this.#sessionManager = new SessionManager({
        ...(config.session || {}),
        model: config.session?.model || config.model,
      });
    }

    this.#retryStrategy = new RetryStrategy();
    this.#textToolParser = new TextToolParser(toolRegistry);
    this.#intentClassifier = config.intentClassification
      ? new IntentClassifier(modelProvider, toolRegistry, config.intentClassifier || {})
      : null;
    this.#ui = customUI;
    this.#contextPruner = config.contextPruner || new DynamicContextPruning();
    this.#tokenJuice = config.tokenJuice || null;
    this.#workspaceIndex = new WorkspaceIndex(this.#config.workingDirectory);

    this.#tokenScope =
      config.tokenScope ||
      new TokenScope({
        budgetLimits: config.tokenBudget
          ? {
              global: {
                limit: config.tokenBudget,
                warningThreshold: config.tokenBudgetWarningThreshold ?? 70,
              },
            }
          : null,
        onBudgetWarning: (info) => {
          this.#debugEvent('Token budget warning', info);
        },
        onBudgetExceeded: (info) => {
          this.#debugEvent('Token budget exceeded - stopping', info);
          this.#stopRequested = true;
        },
      });

    this.#contentStore = new ContentAddressableStore();
    this.#fileAnalyzer = new FileAnalyzer(this.#contentStore);
    this.#workspaceState = new WorkspaceState();

    // 初始化 ConversationSummarizer 并注入到 contextPruner
    // 这使得 token 超限时不丢弃消息，而是将其压缩为语义摘要
    this.#conversationSummarizer =
      config.conversationSummarizer || new ConversationSummarizer(this.#workspaceState);
    if (typeof this.#contextPruner.setSummarizer === 'function') {
      this.#contextPruner.setSummarizer(this.#conversationSummarizer);
    }

    // ---- 初始化子模块 ----
    const sharedDeps = {
      debugEvent: (label, details) => this.#debugEvent(label, details),
      sessionManager: this.#sessionManager,
    };

    // plan 进度回调（由 UI facade 注入，推送 plan 更新到事件总线）
    this.#onPlanAdvance = typeof config.onPlanAdvance === 'function' ? config.onPlanAdvance : null;

    // 生命周期事件回调（由 UI facade 注入）
    this.#onLifecycleEvent =
      typeof config.onLifecycleEvent === 'function' ? config.onLifecycleEvent : null;

    this.#planner = new AgentPlanner({
      ...sharedDeps,
      onPlanAdvance: (progress) => {
        // 1. 内部回调：推送到外部事件总线
        if (this.#onPlanAdvance) {
          this.#onPlanAdvance(progress);
        }
        // 2. UI delegate：实时更新 plan 卡片
        if (typeof this.#ui.planProgress === 'function') {
          this.#ui.planProgress(progress);
        }
      },
    });

    this.#verifier = new AgentVerifier({
      ...sharedDeps,
      toolRegistry: this.#toolRegistry,
      preview: (v, n) => this.#preview(v, n),
    });

    this.#router = new AgentRouter({
      ...sharedDeps,
      toolRegistry: this.#toolRegistry,
      textToolParser: this.#textToolParser,
      ui: this.#ui,
      config: this.#config,
      contentStore: this.#contentStore,
      fileAnalyzer: this.#fileAnalyzer,
      memoryManager: this.#memoryManager,
      modelProvider: this.#modelProvider,
    });

    const observationSummarizer = new ObservationSummarizer(this.#workspaceState);
    this.#agentContext = new AgentContext({
      ...sharedDeps,
      contextPruner: this.#contextPruner,
      workspaceState: this.#workspaceState,
      observationSummarizer,
      workspaceIndex: this.#workspaceIndex,
    });
  }

  // ============================================================
  // 主入口
  // ============================================================

  async run(userInput) {
    // 阶段 1：初始化运行状态
    const { runStartedAt } = this.#initializeRun(userInput);

    // 阶段 2：确保会话已初始化
    this.#ensureSessionInitialized();

    // 阶段 3：意图识别 + 任务分类
    const { intent, taskProfile } = await this.#classifyIntentAndTask(userInput);

    // 阶段 4：准备运行上下文
    const { maxIterations } = await this.#prepareRunContext(userInput, intent, taskProfile);

    // 编码任务增强的本地变量（保持向后兼容）
    let toolUseCorrections = 0;
    let codingGateCorrections = 0;

    // ============================================================
    // 主循环
    // ============================================================
    let iteration = 0;

    iterationLoop: while (iteration < maxIterations) {
      iteration++;

      // 检查中断请求：只有在plan完成或需要用户交互时才允许中断
      if (this.#stopRequested) {
        const planComplete = this.#planner.isCompleted();
        const needsUserInput = this.isWaitingForUserInput;

        if (!planComplete && !needsUserInput) {
          // plan未完成且不需要用户交互，不应该中断
          this.#debugEvent('Stop requested but blocked - plan incomplete', {
            iteration,
            planStatus: this.#planner.activePlan?.status,
            planSummary: this.#planner.activePlan ? this.#summarizePlanStatus() : 'no plan',
          });

          this.#sessionManager.addUserMessage(
            '⚠️ 执行计划未完成，请继续执行当前任务。不要提前给出最终答案。\n' +
              '当前计划状态：\n' +
              this.#summarizePlanStatus(),
          );

          this.#stopRequested = false; // 重置中断标志
          // 继续执行，不中断
        } else {
          // plan已完成或需要用户交互，允许中断
          return this.#completeRun({
            success: false,
            status: 'cancelled',
            answer: '',
            reason: needsUserInput ? 'user_stop_waiting_input' : 'user_stop_plan_complete',
            iterations: iteration,
            startedAt: runStartedAt,
          });
        }
      }

      this.#ui.iteration(iteration, maxIterations);

      // 运行统计：记录 chat start
      this.#runSummaryCollector.recordChatStart();

      // 注入工作区上下文（包含最近的工具结果和文件快照）
      // 工具结果不直接作为消息发出，而是通过 aggregateContext 聚合后注入
      if (this.#workspaceState) {
        const ctx = this.#workspaceState.aggregateContext({
          maxFiles: 6,
          maxCharsPerFile: 500,
          maxTotalChars: 2400,
        });
        if (ctx && ctx.summary && ctx.files.length > 0) {
          this.#sessionManager.addSystemMessage(
            `<!-- workspace-context: files=${ctx.files.join(',')} -->\n${ctx.summary}`,
          );
        }
      }

      // 停滞检测 + 上下文管理
      const planSummary = this.#planner.activePlan
        ? this.#planner.buildPrompt('') // 简化的进度摘要
        : null;
      this.#agentContext.injectStagnationNudge(iteration, maxIterations, planSummary);
      this.#agentContext.manageContextWindow(this.#modelProvider, maxIterations);

      this.#debugEvent('Iteration started', {
        iteration,
        maxIterations,
        sessionMessages: this.#sessionManager.getHistory().length,
        estimatedTokens: this.#sessionManager.getTokenCount(),
      });

      try {
        // 三层执行链（Phase 7）：Plan task → Methodology phase → Tool pool
        // deriveCurrentPhase() 内部已优先使用 currentRunnableTask.phase，
        // 因此 methodology phase 由 Plan task 驱动。
        const currentPhase = this.#planner.deriveCurrentPhase();

        // 同步生命周期阶段（如果有变化则发出 phase_change 事件）
        const mappedPhase = mapPlanPhaseToAgentPhase(currentPhase);
        if (mappedPhase && mappedPhase !== this.#currentPhase) {
          this.#changePhase(mappedPhase, `Plan phase: ${currentPhase}`);
        }

        // ✅ 获取当前可执行任务（用于 task 约束）
        const currentTask = this.#planner.getCurrentRunnableTask();
        const allowedTools = this.#planner.getCurrentAllowedTools();

        const routedTools = selectToolsForRequest(this.#toolRegistry.getAll(), {
          userInput,
          taskProfile: this.#activeTaskProfile,
          intent,
          currentPhase,
          currentTask, // ✅ 传递 currentTask 给工具路由
        });
        this.#activeRoutedToolNames = new Set(routedTools.map((tool) => tool.name));
        const effectiveAllowedTools = allowedTools ? routedTools.map((tool) => tool.name) : null;
        const functions = this.#toolRegistry.toFunctionDefinitions(routedTools);

        // Inject task constraints using the same effective tool set that the
        // executor will enforce, so the model is not told to avoid safe context
        // tools that the plan router intentionally exposes.
        if (currentTask && allowedTools) {
          const taskConstraintPrompt = buildTaskConstraintPrompt(
            currentTask,
            effectiveAllowedTools,
          );
          if (taskConstraintPrompt) {
            this.#sessionManager.addSystemMessage(taskConstraintPrompt);
            this.#debugEvent('Task constraint prompt injected', {
              taskId: currentTask.id,
              taskName: currentTask.name,
              allowedTools: effectiveAllowedTools,
            });
          }
        }

        const routedToolPrompt = [
          this.#textToolParser.generateToolPrompt(routedTools),
          `Workspace: all relative paths resolve from ${this.#config.workingDirectory}. ` +
            `Shell cwd is ${this.#config.workingDirectory}.`,
        ].join('\n\n');
        const messages = withRoutedToolContext(
          this.#sessionManager.getMessages(),
          routedToolPrompt,
          currentPhase,
        );

        // 硬 Token 上限检查：在 LLM 调用前确保不会超出模型上下文窗口
        // 这是防止 context overflow 导致 agent 遗忘任务的最后防线
        // 改进：使用摘要压缩（ConversationSummarizer）替代裁剪丢弃
        const modelMaxContext = this.#modelProvider.getMaxContextTokens?.() || 128000;
        const hardCapRatio = 0.85; // 85% 硬上限
        const estimatedTotalTokens = this.#estimateMessageTokens(messages);
        if (estimatedTotalTokens > modelMaxContext * hardCapRatio) {
          this.#debugEvent('Pre-LLM hard token cap triggered', {
            estimatedTotalTokens,
            modelMaxContext,
            hardCapTokens: Math.floor(modelMaxContext * hardCapRatio),
            messagesBefore: this.#sessionManager.getHistory().length,
          });
          // 使用摘要压缩：将旧消息压缩为语义摘要，保留最近消息完整内容
          const targetTokens = Math.floor(modelMaxContext * 0.6);
          if (this.#contextPruner && typeof this.#contextPruner.compress === 'function') {
            this.#contextPruner.updateConfig?.({
              maxTokens: modelMaxContext,
              targetTokens,
              preserveRecentMessages: 6, // 保留更多最近消息（因为有摘要兜底）
            });
            const stats = this.#sessionManager.compressWithSummarizer(this.#contextPruner, {
              maxTokens: modelMaxContext,
              targetTokens,
              preserveRecentMessages: 6,
            });
            this.#debugEvent('Pre-LLM summary-compress completed', {
              messagesAfter: this.#sessionManager.getHistory().length,
              estimatedTokensAfter: this.#sessionManager.getTokenCount(),
              stats,
            });
          } else {
            // 回退：没有 compress 能力时用旧版裁剪
            this.#sessionManager.trimToContextWindow(targetTokens, {
              minRecentMessages: 4,
            });
            this.#debugEvent('Pre-LLM force-prune (fallback) completed', {
              messagesAfter: this.#sessionManager.getHistory().length,
              estimatedTokensAfter: this.#sessionManager.getTokenCount(),
            });
          }
        }

        // LLM 调用
        const llmStartedAt = Date.now();
        let llmAttempts = 0;
        let llmError = null;
        this.#debugEvent('LLM request', {
          modelProvider: this.#modelProvider.constructor?.name || 'unknown',
          messageCount: messages.length,
          toolDefinitions: functions.length,
          registeredToolDefinitions: this.#toolRegistry.size,
          routedToolNames: functions.map((tool) => tool.name),
          currentPhase,
          maxTokens: this.#config.maxTokens,
          lastUserMessage: this.#preview(
            [...messages].reverse().find((m) => m.role === 'user')?.content || '',
            240,
          ),
        });

        let response;
        try {
          response = await this.#retryStrategy.executeWithRetry(async () => {
            llmAttempts++;
            return withTimeout(
              () =>
                this.#modelProvider.chat(messages, {
                  functions,
                  maxTokens: this.#config.maxTokens,
                }),
              120000,
              'LLM call',
            );
          });
        } catch (error) {
          llmError = error instanceof Error ? error.message : String(error);
          try {
            metricsSink.recordLLMRequest({
              runId: this.#lastRunResult.runId,
              model:
                this.#modelProvider.getModelName?.() ||
                this.#modelProvider.constructor?.name ||
                'unknown',
              durationMs: Date.now() - llmStartedAt,
              success: false,
              error: llmError,
              attempt: llmAttempts,
            });
          } catch (_) {}
          throw error;
        }

        this.#debugEvent('LLM response', {
          durationMs: Date.now() - llmStartedAt,
          attempts: llmAttempts,
          finishReason: response.finishReason,
          textPreview: this.#preview(response.text, 300),
          reasoningPreview: this.#preview(
            response.reasoning?.summary || response.reasoning?.text || '',
            300,
          ),
          nativeToolCalls: response.toolCalls?.length || 0,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          failureReason: llmError,
        });
        try {
          const modelName =
            this.#modelProvider.getModelName?.() ||
            this.#modelProvider.constructor?.name ||
            'unknown';
          metricsSink.recordLLMRequest({
            runId: this.#lastRunResult.runId,
            model: modelName,
            durationMs: Date.now() - llmStartedAt,
            tokensIn: response.usage?.inputTokens,
            tokensOut: response.usage?.outputTokens,
            success: true,
            attempt: llmAttempts,
          });
        } catch (_) {
          /* 打点失败不影响主流程 */
        }

        if (
          response.reasoning?.text ||
          response.reasoning?.summary ||
          response.reasoning?.details?.length
        ) {
          this.#ui.thinking?.({
            iteration,
            maxIterations,
            text: response.reasoning.text || '',
            summary: response.reasoning.summary || '',
            details: response.reasoning.details || [],
            finishReason: response.finishReason,
          });
        }

        // Token 记账
        this.#recordTokenUsage(messages, response);

        this.#debug(`Response: ${response.text.substring(0, 200)}...`);

        // 解析工具调用
        const nativeToolCalls = response.toolCalls || [];
        const parsedToolCalls =
          nativeToolCalls.length === 0 ? this.#textToolParser.parse(response.text) : [];
        const allToolCalls = [...nativeToolCalls, ...parsedToolCalls];

        // ---- 各种退出/纠正判断 ----

        // 工具语法纠正
        // Must run before any provider-stop final shortcut so malformed plan-action
        // protocol gets retried instead of being emitted as the final answer.
        if (
          allToolCalls.length === 0 &&
          response.text?.trim() &&
          toolUseCorrections < 2 &&
          containsUnparsedSyntax(response.text)
        ) {
          toolUseCorrections++;
          this.#debugEvent('Tool syntax correction requested', {
            iteration,
            correction: toolUseCorrections,
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(buildToolSyntaxCorrectionPrompt(response.text));
          continue;
        }

        // Plan 完成 + provider stop + 无工具调用 → 先检查 completion gate
        if (
          allToolCalls.length === 0 &&
          response.finishReason === 'stop' &&
          response.text?.trim() &&
          this.#planner.activePlan?.status === TaskStatus.COMPLETED
        ) {
          // 即使 plan 标记为完成，也要检查是否有真实的验证证据
          const gateForCompletedPlan = this.#verifier.shouldBlockCodingFinal({
            responseText: response.text,
            taskProfile: this.#activeTaskProfile,
            runToolEvents: this.#runToolEvents,
            activePlan: this.#planner.activePlan,
            activePlanManager: this.#planner,
          });
          if (gateForCompletedPlan.block) {
            codingGateCorrections++;
            this.#ui.debugEvent?.('Coding completion gate requested (completed plan)', {
              iteration,
              correction: codingGateCorrections,
              reason: gateForCompletedPlan.reason,
              evidence: gateForCompletedPlan.evidence,
            });
            this.#sessionManager.addAssistantMessage(response.text);
            this.#sessionManager.addUserMessage(
              this.#verifier.buildCodingCompletionGatePrompt(
                userInput,
                gateForCompletedPlan,
                this.#activeTaskProfile,
              ),
            );
            continue;
          }

          const answer = isTerminationResponse(response.text)
            ? extractFinalAnswer(response.text)
            : response.text.trim();
          this.#ui.finalAnswer(answer);
          this.#sessionManager.addAssistantMessage(response.text);
          return this.#completeRun({
            success: true,
            status: 'completed',
            answer,
            reason: 'completed_plan_provider_stop_without_marker',
            iterations: iteration,
            startedAt: runStartedAt,
          });
        }

        // 工具使用纠正（refusal correction）
        if (
          allToolCalls.length === 0 &&
          response.text?.trim() &&
          toolUseCorrections < 2 &&
          shouldCorrectRefusal(userInput, response.text)
        ) {
          toolUseCorrections++;
          this.#debugEvent('Tool use correction requested', {
            iteration,
            correction: toolUseCorrections,
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(buildToolUseCorrectionPrompt(userInput));
          continue;
        }

        // 编码完成门控
        const gateResult =
          allToolCalls.length === 0 && codingGateCorrections < 3
            ? this.#verifier.shouldBlockCodingFinal({
                responseText: response.text,
                taskProfile: this.#activeTaskProfile,
                runToolEvents: this.#runToolEvents,
                activePlan: this.#planner.activePlan,
                activePlanManager: this.#planner,
              })
            : { block: false };

        if (gateResult.block) {
          codingGateCorrections++;
          this.#debugEvent('Coding completion gate requested', {
            iteration,
            correction: codingGateCorrections,
            reason: gateResult.reason,
            evidence: gateResult.evidence,
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
            this.#verifier.buildCodingCompletionGatePrompt(
              userInput,
              gateResult,
              this.#activeTaskProfile,
            ),
          );
          continue;
        }

        // 终止检测
        if (isTerminationResponse(response.text) || this.#isLocalTermination(response.text)) {
          const answer = normalizeFinalAnswer(extractFinalAnswer(response.text));
          this.#debugEvent('Final answer emitted', {
            iteration,
            totalDurationMs: Date.now() - runStartedAt,
            answerPreview: this.#preview(answer, 300),
          });
          this.#ui.finalAnswer(answer);
          this.#sessionManager.addAssistantMessage(response.text);
          return this.#completeRun({
            success: true,
            status: 'completed',
            answer,
            reason: 'final_answer_marker',
            iterations: iteration,
            startedAt: runStartedAt,
          });
        }

        // Provider 自然停止
        const isModificationTask = this.#activeTaskProfile?.isModificationTask;
        // 对于修改任务，必须有真实的验证证据（不只是写了文件）
        const gateForProviderStop = isModificationTask
          ? this.#verifier.shouldBlockCodingFinal({
              responseText: response.text,
              taskProfile: this.#activeTaskProfile,
              runToolEvents: this.#runToolEvents,
              activePlan: this.#planner.activePlan,
              activePlanManager: this.#planner,
            })
          : null;
        const allowProviderStop =
          allToolCalls.length === 0 &&
          response.finishReason === 'stop' &&
          response.text?.trim() &&
          (!isModificationTask || !gateForProviderStop?.block);

        if (allowProviderStop) {
          const answer = normalizeFinalAnswer(response.text);
          this.#ui.finalAnswer(answer);
          this.#sessionManager.addAssistantMessage(response.text);
          return this.#completeRun({
            success: true,
            status: 'completed',
            answer,
            reason: isModificationTask
              ? 'provider_stop_with_tool_evidence'
              : 'provider_stop_without_tool_calls',
            iterations: iteration,
            startedAt: runStartedAt,
          });
        }

        // 修改任务但无工具证据 → nudge 继续
        if (
          isModificationTask &&
          allToolCalls.length === 0 &&
          response.finishReason === 'stop' &&
          response.text?.trim()
        ) {
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
            `This is a coding task and no tool has been executed yet. The engine has pre-computed workspace structure and project memory — use this context directly. ` +
              `To complete this task: (a) read the specific code sections you need to edit, (b) edit existing code with edit_file/apply_hashline_patch or create new files with write_file, (c) verify with shell/verify. ` +
              `Do not finish until you have produced and verified real code changes.`,
          );
          continue;
        }

        // 无工具调用也无终止 → 提示继续
        if (allToolCalls.length === 0) {
          this.#agentContext.recordZeroToolCallIteration();

          // 连续零工具调用 ≥ 5 轮 → 强打断，防止无限分析循环撑爆上下文
          if (this.#agentContext.shouldHardStopForZeroToolCalls()) {
            this.#sessionManager.addAssistantMessage(response.text);
            this.#sessionManager.addUserMessage(
              `[HARD STOP] You have produced ${this.#agentContext.zeroToolCallStreak}+ consecutive responses with ZERO tool calls.\n` +
                `You are stuck in an analysis loop that is consuming context without making progress.\n` +
                `Take one concrete action now: edit if the target is clear, gather the one missing fact with a tool, replan/ask_user if blocked, OR provide FINAL_ANSWER with the actual blocker. ` +
                `Do not output more prose-only analysis.`,
            );
            continue;
          }

          // 探索预算超出 → 强制行动 nudge（比上面更温和，留给一次机会）
          let nudgeMsg = '';
          if (
            this.#agentContext.isExplorationBudgetExceeded() &&
            !this.#agentContext.forceActionTriggered
          ) {
            nudgeMsg = this.#agentContext.triggerForceAction() || '';
          } else if (
            this.#agentContext.forceActionTriggered &&
            this.#agentContext.shouldHardStopForExploration()
          ) {
            nudgeMsg =
              `[TERMINAL] Exploration budget exceeded with ${this.#agentContext.forceActionIgnored} warnings ignored. ` +
              `Provide FINAL_ANSWER or make code changes NOW. This is your last chance.`;
          }

          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
            (nudgeMsg ? nudgeMsg + '\n\n' : '') +
              `No tool call detected in your response. To use a tool, output in one of these formats:\n` +
              `1. CALL tool_name({"param": "value"})\n` +
              `2. \`\`\`tool\n{"name": "tool_name", "arguments": {"param": "value"}}\n\`\`\`\n` +
              `3. <||DSML||tool_calls>\n   <||DSML||invoke name="tool_name">\n   <||DSML||parameter name="param" string="true">value<||DSML||parameter>\n   <||DSML||invoke>\n   <||DSML||tool_calls>\n\n` +
              `If you have reached a final conclusion, respond with "FINAL_ANSWER:" followed by your response.`,
          );
          continue;
        }

        // ---- 工具执行 ----
        if (nativeToolCalls.length > 0) {
          const visibleText = stripActionBlocks(response.text, {
            toolRegistry: this.#toolRegistry,
          });
          if (visibleText) {
            this.#sessionManager.addAssistantMessage(visibleText, nativeToolCalls);
          } else {
            this.#sessionManager.addAssistantMessage(response.text, nativeToolCalls);
          }
          for (const toolCall of nativeToolCalls) {
            const toolStart = Date.now();
            const currentTaskForRouter = this.#planner.getCurrentRunnableTask();
            const toolResult = await this.#router.executeToolCall(toolCall, {
              resultMode: 'tool',
              activeRoutedToolNames: this.#activeRoutedToolNames,
              workspaceState: this.#workspaceState,
              currentTask: currentTaskForRouter,
              activePlanManager: this.#planner,
              activePlan: this.#planner.activePlan,
            });
            this.#recordToolEvent(toolResult, { durationMs: Date.now() - toolStart });
            this.#agentContext.recordToolCallForStagnation(toolResult, iteration, (name, r) =>
              isMutationTool(name, r?.args || {}),
            );
            this.#planner.advance(
              toolResult.name,
              toolResult.result?.args || {},
              toolResult.result,
            );
            // ask_user 智能自答：先尝试 LLM 自行回答，只有无法回答时才挂起等待用户
            if (toolResult.name === 'ask_user' || this.#isUserInputRequest(toolResult?.result)) {
              const autoResult = await this.#tryAutoAnswerAskUser(toolResult.result);
              if (autoResult.autoAnswered) {
                this.#injectAutoAnswerAsObservation(toolResult.result, autoResult.answers);
                continue iterationLoop;
              }
              const suspendResult = await this.#suspendForUserInput(toolResult.result);
              this.#injectUserInputAsObservation(
                toolResult.result,
                suspendResult.userInput || suspendResult,
              );
              continue iterationLoop;
            }
          }
        } else {
          this.#sessionManager.addAssistantMessage(response.text);
        }

        for (const toolCall of parsedToolCalls) {
          const toolStart = Date.now();
          const currentTaskForRouter = this.#planner.getCurrentRunnableTask();
          const toolResult = await this.#router.executeToolCall(toolCall, {
            resultMode: 'observation',
            activeRoutedToolNames: this.#activeRoutedToolNames,
            workspaceState: this.#workspaceState,
            currentTask: currentTaskForRouter,
            activePlanManager: this.#planner,
            activePlan: this.#planner.activePlan,
          });
          this.#recordToolEvent(toolResult, { durationMs: Date.now() - toolStart });
          this.#agentContext.recordToolCallForStagnation(toolResult, iteration, (name, r) =>
            isMutationTool(name, r?.args || {}),
          );

          // 记录工具结果到 WorkspaceState（不直接添加到会话消息）
          // 工具结果将通过 aggregateContext 在下次迭代时注入到会话中
          // cached 结果也需要记录，因为模型可能需要重新消费上次的结果
          if ((!toolResult.skipped || toolResult.cached) && this.#workspaceState) {
            const success = !toolResult.error && !String(toolResult.result).startsWith('Error:');
            this.#workspaceState.recordToolResult(
              toolResult.name,
              toolCall.arguments || {},
              toolResult.result,
              success,
            );
          }

          this.#planner.advance(
            toolResult.name,
            toolCall.arguments || {},
            toolResult.result,
            toolResult,
          );
          // ask_user 智能自答：先尝试 LLM 自行回答，只有无法回答时才挂起等待用户
          if (toolResult.name === 'ask_user' || this.#isUserInputRequest(toolResult?.result)) {
            const autoResult = await this.#tryAutoAnswerAskUser(toolResult.result);
            if (autoResult.autoAnswered) {
              this.#injectAutoAnswerAsObservation(toolResult.result, autoResult.answers);
              continue iterationLoop;
            }
            const suspendResult = await this.#suspendForUserInput(toolResult.result);
            this.#injectUserInputAsObservation(
              toolResult.result,
              suspendResult.userInput || suspendResult,
            );
            continue iterationLoop;
          }
        }

        // ✅ 新增：实现阶段熔断机制
        // 检查是否处于实现阶段，以及是否有代码变更
        const breakerPhase = this.#planner.deriveCurrentPhase();
        if (breakerPhase === 'implementation' || breakerPhase === 'coding') {
          this.#implementationPhaseStarted = true;

          // 检查本轮迭代是否有代码变更工具调用
          const hasMutationInThisIteration =
            nativeToolCalls.some((tc) => isMutationTool(tc.name, tc.arguments || {})) ||
            parsedToolCalls.some((tc) => isMutationTool(tc.name, tc.arguments || {}));

          if (!hasMutationInThisIteration) {
            this.#implementationNoMutationIterations++;
            this.#debugEvent('Implementation phase - no mutation iteration', {
              iteration,
              noMutationCount: this.#implementationNoMutationIterations,
              phase: breakerPhase,
              toolCallCount: allToolCalls.length,
            });

            // 熔断阈值：连续 2 次没有代码变更就强制行动
            if (this.#implementationNoMutationIterations >= 2) {
              this.#debugEvent('Implementation phase - activating forced action breaker', {
                iteration,
                noMutationCount: this.#implementationNoMutationIterations,
                forceWriteToolOnly: true,
              });

              // Nudge the model out of analysis drift without forcing a blind
              // mutation. If evidence is insufficient, the professional action
              // is to gather the missing fact, replan, or ask the user.
              const forceActionPrompt =
                `\n[IMPLEMENTATION PROGRESS CHECK]\n` +
                `You are in IMPLEMENTATION phase and have NOT made any code changes in the last ${this.#implementationNoMutationIterations} iteration(s).\n` +
                `Choose the next concrete step based on evidence:\n` +
                `- If the target and intended change are clear, apply the smallest scoped edit now.\n` +
                `- If a required fact is missing, gather that single fact with a focused read/search.\n` +
                `- If the plan is wrong or blocked, call change_plan or ask_user with the missing decision.\n` +
                `Do not create report files or keep repeating broad analysis.`;

              this.#sessionManager.addUserMessage(forceActionPrompt);

              // 重置计数器以防止重复触发
              this.#implementationNoMutationIterations = 0;

              // 注册下一轮的工具约束检查（在下一轮迭代开始时）
              // 这将通过 selectToolsForRequest 中的 currentPhase 约束来实现
            }
          } else {
            // 有代码变更，重置计数器
            this.#implementationNoMutationIterations = 0;
          }
        } else if (this.#implementationPhaseStarted) {
          // 从实现阶段退出，重置追踪
          this.#implementationNoMutationIterations = 0;
          this.#implementationPhaseStarted = false;
        }
      } catch (error) {
        const agentError = classifyError(error);
        this.#debugEvent('Iteration error', {
          iteration,
          category: agentError.category,
          severity: agentError.severity,
          retryable: agentError.retryable,
          message: agentError.message,
        });
        this.#ui.error(`Iteration ${iteration} error: ${agentError.message}`);

        if (agentError.severity === 'fatal') {
          this.#ui.error('Fatal error. Stopping agent.');
          return this.#completeRun({
            success: false,
            status: 'failed',
            answer: '',
            reason: 'fatal_error',
            iterations: iteration,
            startedAt: runStartedAt,
            error: agentError.message,
          });
        }
        this.#sessionManager.addUserMessage(
          `Error occurred: ${agentError.message}. Please try a different approach or call a different tool.`,
        );
      }
    }

    this.#ui.warn(`Reached maximum iterations (${maxIterations}). Stopping.`);
    this.#ui.info('The task may not be fully completed. Consider breaking it into smaller steps.');
    return this.#completeRun({
      success: false,
      status: 'max_iterations',
      answer: '',
      reason: 'max_iterations',
      iterations: maxIterations,
      startedAt: runStartedAt,
    });
  }

  stop() {
    this.#stopRequested = true;
    this.#debugEvent('Stop requested', { at: new Date().toISOString() });
  }

  clearSession(clearWorkspace = false) {
    this.#sessionManager.clear();
    this.#lastResponse = '';
    this.#repeatCount = 0;
    this.#router.reset();
    if (clearWorkspace && this.#workspaceState) {
      this.#workspaceState.clear();
    }
    this.#ui.info?.('Session cleared. Memory preserved.');
  }

  getTools() {
    return this.#toolRegistry;
  }

  setModelProvider(modelProvider, options = {}) {
    this.#modelProvider = modelProvider;
    if (options.model) {
      this.#sessionManager.setTokenizerModel(options.model);
    }
  }

  setDebugMode(enabled) {
    this.#config.debug = Boolean(enabled);
    if (typeof this.#ui.setDebugMode === 'function') {
      this.#ui.setDebugMode(enabled);
    }
  }

  get memoryManager() {
    return this.#memoryManager;
  }
  get sessionManager() {
    return this.#sessionManager;
  }
  get workspaceState() {
    return this.#workspaceState;
  }
  get intentClassifier() {
    return this.#intentClassifier;
  }

  getWorkspaceSummary() {
    if (!this.#workspaceState) {
      return null;
    }
    const observationSummarizer = new ObservationSummarizer(this.#workspaceState);
    return {
      state: this.#workspaceState.getSummary(),
      criticalFacts: this.#workspaceState
        .getCriticalFacts()
        .map((f) => ({ type: f.type, value: f.value })),
      workspaceDescription: observationSummarizer.generateWorkspaceDescription() || '',
    };
  }

  getLastRunResult() {
    return this.#lastRunResult ? { ...this.#lastRunResult } : null;
  }

  dispose() {
    this.#modelProvider.dispose?.();
  }

  /**
   * 设置外部创建的 plan（由 GraphPlanner 创建）
   * @param {ExecutionPlan} plan - 外部创建的执行计划
   */
  setPlan(plan) {
    this.#planner.setPlan(plan);
  }

  /**
   * 动态修改当前执行计划。
   * @param {{mode?: string, tasks?: Array, targetTaskId?: string, reason?: string}} change
   */
  changePlan(change) {
    return this.#planner.changePlan(change);
  }

  /**
   * 获取内部 planner 实例（用于测试和高级操作）
   * @returns {AgentPlanner}
   */
  get planner() {
    return this.#planner;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 阶段 1：初始化运行状态
   * 生成 runId、重置运行状态、记录开始事件
   *
   * @param {string} userInput
   * @returns {{ runStartedAt: number, runId: string }}
   */
  #initializeRun(userInput) {
    const runStartedAt = Date.now();
    const runId = `run-${runStartedAt}-${Math.random().toString(36).slice(2, 8)}`;
    metricsSink.startRun(runId);

    // 重置运行统计收集器
    this.#runSummaryCollector.reset();
    this.#currentPhase = AgentPhase.INITIALIZING;

    this.#stopRequested = false;
    this.#lastRunResult = {
      success: false,
      status: 'running',
      answer: '',
      reason: null,
      iterations: 0,
      durationMs: 0,
      toolEvents: [],
      runId,
    };
    this.#debugEvent('Agent run started', {
      runId,
      inputPreview: this.#preview(userInput, 240),
      workingDirectory: this.#config.workingDirectory,
      maxIterations: this.#config.maxIterations,
    });

    // 发出生命周期事件：agent_start
    this.#emitLifecycle(
      createAgentStartEvent({
        runId,
        inputPreview: this.#preview(userInput, 240),
        workingDirectory: this.#config.workingDirectory,
        maxIterations: this.#config.maxIterations,
      }),
    );

    return { runStartedAt, runId };
  }

  /**
   * 阶段 2：确保会话已初始化（首次运行时设置 system prompt）
   */
  #ensureSessionInitialized() {
    if (this.#sessionManager.length > 0) return;

    const systemPrompt = buildSystemPrompt(
      this.#memoryManager,
      this.#toolRegistry,
      this.#config.workingDirectory,
    );
    this.#sessionManager.setSystemPrompt(systemPrompt);
    const toolInstructions = this.#textToolParser.generateToolPrompt([]);
    this.#sessionManager.addSystemMessage(toolInstructions);
    this.#debugEvent('Session initialized', {
      toolCount: this.#toolRegistry.size,
      systemPromptChars: systemPrompt.length,
      toolInstructionChars: toolInstructions.length,
    });
  }

  /**
   * 阶段 3：意图识别 + 任务分类
   *
   * @param {string} userInput
   * @returns {{ intent: object|null, taskProfile: object }}
   */
  async #classifyIntentAndTask(userInput) {
    // Step 1: 意图识别
    const intent =
      this.#intentClassifier && shouldUseIntentClassifier(userInput)
        ? await this.#intentClassifier.classify(userInput, {
            recentMessages: this.#sessionManager.getRecentExchanges(3),
          })
        : null;

    if (this.#intentClassifier && !intent) {
      this.#debugEvent('Intent classifier skipped', { reason: 'local_task_router' });
    }
    if (intent) {
      this.#debugEvent('Intent classified', {
        intent: intent.intent,
        confidence: intent.confidence,
        normalizedTask: intent.normalizedTask,
        requiresFreshData: intent.requiresFreshData,
        recommendedTools: intent.recommendedTools,
        firstActionHint: intent.firstActionHint,
      });
    }

    // Step 2: 任务分类
    const taskProfile = this.#intentClassifier?.classifyTask(userInput, intent) || {
      isCodingTask: false,
      isModificationTask: false,
      riskLevel: 'low',
      semanticRiskDomains: [],
      requiresSemanticRiskReview: false,
    };

    return { intent, taskProfile };
  }

  /**
   * 阶段 4：准备运行上下文
   * 包括：添加用户消息、设置 task anchor、注入路由提示、工作区上下文、重置运行态
   *
   * @param {string} userInput
   * @param {object} intent
   * @param {object} taskProfile
   * @returns {{ executionPlan: object|null, maxIterations: number }}
   */
  async #prepareRunContext(userInput, intent, taskProfile) {
    // 添加用户消息
    this.#sessionManager.addUserMessage(userInput);

    // 任务锚点：防止 context window overflow 导致 agent 忘记原始任务
    const taskAnchor =
      `[TASK ANCHOR — original user request, never forget this]\n` +
      `The user's original task is: ${typeof userInput === 'string' ? userInput.substring(0, 800) : String(userInput).substring(0, 800)}\n` +
      `This is the primary objective. All actions must directly serve this goal. ` +
      `Periodically re-evaluate whether current actions are progressing toward this objective.`;
    this.#sessionManager.addLayer('layer_task_anchor', taskAnchor, {
      priority: SessionManager.LAYER.MEMORY + 1,
    });

    // 路由提示
    const routingPrompt = this.#intentClassifier?.buildRoutingPrompt(intent);
    if (routingPrompt) {
      this.#sessionManager.addUserMessage(routingPrompt);
    }

    // 注入多文件上下文聚合
    if (this.#workspaceState) {
      const ctx = this.#workspaceState.aggregateContext({
        maxFiles: 6,
        maxCharsPerFile: 500,
        maxTotalChars: 2400,
      });
      if (ctx && ctx.summary && ctx.files.length > 0) {
        this.#sessionManager.addSystemMessage(
          `<!-- workspace-context: files=${ctx.files.join(',')} -->\n${ctx.summary}`,
        );
        this.#debugEvent('Workspace context injected', {
          files: ctx.files,
          totalChars: ctx.totalChars,
        });
      }
    }

    // 重置运行态
    this.#lastResponse = '';
    this.#repeatCount = 0;
    this.#runToolEvents = [];
    this.#activeTaskProfile = taskProfile;
    this.#activeRoutedToolNames = null;
    this.#stagnationBudgetDowngrade = false;
    this.#implementationNoMutationIterations = 0;
    this.#implementationPhaseStarted = false;

    this.#planner.reset({ preserveExternalPlan: true });
    this.#router.reset();
    this.#agentContext.reset();

    // Step 4: 执行计划
    const executionPlan = await this.#planner.createIfNeeded(userInput, taskProfile);
    const maxIterations = this.#verifier.computeIterationBudget(
      taskProfile,
      this.#config.maxIterations,
    );

    // 编码任务增强
    if (taskProfile.isCodingTask) {
      this.#debugEvent('Coding task mode enabled', taskProfile);
      const basePrompt = this.#verifier.buildCodingTaskOperatingPrompt(userInput, taskProfile);
      const strategy = await this.#verifier.suggestVerificationStrategy(
        userInput,
        this.#config.workingDirectory,
      );
      this.#sessionManager.addUserMessage(`${basePrompt}\n\nVerification strategy:\n${strategy}`);
    }

    if (executionPlan) {
      this.#debugEvent('Automatic task orchestration enabled', { plan: executionPlan.toJSON() });
      const semanticGuidance = this.#verifier.buildSemanticRiskGuidance(taskProfile);
      this.#sessionManager.addUserMessage(this.#planner.buildPrompt(userInput, semanticGuidance));
      this.#changePhase(AgentPhase.PLANNING, 'Task plan created');
    }

    // 异步预热工作目录索引
    if (this.#workspaceIndex && taskProfile.isCodingTask) {
      this.#injectPreExploredContextSync(userInput, taskProfile);

      this.#agentContext
        .warmWorkspaceCache()
        .then((summary) => {
          if (summary && this.#sessionManager) {
            this.#sessionManager.addUserMessage(summary);
            try {
              this.#debugEvent('Workspace index warmed', {
                files: this.#workspaceIndex.size,
                summaryChars: summary.length,
              });
            } catch {}
          }
        })
        .catch((err) => {
          try {
            this.#debugEvent('Workspace index warm failed', { error: err.message });
          } catch {}
        });
      this.#workspaceIndex.startPeriodicSync();
    }

    return { executionPlan, maxIterations };
  }

  /**
   * 阶段 5：单次迭代的 LLM 调用准备
   * 构建消息、工具路由、token 检查
   *
   * @param {string} userInput
   * @param {object} intent
   * @param {number} iteration
   * @param {number} maxIterations
   * @returns {{ messages: Array, functions: Array, currentPhase: string, currentTask: object|null }}
   */
  #prepareIteration(userInput, intent, iteration, maxIterations) {
    // 注入工作区上下文
    if (this.#workspaceState) {
      const ctx = this.#workspaceState.aggregateContext({
        maxFiles: 6,
        maxCharsPerFile: 500,
        maxTotalChars: 2400,
      });
      if (ctx && ctx.summary && ctx.files.length > 0) {
        this.#sessionManager.addSystemMessage(
          `<!-- workspace-context: files=${ctx.files.join(',')} -->\n${ctx.summary}`,
        );
      }
    }

    // 停滞检测 + 上下文管理
    const planSummary = this.#planner.activePlan ? this.#planner.buildPrompt('') : null;
    this.#agentContext.injectStagnationNudge(iteration, maxIterations, planSummary);
    this.#agentContext.manageContextWindow(this.#modelProvider, maxIterations);

    this.#debugEvent('Iteration started', {
      iteration,
      maxIterations,
      sessionMessages: this.#sessionManager.getHistory().length,
      estimatedTokens: this.#sessionManager.getTokenCount(),
    });

    // 三层执行链：Plan task → Methodology phase → Tool pool
    const currentPhase = this.#planner.deriveCurrentPhase();
    const currentTask = this.#planner.getCurrentRunnableTask();
    const allowedTools = this.#planner.getCurrentAllowedTools();

    const routedTools = selectToolsForRequest(this.#toolRegistry.getAll(), {
      userInput,
      taskProfile: this.#activeTaskProfile,
      intent,
      currentPhase,
      currentTask,
    });
    this.#activeRoutedToolNames = new Set(routedTools.map((tool) => tool.name));
    const effectiveAllowedTools = allowedTools ? routedTools.map((tool) => tool.name) : null;
    const functions = this.#toolRegistry.toFunctionDefinitions(routedTools);

    // 注入任务约束
    if (currentTask && allowedTools) {
      const taskConstraintPrompt = buildTaskConstraintPrompt(currentTask, effectiveAllowedTools);
      if (taskConstraintPrompt) {
        this.#sessionManager.addSystemMessage(taskConstraintPrompt);
        this.#debugEvent('Task constraint prompt injected', {
          taskId: currentTask.id,
          taskName: currentTask.name,
          allowedTools: effectiveAllowedTools,
        });
      }
    }

    const routedToolPrompt = [
      this.#textToolParser.generateToolPrompt(routedTools),
      `Workspace: all relative paths resolve from ${this.#config.workingDirectory}. ` +
        `Shell cwd is ${this.#config.workingDirectory}.`,
    ].join('\n\n');
    const messages = withRoutedToolContext(
      this.#sessionManager.getMessages(),
      routedToolPrompt,
      currentPhase,
    );

    // 硬 Token 上限检查
    const modelMaxContext = this.#modelProvider.getMaxContextTokens?.() || 128000;
    const hardCapRatio = 0.85;
    const estimatedTotalTokens = this.#estimateMessageTokens(messages);
    if (estimatedTotalTokens > modelMaxContext * hardCapRatio) {
      this.#debugEvent('Pre-LLM hard token cap triggered', {
        estimatedTotalTokens,
        modelMaxContext,
        hardCapTokens: Math.floor(modelMaxContext * hardCapRatio),
        messagesBefore: this.#sessionManager.getHistory().length,
      });
      const targetTokens = Math.floor(modelMaxContext * 0.6);
      if (this.#contextPruner && typeof this.#contextPruner.compress === 'function') {
        this.#contextPruner.updateConfig?.({
          maxTokens: modelMaxContext,
          targetTokens,
          preserveRecentMessages: 6,
        });
        const stats = this.#sessionManager.compressWithSummarizer(this.#contextPruner, {
          maxTokens: modelMaxContext,
          targetTokens,
          preserveRecentMessages: 6,
        });
        this.#debugEvent('Pre-LLM summary-compress completed', {
          messagesAfter: this.#sessionManager.getHistory().length,
          estimatedTokensAfter: this.#sessionManager.getTokenCount(),
          stats,
        });
      } else {
        this.#sessionManager.trimToContextWindow(targetTokens, {
          minRecentMessages: 4,
        });
        this.#debugEvent('Pre-LLM force-prune (fallback) completed', {
          messagesAfter: this.#sessionManager.getHistory().length,
          estimatedTokensAfter: this.#sessionManager.getTokenCount(),
        });
      }
    }

    return { messages, functions, currentPhase, currentTask };
  }

  /**
   * 同步注入预探索上下文：利用 WorkspaceIndex + AgentMemory 数据，
   * 在首轮迭代前注入项目结构和记忆上下文，消除 agent 的探索阶段。
   * 使用 SessionManager 分层 API，支持运行时刷新。
   */
  #injectPreExploredContextSync(userInput, _taskProfile) {
    try {
      // 1. 工作区结构 → layer1_structure
      const wsSummary = this.#workspaceIndex?.getSummary?.();
      if (wsSummary && wsSummary.length > 0) {
        this.#sessionManager.addLayer(
          'layer1_structure',
          `[WORKSPACE STRUCTURE — pre-indexed]\n${wsSummary}`,
          { priority: SessionManager.LAYER.STRUCTURE },
        );
      }
    } catch {
      /* 索引未就绪，跳过 */
    }

    try {
      // 2. 项目记忆 → layer4_memory
      if (this.#memoryManager) {
        const memCtx =
          typeof this.#memoryManager.getBudgetedMemoryContext === 'function'
            ? this.#memoryManager.getBudgetedMemoryContext({
                currentTask: typeof userInput === 'string' ? userInput.substring(0, 300) : '',
                maxTokens: 800,
                tokensPerChar: 0.25,
              })
            : '';
        if (memCtx && memCtx.trim()) {
          this.#sessionManager.addLayer(
            'layer4_memory',
            `[PROJECT MEMORY — git-aware]\n${memCtx}`,
            { priority: SessionManager.LAYER.MEMORY },
          );
        }
      }
    } catch {
      /* 记忆不可用 */
    }

    this.#debugEvent('Pre-explored context injected (sync, layered)', {
      hasWorkspace: Boolean(this.#workspaceIndex),
      hasMemory: Boolean(this.#memoryManager),
    });
  }

  #completeRun({
    success,
    status,
    answer,
    reason,
    iterations,
    startedAt,
    error,
    userInputRequest,
  }) {
    this.#workspaceIndex?.stopPeriodicSync();
    const durationMs = Date.now() - startedAt;
    const toolEvents = this.#runToolEvents.map((e) => ({ ...e }));
    const result = {
      success,
      status,
      answer,
      reason,
      iterations,
      durationMs,
      toolEvents,
    };
    if (error) {
      result.error = error;
    }
    if (userInputRequest) {
      result.userInputRequest = userInputRequest;
    }
    this.#lastRunResult = result;

    // 切换到结束阶段
    if (success) {
      this.#changePhase(AgentPhase.FINISHED, 'Task completed successfully');
    } else {
      this.#changePhase(AgentPhase.FINISHED, `Task ${status}: ${reason || ''}`);
    }

    // 构建运行统计汇总
    const summary = this.#runSummaryCollector.markRunEnded(durationMs);
    result.summary = summary;

    // 发出生命周期事件：agent_end
    this.#emitLifecycle(
      createAgentEndEvent({
        runId: this.#lastRunResult.runId,
        success,
        status,
        answer,
        reason,
        iterations,
        durationMs,
        summary,
      }),
    );

    try {
      metricsSink.finishRun(this.#lastRunResult?.runId, {
        success,
        iterations,
        durationMs,
        reason: error ? String(error) : reason,
        toolCount: toolEvents.length,
      });
    } catch (_) {
      /* 忽略 */
    }

    return result;
  }

  /** 快速估算消息列表的 token 数。CJK 字符 ×2，其他字符 /3.5 */
  #estimateMessageTokens(messages) {
    if (!Array.isArray(messages)) {
      return 0;
    }
    let total = 0;
    for (const msg of messages) {
      const content =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      const cjkCount = (content.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
      const otherCount = content.length - cjkCount;
      total += Math.ceil(cjkCount * 2.0 + otherCount / 3.5);
      if (msg.toolCalls || msg.tool_calls) {
        const calls = msg.toolCalls || msg.tool_calls || [];
        for (const call of calls) {
          total += 10; // function name overhead
          const args =
            typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments || '');
          total += Math.ceil(args.length / 4);
        }
      }
    }
    return total;
  }

  /** 总结当前plan的状态 */
  #summarizePlanStatus() {
    if (!this.#planner.activePlan) {
      return 'No active plan';
    }

    const plan = this.#planner.activePlan;
    const tasks = Array.from(plan.tasks.values());
    const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    const running = tasks.filter((t) => t.status === TaskStatus.RUNNING).length;
    const pending = tasks.filter((t) => t.status === TaskStatus.PENDING).length;
    const blocked = tasks.filter((t) => t.status === TaskStatus.BLOCKED).length;

    return (
      `Plan status: ${plan.status}\n` +
      `Tasks: ${tasks.length} total, ${completed} completed, ${running} running, ${pending} pending, ${blocked} blocked\n` +
      `Task details:\n` +
      tasks.map((t) => `  - ${t.id}: ${t.status} - ${t.name}`).join('\n')
    );
  }

  #recordTokenUsage(messages, response) {
    try {
      const modelName =
        this.#modelProvider.getModelName?.() || this.#modelProvider.constructor?.name || 'unknown';
      let inputTokens, outputTokens;
      if (response.usage && response.usage.inputTokens != null) {
        inputTokens = response.usage.inputTokens;
        outputTokens = response.usage.outputTokens || Math.ceil((response.text || '').length / 4);
      } else {
        let inputChars = 0;
        for (const msg of messages) {
          inputChars += (
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')
          ).length;
        }
        inputTokens = Math.ceil(inputChars / 4);
        outputTokens = Math.ceil((response.text || '').length / 4);
      }
      this.#tokenScope.recordRequest({
        model: modelName,
        inputTokens,
        outputTokens,
        userId: 'global',
        metadata: { source: 'agent-run', iteration: this.#lastRunResult?.iterations || 0 },
      });
    } catch {
      /* best-effort */
    }
  }

  #recordToolEvent(toolResult, { durationMs = null } = {}) {
    if (!toolResult?.name) {
      return;
    }
    const payload = {
      name: toolResult.name,
      args: toolResult.args || {},
      success: !toolResult.error && !toolResult.skipped,
      resultPreview: this.#preview(
        typeof toolResult.result === 'string'
          ? toolResult.result
          : JSON.stringify(toolResult.result || ''),
        300,
      ),
    };
    if (typeof durationMs === 'number') {
      payload.durationMs = durationMs;
    }
    if (toolResult.error) {
      payload.error = String(toolResult.error).substring(0, 300);
    }
    this.#runToolEvents.push(payload);

    // —— 同步到 metrics sink ——
    try {
      metricsSink.recordToolCall({
        runId: this.#lastRunResult?.runId,
        toolName: toolResult.name,
        durationMs: typeof durationMs === 'number' ? durationMs : null,
        success: payload.success,
        error: toolResult.error ? String(toolResult.error) : null,
        predicted: !!toolResult.predicted,
        skipped: !!toolResult.skipped,
      });
    } catch (_) {
      /* 忽略 */
    }
  }

  #isLocalTermination(response) {
    if (this.#lastResponse === response) {
      this.#repeatCount++;
      if (this.#repeatCount >= 3) {
        this.#ui.warn?.('Detected repeated response loop. Terminating.');
        return true;
      }
    } else {
      this.#repeatCount = 0;
    }
    this.#lastResponse = response;
    return false;
  }

  #isUserInputRequest(result) {
    if (!result) {
      return false;
    }
    if (typeof result === 'object') {
      return (
        result.requiresUserInput === true ||
        result.type === 'user_input_required' ||
        result.result === 'needs_user_input'
      );
    }
    return result === 'needs_user_input';
  }

  /**
   * 智能自问自答：在被 ask_user 中断之前，先让 LLM 尝试自行回答。
   * 只有 LLM 明确表示"无法回答"（需要用户偏好/凭据/业务规则等），
   * 才返回 autoAnswered: false 触发真正的用户中断。
   */
  async #tryAutoAnswerAskUser(askResult) {
    const questions = Array.isArray(askResult.questions) ? askResult.questions : [];
    if (questions.length === 0) {
      return { autoAnswered: false };
    }

    const reason = askResult.reason || '';
    const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    // 取最近一条用户消息作为最小任务上下文
    const history = this.#sessionManager.getHistory?.() || [];
    const lastUserMsg =
      [...history]
        .reverse()
        .find((m) => m.role === 'user')
        ?.content?.slice(0, 600) || '';

    const prompt = [
      {
        role: 'user',
        content:
          `Task context: ${lastUserMsg || '(no prior context)'}\n\n` +
          `You want to ask the user these questions because: ${reason}\n\n` +
          `Questions:\n${questionList}\n\n` +
          `Before actually interrupting the user, try answering these yourself. ` +
          `Use your knowledge, reasoning, and the task context above to provide the best answers.\n\n` +
          `For each question, respond with exactly one of:\n` +
          `- "ANSWER: <your answer>" if you can provide a reasonable answer\n` +
          `- "NEEDS_USER: <reason>" if you genuinely cannot answer ` +
          `(only for user preferences, credentials, org-specific business rules, or truly ambiguous requirements)\n\n` +
          `End your response with a single line containing either "ALL_ANSWERED" or "NEEDS_USER_INPUT".`,
      },
    ];

    try {
      const response = await withTimeout(
        () => this.#modelProvider.chat(prompt, { maxTokens: 1000 }),
        30000,
        'Auto-answer attempt',
      );

      const text = response.text || '';

      // 有 NEEDS_USER_INPUT 标记 → 无法自答，回退到真实用户中断
      if (/\bNEEDS_USER_INPUT\b/i.test(text)) {
        this.#debugEvent('Auto-answer: LLM cannot answer, will ask user', {
          questions,
        });
        return { autoAnswered: false };
      }

      // 提取 ANSWER: 行
      const answerLines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^ANSWER:\s*/.test(l))
        .map((l) => l.replace(/^ANSWER:\s*/, '').trim());

      if (answerLines.length > 0) {
        this.#debugEvent('Auto-answer: LLM self-answered', {
          questionCount: questions.length,
          answerCount: answerLines.length,
        });
        return { autoAnswered: true, answers: answerLines };
      }

      // 有内容但没匹配到 ANSWER: 格式 → 整段当答案
      const cleaned = text.trim();
      if (cleaned && !/NEEDS_USER/i.test(cleaned)) {
        return { autoAnswered: true, answers: [cleaned] };
      }

      return { autoAnswered: false };
    } catch (error) {
      this.#debugEvent('Auto-answer attempt failed, falling back to user', {
        error: error.message,
      });
      return { autoAnswered: false };
    }
  }

  /**
   * 将 LLM 自答结果注入为 Observation，避免中断用户。
   */
  #injectAutoAnswerAsObservation(askResult, answers) {
    const questions = Array.isArray(askResult.questions) ? askResult.questions : [];
    const questionText = questions.map((q, i) => `${i + 1}. ${q}`).join('; ');
    const answerText = Array.isArray(answers) ? answers.join('\n') : String(answers);
    this.#sessionManager.addUserMessage(
      `[Self-answered ask_user — no user interruption needed]\n` +
        `Questions: ${questionText}\n\n` +
        `Intelligent answers (reasoned by LLM):\n${answerText}\n\n` +
        `Continue with the task incorporating these answers. Do not ask the same questions again.`,
    );
  }

  /**
   * 挂起 agent 循环，等待用户输入（替代原来的硬中断 return）
   * 通过 Promise 机制，不退出循环，不丢失任何内部状态
   */
  async #suspendForUserInput(askResult) {
    const normalizedAskResult = this.#normalizeAskUserResult(askResult);
    const reason = normalizedAskResult.reason || '需要用户补充信息';
    const questions = normalizedAskResult.questions;
    const answer = normalizedAskResult.answer || this.#formatAskUserPrompt({ reason, questions });

    // 存储待处理的用户输入请求，供外部（如 session-state）获取
    this.#pendingUserInputRequest = {
      requiresUserInput: true,
      reason,
      questions,
      blockingFacts: normalizedAskResult.blockingFacts || [],
      suggestions: normalizedAskResult.suggestions || [],
      answer,
    };

    this.#debugEvent('User input requested (suspended)', {
      reason,
      questions,
    });

    // 通过 UI delegate 通知外层：agent 已挂起，等待用户输入
    if (typeof this.#ui.waitingForUserInput === 'function') {
      this.#ui.waitingForUserInput({
        reason,
        questions,
        blockingFacts: normalizedAskResult.blockingFacts || [],
        suggestions: normalizedAskResult.suggestions || [],
        answer,
      });
    }

    // Promise 挂起：resolve 时返回用户输入
    // 返回一个特殊的 Promise，resolve 时返回一个标志让调用者知道需要用户输入
    const userInput = await new Promise((resolve) => {
      this.#userInputResolve = resolve;
    });

    this.#debugEvent('User input received (resumed)', {
      userInput: this.#preview(userInput, 200),
    });

    // 清除挂起状态
    this.#pendingUserInputRequest = null;

    return { userInput, askResult: normalizedAskResult };
  }

  /**
   * 完成用户输入请求，返回 needs_user_input 状态供外部处理
   */
  #completeUserInputRequest(askResult, { iteration, startedAt }) {
    const normalizedAskResult = this.#normalizeAskUserResult(askResult);
    const answer =
      normalizedAskResult.answer || this.#formatUserInputRequestAnswer(normalizedAskResult);
    this.#debugEvent('User input requested', {
      reason: normalizedAskResult.reason,
      questions: normalizedAskResult.questions || [],
    });
    this.#ui.finalAnswer(answer);
    this.#sessionManager.addAssistantMessage(`FINAL_ANSWER: ${answer}`);
    return this.#completeRun({
      success: true,
      status: 'needs_user_input',
      answer,
      reason: normalizedAskResult.reason,
      iterations: iteration,
      startedAt,
      userInputRequest: normalizedAskResult,
    });
  }

  #formatUserInputRequestAnswer(result) {
    const normalized = this.#normalizeAskUserResult(result);
    const questions = normalized.questions;
    return [
      '需要你补充一点信息后我才能继续。',
      normalized.reason ? `原因：${normalized.reason}` : '',
      questions.length > 0
        ? `请回答：\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  #normalizeAskUserResult(result) {
    let value = result;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        value = { reason: value };
      }
    }
    if (!value || typeof value !== 'object') {
      value = {};
    }
    return {
      ...value,
      questions: Array.isArray(value.questions)
        ? value.questions.map((question) => String(question || '').trim()).filter(Boolean)
        : [],
      blockingFacts: value.blockingFacts || value.blocking_facts || [],
      suggestions: value.suggestions || [],
    };
  }

  /** 将用户回答作为 Observation 注入到会话中，LLM 在下一轮迭代自然继续 */
  #injectUserInputAsObservation(askResult, userInput) {
    const questions = Array.isArray(askResult.questions) ? askResult.questions : [];
    const questionText =
      questions.length > 0 ? questions.map((q, i) => `${i + 1}. ${q}`).join('; ') : '请补充信息';
    this.#sessionManager.addUserMessage(
      `[User response to ask_user] Questions: ${questionText}\nAnswer: ${userInput}\n\n` +
        `Continue with the task incorporating the user's answer. Do not ask the same question again.`,
    );
  }

  /**
   * 外部调用：用户提供了 ask_user 的回答后，恢复 agent 循环
   * 由 session-state.js 的 continueUserInput 调用
   */
  resumeWithUserInput(userInput) {
    if (!this.#userInputResolve) {
      throw new Error('Agent is not waiting for user input');
    }
    this.#userInputResolve(userInput);
    this.#userInputResolve = null;
    this.#pendingUserInputRequest = null;
  }

  /** 检查 agent 是否正在等待用户输入 */
  get isWaitingForUserInput() {
    return this.#userInputResolve !== null;
  }

  /** 获取当前待处理的用户输入请求 */
  get pendingUserInputRequest() {
    return this.#pendingUserInputRequest;
  }

  #formatAskUserPrompt({ reason, questions }) {
    const lines = ['需要你补充一点信息后我才能继续。', '', `原因：${reason}`];
    if (questions.length > 0) {
      lines.push('', '请回答：');
      questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    }
    return lines.join('\n');
  }

  #debug(message) {
    if (typeof this.#ui.debug === 'function') {
      this.#ui.debug(message);
    }
  }

  #debugEvent(label, details = {}) {
    if (typeof this.#ui.debugEvent === 'function') {
      this.#ui.debugEvent(label, details);
      return;
    }
    if (this.#config.debug === true || process.env.DEBUG === 'true') {
      this.#ui.debug?.(`${label}: ${JSON.stringify(details)}`);
    }
  }

  /**
   * 发出生命周期事件
   * @param {object} event - 生命周期事件对象
   * @private
   */
  #emitLifecycle(event) {
    if (this.#onLifecycleEvent) {
      try {
        this.#onLifecycleEvent(event);
      } catch (err) {
        this.#debugEvent('Lifecycle event handler error', { error: err.message });
      }
    }
  }

  /**
   * 切换当前阶段并发出 phase_change 事件
   * @param {string} phase - AgentPhase 常量
   * @param {string} [detail] - 详细描述
   * @private
   */
  #changePhase(phase, detail = '') {
    if (this.#currentPhase === phase) return;
    this.#currentPhase = phase;
    this.#runSummaryCollector.recordPhaseChange(phase);
    this.#emitLifecycle(createPhaseChangeEvent({ phase, detail }));
    this.#debugEvent('Phase changed', { phase, detail });
  }

  #preview(value, maxLength = 200) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }
}
