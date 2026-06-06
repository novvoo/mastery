/**
 * Tool Registry - manages all tool definitions and lookups
 */

export class ToolRegistry {
  /** @type {Map<string, object>} */
  #tools = new Map();

  /** @param {object} tool */
  register(tool) {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.#tools.set(tool.name, tool);
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
