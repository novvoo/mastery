import { getParseHints } from '../prompts/text-tool-parser-hints.js';
import {
  mapRuntimeToolCommandName,
  mapToolCodeName,
  NAMED_XML_TOOL_ALIASES,
  normalizeToolArgumentAliases,
  shellQuote,
  stripShellTokenQuotes,
  TOOL_CODE_CALL_NAMES,
} from '../prompts/text-tool-parser-normalizers.js';
import { generateTextToolPrompt } from '../prompts/text-tool-parser-prompt.js';

import {
  findBalancedJSON,
  parseCALLFormat,
  recoverCallArguments,
  findMatchingBrace,
  findTopLevelKeyPositions,
  findNextUnescapedQuote,
} from './text-tool-parser-call.js';

import {
  parseJSONBlockFormat,
  parseActionTagFormat,
  parseRawJSONActionFormat,
  parseLooseRawJSONAction,
  parseEmbeddedJSONActionFormat,
  extractJSONObjectCandidates,
  parseLooseJSONStringObject,
  findLooseStringEnd,
  findJSONStringEnd,
  findLooseScalarEnd,
} from './text-tool-parser-json.js';

import {
  parseXMLFormat,
  parseToolCallTagFormat,
  parseFunctionCallsFormat,
  parseFunctionCallTagFormat,
  extractFunctionCallTagArgs,
  parseNamedToolXMLFormat,
} from './text-tool-parser-xml.js';

import {
  parseToolCodeFormat,
  parsePythonToolCodeBlock,
  extractToolCodeCalls,
  findMatchingParen,
  parseRuntimeToolInvocations,
  runtimeToolCommandLines,
  runtimeToolCallFromBareCommand,
  parseShellCodeBlockFormat,
} from './text-tool-parser-toolcode.js';

import {
  parseNaturalLanguage,
  buildFallbackPatterns,
  extractParamsFromContext,
  browserActionCallFromJSON,
  isSearchNavigation,
  queryFromSearchURL,
  inferSearchQuery,
  parseDSMLFormat,
} from './text-tool-parser-nl.js';

export class TextToolParser {
  #toolRegistry;
  #fallbackPatterns;

  constructor(toolRegistry) {
    this.#toolRegistry = toolRegistry;
    this.#fallbackPatterns = buildFallbackPatterns(toolRegistry, {
      extractParamsFromContext: (tool, text) => this.#extractParamsFromContext(tool, text),
    });
  }

  parse(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }
    const toolCalls = [];
    const hints = getParseHints(text, (value) => this.#hasNamedXMLCandidate(value));
    if (hints.dsml) {
      toolCalls.push(...this.#parseDSMLFormat(text));
    }
    if (hints.call) {
      toolCalls.push(...this.#parseCALLFormat(text));
    }
    if (hints.jsonBlock) {
      toolCalls.push(...this.#parseJSONBlockFormat(text));
    }
    if (hints.actionTag) {
      toolCalls.push(...this.#parseActionTagFormat(text));
    }
    if (hints.rawJSON) {
      toolCalls.push(...this.#parseRawJSONActionFormat(text));
    }
    if (hints.embeddedJSONAction) {
      toolCalls.push(...this.#parseEmbeddedJSONActionFormat(text));
    }
    if (hints.functionCalls) {
      toolCalls.push(...this.#parseFunctionCallsFormat(text));
    }
    if (hints.functionCallTag) {
      toolCalls.push(...this.#parseFunctionCallTagFormat(text));
    }
    if (hints.toolCallTag) {
      toolCalls.push(...this.#parseToolCallTagFormat(text));
    }
    if (hints.xmlTool) {
      toolCalls.push(...this.#parseXMLFormat(text));
    }
    if (hints.namedXML) {
      toolCalls.push(...this.#parseNamedToolXMLFormat(text));
    }
    if (hints.toolCode) {
      toolCalls.push(...this.#parseToolCodeFormat(text));
    }
    if (hints.shellCodeBlock) {
      toolCalls.push(...this.#parseShellCodeBlockFormat(text));
    }
    if (toolCalls.length === 0) {
      toolCalls.push(...this.#parseNaturalLanguage(text));
    }
    return this.#deduplicate(toolCalls);
  }

  detectMalformedToolCall(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }
    const strictCalls = this.#strictParse(text);
    if (strictCalls.length > 0) {
      return null;
    }
    return this.#scanForToolIntentWithoutParse(text);
  }

  #strictParse(text) {
    const toolCalls = [];
    const hints = getParseHints(text, (value) => this.#hasNamedXMLCandidate(value));
    if (hints.dsml) {
      toolCalls.push(...this.#parseDSMLFormat(text));
    }
    if (hints.call) {
      toolCalls.push(...this.#parseCALLFormat(text));
    }
    if (hints.jsonBlock) {
      toolCalls.push(...this.#parseJSONBlockFormat(text));
    }
    if (hints.actionTag) {
      toolCalls.push(...this.#parseActionTagFormat(text));
    }
    if (hints.rawJSON) {
      toolCalls.push(...this.#parseRawJSONActionFormat(text));
    }
    if (hints.functionCalls) {
      toolCalls.push(...this.#parseFunctionCallsFormat(text));
    }
    if (hints.functionCallTag) {
      toolCalls.push(...this.#parseFunctionCallTagFormat(text));
    }
    if (hints.toolCallTag) {
      toolCalls.push(...this.#parseToolCallTagFormat(text));
    }
    if (hints.xmlTool) {
      toolCalls.push(...this.#parseXMLFormat(text));
    }
    if (hints.namedXML) {
      toolCalls.push(...this.#parseNamedToolXMLFormat(text));
    }
    return this.#deduplicate(toolCalls);
  }

  #hasNamedXMLCandidate(text) {
    const tools = this.#toolRegistry ? this.#toolRegistry.getAll() : [];
    for (const tool of tools) {
      if (tool?.name && text.includes(`<${tool.name}>`)) {
        return true;
      }
    }
    for (const [alias, runtimeName] of Object.entries(NAMED_XML_TOOL_ALIASES)) {
      if (this.#toolRegistry?.has?.(runtimeName) && text.includes(`<${alias}>`)) {
        return true;
      }
    }
    return false;
  }

  #scanForToolIntentWithoutParse(text) {
    const tagPatterns = [
      { open: /<action\b[^>]*>/gi, expectedClose: '<' + '/action>' },
      { open: /<tool_call\b[^>]*>/gi, expectedClose: '<' + '/tool_call>' },
      { open: /<function_call\b[^>]*>/gi, expectedClose: '<' + '/function_call>' },
      { open: /<function>/gi, expectedClose: '<' + '/function>' },
      { open: /<tool_code\b[^>]*>/gi, expectedClose: '<' + '/tool_code>' },
      { open: /<tool>/gi, expectedClose: '<' + '/tool>' },
      { open: /<invoke\b[^>]*>/gi, expectedClose: '<' + '/invoke>' },
    ];

    for (const { open, expectedClose } of tagPatterns) {
      const m = text.match(open);
      if (!m || m.length === 0) {
        continue;
      }
      const openStart = text.search(open);
      const afterOpen = text.substring(openStart + m[0].length);
      const firstCloseMatch = afterOpen.match(/<\/[A-Za-z_][\w-]*>/);
      const closeTag = firstCloseMatch ? firstCloseMatch[0] : null;
      const trimmed = text.trim();
      const endsWithExpected = trimmed.endsWith(expectedClose);
      if (!endsWithExpected) {
        return {
          tag: 'xml_close_mismatch_or_missing',
          opening: m[0],
          closing: closeTag || '(missing - response ended without a close tag)',
          hint:
            'Opening tag ' +
            m[0].replace(/\s+$/, '') +
            ' must be closed by ' +
            expectedClose +
            '. The current response has a malformed closing tag.',
          sample: text.substring(openStart, Math.min(openStart + 160, text.length)),
        };
      }
    }

    const fenceRegex = /```(?:tool|json)?\s*\n?([\s\S]*?)```/gi;
    let fence;
    while ((fence = fenceRegex.exec(text)) !== null) {
      const body = fence[1].trim();
      if (body.startsWith('{') && body.endsWith('}')) {
        const parsed = this.#safeJSONParse(body);
        if (!parsed || typeof parsed !== 'object') {
          return {
            tag: 'tool_code_block_invalid_json',
            opening: '```tool',
            closing: '```',
            hint: 'The JSON inside the tool code fence could not be parsed.',
            sample: body.substring(0, 160),
          };
        }
      }
    }

    // Check for plain <invoke> blocks without DSML wrapper — not parsable
    const hasPlainInvoke = /<invoke\b[^>]*>/i.test(text);
    const hasDSMLPrefix = /<(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)/i.test(text);
    if (hasPlainInvoke && !hasDSMLPrefix) {
      const invokeMatch = text.match(/<invoke\b[^>]*>/i);
      const invokeIdx = text.search(/<invoke\b/i);
      return {
        tag: 'plain_invoke_without_dsml',
        opening: invokeMatch[0],
        closing:
          '</invoke>' +
          (text.includes('</invoke>') ? ' (present but not in DSML format)' : ' (missing)'),
        hint: '<invoke> blocks must be wrapped in ||DSML|| tags to be parsed. Use CALL tool_name({"param":"value"}) format instead.',
        sample: text.substring(invokeIdx, Math.min(invokeIdx + 200, text.length)),
      };
    }

    // Check for properly-closed <function> / <tool> blocks that the parser couldn't resolve
    // These are well-formed XML but may have unknown tool names or other issues.
    const hasPlainFunctionBlock = /<function>\s*[\s\S]*?\s*<\/function>/i.test(text);
    if (hasPlainFunctionBlock) {
      const funcIdx = text.search(/<function>/i);
      return {
        tag: 'unparsed_function_block',
        opening: '<function>',
        closing: '</function>',
        hint: '<function> blocks with this name/parameters could not be resolved to a registered tool. Use CALL tool_name({"param":"value"}) format.',
        sample: text.substring(funcIdx, Math.min(funcIdx + 200, text.length)),
      };
    }

    const hasPlainToolBlock = /<tool>\s*\/?[A-Za-z_][\w-]*\s*<\/tool>/i.test(text);
    if (hasPlainToolBlock) {
      const toolIdx = text.search(/<tool>/i);
      return {
        tag: 'unparsed_tool_block',
        opening: '<tool>',
        closing: '</tool>',
        hint: '<tool> block could not be resolved to a recognized tool name. Use CALL tool_name({"param":"value"}) format.',
        sample: text.substring(toolIdx, Math.min(toolIdx + 200, text.length)),
      };
    }

    const callMatch = text.match(/\bCALL\s+\/?([A-Za-z_][\w.-]*)\s*\(\s*\{/);
    if (callMatch) {
      const braceIdx = callMatch.index + callMatch[0].length - 1;
      const found = findBalancedJSON(text, braceIdx);
      if (!found) {
        return {
          tag: 'call_unbalanced_json',
          opening: 'CALL ' + callMatch[1] + '({',
          closing: '(no matching })',
          hint: 'CALL ' + callMatch[1] + ' must contain a balanced JSON object.',
          sample: text.substring(callMatch.index, Math.min(callMatch.index + 160, text.length)),
        };
      }
      const jsonText = text.substring(braceIdx, found.endIdx);
      const parsed = this.#safeJSONParse(jsonText);
      if (!parsed || typeof parsed !== 'object') {
        return {
          tag: 'call_invalid_json',
          opening: 'CALL ' + callMatch[1] + '({',
          closing: '})',
          hint: 'CALL ' + callMatch[1] + ' contains text that cannot be parsed as JSON.',
          sample: jsonText.substring(0, 160),
        };
      }
    }

    return null;
  }

  // --- Format-specific parse methods (delegate to modules) ---

  #parseDSMLFormat(text) {
    return parseDSMLFormat(text, {
      toolRegistry: this.#toolRegistry,
      resolveToolName: (name) => this.#resolveToolName(name),
      decodeStringLiteral: (v) => this.#decodeStringLiteral(v),
      safeJSONParse: (s) => this.#safeJSONParse(s),
    });
  }

  #parseCALLFormat(text) {
    return parseCALLFormat(text, {
      toolRegistry: this.#toolRegistry,
      safeJSONParse: (s) => this.#safeJSONParse(s),
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      recoverCallArguments: (raw) => this.#recoverCallArguments(raw),
    });
  }

  #parseJSONBlockFormat(text) {
    return parseJSONBlockFormat(text, {
      findBalancedJSON,
      safeJSONParse: (s) => this.#safeJSONParse(s),
      toolCallsFromJSON: (j, s, i) => this.#toolCallsFromJSON(j, s, i),
    });
  }

  #parseActionTagFormat(text) {
    return parseActionTagFormat(text, {
      safeJSONParse: (s) => this.#safeJSONParse(s),
      toolCallsFromJSON: (j, s, i) => this.#toolCallsFromJSON(j, s, i),
    });
  }

  #parseRawJSONActionFormat(text) {
    return parseRawJSONActionFormat(text, {
      safeJSONParse: (s) => this.#safeJSONParse(s),
      toolCallsFromJSON: (j, s, i) => this.#toolCallsFromJSON(j, s, i),
      parseLooseRawJSONAction: (t) => this.#parseLooseRawJSONAction(t),
    });
  }

  #parseLooseRawJSONAction(text) {
    return parseLooseRawJSONAction(text, {
      parseLooseJSONStringObject: (b) => this.#parseLooseJSONStringObject(b),
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      toolRegistry: this.#toolRegistry,
    });
  }

  #parseEmbeddedJSONActionFormat(text) {
    return parseEmbeddedJSONActionFormat(text, {
      safeJSONParse: (s) => this.#safeJSONParse(s),
      toolCallsFromJSON: (j, s, i) => this.#toolCallsFromJSON(j, s, i),
      extractJSONObjectCandidates,
    });
  }

  #parseFunctionCallsFormat(text) {
    return parseFunctionCallsFormat(text, {
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      normalizeLooseArgs: (n, a) => this.#normalizeLooseArgs(n, a),
      toolRegistry: this.#toolRegistry,
    });
  }

  #parseFunctionCallTagFormat(text) {
    return parseFunctionCallTagFormat(text, {
      safeJSONParse: (s) => this.#safeJSONParse(s),
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      normalizeLooseArgs: (n, a) => this.#normalizeLooseArgs(n, a),
      toolRegistry: this.#toolRegistry,
    });
  }

  #parseToolCallTagFormat(text) {
    return parseToolCallTagFormat(text, {
      safeJSONParse: (s) => this.#safeJSONParse(s),
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      normalizeLooseArgs: (n, a) => this.#normalizeLooseArgs(n, a),
      toolRegistry: this.#toolRegistry,
    });
  }

  #parseXMLFormat(text) {
    return parseXMLFormat(text, {
      resolveToolName: (n) => this.#resolveToolName(n),
      toolRegistry: this.#toolRegistry,
    });
  }

  #parseNamedToolXMLFormat(text) {
    return parseNamedToolXMLFormat(text, {
      toolRegistry: this.#toolRegistry,
      normalizeLooseArgs: (n, a) => this.#normalizeLooseArgs(n, a),
      normalizeToolArgumentAliases,
      NAMED_XML_TOOL_ALIASES,
    });
  }

  #parseToolCodeFormat(text) {
    return parseToolCodeFormat(text, {
      toolRegistry: this.#toolRegistry,
      resolveToolName: (n) => this.#resolveToolName(n),
      safeJSONParse: (s) => this.#safeJSONParse(s),
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      parseToolCodeArgs: (s) => this.#parseToolCodeArgs(s),
      normalizeToolCodeArgs: (n, a) => this.#normalizeToolCodeArgs(n, a),
    });
  }

  #parseShellCodeBlockFormat(text) {
    return parseShellCodeBlockFormat(text, {
      toolRegistry: this.#toolRegistry,
      parseRuntimeToolInvocations: (t, i) => this.#parseRuntimeToolInvocations(t, i),
    });
  }

  #parseRuntimeToolInvocations(text, startIndex = 0) {
    return parseRuntimeToolInvocations(text, startIndex, {
      toolRegistry: this.#toolRegistry,
      resolveToolName: (n) => this.#resolveToolName(n),
      safeJSONParse: (s) => this.#safeJSONParse(s),
      normalizeJSONToolCall: (n, a) => this.#normalizeJSONToolCall(n, a),
      normalizeToolCodeArgs: (n, a) => this.#normalizeToolCodeArgs(n, a),
      parseToolCodeArgs: (s) => this.#parseToolCodeArgs(s),
    });
  }

  #parseNaturalLanguage(text) {
    return parseNaturalLanguage(text, {
      fallbackPatterns: this.#fallbackPatterns,
    });
  }

  // --- Cross-cutting helper methods ---

  #recoverCallArguments(rawContent) {
    return recoverCallArguments(rawContent, (raw) => this.#extractRecoveredValue(raw));
  }

  #extractRecoveredValue(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    let value = raw.trim();
    if (value.endsWith(',')) {
      value = value.slice(0, -1).trim();
    }
    if (value.length === 0) {
      return '';
    }
    if (value.startsWith('"') || value.startsWith("'")) {
      const openQuote = value[0];
      if (value.length >= 2 && value[value.length - 1] === openQuote) {
        return value.slice(1, -1);
      }
      for (let i = value.length - 1; i > 0; i--) {
        if (value[i] === openQuote && value[i - 1] !== '\\') {
          return value.slice(1, i);
        }
      }
      return value.slice(1);
    }
    if (value.startsWith('{') || value.startsWith('[')) {
      const closed = value.startsWith('{')
        ? findMatchingBrace(value, 0)
        : this.#findMatchingBracket(value, 0);
      const sliceEnd = closed === -1 ? value.length : closed;
      const candidate = value.slice(0, sliceEnd);
      try {
        return JSON.parse(candidate);
      } catch {
        return candidate;
      }
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  #findMatchingBracket(text, openIdx) {
    if (text[openIdx] !== '[') {
      return -1;
    }
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;
    for (let i = openIdx; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === stringChar) {
          inString = false;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (ch === '[' || ch === '{') {
        depth++;
        continue;
      }
      if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0 && ch === ']') {
          return i + 1;
        }
      }
    }
    return -1;
  }

  #parseLooseJSONStringObject(body) {
    return parseLooseJSONStringObject(body, (v) => this.#decodeStringLiteral(v));
  }

  #safeJSONParse(str) {
    if (!str || typeof str !== 'string') {
      return null;
    }
    try {
      return JSON.parse(str);
    } catch {
      try {
        let normalized = '';
        let i = 0;
        while (i < str.length) {
          const ch = str[i];
          if (ch === '"') {
            normalized += '"';
            i++;
            let escaped = false;
            while (i < str.length) {
              const c = str[i];
              if (escaped) {
                normalized += c;
                escaped = false;
                i++;
                continue;
              }
              if (c === '\\') {
                normalized += c;
                escaped = true;
                i++;
                continue;
              }
              if (c === '"') {
                normalized += c;
                i++;
                break;
              }
              if (c === '\n') {
                normalized += '\\n';
                i++;
                continue;
              }
              if (c === '\r') {
                normalized += '\\r';
                i++;
                continue;
              }
              if (c === '\t') {
                normalized += '\\t';
                i++;
                continue;
              }
              normalized += c;
              i++;
            }
            continue;
          }
          normalized += ch;
          i++;
        }
        try {
          return JSON.parse(normalized);
        } catch {
          /* fall through */
        }
        let fixed = normalized;
        if (!fixed.includes('"')) {
          fixed = fixed.replace(/'/g, '"');
        }
        fixed = fixed
          .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
          .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(fixed);
      } catch {
        return null;
      }
    }
  }

  #toolCallsFromJSON(json, source, startIndex = 0) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return [];
    }
    const browserActionCall = browserActionCallFromJSON(json, source, startIndex, {
      toolRegistry: this.#toolRegistry,
      queryFromSearchURL,
      inferSearchQuery,
      isSearchNavigation,
    });
    if (browserActionCall) {
      return [browserActionCall];
    }
    const directName =
      json.name ||
      json.tool ||
      json.tool_name ||
      (typeof json.action === 'string' ? json.action : '');
    if (directName) {
      const originalArgs =
        json.arguments ||
        json.args ||
        json.params ||
        Object.fromEntries(
          Object.entries(json).filter(
            ([key]) => !['name', 'tool', 'tool_name', 'action', 'source', 'id'].includes(key),
          ),
        );
      const { name, args } = this.#normalizeJSONToolCall(directName, originalArgs);
      if (!this.#toolRegistry?.has?.(name)) {
        return [];
      }
      return [{ id: 'call_' + Date.now() + '_' + startIndex, name, arguments: args, source }];
    }
    const action =
      json.action && typeof json.action === 'object' && !Array.isArray(json.action)
        ? json.action
        : json;
    const entries = Object.entries(action);
    if (entries.length !== 1) {
      return [];
    }
    const [rawName, originalArgs] = entries[0];
    const { name, args } = this.#normalizeJSONToolCall(rawName, originalArgs);
    if (!this.#toolRegistry?.has?.(name)) {
      return [];
    }
    return [
      {
        id: 'call_' + Date.now() + '_' + startIndex,
        name,
        arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
        source,
      },
    ];
  }

  #resolveToolName(name) {
    const rawName = String(name || '').replace(/^\//, '');
    if (this.#toolRegistry?.has?.(rawName)) {
      return rawName;
    }
    const underscored = rawName.replace(/-/g, '_');
    if (this.#toolRegistry?.has?.(underscored)) {
      return underscored;
    }
    const snakeCase = rawName
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/-/g, '_')
      .toLowerCase();
    if (this.#toolRegistry?.has?.(snakeCase)) {
      return snakeCase;
    }
    return rawName;
  }

  #normalizeJSONToolCall(rawName, originalArgs) {
    const args =
      originalArgs && typeof originalArgs === 'object' && !Array.isArray(originalArgs)
        ? originalArgs
        : {};
    // 去除开头的 / 和常见的命名空间前缀 (filesystem., fs., tools. 等)
    let name = String(rawName || '').replace(/^\//, '');
    name = name.replace(/^(?:filesystem|fs|tools|file|workspace)\./i, '');
    const snakeName = name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/-/g, '_')
      .toLowerCase();
    const aliases = {
      list_directory: 'list_dir',
      list_files: 'list_dir',
      ls: 'list_dir',
      read: 'read_file',
      cat: 'read_file',
      write: 'write_file',
      save_file: 'write_file',
      edit: 'edit_file',
      update: 'write_file',
      run_command: 'shell',
      execute_command: 'shell',
      run_in_terminal: 'shell',
      terminal: 'shell',
      exec: 'shell',
      bash: 'shell',
      search_web: 'web_search',
      browser_search: 'web_search',
      google: 'web_search',
      internet_search: 'web_search',
      fetch_url: 'web_fetch',
      browser_fetch: 'web_fetch',
      plan: 'brainstorm',
      plan_solution: 'brainstorm',
    };
    if (snakeName === 'create_directory' || snakeName === 'mkdir') {
      const path = args.path || args.dir || args.directory || '.';
      return { name: 'shell', args: { command: 'mkdir -p ' + shellQuote(path) } };
    }
    const resolvedName = aliases[snakeName] || this.#resolveToolName(name);
    if (
      resolvedName === 'shell' &&
      !args.command &&
      (args.cmd || args.path || args.commands || args.code || args.arg0 || args.value)
    ) {
      return {
        name: resolvedName,
        args: {
          ...args,
          command: args.cmd || args.path || args.commands || args.code || args.arg0 || args.value,
        },
      };
    }
    if (resolvedName === 'brainstorm') {
      return {
        name: resolvedName,
        args: {
          problem:
            args.problem ||
            args.steps ||
            args.plan ||
            args.value ||
            'Plan the requested implementation before editing files.',
        },
      };
    }
    if (resolvedName === 'web_search') {
      return {
        name: resolvedName,
        args: { ...args, query: args.query || args.q || args.text || args.value || args.question },
      };
    }
    if (resolvedName === 'web_fetch') {
      return {
        name: resolvedName,
        args: { ...args, url: args.url || args.href || args.link || args.value },
      };
    }
    return { name: resolvedName, args: normalizeToolArgumentAliases(resolvedName, args) };
  }

  #normalizeLooseArgs(toolName, args) {
    if (toolName === 'list_dir' && args.value && !args.path) {
      return { ...args, path: args.value };
    }
    if (toolName === 'list_dir' && !args.path) {
      return { ...args, path: '.' };
    }
    if (toolName === 'read_file' && args.value && !args.path) {
      return { ...args, path: args.value };
    }
    if (toolName === 'shell' && args.value && !args.command) {
      return { ...args, command: args.value };
    }
    if (toolName === 'web_search' && args.value && !args.query) {
      return { ...args, query: args.value };
    }
    if (toolName === 'web_fetch' && args.value && !args.url) {
      return { ...args, url: args.value };
    }
    return args;
  }

  #castParam(value, type) {
    if (type === 'boolean') {
      return ['true', 'yes', '1', 'on'].includes(value.toLowerCase());
    }
    if (type === 'number' || type === 'integer') {
      const num = Number(value);
      return isNaN(num) ? value : num;
    }
    if (type === 'array') {
      try {
        return JSON.parse(value);
      } catch {
        return value.split(/[,;]/).map((s) => s.trim());
      }
    }
    return value;
  }

  #parseToolCodeArgs(argsText) {
    const args = { positional: [] };
    const text = String(argsText || '');
    const stringRegex =
      /(?:([A-Za-z_][\w]*)\s*=\s*)?(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
    let match;
    while ((match = stringRegex.exec(text)) !== null) {
      const key = match[1];
      const value = this.#decodeStringLiteral(match[2] ?? match[3] ?? match[4] ?? match[5] ?? '');
      if (key) {
        args[key] = value;
      } else {
        args.positional.push(value);
      }
    }
    return args;
  }

  #decodeStringLiteral(value) {
    return String(value)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  #normalizeToolCodeArgs(toolName, parsedArgs) {
    if (toolName === 'list_dir') {
      return { path: parsedArgs.path ?? parsedArgs.positional[0] ?? '.' };
    }
    if (toolName === 'read_file') {
      const path =
        parsedArgs.path ?? parsedArgs.file ?? parsedArgs.file_path ?? parsedArgs.positional[0];
      return path ? { path } : null;
    }
    if (toolName === 'write_file') {
      const path =
        parsedArgs.path ?? parsedArgs.file ?? parsedArgs.file_path ?? parsedArgs.positional[0];
      const content = parsedArgs.content ?? parsedArgs.text ?? parsedArgs.positional[1];
      return path && content !== undefined ? { path, content } : null;
    }
    if (toolName === 'shell') {
      const command = parsedArgs.command ?? parsedArgs.cmd ?? parsedArgs.positional[0];
      return command ? { command } : null;
    }
    if (toolName === 'web_search') {
      const query = parsedArgs.query ?? parsedArgs.q ?? parsedArgs.text ?? parsedArgs.positional[0];
      return query ? { query } : null;
    }
    if (toolName === 'web_fetch') {
      const url = parsedArgs.url ?? parsedArgs.href ?? parsedArgs.link ?? parsedArgs.positional[0];
      return url ? { url } : null;
    }
    if (toolName === 'brainstorm') {
      const problem =
        parsedArgs.problem ??
        parsedArgs.positional[0] ??
        'Plan the requested implementation before editing files.';
      return { problem };
    }
    return {};
  }

  #extractParamsFromContext(tool, text) {
    return extractParamsFromContext(tool, text, { castParam: (v, t) => this.#castParam(v, t) });
  }

  #deduplicate(toolCalls) {
    const seen = new Set();
    return toolCalls.filter((tc) => {
      const key = tc.name + ':' + JSON.stringify(tc.arguments);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  generateToolPrompt(tools = null) {
    return generateTextToolPrompt(this.#toolRegistry, tools);
  }
}

export default TextToolParser;
