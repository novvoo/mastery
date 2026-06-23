/**
 * Natural language and DSML format parsers for TextToolParser.
 *
 * Handles: natural language fallback patterns, DSML format,
 * browser action helpers, search URL/query inference.
 */

import { NAMED_XML_TOOL_ALIASES } from '../prompts/text-tool-parser-normalizers.js';

/**
 * Parse natural language tool call patterns (fallback).
 */
export function parseNaturalLanguage(text, { fallbackPatterns }) {
  const toolCalls = [];
  const lowerText = text.toLowerCase();

  for (const pattern of fallbackPatterns) {
    const match = lowerText.match(pattern.regex);
    if (match) {
      const args = {};
      if (pattern.paramExtractor) {
        Object.assign(args, pattern.paramExtractor(match, text));
      }

      const required = pattern.required || [];
      if (required.some(paramName => args[paramName] === undefined || args[paramName] === '')) {
        continue;
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name: pattern.toolName,
        arguments: args,
        source: 'natural_language',
        confidence: 0.6,
      });
    }
  }

  return toolCalls;
}

/**
 * Build natural language fallback patterns from the tool registry.
 */
export function buildFallbackPatterns(toolRegistry, { extractParamsFromContext }) {
  const tools = toolRegistry ? toolRegistry.getAll() : [];
  const patterns = [];

  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    const desc = (tool.description || '').toLowerCase();

    const keywords = [name];

    if (desc.includes('read') || desc.includes('show') || desc.includes('get')) {
      keywords.push('read', 'show', 'get', 'display');
    }
    if (desc.includes('write') || desc.includes('create') || desc.includes('save')) {
      keywords.push('write', 'create', 'save', 'add');
    }
    if (desc.includes('delete') || desc.includes('remove')) {
      keywords.push('delete', 'remove', 'clear');
    }
    if (desc.includes('search') || desc.includes('find')) {
      keywords.push('search', 'find', 'look for');
    }
    if (desc.includes('execute') || desc.includes('run')) {
      keywords.push('execute', 'run', 'start');
    }

    const keywordPattern = keywords.join('|');
    patterns.push({
      toolName: tool.name,
      regex: new RegExp(`\\b(${keywordPattern})\\b.*\\b(${name.replace(/_/g, '[_ ]')}|[${name.split('_').join('|')}])\\b`, 'i'),
      paramExtractor: (match, fullText) => extractParamsFromContext(tool, fullText),
      required: tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []),
    });

    if (name === 'glob') {
      patterns.push({
        toolName: tool.name,
        regex: /\b(list|find|show|get|count)\b.*\b(javascript|js)\b.*\b(files?|目录|文件)\b/i,
        paramExtractor: (match, fullText) => extractParamsFromContext(tool, fullText),
        required: tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []),
      });
    }
  }

  return patterns;
}

/**
 * Extract parameters from surrounding context for natural language parsing.
 */
export function extractParamsFromContext(tool, text, { castParam }) {
  const args = {};
  const params = tool.params || (tool.parameters && tool.parameters.properties ? tool.parameters.properties : tool.parameters) || {};

  for (const [paramName, paramSchema] of Object.entries(params)) {
    const lowerText = text.toLowerCase();
    if (tool.name === 'glob' && paramName === 'pattern') {
      const explicitGlob = text.match(/["'`]((?:\*\*\/)?[^"'`\s]*\.(?:js|mjs|cjs|ts|tsx|jsx))["'`]/i)
        || text.match(/(?:^|\s)((?:\*\*\/)?\*\.js)\b/i);
      if (explicitGlob) {
        args[paramName] = explicitGlob[1];
        continue;
      }
      if (/\b(javascript|js)\b/i.test(text) || /js\s*文件|javascript\s*文件/i.test(lowerText)) {
        args[paramName] = '*.js';
        continue;
      }
    }

    const patterns = [
      new RegExp(`${paramName}[:=]\\s*["']?([^"'\\s,]+)["']?`, 'i'),
      new RegExp(`${paramName}\\s+is\\s+["']?([^"'\\n]+)["']?`, 'i'),
      new RegExp(`${paramName}\\s*\\(([^)]+)\\)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        args[paramName] = castParam(match[1].trim(), paramSchema.type);
        break;
      }
    }
  }

  return args;
}

/**
 * Convert a browser-action JSON object into a tool call.
 */
export function browserActionCallFromJSON(json, source, startIndex, { toolRegistry, queryFromSearchURL, inferSearchQuery, isSearchNavigation }) {
  const browserActions = new Set([
    'navigate',
    'go_to',
    'goto',
    'open_url',
    'open_page',
    'browse',
    'browser',
    'type',
    'input',
    'input_text',
    'fill',
    'enter_text',
    'search',
    'click',
    'click_element',
    'click_link',
    'select',
    'press',
  ]);
  const action = json.action && typeof json.action === 'object' && !Array.isArray(json.action)
    ? json.action
    : json;
  const entries = Object.entries(action);
  if (entries.length < 1) {
    return null;
  }

  const normalizeActionName = value => String(value || '')
    .replace(/^\//, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
  const selectedEntry = entries.find(([name, value]) => {
    const normalized = normalizeActionName(name);
    if (!browserActions.has(normalized)) {
      return false;
    }
    return value && typeof value === 'object' && !Array.isArray(value) && (
      value.query || value.q || value.search || value.text || value.keywords ||
      value.url || value.href || value.link || value.value
    );
  }) || entries.find(([name]) => browserActions.has(normalizeActionName(name)));

  if (!selectedEntry) {
    return null;
  }

  const [rawName, rawArgs] = selectedEntry;
  const actionName = normalizeActionName(rawName);
  if (!browserActions.has(actionName)) {
    return null;
  }

  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  const url = args.url || args.href || args.link || args.value;
  const explicitQuery = args.query || args.q || args.search || args.text || args.keywords;
  const searchQuery = explicitQuery || queryFromSearchURL(url) || inferSearchQuery(json);

  if (searchQuery && toolRegistry?.has?.('web_search') && isSearchNavigation(url)) {
    return {
      id: `call_${Date.now()}_${startIndex}`,
      name: 'web_search',
      arguments: { query: searchQuery },
      source: `${source}_browser_action`,
    };
  }

  if (url && toolRegistry?.has?.('web_fetch')) {
    return {
      id: `call_${Date.now()}_${startIndex}`,
      name: 'web_fetch',
      arguments: { url },
      source: `${source}_browser_action`,
    };
  }

  if (searchQuery && toolRegistry?.has?.('web_search')) {
    return {
      id: `call_${Date.now()}_${startIndex}`,
      name: 'web_search',
      arguments: { query: searchQuery },
      source: `${source}_browser_action`,
    };
  }

  return null;
}

/**
 * Check if a URL is a search engine navigation URL.
 */
export function isSearchNavigation(url) {
  if (!url) {
    return true;
  }
  try {
    const parsed = new globalThis.URL(String(url));
    const host = parsed.hostname.toLowerCase();
    return host.includes('google.')
      || host.includes('bing.')
      || host.includes('duckduckgo.')
      || host.includes('baidu.')
      || host.includes('search.yahoo.');
  } catch {
    return false;
  }
}

/**
 * Extract query parameter from a search engine URL.
 */
export function queryFromSearchURL(url) {
  if (!url) {
    return '';
  }
  try {
    const parsed = new globalThis.URL(String(url));
    return parsed.searchParams.get('q')
      || parsed.searchParams.get('query')
      || parsed.searchParams.get('wd')
      || parsed.searchParams.get('p')
      || '';
  } catch {
    return '';
  }
}

/**
 * Infer a search query from a JSON action object.
 */
export function inferSearchQuery(json) {
  const fields = [
    json.query,
    json.q,
    json.search,
    json.user_request,
    json.input,
    json.task,
    json.next_goal,
    json.memory,
    json.evaluation_previous_goal,
  ];
  const text = fields.find(value => typeof value === 'string' && value.trim());
  if (!text) {
    return '';
  }
  const quotedInput = text.match(/(?:输入|搜索|查询|查找|search(?:\s+for)?)[\u201c"'']([^\u201d"'']+)[\u201d"'']/i);
  if (quotedInput?.[1]) {
    return quotedInput[1].trim();
  }

  const chineseWeatherRequest = text.match(/(?:用户要求|需要|想要|请|帮.*?)(?:查询|搜索|查找|了解)([^。；;,.，]+天气[^。；;,.，]*)/);
  if (chineseWeatherRequest?.[1]) {
    return chineseWeatherRequest[1].trim();
  }

  const chineseWeatherClick = text.match(/点击([^。；;,.，]*?)(?:城市)?链接[\s\S]*?(?:天气|weather)/i);
  if (chineseWeatherClick?.[1]) {
    const city = chineseWeatherClick[1].replace(/并$/, '').trim();
    if (city) {
      return `${city}天气`;
    }
  }

  return text
    .replace(/^Beginning task to\s+/i, '')
    .replace(/\bNeed to navigate\b[\s\S]*$/i, '')
    .replace(/\bNeed to search\b[\s\S]*$/i, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Parse DSML format tool calls.
 * Format: <｜｜DSML｜｜invoke name="tool"> ... </｜｜DSML｜｜invoke>
 */
export function parseDSMLFormat(text, { toolRegistry, resolveToolName, decodeStringLiteral, safeJSONParse }) {
  if (!text || typeof text !== 'string') {return [];}

  // DSML: <｜｜DSML｜｜invoke name="tool"> / <||DSML||invoke name="tool">
  // Unicode fullwidth vertical bar (U+FF5C) or plain ASCII pipes.
  const pipe = '(?:\\uFF5C\\uFF5C|\\|\\|)';
  const dsmlTag = `<${pipe}DSML${pipe}`;

  const toolCalls = [];

  const invokeRegex = new RegExp(
    `${dsmlTag}invoke\\s+name="([^"]+)"\\s*>` +
    '([\\s\\S]*?)' +
    `<\\/?${pipe}DSML${pipe}invoke\\s*>`,
    'gi',
  );

  const paramRegex = new RegExp(
    `${dsmlTag}parameter\\s+name="([^"]+)"(?:\\s+[^>]*)?>` +
    '([\\s\\S]*?)' +
    `<\\/?${pipe}DSML${pipe}parameter\\s*>`,
    'gi',
  );

  let invokeMatch;
  while ((invokeMatch = invokeRegex.exec(text)) !== null) {
    const name = resolveToolName(invokeMatch[1]);
    if (!toolRegistry?.has?.(name)) {
      continue;
    }

    const innerText = invokeMatch[2];
    const args = {};
    let paramMatch;

    while ((paramMatch = paramRegex.exec(innerText)) !== null) {
      const paramName = paramMatch[1];
      let paramValue = paramMatch[2] ? paramMatch[2].trim() : '';
      const decoded = decodeStringLiteral(paramValue);
      args[paramName] = decoded !== undefined ? decoded : paramValue;
    }

    if (Object.keys(args).length === 0) {
      const jsonMatch = innerText.match(/^\s*(\{[\s\S]*\})\s*$/);
      if (jsonMatch) {
        const parsed = safeJSONParse(jsonMatch[1]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          Object.assign(args, parsed);
        }
      }
    }

    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      name,
      arguments: args,
      source: 'DSML',
    });
  }

  // Also handle standalone DSML invoke blocks without wrapping tool_calls tag
  if (toolCalls.length === 0 && new RegExp(`${dsmlTag}`, 'i').test(text)) {
    const namedTagRegex = new RegExp(
      `${dsmlTag}([A-Za-z_][\\w-]*)\\s*([^>]*)>`,
      'gi',
    );

    let namedMatch;
    while ((namedMatch = namedTagRegex.exec(text)) !== null) {
      const rawName = namedMatch[1];
      if (rawName === 'tool_calls' || rawName === 'parameter' || rawName === 'invoke') {
        continue;
      }
      const name = resolveToolName(rawName);
      if (!toolRegistry?.has?.(name)) {
        continue;
      }

      const attrsText = namedMatch[2] || '';
      const args = {};
      const attrRegex = /(\w+)\s*=\s*"([^"]*)"/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsText)) !== null) {
        if (attrMatch[1] === 'name') {continue;}
        args[attrMatch[1]] = decodeStringLiteral(attrMatch[2]);
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name,
        arguments: args,
        source: 'DSML_named_tag',
      });
    }
  }

  // Fallback: parse plain <invoke> blocks without DSML prefix
  // e.g. <invoke name="glob"><parameter name="path">/foo</parameter></invoke>
  if (toolCalls.length === 0 && /<invoke\b/i.test(text)) {
    const plainInvokeRegex = /<invoke\s+name="([^"]+)"\s*>\s*([\s\S]*?)<\/invoke\s*>/gi;
    const plainParamRegex = /<parameter\s+name="([^"]+)"(?:\s+[^>]*)?>\s*([\s\S]*?)\s*<\/parameter\s*>/gi;

    let invokeMatch;
    while ((invokeMatch = plainInvokeRegex.exec(text)) !== null) {
      const name = resolveToolName(invokeMatch[1]);
      if (!toolRegistry?.has?.(name)) {continue;}

      const innerText = invokeMatch[2];
      const args = {};
      let paramMatch;
      while ((paramMatch = plainParamRegex.exec(innerText)) !== null) {
        const paramName = paramMatch[1];
        let paramValue = (paramMatch[2] || '').trim();
        const decoded = decodeStringLiteral(paramValue);
        args[paramName] = decoded !== undefined ? decoded : paramValue;
      }

      if (Object.keys(args).length === 0) {
        const jsonMatch = innerText.match(/^\s*(\{[\s\S]*\})\s*$/);
        if (jsonMatch) {
          const parsed = safeJSONParse(jsonMatch[1]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(args, parsed);
          }
        }
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name,
        arguments: args,
        source: 'plain_invoke',
      });
    }
  }

  return toolCalls;
}
