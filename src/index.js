#!/usr/bin/env node
/**
 * AI Engineering Mastery Agent
 * Main entry point with enhanced CLI
 */

import { config } from 'dotenv';
import { clearLine, createInterface, cursorTo, emitKeypressEvents } from 'readline';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { input, select } from '@inquirer/prompts';

// Core imports
import { ToolRegistry } from './core/tool-registry.js';
import { SessionManager } from './core/session-manager.js';
import { ReActAgent } from './core/agent.js';
import { MemoryManager } from './memory/memory-manager.js';
import { TokenJuice } from './core/token-juice.js';
import { ExperienceMemory } from './core/experience-memory.js';
import { SecurityPolicy } from './core/security-policy.js';
import { IntelligentReasoning } from './core/intelligent-reasoning.js';
import { AutomationEngine, TriggerType, WorkflowStatus } from './core/automation-engine.js';

// Model imports
import { OpenAIModelProvider } from './models/openai-provider.js';
import { LlamaModelProvider } from './models/llama-provider.js';
import { ZhipuModelProvider } from './models/zhipu-provider.js';
import { DeepSeekModelProvider } from './models/deepseek-provider.js';
import { OpenRouterModelProvider } from './models/openrouter-provider.js';

// Scheduler imports
import { SchedulerEngine } from './scheduler/SchedulerEngine.js';

// Tool imports
import { createFileSystemTools } from './tools/filesystem/filesystem-tools.js';
import { createShellTool } from './tools/system/shell.js';
import { createPtyTools, stopAllPtySessions } from './tools/system/pty.js';
import { createSemanticSearchTool } from './tools/memory/semantic-search.js';
import { createWebTools } from './tools/web/web-tools.js';
import { createTaskTools } from './tools/scheduler/task-tools.js';
import { createScheduleTools } from './tools/scheduler/schedule-tools.js';
import { createSubAgentTools } from './tools/scheduler/subagent-tools.js';
import { createGitTools } from './tools/git/git-tools.js';
import { createMCPTools } from './tools/mcp/mcp-tools.js';

// MCP imports
import { MCPClient } from './mcp/mcp-client.js';

// Skill imports
import createBrainstormTool from './tools/skills/brainstorm.js';
import createGrillTool from './tools/skills/grill.js';
import createTddTool from './tools/skills/tdd.js';
import createDiagnoseTool from './tools/skills/diagnose.js';
import createVerifyTool from './tools/skills/verify.js';
import createReviewTool from './tools/skills/review.js';
import createArchitectTool from './tools/skills/architect.js';
import createZoomOutTool from './tools/skills/zoom_out.js';
import createCavemanTool from './tools/skills/caveman.js';
import createHandoffTool from './tools/skills/handoff.js';
import createToPrdTool from './tools/skills/to_prd.js';
import createToIssuesTool from './tools/skills/to_issues.js';
import createSetupTool from './tools/skills/setup.js';

// UI imports
import { enhancedUI } from './cli/enhanced-ui.js';
import { createEnhancedCommands } from './cli/enhanced-commands.js';
import {
  buildSlashCommandSuggestions,
  formatSlashCommandSuggestions,
  filterSlashCommandSuggestions,
} from './cli/slash-command-suggestions.js';

// Load environment variables
config();

/**
 * Main application class
 */
class AIEngineeringAgent {
  constructor() {
    this.config = this.#loadConfig();
    this.workingDir = this.config.workingDir;
    this.agent = null;
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
  }

  /**
   * Load configuration from environment
   */
  #loadConfig() {
    const provider = process.env.MODEL_PROVIDER || 'openai';
    const model = process.env.OPENAI_MODEL || process.env.MODEL || 'gpt-4';
    
    return {
      provider,
      model,
      apiKey: process.env.OPENAI_API_KEY,
      apiUrl: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
      maxIterations: parseInt(process.env.MAX_ITERATIONS || '10'),
      maxTokens: parseInt(process.env.MAX_TOKENS || '2048'),
      temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
      workingDir: resolve(process.env.WORKING_DIRECTORY || process.cwd()),
      debug: process.env.DEBUG === 'true',
      logDir: process.env.LOG_DIR || './logs',
      intentClassification: process.env.INTENT_CLASSIFICATION !== 'false',
    };
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
    
    for (const mcpTool of tools) {
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
    }
  }

  /**
   * Initialize the application
   */
  async initialize() {
    enhancedUI.setDebugMode(this.debugMode);

    // Ensure working directory exists
    if (!existsSync(this.workingDir)) {
      mkdirSync(this.workingDir, { recursive: true });
    }

    // Create tool registry
    const toolRegistry = new ToolRegistry();

    // Register filesystem tools
    const fsTools = createFileSystemTools();
    for (const tool of fsTools) {
      toolRegistry.register(tool);
    }

    // Register shell tool
    toolRegistry.register(createShellTool());

    // Register interactive terminal and semantic workspace search tools
    for (const tool of createPtyTools()) {
      toolRegistry.register(tool);
    }
    toolRegistry.register(createSemanticSearchTool());

    // Register browser-like web search and fetch tools
    for (const tool of createWebTools()) {
      toolRegistry.register(tool);
    }

    // Register skill tools
    const skillTools = [
      createBrainstormTool(),
      createGrillTool(),
      createTddTool(),
      createDiagnoseTool(),
      createVerifyTool(),
      createReviewTool(),
      createArchitectTool(),
      createZoomOutTool(),
      createCavemanTool(),
      createHandoffTool(),
      createToPrdTool(),
      createToIssuesTool(),
      createSetupTool(),
    ];
    for (const tool of skillTools) {
      toolRegistry.register(tool);
    }
    this.slashCommandSuggestions = buildSlashCommandSuggestions(skillTools);

    // Create model provider
    let modelProvider;
    if (this.config.provider === 'openai') {
      modelProvider = new OpenAIModelProvider(
        this.config.apiKey,
        this.config.apiUrl,
        this.config.model,
        this.debugMode
      );
    } else if (this.config.provider === 'llama') {
      modelProvider = new LlamaModelProvider(this.config.model, {
        temperature: this.config.temperature,
        debug: this.debugMode
      });
    } else if (this.config.provider === 'zhipu') {
      modelProvider = new ZhipuModelProvider(
        process.env.ZHIPU_API_KEY,
        process.env.ZHIPU_BASE_URL,
        this.config.model
      );
    } else if (this.config.provider === 'deepseek') {
      modelProvider = new DeepSeekModelProvider(
        process.env.DEEPSEEK_API_KEY,
        process.env.DEEPSEEK_BASE_URL,
        this.config.model
      );
    } else if (this.config.provider === 'openrouter') {
      modelProvider = new OpenRouterModelProvider(
        process.env.OPENROUTER_API_KEY,
        process.env.OPENROUTER_BASE_URL,
        this.config.model
      );
    } else {
      throw new Error(`Unknown provider: ${this.config.provider}`);
    }

    this.modelProvider = modelProvider;

    // Initialize Security Policy before scheduler/subagents so every agent
    // receives the same enforcement object.
    this.securityPolicy = new SecurityPolicy({
      requireApproval: process.env.REQUIRE_APPROVAL === 'true',
    });

    // Create scheduler engine
    this.schedulerEngine = new SchedulerEngine(
      {
        workingDirectory: this.workingDir,
        dataDir: resolve(this.workingDir, '.agent-data'),
        checkIntervalMs: 60000,
        maxAgents: 10,
        securityPolicy: this.securityPolicy,
      },
      modelProvider,
      toolRegistry,
      null // memoryManager will be created per subagent
    );

    await this.schedulerEngine.initialize();

    // Register scheduler tools (after scheduler engine is created)
    const taskTools = createTaskTools(this.schedulerEngine);
    for (const tool of taskTools) {
      toolRegistry.register(tool);
    }

    const scheduleTools = createScheduleTools(this.schedulerEngine);
    for (const tool of scheduleTools) {
      toolRegistry.register(tool);
    }

    const subAgentTools = createSubAgentTools(this.schedulerEngine);
    for (const tool of subAgentTools) {
      toolRegistry.register(tool);
    }

    // Register Git tools
    const gitTools = createGitTools();
    for (const tool of gitTools) {
      toolRegistry.register(tool);
    }

    // Initialize MCP client and register MCP tools
    this.mcpClient = new MCPClient();
    const mcpTools = createMCPTools(this.mcpClient);
    for (const tool of mcpTools) {
      toolRegistry.register(tool);
    }

    // Auto-connect to configured MCP servers
    await this.#initializeMCPServers(toolRegistry);

    // Initialize TokenJuice (inspired by OpenHuman)
    this.tokenJuice = new TokenJuice({
      maxChars: parseInt(process.env.MAX_RESULT_CHARS || '8000'),
    });

    // Initialize Experience Memory (inspired by OpenHuman's agent_experience)
    const experienceDir = resolve(this.workingDir, '.agent-data');
    if (!existsSync(experienceDir)) mkdirSync(experienceDir, { recursive: true });
    this.experienceMemory = new ExperienceMemory({
      filePath: resolve(experienceDir, 'experience-memory.json'),
      maxExperiences: 500,
    });

    // Register policies after all built-in/MCP tools have been registered.
    this.securityPolicy.registerDefaultPolicies(toolRegistry.getAll());

    // Initialize Intelligent Reasoning Engine
    this.intelligentReasoning = new IntelligentReasoning({
      toolRegistry,
      experienceMemory: this.experienceMemory,
      config: {
        maxCandidates: 5,
        confidenceThreshold: 0.7,
      },
    });

    // Initialize Automation Engine
    this.automationEngine = new AutomationEngine({
      checkIntervalMs: 5000,
      maxConcurrentWorkflows: 5,
      dataDir: resolve(this.workingDir, '.automation'),
    });

    // Create memory manager
    const memoryManager = new MemoryManager(this.workingDir);
    await memoryManager.load();

    // Create main agent
    this.agent = new ReActAgent(
      modelProvider,
      toolRegistry,
      memoryManager,
      {
        maxIterations: this.config.maxIterations,
        temperature: this.config.temperature,
        workingDirectory: this.workingDir,
        debug: this.debugMode,
        intentClassification: this.config.intentClassification,
        securityPolicy: this.securityPolicy,
      },
      enhancedUI
    );

    // Create enhanced commands
    this.commands = createEnhancedCommands(this.schedulerEngine, {
      mcpClient: this.mcpClient,
      tokenJuice: this.tokenJuice,
      experienceMemory: this.experienceMemory,
      securityPolicy: this.securityPolicy,
      intelligentReasoning: this.intelligentReasoning,
      automationEngine: this.automationEngine,
    });

    // Create readline interface
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.rl.on('close', () => {
      this.rlClosed = true;
      this.isRunning = false;
    });
    this.#installSlashCommandSuggestions();

    this.isRunning = true;
  }

  #installSlashCommandSuggestions() {
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.SLASH_SUGGESTIONS === 'false') {
      return;
    }

    emitKeypressEvents(process.stdin, this.rl);
    process.stdin.on('keypress', (_str, key = {}) => {
      if (this.rlClosed || this.isProcessingInput || key.name === 'return' || key.name === 'enter') {
        return;
      }

      setImmediate(() => this.#renderSlashCommandSuggestions());
    });
  }

  #renderSlashCommandSuggestions() {
    if (!this.rl || this.rlClosed || this.isProcessingInput) {
      return;
    }

    const line = this.rl.line || '';
    const suggestions = filterSlashCommandSuggestions(this.slashCommandSuggestions, line, 6);
    const suggestionKey = suggestions.map(command => command.name).join('|');

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
    const toolRegistry = this.agent.getTools();
    const summary = toolRegistry.getToolSummary();
    const totalTools = Object.values(summary).flat().length;
    console.log(enhancedUI.theme.dim(`  ℹ️  Loaded ${totalTools} tools`));
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
    if (!input) return true;

    const command = input.toLowerCase();

    // Exit commands
    if (['exit', 'quit', '/exit', '/quit'].includes(command)) {
      return false;
    }

    // Help
    if (['/help', '/?', 'help'].includes(command)) {
      this.commands.showHelp();
      return true;
    }

    // Clear/reset
    if (['/clear', '/reset', 'clear'].includes(command)) {
      console.clear();
      this.showWelcome();
      return true;
    }

    // Interactive menu
    if (['/menu', 'menu'].includes(command)) {
      await this.showInteractiveMenu();
      return true;
    }

    // Task commands
    if (command.startsWith('/task')) {
      const args = input.slice(5).trim();
      await this.commands.handleTaskCommand(args);
      return true;
    }

    // Schedule commands
    if (command.startsWith('/schedule')) {
      const args = input.slice(9).trim();
      await this.commands.handleScheduleCommand(args);
      return true;
    }

    // SubAgent commands
    if (command.startsWith('/subagent')) {
      const args = input.slice(9).trim();
      await this.commands.handleSubAgentCommand(args);
      return true;
    }

    // Git commands
    if (command.startsWith('/git')) {
      const args = input.slice(4).trim();
      await this.commands.handleGitCommand(args);
      return true;
    }

    // MCP commands
    if (command.startsWith('/mcp')) {
      const args = input.slice(4).trim();
      await this.commands.handleMcpCommand(args);
      return true;
    }

    // Security commands
    if (command.startsWith('/security')) {
      const args = input.slice(9).trim();
      await this.commands.handleSecurityCommand(args);
      return true;
    }

    // Experience commands
    if (command.startsWith('/experience')) {
      const args = input.slice(11).trim();
      await this.commands.handleExperienceCommand(args);
      return true;
    }

    // Compress command
    if (command.startsWith('/compress')) {
      const text = input.slice(9).trim();
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
    if (command.startsWith('/reason')) {
      const args = input.slice(7).trim();
      await this.commands.handleReasonCommand(args);
      return true;
    }

    // Automation commands
    if (command.startsWith('/auto')) {
      const args = input.slice(5).trim();
      await this.commands.handleAutoCommand(args);
      return true;
    }

    // Statistics
    if (['/stats', '/status', 'stats'].includes(command)) {
      await this.commands.showStatistics();
      return true;
    }

    // Tools list
    if (['/tools', '/list'].includes(command)) {
      this.showTools();
      return true;
    }

    // Debug command
    if (command.startsWith('/debug')) {
      const args = input.slice(6).trim();
      
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
      if (this.agent && typeof this.agent.setDebugMode === 'function') {
        this.agent.setDebugMode(this.debugMode);
      }
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
    if (command.startsWith('/model')) {
      const args = input.slice(6).trim();
      await this.handleModelCommand(args);
      return true;
    }

    if (await this.#processSlashToolCommand(input)) {
      return true;
    }

    // Regular input - process through agent
    await this.processAgentInput(input);
    return true;
  }

  async #processSlashToolCommand(input) {
    const match = input.match(/^\/([A-Za-z_][\w-]*)(?:\s+([\s\S]*))?$/);
    if (!match || !this.agent) {
      return false;
    }

    const rawName = match[1];
    const toolName = rawName.toLowerCase().replace(/-/g, '_');
    const toolRegistry = this.agent.getTools();
    const tool = toolRegistry.get(toolName);

    if (!tool) {
      return false;
    }

    const argsText = (match[2] || '').trim();
    const parsed = this.#parseSlashToolArgs(tool, argsText);
    if (parsed.error) {
      enhancedUI.error(parsed.error);
      this.#showSlashToolUsage(rawName, tool);
      return true;
    }

    const missing = this.#getToolRequiredParams(tool)
      .filter(paramName => parsed.args[paramName] === undefined || parsed.args[paramName] === '');
    if (missing.length > 0) {
      enhancedUI.warning(`Missing required argument(s): ${missing.join(', ')}`);
      this.#showSlashToolUsage(rawName, tool);
      return true;
    }

    try {
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
    let consumed = '';

    while ((match = regex.exec(text)) !== null) {
      consumed += match[0];
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
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    return value;
  }

  #getToolRequiredParams(tool) {
    return tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []);
  }

  #showSlashToolUsage(rawName, tool) {
    const required = this.#getToolRequiredParams(tool);
    const optional = Object.keys(tool.params || tool.parameters?.properties || {})
      .filter(paramName => !required.includes(paramName));

    console.log(enhancedUI.createHeader(`/${rawName} Usage`));
    console.log(tool.description || `Run the ${tool.name} tool.`);
    console.log('');
    console.log('JSON:');
    console.log(`  /${rawName} {"${required[0] || 'arg'}":"value"}`);
    console.log('');
    console.log('key=value:');
    const requiredExample = required.map(paramName => `${paramName}="value"`).join(' ');
    console.log(`  /${rawName}${requiredExample ? ` ${requiredExample}` : ''}`);
    if (tool.name === 'tdd') {
      console.log('');
      console.log('TDD shorthand:');
      console.log(`  /${rawName} red ComponentName expected behavior`);
    }
    if (optional.length > 0) {
      console.log('');
      console.log(`Optional: ${optional.join(', ')}`);
    }
    console.log('');
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
      // Validate provider
      const validProviders = ['openai', 'llama', 'zhipu', 'deepseek', 'openrouter'];
      if (!validProviders.includes(provider)) {
        throw new Error(`Unknown provider: ${provider}. Supported: ${validProviders.join(', ')}`);
      }

      // Check API key based on provider
      if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not set in environment');
      }
      if (provider === 'zhipu' && !process.env.ZHIPU_API_KEY) {
        throw new Error('ZHIPU_API_KEY not set in environment');
      }
      if (provider === 'deepseek' && !process.env.DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY not set in environment');
      }
      if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not set in environment');
      }

      // Create new model provider
      let newProvider;
      if (provider === 'openai') {
        newProvider = new OpenAIModelProvider(
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
          model,
          this.debugMode
        );
      } else if (provider === 'llama') {
        newProvider = new LlamaModelProvider(model, {
          temperature: this.config.temperature,
          debug: this.debugMode
        });
      } else if (provider === 'zhipu') {
        newProvider = new ZhipuModelProvider(
          process.env.ZHIPU_API_KEY,
          process.env.ZHIPU_BASE_URL,
          model
        );
      } else if (provider === 'deepseek') {
        newProvider = new DeepSeekModelProvider(
          process.env.DEEPSEEK_API_KEY,
          process.env.DEEPSEEK_BASE_URL,
          model
        );
      } else if (provider === 'openrouter') {
        newProvider = new OpenRouterModelProvider(
          process.env.OPENROUTER_API_KEY,
          process.env.OPENROUTER_BASE_URL,
          model
        );
      }

      // Update config
      this.config.provider = provider;
      this.config.model = model;

      // Update agent's model provider
      this.agent.setModelProvider(newProvider);

      // Update scheduler engine's model provider for new subagents
      this.schedulerEngine.modelProvider = newProvider;

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
    const toolRegistry = this.agent.getTools();
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
      // Since we passed enhancedUI to agent, it will use it directly
      // We'll just handle spinner start/stop
      spinner.stop();
      await this.agent.run(input);
      enhancedUI.debugEvent('Agent input completed', {
        inputChars: input.length,
      });
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
        this.enqueueInput(rawInput);
      });
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

    this.isRunning = false;

    if (this.rl) {
      this.rl.close();
    }

    if (this.schedulerEngine) {
      await this.schedulerEngine.stop();
    }

    if (this.mcpClient) {
      await this.mcpClient.dispose();
    }

    stopAllPtySessions();

    enhancedUI.success('Goodbye!');
    process.exit(0);
  }
}

// Run the application
const app = new AIEngineeringAgent();
app.run();

export default AIEngineeringAgent;
