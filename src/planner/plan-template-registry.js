/**
 * PlanTemplateRegistry — 计划模板注册表
 *
 * 参考 oh-my-pi 的设计理念：
 * - 模板通过 register() 注册，而非硬编码在大对象中
 * - 技能/方法论可以自带模板，初始化时自注册
 * - 支持按 type / riskLevel / phase 过滤
 * - 完全向后兼容旧的 PLAN_TEMPLATES 结构
 *
 * 解决的问题：
 * - 之前 PLAN_TEMPLATES 是一个巨大的冻结对象，难以扩展
 * - 新增模板需要修改核心代码
 * - 技能/插件无法自带模板
 */

export class PlanTemplateRegistry {
  #templates = new Map();
  #typeAliases = new Map();

  constructor(initialTemplates = []) {
    for (const tpl of initialTemplates) {
      this.register(tpl);
    }
  }

  // ── 注册/注销 ──────────────────────────────────────────────────────────

  /**
   * 注册一个计划模板
   * @param {object} template - 计划模板对象
   * @param {string} template.id - 模板唯一 ID
   * @param {string} [template.label] - 显示名称
   * @param {string} [template.description] - 描述
   * @param {string[]} [template.phases] - 涉及的阶段
   * @param {string} [template.riskLevel] - 风险等级：low / medium / high
   * @param {Array} [template.tasks] - 任务定义数组
   * @param {string[]} [template.aliases] - 别名（用于 type 映射）
   * @returns {PlanTemplateRegistry} this
   */
  register(template) {
    if (!template || typeof template !== 'object') {
      throw new Error('PlanTemplateRegistry.register: template 必须是对象');
    }
    if (typeof template.id !== 'string' || template.id.length === 0) {
      throw new Error('PlanTemplateRegistry.register: template.id 必须是非空字符串');
    }
    if (this.#templates.has(template.id)) {
      throw new Error(`Plan template "${template.id}" is already registered`);
    }

    const normalized = this.#normalizeTemplate(template);
    this.#templates.set(template.id, normalized);

    // 注册别名
    if (normalized.aliases && normalized.aliases.length > 0) {
      for (const alias of normalized.aliases) {
        this.#typeAliases.set(alias.toLowerCase(), template.id);
      }
    }
    // id 本身也作为别名
    this.#typeAliases.set(template.id.toLowerCase(), template.id);

    return this;
  }

  /**
   * 批量注册模板
   * @param {Array<object>} templates
   * @returns {PlanTemplateRegistry} this
   */
  registerAll(templates) {
    for (const tpl of templates) {
      this.register(tpl);
    }
    return this;
  }

  /**
   * 注册类型别名
   * @param {string} alias - 别名（如 'coding', 'modification'）
   * @param {string} templateId - 目标模板 ID
   * @returns {PlanTemplateRegistry} this
   */
  registerAlias(alias, templateId) {
    if (!this.#templates.has(templateId)) {
      throw new Error(`PlanTemplateRegistry.registerAlias: template "${templateId}" not found`);
    }
    this.#typeAliases.set(alias.toLowerCase(), templateId);
    return this;
  }

  /**
   * 注销模板
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    if (!this.#templates.has(id)) return false;
    this.#templates.delete(id);
    // 清理相关别名
    for (const [alias, tid] of this.#typeAliases.entries()) {
      if (tid === id) {
        this.#typeAliases.delete(alias);
      }
    }
    return true;
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  /**
   * 按 ID 获取模板
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    return this.#templates.get(id);
  }

  /**
   * 按任务类型获取模板（支持别名）
   * @param {string} taskType
   * @param {string} [fallbackId='STANDARD'] - 找不到时的回退模板 ID
   * @returns {object}
   */
  getByTaskType(taskType, fallbackId = 'STANDARD') {
    const normalizedType = (taskType || '').toLowerCase();
    const templateId = this.#typeAliases.get(normalizedType);
    if (templateId && this.#templates.has(templateId)) {
      return this.#templates.get(templateId);
    }
    return this.#templates.get(fallbackId) || this.#templates.values().next().value;
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
   * 按风险等级过滤
   * @param {string} riskLevel - low / medium / high
   * @returns {Array<object>}
   */
  getByRiskLevel(riskLevel) {
    return this.getAll().filter((t) => t.riskLevel === riskLevel);
  }

  /**
   * 按阶段过滤（包含该阶段的模板）
   * @param {string} phase
   * @returns {Array<object>}
   */
  getByPhase(phase) {
    return this.getAll().filter((t) => t.phases && t.phases.includes(phase));
  }

  /**
   * 模糊查找
   * @param {string} query
   * @returns {object|null}
   */
  find(query) {
    if (!query) return null;
    const q = query.toLowerCase().trim();

    // 精确匹配 id
    if (this.#templates.has(q)) return this.#templates.get(q);

    // 精确匹配别名
    if (this.#typeAliases.has(q)) {
      const id = this.#typeAliases.get(q);
      return this.#templates.get(id) || null;
    }

    // 模糊匹配 id
    for (const tpl of this.#templates.values()) {
      if (tpl.id.toLowerCase().includes(q)) return tpl;
    }

    // 模糊匹配 label
    for (const tpl of this.#templates.values()) {
      if (tpl.label && tpl.label.toLowerCase().includes(q)) return tpl;
    }

    return null;
  }

  /** 模板数量 */
  get size() {
    return this.#templates.size;
  }

  /** 别名数量 */
  get aliasCount() {
    return this.#typeAliases.size;
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────

  /**
   * 规范化模板对象
   * @param {object} template
   * @returns {object}
   * @private
   */
  #normalizeTemplate(template) {
    return {
      id: template.id,
      label: template.label || template.id,
      description: template.description || '',
      phases: template.phases || [],
      riskLevel: template.riskLevel || 'medium',
      tasks: template.tasks || [],
      aliases: template.aliases || [],
      ...template,
    };
  }
}

/**
 * 默认全局计划模板注册表实例
 */
export const defaultPlanTemplateRegistry = new PlanTemplateRegistry();
