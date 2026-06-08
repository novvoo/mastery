/**
 * State Graph Editing Tools
 * 
 * Agent 可使用的工具，直接操作 State Graph 而不是文件
 * 
 * 核心思想：
 * Agent 不再直接读/写文件，而是操作状态图节点，通过投影获取上下文
 */

import { ToolCategory } from '../../core/types';
import { ContentAddressableStore, StateGraph } from '../state-graph-core';
import { CompleteIndex } from '../content-addressable-store';
import { ContextProjectionGenerator } from '../context-projection';
import { readFile, writeFile, existsSync } from 'fs/promises';
import { resolve, join } from 'path';

// 全局实例（实际使用中应该与 Agent 实例绑定
let globalGraph: StateGraph | null = null;
let globalIndex: CompleteIndex | null = null;
let globalProjection: ContextProjectionGenerator | null = null;
let isInitialized = false;

/**
 * 初始化系统
 */
function ensureInitialized(workingDir: string) {
  if (!isInitialized) {
    const store = new ContentAddressableStore();
    globalGraph = new StateGraph(store);
    globalIndex = new CompleteIndex(store);
    globalProjection = new ContextProjectionGenerator(globalGraph, globalIndex);
    
    globalGraph.initialize({
      workingDir,
      createdAt: Date.now()
    });
    
    isInitialized = true;
  }
}

/**
 * 创建 State Graph 编辑工具
 */
export function createStateGraphTools() {
  return [
    /**
     * sg_index - 索引项目到 State Graph
     */
    {
      name: 'sg_index',
      description: 'Index project into State Graph - required first step',
      category: ToolCategory.FILESYSTEM,
      params: {
        pattern: {
          type: 'string',
          description: 'File patterns (default: **/*.js,**/*.ts,**/*.jsx,**/*.tsx)'
        }
      },
      required: [],
      handler: async ({ pattern }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        const patterns = pattern ? [pattern] : ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'];
        
        const result = await globalIndex!.indexProject(ctx.workingDirectory, patterns);
        
        return `✅ State Graph Indexing Complete

Files: ${result.filesIndexed}
Symbols: ${result.symbolsFound}
Dependencies: ${result.dependenciesFound}

You can now use sg_project, sg_edit, etc.
`;
      }
    },

    /**
     * sg_project - 获取项目状态的投影
     */
    {
      name: 'sg_project',
      description: 'Get a Context Projection of the current state for a task',
      category: ToolCategory.FILESYSTEM,
      params: {
        task: {
          type: 'string',
          enum: ['edit', 'understand', 'debug', 'refactor', 'summary'],
          description: 'Task type'
        },
        focus: {
          type: 'string',
          description: 'Focus path/symbol (optional)'
        },
        query: {
          type: 'string',
          description: 'Understanding query (for understand task)'
        }
      },
      required: ['task'],
      handler: async ({ task, focus, query }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        if (task === 'summary') {
          return globalProjection!.projectMinimal();
        }
        
        if (task === 'understand') {
          return globalProjection!.projectSmart('understand', {
            query: query || focus
          });
        }
        
        if (task === 'edit' && focus) {
          return globalProjection!.projectSmart('edit', {
            filePath: focus.startsWith('/') ? focus : resolve(ctx.workingDirectory, focus)
          });
        }
        
        return globalProjection!.projectMinimal();
      }
    },

    /**
     * sg_get - 获取特定节点的完整信息
     */
    {
      name: 'sg_get',
      description: 'Get specific node from State Graph by hash or path',
      category: ToolCategory.FILESYSTEM,
      params: {
        id: {
          type: 'string',
          description: 'Node ID (hash or path/symbol name)'
        },
        type: {
          type: 'string',
          enum: ['file', 'symbol', 'dependency'],
          description: 'Node type hint'
        }
      },
      required: ['id'],
      handler: async ({ id, type }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        if (type === 'symbol') {
          const symbols = globalIndex!.symbols.findByName(id);
          if (symbols.length > 0) {
            let result = `Found ${symbols.length} symbol(s) for "${id}":\n\n`;
            for (const sym of symbols) {
              result += `## ${sym.name} (${sym.type})\n`;
              result += `File: ${sym.file}\n`;
              result += `Lines: ${sym.startLine}-${sym.endLine}\n`;
              if (sym.signature) {
                result += `Signature: ${sym.signature}\n`;
              }
              result += '\n';
            }
            return result;
          }
          return `Symbol "${id}" not found.`;
        }
        
        if (type === 'file' || id.includes('/') || id.includes('.')) {
          const filePath = id.startsWith('/') ? id : resolve(ctx.workingDirectory, id);
          if (existsSync(filePath)) {
            const content = await readFile(filePath, 'utf-8');
            const symbols = globalIndex!.symbols.findInFile(filePath);
            
            let result = `## File: ${filePath}\n\n`;
            result += `Symbols in file: ${symbols.length}\n`;
            if (symbols.length > 0) {
              result += '  - ' + symbols.map(s => s.name).join(', ') + '\n';
            }
            result += '\n---\nContent:\n```\n' + content + '\n```\n';
            
            return result;
          }
        }
        
        return `Node "${id}" not found. Try sg_index first.`;
      }
    },

    /**
     * sg_edit - 编辑文件（通过 State Graph）
     */
    {
      name: 'sg_edit',
      description: 'Edit a file by manipulating State Graph nodes',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: {
          type: 'string',
          description: 'File path'
        },
        operation: {
          type: 'string',
          enum: ['replace', 'insert', 'delete'],
          description: 'Edit operation type'
        },
        anchor: {
          type: 'string',
          description: 'Anchor symbol or text (for replace/insert)'
        },
        content: {
          type: 'string',
          description: 'New content'
        },
        message: {
          type: 'string',
          description: 'Commit message (optional)'
        }
      },
      required: ['path', 'operation'],
      handler: async ({ path, operation, anchor, content, message }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        const filePath = resolve(ctx.workingDirectory, path);
        
        if (!existsSync(filePath)) {
          return `Error: File not found - ${filePath}`;
        }
        
        let currentContent = await readFile(filePath, 'utf-8');
        let newContent = currentContent;
        
        if (operation === 'replace' && anchor && content) {
          if (!currentContent.includes(anchor)) {
            return `Error: Anchor text not found. Provide the EXACT text to replace.`;
          }
          newContent = currentContent.replace(anchor, content);
        } else if (operation === 'insert' && anchor && content) {
          if (!currentContent.includes(anchor)) {
            return `Error: Anchor text not found for insertion.`;
          }
          const insertPos = currentContent.indexOf(anchor) + anchor.length;
          newContent = currentContent.slice(0, insertPos) + content + currentContent.slice(insertPos);
        } else if (operation === 'delete' && anchor) {
          if (!currentContent.includes(anchor)) {
            return `Error: Anchor text not found for deletion.`;
          }
          newContent = currentContent.replace(anchor, '');
        }
        
        // 应用变更
        await writeFile(filePath, newContent, 'utf-8');
        
        // 创建状态图提交
        const changes = [
          { type: 'update', nodeId: 'file:' + filePath }
        ];
        
        const commitId = globalGraph!.commit(
          changes, 
          message || `${operation}: ${path}`,
          'agent'
        );
        
        // 重新索引（简化版）
        await globalIndex!.symbols.indexFile(filePath, newContent);
        
        return `✅ Change applied and committed to State Graph

Commit ID: ${commitId.substring(0, 16)}...
Message: ${message || `${operation}: ${path}`}

File updated: ${filePath}
`;
      }
    },

    /**
     * sg_commit - 创建显式提交
     */
    {
      name: 'sg_commit',
      description: 'Create an explicit commit in the State Graph',
      category: ToolCategory.FILESYSTEM,
      params: {
        message: {
          type: 'string',
          description: 'Commit message'
        },
        changes: {
          type: 'string',
          description: 'JSON string of changes (optional)'
        }
      },
      required: ['message'],
      handler: async ({ message, changes }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        const changeOps = changes ? JSON.parse(changes) : [];
        const commitId = globalGraph!.commit(changeOps, message, 'agent');
        
        return `✅ Commit created

ID: ${commitId.substring(0, 16)}...
Message: ${message}
`;
      }
    },

    /**
     * sg_history - 查看 State Graph 历史
     */
    {
      name: 'sg_history',
      description: 'View State Graph history',
      category: ToolCategory.FILESYSTEM,
      params: {
        limit: {
          type: 'number',
          description: 'Max history entries (default: 10)'
        }
      },
      required: [],
      handler: async ({ limit }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        const history = globalGraph!.getHistory(limit || 10);
        
        let result = '## State Graph History\n\n';
        for (const node of history) {
          const date = new Date(node.timestamp).toLocaleString();
          result += `- [${node.id.substring(0, 8)}] ${date} - ${node.data?.message || 'Commit'}\n`;
        }
        
        return result;
      }
    },

    /**
     * sg_rollback - 回滚到指定提交
     */
    {
      name: 'sg_rollback',
      description: 'Rollback State Graph to specific commit',
      category: ToolCategory.FILESYSTEM,
      params: {
        commit_id: {
          type: 'string',
          description: 'Commit ID to rollback to'
        }
      },
      required: ['commit_id'],
      handler: async ({ commit_id }: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        const success = globalGraph!.rollbackTo(commit_id);
        
        if (success) {
          return `✅ Rollback successful

Rolled back to: ${commit_id}
Note: This only updates State Graph metadata.
To revert files, use sg_restore or git commands.
`;
        } else {
          return `❌ Rollback failed: Commit not found`;
        }
      }
    },

    /**
     * sg_status - 显示当前状态
     */
    {
      name: 'sg_status',
      description: 'Show current State Graph status',
      category: ToolCategory.FILESYSTEM,
      params: {},
      required: [],
      handler: async (args: any, ctx: any) => {
        ensureInitialized(ctx.workingDirectory);
        
        const stats = globalIndex!.getStats();
        const graphStats = globalGraph!.getStats();
        const head = globalGraph!.getHead();
        
        return `## State Graph Status

HEAD: ${head ? head.substring(0, 16) + '...' : 'none'}
Nodes: ${graphStats.nodes}
Objects: ${stats.objects}

Project:
  Files: ${stats.files}
  Symbols: ${stats.symbols}
  Dependencies: ${stats.dependencies}

Working Directory: ${ctx.workingDirectory}
`;
      }
    }
  ];
}

export default {
  createStateGraphTools
};
