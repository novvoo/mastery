import { describe, test, expect } from 'bun:test';
import { createTodoWriteTool } from '../../src/tools/system/todo-write.js';

function createMockContext(sessionId) {
  return {
    sessionManager: {
      getSessionId: () => sessionId || 'test-session',
    },
    toolName: 'TodoWrite',
  };
}

describe('TodoWrite tool', () => {
  test('has required name and params', () => {
    const tool = createTodoWriteTool();
    expect(tool.name).toBe('TodoWrite');
    expect(tool.required).toContain('todos');
    expect(tool.params.todos.type).toBe('array');
  });

  test('accepts empty todos and returns zero counts', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler({ todos: [] }, createMockContext());
    expect(result.success).toBe(true);
    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.inProgress).toBe(0);
  });

  test('normalizes todos with minimal fields', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler(
      {
        todos: [
          { content: 'Task one', status: 'in_progress' },
          { content: 'Task two', status: 'pending' },
        ],
      },
      createMockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.inProgress).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.todos).toContain('[→] Task one');
    expect(result.todos).toContain('[ ] Task two');
  });

  test('handles completed tasks', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler(
      {
        todos: [
          { content: 'Write tests', status: 'completed' },
          { content: 'Run tests', status: 'completed' },
          { content: 'Fix bugs', status: 'in_progress' },
        ],
      },
      createMockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.total).toBe(3);
    expect(result.completed).toBe(2);
    expect(result.inProgress).toBe(1);
    expect(result.pending).toBe(0);
    expect(result.todos).toContain('[✓] Write tests');
    expect(result.todos).toContain('[✓] Run tests');
    expect(result.todos).toContain('[→] Fix bugs');
  });

  test('falls back to defaults for missing status', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler(
      {
        todos: [{ content: 'Only task' }],
      },
      createMockContext(),
    );
    expect(result.success).toBe(true);
    expect(result.total).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.summary).toContain('0 done');
  });

  test('accepts name/title as content alias', async () => {
    const tool = createTodoWriteTool();
    const resultByName = await tool.handler(
      { todos: [{ name: 'Task by name', status: 'pending' }] },
      createMockContext(),
    );
    const resultByTitle = await tool.handler(
      { todos: [{ title: 'Task by title', status: 'pending' }] },
      createMockContext(),
    );
    expect(resultByName.todos).toContain('Task by name');
    expect(resultByTitle.todos).toContain('Task by title');
  });

  test('rejects invalid status gracefully', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler(
      {
        todos: [
          { content: 'Valid', status: 'in_progress' },
          { content: 'Invalid status', status: 'nonexistent' },
        ],
      },
      createMockContext(),
    );
    expect(result.total).toBe(2);
    expect(result.inProgress).toBe(1);
    expect(result.pending).toBe(1);
  });

  test('tracks changes between calls (per session)', async () => {
    const tool = createTodoWriteTool();
    const ctx = createMockContext('changes-session');

    // First call
    const r1 = await tool.handler(
      {
        todos: [
          { content: 'A', status: 'pending' },
          { content: 'B', status: 'in_progress' },
        ],
      },
      ctx,
    );
    expect(r1.changedCount).toBe('Structure changed');

    // Second call: same structure, B completed
    const r2 = await tool.handler(
      {
        todos: [
          { content: 'A', status: 'pending' },
          { content: 'B', status: 'completed' },
        ],
      },
      ctx,
    );
    expect(r2.changedCount).toContain('status updates');

    // Third call: same structure, no changes
    const r3 = await tool.handler(
      {
        todos: [
          { content: 'A', status: 'pending' },
          { content: 'B', status: 'completed' },
        ],
      },
      ctx,
    );
    expect(r3.changedCount).toContain('0 status updates');
  });

  test('sessions are isolated from each other', async () => {
    const tool = createTodoWriteTool();
    const ctxA = createMockContext('session-a');
    const ctxB = createMockContext('session-b');

    await tool.handler(
      { todos: [{ content: 'Task A1', status: 'completed' }] },
      ctxA,
    );
    await tool.handler(
      { todos: [{ content: 'Task B1', status: 'in_progress' }] },
      ctxB,
    );

    // Third call on session A should still see session A's previous state
    const r3 = await tool.handler(
      { todos: [{ content: 'Task A1', status: 'completed' }] },
      ctxA,
    );
    expect(r3.changedCount).toContain('0 status updates');
  });

  test('handles new (name-based) task schema', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler(
      {
        todos: [
          { name: 'Explore', status: 'completed' },
          { name: 'Implement', status: 'in_progress' },
          { name: 'Verify', status: 'pending' },
        ],
      },
      createMockContext(),
    );
    expect(result.total).toBe(3);
    expect(result.todos).toContain('Explore');
    expect(result.todos).toContain('Implement');
    expect(result.todos).toContain('Verify');
  });

  test('description contains usage guidance', () => {
    const tool = createTodoWriteTool();
    expect(tool.description).toContain('When to use');
    expect(tool.description).toContain('When NOT to use');
    expect(tool.description).toContain('Complex multi-step');
    expect(tool.description).toContain('Single, straightforward');
    expect(tool.description).toContain('Always capture');
  });

  test('uses default session id when no sessionManager', async () => {
    const tool = createTodoWriteTool();
    const result = await tool.handler(
      { todos: [{ content: 'Orphan task', status: 'pending' }] },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.total).toBe(1);
  });

  test('ToolRegistry validation passes with valid todos', async () => {
    const { ToolRegistry } = await import('../../src/core/runtime/agent/tool-registry.js');
    const registry = new ToolRegistry();
    const tool = createTodoWriteTool();
    registry.register(tool);

    const result = registry.validateAndCoerceArgs('TodoWrite', {
      todos: [
        { content: 'Write tests', status: 'pending' },
        { content: 'Run them', status: 'in_progress' },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
