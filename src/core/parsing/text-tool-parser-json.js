/**
 * JSON format parsers for TextToolParser.
 *
 * Handles: JSON block, raw JSON action, embedded JSON action,
 * loose JSON string object, and supporting utilities.
 */

/**
 * Parse JSON block format tool calls.
 * Format: ```tool\n{"name": "tool_name", "arguments": {...}}\n```
 * @param {string} text
 * @param {object} deps
 * @param {function} deps.findBalancedJSON - Balanced JSON finder
 * @param {function} deps.safeJSONParse - Safe JSON parser
 * @param {function} deps.toolCallsFromJSON - Convert JSON to tool calls
 * @returns {Array<object>}
 */
export function parseJSONBlockFormat(text, { findBalancedJSON, safeJSONParse, toolCallsFromJSON }) {
  const toolCalls = [];
  const blockRegex = /```(?:tool)?\s*\n?\s*\{/g;
  let match;

  while ((match = blockRegex.exec(text)) !== null) {
    const braceStart = match.index + match[0].length - 1;
    const found = findBalancedJSON(text, braceStart);
    if (!found) {
      continue;
    }

    // verify closing code fence appears within a few characters after the JSON
    const after = text.substring(found.endIdx, found.endIdx + 20);
    if (!/^\s*\n?\s*```/.test(after)) {
      blockRegex.lastIndex = found.endIdx;
      continue;
    }

    try {
      const json = safeJSONParse(found.content);
      toolCalls.push(...toolCallsFromJSON(json, 'JSON_block', toolCalls.length));
    } catch (e) {
      // 不是有效的工具调用 JSON
    }
    blockRegex.lastIndex = found.endIdx;
  }

  return toolCalls;
}

/**
 * Parse action tag format.
 * Format: <action>{"tool_name": {"param": "value"}}</action>
 * @param {string} text
 * @param {object} deps
 * @param {function} deps.safeJSONParse
 * @param {function} deps.toolCallsFromJSON
 * @returns {Array<object>}
 */
export function parseActionTagFormat(text, { safeJSONParse, toolCallsFromJSON }) {
  const toolCalls = [];
  const actionRegex = /<action>\s*([\s\S]*?)\s*<\/action>/gi;
  let match;
  while ((match = actionRegex.exec(text)) !== null) {
    const json = safeJSONParse(match[1].trim());
    toolCalls.push(...toolCallsFromJSON(json, 'action_tag', toolCalls.length));
  }
  return toolCalls;
}

/**
 * Parse raw JSON action format.
 * Format: {"action": {"tool_name": {"param": "value"}}}
 * @param {string} text
 * @param {object} deps
 * @param {function} deps.safeJSONParse
 * @param {function} deps.toolCallsFromJSON
 * @param {function} deps.parseLooseRawJSONAction
 * @returns {Array<object>}
 */
export function parseRawJSONActionFormat(
  text,
  { safeJSONParse, toolCallsFromJSON, parseLooseRawJSONAction },
) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return [];
  }

  const parsedCalls = toolCallsFromJSON(safeJSONParse(trimmed), 'raw_JSON_action', 0);
  if (parsedCalls.length > 0) {
    return parsedCalls;
  }
  return parseLooseRawJSONAction(trimmed);
}

/**
 * Parse loose raw JSON action format.
 * @param {string} text
 * @param {object} deps
 * @param {function} deps.parseLooseJSONStringObject
 * @param {function} deps.normalizeJSONToolCall
 * @param {object} deps.toolRegistry
 * @returns {Array<object>}
 */
export function parseLooseRawJSONAction(
  text,
  { parseLooseJSONStringObject, normalizeJSONToolCall, toolRegistry },
) {
  const actionMatch = text.match(/"action"\s*:\s*\{\s*"([^"]+)"\s*:\s*\{([\s\S]*)\}\s*\}\s*$/);
  if (!actionMatch) {
    return [];
  }

  const rawArgs = parseLooseJSONStringObject(actionMatch[2]);
  const { name, args } = normalizeJSONToolCall(actionMatch[1], rawArgs);
  if (!toolRegistry?.has?.(name)) {
    return [];
  }

  return [
    {
      id: `call_${Date.now()}_0`,
      name,
      arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
      source: 'raw_JSON_action_loose',
    },
  ];
}

/**
 * Parse embedded JSON action format.
 * @param {string} text
 * @param {object} deps
 * @param {function} deps.safeJSONParse
 * @param {function} deps.toolCallsFromJSON
 * @param {function} deps.extractJSONObjectCandidates
 * @returns {Array<object>}
 */
export function parseEmbeddedJSONActionFormat(
  text,
  { safeJSONParse, toolCallsFromJSON, extractJSONObjectCandidates },
) {
  if (!text.includes('"action"') && !text.includes("'action'")) {
    return [];
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return [];
  }

  const toolCalls = [];
  for (const candidate of extractJSONObjectCandidates(text)) {
    const json = safeJSONParse(candidate);
    toolCalls.push(...toolCallsFromJSON(json, 'embedded_JSON_action', toolCalls.length));
  }
  return toolCalls;
}

/**
 * Extract JSON object candidate substrings from text.
 * @param {string} text
 * @returns {Array<string>}
 */
export function extractJSONObjectCandidates(text) {
  const candidates = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;

    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          inString = false;
          quote = '';
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }
      if (char === '{') {
        depth++;
      }
      if (char === '}') {
        depth--;
      }
      if (depth === 0) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  }
  return candidates;
}

/**
 * Parse a loose JSON string object (key-value pairs with relaxed quoting).
 * @param {string} body
 * @param {function} decodeStringLiteral
 * @returns {object}
 */
export function parseLooseJSONStringObject(body, decodeStringLiteral) {
  const args = {};
  let index = 0;
  const text = String(body || '');

  while (index < text.length) {
    const keyStart = text.indexOf('"', index);
    if (keyStart === -1) {
      break;
    }
    const keyEnd = findJSONStringEnd(text, keyStart);
    if (keyEnd === -1) {
      break;
    }
    const key = decodeStringLiteral(text.slice(keyStart + 1, keyEnd));
    const colon = text.indexOf(':', keyEnd + 1);
    if (colon === -1) {
      break;
    }
    let valueStart = colon + 1;
    while (/\s/.test(text[valueStart] || '')) {
      valueStart++;
    }

    if (text[valueStart] !== '"') {
      const valueEnd = findLooseScalarEnd(text, valueStart);
      args[key] = text.slice(valueStart, valueEnd).trim();
      index = valueEnd + 1;
      continue;
    }

    const valueEnd = findLooseStringEnd(text, valueStart);
    if (valueEnd === -1) {
      break;
    }
    args[key] = decodeStringLiteral(text.slice(valueStart + 1, valueEnd));
    index = valueEnd + 1;
  }

  return args;
}

/**
 * Find the end of a loose string value (tolerant of unescaped quotes).
 * @param {string} text
 * @param {number} start
 * @returns {number} Index of closing quote, or -1
 */
export function findLooseStringEnd(text, start) {
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char !== '"') {
      continue;
    }
    let next = i + 1;
    while (/\s/.test(text[next] || '')) {
      next++;
    }
    if (text[next] === ',' || text[next] === '}' || next >= text.length) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the end of a JSON string starting at a quote.
 * @param {string} text
 * @param {number} start
 * @returns {number} Index of closing quote, or -1
 */
export function findJSONStringEnd(text, start) {
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return i;
    }
  }
  return -1;
}

/**
 * Find end of a loose scalar value (up to comma or closing brace).
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
export function findLooseScalarEnd(text, start) {
  let index = start;
  while (index < text.length && text[index] !== ',' && text[index] !== '}') {
    index++;
  }
  return index;
}
