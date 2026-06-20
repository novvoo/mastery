import { StructuredMemory } from './structured-memory.js';
import { MemorySelector, RuleBasedSelector } from './memory-selector.js';
import { MemoryVerifier } from './memory-verifier.js';
import { MemoryType } from './memory-types.js';
import { MemoryManager } from './memory-manager.js';

export class AgentMemory extends MemoryManager {
  #structuredMemory;
  #selector;
  #fallbackSelector;
  #verifier;
  #modelProvider;

  constructor(workingDir, modelProvider = null) {
    super(workingDir);
    this.#modelProvider = modelProvider;
    this.#structuredMemory = new StructuredMemory(workingDir);
    this.#verifier = new MemoryVerifier(workingDir);
    this.#selector = new MemorySelector(modelProvider);
    this.#fallbackSelector = new RuleBasedSelector();
  }

  async initialize() {
    await this.load();
    return this;
  }

  addUser(title, content, options = {}) {
    return this.#structuredMemory.addUser(title, content, options);
  }

  addFeedback(title, content, options = {}) {
    return this.#structuredMemory.addFeedback(title, content, options);
  }

  addProject(title, content, options = {}) {
    return this.#structuredMemory.addProject(title, content, options);
  }

  addReference(title, content, options = {}) {
    return this.#structuredMemory.addReference(title, content, options);
  }

  get(id) {
    return this.#structuredMemory.get(id);
  }

  getAll(type = null) {
    return this.#structuredMemory.getAll(type);
  }

  delete(id) {
    return this.#structuredMemory.delete(id);
  }

  async retrieve(query, options = {}) {
    const { limit = 5, types = null, forceVerification = false } = options;

    const allMemories = types
      ? this.getAll().filter(m => types.includes(m.type))
      : this.getAll();

    if (allMemories.length === 0) {
      return [];
    }

    const candidates = allMemories.filter(m => !m.isExpired());

    const selected = await this.#selector.select(query, candidates, { limit });

    const results = [];
    for (const memory of selected) {
      const verificationResult = forceVerification || memory.isStale()
        ? await this.#verifier.verifyMemory(memory)
        : { valid: true, message: 'No verification needed' };

      results.push({
        ...memory,
        verificationResult,
        content: memory.content,
      });
    }

    return results;
  }

  getMemoryContext(currentTask = '') {
    const parts = [];

    const indexSummary = this.#structuredMemory.getIndexSummary();
    if (indexSummary) {
      parts.push(indexSummary);
    }

    if (currentTask) {
      const relevant = this.retrieveSync(currentTask, { limit: 3 });
      if (relevant.length > 0) {
        parts.push('');
        parts.push('[RELEVANT MEMORIES - Pre-loaded for current task:]');
        for (const mem of relevant) {
          const staleMarker = mem.isStale ? mem.isStale() : false;
          parts.push(`- [${mem.type}] ${mem.title}${staleMarker ? ' ⚠️STALE' : ''}`);
          parts.push(`  Content: ${mem.content.substring(0, 150)}${mem.content.length > 150 ? '...' : ''}`);
        }
      }
    }

    return parts.join('\n');
  }

  retrieveSync(query, options = {}) {
    const { limit = 5, types = null } = options;

    const allMemories = types
      ? this.getAll().filter(m => types.includes(m.type))
      : this.getAll();

    if (allMemories.length === 0) {
      return [];
    }

    const candidates = allMemories.filter(m => !m.isExpired());
    return this.#fallbackSelector.select(query, candidates, { limit });
  }

  getFullMemory(id) {
    return this.#structuredMemory.getFullContent(id);
  }

  async verifyMemory(id) {
    const memory = this.get(id);
    if (!memory) {
      return { success: false, message: 'Memory not found' };
    }

    const result = await this.#verifier.verifyMemory(memory);
    return {
      success: result.valid,
      message: result.message,
      memory,
    };
  }

  getStats() {
    return this.#structuredMemory.getStats();
  }

  flush() {
    this.#structuredMemory.flush();
  }

  clearAll() {
    this.#structuredMemory.clear();
  }

  getIndexContent() {
    return this.#structuredMemory.getIndex();
  }

  setModelProvider(modelProvider) {
    this.#modelProvider = modelProvider;
    this.#selector = new MemorySelector(modelProvider);
  }

  toPromptFragment() {
    const parts = [];

    parts.push(super.toPromptFragment());

    const memoryContext = this.getMemoryContext();
    if (memoryContext && memoryContext.trim().length > 0) {
      parts.push('');
      parts.push(memoryContext);
    }

    return parts.join('\n');
  }
}

export default AgentMemory;