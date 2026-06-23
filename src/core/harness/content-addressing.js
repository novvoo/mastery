/**
 * Content Addressing 系统 - 类似 Git 的对象存储
 *
 * 核心思想：
 * - 每个代码块有唯一的内容哈希
 * - 通过哈希而不是位置引用代码
 * - 支持原子性、可回滚的修改
 */

import { createHash } from 'crypto';

// 对象类型
const TYPE_BLOB = 'blob'; // 文件内容
const TYPE_TREE = 'tree'; // 目录结构
const TYPE_COMMIT = 'commit'; // 提交记录
const TYPE_ANCHOR = 'anchor'; // 锚点引用

/**
 * 计算内容哈希
 */
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Git 风格的内容寻址对象存储
 */
export class ContentAddressableStore {
  constructor() {
    this._objects = new Map();
    this._refs = new Map();
  }

  /**
   * 存储一个对象
   */
  store(type, data) {
    const serialized = JSON.stringify({ type, data });
    const hash = hashContent(serialized);

    this._objects.set(hash, { type, data });

    return hash;
  }

  /**
   * 存储 blob（文件内容）
   */
  storeBlob(content) {
    return this.store(TYPE_BLOB, { content });
  }

  /**
   * 存储锚点
   */
  storeAnchor(path, start, end, text) {
    const data = {
      path,
      start,
      end,
      text,
      hash: hashContent(text),
    };
    return this.store(TYPE_ANCHOR, data);
  }

  /**
   * 根据哈希获取对象
   */
  get(hash) {
    return this._objects.get(hash) || null;
  }

  /**
   * 获取 blob 内容
   */
  getBlob(hash) {
    const obj = this.get(hash);
    if (obj && obj.type === TYPE_BLOB) {
      return obj.data.content;
    }
    return null;
  }

  /**
   * 获取锚点
   */
  getAnchor(hash) {
    const obj = this.get(hash);
    if (obj && obj.type === TYPE_ANCHOR) {
      return obj.data;
    }
    return null;
  }

  /**
   * 设置引用
   */
  setRef(name, hash) {
    this._refs.set(name, hash);
  }

  /**
   * 获取引用
   */
  getRef(name) {
    return this._refs.get(name) || null;
  }

  /**
   * 列出所有对象哈希
   */
  listObjects() {
    return Array.from(this._objects.keys());
  }

  /**
   * 导出状态
   */
  export() {
    return {
      objects: Array.from(this._objects.entries()),
      refs: Array.from(this._refs.entries()),
    };
  }

  /**
   * 导入状态
   */
  import(state) {
    for (const [hash, obj] of state.objects) {
      this._objects.set(hash, obj);
    }
    for (const [name, hash] of state.refs) {
      this._refs.set(name, hash);
    }
  }

  /**
   * 获取统计信息
   */
  stats() {
    return {
      objects: this._objects.size,
      refs: this._refs.size,
    };
  }
}

/**
 * 文件分析器 - 将文件拆分为可寻址的内容块
 */
export class FileAnalyzer {
  constructor(store) {
    this._store = store;
  }

  /**
   * 分析文件并创建锚点
   */
  analyzeFile(path, content) {
    // 存储整个文件
    const fileHash = this._store.storeBlob(content);

    // 按行分割，创建锚点
    const lines = content.split('\n');
    const anchors = [];

    // 策略1：按行级锚点
    let currentOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWithNewline = i < lines.length - 1 ? line + '\n' : line;

      const anchorHash = this._store.storeAnchor(
        path,
        currentOffset,
        currentOffset + lineWithNewline.length,
        lineWithNewline,
      );

      anchors.push({
        hash: anchorHash,
        text: lineWithNewline,
        start: currentOffset,
        end: currentOffset + lineWithNewline.length,
      });

      currentOffset += lineWithNewline.length;
    }

    return { fileHash, anchors };
  }

  /**
   * 按代码块分析（函数、类等）
   */
  analyzeByBlocks(path, content) {
    const fileHash = this._store.storeBlob(content);
    const blocks = [];

    // 简单的 JavaScript 块检测
    const lines = content.split('\n');
    let currentBlock = null;
    let braceBalance = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检测函数声明
      const funcMatch = line.match(
        /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+([a-zA-Z_$][\w$]*)|(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|=>))/,
      );

      // 检测类声明
      const classMatch = line.match(/^\s*(?:export\s+)?class\s+([a-zA-Z_$][\w$]*)/);

      if (!currentBlock && (funcMatch || classMatch)) {
        const name = funcMatch ? funcMatch[1] || funcMatch[2] : classMatch[1];
        const type = funcMatch ? 'function' : 'class';

        currentBlock = {
          text: line + '\n',
          type,
          name,
          start: i,
        };
        braceBalance = 0;
      } else if (currentBlock) {
        currentBlock.text += line + (i < lines.length - 1 ? '\n' : '');

        // 简单的大括号平衡检测
        braceBalance += (line.match(/{/g) || []).length;
        braceBalance -= (line.match(/}/g) || []).length;

        if (braceBalance === 0 && line.trim().endsWith('}')) {
          // 块结束，存储
          const blockHash = this._store.storeAnchor(
            path,
            0, // 简化，不跟踪精确偏移
            0,
            currentBlock.text,
          );

          blocks.push({
            hash: blockHash,
            text: currentBlock.text,
            type: currentBlock.type,
            name: currentBlock.name,
          });

          currentBlock = null;
        }
      }
    }

    return { fileHash, blocks };
  }
}

export default {
  ContentAddressableStore,
  FileAnalyzer,
};
