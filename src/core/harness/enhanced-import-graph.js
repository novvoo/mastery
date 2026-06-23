/**
 * EnhancedImportGraph — 增强版导入/导出图分析器。
 *
 * 在现有 ImportGraph/ExportGraph 基础上增加：
 *  1. pnpm workspace 深层解析：解析 pnpm-workspace.yaml，追踪 workspace 协议依赖
 *  2. Re-export chain 追踪：追踪 barrel re-export 链找到原始定义位置
 *  3. Package exports 条件解析：解析 package.json exports 字段 (import/require/types/browser)
 *  4. 跨 monorepo 包引用解析：解析 `@workspace/foo` → 实际文件路径
 *
 * 用法：
 * ```js
 * const graph = new EnhancedImportGraph({ projectRoot: '/path/to/monorepo' });
 * await graph.initialize();
 * const chain = graph.traceReExportChain('@myorg/ui-lib', 'Button');
 * // chain = [{ file: 'packages/ui-lib/src/index.ts', export: 'Button' },
 * //          { file: 'packages/ui-lib/src/components/Button.tsx', export: 'Button', isOriginal: true }]
 * ```
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { ImportGraph } from './import-graph.js';

// ── 类型定义 ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ReExportLink
 * @property {string} file           文件路径
 * @property {string} exportName     导出的名称
 * @property {string} source         从哪个模块重新导出
 * @property {'named'|'default'|'namespace'|'original'} kind
 * @property {string} [originalFile] 原始定义文件（kind=original 时）
 * @property {boolean} isOriginal    是否是原始定义
 */

/**
 * @typedef {Object} WorkspacePackage
 * @property {string} name          包名 (如 @myorg/ui-lib)
 * @property {string} root          包根目录
 * @property {string} srcDir        源码目录
 * @property {object} exports       package.json exports 字段
 * @property {object[]} dependencies 依赖列表
 */

/**
 * @typedef {Object} PackageExportResolution
 * @property {string} condition      匹配的条件 (import/require/types/browser/default)
 * @property {string} resolvedPath   解析后的路径
 * @property {string} sourceField    来源字段 (exports/main/module/types)
 */

// ── EnhancedImportGraph ─────────────────────────────────────────────────

export class EnhancedImportGraph extends ImportGraph {
  /**
   * @param {object} opts
   * @param {string} opts.projectRoot     项目根目录（monorepo 根）
   * @param {string[]} [opts.workspacePackages]  手动指定 workspace 包路径
   * @param {number} [opts.maxChainDepth=20]     re-export 链最大追踪深度
   * @param {boolean} [opts.cacheResolutions=true] 缓存解析结果
   */
  constructor(opts = {}) {
    super(opts);
    this.projectRoot = opts.projectRoot || process.cwd();
    this.maxChainDepth = opts.maxChainDepth || 20;
    this.cacheResolutions = opts.cacheResolutions !== false;

    /** @type {Map<string, WorkspacePackage>} name → package info */
    this._workspacePackages = new Map();

    /** @type {Map<string, string>} bare-specifier → resolved path cache */
    this._resolutionCache = new Map();

    /** @type {Map<string, object>} package.json cache */
    this._pkgJsonCache = new Map();

    /** @type {Map<string, string[]>} file → export names 缓存 */
    this._exportsCache = new Map();

    /** @type {boolean} */
    this._initialized = false;
  }

  // ── 初始化 ──────────────────────────────────────────────────────────

  /**
   * 初始化：扫描 monorepo 结构，解析 workspace 包。
   */
  async initialize() {
    // 1) 解析 pnpm-workspace.yaml 或 package.json workspaces
    await this._discoverWorkspacePackages();

    // 2) 构建 workspace 包名→路径索引
    for (const wp of this._workspacePackages.values()) {
      const pkgJson = this._readPackageJson(wp.root);
      if (pkgJson.name) {
        wp.name = pkgJson.name;
        this._workspacePackages.set(pkgJson.name, wp);
      }
    }

    // 3) 初始化父类 ImportGraph
    if (typeof super.initialize === 'function') {
      await super.initialize();
    }

    this._initialized = true;
  }

  // ── pnpm workspace 解析 ──────────────────────────────────────────────

  /**
   * 发现 workspace 中的所有包。
   * 支持 pnpm-workspace.yaml 和 package.json workspaces 字段。
   * @private
   */
  async _discoverWorkspacePackages() {
    // 1) pnpm-workspace.yaml
    const pnpmWsPath = join(this.projectRoot, 'pnpm-workspace.yaml');
    if (existsSync(pnpmWsPath)) {
      this._parsePnpmWorkspace(pnpmWsPath);
    }

    // 2) package.json workspaces 字段 (npm/yarn)
    const rootPkgPath = join(this.projectRoot, 'package.json');
    if (existsSync(rootPkgPath)) {
      this._parseNpmWorkspaces(rootPkgPath);
    }

    // 如果没有发现任何 workspace，将根目录本身作为单个包
    if (this._workspacePackages.size === 0) {
      this._workspacePackages.set('__root__', {
        name: '__root__',
        root: this.projectRoot,
        srcDir: this.projectRoot,
        exports: null,
        dependencies: [],
      });
    }
  }

  /**
   * 解析 pnpm-workspace.yaml。
   * @private
   */
  _parsePnpmWorkspace(filePath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      // 简单的 YAML 解析（提取 packages: 下的 glob 列表）
      const packagesMatch = content.match(/packages:\s*\n((?:\s*-\s*.+\n?)+)/);
      if (!packagesMatch) {return;}

      const globLines = packagesMatch[1]
        .split('\n')
        .map(l => l.trim().replace(/^-\s*'?/, '').replace(/'?\s*$/, '').replace(/^"/, '').replace(/"$/, ''))
        .filter(l => l.length > 0);

      for (const glob of globLines) {
        // 简化 glob 处理：将 * 展开为直接子目录
        const baseDir = join(this.projectRoot, glob.replace(/\*$/, '').replace(/\/\*$/, ''));
        if (!existsSync(baseDir)) {continue;}

        try {
          const entries = readdirSync(baseDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pkgDir = join(baseDir, entry.name);
              const pkgJson = join(pkgDir, 'package.json');
              if (existsSync(pkgJson)) {
                this._registerWorkspacePackage(pkgDir);
              }
            }
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn(`[EnhancedImportGraph] Failed to parse pnpm-workspace.yaml: ${err.message}`);
    }
  }

  /**
   * 解析 npm/yarn workspaces 配置。
   * @private
   */
  _parseNpmWorkspaces(packageJsonPath) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const workspaces = pkg.workspaces || (pkg.workspaces && pkg.packages) || [];

      for (const glob of (Array.isArray(workspaces) ? workspaces : workspaces.packages || [])) {
        const baseDir = join(this.projectRoot, glob.replace(/\*$/, '').replace(/\/\*$/, ''));
        if (!existsSync(baseDir)) {continue;}

        try {
          const entries = readdirSync(baseDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pkgDir = join(baseDir, entry.name);
              if (existsSync(join(pkgDir, 'package.json'))) {
                this._registerWorkspacePackage(pkgDir);
              }
            }
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn(`[EnhancedImportGraph] Failed to parse npm workspaces: ${err.message}`);
    }
  }

  /**
   * 注册一个 workspace 包。
   * @private
   */
  _registerWorkspacePackage(pkgDir) {
    try {
      const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
      const name = pkgJson.name || basename(pkgDir);
      const srcDir = pkgJson.source || join(pkgDir, 'src');

      this._workspacePackages.set(name, {
        name,
        root: pkgDir,
        srcDir: existsSync(srcDir) ? srcDir : pkgDir,
        exports: pkgJson.exports || null,
        dependencies: {
          ...(pkgJson.dependencies || {}),
          ...(pkgJson.devDependencies || {}),
          ...(pkgJson.peerDependencies || {}),
        },
      });
    } catch { /* ignore invalid package.json */ }
  }

  // ── Package exports 条件解析 ──────────────────────────────────────────

  /**
   * 解析 package.json exports 字段，根据条件返回路径。
   *
   * @param {string} packageName    包名或路径
   * @param {string} [subpath='.']  子路径 (如 './button')
   * @param {string[]} [conditions=['import','default']]  条件优先级
   * @returns {PackageExportResolution|null}
   */
  resolvePackageExports(packageName, subpath = '.', conditions = ['import', 'default']) {
    const wp = this._workspacePackages.get(packageName);
    const pkgPath = wp ? join(wp.root, 'package.json') : this._resolveNodeModulePkgJson(packageName);

    if (!pkgPath) {return null;}

    const cacheKey = `${packageName}:${subpath}:${conditions.join(',')}`;
    if (this.cacheResolutions && this._resolutionCache.has(cacheKey)) {
      return this._resolutionCache.get(cacheKey);
    }

    try {
      const pkg = this._readPackageJson(dirname(pkgPath));

      // 1) 先尝试 exports 字段
      if (pkg.exports) {
        const result = this._resolveExportsField(pkg.exports, subpath, conditions, dirname(pkgPath));
        if (result) {
          if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
          return result;
        }
      }

      // 2) 回退到 main/module/types 字段
      if (subpath === '.' || subpath === '') {
        const mainField = conditions.includes('import') && pkg.module
          ? pkg.module : pkg.main || 'index.js';
        const resolved = resolve(dirname(pkgPath), mainField);
        const result = {
          condition: 'default',
          resolvedPath: resolved,
          sourceField: conditions.includes('import') && pkg.module ? 'module' : 'main',
        };
        if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
        return result;
      }

      // 3) 简单子路径拼接
      const simplePath = resolve(dirname(pkgPath), subpath.replace(/^\.\//, ''));
      // 尝试添加扩展名
      for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.js']) {
        const withExt = simplePath + ext;
        if (existsSync(withExt)) {
          const result = {
            condition: 'default',
            resolvedPath: withExt,
            sourceField: 'exports',
          };
          if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
          return result;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 解析 exports 字段中的条件导出。
   * @private
   */
  _resolveExportsField(exports, subpath, conditions, pkgDir) {
    const entry = typeof exports === 'string'
      ? exports
      : exports[subpath] || exports['.' + subpath] || exports;

    if (!entry) {return null;}

    // 字符串：直接路径
    if (typeof entry === 'string') {
      // 处理 workspace: 协议
      if (entry.startsWith('workspace:')) {
        return this._resolveWorkspaceProtocol(entry, pkgDir, conditions);
      }
      return {
        condition: 'default',
        resolvedPath: resolve(pkgDir, entry),
        sourceField: 'exports',
      };
    }

    // 对象：条件导出
    if (typeof entry === 'object') {
      for (const cond of conditions) {
        if (entry[cond]) {
          const target = entry[cond];
          if (typeof target === 'string') {
            return {
              condition: cond,
              resolvedPath: resolve(pkgDir, target),
              sourceField: `exports.${cond}`,
            };
          }
        }
      }
      // 没有条件匹配：使用第一个可用条件
      const firstCond = Object.keys(entry)[0];
      if (firstCond && typeof entry[firstCond] === 'string') {
        return {
          condition: firstCond,
          resolvedPath: resolve(pkgDir, entry[firstCond]),
          sourceField: `exports.${firstCond}`,
        };
      }
    }

    return null;
  }

  /**
   * 解析 pnpm workspace: 协议。
   * @private
   */
  _resolveWorkspaceProtocol(workspaceRef, pkgDir, conditions) {
    const target = workspaceRef.replace(/^workspace:/, '');
    // workspace:* → 链接到 workspace 包源码
    for (const [name, wp] of this._workspacePackages) {
      const pkg = this._readPackageJson(wp.root);
      if (pkg.name === target || target === '*') {
        // 直接指向包的入口文件
        const mainEntry = pkg.main || pkg.module || 'src/index.ts';
        return {
          condition: 'workspace',
          resolvedPath: resolve(wp.root, mainEntry),
          sourceField: 'workspace',
        };
      }
    }
    return null;
  }

  // ── Re-export 链追踪 ──────────────────────────────────────────────────

  /**
   * 追踪 re-export 链：从给定的包/文件的导出名，追踪到原始定义位置。
   *
   * 例如：
   *   输入: '@myorg/ui-lib', 'Button'
   *   输出: [
   *     { file: 'packages/ui-lib/src/index.ts', export: 'Button', kind: 'named', source: './components' },
   *     { file: 'packages/ui-lib/src/components/Button.tsx', export: 'Button', kind: 'original', isOriginal: true }
   *   ]
   *
   * @param {string} entryPackage   入口包名或文件路径
   * @param {string} exportName     追踪的导出名称
   * @param {object} [opts]
   * @param {number} [opts.maxDepth]  最大追踪深度
   * @param {boolean} [opts.includeIntermediates=true] 是否包含中间环节
   * @returns {ReExportLink[]}
   */
  traceReExportChain(entryPackage, exportName, opts = {}) {
    const { maxDepth = this.maxChainDepth, includeIntermediates = true } = opts;
    const chain = [];

    // 解析入口点
    let currentFile = this._resolveEntryPoint(entryPackage);
    if (!currentFile) {return chain;}

    let currentExport = exportName;
    const visited = new Set();
    let depth = 0;

    while (depth < maxDepth) {
      const fileKey = `${currentFile}#${currentExport}`;
      if (visited.has(fileKey)) {break;} // 循环引用终止
      visited.add(fileKey);

      // 解析当前文件中的导出
      const exportInfo = this._resolveExportInFile(currentFile, currentExport);
      if (!exportInfo) {break;}

      if (exportInfo.isOriginal) {
        // 找到原始定义
        chain.push({
          file: currentFile,
          exportName: currentExport,
          kind: 'original',
          originalFile: currentFile,
          isOriginal: true,
        });
        break;
      }

      if (includeIntermediates) {
        chain.push({
          file: currentFile,
          exportName: currentExport,
          kind: exportInfo.kind,
          source: exportInfo.source,
        });
      }

      // 追踪到下一层
      const nextFile = this._resolveReExportSource(currentFile, exportInfo.source, exportInfo.originalName || currentExport);
      if (!nextFile || nextFile === currentFile) {break;}

      currentFile = nextFile;
      currentExport = exportInfo.originalName || currentExport;
      depth++;
    }

    return chain;
  }

  /**
   * 批量追踪多个导出名称的 re-export 链。
   *
   * @param {string} entryPackage
   * @param {string[]} exportNames
   * @returns {Map<string, ReExportLink[]>}
   */
  traceReExportChains(entryPackage, exportNames) {
    const results = new Map();
    for (const name of exportNames) {
      results.set(name, this.traceReExportChain(entryPackage, name));
    }
    return results;
  }

  /**
   * 查找 re-export 链中的原始定义文件列表（去重）。
   *
   * @param {string} entryPackage
   * @param {string[]} exportNames
   * @returns {string[]} 独一的原始文件路径列表
   */
  findOriginalFiles(entryPackage, exportNames) {
    const originals = new Set();
    for (const name of exportNames) {
      const chain = this.traceReExportChain(entryPackage, name);
      for (const link of chain) {
        if (link.isOriginal && link.originalFile) {
          originals.add(link.originalFile);
        }
      }
    }
    return [...originals];
  }

  // ── 私有：导出解析 ──────────────────────────────────────────────────

  /**
   * 解析入口点路径。
   * @private
   */
  _resolveEntryPoint(packageOrFile) {
    // 如果是文件路径，直接返回
    if (packageOrFile.includes('/') && existsSync(packageOrFile)) {
      return packageOrFile;
    }

    // 如果是 workspace 包名
    const wp = this._workspacePackages.get(packageOrFile);
    if (wp) {
      const pkg = this._readPackageJson(wp.root);
      const entryFile = pkg.main || pkg.module || 'src/index.ts';
      const resolved = resolve(wp.root, entryFile);
      if (existsSync(resolved)) {return resolved;}

      // 尝试常见入口
      for (const candidate of ['src/index.ts', 'src/index.tsx', 'src/index.js', 'index.ts', 'index.js']) {
        const p = join(wp.root, candidate);
        if (existsSync(p)) {return p;}
      }
      return join(wp.root, entryFile); // 返回推测路径
    }

    // 尝试作为 node_modules 包
    return this._resolveNodeModuleEntry(packageOrFile);
  }

  /**
   * 在文件中解析一个导出名称的来源。
   * @private
   */
  _resolveExportInFile(filePath, exportName) {
    if (!existsSync(filePath)) {return null;}

    // 检查缓存
    const cacheKey = `${filePath}:${exportName}`;
    if (this.cacheResolutions && this._resolutionCache.has(cacheKey)) {
      return this._resolutionCache.get(cacheKey);
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // 模式匹配优先级
      const patterns = [
        // export { Foo } from './bar'
        {
          regex: new RegExp(`export\\s*\\{\\s*[^}]*\\b${this._escapeRegex(exportName)}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`),
          kind: 'named',
        },
        // export { Foo as Bar } from './bar'
        {
          regex: new RegExp(`export\\s*\\{\\s*[^}]*\\b(\\w+)\\s+as\\s+${this._escapeRegex(exportName)}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`),
          kind: 'named',
          captureOriginal: 1, // 被重命名的原始名
          captureSource: 2,
        },
        // export { default as Foo } from './bar'
        {
          regex: new RegExp(`export\\s*\\{\\s*default\\s+as\\s+${this._escapeRegex(exportName)}\\s*\\}\\s*from\\s*['"]([^'"]+)['"]`),
          kind: 'default',
        },
        // export * from './bar'
        {
          regex: /export\s*\*\s*from\s*['"]([^'"]+)['"]/,
          kind: 'namespace',
          wildcard: true,
        },
        // export default function Foo() { ... }
        {
          regex: new RegExp(`export\\s+default\\s+(?:function|class|const|let|var)\\s+${this._escapeRegex(exportName)}\\b`),
          kind: 'original',
          isOriginal: true,
        },
        // export function/class/const Foo = ...
        {
          regex: new RegExp(`export\\s+(?:function|class|const|let|var|type|interface|enum)\\s+${this._escapeRegex(exportName)}\\b`),
          kind: 'original',
          isOriginal: true,
        },
        // export { Foo }
        {
          regex: new RegExp(`export\\s*\\{\\s*[^}]*\\b${this._escapeRegex(exportName)}\\b[^}]*\\}`),
          kind: 'named-local',
        },
        // export default Foo
        {
          regex: new RegExp(`export\\s+default\\s+${this._escapeRegex(exportName)}\\b`),
          kind: 'default-local',
        },
      ];

      for (const pattern of patterns) {
        for (const line of lines) {
          const match = line.match(pattern.regex);
          if (match) {
            if (pattern.isOriginal) {
              const result = { isOriginal: true, kind: 'original' };
              if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
              return result;
            }

            if (pattern.wildcard) {
              // export * from: 尝试在目标文件中找到该导出
              const source = match[1];
              const result = { kind: 'namespace', source, originalName: exportName };
              if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
              return result;
            }

            const sourceIdx = pattern.captureSource !== undefined ? pattern.captureSource : 1;
            const source = match[sourceIdx];
            const originalName = pattern.captureOriginal !== undefined ? match[pattern.captureOriginal] : exportName;

            const result = { kind: pattern.kind, source, originalName };
            if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
            return result;
          }
        }
      }

      // 未找到特定导出模式：检查是否是本地定义
      for (const line of lines) {
        if (new RegExp(`\\b(?:const|let|var|function|class|type|interface|enum)\\s+${this._escapeRegex(exportName)}\\b`).test(line)) {
          const result = { isOriginal: true, kind: 'original' };
          if (this.cacheResolutions) {this._resolutionCache.set(cacheKey, result);}
          return result;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 解析 re-export 的源文件路径。
   * @private
   */
  _resolveReExportSource(fromFile, source, exportName) {
    if (!source) {return null;}

    // 相对路径
    if (source.startsWith('.') || source.startsWith('/')) {
      let resolved = resolve(dirname(fromFile), source);
      // 尝试扩展名
      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs']) {
        const withExt = resolved + ext;
        if (existsSync(withExt)) {return withExt;}
      }
      // 尝试 index 文件
      for (const idx of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
        const withIdx = resolved + idx;
        if (existsSync(withIdx)) {return withIdx;}
      }
      return resolved + '.ts'; // 推测
    }

    // workspace 协议
    if (source.startsWith('workspace:')) {
      const target = source.replace(/^workspace:/, '');
      for (const [name, wp] of this._workspacePackages) {
        const pkg = this._readPackageJson(wp.root);
        if (pkg.name === target) {
          return this._resolveEntryPoint(target);
        }
      }
    }

    // 裸 specifier（可能是 workspace 包）
    const wp = this._workspacePackages.get(source);
    if (wp) {
      return this._resolveEntryPoint(source);
    }

    // 尝试作为 node_modules
    return this._resolveNodeModuleEntry(source);
  }

  // ── 辅助方法 ──────────────────────────────────────────────────────────

  /**
   * 读取 package.json（带缓存）。
   * @private
   */
  _readPackageJson(dir) {
    const pkgPath = join(dir, 'package.json');
    if (this.cacheResolutions && this._pkgJsonCache.has(pkgPath)) {
      return this._pkgJsonCache.get(pkgPath);
    }
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (this.cacheResolutions) {this._pkgJsonCache.set(pkgPath, pkg);}
      return pkg;
    } catch {
      return {};
    }
  }

  /**
   * 从 node_modules 解析包入口。
   * @private
   */
  _resolveNodeModuleEntry(packageName) {
    const pkgJsonPath = this._resolveNodeModulePkgJson(packageName);
    if (!pkgJsonPath) {return null;}

    const pkgDir = dirname(pkgJsonPath);
    const pkg = this._readPackageJson(pkgDir);
    const mainFile = pkg.module || pkg.main || 'index.js';
    const resolved = resolve(pkgDir, mainFile);
    return existsSync(resolved) ? resolved : null;
  }

  /**
   * 查找 node_modules 中包的 package.json 路径。
   * @private
   */
  _resolveNodeModulePkgJson(packageName) {
    const parts = packageName.split('/');
    const searchPaths = [this.projectRoot];

    // 也搜索 workspace 包的 node_modules
    for (const wp of this._workspacePackages.values()) {
      searchPaths.push(wp.root);
    }

    for (const base of searchPaths) {
      let current = base;
      while (current !== resolve(current, '..')) {
        const nmDir = join(current, 'node_modules');
        if (existsSync(nmDir)) {
          // scoped package?
          if (packageName.startsWith('@') && parts.length > 1) {
            const scopeDir = join(nmDir, parts[0]);
            const pkgDir = join(scopeDir, parts.slice(1).join('/'));
            const pkgJson = join(pkgDir, 'package.json');
            if (existsSync(pkgJson)) {return pkgJson;}
          }

          const pkgDir = join(nmDir, packageName);
          const pkgJson = join(pkgDir, 'package.json');
          if (existsSync(pkgJson)) {return pkgJson;}
        }
        current = resolve(current, '..');
      }
    }
    return null;
  }

  /**
   * 正则转义。
   * @private
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── 公开查询 API ──────────────────────────────────────────────────────

  /**
   * 获取 workspace 包列表。
   */
  getWorkspacePackages() {
    const result = [];
    for (const [name, wp] of this._workspacePackages) {
      result.push({
        name,
        root: wp.root,
        srcDir: wp.srcDir,
        hasExports: !!wp.exports,
        dependencyCount: Object.keys(wp.dependencies || {}).length,
      });
    }
    return result;
  }

  /**
   * 查找引用某个 workspace 包的所有其他 workspace 包。
   */
  findWorkspaceDependents(packageName) {
    const dependents = [];
    for (const [name, wp] of this._workspacePackages) {
      if (name === packageName) {continue;}
      const deps = wp.dependencies || {};
      if (deps[packageName]) {
        dependents.push({
          name,
          root: wp.root,
          versionRange: deps[packageName],
          isWorkspaceProtocol: deps[packageName].startsWith('workspace:'),
        });
      }
    }
    return dependents;
  }

  /**
   * 清空缓存。
   */
  clearCache() {
    this._resolutionCache.clear();
    this._pkgJsonCache.clear();
    this._exportsCache.clear();
  }
}

export default EnhancedImportGraph;
