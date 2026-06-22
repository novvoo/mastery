/**
 * ProjectRules — 分层规则系统（品牌中立）
 *
 * 从工作目录向上递归查找 .agent-rules/instructions.md，
 * 合并为统一的项目规则上下文，注入 system prompt。
 *
 * 目录结构：
 *   ~/.agent-rules/instructions.md     ← 全局用户规则
 *   /project/.agent-rules/instructions.md  ← 项目级规则
 *   /project/src/.agent-rules/instructions.md ← 子目录规则
 *
 * 每个 instructions.md 支持 @import 指令：
 *   @import architecture.md
 *   @import ../shared/rules/conventions.md
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, isAbsolute, relative, parse } from 'path';
import { homedir } from 'os';

const RULES_DIR = '.agent-rules';
const INSTRUCTIONS_FILE = 'instructions.md';
const MAX_RULES_DEPTH = 20;       // 最多向上查找 20 层
const MAX_IMPORT_DEPTH = 5;       // @import 嵌套深度
const MAX_RULES_SIZE = 200 * 1024; // 单文件最大 200KB

export class ProjectRules {
  #workingDir;
  #rules = [];           // { level: 'global'|'project'|'local', path, content }

  constructor(workingDir) {
    this.#workingDir = resolve(workingDir || process.cwd());
  }

  /**
   * 加载所有层级规则。
   * @param {{ subdirs?: string[] }} opts - subdirs 传入要检查的子目录
   * @returns {this}
   */
  load(opts = {}) {
    this.#rules = [];
    const visited = new Set();

    // 1. 加载全局规则（从用户 home 目录）
    this.#loadGlobal(visited);

    // 2. 从工作目录向上递归查找项目级规则
    this.#loadUpward(this.#workingDir, visited);

    // 3. 加载指定子目录的本地规则
    if (opts.subdirs && Array.isArray(opts.subdirs)) {
      for (const sub of opts.subdirs) {
        const subPath = resolve(this.#workingDir, sub);
        if (subPath.startsWith(this.#workingDir) && !visited.has(subPath)) {
          this.#loadSingle(subPath, 'local', visited);
        }
      }
    }

    return this;
  }

  /**
   * 生成合并后的规则 prompt fragment。
   * @returns {string}
   */
  toPromptFragment() {
    if (this.#rules.length === 0) { return ''; }

    const parts = ['## Project Rules & Conventions'];

    // 按层级分组显示
    const grouped = {
      global: [],
      project: [],
      local: [],
    };

    for (const rule of this.#rules) {
      const label = this.#formatRuleLabel(rule);
      grouped[rule.level].push(label);
    }

    if (grouped.global.length > 0) {
      parts.push('');
      parts.push('### Global Rules');
      for (const r of grouped.global) { parts.push(r); }
    }

    if (grouped.project.length > 0) {
      parts.push('');
      parts.push('### Project Rules');
      for (const r of grouped.project) { parts.push(r); }
    }

    if (grouped.local.length > 0) {
      parts.push('');
      parts.push('### Local Rules (subdirectory)');
      for (const r of grouped.local) { parts.push(r); }
    }

    return parts.join('\n');
  }

  /**
   * 获取子目录对应的规则路径（用于懒加载提示）。
   * @param {string} subdir
   * @returns {string|null}
   */
  getSubdirRulesPath(subdir) {
    const rulesDir = join(this.#workingDir, subdir, RULES_DIR);
    const filePath = join(rulesDir, INSTRUCTIONS_FILE);
    return existsSync(filePath) ? filePath : null;
  }

  /**
   * 检查是否存在任何规则文件。
   * @returns {boolean}
   */
  hasRules() {
    return this.#rules.length > 0;
  }

  /**
   * 返回已加载的规则列表（只读）。
   * @returns {Array<{level:string, path:string}>}
   */
  getLoadedRules() {
    return this.#rules.map(r => ({ level: r.level, path: r.path }));
  }

  /**
   * 路径作用域懒加载：从 cwd 向上查找未加载的规则目录。
   * 只加载新发现的规则，不重复加载已有的。
   *
   * @param {string} cwd - 当前工作路径
   * @returns {this}
   */
  loadForPath(cwd) {
    const resolvedCwd = resolve(cwd);
    const loadedPaths = new Set(this.#rules.map(r => dirname(r.path)));

    // 从 cwd 向上查找
    let current = resolvedCwd;
    let depth = 0;

    while (current && current !== '/' && depth < MAX_RULES_DEPTH) {
      const rulesDir = join(current, RULES_DIR);
      if (existsSync(rulesDir) && !loadedPaths.has(rulesDir)) {
        const level = this.#determineLevel(current);
        this.#loadSingle(rulesDir, level, loadedPaths);
        loadedPaths.add(rulesDir);
      }

      // 如果已经到达项目根（已加载的规则目录），停止
      if (loadedPaths.has(join(current, RULES_DIR)) && current !== resolvedCwd) {
        // 继续向上但只查未加载的
      }

      const parent = dirname(current);
      if (parent === current) { break; }
      current = parent;
      depth++;
    }

    return this;
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────

  /**
   * 判断路径的规则级别。
   */
  #determineLevel(path) {
    if (resolve(path) === resolve(this.#workingDir)) { return 'project'; }
    return 'local';
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────

  /**
   * 加载全局规则（~/.agent-rules/instructions.md）
   */
  #loadGlobal(visited) {
    const globalPath = join(homedir(), RULES_DIR, INSTRUCTIONS_FILE);
    if (existsSync(globalPath) && !visited.has(dirname(globalPath))) {
      this.#loadSingle(dirname(globalPath), 'global', visited);
    }
  }

  /**
   * 从 givenPath 向上递归查找规则目录
   */
  #loadUpward(currentPath, visited) {
    let depth = 0;
    let path = resolve(currentPath);

    while (path && path !== '/' && depth < MAX_RULES_DEPTH) {
      const rulesDir = join(path, RULES_DIR);
      if (existsSync(rulesDir) && !visited.has(rulesDir)) {
        const level = path === this.#workingDir ? 'project' : 'local';
        this.#loadSingle(rulesDir, level, visited);
      }
      const parent = dirname(path);
      if (parent === path) { break; }
      path = parent;
      depth++;
    }
  }

  /**
   * 加载单个规则目录，处理 @import。
   */
  #loadSingle(rulesDir, level, visited) {
    visited.add(rulesDir);
    const mainFile = join(rulesDir, INSTRUCTIONS_FILE);

    if (!existsSync(mainFile)) { return; }

    try {
      const stat = statSync(mainFile);
      if (stat.size > MAX_RULES_SIZE) {
        console.warn(`ProjectRules: ${mainFile} exceeds max size (${MAX_RULES_SIZE} bytes), skipping`);
        return;
      }

      let content = readFileSync(mainFile, 'utf-8');
      content = this.#resolveImports(content, rulesDir, visited, 0);

      if (content.trim()) {
        this.#rules.push({ level, path: mainFile, content });
      }
    } catch (e) {
      console.warn(`ProjectRules: failed to load ${mainFile}: ${e.message}`);
    }
  }

  /**
   * 解析 @import 指令，递归内联引用文件内容。
   * 格式：@import path/to/file.md（每行一个）
   */
  #resolveImports(content, baseDir, visited, depth) {
    if (depth >= MAX_IMPORT_DEPTH) { return content; }

    const lines = content.split('\n');
    const result = [];

    for (const line of lines) {
      const match = line.match(/^@import\s+(.+)$/);
      if (!match) {
        result.push(line);
        continue;
      }

      const importRef = match[1].trim();
      const resolvedPath = this.#resolveImportPath(importRef, baseDir);

      if (!resolvedPath || !existsSync(resolvedPath)) {
        console.warn(`ProjectRules: @import "${importRef}" not found (from ${baseDir})`);
        result.push(`<!-- @import ${importRef}: file not found -->`);
        continue;
      }

      if (visited.has(resolvedPath)) {
        console.warn(`ProjectRules: circular @import detected: ${resolvedPath}`);
        result.push(`<!-- @import ${importRef}: circular reference skipped -->`);
        continue;
      }

      try {
        const stat = statSync(resolvedPath);
        if (stat.size > MAX_RULES_SIZE) {
          console.warn(`ProjectRules: imported file ${resolvedPath} exceeds max size`);
          continue;
        }

        visited.add(resolvedPath);
        let importedContent = readFileSync(resolvedPath, 'utf-8');
        importedContent = this.#resolveImports(importedContent, dirname(resolvedPath), visited, depth + 1);

        result.push(`<!-- imported from ${importRef} -->`);
        result.push(importedContent);
      } catch (e) {
        console.warn(`ProjectRules: failed to import ${importRef}: ${e.message}`);
      }
    }

    return result.join('\n');
  }

  /**
   * 解析 @import 路径。
   * - 相对路径：相对于 rulesDir
   * - 以 / 开头：绝对路径
   * - 以 ~/ 开头：home 目录
   * - 纯文件名：在 rulesDir 内查找
   */
  #resolveImportPath(importRef, baseDir) {
    if (importRef.startsWith('~/')) {
      return join(homedir(), importRef.slice(2));
    }
    if (importRef.startsWith('/')) {
      return importRef;
    }
    // 相对路径
    const resolved = resolve(baseDir, importRef);
    // 安全检查：不允许跳出 rules 目录到项目根之外太远
    // 但允许引用项目根的其他 rules 目录
    return resolved;
  }

  /**
   * 格式化单条规则为 prompt 片段。
   */
  #formatRuleLabel(rule) {
    const relPath = relative(this.#workingDir, rule.path);
    const displayPath = relPath.startsWith('..') ? rule.path : `./${relPath}`;
    return `[${displayPath}]\n${rule.content}`;
  }
}

export default ProjectRules;
