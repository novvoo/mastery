/**
 * Hash-Anchored Patch System - 哈希锚点补丁系统
 *
 * 基于内容哈希的补丁系统，替代传统的行号定位
 *
 * Patch Intent 类型：
 * - INSERT: 在锚点后插入
 * - REPLACE: 替换锚点
 * - DELETE: 删除锚点
 * - MODIFY: 修改锚点内的部分内容
 */

import { ContentAddressableStore, FileAnalyzer } from './content-addressing.js';
import { createHash } from 'crypto';

/**
 * 哈希锚点补丁应用器
 */
export class HashAnchoredPatcher {
  constructor(store) {
    this._store = store;
    this._analyzer = new FileAnalyzer(store);
  }

  /**
   * 应用单个补丁
   */
  applyPatch(originalContent, intent) {
    // 先获取锚点信息
    const anchor = this._store.getAnchor(intent.anchorHash);

    if (!anchor) {
      return {
        success: false,
        newContent: originalContent,
        newAnchors: [],
        changes: 0,
        error: `Anchor not found: ${intent.anchorHash}`,
      };
    }

    // 在当前内容中重新定位锚点（即使内容有移动也能找到）
    const foundRange = this._findContentRange(originalContent, anchor.text);

    if (!foundRange) {
      return {
        success: false,
        newContent: originalContent,
        newAnchors: [],
        changes: 0,
        error: `Cannot locate anchor content in current file`,
      };
    }

    const { start, end } = foundRange;

    let newContent = originalContent;
    let changes = 0;

    switch (intent.type) {
      case 'DELETE':
        newContent = originalContent.slice(0, start) + originalContent.slice(end);
        changes = 1;
        break;

      case 'REPLACE':
        if (!intent.content) {
          return {
            success: false,
            newContent: originalContent,
            newAnchors: [],
            changes: 0,
            error: 'REPLACE requires content',
          };
        }
        newContent = originalContent.slice(0, start) + intent.content + originalContent.slice(end);
        changes = 1;
        break;

      case 'INSERT':
        if (!intent.content) {
          return {
            success: false,
            newContent: originalContent,
            newAnchors: [],
            changes: 0,
            error: 'INSERT requires content',
          };
        }
        newContent = originalContent.slice(0, end) + intent.content + originalContent.slice(end);
        changes = 1;
        break;

      case 'MODIFY':
        // 对锚点内容进行局部修改
        if (!intent.content) {
          return {
            success: false,
            newContent: originalContent,
            newAnchors: [],
            changes: 0,
            error: 'MODIFY requires content',
          };
        }
        // MODIFY 的 content 应该是完整的新内容
        newContent = originalContent.slice(0, start) + intent.content + originalContent.slice(end);
        changes = 1;
        break;
    }

    // 重新分析新内容，创建新锚点
    const analysis = this._analyzer.analyzeFile(anchor.path, newContent);

    return {
      success: true,
      newContent,
      newAnchors: analysis.anchors.map((a) => ({ hash: a.hash, text: a.text })),
      changes,
    };
  }

  /**
   * 批量应用补丁
   */
  applyPatches(originalContent, intents) {
    let content = originalContent;
    let totalChanges = 0;
    let allNewAnchors = [];

    for (const intent of intents) {
      const result = this.applyPatch(content, intent);

      if (!result.success) {
        return {
          success: false,
          newContent: originalContent,
          newAnchors: [],
          changes: 0,
          error: result.error,
        };
      }

      content = result.newContent;
      totalChanges += result.changes;
      allNewAnchors = result.newAnchors;
    }

    return {
      success: true,
      newContent: content,
      newAnchors: allNewAnchors,
      changes: totalChanges,
    };
  }

  /**
   * 在内容中查找精确匹配的文本范围
   */
  _findContentRange(content, searchText) {
    // 精确匹配
    const index = content.indexOf(searchText);
    if (index !== -1) {
      return { start: index, end: index + searchText.length };
    }

    // 尝试模糊匹配（处理空白差异）
    const normalizedSearch = this._normalizeWhitespace(searchText);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const window = lines.slice(i, i + 20).join('\n'); // 最多检查20行
      const normalizedWindow = this._normalizeWhitespace(window);

      if (normalizedWindow.includes(normalizedSearch)) {
        // 找到模糊匹配，尝试找到更精确的位置
        const start = content.indexOf(window);
        if (start !== -1) {
          return { start, end: start + window.length };
        }
      }
    }

    return null;
  }

  /**
   * 标准化空白字符用于模糊匹配
   */
  _normalizeWhitespace(text) {
    return text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  }

  /**
   * 为内容创建初始锚点并返回引用
   */
  initializeFile(path, content) {
    return this._analyzer.analyzeFile(path, content);
  }
}

/**
 * 补丁意图生成器 - 帮助 Agent 更容易地表达意图
 */
export class PatchIntentBuilder {
  constructor(store) {
    this._store = store;
  }

  /**
   * 创建 REPLACE 意图
   */
  replace(anchorHash, newContent, description) {
    return {
      type: 'REPLACE',
      anchorHash,
      content: newContent,
      description,
    };
  }

  /**
   * 创建 INSERT 意图
   */
  insertAfter(anchorHash, newContent, description) {
    return {
      type: 'INSERT',
      anchorHash,
      content: newContent,
      description,
    };
  }

  /**
   * 创建 DELETE 意图
   */
  delete(anchorHash, description) {
    return {
      type: 'DELETE',
      anchorHash,
      description,
    };
  }

  /**
   * 创建 MODIFY 意图
   */
  modify(anchorHash, newContent, description) {
    return {
      type: 'MODIFY',
      anchorHash,
      content: newContent,
      description,
    };
  }
}

/**
 * 状态图 - 跟踪编辑历史和状态
 */
export class StateGraph {
  constructor(store) {
    this._store = store;
    this._nodes = new Map();
    this._currentHead = null;
  }

  /**
   * 创建初始节点
   */
  createInitialNode(path, content) {
    const fileHash = this._store.storeBlob(content);

    const node = {
      hash: fileHash,
      content,
      parentHashes: [],
      patch: null,
      timestamp: Date.now(),
    };

    this._nodes.set(fileHash, node);
    this._currentHead = fileHash;

    return fileHash;
  }

  /**
   * 基于补丁创建新节点
   */
  createNodeFromPatch(parentHash, patch, newContent) {
    const newHash = this._store.storeBlob(newContent);

    const node = {
      hash: newHash,
      content: newContent,
      parentHashes: [parentHash],
      patch,
      timestamp: Date.now(),
    };

    this._nodes.set(newHash, node);
    this._currentHead = newHash;

    return newHash;
  }

  /**
   * 获取当前头部
   */
  getCurrentHead() {
    return this._currentHead;
  }

  /**
   * 获取节点内容
   */
  getNodeContent(hash) {
    const node = this._nodes.get(hash);
    return node ? node.content : null;
  }

  /**
   * 回滚到特定节点
   */
  rollbackTo(hash) {
    if (this._nodes.has(hash)) {
      this._currentHead = hash;
      return true;
    }
    return false;
  }

  /**
   * 获取历史记录
   */
  getHistory(limit = 10) {
    const history = [];
    let current = this._currentHead;
    let count = 0;

    while (current && count < limit) {
      const node = this._nodes.get(current);
      if (!node) {
        break;
      }

      history.push({
        hash: node.hash,
        timestamp: node.timestamp,
        patch: node.patch,
      });

      current = node.parentHashes[0] || null;
      count++;
    }

    return history;
  }
}

export default {
  HashAnchoredPatcher,
  PatchIntentBuilder,
  StateGraph,
};
