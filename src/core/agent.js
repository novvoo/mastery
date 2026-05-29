/**
 * ReAct Agent Engine
 * Core reasoning loop: Thought -> Action -> Observation -> repeat
 */

import { ToolRegistry } from './tool-registry.js';
import { SessionManager } from './session-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { classifyError, RetryStrategy, withTimeout } from '../errors/error-handler.js';
import { ui } from '../cli/ui.js';
import { TextToolParser } from './text-tool-parser.js';

const TERMINATION_KEYWORDS = ['FINAL_ANSWER:', 'Answer:', 'TASK_COMPLETE'];
const MAX_ITERATIONS_DEFAULT = 30;

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
  /** @type {string[]} */
  #toolCallHistory = [];
  /** @type {Map<string, string>} */
  #toolResultCache = new Map();
  /** @type {TextToolParser} */
  #textToolParser;

  constructor(modelProvider, toolRegistry, memoryManager, config = {}, customUI = ui) {
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry;
    this.#memoryManager = memoryManager;
    this.#config = {
      maxIterations: config.maxIterations || MAX_ITERATIONS_DEFAULT,
      workingDirectory: config.workingDirectory || process.cwd(),
      ...config,
    };
    this.#sessionManager = new SessionManager();
    this.#retryStrategy = new RetryStrategy();
    this.#textToolParser = new TextToolParser(toolRegistry);
    this.#ui = customUI;
  }

  /**
   * Run the agent with a user input
   */
  async run(userInput) {
    const runStartedAt = Date.now();
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

    // Add user message
    this.#sessionManager.addUserMessage(userInput);

    // Reset tracking
    this.#lastResponse = '';
    this.#repeatCount = 0;
    this.#toolCallHistory = [];

    let iteration = 0;
    const maxIterations = this.#config.maxIterations || MAX_ITERATIONS_DEFAULT;
    let toolUseCorrections = 0;

    while (iteration < maxIterations) {
      iteration++;
      this.#ui.iteration(iteration, maxIterations);
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
        const functions = this.#toolRegistry.toFunctionDefinitions();

        // Call LLM with retry
        const llmStartedAt = Date.now();
        this.#debugEvent('LLM request', {
          modelProvider: this.#modelProvider.constructor?.name || 'unknown',
          messageCount: messages.length,
          toolDefinitions: functions.length,
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

        // Check for termination
        if (this.#isTermination(response.text)) {
          const answer = this.#extractFinalAnswer(response.text);
          this.#debugEvent('Final answer emitted', {
            iteration,
            totalDurationMs: Date.now() - runStartedAt,
            answerPreview: this.#preview(answer, 300),
          });
          this.#ui.finalAnswer(answer);
          this.#sessionManager.addAssistantMessage(response.text);
          return;
        }

        // OpenAI-compatible models often finish naturally without following the
        // explicit FINAL_ANSWER marker. If the provider says the response is
        // complete and no tool call is present, surface it instead of making a
        // hidden continuation request that looks like a hang in the terminal.
        if (allToolCalls.length === 0 && response.finishReason === 'stop' && response.text?.trim()) {
          this.#debugEvent('Final answer emitted', {
            iteration,
            totalDurationMs: Date.now() - runStartedAt,
            reason: 'provider_stop_without_tool_calls',
            answerPreview: this.#preview(response.text, 300),
          });
          this.#ui.finalAnswer(response.text.trim());
          this.#sessionManager.addAssistantMessage(response.text);
          return;
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
            await this.#executeToolCall(toolCall, { resultMode: 'tool' });
          }
        } else {
          this.#sessionManager.addAssistantMessage(response.text);
        }

        for (const toolCall of parsedToolCalls) {
          await this.#executeToolCall(toolCall, { resultMode: 'observation' });
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
          return;
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
  }

  /**
   * Execute a single tool call
   */
  async #executeToolCall(toolCall, options = {}) {
    const { id, name, arguments: args } = toolCall;
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
      return;
    }
    this.#toolCallHistory.push(callSignature);
    // Keep history manageable
    if (this.#toolCallHistory.length > 50) {
      this.#toolCallHistory = this.#toolCallHistory.slice(-25);
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
      return;
    }

    this.#debugEvent('Tool call started', {
      id,
      tool: name,
      category: tool.category,
      source: toolCall.source || 'native',
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
        debug: this.#isDebugEnabled(),
        ui: this.#ui,
        toolName: name,
      };

      const result = await withTimeout(
        () => tool.handler(args, context),
        60000, // 1 minute timeout per tool
        `Tool ${name}`
      );

      this.#debugEvent('Tool call completed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        resultChars: this.#contentLength(result),
        resultPreview: this.#preview(typeof result === 'string' ? result : JSON.stringify(result), 300),
      });
      this.#ui.toolResult(name, result);
      this.#toolResultCache.set(callSignature, typeof result === 'string' ? result : JSON.stringify(result));
      this.#addToolObservation(id, name, result, resultMode);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.#debugEvent('Tool call failed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        error: errorMsg,
      });
      this.#ui.toolError(name, errorMsg);
      this.#toolResultCache.set(callSignature, `Error: ${errorMsg}`);
      this.#addToolObservation(id, name, `Error: ${errorMsg}`, resultMode);
    }
  }

  /**
   * Add tool output back to the conversation in the format expected by the call source.
   */
  #addToolObservation(toolCallId, toolName, result, mode) {
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    if (mode === 'tool') {
      this.#sessionManager.addToolResult(toolCallId, toolName, content);
      return;
    }

    this.#sessionManager.addUserMessage(
      `Observation from ${toolName}:\n${content}`
    );
  }

  /**
   * Check if the response indicates termination
   */
  #isTermination(response) {
    if (!response) return false;

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

  /**
   * Manage context window to prevent overflow
   */
  #manageContextWindow() {
    const maxTokens = this.#modelProvider.getMaxContextTokens();
    const currentTokens = this.#sessionManager.getTokenCount();
    const threshold = maxTokens * 0.8;

    if (currentTokens > threshold) {
      this.#ui.warn(`Context window at ${Math.round(currentTokens / maxTokens * 100)}%. Trimming old messages.`);
      this.#debugEvent('Context window trimming', {
        currentTokens,
        maxTokens,
        threshold,
        messagesBefore: this.#sessionManager.getHistory().length,
      });
      this.#sessionManager.trimToContextWindow(maxTokens * 0.6, { minRecentMessages: 6 });
      this.#debugEvent('Context window trimmed', {
        estimatedTokens: this.#sessionManager.getTokenCount(),
        messagesAfter: this.#sessionManager.getHistory().length,
      });
    }
  }

  /**
   * Clear conversation history (keep system prompt and memory)
   */
  clearSession() {
    this.#sessionManager.clear();
    this.#lastResponse = '';
    this.#repeatCount = 0;
    this.#toolCallHistory = [];
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
  setModelProvider(modelProvider) {
    this.#modelProvider = modelProvider;
  }

  setDebugMode(enabled) {
    this.#config.debug = Boolean(enabled);
    if (typeof this.#ui.setDebugMode === 'function') {
      this.#ui.setDebugMode(enabled);
    }
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

  #buildToolUseCorrectionPrompt(userInput) {
    const toolNames = this.#toolRegistry.getAll().map(tool => tool.name).slice(0, 24).join(', ');
    return (
      `Your previous response incorrectly refused a local/system task. You do have tools available in this agent runtime.\n` +
      `Original user request: ${userInput}\n\n` +
      `Use an appropriate tool now instead of answering from assumptions. Available tools include: ${toolNames}. ` +
      `For filesystem, terminal, PTY, embedding, memory, or browser tasks, choose the matching tool and continue from the observation.`
    );
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
   * Dispose of resources
   */
  dispose() {
    this.#modelProvider.dispose();
  }
}
