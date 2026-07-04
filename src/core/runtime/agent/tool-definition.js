/**
 * 统一的工具定义工厂。
 *
 * 参考 oh-my-pi 的设计理念：所有工具通过单一入口 defineTool 创建，
 * 确保格式一致、元数据完整、可测试性强。
 *
 * Usage:
 *   const myTool = defineTool({
 *     name: 'my_tool',
 *     description: 'What it does',
 *     category: 'filesystem',
 *     parameters: {
 *       type: 'object',
 *       properties: { path: { type: 'string', description: 'File path' } },
 *       required: ['path'],
 *     },
 *     paramAliases: { file_path: 'path' },
 *     handler: async (args, context) => { ... },
 *   });
 */

export function defineTool(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('defineTool: config 必须是一个对象');
  }
  if (typeof config.name !== 'string' || config.name.length === 0) {
    throw new Error('defineTool: name 必须是非空字符串');
  }
  if (typeof config.handler !== 'function') {
    throw new Error(`defineTool: "${config.name}" 必须定义 handler 函数`);
  }

  const parameters = normalizeParameters(config.parameters);
  const description = config.description || '';
  const category = config.category || 'general';
  const paramAliases = config.paramAliases || {};

  // 规范化后的工具对象 — 单一真实来源
  const tool = {
    name: config.name,
    description,
    category,
    parameters,
    paramAliases,
    handler: config.handler,
    // 兼容字段：旧版代码可能读 .params / .required / .call
    get params() {
      return parameters.properties || {};
    },
    get required() {
      return parameters.required || [];
    },
    get call() {
      return this.handler;
    },
    // 兼容 _schema（旧版 tool-registry 内部字段，测试依赖它）
    _schema: {
      properties: parameters.properties || {},
      required: parameters.required || [],
    },
    // 元数据
    _definition: { ...config, parameters },
  };

  return tool;
}

function normalizeParameters(params) {
  if (!params) {
    return { type: 'object', properties: {}, required: [] };
  }
  // 已经是完整 OpenAI 格式：{ type: 'object', properties: {}, required: [] }
  if (params.type === 'object' && params.properties) {
    return {
      type: 'object',
      properties: params.properties || {},
      required: params.required || [],
    };
  }
  // 半完整格式：有 properties 和 required，但没有 type
  if (params.properties && typeof params.properties === 'object') {
    return {
      type: 'object',
      properties: params.properties,
      required: params.required || [],
    };
  }
  // 旧版简写格式：直接是 properties 对象（键是参数名，值是参数定义）
  if (typeof params === 'object') {
    return { type: 'object', properties: params, required: [] };
  }
  return { type: 'object', properties: {}, required: [] };
}

/**
 * 批量定义工具，返回工具数组。
 * @param {Array<object>} configs
 * @returns {Array<object>}
 */
export function defineTools(configs) {
  return configs.map(defineTool);
}

/**
 * 将旧版格式的工具（可能用 params/call）迁移为标准格式。
 * 非破坏性：返回新对象，不修改原对象。
 * @param {object} legacyTool
 * @returns {object}
 */
export function normalizeTool(legacyTool) {
  if (!legacyTool) return legacyTool;
  // 已经是 defineTool 创建的，直接返回
  if (legacyTool._definition) return legacyTool;

  const handler = legacyTool.handler || legacyTool.call;
  if (!handler) {
    throw new Error(`Tool "${legacyTool.name || '(unnamed)'}" 必须定义 handler 或 call 方法`);
  }

  const parameters = legacyTool.parameters || {
    type: 'object',
    properties: legacyTool.params || {},
    required: legacyTool.required || [],
  };

  return defineTool({
    name: legacyTool.name,
    description: legacyTool.description || '',
    category: legacyTool.category || 'general',
    parameters,
    paramAliases: legacyTool.paramAliases || {},
    handler,
  });
}
