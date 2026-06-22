/**
 * ImportGraph / ExportGraph — 项目级导入导出依赖图
 *
 * 对标文档 P2 要求：
 *   ImportGraph：给定文件，找出所有被导入的模块（直接 + 传递）
 *   ExportGraph：给定文件，找出所有导出被哪些文件导入（直接 + 传递）
 *   ModuleResolver：结合 tsconfig paths、package exports、workspace packages 解析
 *   BarrelManager：管理 barrel 文件，自动更新 re-export
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, dirname, extname } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// ImportGraph — 为给定文件集合构建导入依赖图
// ─────────────────────────────────────────────────────────────────────────────

export class ImportGraph {
  /**
   * @param {object} opts
   * @param {string} opts.workingDirectory    项目根目录
   * @param {ModuleResolver} [opts.resolver]  模块解析器
   * @param {string[]} [opts.extensions]      搜索的扩展名列表
   */
  constructor(opts = {}) {
    this.workingDirectory = opts.workingDirectory || process.cwd();
    this._resolver = opts.resolver || null;
    this.extensions = opts.extensions || ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

    /** @type {Map<string, {imports: string[], exports: ExportInfo[], resolved: boolean}>} */
    this.graph = new Map();
  }

  /** 懒加载 ModuleResolver */
  get resolver() {
    if (!this._resolver) {
      const { ModuleResolver } = require('./module-resolver.js');
      this._resolver = new ModuleResolver({ workingDirectory: this.workingDirectory });
    }
    return this._resolver;
  }

  /**
   * 扫描文件集合，构建完整的导入导出映射。
   * @param {string[]} filePaths
   * @returns {Promise<Map<string, {imports: string[], exports: ExportInfo[]}>>}
   */
  async build(filePaths) {
    // 分批并行扫描
    const queue = [...new Set(filePaths)];
    const seen = new Set(queue);
    const batchSize = 20;

    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize);
      const results = await Promise.all(batch.map(fp => this._analyzeFile(fp)));
      for (const r of results) {
        if (!r) continue;
        this.graph.set(r.path, { imports: r.imports, exports: r.exports, resolved: true });
        // 将新发现的依赖加入队列
        for (const imp of r.imports) {
          if (!seen.has(imp)) {
            seen.add(imp);
            if (existsSync(imp)) queue.push(imp);
          }
        }
      }
    }

    return this.graph;
  }

  /**
   * 获取指定文件的直接导入。
   * @param {string} filePath
   * @returns {Promise<string[]>}
   */
  async getImports(filePath) {
    if (!this.graph.has(filePath) || !this.graph.get(filePath).resolved) {
      await this.build([filePath]);
    }
    const node = this.graph.get(filePath);
    return node ? node.imports : [];
  }

  /**
   * 获取指定文件的全部传递导入（递归）。
   * @param {string} filePath
   * @param {number} [maxDepth=5]
   * @returns {Promise<string[]>}
   */
  async getTransitiveImports(filePath, maxDepth = 5) {
    await this.build([filePath]);
    const visited = new Set();
    const queue = [filePath];
    const result = [];

    while (queue.length > 0 && result.length < maxDepth * 100) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.graph.get(current);
      if (!node) continue;

      for (const imp of node.imports) {
        if (!visited.has(imp)) {
          result.push(imp);
          queue.push(imp);
        }
      }
    }
    return [...new Set(result)];
  }

  /**
   * 查找导入了指定模块的所有文件。
   * @param {string} modulePath   被导入的模块路径
   * @param {string[]} scopeFiles  搜索范围
   * @returns {Promise<string[]>}
   */
  async getImporters(modulePath, scopeFiles = []) {
    if (scopeFiles.length > 0) {
      await this.build(scopeFiles);
    }
    const resolved = this.resolver.resolveModule(modulePath, this.workingDirectory);
    const importers = [];
    for (const [fp, node] of this.graph) {
      if (node.imports.some(imp =>
        imp === modulePath || imp === resolved || resolved && imp === resolved.replace(extname(imp), ''))) {
        importers.push(fp);
      }
    }
    return importers;
  }

  // ── 私有方法 ───────────────────────────────────────────────────────

  async _analyzeFile(filePath) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const imports = this._extractImports(content, filePath);
      const exports = this._extractExports(content, filePath);
      return { path: filePath, imports: await this._resolveImports(imports, filePath), exports };
    } catch {
      return null;
    }
  }

  _extractImports(content, sourcePath) {
    const imports = [];
    // ES import / require 语句
    const patterns = [
      // import ... from '...'
      /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g,
      // import('...')
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // require('...')
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // export ... from '...'
      /export\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g,
      // /// <reference path="..." />
      /\/\/\/\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        imports.push({ specifier: m[1], sourcePath, line: this._getLineOf(content, m.index) });
      }
    }
    return imports;
  }

  _extractExports(content, sourcePath) {
    const exports = [];
    // named export: export const/function/class/interface/type name
    const namedRe = /export\s+(?:const|let|var|function|class|interface|type|enum|abstract\s+class)\s+(\w+)/g;
    let m;
    while ((m = namedRe.exec(content)) !== null) {
      exports.push({
        type: 'named',
        name: m[1],
        sourcePath,
        line: this._getLineOf(content, m.index),
      });
    }
    // export { ... }
    const exportListRe = /export\s*{([^}]*)}/g;
    while ((m = exportListRe.exec(content)) !== null) {
      const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const item of items) {
        const name = item.split(/\s+as\s+/)[0].trim();
        exports.push({
          type: 'named',
          name,
          sourcePath,
          line: this._getLineOf(content, m.index),
        });
      }
    }
    // export default
    if (/export\s+default\s+/.test(content)) {
      exports.push({ type: 'default', name: 'default', sourcePath, line: 0 });
    }
    // export * from
    const reExportRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    while ((m = reExportRe.exec(content)) !== null) {
      exports.push({
        type: 're-export-all',
        name: '*',
        from: m[1],
        sourcePath,
        line: this._getLineOf(content, m.index),
      });
    }
    // export { x } from
    const reExportListRe = /export\s*{([^}]*)}\s*from\s+['"]([^'"]+)['"]/g;
    while ((m = reExportListRe.exec(content)) !== null) {
      const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const item of items) {
        const parts = item.split(/\s+as\s+/);
        const localName = parts[0].trim();
        const exportName = parts[1] ? parts[1].trim() : localName;
        exports.push({
          type: 're-export',
          name: exportName,
          from: m[2],
          localName,
          sourcePath,
          line: this._getLineOf(content, m.index),
        });
      }
    }
    return exports;
  }

  async _resolveImports(imports, sourcePath) {
    const resolved = [];
    for (const imp of imports) {
      const resolvedPath = this.resolver.resolveImport(imp.specifier, sourcePath);
      if (resolvedPath) {
        resolved.push(resolvedPath);
      }
    }
    return [...new Set(resolved)];
  }

  _getLineOf(content, index) {
    return content.substring(0, index).split('\n').length;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExportGraph
// ─────────────────────────────────────────────────────────────────────────────

export class ExportGraph {
  /**
   * @param {ImportGraph} importGraph
   */
  constructor(importGraph) {
    this.importGraph = importGraph;
  }

  /**
   * 查找导入了指定导出名/模块的所有文件。
   * @param {object} opts
   * @param {string} opts.exportName   导出名（可选）
   * @param {string} opts.modulePath   模块路径
   * @param {string[]} [opts.scopeFiles]
   * @returns {Promise<{importers: string[], reExports: ExportInfo[]}>}
   */
  async findExportUsage(opts = {}) {
    const { exportName, modulePath, scopeFiles = [] } = opts;
    const importers = await this.importGraph.getImporters(modulePath, scopeFiles);
    const node = this.importGraph.graph.get(modulePath);
    const reExports = node ? node.exports.filter(e => e.name === exportName || (exportName === undefined && e.name === '*')) : [];
    return { importers, reExports };
  }
}

/**
 * @typedef {Object} ExportInfo
 * @property {string} type         'named' | 'default' | 're-export' | 're-export-all'
 * @property {string} name         导出名称
 * @property {string} [from]       re-export 的来源模块
 * @property {string} [localName]  re-export 中的本地名
 * @property {string} sourcePath   源文件路径
 * @property {number} line         行号
 */
