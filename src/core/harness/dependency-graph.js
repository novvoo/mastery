/**
 * Dependency Graph - 依赖关系图
 *
 * 构建和维护代码库中模块/文件之间的依赖关系
 * 支持按需加载，理解"为什么这样改"需要的所有依赖信息
 */

import { readFile } from 'fs/promises';
import { resolve, join, relative } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'node:crypto';

/**
 * 依赖关系图
 */
export class DependencyGraph {
  constructor() {
    this._nodes = new Map();
    this._externalModules = new Set();
  }

  /**
   * 添加文件到依赖图
   */
  async addFile(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    const dependencies = this._extractDependencies(filePath, content);

    const node = {
      path: filePath,
      dependencies,
      dependents: [],
      hash: this._hashContent(content),
      timestamp: Date.now(),
    };

    // 更新反向索引
    for (const dep of dependencies) {
      if (!dep.isExternal) {
        const targetNode = this._nodes.get(dep.target);
        if (targetNode) {
          if (!targetNode.dependents.includes(filePath)) {
            targetNode.dependents.push(filePath);
          }
        }
      }
    }

    this._nodes.set(filePath, node);
    return dependencies;
  }

  /**
   * 获取文件的所有依赖（直接依赖）
   */
  getDirectDependencies(filePath) {
    const node = this._nodes.get(filePath);
    return node ? node.dependencies : [];
  }

  /**
   * 获取文件的传递依赖（所有层级的依赖）
   */
  getTransitiveDependencies(filePath, maxDepth = 5) {
    const visited = new Set();
    const result = [];

    const traverse = (currentPath, depth) => {
      if (depth > maxDepth || visited.has(currentPath)) {
        return;
      }
      visited.add(currentPath);

      const node = this._nodes.get(currentPath);
      if (!node) {
        return;
      }

      for (const dep of node.dependencies) {
        if (!dep.isExternal) {
          result.push({
            depth: depth + 1,
            path: dep.target,
            dependencies: this.getDirectDependencies(dep.target),
          });
          traverse(dep.target, depth + 1);
        }
      }
    };

    traverse(filePath, 0);
    return result;
  }

  /**
   * 获取依赖这个文件的所有文件
   */
  getDependents(filePath) {
    const node = this._nodes.get(filePath);
    return node ? node.dependents : [];
  }

  /**
   * 获取传递依赖者（所有依赖这个文件的文件）
   */
  getTransitiveDependents(filePath, maxDepth = 5) {
    const visited = new Set();
    const result = [];

    const traverse = (currentPath, depth) => {
      if (depth > maxDepth || visited.has(currentPath)) {
        return;
      }
      visited.add(currentPath);

      const node = this._nodes.get(currentPath);
      if (!node) {
        return;
      }

      for (const dependent of node.dependents) {
        result.push({ depth: depth + 1, path: dependent });
        traverse(dependent, depth + 1);
      }
    };

    traverse(filePath, 0);
    return result;
  }

  /**
   * 检查修改是否会影响其他文件
   */
  analyzeImpact(filePath) {
    const directlyAffects = this.getDirectDependencies(filePath)
      .filter((d) => !d.isExternal)
      .map((d) => d.target);

    const transitivelyAffects = this.getTransitiveDependencies(filePath).map((d) => ({
      depth: d.depth,
      path: d.path,
    }));

    const directlyAffectedBy = this.getDependents(filePath);

    const transitivelyAffectedBy = this.getTransitiveDependents(filePath);

    return {
      directlyAffects,
      transitivelyAffects,
      directlyAffectedBy,
      transitivelyAffectedBy,
    };
  }

  /**
   * 查找两个文件之间的最短路径
   */
  findPath(from, to) {
    const visited = new Set();
    const queue = [{ path: [from], current: from }];

    while (queue.length > 0) {
      const { path, current } = queue.shift();

      if (current === to) {
        return path;
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const node = this._nodes.get(current);
      if (!node) {
        continue;
      }

      for (const dep of node.dependencies) {
        if (!dep.isExternal && !visited.has(dep.target)) {
          queue.push({
            path: [...path, dep.target],
            current: dep.target,
          });
        }
      }
    }

    return null;
  }

  /**
   * 提取依赖关系
   */
  _extractDependencies(filePath, content) {
    const dependencies = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // ES6 import
      const es6Match = trimmed.match(
        /^import\s+(?:{([^}]+)}|(\*)\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/,
      );

      if (es6Match) {
        const [, namedImports, , , defaultImport, source] = es6Match;
        const symbols = namedImports
          ? namedImports.split(',').map((s) => s.trim().split(' as ')[0].trim())
          : defaultImport
            ? [defaultImport]
            : [];

        dependencies.push({
          source: filePath,
          target: this._resolvePath(filePath, source),
          type: 'import',
          symbols,
          isExternal: this._isExternalModule(source),
        });
        continue;
      }

      // CommonJS require
      const cjsMatch = trimmed.match(
        /^const\s+\{([^}]+)\}\s+=\s+require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (cjsMatch) {
        dependencies.push({
          source: filePath,
          target: this._resolvePath(filePath, cjsMatch[2]),
          type: 'require',
          symbols: cjsMatch[1].split(',').map((s) => s.trim().split(' as ')[0].trim()),
          isExternal: this._isExternalModule(cjsMatch[2]),
        });
        continue;
      }

      // Class extends
      const extendsMatch = trimmed.match(/class\s+\w+\s+extends\s+([A-Z][\w]*)/);
      if (extendsMatch) {
        dependencies.push({
          source: filePath,
          target: extendsMatch[1], // 需要通过符号索引找到实际文件
          type: 'extends',
          isExternal: false,
        });
      }
    }

    return dependencies;
  }

  /**
   * 解析模块路径到实际文件路径
   */
  _resolvePath(fromFile, modulePath) {
    if (this._isExternalModule(modulePath)) {
      return modulePath;
    }

    const baseDir = resolve(fromFile, '..');

    // 处理相对路径
    if (modulePath.startsWith('.')) {
      return resolve(baseDir, modulePath);
    }

    // 处理包名（简化处理，实际应该检查 node_modules）
    return join(baseDir, 'node_modules', modulePath);
  }

  /**
   * 检查是否是外部模块
   */
  _isExternalModule(modulePath) {
    // 外部模块通常不以 . 或 / 开头
    return !modulePath.startsWith('.') && !modulePath.startsWith('/');
  }

  /**
   * 内容哈希
   */
  _hashContent(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 获取依赖图统计
   */
  getStats() {
    let totalDeps = 0;
    let mostDependent = [];

    for (const [path, node] of this._nodes.entries()) {
      totalDeps += node.dependencies.filter((d) => !d.isExternal).length;
      mostDependent.push({ path, count: node.dependents.length });
    }

    mostDependent.sort((a, b) => b.count - a.count);

    return {
      files: this._nodes.size,
      externalModules: this._externalModules.size,
      avgDependencies: this._nodes.size > 0 ? totalDeps / this._nodes.size : 0,
      mostDependent: mostDependent.slice(0, 10),
    };
  }

  /**
   * 导出图数据（用于可视化或序列化）
   */
  export() {
    const nodes = [];
    const edges = [];

    for (const [path, node] of this._nodes.entries()) {
      nodes.push({
        path,
        hash: node.hash,
        timestamp: node.timestamp,
      });

      for (const dep of node.dependencies) {
        if (!dep.isExternal) {
          edges.push({
            from: path,
            to: dep.target,
            type: dep.type,
          });
        }
      }
    }

    return { nodes, edges };
  }
}

export default DependencyGraph;
