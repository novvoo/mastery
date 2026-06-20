import { describe, test, expect, beforeEach } from 'bun:test';
import { MemoryEntry, MemoryType, MemoryStatus, StaleThreshold } from '../../src/memory/memory-types.js';

describe('MemoryType', () => {
  test('defines all expected types', () => {
    expect(MemoryType.USER).toBe('user');
    expect(MemoryType.FEEDBACK).toBe('feedback');
    expect(MemoryType.PROJECT).toBe('project');
    expect(MemoryType.REFERENCE).toBe('reference');
  });
});

describe('MemoryStatus', () => {
  test('defines all expected statuses', () => {
    expect(MemoryStatus.ACTIVE).toBe('active');
    expect(MemoryStatus.STALE).toBe('stale');
    expect(MemoryStatus.VERIFIED).toBe('verified');
    expect(MemoryStatus.EXPIRED).toBe('expired');
  });
});

describe('StaleThreshold', () => {
  test('defines all expected thresholds in days', () => {
    expect(StaleThreshold.USER).toBe(7);
    expect(StaleThreshold.FEEDBACK).toBe(3);
    expect(StaleThreshold.PROJECT).toBe(2);
    expect(StaleThreshold.REFERENCE).toBe(14);
  });
});

describe('MemoryEntry', () => {
  let baseData;

  beforeEach(() => {
    baseData = {
      type: MemoryType.USER,
      title: 'Test Title',
      content: 'Test content',
    };
  });

  test('constructor creates entry with required fields', () => {
    const entry = new MemoryEntry(baseData);
    expect(entry.id).toBeDefined();
    expect(entry.type).toBe(MemoryType.USER);
    expect(entry.title).toBe('Test Title');
    expect(entry.content).toBe('Test content');
    expect(entry.timestamp).toBeDefined();
    expect(entry.lastUsed).toBe(entry.timestamp);
    expect(entry.status).toBe(MemoryStatus.ACTIVE);
    expect(entry.usageCount).toBe(0);
    expect(entry.metadata).toEqual({});
    expect(entry.source).toBe(null);
    expect(entry.tags).toEqual([]);
    expect(entry.relatedIds).toEqual([]);
  });

  test('constructor generates unique IDs', () => {
    const entry1 = new MemoryEntry(baseData);
    const entry2 = new MemoryEntry(baseData);
    expect(entry1.id).not.toBe(entry2.id);
  });

  test('constructor accepts optional fields', () => {
    const data = {
      ...baseData,
      tags: ['tag1', 'tag2'],
      metadata: { author: 'test' },
      source: { type: 'file', path: 'test.txt' },
      relatedIds: ['mem_1'],
    };
    const entry = new MemoryEntry(data);
    expect(entry.tags).toEqual(['tag1', 'tag2']);
    expect(entry.metadata).toEqual({ author: 'test' });
    expect(entry.source).toEqual({ type: 'file', path: 'test.txt' });
  });

  test('constructor validates required fields', () => {
    expect(() => new MemoryEntry({ type: MemoryType.USER, title: 'Test' }))
      .toThrow('Memory content is required');
    expect(() => new MemoryEntry({ type: MemoryType.USER, content: 'Test' }))
      .toThrow('Memory title is required');
    expect(() => new MemoryEntry({ title: 'Test', content: 'Test' }))
      .toThrow('Invalid memory type');
  });

  test('constructor validates type', () => {
    expect(() => new MemoryEntry({ type: 'invalid', title: 'Test', content: 'Test' }))
      .toThrow('Invalid memory type');
  });

  test('toMarkdown generates correct format', () => {
    const entry = new MemoryEntry(baseData);
    const markdown = entry.toMarkdown();
    expect(markdown).toContain('---');
    expect(markdown).toContain(`id: "${entry.id}"`);
    expect(markdown).toContain(`type: "${entry.type}"`);
    expect(markdown).toContain(`title: "${entry.title}"`);
    expect(markdown).toContain('Test content');
  });

  test('toMarkdown includes optional fields when present', () => {
    const data = {
      ...baseData,
      tags: ['tag1'],
      source: { type: 'file', path: 'test.txt' },
    };
    const entry = new MemoryEntry(data);
    const markdown = entry.toMarkdown();
    expect(markdown).toContain('tag1');
    expect(markdown).toContain('test.txt');
  });

  test('fromMarkdown parses markdown correctly', () => {
    const entry = new MemoryEntry(baseData);
    const markdown = entry.toMarkdown();
    const parsed = MemoryEntry.fromMarkdown(markdown);
    expect(parsed.id).toBe(entry.id);
    expect(parsed.type).toBe(entry.type);
    expect(parsed.title).toBe(entry.title);
    expect(parsed.content).toBe(entry.content);
    expect(parsed.status).toBe(entry.status);
  });

  test('fromMarkdown handles missing optional fields', () => {
    const markdown = `---
id: "test_id"
type: "user"
title: "Test"
timestamp: "2024-01-01T00:00:00.000Z"
status: "active"
---
Test content`;
    const parsed = MemoryEntry.fromMarkdown(markdown);
    expect(parsed.id).toBe('test_id');
    expect(parsed.tags).toEqual([]);
    expect(parsed.source).toBe(null);
  });

  test('isStale returns false for fresh entries', () => {
    const entry = new MemoryEntry(baseData);
    expect(entry.isStale()).toBe(false);
  });

  test('isStale returns true for stale entries', () => {
    const oldTimestamp = Date.now() - (StaleThreshold.USER * 24 * 60 * 60 * 1000) - 1000;
    const entry = new MemoryEntry({ ...baseData, timestamp: oldTimestamp });
    expect(entry.isStale()).toBe(true);
  });

  test('isStale uses type-specific thresholds', () => {
    const userEntry = new MemoryEntry({ type: MemoryType.USER, title: 'User', content: 'Test' });
    const feedbackEntry = new MemoryEntry({ type: MemoryType.FEEDBACK, title: 'Feedback', content: 'Test' });
    
    const staleTime = Date.now() - (StaleThreshold.FEEDBACK * 24 * 60 * 60 * 1000) - 1000;
    userEntry.timestamp = staleTime;
    feedbackEntry.timestamp = staleTime;
    
    expect(userEntry.isStale()).toBe(false);
    expect(feedbackEntry.isStale()).toBe(true);
  });

  test('isExpired returns false for non-expired entries', () => {
    const entry = new MemoryEntry(baseData);
    expect(entry.isExpired()).toBe(false);
  });

  test('isExpired returns true for entries older than 30 days', () => {
    const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000);
    const entry = new MemoryEntry({ ...baseData, timestamp: oldTimestamp });
    expect(entry.isExpired()).toBe(true);
  });

  test('access updates lastUsed and usageCount', () => {
    const entry = new MemoryEntry(baseData);
    const initialCount = entry.usageCount;
    
    entry.access();
    
    expect(entry.usageCount).toBe(initialCount + 1);
    expect(entry.lastUsed).toBeDefined();
  });

  test('access returns the entry', () => {
    const entry = new MemoryEntry(baseData);
    const result = entry.access();
    expect(result).toBe(entry);
  });

  test('toFrontmatter returns frontmatter object', () => {
    const entry = new MemoryEntry(baseData);
    const frontmatter = entry.toFrontmatter();
    expect(frontmatter.id).toBe(entry.id);
    expect(frontmatter.type).toBe(entry.type);
    expect(frontmatter.title).toBe(entry.title);
  });
});