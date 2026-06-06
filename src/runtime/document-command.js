import { Embedder } from '../core/embedder.js';

const DOC_COMMAND_NAMES = new Set(['/doc', '/docs', '/document', '/documents']);

export function parseDocumentCommand(input) {
  const rawInput = String(input || '').trim();
  if (!rawInput) {return null;}

  const commandName = rawInput.split(/\s+/, 1)[0].toLowerCase();
  if (!DOC_COMMAND_NAMES.has(commandName)) {return null;}

  const argsText = rawInput.slice(commandName.length).trim();
  const [subcommandRaw, ...restParts] = argsText.split(/\s+/).filter(Boolean);
  const subcommand = (subcommandRaw || 'list').toLowerCase();
  const restText = argsText.slice(subcommandRaw?.length || 0).trim();

  return {
    commandName,
    argsText,
    subcommand,
    restText,
    restParts,
  };
}

export async function handleDocumentCommand(input, options = {}) {
  const parsed = parseDocumentCommand(input);
  if (!parsed) {return null;}

  const { engine, toolRegistry = engine?.getToolRegistry?.(), modelProvider = engine?.getModelProvider?.() } = options;
  const context = createDocumentToolContext(engine, options);

  if (['help', '--help', '-h'].includes(parsed.subcommand)) {
    return createCommandResult(parsed, {
      success: true,
      content: formatDocumentHelp(),
    });
  }

  if (['init', 'status', 'doctor'].includes(parsed.subcommand)) {
    const embedder = new Embedder();
    const before = await embedder.inspect();
    return createCommandResult(parsed, {
      success: true,
      content: [
        'Document RAG Runtime',
        `Embedding model: ${before.modelName || before.model || 'unknown'}`,
        `Model path: ${before.modelPath || 'unknown'}`,
        `Runtime: ${before.runtime || before.provider || 'unknown'}`,
        `Ready: ${before.ready === false ? 'no' : 'yes'}`,
      ].join('\n'),
      data: before,
    });
  }

  if (!toolRegistry) {
    return createCommandResult(parsed, {
      success: false,
      content: 'Document tools are not initialized.',
      error: 'Document tools are not initialized.',
    });
  }

  if (['add', 'index', 'load'].includes(parsed.subcommand)) {
    const source = stripWrappingQuotes(parsed.restText);
    if (!source) {
      return createCommandResult(parsed, {
        success: false,
        content: 'Usage: /doc add <path-or-url>',
        error: 'Missing document source.',
      });
    }

    const result = await toolRegistry.execute('document_add', { source }, context);
    return createCommandResult(parsed, {
      success: result?.success !== false,
      content: result?.success === false
        ? (result?.error || 'Document indexing failed.')
        : [
            `Indexed document: ${result.title}`,
            `id: ${result.id}`,
            `kind: ${result.kind}`,
            `chunks: ${result.chunks}`,
            `source: ${result.source}`,
          ].join('\n'),
      data: result,
      error: result?.success === false ? result?.error : undefined,
    });
  }

  if (['search', 'find', 'query'].includes(parsed.subcommand)) {
    const query = parsed.restParts.length > 0 ? parsed.restText : '';
    if (!query) {
      return createCommandResult(parsed, {
        success: false,
        content: 'Usage: /doc search <query>',
        error: 'Missing search query.',
      });
    }

    const rawResult = await toolRegistry.execute('document_search', { query, limit: 5 }, context);
    const firstResultBlock = rawResult ? String(rawResult).split('\n\n')[0] : '';
    let answer = '';

    if (modelProvider && rawResult && !String(rawResult).startsWith('No document')) {
      try {
        const refineResponse = await modelProvider.chat([
          {
            role: 'system',
            content: 'You are a precise document analyst. Based on the user question and search results, extract a concise answer. Use the user\'s language. If insufficient info, say so.',
          },
          {
            role: 'user',
            content: `Question: ${query}\n\nSearch results:\n${firstResultBlock}`,
          },
        ], { maxTokens: 500 });
        answer = normalizeModelText(refineResponse);
      } catch {
        answer = '';
      }
    }

    return createCommandResult(parsed, {
      success: true,
      content: answer ? `${rawResult}\n\nAnswer\n\n${answer}` : String(rawResult || ''),
      answer,
      data: {
        query,
        result: rawResult,
      },
    });
  }

  if (['list', 'ls', ''].includes(parsed.subcommand)) {
    const result = await toolRegistry.execute('document_list', {}, context);
    const documents = result?.documents || [];
    const content = documents.length === 0
      ? 'No documents are indexed yet. Use /doc add <path-or-url> or reference one with @path.'
      : [
          'Indexed Documents',
          ...documents.flatMap(doc => [
            `${doc.id}  ${doc.title}`,
            `  kind=${doc.kind} chunks=${doc.chunks} chars=${doc.chars}`,
            `  source=${doc.source}`,
          ]),
        ].join('\n');

    return createCommandResult(parsed, {
      success: true,
      content,
      data: result,
    });
  }

  if (['clear', 'remove', 'rm'].includes(parsed.subcommand)) {
    const documentId = parsed.restText ? stripWrappingQuotes(parsed.restText) : undefined;
    const result = await toolRegistry.execute('document_clear', { document_id: documentId }, context);
    const target = documentId ? `document ${documentId}` : 'all documents';
    return createCommandResult(parsed, {
      success: result?.success !== false,
      content: result?.success ? `Cleared ${target}. Removed: ${result.removed}` : `No matching document found for ${documentId}.`,
      data: result,
      error: result?.success === false ? `No matching document found for ${documentId}.` : undefined,
    });
  }

  return createCommandResult(parsed, {
    success: false,
    content: `Unknown /doc command: ${parsed.subcommand}\n\n${formatDocumentHelp()}`,
    error: `Unknown /doc command: ${parsed.subcommand}`,
  });
}

export async function handleDocumentBatchAdd(sources = [], options = {}) {
  const { engine, toolRegistry = engine?.getToolRegistry?.() } = options;
  const context = createDocumentToolContext(engine, options);
  const normalizedSources = Array.from(new Set((sources || [])
    .map(source => String(source || '').trim())
    .filter(Boolean)));

  if (!toolRegistry) {
    return {
      kind: 'document_command',
      command: 'init_rag',
      subcommand: 'add',
      localCommand: true,
      success: false,
      content: 'Document tools are not initialized.',
      error: 'Document tools are not initialized.',
      documents: [],
    };
  }

  if (normalizedSources.length === 0) {
    return {
      kind: 'document_command',
      command: 'init_rag',
      subcommand: 'add',
      localCommand: true,
      success: false,
      content: 'No documents selected.',
      error: 'No documents selected.',
      documents: [],
    };
  }

  const documents = [];
  const errors = [];

  for (const source of normalizedSources) {
    try {
      const result = await toolRegistry.execute('document_add', { source }, context);
      if (result?.success === false) {
        errors.push({ source, error: result?.error || 'Document indexing failed.' });
      } else {
        documents.push(result);
      }
    } catch (error) {
      errors.push({ source, error: error.message });
    }
  }

  const content = [
    `Indexed documents: ${documents.length}/${normalizedSources.length}`,
    ...documents.map(doc => `- ${doc.title} (${doc.id}) chunks=${doc.chunks}`),
    ...errors.map(item => `- Failed: ${item.source} - ${item.error}`),
  ].join('\n');

  return {
    kind: 'document_command',
    command: 'init_rag',
    subcommand: 'add',
    localCommand: true,
    success: errors.length === 0,
    content,
    documents,
    errors,
  };
}

function createDocumentToolContext(engine, options) {
  const config = engine?.getConfig?.();
  return {
    workingDirectory: options.workingDirectory || config?.workingDirectory || process.cwd(),
    debug: options.debug ?? config?.debug ?? false,
    ui: options.ui,
  };
}

function createCommandResult(parsed, fields) {
  return {
    kind: 'document_command',
    command: parsed.commandName,
    subcommand: parsed.subcommand,
    localCommand: true,
    ...fields,
  };
}

function formatDocumentHelp() {
  return [
    'Document RAG commands',
    '/doc init',
    '/doc add <path-or-url>',
    '/doc search <query>',
    '/doc list',
    '/doc clear [id]',
  ].join('\n');
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function normalizeModelText(response) {
  let text = response?.text || response?.content || String(response || '');
  try {
    const parsed = JSON.parse(text);
    if (parsed?.action?.done?.text) {
      text = parsed.action.done.text;
    }
  } catch {
    // Plain text response.
  }
  return String(text || '').trim();
}
