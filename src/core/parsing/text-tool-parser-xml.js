/**
 * XML format parsers for TextToolParser.
 *
 * Handles: XML format, tool call tag, function calls,
 * function call tag, named tool XML.
 */

/**
 * Parse XML format tool calls.
 * Format: <tool>tool_name</tool><arg>value</arg>
 */
export function parseXMLFormat(text, { resolveToolName, toolRegistry }) {
  const toolCalls = [];
  const toolRegex = /<tool>\/?([A-Za-z_][\w-]*)<\/tool>/g;
  let match;

  while ((match = toolRegex.exec(text)) !== null) {
    const name = resolveToolName(match[1]);
    // Skip unregistered tool names — these will be caught by malformed detection
    if (toolRegistry && !toolRegistry.has?.(name)) continue;

    const args = {};

    const argRegex = new RegExp('<arg(?:\\s+name="([^"]+)")?>([^<]*)</arg>', 'g');
    let argMatch;
    let argIndex = 0;

    while ((argMatch = argRegex.exec(text)) !== null) {
      const argName = argMatch[1] || `arg${argIndex++}`;
      args[argName] = argMatch[2].trim();
    }

    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      name,
      arguments: args,
      source: 'XML_format',
    });
  }

  return toolCalls;
}

/**
 * Parse tool_call tag format.
 */
export function parseToolCallTagFormat(text, { safeJSONParse, normalizeJSONToolCall, normalizeLooseArgs, toolRegistry }) {
  const toolCalls = [];
  const callRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match;

  while ((match = callRegex.exec(text)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<(?:name|function|function_name)>\s*([^<]+?)\s*<\/(?:name|function|function_name)>/i);
    if (!nameMatch) {
      continue;
    }

    let rawArgs = {};
    const argumentsMatch = block.match(/<(?:arguments|parameters)>\s*([\s\S]*?)\s*<\/(?:arguments|parameters)>/i);
    if (argumentsMatch) {
      rawArgs = safeJSONParse(argumentsMatch[1].trim()) || {};
    }
    const parameterValues = Array.from(block.matchAll(/<parameter(?:\s+name="([^"]+)")?>\s*([\s\S]*?)\s*<\/parameter>/gi))
      .map(parameterMatch => ({
        name: parameterMatch[1],
        value: parameterMatch[2].trim(),
      }));
    const malformedParameterValues = Array.from(block.matchAll(/<parameter=([A-Za-z_][\w-]*)>\s*<\/parameter>\s*<parameter>\s*([\s\S]*?)\s*<\/parameter>/gi))
      .map(parameterMatch => ({
        name: parameterMatch[1],
        value: parameterMatch[2].trim(),
      }));

    if (Object.keys(rawArgs).length > 0) {
      // Prefer explicit JSON arguments when provided.
    } else if (malformedParameterValues.length > 0) {
      for (const parameter of malformedParameterValues) {
        rawArgs[parameter.name] = parameter.value;
      }
      for (let i = 0; i < parameterValues.length; i += 2) {
        const current = parameterValues[i];
        const next = parameterValues[i + 1];
        if (current && next) {
          rawArgs[current.value] = next.value;
        }
      }
    } else if (parameterValues.length === 1) {
      rawArgs.value = parameterValues[0].value;
    } else {
      for (let i = 0; i < parameterValues.length; i += 2) {
        const current = parameterValues[i];
        const next = parameterValues[i + 1];
        if (current?.name) {
          rawArgs[current.name] = current.value;
        } else if (current && next) {
          rawArgs[current.value] = next.value;
        }
      }
    }

    const { name, args } = normalizeJSONToolCall(nameMatch[1], rawArgs);
    if (!toolRegistry?.has?.(name)) {
      continue;
    }

    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      name,
      arguments: normalizeLooseArgs(name, args),
      source: 'tool_call_tag',
    });
  }

  return toolCalls;
}

/**
 * Parse function_calls format.
 */
export function parseFunctionCallsFormat(text, { normalizeJSONToolCall, normalizeLooseArgs, toolRegistry }) {
  const toolCalls = [];
  const functionRegex = /<function>\s*([\s\S]*?)\s*<\/function>/gi;
  let match;

  while ((match = functionRegex.exec(text)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<name>\s*([^<]+?)\s*<\/name>/i);
    if (!nameMatch) {
      continue;
    }

    const rawArgs = {};
    for (const parameterMatch of block.matchAll(/<parameter<([A-Za-z_][\w-]*)>\s*([\s\S]*?)\s*<\/parameter>/gi)) {
      rawArgs[parameterMatch[1]] = parameterMatch[2].trim();
    }
    for (const parameterMatch of block.matchAll(/<parameter=([A-Za-z_][\w-]*)>\s*([\s\S]*?)(?=<\/function>|<parameter[=>]|$)/gi)) {
      rawArgs[parameterMatch[1]] = parameterMatch[2].trim();
    }

    const parameterValues = Array.from(block.matchAll(/<parameter(?:\s+name="([^"]+)")?>\s*([\s\S]*?)\s*<\/parameter>/gi))
      .map(parameterMatch => ({
        name: parameterMatch[1],
        value: parameterMatch[2].trim(),
      }));
    for (let i = 0; i < parameterValues.length; i += 2) {
      const current = parameterValues[i];
      const next = parameterValues[i + 1];
      if (current?.name) {
        rawArgs[current.name] = current.value;
      } else if (current && next) {
        rawArgs[current.value] = next.value;
      }
    }

    const { name, args } = normalizeJSONToolCall(nameMatch[1], rawArgs);
    if (!toolRegistry?.has?.(name)) {
      continue;
    }

    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      name,
      arguments: normalizeLooseArgs(name, args),
      source: 'function_calls',
    });
  }

  return toolCalls;
}

/**
 * Parse function_call tag format.
 */
export function parseFunctionCallTagFormat(text, { safeJSONParse, normalizeJSONToolCall, normalizeLooseArgs, toolRegistry }) {
  const toolCalls = [];
  const callRegex = /<function_call>\s*([\s\S]*?)\s*<\/function_call>/gi;
  let match;

  while ((match = callRegex.exec(text)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<(?:name|function|function_name)>\s*([^<]+?)\s*<\/(?:name|function|function_name)>/i);
    if (!nameMatch) {
      continue;
    }

    const { name } = normalizeJSONToolCall(nameMatch[1], {});
    if (!toolRegistry?.has?.(name)) {
      continue;
    }

    const rawArgs = extractFunctionCallTagArgs(block, safeJSONParse);
    const normalized = normalizeJSONToolCall(nameMatch[1], rawArgs);
    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      name: normalized.name,
      arguments: normalizeLooseArgs(normalized.name, normalized.args),
      source: 'function_call_tag',
    });
  }

  return toolCalls;
}

/**
 * Extract arguments from a function_call tag block.
 */
export function extractFunctionCallTagArgs(block, safeJSONParse) {
  const parametersMatch = block.match(/<parameters>\s*([\s\S]*?)\s*<\/parameters>/i);
  const parameters = parametersMatch ? parametersMatch[1].trim() : block;
  const json = safeJSONParse(parameters);
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    return json;
  }

  const args = {};
  const parameterValues = Array.from(parameters.matchAll(/<parameter(?:\s+name="([^"]+)")?>\s*([\s\S]*?)\s*<\/parameter>/gi))
    .map(parameterMatch => ({
      name: parameterMatch[1],
      value: parameterMatch[2].trim(),
    }));

  let index = 0;
  for (const parameter of parameterValues) {
    let key = parameter.name;
    let value = parameter.value;
    const inlineName = value.match(/^([A-Za-z_][\w-]*)\s*\n([\s\S]*)$/);
    if (!key && inlineName) {
      key = inlineName[1];
      value = inlineName[2].trim();
    }
    args[key || `arg${index++}`] = value;
  }

  return args;
}

/**
 * Parse named tool XML format.
 */
export function parseNamedToolXMLFormat(text, { toolRegistry, normalizeLooseArgs, normalizeToolArgumentAliases, NAMED_XML_TOOL_ALIASES }) {
  const toolCalls = [];
  const tools = toolRegistry ? toolRegistry.getAll() : [];
  const tagToToolName = new Map();

  for (const tool of tools) {
    tagToToolName.set(tool.name, tool.name);
  }
  for (const [alias, runtimeName] of Object.entries(NAMED_XML_TOOL_ALIASES)) {
    if (toolRegistry?.has?.(runtimeName)) {
      tagToToolName.set(alias, runtimeName);
    }
  }

  for (const [tagName, name] of tagToToolName) {
    const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRegex = new RegExp(`<${escapedName}>\\s*([\\s\\S]*?)\\s*<\\/${escapedName}>`, 'gi');
    let match;

    while ((match = blockRegex.exec(text)) !== null) {
      const args = {};
      const argRegex = /<([A-Za-z_][\w-]*)>\s*([\s\S]*?)\s*<\/\1>/g;
      let argMatch;

      while ((argMatch = argRegex.exec(match[1])) !== null) {
        args[argMatch[1]] = argMatch[2].trim();
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name,
        arguments: normalizeLooseArgs(name, normalizeToolArgumentAliases(name, args)),
        source: 'named_tool_xml',
      });
    }
  }

  return toolCalls;
}
