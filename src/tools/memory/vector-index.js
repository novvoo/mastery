/**
 * VectorIndex - 持久化向量索引
 * 将索引缓存到磁盘，agent 重启后无需重建
 * 支持检测索引过期，自动重建变更文件的索引
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, relative } from 'path';

const INDEX_VERSION = 2; // 版本升级以支持过期检测

export class VectorIndex {
  #indexDir;
  #baseDir;

  constructor(baseDir) {
    this.#baseDir = baseDir;
    this.#indexDir = join(baseDir, '.agent-data', 'vector-index');
  }

  /**
   * 从磁盘加载索引并检查是否过期
   * @param {string} cacheKey
   * @returns {Promise<{chunks: Array|null, stale: boolean}>}
   */
  async load(cacheKey) {
    const indexPath = this.#getIndexPath(cacheKey);
    try {
      const raw = await readFile(indexPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && data.version === INDEX_VERSION && Array.isArray(data.chunks) && data.chunks.length > 0) {
        const isStale = await this.#checkIfStale(data);
        return { chunks: data.chunks, stale: isStale, fileMeta: data.fileMeta };
      }
    } catch {}
    return { chunks: null, stale: true };
  }

  /**
   * 保存索引到磁盘，包含文件元数据用于过期检测
   * @param {string} cacheKey
   * @param {Array} chunks
   */
  async save(cacheKey, chunks) {
    const indexPath = this.#getIndexPath(cacheKey);
    await mkdir(this.#indexDir, { recursive: true });
    
    // 收集文件元数据用于过期检测
    const fileMeta = {};
    const paths = new Set();
    for (const chunk of chunks) {
      if (chunk.metadata?.path) {
        paths.add(chunk.metadata.path);
      }
    }
    for (const relPath of paths) {
      try {
        const fullPath = join(this.#baseDir, relPath);
        const fileStat = await stat(fullPath);
        fileMeta[relPath] = {
          mtime: fileStat.mtimeMs,
          size: fileStat.size,
        };
      } catch {
        // 文件不存在，忽略
      }
    }

    const data = {
      version: INDEX_VERSION,
      createdAt: new Date().toISOString(),
      chunks,
      fileMeta,
    };
    await writeFile(indexPath, JSON.stringify(data), 'utf-8');
  }

  /**
   * 检查索引是否过期
   * @param {Object} data 索引数据
   * @returns {Promise<boolean>}
   */
  async #checkIfStale(data) {
    // 如果没有文件元数据，认为过期
    if (!data.fileMeta || typeof data.fileMeta !== 'object') {
      return true;
    }

    // 检查文件是否变更
    for (const [relPath, savedMeta] of Object.entries(data.fileMeta)) {
      try {
        const fullPath = join(this.#baseDir, relPath);
        const fileStat = await stat(fullPath);
        // 文件修改时间或大小变更，索引过期
        if (fileStat.mtimeMs !== savedMeta.mtime || fileStat.size !== savedMeta.size) {
          return true;
        }
      } catch {
        // 文件不存在，索引过期
        return true;
      }
    }

    return false;
  }

  #getIndexPath(cacheKey) {
    const hash = this.#simpleHash(cacheKey);
    return join(this.#indexDir, `${hash}.json`);
  }

  #simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
    }
    return Math.abs(hash).toString(36);
  }
}
