/**
 * State Graph Core System
 * 
 * 核心思想：
 * 将 Agent 的系统状态从 Token Context 中提升为 Runtime 维护的显式 State Graph
 * 
 * - 内容寻址提供稳定的对象身份
 * - 状态图提供长期的状态连续性
 * - 上下文仅作为状态图在当前任务下的局部投影（Context Projection）
 */

import { createHash } from 'crypto';

// ==================== 类型定义 ====================

type ObjectType = 'blob' | 'tree' | 'node' | 'commit' | 'symbol' | 'dependency';

interface ContentAddressableObject {
  type: ObjectType;
  data: any;
  hash: string;
}

interface StateNode {
  id: string;             // 稳定的内容哈希
  type: 'file' | 'symbol' | 'dependency' | 'commit';
  data: any;
  parentIds: string[];   // 父节点（形成 DAG）
  timestamp: number;
  metadata: Record<string, any>;
}

interface ContextProjection {
  taskId: string;
  nodes: string[];      // 投影到当前任务的节点 ID
  purpose: string;      // 投影的目的（编辑、理解、调试等）
  timestamp: number;
  context: string;      // 生成的上下文字符串
}

interface Commit {
  id: string;
  parentIds: string[];
  changes: ChangeOp[];
  timestamp: number;
  author: string;
  message: string;
}

type ChangeOp = {
  type: 'add' | 'update' | 'delete';
  nodeId: string;
  previousId?: string;
};

// ==================== 内容寻址存储 ====================

export class ContentAddressableStore {
  private objects: Map<string, ContentAddressableObject> = new Map();
  private refs: Map<string, string> = new Map();

  /**
   * 计算内容哈希
   */
  static computeHash(data: any, type: ObjectType): string {
    const serialized = JSON.stringify({ type, data });
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * 存储对象，返回哈希
   */
  store(type: ObjectType, data: any): string {
    const hash = ContentAddressableStore.computeHash(data, type);
    if (!this.objects.has(hash)) {
      this.objects.set(hash, { type, data, hash });
    }
    return hash;
  }

  /**
   * 按哈希获取对象
   */
  get(hash: string): ContentAddressableObject | null {
    return this.objects.get(hash) || null;
  }

  /**
   * 存储 BLOB（文件内容）
   */
  storeBlob(content: string): string {
    return this.store('blob', { content });
  }

  /**
   * 获取 BLOB 内容
   */
  getBlob(hash: string): string | null {
    const obj = this.get(hash);
    return obj && obj.type === 'blob' ? obj.data.content : null;
  }

  /**
   * 设置引用
   */
  setRef(name: string, hash: string): void {
    this.refs.set(name, hash);
  }

  /**
   * 获取引用
   */
  getRef(name: string): string | null {
    return this.refs.get(name) || null;
  }

  /**
   * 删除引用
   */
  deleteRef(name: string): void {
    this.refs.delete(name);
  }

  /**
   * 导出存储
   */
  export(): { objects: [string, ContentAddressableObject][], refs: [string, string][] } {
    return {
      objects: Array.from(this.objects.entries()),
      refs: Array.from(this.refs.entries())
    };
  }

  /**
   * 导入存储
   */
  import(data: { objects: [string, ContentAddressableObject][], refs: [string, string][] }): void {
    for (const [hash, obj] of data.objects) {
      this.objects.set(hash, obj);
    }
    for (const [name, hash] of data.refs) {
      this.refs.set(name, hash);
    }
  }

  /**
   * 获取统计
   */
  getStats(): { objects: number, refs: number } {
    return {
      objects: this.objects.size,
      refs: this.refs.size
    };
  }
}

// ==================== 状态图 ====================

export class StateGraph {
  private store: ContentAddressableStore;
  private nodes: Map<string, StateNode> = new Map();
  private headRef: string = 'HEAD';
  private initialCommitId: string | null = null;

  constructor(store?: ContentAddressableStore) {
    this.store = store || new ContentAddressableStore();
  }

  /**
   * 创建初始状态
   */
  initialize(initialData: any = {}): string {
    const initialNode = this.createNode('commit', {
      message: 'Initial state',
      data: initialData
    }, []);
    
    this.initialCommitId = initialNode.id;
    this.store.setRef(this.headRef, initialNode.id);
    
    return initialNode.id;
  }

  /**
   * 创建节点
   */
  createNode(type: StateNode['type'], data: any, parentIds: string[] = [], metadata: Record<string, any> = {}): StateNode {
    const node: StateNode = {
      id: this.store.store(type, data),
      type,
      data,
      parentIds,
      timestamp: Date.now(),
      metadata
    };
    
    this.nodes.set(node.id, node);
    return node;
  }

  /**
   * 获取节点
   */
  getNode(id: string): StateNode | null {
    return this.nodes.get(id) || null;
  }

  /**
   * 创建提交（应用变更）
   */
  commit(
    changes: ChangeOp[], 
    message: string, 
    author: string = 'agent'
  ): string {
    const currentHead = this.store.getRef(this.headRef);
    
    const commitNode = this.createNode('commit', {
      message,
      changes,
      author
    }, currentHead ? [currentHead] : []);

    // 应用变更
    for (const change of changes) {
      if (change.type === 'delete') {
        this.nodes.delete(change.nodeId);
      } else {
        // add/update 通过 createNode 处理
      }
    }

    // 更新 HEAD
    this.store.setRef(this.headRef, commitNode.id);
    
    return commitNode.id;
  }

  /**
   * 回滚到指定提交
   */
  rollbackTo(commitId: string): boolean {
    const node = this.getNode(commitId);
    if (!node) {
      return false;
    }

    this.store.setRef(this.headRef, commitId);
    return true;
  }

  /**
   * 获取当前 HEAD 提交
   */
  getHead(): string | null {
    return this.store.getRef(this.headRef);
  }

  /**
   * 获取历史记录
   */
  getHistory(limit: number = 10): StateNode[] {
    const history: StateNode[] = [];
    let currentId = this.getHead();
    
    while (currentId && history.length < limit) {
      const node = this.getNode(currentId);
      if (!node) break;
      
      history.push(node);
      
      if (node.parentIds.length > 0) {
        currentId = node.parentIds[0];
      } else {
        break;
      }
    }
    
    return history;
  }

  /**
   * 获取两个提交之间的差异
   */
  getDiff(fromCommitId: string, toCommitId: string): ChangeOp[] {
    const fromNode = this.getNode(fromCommitId);
    const toNode = this.getNode(toCommitId);
    
    if (!fromNode || !toNode) {
      return [];
    }

    const changes: ChangeOp[] = [];
    const fromIds = new Set(this.collectNodeIds(fromCommitId));
    const toIds = new Set(this.collectNodeIds(toCommitId));
    
    // 新增的节点
    for (const id of toIds) {
      if (!fromIds.has(id)) {
        changes.push({ type: 'add', nodeId: id });
      }
    }
    
    // 删除的节点
    for (const id of fromIds) {
      if (!toIds.has(id)) {
        changes.push({ type: 'delete', nodeId: id });
      }
    }
    
    return changes;
  }

  /**
   * 收集节点及其祖先的 ID
   */
  private collectNodeIds(nodeId: string): Set<string> {
    const ids = new Set<string>();
    const toVisit: string[] = [nodeId];
    
    while (toVisit.length > 0) {
      const id = toVisit.shift()!;
      if (ids.has(id)) continue;
      
      ids.add(id);
      const node = this.getNode(id);
      if (node) {
        for (const parentId of node.parentIds) {
          toVisit.push(parentId);
        }
      }
    }
    
    return ids;
  }

  /**
   * 获取存储
   */
  getStore(): ContentAddressableStore {
    return this.store;
  }

  /**
   * 获取统计
   */
  getStats(): { nodes: number, head: string | null } {
    return {
      nodes: this.nodes.size,
      head: this.getHead()
    };
  }
}

// ==================== 上下文投影 ====================

export class ContextProjectionEngine {
  private graph: StateGraph;
  private projections: Map<string, ContextProjection> = new Map();

  constructor(graph: StateGraph) {
    this.graph = graph;
  }

  /**
   * 创建上下文投影
   * 
   * Context Projection: 状态图在当前任务下的局部视图
   */
  project(
    taskId: string, 
    purpose: string, 
    nodeIds: string[],
    additionalContext: string = ''
  ): ContextProjection {
    const context = this.generateContextFromNodes(nodeIds, purpose);
    
    const projection: ContextProjection = {
      taskId,
      nodes: nodeIds,
      purpose,
      timestamp: Date.now(),
      context: context + additionalContext
    };
    
    this.projections.set(taskId, projection);
    return projection;
  }

  /**
   * 从节点生成上下文字符串
   */
  private generateContextFromNodes(nodeIds: string[], purpose: string): string {
    const lines: string[] = [];
    
    lines.push(`## Context Projection: ${purpose}`);
    lines.push(`Generated at: ${new Date().toISOString()}`);
    lines.push('');
    
    for (const nodeId of nodeIds) {
      const node = this.graph.getNode(nodeId);
      if (!node) continue;
      
      lines.push(`---`);
      lines.push(`Node ID: ${nodeId.substring(0, 16)}...`);
      lines.push(`Type: ${node.type}`);
      
      if (node.type === 'file') {
        lines.push(`File: ${node.data.path || 'unknown'}`);
        if (node.data.content) {
          lines.push('');
          lines.push('```');
          lines.push(node.data.content.substring(0, 2000));
          if (node.data.content.length > 2000) {
            lines.push('... (truncated)');
          }
          lines.push('```');
        }
      } else if (node.type === 'symbol') {
        lines.push(`Symbol: ${node.data.name}`);
        if (node.data.signature) {
          lines.push(`Signature: ${node.data.signature}`);
        }
        if (node.data.context) {
          lines.push('');
          lines.push('```');
          lines.push(node.data.context.substring(0, 1000));
          lines.push('```');
        }
      }
    }
    
    lines.push('');
    lines.push('---');
    lines.push('End of Context Projection');
    
    return lines.join('\n');
  }

  /**
   * 获取投影
   */
  getProjection(taskId: string): ContextProjection | null {
    return this.projections.get(taskId) || null;
  }

  /**
   * 更新投影
   */
  updateProjection(taskId: string, updates: Partial<ContextProjection>): ContextProjection | null {
    const existing = this.getProjection(taskId);
    if (!existing) return null;
    
    const updated: ContextProjection = { ...existing, ...updates, timestamp: Date.now() };
    this.projections.set(taskId, updated);
    return updated;
  }

  /**
   * 删除投影
   */
  deleteProjection(taskId: string): boolean {
    return this.projections.delete(taskId);
  }

  /**
   * 获取所有投影
   */
  getAllProjections(): ContextProjection[] {
    return Array.from(this.projections.values());
  }

  /**
   * 智能投影：基于相关性自动选择节点
   */
  smartProject(
    taskId: string,
    purpose: string,
    query: string,
    relevanceThreshold: number = 0.5
  ): ContextProjection {
    // TODO: 实现智能选择算法（基于语义相似度）
    // 暂时返回空投影
    return this.project(taskId, purpose, []);
  }
}

// ==================== 导出 ====================

export default {
  ContentAddressableStore,
  StateGraph,
  ContextProjectionEngine
};
