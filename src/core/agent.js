/**
 * ReAct Agent Engine
 * Core reasoning loop: Thought -> Action -> Observation -> repeat
 */

import { SessionManager } from './session-manager.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { classifyError, RetryStrategy, withTimeout } from '../errors/error-handler.js';
import { ui } from '../cli/ui.js';
import { TextToolParser } from './text-tool-parser.js';
import { IntentClassifier } from './intent-classifier.js';
import { ExecutionPlan, TaskStatus } from '../planner/graph-planner.js';
import { DynamicContextPruning } from './dynamic-context-pruning.js';
import { WorkspaceIndex } from './workspace-index.js';
import { selectToolsForRequest, shouldUseIntentClassifier } from './tool-router.js';
import { WorkspaceState } from './workspace-state.js';
import { ObservationSummarizer } from './observation-summarizer.js';
import { ContentAddressableStore, FileAnalyzer } from './harness/content-addressing.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const TERMINATION_KEYWORDS = ['FINAL_ANSWER:', 'Answer:', 'TASK_COMPLETE'];
const MAX_ITERATIONS_DEFAULT = 120;

// 自适应迭代预算（占 maxIterations 的比例）
const ITERATION_BUDGET = {
  trivial: 0.25,
  simple: 0.5,
  normal: 0.8,
  intensive: 1.0,
  exploration: 1.0,
};

// 停滞检测
const STAGNATION_LOOKBACK = 10;
const STAGNATION_SAME_TOOL_LIMIT = 6;
const STAGNATION_NO_MUTATION_LIMIT = 8;
const PROGRESS_CHECKPOINT_INTERVAL = 12;
const MAX_STAGNATION_NUDGES = 2;
const METHODOLOGY_TOOLS = new Set([
  'coverage_check',
  'ask_user',
  'brainstorm',
  'grill',
  'zoom_out',
  'tdd',
  'review',
  'verify',
  'diagnose',
  'architect',
  'to_prd',
  'to_issues',
  'setup',
]);
const MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'shell',
  'pty_start',
  'pty_write',
  'git_apply_patch',
  'git_commit',
  'git_push',
]);
const VERIFICATION_TOOLS = new Set([
  'verify',
  'review',
  'read_file',
  'list_dir',
  'glob',
  'search',
  'shell',
  'pty_start',
  'pty_read',
  'semantic_search',
]);
// Inspection-only tools (read back your own edits is NOT a runtime test).
const INSPECTION_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'search',
  'semantic_search',
  'review',
]);
// True runtime verification: shell/pty that runs test/lint/build commands, or verify tool.
const RUNTIME_VERIFICATION_TOOLS = new Set([
  'verify',
  'shell',
  'pty_start',
  'pty_write',
  'pty_read',
]);
// Shell sub-command patterns that count as real runtime verification.
const RUNTIME_VERIFICATION_COMMAND_PATTERNS = [
  /\b(test|tests|testing)\b/i,
  /\b(lint|linting|eslint|prettier)\b/i,
  /\b(build|compile|bundle|tsc|webpack|rollup|vite build|babel)\b/i,
  /\b(type.?check|typecheck|check)\b/i,
  /\b(npm|pnpm|yarn|bun|node|python|pytest|vitest|jest|mocha|cargo|go test|dotnet test|mvn test|gradle test)\b/i,
];
const SEMANTIC_RISK_DOMAINS = [
  {
    id: 'units_timing',
    label: 'units/time/animation semantics',
    pattern: /时间|速度|帧|毫秒|秒|定时|计时|循环|动画|游戏|物理|实时|fps|frame|clock|tick|speed|interval|timeout|timer|animation|game|physics|realtime|real-time/i,
    checklist: 'track units in variable names and API arguments; separate render FPS from simulation/update intervals; verify user-visible timing or movement behavior',
  },
  {
    id: 'api_semantics',
    label: 'third-party API semantics',
    pattern: /api|sdk|库|框架|pygame|three\.js|react|vue|express|fastapi|requestanimationframe|setinterval|settimeout|websocket|http|fetch/i,
    checklist: 'confirm parameter meanings, return values, lifecycle constraints, and error behavior before treating a call as correct',
  },
  {
    id: 'state_transitions',
    label: 'state transition invariants',
    pattern: /状态|状态机|胜负|分数|移动|碰撞|合并|撤销|重试|缓存|session|state|fsm|transition|score|collision|merge|retry|cache/i,
    checklist: 'verify state invariants, edge transitions, reset behavior, and repeated-action behavior',
  },
  {
    id: 'concurrency_io',
    label: 'async/concurrency/io semantics',
    pattern: /并发|异步|队列|锁|流|文件|网络|超时|重试|async|await|promise|concurrent|parallel|queue|lock|stream|file|network|timeout|retry/i,
    checklist: 'check ordering, cancellation, timeout/retry behavior, idempotency, and partial failure handling',
  },
  {
    id: 'security_boundary',
    label: 'security/input boundary semantics',
    pattern: /安全|权限|认证|登录|密钥|token|注入|沙箱|secret|password|auth|permission|sanitize|injection|sandbox|xss|csrf/i,
    checklist: 'validate trust boundaries, secrets handling, escaping/sanitization, and permission checks',
  },
];

export class ReActAgent {
  /** @type {import('./tool-registry.js').ToolRegistry} */
  #modelProvider;
  /** @type {import('./tool-registry.js').ToolRegistry} */
  #toolRegistry;
  /** @type {SessionManager} */
  #sessionManager;
  /** @type {MemoryManager} */
  #memoryManager;
  /** @type {object} */
  #config;
  /** @type {RetryStrategy} */
  #retryStrategy;
  /** @type {object} */
  #ui;

  // Deduplication tracking
  #lastResponse = '';
  #repeatCount = 0;
  #stagnationWindow = [];
  /** @type {number} */
  #lastStagnationNudge = 0;
  /** @type {number} */
  #consecutiveSameTool = 0;
  /** @type {number} */
  #lastMutationIteration = 0;
  /** @type {number} */
  #activeProgressCheckpoints = 0;
  /** @type {number} */
  #iterationBudget = MAX_ITERATIONS_DEFAULT;

  /** @type {string[]} */
  #toolCallHistory = [];
  /** @type {Map<string, string>} */
  #toolResultCache = new Map();
  /** @type {TextToolParser} */
  #textToolParser;
  /** @type {IntentClassifier|null} */
  #intentClassifier;
  /** @type {Array<{name: string, success: boolean, args: object, resultPreview: string}>} */
  #runToolEvents = [];
  /** @type {object} */
  #activeTaskProfile = null;
  /** @type {ExecutionPlan|null} */
  #activeExecutionPlan = null;
  /** @type {Set<string>} */
  #requiredMutationPaths = new Set();
  /** @type {Set<string>} */
  #completedMutationPaths = new Set();
  #lastRunResult = null;
  #contextPruner = null;
  /** @type {object|null} */
  #tokenJuice = null;
  /** @type {WorkspaceIndex|null} */
  #workspaceIndex = null;
  
  // ============ 工作区状态追踪（新功能）============
  /** @type {WorkspaceState|null} */
  #workspaceState = null;
  /** @type {ObservationSummarizer|null} */
  #observationSummarizer = null;
  /** @type {boolean} */
  #workspaceStateEnabled = true;
  /** @type {number} */
  #lastWorkspaceHintUpdate = 0;
  /** @type {string} */
  #cachedWorkspaceHint = '';
  /** @type {ContentAddressableStore|null} */
  #contentStore = null;
  /** @type {FileAnalyzer|null} */
  #fileAnalyzer = null;

  constructor(modelProvider, toolRegistry, memoryManager, config = {}, customUI = ui) {
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry;
    this.#memoryManager = memoryManager;
    this.#config = {
      maxIterations: config.maxIterations || MAX_ITERATIONS_DEFAULT,
      workingDirectory: config.workingDirectory || process.cwd(),
      ...config,
    };
    // 如果 config.session 是 SessionManager 实例，直接使用它
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

    // Content-addressable store: session-scoped (not global singleton).
    // Lives for the duration of this agent instance, is passed to all
    // filesystem tool handlers so they can record anchors/blobs and detect
    // concurrent modifications.
    this.#contentStore = new ContentAddressableStore();
    this.#fileAnalyzer = new FileAnalyzer(this.#contentStore);

    
    // 初始化工作区状态追踪
    this.#initializeWorkspaceState(config);
  }
  
  /**
   * 初始化工作区状态追踪
   */
  #initializeWorkspaceState(config) {
    if (config.workspaceState instanceof WorkspaceState) {
      // 允许外部注入
      this.#workspaceState = config.workspaceState;
    } else {
      this.#workspaceState = new WorkspaceState();
    }
    
    this.#observationSummarizer = new ObservationSummarizer(this.#workspaceState);
    
    this.#debugEvent('Workspace state initialized', {
      enabled: this.#workspaceStateEnabled,
      files: 0,
      directories: 0,
    });
  }

  /**
   * Run the agent with a user input
   */
  async run(userInput) {
    const runStartedAt = Date.now();
    this.#lastRunResult = {
      success: false,
      status: 'running',
      answer: '',
      reason: null,
      iterations: 0,
      durationMs: 0,
      toolEvents: [],
    };
    this.#debugEvent('Agent run started', {
      inputPreview: this.#preview(userInput, 240),
      workingDirectory: this.#config.workingDirectory,
      maxIterations: this.#config.maxIterations,
    });

    // Only set system prompt once at the first run
    if (this.#sessionManager.length === 0) {
      // Build and set system prompt
      const systemPrompt = buildSystemPrompt(
        this.#memoryManager,
        this.#toolRegistry,
        this.#config.workingDirectory
      );
      this.#sessionManager.setSystemPrompt(systemPrompt);

      // Add tool usage instructions for text-based LLMs
      const toolInstructions = this.#textToolParser.generateToolPrompt();
      this.#sessionManager.addSystemMessage(toolInstructions);

      this.#debugEvent('Session initialized', {
        toolCount: this.#toolRegistry.size,
        systemPromptChars: systemPrompt.length,
        toolInstructionChars: toolInstructions.length,
      });
    }

    const taskProfile = this.#classifyTask(userInput);
    const intent = this.#intentClassifier && shouldUseIntentClassifier(userInput)
      ? await this.#intentClassifier.classify(userInput, {
        recentMessages: this.#sessionManager.getRecentExchanges(3),
      })
      : null;
    if (this.#intentClassifier && !intent) {
      this.#debugEvent('Intent classifier skipped', {
        reason: 'local_task_router',
        isCodingTask: taskProfile.isCodingTask,
      });
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

    // Add user message
    this.#sessionManager.addUserMessage(userInput);
    const routingPrompt = this.#intentClassifier?.buildRoutingPrompt(intent);
    if (routingPrompt) {
      this.#sessionManager.addUserMessage(routingPrompt);
    }

    // Reset tracking
    this.#lastResponse = '';
    this.#repeatCount = 0;

    this.#toolCallHistory = [];
    this.#runToolEvents = [];
    this.#activeTaskProfile = taskProfile;
    this.#requiredMutationPaths = this.#extractRequestedFilePaths(userInput);
    this.#completedMutationPaths = new Set();
    this.#activeExecutionPlan = this.#createAutomaticExecutionPlan(userInput, this.#activeTaskProfile);

    // 基于任务复杂度计算自适应迭代预算
    const maxIterations = this.#computeIterationBudget(taskProfile);
    this.#stagnationWindow = [];
    this.#lastStagnationNudge = 0;
    this.#consecutiveSameTool = 0;
    this.#lastMutationIteration = 0;
    this.#activeProgressCheckpoints = 0;

    let iteration = 0;
    let toolUseCorrections = 0;
    let codingGateCorrections = 0;

    if (this.#activeTaskProfile.isCodingTask) {
      this.#debugEvent('Coding task mode enabled', this.#activeTaskProfile);
      const basePrompt = this.#buildCodingTaskOperatingPrompt(userInput);
      const strategy = await this.#suggestVerificationStrategy(userInput);
      this.#sessionManager.addUserMessage(`${basePrompt}\n\nVerification strategy:\n${strategy}`);
    }

    if (this.#activeExecutionPlan) {
      this.#debugEvent('Automatic task orchestration enabled', {
        plan: this.#activeExecutionPlan.toJSON(),
      });
      this.#sessionManager.addUserMessage(this.#buildExecutionPlanPrompt(userInput));
    }
    // 异步预热工作目录索引（不阻塞首轮迭代）
    // 首次构建 1-3s，后续 <100ms。摘要在第 2-3 轮到达，
    // 正好 Agent 还在探索阶段，不影响决策质量
    if (this.#workspaceIndex && taskProfile.isCodingTask && !taskProfile.isLikelyTrivial) {
      this.#warmWorkspaceCache().then(summary => {
        if (summary && this.#sessionManager) {
          this.#sessionManager.addUserMessage(summary);
          try { this.#debugEvent('Workspace index warmed', {
            files: this.#workspaceIndex.size,
            summaryChars: summary.length,
         }); } catch { /* ignore */ }
        }
      }).catch(err => {
         try { this.#debugEvent('Workspace index warm failed', { error: err.message }); } catch { /* ignore */ }
     });
      this.#workspaceIndex.startPeriodicSync();
    }


    while (iteration < maxIterations) {
      iteration++;
      this.#ui.iteration(iteration, maxIterations);
        // 停滞检测：注入 nudge 或进度检查点
        this.#injectStagnationNudge(iteration, maxIterations);
      this.#debugEvent('Iteration started', {
        iteration,
        maxIterations,
        sessionMessages: this.#sessionManager.getHistory().length,
        estimatedTokens: this.#sessionManager.getTokenCount(),
      });

      try {
        // Manage context window
        this.#manageContextWindow();

        // Get messages for LLM after context trimming so the request reflects
        // the actual session state that will continue into later iterations.
        const messages = this.#sessionManager.getMessages();
        const routedTools = selectToolsForRequest(this.#toolRegistry.getAll(), {
          userInput,
          taskProfile: this.#activeTaskProfile,
          intent,
        });
        const functions = this.#toolRegistry.toFunctionDefinitions(routedTools);

        // Call LLM with retry
        const llmStartedAt = Date.now();
        this.#debugEvent('LLM request', {
          modelProvider: this.#modelProvider.constructor?.name || 'unknown',
          messageCount: messages.length,
          toolDefinitions: functions.length,
          registeredToolDefinitions: this.#toolRegistry.size,
          routedToolNames: functions.map(tool => tool.name),
          maxTokens: this.#config.maxTokens,
          lastUserMessage: this.#preview(
            [...messages].reverse().find(message => message.role === 'user')?.content || '',
            240
          ),
        });

        const response = await this.#retryStrategy.executeWithRetry(() =>
          withTimeout(
            () => this.#modelProvider.chat(messages, {
              functions,
              maxTokens: this.#config.maxTokens,
            }),
            120000, // 2 minute timeout
            'LLM call'
          )
        );

        this.#debugEvent('LLM response', {
          durationMs: Date.now() - llmStartedAt,
          finishReason: response.finishReason,
          textPreview: this.#preview(response.text, 300),
          nativeToolCalls: response.toolCalls?.length || 0,
        });
        this.#debug(`Response: ${response.text.substring(0, 200)}...`);
        
        // Parse text-based tool calls for models that don't support function calling
        const nativeToolCalls = response.toolCalls || [];
        const parsedToolCalls = nativeToolCalls.length === 0
          ? this.#textToolParser.parse(response.text)
          : [];
        const allToolCalls = [...nativeToolCalls, ...parsedToolCalls];
        this.#debug(`Tool calls: ${allToolCalls.length} (${nativeToolCalls.length} native, ${parsedToolCalls.length} parsed)`);
        if (allToolCalls.length > 0) {
          this.#debugEvent('Tool calls detected', {
            native: nativeToolCalls.map(call => ({ name: call.name, arguments: call.arguments })),
            parsed: parsedToolCalls.map(call => ({ name: call.name, arguments: call.arguments, source: call.source })),
          });
        }

        if (
          allToolCalls.length === 0 &&
          response.finishReason === 'stop' &&
          response.text?.trim() &&
          this.#activeExecutionPlan?.status === TaskStatus.COMPLETED
        ) {
          const answer = this.#isTermination(response.text)
            ? this.#extractFinalAnswer(response.text)
            : response.text.trim();
          this.#debugEvent('Final answer emitted', {
            iteration,
            totalDurationMs: Date.now() - runStartedAt,
            reason: 'completed_plan_provider_stop_without_marker',
            answerPreview: this.#preview(answer, 300),
          });
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

        if (
          allToolCalls.length === 0 &&
          response.text?.trim() &&
          toolUseCorrections < 2 &&
          this.#containsUnparsedToolSyntax(response.text)
        ) {
          toolUseCorrections++;
          this.#debugEvent('Tool syntax correction requested', {
            iteration,
            correction: toolUseCorrections,
            responsePreview: this.#preview(response.text, 300),
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(this.#buildToolSyntaxCorrectionPrompt(response.text));
          continue;
        }

        if (
          allToolCalls.length === 0 &&
          response.text?.trim() &&
          toolUseCorrections < 2 &&
          this.#shouldCorrectToolRefusal(userInput, response.text)
        ) {
          toolUseCorrections++;
          this.#debugEvent('Tool use correction requested', {
            iteration,
            correction: toolUseCorrections,
            responsePreview: this.#preview(response.text, 300),
            userInputPreview: this.#preview(userInput, 160),
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(this.#buildToolUseCorrectionPrompt(userInput));
          continue;
        }

        const shouldBlockFinal = allToolCalls.length === 0 &&
          codingGateCorrections < 3 &&
          this.#shouldBlockCodingFinal(userInput, response.text);

        if (shouldBlockFinal.block) {
          codingGateCorrections++;
          this.#debugEvent('Coding completion gate requested', {
            iteration,
            correction: codingGateCorrections,
            reason: shouldBlockFinal.reason,
            evidence: shouldBlockFinal.evidence,
            responsePreview: this.#preview(response.text, 300),
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
            this.#buildCodingCompletionGatePrompt(userInput, shouldBlockFinal)
          );
          continue;
        }

        // Check for termination
        if (this.#isTermination(response.text)) {
          const answer = this.#normalizeFinalAnswer(this.#extractFinalAnswer(response.text));
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

        // OpenAI-compatible models often finish naturally without following the
        // explicit FINAL_ANSWER marker. If the provider says the response is
        // complete and no tool call is present, surface it instead of making a
        // hidden continuation request that looks like a hang in the terminal.
        if (allToolCalls.length === 0 && response.finishReason === 'stop' && response.text?.trim()) {
          const answer = this.#normalizeFinalAnswer(response.text);
          this.#debugEvent('Final answer emitted', {
            iteration,
            totalDurationMs: Date.now() - runStartedAt,
            reason: 'provider_stop_without_tool_calls',
            answerPreview: this.#preview(answer, 300),
          });
          this.#ui.finalAnswer(answer);
          this.#sessionManager.addAssistantMessage(response.text);
          return this.#completeRun({
            success: true,
            status: 'completed',
            answer,
            reason: 'provider_stop_without_tool_calls',
            iterations: iteration,
            startedAt: runStartedAt,
          });
        }

        // If no tool calls and no termination, prompt to continue
        if (allToolCalls.length === 0) {
          this.#debug('No tool calls detected, prompting to continue...');
          this.#debugEvent('Continuation requested', {
            reason: 'no_tool_calls_and_no_final_answer',
            responsePreview: this.#preview(response.text, 240),
          });
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
            `No tool call detected in your response. To use a tool, output in one of these formats:\n` +
            `1. CALL tool_name({"param": "value"})\n` +
            `2. \`\`\`tool\n{"name": "tool_name", "arguments": {"param": "value"}}\n\`\`\`\n\n` +
            `If you have reached a final conclusion, respond with "FINAL_ANSWER:" followed by your response.`
          );
          continue;
        }

        // Native provider tool calls must be preserved as tool_call/tool messages.
        // Text-parsed CALL blocks are plain assistant text, so feed their results
        // back as Observation text to avoid sending fabricated tool_calls history.
        if (nativeToolCalls.length > 0) {
          this.#sessionManager.addAssistantMessage(response.text, nativeToolCalls);
          for (const toolCall of nativeToolCalls) {
            const toolResult = await this.#executeToolCall(toolCall, { resultMode: 'tool' });
            this.#recordToolCallForStagnation(toolResult, iteration);
            if (this.#isUserInputRequest(toolResult?.result)) {
              return this.#completeUserInputRequest(toolResult.result, {
                iteration,
                startedAt: runStartedAt,
                reason: 'ask_user_tool',
              });
            }
          }
        } else {
          this.#sessionManager.addAssistantMessage(response.text);
        }

        for (const toolCall of parsedToolCalls) {
          const toolResult = await this.#executeToolCall(toolCall, { resultMode: 'observation' });
          this.#recordToolCallForStagnation(toolResult, iteration);
          if (this.#isUserInputRequest(toolResult?.result)) {
            return this.#completeUserInputRequest(toolResult.result, {
              iteration,
              startedAt: runStartedAt,
              reason: 'ask_user_tool',
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

        // Add error as observation and continue
        this.#sessionManager.addUserMessage(
          `Error occurred: ${agentError.message}. Please try a different approach or call a different tool.`
        );
      }
    }

    this.#ui.warn(`Reached maximum iterations (${maxIterations}). Stopping.`);
    this.#ui.info('The task may not be fully completed. Consider breaking it into smaller steps.');
    this.#debugEvent('Agent run stopped at max iterations', {
      maxIterations,
      totalDurationMs: Date.now() - runStartedAt,
    });
    return this.#completeRun({
      success: false,
      status: 'max_iterations',
      answer: '',
      reason: 'max_iterations',
      iterations: maxIterations,
      startedAt: runStartedAt,
    });
  }

  /**
   * Execute a single tool call
   */
  async #executeToolCall(toolCall, options = {}) {
    const normalizedToolCall = this.#normalizeToolCall(toolCall);
    const rewrittenToolCall = this.#rewriteShellRuntimeToolCall(normalizedToolCall) || normalizedToolCall;
    const { id, name, arguments: args } = rewrittenToolCall;
    const resultMode = options.resultMode || 'tool';
    const startedAt = Date.now();

    // Deduplication check
    const callSignature = `${name}:${JSON.stringify(args)}`;
    if (this.#toolCallHistory.includes(callSignature)) {
      this.#ui.warn(`Duplicate tool call detected: ${name}. Skipping.`);
      const cachedResult = this.#toolResultCache.get(callSignature);
      this.#debugEvent('Tool call skipped', {
        reason: 'duplicate',
        tool: name,
        arguments: args,
        resultMode,
        cachedResult: Boolean(cachedResult),
      });
      this.#addToolObservation(
        id,
        name,
        cachedResult
          ? `Duplicate call to ${name} skipped. Previous result:\n${cachedResult}\n\nUse this observation to provide the final answer.`
          : `Warning: Duplicate call to ${name} skipped. Use the existing observations to provide the final answer.`,
        resultMode
      );
      return { name, result: cachedResult || null, skipped: true };
    }
    this.#toolCallHistory.push(callSignature);
    // Keep history manageable
    if (this.#toolCallHistory.length > 50) {
      this.#toolCallHistory = this.#toolCallHistory.slice(-25);
    }

    // ============ 基于工作区状态的智能预测（新功能）============
    if (this.#workspaceStateEnabled && this.#workspaceState) {
      const prediction = this.#workspaceState.predictToolResult(name, args);
      if (prediction.canSkip) {
        this.#ui.warn(`⚠️  Skipping ${name}: ${prediction.reason}`);
        this.#debugEvent('Tool call skipped (workspace prediction)', {
          tool: name,
          arguments: args,
          reason: prediction.reason,
          prediction: prediction.type,
        });
        const observation = `Based on previous exploration:\n${prediction.reason}\n\nThis operation would fail. Consider a different approach or check workspace_knowledge first.`;
        this.#addToolObservation(id, name, observation, resultMode);
        
        // 记录为失败的操作
        this.#recordToolEvent(name, args, false, prediction.reason);
        return { name, result: prediction.predicted || { error: prediction.reason }, skipped: true, predicted: true };
      }
    }

    this.#ui.toolCall(name, args);

    const tool = this.#toolRegistry.get(name);
    if (!tool) {
      const errorMsg = this.#formatToolNotFoundError(name);
      this.#debugEvent('Tool lookup failed', {
        tool: name,
        arguments: args,
        availableTools: this.#toolRegistry.getAll().map(item => item.name),
      });
      this.#ui.toolError(name, errorMsg);
      this.#addToolObservation(id, name, errorMsg, resultMode);
      return { name, result: errorMsg, error: errorMsg };
    }

    // 验证必填参数
    if (tool.required && Array.isArray(tool.required)) {
      const missing = tool.required.filter(param => {
        const value = args ? args[param] : undefined;
        return value === undefined || value === null || value === '';
      });
      if (missing.length > 0) {
        const errorMsg = `Missing required parameter(s): ${missing.join(', ')}. The "${name}" tool requires: ${tool.required.join(', ')}.`;
        this.#debugEvent('Tool call missing required params', {
          tool: name,
          missing,
          receivedArgs: args,
        });
        this.#ui.warn?.(errorMsg);
        this.#addToolObservation(id, name, errorMsg, resultMode);
        return { name, result: errorMsg, error: errorMsg };
      }
    }

    const securityBlock = this.#enforceToolSecurity(name, args);
    if (securityBlock) {
      this.#debugEvent('Tool call blocked by security policy', {
        tool: name,
        arguments: args,
        reason: securityBlock,
      });
      this.#ui.toolError(name, securityBlock);
      this.#recordToolEvent(name, args, false, `Security policy blocked tool call: ${securityBlock}`);
      this.#addToolObservation(id, name, `Error: Security policy blocked ${name}: ${securityBlock}`, resultMode);
      return { name, result: `Error: Security policy blocked ${name}: ${securityBlock}`, error: securityBlock };
    }

    this.#debugEvent('Tool call started', {
      id,
      tool: name,
      category: tool.category,
      source: rewrittenToolCall.source || toolCall.source || 'native',
      resultMode,
      workingDirectory: this.#config.workingDirectory,
      arguments: args,
      purpose: tool.description,
    });

    try {
      const context = {
        workingDirectory: this.#config.workingDirectory,
        memoryManager: this.#memoryManager,
        sessionManager: this.#sessionManager,
        modelProvider: this.#modelProvider,
        debug: this.#isDebugEnabled(),
        ui: this.#ui,
        toolName: name,
        subAgent: this.#config.subAgent,
        // Content-addressable store: enables hash-anchored patch verification
        // in filesystem tools (edit_file, write_file) and provides anchors.
        contentStore: this.#contentStore,
        fileAnalyzer: this.#fileAnalyzer,
        // Snapshot of tool events so far, used by the `verify` tool to build
        // an evidence-based report rather than trusting textual "evidence" args.
        toolEventsSnapshot: this.#runToolEvents.map(event => ({ ...event })),
      };

      const result = await withTimeout(
        () => tool.handler(args, context),
        60000, // 1 minute timeout per tool
        `Tool ${name}`
      );

      const finalResult = this.#applyToolSecurityResultPolicy(name, result);

      this.#debugEvent('Tool call completed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        resultChars: this.#contentLength(finalResult),
        resultPreview: this.#preview(typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult), 300),
      });
      this.#ui.toolResult(name, finalResult);
      this.#recordToolEvent(name, args, true, finalResult);
      this.#toolResultCache.set(callSignature, typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult));
      
      // ============ 记录到工作区状态（新功能）============
      if (this.#workspaceStateEnabled && this.#observationSummarizer) {
        const processed = this.#observationSummarizer.processToolResult(name, args, finalResult);
        this.#debugEvent('Workspace state updated', {
          tool: name,
          summary: processed.summary,
          factsCount: processed.facts?.length || 0,
        });
        // 清除缓存的工作区提示
        this.#cachedWorkspaceHint = '';
      }
      
      this.#addToolObservation(id, name, finalResult, resultMode);
      this.#advanceAutomaticPlan(name, args, finalResult);
      return { name, result: finalResult };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.#debugEvent('Tool call failed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        error: errorMsg,
      });
      this.#ui.toolError(name, errorMsg);
      this.#recordToolEvent(name, args, false, `Error: ${errorMsg}`);
      this.#toolResultCache.set(callSignature, `Error: ${errorMsg}`);
      
      // ============ 记录错误到工作区状态（新功能）============
      if (this.#workspaceStateEnabled && this.#observationSummarizer) {
        this.#observationSummarizer.processToolResult(name, args, { error: errorMsg });
        this.#cachedWorkspaceHint = '';
      }
      
      this.#addToolObservation(id, name, `Error: ${errorMsg}`, resultMode);
      return { name, result: `Error: ${errorMsg}`, error: errorMsg };
    }
  }

  #normalizeToolCall(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') {
      return toolCall;
    }

    if (toolCall.name) {
      return {
        ...toolCall,
        arguments: this.#parseToolArguments(toolCall.arguments),
      };
    }

    if (toolCall.function?.name) {
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: this.#parseToolArguments(toolCall.function.arguments),
        source: toolCall.type || 'native_tool_call',
        raw: toolCall,
      };
    }

    return toolCall;
  }

  #parseToolArguments(args) {
    if (!args) {
      return {};
    }
    if (typeof args === 'object') {
      return args;
    }
    if (typeof args !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  #isUserInputRequest(result) {
    if (!result || typeof result !== 'object') {
      return false;
    }
    return result.requiresUserInput === true || result.type === 'user_input_required';
  }

  #completeUserInputRequest(result, { iteration, startedAt, reason }) {
    const answer = result.answer || this.#formatUserInputRequestAnswer(result);
    this.#debugEvent('User input requested', {
      reason,
      questions: result.questions || [],
      blockingFacts: result.blockingFacts || [],
    });
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
        ? `请回答：\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n');
  }

  #recordToolEvent(name, args, success, result) {
    this.#runToolEvents.push({
      name,
      args,
      success,
      resultPreview: this.#preview(typeof result === 'string' ? result : JSON.stringify(result), 300),
    });
  }

  #enforceToolSecurity(name, args) {
    const policy = this.#config.securityPolicy;
    if (!policy) {
      return null;
    }

    if (typeof policy.requiresApproval === 'function' && policy.requiresApproval(name)) {
      return 'approval_required';
    }

    if (typeof policy.validateToolCall === 'function') {
      const result = policy.validateToolCall(name, args);
      if (result === false) {
        return 'denied';
      }
      if (result && result.allowed === false) {
        return result.reason || 'denied';
      }
    }

    return null;
  }

  #applyToolSecurityResultPolicy(name, result) {
    const policy = this.#config.securityPolicy;
    if (policy && typeof policy.truncateResult === 'function') {
      return policy.truncateResult(name, result);
    }
    return result;
  }

  #createAutomaticExecutionPlan(userInput, profile) {
    if (!profile?.requiresAutomaticPlanning) {
      return null;
    }

    const plan = new ExecutionPlan({
      name: 'Automatic coding task plan',
      description: userInput,
      context: {
        source: 'react-agent',
        generatedAt: new Date().toISOString(),
      },
    });

    plan.addTask({
      id: 'inspect_workspace',
      name: 'Inspect workspace',
      description: 'Discover the relevant project structure and existing files before reading or writing.',
      dependencies: [],
    });
    plan.addTask({
      id: 'plan_solution',
      name: 'Plan solution',
      description: 'Choose the implementation approach and file split for the requested change.',
      dependencies: ['inspect_workspace'],
    });
    plan.addTask({
      id: 'implement_changes',
      name: 'Implement changes',
      description: 'Create or edit the required files using the smallest necessary changes.',
      dependencies: ['plan_solution'],
    });
    plan.addTask({
      id: 'inspect_changes',
      name: 'Inspect changes',
      description: 'Read back or otherwise inspect the files that were created or edited.',
      dependencies: ['implement_changes'],
    });
    if (profile.requiresSemanticRiskReview) {
      plan.addTask({
        id: 'semantic_risk_review',
        name: 'Semantic/API risk review',
        description: `Review the changed code against semantic risk domains: ${profile.semanticRiskDomains.map(domain => domain.label).join('; ')}.`,
        dependencies: ['inspect_changes'],
      });
    }
    plan.addTask({
      id: 'verify_result',
      name: 'Verify result',
      description: 'Run an appropriate command/tool to verify the requested behavior.',
      dependencies: profile.requiresSemanticRiskReview ? ['semantic_risk_review'] : ['inspect_changes'],
    });

    plan.status = TaskStatus.RUNNING;
    plan.startedAt = Date.now();
    plan.getTask('inspect_workspace')?.updateStatus(TaskStatus.RUNNING);
    return plan;
  }

  #buildExecutionPlanPrompt(userInput) {
    const plan = this.#activeExecutionPlan;
    const tasks = plan.toJSON().tasks
      .map(task => `- ${task.id}: ${task.name} [${task.status}] - ${task.description}`)
      .join('\n');

    return (
      `Automatic task orchestration is active for this request:\n${userInput}\n\n` +
      `Execute this DAG in dependency order. Do not skip ahead, and do not provide FINAL_ANSWER until every task is completed.\n` +
      `${tasks}\n\n` +
      `The DAG task ids are status labels, not tool names. Use real available tools such as list_dir, read_file, write_file, shell, and methodology tools.\n` +
      `${this.#activeTaskProfile?.requiresSemanticRiskReview ? `${this.#buildSemanticRiskGuidance()}\n` : ''}` +
      `Current task: inspect_workspace. Call list_dir or another filesystem discovery tool first, then continue through the plan.`
    );
  }

  #advanceAutomaticPlan(toolName, args, result) {
    const plan = this.#activeExecutionPlan;
    if (!plan || plan.status !== TaskStatus.RUNNING) {
      return;
    }
    if (!this.#isSuccessfulToolResult(result)) {
      return;
    }

    const before = this.#summarizePlanProgress(plan);
    this.#completePlanTaskIf('inspect_workspace', () => this.#isWorkspaceInspectionTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#completePlanTaskIf('plan_solution', () => this.#isPlanningTool(toolName));
    this.#startReadyTasks(plan);
    this.#completePlanTaskIf('plan_solution', () => this.#isMutationTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#recordMutationPath(toolName, args);
    this.#completePlanTaskIf('implement_changes', () => this.#isMutationTool(toolName, args) && this.#hasCompletedRequiredMutationPaths());
    this.#startReadyTasks(plan);
    this.#completePlanTaskIf('inspect_changes', () => this.#isChangeInspectionTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#completePlanTaskIf('semantic_risk_review', () => this.#isSemanticRiskReviewTool(toolName, args));
    this.#startReadyTasks(plan);
    this.#completePlanTaskIf('verify_result', () => this.#isVerificationTool(toolName, args));
    this.#startReadyTasks(plan);

    if (Array.from(plan.tasks.values()).every(task => task.status === TaskStatus.COMPLETED)) {
      plan.status = TaskStatus.COMPLETED;
      plan.completedAt = Date.now();
    }

    const after = this.#summarizePlanProgress(plan);
    if (after !== before) {
      this.#debugEvent('Automatic task orchestration advanced', {
        tool: toolName,
        before,
        after,
      });
      this.#sessionManager.addUserMessage(
        `Automatic task orchestration update:\n${after}\n\n` +
        `${plan.status === TaskStatus.COMPLETED
          ? 'All orchestrated tasks are complete. You may now provide FINAL_ANSWER with the change and verification summary.'
          : `Continue with the current ready task: ${this.#currentPlanTaskLabel(plan)}.`}`
      );
    }
  }

  #completePlanTaskIf(taskId, predicate) {
    const task = this.#activeExecutionPlan?.getTask(taskId);
    if (!task || task.status === TaskStatus.COMPLETED || !task.checkDependencies(this.#activeExecutionPlan.tasks)) {
      return;
    }
    if (predicate()) {
      task.updateStatus(TaskStatus.COMPLETED, { result: { completedBy: 'tool-observation' } });
    }
  }

  #isSuccessfulToolResult(result) {
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return !/^(Error|Command failed|BLOCKED):/i.test(text.trim());
  }

  #extractRequestedFilePaths(text) {
    const paths = new Set();
    const regex = /\b((?:[\w.-]+\/)*[\w.-]+\.(?:html|js|css|ts|tsx|jsx|json|md|py|java|go|rs|c|cpp|h|hpp))\b/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      paths.add(match[1]);
    }
    const basenamesWithDirectory = new Set(
      Array.from(paths)
        .filter(path => path.includes('/'))
        .map(path => path.split('/').pop())
    );
    for (const path of Array.from(paths)) {
      if (!path.includes('/') && basenamesWithDirectory.has(path)) {
        paths.delete(path);
      }
    }
    return paths;
  }

  #recordMutationPath(toolName, args) {
    if (!['write_file', 'edit_file'].includes(toolName)) {
      return;
    }
    const path = args?.path || args?.file_path || args?.file;
    if (path) {
      this.#completedMutationPaths.add(String(path));
    }
  }

  #hasCompletedRequiredMutationPaths() {
    if (this.#requiredMutationPaths.size === 0) {
      return true;
    }
    for (const path of this.#requiredMutationPaths) {
      if (!this.#completedMutationPaths.has(path)) {
        return false;
      }
    }
    return true;
  }

  #startReadyTasks(plan) {
    for (const task of plan.getReadyTasks()) {
      if (task.status === TaskStatus.PENDING || task.status === TaskStatus.BLOCKED) {
        task.updateStatus(TaskStatus.RUNNING);
        return;
      }
    }
  }

  #rewriteShellRuntimeToolCall(toolCall) {
    if (toolCall?.name !== 'shell') {
      return null;
    }

    const command = String(toolCall.arguments?.command || '').trim();
    if (!command) {
      return null;
    }

    const parsed = this.#textToolParser
      .parse(`\`\`\`bash\n${command}\n\`\`\``)
      .filter(call => call.name !== 'shell');
    if (parsed.length === 0) {
      return null;
    }

    const replacement = parsed[0];
    this.#debugEvent('Shell tool call rewritten to runtime tool', {
      originalCommand: command,
      replacementTool: replacement.name,
      replacementArguments: replacement.arguments,
    });

    return {
      ...replacement,
      id: toolCall.id,
      source: 'shell_runtime_tool_redirect',
    };
  }

  #summarizePlanProgress(plan) {
    return plan.toJSON().tasks
      .map(task => `- ${task.id}: ${task.status}`)
      .join('\n');
  }

  #currentPlanTaskLabel(plan) {
    const active = Array.from(plan.tasks.values())
      .find(task => task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING || task.status === TaskStatus.BLOCKED);
    return active ? `${active.id} (${active.name})` : 'none';
  }

  #isWorkspaceInspectionTool(toolName, args) {
    if (['list_dir', 'glob', 'search', 'semantic_search'].includes(toolName)) {
      return true;
    }
    if (toolName === 'read_file') {
      return true;
    }
    if (toolName === 'shell') {
      const command = String(args?.command || '');
      return /\b(pwd|ls|find|rg|grep|tree)\b/.test(command);
    }
    return false;
  }

  #isPlanningTool(toolName) {
    return ['brainstorm', 'grill', 'zoom_out', 'tdd', 'to_prd', 'to_issues', 'architect'].includes(toolName);
  }

  #isMutationTool(toolName, args) {
    if (['write_file', 'edit_file', 'git_apply_patch', 'git_commit', 'git_push'].includes(toolName)) {
      return true;
    }
    if (toolName === 'shell') {
      return this.#isShellMutationCommand(args);
    }
    return false;
  }

  #isChangeInspectionTool(toolName, args) {
    if (['read_file', 'list_dir', 'glob', 'search'].includes(toolName)) {
      return true;
    }
    if (toolName === 'shell') {
      const command = String(args?.command || '');
      return /\b(cat|sed|awk|ls|find|rg|grep|git\s+diff|git\s+status)\b/.test(command);
    }
    return false;
  }

  #isVerificationTool(toolName, args) {
    if (['verify', 'review'].includes(toolName)) {
      return true;
    }
    if (toolName === 'shell') {
      const command = String(args?.command || '');
      return this.#isShellVerificationCommand(args) || /\b(test|lint|build|check|typecheck|tsc|node)\b/.test(command);
    }
    return false;
  }

  #isSemanticRiskReviewTool(toolName, args) {
    if (!this.#activeTaskProfile?.requiresSemanticRiskReview) {
      return false;
    }

    const focusText = String(
      args?.focus_areas ||
      args?.criteria ||
      args?.claim ||
      args?.evidence ||
      args?.command ||
      args?.input ||
      args?.text ||
      ''
    ).toLowerCase();
    const mentionsSemanticReview = /semantic|api|unit|timing|time|fps|frame|state|behavior|behaviour|invariant|boundary|语义|单位|时间|速度|状态|行为|边界/.test(focusText);

    if (toolName === 'review') {
      return mentionsSemanticReview || !focusText;
    }
    if (toolName === 'verify') {
      return mentionsSemanticReview;
    }
    if (toolName === 'shell') {
      return mentionsSemanticReview && this.#isShellVerificationCommand(args);
    }
    return false;
  }

  #isShellMutationCommand(args) {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    if (/\bmkdir\b/.test(command) && !/(^|\s)(touch|cp|mv|rm|sed|perl|cat|tee)\b|>|>>|apply_patch/.test(command)) {
      return false;
    }
    return /(^|\s)(bun|npm|pnpm|yarn|npx|node|python|pytest|vitest|jest|eslint|tsc|git|touch|cp|mv|rm|sed|perl|tee)\b|>|>>|apply_patch/.test(command);
  }

  #isShellVerificationCommand(args) {
    const command = String(args?.command || args?.input || args?.text || '').toLowerCase();
    return /\b(test|lint|check|verify|build|typecheck|tsc|jest|vitest|pytest|bun|node|npm|pnpm|yarn)\b/.test(command);
  }

  /**
   * Add tool output back to the conversation in the format expected by the call source.
   */
  #addToolObservation(toolCallId, toolName, result, mode) {
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    // Apply TokenJuice compression if available
    let processedContent = content;
    if (this.#tokenJuice) {
      const compressed = this.#tokenJuice.compressToolResult(content, {
        input: { toolName },
      });
      processedContent = compressed.inlineText || content;
    }

    if (mode === 'tool') {
      this.#sessionManager.addToolResult(toolCallId, toolName, processedContent);
      return;
    }

    this.#sessionManager.addUserMessage(
      `Observation from ${toolName}:\n${processedContent}`
    );
  }

  /**
   * Check if the response indicates termination
   */
  #isTermination(response) {
    if (!response) {
      return false;
    }

    // Explicit termination keywords
    if (TERMINATION_KEYWORDS.some(kw => response.includes(kw))) {
      return true;
    }

    // Empty response detection
    if (response.trim().length === 0) {
      return true;
    }

    // Repeated response detection (prevent infinite loops)
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

  /**
   * Extract the final answer from a termination response
   */
  #extractFinalAnswer(response) {
    for (const keyword of TERMINATION_KEYWORDS) {
      const idx = response.indexOf(keyword);
      if (idx !== -1) {
        return response.substring(idx + keyword.length).trim();
      }
    }
    return response;
  }

  #normalizeFinalAnswer(response) {
    const text = String(response || '').trim();
    if (!text) {
      return text;
    }

    const parsed = this.#parseJSONAnswer(text);
    const doneText = parsed?.action?.done?.text || parsed?.done?.text;
    if (typeof doneText === 'string' && doneText.trim()) {
      return doneText.trim();
    }

    const directText = parsed?.text || parsed?.answer || parsed?.final_answer;
    if (typeof directText === 'string' && directText.trim()) {
      return directText.trim();
    }

    return text;
  }

  #parseJSONAnswer(text) {
    try {
      return JSON.parse(text);
    } catch {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace <= firstBrace) {
        return null;
      }
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  /**
   * Manage context window to prevent overflow
   */
  #manageContextWindow() {
    const maxTokens = this.#modelProvider.getMaxContextTokens();
    const currentTokens = this.#sessionManager.getTokenCount();
    
    // 根据迭代进度渐进式调整裁剪强度
    // 早期：宽松保留上下文；后期：激进裁剪以腾出空间
    const progress = this.#iterationBudget > 0 
      ? this.#sessionManager.getHistory().length / (this.#iterationBudget * 1.5)
      : 0.5;
    
    // 阈值：早期 70% 触发，后期 40% 触发
    const thresholdBase = 0.7;    // 宽松基准
    const thresholdMin = 0.4;     // 激进底线
    const progressFactor = Math.min(progress, 1.0);
    const threshold = maxTokens * (thresholdBase - (thresholdBase - thresholdMin) * progressFactor);
    
    // 保留的消息数：早期 10 条，后期 4 条
    const preserveMessages = Math.max(4, Math.floor(10 - 6 * progressFactor));
    // 目标 token：早期 60%，后期 35%
    const targetRatio = 0.6 - 0.25 * progressFactor;
    const targetTokens = Math.floor(maxTokens * targetRatio);
    const minMessages = Math.max(2, Math.floor(5 - 2 * progressFactor));

    if (currentTokens > threshold) {
      this.#ui.warn(`Context window at ${Math.round(currentTokens / maxTokens * 100)}% (progress=${(progressFactor*100).toFixed(0)}%). Trimming.`);
      this.#debugEvent('Context window trimming', {
        currentTokens, maxTokens, threshold, targetTokens,
        preserveRecentMessages: preserveMessages,
        messagesBefore: this.#sessionManager.getHistory().length,
      });
      let stats = null;
      if (this.#contextPruner) {
        this.#contextPruner.updateConfig?.({ maxTokens, targetTokens, preserveRecentMessages: preserveMessages });
        stats = this.#sessionManager.trimWithPruner(this.#contextPruner, {
          maxTokens, targetTokens, preserveRecentMessages: preserveMessages, minMessages,
        });
      } else {
        this.#sessionManager.trimToContextWindow(targetTokens, { minRecentMessages: preserveMessages });
      }
      this.#debugEvent('Context window trimmed', {
        estimatedTokens: this.#sessionManager.getTokenCount(),
        messagesAfter: this.#sessionManager.getHistory().length,
        stats,
      });
      
      // ============ 注入工作区状态摘要（新功能）============
      // 在上下文裁剪后，注入工作区状态摘要，确保关键信息不会丢失
      this.#injectWorkspaceStateSummary();
    }
  }
  
  /**
   * 注入工作区状态摘要到会话上下文
   * 确保在上下文裁剪后，关键的工作区发现仍然可用
   */
  #injectWorkspaceStateSummary() {
    if (!this.#workspaceStateEnabled || !this.#workspaceState) {
      return;
    }
    
    // 检查是否需要更新缓存
    const now = Date.now();
    const cacheAge = now - this.#lastWorkspaceHintUpdate;
    
    if (cacheAge < 30000 && this.#cachedWorkspaceHint) {
      // 30秒内使用缓存
      if (this.#cachedWorkspaceHint) {
        this.#sessionManager.addSystemMessage(this.#cachedWorkspaceHint);
      }
      return;
    }
    
    // 生成新的摘要
    const hint = this.#generateWorkspaceHint();
    this.#cachedWorkspaceHint = hint;
    this.#lastWorkspaceHintUpdate = now;
    
    if (hint) {
      this.#sessionManager.addSystemMessage(hint);
      this.#debugEvent('Workspace state hint injected', {
        hintLength: hint.length,
      });
    }
  }
  
  /**
   * 生成工作区状态提示
   */
  #generateWorkspaceHint() {
    if (!this.#workspaceState || !this.#observationSummarizer) {
      return '';
    }
    
    const summary = this.#workspaceState.getSummary();
    
    // 如果没有足够的探索数据，不生成提示
    if (summary.trackedFiles === 0 && summary.trackedDirectories === 0) {
      return '';
    }
    
    const criticalFacts = this.#workspaceState.getCriticalFacts();
    const knownNonExistent = criticalFacts
      .filter(f => f.type === 'path_not_found')
      .map(f => f.value?.path)
      .filter(Boolean);
    
    const workspaceDescription = this.#observationSummarizer.generateWorkspaceDescription();
    
    const parts = [];
    parts.push('## 工作区探索状态 (Context Trimmed)');
    parts.push('');
    parts.push(workspaceDescription);
    
    if (knownNonExistent.length > 0) {
      parts.push('');
      parts.push('### 已知不存在的路径 (避免重复尝试)');
      for (const path of knownNonExistent.slice(0, 10)) {
        parts.push(`- ${path}`);
      }
    }
    
    // 添加关键事实
    const importantFacts = criticalFacts
      .filter(f => f.type !== 'path_not_found')
      .slice(-5);
    
    if (importantFacts.length > 0) {
      parts.push('');
      parts.push('### 关键发现');
      for (const fact of importantFacts) {
        const value = typeof fact.value === 'object' 
          ? JSON.stringify(fact.value).substring(0, 100)
          : fact.value;
        parts.push(`- ${fact.type}: ${value}`);
      }
    }
    
    parts.push('');
    parts.push('这些信息来自之前的探索，在上下文裁剪后保留。请利用这些信息避免重复探索。');
    
    return parts.join('\n');
  }

  /**
   * Clear conversation history (keep system prompt and memory)
   * @param {boolean} clearWorkspace - 是否清除工作区状态，默认 false 保留
   */
  clearSession(clearWorkspace = false) {
    this.#sessionManager.clear();
    this.#lastResponse = '';
    this.#repeatCount = 0;

    this.#toolCallHistory = [];
    
    // 可选清除工作区状态
    if (clearWorkspace && this.#workspaceState) {
      this.#workspaceState.clear();
      this.#cachedWorkspaceHint = '';
    }
    
    this.#ui.info?.('Session cleared. Memory preserved.');
  }

  /**
   * Get tool registry for inspection
   */
  getTools() {
    return this.#toolRegistry;
  }

  /**
   * Set model provider (for switching models)
   */
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

  // ============ 工作区状态 getter (新功能) ============
  get workspaceState() {
    return this.#workspaceState;
  }

  get observationSummarizer() {
    return this.#observationSummarizer;
  }

  /**
   * 获取工作区状态摘要
   */
  getWorkspaceSummary() {
    if (!this.#workspaceState) {
      return null;
    }
    return {
      state: this.#workspaceState.getSummary(),
      criticalFacts: this.#workspaceState.getCriticalFacts().map(f => ({
        type: f.type,
        value: f.value,
      })),
      workspaceDescription: this.#observationSummarizer?.generateWorkspaceDescription() || '',
    };
  }

  getLastRunResult() {
    return this.#lastRunResult ? { ...this.#lastRunResult } : null;
  }

  #completeRun({ success, status, answer, reason, iterations, startedAt, error, userInputRequest }) {
    this.#workspaceIndex?.stopPeriodicSync();
    const result = {
      success,
      status,
      answer,
      reason,
      iterations,
      durationMs: Date.now() - startedAt,
      toolEvents: this.#runToolEvents.map(event => ({ ...event })),
   };
    if (error) {
      result.error = error;
    }
    if (userInputRequest) {
      result.userInputRequest = userInputRequest;
    }
    this.#lastRunResult = result;
    return result;
  }

  #isDebugEnabled() {
    if (typeof this.#ui.isDebugEnabled === 'function') {
      return this.#ui.isDebugEnabled();
    }
    return this.#config.debug === true || process.env.DEBUG === 'true';
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
    if (this.#isDebugEnabled()) {
      this.#ui.debug?.(`${label}: ${JSON.stringify(details)}`);
    }
  }

  #preview(value, maxLength = 200) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }

  #contentLength(value) {
    if (typeof value === 'string') {
      return value.length;
    }
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  #shouldCorrectToolRefusal(userInput, responseText) {
    if (this.#toolRegistry.size === 0) {
      return false;
    }

    const input = String(userInput || '').toLowerCase();
    const response = String(responseText || '').toLowerCase();

    const asksForLocalOperation = [
      /当前目录|本地|文件|目录|路径|文件夹|几个|多少|数量|统计|列出|查看|运行|执行|终端|命令/,
      /\b(current directory|working directory|local|filesystem|file system|files?|folders?|directories|path|count|how many|list|show|run|execute|shell|terminal|pwd|ls|find|grep|rg)\b/,
    ].some(pattern => pattern.test(input));

    if (!asksForLocalOperation) {
      return false;
    }

    return [
      /无法|不能|没法|无权|没有权限|无法访问|不能访问|不能查看|不能读取|不能操作/,
      /浏览器助手|网页浏览器|网页.*助手|只能操作.*网页|只能.*浏览器/,
      /cannot|can't|unable|do not have|don't have|no access|not able/,
      /browser assistant|web browser|only.*browser|only.*web/,
    ].some(pattern => pattern.test(response));
  }

  #containsUnparsedToolSyntax(responseText) {
    const response = String(responseText || '');
    return [
      /<tool_code>[\s\S]*?<\/tool_code>/i,
      /<tool_call>[\s\S]*?<\/tool_call>/i,
      /<function_call>[\s\S]*?<\/function_call>/i,
      /```(?:tool|json)?\s*\n\s*\{[\s\S]*?(?:"name"|"action"|"tool")[\s\S]*?\}\s*```/i,
      /\bCALL\s+\/?[A-Za-z_][\w-]*\s*\(/,
    ].some(pattern => pattern.test(response));
  }

  #buildToolSyntaxCorrectionPrompt(responseText) {
    const toolNames = this.#toolRegistry.getAll().map(tool => tool.name).slice(0, 24).join(', ');
    return (
      `Your previous response looked like a tool call, but this runtime could not parse it, so it must not be treated as a final answer.\n` +
      `Previous response:\n${responseText}\n\n` +
      `Use one valid tool-call format now. Prefer: CALL tool_name({"param":"value"}). ` +
      `Available tools include: ${toolNames}. If you are actually finished, respond with FINAL_ANSWER: and summarize the completed work for the user.`
    );
  }

  #buildToolUseCorrectionPrompt(userInput) {
    const toolNames = this.#toolRegistry.getAll().map(tool => tool.name).slice(0, 24).join(', ');
    return (
      `Your previous response incorrectly refused a local/system task. You do have tools available in this agent runtime.\n` +
      `Original user request: ${userInput}\n\n` +
      `Use an appropriate tool now instead of answering from assumptions. Available tools include: ${toolNames}. ` +
      `For filesystem, terminal, PTY, embedding, memory, or browser tasks, choose the matching tool and continue from the observation.`
    );
  }

  #classifyTask(userInput) {
    const input = String(userInput || '').toLowerCase();
    const isCodingTask = [
      /写.*代码|写.*html|写.*js|写.*css|创建.*文件|新建.*文件|修改.*代码|改.*代码|修复|实现|创建|新建|开发|生成|重构|跑.*测试|运行.*测试|集成测试|单元测试|提交|push/,
      /(写一个|做一个|创建|新建|实现|开发).*(工程化|程序|应用|工具|脚本|项目|游戏|网站|页面|系统)/,
      /2048|游戏|浏览器.*应用|网页.*应用/,
      /\b(code|coding|implement|fix|bug|refactor|unit test|integration test|test suite|bun test|run tests?|write tests?|add tests?|html|css|javascript|typescript|commit|push)\b/,
      /\b(create|write|edit|modify|update|change)\b.*\b(file|code|html|css|js|javascript|ts|typescript|component|function|class|module|test)\b/,
    ].some(pattern => pattern.test(input));

    const isModificationTask = [
      /写.*代码|写.*html|写.*js|写.*css|创建.*文件|新建.*文件|修改.*代码|改.*代码|修复|实现|创建|新建|开发|生成|写一个|做一个|放在|中创建|重构|提交|push/,
      /2048.*\.(html|js)\b|\.(html|js)\b.*2048|index\.html|game\.js/,
      /\b(implement|fix|refactor|commit|push)\b/,
      /\b(create|write|edit|modify|update|change)\b.*\b(file|code|html|css|js|javascript|ts|typescript|component|function|class|module|test)\b/,
    ].some(pattern => pattern.test(input));

    const isBugTask = [
      /bug|error|exception|failed|failing|broken|hang|stuck|报错|错误|失败|崩溃|卡住|没响应|没有响应|修复/,
    ].some(pattern => pattern.test(input));

    const isLikelyTrivial = [
      /typo|拼写|文案|注释|comment|rename only|只改名/,
      /简单|小.*(文件|页面|html)|单个.*(文件|页面|html)|独立.*(文件|页面|html)|直接.*(创建|写入|写)|demo|示例|standalone|single[- ]file|simple/,
      /(创建|新建|写).*(html\s*文件|\.html)/,
      /\.html\b.*\b(write[_ -]?file|writefile|read[_ -]?file|readfile)\b/,
    ].some(pattern => pattern.test(input));

    const mentionsMultipleArtifacts = [
      /多个|拆分|分离|html.*js|js.*html|和.*中创建|目录|文件|css|测试|文档|接口|controller|route|schema|resolver/,
      /\b(multiple|separate|split|html.*js|js.*html|css|tests?|docs?|route|controller|schema|resolver|endpoint|component|service)\b/,
    ].some(pattern => pattern.test(input));
    const likelyFeatureWork = [
      /实现|创建|新建|写一个|做一个|开发|生成/,
      /\b(implement|create|build|write|develop|generate|add)\b/,
    ].some(pattern => pattern.test(input));
    const requiresAutomaticPlanning = isCodingTask &&
      isModificationTask &&
      !isLikelyTrivial &&
      (mentionsMultipleArtifacts || likelyFeatureWork || isBugTask);

    const semanticRiskDomains = this.#inferSemanticRiskDomains(userInput);
    const requiresSemanticRiskReview = isCodingTask &&
      isModificationTask &&
      semanticRiskDomains.length > 0 &&
      !isLikelyTrivial;

    return {
      isCodingTask,
      isModificationTask,
      isBugTask,
      isLikelyTrivial,
      requiresAutomaticPlanning,
      requiresSemanticRiskReview,
      semanticRiskDomains,
    };
  }

  #inferSemanticRiskDomains(userInput) {
    const text = String(userInput || '');
    return SEMANTIC_RISK_DOMAINS
      .filter(domain => domain.pattern.test(text))
      .map(({ id, label, checklist }) => ({ id, label, checklist }));
  }

  #buildSemanticRiskGuidance() {
    const domains = this.#activeTaskProfile?.semanticRiskDomains || [];
    if (domains.length === 0) {
      return '';
    }

    const checklist = domains
      .map(domain => `- ${domain.label}: ${domain.checklist}`)
      .join('\n');

    return (
      `Semantic/API risk review is required before completion because this task touches high-risk behavior semantics.\n` +
      `Risk domains:\n${checklist}\n` +
      `Do not hardcode isolated API trivia. Instead, inspect the changed code and verify whether variable units, API parameter meanings, state transitions, and user-visible behavior match the requested intent. ` +
      `Prefer CALL review({"file_path":"...","focus_areas":"semantic API semantics, units, timing, state invariants, behavior verification"}) on changed files, then run behavior-level verification.`
    );
  }

  // ---------------------------------------------------------------
  // Verification strategy: read package.json (or known project files)
  // and map changed file extensions -> recommended shell commands.
  // Returns a short human-readable recommendation string.
  // ---------------------------------------------------------------
  async #suggestVerificationStrategy(userInput) {
    try {
      const workingDirectory = this.#config.workingDirectory || process.cwd();
      const pkgPath = `${workingDirectory}/package.json`;
      const changedFiles = this.#extractRequestedFilePaths(userInput);

      // Infer file types from user-input file paths
      const extensions = new Set();
      for (const p of changedFiles) {
        const m = p.match(/\.[a-zA-Z0-9]+$/);
        if (m) extensions.add(m[0].toLowerCase());
      }

      let recommendedCommands = [];
      let packageInfo = null;

      // 1) Try package.json scripts
      if (existsSync(pkgPath)) {
        try {
          const raw = await readFile(pkgPath, 'utf-8');
          const pkg = JSON.parse(raw);
          packageInfo = { scripts: pkg.scripts || {} };
          const scripts = pkg.scripts || {};
          // Order by priority: test > lint > build > typecheck > check
          const priority = [
            ['test', /^(test|tests?|spec)$/i],
            ['lint', /^(lint|linting|eslint|stylelint)$/i],
            ['build', /^(build|compile|bundle|build:.*)$/i],
            ['typecheck', /^(type.?check|tsc|typecheck:.*|check)$/i],
            ['start', /^(start|dev|serve)$/i],
          ];
          for (const [label, regex] of priority) {
            const name = Object.keys(scripts).find(s => regex.test(s));
            if (name) {
              recommendedCommands.push(`npm run ${name}  # ${label}`);
            }
          }
          // Fallback if nothing matched but scripts exist
          if (recommendedCommands.length === 0 && Object.keys(scripts).length > 0) {
            const first = Object.keys(scripts)[0];
            recommendedCommands.push(`npm run ${first}  # first available script`);
          }
        } catch {
          // JSON parse errors are non-fatal; continue without package.json hints
        }
      }

      // 2) Fall back to extension-based heuristics
      const extBasedCommands = [];
      for (const ext of extensions) {
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          extBasedCommands.push('node --check <file>  # syntax check');
          extBasedCommands.push('npx tsc --noEmit  # typecheck');
          extBasedCommands.push('npm test  # if tests exist');
        } else if (['.py'].includes(ext)) {
          extBasedCommands.push('python -c "import py_compile; py_compile.compile(\'<file>\', doraise=True)"  # syntax check');
          extBasedCommands.push('pytest  # if tests exist');
        } else if (['.go'].includes(ext)) {
          extBasedCommands.push('go build ./...');
          extBasedCommands.push('go test ./...');
        } else if (['.rs'].includes(ext)) {
          extBasedCommands.push('cargo check');
          extBasedCommands.push('cargo test');
        } else if (['.java'].includes(ext)) {
          extBasedCommands.push('mvn test');
        }
      }

      // 3) Detect "non-verifiable" files (markdown, plain data, config without tests)
      const verificationHintExts = new Set();
      let unverifiableExts = [];
      for (const ext of extensions) {
        if (['.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.csv'].includes(ext)) {
          verificationHintExts.add(ext);
        }
      }
      for (const ext of verificationHintExts) {
        if (['.json', '.yml', '.yaml', '.toml'].includes(ext)) {
          // JSON/YAML/TOML can at least be parsed
          if (ext === '.json') extBasedCommands.push('node -e "JSON.parse(require(\'fs\').readFileSync(\'<file>\',\'utf8\'))"  # syntax check JSON');
        } else {
          // markdown/txt - no sensible runtime command
          unverifiableExts.push(ext);
        }
      }

      // Compose the prompt
      const lines = [];
      if (packageInfo) {
        const scripts = Object.keys(packageInfo.scripts).slice(0, 6);
        lines.push(`Detected package.json. Relevant scripts: ${scripts.join(', ') || '(none)'}.`);
      }
      if (recommendedCommands.length > 0) {
        lines.push('Recommended verification commands (from package.json):');
        for (const c of recommendedCommands.slice(0, 4)) lines.push(`  - ${c}`);
      }
      if (extBasedCommands.length > 0) {
        lines.push('File-extension-based verification commands:');
        for (const c of extBasedCommands.slice(0, 6)) lines.push(`  - ${c}`);
      }
      if (unverifiableExts.length > 0) {
        lines.push(`Files with extensions ${unverifiableExts.join(', ')} may not have meaningful runtime verification; ` +
                    'use read_file to inspect correctness instead of claiming "tested".');
      }
      if (lines.length === 0) {
        lines.push('Before finishing, run a shell command that exercises your changes (for example: a test, linter, typechecker, or build).');
      }
      return lines.join('\n');
    } catch {
      return 'Before finishing, run a shell command that exercises your changes (for example: a test, linter, typechecker, or build).';
    }
  }

  #buildCodingTaskOperatingPrompt(userInput) {
    // NOTE: the verification strategy helper is async; the caller prepends it
    // into the same user-message via `await`. We build it lazily in run().
    const hasMethodologyTools = this.#hasAnyTool(METHODOLOGY_TOOLS);
    const methodologyLine = hasMethodologyTools
      ? 'Use the built-in methodology tools proactively when they fit: setup only when project context is missing, coverage_check before uncertain/RAG/web answers, diagnose for bugs, grill/zoom_out for unclear or shared changes, brainstorm/tdd before implementation when non-trivial, to_prd/to_issues for formal planning, review after editing, and verify before completion. For a small standalone file creation, do not run setup repeatedly; write the file and inspect it.'
      : 'Use the same methodology directly in your reasoning because methodology tools are not registered in this runtime.';

    return (
      `Coding task mode is active for the previous user request:\n${userInput}\n\n` +
      `Act like a responsible coding agent. First understand the repo with tools, then make the smallest necessary change, then verify with fresh evidence.\n` +
      `${methodologyLine}\n` +
      `${this.#activeTaskProfile?.requiresSemanticRiskReview ? `${this.#buildSemanticRiskGuidance()}\n` : ''}` +
      `For file creation or file edits, prefer write_file/edit_file directly when available; shell is for inspection, commands, and verification, not a substitute for editing files.\n` +
      `Strict verification rules — read these carefully and obey them every time:\n` +
      `1. Any code/file you write or edit MUST be inspected after creation (read_file, list_dir, or equivalent) to confirm the content matches your intent.\n` +
      `2. Inspection-only tools (read_file, list_dir, glob, search, semantic_search, review) are NOT runtime verification. Reading your own file back proves only that the file was written; it does NOT prove the code runs, compiles, passes tests, or behaves correctly.\n` +
      `3. True runtime verification means executing code against a real tool / shell command. Acceptable runtime verification evidence includes: a test runner (jest, vitest, pytest, cargo test, go test, mvn test, etc.), a linter (eslint, tsc --noEmit, flake8, golangci-lint, etc.), a build / compile step (npm run build, tsc, cargo build, go build, webpack, etc.), a node/python/go/java script that exercises the changed code, or the verify tool.\n` +
      `4. After every successful mutation (write_file, edit_file, shell/pty that writes code), you MUST produce at least one successful runtime verification observation before FINAL_ANSWER. Do not finish the task by only reading the file back.\n` +
      `5. If verification fails (tests fail, build errors, lint errors), fix the failure and re-verify. Do not report "completed" while verification is failing or un-run.\n` +
      `6. For files that cannot be run (pure data: .md, .txt, etc.), inspect the file with read_file/list_dir/parsing and honestly report that verification is inspection-only; do not claim "tested" or "verified" for a markdown or plain-text file.\n` +
      `7. The verify tool, if available, is especially valuable after editing because it produces an evidence-based report. Consider calling verify on the changed paths near the end of the task.\n` +
      `8. When this task has semantic risk domains (units/timing, API semantics, state transitions, concurrency/IO, security boundaries), run dedicated review or verification that exercises those behaviors, not just a syntax check.\n` +
      `Final answers must explicitly mention: (a) what files changed and how, (b) which runtime verification step was run and what it reported (command + outcome), and (c) any caveats or open issues. Never state "it works" without fresh runtime verification evidence from this session.`
    );
  }

  #shouldBlockCodingFinal(userInput, responseText) {
    if (!this.#activeTaskProfile?.isCodingTask) {
      return { block: false };
    }

    const text = String(responseText || '').trim();
    if (!text) {
      return { block: false };
    }

    const successfulEvents = this.#runToolEvents.filter(event => event.success);
    const methodologyEvents = successfulEvents.filter(event => METHODOLOGY_TOOLS.has(event.name));
    const mutationEvents = successfulEvents.filter(event => this.#isMutationEvent(event));
    const verificationEvents = successfulEvents.filter(event => this.#isVerificationEvent(event));
    const semanticRiskReviewEvents = successfulEvents.filter(event => this.#isSemanticRiskReviewEvent(event));
    const hasMethodologyTools = this.#hasAnyTool(METHODOLOGY_TOOLS);
    const hasFileWriteTool = this.#toolRegistry.has('write_file') || this.#toolRegistry.has('edit_file');

    const evidence = {
      methodologyTools: methodologyEvents.map(event => event.name),
      mutationTools: mutationEvents.map(event => event.name),
      verificationTools: verificationEvents.map(event => event.name),
      semanticRiskReviewTools: semanticRiskReviewEvents.map(event => event.name),
    };

    if (this.#activeExecutionPlan && this.#activeExecutionPlan.status !== TaskStatus.COMPLETED) {
      return {
        block: true,
        reason: 'automatic_plan_incomplete',
        evidence: {
          ...evidence,
          automaticPlan: this.#summarizePlanProgress(this.#activeExecutionPlan),
        },
      };
    }

    if (successfulEvents.length === 0) {
      return { block: true, reason: 'no_tool_evidence', evidence };
    }

    if (hasMethodologyTools && !this.#activeTaskProfile.isLikelyTrivial && methodologyEvents.length === 0) {
      return { block: true, reason: 'missing_methodology_step', evidence };
    }

    if (hasFileWriteTool && this.#activeTaskProfile.isModificationTask && mutationEvents.length === 0) {
      return { block: true, reason: 'missing_code_change', evidence };
    }

    if (mutationEvents.length > 0 && verificationEvents.length === 0) {
      return { block: true, reason: 'missing_verification', evidence };
    }

    if (
      this.#activeTaskProfile.requiresSemanticRiskReview &&
      mutationEvents.length > 0 &&
      semanticRiskReviewEvents.length === 0
    ) {
      return { block: true, reason: 'missing_semantic_risk_review', evidence };
    }

    const claimsDone = /done|completed|successfully|created|updated|fixed|implemented|完成|已完成|成功|创建|修改|修复|实现/.test(text.toLowerCase());
    const mentionsVerification = /test|verify|verified|check|passed|validation|验证|测试|检查|通过/.test(text.toLowerCase());
    if (mutationEvents.length > 0 && claimsDone && !mentionsVerification) {
      return { block: true, reason: 'final_answer_missing_verification_summary', evidence };
    }

    return { block: false, evidence };
  }

  #buildCodingCompletionGatePrompt(userInput, gate) {
    const reasonText = {
      no_tool_evidence: 'You are trying to finish a coding task without any successful tool evidence.',
      missing_methodology_step: 'You have not used the built-in coding methodology yet.',
      missing_code_change: 'You have not produced a successful code/file change yet.',
      missing_verification: 'You changed code/files but have not verified the result with fresh evidence.',
      missing_semantic_risk_review: 'This task touches high-risk behavior semantics but has no semantic/API risk review evidence yet.',
      final_answer_missing_verification_summary: 'Your final answer claims completion but does not summarize verification.',
      automatic_plan_incomplete: 'The automatic task orchestration plan is not complete yet.',
    }[gate.reason] || gate.reason;

    return (
      `Coding completion gate blocked the final answer.\n` +
      `Original user request: ${userInput}\n` +
      `Reason: ${reasonText}\n` +
      `Evidence so far: ${JSON.stringify(gate.evidence)}\n\n` +
      `${this.#activeTaskProfile?.requiresSemanticRiskReview ? `${this.#buildSemanticRiskGuidance()}\n` : ''}` +
      `Continue working now. If this task creates or modifies a file and write_file/edit_file is available, call write_file or edit_file next to make the change. Inspect your own changes, run a relevant verification command or verify tool, and only then answer with FINAL_ANSWER including what changed and what passed.`
    );
  }

  #hasAnyTool(toolNames) {
    for (const name of toolNames) {
      if (this.#toolRegistry.has(name)) {
        return true;
      }
    }
    return false;
  }

  #isMutationEvent(event) {
    if (!MUTATION_TOOLS.has(event.name)) {
      return false;
    }

    if (event.name === 'shell' || event.name === 'pty_start' || event.name === 'pty_write') {
      const command = String(event.args?.command || event.args?.input || event.args?.text || '').toLowerCase();
      return /(^|\s)(bun|npm|pnpm|yarn|npx|node|python|pytest|vitest|jest|eslint|tsc|git|mkdir|touch|cp|mv|rm|sed|perl)\b|>|>>|apply_patch/.test(command);
    }

    return true;
  }

  #isVerificationEvent(event) {
    if (!VERIFICATION_TOOLS.has(event.name)) {
      return false;
    }

    if (event.name === 'shell' || event.name === 'pty_start' || event.name === 'pty_read') {
      const command = String(event.args?.command || event.args?.input || event.args?.text || '').toLowerCase();
      return /\b(test|lint|check|verify|build|typecheck|tsc|jest|vitest|pytest|bun|node|npm|pnpm|yarn|cat|sed|ls|find|rg)\b/.test(command);
    }

    return true;
  }

  #isSemanticRiskReviewEvent(event) {
    return this.#isSemanticRiskReviewTool(event.name, event.args);
  }

  /**
   * Format helpful error message when tool not found
   * @private
   */
  #formatToolNotFoundError(toolName) {
    const allTools = this.#toolRegistry.getAll();
    const availableToolNames = allTools.map(t => t.name).join(', ');
    
    // Check for common browser/navigation related tool names
    const browserToolPatterns = ['navigate', 'browse', 'browser', 'web', 'url', 'fetch', 'get_weather'];
    const isBrowserTool = browserToolPatterns.some(pattern => 
      toolName.toLowerCase().includes(pattern)
    );
    
    let errorMsg = `Unknown tool: "${toolName}". Available tools: ${availableToolNames}`;
    
    if (isBrowserTool) {
      errorMsg += `\n\nℹ️  It looks like you're trying to use a browser/web tool. `;
      errorMsg += `These tools are provided by MCP servers. `;
      errorMsg += `Try using:\n`;
      errorMsg += `  1. Use "mcp_list_servers" to see connected MCP servers\n`;
      errorMsg += `  2. Use "mcp_list_tools" to see all available MCP tools\n`;
      errorMsg += `  3. If no browser server is connected, use "mcp_connect" to connect one`;
    }
    
    // Check if there are MCP tools available
    const mcpTools = allTools.filter(t => t.name.includes('/') || t.name.startsWith('mcp_'));
    if (mcpTools.length > 0 && toolName.includes('/') === false && !toolName.startsWith('mcp_')) {
      // Check if any MCP tool has a similar name
      const similarTools = mcpTools.filter(t => 
        t.name.toLowerCase().includes(toolName.toLowerCase().split('/').pop())
      );
      if (similarTools.length > 0) {
        errorMsg += `\n\n💡  Did you mean one of these? ${similarTools.map(t => t.name).join(', ')}`;
      }
    }
    
    return errorMsg;
  }


  /**
   * 根据任务复杂度计算自适应迭代预算
   * 核心原则：够用就好，不用浪费；也不限制复杂任务
   */
  #computeIterationBudget(taskProfile) {
    const maxIterations = this.#config.maxIterations || MAX_ITERATIONS_DEFAULT;
    let ratio;

    if (!taskProfile) {
      ratio = ITERATION_BUDGET.normal;
    } else if (taskProfile.isLikelyTrivial) {
      ratio = ITERATION_BUDGET.trivial;
    } else if (!taskProfile.isCodingTask) {
      ratio = ITERATION_BUDGET.simple;
    } else if (taskProfile.requiresAutomaticPlanning || taskProfile.isBugTask) {
      ratio = ITERATION_BUDGET.intensive;
    } else if (taskProfile.isCodingTask) {
      ratio = ITERATION_BUDGET.normal;
    } else {
      ratio = ITERATION_BUDGET.normal;
    }

    return Math.max(1, Math.round(maxIterations * ratio));
  }

  /**
   * 记录工具调用到停滞检测滑动窗口
   * 跟踪工具类型和是否执行了修改操作
   */
  #recordToolCallForStagnation(toolResult, iteration) {
    if (!toolResult || !toolResult.name) { return; }
    const isMutation = this.#isMutationTool(toolResult.name, toolResult);
    this.#stagnationWindow.push({
      toolName: toolResult.name,
      iteration,
      isMutation,
    });
    if (this.#stagnationWindow.length > STAGNATION_LOOKBACK) {
      this.#stagnationWindow.shift();
    }
    if (isMutation) {
      this.#lastMutationIteration = iteration;
    }
  }

  /**
   * 停滞检测与进度检查点注入
   *
   * 不直接终止 Agent，而是注入一个 nudge 消息让 LLM 意识到
   * 当前效率低下的模式，自行调整策略。
   *
   * 检测三种停滞模式：
   * 1. 工具调用停滞：同一类工具连续重复多次
   * 2. 零进展停滞：长时间无修改操作
   * 3. 进度检查点：定期提示 LLM 总结进展
   *
   * 超过 MAX_STAGNATION_NUDGES 次后，降级迭代预算以节约 token
   */
  #injectStagnationNudge(iteration, maxIterations) {
    if (iteration < 3) { return; } // 前 3 轮不检测

    // 检查是否已达到进度检查点间隔
    if (iteration % PROGRESS_CHECKPOINT_INTERVAL === 0) {
      this.#activeProgressCheckpoints++;
      const planStatus = this.#activeExecutionPlan
        ? this.#summarizePlanProgress(this.#activeExecutionPlan)
        : 'not available';
      this.#sessionManager.addUserMessage(
        `[Progress checkpoint @iter ${iteration}/${maxIterations}]
Plan status:
${planStatus}
If you have enough information to answer, provide FINAL_ANSWER now.
If you are stuck, try a fundamentally different approach instead of repeating the same pattern.`
      );
      return;
    }

    // 当迭代预算被降级后，不再注入 nudge
    if (this.#consecutiveSameTool >= STAGNATION_SAME_TOOL_LIMIT ||
        this.#stagnationWindow.length >= STAGNATION_LOOKBACK) {
      if (this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT < iteration) {
        // 已尝试过最大 nudge 次数？降级预算
        if (this.#lastStagnationNudge >= MAX_STAGNATION_NUDGES) {
          this.#iterationBudget = Math.min(this.#iterationBudget, Math.ceil(maxIterations * 0.4));
        }
      }
    }

    // 模式 1：相同工具类型连续重复
    const window = this.#stagnationWindow;
    if (window.length >= STAGNATION_SAME_TOOL_LIMIT) {
      const recentTools = window.slice(-STAGNATION_SAME_TOOL_LIMIT);
      const uniqueTools = new Set(recentTools.map(t => t.toolName));
      if (uniqueTools.size <= 2 && window.every(t => !t.isMutation)) {
        this.#lastStagnationNudge++;
        const toolList = [...uniqueTools].join(', ');
        this.#sessionManager.addUserMessage(
          `[Efficiency note] You have called ${toolList} repeatedly for ${STAGNATION_SAME_TOOL_LIMIT} consecutive iterations with no modifications.
Consider: (1) call a different tool to make progress, (2) provide FINAL_ANSWER if you already have enough information, or (3) ask the user for clarification.`
        );
        this.#consecutiveSameTool = 0;
        return;
      }
    }

    // 模式 2：长时间无修改操作
    if (this.#lastMutationIteration > 0 &&
        this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT <= iteration &&
        window.length >= STAGNATION_NO_MUTATION_LIMIT) {
      this.#lastStagnationNudge++;
      const planStatus = this.#activeExecutionPlan
        ? this.#summarizePlanProgress(this.#activeExecutionPlan)
        : 'not available';
      this.#sessionManager.addUserMessage(
        `[Efficiency note] No modifications were made in the last ${STAGNATION_NO_MUTATION_LIMIT} iterations.
Plan status:
${planStatus}
If you are still investigating, try narrowing your search. Otherwise, provide FINAL_ANSWER with what you have found so far.`
      );
      this.#lastMutationIteration = iteration;
    }
  }

  /**
   * 预热工作目录索引
   * WorkspaceIndex.warm() 自动处理：加载缓存 → 增量同步 → 全量构建
   * 返回项目文件结构摘要，注入到 Agent 上下文
   */
  async #warmWorkspaceCache() {
    try {
      return await this.#workspaceIndex.warm();
    } catch (err) {
      this.#debugEvent('WorkspaceIndex warmup failed', { error: err.message });
      return '';
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.#modelProvider.dispose();
  }
}
