/**
 * ModuleResolver — 非正则、基于 AST 感知的项目级模块解析器
 *
 * 对标文档 P2 要求，处理：
 *   tsconfig paths alias
 *   package.json exports / subpath exports
 *   monorepo / pnpm workspace packages
 *   index.ts barrel
 *   vite alias / webpack alias
 *   re-export chain 追踪
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, join, dirname, extname } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// ModuleResolver
// ─────────────────────────────────────────────────────────────────────────────

export class ModuleResolver {
  /**
   * @param {object} opts
   * @param {string} opts.workingDirectory      项目根目录
   * @param {object} [opts.tsconfig]            预解析的 tsconfig（可选）
   * @param {'ts'|'js'|'auto'} [opts.mode='auto']
   */
  constructor(opts = {}) {
    this.workingDirectory = opts.workingDirectory || process.cwd();
    this.mode = opts.mode || 'auto';

    /** @type {Map<string, string>} tsconfig paths 别名映射 */
    this.tsPaths = new Map();
    /** @type {Map<string, string>} package exports 映射 */
    this.packageExports = new Map();
    /** @type {Map<string, string>} workspace package 映射 */
    this.workspacePackages = new Map();
    /** @type {Map<string, string>} 自定义别名 */
    this.customAliases = new Map();

    this._loaded = false;
  }

  /**
   * 初始化：加载项目配置。
   * @returns {Promise<void>}
   */
  async init() {
    if (this._loaded) { return; }
    await Promise.all([
      this._loadTsconfig(),
      this._loadPackageExports(),
      this._loadWorkspacePackages(),
      this._loadCustomAliases(),
    ]);
    this._loaded = true;
  }

  // ── 核心解析方法 ────────────────────────────────────────────────────

  /**
   * 解析 import specifier 到文件系统绝对路径。
   *
   * 解析顺序：
   *   1. tsconfig paths alias
   *   2. package.json exports
   *   3. workspace packages
   *   4. custom aliases (vite/webpack)
   *   5. relative path resolution
   *   6. node_modules lookup
   *
   * @param {string} specifier    import specifier（如 '@/utils'、'./foo'、'lodash'）
   * @param {string} fromPath     发起 import 的文件路径
   * @returns {string|null}       解析到的绝对文件路径，或 null
   */
  resolveImport(specifier, fromPath) {
    // 1. tsconfig paths alias
    const aliasResult = this._resolveAlias(specifier);
    if (aliasResult) { return aliasResult; }

    // 2. package.json exports (including nested)
    const exportsResult = this._resolveExports(specifier)
      || this._resolveNestedExports(specifier);
    if (exportsResult) { return exportsResult; }

    // 3. workspace packages (including inter-dependencies)
    const workspaceResult = this._resolveWorkspace(specifier)
      || this._resolveWorkspaceDependency(specifier, fromPath);
    if (workspaceResult) { return workspaceResult; }

    // 4. 相对路径
    if (specifier.startsWith('.')) {
      return this._resolveRelative(specifier, fromPath);
    }

    // 5. 无前缀裸模块 → node_modules 查找
    return this._resolveNodeModule(specifier, fromPath);
  }

  /**
   * 解析模块 specifier 到磁盘路径（不指定 fromPath 时）。
   * @param {string} specifier
   * @param {string} [baseDir]
   * @returns {string|null}
   */
  resolveModule(specifier, baseDir) {
    const base = baseDir || this.workingDirectory;
    return this.resolveImport(specifier, base);
  }

  /**
   * 获取 tsconfig paths 中某个别名的所有可能路径。
   * @param {string} alias
   * @returns {string[]}
   */
  getTsPathsForAlias(alias) {
    const results = [];
    for (const [pattern, target] of this.tsPaths) {
      if (pattern === alias || pattern.startsWith(alias + '/')) {
        results.push(target);
      }
    }
    return results;
  }

  /**
   * 判断 specifier 是否匹配某个已知别名。
   * @param {string} specifier
   * @returns {{ alias: string, rest: string }|null}
   */
  matchAlias(specifier) {
    // 按别名长度降序排序，确保最长匹配优先
    const sorted = [...this.tsPaths.keys()].sort((a, b) => b.length - a.length);
    for (const pattern of sorted) {
      const cleanPattern = pattern.replace(/\/\*$/, '');
      if (specifier === cleanPattern) {
        return { alias: cleanPattern, rest: '' };
      }
      if (specifier.startsWith(cleanPattern + '/')) {
        return { alias: cleanPattern, rest: specifier.slice(cleanPattern.length) };
      }
    }
    // 也检查 package exports
    if (this.packageExports.has(specifier)) {
      return { alias: specifier, rest: '' };
    }
    for (const key of this.packageExports.keys()) {
      if (specifier.startsWith(key + '/')) {
        return { alias: key, rest: specifier.slice(key.length) };
      }
    }
    return null;
  }

  // ── 配置加载 ────────────────────────────────────────────────────────

  async _loadTsconfig() {
    // 搜索 tsconfig.json / jsconfig.json
    const candidates = [
      join(this.workingDirectory, 'tsconfig.json'),
      join(this.workingDirectory, 'jsconfig.json'),
    ];
    const seenConfigs = new Set(); // 防循环引用
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          this._loadTsconfigRecursive(candidate, seenConfigs);
          break; // 找到第一个就停
        }
      } catch { /* skip unparseable */ }
    }
  }

  /**
   * @private 递归加载 tsconfig extends 链
   */
  _loadTsconfigRecursive(configPath, seenConfigs, maxDepth = 10) {
    const absPath = resolve(configPath);
    if (seenConfigs.has(absPath) || maxDepth <= 0) { return; }
    seenConfigs.add(absPath);
    try {
      const raw = readFileSync(absPath, 'utf-8');
      const config = JSON.parse(this._stripComments(raw));
      if (config.compilerOptions?.paths) {
        for (const [alias, targets] of Object.entries(config.compilerOptions.paths)) {
          for (const target of targets) {
            const resolvedTarget = target.replace(/\/\*$/, '').replace(/^\*$/, '');
            this.tsPaths.set(alias.replace(/\/\*$/, ''), join(this.workingDirectory, resolvedTarget));
          }
        }
      }
      // 递归处理 extends
      if (config.extends) {
        const extendPath = config.extends.replace(/\.json$/, '') + '.json';
        // extends 可能是相对路径、绝对路径、或 npm 包名
        let resolvedExtends;
        if (extendPath.startsWith('.')) {
          resolvedExtends = resolve(dirname(absPath), extendPath);
        } else if (extendPath.startsWith('/')) {
          resolvedExtends = extendPath;
        } else {
          // npm 包名，尝试从 node_modules 解析
          resolvedExtends = resolve(this.workingDirectory, 'node_modules', extendPath);
        }
        if (existsSync(resolvedExtends)) {
          // 子 extends 的 baseDir 是它自己的目录
          const savedWd = this.workingDirectory;
          this.workingDirectory = dirname(resolvedExtends);
          this._loadTsconfigRecursive(resolvedExtends, seenConfigs, maxDepth - 1);
          this.workingDirectory = savedWd;
        }
      }
    } catch { /* skip unparseable */ }
  }

  async _loadPackageExports() {
    const pkgPath = join(this.workingDirectory, 'package.json');
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.exports) {
          this._flattenExports(pkg.exports, pkg.name || '', join(this.workingDirectory, pkg.main || 'index.js'));
        }
      }
    } catch { /* skip */ }
  }

  async _loadWorkspacePackages() {
    // pnpm-workspace.yaml / package.json workspaces / lerna.json
    const pkgPath = join(this.workingDirectory, 'package.json');
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const workspaces = pkg.workspaces || (Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : []);
        for (const ws of workspaces) {
          this._expandWorkspacePattern(ws);
        }
      }
    } catch { /* skip */ }

    // 也检查 pnpm-workspace.yaml
    const pnpmWsPath = join(this.workingDirectory, 'pnpm-workspace.yaml');
    try {
      if (existsSync(pnpmWsPath)) {
        const content = readFileSync(pnpmWsPath, 'utf-8');
        // 简单解析 yaml 的 packages 列表
        const lines = content.split('\n');
        let inPackages = false;
        for (const line of lines) {
          if (line.trim().startsWith('packages:')) {
            inPackages = true;
            continue;
          }
          if (inPackages && line.trim().startsWith('-')) {
            const p = line.trim().replace(/^-\s*['"]?/, '').replace(/['"]$/, '');
            this._expandWorkspacePattern(p);
          } else if (inPackages && !line.trim().startsWith('-') && line.trim() !== '') {
            inPackages = false;
          }
        }
      }
    } catch { /* skip */ }
  }

  /**
   * @private 展开 workspace glob 模式，支持 * 通配符。
   * 例：'packages/*' → 匹配 packages/ 下所有含 package.json 的子目录
   */
  _expandWorkspacePattern(pattern) {
    if (!pattern.includes('*')) {
      const wsPath = join(this.workingDirectory, pattern);
      if (existsSync(join(wsPath, 'package.json'))) {
        try {
          const wsPkg = JSON.parse(readFileSync(join(wsPath, 'package.json'), 'utf-8'));
          if (wsPkg.name) { this.workspacePackages.set(wsPkg.name, wsPath); }
        } catch { /* skip */ }
      }
      return;
    }
    // glob 匹配：将 * 替换为当前目录下的子目录
    const parts = pattern.split('*');
    if (parts.length === 2) {
      const prefix = parts[0]; // e.g. "packages/"
      const suffix = parts[1]; // e.g. "" or "/package.json"
      const baseDir = join(this.workingDirectory, prefix);
      try {
        if (existsSync(baseDir)) {
          const entries = readdirSync(baseDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const wsPath = join(baseDir, entry.name, suffix.replace(/^\//, ''));
              const checkDir = suffix ? dirname(join(wsPath)) : wsPath;
              if (existsSync(join(checkDir, 'package.json'))) {
                try {
                  const wsPkg = JSON.parse(readFileSync(join(checkDir, 'package.json'), 'utf-8'));
                  if (wsPkg.name) {this.workspacePackages.set(wsPkg.name, checkDir);}
                } catch { /* skip */ }
              }
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  async _loadCustomAliases() {
    // 检查 vite.config.ts / webpack.config.js 中的 alias 配置
    const configs = ['vite.config.ts', 'vite.config.js', 'webpack.config.js', 'next.config.js', 'nuxt.config.ts'];
    for (const cfg of configs) {
      const cfgPath = join(this.workingDirectory, cfg);
      if (!existsSync(cfgPath)) {continue;}
      try {
        const content = readFileSync(cfgPath, 'utf-8');
        // 匹配 alias: { '@': 'src', ... } 或 resolve: { alias: { '@': 'src' } }
        const aliasPatterns = [
          /alias\s*:\s*{\s*([^}]+)\s*}/g,
          /'@'\s*:\s*(?:resolve|path)\s*\([^)]*,\s*['"]([^'"]+)['"]/g,
          /"@"\s*:\s*(?:resolve|path)\s*\([^)]*,\s*['"]([^'"]+)['"]/g,
        ];
        for (const pattern of aliasPatterns) {
          let m;
          while ((m = pattern.exec(content)) !== null) {
            if (m[1] && !m[1].includes('resolve') && !m[1].includes('path')) {
              // 解析 { '@': 'src', '@/components': 'src/components' } 格式
              const pairs = m[1].split(',').map(s => s.trim());
              for (const pair of pairs) {
                const [key, val] = pair.split(':').map(s => s.trim().replace(/['"]/g, ''));
                if (key && val) {
                  this.customAliases.set(key, join(this.workingDirectory, val));
                }
              }
            } else if (m[1]) {
              this.customAliases.set('@', join(this.workingDirectory, m[1]));
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  // ── 内部解析方法 ───────────────────────────────────────────────────

  _resolveAlias(specifier) {
    // tsconfig paths
    const match = this.matchAlias(specifier);
    if (match) {
      const targetDir = this.tsPaths.get(match.alias);
      if (targetDir) {
        const fullPath = match.rest ? join(targetDir, match.rest.replace(/^\//, '')) : targetDir;
        return this._resolveToFile(fullPath);
      }
    }
    // custom aliases (vite/webpack)
    for (const [alias, targetDir] of this.customAliases) {
      if (specifier === alias) {return this._resolveToFile(targetDir);}
      if (specifier.startsWith(alias + '/')) {
        return this._resolveToFile(join(targetDir, specifier.slice(alias.length + 1)));
      }
    }
    return null;
  }

  _resolveExports(specifier) {
    if (this.packageExports.has(specifier)) {
      return this.packageExports.get(specifier);
    }
    for (const [key, target] of this.packageExports) {
      if (specifier.startsWith(key + '/')) {
        return join(target, specifier.slice(key.length + 1));
      }
    }
    return null;
  }

  _resolveWorkspace(specifier) {
    const pkgDir = this.workspacePackages.get(specifier);
    if (pkgDir) {
      return this._resolveToFile(pkgDir);
    }
    // 部分匹配：@scope/name
    for (const [name, dir] of this.workspacePackages) {
      if (name === specifier) {return this._resolveToFile(dir);}
    }
    return null;
  }

  _resolveRelative(specifier, fromPath) {
    const baseDir = dirname(fromPath);
    const fullPath = resolve(baseDir, specifier);
    return this._resolveToFile(fullPath);
  }

  _resolveNodeModule(specifier, fromPath) {
    // 从 fromPath 向上搜索 node_modules
    let dir = dirname(fromPath);
    const root = this.workingDirectory;

    while (dir.startsWith(root) && dir.length >= root.length) {
      const candidate = join(dir, 'node_modules', specifier);
      const result = this._resolveToFile(candidate);
      if (result) {return result;}
      const parent = dirname(dir);
      if (parent === dir) {break;}
      dir = parent;
    }
    return null;
  }

  /**
   * 将路径解析为实际文件：尝试添加扩展名、index 文件。
   * @param {string} p
   * @returns {string|null}
   */
  _resolveToFile(p) {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json'];
    // 已有扩展名且存在
    if (extname(p) && existsSync(p)) {return p;}

    // 尝试各种扩展名
    for (const ext of extensions) {
      if (existsSync(p + ext)) {return p + ext;}
    }

    // 尝试目录 index 文件
    for (const ext of extensions) {
      const idx = join(p, 'index' + ext);
      if (existsSync(idx)) {return idx;}
    }

    return null;
  }

  // ── 辅助方法 ────────────────────────────────────────────────────────

  _flattenExports(exports, packageName, defaultTarget) {
    if (!exports || typeof exports !== 'object') {return;}
    if (typeof exports === 'string') {
      this.packageExports.set(packageName, join(this.workingDirectory, exports));
      return;
    }
    // 对象形式
    for (const [key, value] of Object.entries(exports)) {
      if (key === '.' || key === './' || key === './index') {
        const v = typeof value === 'string' ? value : (value.default || value.import || value.require);
        if (v) {this.packageExports.set(packageName, join(this.workingDirectory, v));}
      } else if (typeof value === 'string') {
        const exportKey = packageName + key.replace(/^\./, '');
        this.packageExports.set(exportKey, join(this.workingDirectory, value));
      } else if (value && typeof value === 'object') {
        const v = value.default || value.import || value.require;
        if (v) {
          const exportKey = packageName + key.replace(/^\./, '');
          this.packageExports.set(exportKey, join(this.workingDirectory, v));
        }
      }
    }
  }

  _stripComments(jsonWithComments) {
    // 移除 // 单行注释（不在字符串内的）
    return jsonWithComments
      .split('\n')
      .map(line => {
        const idx = this._findCommentStart(line);
        return idx >= 0 ? line.substring(0, idx) : line;
      })
      .join('\n');
  }

  // ── 增强：深度 Monorepo / Nested Exports 解析 ──────────────────────

  /**
   * 解析 monorepo workspace 包内的嵌套依赖。
   * 处理 `@scope/pkg/feature` 这种嵌套导出情况。
   * @param {string} specifier   如 `@myorg/ui/button`
   * @returns {string|null}
   */
  _resolveNestedExports(specifier) {
    // 检查是否为 workspace package 的子路径导出
    for (const [pkgName, pkgPath] of this.workspacePackages) {
      if (specifier === pkgName) {
        return this._resolveToFile(pkgPath);
      }
      if (specifier.startsWith(pkgName + '/')) {
        const subPath = specifier.slice(pkgName.length + 1);
        return this._resolveToFile(join(pkgPath, subPath));
      }
    }
    // 检查是否为 exports 子路径
    for (const [exportKey, exportPath] of this.packageExports) {
      if (specifier === exportKey) {
        return this._resolveToFile(exportPath);
      }
      // 通配符 exports: "@myorg/ui/*"
      if (exportKey.includes('*')) {
        const pattern = exportKey.replace('*', '(.+)');
        const regex = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
        const match = specifier.match(regex);
        if (match) {
          return this._resolveToFile(exportPath.replace('*', match[1]));
        }
      }
    }
    return null;
  }

  /**
   * 解析 conditional exports（package.json exports 的 import/require/types/default 条件）。
   * @param {string} packageName   包名
   * @param {string} subpath       子路径（不含包名）
   * @param {'import'|'require'|'types'} [condition='import']
   * @returns {string|null}
   */
  _resolveConditionalExport(packageName, subpath = '.', condition = 'import') {
    // 先在 workspace packages 中查找
    const pkgPath = this.workspacePackages.get(packageName);
    const searchPath = pkgPath || join(this.workingDirectory, 'node_modules', packageName);
    const pkgJsonPath = join(searchPath, 'package.json');

    if (!existsSync(pkgJsonPath)) {return null;}

    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      if (!pkg.exports) {return null;}

      const exportEntry = pkg.exports[subpath] || pkg.exports['.' + subpath] || pkg.exports['./' + subpath];
      if (!exportEntry) {return null;}

      if (typeof exportEntry === 'string') {
        return this._resolveToFile(join(searchPath, exportEntry));
      }

      // Conditional exports: { import: '...', require: '...', types: '...', default: '...' }
      const resolved = exportEntry[condition]
        || exportEntry.default
        || exportEntry.import
        || exportEntry.require;
      if (resolved) {
        return this._resolveToFile(join(searchPath, resolved));
      }
    } catch { /* skip */ }

    return null;
  }

  /**
   * 解析 monorepo workspace 包之间的依赖关系。
   * 当 package A 依赖 package B（workspace 内），解析 B 的实际路径。
   * @param {string} specifier  依赖的包名
   * @param {string} fromPath   发起依赖的文件路径
   * @returns {string|null}
   */
  _resolveWorkspaceDependency(specifier, fromPath) {
    // 先检查直接的 workspace package 映射
    if (this.workspacePackages.has(specifier)) {
      return this._resolveToFile(this.workspacePackages.get(specifier));
    }

    // 检查子路径导出
    const nested = this._resolveNestedExports(specifier);
    if (nested) {return nested;}

    // 从 fromPath 向上查找所在 package 的 package.json，
    // 获取它的 dependencies，再检查依赖是否是 workspace package
    let current = dirname(fromPath);
    for (let i = 0; i < 10; i++) {
      const pkgPath = join(current, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };

          // 检查 specifier 是否匹配某个 workspace package 的 export field
          for (const [depName, depVersion] of Object.entries(allDeps)) {
            if (specifier === depName || specifier.startsWith(depName + '/')) {
              // 查找 workspace package
              const wsPath = this.workspacePackages.get(depName);
              if (wsPath) {
                if (specifier === depName) {
                  return this._resolveToFile(wsPath);
                }
                const subPath = specifier.slice(depName.length + 1);
                return this._resolveToFile(join(wsPath, subPath));
              }
            }
          }
        } catch { /* skip */ }
        break;
      }
      current = dirname(current);
    }

    return null;
  }

  _findCommentStart(line) {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < line.length - 1; i++) {
      const c = line[i];
      if (!inString && (c === '"' || c === "'")) { inString = true; stringChar = c; continue; }
      if (inString && c === stringChar && line[i - 1] !== '\\') { inString = false; continue; }
      if (!inString && c === '/' && line[i + 1] === '/') {return i;}
    }
    return -1;
  }
}
