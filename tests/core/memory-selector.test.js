import { describe, test, expect } from 'bun:test';
import { MemorySelector, RuleBasedSelector } from '../../src/memory/memory-selector.js';
import { MemoryType, MemoryEntry } from '../../src/memory/memory-types.js';

describe('RuleBasedSelector', () => {
  test('select returns empty array when no candidates', () => {
    const selector = new RuleBasedSelector();
    const result = selector.select('test query', []);
    expect(result).toEqual([]);
  });

  test('select returns all candidates when fewer than limit', () => {
    const selector = new RuleBasedSelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'Test 1', content: 'Content 1' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Test 2', content: 'Content 2' }),
    ];
    const result = selector.select('test', candidates, { limit: 5 });
    expect(result.length).toBe(2);
  });

  test('select filters by keyword match', () => {
    const selector = new RuleBasedSelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'React preference', content: 'User likes React' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Vue project', content: 'Using Vue.js' }),
      new MemoryEntry({ type: MemoryType.REFERENCE, title: 'React docs', content: 'React documentation' }),
    ];
    const result = selector.select('React', candidates, { limit: 2 });
    expect(result.length).toBe(2);
    expect(result.every(r => r.title.toLowerCase().includes('react') || r.content.toLowerCase().includes('react'))).toBe(true);
  });

  test('select scores project entries higher', () => {
    const selector = new RuleBasedSelector();
    const oldTimestamp = Date.now() - 1000;
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'React', content: 'React content', timestamp: Date.now() }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'React', content: 'React content', timestamp: oldTimestamp }),
    ];
    const result = selector.select('React', candidates, { limit: 2 });
    expect(result[0].type).toBe(MemoryType.PROJECT);
  });

  test('select penalizes older entries', () => {
    const selector = new RuleBasedSelector();
    const oldTimestamp = Date.now() - (5 * 24 * 60 * 60 * 1000);
    const recentTimestamp = Date.now();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'React old', content: 'React content with multiple React mentions React', timestamp: oldTimestamp }),
      new MemoryEntry({ type: MemoryType.USER, title: 'React new', content: 'React content', timestamp: recentTimestamp }),
    ];
    const result = selector.select('React', candidates, { limit: 2 });
    expect(result.length).toBe(2);
    expect(result[0].timestamp).toBeGreaterThan(result[1].timestamp);
  });

  test('keywordMatch filters by keywords', () => {
    const selector = new RuleBasedSelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'No match' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Test', content: 'Contains keyword' }),
    ];
    const result = selector.keywordMatch('keyword', candidates, 1);
    expect(result.length).toBe(1);
    expect(result[0].content).toBe('Contains keyword');
  });

  test('keywordMatch ignores short words', () => {
    const selector = new RuleBasedSelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'a bc test' }),
    ];
    const result = selector.keywordMatch('a bc', candidates, 1);
    expect(result.length).toBe(0);
  });

  test('keywordMatch uses tags for matching', () => {
    const selector = new RuleBasedSelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'No match', tags: ['react'] }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Test', content: 'No match', tags: ['vue'] }),
    ];
    const result = selector.keywordMatch('react', candidates, 1);
    expect(result.length).toBe(1);
    expect(result[0].tags).toContain('react');
  });
});

describe('MemorySelector', () => {
  test('select returns empty array when no candidates', async () => {
    const selector = new MemorySelector();
    const result = await selector.select('test', []);
    expect(result).toEqual([]);
  });

  test('select returns all candidates when fewer than limit', async () => {
    const selector = new MemorySelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'Test 1', content: 'Content 1' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Test 2', content: 'Content 2' }),
    ];
    const result = await selector.select('test', candidates);
    expect(result.length).toBe(2);
  });

  test('select falls back to rule-based when no model provider', async () => {
    const selector = new MemorySelector();
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'React preference', content: 'User likes React' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Vue project', content: 'Using Vue.js' }),
    ];
    const result = await selector.select('React', candidates, { limit: 1 });
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('React preference');
  });

  test('select uses fallback when model provider fails', async () => {
    const mockProvider = {
      generate: async () => {
        throw new Error('Model failure');
      },
    };
    const selector = new MemorySelector(mockProvider);
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'React preference', content: 'User likes React' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Vue project', content: 'Using Vue.js' }),
    ];
    const result = await selector.select('React', candidates, { limit: 1 });
    expect(result.length).toBe(1);
  });

  test('select uses LLM when model provider is available', async () => {
    const mockProvider = {
      generate: async (prompt) => {
        expect(prompt).toContain('React preference');
        return '1';
      },
    };
    const selector = new MemorySelector(mockProvider);
    const candidates = [
      new MemoryEntry({ type: MemoryType.USER, title: 'React preference', content: 'User likes React' }),
      new MemoryEntry({ type: MemoryType.PROJECT, title: 'Vue project', content: 'Using Vue.js' }),
    ];
    const result = await selector.select('React', candidates, { limit: 1 });
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('React preference');
  });

  test('validate returns valid when no source', async () => {
    const selector = new MemorySelector();
    const memory = new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'Content' });
    const result = await selector.validate(memory, () => ({ valid: true }));
    expect(result.valid).toBe(true);
    expect(result.message).toBe('No verification needed');
  });

  test('validate marks as verified when verification succeeds', async () => {
    const selector = new MemorySelector();
    const memory = new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'Content', source: { type: 'file', path: 'test.txt' } });
    const result = await selector.validate(memory, () => ({ valid: true }));
    expect(result.valid).toBe(true);
    expect(memory.status).toBe('verified');
  });

  test('validate marks as stale when verification fails', async () => {
    const selector = new MemorySelector();
    const memory = new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'Content', source: { type: 'file', path: 'test.txt' } });
    const result = await selector.validate(memory, () => ({ valid: false, message: 'Failed' }));
    expect(result.valid).toBe(false);
    expect(memory.status).toBe('stale');
  });

  test('validate handles verification errors', async () => {
    const selector = new MemorySelector();
    const memory = new MemoryEntry({ type: MemoryType.USER, title: 'Test', content: 'Content', source: { type: 'file', path: 'test.txt' } });
    const result = await selector.validate(memory, () => { throw new Error('Verification error'); });
    expect(result.valid).toBe(true);
    expect(result.message).toContain('Verification skipped');
  });
});