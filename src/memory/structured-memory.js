import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, appendFileSync } from 'fs';
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
    this.#load();
  }

  #load() {
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
      } catch (e) {
        console.warn(`Failed to load memory entries: ${e.message}`);
      }
    }
  }

  #saveEntry(entry) {
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
    if (!this.#dirty) return;

    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
    }

    this.#saveTimer = setTimeout(() => {
      for (const entry of this.#entries.values()) {
        this.#saveEntry(entry);
      }
      this.#writeIndex();
      this.#dirty = false;
      this.#saveTimer = null;
    }, 1000);
  }

  flush() {
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

    this.save();

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
    const entry = this.#entries.get(id);
    if (entry) {
      entry.access();
      this.#dirty = true;
      this.save();
    }
    return entry || null;
  }

  getAll(type = null) {
    const entries = Array.from(this.#entries.values());
    if (type) {
      return entries.filter(e => e.type === type);
    }
    return entries;
  }

  delete(id) {
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
    const entries = Array.from(this.#entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_INDEX_SIZE);

    const lines = ['# Memory Index', '', '## Overview', '',
      `Total memories: ${this.#entries.size}`,
      `User: ${this.getAll(MemoryType.USER).length}`,
      `Feedback: ${this.getAll(MemoryType.FEEDBACK).length}`,
      `Project: ${this.getAll(MemoryType.PROJECT).length}`,
      `Reference: ${this.getAll(MemoryType.REFERENCE).length}`,
      '', '## Memory Entries', '', '| ID | Type | Title | Age | Status |',
      '|----|------|-------|-----|--------|'
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
    const entries = Array.from(this.#entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    const lines = ['[MEMORY INDEX - Available memories for context:]', ''];

    for (const entry of entries) {
      const ageDays = Math.floor((Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24));
      const staleMarker = entry.isStale() ? ' ⚠️STALE' : '';
      lines.push(`- [${entry.type}] ${entry.title} (id: ${entry.id}, age: ${ageDays}d${staleMarker})`);
    }

    if (entries.length === 0) {
      lines.push('No memories available.');
    }

    lines.push('');
    lines.push('[To use a memory, request full content by ID. Stale memories should be verified before use.]');

    return lines.join('\n');
  }

  getFullContent(id) {
    const entry = this.get(id);
    if (!entry) return null;

    let content = entry.toMarkdown();

    if (entry.isStale()) {
      content = `⚠️ WARNING: This memory is ${Math.floor((Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24))} days old and may be outdated. Please verify before relying on this information.\n\n${content}`;
    }

    return content;
  }

  getStats() {
    return {
      total: this.#entries.size,
      user: this.getAll(MemoryType.USER).length,
      feedback: this.getAll(MemoryType.FEEDBACK).length,
      project: this.getAll(MemoryType.PROJECT).length,
      reference: this.getAll(MemoryType.REFERENCE).length,
      stale: this.getAll().filter(e => e.isStale()).length,
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
    if (!existsSync(topicPath)) { return null; }
    return readFileSync(topicPath, 'utf-8');
  }

  /**
   * 列出所有 topic 文件。
   * @returns {Array<{ topic: string, path: string, size: number, entryCount: number }>}
   */
  listTopics() {
    if (!existsSync(this.#topicsDir)) { return []; }
    const files = readdirSync(this.#topicsDir).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const topicPath = join(this.#topicsDir, f);
      const content = readFileSync(topicPath, 'utf-8');
      return {
        topic: f.replace('.md', ''),
        path: topicPath,
        size: content.length,
        entryCount: (content.match(/^### /gm) || []).length,
      };
    }).sort((a, b) => b.size - a.size);
  }

  /**
   * 获取 topic 目录的摘要（注入 system prompt）。
   */
  getTopicSummary() {
    const topics = this.listTopics();
    if (topics.length === 0) { return ''; }

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
    if (bytes < 1024) { return `${bytes}B`; }
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  clear() {
    for (const id of this.#entries.keys()) {
      this.#deleteEntry(id);
    }
    this.#entries.clear();
    this.#dirty = true;
    this.save();
  }
}
