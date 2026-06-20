import { ToolCategory } from '../../core/types.js';
import { MemoryType } from '../../memory/memory-types.js';

export function createStructuredMemoryTools() {
  return [
    createWriteMemoryTool(),
    createReadMemoryTool(),
    createRetrieveMemoryTool(),
    createListMemoryTool(),
    createDeleteMemoryTool(),
    createVerifyMemoryTool(),
  ];
}

function createWriteMemoryTool() {
  return {
    name: 'write_memory',
    description: 'Write a structured memory entry to the agent memory system. Use this to store important information for future tasks. Choose the appropriate type: user (user preferences), feedback (user feedback), project (project-specific knowledge), reference (reference material).',
    category: ToolCategory.FILESYSTEM,
    params: {
      type: { 
        type: 'string', 
        description: 'Memory type: user, feedback, project, or reference',
        enum: ['user', 'feedback', 'project', 'reference']
      },
      title: { type: 'string', description: 'Short title for the memory entry' },
      content: { type: 'string', description: 'Detailed content of the memory' },
      tags: { type: 'array', description: 'Optional tags for categorization', items: { type: 'string' } },
      source: { 
        type: 'object', 
        description: 'Optional source reference for verification',
        properties: {
          type: { type: 'string', enum: ['file', 'function', 'flag'] },
          path: { type: 'string' },
          file: { type: 'string' },
          name: { type: 'string' },
          value: { type: 'string' },
          contentHash: { type: 'string' }
        }
      }
    },
    required: ['type', 'title', 'content'],
    handler: async ({ type, title, content, tags, source }, ctx) => {
      const memoryManager = ctx.memoryManager;
      if (!memoryManager) {
        return { success: false, error: 'Memory manager not available' };
      }

      const options = {};
      if (tags && Array.isArray(tags)) {
        options.tags = tags;
      }
      if (source && typeof source === 'object') {
        options.source = source;
      }

      let memory;
      switch (type) {
        case 'user':
          memory = memoryManager.addUser(title, content, options);
          break;
        case 'feedback':
          memory = memoryManager.addFeedback(title, content, options);
          break;
        case 'project':
          memory = memoryManager.addProject(title, content, options);
          break;
        case 'reference':
          memory = memoryManager.addReference(title, content, options);
          break;
        default:
          return { success: false, error: `Invalid memory type: ${type}` };
      }

      memoryManager.flush();

      return {
        success: true,
        id: memory.id,
        type: memory.type,
        title: memory.title,
        message: 'Memory saved successfully'
      };
    },
  };
}

function createReadMemoryTool() {
  return {
    name: 'read_memory',
    description: 'Read the full content of a memory entry by ID. Use this when you need detailed information from a specific memory. You can get memory IDs from list_memory or retrieve_memory tools.',
    category: ToolCategory.FILESYSTEM,
    params: {
      id: { type: 'string', description: 'The ID of the memory entry to read' },
    },
    required: ['id'],
    handler: async ({ id }, ctx) => {
      const memoryManager = ctx.memoryManager;
      if (!memoryManager) {
        return { success: false, error: 'Memory manager not available' };
      }

      const content = memoryManager.getFullMemory(id);
      if (!content) {
        return { success: false, error: `Memory not found: ${id}` };
      }

      return {
        success: true,
        id,
        content
      };
    },
  };
}

function createRetrieveMemoryTool() {
  return {
    name: 'retrieve_memory',
    description: 'Retrieve relevant memories based on a query. The system will search through all memories and return the most relevant ones. Use this to find information that may be useful for the current task.',
    category: ToolCategory.FILESYSTEM,
    params: {
      query: { type: 'string', description: 'Search query to find relevant memories' },
      limit: { type: 'number', description: 'Maximum number of results (default 5)', default: 5 },
      types: { type: 'array', description: 'Optional filter by memory types', items: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] } },
      forceVerification: { type: 'boolean', description: 'Force verification of results', default: false },
    },
    required: ['query'],
    handler: async ({ query, limit, types, forceVerification }, ctx) => {
      const memoryManager = ctx.memoryManager;
      if (!memoryManager) {
        return { success: false, error: 'Memory manager not available' };
      }

      const options = {};
      if (limit !== undefined && limit !== null) {
        options.limit = limit;
      }
      if (types && Array.isArray(types)) {
        options.types = types;
      }
      if (forceVerification !== undefined) {
        options.forceVerification = forceVerification;
      }

      const results = await memoryManager.retrieve(query, options);

      return {
        success: true,
        count: results.length,
        results: results.map(r => ({
          id: r.id,
          type: r.type,
          title: r.title,
          content_preview: r.content.substring(0, 200) + (r.content.length > 200 ? '...' : ''),
          age_days: Math.floor((Date.now() - r.timestamp) / (1000 * 60 * 60 * 24)),
          is_stale: r.isStale ? r.isStale() : false,
          verification: r.verificationResult
        }))
      };
    },
  };
}

function createListMemoryTool() {
  return {
    name: 'list_memory',
    description: 'List all memory entries with basic information. Use this to see what memories are available.',
    category: ToolCategory.FILESYSTEM,
    params: {
      type: { type: 'string', description: 'Optional filter by memory type', enum: ['user', 'feedback', 'project', 'reference'] },
    },
    handler: async ({ type }, ctx) => {
      const memoryManager = ctx.memoryManager;
      if (!memoryManager) {
        return { success: false, error: 'Memory manager not available' };
      }

      const memories = memoryManager.getAll(type || null);

      return {
        success: true,
        count: memories.length,
        stats: memoryManager.getStats(),
        memories: memories.map(m => ({
          id: m.id,
          type: m.type,
          title: m.title,
          age_days: Math.floor((Date.now() - m.timestamp) / (1000 * 60 * 60 * 24)),
          is_stale: m.isStale ? m.isStale() : false,
          usage_count: m.usageCount
        }))
      };
    },
  };
}

function createDeleteMemoryTool() {
  return {
    name: 'delete_memory',
    description: 'Delete a memory entry by ID. Use this to remove outdated or incorrect memories.',
    category: ToolCategory.FILESYSTEM,
    params: {
      id: { type: 'string', description: 'The ID of the memory entry to delete' },
    },
    required: ['id'],
    handler: async ({ id }, ctx) => {
      const memoryManager = ctx.memoryManager;
      if (!memoryManager) {
        return { success: false, error: 'Memory manager not available' };
      }

      const deleted = memoryManager.delete(id);

      return {
        success: deleted,
        message: deleted ? 'Memory deleted successfully' : 'Memory not found'
      };
    },
  };
}

function createVerifyMemoryTool() {
  return {
    name: 'verify_memory',
    description: 'Verify if a memory entry is still valid. Checks if file/function/flag references still exist and match expected values.',
    category: ToolCategory.FILESYSTEM,
    params: {
      id: { type: 'string', description: 'The ID of the memory entry to verify' },
    },
    required: ['id'],
    handler: async ({ id }, ctx) => {
      const memoryManager = ctx.memoryManager;
      if (!memoryManager) {
        return { success: false, error: 'Memory manager not available' };
      }

      const result = await memoryManager.verifyMemory(id);

      return {
        success: result.success,
        message: result.message,
        valid: result.success,
        memory: result.memory ? {
          id: result.memory.id,
          type: result.memory.type,
          title: result.memory.title,
          source: result.memory.source
        } : null
      };
    },
  };
}