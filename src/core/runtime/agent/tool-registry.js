/**
 * Tool Registry - manages all tool definitions and lookups
 */

export class ToolRegistry {
  /** @type {Map<string, object>} */
  #tools = new Map();
  /** @type {Map<string, Array<string>>} 校验错误缓存 —— 每个工具只报一次 */
  #reportedSchemaIssues = new Map();

  /** @param {object} tool */
  register(tool) {
    // 基本字段校验：name 和 call/handler 二选一
    if (!tool || typeof tool !== 'object') {
      throw new Error('ToolRegistry.register: tool 必须是一个对象');
    }
    if (typeof tool.name !== 'string' || tool.name.length === 0) {
      throw new Error('ToolRegistry.register: tool.name 必须是非空字符串');
    }
    if (!tool.call && !tool.handler) {
      throw new Error(`Tool "${tool.name}" 必须定义 call 或 handler 方法`);
    }
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    // 规范化 parameters：允许 `params` 或 `parameters.properties` 两种格式
    // —— 这里只做结构记录，不强校验，因为上游工具风格多样
    const toolParams = tool.params || (tool.parameters && tool.parameters.properties ? tool.parameters.properties : {});
    const toolRequired = tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []);

    // 统一存储为：schema.normalizedProperties + schema.required
    const normalizedTool = {
      ...tool,
      _schema: {
        properties: toolParams,
        required: toolRequired,
      },
    };

    this.#tools.set(tool.name, normalizedTool);
  }

  /** @param {string} name @returns {object|undefined} */
  get(name) {
    return this.#tools.get(name);
  }

  /** @returns {object[]} */
  getAll() {
    return Array.from(this.#tools.values());
  }

  /** @param {string[]} names @returns {object[]} */
  getByName(names) {
    return names.map(name => this.#tools.get(name)).filter(Boolean);
  }

  /** @param {string} category @returns {object[]} */
  getByCategory(category) {
    return this.getAll().filter(t => t.category === category);
  }

  /**
   * 对工具调用参数做轻量类型校验 + 强制转换。
   * 返回 { valid, errors, coercedArgs } —— 调用方决定如何处理错误。
   *
   * 设计原则：非阻断。参数类型错误时尽量 coerce，失败时返回 errors 让调用方决定。
   *
   * @param {string} toolName
   * @param {object} args
   * @returns {{ valid: boolean, errors: string[], coercedArgs: object }}
   */
  validateAndCoerceArgs(toolName, args) {
    const tool = this.#tools.get(toolName);
    const errors = [];
    const coerced = { ...(args || {}) };

    if (!tool) {
      return { valid: false, errors: [`Tool "${toolName}" not found`], coercedArgs: coerced };
    }

    const schema = tool._schema || { properties: {}, required: [] };
    const props = schema.properties || {};
    const required = schema.required || [];

    // 1) required 检查
    for (const key of required) {
      if (coerced[key] === undefined || coerced[key] === null || coerced[key] === '') {
        errors.push(`缺少必填参数: ${key}`);
      }
    }

    // 2) 类型检查 + coerce
    for (const [key, param] of Object.entries(props)) {
      if (param === null || typeof param !== 'object') continue;
      const value = coerced[key];
      if (value === undefined || value === null) continue;

      const expectedType = param.type;
      const isArray = Array.isArray(value);

      switch (expectedType) {
        case 'string':
          if (typeof value !== 'string') {
            coerced[key] = String(value);
          }
          break;
        case 'integer':
        case 'number': {
          const n = Number(value);
          if (Number.isNaN(n)) {
            errors.push(`${key} 应为 ${expectedType}，但收到: ${JSON.stringify(value)}`);
          } else if (expectedType === 'integer' && !Number.isInteger(n)) {
            errors.push(`${key} 应为 integer，但收到: ${JSON.stringify(value)}`);
          } else {
            coerced[key] = n;
          }
          break;
        }
        case 'boolean':
          if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === 'true' || lower === '1') {
              coerced[key] = true;
            } else if (lower === 'false' || lower === '0') {
              coerced[key] = false;
            } else {
              errors.push(`${key} 应为 boolean，但收到: ${JSON.stringify(value)}`);
            }
          } else if (typeof value !== 'boolean') {
            errors.push(`${key} 应为 boolean，但收到类型: ${typeof value}`);
          }
          break;
        case 'array':
          if (!isArray) {
            if (typeof value === 'string') {
              // 容忍: "a,b,c" 转为数组
              coerced[key] = value.split(',').map(s => s.trim()).filter(Boolean);
            } else {
              errors.push(`${key} 应为 array，但收到: ${typeof value}`);
            }
          }
          break;
        case 'object':
          if (typeof value !== 'object' || isArray) {
            errors.push(`${key} 应为 object`);
          }
          break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      coercedArgs: coerced,
    };
  }

  /** Convert selected tools to OpenAI function calling format */
  toFunctionDefinitions(tools = this.getAll()) {
    return tools
      .map(tool => typeof tool === 'string' ? this.get(tool) : tool)
      .filter(Boolean)
      .map(tool => this.#toFunctionDefinition(tool));
  }

  #toFunctionDefinition(tool) {
    // Support both `params` (skill tools) and `parameters` (scheduler tools) formats
    const toolParams = tool.params || (tool.parameters && tool.parameters.properties ? tool.parameters.properties : {});
    const toolRequired = tool.required || (tool.parameters && tool.parameters.required ? tool.parameters.required : []);
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(toolParams).map(([key, param]) => {
            /** @type {Record<string, unknown>} */
            const entry = {
              type: param.type,
              description: param.description,
            };
            if (param.enum) {entry.enum = param.enum;}
            if (param.items) {entry.items = { type: param.items.type, description: param.items.description };}
            if (param.default !== undefined) {entry.default = param.default;}
            return [key, entry];
          })
        ),
        required: toolRequired,
      },
    };
  }

  /** Get tool names grouped by category for display */
  getToolSummary() {
    /** @type {Record<string, string[]>} */
    const summary = {};
    for (const tool of this.getAll()) {
      const cat = tool.category;
      if (!summary[cat]) {summary[cat] = [];}
      summary[cat].push(tool.name);
    }
    return summary;
  }

  /** @param {string} name @returns {boolean} */
  has(name) {
    return this.#tools.has(name);
  }

  get size() {
    return this.#tools.size;
  }

  /**
   * Execute a tool by name with given arguments
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @param {object} context - Execution context
   * @returns {Promise<any>} - Tool execution result
   */
  async execute(name, args = {}, context = {}) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    if (!tool.handler || typeof tool.handler !== 'function') {
      throw new Error(`Tool "${name}" has no handler function`);
    }
    return await tool.handler(args, context);
  }
}
