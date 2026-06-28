import { describe, test, expect } from 'bun:test';
import { ExperienceMemory } from '../../src/core/experience-memory.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ExperienceMemory', () => {
  test('constructor initializes empty', () => {
    const mem = new ExperienceMemory();
    const stats = mem.getStats();
    expect(stats.total).toBe(0);
  });

  test('record adds an experience', () => {
    const mem = new ExperienceMemory();
    const entry = mem.record({ task: 'fix bug', tool: 'shell', lesson: 'test first' });
    expect(entry.id).toBeDefined();
    expect(entry.task).toBe('fix bug');
    expect(mem.getStats().total).toBe(1);
  });

  test('recordSuccess creates success entry', () => {
    const mem = new ExperienceMemory();
    const entry = mem.recordSuccess('write code', 'write_file', 'plan before coding');
    expect(entry.outcome).toBe('success');
  });

  test('recordFailure creates failure entry', () => {
    const mem = new ExperienceMemory();
    const entry = mem.recordFailure('debug', 'shell', 'check logs first');
    expect(entry.outcome).toBe('failure');
  });

  test('recall finds relevant experiences', () => {
    const mem = new ExperienceMemory();
    mem.recordSuccess('write python code', 'write_file', 'use type hints');
    mem.recordFailure('debug python error', 'shell', 'check traceback');
    const results = mem.recall('python code');
    expect(results.length).toBeGreaterThan(0);
  });

  test('recall returns empty for empty task', () => {
    const mem = new ExperienceMemory();
    mem.record({ task: 'test' });
    expect(mem.recall('')).toEqual([]);
  });

  test('markUsed increments usage count', () => {
    const mem = new ExperienceMemory();
    const entry = mem.record({ task: 'test' });
    mem.markUsed(entry.id, true);
    const all = mem.getAll();
    expect(all[0].usageCount).toBe(1);
    expect(all[0].successCount).toBe(1);
  });

  test('markUsed with failure increments failureCount', () => {
    const mem = new ExperienceMemory();
    const entry = mem.record({ task: 'test' });
    mem.markUsed(entry.id, false);
    const all = mem.getAll();
    expect(all[0].failureCount).toBe(1);
  });

  test('buildExperiencePrompt returns prompt text', () => {
    const mem = new ExperienceMemory();
    mem.recordSuccess('write code', 'write_file', 'plan first');
    const prompt = mem.buildExperiencePrompt('write code');
    expect(prompt).toContain('PAST EXPERIENCES');
    expect(prompt).toContain('plan first');
  });

  test('buildExperiencePrompt returns empty string with no matches', () => {
    const mem = new ExperienceMemory();
    expect(mem.buildExperiencePrompt('anything')).toBe('');
  });

  test('getStats returns correct counts', () => {
    const mem = new ExperienceMemory();
    mem.recordSuccess('task1', 'tool1', 'lesson1');
    mem.recordFailure('task2', 'tool2', 'lesson2');
    mem.record({ task: 'task3' }); // partial
    const stats = mem.getStats();
    expect(stats.total).toBe(3);
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(1);
    expect(stats.partial).toBe(1);
  });

  test('clear removes all experiences', () => {
    const mem = new ExperienceMemory();
    mem.record({ task: 'test' });
    mem.clear();
    expect(mem.getStats().total).toBe(0);
  });

  test('respects maxExperiences limit', () => {
    const mem = new ExperienceMemory({ maxExperiences: 5 });
    for (let i = 0; i < 10; i++) {
      mem.record({ task: `task${i}` });
    }
    expect(mem.getStats().total).toBeLessThanOrEqual(5);
  });

  test('respects zero maxExperiences limit', () => {
    const mem = new ExperienceMemory({ maxExperiences: 0 });
    mem.record({ task: 'task0' });
    expect(mem.getStats().total).toBe(0);
  });

  test('recall respects zero maxResults', () => {
    const mem = new ExperienceMemory();
    mem.recordSuccess('write python code', 'write_file', 'use type hints');
    expect(mem.recall('python code', { maxResults: 0 })).toEqual([]);
  });

  test('normalizes scalar tags before recall', () => {
    const mem = new ExperienceMemory();
    mem.record({ task: 'debug timeout', tags: 'retry', lesson: 'cap retry attempts' });
    const results = mem.recall('retry timeout');
    expect(results.length).toBe(1);
    expect(results[0].tags).toEqual(['retry']);
  });

  test('persists to file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'exp-test-'));
    const filePath = join(tmpDir, 'experiences.json');
    const mem1 = new ExperienceMemory({ filePath });
    mem1.recordSuccess('write code', 'write_file', 'plan first');

    const mem2 = new ExperienceMemory({ filePath });
    expect(mem2.getStats().total).toBe(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads only valid persisted experience arrays', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'exp-test-invalid-'));
    const filePath = join(tmpDir, 'experiences.json');
    try {
      writeFileSync(filePath, JSON.stringify({ invalid: true }), 'utf-8');
      const mem = new ExperienceMemory({ filePath });
      expect(mem.getStats().total).toBe(0);
      expect(mem.recall('anything')).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('normalizes loaded legacy experience entries', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'exp-test-legacy-'));
    const filePath = join(tmpDir, 'experiences.json');
    try {
      writeFileSync(
        filePath,
        JSON.stringify([
          {
            id: 'legacy',
            timestamp: Date.now(),
            task: 'fix restart context',
            tool: 'shell',
            lesson: 'verify session restore',
            tags: 'restart',
          },
          null,
          'bad',
        ]),
        'utf-8',
      );

      const mem = new ExperienceMemory({ filePath });
      const results = mem.recall('restart context');
      expect(mem.getStats().total).toBe(1);
      expect(results[0].id).toBe('legacy');
      expect(results[0].tags).toEqual(['restart']);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('getAll returns copy', () => {
    const mem = new ExperienceMemory();
    mem.record({ task: 'test' });
    const all = mem.getAll();
    expect(Array.isArray(all)).toBe(true);
    expect(all).not.toBe(mem.getAll()); // different reference
  });
});
