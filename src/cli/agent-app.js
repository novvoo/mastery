#!/usr/bin/env bun
/**
 * AI Engineering Mastery Agent
 * 主入口点 - 使用新架构 Runtime Layer
 *
 * This module re-exports the thin coordinator class that delegates to:
 *   - agent-app-config.js       → Config & Engine initialization
 *   - agent-app-input.js        → Input loop & readline management
 *   - agent-app-slash-commands.js → Slash command routing
 */

import { enhancedUI } from './enhanced-ui.js';
import { createEnhancedCommands } from './enhanced-commands.js';
import { getPackageVersion, printCliHelp, runDoctor } from './bootstrap-utils.js';
import { getUserEnvPath } from '../core/runtime-config.js';
import { stopAllPtySessions } from '../tools/system/pty.js';
import { loadRuntimeEnv } from '../core/runtime-config.js';

// Extracted modules
import {
  loadConfig,
  ensureRuntimeConfig,
  runSetupWizard,
  createEngine,
  createModelProvider,
  setupEventForwarding,
  initializeMCPServers,
  registerMCPTools as doRegisterMCPTools,
} from './agent-app-config.js';

import {
  createReadlineInterface,
  setupSigintHandler,
  removeSigintHandler,
  installSlashCommandSuggestions,
  armSlashCommandSuggestions,
  disarmSlashCommandSuggestions,
  getInput,
  drainInputQueue,
  rebuildSlashCommandSuggestions,
} from './agent-app-input.js';

import {
  processCommand,
  showCommandHelp,
  showMemoryContext,
  handleDocumentCommand,
  handlePreviewCommand,
  handleModelCommand,
  showCurrentModel,
  interactiveModelSwitch,
  switchModel,
  showInteractiveMenu,
  showTools,
  processAgentInput,
  showBuiltInCommandHelp,
} from './agent-app-slash-commands.js';

// Load environment variables from the user config and the current workspace.
loadRuntimeEnv();

/**
 * Main application class — thin coordinator that delegates to extracted modules.
 */
class AIEngineeringAgent {
  constructor() {
    this.config = loadConfig();
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

    // SIGINT state (managed by agent-app-input)
    this.#sigintInfo = null;
  }

  #sigintInfo = null;

  /**
   * Initialize the application - 使用新架构 AgentEngine
   */
  async initialize() {
    await ensureRuntimeConfig();
    this.config = loadConfig();
    this.workingDir = this.config.workingDir;
    this.debugMode = this.config.debug;
    enhancedUI.setDebugMode(this.debugMode);

    // Create engine via config module
    this.engine = await createEngine(this.config);

    // 设置事件转发到 enhancedUI
    setupEventForwarding(this.engine, this.debugMode);

    // 创建模型提供者
    const modelProvider = await createModelProvider(this.config, this.debugMode);
    this.engine.attachModelProvider(modelProvider);
    this.modelProvider = modelProvider;

    // 初始化引擎
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
      registerMcpTools: serverName => this.#registerMCPTools(serverName),
    });

    // Initialize MCP servers
    await initializeMCPServers(this.mcpClient, this.toolRegistry, (toolRegistry, serverName) => {
      this.#registerMCPTools(serverName);
    });

    // Build initial slash command suggestions from registered tools
    this.slashCommandSuggestions = rebuildSlashCommandSuggestions(this.engine);

    // Create readline interface
    this.rl = createReadlineInterface(this.slashCommandSuggestions);
    this.rl.on('close', () => {
      this.rlClosed = true;
      this.isRunning = false;
    });

    // Handle Ctrl+C
    this.#sigintInfo = setupSigintHandler(this);

    // Install slash command suggestions
    installSlashCommandSuggestions(this);

    this.isRunning = true;
  }

  /**
   * Register MCP tools (delegates to config module, then rebuilds suggestions)
   */
  #registerMCPTools(serverName) {
    const registered = doRegisterMCPTools(this.mcpClient, this.toolRegistry, serverName);
    // Rebuild slash command suggestions when new MCP tools are registered
    this.slashCommandSuggestions = rebuildSlashCommandSuggestions(this.engine);
    return registered;
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
   * Get user input (delegates to input module)
   */
  async getInput() {
    return getInput(this);
  }

  /**
   * Process user command (delegates to slash-commands module)
   */
  async processCommand(input) {
    return processCommand(this, input);
  }

  /**
   * Show command help (delegates to slash-commands module)
   */
  showCommandHelp(commandText = '') {
    return showCommandHelp(this, commandText);
  }

  /**
   * Show memory context (delegates to slash-commands module)
   */
  showMemoryContext(argsText = '') {
    return showMemoryContext(this, argsText);
  }

  /**
   * Handle document command (delegates to slash-commands module)
   */
  async handleDocumentCommand(argsText = '') {
    return handleDocumentCommand(this, argsText);
  }

  /**
   * Handle preview command (delegates to slash-commands module)
   */
  async handlePreviewCommand(argsText = '') {
    return handlePreviewCommand(this, argsText);
  }

  /**
   * Handle model command (delegates to slash-commands module)
   */
  async handleModelCommand(args) {
    return handleModelCommand(this, args);
  }

  /**
   * Show current model info (delegates to slash-commands module)
   */
  showCurrentModel() {
    return showCurrentModel(this);
  }

  /**
   * Interactive model switch (delegates to slash-commands module)
   */
  async interactiveModelSwitch() {
    return interactiveModelSwitch(this);
  }

  /**
   * Switch to a new model (delegates to slash-commands module)
   */
  async switchModel(provider, model) {
    return switchModel(this, provider, model);
  }

  /**
   * Show interactive menu (delegates to slash-commands module)
   */
  async showInteractiveMenu() {
    return showInteractiveMenu(this);
  }

  /**
   * Show available tools (delegates to slash-commands module)
   */
  showTools() {
    return showTools(this);
  }

  /**
   * Process input through the agent (delegates to slash-commands module)
   */
  async processAgentInput(input) {
    return processAgentInput(this, input);
  }

  /**
   * Queue readline input and process it sequentially.
   */
  enqueueInput(rawInput) {
    this.inputQueue.push(rawInput);
    drainInputQueue(this);
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
        armSlashCommandSuggestions();
        this.enqueueInput(rawInput);
      });
      armSlashCommandSuggestions();
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
   * Run setup wizard (delegates to config module)
   */
  async runSetupWizard() {
    return runSetupWizard();
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
    if (this.#sigintInfo) {
      removeSigintHandler(this.#sigintInfo.handler);
      this.#sigintInfo.clearTimer();
      this.#sigintInfo = null;
    }

    this.isRunning = false;

    disarmSlashCommandSuggestions();

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
