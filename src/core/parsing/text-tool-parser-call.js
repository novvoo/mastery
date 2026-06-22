/**
 * CALL format parser for TextToolParser.
 *
 * Handles: CALL tool_name({"param": "value"})
 */

/**
 * Scan forward from startIdx to find a balanced JSON object.
 * Tracks brace depth and ignores braces inside string literals.
 * Supports double quotes, single quotes, and backslash escapes.
 * @param {string} text
 * @param {number} startIdx
 * @returns {{endIdx: number, content: string} | null}
 */
export function findBalancedJSON(text, startIdx) {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  let i = startIdx;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i++;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      i++;
      continue;
    }

    if (ch === '{') {
      depth++;
      i++;
      continue;
    }

    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return {
          endIdx: i + 1,
          content: text.substring(startIdx, i + 1),
        };
      }
      i++;
      continue;
    }

    i++;
  }

  return null;
}

/**
 * Parse CALL format tool calls from text.
 * @param {string} text - LLM output text
 * @param {object} deps - Dependencies
 * @param {object} deps.toolRegistry - Tool registry
 * @param {function} deps.safeJSONParse - Safe JSON parser
 * @param {function} deps.normalizeJSONToolCall - Normalize JSON tool call
 * @param {function} deps.recoverCallArguments - Recover call arguments
 * @returns {Array<object>} Parsed tool calls
 */
export function parseCALLFormat(text, { toolRegistry, safeJSONParse, normalizeJSONToolCall, recoverCallArguments }) {
  const toolCalls = [];
  // Find each CALL header, then scan for balanced JSON argument object.
  // A naive /\{[\s\S]*?\}/ non-greedy match stops at the first }, which
  // breaks when string values contain code snippets like { x: 10 }.
  const headerRegex = /CALL\s+\/?([A-Za-z_][\w.-]*)\s*\(\s*\{/g;
  let match;

  while ((match = headerRegex.exec(text)) !== null) {
    const toolName = match[1];
    const braceStart = match.index + match[0].length - 1;
    const found = findBalancedJSON(text, braceStart);
    if (!found) {continue;}

    try {
      let args = safeJSONParse(found.content);

      // Fallback: if JSON parsing fails (common when the argument value
      // contains code with unescaped quotes like: {"command": "echo "abc""}),
      // try to extract the first string value for a few well-known keys
      // (command, path, query, url, content) directly from the raw text.
      // This keeps the tool call functional instead of being silently
      // dropped, which would cause the raw CALL text to leak back to the
      // user as an unhandled final answer.
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        const recovered = recoverCallArguments(found.content);
        if (recovered && Object.keys(recovered).length > 0) {
          args = recovered;
        }
      }

      if (args && typeof args === 'object' && !Array.isArray(args)) {
        const { name, args: normalizedArgs } = normalizeJSONToolCall(toolName, args);
        if (toolRegistry?.has && !toolRegistry.has(name)) {
          headerRegex.lastIndex = found.endIdx;
          continue;
        }
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          name,
          arguments: normalizedArgs && typeof normalizedArgs === 'object' && !Array.isArray(normalizedArgs)
            ? normalizedArgs
            : args,
          source: 'CALL_format',
        });
      }
      headerRegex.lastIndex = found.endIdx;
    } catch (e) {
      console.debug(`Failed to parse CALL format`);
      headerRegex.lastIndex = found.endIdx;
    }
  }

  return toolCalls;
}

/**
 * Recover arguments from a raw CALL {...} payload when strict JSON
 * parsing fails. The most common failure mode is unescaped double
 * quotes inside string values — e.g.,
 *   {"command": "node -e 'console.log(\"hi\");'" }
 * has internal `"` characters that break JSON parsing.
 *
 * Strategy: scan for top-level `"key" :` markers and pair each key
 * with the raw content up to the next `"key" :` marker, a trailing
 * `}`, or end-of-text. This is tolerant of unescaped quotes inside
 * the value. When the value itself starts with `{` or `[`, we fall
 * back to balanced-delimiter extraction.
 * @param {string} rawContent
 * @param {function} extractRecoveredValue - Extract recovered value helper
 * @returns {object | null}
 */
export function recoverCallArguments(rawContent, extractRecoveredValue) {
  if (!rawContent || typeof rawContent !== 'string') {return null;}

  const content = rawContent.trim();
  if (!content.startsWith('{')) {return null;}

  // Work on the text inside the outer braces.
  const endBrace = findMatchingBrace(content, 0);
  const innerEnd = endBrace === -1 ? content.length : endBrace - 1;
  const inner = content.slice(1, innerEnd);

  // Find top-level `"key"` markers followed by `:` or `=`.
  const keyPositions = findTopLevelKeyPositions(inner);

  const result = {};
  for (let i = 0; i < keyPositions.length; i++) {
    const { key, keyEnd } = keyPositions[i];
    const nextStart = i + 1 < keyPositions.length
      ? keyPositions[i + 1].keyStart
      : inner.length;
    // Extract the value slice between this key's `:` and the next
    // key (or the end of the inner text).
    let valueRaw = inner.slice(keyEnd, nextStart).trim();
    if (valueRaw.endsWith(',')) { valueRaw = valueRaw.slice(0, -1).trim(); }
    const value = extractRecoveredValue(valueRaw);
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Find matching closing brace for an opening brace at openIdx.
 * @param {string} text
 * @param {number} openIdx
 * @returns {number} Index of matching '}', or -1
 */
export function findMatchingBrace(text, openIdx) {
  if (text[openIdx] !== '{') {return -1;}
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {escaped = false; continue;}
      if (ch === '\\') {escaped = true; continue;}
      if (ch === stringChar) {inString = false;}
      continue;
    }
    if (ch === '"' || ch === "'") {inString = true; stringChar = ch; continue;}
    if (ch === '{' || ch === '[') {depth++; continue;}
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === '}') {return i + 1;}
    }
  }
  return -1;
}

/**
 * Find top-level key positions in JSON-like text.
 * @param {string} text
 * @returns {Array<{key: string, keyStart: number, keyEnd: number}>}
 */
export function findTopLevelKeyPositions(text) {
  const positions = [];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {escaped = false; continue;}
      if (ch === '\\') {escaped = true; continue;}
      if (ch === stringChar) {inString = false;}
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (depth > 0) {continue;}
      const quoteChar = ch;
      const afterOpen = i + 1;
      const closeIdx = findNextUnescapedQuote(text, afterOpen, quoteChar);
      if (closeIdx === -1) {
        continue;
      }
      const candidateKey = text.slice(afterOpen, closeIdx - 1);
      if (!/^[A-Za-z_][\w-]*$/.test(candidateKey)) {
        i = closeIdx - 1;
        continue;
      }
      let j = closeIdx;
      while (j < text.length && /\s/.test(text[j])) {j++;}
      if (j < text.length && (text[j] === ':' || text[j] === '=')) {
        positions.push({
          key: candidateKey,
          keyStart: i,
          keyEnd: j + 1,
        });
        i = j;
        continue;
      }
      i = closeIdx - 1;
      continue;
    }
    if (ch === '{' || ch === '[') {depth++; continue;}
    if (ch === '}' || ch === ']') {depth = Math.max(0, depth - 1); continue;}
  }
  return positions;
}

/**
 * Find the next unescaped quote character in text starting from start.
 * @param {string} text
 * @param {number} start
 * @param {string} quoteChar
 * @returns {number} Index of matching quote, or -1
 */
export function findNextUnescapedQuote(text, start, quoteChar) {
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {escaped = false; continue;}
    if (ch === '\\') {escaped = true; continue;}
    if (ch === quoteChar) {return i + 1;}
  }
  return -1;
}

/**
 * Find matching closing bracket for an opening bracket at openIdx.
 * @param {string} text
 * @param {number} openIdx
 * @returns {number} Index of matching ']', or -1
 */
export function findMatchingBracket(text, openIdx) {
  if (text[openIdx] !== '[') {return -1;}
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {escaped = false; continue;}
      if (ch === '\\') {escaped = true; continue;}
      if (ch === stringChar) {inString = false;}
      continue;
    }
    if (ch === '"' || ch === "'") {inString = true; stringChar = ch; continue;}
    if (ch === '[' || ch === '{') {depth++; continue;}
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && ch === ']') {return i + 1;}
    }
  }
  return -1;
}

/**
 * Extract a tolerant value from a recovered CALL argument slice.
 * @param {string} raw
 * @param {function} safeJSONParse
 * @returns {*}
 */
export function extractRecoveredValue(raw, safeJSONParse) {
  if (!raw || typeof raw !== 'string') {return null;}
  let value = raw.trim();

  if (value.endsWith(',')) {value = value.slice(0, -1).trim();}
  if (value.length === 0) {return '';}

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
      : findMatchingBracket(value, 0);
    const sliceEnd = closed === -1 ? value.length : closed;
    const candidate = value.slice(0, sliceEnd);
    return safeJSONParse(candidate) || candidate;
  }

  return safeJSONParse(value) ?? value;
}
