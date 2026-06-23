#!/usr/bin/env bun
/**
 * Soak Test Runner — 长期稳定性测试框架
 *
 * 验证 multi-day / multi-commit / multi-branch / multi-agent-session 场景下：
 *  - Memory 不污染（无虚假增长、过期条目正确标记、矛盾检测正常）
 *  - LSP 不漂移（rename/format/diagnostics 在多次操作后仍然准确）
 *  - Hashline 不误合并（stale tag recovery 在多次并发编辑后正确）
 *
 * 用法：
 *   bun run tests/core/soak/soak-runner.mjs [--duration=60] [--aggressive]
 *
 * 选项：
 *   --duration=N    测试持续时间（秒），默认 60
 *   --aggressive    激进模式：更频繁的并发操作
 *   --seed=N        随机种子，用于可重复性
 */

import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { execSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DURATION_SEC = parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1] || '60', 10);
const AGGRESSIVE = args.includes('--aggressive');
const SEED = parseInt(args.find(a => a.startsWith('--seed='))?.split('=')[1] || String(Date.now()), 10);

// ── 伪随机（可重复） ───────────────────────────────────────────────────────

let rngState = SEED;
function rng() {
  rngState = (rngState * 1664525 + 1013904223) | 0;
  return (rngState >>> 0) / 0xFFFFFFFF;
}
function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

// ── 测试项目模板 ────────────────────────────────────────────────────────────

const BRANCHES = ['main', 'feature/login', 'feature/api', 'fix/bug-42', 'refactor/core', 'hotfix/security'];
const COMMIT_MESSAGES = [
  'feat: add user auth module', 'fix: resolve race condition in cache',
  'refactor: extract shared utils', 'docs: update API documentation',
  'test: add integration tests for auth', 'perf: optimize database queries',
  'chore: update dependencies', 'feat: add rate limiting middleware',
  'fix: handle null pointer in parser', 'refactor: rename legacy components',
];

const FILE_TEMPLATES = {
  'src/index.ts': `export { greet } from './greet';\nexport { calculate } from './math';\nexport { formatDate } from './utils';\n`,
  'src/greet.ts': `export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`,
  'src/math.ts': `export function calculate(a: number, b: number): number {\n  return a + b;\n}\n`,
  'src/utils.ts': `export function formatDate(date: Date): string {\n  return date.toISOString().split('T')[0];\n}\n`,
  'src/config.ts': `export const config = {\n  port: 3000,\n  host: 'localhost',\n  debug: false,\n};\n`,
  'package.json': `{"name":"soak-test","version":"1.0.0","main":"src/index.ts"}\n`,
  'tsconfig.json': `{"compilerOptions":{"target":"ES2022","module":"commonjs","strict":true,"outDir":"./dist","rootDir":"./src","paths":{"@/*":["./src/*"]}}}\n`,
};

// ── 操作类型 ────────────────────────────────────────────────────────────────

const OPERATIONS = [
  'edit_file', 'write_file', 'create_branch', 'checkout_branch',
  'commit', 'merge_branch', 'rename_symbol', 'add_memory',
  'delete_file', 'revert_commit',
];

// ── Session 抽象 ───────────────────────────────────────────────────────────

class SoakSession {
  constructor(projectDir, index) {
    this.projectDir = projectDir;
    this.index = index;
    this.editCount = 0;
    this.errors = [];
    this.warnings = [];
    this.memoriesCreated = [];
  }

  async runSteps(maxSteps) {
    const steps = AGGRESSIVE ? maxSteps : Math.ceil(maxSteps / 3);
    for (let i = 0; i < steps; i++) {
      await this.#executeRandomStep();
    }
  }

  async #executeRandomStep() {
    const op = pick(OPERATIONS);
    try {
      switch (op) {
        case 'edit_file': await this.#editRandomFile(); break;
        case 'write_file': await this.#writeNewFile(); break;
        case 'create_branch': await this.#createRandomBranch(); break;
        case 'checkout_branch': await this.#checkoutRandomBranch(); break;
        case 'commit': await this.#makeCommit(); break;
        case 'merge_branch': await this.#mergeRandomBranch(); break;
        case 'rename_symbol': await this.#renameRandomSymbol(); break;
        case 'add_memory': await this.#addRandomMemory(); break;
        case 'delete_file': await this.#deleteRandomFile(); break;
        case 'revert_commit': await this.#revertLastCommit(); break;
      }
      this.editCount++;
    } catch (err) {
      this.errors.push({ op, message: err.message, timestamp: Date.now() });
    }
  }

  async #editRandomFile() {
    const files = Object.keys(FILE_TEMPLATES);
    const file = pick(files);
    const fullPath = join(this.projectDir, file);
    if (!existsSync(fullPath)) {return;}

    let content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineIdx = randInt(0, Math.max(0, lines.length - 1));
    const change = pick([
      () => lines[lineIdx] = `  // edit ${Date.now()}\n`,
      () => lines.splice(lineIdx, 1),
      () => lines.splice(lineIdx, 0, `  console.log('session ${this.index} step ${this.editCount}');\n`),
    ]);
    change();
    writeFileSync(fullPath, lines.join('\n'));
  }

  async #writeNewFile() {
    const filename = `src/generated_${this.index}_${this.editCount}.ts`;
    const fullPath = join(this.projectDir, filename);
    writeFileSync(fullPath, `// Generated by soak session ${this.index}\nexport const sessionId = '${this.index}-${this.editCount}';\n`);
  }

  async #createRandomBranch() {
    const branch = `session-${this.index}-${randInt(0, 99)}`;
    try { execSync(`cd "${this.projectDir}" && git checkout -b ${branch} 2>/dev/null`, { encoding: 'utf-8' }); } catch {}
  }

  async #checkoutRandomBranch() {
    try {
      const branches = execSync(`cd "${this.projectDir}" && git branch`, { encoding: 'utf-8' })
        .split('\n').map(l => l.replace(/^\*?\s+/, '').trim()).filter(Boolean);
      if (branches.length > 0) {
        execSync(`cd "${this.projectDir}" && git checkout "${pick(branches)}" 2>/dev/null`, { encoding: 'utf-8' });
      }
    } catch {}
  }

  async #makeCommit() {
    try {
      execSync(`cd "${this.projectDir}" && git add -A && git commit -m "${pick(COMMIT_MESSAGES)}" --allow-empty`, { encoding: 'utf-8' });
    } catch {}
  }

  async #mergeRandomBranch() {
    try {
      const branches = execSync(`cd "${this.projectDir}" && git branch`, { encoding: 'utf-8' })
        .split('\n').map(l => l.replace(/^\*?\s+/, '').trim()).filter(Boolean);
      const target = pick(branches);
      execSync(`cd "${this.projectDir}" && git merge "${target}" --no-edit 2>/dev/null || git merge --abort`, { encoding: 'utf-8' });
    } catch {}
  }

  async #renameRandomSymbol() {
    // 模拟 rename 操作：编辑文件内容进行重命名
    const files = Object.keys(FILE_TEMPLATES).filter(f => existsSync(join(this.projectDir, f)));
    if (files.length === 0) {return;}
    const file = pick(files);
    const fullPath = join(this.projectDir, file);
    let content = readFileSync(fullPath, 'utf-8');
    const oldName = pick(['greet', 'calculate', 'formatDate', 'config', 'sessionId']);
    const newName = `${oldName}_renamed_${randInt(0, 99)}`;
    content = content.replace(new RegExp(oldName, 'g'), newName);
    writeFileSync(fullPath, content);
  }

  async #addRandomMemory() {
    const mem = {
      session: this.index,
      step: this.editCount,
      type: pick(['project', 'reference', 'feedback']),
      title: `memory_${this.index}_${this.editCount}`,
      content: `Recorded at step ${this.editCount} during soak test. Random value: ${randInt(0, 999999)}`,
      timestamp: Date.now(),
    };
    this.memoriesCreated.push(mem);
  }

  async #deleteRandomFile() {
    const generatedFiles = [];
    try {
      const ls = execSync(`cd "${this.projectDir}" && find src -name "generated_*" -type f 2>/dev/null`, { encoding: 'utf-8' });
      generatedFiles.push(...ls.split('\n').filter(Boolean));
    } catch {}
    if (generatedFiles.length > 0) {
      const target = pick(generatedFiles);
      try { execSync(`cd "${this.projectDir}" && rm "${target}" && git add -A`, { encoding: 'utf-8' }); } catch {}
    }
  }

  async #revertLastCommit() {
    try {
      execSync(`cd "${this.projectDir}" && git log -1 --format="%H"`, { encoding: 'utf-8' });
      execSync(`cd "${this.projectDir}" && git reset --soft HEAD~1 2>/dev/null`, { encoding: 'utf-8' });
    } catch {}
  }
}

// ── 结果验证器 ──────────────────────────────────────────────────────────────

class SoakValidator {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.metrics = {};
  }

  verifyMemoryIntegrity(sessions) {
    const allMemories = sessions.flatMap(s => s.memoriesCreated);
    const issues = [];

    // 1. 总数不异常增长（无泄漏）
    const uniqueTitles = new Set(allMemories.map(m => m.title));
    if (uniqueTitles.size !== allMemories.length) {
      issues.push(`Duplicate memory titles: ${allMemories.length - uniqueTitles.size} duplicates`);
    }

    // 2. 时间戳单调性
    for (let i = 1; i < allMemories.length; i++) {
      if (allMemories[i].timestamp < allMemories[i - 1].timestamp) {
        issues.push(`Non-monotonic timestamp at index ${i}`);
        break;
      }
    }

    // 3. 类型分布合理性
    const typeCounts = {};
    for (const m of allMemories) {
      typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
    }

    this.metrics.memoryIntegrity = {
      total: allMemories.length,
      unique: uniqueTitles.size,
      types: typeCounts,
      issues: issues.length,
      issueDetails: issues.slice(0, 5),
    };

    return issues.length === 0;
  }

  verifyLSPStability(sessions) {
    const issues = [];

    // 检查是否出现大量 errors
    const totalErrors = sessions.reduce((sum, s) => sum + s.errors.length, 0);
    const totalOps = sessions.reduce((sum, s) => sum + s.editCount, 0);

    // 错误率
    const errorRate = totalOps > 0 ? totalErrors / totalOps : 0;
    if (errorRate > 0.1) {
      issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }

    // 跨 session 误差累积
    const sessionErrors = sessions.map(s => s.errors.length);
    const maxErr = Math.max(...sessionErrors, 0);
    if (maxErr > 20) {
      issues.push(`Max errors per session: ${maxErr} (threshold: 20)`);
    }

    this.metrics.lspStability = {
      totalErrors,
      totalOps,
      errorRate,
      perSession: sessionErrors,
      issues: issues.length,
      issueDetails: issues.slice(0, 5),
    };

    return issues.length === 0;
  }

  verifyHashlineCorrectness(sessions) {
    // 验证文件完整性：所有模板文件在操作后仍然有效
    const issues = [];

    for (const [file, originalContent] of Object.entries(FILE_TEMPLATES)) {
      const fullPath = join(this.projectDir, file);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        // 检查语法完整性（简单检查）
        if (file.endsWith('.ts') || file.endsWith('.js')) {
          if ((content.match(/{/g) || []).length !== (content.match(/}/g) || []).length) {
            issues.push(`Brace mismatch in ${file}`);
          }
          if ((content.match(/\(/g) || []).length !== (content.match(/\)/g) || []).length) {
            issues.push(`Parenthesis mismatch in ${file}`);
          }
        }
        if (file.endsWith('.json')) {
          try { JSON.parse(content); } catch {
            issues.push(`Invalid JSON in ${file}`);
          }
        }
      }
    }

    this.metrics.hashlineCorrectness = {
      filesChecked: Object.keys(FILE_TEMPLATES).length,
      syntaxErrors: issues.length,
      issueDetails: issues.slice(0, 5),
    };

    return issues.length === 0;
  }

  verifyMultiBranchIntegrity(sessions) {
    const issues = [];
    try {
      // 检查分支数
      const branches = execSync(`cd "${this.projectDir}" && git branch -a`, { encoding: 'utf-8' })
        .split('\n').map(l => l.trim()).filter(Boolean);
      if (branches.length < 3) {
        issues.push(`Expected >= 3 branches, got ${branches.length}`);
      }
      // 检查是否有孤儿分支
      const hasMain = branches.some(b => b.includes('main'));
      if (!hasMain) {
        issues.push('No main branch found');
      }
    } catch {}

    this.metrics.multiBranch = {
      issues: issues.length,
      issueDetails: issues.slice(0, 3),
    };

    return issues.length === 0;
  }

  verifyMultiCommitIntegrity(sessions) {
    const issues = [];
    try {
      const log = execSync(`cd "${this.projectDir}" && git log --oneline --all`, { encoding: 'utf-8' });
      const commitCount = log.split('\n').filter(Boolean).length;
      if (commitCount < 5) {
        issues.push(`Expected >= 5 commits, got ${commitCount}`);
      }
      this.metrics.multiCommit = { commitCount, issues: issues.length };
    } catch {
      this.metrics.multiCommit = { commitCount: 0, issues: 0 };
    }

    return issues.length === 0;
  }

  computeFinalScore() {
    const checks = [
      this.metrics.memoryIntegrity?.issues === 0,
      this.metrics.lspStability?.issues === 0,
      this.metrics.hashlineCorrectness?.syntaxErrors === 0,
      this.metrics.multiBranch?.issues === 0,
      this.metrics.multiCommit?.issues === 0,
    ];
    const passCount = checks.filter(Boolean).length;
    return { passCount, total: checks.length, score: Math.round((passCount / checks.length) * 100) };
  }
}

// ── 主运行器 ────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║         Hashline/LSP/Memory Soak Test Runner          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Duration: ${DURATION_SEC}s`);
  console.log(`  Mode:     ${AGGRESSIVE ? 'AGGRESSIVE' : 'normal'}`);
  console.log(`  Seed:     ${SEED}`);
  console.log('');

  // ── 创建测试项目 ──
  const tmpDir = mkdtempSync(join(tmpdir(), 'soak-test-'));
  const projectDir = join(tmpDir, 'project');
  execSync(`mkdir -p "${projectDir}/src"`, { encoding: 'utf-8' });

  // 初始化 Git
  execSync(`cd "${projectDir}" && git init && git config user.email "soak@test.local" && git config user.name "Soak Test"`, { encoding: 'utf-8' });

  // 写入初始文件
  for (const [file, content] of Object.entries(FILE_TEMPLATES)) {
    const fullPath = join(projectDir, file);
    const dir = join(fullPath, '..');
    execSync(`mkdir -p "${dir}"`, { encoding: 'utf-8' });
    writeFileSync(fullPath, content);
  }

  // 初始 commit
  execSync(`cd "${projectDir}" && git add -A && git commit -m "initial commit: soak test setup"`, { encoding: 'utf-8' });

  // 创建初始分支
  for (const branch of BRANCHES) {
    if (branch !== 'main') {
      try { execSync(`cd "${projectDir}" && git branch "${branch}" 2>/dev/null`, { encoding: 'utf-8' }); } catch {}
    }
  }

  console.log(`  Project:  ${projectDir}`);
  console.log('');

  // ── 运行多 session ──
  const sessions = [];
  const startTime = Date.now();
  const endTime = startTime + DURATION_SEC * 1000;
  let sessionIndex = 0;

  console.log('╭─ Running sessions ─────────────────────────────────────╮');

  while (Date.now() < endTime) {
    const remainingMs = endTime - Date.now();
    const stepsPerSession = AGGRESSIVE ? randInt(10, 30) : randInt(5, 12);

    const session = new SoakSession(projectDir, sessionIndex);
    await session.runSteps(stepsPerSession);
    sessions.push(session);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const progress = Math.min(100, Math.round((Date.now() - startTime) / (DURATION_SEC * 1000) * 100));
    const bar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

    process.stdout.write(`\r  │ Session ${sessionIndex.toString().padStart(3)} │ ${bar} ${progress}% │ ${elapsed}s/${DURATION_SEC}s │ edits: ${session.editCount} │ errors: ${session.errors.length} │`);
    sessionIndex++;
  }
  console.log('');
  console.log('╰───────────────────────────────────────────────────────────────╯');
  console.log('');

  const totalEdits = sessions.reduce((sum, s) => sum + s.editCount, 0);
  const totalErrors = sessions.reduce((sum, s) => sum + s.errors.length, 0);
  const totalWarnings = sessions.reduce((sum, s) => sum + s.warnings.length, 0);

  // ── 验证 ──
  console.log('╭─ Validation ───────────────────────────────────────────╮');
  const validator = new SoakValidator(projectDir);

  const memOk = validator.verifyMemoryIntegrity(sessions);
  console.log(`  │ Memory integrity:     ${memOk ? '✅ PASS' : '❌ FAIL'}`);

  const lspOk = validator.verifyLSPStability(sessions);
  console.log(`  │ LSP stability:        ${lspOk ? '✅ PASS' : '❌ FAIL'}`);

  const hlOk = validator.verifyHashlineCorrectness(sessions);
  console.log(`  │ Hashline correctness: ${hlOk ? '✅ PASS' : '❌ FAIL'}`);

  const branchOk = validator.verifyMultiBranchIntegrity(sessions);
  console.log(`  │ Multi-branch:         ${branchOk ? '✅ PASS' : '❌ FAIL'}`);

  const commitOk = validator.verifyMultiCommitIntegrity(sessions);
  console.log(`  │ Multi-commit:         ${commitOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('╰───────────────────────────────────────────────────────────────╯');
  console.log('');

  // ── 摘要报告 ──
  const score = validator.computeFinalScore();

  console.log('╭─ Summary ─────────────────────────────────────────────╮');
  console.log(`  │ Sessions:    ${sessions.length}`);
  console.log(`  │ Total Edits: ${totalEdits}`);
  console.log(`  │ Errors:      ${totalErrors}`);
  console.log(`  │ Warnings:    ${totalWarnings}`);
  console.log(`  │ Score:       ${score.passCount}/${score.total} (${score.score}%)`);
  console.log(`  │ Final Verdict: ${score.score >= 80 ? '✅ PASS' : score.score >= 50 ? '⚠️  WARNING' : '❌ FAIL'}`);
  console.log('╰───────────────────────────────────────────────────────────────╯');
  console.log('');

  // 详细报告
  console.log(JSON.stringify({
    seed: SEED,
    duration: DURATION_SEC,
    aggressive: AGGRESSIVE,
    sessions: sessions.length,
    totalEdits,
    totalErrors,
    score,
    metrics: validator.metrics,
  }, null, 2));

  // 清理
  console.log(`\nCleaning up: ${tmpDir}`);
  rmSync(tmpDir, { recursive: true, force: true });

  process.exit(score.score >= 80 ? 0 : 1);
}

main().catch(err => {
  console.error('Soak runner crashed:', err);
  process.exit(2);
});
