import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  appendFileSync,
  statSync,
} from 'fs';
import { resolve, join } from 'path';
import { MemoryType, MemoryStatus, MemoryEntry, MemoryTopic, inferTopic } from './memory-types.js';

const MAX_INDEX_SIZE = 50;
const MEMORY_DIR = '.agent-memory';
const INDEX_FILE = 'MEMORY.md';
const ENTRIES_DIR = 'entries';
const TOPICS_DIR = 'topics';

export class StructuredMemory {
  #workingDir;
  #memoryDir;
  #indexPath;
  #entriesDir;
  #topicsDir;
  #entries;
  #dirty;
  #saveTimer;
  /** @type {boolean} 标记 entries 是否已从磁盘加载 */
  #loaded = false;
  /** @type {number} entries 目录的 mtime（用于增量重载） */
  #entriesDirMtime = 0;

  constructor(workingDir) {
    this.#workingDir = workingDir;
    this.#memoryDir = join(workingDir, MEMORY_DIR);
    this.#indexPath = join(this.#memoryDir, INDEX_FILE);
    this.#entriesDir = join(this.#memoryDir, ENTRIES_DIR);
    this.#topicsDir = join(this.#memoryDir, TOPICS_DIR);
    this.#entries = new Map();
    this.#dirty = false;
    this.#saveTimer = null;
    this.#init();
  }

  #init() {
    if (!existsSync(this.#memoryDir)) {
      mkdirSync(this.#memoryDir, { recursive: true });
    }
    if (!existsSync(this.#entriesDir)) {
      mkdirSync(this.#entriesDir, { recursive: true });
    }
    if (!existsSync(this.#topicsDir)) {
      mkdirSync(this.#topicsDir, { recursive: true });
    }
    // 延迟加载：不在构造时同步读磁盘，仅在首次访问 entries 时触发
  }

  /**
   * 确保 entries 已从磁盘加载。仅首次调用时执行磁盘 I/O。
   * 后续调用检查 entries 目录的 mtime，仅在目录有变化时才重新加载。
   */
  #ensureLoaded() {
    if (!this.#loaded) {
      this.#loadFromDisk();
      this.#loaded = true;
      return;
    }
    // 增量检查：entries 目录 mtime 是否有变化
    if (existsSync(this.#entriesDir)) {
      try {
        const currentMtime = statSync(this.#entriesDir).mtimeMs;
        if (currentMtime > this.#entriesDirMtime) {
          this.#loadFromDisk();
          this.#entriesDirMtime = currentMtime;
        }
      } catch {
        /* 静默 */
      }
    }
  }

  #loadFromDisk() {
    this.#entries.clear();

    if (existsSync(this.#entriesDir)) {
      try {
        const files = readdirSync(this.#entriesDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = join(this.#entriesDir, file);
            const content = readFileSync(filePath, 'utf-8');
            try {
              const entry = MemoryEntry.fromMarkdown(content);
              this.#entries.set(entry.id, entry);
            } catch (e) {
              console.warn(`Failed to parse memory entry ${file}: ${e.message}`);
            }
          }
        }
        this.#entriesDirMtime = statSync(this.#entriesDir).mtimeMs;
      } catch (e) {
        console.warn(`Failed to load memory entries: ${e.message}`);
      }
    }
  }

  /** 强制从磁盘重新加载（外部新增了文件时调用） */
  reload() {
    this.#loadFromDisk();
    this.#loaded = true;
  }

  #saveEntry(entry) {
    if (!existsSync(this.#entriesDir)) {
      mkdirSync(this.#entriesDir, { recursive: true });
    }
    const filePath = join(this.#entriesDir, `${entry.id}.md`);
    writeFileSync(filePath, entry.toMarkdown(), 'utf-8');
  }

  #deleteEntry(entryId) {
    const filePath = join(this.#entriesDir, `${entryId}.md`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  save() {
    if (!this.#dirty) {
      return;
    }

    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
    }

    this.#saveTimer = setTimeout(() => {
      try {
        this.#ensureLoaded();
        for (const entry of this.#entries.values()) {
          this.#saveEntry(entry);
        }
        this.#writeIndex();
        this.#dirty = false;
      } catch (e) {
        // 目录可能已被清理（测试等场景），静默失败
        if (e.code !== 'ENOENT') {
          console.warn(`Failed to save memory: ${e.message}`);
        }
      }
      this.#saveTimer = null;
    }, 1000);
  }

  flush() {
    this.#ensureLoaded();
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    for (const entry of this.#entries.values()) {
      this.#saveEntry(entry);
    }
    this.#writeIndex();
    this.#dirty = false;
  }

  add(type, title, content, options = {}) {
    this.#ensureLoaded();
    const entry = new MemoryEntry({
      type,
      title,
      content,
      metadata: options.metadata || {},
      tags: options.tags || [],
      source: options.source || null,
    });

    this.#entries.set(entry.id, entry);
    this.#dirty = true;

    // 自动追加到 topic 文件
    const topic = options.topic || null;
    this.appendToTopic(entry, topic);

    if (options.syncSave) {
      this.flush();
    } else {
      this.save();
    }

    return entry;
  }

  addUser(title, content, options = {}) {
    return this.add(MemoryType.USER, title, content, options);
  }

  addFeedback(title, content, options = {}) {
    return this.add(MemoryType.FEEDBACK, title, content, options);
  }

  addProject(title, content, options = {}) {
    return this.add(MemoryType.PROJECT, title, content, options);
  }

  addReference(title, content, options = {}) {
    return this.add(MemoryType.REFERENCE, title, content, options);
  }

  get(id) {
    this.#ensureLoaded();
    const entry = this.#entries.get(id);
    if (entry) {
      entry.access();
      this.#dirty = true;
      this.save();
    }
    return entry || null;
  }

  getAll(type = null) {
    this.#ensureLoaded();
    const entries = Array.from(this.#entries.values());
    if (type) {
      return entries.filter((e) => e.type === type);
    }
    return entries;
  }

  delete(id) {
    this.#ensureLoaded();
    const entry = this.#entries.get(id);
    if (entry) {
      this.#deleteEntry(id);
      this.#entries.delete(id);
      this.#dirty = true;
      this.save();
      return true;
    }
    return false;
  }

  #writeIndex() {
    this.#ensureLoaded();
    if (!existsSync(this.#memoryDir)) {
      mkdirSync(this.#memoryDir, { recursive: true });
    }
    const entries = Array.from(this.#entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_INDEX_SIZE);

    const lines = [
      '# Memory Index',
      '',
      '## Overview',
      '',
      `Total memories: ${this.#entries.size}`,
      `User: ${this.getAll(MemoryType.USER).length}`,
      `Feedback: ${this.getAll(MemoryType.FEEDBACK).length}`,
      `Project: ${this.getAll(MemoryType.PROJECT).length}`,
      `Reference: ${this.getAll(MemoryType.REFERENCE).length}`,
      '',
      '## Memory Entries',
      '',
      '| ID | Type | Title | Age | Status |',
      '|----|------|-------|-----|--------|',
    ];

    for (const entry of entries) {
      const ageDays = Math.floor((Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24));
      const status = entry.isStale() ? MemoryStatus.STALE : entry.status;
      lines.push(`| ${entry.id} | ${entry.type} | ${entry.title} | ${ageDays}d | ${status} |`);
    }

    writeFileSync(this.#indexPath, lines.join('\n') + '\n', 'utf-8');
  }

  getIndex() {
    if (existsSync(this.#indexPath)) {
      return readFileSync(this.#indexPath, 'utf-8');
    }
    return '# Memory Index\n\nNo memories yet.';
  }

  getIndexSummary() {
    this.#ensureLoaded();
    const entries = Array.from(this.#entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    const lines = ['[MEMORY INDEX - Available memories for context:]', ''];

    for (const entry of entries) {
      const ageDays = Math.floor((Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24));
      const staleMarker = entry.isStale() ? ' ⚠️STALE' : '';
      lines.push(
        `- [${entry.type}] ${entry.title} (id: ${entry.id}, age: ${ageDays}d${staleMarker})`,
      );
    }

    if (entries.length === 0) {
      lines.push('No memories available.');
    }

    lines.push('');
    lines.push(
      '[To use a memory, request full content by ID. Stale memories should be verified before use.]',
    );

    return lines.join('\n');
  }

  getFullContent(id) {
    const entry = this.get(id);
    if (!entry) {
      return null;
    }

    let content = entry.toMarkdown();

    if (entry.isStale()) {
      content = `⚠️ WARNING: This memory is ${Math.floor((Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24))} days old and may be outdated. Please verify before relying on this information.\n\n${content}`;
    }

    return content;
  }

  getStats() {
    this.#ensureLoaded();
    return {
      total: this.#entries.size,
      user: this.getAll(MemoryType.USER).length,
      feedback: this.getAll(MemoryType.FEEDBACK).length,
      project: this.getAll(MemoryType.PROJECT).length,
      reference: this.getAll(MemoryType.REFERENCE).length,
      stale: this.getAll().filter((e) => e.isStale()).length,
    };
  }

  // ── Topic-file 组织 ──────────────────────────────────────────────────

  /**
   * 将一条记忆追加到对应 topic 文件中（人可读主题笔记本）。
   * 自动推断 topic 分类，同时保留原始 entries/mem_xxx.md。
   *
   * @param {MemoryEntry} entry
   * @param {string} [topic] - 显式指定 topic，不指定则自动推断
   * @returns {string} topic 文件名
   */
  appendToTopic(entry, topic = null) {
    const targetTopic = topic || inferTopic(entry.type, entry.tags, entry.content);
    const topicPath = join(this.#topicsDir, `${targetTopic}.md`);

    // 如果 topic 文件不存在，创建带标题头的新文件
    if (!existsSync(topicPath)) {
      const header = this.#topicHeader(targetTopic);
      writeFileSync(topicPath, header, 'utf-8');
    }

    // 追加记忆区块
    const block = this.#topicEntryBlock(entry);
    appendFileSync(topicPath, block, 'utf-8');

    return targetTopic;
  }

  /**
   * 读取指定 topic 文件内容。
   * @param {string} topic
   * @returns {string|null}
   */
  readTopic(topic) {
    const topicPath = join(this.#topicsDir, `${topic}.md`);
    if (!existsSync(topicPath)) {
      return null;
    }
    return readFileSync(topicPath, 'utf-8');
  }

  /**
   * 列出所有 topic 文件。
   * @returns {Array<{ topic: string, path: string, size: number, entryCount: number }>}
   */
  listTopics() {
    if (!existsSync(this.#topicsDir)) {
      return [];
    }
    const files = readdirSync(this.#topicsDir).filter((f) => f.endsWith('.md'));
    return files
      .map((f) => {
        const topicPath = join(this.#topicsDir, f);
        const content = readFileSync(topicPath, 'utf-8');
        return {
          topic: f.replace('.md', ''),
          path: topicPath,
          size: content.length,
          entryCount: (content.match(/^### /gm) || []).length,
        };
      })
      .sort((a, b) => b.size - a.size);
  }

  /**
   * 获取 topic 目录的摘要（注入 system prompt）。
   */
  getTopicSummary() {
    const topics = this.listTopics();
    if (topics.length === 0) {
      return '';
    }

    const lines = ['[TOPIC FILES - Reference notebooks for common themes:]'];
    for (const t of topics) {
      lines.push(`  - ${t.topic}.md (${t.entryCount} entries, ${this.#formatSize(t.size)})`);
    }
    return lines.join('\n');
  }

  /**
   * 将 entries/ 下已有记忆迁移到 topic 文件（首次启用时调用）。
   */
  migrateToTopics() {
    this.#ensureLoaded();
    const migrated = [];
    for (const entry of this.#entries.values()) {
      const topic = this.appendToTopic(entry);
      migrated.push({ id: entry.id, topic });
    }
    return migrated;
  }

  // ── 私有：topic 辅助 ───────────────────────────────────────────────

  #topicHeader(topic) {
    const title = topic.charAt(0).toUpperCase() + topic.slice(1);
    return `# ${title}\n\n> Auto-generated topic notebook. Last updated: ${new Date().toISOString()}\n> Use \`read_memory\` to retrieve individual entries.\n\n`;
  }

  #topicEntryBlock(entry) {
    const date = new Date(entry.timestamp).toISOString().split('T')[0];
    const tags = entry.tags.length > 0 ? ` \`#${entry.tags.join('` `#')}\`` : '';
    return [
      '',
      `### ${entry.title}`,
      '',
      `- **ID**: \`${entry.id}\``,
      `- **Type**: \`${entry.type}\``,
      `- **Date**: ${date}${tags}`,
      `- **Status**: ${entry.isStale() ? '⚠️ STALE' : entry.status}`,
      '',
      entry.content,
      '',
      '---',
      '',
    ].join('\n');
  }

  #formatSize(bytes) {
    if (bytes < 1024) {
      return `${bytes}B`;
    }
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  clear() {
    this.#ensureLoaded();
    for (const id of this.#entries.keys()) {
      this.#deleteEntry(id);
    }
    this.#entries.clear();
    this.#dirty = true;
    this.save();
  }
}
