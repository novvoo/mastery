#!/usr/bin/env bun
/**
 * AI Engineering Mastery Agent
 * 主入口点 - 使用新架构 Runtime Layer
 */

import { clearLine, createInterface, cursorTo, emitKeypressEvents } from 'readline';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { input, password, select } from '@inquirer/prompts';
import { getProviderApiKey, loadCliConfig } from './agent-config.js';
import {
  assertSupportedProvider,
  createConfiguredModelProvider,
  createModelProviderForSwitch,
} from './model-provider-factory.js';

// 新架构导入 - Runtime Layer
import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  RuntimeEvent
} from '../runtime/index.js';

// Core imports - 核心模块导入（旧架构）
import { ToolCategory } from '../core/types.js';
import { Embedder } from '../core/embedder.js';
import {
  applyRuntimeValues,
  buildMissingConfigMessage,
  getMissingRequiredConfig,
  getProviderBaseUrl,
  getProviderModel,
  getProviderRequirement,
  getUserEnvPath,
  loadRuntimeEnv,
  writeUserEnv,
} from '../core/runtime-config.js';

// Tool imports - 工具导入
import { stopAllPtySessions } from '../tools/system/pty.js';

// UI imports - UI 组件导入
import { enhancedUI } from './enhanced-ui.js';
import { createEnhancedCommands } from './enhanced-commands.js';
import { COMMAND_HELP, COMMAND_HELP_ALIASES } from './command-help.js';
import { getPackageVersion, printCliHelp, runDoctor } from './bootstrap-utils.js';
import {
  chooseDocumentFile,
  extractDocumentReferences,
  formatBytes,
  stripWrappingQuotes,
} from './document-command-utils.js';
import { listPreviews, startPreview, stopPreview } from '../core/preview-server.js';
import {
  buildSlashCommandSuggestions,
  completeSlashCommand,
  formatSlashCommandSuggestions,
  filterSlashCommandSuggestions,
} from './slash-command-suggestions.js';

// Load environment variables from the user config and the current workspace.
// 加载环境变量
loadRuntimeEnv();

/**
 * Main application class
 */
class AIEngineeringAgent {
  #sigintCount = 0;
  #sigintTimer = null;
  #sigintHandler = null;

  constructor() {
    this.config = this.#loadConfig();
    this.workingDir = this.config.workingDir;
    this.engine = null;
    this.schedulerEngine = null;
    this.commands = null;
    this.rl = null;
    this.isRunning = false;
    this.mcpClient = null;
    this.tokenJuice = null;
    this.experienceMemory = null;
    this.securityPolicy = null;
    this.intelligentReasoning = null;
    this.automationEngine = null;
    this.debugMode = this.config.debug;
    this.modelProvider = null;
    this.rlClosed = false;
    this.inputQueue = [];
    this.isProcessingInput = false;
    this.shutdownStarted = false;
    this.slashCommandSuggestions = [];
    this.lastSlashSuggestionKey = '';
    this.slashSuggestionsInstalled = false;
  }

  /**
   * Load configuration from environment
   */
  #loadConfig() {
    return loadCliConfig();
  }

  /**
   * Initialize MCP servers from environment configuration
   * @private
   */
  async #initializeMCPServers(toolRegistry) {
    const mcpConfigs = [];

    // Parse MCP configurations from environment variables
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('MCP_') && key.endsWith('_ENABLED') && value === 'true') {
        const prefix = key.replace('_ENABLED', '');
        const name = prefix.replace('MCP_', '').toLowerCase();
        const command = process.env[`${prefix}_COMMAND`];
        const argsStr = process.env[`${prefix}_ARGS`] || '';
        const envStr = process.env[`${prefix}_ENV`] || '{}';

        if (command) {
          try {
            const args = argsStr.split(',').filter(Boolean);
            const env = JSON.parse(envStr);
            mcpConfigs.push({ name, command, args, env });
          } catch (error) {
            console.error(`Failed to parse MCP config for ${name}:`, error.message);
          }
        }
      }
    }

    // 监听服务器连接事件，自动注册工具
    this.mcpClient.on('serverConnected', (name) => {
      this.#registerMCPTools(toolRegistry, name);
    });

    // Connect to configured servers
    if (mcpConfigs.length > 0) {
      console.log(enhancedUI.theme.dim(`  ℹ️  Connecting to ${mcpConfigs.length} MCP server(s)...`));
      
      for (const config of mcpConfigs) {
        try {
          const success = await this.mcpClient.connect(config.name, {
            command: config.command,
            args: config.args,
            env: config.env,
          });
          
          if (success) {
            console.log(enhancedUI.theme.success(`  ✓ Connected to MCP server: ${config.name}`));
            // 手动注册工具
            this.#registerMCPTools(toolRegistry, config.name);
          } else {
            console.log(enhancedUI.theme.error(`  ✗ Failed to connect to MCP server: ${config.name}`));
          }
        } catch (error) {
          console.log(enhancedUI.theme.error(`  ✗ MCP connection error (${config.name}): ${error.message}`));
        }
      }
    }
  }

  /**
   * 将MCP服务器的工具注册到工具注册表中
   * @private
   */
  #registerMCPTools(toolRegistry, serverName) {
    const tools = this.mcpClient.getTools().filter(t => t.serverName === serverName);
    let registered = 0;
    
    for (const mcpTool of tools) {
      if (toolRegistry.has(mcpTool.fullName)) {
        continue;
      }
      const tool = {
        name: mcpTool.fullName,
        description: mcpTool.description,
        category: 'MCP',
        parameters: mcpTool.inputSchema.properties || {},
        required: mcpTool.inputSchema.required || [],
        handler: async (args) => {
          try {
            const result = await this.mcpClient.callTool(mcpTool.fullName, args);
            return result;
          } catch (error) {
            throw new Error(`MCP tool ${mcpTool.fullName} failed: ${error.message}`);
          }
        },
      };
      toolRegistry.register(tool);
      registered += 1;
    }
    // Rebuild slash command suggestions when new MCP tools are registered
    try {
      this.slashCommandSuggestions = buildSlashCommandSuggestions(this.engine.getTools() || []);
    } catch (err) {
      enhancedUI.debugEvent('Failed to rebuild slash command suggestions after MCP register', { error: String(err) });
    }

    return registered;
  }

  /**
   * Initialize the application - 使用新架构 AgentEngine
   */
  async initialize() {
    await this.#ensureRuntimeConfig();
    this.config = this.#loadConfig();
    this.workingDir = this.config.workingDir;
    this.debugMode = this.config.debug;
    enhancedUI.setDebugMode(this.debugMode);

    // Ensure working directory exists
    if (!existsSync(this.workingDir)) {
      mkdirSync(this.workingDir, { recursive: true });
    }

    // 使用新架构的 AgentEngine
    this.engine = createAgentEngine({
      platform: PlatformType.CLI,
      workingDirectory: this.workingDir,
      debug: this.debugMode,
      maxIterations: this.config.maxIterations,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      tokenBudget: this.config.tokenBudget,
      tokenBudgetWarningThreshold: this.config.tokenBudgetWarningThreshold,
      toolResultCacheEnabled: this.config.toolResultCacheEnabled,
    });

    // 设置事件转发到 enhancedUI
    this.#setupEventForwarding();

    // 创建模型提供者（先创建，以便引擎初始化时可以使用）
    const modelProvider = await this.#createModelProvider();
    this.engine.attachModelProvider(modelProvider);
    this.modelProvider = modelProvider;

    // 初始化引擎（现在 modelProvider 已附加，schedulerEngine 会被创建）
    await this.engine.initialize();

    // 获取引擎中的组件引用（用于 CLI 命令）
    this.toolRegistry = this.engine.getToolRegistry();
    this.schedulerEngine = this.engine.getSchedulerEngine();
    this.mcpClient = this.engine.getMcpClient();
    this.tokenJuice = this.engine.getTokenJuice();
    this.experienceMemory = this.engine.getExperienceMemory();
    this.securityPolicy = this.engine.getSecurityPolicy();
    this.intelligentReasoning = this.engine.getIntelligentReasoning();
    this.automationEngine = this.engine.getAutomationEngine();

    // Create enhanced commands
    this.commands = createEnhancedCommands(this.schedulerEngine, {
      mcpClient: this.mcpClient,
      tokenJuice: this.tokenJuice,
      experienceMemory: this.experienceMemory,
      securityPolicy: this.securityPolicy,
      intelligentReasoning: this.intelligentReasoning,
      automationEngine: this.automationEngine,
      registerMcpTools: serverName => this.#registerMCPTools(this.toolRegistry, serverName),
    });

    // Build initial slash command suggestions from registered tools
    try {
      this.slashCommandSuggestions = buildSlashCommandSuggestions(this.engine.getTools() || []);
    } catch (err) {
      enhancedUI.debugEvent('Failed to build slash command suggestions on init', { error: String(err) });
      this.slashCommandSuggestions = [];
    }

    // Create readline interface
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: line => this.#completeSlashCommandLine(line),
    });
    this.rl.on('close', () => {
      this.rlClosed = true;
      this.isRunning = false;
    });

    // 处理 Ctrl+C 中断：优雅停止 Agent 而非直接退出
    const sigintHandler = () => {
      if (this.isProcessingInput) {
        // Agent 正在执行中 → 请求停止
        this.#sigintCount++;
        if (this.#sigintCount === 1) {
          enhancedUI.warning('\n⚠️  正在请求中断 Agent...（再按一次 Ctrl+C 强制退出）');
          this.engine.stop().catch(() => {});
          // 3秒内不再次按 Ctrl+C 则重置计数
          this.#sigintTimer = setTimeout(() => { this.#sigintCount = 0; }, 3000);
        } else if (this.#sigintCount >= 2) {
          // 双击 Ctrl+C → 强制退出
          enhancedUI.error('\n强制退出');
          process.exit(130);
        }
      } else {
        // 空闲状态 → 直接退出
        this.shutdown().then(() => process.exit(0));
      }
    };
    process.on('SIGINT', sigintHandler);
    this.#sigintHandler = sigintHandler;

    this.#installSlashCommandSuggestions();

    this.isRunning = true;
  }

  /**
   * 设置事件转发到 enhancedUI
   */
  #setupEventForwarding() {
    const eventBus = getEventBus();
    
    // 转发状态更新
    eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (event) => {
      switch (event.level) {
        case 'info':
          console.log(enhancedUI.theme.info(event.message));
          break;
        case 'success':
          console.log(enhancedUI.theme.success(event.message));
          break;
        case 'error':
          console.log(enhancedUI.theme.error(event.message));
          break;
        case 'debug':
          if (this.debugMode) {
            console.log(enhancedUI.theme.dim(event.message));
          }
          break;
        default:
          console.log(event.message);
      }
    });

    // 转发工具调用
    eventBus.subscribe(RuntimeEvent.TOOL_CALL, (event) => {
      if (this.debugMode) {
        console.log(enhancedUI.theme.dim(`  🔧 Calling: ${event.toolName}`));
      }
    });

    // 转发 Agent 完成
    eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, (event) => {
      if (this.debugMode) {
        console.log(enhancedUI.theme.success('✨ Task complete!'));
      }
    });

    // 转发 Agent 错误
    eventBus.subscribe(RuntimeEvent.AGENT_ERROR, (event) => {
      console.error(enhancedUI.theme.error(`❌ Agent error: ${event.error}`));
    });
  }

  /**
   * 创建模型提供者
   */
  async #createModelProvider() {
    return createConfiguredModelProvider(this.config, {
      debug: this.debugMode,
      onCapabilitiesResolved: (modelCapabilities) => {
        if (!this.debugMode) {
          return;
        }
        enhancedUI.debugEvent?.('Model capabilities resolved', {
          provider: modelCapabilities.provider,
          model: modelCapabilities.model,
          contextWindow: modelCapabilities.contextWindow,
          maxOutputTokens: modelCapabilities.maxOutputTokens,
          source: modelCapabilities.source,
        });
      },
    });
  }

  async #ensureRuntimeConfig() {
    const missingVars = getMissingRequiredConfig();
    if (missingVars.length === 0) {
      return;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(buildMissingConfigMessage(missingVars, getUserEnvPath()));
    }

    await this.runSetupWizard();
  }

  async runSetupWizard() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(buildMissingConfigMessage(getMissingRequiredConfig(), getUserEnvPath()));
    }

    const values = await this.#promptForRuntimeConfig();
    const envPath = writeUserEnv(values);
    applyRuntimeValues(values);
    enhancedUI.success(`Configuration saved to ${envPath}`);
    enhancedUI.info('Run `agent` to start, or `agent doctor` to verify the configuration.');
    return envPath;
  }

  #getProviderApiKey(provider) {
    return getProviderApiKey(provider);
  }

  async #promptForRuntimeConfig() {
    enhancedUI.info('First-time setup: model configuration is required before starting.');

    const provider = await select({
      message: 'Choose model provider:',
      choices: [
        { name: 'OpenAI compatible', value: 'openai' },
        { name: 'DeepSeek', value: 'deepseek' },
        { name: 'Zhipu AI', value: 'zhipu' },
        { name: 'OpenRouter', value: 'openrouter' },
      ],
      default: process.env.MODEL_PROVIDER || 'openai',
    });
    const requirement = getProviderRequirement(provider);

    const apiKey = await password({
      message: `Enter ${requirement.keyVar}:`,
      mask: '*',
      validate: value => value.trim() !== '' || `${requirement.keyVar} is required`,
    });
    const baseUrl = await input({
      message: `Enter ${requirement.baseUrlVar}:`,
      default: getProviderBaseUrl(provider),
      validate: value => value.trim() !== '' || `${requirement.baseUrlVar} is required`,
    });
    const model = await input({
      message: `Enter ${requirement.modelVar}:`,
      default: getProviderModel(provider),
      validate: value => value.trim() !== '' || `${requirement.modelVar} is required`,
    });
    const workingDirectory = await input({
      message: 'Enter working directory:',
      default: process.env.WORKING_DIRECTORY || resolve(process.cwd(), 'workspace'),
      validate: value => value.trim() !== '' || 'WORKING_DIRECTORY is required',
    });

    return {
      MODEL_PROVIDER: provider,
      [requirement.keyVar]: apiKey.trim(),
      [requirement.baseUrlVar]: baseUrl.trim(),
      [requirement.modelVar]: model.trim(),
      WORKING_DIRECTORY: workingDirectory.trim(),
      MAX_ITERATIONS: process.env.MAX_ITERATIONS || '60',
      MAX_TOKENS: process.env.MAX_TOKENS || '4096',
      DEBUG: process.env.DEBUG || 'false',
    };
  }

  #installSlashCommandSuggestions() {
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.SLASH_SUGGESTIONS === 'false') {
      return;
    }
    if (this.slashSuggestionsInstalled) {
      return;
    }

    emitKeypressEvents(process.stdin, this.rl);
    this.slashSuggestionsInstalled = true;
    this.#armSlashCommandSuggestions();
    process.stdin.on('keypress', (_str, key = {}) => {
      if (this.rlClosed || this.isProcessingInput || key.name === 'return' || key.name === 'enter') {
        return;
      }

      setImmediate(() => this.#renderSlashCommandSuggestions());
    });
  }

  #armSlashCommandSuggestions() {
    if (!process.stdin.isTTY || !process.stdin.setRawMode || this.rlClosed || process.env.SLASH_SUGGESTIONS === 'false') {
      return;
    }

    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    } catch (error) {
      enhancedUI.debugEvent('Slash command suggestions could not enable raw input mode', {
        error: error.message,
      });
    }
  }

  #disarmSlashCommandSuggestions() {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      return;
    }

    try {
      process.stdin.setRawMode(false);
    } catch (error) {
      enhancedUI.debugEvent('Slash command suggestions could not restore cooked input mode', {
        error: error.message,
      });
    }
  }

  #renderSlashCommandSuggestions() {
    if (!this.rl || this.rlClosed || this.isProcessingInput) {
      return;
    }

    const line = this.rl.line || '';
    const suggestions = filterSlashCommandSuggestions(this.slashCommandSuggestions, line, 6);
    const suggestionKey = `${line}::${suggestions.map(command => command.name).join('|')}`;

    if (!suggestions.length) {
      this.lastSlashSuggestionKey = '';
      return;
    }

    if (suggestionKey === this.lastSlashSuggestionKey) {
      return;
    }

    this.lastSlashSuggestionKey = suggestionKey;
    process.stdout.write('\n');
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);
    process.stdout.write(`${formatSlashCommandSuggestions(suggestions, enhancedUI.theme)}\n`);
    this.rl.prompt(true);
  }

  #completeSlashCommandLine(line) {
    return completeSlashCommand(this.slashCommandSuggestions, line);
  }

  /**
   * Display welcome message
   */
  showWelcome() {
    enhancedUI.welcome({
      model: this.config.model,
      provider: this.config.provider,
      workingDir: this.config.workingDir,
    });

    // Show tool summary
    const toolRegistry = this.engine?.getToolRegistry();
    if (toolRegistry) {
      const summary = toolRegistry.getToolSummary();
      const totalTools = Object.values(summary).flat().length;
      console.log(enhancedUI.theme.dim(`  ℹ️  Loaded ${totalTools} tools`));
    }
    console.log('');
  }

  /**
   * Get user input
   */
  async getInput() {
    if (!this.rl || this.rlClosed || !this.isRunning) {
      return null;
    }

    return new Promise((resolve) => {
      try {
        this.rl.question(enhancedUI.prompt(), (input) => {
          resolve(input.trim());
        });
      } catch (error) {
        if (error?.code === 'ERR_USE_AFTER_CLOSE') {
          this.rlClosed = true;
          this.isRunning = false;
          resolve(null);
          return;
        }
        throw error;
      }
    });
  }

  /**
   * Process user command
   */
  async processCommand(input) {
    if (!input) {return true;}

    const command = input.toLowerCase();
    const commandName = command.split(/\s+/, 1)[0];
    const argsText = input.slice(input.match(/^\S+/)?.[0]?.length || 0).trim();

    // Exit commands
    if (['exit', 'quit', '/exit', '/quit'].includes(commandName)) {
      return false;
    }

    // Help
    if (['/help', '/?', 'help'].includes(commandName)) {
      if (argsText) {
        this.showCommandHelp(argsText);
      } else {
        this.commands.showHelp();
      }
      return true;
    }

    if (commandName.startsWith('/') && ['help', '--help', '-h'].includes(argsText.toLowerCase())) {
      this.showCommandHelp(commandName);
      return true;
    }

    // Clear/reset
    if (['/clear', '/reset', 'clear'].includes(commandName)) {
      console.clear();
      this.showWelcome();
      return true;
    }

    // Interactive menu
    if (['/menu', 'menu'].includes(commandName)) {
      await this.showInteractiveMenu();
      return true;
    }

    // Task commands
    if (['/task', '/tasks'].includes(commandName)) {
      await this.commands.handleTaskCommand(argsText || 'list');
      return true;
    }

    // Schedule commands
    if (['/schedule', '/schedules'].includes(commandName)) {
      await this.commands.handleScheduleCommand(argsText || 'list');
      return true;
    }

    // SubAgent commands
    if (['/subagent', '/subagents'].includes(commandName)) {
      await this.commands.handleSubAgentCommand(argsText || 'list');
      return true;
    }

    // Git commands
    if (commandName === '/git') {
      await this.commands.handleGitCommand(argsText);
      return true;
    }

    // MCP commands
    if (commandName === '/mcp') {
      await this.commands.handleMcpCommand(argsText);
      return true;
    }

    // Security commands
    if (commandName === '/security') {
      await this.commands.handleSecurityCommand(argsText);
      return true;
    }

    // Experience commands
    if (commandName === '/experience') {
      await this.commands.handleExperienceCommand(argsText);
      return true;
    }

    // Project memory/context commands
    if (['/memory', '/context'].includes(commandName)) {
      this.showMemoryContext(argsText);
      return true;
    }

    // User document RAG commands
    if (['/doc', '/docs', '/document', '/documents'].includes(commandName)) {
      await this.handleDocumentCommand(argsText);
      return true;
    }

    if (commandName === '/preview') {
      await this.handlePreviewCommand(argsText);
      return true;
    }

    // Compress command
    if (commandName === '/compress') {
      const text = argsText;
      if (text) {
        const compressed = this.tokenJuice.compress(text);
        const stats = this.tokenJuice.getStats(text, compressed);
        console.log(enhancedUI.createHeader('TokenJuice Compression'));
        console.log(`Original: ${stats.originalChars} chars / ~${stats.originalTokens} tokens`);
        console.log(`Compressed: ${stats.compressedChars} chars / ~${stats.compressedTokens} tokens`);
        console.log(`Savings: ${stats.savingsPercent}%`);
        console.log('');
        console.log(compressed);
      } else {
        enhancedUI.info('Usage: /compress <text to compress>');
      }
      return true;
    }

    // Reasoning commands
    if (commandName === '/reason') {
      await this.commands.handleReasonCommand(argsText);
      return true;
    }

    // Automation commands
    if (commandName === '/auto') {
      await this.commands.handleAutoCommand(argsText);
      return true;
    }

    // Statistics
    if (['/stats', '/status', 'stats'].includes(commandName)) {
      await this.commands.showStatistics();
      return true;
    }

    // Tools list
    if (['/tools', '/list'].includes(commandName)) {
      this.showTools();
      return true;
    }

    // Debug command
    if (commandName === '/debug') {
      const args = argsText.toLowerCase();
      
      // 如果有具体参数，处理它
      if (args === 'on' || args === 'enable') {
        this.debugMode = true;
      } else if (args === 'off' || args === 'disable') {
        this.debugMode = false;
      } else if (args === 'status') {
        // 显示当前调试状态
        console.log(enhancedUI.createHeader('Debug Status'));
        console.log(`Debug mode: ${this.debugMode ? '✅  Enabled' : '❌  Disabled'}`);
        console.log(`Model provider: ${this.config.provider}`);
        console.log(`Model: ${this.config.model}`);
        console.log('');
        return true;
      } else {
        // 默认切换
        this.debugMode = !this.debugMode;
      }
      
      // 更新 model provider 的 debug 状态
      if (this.modelProvider) {
        if (typeof this.modelProvider.setDebugMode === 'function') {
          this.modelProvider.setDebugMode(this.debugMode);
        }
      }
      // Debug mode is handled by engine config
      enhancedUI.setDebugMode(this.debugMode);
      process.env.DEBUG = this.debugMode ? 'true' : 'false';
      
      // 显示更详细的反馈信息
      console.log(enhancedUI.createHeader('Debug Mode'));
      if (this.debugMode) {
        console.log('✅ Debug mode ENABLED');
        console.log('');
        console.log('📋 What you will see:');
        console.log('   - User input and agent run lifecycle');
        console.log('   - LLM request/response summaries and timing');
        console.log('   - Tool calls, arguments, purpose, result mode, and duration');
        console.log('   - Shell commands with cwd, timeout, exit code, and output preview');
        console.log('   - Error classification and context-window trimming');
        console.log('');
        console.log('💡 Try asking something to see debug output!');
      } else {
        console.log('❌ Debug mode DISABLED');
        console.log('');
        console.log('📋 No more debug information will be shown.');
      }
      console.log('');
      
      return true;
    }

    // Model commands
    if (commandName === '/model') {
      await this.handleModelCommand(argsText);
      return true;
    }

    if (await this.#processSlashToolCommand(input)) {
      return true;
    }

    // Regular input - process through agent
    await this.processAgentInput(input);
    return true;
  }

  showMemoryContext(argsText = '') {
    const mode = String(argsText || '').trim().toLowerCase();
    const memoryManager = this.engine?.getMemoryManager();
    if (!memoryManager) {
      enhancedUI.error('Project memory is not initialized');
      return;
    }

    const context = memoryManager.getContext();
    console.log(enhancedUI.createHeader('Project Memory Context'));
    console.log(`Path: ${memoryManager.getContextPath()}`);
    console.log(`Project: ${context.projectInfo?.name || '(unknown)'}`);
    console.log(`Working directory: ${context.projectInfo?.path || this.workingDir}`);
    console.log('');
    console.log('Current Task');
    console.log(`  Status: ${context.currentTask?.status || '(none)'}`);
    console.log(`  Phase: ${context.currentTask?.phase || '(none)'}`);
    console.log(`  Description: ${context.currentTask?.description || '(none)'}`);

    if (mode === 'full') {
      console.log('');
      console.log(memoryManager.toMarkdown());
      return;
    }

    const decisions = context.keyDecisions || [];
    const constraints = context.constraints || [];
    const files = context.fileMap || [];
    const sessions = context.sessionHistory || [];
    const notes = context.notes || [];

    if (decisions.length > 0) {
      console.log('');
      console.log('Recent Decisions');
      for (const decision of decisions.slice(-5)) {
        console.log(`  - ${decision.decision}: ${decision.reason}`);
      }
    }

    if (constraints.length > 0) {
      console.log('');
      console.log('Constraints');
      for (const constraint of constraints.slice(-8)) {
        console.log(`  - ${constraint}`);
      }
    }

    if (files.length > 0) {
      console.log('');
      console.log('Recent File Map');
      for (const file of files.slice(-8)) {
        console.log(`  - ${file.file}: ${file.purpose}`);
      }
    }

    if (notes.length > 0) {
      console.log('');
      console.log('Notes');
      for (const note of notes.slice(-5)) {
        console.log(`  - ${note}`);
      }
    }

    console.log('');
    console.log(`Sessions: ${sessions.length}`);
    console.log(enhancedUI.theme.dim('Use /memory full to print the full CONTEXT.md representation.'));
    console.log('');
  }

  async handleDocumentCommand(argsText = '') {
    const raw = String(argsText || '').trim();
    const [subcommandRaw, ...restParts] = raw.split(/\s+/).filter(Boolean);
    const subcommand = (subcommandRaw || 'list').toLowerCase();
    const restText = raw.slice(subcommandRaw?.length || 0).trim();

    if (['help', '--help', '-h'].includes(subcommand)) {
      this.#showBuiltInCommandHelp('doc');
      return;
    }

    if (['init', 'status', 'doctor'].includes(subcommand)) {
      await this.#handleDocumentInitCommand();
      return;
    }

    const toolRegistry = this.toolRegistry;
    if (!toolRegistry) {
      enhancedUI.error('Document tools are not initialized.');
      return;
    }

    if (['add', 'index', 'load'].includes(subcommand)) {
      let source = stripWrappingQuotes(restText);
      if (!source) {
        source = await chooseDocumentFile();
      }
      if (!source) {
        enhancedUI.info('Usage: /doc add <path-or-url>');
        return;
      }

      const spinner = enhancedUI.spinner('Indexing document...');
      try {
        spinner.start();
        const result = await toolRegistry.execute('document_add', { source }, this.#documentToolContext());
        spinner.stop();
        if (!result?.success) {
          enhancedUI.error(result?.error || 'Document indexing failed.');
          return;
        }
        enhancedUI.success(`Indexed document: ${result.title}`);
        console.log(`  id: ${result.id}`);
        console.log(`  kind: ${result.kind}`);
        console.log(`  chunks: ${result.chunks}`);
        console.log(`  source: ${result.source}`);
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Document indexing failed: ${error.message}`);
      }
      return;
    }

    if (['search', 'find', 'query'].includes(subcommand)) {
      const flags = new Set(restParts.filter(p => p.startsWith('--')));
      const query = restParts.filter(p => !p.startsWith('--')).join(' ');
      const showRaw = flags.has('--debug') || flags.has('--raw');
      if (!query) {
        enhancedUI.info('Usage: /doc search <query> [--debug|--raw]');
        return;
      }

      const spinner = enhancedUI.spinner('Searching documents...');
      try {
        spinner.start();
        const result = await toolRegistry.execute('document_search', { query, limit: 5 }, this.#documentToolContext());
        spinner.stop();

        const firstResultLine = (result || '').split('\n')[0];
        const searchPayload = result ? String(result) : '';
        const truncatedSearch = searchPayload.length > 8000 ? searchPayload.slice(0, 8000) + '\n...[truncated]' : searchPayload;
        if (showRaw) {
          console.log(enhancedUI.theme.dim(firstResultLine));
        }

        let answerText = '';
        if (this.modelProvider && searchPayload && !searchPayload.startsWith('No document')) {
          try {
            const refineSpinner = enhancedUI.spinner('Refining answer...');
            refineSpinner.start();
            const refineMessages = [
              { role: 'system', content: 'You are a precise document analyst. Based on the user question and search results, extract a concise answer. Use the user\'s language. If insufficient info, say so.' },
              { role: 'user', content: 'Question: ' + query + '\n\nSearch results:\n' + truncatedSearch }
            ];
            const refineResponse = await this.modelProvider.chat(refineMessages, { maxTokens: 500 });
            refineSpinner.stop();

            answerText = refineResponse.text || String(refineResponse);
            try {
              const parsed = JSON.parse(answerText);
              if (parsed?.action?.done?.text) { answerText = parsed.action.done.text; }
            } catch {
              // Keep the raw answer text when it is not JSON.
            }
          } catch (refineError) {
            answerText = '';
          }
        }

        if (showRaw && searchPayload) {
          console.log('');
          console.log(enhancedUI.createHeader('Raw Evidence'));
          console.log('');
          console.log(searchPayload);
        }
        if (answerText) {
          console.log('');
          console.log(enhancedUI.createHeader('Answer'));
          console.log('');
          console.log(answerText);
          console.log('');
        } else if (!showRaw) {
          // When no model provider, fall back to showing the raw result
          console.log(searchPayload);
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.error(`Document search failed: ${error.message}`);
      }
      return;
    }

    if (['list', 'ls', ''].includes(subcommand)) {
      try {
        const result = await toolRegistry.execute('document_list', {}, this.#documentToolContext());
        console.log(enhancedUI.createHeader('Indexed Documents'));
        if (!result.documents?.length) {
          enhancedUI.info('No documents are indexed yet. Use /doc add <path-or-url> or reference one with @path.');
          return;
        }
        for (const doc of result.documents) {
          console.log(`${doc.id}  ${doc.title}`);
          console.log(`  kind=${doc.kind} chunks=${doc.chunks} chars=${doc.chars}`);
          console.log(`  source=${doc.source}`);
        }
        console.log('');
      } catch (error) {
        enhancedUI.error(`Document list failed: ${error.message}`);
      }
      return;
    }

    if (['clear', 'remove', 'rm'].includes(subcommand)) {
      const documentId = restText ? stripWrappingQuotes(restText) : undefined;
      try {
        const result = await toolRegistry.execute('document_clear', {
          document_id: documentId,
        }, this.#documentToolContext());
        const target = documentId ? `document ${documentId}` : 'all documents';
        if (result?.success) {
          enhancedUI.success(`Cleared ${target}. Removed: ${result.removed}`);
        } else {
          enhancedUI.warning(`No matching document found for ${documentId}.`);
        }
      } catch (error) {
        enhancedUI.error(`Document clear failed: ${error.message}`);
      }
      return;
    }

    enhancedUI.warning(`Unknown /doc command: ${subcommand}`);
    this.#showBuiltInCommandHelp('doc');
  }

  async handlePreviewCommand(argsText = '') {
    const args = this.parseArgs(argsText || '');
    const subcommand = (args[0] || 'start').toLowerCase();

    if (['help', '--help', '-h'].includes(subcommand)) {
      this.#showBuiltInCommandHelp('preview');
      return;
    }

    if (subcommand === 'list') {
      const previews = listPreviews();
      if (previews.length === 0) {
        enhancedUI.info('No active preview sessions.');
        return;
      }
      for (const preview of previews) {
        enhancedUI.info(`${preview.session_id} ${preview.mode} ${preview.url}`);
      }
      return;
    }

    if (subcommand === 'stop') {
      const sessionId = args[1];
      if (!sessionId) {
        enhancedUI.info('Usage: /preview stop <session-id>');
        return;
      }
      const result = stopPreview(sessionId);
      if (result.success) {
        enhancedUI.success(`Preview stopped: ${sessionId}`);
      } else {
        enhancedUI.warning(result.error);
      }
      return;
    }

    const kind = ['static', 'node', 'auto'].includes(subcommand) ? subcommand : 'auto';
    const target = ['static', 'node', 'auto'].includes(subcommand)
      ? (args[1] || '.')
      : (args[0] || '.');
    const command = kind === 'node' && args.length > 2 ? args.slice(2).join(' ') : undefined;
    const spinner = enhancedUI.spinner('Starting preview...');
    spinner.start();
    try {
      const preview = await startPreview({
        workingDirectory: this.workingDir,
        target,
        kind,
        command,
      });
      spinner.stop();
      enhancedUI.success(`Preview ready: ${preview.url}`);
      enhancedUI.info(`Session: ${preview.session_id} (${preview.mode})`);
    } catch (error) {
      spinner.stop();
      enhancedUI.error(`Preview failed: ${error.message}`);
    }
  }

  async #handleDocumentInitCommand() {
    const embedder = new Embedder();
    const before = await embedder.inspect();

    console.log(enhancedUI.createHeader('Document RAG Runtime'));
    console.log('Embedding Model');
    console.log(`  path: ${before.modelPath}`);
    console.log(`  exists: ${before.modelFile.exists ? 'yes' : 'no'}`);
    if (before.modelFile.exists) {
      console.log(`  size: ${formatBytes(before.modelFile.bytes)}`);
      console.log(`  modified: ${before.modelFile.modifiedAt}`);
    }
    console.log(`  auto download: ${before.autoDownload ? 'enabled' : 'disabled'}`);
    console.log(`  probe timeout: ${before.probeTimeoutMs}ms`);
    console.log(`  download timeout: ${before.downloadTimeoutMs}ms`);
    console.log('');
    console.log('Download Candidates');
    for (const [index, url] of before.downloadCandidates.entries()) {
      console.log(`  ${index + 1}. ${url}`);
    }
    console.log('');

    let prepared = before;
    if (!before.modelFile.exists && before.autoDownload) {
      enhancedUI.info('Embedding model is missing. Starting download before runtime initialization.');
      let lastProgressBytes = -1;
      let lastProgressAt = 0;
      try {
        prepared = await embedder.prepareModel({
          onDownloadProbeStart: ({ candidates, timeoutMs }) => {
            console.log(`  checking ${candidates.length} download candidate${candidates.length === 1 ? '' : 's'}...`);
            console.log(`  probe timeout: ${timeoutMs}ms`);
          },
          onDownloadProbeResult: ({ url, available, durationMs, totalBytes, error }) => {
            const sizeText = totalBytes ? `, size ${formatBytes(totalBytes)}` : '';
            const statusText = available ? 'available' : `unavailable: ${error}`;
            console.log(`  candidate: ${statusText} in ${durationMs}ms${sizeText}`);
            console.log(`    ${url}`);
          },
          onDownloadSelected: ({ url, durationMs, totalBytes }) => {
            const sizeText = totalBytes ? `, ${formatBytes(totalBytes)}` : '';
            console.log(`  selected: ${url} (${durationMs}ms${sizeText})`);
          },
          onDownloadStart: ({ url, timeoutMs }) => {
            console.log(`  downloading from: ${url}`);
            console.log(`  timeout: ${timeoutMs}ms`);
          },
          onDownloadProgress: ({ downloadedBytes, totalBytes }) => {
            const now = Date.now();
            const bytesDelta = downloadedBytes - lastProgressBytes;
            const shouldReport =
              lastProgressBytes < 0 ||
              downloadedBytes === totalBytes ||
              bytesDelta >= 25 * 1024 * 1024 ||
              now - lastProgressAt >= 5000;

            if (!shouldReport) {
              return;
            }

            lastProgressBytes = downloadedBytes;
            lastProgressAt = now;
            const totalText = totalBytes ? ` / ${formatBytes(totalBytes)}` : '';
            const percentText = totalBytes ? ` (${Math.min(100, (downloadedBytes / totalBytes) * 100).toFixed(1)}%)` : '';
            console.log(`  progress: ${formatBytes(downloadedBytes)}${totalText}${percentText}`);
          },
          onDownloadComplete: ({ bytes }) => {
            console.log(`  downloaded: ${formatBytes(bytes)}`);
          },
        });
        enhancedUI.success(`Embedding model downloaded: ${formatBytes(prepared.modelFile.bytes)}`);
      } catch (error) {
        enhancedUI.error(`Embedding model download failed: ${error.message}`);
        enhancedUI.info('Runtime initialization will continue with the fallback embedder if needed.');
      }
      console.log('');
    } else if (!before.modelFile.exists && !before.autoDownload) {
      enhancedUI.warning('Embedding model file is missing and auto download is disabled.');
      console.log('');
    }

    const currentModel = await embedder.inspect();
    console.log('Model File After Prepare');
    console.log(`  exists: ${currentModel.modelFile.exists ? 'yes' : 'no'}`);
    if (currentModel.modelFile.exists) {
      console.log(`  size: ${formatBytes(currentModel.modelFile.bytes)}`);
      console.log(`  modified: ${currentModel.modelFile.modifiedAt}`);
    }
    console.log('');

    const spinner = enhancedUI.spinner('Initializing embedding runtime...');
    try {
      spinner.start();
      await embedder.initialize();
      spinner.stop();
    } catch (error) {
      spinner.stop();
      enhancedUI.error(`Embedding initialization failed: ${error.message}`);
    }

    const after = await embedder.inspect();
    console.log(enhancedUI.createHeader('Document RAG Init Result'));
    console.log(`Runtime: ${after.usingONNX ? 'ONNX' : 'fallback'}`);
    console.log(`Initialized: ${after.initialized ? 'yes' : 'no'}`);
    if (after.fallbackReason) {
      console.log(`Fallback reason: ${after.fallbackReason}`);
    }
    console.log('');

    if (after.usingONNX) {
      enhancedUI.success('Document RAG will use ONNX embeddings.');
    } else {
      enhancedUI.warning('Document RAG will use the local fallback embedder.');
      enhancedUI.info('This is usable, but semantic ranking may be less precise than ONNX embeddings.');
    }
    console.log('');
  }

  async #processSlashToolCommand(input) {
    const match = input.match(/^\/([A-Za-z_][\w-]*)(?:\s+([\s\S]*))?$/);
    if (!match || !this.engine) {
      return false;
    }

    const rawName = match[1];
    const toolName = rawName.toLowerCase().replace(/-/g, '_');
    const toolRegistry = this.toolRegistry;
    const tool = toolRegistry.get(toolName);

    if (!tool) {
      return false;
    }

    const argsText = (match[2] || '').trim();
    if (!argsText || ['help', '--help', '-h'].includes(argsText.toLowerCase())) {
      this.#showSlashToolHelp(rawName, tool);
      return true;
    }

    const parsed = this.#parseSlashToolArgs(tool, argsText);
    if (parsed.error) {
      enhancedUI.error(parsed.error);
      this.#showSlashToolHelp(rawName, tool);
      return true;
    }

    const missing = this.#getToolRequiredParams(tool)
      .filter(paramName => parsed.args[paramName] === undefined || parsed.args[paramName] === '');
    if (missing.length > 0) {
      enhancedUI.warning(`Missing required argument(s): ${missing.join(', ')}`);
      this.#showSlashToolHelp(rawName, tool);
      return true;
    }

    try {
      const displayCommand = `/${rawName}${argsText ? ` ${argsText}` : ''}`;
      console.log(`${enhancedUI.theme.dim('Running slash command:')} ${displayCommand}`);
      enhancedUI.toolCall(toolName, parsed.args);
      const result = await toolRegistry.execute(toolName, parsed.args, {
        workingDirectory: this.workingDir,
      });
      enhancedUI.toolResult(toolName, result);
      if (typeof result === 'string') {
        enhancedUI.finalAnswer(result);
      } else {
        console.log(enhancedUI.formatJSON(result));
      }
    } catch (error) {
      enhancedUI.toolError(toolName, error.message);
    }

    return true;
  }

  showCommandHelp(commandText = '') {
    const normalized = String(commandText || '').trim().replace(/^\//, '');
    if (!normalized) {
      this.commands.showHelp();
      return;
    }

    const rawName = normalized.split(/\s+/, 1)[0].toLowerCase();
    const builtInName = COMMAND_HELP_ALIASES[rawName] || rawName;
    if (builtInName === 'commands') {
      this.commands.showHelp();
      return;
    }
    if (builtInName === 'skills') {
      this.#showSlashSkillList();
      return;
    }
    if (COMMAND_HELP[builtInName]) {
      this.#showBuiltInCommandHelp(builtInName);
      return;
    }

    const toolName = rawName.replace(/-/g, '_');
    const tool = this.toolRegistry?.get(toolName);
    if (tool) {
      this.#showSlashToolHelp(rawName, tool);
      return;
    }

    enhancedUI.info(`No detailed help found for /${rawName}.`);
    enhancedUI.info('Use /help to list available commands.');
  }

  #showBuiltInCommandHelp(commandName) {
    const help = COMMAND_HELP[commandName];
    console.log(enhancedUI.createHeader(`Command Help: ${help.title}`));
    console.log(help.description);
    console.log('');
    console.log('Usage:');
    for (const usage of help.usage || []) {
      console.log(`  ${usage}`);
    }
    console.log('');
    console.log('Effects:');
    for (const effect of help.effects || []) {
      console.log(`  - ${effect}`);
    }
    if (help.examples?.length > 0) {
      console.log('');
      console.log('Examples:');
      for (const example of help.examples) {
        console.log(`  ${example}`);
      }
    }
    console.log('');
  }

  #showSlashSkillList() {
    const tools = this.toolRegistry?.getAll() || [];
    const skillTools = tools
      .filter(tool => [
        ToolCategory.SKILL_ENGINEERING,
        ToolCategory.SKILL_PRODUCTIVITY,
        ToolCategory.SKILL_OUTPUT,
      ].includes(tool.category))
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log(enhancedUI.createHeader('Slash Skill Commands'));
    if (skillTools.length === 0) {
      enhancedUI.info('No slash skill commands are registered.');
      return;
    }

    for (const tool of skillTools) {
      const slashName = `/${tool.name.replace(/_/g, '-')}`;
      const description = String(tool.description || '').split(/\s+/).slice(0, 18).join(' ');
      console.log(`${slashName.padEnd(14)} ${description}${description ? '...' : ''}`);
    }
    console.log('');
    console.log('Use /help <command> or /<command> --help for details and examples.');
    console.log('Natural language also works: the agent can choose these methodology tools automatically when they fit the task.');
    console.log('');
  }

  #parseSlashToolArgs(tool, argsText) {
    if (!argsText) {
      return { args: {} };
    }

    const trimmed = argsText.trim();
    if (trimmed.startsWith('{')) {
      try {
        const args = JSON.parse(trimmed);
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          return { error: 'Slash tool JSON arguments must be an object.' };
        }
        return { args };
      } catch (error) {
        return { error: `Invalid JSON arguments: ${error.message}` };
      }
    }

    const keyValueArgs = this.#parseKeyValueArgs(trimmed);
    if (keyValueArgs) {
      return { args: keyValueArgs };
    }

    if (tool.name === 'tdd') {
      const shorthand = this.#parseTddShorthand(trimmed);
      if (shorthand) {
        return { args: shorthand };
      }
    }

    const required = this.#getToolRequiredParams(tool);
    if (required.length === 1) {
      return { args: { [required[0]]: trimmed } };
    }

    return {
      error: 'Could not parse slash tool arguments. Use JSON or key=value arguments.',
    };
  }

  #parseKeyValueArgs(text) {
    const args = {};
    const regex = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s]+))/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      args[match[1]] = this.#coerceSlashValue(match[2] ?? match[3] ?? match[4] ?? match[5] ?? '');
    }

    if (Object.keys(args).length === 0) {
      return null;
    }

    const remainder = text.replace(regex, '').trim();
    return remainder ? null : args;
  }

  #parseTddShorthand(text) {
    const match = text.match(/^(red|green|refactor)\s+(\S+)(?:\s+([\s\S]+))?$/i);
    if (!match || !match[3]) {
      return null;
    }

    return {
      phase: match[1].toLowerCase(),
      component: match[2],
      spec: match[3].trim(),
    };
  }

  #coerceSlashValue(value) {
    if (value === 'true') {return true;}
    if (value === 'false') {return false;}
    if (value === 'null') {return null;}
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {return Number(value);}
    return value;
  }

  #getToolRequiredParams(tool) {
    return tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []);
  }

  #showSlashToolHelp(rawName, tool) {
    const params = tool.params || tool.parameters?.properties || {};
    const required = this.#getToolRequiredParams(tool);
    const examples = this.#getSlashToolExamples(rawName, tool);

    console.log(enhancedUI.createHeader(`Command Help: /${rawName}`));
    console.log(tool.description || `Run the ${tool.name} tool.`);
    console.log('');
    console.log(`Usage: ${this.#formatSlashToolUsage(rawName, tool)}`);
    console.log('');
    console.log('Effects:');
    for (const effect of this.#inferSlashToolEffects(tool)) {
      console.log(`  - ${effect}`);
    }

    if (Object.keys(params).length > 0) {
      console.log('');
      console.log('Arguments:');
      for (const [name, schema] of Object.entries(params)) {
        const requiredMark = required.includes(name) ? 'required' : 'optional';
        const enumText = schema.enum ? ` (${schema.enum.join('|')})` : '';
        console.log(`  - ${name}${enumText}: ${requiredMark}. ${schema.description || ''}`);
      }
    }

    if (examples.length > 0) {
      console.log('');
      console.log('Examples:');
      for (const example of examples) {
        console.log(`  ${example}`);
      }
    }
    console.log('');
  }

  #formatSlashToolUsage(rawName, tool) {
    const params = tool.params || tool.parameters?.properties || {};
    const required = this.#getToolRequiredParams(tool);
    const parts = [];
    const orderedEntries = tool.name === 'tdd'
      ? ['phase', 'component', 'spec', 'test_file', 'source_file']
        .filter(name => params[name])
        .map(name => [name, params[name]])
      : Object.entries(params);

    for (const [name, schema] of orderedEntries) {
      const value = schema.enum ? `<${schema.enum.join('|')}>` : '<value>';
      const token = `${name}=${value}`;
      parts.push(required.includes(name) ? token : `[${token}]`);
    }

    return `/${rawName}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`;
  }

  #inferSlashToolEffects(tool) {
    const effects = ['Runs locally as a slash skill command; it does not call the LLM.'];
    if (tool.name === 'setup') {
      effects.push('Creates or updates project context files in the working directory.');
    } else if (tool.name === 'review') {
      effects.push('Reads a file from the working directory and prints a review report.');
    } else if (tool.name === 'handoff') {
      effects.push('Writes a handoff document to a temporary location.');
    } else {
      effects.push('Prints structured guidance/report text; it does not modify files by itself.');
    }
    return effects;
  }

  #getSlashToolExamples(rawName, tool) {
    const examplesByTool = {
      tdd: [
        '/tdd phase=red component=LoginForm spec="valid credentials submit the form"',
        '/tdd phase=green component=WeatherSearch spec="上海天气 triggers web_search" test_file=tests/weather.test.js',
        '/tdd red SnakeGame "snake moves once per tick without exceeding the configured FPS"',
      ],
      review: [
        '/review file_path=src/index.js',
        '/review file_path=src/index.js focus_areas="security,cli ux,tests"',
      ],
      brainstorm: [
        '/brainstorm problem="make CLI commands self-documenting"',
        '/brainstorm problem="package Bun standalone binary" constraints="macOS,Linux,Windows"',
      ],
      grill: [
        '/grill task="add command help system"',
        '/grill task="ship CD artifacts" assumptions="GitHub Actions available, Bun installed in CI"',
      ],
      architect: [
        '/architect scope="CLI command routing"',
        '/architect scope="agent context management" pain_points="duplicated help,hidden defaults"',
      ],
      diagnose: [
        '/diagnose symptom="slash command output hides whether it executed"',
      ],
      verify: [
        '/verify claim="CLI command help works" criteria="help output shown,no LLM request,test passes" evidence="bun test-integration.mjs passed"',
      ],
      'zoom-out': [
        '/zoom-out proposed_change="add another hardcoded command router branch"',
      ],
      caveman: [
        '/caveman mode=simplify content="The system dynamically orchestrates tool affordances"',
      ],
      handoff: [
        '/handoff session_summary="Implemented CLI command help" next_steps="review remaining built-in commands"',
      ],
      'to-prd': [
        '/to-prd title="Command Help" context="Users do not know what slash commands do"',
      ],
      'to-issues': [
        '/to-issues plan="Add command registry, help output, and tests" granularity=medium',
      ],
      setup: [
        '/setup project_name="AI Engineering Agent" project_type=cli',
      ],
    };

    if (examplesByTool[rawName]) {
      return examplesByTool[rawName];
    }

    const required = this.#getToolRequiredParams(tool);
    if (required.length === 0) {
      return [`/${rawName} --help`];
    }
    return [`/${rawName} ${required.map(name => `${name}="value"`).join(' ')}`];
  }

  /**
   * Handle model commands
   */
  async handleModelCommand(args) {
    if (!args || args === 'list') {
      this.showCurrentModel();
      return;
    }

    if (args === 'switch' || args === 'change') {
      await this.interactiveModelSwitch();
      return;
    }

    // Try to parse as provider:model format
    const parts = args.split(':');
    if (parts.length === 2) {
      const [provider, model] = parts;
      await this.switchModel(provider.trim(), model.trim());
      return;
    }

    // Try to parse as just model name (keep current provider)
    await this.switchModel(this.config.provider, args.trim());
  }

  /**
   * Show current model info
   */
  showCurrentModel() {
    console.log(enhancedUI.createHeader('Current Model'));
    
    const table = enhancedUI.createTable({
      colWidths: [20, 50],
    });

    table.push(
      [enhancedUI.theme.primaryBold('Provider'), this.config.provider],
      [enhancedUI.theme.primaryBold('Model'), this.config.model],
      [enhancedUI.theme.primaryBold('Temperature'), this.config.temperature],
      [enhancedUI.theme.primaryBold('Max Iterations'), this.config.maxIterations],
    );

    console.log(table.toString());
    console.log('');
    console.log(enhancedUI.theme.dim('Use /model switch for interactive selection'));
    console.log(enhancedUI.theme.dim('Use /model <provider>:<model> to switch directly'));
    console.log(enhancedUI.theme.dim('Examples:'));
    console.log(enhancedUI.theme.dim('  /model openai:gpt-4'));
    console.log(enhancedUI.theme.dim('  /model openai:gpt-3.5-turbo'));
    console.log(enhancedUI.theme.dim('  /model zhipu:glm-4'));
    console.log(enhancedUI.theme.dim('  /model deepseek:deepseek-chat'));
    console.log(enhancedUI.theme.dim('  /model openrouter:anthropic/claude-3-opus'));
    console.log(enhancedUI.theme.dim('  /model gpt-4 (keeps current provider)'));
    console.log('');
  }

  /**
   * Interactive model switch
   */
  async interactiveModelSwitch() {
    const provider = await select({
      message: 'Select provider:',
      choices: [
        { name: '🔵 OpenAI', value: 'openai' },
        { name: '🦙 Llama (Local)', value: 'llama' },
        { name: '🇨🇳 Zhipu AI (智谱清言)', value: 'zhipu' },
        { name: '🔮 DeepSeek', value: 'deepseek' },
        { name: '🌐 OpenRouter', value: 'openrouter' },
      ],
      default: this.config.provider,
    });

    let modelChoices = [];
    if (provider === 'openai') {
      modelChoices = [
        { name: 'GPT-4', value: 'gpt-4' },
        { name: 'GPT-4 Turbo', value: 'gpt-4-turbo-preview' },
        { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
        { name: 'GPT-3.5 Turbo 16k', value: 'gpt-3.5-turbo-16k' },
        { name: 'Custom...', value: 'custom' },
      ];
    } else if (provider === 'llama') {
      modelChoices = [
        { name: 'Llama 2 7B', value: 'llama-2-7b' },
        { name: 'Llama 2 13B', value: 'llama-2-13b' },
        { name: 'Llama 2 70B', value: 'llama-2-70b' },
        { name: 'Code Llama', value: 'codellama' },
        { name: 'Custom...', value: 'custom' },
      ];
    } else if (provider === 'zhipu') {
      modelChoices = [
        { name: 'GLM-4', value: 'glm-4' },
        { name: 'GLM-4V (Vision)', value: 'glm-4v' },
        { name: 'GLM-4-Flash', value: 'glm-4-flash' },
        { name: 'GLM-3-Turbo', value: 'glm-3-turbo' },
        { name: 'Custom...', value: 'custom' },
      ];
    } else if (provider === 'deepseek') {
      modelChoices = [
        { name: 'DeepSeek Chat', value: 'deepseek-chat' },
        { name: 'DeepSeek Coder', value: 'deepseek-coder' },
        { name: 'Custom...', value: 'custom' },
      ];
    } else if (provider === 'openrouter') {
      modelChoices = [
        { name: 'OpenAI GPT-4', value: 'openai/gpt-4' },
        { name: 'OpenAI GPT-4 Turbo', value: 'openai/gpt-4-turbo' },
        { name: 'OpenAI GPT-4o', value: 'openai/gpt-4o' },
        { name: 'Anthropic Claude 3 Opus', value: 'anthropic/claude-3-opus' },
        { name: 'Anthropic Claude 3 Sonnet', value: 'anthropic/claude-3-sonnet' },
        { name: 'Google Gemini Pro', value: 'google/gemini-pro' },
        { name: 'Meta Llama 3 70B', value: 'meta-llama/llama-3-70b-instruct' },
        { name: 'Mistral Large', value: 'mistralai/mistral-large' },
        { name: 'DeepSeek Chat', value: 'deepseek/deepseek-chat' },
        { name: 'Custom...', value: 'custom' },
      ];
    }

    const model = await select({
      message: 'Select model:',
      choices: modelChoices,
      default: this.config.model,
    });

    let finalModel = model;
    if (model === 'custom') {
      const customModel = await input({
        message: 'Enter model name:',
        validate: (input) => input.trim() !== '' || 'Model name is required',
      });
      finalModel = customModel.trim();
    }

    await this.switchModel(provider, finalModel);
  }

  /**
   * Switch to a new model
   */
  async switchModel(provider, model) {
    const spinner = enhancedUI.spinner('Switching model...');
    spinner.start();

    try {
      assertSupportedProvider(provider);
      const newProvider = createModelProviderForSwitch(provider, model, {
        temperature: this.config.temperature,
        debug: this.debugMode,
      });

      // Update config
      this.config.provider = provider;
      this.config.model = model;

      // Update engine's model provider
      this.engine.attachModelProvider(newProvider);

      // Update scheduler engine's model provider for new subagents
      if (this.schedulerEngine) {
        this.schedulerEngine.modelProvider = newProvider;
      }

      // Update our model provider reference
      this.modelProvider = newProvider;

      spinner.stop();
      enhancedUI.success(`Switched to ${provider}:${model}`);
      console.log('');

    } catch (error) {
      spinner.stop();
      enhancedUI.error(`Failed to switch model: ${error.message}`);
      console.log('');
    }
  }

  /**
   * Show interactive menu
   */
  async showInteractiveMenu() {
    let exitMenu = false;

    while (!exitMenu && this.isRunning) {
      const action = await this.commands.showMainMenu();

      switch (action) {
        case 'tasks':
          await this.commands.showTaskMenu();
          break;
        case 'schedules':
          await this.commands.showScheduleMenu();
          break;
        case 'subagents':
          await this.commands.handleSubAgentCommand('list');
          break;
        case 'git':
          await this.commands.showGitMenu();
          break;
        case 'mcp':
          await this.commands.showMcpMenu();
          break;
        case 'security':
          await this.commands.showSecurityMenu();
          break;
        case 'experience':
          await this.commands.showExperienceMenu();
          break;
        case 'reasoning':
          await this.commands.showReasonMenu();
          break;
        case 'automation':
          await this.commands.showAutoMenu();
          break;
        case 'stats':
          await this.commands.showStatistics();
          break;
        case 'messages':
          enhancedUI.info('Message bus feature coming soon...');
          break;
        case 'exit':
          exitMenu = true;
          break;
      }
    }
  }

  /**
   * Show available tools
   */
  showTools() {
    const toolRegistry = this.toolRegistry;
    const summary = toolRegistry.getToolSummary();
    
    console.log(enhancedUI.createHeader('Available Tools'));
    
    for (const [category, tools] of Object.entries(summary)) {
      if (tools.length > 0) {
        console.log(enhancedUI.theme.primaryBold(`\n${category}:`));
        for (const tool of tools) {
          console.log(`  • ${tool}`);
        }
      }
    }
    
    console.log('');
  }

  #documentToolContext() {
    return {
      workingDirectory: this.workingDir,
      debug: this.debugMode,
      ui: enhancedUI,
    };
  }

  async #prepareDocumentReferences(input) {
    const refs = extractDocumentReferences(input, this.workingDir);
    if (refs.length === 0) {
      return input;
    }

    const toolRegistry = this.toolRegistry;
    const indexed = [];
    const spinner = enhancedUI.spinner(`Indexing ${refs.length} referenced document${refs.length === 1 ? '' : 's'}...`);
    spinner.start();
    for (const source of refs) {
      try {
        const result = await toolRegistry.execute('document_add', { source }, this.#documentToolContext());
        if (result?.success) {
          indexed.push(result);
        }
      } catch (error) {
        spinner.stop();
        enhancedUI.warning(`Could not index @ document ${source}: ${error.message}`);
        spinner.start();
      }
    }
    spinner.stop();

    if (indexed.length === 0) {
      return input;
    }

    for (const doc of indexed) {
      enhancedUI.info(`Indexed @ document: ${doc.title} (${doc.id})`);
    }

    const docSummary = indexed
      .map(doc => `${doc.title} (${doc.id})`)
      .join(', ');
    return `${input}\n\n[Document references indexed for this turn: ${docSummary}. Use document_search for questions that need details from them.]`;
  }

  /**
   * Process input through the agent
   */
  async processAgentInput(input) {
    const spinner = enhancedUI.spinner('Thinking...');
    spinner.start();

    try {
      enhancedUI.debugEvent('User input received', {
        commandType: 'agent',
        inputPreview: input.length > 240 ? input.substring(0, 240) + '... (truncated)' : input,
        inputChars: input.length,
      });
      const preparedInput = await this.#prepareDocumentReferences(input);
      const result = await this.engine.processInput(preparedInput);
      spinner.stop();
      enhancedUI.debugEvent('Agent input completed', {
        inputChars: preparedInput.length,
        result: result?.status || (result?.answer ? 'completed' : 'unknown'),
      });

      // 处理不同的结束状态
      if (result?.status === 'cancelled') {
        enhancedUI.warning('🛑 Agent 执行已中断');
      } else if (result?.status === 'needs_user_input') {
        if (result.answer) {
          enhancedUI.finalAnswer(result.answer);
        }
        enhancedUI.info('请直接在下一行输入补充信息，我会带着当前上下文继续。');
      } else if (result?.answer) {
        enhancedUI.finalAnswer(result.answer);
      } else if (result?.status === 'max_iterations') {
        enhancedUI.warning('Agent stopped after reaching the maximum iteration limit without a final answer.');
      }
    } catch (error) {
      spinner.stop();
      enhancedUI.error(`Agent error: ${error.message}`);
      console.error(error);
    }
  }

  /**
   * Queue readline input and process it sequentially.
   *
   * The readline async iterator can behave poorly when the loop body awaits
   * long-running model calls. A small explicit queue keeps interactive input
   * handling deterministic across Terminal.app, VS Code terminals, and watch
   * mode.
   */
  enqueueInput(rawInput) {
    this.inputQueue.push(rawInput);
    this.#drainInputQueue();
  }

  async #drainInputQueue() {
    if (this.isProcessingInput || !this.isRunning || this.rlClosed) {
      return;
    }

    this.isProcessingInput = true;

    try {
      while (this.inputQueue.length > 0 && this.isRunning && !this.rlClosed) {
        const rawInput = this.inputQueue.shift();
        const input = rawInput.trim();
        this.lastSlashSuggestionKey = '';

        enhancedUI.debugEvent('CLI line received', {
          rawChars: rawInput.length,
          trimmedChars: input.length,
          preview: input.length > 240 ? input.substring(0, 240) + '... (truncated)' : input,
          queuedInputs: this.inputQueue.length,
        });

        this.rl.pause();
        const shouldContinue = await this.processCommand(input);

        if (!shouldContinue) {
          await this.shutdown();
          return;
        }

        if (this.isRunning && !this.rlClosed) {
          this.rl.resume();
          this.lastSlashSuggestionKey = '';
          this.#armSlashCommandSuggestions();
          this.rl.prompt();
        }
      }
    } catch (error) {
      enhancedUI.error(`Input loop error: ${error.message}`);
      console.error(error);
    } finally {
      this.isProcessingInput = false;

      if (this.inputQueue.length > 0 && this.isRunning && !this.rlClosed) {
        this.#drainInputQueue();
      } else if (this.isRunning && !this.rlClosed) {
        this.#armSlashCommandSuggestions();
      }
    }
  }

  /**
   * Main run loop
   */
  async run() {
    try {
      await this.initialize();
      this.showWelcome();

      this.rl.setPrompt(enhancedUI.prompt());
      this.rl.on('line', (rawInput) => {
        this.lastSlashSuggestionKey = '';
        this.#armSlashCommandSuggestions();
        this.enqueueInput(rawInput);
      });
      this.#armSlashCommandSuggestions();
      this.rl.prompt();

      await new Promise((resolve) => {
        this.rl.once('close', resolve);
      });
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  }

  /**
   * Shutdown the application
   */
  async shutdown() {
    if (this.shutdownStarted) {
      return;
    }
    this.shutdownStarted = true;

    console.log('');
    enhancedUI.info('Shutting down...');

    // 清理 SIGINT 处理器
    if (this.#sigintHandler) {
      process.removeListener('SIGINT', this.#sigintHandler);
      this.#sigintHandler = null;
    }
    if (this.#sigintTimer) {
      clearTimeout(this.#sigintTimer);
      this.#sigintTimer = null;
    }

    this.isRunning = false;

    this.#disarmSlashCommandSuggestions();

    if (this.rl) {
      this.rl.close();
    }

    // 使用新架构的 engine.dispose
    if (this.engine) {
      await this.engine.dispose();
    }

    stopAllPtySessions();

    enhancedUI.success('Goodbye!');
    process.exit(0);
  }
}

async function handleCliArgs(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!command) {
    return false;
  }

  if (['--help', '-h', 'help'].includes(command)) {
    printCliHelp();
    return true;
  }

  if (['--version', '-v', 'version'].includes(command)) {
    console.log(getPackageVersion());
    return true;
  }

  if (['setup', 'configure', 'config'].includes(command)) {
    const app = new AIEngineeringAgent();
    await app.runSetupWizard();
    return true;
  }

  if (['doctor', 'check'].includes(command)) {
    runDoctor();
    return true;
  }

  if (['config-path', 'where'].includes(command)) {
    console.log(getUserEnvPath());
    return true;
  }

  return false;
}

export { AIEngineeringAgent, handleCliArgs };
export default AIEngineeringAgent;
