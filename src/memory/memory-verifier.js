/**
 * MemoryVerifier — 增强版：Git-aware 验证 + 过期标记 + 来源溯源
 *
 * 对标文档 P3 要求：
 *   commit-aware provenance（每条 memory 记录 created at commit, source files + hashes）
 *   git diff 驱动的 stale invalidation
 *   批量验证
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, relative } from 'path';
import { execSync } from 'child_process';

// ─────────────────────────────────────────────────────────────────────────────
// MemoryProvenance — 增强的 provenance 记录
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryProvenance {
  /**
   * 为一条 memory 创建 provenance 记录。
   * @param {object} memory      memory 条目
   * @param {string} workingDir  项目根目录
   * @returns {object}            provenance 对象
   */
  static create(memory, workingDir) {
    const provenance = {
      // Git 提交信息
      createdAtCommit: null,
      lastVerifiedCommit: null,

      // 引用的源文件
      sourceFiles: [],

      // 来源信息
      source: memory._source || 'unknown',
      sourceTimestamp: memory.timestamp || Date.now(),

      // 最初验证结果
      initialVerification: null,
    };

    // 获取当前 commit
    try {
      provenance.createdAtCommit = execSync('git rev-parse HEAD', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    } catch {
      /* no git */
    }

    // 记录引用的源文件
    if (memory.source) {
      if (memory.source.path) {
        const filePath = join(workingDir, memory.source.path);
        if (existsSync(filePath)) {
          const hash = ProvenanceUtils.fileContentHash(filePath);
          provenance.sourceFiles.push({
            path: memory.source.path,
            hash,
            lineRange: memory.source.lineRange || null,
            size: statSync(filePath).size,
          });
        }
      }
      if (memory.source.file) {
        const filePath = join(workingDir, memory.source.file);
        if (existsSync(filePath)) {
          const hash = ProvenanceUtils.fileContentHash(filePath);
          provenance.sourceFiles.push({
            path: memory.source.file,
            hash,
            lineRange: null,
            size: statSync(filePath).size,
          });
        }
      }
    }

    // 记录额外的引用文件
    if (memory._referencedFiles) {
      for (const rf of memory._referencedFiles) {
        const filePath = join(workingDir, rf.path || rf);
        if (
          existsSync(filePath) &&
          !provenance.sourceFiles.some((s) => s.path === (rf.path || rf))
        ) {
          const hash = ProvenanceUtils.fileContentHash(filePath);
          provenance.sourceFiles.push({
            path: rf.path || rf,
            hash,
            lineRange: rf.lineRange || null,
            size: statSync(filePath).size,
          });
        }
      }
    }

    return provenance;
  }

  /**
   * 更新 provenance 的验证信息。
   * @param {object} provenance
   * @param {string} workingDir
   * @returns {object}  更新后的 provenance
   */
  static reverify(provenance, workingDir) {
    try {
      provenance.lastVerifiedCommit = execSync('git rev-parse HEAD', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    } catch {
      /* no git */
    }

    provenance.lastVerifiedAt = Date.now();

    // 重新计算源文件 hash
    for (const sf of provenance.sourceFiles) {
      const filePath = join(workingDir, sf.path);
      if (existsSync(filePath)) {
        sf.currentHash = ProvenanceUtils.fileContentHash(filePath);
        sf.stale = sf.currentHash !== sf.hash;
        sf.currentSize = statSync(filePath).size;
      } else {
        sf.stale = true;
        sf.currentHash = null;
      }
    }

    return provenance;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GitDiffStaleDetector — git diff 驱动的过期检测
// ─────────────────────────────────────────────────────────────────────────────

export class GitDiffStaleDetector {
  /**
   * @param {string} workingDir  项目根目录
   */
  constructor(workingDir) {
    this.workingDir = workingDir || process.cwd();
    this.lastCommitHash = null;
  }

  /**
   * 获取相对于上次记录的变更文件列表。
   * @returns {{ changedFiles: string[], currentCommit: string|null }}
   */
  getChangedFiles() {
    try {
      const currentCommit = execSync('git rev-parse HEAD', {
        cwd: this.workingDir,
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();

      if (!this.lastCommitHash) {
        this.lastCommitHash = currentCommit;
        return { changedFiles: [], currentCommit };
      }

      const diff = execSync(`git diff --name-only ${this.lastCommitHash}..${currentCommit}`, {
        cwd: this.workingDir,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      const changedFiles = diff ? diff.split('\n').filter(Boolean) : [];
      this.lastCommitHash = currentCommit;

      return { changedFiles, currentCommit };
    } catch {
      return { changedFiles: [], currentCommit: null };
    }
  }

  /**
   * 获取与指定 commit 之间的变更文件列表。
   * @param {string} sinceCommit
   * @returns {string[]}
   */
  getChangedFilesSince(sinceCommit) {
    if (!sinceCommit) {
      return [];
    }
    try {
      const diff = execSync(`git diff --name-only ${sinceCommit} HEAD`, {
        cwd: this.workingDir,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      return diff ? diff.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  /**
   * 查找引用过变更文件的 memories。
   * @param {string[]} changedFiles
   * @param {Map<string, object>} memories  id → memory entry
   * @returns {string[]}  过期 memory 的 id 列表
   */
  findStaleMemories(changedFiles, memories) {
    const staleMemories = [];

    for (const [id, memory] of memories) {
      const provenance = memory.provenance || memory._provenance;
      if (!provenance || !provenance.sourceFiles) {
        continue;
      }

      for (const sf of provenance.sourceFiles) {
        // 检查变更文件是否匹配 sourceFiles 中的某个
        for (const changed of changedFiles) {
          if (
            sf.path === changed ||
            sf.path.endsWith('/' + changed) ||
            changed.endsWith('/' + sf.path) ||
            this._pathsOverlap(sf.path, changed)
          ) {
            staleMemories.push(id);
            break;
          }
        }
      }
    }

    return [...new Set(staleMemories)];
  }

  _pathsOverlap(a, b) {
    // 规范化路径做比较
    const na = a.replace(/^\.\//, '').replace(/\\/g, '/');
    const nb = b.replace(/^\.\//, '').replace(/\\/g, '/');
    return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryVerifier (增强版)
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryVerifier {
  #workingDir;
  #staleDetector;
  #provenanceMap;

  constructor(workingDir) {
    this.#workingDir = workingDir;
    this.#staleDetector = new GitDiffStaleDetector(workingDir);
    /** @type {Map<string, object>}  memory id → provenance */
    this.#provenanceMap = new Map();
  }

  // ── 基础验证（保持向后兼容） ─────────────────────────────────────────

  async verifyFileReference(memory) {
    if (!memory.source || memory.source.type !== 'file') {
      return { valid: true, message: 'No file reference to verify' };
    }

    const filePath = join(this.#workingDir, memory.source.path);

    if (!existsSync(filePath)) {
      return { valid: false, message: `File not found: ${memory.source.path}` };
    }

    const fileStat = statSync(filePath);
    const fileModified = fileStat.mtime.getTime();

    if (memory.timestamp < fileModified) {
      return {
        valid: false,
        message: `File was modified after memory was created. File: ${memory.source.path}`,
      };
    }

    if (memory.source.contentHash) {
      const content = readFileSync(filePath, 'utf-8');
      const hash = ProvenanceUtils.fileContentHash(filePath);
      if (hash !== memory.source.contentHash) {
        return {
          valid: false,
          message: `File content has changed. Expected hash: ${memory.source.contentHash}, actual: ${hash}`,
        };
      }
    }

    return { valid: true, message: 'File reference verified' };
  }

  async verifyFunctionReference(memory) {
    if (!memory.source || memory.source.type !== 'function') {
      return { valid: true, message: 'No function reference to verify' };
    }

    const filePath = join(this.#workingDir, memory.source.file);
    if (!existsSync(filePath)) {
      return { valid: false, message: `File not found: ${memory.source.file}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    const functionName = memory.source.name;

    if (
      !content.includes(`function ${functionName}`) &&
      !content.includes(`${functionName} = `) &&
      !content.includes(`${functionName}: `) &&
      !content.includes(`class ${functionName}`) &&
      !content.includes(`${functionName}(`)
    ) {
      return { valid: false, message: `Function not found in file: ${functionName}` };
    }

    // 检查 function 所在的行范围是否仍在文件中
    if (memory.source.lineRange) {
      const lines = content.split('\n');
      const [start, end] = memory.source.lineRange;
      if (start > lines.length || end > lines.length) {
        return { valid: false, message: `Function line range out of bounds: [${start}, ${end}]` };
      }
    }

    return { valid: true, message: 'Function reference verified' };
  }

  async verifyFlag(memory) {
    if (!memory.source || memory.source.type !== 'flag') {
      return { valid: true, message: 'No flag reference to verify' };
    }

    const filePath = join(this.#workingDir, memory.source.file || '.env');
    if (!existsSync(filePath)) {
      return { valid: false, message: `Config file not found: ${filePath}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    const flagName = memory.source.name;

    if (!content.includes(flagName)) {
      return { valid: false, message: `Flag not found: ${flagName}` };
    }

    const expectedValue = memory.source.value;
    if (expectedValue !== undefined) {
      const match = content.match(
        new RegExp(
          `${flagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*["']?([^"'\n]+)["']?`,
        ),
      );
      if (!match || match[1] !== expectedValue) {
        return {
          valid: false,
          message: `Flag value mismatch. Expected: ${expectedValue}, found: ${match ? match[1] : 'not found'}`,
        };
      }
    }

    return { valid: true, message: 'Flag verified' };
  }

  async verifyMemory(memory) {
    if (!memory.source) {
      return { valid: true, message: 'No source to verify' };
    }

    switch (memory.source.type) {
      case 'file':
        return this.verifyFileReference(memory);
      case 'function':
        return this.verifyFunctionReference(memory);
      case 'flag':
        return this.verifyFlag(memory);
      default:
        return { valid: true, message: `Unknown source type: ${memory.source.type}` };
    }
  }

  // ── Git-aware 增强验证 ──────────────────────────────────────────────

  /**
   * 创建一条 memory 的 provenance，存入 map。
   * @param {string} memoryId     memory ID
   * @param {object} memory       memory 条目
   * @returns {object}            provenance 对象
   */
  recordProvenance(memoryId, memory) {
    const provenance = MemoryProvenance.create(memory, this.#workingDir);
    this.#provenanceMap.set(memoryId, provenance);
    // 注入到 memory 对象
    memory._provenance = provenance;
    return provenance;
  }

  /**
   * 验证一条带有 provenance 的 memory 是否仍然有效。
   * @param {string} memoryId
   * @param {object} memory
   * @returns {Promise<{valid: boolean, message: string, staleFiles?: string[]}>}
   */
  async verifyWithProvenance(memoryId, memory) {
    // 基础验证
    const baseResult = await this.verifyMemory(memory);
    if (!baseResult.valid) {
      return baseResult;
    }

    // 检查 provenance
    let provenance = memory._provenance || this.#provenanceMap.get(memoryId);
    if (!provenance || !provenance.sourceFiles || provenance.sourceFiles.length === 0) {
      return baseResult;
    }
    provenance = MemoryProvenance.reverify(provenance, this.#workingDir);

    const staleFiles = [];
    for (const sf of provenance.sourceFiles) {
      if (sf.stale) {
        staleFiles.push(sf.path);
      }
    }

    if (staleFiles.length > 0) {
      return {
        valid: false,
        message: `Source files changed since memory was created: ${staleFiles.join(', ')}`,
        staleFiles,
        provenance,
      };
    }

    return { valid: true, message: 'Memory verified (with provenance)', provenance };
  }

  /**
   * 批量验证所有 memory，标记过期的。
   * @param {Map<string, object>|object[]} memories
   * @returns {Promise<{valid: string[], stale: string[], results: object}>}
   */
  async verifyAll(memories) {
    const entries =
      memories instanceof Map
        ? [...memories.entries()]
        : memories.map((m, i) => [m.id || String(i), m]);

    const valid = [];
    const stale = [];
    const results = {};

    for (const [id, memory] of entries) {
      const result = memory._provenance
        ? await this.verifyWithProvenance(id, memory)
        : await this.verifyMemory(memory);
      results[id] = result;
      if (result.valid) {
        valid.push(id);
      } else {
        stale.push(id);
      }
    }

    return { valid, stale, results };
  }

  /**
   * Git diff 驱动的过期检测：
   *   找出所有引用过变更文件的 memories。
   * @param {Map<string, object>|object[]} memories
   * @returns {Promise<{staleIds: string[], changedFiles: string[], currentCommit: string|null}>}
   */
  async detectStaleByGitDiff(memories) {
    const { changedFiles, currentCommit } = this.#staleDetector.getChangedFiles();
    const memoryMap =
      memories instanceof Map ? memories : new Map(memories.map((m, i) => [m.id || String(i), m]));

    const staleIds = this.#staleDetector.findStaleMemories(changedFiles, memoryMap);
    return { staleIds, changedFiles, currentCommit };
  }

  /**
   * 标记一条 memory 的最后验证 commit。
   * @param {string} memoryId
   * @param {object} memory
   */
  markVerified(memoryId, memory) {
    const provenance = memory._provenance || this.#provenanceMap.get(memoryId);
    if (provenance) {
      MemoryProvenance.reverify(provenance, this.#workingDir);
    }
    memory._verifiedAt = Date.now();
  }

  // ── Memory 压缩与矛盾检测 ───────────────────────────────────────────

  /**
   * 检测 memory 集合中的矛盾。
   * @param {object[]} entries
   * @returns {{contradictions: {a: object, b: object, topic: string, reason: string}[]}}
   */
  static detectContradictions(entries) {
    const contradictions = [];

    // 按 topic 分组
    const byTopic = {};
    for (const entry of entries) {
      const topic = entry.topic || entry.type || 'general';
      if (!byTopic[topic]) {
        byTopic[topic] = [];
      }
      byTopic[topic].push(entry);
    }

    // 同组内比较简单关键词
    for (const [topic, group] of Object.entries(byTopic)) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const textA = (a.content || a.text || '').toLowerCase();
          const textB = (b.content || b.text || '').toLowerCase();

          // 简单矛盾检测（实际可用 AI embedding 做更精确检测）
          const contraSignals = [
            [['pnpm', 'yarn', 'npm'], 'package manager conflict'],
            [['esm', 'cjs'], 'module system conflict'],
            [['react', 'vue', 'angular'], 'framework conflict'],
            [['typescript', 'javascript'], 'language choice conflict'],
            [['mysql', 'postgres', 'sqlite'], 'database conflict'],
            [['prettier', 'eslint'], 'can coexist'],
          ];

          for (const [signals, reason] of contraSignals) {
            const foundA = signals.find((s) => textA.includes(s));
            const foundB = signals.find((s) => textB.includes(s));
            if (foundA && foundB && foundA !== foundB) {
              contradictions.push({
                a: { id: a.id, title: a.title },
                b: { id: b.id, title: b.title },
                topic,
                reason: `${reason}: ${foundA} vs ${foundB}`,
              });
              break; // 一对只报一次
            }
          }
        }
      }
    }

    return { contradictions };
  }

  /**
   * Compaction：合并重复/相似的 memories。
   * 找出重复的 topic 条目并归并。
   * @param {object[]} entries
   * @returns {{merged: object[], removedIds: string[]}}
   */
  static compact(entries) {
    const seen = new Map(); // topic → [{entry, index}]
    const removedIds = [];
    const merged = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const topic = entry.topic || 'general';
      const key = `${topic}:${entry.title || ''}`;

      if (!seen.has(key)) {
        seen.set(key, []);
        merged.push(entry);
      }
      seen.get(key).push(entry);

      // 如果有重复 topic+title，保留最新的，移除旧的
      const group = seen.get(key);
      if (group.length > 1) {
        // 保留最新 timestamp 的那个
        group.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const toRemove = group.slice(1);
        for (const r of toRemove) {
          if (!removedIds.includes(r.id)) {
            removedIds.push(r.id);
          }
        }
        // 从 merged 中移除旧条目
        for (const r of toRemove) {
          const idx = merged.findIndex((m) => m.id === r.id);
          if (idx >= 0) {
            merged.splice(idx, 1);
          }
        }
        // 确保最新的条目在 merged 中
        const best = group[0];
        if (!merged.find((m) => m.id === best.id)) {
          merged.push(best);
        }
      }
    }

    return { merged, removedIds };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 辅助工具
// ─────────────────────────────────────────────────────────────────────────────

class ProvenanceUtils {
  static fileContentHash(filePath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const normalized = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
      return createHash('sha256').update(normalized).digest('hex');
    } catch {
      return null;
    }
  }
}
