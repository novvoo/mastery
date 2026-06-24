import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { StructuredMemory } from '../../src/memory/structured-memory.js';
import { MemoryType } from '../../src/memory/memory-types.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('StructuredMemory', () => {
  let workingDir;
  let memory;

  beforeEach(() => {
    workingDir = join(tmpdir(), `structured-memory-test-${Date.now()}`);
    memory = new StructuredMemory(workingDir);
  });

  afterEach(() => {
    if (existsSync(workingDir)) {
      rmSync(workingDir, { recursive: true });
    }
  });

  test('constructor initializes directories', () => {
    expect(existsSync(join(workingDir, '.agent-memory'))).toBe(true);
    expect(existsSync(join(workingDir, '.agent-memory', 'entries'))).toBe(true);
  });

  test('addUser creates user memory', () => {
    const entry = memory.addUser('User Preference', 'Prefers React');
    expect(entry.id).toBeDefined();
    expect(entry.type).toBe(MemoryType.USER);
    expect(entry.title).toBe('User Preference');
    expect(entry.content).toBe('Prefers React');
  });

  test('addFeedback creates feedback memory', () => {
    const entry = memory.addFeedback('Build Issue', 'Missing dependency');
    expect(entry.type).toBe(MemoryType.FEEDBACK);
  });

  test('addProject creates project memory', () => {
    const entry = memory.addProject('Tech Stack', 'Node.js + React');
    expect(entry.type).toBe(MemoryType.PROJECT);
  });

  test('addReference creates reference memory', () => {
    const entry = memory.addReference('API Docs', 'GET /api/users');
    expect(entry.type).toBe(MemoryType.REFERENCE);
  });

  test('get retrieves entry by ID', () => {
    const entry = memory.addUser('Test', 'Content');
    const retrieved = memory.get(entry.id);
    expect(retrieved.id).toBe(entry.id);
    expect(retrieved.title).toBe('Test');
  });

  test('get returns null for non-existent ID', () => {
    const retrieved = memory.get('non-existent-id');
    expect(retrieved).toBe(null);
  });

  test('getAll returns all entries', () => {
    memory.addUser('User1', 'Content1');
    memory.addProject('Project1', 'Content2');
    const all = memory.getAll();
    expect(all.length).toBe(2);
  });

  test('getAll filters by type', () => {
    memory.addUser('User1', 'Content1');
    memory.addUser('User2', 'Content2');
    memory.addProject('Project1', 'Content3');
    const users = memory.getAll(MemoryType.USER);
    expect(users.length).toBe(2);
    expect(users.every((u) => u.type === MemoryType.USER)).toBe(true);
  });

  test('delete removes entry', () => {
    const entry = memory.addUser('Test', 'Content');
    const deleted = memory.delete(entry.id);
    expect(deleted).toBe(true);
    expect(memory.get(entry.id)).toBe(null);
  });

  test('delete returns false for non-existent ID', () => {
    const deleted = memory.delete('non-existent-id');
    expect(deleted).toBe(false);
  });

  test('getFullContent returns complete markdown', () => {
    const entry = memory.addUser('Test', 'Content');
    const content = memory.getFullContent(entry.id);
    expect(content).toContain('---');
    expect(content).toContain(`id: "${entry.id}"`);
    expect(content).toContain('Content');
  });

  test('getFullContent returns null for non-existent ID', () => {
    const content = memory.getFullContent('non-existent-id');
    expect(content).toBe(null);
  });

  test('getStats returns correct counts', () => {
    memory.addUser('User1', 'Content');
    memory.addFeedback('Feedback1', 'Content');
    memory.addProject('Project1', 'Content');
    memory.addReference('Reference1', 'Content');
    const stats = memory.getStats();
    expect(stats.total).toBe(4);
    expect(stats.user).toBe(1);
    expect(stats.feedback).toBe(1);
    expect(stats.project).toBe(1);
    expect(stats.reference).toBe(1);
  });

  test('getIndex returns index content', () => {
    memory.addUser('Test', 'Content');
    memory.flush();
    const index = memory.getIndex();
    expect(index).toContain('# Memory Index');
    expect(index).toContain('Test');
  });

  test('getIndex returns empty message when no memories', () => {
    const index = memory.getIndex();
    expect(index).toBe('# Memory Index\n\nNo memories yet.');
  });

  test('getIndexSummary returns compact summary', () => {
    memory.addUser('Test', 'Content');
    const summary = memory.getIndexSummary();
    expect(summary).toContain('[MEMORY INDEX');
    expect(summary).toContain('Test');
  });

  test('flush writes changes to disk', () => {
    const entry = memory.addUser('Test', 'Content');
    memory.flush();

    const memory2 = new StructuredMemory(workingDir);
    const retrieved = memory2.get(entry.id);
    expect(retrieved).not.toBe(null);
    expect(retrieved.title).toBe('Test');
  });

  test('persistence works across instances', () => {
    const entry = memory.addUser('Persistent', 'Content');
    memory.flush();

    const memory2 = new StructuredMemory(workingDir);
    const all = memory2.getAll();
    expect(all.length).toBe(1);
    expect(all[0].title).toBe('Persistent');
  });

  test('clear removes all entries', () => {
    memory.addUser('User1', 'Content');
    memory.addProject('Project1', 'Content');
    memory.clear();
    expect(memory.getAll().length).toBe(0);
  });

  test('entries are stored as separate files', () => {
    const entry = memory.addUser('Test', 'Content');
    memory.flush();
    const entryPath = join(workingDir, '.agent-memory', 'entries', `${entry.id}.md`);
    expect(existsSync(entryPath)).toBe(true);
  });

  test('handles entries with special characters', () => {
    const entry = memory.addUser(
      'Title with "quotes" and @special#chars',
      'Content with new\nlines and special chars: $%^&*',
    );
    expect(entry.title).toBe('Title with "quotes" and @special#chars');
    expect(entry.content).toBe('Content with new\nlines and special chars: $%^&*');

    const retrieved = memory.get(entry.id);
    expect(retrieved.title).toBe(entry.title);
    expect(retrieved.content).toBe(entry.content);
  });

  test('loadFromDisk reads existing memory', () => {
    const entry = memory.addUser('Test', 'Content');
    memory.flush();

    const memory2 = new StructuredMemory(workingDir);
    const retrieved = memory2.get(entry.id);
    expect(retrieved).not.toBe(null);
    expect(retrieved.title).toBe('Test');
  });
});
