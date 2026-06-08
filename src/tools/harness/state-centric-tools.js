/**
 * State-Centric Editing Tools - 状态驱动编辑工具
 * 
 * 基于 Content Addressing 和 Hash-Anchored Patch 的编辑工具
 * 
 * 工具列表：
 * - harness_analyze: 分析文件并创建锚点
 * - harness_replace: 基于锚点替换内容
 * - harness_insert: 在锚点后插入内容
 * - harness_delete: 删除锚点内容
 * - harness_query: 查询当前状态
 * - harness_rollback: 回滚到之前状态
 */

import { ToolCategory } from '../../core/types.js';
import { ContentAddressableStore, FileAnalyzer } from './content-addressing.js';
import { HashAnchoredPatcher, PatchIntentBuilder, StateGraph } from './hash-anchored-patch.js';
import { readFile, writeFile } from 'fs/promises';
import { resolve, join } from 'path';
import { existsSync } from 'fs';

// 全局状态存储（实际项目应该与 Session 绑定）
let globalStore: ContentAddressableStore | null = null;
let globalStateGraph: StateGraph | null = null;
let globalPatcher: HashAnchoredPatcher | null = null;
let globalPatchBuilder: PatchIntentBuilder | null = null;

/**
 * 初始化 Harness 系统
 */
function initializeHarness() {
  if (!globalStore) {
    globalStore = new ContentAddressableStore();
    globalStateGraph = new StateGraph(globalStore);
    globalPatcher = new HashAnchoredPatcher(globalStore);
    globalPatchBuilder = new PatchIntentBuilder(globalStore);
  }
}

/**
 * 创建 State-Centric 编辑工具
 */
export function createStateCentricTools() {
  initializeHarness();
  
  return [
    /**
     * harness_analyze - 分析文件并创建可寻址锚点
     */
    {
      name: 'harness_analyze',
      description: '分析文件并创建内容锚点。这是使用其它 harness 工具的第一步。',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: '文件路径' },
        mode: { type: 'string', enum: ['lines', 'blocks'], description: '分析模式：按行(lines)或按块(blocks)', default: 'lines' }
      },
      required: ['path'],
      handler: async ({ path, mode }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        if (!existsSync(fullPath)) {
          return `Error: File not found: ${path}`;
        }
        
        try {
          const content = await readFile(fullPath, 'utf-8');
          
          const result = mode === 'blocks' 
            ? globalPatcher!['_analyzer'].analyzeByBlocks(path, content)
            : globalPatcher!.initializeFile(path, content);
          
          // 初始化状态图
          globalStateGraph!.createInitialNode(path, content);
          
          // 返回锚点信息（不返回完整文件内容）
          const anchorSummary = result.anchors.slice(0, 20).map((a, i) => ({
            index: i,
            hash: a.hash.substring(0, 16) + '...',
            preview: (a.text || '').substring(0, 80).replace(/\n/g, ' ↵ ')
          }));
          
          return `File analyzed: ${path}\n` +
                 `File Hash: ${result.fileHash.substring(0, 16)}...\n` +
                 `Anchors: ${result.anchors.length} (showing first ${Math.min(20, result.anchors.length)})\n` +
                 `${anchorSummary.map(a => `  [${a.index}] ${a.hash} "${a.preview}"`).join('\n')}\n\n` +
                 `Use these anchor hashes with harness_replace/harness_insert/harness_delete.`;
        } catch (error) {
          return `Error analyzing file: ${error}`;
        }
      }
    },
    
    /**
     * harness_replace - 基于锚点替换内容
     */
    {
      name: 'harness_replace',
      description: '替换锚点对应的内容。不指定完整文件，只指定锚点哈希和新内容。',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: '文件路径' },
        anchor_hash: { type: 'string', description: '要替换的锚点哈希（至少 16 个字符）' },
        new_content: { type: 'string', description: '新的内容' },
        description: { type: 'string', description: '修改说明（可选）' }
      },
      required: ['path', 'anchor_hash', 'new_content'],
      handler: async ({ path, anchor_hash, new_content, description }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        if (!existsSync(fullPath)) {
          return `Error: File not found: ${path}`;
        }
        
        try {
          // 找到完整的锚点哈希（支持前缀匹配）
          let fullHash: string | null = null;
          for (const objHash of globalStore!.listObjects()) {
            if (objHash.startsWith(anchor_hash)) {
              fullHash = objHash;
              break;
            }
          }
          
          if (!fullHash) {
            return `Error: Anchor not found for hash prefix: ${anchor_hash}`;
          }
          
          // 读取当前文件内容
          const currentContent = await readFile(fullPath, 'utf-8');
          
          // 创建并应用补丁
          const intent = globalPatchBuilder!.replace(fullHash, new_content, description);
          const result = globalPatcher!.applyPatch(currentContent, intent);
          
          if (!result.success) {
            return `Error applying patch: ${result.error}`;
          }
          
          // 写入文件
          await writeFile(fullPath, result.newContent, 'utf-8');
          
          // 更新状态图
          const parentHash = globalStateGraph!.getCurrentHead();
          if (parentHash) {
            globalStateGraph!.createNodeFromPatch(parentHash, intent, result.newContent);
          }
          
          // 重新分析生成新锚点
          const newAnchors = globalPatcher!.initializeFile(path, result.newContent);
          
          return `Successfully replaced content\n` +
                 `File: ${path}\n` +
                 `Changes: ${result.changes}\n` +
                 `New anchors: ${newAnchors.anchors.length}\n` +
                 `First new anchor: ${newAnchors.anchors[0]?.hash.substring(0, 16)}...`;
        } catch (error) {
          return `Error: ${error}`;
        }
      }
    },
    
    /**
     * harness_insert - 在锚点后插入内容
     */
    {
      name: 'harness_insert',
      description: '在指定锚点后插入新内容。',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: '文件路径' },
        anchor_hash: { type: 'string', description: '锚点哈希' },
        content: { type: 'string', description: '要插入的内容' },
        description: { type: 'string', description: '修改说明' }
      },
      required: ['path', 'anchor_hash', 'content'],
      handler: async ({ path, anchor_hash, content, description }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        if (!existsSync(fullPath)) {
          return `Error: File not found: ${path}`;
        }
        
        try {
          // 找到完整哈希
          let fullHash: string | null = null;
          for (const objHash of globalStore!.listObjects()) {
            if (objHash.startsWith(anchor_hash)) {
              fullHash = objHash;
              break;
            }
          }
          
          if (!fullHash) {
            return `Error: Anchor not found: ${anchor_hash}`;
          }
          
          const currentContent = await readFile(fullPath, 'utf-8');
          const intent = globalPatchBuilder!.insertAfter(fullHash, content, description);
          const result = globalPatcher!.applyPatch(currentContent, intent);
          
          if (!result.success) {
            return `Error: ${result.error}`;
          }
          
          await writeFile(fullPath, result.newContent, 'utf-8');
          
          const parentHash = globalStateGraph!.getCurrentHead();
          if (parentHash) {
            globalStateGraph!.createNodeFromPatch(parentHash, intent, result.newContent);
          }
          
          return `Successfully inserted content after anchor ${anchor_hash}\n` +
                 `Changes: ${result.changes}`;
        } catch (error) {
          return `Error: ${error}`;
        }
      }
    },
    
    /**
     * harness_delete - 删除锚点内容
     */
    {
      name: 'harness_delete',
      description: '删除指定锚点对应的内容。',
      category: ToolCategory.FILESYSTEM,
      params: {
        path: { type: 'string', description: '文件路径' },
        anchor_hash: { type: 'string', description: '锚点哈希' },
        description: { type: 'string', description: '修改说明' }
      },
      required: ['path', 'anchor_hash'],
      handler: async ({ path, anchor_hash, description }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        if (!existsSync(fullPath)) {
          return `Error: File not found: ${path}`;
        }
        
        try {
          let fullHash: string | null = null;
          for (const objHash of globalStore!.listObjects()) {
            if (objHash.startsWith(anchor_hash)) {
              fullHash = objHash;
              break;
            }
          }
          
          if (!fullHash) {
            return `Error: Anchor not found: ${anchor_hash}`;
          }
          
          const currentContent = await readFile(fullPath, 'utf-8');
          const intent = globalPatchBuilder!.delete(fullHash, description);
          const result = globalPatcher!.applyPatch(currentContent, intent);
          
          if (!result.success) {
            return `Error: ${result.error}`;
          }
          
          await writeFile(fullPath, result.newContent, 'utf-8');
          
          const parentHash = globalStateGraph!.getCurrentHead();
          if (parentHash) {
            globalStateGraph!.createNodeFromPatch(parentHash, intent, result.newContent);
          }
          
          return `Successfully deleted content at anchor ${anchor_hash}\n` +
                 `Changes: ${result.changes}`;
        } catch (error) {
          return `Error: ${error}`;
        }
      }
    },
    
    /**
     * harness_query - 查询当前状态
     */
    {
      name: 'harness_query',
      description: '查询 Harness 系统的当前状态：文件哈希、锚点、历史记录等。',
      category: ToolCategory.FILESYSTEM,
      params: {
        query_type: { 
          type: 'string', 
          enum: ['status', 'history', 'anchors', 'objects'], 
          description: '查询类型'
        },
        path: { type: 'string', description: '文件路径（可选）' },
        limit: { type: 'number', description: '结果数量限制', default: 10 }
      },
      required: ['query_type'],
      handler: async ({ query_type, path, limit }, ctx) => {
        switch (query_type) {
          case 'status':
            const stats = globalStore!.stats();
            const head = globalStateGraph!.getCurrentHead();
            return `Harness Status:\n` +
                   `  Objects: ${stats.objects}\n` +
                   `  Refs: ${stats.refs}\n` +
                   `  Current Head: ${head ? head.substring(0, 16) + '...' : 'none'}`;
                   
          case 'history':
            const history = globalStateGraph!.getHistory(limit);
            return `Edit History (last ${history.length}):\n` +
                   history.map((h, i) => {
                     const patchInfo = h.patch 
                       ? `${h.patch.type} ${h.patch.anchorHash.substring(0, 16)}...` 
                       : '(initial)';
                     return `  [${i}] ${h.hash.substring(0, 16)}... - ${patchInfo}`;
                   }).join('\n');
                   
          case 'anchors':
            const anchorObjects = globalStore!.listObjects()
              .filter(hash => {
                const obj = globalStore!.get(hash);
                return obj && obj.type === 'anchor' && (!path || obj.data.path === path);
              })
              .slice(0, limit);
              
            return `Anchors${path ? ` in ${path}` : ''} (${anchorObjects.length}):\n` +
                   anchorObjects.map(hash => {
                     const obj = globalStore!.get(hash)!;
                     return `  ${hash.substring(0, 16)}...: ${obj.data.text.substring(0, 60).replace(/\n/g, ' ↵ ')}`;
                   }).join('\n');
                   
          case 'objects':
            const allObjects = globalStore!.listObjects().slice(0, limit);
            return `All Objects (${globalStore!.listObjects().length} total, showing ${allObjects.length}):\n` +
                   allObjects.map(hash => {
                     const obj = globalStore!.get(hash)!;
                     return `  ${hash.substring(0, 16)}...: ${obj.type}`;
                   }).join('\n');
                   
          default:
            return `Unknown query type: ${query_type}`;
        }
      }
    },
    
    /**
     * harness_rollback - 回滚到之前的状态
     */
    {
      name: 'harness_rollback',
      description: '回滚到之前的状态。',
      category: ToolCategory.FILESYSTEM,
      params: {
        target_hash: { type: 'string', description: '目标状态哈希' },
        path: { type: 'string', description: '文件路径' }
      },
      required: ['target_hash', 'path'],
      handler: async ({ target_hash, path }, ctx) => {
        const fullPath = resolve(join(ctx.workingDirectory, path));
        
        try {
          const content = globalStateGraph!.getNodeContent(target_hash);
          
          if (!content) {
            return `Error: Cannot find state for hash: ${target_hash}`;
          }
          
          const success = globalStateGraph!.rollbackTo(target_hash);
          
          if (!success) {
            return `Error: Rollback failed`;
          }
          
          await writeFile(fullPath, content, 'utf-8');
          
          return `Successfully rolled back to ${target_hash.substring(0, 16)}...`;
        } catch (error) {
          return `Error: ${error}`;
        }
      }
    }
  ];
}

/**
 * 获取 Harness 系统实例（用于集成）
 */
export function getHarnessSystem() {
  initializeHarness();
  
  return {
    store: globalStore,
    patcher: globalPatcher,
    stateGraph: globalStateGraph,
    patchBuilder: globalPatchBuilder
  };
}

export default {
  createStateCentricTools,
  getHarnessSystem
};
