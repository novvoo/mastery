/**
 * Tool code and shell code block parsers for TextToolParser.
 *
 * Handles: tool_code format, Python tool code blocks,
 * runtime tool invocations, shell code blocks.
 */

import {
  mapRuntimeToolCommandName,
  mapToolCodeName,
  stripShellTokenQuotes,
  TOOL_CODE_CALL_NAMES,
} from '../prompts/text-tool-parser-normalizers.js';

/**
 * Parse tool_code format.
 * Format: <tool_code>print(ls("path"))</tool_code>
 */
export function parseToolCodeFormat(
  text,
  {
    toolRegistry,
    resolveToolName,
    safeJSONParse,
    normalizeJSONToolCall,
    parseToolCodeArgs,
    normalizeToolCodeArgs,
  },
) {
  const toolCalls = [];
  const blocks = [];
  const blockRegex = /<tool_code>\s*([\s\S]*?)\s*<\/tool_code>/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(text)) !== null) {
    blocks.push(blockMatch[1]);
  }

  for (const block of blocks) {
    toolCalls.push(...parsePythonToolCodeBlock(block, toolCalls.length, { toolRegistry }));

    for (const call of extractToolCodeCalls(block, { findMatchingParen })) {
      const rawName = call.name;
      const mapped = mapToolCodeName(rawName, (value) => resolveToolName(value));
      if (!mapped || !toolRegistry?.has?.(mapped)) {
        continue;
      }

      const parsedArgs = parseToolCodeArgs(call.argsText);
      const args = normalizeToolCodeArgs(mapped, parsedArgs);
      if (!args) {
        continue;
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name: mapped,
        arguments: args,
        source: 'tool_code',
      });
    }
  }

  return toolCalls;
}

/**
 * Parse Python-style tool code block (e.g., os.walk patterns).
 */
export function parsePythonToolCodeBlock(block, startIndex = 0, { toolRegistry }) {
  const text = String(block || '');
  if (!toolRegistry?.has?.('list_dir')) {
    return [];
  }

  const walksWorkspace = /\bos\.walk\(\s*(['"])(.*?)\1\s*\)/.exec(text);
  const listsWorkspace = /\bos\.listdir\(\s*(['"])(.*?)\1\s*\)/.exec(text);
  const printsPaths =
    /print\s*\(\s*os\.path\.join\s*\(|print\s*\(\s*f\b|print\s*\(\s*path\b|print\s*\(\s*f\s*\)/.test(
      text,
    );

  if ((walksWorkspace || listsWorkspace) && printsPaths) {
    return [
      {
        id: `call_${Date.now()}_${startIndex}`,
        name: 'list_dir',
        arguments: { path: walksWorkspace?.[2] || listsWorkspace?.[2] || '.' },
        source: 'tool_code_python',
      },
    ];
  }

  return [];
}

/**
 * Extract tool code calls from a block of text.
 */
export function extractToolCodeCalls(block, { findMatchingParen: _findMatchingParen }) {
  const calls = [];
  const namePattern = new RegExp(`\\b(${TOOL_CODE_CALL_NAMES.join('|')})\\s*\\(`, 'g');
  let match;

  while ((match = namePattern.exec(block)) !== null) {
    const argsStart = namePattern.lastIndex;
    const argsEnd = _findMatchingParen(block, argsStart - 1);
    if (argsEnd === -1) {
      continue;
    }
    calls.push({
      name: match[1],
      argsText: block.slice(argsStart, argsEnd),
    });
    namePattern.lastIndex = argsEnd + 1;
  }

  return calls;
}

/**
 * Find matching closing parenthesis for an opening one at openIndex.
 */
export function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = null;
  let tripleQuote = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    const nextTwo = text.slice(i, i + 3);

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (tripleQuote && nextTwo === quote.repeat(3)) {
        i += 2;
        quote = null;
        tripleQuote = false;
        continue;
      }
      if (!tripleQuote && char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      tripleQuote = nextTwo === char.repeat(3);
      if (tripleQuote) {
        i += 2;
      }
      continue;
    }

    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Parse runtime tool invocations from shell code block text.
 */
export function parseRuntimeToolInvocations(
  text,
  startIndex = 0,
  {
    toolRegistry,
    resolveToolName,
    safeJSONParse,
    normalizeJSONToolCall,
    normalizeToolCodeArgs,
    parseToolCodeArgs,
  },
) {
  const toolCalls = [];
  const source = 'shell_code_block_runtime_tool';

  for (const call of extractToolCodeCalls(text, { findMatchingParen })) {
    const mapped = mapRuntimeToolCommandName(call.name, (value) => resolveToolName(value));
    if (!mapped || mapped === 'shell' || !toolRegistry?.has?.(mapped)) {
      continue;
    }

    const jsonArgs = safeJSONParse(call.argsText.trim());
    const args =
      jsonArgs && typeof jsonArgs === 'object' && !Array.isArray(jsonArgs)
        ? normalizeJSONToolCall(mapped, jsonArgs).args
        : normalizeToolCodeArgs(mapped, parseToolCodeArgs(call.argsText));
    if (!args) {
      continue;
    }

    toolCalls.push({
      id: `call_${Date.now()}_${startIndex + toolCalls.length}`,
      name: mapped,
      arguments: args,
      source,
    });
  }

  for (const line of runtimeToolCommandLines(text)) {
    const call = runtimeToolCallFromBareCommand(line, startIndex + toolCalls.length, {
      toolRegistry,
      resolveToolName,
      safeJSONParse,
      normalizeJSONToolCall,
    });
    if (call) {
      toolCalls.push(call);
    } else {
      const firstWord = line.split(/\s+/)[0];
      if (firstWord) {
        const mapped = mapRuntimeToolCommandName(firstWord, (name) => name);
        if (!mapped || mapped === 'shell' || !toolRegistry?.has?.(mapped)) {
          // 对于 shell 别名（run_command/bash/exec 等），剥离工具名前缀，
          // 只保留实际命令部分（如 'run_command npm test' → 'npm test'）
          let commandText = line;
          if (mapped === 'shell') {
            const rest = line.slice(firstWord.length).trim();
            commandText = rest || line;
          }
          toolCalls.push({
            id: `call_${Date.now()}_${startIndex + toolCalls.length}`,
            name: 'shell',
            arguments: { command: commandText },
            source: 'shell_code_block',
          });
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Split text into runtime tool command lines.
 */
export function runtimeToolCommandLines(text) {
  const rawLines = String(text || '')
    .split('\n')
    .map((line) => line.trim().replace(/^\$\s*/, ''))
    .filter((line) => line && !line.startsWith('#'));

  const mergedLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const current = rawLines[i];
    const next = rawLines[i + 1];

    if (next && next.startsWith('{') && /^[A-Za-z_][\w-]*$/.test(current)) {
      mergedLines.push(current + ' ' + next);
      i++;
    } else {
      mergedLines.push(current);
    }
  }

  return mergedLines;
}

/**
 * Parse a bare command line into a runtime tool call.
 */
export function runtimeToolCallFromBareCommand(
  line,
  index,
  { toolRegistry, resolveToolName, safeJSONParse, normalizeJSONToolCall },
) {
  const match = line.match(/^([A-Za-z_][\w-]*)(?:\s+(.+))?$/);
  if (!match) {
    return null;
  }

  const mapped = mapRuntimeToolCommandName(match[1], (value) => resolveToolName(value));
  if (!mapped || mapped === 'shell' || !toolRegistry?.has?.(mapped)) {
    return null;
  }

  const rest = String(match[2] || '').trim();
  let args = {};
  if (rest.startsWith('{') && rest.endsWith('}')) {
    const jsonArgs = safeJSONParse(rest);
    if (!jsonArgs || typeof jsonArgs !== 'object' || Array.isArray(jsonArgs)) {
      return null;
    }
    args = normalizeJSONToolCall(mapped, jsonArgs).args;
  } else if (rest.startsWith('{')) {
    const jsonMatch = line.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonArgs = safeJSONParse(jsonMatch[0]);
      if (jsonArgs && typeof jsonArgs === 'object' && !Array.isArray(jsonArgs)) {
        args = normalizeJSONToolCall(mapped, jsonArgs).args;
      }
    }
  } else if (mapped === 'list_dir') {
    args = { path: stripShellTokenQuotes(rest || '.') };
  } else if (mapped === 'read_file') {
    if (!rest) {
      return null;
    }
    args = { path: stripShellTokenQuotes(rest) };
  } else {
    return null;
  }

  return {
    id: `call_${Date.now()}_${index}`,
    name: mapped,
    arguments: args,
    source: 'shell_code_block_runtime_tool',
  };
}

/**
 * Parse shell code block format.
 * Format: ```bash\ncommand\n```
 */
export function parseShellCodeBlockFormat(
  text,
  { toolRegistry, parseRuntimeToolInvocations: _parseRuntimeToolInvocations },
) {
  if (!toolRegistry?.has?.('shell')) {
    return [];
  }

  const toolCalls = [];
  const blockRegex = /```(?:bash|sh|zsh|shell|terminal|console)\s*\n([\s\S]*?)```/gi;
  let match;

  while ((match = blockRegex.exec(text)) !== null) {
    const command = match[1].trim();
    const runtimeToolCalls = _parseRuntimeToolInvocations(command, toolCalls.length);
    if (runtimeToolCalls.length > 0) {
      toolCalls.push(...runtimeToolCalls);
      continue;
    }

    if (!command || command.startsWith('$')) {
      const normalized = command.replace(/^\$\s*/, '').trim();
      if (!normalized) {
        continue;
      }
      const normalizedRuntimeToolCalls = _parseRuntimeToolInvocations(normalized, toolCalls.length);
      if (normalizedRuntimeToolCalls.length > 0) {
        toolCalls.push(...normalizedRuntimeToolCalls);
        continue;
      }

      if (isKnownToolName(normalized, toolRegistry)) {
        continue;
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name: 'shell',
        arguments: { command: stripShellAliasPrefix(normalized) },
        source: 'shell_code_block',
      });
      continue;
    }

    if (isKnownToolName(command, toolRegistry)) {
      continue;
    }

    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      name: 'shell',
      arguments: { command: stripShellAliasPrefix(command) },
      source: 'shell_code_block',
    });
  }

  return toolCalls;
}

function isKnownToolName(command, toolRegistry) {
  const firstWord = command.split(/\s+/)[0];
  if (!firstWord) return false;

  const mapped = mapRuntimeToolCommandName(firstWord, (name) => name);
  return mapped && mapped !== 'shell' && toolRegistry?.has?.(mapped);
}

/**
 * 剥离 shell 工具别名前缀（如 'run_command npm test' → 'npm test'）。
 * 如果命令不以 shell 别名开头，则原样返回。
 */
function stripShellAliasPrefix(command) {
  const firstWord = String(command).split(/\s+/)[0];
  if (!firstWord) return command;
  const mapped = mapRuntimeToolCommandName(firstWord, (name) => name);
  if (mapped === 'shell') {
    const rest = command.slice(firstWord.length).trim();
    return rest || command;
  }
  return command;
}
