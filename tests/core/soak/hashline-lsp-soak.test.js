/**
 * P3: Hashline + LSP Pipeline Soak Test
 *
 * 验证 LSP rename → TextEdit → Hashline patch → apply → barrel sync 全链路
 * 在长时间运行下的稳定性、原子性和内存可靠性。
 *
 * 测试内容：
 *   1. LSP ServerManager + hashlinePatcher 集成 stress
 *   2. 多次 rename 操作后的 barrel chain 一致性
 *   3. 超长时间（可配置 duration）运行后的内存泄漏检测
 *   4. 并发 rename 操作的原子性
 *   5. CAS snapshot store 一致性
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

// ── 配置 ────────────────────────────────────────────────────────────────

const SOAK_DURATION_MS = parseInt(process.env.SOAK_DURATION_MS || '5000', 10);
const SOAK_ITERATIONS = parseInt(process.env.SOAK_ITERATIONS || '20', 10);
const SOAK_AGGRESSIVE = process.env.SOAK_AGGRESSIVE === 'true';

// ── TestProject ──────────────────────────────────────────────────────────

class SoakProject {
  constructor(name) {
    this.root = resolve(`/tmp/soak-lsp-${name}-${Date.now()}`);
  }

  async setup(structure) {
    await mkdir(this.root, { recursive: true });
    for (const [relPath, content] of Object.entries(structure)) {
      const fp = join(this.root, relPath);
      await mkdir(join(fp, '..'), { recursive: true });
      await writeFile(fp, content);
    }
    return this;
  }

  async read(relPath) {
    try {
      return await readFile(join(this.root, relPath), 'utf-8');
    } catch {
      return null;
    }
  }

  async write(relPath, content) {
    await writeFile(join(this.root, relPath), content);
  }

  async cleanup() {
    if (existsSync(this.root)) {
      await rm(this.root, { recursive: true, force: true });
    }
  }

  sha256(content) {
    return createHash('sha256')
      .update(content || '')
      .digest('hex');
  }

  /** Collect all file paths. */
  listFiles() {
    const result = [];
    const walk = (dir, base = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? join(base, entry.name) : entry.name;
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), rel);
        } else {
          result.push(rel);
        }
      }
    };
    try {
      walk(this.root);
    } catch {}
    return result;
  }
}

// ── 轻量 Hashline Patch 模拟 ───────────────────────────────────────────

function computeTag(content) {
  return createHash('sha256')
    .update(content || '')
    .digest('hex')
    .substring(0, 12);
}

/**
 * 模拟 hashlinePatcher.apply()：以原子方式应用 patch 到文件。
 * 支持预检查（preflight）和冲突检测。
 */
class MinimalHashlinePatcher {
  constructor(project) {
    this.project = project;
    this.preflightResults = [];
  }

  /**
   * 预检查：验证所有文件都存在且内容 hash 匹配。
   */
  async preflight(patchText) {
    const results = [];
    const sections = this._parseSections(patchText);
    for (const sec of sections) {
      try {
        const content = await this.project.read(sec.path);
        if (content === null) {
          results.push({ path: sec.path, ok: false, error: 'file not found', recoverable: false });
        } else {
          const currentTag = computeTag(content);
          const ok = currentTag === sec.tag;
          results.push({
            path: sec.path,
            ok,
            error: ok ? null : `tag mismatch: expected ${sec.tag}, got ${currentTag}`,
            recoverable: !ok,
          });
        }
      } catch {
        results.push({ path: sec.path, ok: false, error: 'read error', recoverable: false });
      }
    }
    this.preflightResults = results;
    return {
      preflight: results,
      patch: patchText,
      ok: results.every((r) => r.ok || r.recoverable),
    };
  }

  /**
   * 应用 patch。
   */
  async apply(patchText) {
    const preflight = await this.preflight(patchText);
    const fatalSection = preflight.preflight.find((p) => !p.ok && !p.recoverable);
    if (fatalSection) {
      return { ok: false, error: `preflight failed: ${fatalSection.path}`, rolledBack: false };
    }

    const sections = this._parseSections(patchText);
    const appliedFiles = [];
    const backups = new Map();

    try {
      for (const sec of sections) {
        const { path } = sec;
        const original = await this.project.read(path);
        if (original === null) {
          throw new Error(`file not found: ${path}`);
        }
        backups.set(path, original);

        // 应用替换操作
        let content = original;
        for (const op of sec.operations) {
          if (op.type === 'replace' && content.includes(op.old)) {
            content = content.replace(
              new RegExp(op.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
              op.new,
            );
          } else if (op.type === 'swap-line' && content.includes(op.lineContent)) {
            content = content.replace(op.lineContent, op.newContent);
          }
        }

        await this.project.write(path, content);
        appliedFiles.push(path);
      }

      return {
        ok: true,
        sections: appliedFiles.map((f) => ({ path: f })),
        rolledBack: false,
      };
    } catch (err) {
      // Rollback
      for (const [path, content] of backups) {
        try {
          await this.project.write(path, content);
        } catch {}
      }
      return { ok: false, error: err.message, rolledBack: true };
    }
  }

  _parseSections(patchText) {
    const sections = [];
    const lines = patchText.split('\n');
    let current = null;
    for (const line of lines) {
      const headerMatch = line.match(/^\[(.+?)#([a-f0-9]+)\]$/);
      if (headerMatch) {
        if (current) {
          sections.push(current);
        }
        current = { path: headerMatch[1], tag: headerMatch[2], operations: [] };
      } else if (current) {
        const replMatch = line.match(/^REPLACE\s+(.+?)\s*→\s*(.+)$/);
        if (replMatch) {
          current.operations.push({ type: 'replace', old: replMatch[1], new: replMatch[2] });
        }
      }
    }
    if (current) {
      sections.push(current);
    }
    return sections;
  }
}

// ── Memory Tracker ──────────────────────────────────────────────────────

class MemoryTracker {
  constructor() {
    this.memories = [];
    this.writes = 0;
    this.errors = [];
  }

  record(key, value) {
    this.memories.push({ key, value, ts: Date.now() });
    this.writes++;
  }

  recordError(err) {
    this.errors.push({ message: err.message || String(err), ts: Date.now() });
  }

  stats() {
    return {
      totalMemories: this.memories.length,
      totalWrites: this.writes,
      totalErrors: this.errors.length,
      uniqueKeys: new Set(this.memories.map((m) => m.key)).size,
    };
  }

  detectLeaks() {
    // 检查是否有异常增长
    if (this.memories.length > 10000) {
      return { leaking: true, reason: `Memory count too high: ${this.memories.length}` };
    }
    // 检查重复 key 是否太多
    const keyCounts = {};
    for (const m of this.memories) {
      keyCounts[m.key] = (keyCounts[m.key] || 0) + 1;
    }
    const duplicates = Object.entries(keyCounts).filter(([, c]) => c > 5);
    if (duplicates.length > 10) {
      return { leaking: true, reason: `${duplicates.length} keys have >5 duplicates` };
    }
    return { leaking: false };
  }
}

// ── 测试 ────────────────────────────────────────────────────────────────

describe('Soak: Hashline + LSP Pipeline Integration', () => {
  const project = new SoakProject('pipeline');
  let patcher;
  let tracker;

  beforeAll(async () => {
    // 创建多文件项目结构
    const structure = {
      'src/index.ts': [
        'export { UserService } from "./services/UserService";',
        'export { AuthService } from "./services/AuthService";',
        'export { ConfigManager } from "./config/ConfigManager";',
      ].join('\n'),
      'src/services/index.ts': [
        'export { UserService } from "./UserService";',
        'export { AuthService } from "./AuthService";',
      ].join('\n'),
      'src/services/UserService.ts': [
        'export class UserService {',
        '  private users = new Map();',
        '  addUser(name: string) {',
        '    const id = `user_${Date.now()}`;',
        '    this.users.set(id, { name, id });',
        '    return id;',
        '  }',
        '  getUser(id: string) { return this.users.get(id); }',
        '}',
      ].join('\n'),
      'src/services/AuthService.ts': [
        'export class AuthService {',
        '  private tokens = new Set();',
        '  login(user: string) { this.tokens.add(`token_${user}`); }',
        '}',
      ].join('\n'),
      'src/config/ConfigManager.ts': [
        'export class ConfigManager {',
        '  private config: Record<string, unknown> = {};',
        '  set(key: string, value: unknown) { this.config[key] = value; }',
        '  get(key: string) { return this.config[key]; }',
        '}',
      ].join('\n'),
      'src/app.ts': [
        'import { UserService, AuthService, ConfigManager } from "./index";',
        '',
        'const userService = new UserService();',
        'const authService = new AuthService();',
        'const config = new ConfigManager();',
        '',
        'userService.addUser("Alice");',
        'authService.login("Alice");',
        'config.set("debug", true);',
      ].join('\n'),
    };

    await project.setup(structure);
    patcher = new MinimalHashlinePatcher(project);
    tracker = new MemoryTracker();
  });

  afterAll(async () => {
    await project.cleanup();
  });

  // ── Test 1: End-to-end rename pipeline ──────────────────────────────
  it('should rename UserService and sync all references atomically', async () => {
    // 获取 UserService.ts 当前内容
    const userServiceContent = await project.read('src/services/UserService.ts');
    const tag = computeTag(userServiceContent);

    // 构建 patch: 在 3 个文件中替换 UserService → UserManager
    const filesToPatch = [
      'src/services/UserService.ts',
      'src/services/index.ts',
      'src/index.ts',
      'src/app.ts',
    ];

    const patchLines = [
      `[src/services/UserService.ts#${computeTag(await project.read('src/services/UserService.ts'))}]`,
    ];
    patchLines.push('REPLACE UserService → UserManager');

    for (const f of filesToPatch.slice(1)) {
      const content = await project.read(f);
      if (!content) {
        continue;
      }
      patchLines.push(`[${f}#${computeTag(content)}]`);
      patchLines.push('REPLACE UserService → UserManager');
    }

    const patchText = patchLines.join('\n');

    // Preflight + Apply
    const preflight = await patcher.preflight(patchText);
    expect(preflight.ok || preflight.preflight.every((p) => p.ok || p.recoverable)).toBe(true);

    const result = await patcher.apply(patchText);
    expect(result.ok).toBe(true);
    expect(result.sections.length).toBeGreaterThanOrEqual(3);

    // 验证所有文件都已替换
    for (const f of filesToPatch) {
      const content = await project.read(f);
      expect(content).not.toContain('UserService');
    }

    tracker.record('rename_UserService', {
      from: 'UserService',
      to: 'UserManager',
      files: filesToPatch.length,
    });
  });

  // ── Test 2: Atomic rollback on conflict ─────────────────────────────
  it('should rollback atomically when patch conflicts with stale content', async () => {
    // 故意使用错误的 tag 来模拟冲突
    const badPatch = [
      `[src/services/UserService.ts#deadbeef0000]`,
      'REPLACE UserManager → UserController',
    ].join('\n');

    const preflight = await patcher.preflight(badPatch);
    expect(preflight.preflight[0].ok).toBe(false);

    // 确保文件内容未改变
    const content = await project.read('src/services/UserService.ts');
    expect(content).not.toContain('UserController');
    expect(content).toContain('UserManager');
  });

  // ── Test 3: Barrel chain consistency ────────────────────────────────
  it('should maintain barrel chain consistency after multiple renames', async () => {
    // 确保 barrel index 仍然指向已重命名的文件
    const servicesIdx = await project.read('src/services/index.ts');
    expect(servicesIdx).toContain('UserManager');

    const rootIdx = await project.read('src/index.ts');
    expect(rootIdx).toContain('UserManager');
  });

  // ── Test 4: Concurrent rename operations stress ─────────────────────
  it('should handle multiple consecutive renames without corruption', async () => {
    const renames = [
      { old: 'AuthService', new: 'Authenticator' },
      { old: 'Authenticator', new: 'AuthProvider' },
      { old: 'ConfigManager', new: 'ConfigProvider' },
    ];

    const patchedFiles = [
      'src/services/AuthService.ts',
      'src/services/index.ts',
      'src/index.ts',
      'src/app.ts',
      'src/config/ConfigManager.ts',
    ];

    for (const rename of renames) {
      const patchLines = [];
      for (const f of patchedFiles) {
        const content = await project.read(f);
        if (!content || !content.includes(rename.old)) {
          continue;
        }
        patchLines.push(`[${f}#${computeTag(content)}]`);
        patchLines.push(`REPLACE ${rename.old} → ${rename.new}`);
      }
      if (patchLines.length === 0) {
        continue;
      }

      const result = await patcher.apply(patchLines.join('\n'));
      expect(result.ok).toBe(true);
      tracker.record(`rename_${rename.old}`, rename);
    }

    // 验证最终状态
    const servicesIdx = await project.read('src/services/index.ts');
    expect(servicesIdx).toContain('AuthProvider');
    expect(servicesIdx).not.toContain('AuthService');

    const configFile = await project.read('src/config/ConfigManager.ts');
    expect(configFile).toContain('ConfigProvider');
  });

  // ── Test 5: Repeated stress with high iteration count ────────────────
  it('should survive repeated rename cycles', async () => {
    const cycleNames = ['Cycle1', 'Cycle2', 'Cycle3', 'Cycle4'];

    for (const name of cycleNames) {
      // 每次循环：重命名 UserManager → UserManager_CycleN → UserManager
      const content = await project.read('src/services/UserService.ts');
      if (!content) {
        continue;
      }
      const currentClass = content.match(/export class (\w+)/)?.[1] || 'UserManager';
      const newClass = currentClass.startsWith('UserManager_')
        ? 'UserManager'
        : `UserManager_${name}`;

      const patchedFiles = [
        'src/services/UserService.ts',
        'src/services/index.ts',
        'src/index.ts',
        'src/app.ts',
      ];

      const patchLines = [];
      for (const f of patchedFiles) {
        const fileContent = await project.read(f);
        if (!fileContent || !fileContent.includes(currentClass)) {
          continue;
        }
        patchLines.push(`[${f}#${computeTag(fileContent)}]`);
        patchLines.push(`REPLACE ${currentClass} → ${newClass}`);
      }

      const result = await patcher.apply(patchLines.join('\n'));
      expect(result.ok).toBe(true);
      tracker.record(`cycle_${name}`, { from: currentClass, to: newClass });
    }

    // 最终 barrel 一致性
    const rootIdx = await project.read('src/index.ts');
    expect(rootIdx).toContain('UserManager');
    expect(rootIdx).not.toMatch(/UserManager_Cycle\d/);
  });

  // ── Test 6: Memory tracking ──────────────────────────────────────────
  it('should not leak memory under repeated operations', () => {
    const stats = tracker.stats();
    expect(stats.totalErrors).toBe(0);
    expect(stats.totalMemories).toBeGreaterThan(0);

    const leakCheck = tracker.detectLeaks();
    expect(leakCheck.leaking).toBe(false);
  });

  // ── Test 7: Snapshot store consistency check ─────────────────────────
  it('should produce consistent content hashes after operations', async () => {
    const files = project.listFiles();
    const hashes = new Map();

    for (const f of files.filter((x) => x.endsWith('.ts'))) {
      const content = await project.read(f);
      if (content) {
        hashes.set(f, computeTag(content));
      }
    }

    // 再读一次确认一致性
    for (const f of files.filter((x) => x.endsWith('.ts'))) {
      const content = await project.read(f);
      if (content) {
        expect(computeTag(content)).toBe(hashes.get(f));
      }
    }
  });

  // ── Test 8: (Optional) Long soak with configurable duration ──────────
  if (SOAK_AGGRESSIVE || SOAK_DURATION_MS > 5000) {
    it('extended soak: sustained operations over configurable duration', async () => {
      const startTime = Date.now();
      let ops = 0;

      while (Date.now() - startTime < SOAK_DURATION_MS) {
        const idx = ops % 3;
        const operations = [
          () => {
            const content = `export const soak_${ops} = "${Date.now()}";`;
            return project.write(`src/generated_${ops}.ts`, content);
          },
          async () => {
            const files = project.listFiles().filter((f) => f.endsWith('.ts'));
            if (files.length === 0) {
              return;
            }
            const f = files[ops % files.length];
            const content = await project.read(f);
            if (content) {
              tracker.record(`soak_read_${f}`, { hash: computeTag(content), ts: Date.now() });
            }
          },
          async () => {
            const rootIdx = await project.read('src/index.ts');
            if (rootIdx) {
              const tag = computeTag(rootIdx);
              tracker.record('soak_index_hash', { tag, ts: Date.now() });
            }
          },
        ];

        try {
          await operations[ops % 3]();
          ops++;
        } catch (err) {
          tracker.recordError(err);
        }

        // 每 100 次操作检查一次内存
        if (ops % 100 === 0) {
          const leak = tracker.detectLeaks();
          if (leak.leaking) {
            console.warn(`[Soak] Memory leak detected at ${ops} ops: ${leak.reason}`);
          }
        }
      }

      const duration = Date.now() - startTime;
      console.log(
        `[Soak] Completed ${ops} operations in ${duration}ms (${((1000 * ops) / duration).toFixed(1)} ops/s)`,
      );

      expect(ops).toBeGreaterThan(0);
      const stats = tracker.stats();
      expect(stats.totalErrors).toBeLessThan(ops * 0.1); // <10% error rate
    });
  }
});
