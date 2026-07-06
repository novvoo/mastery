/**
 * Filesystem + shell security policy end-to-end tests.
 *
 * 验证点:
 *  - safeResolvePath 拒绝 ".." 路径穿越
 *  - safeResolvePath 拒绝绝对路径
 *  - write_file/read_file 不允许写入/读取 workdir 之外
 *  - SecurityPolicy：global maxPermissionLevel 生效
 *  - read_file 在 sandbox 目录内工作正常
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { SecurityPolicy, Decision } from '../../src/core/runtime/agent/support/security-policy.js';
import { PermissionLevel } from '../../src/core/types/index.js';
import { createFileSystemTools } from '../../src/tools/filesystem/filesystem-tools.js';

let workdir;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'fs-security-test-'));
  // 放一个合法文件
  writeFileSync(join(workdir, 'hello.txt'), 'Hello, world!');
  // 在 workdir 之外再放一个敏感文件 (用于路径穿越验证)
  writeFileSync(join(tmpdir(), 'secret.txt'), 'I_AM_SENSITIVE');
});

afterAll(() => {
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {}
});

// 一个最简单的 ctx 对象，供工具 handler 调用
function makeCtx(wd, policy = null) {
  return {
    workingDirectory: wd,
    memoryManager: {
      async updateFileMap() {},
    },
    contentStore: null,
    fileAnalyzer: null,
    securityPolicy: policy,
  };
}

describe('Filesystem sandbox: path containment', () => {
  let tools;
  beforeAll(() => {
    tools = {};
    for (const tool of createFileSystemTools()) {
      tools[tool.name] = tool;
    }
  });

  test('read_file 拒绝路径穿越 ../secret.txt', async () => {
    const result = await tools.read_file.handler({ path: '../secret.txt' }, makeCtx(workdir));
    // 失败的路径穿越应返回以 "Error:" 开头的错误信息
    expect(String(result)).toMatch(/Error/i);
    // 且不应当包含敏感文件内容
    expect(String(result)).not.toMatch(/I_AM_SENSITIVE/);
  });

  test('read_file 拒绝绝对路径指向 workdir 之外', async () => {
    const result = await tools.read_file.handler(
      { path: resolve(join(tmpdir(), 'secret.txt')) },
      makeCtx(workdir),
    );
    expect(String(result)).toMatch(/Error/i);
    expect(String(result)).not.toMatch(/I_AM_SENSITIVE/);
  });

  test('read_file 允许相对路径读取工作目录内合法文件', async () => {
    const result = await tools.read_file.handler({ path: 'hello.txt' }, makeCtx(workdir));
    expect(String(result)).toMatch(/Hello, world!/);
  });

  test('write_file 拒绝路径穿越 ../evil.txt', async () => {
    const result = await tools.write_file.handler(
      { path: '../evil.txt', content: 'payload' },
      makeCtx(workdir),
    );
    expect(String(result)).toMatch(/Error/i);
  });

  test('write_file 允许写入 workdir 子目录', async () => {
    const result = await tools.write_file.handler(
      { path: 'sub/generated.txt', content: 'generated content' },
      makeCtx(workdir),
    );
    expect(String(result)).toMatch(/success/i);
  });

  test('read_file 允许读取刚刚写入 workdir 的新文件', async () => {
    const written = await tools.write_file.handler(
      { path: 'roundtrip.txt', content: 'roundtrip value' },
      makeCtx(workdir),
    );
    expect(String(written)).toMatch(/success/i);
    const result = await tools.read_file.handler({ path: 'roundtrip.txt' }, makeCtx(workdir));
    expect(String(result)).toMatch(/roundtrip value/);
  });

  test('edit_file 在 old_text 存在轻微空白差异时可回退到 normalized 匹配', async () => {
    writeFileSync(
      join(workdir, 'normalized-edit.js'),
      "function demo() {\r\n  return answer;\r\n}\r\n",
      'utf8',
    );

    const result = await tools.edit_file.handler(
      {
        path: 'normalized-edit.js',
        old_text: "function demo() {\nreturn answer;\n}",
        new_text: "function demo() {\n  return value;\n}",
      },
      makeCtx(workdir),
    );

    expect(String(result)).toContain('File edited successfully');
    expect(String(result)).toContain('Strategy: normalized');

    const after = await tools.read_file.handler({ path: 'normalized-edit.js' }, makeCtx(workdir));
    expect(String(after)).toContain('return value;');
  });

  test('edit_file delegates to EditOrchestrator when available', async () => {
    writeFileSync(join(workdir, 'orchestrator-test.js'), 'const x = 1;\n', 'utf8');
    const mockOrchestrator = {
      editViaHashline: async () => ({
        success: true,
        filesChanged: ['orchestrator-test.js'],
        totalEdits: 1,
        diagnostics: { ok: true },
        repaired: [],
        memoryUpdated: true,
        error: null,
      }),
    };
    const ctx = { ...makeCtx(workdir), editOrchestrator: mockOrchestrator };

    const result = await tools.edit_file.handler(
      { path: 'orchestrator-test.js', old_text: 'const x = 1;', new_text: 'const y = 2;' },
      ctx,
    );

    expect(String(result)).toContain('via EditOrchestrator');
    expect(String(result)).toContain('Diagnostics gate: PASSED');
    expect(String(result)).toContain('Memory: updated');
  });

  test('edit_file propagates orchestrator failure', async () => {
    writeFileSync(join(workdir, 'orchestrator-fail.js'), 'const a = 1;\n', 'utf8');
    const mockOrchestrator = {
      editViaHashline: async () => ({
        success: false,
        filesChanged: [],
        totalEdits: 0,
        diagnostics: null,
        error: 'simulated orchestrator error',
      }),
    };
    const ctx = { ...makeCtx(workdir), editOrchestrator: mockOrchestrator };

    const result = await tools.edit_file.handler(
      { path: 'orchestrator-fail.js', old_text: 'const a = 1;', new_text: 'const b = 2;' },
      ctx,
    );

    expect(String(result)).toContain('Edit failed via orchestrator');
    expect(String(result)).toContain('simulated orchestrator error');
  });

  test('edit_file falls back to patcher when no orchestrator', async () => {
    writeFileSync(join(workdir, 'patcher-fallback.js'), 'const p = 1;\n', 'utf8');
    const mockPatcher = {
      preflight: async () => ({
        patch: {},
        preflight: [{ ok: true, path: 'patcher-fallback.js', tag: 'abc', recoverable: false }],
      }),
      apply: async () => ({
        ok: true,
        sections: [{ path: 'patcher-fallback.js', hunksApplied: 1, tag: 'abc', newTag: 'def' }],
        error: null,
      }),
    };
    const ctx = { ...makeCtx(workdir), hashlinePatcher: mockPatcher };

    const result = await tools.edit_file.handler(
      { path: 'patcher-fallback.js', old_text: 'const p = 1;', new_text: 'const q = 2;' },
      ctx,
    );

    expect(String(result)).toContain('via Hashline patcher');
    expect(String(result)).toContain('File edited successfully');
  });

  test('edit_file direct fallback when no orchestrator or patcher', async () => {
    writeFileSync(join(workdir, 'direct-fallback.js'), 'const d = 1;\n', 'utf8');

    const result = await tools.edit_file.handler(
      { path: 'direct-fallback.js', old_text: 'const d = 1;', new_text: 'const e = 2;' },
      makeCtx(workdir),
    );

    expect(String(result)).toContain('(direct)');
    expect(String(result)).toContain('File edited successfully');
  });

  test('edit_file accepts original_text alias for old_text', async () => {
    writeFileSync(join(workdir, 'orig-alias.js'), 'const x = 1;\n', 'utf8');

    const result = await tools.edit_file.handler(
      { path: 'orig-alias.js', original_text: 'const x = 1;', new_text: 'const y = 2;' },
      makeCtx(workdir),
    );

    expect(String(result)).toContain('File edited successfully');
    expect(String(result)).toContain('exact');
  });

  test('edit_file accepts edits array (Claude Code format)', async () => {
    writeFileSync(join(workdir, 'edits-array.js'), 'let a = 1;\n', 'utf8');

    const result = await tools.edit_file.handler(
      {
        path: 'edits-array.js',
        edits: [{ old_text: 'let a = 1;', new_text: 'let b = 2;' }],
      },
      makeCtx(workdir),
    );

    expect(String(result)).toContain('File edited successfully');
  });

  test('edit_file accepts changes array (Claude Code format)', async () => {
    writeFileSync(join(workdir, 'changes-array.js'), 'const p = 1;\n', 'utf8');

    const result = await tools.edit_file.handler(
      {
        path: 'changes-array.js',
        changes: [{ old_text: 'const p = 1;', new_text: 'const q = 2;' }],
      },
      makeCtx(workdir),
    );

    expect(String(result)).toContain('File edited successfully');
  });
});

describe('SecurityPolicy permission levels', () => {
  test('global maxPermissionLevel = READ_ONLY 拒绝 write 类工具', () => {
    const policy = new SecurityPolicy({
      maxPermissionLevel: PermissionLevel.READ_ONLY,
    });
    policy.registerPolicy('write_file', {
      permissionLevel: PermissionLevel.WRITE,
    });
    const decision = policy.evaluate('write_file', { path: 'x', content: 'y' });
    expect(decision.decision).toBe(Decision.DENY);
  });

  test('global maxPermissionLevel = WRITE 允许 write, 拒绝 execute', () => {
    const policy = new SecurityPolicy({
      maxPermissionLevel: PermissionLevel.WRITE,
    });
    policy.registerPolicy('write_file', { permissionLevel: PermissionLevel.WRITE });
    policy.registerPolicy('shell', { permissionLevel: PermissionLevel.EXECUTE });

    const writeDecision = policy.evaluate('write_file', { path: 'x', content: 'y' });
    const shellDecision = policy.evaluate('shell', { command: 'ls' });

    expect(writeDecision.decision).toBe(Decision.ALLOW);
    expect(shellDecision.decision).toBe(Decision.DENY);
  });

  test('requiresApproval gate 对危险工具产生 REQUIRE_APPROVAL', () => {
    const policy = new SecurityPolicy({
      maxPermissionLevel: PermissionLevel.DANGEROUS,
    });
    policy.registerPolicy('git_push_force', {
      permissionLevel: PermissionLevel.DANGEROUS,
      requiresApproval: true,
    });
    const decision = policy.evaluate('git_push_force', { remote: 'origin' });
    expect(decision.decision).toBe(Decision.REQUIRE_APPROVAL);
  });

  test('未注册工具通过 inferPolicy 回退到 READ_ONLY 不会直接 ALLOW 危险操作', () => {
    const policy = new SecurityPolicy({
      maxPermissionLevel: PermissionLevel.READ_ONLY,
    });
    // shell 类命名应被推断为 EXECUTE，与全局 READ_ONLY 冲突 → DENY
    const decision = policy.evaluate('shell_run', { command: 'ls' });
    expect(decision.decision).toBe(Decision.DENY);
  });

  test('getSecurityReport 汇总策略状态', () => {
    const policy = new SecurityPolicy({
      maxPermissionLevel: PermissionLevel.WRITE,
    });
    policy.registerPolicy('write_file', { permissionLevel: PermissionLevel.WRITE });
    policy.registerPolicy('read_file', { permissionLevel: PermissionLevel.READ_ONLY });

    policy.evaluate('write_file', { path: 'x', content: 'y' });
    policy.evaluate('read_file', { path: 'x' });

    const report = policy.getSecurityReport();
    expect(report.totalTools).toBeGreaterThan(0);
    expect(typeof report.globalPolicy).toBe('object');
    expect(Array.isArray(report.byDecision?.byDecision ?? report.byDecision?.allow)).toBe(false);
    // 至少 report 包含 keys 是我们关心的
    expect(
      ['totalTools', 'byDecision', 'globalPolicy'].every((k) => Object.keys(report).includes(k)),
    ).toBe(true);
  });
});
