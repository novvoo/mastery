/**
 * On-Demand Context Expansion System - 按需上下文扩展系统
 *
 * 核心架构：
 * Hash Anchor 解决"改哪里"，动态上下文扩展解决"为什么这样改"
 *
 * 只有两者同时存在，才能既降低编辑成本，又不牺牲代码理解能力
 *
 * 核心洞察：
 * - Hash Anchor 的价值不是"减少上下文"，而是**按需加载（load on demand）**
 * - 减少上下文只是副作用
 * - **按需获取正确上下文才是避免幻觉的关键**
 */

import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { SymbolIndex } from './symbol-index.js';
import { DependencyGraph } from './dependency-graph.js';
import { ASTMetadataExtractor } from './ast-metadata.js';
import { ContentAddressableStore } from './content-addressing.js';

/**
 * 置信度级别
 */
const CONFIDENCE_HIGH = 'high';
const CONFIDENCE_MEDIUM = 'medium';
const CONFIDENCE_LOW = 'low';
const CONFIDENCE_UNKNOWN = 'unknown';

/**
 * 按需上下文扩展器
 *
 * 核心职责：
 * 1. 检测模型对当前上下文的置信度
 * 2. 按需扩展上下文（而非预加载）
 * 3. 生成基于证据的修改意图
 * 4. 识别潜在副作用
 */
export class OnDemandContextExpansion {
  constructor(options) {
    this._symbolIndex = options?.symbolIndex || new SymbolIndex();
    this._dependencyGraph = options?.dependencyGraph || new DependencyGraph();
    this._astExtractor = options?.astExtractor || new ASTMetadataExtractor();
    this._contentStore = new ContentAddressableStore();

    // 置信度阈值
    this._confidenceThresholds = {
      high: 0.9, // 90% 以上的置信度
      medium: 0.6, // 60% - 90%
      low: 0.3, // 30% - 60%
    };

    // 扩展缓存
    this._expansionCache = new Map();
  }

  /**
   * 索引项目文件
   */
  async indexProject(workingDirectory, filePatterns = ['**/*.{js,ts,jsx,tsx}']) {
    const { glob } = await import('glob');

    let filesIndexed = 0;
    let symbolsFound = 0;

    for (const pattern of filePatterns) {
      const files = await glob(pattern, {
        cwd: workingDirectory,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });

      for (const file of files) {
        const fullPath = resolve(workingDirectory, file);

        try {
          await this._symbolIndex.indexFile(fullPath);
          await this._dependencyGraph.addFile(fullPath);
          await this._astExtractor.extract(fullPath);

          filesIndexed++;
          const symbols = this._symbolIndex.findInFile(fullPath);
          symbolsFound += symbols.length;
        } catch (error) {
          // 忽略无法索引的文件
        }
      }
    }

    return { filesIndexed, symbolsFound };
  }

  /**
   * 检测上下文置信度
   *
   * 这是避免幻觉的关键：
   * 当置信度不足时，自动触发上下文扩展
   */
  assessConfidence(request) {
    const suggestions = [];
    let confidence = this._calculateConfidence(request);
    let reason = '';

    if (confidence >= this._confidenceThresholds.high) {
      reason = '完整的符号定义、类型信息和依赖关系已可用';
    } else if (confidence >= this._confidenceThresholds.medium) {
      reason = '部分上下文可用，建议扩展以下内容';
      suggestions.push('加载被引用函数的定义');
      suggestions.push('加载依赖的类型定义');
      suggestions.push('加载调用者/被调用者信息');
    } else if (confidence >= this._confidenceThresholds.low) {
      reason = '上下文不足，可能导致理解偏差';
      suggestions.push('加载完整的符号定义');
      suggestions.push('加载相关的依赖图');
      suggestions.push('加载类型信息');
    } else {
      reason = '上下文严重不足，无法做出可靠决策';
      suggestions.push('加载完整的文件内容');
      suggestions.push('加载所有相关的符号定义');
      suggestions.push('加载依赖和引用关系');
    }

    return {
      level: this._getConfidenceLevel(confidence),
      reason,
      expansionNeeded: confidence < this._confidenceThresholds.high,
      suggestions,
    };
  }

  /**
   * 按需扩展上下文
   *
   * 核心原则：
   * - 只加载实际需要的上下文
   * - 返回结构化的、可验证的信息
   * - 附带置信度评估
   */
  async expandContext(request) {
    // 检查缓存
    const cacheKey = this._generateCacheKey(request);
    const cached = this._expansionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = {
      confidence: CONFIDENCE_UNKNOWN,
      confidenceReason: '',
      primaryContent: {
        type: 'file',
        name: request.file,
        definition: '',
        hash: '',
      },
      supportingContext: [],
      dependencies: [],
      recommendations: [],
      tokens: 0,
    };

    // 1. 加载主要上下文
    if (request.file) {
      const fileContext = await this._loadFileContext(
        request.file,
        request.line,
        request.contextLines,
      );
      result.primaryContent = fileContext;
      result.tokens += this._estimateTokens(fileContext.definition);
    }

    // 2. 加载符号信息
    if (request.symbolName) {
      const symbolInfo = this._symbolIndex.findByName(request.symbolName);
      for (const sym of symbolInfo) {
        result.supportingContext.push({
          type: 'reference',
          name: sym.name,
          file: sym.file,
          preview: sym.signature || sym.type,
          importance: 'critical',
        });
      }
    }

    // 3. 加载依赖信息
    if (request.file && request.dependencyLevel) {
      const deps = this._dependencyGraph.getTransitiveDependencies(
        request.file,
        request.dependencyLevel,
      );

      result.dependencies = deps.map((d) => ({
        file: d.path,
        symbols: d.dependencies.map((dep) => dep.target).filter(Boolean),
        distance: d.depth,
      }));

      for (const dep of deps.slice(0, 5)) {
        const depSymbols = this._symbolIndex.findInFile(dep.path);
        result.supportingContext.push({
          type: 'dependency',
          name: dep.path,
          file: dep.path,
          preview: `${depSymbols.length} symbols`,
          importance: dep.depth === 1 ? 'critical' : 'helpful',
        });
      }
    }

    // 4. 计算置信度
    const confidenceResult = this.assessConfidence(request);
    result.confidence = confidenceResult.level;
    result.confidenceReason = confidenceResult.reason;
    result.recommendations = confidenceResult.suggestions;

    // 缓存结果
    this._expansionCache.set(cacheKey, result);

    return result;
  }

  /**
   * 生成基于证据的修改意图
   *
   * 这是避免幻觉的核心：
   * - 模型生成的是"基于证据的修改意图"
   * - 而非"基于不完整上下文的代码臆测"
   */
  async generateEvidenceBasedIntent(request) {
    const intent = {
      target: {
        file: request.targetFile,
      },
      intent: request.changeType,
      evidence: {
        reason: request.changeDescription,
        confidence: CONFIDENCE_UNKNOWN,
        supportingFacts: [],
        missingInformation: [],
      },
      requiredContext: {
        toLoad: [],
        reason: '',
      },
      potentialSideEffects: [],
    };

    // 1. 收集证据
    const facts = [];
    const missingInfo = [];

    // 检查文件是否存在
    if (existsSync(request.targetFile)) {
      facts.push(`文件 ${request.targetFile} 存在`);

      // 检查符号定义
      const symbols = this._symbolIndex.findInFile(request.targetFile);
      if (symbols.length > 0) {
        facts.push(`文件包含 ${symbols.length} 个符号定义`);
      } else {
        missingInfo.push('文件符号定义不可用');
      }

      // 检查依赖关系
      const impact = this._dependencyGraph.analyzeImpact(request.targetFile);
      if (impact.directlyAffectedBy.length > 0) {
        facts.push(`有 ${impact.directlyAffectedBy.length} 个文件依赖此文件`);
        intent.potentialSideEffects.push(
          ...impact.transitivelyAffectedBy.slice(0, 3).map((f) => ({
            file: f.path,
            reason: '此文件被修改可能影响依赖方',
            severity: 'medium',
          })),
        );
      }
    } else {
      missingInfo.push('目标文件不存在');
    }

    // 2. 评估置信度
    const confidence = this.assessConfidence({ file: request.targetFile });
    intent.evidence.confidence = confidence.level;
    intent.evidence.supportingFacts = facts;
    intent.evidence.missingInformation = missingInfo;

    // 3. 确定需要的上下文
    if (confidence.expansionNeeded) {
      intent.requiredContext.toLoad = confidence.suggestions;
      intent.requiredContext.reason = '当前置信度不足，需要扩展上下文以避免误判';
    }

    return intent;
  }

  /**
   * 批量扩展上下文（用于复杂修改）
   */
  async expandContextBatch(requests) {
    return Promise.all(requests.map((r) => this.expandContext(r)));
  }

  /**
   * 获取符号的完整上下文（包括定义、调用者、被调用者）
   */
  async getSymbolFullContext(symbolName, filePath) {
    // 查找定义
    let definitions = this._symbolIndex.findByName(symbolName);
    if (filePath) {
      definitions = definitions.filter((d) => d.file === filePath);
    }
    const definition = definitions[0] || null;

    // 查找调用者
    const callers = [];
    const callees = [];

    if (definition) {
      // 获取 AST 元数据
      const astData = await this._astExtractor.extract(definition.file);
      const funcMeta = astData.functions.find((f) => f.name === symbolName);

      if (funcMeta) {
        // 查找调用者
        for (const called of funcMeta.calls) {
          const calledDefs = this._symbolIndex.findByName(called);
          callees.push(...calledDefs);
        }
      }

      // 通过依赖图查找调用者
      const dependents = this._dependencyGraph.getDependents(definition.file);
      for (const depFile of dependents) {
        const depSymbols = this._symbolIndex.findInFile(depFile);
        for (const sym of depSymbols) {
          const depAst = await this._astExtractor.extract(depFile);
          const depFunc = depAst.functions.find((f) => f.calls.includes(symbolName));
          if (depFunc) {
            callers.push(sym);
          }
        }
      }
    }

    // 获取上下文
    let context = '';
    if (definition) {
      const contextResult = await this._symbolIndex.getSymbolContext(
        definition.file,
        definition.line,
        30,
      );
      context = contextResult?.context || '';
    }

    // 获取类型信息
    let typeInfo = null;
    if (definition) {
      const astData = await this._astExtractor.extract(definition.file);
      typeInfo =
        astData.functions.find((f) => f.name === symbolName) ||
        astData.classes.find((f) => f.name === symbolName) ||
        null;
    }

    return {
      definition,
      callers,
      callees,
      typeInfo,
      context,
    };
  }

  /**
   * 加载文件上下文
   */
  async _loadFileContext(filePath, line, contextLines) {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    let definition = content;
    let type = 'file';

    // 如果指定了行号，提取局部上下文
    if (line !== undefined) {
      const symbols = this._symbolIndex.findInFile(filePath);
      const symbol = symbols.find((s) => s.line <= line && s.endLine >= line);

      if (symbol) {
        const start = Math.max(0, symbol.line - 1);
        const end = Math.min(lines.length, symbol.endLine);
        definition = lines.slice(start, end).join('\n');
        type =
          symbol.type === 'function' || symbol.type === 'method'
            ? 'function'
            : symbol.type === 'class'
              ? 'class'
              : 'symbol';
      } else if (contextLines) {
        const start = Math.max(0, line - 1 - contextLines);
        const end = Math.min(lines.length, line + contextLines);
        definition = lines.slice(start, end).join('\n');
        type = 'symbol';
      }
    }

    const hash = this._contentStore.storeBlob(definition);

    return {
      type,
      name: filePath.split('/').pop(),
      definition,
      hash,
    };
  }

  /**
   * 计算置信度
   */
  _calculateConfidence(request) {
    let score = 0;
    let maxScore = 0;

    // 1. 文件存在性 (权重 20%)
    maxScore += 20;
    if (request.file && existsSync(request.file)) {
      score += 20;
    }

    // 2. 符号索引 (权重 30%)
    maxScore += 30;
    if (request.symbolName) {
      const symbols = this._symbolIndex.findByName(request.symbolName);
      if (symbols.length > 0) {
        score += 30;
      }
    }

    // 3. 依赖图 (权重 20%)
    maxScore += 20;
    if (request.file) {
      const deps = this._dependencyGraph.getDirectDependencies(request.file);
      if (deps.length > 0 || this._dependencyGraph.getDependents(request.file).length > 0) {
        score += 20;
      }
    }

    // 4. AST 元数据 (权重 30%)
    maxScore += 30;
    if (request.file) {
      const astData = this._astExtractor.getCodeRegion(request.file, request.line || 1);
      if (astData) {
        score += 30;
      }
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * 获取置信度级别
   */
  _getConfidenceLevel(score) {
    if (score >= this._confidenceThresholds.high) {
      return CONFIDENCE_HIGH;
    }
    if (score >= this._confidenceThresholds.medium) {
      return CONFIDENCE_MEDIUM;
    }
    if (score >= this._confidenceThresholds.low) {
      return CONFIDENCE_LOW;
    }
    return CONFIDENCE_UNKNOWN;
  }

  /**
   * 生成缓存键
   */
  _generateCacheKey(request) {
    return JSON.stringify(request);
  }

  /**
   * 估算 token 数量
   */
  _estimateTokens(text) {
    // 简单估算：中文约 1.5 tokens/字符，英文约 0.25 tokens/字符
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 1.5 + otherChars * 0.25);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      symbolIndex: this._symbolIndex.getStats(),
      dependencyGraph: this._dependencyGraph.getStats(),
      expansionCache: this._expansionCache.size,
    };
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._expansionCache.clear();
  }
}

export default OnDemandContextExpansion;
