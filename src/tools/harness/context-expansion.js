/**
 * Context Expansion Tools - 上下文扩展工具
 *
 * 提供 Agent 主动扩展上下文的接口
 * 实现"按需加载（load on demand）"而非"预加载（preload everything）"
 */

import { ToolCategory } from '../../core/types/index.js';
import { OnDemandContextExpansion } from '../../core/harness/on-demand-context.js';
import { SymbolIndex } from '../../core/harness/symbol-index.js';
import { DependencyGraph } from '../../core/harness/dependency-graph.js';
import { resolve, join } from 'path';

// 全局实例（实际项目应该与 Session 绑定）
let globalExpander = null;
let globalSymbolIndex = null;
let globalDepGraph = null;

/**
 * 初始化上下文扩展器
 */
function initializeExpander(workingDirectory) {
  if (!globalExpander) {
    globalSymbolIndex = new SymbolIndex();
    globalDepGraph = new DependencyGraph();
    globalExpander = new OnDemandContextExpansion({
      symbolIndex: globalSymbolIndex,
      dependencyGraph: globalDepGraph,
    });
  }
  return globalExpander;
}

/**
 * 创建上下文扩展工具
 */
export function createContextExpansionTools(workingDirectory) {
  initializeExpander(workingDirectory);

  return [
    /**
     * context_index - 索引项目文件
     */
    {
      name: 'context_index',
      description:
        '索引项目文件，构建符号索引、依赖关系图和 AST 元数据。这是使用其他上下文扩展工具的前置步骤。',
      category: ToolCategory.FILESYSTEM,
      params: {
        file_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: '要索引的文件模式，如 ["**/*.js", "**/*.ts"]',
          default: ['**/*.{js,ts,jsx,tsx}'],
        },
      },
      required: [],
      handler: async ({ file_patterns }, ctx) => {
        try {
          const result = await globalExpander.indexProject(
            ctx.workingDirectory,
            file_patterns || ['**/*.{js,ts,jsx,tsx}'],
          );

          const stats = globalExpander.getStats();

          return (
            `项目索引完成\n` +
            `  文件数: ${result.filesIndexed}\n` +
            `  符号数: ${result.symbolsFound}\n` +
            `  依赖关系: ${stats.dependencyGraph.files} 个文件\n` +
            `  缓存条目: ${stats.expansionCache}\n\n` +
            `现在可以使用 context_expand 或 context_assess 工具了。`
          );
        } catch (error) {
          return `索引失败: ${error}`;
        }
      },
    },

    /**
     * context_assess - 评估上下文置信度
     */
    {
      name: 'context_assess',
      description:
        '评估当前上下文对特定目标的置信度。当置信度不足时，建议使用 context_expand 扩展上下文。',
      category: ToolCategory.FILESYSTEM,
      params: {
        file: { type: 'string', description: '目标文件路径' },
        line: { type: 'number', description: '目标行号（可选）' },
        symbol_name: { type: 'string', description: '符号名称（可选）' },
        anchor_hash: { type: 'string', description: '锚点哈希（可选）' },
      },
      required: ['file'],
      handler: async ({ file, line, symbol_name, anchor_hash }, ctx) => {
        const fullPath = resolve(ctx.workingDirectory, file);

        const result = globalExpander.assessConfidence({
          file: fullPath,
          line,
          symbolName: symbol_name,
          anchorHash: anchor_hash,
        });

        const confidenceIcon = {
          high: '✅',
          medium: '⚠️',
          low: '❌',
          unknown: '❓',
        }[result.level];

        let response = `上下文置信度评估: ${confidenceIcon} ${result.level.toUpperCase()}\n\n`;
        response += `原因: ${result.reason}\n\n`;

        if (result.expansionNeeded) {
          response += `需要扩展的内容:\n`;
          for (const suggestion of result.suggestions) {
            response += `  - ${suggestion}\n`;
          }
          response += `\n建议: 使用 context_expand 工具扩展上下文`;
        } else {
          response += `✅ 当前上下文足够，可以进行可靠的分析和修改`;
        }

        return response;
      },
    },

    /**
     * context_expand - 按需扩展上下文
     */
    {
      name: 'context_expand',
      description:
        '按需扩展上下文（load on demand），只加载实际需要的部分，而非整个文件。这避免了上下文膨胀，同时确保模型有足够的信息做出正确决策。',
      category: ToolCategory.FILESYSTEM,
      params: {
        file: { type: 'string', description: '目标文件路径' },
        line: { type: 'number', description: '目标行号（可选）' },
        symbol_name: { type: 'string', description: '符号名称（可选）' },
        dependency_level: {
          type: 'number',
          description: '依赖扩展深度（0-3），0 表示不加载依赖',
          default: 1,
        },
        context_lines: { type: 'number', description: '周围上下文行数', default: 30 },
      },
      required: ['file'],
      handler: async ({ file, line, symbol_name, dependency_level, context_lines }, ctx) => {
        const fullPath = resolve(ctx.workingDirectory, file);

        const result = await globalExpander.expandContext({
          file: fullPath,
          line,
          symbolName: symbol_name,
          dependencyLevel: dependency_level,
          contextLines: context_lines,
        });

        let response = `上下文扩展结果\n`;
        response += `${'='.repeat(60)}\n\n`;

        // 置信度
        const confidenceIcon = { high: '✅', medium: '⚠️', low: '❌', unknown: '❓' };
        response += `置信度: ${confidenceIcon[result.confidence]} ${result.confidence.toUpperCase()}\n`;
        response += `原因: ${result.confidenceReason}\n`;
        response += `Token 消耗: ~${result.tokens}\n\n`;

        // 主要内容
        response += `主要内容 (${result.primaryContent.type}):\n`;
        response += `${'-'.repeat(60)}\n`;
        response += result.primaryContent.definition.substring(0, 1500);
        if (result.primaryContent.definition.length > 1500) {
          response += `\n... (截断显示，完整内容已加载)`;
        }
        response += `\n\n`;

        // 支持上下文
        if (result.supportingContext.length > 0) {
          response += `支持上下文:\n`;
          for (const item of result.supportingContext.slice(0, 10)) {
            const importanceIcon = { critical: '🔴', helpful: '🟡', optional: '⚪' };
            response += `  ${importanceIcon[item.importance]} ${item.type}: ${item.name} (${item.file})\n`;
            response += `     预览: ${item.preview}\n`;
          }
          response += `\n`;
        }

        // 依赖
        if (result.dependencies.length > 0) {
          response += `依赖关系:\n`;
          for (const dep of result.dependencies.slice(0, 5)) {
            response += `  ${'  '.repeat(dep.distance)}→ ${dep.file}\n`;
          }
          response += `\n`;
        }

        // 建议
        if (result.recommendations.length > 0) {
          response += `建议:\n`;
          for (const rec of result.recommendations) {
            response += `  - ${rec}\n`;
          }
        }

        return response;
      },
    },

    /**
     * context_expand_symbol - 获取符号的完整上下文
     */
    {
      name: 'context_expand_symbol',
      description:
        '获取特定符号的完整上下文，包括定义、调用者、被调用者、类型信息。这对于理解函数的用途和影响范围至关重要。',
      category: ToolCategory.FILESYSTEM,
      params: {
        symbol_name: { type: 'string', description: '符号名称' },
        file: { type: 'string', description: '文件路径（可选，限定搜索范围）' },
      },
      required: ['symbol_name'],
      handler: async ({ symbol_name, file }, ctx) => {
        const fullPath = file ? resolve(ctx.workingDirectory, file) : undefined;

        const result = await globalExpander.getSymbolFullContext(symbol_name, fullPath);

        let response = `符号 "${symbol_name}" 的完整上下文\n`;
        response += `${'='.repeat(60)}\n\n`;

        // 定义
        if (result.definition) {
          response += `定义:\n`;
          response += `  文件: ${result.definition.file}\n`;
          response += `  行号: ${result.definition.line}\n`;
          response += `  类型: ${result.definition.type}\n`;
          if (result.definition.signature) {
            response += `  签名: ${result.definition.signature}\n`;
          }
          response += `\n代码上下文:\n`;
          response += `${'-'.repeat(60)}\n`;
          response += result.context.substring(0, 2000);
          response += `\n\n`;
        } else {
          response += `❌ 未找到符号 "${symbol_name}" 的定义\n\n`;
        }

        // 类型信息
        if (result.typeInfo) {
          response += `类型信息:\n`;
          if ('params' in result.typeInfo) {
            response += `  参数: ${result.typeInfo.params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ')}\n`;
            if (result.typeInfo.returnType) {
              response += `  返回: ${result.typeInfo.returnType}\n`;
            }
            response += `  圈复杂度: ${result.typeInfo.complexity}\n`;
          }
          response += `\n`;
        }

        // 调用者
        if (result.callers.length > 0) {
          response += `调用者 (${result.callers.length}):\n`;
          for (const caller of result.callers.slice(0, 5)) {
            response += `  - ${caller.name} (${caller.file}:${caller.line})\n`;
          }
          response += `\n`;
        }

        // 被调用者
        if (result.callees.length > 0) {
          response += `被调用者 (${result.callees.length}):\n`;
          for (const callee of result.callees.slice(0, 5)) {
            response += `  - ${callee.name} (${callee.file}:${callee.line})\n`;
          }
          response += `\n`;
        }

        return response;
      },
    },

    /**
     * context_query - 查询符号和依赖
     */
    {
      name: 'context_query',
      description: '查询符号索引和依赖关系图，快速定位符号定义或依赖关系。',
      category: ToolCategory.FILESYSTEM,
      params: {
        query_type: {
          type: 'string',
          enum: ['symbol', 'type', 'dependency', 'impact'],
          description: '查询类型',
        },
        name: { type: 'string', description: '符号或文件名' },
        file: { type: 'string', description: '文件路径（可选）' },
      },
      required: ['query_type', 'name'],
      handler: async ({ query_type, name, file }, ctx) => {
        const fullPath = file ? resolve(ctx.workingDirectory, file) : undefined;

        switch (query_type) {
          case 'symbol': {
            const symbols = globalSymbolIndex.findByName(name);
            if (symbols.length === 0) {
              return `未找到符号 "${name}"`;
            }

            let response = `符号 "${name}" 的定义 (${symbols.length}):\n\n`;
            for (const sym of symbols) {
              response += `📍 ${sym.file}:${sym.line}\n`;
              response += `   类型: ${sym.type}\n`;
              if (sym.signature) {
                response += `   签名: ${sym.signature}\n`;
              }
              response += `\n`;
            }
            return response;
          }

          case 'type': {
            const byType = globalSymbolIndex.findByType(name);
            if (byType.length === 0) {
              return `未找到类型为 "${name}" 的符号`;
            }

            return (
              `类型为 "${name}" 的符号 (${byType.length}):\n` +
              byType
                .slice(0, 20)
                .map((s) => `  - ${s.name} (${s.file})`)
                .join('\n')
            );
          }

          case 'dependency': {
            if (!fullPath) {
              return '查询依赖需要指定 file 参数';
            }

            const deps = globalDepGraph.getDirectDependencies(fullPath);
            if (deps.length === 0) {
              return `文件 "${file}" 没有依赖`;
            }

            let response = `${file} 的直接依赖:\n\n`;
            for (const dep of deps) {
              const external = dep.isExternal ? ' [外部]' : '';
              response += `📦 ${dep.target}${external}\n`;
              if (dep.symbols && dep.symbols.length > 0) {
                response += `   导入: ${dep.symbols.join(', ')}\n`;
              }
              response += `\n`;
            }
            return response;
          }

          case 'impact': {
            if (!fullPath) {
              return '查询影响需要指定 file 参数';
            }

            const impact = globalDepGraph.analyzeImpact(fullPath);

            let response = `修改 "${file}" 的影响分析:\n\n`;

            response += `直接依赖 (此文件依赖):\n`;
            if (impact.directlyAffects.length > 0) {
              for (const dep of impact.directlyAffects) {
                response += `  📦 ${dep}\n`;
              }
            } else {
              response += `  (无)\n`;
            }
            response += `\n`;

            response += `直接被依赖 (依赖此文件):\n`;
            if (impact.directlyAffectedBy.length > 0) {
              for (const dep of impact.directlyAffectedBy) {
                response += `  📦 ${dep}\n`;
              }
            } else {
              response += `  (无)\n`;
            }
            response += `\n`;

            response += `传递影响:\n`;
            response += `  影响文件数: ${impact.transitivelyAffects.length}\n`;
            response += `  被影响文件数: ${impact.transitivelyAffectedBy.length}\n`;

            return response;
          }

          default:
            return `未知的查询类型: ${query_type}`;
        }
      },
    },

    /**
     * context_evidence - 生成基于证据的修改意图
     */
    {
      name: 'context_evidence',
      description:
        '生成基于证据的修改意图（Evidence-Based Change Intent）。这是避免幻觉的关键：模型生成的不是"基于不完整上下文的代码臆测"，而是"基于证据的修改意图"。',
      category: ToolCategory.FILESYSTEM,
      params: {
        file: { type: 'string', description: '目标文件' },
        change_type: {
          type: 'string',
          enum: ['modify', 'extend', 'delete', 'replace', 'refactor'],
          description: '修改类型',
        },
        change_description: { type: 'string', description: '修改描述' },
      },
      required: ['file', 'change_type', 'change_description'],
      handler: async ({ file, change_type, change_description }, ctx) => {
        const fullPath = resolve(ctx.workingDirectory, file);

        const result = await globalExpander.generateEvidenceBasedIntent({
          targetFile: fullPath,
          changeType: change_type,
          changeDescription: change_description,
        });

        const confidenceIcon = { high: '✅', medium: '⚠️', low: '❌', unknown: '❓' };

        let response = `基于证据的修改意图分析\n`;
        response += `${'='.repeat(60)}\n\n`;

        response += `目标: ${result.target.file}\n`;
        response += `修改类型: ${result.intent}\n`;
        response += `修改描述: ${result.evidence.reason}\n\n`;

        response += `证据评估:\n`;
        response += `  置信度: ${confidenceIcon[result.evidence.confidence]} ${result.evidence.confidence.toUpperCase()}\n\n`;

        if (result.evidence.supportingFacts.length > 0) {
          response += `支持事实:\n`;
          for (const fact of result.evidence.supportingFacts) {
            response += `  ✅ ${fact}\n`;
          }
          response += `\n`;
        }

        if (result.evidence.missingInformation.length > 0) {
          response += `缺失信息:\n`;
          for (const missing of result.evidence.missingInformation) {
            response += `  ⚠️ ${missing}\n`;
          }
          response += `\n`;
        }

        if (result.requiredContext.toLoad.length > 0) {
          response += `建议加载的上下文:\n`;
          response += `  原因: ${result.requiredContext.reason}\n`;
          for (const item of result.requiredContext.toLoad) {
            response += `  - ${item}\n`;
          }
          response += `\n`;
        }

        if (result.potentialSideEffects.length > 0) {
          response += `潜在副作用:\n`;
          for (const effect of result.potentialSideEffects) {
            const severityIcon = { high: '🔴', medium: '🟡', low: '🟢' };
            response += `  ${severityIcon[effect.severity]} ${effect.file}: ${effect.reason}\n`;
          }
        }

        return response;
      },
    },

    /**
     * context_stats - 获取索引统计
     */
    {
      name: 'context_stats',
      description: '获取上下文索引的统计信息。',
      category: ToolCategory.FILESYSTEM,
      params: {},
      required: [],
      handler: async (_, ctx) => {
        const stats = globalExpander.getStats();

        return (
          `上下文索引统计:\n\n` +
          `符号索引:\n` +
          `  文件: ${stats.symbolIndex.files}\n` +
          `  符号总数: ${stats.symbolIndex.symbols}\n` +
          `  按类型: ${JSON.stringify(stats.symbolIndex.byType)}\n\n` +
          `依赖图:\n` +
          `  文件: ${stats.dependencyGraph.files}\n` +
          `  外部模块: ${stats.dependencyGraph.externalModules}\n` +
          `  平均依赖: ${stats.dependencyGraph.avgDependencies.toFixed(2)}\n\n` +
          `扩展缓存:\n` +
          `  条目数: ${stats.expansionCache}\n`
        );
      },
    },
  ];
}

/**
 * 获取上下文扩展器实例（用于集成）
 */
export function getContextExpansionSystem() {
  initializeExpander();
  return {
    expander: globalExpander,
    symbolIndex: globalSymbolIndex,
    dependencyGraph: globalDepGraph,
  };
}

export default {
  createContextExpansionTools,
  getContextExpansionSystem,
};
