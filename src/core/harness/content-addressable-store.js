/**
 * Content Addressable Object Store
 *
 * 更完整的内容寻址对象存储系统
 *
 * 职责：
 * - Blobs：文件内容
 * - Trees：目录结构
 * - Symbols：函数、类等符号
 * - Dependencies：依赖关系
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative, dirname, basename } from 'path';
import { ContentAddressableStore, StateGraph } from './state-graph-core.js';

/**
 * 文件树索引器
 */
export class FileTreeIndex {
  constructor(store) {
    this.store = store;
    this.rootHash = null;
  }

  /**
   * 索引目录结构
   */
  async indexDirectory(rootDir, patterns = ['**/*']) {
    const entries = await this.buildTree(rootDir, '.');
    const rootHash = this.store.store('tree', entries);
    this.rootHash = rootHash;
    return rootHash;
  }

  /**
   * 递归构建目录树
   */
  async buildTree(rootDir, currentPath) {
    const fullPath = resolve(rootDir, currentPath);
    const entries = await readdir(fullPath, { withFileTypes: true });

    const tree = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }

      const entryPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        const children = await this.buildTree(rootDir, entryPath);
        const treeHash = this.store.store('tree', children);
        tree.push({
          name: entry.name,
          hash: treeHash,
          type: 'tree',
        });
      } else if (entry.isFile()) {
        const filePath = resolve(rootDir, entryPath);
        const content = await readFile(filePath, 'utf-8');
        const blobHash = this.store.storeBlob(content);
        tree.push({
          name: entry.name,
          hash: blobHash,
          type: 'blob',
        });
      }
    }

    return tree;
  }

  /**
   * 获取目录内容
   */
  getTree(hash) {
    const obj = this.store.get(hash);
    return obj && obj.type === 'tree' ? obj.data : [];
  }

  /**
   * 获取文件内容
   */
  getFileContent(hash) {
    return this.store.getBlob(hash);
  }

  /**
   * 按路径查找
   */
  async findByPath(rootDir, path) {
    if (!this.rootHash) {
      return null;
    }

    const parts = path.split('/').filter(Boolean);
    let currentHash = this.rootHash;

    for (const part of parts) {
      const tree = this.getTree(currentHash);
      const entry = tree.find((e) => e.name === part);
      if (!entry) {
        return null;
      }

      if (entry.type === 'tree') {
        currentHash = entry.hash;
      } else {
        return entry.hash;
      }
    }

    return currentHash;
  }
}

/**
 * 符号索引器
 */
export class SymbolIndexer {
  constructor(store) {
    this.store = store;
    this.symbolMap = new Map(); // name -> hashes
    this.fileMap = new Map(); // file -> hashes
  }

  /**
   * 索引文件中的符号
   */
  async indexFile(filePath, content) {
    const symbols = [];
    const lines = content.split('\n');

    // 简单的符号提取（生产环境中应该使用真实的 AST 解析器
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 函数声明
      const funcMatch = trimmed.match(
        /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)/,
      );
      if (funcMatch && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          name: funcMatch[1],
          type: 'function',
          file: filePath,
          startLine: i + 1,
          endLine,
          visibility: trimmed.includes('export') ? 'public' : 'private',
          signature: trimmed,
        });
      }

      // 类声明
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+([a-zA-Z_$][\w$]*)/);
      if (classMatch) {
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          name: classMatch[1],
          type: 'class',
          file: filePath,
          startLine: i + 1,
          endLine,
          visibility: trimmed.includes('export') ? 'public' : 'private',
          signature: trimmed,
        });
      }

      // 导入
      if (trimmed.startsWith('import')) {
        const importMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          symbols.push({
            name: importMatch[1],
            type: 'import',
            file: filePath,
            startLine: i + 1,
            endLine: i + 1,
            visibility: 'private',
            signature: trimmed,
          });
        }
      }
    }

    // 存储符号
    for (const symbol of symbols) {
      const hash = this.store.store('symbol', symbol);
      if (!this.symbolMap.has(symbol.name)) {
        this.symbolMap.set(symbol.name, []);
      }
      this.symbolMap.get(symbol.name).push(hash);
      if (!this.fileMap.has(symbol.file)) {
        this.fileMap.set(symbol.file, []);
      }
      this.fileMap.get(symbol.file).push(hash);
    }

    return symbols;
  }

  /**
   * 查找代码块结束
   */
  findBlockEnd(lines, start) {
    let braceCount = 0;
    let foundOpen = false;

    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpen = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (foundOpen && braceCount === 0) {
        return i + 1;
      }
    }

    return start + 1;
  }

  /**
   * 按名称查找符号
   */
  findByName(name) {
    const hashes = this.symbolMap.get(name) || [];
    return hashes
      .map((hash) => {
        const obj = this.store.get(hash);
        return obj && obj.type === 'symbol' ? obj.data : null;
      })
      .filter(Boolean);
  }

  /**
   * 查找文件中的符号
   */
  findInFile(file) {
    const hashes = this.fileMap.get(file) || [];
    return hashes
      .map((hash) => {
        const obj = this.store.get(hash);
        return obj && obj.type === 'symbol' ? obj.data : null;
      })
      .filter(Boolean);
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      symbols: this.symbolMap.size,
      files: this.fileMap.size,
    };
  }
}

/**
 * 依赖关系分析器
 */
export class DependencyAnalyzer {
  constructor(store) {
    this.store = store;
    this.dependencyMap = new Map();
    this.dependentMap = new Map();
  }

  /**
   * 分析文件依赖
   */
  async analyzeFile(filePath, content) {
    const deps = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // ES6 import
      const importMatch = trimmed.match(/^import\s+(?:{([^}]+)}\s+from\s+['"]([^'"]+)['"])/);
      if (importMatch) {
        const target = importMatch[2];
        deps.push({
          source: filePath,
          target,
          type: 'import',
          isExternal: !target.startsWith('.'),
          symbols: importMatch[1] ? importMatch[1].split(',').map((s) => s.trim()) : [],
        });
      }

      // CommonJS require
      const requireMatch = trimmed.match(
        /^const\s+{[^}]+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (requireMatch) {
        const target = requireMatch[1];
        deps.push({
          source: filePath,
          target,
          type: 'require',
          isExternal: !target.startsWith('.'),
          symbols: [],
        });
      }
    }

    for (const dep of deps) {
      const hash = this.store.store('dependency', dep);
      if (!this.dependencyMap.has(filePath)) {
        this.dependencyMap.set(filePath, []);
      }
      this.dependencyMap.get(filePath).push(dep);

      if (!this.dependentMap.has(dep.target)) {
        this.dependentMap.set(dep.target, []);
      }
      this.dependentMap.get(dep.target).push(filePath);
    }

    return deps;
  }

  /**
   * 获取文件的依赖
   */
  getDependencies(file) {
    return this.dependencyMap.get(file) || [];
  }

  /**
   * 获取依赖该文件的文件
   */
  getDependents(file) {
    return this.dependentMap.get(file) || [];
  }

  /**
   * 影响分析
   */
  analyzeImpact(file) {
    const directDeps = this.getDependencies(file).map((d) => d.target);
    const dependents = this.getDependents(file);

    const transitiveDeps = new Set();
    const transitiveDependents = new Set();

    // 递归收集
    const collectDeps = (f) => {
      for (const dep of this.getDependencies(f).map((d) => d.target)) {
        if (!transitiveDeps.has(dep)) {
          transitiveDeps.add(dep);
          collectDeps(dep);
        }
      }
    };
    collectDeps(file);

    const collectDependents = (f) => {
      for (const dep of this.getDependents(f)) {
        if (!transitiveDependents.has(dep)) {
          transitiveDependents.add(dep);
          collectDependents(dep);
        }
      }
    };
    collectDependents(file);

    return {
      directDeps,
      transitiveDeps: Array.from(transitiveDeps),
      dependents,
      transitiveDependents: Array.from(transitiveDependents),
    };
  }

  /**
   * 获取统计
   */
  getStats() {
    let totalDeps = 0;
    for (const deps of this.dependencyMap.values()) {
      totalDeps += deps.length;
    }
    return {
      dependencies: totalDeps,
      files: this.dependencyMap.size,
    };
  }
}

/**
 * 完整索引
 */
export class CompleteIndex {
  constructor(store) {
    this.store = store || new ContentAddressableStore();
    this.fileTree = new FileTreeIndex(this.store);
    this.symbols = new SymbolIndexer(this.store);
    this.dependencies = new DependencyAnalyzer(this.store);
  }

  /**
   * 索引整个项目
   */
  async indexProject(rootDir, patterns = ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx']) {
    // 简单实现：实际应该使用 glob 模式匹配
    const rootHash = await this.fileTree.indexDirectory(rootDir, patterns);

    let filesIndexed = 0;
    let symbolsFound = 0;
    let dependenciesFound = 0;

    // 递归处理文件
    const indexFiles = async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          await indexFiles(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.js') ||
            entry.name.endsWith('.ts') ||
            entry.name.endsWith('.jsx') ||
            entry.name.endsWith('.tsx'))
        ) {
          const content = await readFile(fullPath, 'utf-8');
          const syms = await this.symbols.indexFile(fullPath, content);
          const deps = await this.dependencies.analyzeFile(fullPath, content);

          filesIndexed++;
          symbolsFound += syms.length;
          dependenciesFound += deps.length;
        }
      }
    };

    await indexFiles(rootDir);

    return { filesIndexed, symbolsFound, dependenciesFound };
  }

  /**
   * 获取统计
   */
  getStats() {
    const storeStats = this.store.getStats();
    const symbolStats = this.symbols.getStats();
    const depStats = this.dependencies.getStats();

    return {
      files: symbolStats.files,
      symbols: symbolStats.symbols,
      dependencies: depStats.dependencies,
      objects: storeStats.objects,
    };
  }
}

export default {
  FileTreeIndex,
  SymbolIndexer,
  DependencyAnalyzer,
  CompleteIndex,
};
