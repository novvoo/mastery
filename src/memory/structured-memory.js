import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { MemoryType, MemoryStatus, MemoryEntry } from './memory-types.js';

const MAX_INDEX_SIZE = 50;
const MEMORY_DIR = '.agent-memory';
const INDEX_FILE = 'MEMORY.md';
const ENTRIES_DIR = 'entries';

export class StructuredMemory {
  #workingDir;
  #memoryDir;
  #indexPath;
  #entriesDir;
  #entries;
  #dirty;
  #saveTimer;

  constructor(workingDir) {
    this.#workingDir = workingDir;
    this.#memoryDir = join(workingDir, MEMORY_DIR);
    this.#indexPath = join(this.#memoryDir, INDEX_FILE);
    this.#entriesDir = join(this.#memoryDir, ENTRIES_DIR);
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
      const { unlinkSync } = require('fs');
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

  clear() {
    for (const id of this.#entries.keys()) {
      this.#deleteEntry(id);
    }
    this.#entries.clear();
    this.#dirty = true;
    this.save();
  }
}