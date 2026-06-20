import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { AgentMemory } from '../../src/memory/agent-memory.js';
import { MemoryType } from '../../src/memory/memory-types.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AgentMemory', () => {
  let workingDir;
  let memory;

  beforeEach(() => {
    workingDir = join(tmpdir(), `agent-memory-test-${Date.now()}`);
    memory = new AgentMemory(workingDir);
  });

  afterEach(() => {
    if (existsSync(workingDir)) {
      rmSync(workingDir, { recursive: true });
    }
  });

  test('constructor initializes components', () => {
    expect(memory).toBeDefined();
  });

  test('addUser creates user memory', () => {
    const entry = memory.addUser('Test User', 'Content');
    expect(entry.type).toBe(MemoryType.USER);
    expect(entry.title).toBe('Test User');
  });

  test('addFeedback creates feedback memory', () => {
    const entry = memory.addFeedback('Test Feedback', 'Content');
    expect(entry.type).toBe(MemoryType.FEEDBACK);
  });

  test('addProject creates project memory', () => {
    const entry = memory.addProject('Test Project', 'Content');
    expect(entry.type).toBe(MemoryType.PROJECT);
  });

  test('addReference creates reference memory', () => {
    const entry = memory.addReference('Test Reference', 'Content');
    expect(entry.type).toBe(MemoryType.REFERENCE);
  });

  test('get retrieves memory by ID', () => {
    const entry = memory.addUser('Test', 'Content');
    const retrieved = memory.get(entry.id);
    expect(retrieved.id).toBe(entry.id);
    expect(retrieved.title).toBe('Test');
  });

  test('get returns null for non-existent ID', () => {
    const retrieved = memory.get('non-existent-id');
    expect(retrieved).toBe(null);
  });

  test('getAll returns all memories', () => {
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
  });

  test('delete removes memory', () => {
    const entry = memory.addUser('Test', 'Content');
    const deleted = memory.delete(entry.id);
    expect(deleted).toBe(true);
    expect(memory.get(entry.id)).toBe(null);
  });

  test('retrieve returns relevant memories', async () => {
    memory.addUser('React preference', 'User likes React');
    memory.addProject('Vue project', 'Using Vue.js');
    const results = await memory.retrieve('React');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('React preference');
  });

  test('retrieve returns empty array when no memories', async () => {
    const results = await memory.retrieve('test');
    expect(results).toEqual([]);
  });

  test('retrieve filters by type', async () => {
    memory.addUser('User1', 'test content');
    memory.addProject('Project1', 'test content');
    const results = await memory.retrieve('test', { types: [MemoryType.USER] });
    expect(results.length).toBe(1);
    expect(results[0].type).toBe(MemoryType.USER);
  });

  test('retrieve applies limit', async () => {
    memory.addUser('User1', 'test content');
    memory.addUser('User2', 'test content');
    memory.addUser('User3', 'test content');
    const results = await memory.retrieve('test', { limit: 2 });
    expect(results.length).toBe(2);
  });

  test('retrieve excludes expired memories', async () => {
    const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000);
    const expiredEntry = memory.addUser('Expired', 'test content');
    expiredEntry.timestamp = oldTimestamp;
    
    const freshEntry = memory.addUser('Fresh', 'test content');
    
    const results = await memory.retrieve('test');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Fresh');
  });

  test('retrieveSync returns relevant memories', () => {
    memory.addUser('React preference', 'User likes React');
    memory.addProject('Vue project', 'Using Vue.js');
    const results = memory.retrieveSync('React');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('React preference');
  });

  test('getFullMemory returns complete content', () => {
    const entry = memory.addUser('Test', 'Content');
    const content = memory.getFullMemory(entry.id);
    expect(content).toContain('---');
    expect(content).toContain(`id: "${entry.id}"`);
    expect(content).toContain('Content');
  });

  test('verifyMemory verifies memory', async () => {
    const entry = memory.addUser('Test', 'Content');
    const result = await memory.verifyMemory(entry.id);
    expect(result.success).toBe(true);
  });

  test('verifyMemory returns error for non-existent ID', async () => {
    const result = await memory.verifyMemory('non-existent-id');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Memory not found');
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

  test('getMemoryContext returns context string', () => {
    memory.addUser('Test', 'Content');
    const context = memory.getMemoryContext();
    expect(context).toContain('[MEMORY INDEX');
    expect(context).toContain('Test');
  });

  test('getMemoryContext includes relevant memories for task', () => {
    memory.addUser('React preference', 'User likes React');
    const context = memory.getMemoryContext('React');
    expect(context).toContain('[RELEVANT MEMORIES');
    expect(context).toContain('React preference');
  });

  test('getIndexContent returns index', () => {
    memory.addUser('Test', 'Content');
    memory.flush();
    const index = memory.getIndexContent();
    expect(index).toContain('# Memory Index');
    expect(index).toContain('Test');
  });

  test('setModelProvider updates selector', () => {
    const mockProvider = { generate: async () => '1' };
    memory.setModelProvider(mockProvider);
    expect(memory).toBeDefined();
  });

  test('flush persists changes', () => {
    const entry = memory.addUser('Test', 'Content');
    memory.flush();
    
    const memory2 = new AgentMemory(workingDir);
    const retrieved = memory2.get(entry.id);
    expect(retrieved).not.toBe(null);
    expect(retrieved.title).toBe('Test');
  });

  test('clearAll removes all memories', () => {
    memory.addUser('User1', 'Content');
    memory.addProject('Project1', 'Content');
    memory.clearAll();
    expect(memory.getAll().length).toBe(0);
  });

  test('toPromptFragment returns combined prompt', () => {
    memory.addUser('Test', 'Content');
    const fragment = memory.toPromptFragment();
    expect(fragment).toContain('[MEMORY INDEX');
  });
});