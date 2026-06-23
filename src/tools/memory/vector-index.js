/**
 * VectorIndex - 持久化向量索引
 * 将索引缓存到磁盘，agent 重启后无需重建
 * 支持检测索引过期，自动重建变更文件的索引
 */

import { readFile, writeFile, mkdir, stat, unlink, readdir } from 'fs/promises';
import { join } from 'path';

const INDEX_VERSION = 2; // 版本升级以支持过期检测
const MAX_TOTAL_INDEX_SIZE_MB = 200; // 总索引大小最大200MB
const MAX_SINGLE_INDEX_SIZE_MB = 50; // 单个索引最大50MB

export class VectorIndex {
  #indexDir;
  #baseDir;

  constructor(baseDir) {
    this.#baseDir = baseDir;
    this.#indexDir = join(baseDir, '.agent-data', 'vector-index');
  }

  /**
   * 清理过期和过大的索引
   */
  async cleanup() {
    try {
      await mkdir(this.#indexDir, { recursive: true });
      const files = await readdir(this.#indexDir);
      const indexFiles = files.filter((f) => f.endsWith('.json'));

      let totalSize = 0;
      const fileInfo = [];

      for (const file of indexFiles) {
        try {
          const filePath = join(this.#indexDir, file);
          const stats = await stat(filePath);
          totalSize += stats.size;
          fileInfo.push({ path: filePath, size: stats.size, mtime: stats.mtimeMs });
        } catch {
          // 忽略无法访问的文件
        }
      }

      // 检查总大小是否超限
      const MAX_TOTAL_BYTES = MAX_TOTAL_INDEX_SIZE_MB * 1024 * 1024;
      if (totalSize > MAX_TOTAL_BYTES) {
        // 按修改时间排序，删除最旧的
        fileInfo.sort((a, b) => a.mtime - b.mtime);

        let bytesToDelete = totalSize - MAX_TOTAL_BYTES;
        for (const info of fileInfo) {
          if (bytesToDelete <= 0) {
            break;
          }
          try {
            await unlink(info.path);
            bytesToDelete -= info.size;
            console.log('vector-index: cleaned up old index', info.path);
          } catch {
            // 忽略删除失败
          }
        }
      }
    } catch {
      // 清理失败不影响正常使用
    }
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
      if (
        data &&
        data.version === INDEX_VERSION &&
        Array.isArray(data.chunks) &&
        data.chunks.length > 0
      ) {
        const isStale = await this.#checkIfStale(data);
        return { chunks: data.chunks, stale: isStale, fileMeta: data.fileMeta };
      }
    } catch {
      // Treat unreadable or invalid cache files as stale.
    }
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

    // 先尝试清理旧索引
    await this.cleanup();

    // 检查单个索引大小
    const MAX_SINGLE_BYTES = MAX_SINGLE_INDEX_SIZE_MB * 1024 * 1024;
    let trimmedChunks = chunks;

    // 如果预估大小超限，裁剪 chunks
    let estimatedSize = JSON.stringify(chunks).length;
    if (estimatedSize > MAX_SINGLE_BYTES) {
      const keepRatio = MAX_SINGLE_BYTES / estimatedSize;
      const keepCount = Math.floor(chunks.length * keepRatio);
      trimmedChunks = chunks.slice(0, keepCount);
      console.warn(
        'vector-index: index too large, trimmed from',
        chunks.length,
        'to',
        keepCount,
        'chunks',
      );
    }

    // 收集文件元数据用于过期检测
    const fileMeta = {};
    const paths = new Set();
    for (const chunk of trimmedChunks) {
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
      chunks: trimmedChunks,
      fileMeta,
    };

    const jsonData = JSON.stringify(data);
    if (jsonData.length > MAX_SINGLE_BYTES) {
      console.warn('vector-index: index still too large after trimming, skipping save');
      return;
    }

    await writeFile(indexPath, jsonData, 'utf-8');
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
      hash = (hash << 5) - hash + str.charCodeAt(i);
    }
    return Math.abs(hash).toString(36);
  }
}
