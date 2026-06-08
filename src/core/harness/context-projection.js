/**
 * Context Projection System
 * 
 * 核心思想：
 * 上下文仅作为状态图在当前任务下的局部投影（Context Projection）
 * 
 * 状态图是完整的、持久化的；上下文是短暂的、按需的。
 */

import { StateGraph, ContextProjectionEngine } from './state-graph-core';
import { CompleteIndex, SymbolIndexer, DependencyAnalyzer } from './content-addressable-store';

// ==================== 投影策略 ====================

type ProjectionStrategy = 
  | 'symbol_and_context'       // 符号及其上下文
  | 'dependencies_only'         // 仅依赖关系
  | 'file_and_dependencies'     // 文件及其依赖
  | 'complete_with_history'     // 完整视图（含历史）
  | 'minimal_for_task';         // 任务所需最小视图

interface ProjectionOptions {
  strategy: ProjectionStrategy;
  includeHistory?: boolean;
  maxDepth?: number;
  maxTokens?: number;
  includeSymbols?: boolean;
  includeDependencies?: boolean;
}

// ==================== 投影生成器 ====================

export class ContextProjectionGenerator {
  private graph: StateGraph;
  private index: CompleteIndex;
  private engine: ContextProjectionEngine;

  constructor(graph: StateGraph, index: CompleteIndex) {
    this.graph = graph;
    this.index = index;
    this.engine = new ContextProjectionEngine(graph);
  }

  /**
   * 为编辑任务生成投影
   */
  projectForEditing(
    filePath: string, 
    lineNumber: number, 
    options?: Partial<ProjectionOptions>
  ): string {
    const opts: ProjectionOptions = {
      strategy: 'symbol_and_context',
      includeHistory: true,
      maxDepth: 3,
      ...options
    };
    
    const projectionId = `edit:${filePath}:${lineNumber}:${Date.now()}`;
    
    // 找到相关的符号
    const relatedSymbols = this.index.symbols.findInFile(filePath);
    const relevantSymbol = relatedSymbols.find(s => 
      lineNumber >= s.startLine && lineNumber <= s.endLine
    ) || relatedSymbols[0];
    
    const nodeIds: string[] = [];
    
    // 添加符号节点
    if (relevantSymbol) {
      const symbolNodes = this.index.symbols.findByName(relevantSymbol.name);
      nodeIds.push(...symbolNodes.map(s => {
        // 存储中查找
        const store = this.index.store;
        // 简化实现：返回占位符
        return 'symbol:' + relevantSymbol.name;
      }));
    }
    
    // 添加文件节点
    const fileNode = this.graph.createNode('file', { path: filePath }, []);
    nodeIds.push(fileNode.id);
    
    // 添加依赖关系
    if (opts.includeDependencies) {
      const impact = this.index.dependencies.analyzeImpact(filePath);
      for (const dep of impact.directDeps.slice(0, 5)) {
        nodeIds.push('dep:' + dep);
      }
    }
    
    const projection = this.engine.project(
      projectionId,
      'Editing file: ' + filePath,
      nodeIds,
      this.generateAdditionalContext(filePath, lineNumber, relevantSymbol)
    );
    
    return projection.context;
  }

  /**
   * 为理解任务生成投影
   */
  projectForUnderstanding(
    query: string, 
    relevantFiles: string[],
    options?: Partial<ProjectionOptions>
  ): string {
    const opts: ProjectionOptions = {
      strategy: 'minimal_for_task',
      includeDependencies: true,
      ...options
    };
    
    const projectionId = `understand:${Date.now()}`;
    
    const nodeIds: string[] = [];
    
    // 添加相关文件
    for (const file of relevantFiles.slice(0, 3)) {
      const symbols = this.index.symbols.findInFile(file);
      for (const symbol of symbols.slice(0, 5)) {
        nodeIds.push('symbol:' + symbol.name);
      }
      nodeIds.push('file:' + file);
    }
    
    // 投影
    const projection = this.engine.project(
      projectionId,
      'Understanding query: ' + query.substring(0, 50),
      nodeIds,
      `\nQuery context: ${query}\n`
    );
    
    return projection.context;
  }

  /**
   * 生成智能投影：根据任务自动选择内容
   */
  projectSmart(
    taskType: 'edit' | 'understand' | 'debug' | 'refactor',
    focus: { filePath?: string, symbolName?: string, query?: string },
    options?: Partial<ProjectionOptions>
  ): string {
    if (taskType === 'edit' && focus.filePath && focus.symbolName) {
      const symbols = this.index.symbols.findByName(focus.symbolName);
      if (symbols.length > 0) {
        return this.projectForEditing(
          symbols[0].file, 
          symbols[0].startLine, 
          options
        );
      }
    }
    
    if (taskType === 'understand' && focus.query) {
      const relevantFiles: string[] = []; // 实际应该通过查询找到
      return this.projectForUnderstanding(
        focus.query, 
        relevantFiles,
        options
      );
    }
    
    // 默认返回最小投影
    return this.projectMinimal();
  }

  /**
   * 最小投影
   */
  projectMinimal(): string {
    const stats = this.index.getStats();
    return `## Project State Summary

Files: ${stats.files}
Symbols: ${stats.symbols}
Dependencies: ${stats.dependencies}

For more details, request a specific projection.
`;
  }

  /**
   * 生成额外的上下文
   */
  private generateAdditionalContext(
    filePath: string,
    lineNumber: number,
    relevantSymbol?: any
  ): string {
    const parts: string[] = [];
    
    if (relevantSymbol) {
      parts.push(`\n## Focus Symbol: ${relevantSymbol.name}`);
      parts.push(`Type: ${relevantSymbol.type}`);
      parts.push(`Location: ${filePath}:${relevantSymbol.startLine}`);
      
      if (relevantSymbol.signature) {
        parts.push(`Signature: ${relevantSymbol.signature}`);
      }
    }
    
    // 添加依赖信息
    const impact = this.index.dependencies.analyzeImpact(filePath);
    parts.push(`\n## Impact Analysis`);
    parts.push(`Direct dependencies: ${impact.directDeps.length}`);
    parts.push(`Files depending on this: ${impact.dependents.length}`);
    
    if (impact.transitiveDependents.length > 0) {
      parts.push(`Files potentially affected (transitive): ${impact.transitiveDependents.length}`);
    }
    
    return parts.join('\n');
  }

  /**
   * 获取投影引擎
   */
  getEngine(): ContextProjectionEngine {
    return this.engine;
  }
}

// ==================== 历史投影 ====================

export class HistoryProjection {
  private graph: StateGraph;

  constructor(graph: StateGraph) {
    this.graph = graph;
  }

  /**
   * 生成历史视图
   */
  generateHistoryView(limit: number = 10): string {
    const history = this.graph.getHistory(limit);
    const lines: string[] = [];
    
    lines.push('## State Graph History\n');
    
    for (const node of history) {
      const date = new Date(node.timestamp).toISOString();
      lines.push(`- ${date} [${node.id.substring(0, 8)}]: ${node.data?.message || 'Commit'}`);
      
      if (node.data?.changes) {
        const changes = node.data.changes;
        lines.push(`  Changes: ${changes.length}`);
      }
    }
    
    lines.push('\n---');
    return lines.join('\n');
  }

  /**
   * 生成差异视图
   */
  generateDiffView(fromCommitId: string, toCommitId: string): string {
    const diff = this.graph.getDiff(fromCommitId, toCommitId);
    const lines: string[] = [];
    
    lines.push(`## Diff: ${fromCommitId.substring(0, 8)} → ${toCommitId.substring(0, 8)}`);
    lines.push('');
    
    if (diff.length === 0) {
      lines.push('(no changes)');
    } else {
      for (const change of diff) {
        const icon = change.type === 'add' ? '+' :
                    change.type === 'delete' ? '-' : '~';
        lines.push(`${icon} ${change.type.toUpperCase()} ${change.nodeId.substring(0, 12)}`);
      }
    }
    
    return lines.join('\n');
  }
}

// ==================== 导出 ====================

export default {
  ContextProjectionGenerator,
  HistoryProjection
};
