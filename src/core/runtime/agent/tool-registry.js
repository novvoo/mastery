/**
 * Tool Registry - manages all tool definitions and lookups
 *
 * 设计原则（参考 oh-my-pi）：
 * - 单一入口注册，统一格式校验
 * - 参数别名由工具自身声明，而非注册表硬编码
 * - 执行链路通过中间件扩展，而非多层包装
 */

import { normalizeToolResult } from './tool-result.js';
import { normalizeTool } from './tool-definition.js';

export class ToolRegistry {
  /** @type {Map<string, object>} */
  #tools = new Map();
  /** @type {Map<string, Array<string>>} 校验错误缓存 —— 每个工具只报一次 */
  #reportedSchemaIssues = new Map();
  /** @type {Array<Function>} 执行中间件 */
  #middleware = [];

  /** @param {object} tool */
  register(tool) {
    if (!tool || typeof tool !== 'object') {
      throw new Error('ToolRegistry.register: tool 必须是一个对象');
    }
    if (typeof tool.name !== 'string' || tool.name.length === 0) {
      throw new Error('ToolRegistry.register: tool.name 必须是非空字符串');
    }
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    // 统一规范化为标准格式
    const normalized = normalizeTool(tool);
    this.#tools.set(normalized.name, normalized);
  }

  /**
   * 批量注册工具
   * @param {Array<object>} tools
   * @returns {ToolRegistry} this
   */
  registerMany(tools) {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  /**
   * 注销工具
   * @param {string} name
   * @returns {boolean} 是否成功注销
   */
  unregister(name) {
    const existed = this.#tools.has(name);
    this.#tools.delete(name);
    this.#reportedSchemaIssues.delete(name);
    return existed;
  }

  /**
   * 注册执行中间件。中间件按注册顺序执行。
   * 签名: async (context, next) => result
   *   context = { toolName, args, handler, tool }
   *   next = async () => handlerResult
   *
   * 参考 oh-my-pi 的工具边界归一化设计：
   * 日志、审计、限流、缓存等都通过中间件实现。
   */
  use(middleware) {
    this.#middleware.push(middleware);
    return this;
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
    return names.map((name) => this.#tools.get(name)).filter(Boolean);
  }

  /** @param {string} category @returns {object[]} */
  getByCategory(category) {
    return this.getAll().filter((t) => t.category === category);
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

    const schema = tool.parameters || { properties: {}, required: [] };
    const props = schema.properties || {};
    const required = schema.required || [];

    // 参数别名映射：从工具定义中读取（工具自己声明自己的别名）
    const toolAliases = tool.paramAliases || {};
    for (const [alias, canonical] of Object.entries(toolAliases)) {
      if (coerced[alias] !== undefined && coerced[canonical] === undefined) {
        coerced[canonical] = coerced[alias];
        delete coerced[alias];
      }
    }

    // 1) required 检查（allowEmpty: true 的字段允许空字符串，如 edit_file 的 new_text 用于删除）
    for (const key of required) {
      const param = props[key];
      const allowEmpty = param && param.allowEmpty;
      if (
        coerced[key] === undefined ||
        coerced[key] === null ||
        (coerced[key] === '' && !allowEmpty)
      ) {
        errors.push(`缺少必填参数: ${key}`);
      }
    }

    // 2) 类型检查 + coerce
    for (const [key, param] of Object.entries(props)) {
      if (param === null || typeof param !== 'object') {
        continue;
      }
      const value = coerced[key];
      if (value === undefined || value === null) {
        continue;
      }

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
              coerced[key] = value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
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
      // 返回 schema 信息供错误消息使用
      schema: { properties: props, required },
      originalArgs: args,
    };
  }

  /** Convert selected tools to OpenAI function calling format */
  toFunctionDefinitions(tools = this.getAll()) {
    return tools
      .map((tool) => (typeof tool === 'string' ? this.get(tool) : tool))
      .filter(Boolean)
      .map((tool) => this.#toFunctionDefinition(tool));
  }

  #toFunctionDefinition(tool) {
    const params = tool.parameters || { type: 'object', properties: {}, required: [] };
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(params.properties || {}).map(([key, param]) => {
            /** @type {Record<string, unknown>} */
            const entry = {
              type: param.type,
              description: param.description,
            };
            if (param.enum) entry.enum = param.enum;
            if (param.items)
              entry.items = { type: param.items.type, description: param.items.description };
            if (param.default !== undefined) entry.default = param.default;
            return [key, entry];
          }),
        ),
        required: params.required || [],
      },
    };
  }

  /** Get tool names grouped by category for display */
  getToolSummary() {
    /** @type {Record<string, string[]>} */
    const summary = {};
    for (const tool of this.getAll()) {
      const cat = tool.category;
      if (!summary[cat]) {
        summary[cat] = [];
      }
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
    const meta = await this.executeWithMeta(name, args, context);
    if (!meta.success && meta.thrown) {
      throw meta.errorObject;
    }
    return meta.result;
  }

  /**
   * Execute a tool and return structured execution metadata.
   * 执行经过中间件链，中间件可以修改 args、拦截调用、记录日志等。
   */
  async executeWithMeta(name, args = {}, context = {}) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }
    if (!tool.handler || typeof tool.handler !== 'function') {
      throw new Error(`Tool "${name}" has no handler function`);
    }

    const startedAt = Date.now();
    const middleware = this.#middleware;

    // 构建中间件调用链
    let index = 0;
    const runNext = async () => {
      if (index < middleware.length) {
        const m = middleware[index++];
        return m({ toolName: name, args, tool, context, registry: this }, runNext);
      }
      return tool.handler(args, context);
    };

    try {
      const result = await runNext();
      return {
        toolName: name,
        args,
        durationMs: Date.now() - startedAt,
        ...normalizeToolResult(result),
      };
    } catch (error) {
      const result = `Error: ${error instanceof Error ? error.message : String(error)}`;
      return {
        toolName: name,
        args,
        durationMs: Date.now() - startedAt,
        ...normalizeToolResult(error),
        result,
        thrown: true,
        errorObject: error,
      };
    }
  }
}
