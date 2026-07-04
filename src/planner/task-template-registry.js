/**
 * 任务模板注册表 — 可扩展的任务模板管理
 *
 * 参考 oh-my-pi 的设计理念：
 * - 模板通过 register() 注册，而非硬编码在大对象中
 * - 技能/方法论可以自带模板，初始化时自注册
 * - 支持按 phase / priority / methodology 过滤
 */

export class TaskTemplateRegistry {
  #templates = new Map();

  constructor(initialTemplates = []) {
    for (const tpl of initialTemplates) {
      this.register(tpl);
    }
  }

  /**
   * 注册一个任务模板
   * @param {object} template
   * @returns {TaskTemplateRegistry} this
   */
  register(template) {
    if (!template || typeof template !== 'object') {
      throw new Error('TaskTemplateRegistry.register: template 必须是对象');
    }
    if (typeof template.id !== 'string' || template.id.length === 0) {
      throw new Error('TaskTemplateRegistry.register: template.id 必须是非空字符串');
    }
    if (this.#templates.has(template.id)) {
      throw new Error(`Task template "${template.id}" is already registered`);
    }
    // 规范化：确保必填字段有默认值
    const normalized = {
      id: template.id,
      semanticName: template.semanticName || template.id,
      phase: template.phase || 'implementation',
      priority: template.priority ?? 50,
      allowedTools: template.allowedTools || [],
      requiredToolIntents: template.requiredToolIntents || [],
      completionPredicate: template.completionPredicate || null,
      description: template.description || '',
      methodologyHint: template.methodologyHint || null,
      ...template,
    };
    this.#templates.set(template.id, normalized);
    return this;
  }

  /**
   * 批量注册模板
   * @param {Array<object>} templates
   * @returns {TaskTemplateRegistry} this
   */
  registerAll(templates) {
    for (const tpl of templates) {
      this.register(tpl);
    }
    return this;
  }

  /**
   * 注销模板
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    return this.#templates.delete(id);
  }

  /**
   * 获取模板
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    return this.#templates.get(id);
  }

  /**
   * 检查模板是否存在
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.#templates.has(id);
  }

  /**
   * 获取所有模板
   * @returns {Array<object>}
   */
  getAll() {
    return Array.from(this.#templates.values());
  }

  /**
   * 按阶段过滤
   * @param {string} phase
   * @returns {Array<object>}
   */
  getByPhase(phase) {
    return this.getAll().filter((t) => t.phase === phase);
  }

  /**
   * 按方法论过滤
   * @param {string} hint
   * @returns {Array<object>}
   */
  getByMethodology(hint) {
    return this.getAll().filter((t) => t.methodologyHint === hint);
  }

  /**
   * 按优先级排序返回（高优先级在前）
   * @returns {Array<object>}
   */
  getSortedByPriority() {
    return this.getAll().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 模糊查找：按 id 或 semanticName 匹配
   * @param {string} query
   * @returns {object|null}
   */
  find(query) {
    if (!query) return null;
    const q = query.toLowerCase().trim();
    // 精确匹配 id
    if (this.#templates.has(q)) return this.#templates.get(q);
    // 精确匹配 semanticName
    for (const tpl of this.#templates.values()) {
      if (tpl.semanticName && tpl.semanticName.toLowerCase() === q) return tpl;
    }
    // 模糊匹配 id
    for (const tpl of this.#templates.values()) {
      if (tpl.id.toLowerCase().includes(q)) return tpl;
    }
    // 模糊匹配 semanticName
    for (const tpl of this.#templates.values()) {
      if (tpl.semanticName && tpl.semanticName.toLowerCase().includes(q)) return tpl;
    }
    return null;
  }

  /** 模板数量 */
  get size() {
    return this.#templates.size;
  }
}
