/**
 * Symbol Index - 符号索引系统
 *
 * 提供代码中所有符号（函数、类、变量、导入等）的快速查找能力
 * 支持按需上下文扩展，理解"为什么这样改"
 */

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'node:crypto';

/**
 * 符号索引器
 */
export class SymbolIndex {
  constructor() {
    this._index = new Map();
    this._nameIndex = new Map();
    this._typeIndex = new Map();
  }

  /**
   * 索引文件
   */
  async indexFile(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    const symbols = this._extractSymbols(filePath, content);

    const fileSymbols = {
      file: filePath,
      symbols,
      hash: this._hashContent(content),
      timestamp: Date.now(),
    };

    this._index.set(filePath, fileSymbols);

    // 更新名称索引
    for (const symbol of symbols) {
      if (!this._nameIndex.has(symbol.name)) {
        this._nameIndex.set(symbol.name, []);
      }
      this._nameIndex.get(symbol.name).push(symbol);

      // 更新类型索引
      if (!this._typeIndex.has(symbol.type)) {
        this._typeIndex.set(symbol.type, []);
      }
      this._typeIndex.get(symbol.type).push(symbol);
    }

    return symbols;
  }

  /**
   * 根据名称查找符号
   */
  findByName(name) {
    return this._nameIndex.get(name) || [];
  }

  /**
   * 根据类型查找符号
   */
  findByType(type) {
    return this._typeIndex.get(type) || [];
  }

  /**
   * 查找文件中的符号
   */
  findInFile(filePath) {
    const fileSymbols = this._index.get(filePath);
    return fileSymbols ? fileSymbols.symbols : [];
  }

  /**
   * 获取符号上下文（符号及其周围的代码）
   */
  async getSymbolContext(filePath, line, contextLines = 20) {
    const fileSymbols = this._index.get(filePath);
    if (!fileSymbols) {
      return null;
    }

    const symbol = fileSymbols.symbols.find((s) => s.line <= line && s.endLine >= line);

    if (!symbol) {
      return null;
    }

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const startLine = Math.max(0, symbol.line - contextLines);
    const endLine = Math.min(lines.length, symbol.endLine + contextLines);
    const context = lines.slice(startLine, endLine).join('\n');

    return { symbol, context };
  }

  /**
   * 获取符号的完整定义（包括依赖）
   */
  async getSymbolWithDependencies(symbol, maxDepth = 2) {
    const dependencies = [];
    const visited = new Set();

    const collectDependencies = async (sym, depth) => {
      if (depth > maxDepth || visited.has(sym.hash)) {
        return;
      }
      visited.add(sym.hash);

      // 查找导入的符号
      const importedSymbols = this._nameIndex.get(sym.name) || [];
      for (const dep of importedSymbols) {
        if (dep.file !== sym.file && !visited.has(dep.hash)) {
          dependencies.push(dep);
          await collectDependencies(dep, depth + 1);
        }
      }
    };

    await collectDependencies(symbol, 0);

    // 获取上下文
    const contextResult = await this.getSymbolContext(symbol.file, symbol.line);
    const context = contextResult ? contextResult.context : '';

    return { symbol, dependencies, context };
  }

  /**
   * 提取符号（简单实现，支持 JS/TS）
   */
  _extractSymbols(filePath, content) {
    const symbols = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 函数声明
      const funcMatch = trimmed.match(
        /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/,
      );
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          type: 'function',
          file: filePath,
          line: i + 1,
          column: line.indexOf(funcMatch[1]),
          endLine: this._findBlockEnd(lines, i),
          visibility: trimmed.includes('export') ? 'public' : 'private',
          signature: this._extractSignature(lines[i]),
          hash: this._hashContent(trimmed),
        });
        continue;
      }

      // 类声明
      const classMatch = trimmed.match(/^(?:export\s+)?class\s+([a-zA-Z_$][\w$]*)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: 'class',
          file: filePath,
          line: i + 1,
          column: line.indexOf(classMatch[1]),
          endLine: this._findBlockEnd(lines, i),
          visibility: trimmed.includes('export') ? 'public' : 'private',
          hash: this._hashContent(trimmed),
        });
        continue;
      }

      // 方法声明（class 内）
      const methodMatch = trimmed.match(
        /^(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^=]+)?\s*\{/,
      );
      if (
        methodMatch &&
        methodMatch[1] !== 'if' &&
        methodMatch[1] !== 'for' &&
        methodMatch[1] !== 'while'
      ) {
        symbols.push({
          name: methodMatch[1],
          type: 'method',
          file: filePath,
          line: i + 1,
          column: line.indexOf(methodMatch[1]),
          endLine: this._findBlockEnd(lines, i),
          visibility: this._getVisibility(trimmed),
          signature: this._extractSignature(line),
          hash: this._hashContent(trimmed),
        });
        continue;
      }

      // 导入声明
      const importMatch = trimmed.match(
        /^import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/,
      );
      if (importMatch) {
        symbols.push({
          name: importMatch[1],
          type: 'import',
          file: filePath,
          line: i + 1,
          column: 0,
          endLine: i + 1,
          visibility: 'private',
          hash: this._hashContent(trimmed),
        });
        continue;
      }

      // 导出声明
      const exportMatch = trimmed.match(
        /^export\s+(?:const|let|var|function|class|interface|type)\s+([a-zA-Z_$][\w$]*)/,
      );
      if (exportMatch) {
        symbols.push({
          name: exportMatch[1],
          type: 'export',
          file: filePath,
          line: i + 1,
          column: line.indexOf(exportMatch[1]),
          endLine: this._findBlockEnd(lines, i),
          visibility: 'public',
          hash: this._hashContent(trimmed),
        });
        continue;
      }

      // 接口声明
      const interfaceMatch = trimmed.match(/^interface\s+([a-zA-Z_$][\w$]*)/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          type: 'interface',
          file: filePath,
          line: i + 1,
          column: line.indexOf(interfaceMatch[1]),
          endLine: this._findBlockEnd(lines, i),
          visibility: 'public',
          hash: this._hashContent(trimmed),
        });
        continue;
      }

      // 类型别名
      const typeMatch = trimmed.match(/^type\s+([a-zA-Z_$][\w$]*)\s*=/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          type: 'type',
          file: filePath,
          line: i + 1,
          column: line.indexOf(typeMatch[1]),
          endLine: i + 1,
          visibility: 'public',
          hash: this._hashContent(trimmed),
        });
      }
    }

    return symbols;
  }

  /**
   * 查找代码块结束行
   */
  _findBlockEnd(lines, startLine) {
    let braceCount = 0;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
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

    return startLine + 1;
  }

  /**
   * 提取函数签名
   */
  _extractSignature(line) {
    const match = line.match(/\([^)]*\)/);
    return match ? match[0] : '';
  }

  /**
   * 获取可见性
   */
  _getVisibility(line) {
    if (line.includes('private') || line.startsWith('_')) {
      return 'private';
    }
    if (line.includes('protected')) {
      return 'protected';
    }
    return 'public';
  }

  /**
   * 内容哈希
   */
  _hashContent(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 获取索引统计
   */
  getStats() {
    const byType = {};

    for (const [type, symbols] of this._typeIndex.entries()) {
      byType[type] = symbols.length;
    }

    return {
      files: this._index.size,
      symbols: Array.from(this._nameIndex.values()).reduce((sum, arr) => sum + arr.length, 0),
      byType,
    };
  }
}

export default SymbolIndex;
