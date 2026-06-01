/**
 * Text Tool Parser
 * 为不支持 function calling 的语言类 LLM 提供鲁棒的工具调用解析
 * 
 * 支持多种格式：
 * 1. CALL tool_name({"param": "value"})
 * 2. ```tool\n{"name": "tool_name", "arguments": {...}}\n```
 * 3. <action>{"tool_name": {"param": "value"}}</action>
 * 4. {"action": {"tool_name": {"param": "value"}}}
 * 5. <tool>tool_name</tool><arg>value</arg>
 * 6. <tool_code>print(ls("path"))</tool_code> style code emitted by some models
 * 7. ```bash\ncommand\n``` shell code fences emitted by some models
 * 8. 自然语言描述（通过关键词匹配）
 */

export class TextToolParser {
  #toolRegistry;
  #fallbackPatterns;

  constructor(toolRegistry) {
    this.#toolRegistry = toolRegistry;
    this.#fallbackPatterns = this.#buildFallbackPatterns();
  }

  /**
   * 解析文本中的工具调用
   * @param {string} text - LLM 输出文本
   * @returns {Array<object>} 解析出的工具调用列表
   */
  parse(text) {
    if (!text || typeof text !== 'string') return [];

    const toolCalls = [];

    // 尝试多种解析策略
    toolCalls.push(...this.#parseCALLFormat(text));
    toolCalls.push(...this.#parseJSONBlockFormat(text));
    toolCalls.push(...this.#parseActionTagFormat(text));
    toolCalls.push(...this.#parseRawJSONActionFormat(text));
    toolCalls.push(...this.#parseEmbeddedJSONActionFormat(text));
    toolCalls.push(...this.#parseFunctionCallsFormat(text));
    toolCalls.push(...this.#parseFunctionCallTagFormat(text));
    toolCalls.push(...this.#parseToolCallTagFormat(text));
    toolCalls.push(...this.#parseXMLFormat(text));
    toolCalls.push(...this.#parseNamedToolXMLFormat(text));
    toolCalls.push(...this.#parseToolCodeFormat(text));
    toolCalls.push(...this.#parseShellCodeBlockFormat(text));
    if (toolCalls.length === 0) {
      toolCalls.push(...this.#parseNaturalLanguage(text));
    }

    // 去重
    return this.#deduplicate(toolCalls);
  }

  /**
   * 格式 1: CALL tool_name({"param": "value"})
   */
  #parseCALLFormat(text) {
    const toolCalls = [];
    // 支持多行和嵌套括号
    const callRegex = /CALL\s+\/?([A-Za-z_][\w-]*)\s*\((\{[\s\S]*?\})\)/g;
    let match;

    while ((match = callRegex.exec(text)) !== null) {
      const argsStr = match[2];
      
      try {
        const args = this.#safeJSONParse(argsStr);
        if (args) {
          const { name, args: normalizedArgs } = this.#normalizeJSONToolCall(match[1], args);
          if (this.#toolRegistry?.has && !this.#toolRegistry.has(name)) {
            continue;
          }
          toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            name,
            arguments: args && typeof args === 'object' && !Array.isArray(args) ? normalizedArgs : args,
            source: 'CALL_format',
          });
        }
      } catch (e) {
        console.debug(`Failed to parse CALL format: ${argsStr.substring(0, 50)}`);
      }
    }

    return toolCalls;
  }

  /**
   * 格式 2: ```tool\n{"name": "tool_name", "arguments": {...}}\n```
   */
  #parseJSONBlockFormat(text) {
    const toolCalls = [];
    const blockRegex = /```(?:tool)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/g;
    let match;

    while ((match = blockRegex.exec(text)) !== null) {
      try {
        const json = this.#safeJSONParse(match[1]);
        toolCalls.push(...this.#toolCallsFromJSON(json, 'JSON_block', toolCalls.length));
      } catch (e) {
        // 不是有效的工具调用 JSON
      }
    }

    return toolCalls;
  }

  #parseShellCodeBlockFormat(text) {
    if (!this.#toolRegistry?.has?.('shell')) {
      return [];
    }

    const toolCalls = [];
    const blockRegex = /```(?:bash|sh|zsh|shell|terminal|console)\s*\n([\s\S]*?)```/gi;
    let match;

    while ((match = blockRegex.exec(text)) !== null) {
      const command = match[1].trim();
      if (!command || command.startsWith('$')) {
        const normalized = command.replace(/^\$\s*/, '').trim();
        if (!normalized) {
          continue;
        }
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          name: 'shell',
          arguments: { command: normalized },
          source: 'shell_code_block',
        });
        continue;
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name: 'shell',
        arguments: { command },
        source: 'shell_code_block',
      });
    }

    return toolCalls;
  }
  
  /**
   * 格式 3: <action>{"tool_name": {"param": "value"}}</action>
   * Some models emit XML-wrapped JSON even when instructed to use CALL.
   */
  #parseActionTagFormat(text) {
    const toolCalls = [];
    const actionRegex = /<action>\s*([\s\S]*?)\s*<\/action>/gi;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      const json = this.#safeJSONParse(match[1].trim());
      toolCalls.push(...this.#toolCallsFromJSON(json, 'action_tag', toolCalls.length));
    }

    return toolCalls;
  }

  /**
   * 格式 4: {"action": {"tool_name": {"param": "value"}}}
   */
  #parseRawJSONActionFormat(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return [];
    }

    const parsedCalls = this.#toolCallsFromJSON(this.#safeJSONParse(trimmed), 'raw_JSON_action', 0);
    if (parsedCalls.length > 0) {
      return parsedCalls;
    }
    return this.#parseLooseRawJSONAction(trimmed);
  }

  #parseLooseRawJSONAction(text) {
    const actionMatch = text.match(/"action"\s*:\s*\{\s*"([^"]+)"\s*:\s*\{([\s\S]*)\}\s*\}\s*$/);
    if (!actionMatch) {
      return [];
    }

    const rawArgs = this.#parseLooseJSONStringObject(actionMatch[2]);
    const { name, args } = this.#normalizeJSONToolCall(actionMatch[1], rawArgs);
    if (!this.#toolRegistry?.has?.(name)) {
      return [];
    }

    return [{
      id: `call_${Date.now()}_0`,
      name,
      arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
      source: 'raw_JSON_action_loose',
    }];
  }

  #parseEmbeddedJSONActionFormat(text) {
    if (!text.includes('"action"') && !text.includes("'action'")) {
      return [];
    }
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return [];
    }

    const toolCalls = [];
    for (const candidate of this.#extractJSONObjectCandidates(text)) {
      const json = this.#safeJSONParse(candidate);
      toolCalls.push(...this.#toolCallsFromJSON(json, 'embedded_JSON_action', toolCalls.length));
    }
    return toolCalls;
  }

  #extractJSONObjectCandidates(text) {
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
        if (char === '{') depth++;
        if (char === '}') depth--;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
    return candidates;
  }

  #parseLooseJSONStringObject(body) {
    const args = {};
    let index = 0;
    const text = String(body || '');

    while (index < text.length) {
      const keyStart = text.indexOf('"', index);
      if (keyStart === -1) {
        break;
      }
      const keyEnd = this.#findJSONStringEnd(text, keyStart);
      if (keyEnd === -1) {
        break;
      }
      const key = this.#decodeStringLiteral(text.slice(keyStart + 1, keyEnd));
      const colon = text.indexOf(':', keyEnd + 1);
      if (colon === -1) {
        break;
      }
      let valueStart = colon + 1;
      while (/\s/.test(text[valueStart] || '')) {
        valueStart++;
      }

      if (text[valueStart] !== '"') {
        const valueEnd = this.#findLooseScalarEnd(text, valueStart);
        args[key] = text.slice(valueStart, valueEnd).trim();
        index = valueEnd + 1;
        continue;
      }

      const valueEnd = this.#findLooseStringEnd(text, valueStart);
      if (valueEnd === -1) {
        break;
      }
      args[key] = this.#decodeStringLiteral(text.slice(valueStart + 1, valueEnd));
      index = valueEnd + 1;
    }

    return args;
  }

  #findLooseStringEnd(text, start) {
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

  #findJSONStringEnd(text, start) {
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

  #findLooseScalarEnd(text, start) {
    let index = start;
    while (index < text.length && text[index] !== ',' && text[index] !== '}') {
      index++;
    }
    return index;
  }

  /**
   * 格式 5: <tool>tool_name</tool><arg>value</arg>
   */
  #parseXMLFormat(text) {
    const toolCalls = [];
    const toolRegex = /<tool>\/?([A-Za-z_][\w-]*)<\/tool>/g;
    let match;

    while ((match = toolRegex.exec(text)) !== null) {
      const name = this.#resolveToolName(match[1]);
      const args = {};
      
      // 提取参数
      const argRegex = new RegExp(`<arg(?:\s+name="([^"]+)")?>([^<]*)</arg>`, 'g');
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
   * 格式 6: <tool_call><name>tool</name><parameter>key</parameter><parameter>value</parameter></tool_call>
   */
  #parseToolCallTagFormat(text) {
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
        rawArgs = this.#safeJSONParse(argumentsMatch[1].trim()) || {};
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

      const { name, args } = this.#normalizeJSONToolCall(nameMatch[1], rawArgs);
      if (!this.#toolRegistry?.has?.(name)) {
        continue;
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name,
        arguments: this.#normalizeLooseArgs(name, args),
        source: 'tool_call_tag',
      });
    }

    return toolCalls;
  }

  #parseFunctionCallsFormat(text) {
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

      const { name, args } = this.#normalizeJSONToolCall(nameMatch[1], rawArgs);
      if (!this.#toolRegistry?.has?.(name)) {
        continue;
      }

      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name,
        arguments: this.#normalizeLooseArgs(name, args),
        source: 'function_calls',
      });
    }

    return toolCalls;
  }

  #parseFunctionCallTagFormat(text) {
    const toolCalls = [];
    const callRegex = /<function_call>\s*([\s\S]*?)\s*<\/function_call>/gi;
    let match;

    while ((match = callRegex.exec(text)) !== null) {
      const block = match[1];
      const nameMatch = block.match(/<(?:name|function|function_name)>\s*([^<]+?)\s*<\/(?:name|function|function_name)>/i);
      if (!nameMatch) {
        continue;
      }

      const { name } = this.#normalizeJSONToolCall(nameMatch[1], {});
      if (!this.#toolRegistry?.has?.(name)) {
        continue;
      }

      const rawArgs = this.#extractFunctionCallTagArgs(block);
      const normalized = this.#normalizeJSONToolCall(nameMatch[1], rawArgs);
      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name: normalized.name,
        arguments: this.#normalizeLooseArgs(normalized.name, normalized.args),
        source: 'function_call_tag',
      });
    }

    return toolCalls;
  }

  #extractFunctionCallTagArgs(block) {
    const parametersMatch = block.match(/<parameters>\s*([\s\S]*?)\s*<\/parameters>/i);
    const parameters = parametersMatch ? parametersMatch[1].trim() : block;
    const json = this.#safeJSONParse(parameters);
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

  #parseNamedToolXMLFormat(text) {
    const toolCalls = [];
    const tools = this.#toolRegistry ? this.#toolRegistry.getAll() : [];
    const tagToToolName = new Map();

    for (const tool of tools) {
      tagToToolName.set(tool.name, tool.name);
    }
    for (const [alias, runtimeName] of Object.entries(this.#namedXMLToolAliases())) {
      if (this.#toolRegistry?.has?.(runtimeName)) {
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
          arguments: this.#normalizeLooseArgs(name, this.#normalizeToolArgumentAliases(name, args)),
          source: 'named_tool_xml',
        });
      }
    }

    return toolCalls;
  }

  /**
   * 格式 6: <tool_code>print(ls("path"))</tool_code>
   * Some upstream prompts teach Python-like helper names. Translate the common
   * aliases into the runtime's registered tools so orchestration can continue.
   */
  #parseToolCodeFormat(text) {
    const toolCalls = [];
    const blocks = [];
    const blockRegex = /<tool_code>\s*([\s\S]*?)\s*<\/tool_code>/gi;
    let blockMatch;

    while ((blockMatch = blockRegex.exec(text)) !== null) {
      blocks.push(blockMatch[1]);
    }

    for (const block of blocks) {
      toolCalls.push(...this.#parsePythonToolCodeBlock(block, toolCalls.length));

      for (const call of this.#extractToolCodeCalls(block)) {
        const rawName = call.name;
        const mapped = this.#mapToolCodeName(rawName);
        if (!mapped || !this.#toolRegistry?.has?.(mapped)) {
          continue;
        }

        const parsedArgs = this.#parseToolCodeArgs(call.argsText);
        const args = this.#normalizeToolCodeArgs(mapped, parsedArgs);
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

  #parsePythonToolCodeBlock(block, startIndex = 0) {
    const text = String(block || '');
    if (!this.#toolRegistry?.has?.('list_dir')) {
      return [];
    }

    const walksWorkspace = /\bos\.walk\(\s*(['"])(.*?)\1\s*\)/.exec(text);
    const listsWorkspace = /\bos\.listdir\(\s*(['"])(.*?)\1\s*\)/.exec(text);
    const printsPaths = /print\s*\(\s*os\.path\.join\s*\(|print\s*\(\s*f\b|print\s*\(\s*path\b|print\s*\(\s*f\s*\)/.test(text);

    if ((walksWorkspace || listsWorkspace) && printsPaths) {
      return [{
        id: `call_${Date.now()}_${startIndex}`,
        name: 'list_dir',
        arguments: { path: walksWorkspace?.[2] || listsWorkspace?.[2] || '.' },
        source: 'tool_code_python',
      }];
    }

    return [];
  }

  #extractToolCodeCalls(block) {
    const calls = [];
    const names = ['ls', 'list', 'list_files', 'list_dir', 'list_directory', 'inspect_workspace', 'cat', 'read', 'read_file', 'write', 'write_file', 'shell', 'bash', 'run', 'run_command', 'web_search', 'search_web', 'browser_search', 'web_fetch', 'fetch_url', 'plan_solution'];
    const namePattern = new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g');
    let match;

    while ((match = namePattern.exec(block)) !== null) {
      const argsStart = namePattern.lastIndex;
      const argsEnd = this.#findMatchingParen(block, argsStart - 1);
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

  #findMatchingParen(text, openIndex) {
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
   * 格式 6: 自然语言关键词匹配（fallback）
   */
  #parseNaturalLanguage(text) {
    const toolCalls = [];
    const lowerText = text.toLowerCase();

    for (const pattern of this.#fallbackPatterns) {
      const match = lowerText.match(pattern.regex);
      if (match) {
        // 提取参数
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
   * 构建自然语言 fallback 模式
   */
  #buildFallbackPatterns() {
    const tools = this.#toolRegistry ? this.#toolRegistry.getAll() : [];
    const patterns = [];

    for (const tool of tools) {
      const name = tool.name.toLowerCase();
      const desc = (tool.description || '').toLowerCase();

      // 为每个工具构建关键词模式
      const keywords = [name];
      
      // 从描述中提取动词
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

      // 构建正则
      const keywordPattern = keywords.join('|');
      patterns.push({
        toolName: tool.name,
        regex: new RegExp(`\\b(${keywordPattern})\\b.*\\b(${name.replace(/_/g, '[_ ]')}|[${name.split('_').join('|')}])\\b`, 'i'),
        paramExtractor: (match, fullText) => this.#extractParamsFromContext(tool, fullText),
        required: tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []),
      });

      if (name === 'glob') {
        patterns.push({
          toolName: tool.name,
          regex: /\b(list|find|show|get|count)\b.*\b(javascript|js)\b.*\b(files?|目录|文件)\b/i,
          paramExtractor: (match, fullText) => this.#extractParamsFromContext(tool, fullText),
          required: tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []),
        });
      }
    }

    return patterns;
  }

  /**
   * 从上下文中提取参数
   */
  #extractParamsFromContext(tool, text) {
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

      // 尝试从文本中提取参数值
      const patterns = [
        new RegExp(`${paramName}[:=]\\s*["']?([^"'\\s,]+)["']?`, 'i'),
        new RegExp(`${paramName}\\s+is\\s+["']?([^"'\\n]+)["']?`, 'i'),
        new RegExp(`${paramName}\\s*\\(([^)]+)\\)`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          args[paramName] = this.#castParam(match[1].trim(), paramSchema.type);
          break;
        }
      }
    }

    return args;
  }

  /**
   * 类型转换
   */
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
        return value.split(/[,;]/).map(s => s.trim());
      }
    }
    return value;
  }

  #mapToolCodeName(rawName) {
    const name = String(rawName || '').replace(/^\//, '');
    const aliases = {
      ls: 'list_dir',
      list: 'list_dir',
      list_files: 'list_dir',
      list_dir: 'list_dir',
      list_directory: 'list_dir',
      inspect_workspace: 'list_dir',
      cat: 'read_file',
      read: 'read_file',
      read_file: 'read_file',
      write: 'write_file',
      write_file: 'write_file',
      shell: 'shell',
      bash: 'shell',
      run: 'shell',
      run_command: 'shell',
      execute_command: 'shell',
      run_in_terminal: 'shell',
      terminal: 'shell',
      exec: 'shell',
      search_web: 'web_search',
      browser_search: 'web_search',
      web_search: 'web_search',
      google: 'web_search',
      internet_search: 'web_search',
      fetch_url: 'web_fetch',
      browser_fetch: 'web_fetch',
      web_fetch: 'web_fetch',
      plan_solution: 'brainstorm',
    };
    return aliases[name] || this.#resolveToolName(name);
  }

  #namedXMLToolAliases() {
    return {
      list_files: 'list_dir',
      list_directory: 'list_dir',
      ls: 'list_dir',
      inspect_workspace: 'list_dir',
      read: 'read_file',
      cat: 'read_file',
      write: 'write_file',
      save_file: 'write_file',
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
  }

  #parseToolCodeArgs(argsText) {
    const args = { positional: [] };
    const text = String(argsText || '');
    const stringRegex = /(?:([A-Za-z_][\w]*)\s*=\s*)?(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
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
      const path = parsedArgs.path ?? parsedArgs.file ?? parsedArgs.file_path ?? parsedArgs.positional[0];
      return path ? { path } : null;
    }
    if (toolName === 'write_file') {
      const path = parsedArgs.path ?? parsedArgs.file ?? parsedArgs.file_path ?? parsedArgs.positional[0];
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
      const problem = parsedArgs.problem ?? parsedArgs.positional[0] ?? 'Plan the requested implementation before editing files.';
      return { problem };
    }
    return {};
  }

  /**
   * 安全的 JSON 解析
   */
  #safeJSONParse(str) {
    try {
      // 先尝试直接解析
      return JSON.parse(str);
    } catch {
      // 尝试修复常见 JSON 错误
      try {
        // 单引号转双引号
        const fixed = str
          .replace(/'/g, '"')
          .replace(/(\w+):/g, '"$1":')
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

    const browserActionCall = this.#browserActionCallFromJSON(json, source, startIndex);
    if (browserActionCall) {
      return [browserActionCall];
    }

    const directName = json.name || json.tool;
    if (directName) {
      const originalArgs = json.arguments || json.args || json.params || {};
      const { name, args } = this.#normalizeJSONToolCall(directName, originalArgs);
      if (!this.#toolRegistry?.has?.(name)) {
        return [];
      }
      return [{
        id: `call_${Date.now()}_${startIndex}`,
        name,
        arguments: args,
        source,
      }];
    }

    const action = json.action && typeof json.action === 'object' && !Array.isArray(json.action)
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

    return [{
      id: `call_${Date.now()}_${startIndex}`,
      name,
      arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
      source,
    }];
  }

  #browserActionCallFromJSON(json, source, startIndex) {
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
    const searchQuery = explicitQuery || this.#queryFromSearchURL(url) || this.#inferSearchQuery(json);

    if (searchQuery && this.#toolRegistry?.has?.('web_search') && this.#isSearchNavigation(url)) {
      return {
        id: `call_${Date.now()}_${startIndex}`,
        name: 'web_search',
        arguments: { query: searchQuery },
        source: `${source}_browser_action`,
      };
    }

    if (url && this.#toolRegistry?.has?.('web_fetch')) {
      return {
        id: `call_${Date.now()}_${startIndex}`,
        name: 'web_fetch',
        arguments: { url },
        source: `${source}_browser_action`,
      };
    }

    if (searchQuery && this.#toolRegistry?.has?.('web_search')) {
      return {
        id: `call_${Date.now()}_${startIndex}`,
        name: 'web_search',
        arguments: { query: searchQuery },
        source: `${source}_browser_action`,
      };
    }

    return null;
  }

  #isSearchNavigation(url) {
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

  #queryFromSearchURL(url) {
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

  #inferSearchQuery(json) {
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
    const quotedInput = text.match(/(?:输入|搜索|查询|查找|search(?:\s+for)?)[“"'']([^“”"'']+)[”"'']/i);
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
    const args = originalArgs && typeof originalArgs === 'object' && !Array.isArray(originalArgs)
      ? originalArgs
      : {};
    const name = String(rawName || '').replace(/^\//, '');
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
      return {
        name: 'shell',
        args: { command: `mkdir -p ${this.#shellQuote(path)}` },
      };
    }

    const resolvedName = aliases[snakeName] || this.#resolveToolName(name);
    if (resolvedName === 'shell' && !args.command && (args.cmd || args.path || args.commands || args.code || args.arg0 || args.value)) {
      return {
        name: resolvedName,
        args: { ...args, command: args.cmd || args.path || args.commands || args.code || args.arg0 || args.value },
      };
    }
    if (resolvedName === 'brainstorm') {
      return {
        name: resolvedName,
        args: { problem: args.problem || args.steps || args.plan || args.value || 'Plan the requested implementation before editing files.' },
      };
    }
    if (resolvedName === 'web_search') {
      return {
        name: resolvedName,
        args: {
          ...args,
          query: args.query || args.q || args.text || args.value || args.question,
        },
      };
    }
    if (resolvedName === 'web_fetch') {
      return {
        name: resolvedName,
        args: {
          ...args,
          url: args.url || args.href || args.link || args.value,
        },
      };
    }

    return { name: resolvedName, args: this.#normalizeToolArgumentAliases(resolvedName, args) };
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

  #normalizeToolArgumentAliases(toolName, args) {
    if ((toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file' || toolName === 'list_dir')
      && !args.path
      && (args.file_path || args.file || args.filename)) {
      return { ...args, path: args.file_path || args.file || args.filename };
    }
    return args;
  }

  #shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  /**
   * 去重
   */
  #deduplicate(toolCalls) {
    const seen = new Set();
    return toolCalls.filter(tc => {
      const key = `${tc.name}:${JSON.stringify(tc.arguments)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 生成工具使用提示
   * 用于指导语言类 LLM 如何调用工具
   */
  generateToolPrompt() {
    const tools = this.#toolRegistry ? this.#toolRegistry.getAll() : [];
    
    const lines = [
      'You have access to the following tools:',
      '',
      ...tools.map(t => {
        const params = Object.entries(t.parameters || {})
          .map(([k, v]) => `${k}: ${v.type}`)
          .join(', ');
        return `- ${t.name}(${params}): ${t.description}`;
      }),
      '',
      'To use a tool, output in one of these formats:',
      '1. CALL tool_name({"param": "value"})',
      '2. ```tool\n{"name": "tool_name", "arguments": {"param": "value"}}\n```',
      '3. <action>{"tool_name": {"param": "value"}}</action>',
      '4. {"action": {"tool_name": {"param": "value"}}}',
      '',
      'After receiving tool results, continue reasoning or output FINAL_ANSWER: followed by your final response.',
    ];

    return lines.join('\n');
  }
}

export default TextToolParser;
