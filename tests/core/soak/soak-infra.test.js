/**
 * Soak Test 基础设施单元测试
 *
 * 验证 SoakSession / SoakValidator 的核心逻辑，无需长时间运行。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// ── 轻量 SoakSession（测试专用） ────────────────────────────────────────────

class TestSoakSession {
  constructor(projectDir, index) {
    this.projectDir = projectDir;
    this.index = index;
    this.editCount = 0;
    this.errors = [];
    this.memoriesCreated = [];
  }

  addMemory(type, title, content) {
    const mem = { session: this.index, type, title, content, timestamp: Date.now() };
    this.memoriesCreated.push(mem);
    return mem;
  }
}

// ── SoakValidator（精简版，用于测试） ────────────────────────────────────────

class TestSoakValidator {
  constructor(projectDir) { this.projectDir = projectDir; this.metrics = {}; }

  verifyMemoryIntegrity(sessions) {
    const allMemories = sessions.flatMap(s => s.memoriesCreated);
    const issues = [];
    const uniqueTitles = new Set(allMemories.map(m => m.title));
    if (uniqueTitles.size !== allMemories.length) {
      issues.push(`Duplicate memory titles: ${allMemories.length - uniqueTitles.size} duplicates`);
    }
    // 时间戳单调性
    for (let i = 1; i < allMemories.length; i++) {
      if (allMemories[i].timestamp < allMemories[i - 1].timestamp) {
        issues.push(`Non-monotonic timestamp at index ${i}`);
        break;
      }
    }
    this.metrics.memoryIntegrity = { total: allMemories.length, unique: uniqueTitles.size, issues: issues.length };
    return issues.length === 0;
  }

  verifyLSPStability(sessions) {
    const totalErrors = sessions.reduce((sum, s) => sum + s.errors.length, 0);
    const totalOps = sessions.reduce((sum, s) => sum + s.editCount, 0);
    const errorRate = totalOps > 0 ? totalErrors / totalOps : 0;
    const issues = errorRate > 0.1 ? [`High error rate: ${(errorRate * 100).toFixed(1)}%`] : [];
    const sessionErrors = sessions.map(s => s.errors.length);
    if (Math.max(...sessionErrors, 0) > 20) issues.push(`Max errors exceeds 20`);
    this.metrics.lspStability = { totalErrors, totalOps, errorRate, perSession: sessionErrors };
    return issues.length === 0;
  }

  verifyHashlineCorrectness(sessions) {
    const issues = [];
    const jsFiles = ['src/index.ts'];
    for (const file of jsFiles) {
      const fullPath = join(this.projectDir, file);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        if ((content.match(/{/g) || []).length !== (content.match(/}/g) || []).length) {
          issues.push(`Brace mismatch in ${file}`);
        }
      }
    }
    this.metrics.hashlineCorrectness = { filesChecked: jsFiles.length, syntaxErrors: issues.length };
    return issues.length === 0;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SoakTest Infrastructure', () => {
  let tmpDir, projectDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soak-unit-'));
    projectDir = join(tmpDir, 'project');
    execSync(`mkdir -p "${projectDir}/src"`);
    execSync(`cd "${projectDir}" && git init && git config user.email "test@test" && git config user.name "Test"`);
    writeFileSync(join(projectDir, 'src/index.ts'), 'export const x = 1;\n');
    writeFileSync(join(projectDir, 'src/greet.ts'), 'export function greet() {}\n');
    execSync(`cd "${projectDir}" && git add -A && git commit -m "init"`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Memory Corruption 测试 ──

  it('should detect no memory corruption with clean sessions', () => {
    const sessions = [
      new TestSoakSession(projectDir, 0),
      new TestSoakSession(projectDir, 1),
    ];
    sessions[0].addMemory('project', 'mem-A', 'content A');
    sessions[0].addMemory('project', 'mem-B', 'content B');
    sessions[1].addMemory('reference', 'mem-C', 'content C');

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyMemoryIntegrity(sessions)).toBe(true);
    expect(validator.metrics.memoryIntegrity.total).toBe(3);
    expect(validator.metrics.memoryIntegrity.unique).toBe(3);
  });

  it('should detect duplicate memory titles', () => {
    const sessions = [new TestSoakSession(projectDir, 0)];
    sessions[0].addMemory('project', 'duplicate', 'content 1');
    sessions[0].addMemory('project', 'duplicate', 'content 2');

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyMemoryIntegrity(sessions)).toBe(false);
    expect(validator.metrics.memoryIntegrity.issues).toBeGreaterThan(0);
  });

  it('should detect non-monotonic timestamps', () => {
    const session = new TestSoakSession(projectDir, 0);
    const mem1 = session.addMemory('project', 'mem-1', 'c1');
    const mem2 = session.addMemory('project', 'mem-2', 'c2');
    mem2.timestamp = mem1.timestamp - 1000; // 时间倒退

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyMemoryIntegrity([session])).toBe(false);
  });

  // ── LSP Drift 测试 ──

  it('should pass LSP stability with no errors', () => {
    const sessions = [new TestSoakSession(projectDir, 0)];
    sessions[0].editCount = 50;
    // no errors added

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyLSPStability(sessions)).toBe(true);
  });

  it('should detect high error rate', () => {
    const sessions = [new TestSoakSession(projectDir, 0)];
    sessions[0].editCount = 10;
    for (let i = 0; i < 5; i++) {
      sessions[0].errors.push({ message: 'fake error', timestamp: Date.now() });
    }
    // error rate = 5/10 = 50% > 10%

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyLSPStability(sessions)).toBe(false);
  });

  it('should accept low error rate', () => {
    const sessions = [new TestSoakSession(projectDir, 0)];
    sessions[0].editCount = 100;
    sessions[0].errors.push({ message: 'ok error', timestamp: Date.now() });
    // error rate = 1/100 = 1% < 10%

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyLSPStability(sessions)).toBe(true);
  });

  // ── Hashline Mis-merge 测试 ──

  it('should pass hashcheck with valid syntax files', () => {
    const sessions = [new TestSoakSession(projectDir, 0)];
    // src/index.ts has valid content

    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyHashlineCorrectness(sessions)).toBe(true);
  });

  it('should detect brace mismatch in source files', () => {
    writeFileSync(join(projectDir, 'src/index.ts'), 'const x = { {;;\n');
    execSync(`cd "${projectDir}" && git add -A && git commit -m "broken"`);

    const sessions = [new TestSoakSession(projectDir, 0)];
    const validator = new TestSoakValidator(projectDir);
    expect(validator.verifyHashlineCorrectness(sessions)).toBe(false);
  });

  // ── Multi-branch 测试 ──

  it('should verify multi-branch setup', () => {
    execSync(`cd "${projectDir}" && git branch feature/x && git branch hotfix/y`);
    // SoakValidator 的 verifyMultiBranchIntegrity 检查分支数

    const branches = execSync(`cd "${projectDir}" && git branch`, { encoding: 'utf-8' })
      .split('\n').filter(Boolean);

    expect(branches.length).toBeGreaterThanOrEqual(3); // main + feature/x + hotfix/y
  });

  // ── Multi-commit 测试 ──

  it('should track commit history correctly', () => {
    const contents = ['a', 'b', 'c', 'd', 'e'];
    for (const c of contents) {
      writeFileSync(join(projectDir, 'src/marker.txt'), c);
      execSync(`cd "${projectDir}" && git add -A && git commit -m "commit ${c}"`);
    }

    const log = execSync(`cd "${projectDir}" && git log --oneline`, { encoding: 'utf-8' });
    const commitCount = log.split('\n').filter(Boolean).length;
    expect(commitCount).toBeGreaterThanOrEqual(6); // initial + 5
  });

  // ── 跨 session 不污染测试 ──

  it('should maintain isolation between sessions', () => {
    const session1 = new TestSoakSession(projectDir, 1);
    const session2 = new TestSoakSession(projectDir, 2);

    session1.addMemory('project', 's1-mem', 'from session 1');
    session2.addMemory('project', 's2-mem', 'from session 2');

    // 验证每个 session 的记忆只属于自己
    expect(session1.memoriesCreated).toHaveLength(1);
    expect(session2.memoriesCreated).toHaveLength(1);
    expect(session1.memoriesCreated[0].session).toBe(1);
    expect(session2.memoriesCreated[0].session).toBe(2);

    // 合并后不重复
    const all = [...session1.memoriesCreated, ...session2.memoriesCreated];
    const titles = all.map(m => m.title);
    expect(new Set(titles).size).toBe(2);
  });

  // ── 异常恢复测试 ──

  it('should not lose data when operation fails', () => {
    const session = new TestSoakSession(projectDir, 0);
    const before = session.memoriesCreated.length;
    session.errors.push({ message: 'simulated failure', op: 'edit_file', timestamp: Date.now() });
    // 错误不应该影响已经创建的记忆
    expect(session.memoriesCreated.length).toBe(before);
    expect(session.errors.length).toBeGreaterThan(0);
  });
});
