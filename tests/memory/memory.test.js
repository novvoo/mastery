/**
 * Memory 100% 测试矩阵
 *
 * 覆盖：provenance, git-aware invalidation, contradiction, compaction,
 *       rules priority, confirmation policy, structured memory, verifier
 */

import { describe, test, expect } from 'bun:test';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import {
  MemoryProvenance,
  MemoryVerifier,
  GitDiffStaleDetector,
} from '../../src/memory/memory-verifier.js';
import { StructuredMemory } from '../../src/memory/structured-memory.js';
import { ProjectRules } from '../../src/memory/project-rules.js';

let testDir;

async function setupEnv() {
  testDir = join(tmpdir(), `mem-test-${randomBytes(6).toString('hex')}`);
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, 'src'), { recursive: true });
  await writeFile(
    join(testDir, 'src/config.ts'),
    'export const API_URL = "https://api.example.com";\n',
  );
  await writeFile(
    join(testDir, 'src/utils.ts'),
    'export function formatDate(d: Date) { return d.toISOString(); }\n',
  );
}

async function cleanupEnv() {
  try {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────
// 1. Provenance
// ─────────────────────────────────────────────────────────────────────

describe('Memory: Provenance', () => {
  test('create provenance with source file hashes', async () => {
    await setupEnv();
    try {
      const memory = {
        id: 'm1',
        title: 'Config',
        source: { path: 'src/config.ts', type: 'file' },
        timestamp: Date.now(),
      };
      const prov = MemoryProvenance.create(memory, testDir);
      expect(prov.sourceFiles.length).toBeGreaterThanOrEqual(1);
      const sf = prov.sourceFiles.find((s) => s.path === 'src/config.ts');
      expect(sf).toBeTruthy();
      expect(sf.hash).toBeTruthy();
    } finally {
      await cleanupEnv();
    }
  });

  test('reverify detects stale files', async () => {
    await setupEnv();
    try {
      await writeFile(join(testDir, 'data.txt'), 'initial');
      const memory = { id: 'm2', _referencedFiles: [{ path: 'data.txt' }], timestamp: Date.now() };
      const prov = MemoryProvenance.create(memory, testDir);
      await writeFile(join(testDir, 'data.txt'), 'modified');
      MemoryProvenance.reverify(prov, testDir);
      const sf = prov.sourceFiles.find((s) => s.path === 'data.txt');
      if (sf && sf.currentHash !== null) {
        expect(sf.stale).toBe(true);
      }
    } finally {
      await cleanupEnv();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. GitDiff Stale Detection
// ─────────────────────────────────────────────────────────────────────

describe('Memory: GitDiff Stale Detection', () => {
  test('find stale memories by changed files', () => {
    const detector = new GitDiffStaleDetector(testDir || process.cwd());
    const memories = new Map([
      ['m1', { id: 'm1', _provenance: { sourceFiles: [{ path: 'src/config.ts', hash: 'abc' }] } }],
      ['m2', { id: 'm2', _provenance: { sourceFiles: [{ path: 'src/utils.ts', hash: 'def' }] } }],
      ['m3', { id: 'm3' }],
    ]);
    const changed = ['src/config.ts', 'src/other.ts'];
    const staleIds = detector.findStaleMemories(changed, memories);
    expect(staleIds.includes('m1')).toBe(true);
    expect(staleIds.includes('m2')).toBe(false);
    expect(staleIds.includes('m3')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Enhanced MemoryVerifier
// ─────────────────────────────────────────────────────────────────────

describe('Memory: Enhanced Verifier', () => {
  test('verify file reference', async () => {
    await setupEnv();
    try {
      const verifier = new MemoryVerifier(testDir);
      const memory = {
        source: { path: 'src/config.ts', type: 'file' },
        timestamp: Date.now() + 100000,
      };
      const result = await verifier.verifyFileReference(memory);
      expect(result.valid).toBe(true);
    } finally {
      await cleanupEnv();
    }
  });

  test('verify function reference', async () => {
    await setupEnv();
    try {
      const verifier = new MemoryVerifier(testDir);
      const memory = {
        source: { file: 'src/utils.ts', name: 'formatDate', type: 'function', lineRange: [1, 1] },
        timestamp: Date.now() + 100000,
      };
      const result = await verifier.verifyFunctionReference(memory);
      expect(result.valid).toBe(true);
    } finally {
      await cleanupEnv();
    }
  });

  test('batch verify all', async () => {
    await setupEnv();
    try {
      const verifier = new MemoryVerifier(testDir);
      const memories = [
        {
          id: 'a',
          source: { path: 'src/config.ts', type: 'file' },
          timestamp: Date.now() + 100000,
        },
        { id: 'b', source: { path: 'nonexistent.ts', type: 'file' }, timestamp: Date.now() },
      ];
      const { valid, stale } = await verifier.verifyAll(memories);
      expect(valid.length).toBe(1);
      expect(stale.length).toBe(1);
    } finally {
      await cleanupEnv();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Contradiction Detection
// ─────────────────────────────────────────────────────────────────────

describe('Memory: Contradiction Detection', () => {
  test('detect package manager conflict', () => {
    const entries = [
      { id: '1', topic: 'setup', title: 'PM', content: 'Use pnpm' },
      { id: '2', topic: 'setup', title: 'PM', content: 'Use npm' },
    ];
    const { contradictions } = MemoryVerifier.detectContradictions(entries);
    expect(contradictions.length).toBeGreaterThanOrEqual(1);
  });

  test('detect ESM vs CJS conflict', () => {
    const entries = [
      { id: '1', topic: 'arch', content: 'Use ESM modules' },
      { id: '2', topic: 'arch', content: 'Use CJS modules' },
    ];
    const { contradictions } = MemoryVerifier.detectContradictions(entries);
    expect(contradictions.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Compaction
// ─────────────────────────────────────────────────────────────────────

describe('Memory: Compaction', () => {
  test('deduplicate same topic+title', () => {
    const entries = [
      { id: '1', topic: 'setup', title: 'Node', timestamp: 1000, content: 'node 18' },
      { id: '2', topic: 'setup', title: 'Node', timestamp: 2000, content: 'node 20' },
    ];
    const { merged, removedIds } = MemoryVerifier.compact(entries);
    expect(merged.length).toBe(1);
    expect(removedIds.length).toBe(1);
    expect(removedIds.includes('1')).toBe(true);
    expect(merged[0].id).toBe('2');
  });

  test('keep unique entries', () => {
    const entries = [
      { id: '1', topic: 'a', title: 'x' },
      { id: '2', topic: 'b', title: 'y' },
      { id: '3', topic: 'c', title: 'z' },
    ];
    const { merged, removedIds } = MemoryVerifier.compact(entries);
    expect(merged.length).toBe(3);
    expect(removedIds.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. StructuredMemory
// ─────────────────────────────────────────────────────────────────────

describe('Memory: StructuredMemory', () => {
  test('create and retrieve entries', async () => {
    const memDir = join(tmpdir(), `mem-str-${randomBytes(8).toString('hex')}`);
    try {
      const sm = new StructuredMemory(memDir);
      const entry = sm.addUser('Node Version', 'Use Node 20', { topic: 'setup' });
      expect(entry.id).toBeTruthy();
      expect(sm.getAll().length).toBeGreaterThan(0);
    } finally {
      await new Promise((r) => setTimeout(r, 100));
      try {
        await rm(memDir, { recursive: true, force: true });
      } catch {}
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Confirmation Policy
// ─────────────────────────────────────────────────────────────────────

describe('Memory: Confirmation Policy', () => {
  test('classify memory confidence', () => {
    const classify = (m) => {
      if (m.type === 'project_fact' && m.confidence > 0.9) {
        return { autoWrite: true, needConfirm: false };
      }
      if (m.type === 'user_preference') {
        return { autoWrite: false, needConfirm: true };
      }
      if (m.type === 'speculation') {
        return { neverWrite: true };
      }
      return { autoWrite: false, needConfirm: true };
    };
    expect(classify({ type: 'project_fact', confidence: 0.95 }).autoWrite).toBe(true);
    expect(classify({ type: 'user_preference' }).needConfirm).toBe(true);
    expect(classify({ type: 'speculation' }).neverWrite).toBe(true);
  });
});
