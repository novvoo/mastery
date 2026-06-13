#!/usr/bin/env bun
/**
 * Agent App - Slash Command Routing & Handlers
 * Extracted from agent-app.js
 */

import { select, input } from '@inquirer/prompts';
import {
  assertSupportedProvider,
  createModelProviderForSwitch,
} from './model-provider-factory.js';

import { ToolCategory } from '../core/types.js';
import { Embedder } from '../core/embedder.js';
import { enhancedUI } from './enhanced-ui.js';
import { COMMAND_HELP, COMMAND_HELP_ALIASES } from './command-help.js';
import {
  chooseDocumentFile,
  extractDocumentReferences,
  formatBytes,
  stripWrappingQuotes,
} from './document-command-utils.js';
import { listPreviews, startPreview, stopPreview } from '../core/preview-server.js';

// ---------------------------------------------------------------------------
// processCommand – top-level slash command router
// ---------------------------------------------------------------------------

/**
 * Route a user input string to the correct command handler.
 * Returns `true` to keep the REPL alive, `false` to exit.
 */
export async function processCommand(agent, input) {
  if (!input) { return true; }

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
      showCommandHelp(agent, argsText);
    } else {
      agent.commands.showHelp();
    }
    return true;
  }

  if (commandName.startsWith('/') && ['help', '--help', '-h'].includes(argsText.toLowerCase())) {
    showCommandHelp(agent, commandName);
    return true;
  }

  // Clear/reset
  if (['/clear', '/reset', 'clear'].includes(commandName)) {
    console.clear();
    agent.showWelcome();
    return true;
  }

  // Interactive menu
  if (['/menu', 'menu'].includes(commandName)) {
    await showInteractiveMenu(agent);
    return true;
  }

  // Task commands
  if (['/task', '/tasks'].includes(commandName)) {
    await agent.commands.handleTaskCommand(argsText || 'list');
    return true;
  }

  // Schedule commands
  if (['/schedule', '/schedules'].includes(commandName)) {
    await agent.commands.handleScheduleCommand(argsText || 'list');
    return true;
  }

  // SubAgent commands
  if (['/subagent', '/subagents'].includes(commandName)) {
    await agent.commands.handleSubAgentCommand(argsText || 'list');
    return true;
  }

  // Git commands
  if (commandName === '/git') {
    await agent.commands.handleGitCommand(argsText);
    return true;
  }

  // MCP commands
  if (commandName === '/mcp') {
    await agent.commands.handleMcpCommand(argsText);
    return true;
  }

  // Security commands
  if (commandName === '/security') {
    await agent.commands.handleSecurityCommand(argsText);
    return true;
  }

  // Experience commands
  if (commandName === '/experience') {
    await agent.commands.handleExperienceCommand(argsText);
    return true;
  }

  // Project memory/context commands
  if (['/memory', '/context'].includes(commandName)) {
    showMemoryContext(agent, argsText);
    return true;
  }

  // User document RAG commands
  if (['/doc', '/docs', '/document', '/documents'].includes(commandName)) {
    await handleDocumentCommand(agent, argsText);
    return true;
  }

  if (commandName === '/preview') {
    await handlePreviewCommand(agent, argsText);
    return true;
  }

  // Compress command
  if (commandName === '/compress') {
    handleCompressCommand(agent, argsText);
    return true;
  }

  // Reasoning commands
  if (commandName === '/reason') {
    await agent.commands.handleReasonCommand(argsText);
    return true;
  }

  // Automation commands
  if (commandName === '/auto') {
    await agent.commands.handleAutoCommand(argsText);
    return true;
  }

  // Statistics
  if (['/stats', '/status', 'stats'].includes(commandName)) {
    await agent.commands.showStatistics();
    return true;
  }

  // Tools list
  if (['/tools', '/list'].includes(commandName)) {
    showTools(agent);
    return true;
  }

  // Debug command
  if (commandName === '/debug') {
    await handleDebugCommand(agent, argsText);
    return true;
  }

  // Model commands
  if (commandName === '/model') {
    await handleModelCommand(agent, argsText);
    return true;
  }

  if (await processSlashToolCommand(agent, input)) {
    return true;
  }

  // Regular input - process through agent
  await processAgentInput(agent, input);
  return true;
}

// ---------------------------------------------------------------------------
// Document command
// ---------------------------------------------------------------------------

export async function handleDocumentCommand(agent, argsText = '') {
  const raw = String(argsText || '').trim();
  const [subcommandRaw, ...restParts] = raw.split(/\s+/).filter(Boolean);
  const subcommand = (subcommandRaw || 'list').toLowerCase();
  const restText = raw.slice(subcommandRaw?.length || 0).trim();

  if (['help', '--help', '-h'].includes(subcommand)) {
    showBuiltInCommandHelp('doc');
    return;
  }

  if (['init', 'status', 'doctor'].includes(subcommand)) {
    await handleDocumentInitCommand();
    return;
  }

  const toolRegistry = agent.toolRegistry;
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
      const result = await toolRegistry.execute('document_add', { source }, documentToolContext(agent));
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
      const result = await toolRegistry.execute('document_search', { query, limit: 5 }, documentToolContext(agent));
      spinner.stop();

      const firstResultLine = (result || '').split('\n')[0];
      const searchPayload = result ? String(result) : '';
      const truncatedSearch = searchPayload.length > 8000 ? searchPayload.slice(0, 8000) + '\n...[truncated]' : searchPayload;
      if (showRaw) {
        console.log(enhancedUI.theme.dim(firstResultLine));
      }

      let answerText = '';
      if (agent.modelProvider && searchPayload && !searchPayload.startsWith('No document')) {
        try {
          const refineSpinner = enhancedUI.spinner('Refining answer...');
          refineSpinner.start();
          const refineMessages = [
            { role: 'system', content: 'You are a precise document analyst. Based on the user question and search results, extract a concise answer. Use the user\'s language. If insufficient info, say so.' },
            { role: 'user', content: 'Question: ' + query + '\n\nSearch results:\n' + truncatedSearch }
          ];
          const refineResponse = await agent.modelProvider.chat(refineMessages, { maxTokens: 500 });
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
      const result = await toolRegistry.execute('document_list', {}, documentToolContext(agent));
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
      }, documentToolContext(agent));
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
  showBuiltInCommandHelp('doc');
}

// ---------------------------------------------------------------------------
// Document init command
// ---------------------------------------------------------------------------

async function handleDocumentInitCommand() {
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

// ---------------------------------------------------------------------------
// Preview command
// ---------------------------------------------------------------------------

export async function handlePreviewCommand(agent, argsText = '') {
  const args = parseArgs(argsText || '');
  const subcommand = (args[0] || 'start').toLowerCase();

  if (['help', '--help', '-h'].includes(subcommand)) {
    showBuiltInCommandHelp('preview');
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
      workingDirectory: agent.workingDir,
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

// ---------------------------------------------------------------------------
// Compress command
// ---------------------------------------------------------------------------

function handleCompressCommand(agent, argsText) {
  const text = argsText;
  if (text) {
    const compressed = agent.tokenJuice.compress(text);
    const stats = agent.tokenJuice.getStats(text, compressed);
    console.log(enhancedUI.createHeader('TokenJuice Compression'));
    console.log(`Original: ${stats.originalChars} chars / ~${stats.originalTokens} tokens`);
    console.log(`Compressed: ${stats.compressedChars} chars / ~${stats.compressedTokens} tokens`);
    console.log(`Savings: ${stats.savingsPercent}%`);
    console.log('');
    console.log(compressed);
  } else {
    enhancedUI.info('Usage: /compress <text to compress>');
  }
}

// ---------------------------------------------------------------------------
// Debug command
// ---------------------------------------------------------------------------

async function handleDebugCommand(agent, argsText) {
  const args = argsText.toLowerCase();

  if (args === 'on' || args === 'enable') {
    agent.debugMode = true;
  } else if (args === 'off' || args === 'disable') {
    agent.debugMode = false;
  } else if (args === 'status') {
    console.log(enhancedUI.createHeader('Debug Status'));
    console.log(`Debug mode: ${agent.debugMode ? '✅  Enabled' : '❌  Disabled'}`);
    console.log(`Model provider: ${agent.config.provider}`);
    console.log(`Model: ${agent.config.model}`);
    console.log('');
    return;
  } else {
    agent.debugMode = !agent.debugMode;
  }

  if (agent.modelProvider) {
    if (typeof agent.modelProvider.setDebugMode === 'function') {
      agent.modelProvider.setDebugMode(agent.debugMode);
    }
  }
  enhancedUI.setDebugMode(agent.debugMode);
  process.env.DEBUG = agent.debugMode ? 'true' : 'false';

  console.log(enhancedUI.createHeader('Debug Mode'));
  if (agent.debugMode) {
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
}

// ---------------------------------------------------------------------------
// Model command
// ---------------------------------------------------------------------------

export async function handleModelCommand(agent, args) {
  if (!args || args === 'list') {
    showCurrentModel(agent);
    return;
  }

  if (args === 'switch' || args === 'change') {
    await interactiveModelSwitch(agent);
    return;
  }

  // Try to parse as provider:model format
  const parts = args.split(':');
  if (parts.length === 2) {
    const [provider, model] = parts;
    await switchModel(agent, provider.trim(), model.trim());
    return;
  }

  // Try to parse as just model name (keep current provider)
  await switchModel(agent, agent.config.provider, args.trim());
}

export function showCurrentModel(agent) {
  console.log(enhancedUI.createHeader('Current Model'));

  const table = enhancedUI.createTable({
    colWidths: [20, 50],
  });

  table.push(
    [enhancedUI.theme.primaryBold('Provider'), agent.config.provider],
    [enhancedUI.theme.primaryBold('Model'), agent.config.model],
    [enhancedUI.theme.primaryBold('Temperature'), agent.config.temperature],
    [enhancedUI.theme.primaryBold('Max Iterations'), agent.config.maxIterations],
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

export async function interactiveModelSwitch(agent) {
  const provider = await select({
    message: 'Select provider:',
    choices: [
      { name: '🔵 OpenAI', value: 'openai' },
      { name: '🦙 Llama (Local)', value: 'llama' },
      { name: '🇨🇳 Zhipu AI (智谱清言)', value: 'zhipu' },
      { name: '🔮 DeepSeek', value: 'deepseek' },
      { name: '🌐 OpenRouter', value: 'openrouter' },
    ],
    default: agent.config.provider,
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
    default: agent.config.model,
  });

  let finalModel = model;
  if (model === 'custom') {
    const customModel = await input({
      message: 'Enter model name:',
      validate: (input) => input.trim() !== '' || 'Model name is required',
    });
    finalModel = customModel.trim();
  }

  await switchModel(agent, provider, finalModel);
}

export async function switchModel(agent, provider, model) {
  const spinner = enhancedUI.spinner('Switching model...');
  spinner.start();

  try {
    assertSupportedProvider(provider);
    const newProvider = createModelProviderForSwitch(provider, model, {
      temperature: agent.config.temperature,
      debug: agent.debugMode,
    });

    // Update config
    agent.config.provider = provider;
    agent.config.model = model;

    // Update engine's model provider
    agent.engine.attachModelProvider(newProvider);

    // Update scheduler engine's model provider for new subagents
    if (agent.schedulerEngine) {
      agent.schedulerEngine.modelProvider = newProvider;
    }

    // Update our model provider reference
    agent.modelProvider = newProvider;

    spinner.stop();
    enhancedUI.success(`Switched to ${provider}:${model}`);
    console.log('');

  } catch (error) {
    spinner.stop();
    enhancedUI.error(`Failed to switch model: ${error.message}`);
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Memory / Context command
// ---------------------------------------------------------------------------

export function showMemoryContext(agent, argsText = '') {
  const mode = String(argsText || '').trim().toLowerCase();
  const memoryManager = agent.engine?.getMemoryManager();
  if (!memoryManager) {
    enhancedUI.error('Project memory is not initialized');
    return;
  }

  const context = memoryManager.getContext();
  console.log(enhancedUI.createHeader('Project Memory Context'));
  console.log(`Path: ${memoryManager.getContextPath()}`);
  console.log(`Project: ${context.projectInfo?.name || '(unknown)'}`);
  console.log(`Working directory: ${context.projectInfo?.path || agent.workingDir}`);
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

// ---------------------------------------------------------------------------
// Interactive menu
// ---------------------------------------------------------------------------

export async function showInteractiveMenu(agent) {
  let exitMenu = false;

  while (!exitMenu && agent.isRunning) {
    const action = await agent.commands.showMainMenu();

    switch (action) {
      case 'tasks':
        await agent.commands.showTaskMenu();
        break;
      case 'schedules':
        await agent.commands.showScheduleMenu();
        break;
      case 'subagents':
        await agent.commands.handleSubAgentCommand('list');
        break;
      case 'git':
        await agent.commands.showGitMenu();
        break;
      case 'mcp':
        await agent.commands.showMcpMenu();
        break;
      case 'security':
        await agent.commands.showSecurityMenu();
        break;
      case 'experience':
        await agent.commands.showExperienceMenu();
        break;
      case 'reasoning':
        await agent.commands.showReasonMenu();
        break;
      case 'automation':
        await agent.commands.showAutoMenu();
        break;
      case 'stats':
        await agent.commands.showStatistics();
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

// ---------------------------------------------------------------------------
// Show tools
// ---------------------------------------------------------------------------

export function showTools(agent) {
  const toolRegistry = agent.toolRegistry;
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

// ---------------------------------------------------------------------------
// Agent input processing
// ---------------------------------------------------------------------------

export async function processAgentInput(agent, input) {
  const spinner = enhancedUI.spinner('Thinking...');
  spinner.start();

  try {
    enhancedUI.debugEvent('User input received', {
      commandType: 'agent',
      inputPreview: input.length > 240 ? input.substring(0, 240) + '... (truncated)' : input,
      inputChars: input.length,
    });
    const preparedInput = await prepareDocumentReferences(agent, input);
    const result = await agent.engine.processInput(preparedInput);
    spinner.stop();
    enhancedUI.debugEvent('Agent input completed', {
      inputChars: preparedInput.length,
      result: result?.status || (result?.answer ? 'completed' : 'unknown'),
    });

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

// ---------------------------------------------------------------------------
// Prepare document references (@-prefixed paths in input)
// ---------------------------------------------------------------------------

async function prepareDocumentReferences(agent, input) {
  const refs = extractDocumentReferences(input, agent.workingDir);
  if (refs.length === 0) {
    return input;
  }

  const toolRegistry = agent.toolRegistry;
  const indexed = [];
  const spinner = enhancedUI.spinner(`Indexing ${refs.length} referenced document${refs.length === 1 ? '' : 's'}...`);
  spinner.start();
  for (const source of refs) {
    try {
      const result = await toolRegistry.execute('document_add', { source }, documentToolContext(agent));
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

// ---------------------------------------------------------------------------
// Slash tool command (dynamic /<tool-name> dispatch)
// ---------------------------------------------------------------------------

async function processSlashToolCommand(agent, input) {
  const match = input.match(/^\/([A-Za-z_][\w-]*)(?:\s+([\s\S]*))?$/);
  if (!match || !agent.engine) {
    return false;
  }

  const rawName = match[1];
  const toolName = rawName.toLowerCase().replace(/-/g, '_');
  const toolRegistry = agent.toolRegistry;
  const tool = toolRegistry.get(toolName);

  if (!tool) {
    return false;
  }

  const argsText = (match[2] || '').trim();
  if (!argsText || ['help', '--help', '-h'].includes(argsText.toLowerCase())) {
    showSlashToolHelp(agent, rawName, tool);
    return true;
  }

  const parsed = parseSlashToolArgs(agent, tool, argsText);
  if (parsed.error) {
    enhancedUI.error(parsed.error);
    showSlashToolHelp(agent, rawName, tool);
    return true;
  }

  const missing = getToolRequiredParams(tool)
    .filter(paramName => parsed.args[paramName] === undefined || parsed.args[paramName] === '');
  if (missing.length > 0) {
    enhancedUI.warning(`Missing required argument(s): ${missing.join(', ')}`);
    showSlashToolHelp(agent, rawName, tool);
    return true;
  }

  try {
    const displayCommand = `/${rawName}${argsText ? ` ${argsText}` : ''}`;
    console.log(`${enhancedUI.theme.dim('Running slash command:')} ${displayCommand}`);
    enhancedUI.toolCall(toolName, parsed.args);
    const result = await toolRegistry.execute(toolName, parsed.args, {
      workingDirectory: agent.workingDir,
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

// ---------------------------------------------------------------------------
// Command help
// ---------------------------------------------------------------------------

export function showCommandHelp(agent, commandText = '') {
  const normalized = String(commandText || '').trim().replace(/^\//, '');
  if (!normalized) {
    agent.commands.showHelp();
    return;
  }

  const rawName = normalized.split(/\s+/, 1)[0].toLowerCase();
  const builtInName = COMMAND_HELP_ALIASES[rawName] || rawName;
  if (builtInName === 'commands') {
    agent.commands.showHelp();
    return;
  }
  if (builtInName === 'skills') {
    showSlashSkillList(agent);
    return;
  }
  if (COMMAND_HELP[builtInName]) {
    showBuiltInCommandHelp(builtInName);
    return;
  }

  const toolName = rawName.replace(/-/g, '_');
  const tool = agent.toolRegistry?.get(toolName);
  if (tool) {
    showSlashToolHelp(agent, rawName, tool);
    return;
  }

  enhancedUI.info(`No detailed help found for /${rawName}.`);
  enhancedUI.info('Use /help to list available commands.');
}

export function showBuiltInCommandHelp(commandName) {
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

function showSlashSkillList(agent) {
  const tools = agent.toolRegistry?.getAll() || [];
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

// ---------------------------------------------------------------------------
// Slash tool help formatting
// ---------------------------------------------------------------------------

function showSlashToolHelp(agent, rawName, tool) {
  const params = tool.params || tool.parameters?.properties || {};
  const required = getToolRequiredParams(tool);
  const examples = getSlashToolExamples(rawName, tool);

  console.log(enhancedUI.createHeader(`Command Help: /${rawName}`));
  console.log(tool.description || `Run the ${tool.name} tool.`);
  console.log('');
  console.log(`Usage: ${formatSlashToolUsage(rawName, tool)}`);
  console.log('');
  console.log('Effects:');
  for (const effect of inferSlashToolEffects(tool)) {
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

function formatSlashToolUsage(rawName, tool) {
  const params = tool.params || tool.parameters?.properties || {};
  const required = getToolRequiredParams(tool);
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

function inferSlashToolEffects(tool) {
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

function getSlashToolExamples(rawName, tool) {
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

  const required = getToolRequiredParams(tool);
  if (required.length === 0) {
    return [`/${rawName} --help`];
  }
  return [`/${rawName} ${required.map(name => `${name}="value"`).join(' ')}`];
}

// ---------------------------------------------------------------------------
// Slash tool argument parsing
// ---------------------------------------------------------------------------

function parseSlashToolArgs(agent, tool, argsText) {
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

  const keyValueArgs = parseKeyValueArgs(trimmed);
  if (keyValueArgs) {
    return { args: keyValueArgs };
  }

  if (tool.name === 'tdd') {
    const shorthand = parseTddShorthand(trimmed);
    if (shorthand) {
      return { args: shorthand };
    }
  }

  const required = getToolRequiredParams(tool);
  if (required.length === 1) {
    return { args: { [required[0]]: trimmed } };
  }

  return {
    error: 'Could not parse slash tool arguments. Use JSON or key=value arguments.',
  };
}

function parseKeyValueArgs(text) {
  const args = {};
  const regex = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    args[match[1]] = coerceSlashValue(match[2] ?? match[3] ?? match[4] ?? match[5] ?? '');
  }

  if (Object.keys(args).length === 0) {
    return null;
  }

  const remainder = text.replace(regex, '').trim();
  return remainder ? null : args;
}

function parseTddShorthand(text) {
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

function coerceSlashValue(value) {
  if (value === 'true') { return true; }
  if (value === 'false') { return false; }
  if (value === 'null') { return null; }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) { return Number(value); }
  return value;
}

function getToolRequiredParams(tool) {
  return tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function parseArgs(text) {
  return text.split(/\s+/).filter(Boolean);
}

function documentToolContext(agent) {
  return {
    workingDirectory: agent.workingDir,
    debug: agent.debugMode,
    ui: enhancedUI,
  };
}
