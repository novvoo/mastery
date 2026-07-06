import { ToolCategory } from '../../core/types/index.js';

const todoStateMap = new Map();

function normalizeTodos(todos) {
  if (!Array.isArray(todos)) {
    return [];
  }
  return todos.map((t, i) => ({
    content: String(t.content || t.name || t.title || `Step ${i + 1}`).trim(),
    status: ['pending', 'in_progress', 'completed'].includes(t.status)
      ? t.status
      : 'pending',
  }));
}

export function createTodoWriteTool() {
  return {
    name: 'TodoWrite',
    description: `Create and update a structured todo list to track progress within a session.

When to use:
- Complex multi-step tasks that require 3 or more distinct steps or actions
- Non-trivial and complex tasks that require careful planning or multiple operations
- User explicitly provides a list of things to be done (numbered or comma-separated)
- After receiving new instructions — immediately capture user requirements as todos
- When you start working on a task — mark it as in_progress before beginning work
- After completing a task — mark it as completed and add any new follow-up tasks discovered

When NOT to use:
- Single, straightforward tasks that can be completed in one step
- Trivial tasks that provide no organizational benefit
- Purely conversational or informational requests

State rules:
- pending: not yet started
- in_progress: currently working on (ideally only one at a time)
- completed: task finished successfully

Always capture the user's FULL request as a decomposed todo list. Break multi-step instructions into individual items so you don't lose track of any requirement.`,
    category: ToolCategory.SYSTEM,
    params: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The task description (e.g. "Implement test module")' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Task status' },
          },
          required: ['content', 'status'],
        },
        description: 'Complete list of all todo items with their current status. Provide the FULL list each time — previous state is replaced.',
      },
    },
    required: ['todos'],
    handler: async ({ todos }, ctx) => {
      const normalized = normalizeTodos(todos);
      const sessionId = ctx.sessionManager?.getSessionId?.() || ctx.toolName || 'default';
      const previous = todoStateMap.get(sessionId) || [];
      todoStateMap.set(sessionId, normalized);

      const pending = normalized.filter((t) => t.status === 'pending').length;
      const inProgress = normalized.filter((t) => t.status === 'in_progress').length;
      const completed = normalized.filter((t) => t.status === 'completed').length;
      const total = normalized.length;

      const preview = normalized
        .map((t) => `  [${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '→' : ' '}] ${t.content}`)
        .join('\n');

      const changedCount = normalized.length !== previous.length
        ? 'Structure changed'
        : `${normalized.filter((t, i) => previous[i]?.status !== t.status).length} status updates`;

      return {
        success: true,
        total,
        pending,
        inProgress,
        completed,
        changedCount,
        summary: `${total} items: ${completed} done, ${inProgress} in progress, ${pending} pending. ${changedCount}.`,
        todos: preview,
      };
    },
  };
}
