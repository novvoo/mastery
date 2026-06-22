/**
 * BarrelManager — Barrel 文件管理与自动 Re-export 更新
 *
 * 对标文档 P2 要求：
 *   自动发现和更新 index.ts barrel 文件
 *   追踪 re-export chain
 *   自动在添加/删除/重命名导出时更新对应 barrel
 *   支持 package.json exports / tsconfig paths alias
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, relative, basename } from 'path';
import { ImportGraph } from './import-graph.js';
import { ModuleResolver } from './module-resolver.js';

// ─────────────────────────────────────────────────────────────────────────────
// BarrelManager
// ─────────────────────────────────────────────────────────────────────────────

export class BarrelManager {
  /**
   * @param {object} opts
   * @param {string} opts.workingDirectory     项目根目录
   * @param {ImportGraph} [opts.importGraph]
   * @param {ModuleResolver} [opts.moduleResolver]
   * @param {string[]} [opts.barrelPatterns]   barrel 文件名模式
   */
  constructor(opts = {}) {
    this.workingDirectory = opts.workingDirectory || process.cwd();
    this.importGraph = opts.importGraph || new ImportGraph({ workingDirectory: this.workingDirectory });
    this.moduleResolver = opts.moduleResolver || new ModuleResolver({ workingDirectory: this.workingDirectory });
    this.barrelPatterns = opts.barrelPatterns || ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

    /** @type {Map<string, BarrelInfo>} barrel 文件信息 */
    this.barrels = new Map();
    /** @type {Map<string, string[]>} 源文件 → barrel 链 */
    this.sourceToBarrels = new Map();
  }

  /**
   * 扫描目录树，发现所有 barrel 文件。
   * @param {string} [baseDir]  扫描根目录
   * @returns {Promise<string[]>}
   */
  async discoverBarrels(baseDir) {
    const root = baseDir || this.workingDirectory;
    const barrels = [];

    // 递归扫描（排除 node_modules, .git, dist, build）
    const scan = async (dir) => {
      const { readdir } = await import('fs/promises');
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) { continue; }
          if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') { continue; }
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await scan(fullPath);
          } else if (entry.isFile() && this.barrelPatterns.includes(entry.name)) {
            barrels.push(fullPath);
          }
        }
      } catch { /* skip */ }
    };

    await scan(root);

    // 构建 barrel 信息
    for (const barrelPath of barrels) {
      try {
        const content = await readFile(barrelPath, 'utf-8');
        const reExports = this._parseReExports(content, barrelPath);
        const sourcFilePaths = this._findSourcFiles(barrelPath);

        this.barrels.set(barrelPath, {
          path: barrelPath,
          directory: dirname(barrelPath),
          reExports,
          sourceFiles: sourcFilePaths,
          lastScan: Date.now(),
        });

        // 建立源文件 → barrel 反向映射
        for (const sf of sourcFilePaths) {
          if (!this.sourceToBarrels.has(sf)) {
            this.sourceToBarrels.set(sf, []);
          }
          this.sourceToBarrels.get(sf).push(barrelPath);
        }
      } catch { /* skip */ }
    }

    return barrels;
  }

  /**
   * 当源文件新增导出时，更新对应 barrel。
   *
   * @param {string} sourceFilePath   源文件路径
   * @param {ExportChange[]} changes   导出变更列表
   * @returns {Promise<{updated: string[], errors: string[]}>}
   */
  async updateBarrelsForSource(sourceFilePath, changes = []) {
    if (!this.sourceToBarrels.has(sourceFilePath)) {
      await this.discoverBarrels();
      if (!this.sourceToBarrels.has(sourceFilePath)) {
        return { updated: [], errors: [] };
      }
    }

    const barrels = this.sourceToBarrels.get(sourceFilePath);
    const updated = [];
    const errors = [];

    for (const barrelPath of barrels) {
      try {
        const barrelInfo = this.barrels.get(barrelPath);
        if (!barrelInfo) continue;

        const barrelDir = barrelInfo.directory;
        const relativePath = relative(barrelDir, sourceFilePath);

        let content = await readFile(barrelPath, 'utf-8');
        let modified = false;

        for (const change of changes) {
          if (change.action === 'added') {
            // 检查是否已有这个 re-export
            const escapedName = change.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!content.includes(`export { ${change.name} }`) &&
                !content.includes(`export * from`) &&
                !new RegExp(`export\\s*{[^}]*\\b${escapedName}\\b[^}]*}\\s*from\\s*['"]`).test(content)) {
              // 在最后一个 export 语句后添加
              const lastExportIdx = content.lastIndexOf('export');
              if (lastExportIdx >= 0) {
                const insertPos = content.indexOf('\n', lastExportIdx) + 1;
                const sep = relativePath.startsWith('.') ? '' : './';
                const exportStmt = `export { ${change.name} } from '${sep}${relativePath.replace(ext(relativePath), '')}';\n`;
                content = content.slice(0, insertPos) + exportStmt + content.slice(insertPos);
                modified = true;
              }
            }
          } else if (change.action === 'removed') {
            // 移除特定的 re-export
            const regex = new RegExp(
              `export\\s*{[^}]*\\b${change.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*}\\s*from\\s*['"]\\.?\\/?${relativePath.replace(/^\.\//, '').replace(ext(relativePath), '')}['"];?\\s*\\n?`,
              'g'
            );
            if (regex.test(content)) {
              content = content.replace(regex, '');
              modified = true;
            }
          } else if (change.action === 'renamed') {
            // 更新 re-export 中的名称
            const oldName = change.oldName;
            const newName = change.newName;
            const regex = new RegExp(
              `export\\s*{([^}]*)}\\s*from\\s*['"]\\.?\\/?${relativePath.replace(/^\.\//, '').replace(ext(relativePath), '')}['"]`,
              'g'
            );
            content = content.replace(regex, (_match, names) => {
              const updatedNames = names.replace(
                new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
                newName
              );
              return _match.replace(names, updatedNames);
            });
            modified = true;
          }
        }

        if (modified) {
          await writeFile(barrelPath, content, 'utf-8');
          updated.push(barrelPath);
        }
      } catch (err) {
        errors.push(`Failed to update barrel ${barrelPath}: ${err.message}`);
      }
    }

    return { updated, errors };
  }

  /**
   * 追踪 re-export chain，找出一个导出通过多少个 barrel 最终暴露。
   *
   * @param {string} sourceFilePath   源文件
   * @param {string} exportName       导出名
   * @returns {Promise<ReExportChain>}
   */
  async traceReExportChain(sourceFilePath, exportName) {
    const chain = {
      source: sourceFilePath,
      exportName,
      steps: [],
      finalExposure: null,
      circular: false,
    };

    let currentPath = sourceFilePath;
    const visited = new Set();

    while (true) {
      // 找到导入了当前文件的 barrel
      const importers = await this.importGraph.getImporters(currentPath);
      const barrelImporters = importers.filter(imp => this.barrels.has(imp));

      if (barrelImporters.length === 0) break;
      if (visited.has(currentPath)) { chain.circular = true; break; }
      visited.add(currentPath);

      for (const barr of barrelImporters) {
        const barrelInfo = this.barrels.get(barr);
        if (!barrelInfo) continue;

        const reExport = barrelInfo.reExports.find(
          re => re.name === exportName || re.name === '*' || re.localName === exportName
        );
        if (reExport) {
          chain.steps.push({
            barrel: barr,
            exportAs: reExport.name === '*' ? exportName : reExport.name,
            originalName: exportName,
          });
          chain.finalExposure = barr;
          currentPath = barr;
          break;
        }
      }
    }

    return chain;
  }

  /**
   * 自动添加 re-export 到 barrel 文件。
   *
   * @param {string} barrelPath     barrel 文件路径
   * @param {string} sourcePath     源文件路径
   * @param {string} exportName     导出名
   * @returns {Promise<boolean>}
   */
  async addReExport(barrelPath, sourcePath, exportName) {
    const barrelDir = dirname(barrelPath);
    const relativePath = relative(barrelDir, sourcePath);
    const importPath = (relativePath.startsWith('.') ? '' : './') + relativePath.replace(ext(relativePath), '');

    let content = await readFile(barrelPath, 'utf-8');

    // 检查是否已有
    if (content.includes(`export { ${exportName} }`) ||
        new RegExp(`export\\s*{[^}]*\\b${exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*}`).test(content)) {
      return false;
    }

    const exportStmt = `export { ${exportName} } from '${importPath}';\n`;

    // 在最后一个 export 语句后插入
    const lastExportIdx = content.lastIndexOf('export');
    if (lastExportIdx >= 0) {
      const insertPos = content.indexOf('\n', lastExportIdx) + 1;
      content = content.slice(0, insertPos) + exportStmt + content.slice(insertPos);
    } else {
      content += '\n' + exportStmt;
    }

    await writeFile(barrelPath, content, 'utf-8');
    return true;
  }

  /**
   * 从 barrel 文件移除 re-export。
   * @param {string} barrelPath
   * @param {string} exportName
   * @returns {Promise<boolean>}
   */
  async removeReExport(barrelPath, exportName) {
    let content = await readFile(barrelPath, 'utf-8');
    const regex = new RegExp(
      `export\\s*{[^}]*\\b${exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^}]*}\\s*from\\s*['"][^'"]+['"];?\\s*\\n?`,
      'g'
    );
    if (regex.test(content)) {
      content = content.replace(regex, '');
      await writeFile(barrelPath, content, 'utf-8');
      return true;
    }
    return false;
  }

  // ── 私有方法 ───────────────────────────────────────────────────────

  _parseReExports(content, barrelPath) {
    const reExports = [];
    const barrelDir = dirname(barrelPath);
    // export { x, y } from './foo'
    const re = /export\s*{([^}]*)}\s*from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const item of items) {
        const parts = item.split(/\s+as\s+/);
        reExports.push({
          name: parts[parts.length - 1].trim(),
          localName: parts.length > 1 ? parts[0].trim() : parts[0].trim(),
          from: m[2],
          sourcePath: join(barrelDir, m[2] + '.ts'),
        });
      }
    }
    // export * from './foo'
    const starRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    while ((m = starRe.exec(content)) !== null) {
      reExports.push({
        name: '*',
        from: m[1],
        sourcePath: join(barrelDir, m[1] + '.ts'),
      });
    }
    return reExports;
  }

  _findSourcFiles(barrelPath) {
    const barrelDir = dirname(barrelPath);
    const sourceFiles = [];
    // 从同一目录下找到所有 .ts/.tsx/.js/.jsx 文件
    try {
      const { readdirSync } = require('fs');
      const entries = readdirSync(barrelDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() &&
            !this.barrelPatterns.includes(entry.name) &&
            /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(entry.name)) {
          sourceFiles.push(join(barrelDir, entry.name));
        }
      }
    } catch { /* skip */ }
    return sourceFiles;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} BarrelInfo
 * @property {string} path            barrel 文件绝对路径
 * @property {string} directory       barrel 所在目录
 * @property {object[]} reExports    re-export 列表
 * @property {string[]} sourceFiles  同目录源文件
 * @property {number} lastScan       最后扫描时间戳
 */

/**
 * @typedef {Object} ExportChange
 * @property {'added'|'removed'|'renamed'} action
 * @property {string} name           导出名
 * @property {string} [oldName]      重命名前的旧名（action=renamed 时）
 * @property {string} [newName]      重命名后的新名（action=renamed 时）
 * @property {string} [type]         导出类型
 */

/**
 * @typedef {Object} ReExportChain
 * @property {string} source          源文件
 * @property {string} exportName      导出名
 * @property {{barrel:string, exportAs:string, originalName:string}[]} steps
 * @property {string|null} finalExposure
 * @property {boolean} circular
 */

function ext(p) {
  return p.substring(p.lastIndexOf('.'));
}
