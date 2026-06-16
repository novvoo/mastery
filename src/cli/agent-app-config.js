#!/usr/bin/env bun
/**
 * Agent App - Config & Engine Initialization
 * Extracted from agent-app.js
 */

import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { input, password, select } from '@inquirer/prompts';
import { getProviderApiKey, loadCliConfig } from './agent-config.js';
import {
  createConfiguredModelProvider,
  createModelProviderForSwitch,
} from './model-provider-factory.js';

import {
  createAgentEngine,
  PlatformType,
  getEventBus,
  RuntimeEvent,
} from '../runtime/index.js';

import {
  bootstrapRuntime,
  ensureMetricsSink,
  initializeMCPServersFromEnv,
  registerMCPTools as registerMCPToolsInBootstrap,
} from '../core/runtime-bootstrap.js';

import {
  applyRuntimeValues,
  buildMissingConfigMessage,
  getMissingRequiredConfig,
  getProviderBaseUrl,
  getProviderModel,
  getProviderRequirement,
  getUserEnvPath,
  writeUserEnv,
} from '../core/runtime-config.js';

import { enhancedUI } from './enhanced-ui.js';
import { loadRuntimeEnv } from '../core/runtime-config.js';

/**
 * Load CLI configuration from environment
 */
export function loadConfig() {
  return loadCliConfig();
}

/**
 * Ensure runtime config is present; launch setup wizard if missing
 */
export async function ensureRuntimeConfig() {
  const missingVars = getMissingRequiredConfig();
  if (missingVars.length === 0) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(buildMissingConfigMessage(missingVars, getUserEnvPath()));
  }

  await runSetupWizard();
}

/**
 * Run the first-time setup wizard to collect required configuration values
 */
export async function runSetupWizard() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(buildMissingConfigMessage(getMissingRequiredConfig(), getUserEnvPath()));
  }

  const values = await promptForRuntimeConfig();
  const envPath = writeUserEnv(values);
  applyRuntimeValues(values);
  enhancedUI.success(`Configuration saved to ${envPath}`);
  enhancedUI.info('Run `agent` to start, or `agent doctor` to verify the configuration.');
  return envPath;
}

/**
 * Get the API key for a given provider
 */
export function getApiKey(provider) {
  return getProviderApiKey(provider);
}

/**
 * Prompt the user interactively for all required runtime config values
 */
async function promptForRuntimeConfig() {
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

/**
 * Create and initialize the AgentEngine with the given config
 * Returns { engine, toolRegistry, schedulerEngine, mcpClient, tokenJuice,
 *           experienceMemory, securityPolicy, intelligentReasoning, automationEngine }
 */
export async function createEngine(config) {
  const workingDir = config.workingDir;
  const debugMode = config.debug;

  if (!existsSync(workingDir)) {
    mkdirSync(workingDir, { recursive: true });
  }

  const engine = createAgentEngine({
    platform: PlatformType.CLI,
    workingDirectory: workingDir,
    debug: debugMode,
    maxIterations: config.maxIterations,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    tokenBudget: config.tokenBudget,
    tokenBudgetWarningThreshold: config.tokenBudgetWarningThreshold,
    toolResultCacheEnabled: config.toolResultCacheEnabled,
  });

  // —— CLI 也启用 metrics + workspaceState（与 Desktop 一致）
  ensureMetricsSink({
    enabled: config.metrics?.enabled !== false,
    logDir: config.metrics?.logDir || null,
    workingDirectory: workingDir,
  });

  return engine;
}

/**
 * 使用 runtime-bootstrap 创建内核 engine（不走旧的 runtime 层）。
 * 用于 tests 和新入口。返回 { engine, toolRegistry, securityPolicy,
 * workspaceState, metricsSink, mcpClient, workingDirectory }。
 */
export async function createBootstrappedRuntime(config = {}) {
  const workingDir = config.workingDir || process.cwd();
  if (!existsSync(workingDir)) {
    mkdirSync(workingDir, { recursive: true });
  }

  const rt = await bootstrapRuntime({
    workingDirectory: workingDir,
    maxIterations: config.maxIterations || 60,
    debug: !!config.debug,
    securityPolicy: config.securityPolicy || 'full',
    metrics: {
      enabled: config.metrics?.enabled !== false,
      logDir: config.metrics?.logDir || null,
    },
    tokenBudget: config.tokenBudget,
    tokenBudgetWarningThreshold: config.tokenBudgetWarningThreshold,
    toolResultCacheEnabled: config.toolResultCacheEnabled,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    ui: config.ui || null,
    memoryManager: config.memoryManager || null,
    modelProvider: config.modelProvider || null,
  });

  // 可选：自动初始化 MCP
  if (config.autoInitMCP !== false) {
    try {
      await initializeMCPServersFromEnv(
        rt.mcpClient,
        rt.toolRegistry,
        config.debug ? (m) => console.log(m) : null,
      );
    } catch (_) {}
  }

  return rt;
}

/**
 * Create a model provider from config
 */
export async function createModelProvider(config, debugMode) {
  return createConfiguredModelProvider(config, {
    debug: debugMode,
    onCapabilitiesResolved: (modelCapabilities) => {
      if (!debugMode) {
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

/**
 * Set up event bus forwarding to enhancedUI
 */
export function setupEventForwarding(engine, debugMode) {
  const eventBus = getEventBus();

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
        if (debugMode) {
          console.log(enhancedUI.theme.dim(event.message));
        }
        break;
      default:
        console.log(event.message);
    }
  });

  eventBus.subscribe(RuntimeEvent.TOOL_CALL, (event) => {
    if (debugMode) {
      console.log(enhancedUI.theme.dim(`  ${event.activity?.statusText || `Calling: ${event.toolName}`}`));
    }
  });

  eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, (event) => {
    if (debugMode) {
      console.log(enhancedUI.theme.success('✨ Task complete!'));
    }
  });

  eventBus.subscribe(RuntimeEvent.AGENT_ERROR, (event) => {
    console.error(enhancedUI.theme.error(`❌ Agent error: ${event.error}`));
  });
}

/**
 * Initialize MCP servers from environment configuration
 */
export async function initializeMCPServers(mcpClient, toolRegistry, onRegisterMCPTools) {
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

  // Listen for server connection events
  mcpClient.on('serverConnected', (name) => {
    onRegisterMCPTools(toolRegistry, name);
  });

  // Connect to configured servers
  if (mcpConfigs.length > 0) {
    console.log(enhancedUI.theme.dim(`  ℹ️  Connecting to ${mcpConfigs.length} MCP server(s)...`));

    for (const config of mcpConfigs) {
      try {
        const success = await mcpClient.connect(config.name, {
          command: config.command,
          args: config.args,
          env: config.env,
        });

        if (success) {
          console.log(enhancedUI.theme.success(`  ✓ Connected to MCP server: ${config.name}`));
          onRegisterMCPTools(toolRegistry, config.name);
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
 * Register MCP server tools into the tool registry
 * Returns the count of newly registered tools
 */
export function registerMCPTools(mcpClient, toolRegistry, serverName) {
  const tools = mcpClient.getTools().filter(t => t.serverName === serverName);
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
          const result = await mcpClient.callTool(mcpTool.fullName, args);
          return result;
        } catch (error) {
          throw new Error(`MCP tool ${mcpTool.fullName} failed: ${error.message}`);
        }
      },
    };
    toolRegistry.register(tool);
    registered += 1;
  }

  return registered;
}
