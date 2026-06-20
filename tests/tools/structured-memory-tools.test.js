import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createStructuredMemoryTools } from '../../src/tools/memory/structured-memory-tools.js';
import { AgentMemory } from '../../src/memory/agent-memory.js';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('StructuredMemoryTools', () => {
  let workingDir;
  let memory;
  let tools;
  let ctx;

  beforeEach(() => {
    workingDir = join(tmpdir(), `memory-tools-test-${Date.now()}`);
    memory = new AgentMemory(workingDir);
    tools = createStructuredMemoryTools();
    ctx = { memoryManager: memory };
  });

  afterEach(() => {
    if (existsSync(workingDir)) {
      rmSync(workingDir, { recursive: true });
    }
  });

  test('createStructuredMemoryTools returns all tools', () => {
    const allTools = createStructuredMemoryTools();
    expect(allTools.length).toBe(6);
    expect(allTools.map(t => t.name)).toEqual([
      'write_memory',
      'read_memory',
      'retrieve_memory',
      'list_memory',
      'delete_memory',
      'verify_memory'
    ]);
  });

  test('write_memory tool creates user memory', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'user',
      title: 'Test User Memory',
      content: 'Test content'
    }, ctx);
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    expect(result.type).toBe('user');
    expect(result.title).toBe('Test User Memory');
  });

  test('write_memory tool creates feedback memory', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'feedback',
      title: 'Test Feedback',
      content: 'Test content'
    }, ctx);
    expect(result.success).toBe(true);
    expect(result.type).toBe('feedback');
  });

  test('write_memory tool creates project memory', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'project',
      title: 'Test Project',
      content: 'Test content'
    }, ctx);
    expect(result.success).toBe(true);
    expect(result.type).toBe('project');
  });

  test('write_memory tool creates reference memory', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'reference',
      title: 'Test Reference',
      content: 'Test content'
    }, ctx);
    expect(result.success).toBe(true);
    expect(result.type).toBe('reference');
  });

  test('write_memory tool returns error for invalid type', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'invalid',
      title: 'Test',
      content: 'Content'
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid memory type');
  });

  test('write_memory tool returns error when memory manager not available', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'user',
      title: 'Test',
      content: 'Content'
    }, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Memory manager not available');
  });

  test('read_memory tool returns memory content', async () => {
    const entry = memory.addUser('Test', 'Content');
    const readTool = tools.find(t => t.name === 'read_memory');
    const result = await readTool.handler({ id: entry.id }, ctx);
    expect(result.success).toBe(true);
    expect(result.id).toBe(entry.id);
    expect(result.content).toContain('Content');
  });

  test('read_memory tool returns error for non-existent ID', async () => {
    const readTool = tools.find(t => t.name === 'read_memory');
    const result = await readTool.handler({ id: 'non-existent-id' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Memory not found');
  });

  test('retrieve_memory tool returns relevant memories', async () => {
    memory.addUser('React preference', 'User likes React');
    memory.addProject('Vue project', 'Using Vue.js');
    const retrieveTool = tools.find(t => t.name === 'retrieve_memory');
    const result = await retrieveTool.handler({ query: 'React' }, ctx);
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.results[0].title).toBe('React preference');
  });

  test('retrieve_memory tool respects limit', async () => {
    memory.addUser('User1', 'test content');
    memory.addUser('User2', 'test content');
    memory.addUser('User3', 'test content');
    const retrieveTool = tools.find(t => t.name === 'retrieve_memory');
    const result = await retrieveTool.handler({ query: 'test', limit: 2 }, ctx);
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
  });

  test('retrieve_memory tool filters by types', async () => {
    memory.addUser('User1', 'test content');
    memory.addProject('Project1', 'test content');
    const retrieveTool = tools.find(t => t.name === 'retrieve_memory');
    const result = await retrieveTool.handler({ query: 'test', types: ['user'] }, ctx);
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.results[0].type).toBe('user');
  });

  test('list_memory tool returns all memories', async () => {
    memory.addUser('User1', 'Content1');
    memory.addProject('Project1', 'Content2');
    const listTool = tools.find(t => t.name === 'list_memory');
    const result = await listTool.handler({}, ctx);
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.stats.total).toBe(2);
    expect(result.memories.length).toBe(2);
  });

  test('list_memory tool filters by type', async () => {
    memory.addUser('User1', 'Content1');
    memory.addUser('User2', 'Content2');
    memory.addProject('Project1', 'Content3');
    const listTool = tools.find(t => t.name === 'list_memory');
    const result = await listTool.handler({ type: 'user' }, ctx);
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.memories.every(m => m.type === 'user')).toBe(true);
  });

  test('delete_memory tool deletes memory', async () => {
    const entry = memory.addUser('Test', 'Content');
    const deleteTool = tools.find(t => t.name === 'delete_memory');
    const result = await deleteTool.handler({ id: entry.id }, ctx);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Memory deleted successfully');
    expect(memory.get(entry.id)).toBe(null);
  });

  test('delete_memory tool returns error for non-existent ID', async () => {
    const deleteTool = tools.find(t => t.name === 'delete_memory');
    const result = await deleteTool.handler({ id: 'non-existent-id' }, ctx);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Memory not found');
  });

  test('verify_memory tool verifies memory', async () => {
    const entry = memory.addUser('Test', 'Content');
    const verifyTool = tools.find(t => t.name === 'verify_memory');
    const result = await verifyTool.handler({ id: entry.id }, ctx);
    expect(result.success).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.memory.id).toBe(entry.id);
  });

  test('verify_memory tool returns error for non-existent ID', async () => {
    const verifyTool = tools.find(t => t.name === 'verify_memory');
    const result = await verifyTool.handler({ id: 'non-existent-id' }, ctx);
    expect(result.success).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.memory).toBe(null);
  });

  test('write_memory tool stores tags', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'user',
      title: 'Test',
      content: 'Content',
      tags: ['tag1', 'tag2']
    }, ctx);
    expect(result.success).toBe(true);
    const stored = memory.get(result.id);
    expect(stored.tags).toEqual(['tag1', 'tag2']);
  });

  test('write_memory tool stores source', async () => {
    const writeTool = tools.find(t => t.name === 'write_memory');
    const result = await writeTool.handler({
      type: 'user',
      title: 'Test',
      content: 'Content',
      source: { type: 'file', path: 'test.txt' }
    }, ctx);
    expect(result.success).toBe(true);
    const stored = memory.get(result.id);
    expect(stored.source).toEqual({ type: 'file', path: 'test.txt' });
  });

  test('retrieve_memory tool returns verification info', async () => {
    memory.addUser('Test', 'Content');
    const retrieveTool = tools.find(t => t.name === 'retrieve_memory');
    const result = await retrieveTool.handler({ query: 'test', forceVerification: true }, ctx);
    expect(result.success).toBe(true);
    expect(result.results[0].verification).toBeDefined();
  });

  test('list_memory tool returns usage count', async () => {
    const entry = memory.addUser('Test', 'Content');
    memory.get(entry.id);
    memory.get(entry.id);
    const listTool = tools.find(t => t.name === 'list_memory');
    const result = await listTool.handler({}, ctx);
    expect(result.success).toBe(true);
    expect(result.memories[0].usage_count).toBe(2);
  });

  test('retrieve_memory tool returns empty when no matches', async () => {
    memory.addUser('Vue preference', 'User likes Vue');
    const retrieveTool = tools.find(t => t.name === 'retrieve_memory');
    const result = await retrieveTool.handler({ query: 'React' }, ctx);
    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
  });
});