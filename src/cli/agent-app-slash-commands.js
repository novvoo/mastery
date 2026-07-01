#!/usr/bin/env bun
/**
 * Agent App - Slash Command Routing & Handlers
 * Extracted from agent-app.js
 */

import { ToolCategory } from '../core/types.js';
import { Embedder } from '../core/embedder.js';
import { OCRRuntime } from '../core/ocr-runtime.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { enhancedUI } from './enhanced-ui.js';
import { COMMAND_HELP, COMMAND_HELP_ALIASES } from './command-help.js';
import { handlePreviewCommand } from './agent-app-preview-commands.js';
import { handleModelCommand } from './agent-app-model-commands.js';
import {
  chooseDocumentFile,
  extractDocumentReferences,
  formatBytes,
  stripWrappingQuotes,
} from './document-command-utils.js';

export { handlePreviewCommand } from './agent-app-preview-commands.js';
export {
  handleModelCommand,
  interactiveModelSwitch,
  showCurrentModel,
  switchModel,
} from './agent-app-model-commands.js';

// ---------------------------------------------------------------------------
// processCommand – top-level slash command router
// ---------------------------------------------------------------------------

/**
 * Route a user input string to the correct command handler.
 * Returns `true` to keep the REPL alive, `false` to exit.
 */
export async function processCommand(agent, input) {
  if (!input) {
    return true;
  }

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

  if (['/ocr', '/orc'].includes(commandName)) {
    await handleOCRCommand(agent, argsText);
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

  // Activity summary — 展示当前会话的工具活动摘要
  if (['/summary', '/activity'].includes(commandName)) {
    if (agent.uiAdapter && typeof agent.uiAdapter.printActivitySummary === 'function') {
      agent.uiAdapter.printActivitySummary();
    } else {
      enhancedUI.info('暂无活动摘要（需要先执行任务）');
    }
    return true;
  }

  // Workspace — 列出工作目录文件
  if (['/workspace', '/files', '/ls'].includes(commandName)) {
    await handleWorkspaceCommand(agent, argsText);
    return true;
  }

  // Session — 会话管理
  if (['/session', '/sessions'].includes(commandName)) {
    await handleSessionCommand(agent, argsText);
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
    const addParts = restParts.filter((part) => part !== '--ocr' && part !== '--force-ocr');
    const forceOCR = restParts.includes('--ocr') || restParts.includes('--force-ocr');
    let source = stripWrappingQuotes(addParts.join(' '));
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
      const result = await toolRegistry.execute(
        'document_add',
        { source, ocr: forceOCR },
        documentToolContext(agent),
      );
      spinner.stop();
      if (!result?.success) {
        enhancedUI.error(result?.error || 'Document indexing failed.');
        return;
      }
      enhancedUI.success(`Indexed document: ${result.title}`);
      console.log(`  id: ${result.id}`);
      console.log(`  kind: ${result.kind}`);
      console.log(`  extraction: ${result.extractionMethod || 'text'}`);
      if (Number.isFinite(result.ocrConfidence)) {
        console.log(`  OCR confidence: ${(result.ocrConfidence * 100).toFixed(1)}%`);
      }
      console.log(`  chunks: ${result.chunks}`);
      console.log(`  source: ${result.source}`);
    } catch (error) {
      spinner.stop();
      enhancedUI.error(`Document indexing failed: ${error.message}`);
    }
    return;
  }

  if (['search', 'find', 'query'].includes(subcommand)) {
    const flags = new Set(restParts.filter((p) => p.startsWith('--')));
    const query = restParts.filter((p) => !p.startsWith('--')).join(' ');
    const showRaw = flags.has('--debug') || flags.has('--raw');
    if (!query) {
      enhancedUI.info('Usage: /doc search <query> [--debug|--raw]');
      return;
    }

    const spinner = enhancedUI.spinner('Searching documents...');
    try {
      spinner.start();
      const result = await toolRegistry.execute(
        'document_search',
        { query, limit: 5 },
        documentToolContext(agent),
      );
      spinner.stop();

      const firstResultLine = (result || '').split('\n')[0];
      const searchPayload = result ? String(result) : '';
      const truncatedSearch =
        searchPayload.length > 8000
          ? searchPayload.slice(0, 8000) + '\n...[truncated]'
          : searchPayload;
      if (showRaw) {
        console.log(enhancedUI.theme.dim(firstResultLine));
      }

      let answerText = '';
      if (agent.modelProvider && searchPayload && !searchPayload.startsWith('No document')) {
        try {
          const refineSpinner = enhancedUI.spinner('Refining answer...');
          refineSpinner.start();
          const refineMessages = [
            {
              role: 'system',
              content:
                "You are a precise document analyst. Based on the user question and search results, extract a concise answer. Use the user's language. If insufficient info, say so.",
            },
            {
              role: 'user',
              content: 'Question: ' + query + '\n\nSearch results:\n' + truncatedSearch,
            },
          ];
          const refineResponse = await agent.modelProvider.chat(refineMessages, { maxTokens: 500 });
          refineSpinner.stop();

          answerText = refineResponse.text || String(refineResponse);
          try {
            const parsed = JSON.parse(answerText);
            if (parsed?.action?.done?.text) {
              answerText = parsed.action.done.text;
            }
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
        enhancedUI.info(
          'No documents are indexed yet. Use /doc add <path-or-url> or reference one with @path.',
        );
        return;
      }
      for (const doc of result.documents) {
        console.log(`${doc.id}  ${doc.title}`);
        const extraction = doc.extractionMethod ? ` extraction=${doc.extractionMethod}` : '';
        const confidence = Number.isFinite(doc.ocrConfidence)
          ? ` ocrConfidence=${(doc.ocrConfidence * 100).toFixed(1)}%`
          : '';
        console.log(
          `  kind=${doc.kind}${extraction}${confidence} chunks=${doc.chunks} chars=${doc.chars}`,
        );
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
      const result = await toolRegistry.execute(
        'document_clear',
        {
          document_id: documentId,
        },
        documentToolContext(agent),
      );
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
// OCR command
// ---------------------------------------------------------------------------

export async function handleOCRCommand(agent, argsText = '') {
  const raw = String(argsText || '').trim();
  const [subcommandRaw] = raw.split(/\s+/).filter(Boolean);
  const subcommand = (subcommandRaw || 'status').toLowerCase();
  const restText = raw.slice(subcommandRaw?.length || 0).trim();

  if (['help', '--help', '-h'].includes(subcommand)) {
    showBuiltInCommandHelp('ocr');
    return;
  }

  if (['status', 'doctor', 'init'].includes(subcommand)) {
    await handleOCRInitCommand({ prepare: subcommand === 'init' });
    return;
  }

  if (['run', 'recognize'].includes(subcommand)) {
    await handleOCRRunCommand(agent, restText);
    return;
  }

  if (subcommandRaw) {
    await handleOCRRunCommand(agent, raw);
    return;
  }

  enhancedUI.warning(`Unknown /ocr command: ${subcommand}`);
  showBuiltInCommandHelp('ocr');
}

async function handleOCRRunCommand(agent, imageText = '') {
  const imageInput = stripWrappingQuotes(String(imageText || '').trim());
  if (!imageInput) {
    enhancedUI.info('Usage: /ocr <image-path>');
    return;
  }

  const isUrl = /^https?:\/\//i.test(imageInput);
  const imagePath = isUrl ? imageInput : resolve(agent?.workingDir || process.cwd(), imageInput);
  if (!isUrl && !existsSync(imagePath)) {
    enhancedUI.error(`OCR input file not found: ${imagePath}`);
    return;
  }

  const ocrRuntime = new OCRRuntime();
  const spinner = enhancedUI.spinner('Running OCR...');
  try {
    spinner.start();
    const result = await ocrRuntime.recognize(imagePath);
    spinner.stop();
    console.log(enhancedUI.createHeader('OCR Result'));
    printOCRResult(result);
    console.log('');
  } catch (error) {
    spinner.stop();
    enhancedUI.error(`OCR failed: ${error.message}`);
  }
}

async function handleOCRInitCommand({ prepare = false } = {}) {
  const ocrRuntime = new OCRRuntime();
  const before = await ocrRuntime.inspect();

  console.log(enhancedUI.createHeader('OCR Runtime'));
  console.log('Runtime Package');
  console.log(`  available: ${before.runtime.available ? 'yes' : 'no'}`);
  console.log(`  package: ${before.runtime.packageName || '(not found)'}`);
  console.log(`  candidates: ${before.runtime.candidates.join(', ')}`);
  if (before.runtime.error) {
    console.log(`  error: ${before.runtime.error}`);
  }
  console.log('');
  printOCRModelStatus(before);
  console.log(`  auto download: ${before.autoDownload ? 'enabled' : 'disabled'}`);
  console.log(`  probe timeout: ${before.probeTimeoutMs}ms`);
  console.log(`  download timeout: ${before.downloadTimeoutMs}ms`);
  console.log('');
  console.log('Download Candidates');
  for (const [kind, candidates] of Object.entries(before.downloadCandidates)) {
    console.log(`  ${kind}:`);
    for (const [index, url] of candidates.entries()) {
      console.log(`    ${index + 1}. ${url}`);
    }
  }
  console.log('');

  let prepared = before;
  const missingFiles = Object.entries(before.files).filter(([, file]) => !file.exists);
  if (prepare && missingFiles.length > 0 && before.autoDownload) {
    enhancedUI.info(
      'OCR model files are missing. Starting downloads before runtime initialization.',
    );
    const progressState = new Map();
    try {
      prepared = await ocrRuntime.prepareModel({
        onDownloadProbeStart: ({ kind, candidates, timeoutMs }) => {
          console.log(
            `  checking ${kind} ${candidates.length} download candidate${candidates.length === 1 ? '' : 's'}...`,
          );
          console.log(`  probe timeout: ${timeoutMs}ms`);
        },
        onDownloadProbeResult: ({ kind, url, available, durationMs, totalBytes, error }) => {
          const sizeText = totalBytes ? `, size ${formatBytes(totalBytes)}` : '';
          const statusText = available ? 'available' : `unavailable: ${error}`;
          console.log(`  ${kind} candidate: ${statusText} in ${durationMs}ms${sizeText}`);
          console.log(`    ${url}`);
        },
        onDownloadSelected: ({ kind, url, durationMs, totalBytes }) => {
          const sizeText = totalBytes ? `, ${formatBytes(totalBytes)}` : '';
          console.log(`  ${kind} selected: ${url} (${durationMs}ms${sizeText})`);
        },
        onDownloadStart: ({ kind, file, url, timeoutMs }) => {
          console.log(`  downloading ${kind} (${file}) from: ${url}`);
          console.log(`  timeout: ${timeoutMs}ms`);
        },
        onDownloadProgress: ({ kind, downloadedBytes, totalBytes }) => {
          const now = Date.now();
          const last = progressState.get(kind) || { bytes: -1, at: 0 };
          const bytesDelta = downloadedBytes - last.bytes;
          const shouldReport =
            last.bytes < 0 ||
            downloadedBytes === totalBytes ||
            bytesDelta >= 25 * 1024 * 1024 ||
            now - last.at >= 5000;

          if (!shouldReport) {
            return;
          }

          progressState.set(kind, { bytes: downloadedBytes, at: now });
          const totalText = totalBytes ? ` / ${formatBytes(totalBytes)}` : '';
          const percentText = totalBytes
            ? ` (${Math.min(100, (downloadedBytes / totalBytes) * 100).toFixed(1)}%)`
            : '';
          console.log(
            `  ${kind} progress: ${formatBytes(downloadedBytes)}${totalText}${percentText}`,
          );
        },
        onDownloadComplete: ({ kind, bytes }) => {
          console.log(`  ${kind} downloaded: ${formatBytes(bytes)}`);
        },
      });
      enhancedUI.success('OCR model files downloaded.');
    } catch (error) {
      enhancedUI.error(`OCR model download failed: ${error.message}`);
    }
    console.log('');
  } else if (missingFiles.length > 0 && !before.autoDownload) {
    enhancedUI.warning('OCR model files are missing and auto download is disabled.');
    console.log('');
  } else if (missingFiles.length > 0) {
    enhancedUI.info('Use /ocr init to download missing OCR model files.');
    console.log('');
  }

  if (prepare) {
    const spinner = enhancedUI.spinner('Initializing OCR runtime...');
    try {
      spinner.start();
      await ocrRuntime.initialize();
      spinner.stop();
    } catch (error) {
      spinner.stop();
      enhancedUI.error(`OCR initialization failed: ${error.message}`);
    }
  }

  const after = prepare ? await ocrRuntime.inspect() : prepared;
  console.log(enhancedUI.createHeader(prepare ? 'OCR Init Result' : 'OCR Status'));
  printOCRModelStatus(after);
  console.log(`Ready: ${after.ready ? 'yes' : 'no'}`);
  console.log(`Initialized: ${after.initialized ? 'yes' : 'no'}`);
  if (after.fallbackReason) {
    console.log(`Fallback reason: ${after.fallbackReason}`);
  }
  if (after.ready) {
    enhancedUI.success('OCR runtime is ready.');
  } else {
    enhancedUI.warning('OCR runtime is not ready yet.');
  }
  console.log('');
}

function printOCRModelStatus(status) {
  console.log('OCR Model Files');
  console.log(`  root: ${status.modelRoot}`);
  for (const [kind, file] of Object.entries(status.files)) {
    console.log(`  ${kind}: ${file.path}`);
    console.log(`    exists: ${file.exists ? 'yes' : 'no'}`);
    if (file.exists) {
      console.log(`    size: ${formatBytes(file.bytes)}`);
      console.log(`    modified: ${file.modifiedAt}`);
    }
  }
}

function printOCRResult(result) {
  if (typeof result === 'string') {
    console.log(result);
    return;
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      if (typeof item === 'string') {
        console.log(item);
      } else if (item?.text) {
        const confidence = Number.isFinite(item.confidence)
          ? ` (${(item.confidence * 100).toFixed(1)}%)`
          : '';
        console.log(`${item.text}${confidence}`);
      } else {
        console.log(enhancedUI.formatJSON(item));
      }
    }
    return;
  }
  console.log(enhancedUI.formatJSON(result));
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
          console.log(
            `  checking ${candidates.length} download candidate${candidates.length === 1 ? '' : 's'}...`,
          );
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
          const percentText = totalBytes
            ? ` (${Math.min(100, (downloadedBytes / totalBytes) * 100).toFixed(1)}%)`
            : '';
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
    enhancedUI.info(
      'This is usable, but semantic ranking may be less precise than ONNX embeddings.',
    );
  }
  console.log('');
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
// Memory / Context command
// ---------------------------------------------------------------------------

export function showMemoryContext(agent, argsText = '') {
  const mode = String(argsText || '')
    .trim()
    .toLowerCase();
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
  console.log(
    enhancedUI.theme.dim('Use /memory full to print the full CONTEXT.md representation.'),
  );
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
      enhancedUI.warning(
        'Agent stopped after reaching the maximum iteration limit without a final answer.',
      );
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
  const spinner = enhancedUI.spinner(
    `Indexing ${refs.length} referenced document${refs.length === 1 ? '' : 's'}...`,
  );
  spinner.start();
  for (const source of refs) {
    try {
      const result = await toolRegistry.execute(
        'document_add',
        { source },
        documentToolContext(agent),
      );
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

  const docSummary = indexed.map((doc) => `${doc.title} (${doc.id})`).join(', ');
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

  const missing = getToolRequiredParams(tool).filter(
    (paramName) => parsed.args[paramName] === undefined || parsed.args[paramName] === '',
  );
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
  const normalized = String(commandText || '')
    .trim()
    .replace(/^\//, '');
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
    .filter((tool) =>
      [
        ToolCategory.SKILL_ENGINEERING,
        ToolCategory.SKILL_PRODUCTIVITY,
        ToolCategory.SKILL_OUTPUT,
      ].includes(tool.category),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(enhancedUI.createHeader('Slash Skill Commands'));
  if (skillTools.length === 0) {
    enhancedUI.info('No slash skill commands are registered.');
    return;
  }

  for (const tool of skillTools) {
    const slashName = `/${tool.name.replace(/_/g, '-')}`;
    const description = String(tool.description || '')
      .split(/\s+/)
      .slice(0, 18)
      .join(' ');
    console.log(`${slashName.padEnd(14)} ${description}${description ? '...' : ''}`);
  }
  console.log('');
  console.log('Use /help <command> or /<command> --help for details and examples.');
  console.log(
    'Natural language also works: the agent can choose these methodology tools automatically when they fit the task.',
  );
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
  const orderedEntries =
    tool.name === 'tdd'
      ? ['phase', 'component', 'spec', 'test_file', 'source_file']
          .filter((name) => params[name])
          .map((name) => [name, params[name]])
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
    diagnose: ['/diagnose symptom="slash command output hides whether it executed"'],
    verify: [
      '/verify claim="CLI command help works" criteria="help output shown,no LLM request,test passes" evidence="bun test-integration.mjs passed"',
    ],
    'zoom-out': ['/zoom-out proposed_change="add another hardcoded command router branch"'],
    caveman: [
      '/caveman mode=simplify content="The system dynamically orchestrates tool affordances"',
    ],
    handoff: [
      '/handoff session_summary="Implemented CLI command help" next_steps="review remaining built-in commands"',
    ],
    'to-prd': ['/to-prd title="Command Help" context="Users do not know what slash commands do"'],
    'to-issues': [
      '/to-issues plan="Add command registry, help output, and tests" granularity=medium',
    ],
    setup: ['/setup project_name="AI Engineering Agent" project_type=cli'],
  };

  if (examplesByTool[rawName]) {
    return examplesByTool[rawName];
  }

  const required = getToolRequiredParams(tool);
  if (required.length === 0) {
    return [`/${rawName} --help`];
  }
  return [`/${rawName} ${required.map((name) => `${name}="value"`).join(' ')}`];
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
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function getToolRequiredParams(tool) {
  return (
    tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : [])
  );
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function documentToolContext(agent) {
  return {
    workingDirectory: agent.workingDir,
    debug: agent.debugMode,
    ui: enhancedUI,
  };
}

// ---------------------------------------------------------------------------
// Workspace command — 列出工作目录文件
// ---------------------------------------------------------------------------

async function handleWorkspaceCommand(agent, argsText) {
  const { listWorkspaceDirectory } = await import('../core/workspace-watcher.js');
  const subPath = argsText.trim() || '';
  const result = listWorkspaceDirectory(agent.workingDir, { path: subPath });

  if (!result.success) {
    enhancedUI.error(result.error);
    return;
  }

  console.log(
    enhancedUI.createHeader(`Workspace: ${result.root}${result.path ? '/' + result.path : ''}`),
  );

  if (result.entries.length === 0) {
    enhancedUI.info('目录为空');
    return;
  }

  const directories = result.entries.filter((e) => e.type === 'directory');
  const files = result.entries.filter((e) => e.type === 'file');

  if (directories.length > 0) {
    console.log(enhancedUI.theme.primaryBold('  Directories:'));
    for (const dir of directories.slice(0, 20)) {
      const hidden = dir.hidden ? enhancedUI.theme.dim(' (hidden)') : '';
      console.log(`    📁 ${dir.name}${hidden}`);
    }
    if (directories.length > 20) {
      console.log(enhancedUI.theme.dim(`    ... +${directories.length - 20} more`));
    }
  }

  if (files.length > 0) {
    console.log(enhancedUI.theme.primaryBold('  Files:'));
    for (const file of files.slice(0, 20)) {
      const sizeStr =
        file.size > 0 ? enhancedUI.theme.dim(` (${(file.size / 1024).toFixed(1)}KB)`) : '';
      console.log(`    📄 ${file.name}${sizeStr}`);
    }
    if (files.length > 20) {
      console.log(enhancedUI.theme.dim(`    ... +${files.length - 20} more`));
    }
  }

  if (result.truncated) {
    console.log(
      enhancedUI.theme.dim(`\n  (显示前 ${result.entries.length} 项，共 ${result.total} 项)`),
    );
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Session command — 会话管理
// ---------------------------------------------------------------------------

async function handleSessionCommand(agent, argsText) {
  const subcommand = (argsText || '').trim().toLowerCase().split(/\s+/)[0] || 'list';

  const { createFileSystemStorageAdapter, getAgentSessionTitle } =
    await import('../core/session-store.js');
  const { getUserConfigDir } = await import('../core/runtime-config.js');
  const fs = await import('fs');
  const path = await import('path');

  const configDir = getUserConfigDir();
  const adapter = createFileSystemStorageAdapter(configDir, fs, path);

  if (subcommand === 'list' || subcommand === 'ls') {
    const sessions = adapter.readSessions();
    if (sessions.length === 0) {
      enhancedUI.info('暂无会话记录');
      return;
    }
    console.log(enhancedUI.createHeader('会话历史'));
    for (const session of sessions.slice(0, 15)) {
      const title = getAgentSessionTitle(session.input, session.messages);
      const time = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '';
      const msgCount = session.messages?.length || 0;
      console.log(`  ${session.id}  ${title}`);
      console.log(`    ${time}  ${msgCount} messages`);
    }
    if (sessions.length > 15) {
      console.log(enhancedUI.theme.dim(`  ... +${sessions.length - 15} more`));
    }
    console.log('');
    return;
  }

  if (subcommand === 'clear') {
    adapter.writeSessions([]);
    adapter.writeHistory([]);
    enhancedUI.success('会话历史已清除');
    return;
  }

  enhancedUI.info('用法: /session list | clear');
}
