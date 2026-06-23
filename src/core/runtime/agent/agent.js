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

import { SessionManager } from '../../session-manager.js';
import { buildSystemPrompt } from '../../../prompts/system-prompt.js';
import { classifyError, RetryStrategy, withTimeout } from '../../../errors/error-handler.js';
import { ui } from '../../../cli/ui.js';
import { TextToolParser } from '../../text-tool-parser.js';
import { IntentClassifier } from '../../intent-classifier.js';
import { DynamicContextPruning } from '../../dynamic-context-pruning.js';
import { WorkspaceIndex } from '../../workspace-index.js';
import { selectToolsForRequest, shouldUseIntentClassifier } from './tool-router.js';
import { WorkspaceState } from '../../workspace-state.js';
import { ObservationSummarizer } from '../../observation-summarizer.js';
import { ContentAddressableStore, FileAnalyzer } from '../../harness/content-addressing.js';
import { withRoutedToolContext } from '../../routed-tool-context.js';
import { TokenScope } from './support/token-scope.js';
import { MAX_ITERATIONS_DEFAULT, METHODOLOGY_TOOLS } from '../../agent-constants.js';
import { TaskStatus } from '../../../planner/graph-planner.js';
import { isMutationTool, isSemanticRiskReviewTool } from './execution-plan-manager.js';
import { metricsSink } from '../metrics-sink.js';
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

    // ---- 初始化子模块 ----
    const sharedDeps = {
      debugEvent: (label, details) => this.#debugEvent(label, details),
      sessionManager: this.#sessionManager,
    };

    this.#planner = new AgentPlanner(sharedDeps);

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
    const runStartedAt = Date.now();
    const runId = `run-${runStartedAt}-${Math.random().toString(36).slice(2, 8)}`;
    metricsSink.startRun(runId);

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

    // 首次 run：设置 system prompt
    if (this.#sessionManager.length === 0) {
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

    // Step 2: 任务分类（合并进 IntentClassifier，消除一层路由）
    const taskProfile = this.#intentClassifier?.classifyTask(userInput, intent) || {
      isCodingTask: false,
      isModificationTask: false,
      riskLevel: 'low',
      semanticRiskDomains: [],
      requiresSemanticRiskReview: false,
    };

    // Step 3: 准备运行上下文
    this.#sessionManager.addUserMessage(userInput);
    const routingPrompt = this.#intentClassifier?.buildRoutingPrompt(intent);
    if (routingPrompt) {
      this.#sessionManager.addUserMessage(routingPrompt);
    }

    // Step 3b: 注入多文件上下文聚合（最近引用的文件 + 最近读写的文件）
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

    this.#planner.reset();
    this.#router.reset();
    this.#agentContext.reset();

    // Step 4: 执行计划
    const executionPlan = this.#planner.createIfNeeded(userInput, taskProfile);
    const maxIterations = this.#verifier.computeIterationBudget(
      taskProfile,
      this.#config.maxIterations,
    );

    // Step 5: 编码任务增强
    let toolUseCorrections = 0;
    let codingGateCorrections = 0;

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
    }

    // 异步预热工作目录索引
    if (this.#workspaceIndex && taskProfile.isCodingTask) {
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

    // ============================================================
    // 主循环
    // ============================================================
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      if (this.#stopRequested) {
        return this.#completeRun({
          success: false,
          status: 'cancelled',
          answer: '',
          reason: 'user_stop',
          iterations: iteration,
          startedAt: runStartedAt,
        });
      }

      this.#ui.iteration(iteration, maxIterations);

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
        // 工具路由
        const currentPhase = this.#planner.deriveCurrentPhase();
        const routedTools = selectToolsForRequest(this.#toolRegistry.getAll(), {
          userInput,
          taskProfile: this.#activeTaskProfile,
          intent,
          currentPhase,
        });
        this.#activeRoutedToolNames = new Set(routedTools.map((tool) => tool.name));
        const functions = this.#toolRegistry.toFunctionDefinitions(routedTools);
        const messages = withRoutedToolContext(
          this.#sessionManager.getMessages(),
          this.#textToolParser.generateToolPrompt(routedTools),
          currentPhase,
        );

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
              runId,
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
            runId,
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

        // 工具语法纠正
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
            `This is a coding task and no tool has been executed yet. To complete this task, use the available tools to: (a) inspect the workspace with list_dir/read_file, (b) write code with write_file/edit_file, (c) verify with shell/verify. Do not finish until you have produced and verified real code changes.`,
          );
          continue;
        }

        // 无工具调用也无终止 → 提示继续
        if (allToolCalls.length === 0) {
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
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
          this.#sessionManager.addAssistantMessage(response.text, nativeToolCalls);
          for (const toolCall of nativeToolCalls) {
            const toolStart = Date.now();
            const toolResult = await this.#router.executeToolCall(toolCall, {
              resultMode: 'tool',
              activeRoutedToolNames: this.#activeRoutedToolNames,
              workspaceState: this.#workspaceState,
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
            if (this.#isUserInputRequest(toolResult?.result)) {
              return this.#completeUserInputRequest(toolResult.result, {
                iteration,
                startedAt: runStartedAt,
              });
            }
          }
        } else {
          this.#sessionManager.addAssistantMessage(response.text);
        }

        for (const toolCall of parsedToolCalls) {
          const toolStart = Date.now();
          const toolResult = await this.#router.executeToolCall(toolCall, {
            resultMode: 'observation',
            activeRoutedToolNames: this.#activeRoutedToolNames,
            workspaceState: this.#workspaceState,
          });
          this.#recordToolEvent(toolResult, { durationMs: Date.now() - toolStart });
          this.#agentContext.recordToolCallForStagnation(toolResult, iteration, (name, r) =>
            isMutationTool(name, r?.args || {}),
          );

          // 添加 Observation 到会话
          if (!toolResult.skipped) {
            const content =
              typeof toolResult.result === 'string'
                ? toolResult.result
                : JSON.stringify(toolResult.result);
            const processedContent = this.#tokenJuice
              ? this.#tokenJuice.compressToolResult(content, {
                  input: { toolName: toolResult.name },
                }).inlineText || content
              : content;
            this.#sessionManager.addUserMessage(
              `Observation from ${toolResult.name}:\n${processedContent}`,
            );
          }

          this.#planner.advance(toolResult.name, toolCall.arguments || {}, toolResult.result);
          if (this.#isUserInputRequest(toolResult?.result)) {
            return this.#completeUserInputRequest(toolResult.result, {
              iteration,
              startedAt: runStartedAt,
            });
          }
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

  // ============================================================
  // 私有方法
  // ============================================================

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
    if (!result || typeof result !== 'object') {
      return false;
    }
    return result.requiresUserInput === true || result.type === 'user_input_required';
  }

  #completeUserInputRequest(result, { iteration, startedAt, reason }) {
    const answer = result.answer || this.#formatUserInputRequestAnswer(result);
    this.#debugEvent('User input requested', { reason, questions: result.questions || [] });
    this.#ui.finalAnswer(answer);
    this.#sessionManager.addAssistantMessage(`FINAL_ANSWER: ${answer}`);
    return this.#completeRun({
      success: true,
      status: 'needs_user_input',
      answer,
      reason,
      iterations: iteration,
      startedAt,
      userInputRequest: result,
    });
  }

  #formatUserInputRequestAnswer(result) {
    const questions = Array.isArray(result.questions) ? result.questions : [];
    return [
      '需要你补充一点信息后我才能继续。',
      result.reason ? `原因：${result.reason}` : '',
      questions.length > 0
        ? `请回答：\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
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

  #preview(value, maxLength = 200) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }
}
