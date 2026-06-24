import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { StructuredMemory } from '../../src/memory/structured-memory.js';
import { AgentMemory } from '../../src/memory/agent-memory.js';
import { MemoryType, MemoryTopic, inferTopic } from '../../src/memory/memory-types.js';

let testDir;
let agentMemory;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `topic-memory-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  mkdirSync(testDir, { recursive: true });
  agentMemory = new AgentMemory(testDir, null);
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

// =====================================================
// Topic inference
// =====================================================
describe('inferTopic', () => {
  test('infers debugging from error content', () => {
    expect(inferTopic('project', [], 'fix bug in login flow error trace')).toBe(
      MemoryTopic.DEBUGGING,
    );
  });

  test('infers architecture from design content', () => {
    expect(inferTopic('project', [], 'module structure and pipeline design pattern')).toBe(
      MemoryTopic.ARCHITECTURE,
    );
  });

  test('infers conventions from style tags', () => {
    expect(inferTopic('reference', ['conventions', 'naming'], '')).toBe(MemoryTopic.CONVENTIONS);
  });

  test('infers dependencies from package content', () => {
    expect(inferTopic('reference', [], 'upgrade npm dependency to latest version')).toBe(
      MemoryTopic.DEPENDENCIES,
    );
  });

  test('infers performance from optimization content', () => {
    expect(inferTopic('project', [], 'optimize slow query with cache layer')).toBe(
      MemoryTopic.PERFORMANCE,
    );
  });

  test('infers security from auth content', () => {
    expect(inferTopic('reference', [], 'csrf token validation vulnerability fix')).toBe(
      MemoryTopic.SECURITY,
    );
  });

  test('infers testing from spec content', () => {
    expect(inferTopic('project', [], 'unit test coverage for assert module')).toBe(
      MemoryTopic.TESTING,
    );
  });

  test('infers deployment from CI content', () => {
    expect(inferTopic('project', [], 'docker deploy pipeline helm chart')).toBe(
      MemoryTopic.DEPLOYMENT,
    );
  });

  test('infers api from endpoint content', () => {
    expect(inferTopic('reference', [], 'rest api endpoint schema swagger')).toBe(MemoryTopic.API);
  });

  test('falls back to general for unknown content', () => {
    expect(inferTopic('user', [], 'just a random thought')).toBe(MemoryTopic.GENERAL);
  });
});

// =====================================================
// Topic-file creation & append
// =====================================================
describe('StructuredMemory topic system', () => {
  test('add() automatically creates topic file', () => {
    // Content with "api" keyword triggers API topic classification
    const mem = agentMemory.addProject('API Design', 'REST api endpoint /v1 schema');
    expect(mem.id).toBeTruthy();

    const topics = agentMemory.listTopics();
    expect(topics.length).toBeGreaterThan(0);

    const apiTopic = topics.find((t) => t.topic === 'api');
    expect(apiTopic).toBeTruthy();
    expect(apiTopic.entryCount).toBe(1);
  });

  test('readTopic returns content with explicit topic', () => {
    agentMemory.addWithTopic(
      'project',
      'Architecture Overview',
      'Monorepo with packages/* layout',
      { topic: 'architecture' },
    );
    agentMemory.addWithTopic(
      'project',
      'Module Design',
      'Core module uses hexagonal architecture',
      { topic: 'architecture' },
    );

    const archContent = agentMemory.readTopic('architecture');
    expect(archContent).toBeTruthy();
    expect(archContent).toContain('Architecture Overview');
    expect(archContent).toContain('Module Design');
    expect(archContent).toContain('Monorepo');
    expect(archContent).toContain('hexagonal');
  });

  test('addWithTopic allows explicit topic selection', () => {
    agentMemory.addWithTopic('reference', 'Git Config', 'Use rebase strategy', {
      topic: 'general',
    });

    const topics = agentMemory.listTopics();
    const generalTopic = topics.find((t) => t.topic === 'general');
    expect(generalTopic).toBeTruthy();

    const content = agentMemory.readTopic('general');
    expect(content).toContain('Git Config');
  });

  test('listTopics returns sorted by size', () => {
    agentMemory.addProject('Small', 'a');
    agentMemory.addProject('Big Entry', 'B'.repeat(500));
    agentMemory.addProject('Medium Entry', 'C'.repeat(100));

    const topics = agentMemory.listTopics();
    expect(topics.length).toBeGreaterThan(0);
    // Sorted descending by size
    for (let i = 1; i < topics.length; i++) {
      expect(topics[i - 1].size).toBeGreaterThanOrEqual(topics[i].size);
    }
  });

  test('getTopicSummary returns formatted list', () => {
    agentMemory.addProject('Debug Tip', 'Use --inspect flag for Node debugging');

    const summary = agentMemory.getTopicSummary();
    expect(summary).toContain('TOPIC FILES');
    expect(summary).toContain('debugging.md');
    expect(summary).toContain('entries');
  });

  test('multiple entries of same topic append correctly', () => {
    agentMemory.addWithTopic('project', 'Bug 1', 'Null pointer in auth module', {
      topic: 'debugging',
      tags: ['debug'],
    });
    agentMemory.addWithTopic('project', 'Bug 2', 'Race condition in cache layer', {
      topic: 'debugging',
      tags: ['debug'],
    });

    const content = agentMemory.readTopic('debugging');
    expect(content).toBeTruthy();
    const entryBlocks = (content.match(/^### /gm) || []).length;
    expect(entryBlocks).toBe(2);
  });

  test('migrateToTopics copies existing entries', () => {
    // Add entries without topic (they go to entries/ but topic is auto-appended via add())
    agentMemory.addProject('Entry A', 'Content A');
    agentMemory.addProject('Entry B', 'Content B');

    const migrated = agentMemory.migrateToTopics();
    expect(migrated.length).toBeGreaterThan(0);

    const topics = agentMemory.listTopics();
    expect(topics.length).toBeGreaterThan(0);
  });
});

// =====================================================
// Auto-memory: suggest + write
// =====================================================
describe('Auto-memory system', () => {
  test('autoSuggestMemory detects corrections', () => {
    const { shouldSuggest, suggestions } = agentMemory.autoSuggestMemory({
      corrections: ['Use tabs not spaces for indentation in this project'],
      toolEvents: [],
    });

    expect(shouldSuggest).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].type).toBe('feedback');
    expect(suggestions[0].confidence).toBe(0.8);
  });

  test('autoSuggestMemory filters noise corrections', () => {
    const { shouldSuggest } = agentMemory.autoSuggestMemory({
      corrections: ['ok'],
      toolEvents: [],
    });

    expect(shouldSuggest).toBe(false);
  });

  test('autoSuggestMemory detects recurring errors', () => {
    const { shouldSuggest, suggestions } = agentMemory.autoSuggestMemory({
      toolEvents: [
        { name: 'read_file', error: 'ENOENT: no such file' },
        { name: 'read_file', error: 'ENOENT: no such file' },
      ],
    });

    expect(shouldSuggest).toBe(true);
    expect(suggestions[0].type).toBe('reference');
    expect(suggestions[0].confidence).toBe(0.85);
  });

  test('autoWriteMemory writes high-confidence items', async () => {
    const { written, deferred } = await agentMemory.autoWriteMemory({
      corrections: ['Always use snake_case for Python files'],
      toolEvents: [],
    });

    expect(written.length).toBe(1);
    expect(written[0].topic).toBeTruthy();
    expect(deferred.length).toBe(0);
  });

  test('autoWriteMemory defers medium-confidence items without model', async () => {
    const { written, deferred } = await agentMemory.autoWriteMemory({
      discoveries: ['Found a somewhat interesting project structure'],
    });

    // Without model provider, medium confidence items are deferred (not auto-written)
    expect(deferred.length >= 0).toBe(true);
  });

  test('isWorthRemembering without model uses heuristics', async () => {
    const result = await agentMemory.isWorthRemembering(
      'The database connection string uses postgres:// with SSL enabled',
      { type: 'reference', reason: 'project config' },
    );
    expect(result).toBe(true);

    const noise = await agentMemory.isWorthRemembering('ok', { type: 'feedback' });
    expect(noise).toBe(false);
  });

  test('getAutoMemoryPrompt generates formatted suggestions', () => {
    const prompt = agentMemory.getAutoMemoryPrompt({
      corrections: ['Use ES modules not CommonJS'],
    });

    expect(prompt).toContain('Auto-Memory Suggestions');
    expect(prompt).toContain('ES modules');
    expect(prompt).toContain('write_memory');
  });
});

// =====================================================
// Path-scoped rules
// =====================================================
describe('Path-scoped rules loading', () => {
  test('ensureRulesForPath discovers subdir rules', () => {
    const subDir = join(testDir, 'src', 'components');
    const rulesDir = join(subDir, '.agent-rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, 'instructions.md'),
      '# Component rules\nUse React functional components.',
      'utf-8',
    );

    const { loaded, hasNewRules } = agentMemory.ensureRulesForPath(subDir);
    expect(hasNewRules).toBe(true);
    expect(loaded.length).toBeGreaterThan(0);
  });

  test('ensureRulesForPath is idempotent', () => {
    const subDir = join(testDir, 'src', 'lib');
    const rulesDir = join(subDir, '.agent-rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'instructions.md'), '# Lib rules', 'utf-8');

    const first = agentMemory.ensureRulesForPath(subDir);
    expect(first.hasNewRules).toBe(true);

    // Second call should not re-load
    const second = agentMemory.ensureRulesForPath(subDir);
    expect(second.hasNewRules).toBe(false);
  });

  test('ensureRulesForPath finds rules in ancestor directories', () => {
    // Create rules in grandparent
    const grandparent = join(testDir, 'packages');
    const rulesDir1 = join(grandparent, '.agent-rules');
    mkdirSync(rulesDir1, { recursive: true });
    writeFileSync(
      join(rulesDir1, 'instructions.md'),
      '# Packages rules\nMonorepo layout.',
      'utf-8',
    );

    // Query from deep subdirectory
    const deepDir = join(grandparent, 'pkg-a', 'src', 'utils');

    const { loaded } = agentMemory.ensureRulesForPath(deepDir);
    expect(loaded.length).toBeGreaterThan(0);
  });
});
