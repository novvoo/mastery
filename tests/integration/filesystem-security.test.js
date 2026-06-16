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
import { SecurityPolicy, Decision } from '../../src/core/security-policy.js';
import { PermissionLevel } from '../../src/core/types.js';
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
  try { rmSync(workdir, { recursive: true, force: true }); } catch {}
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
    const result = await tools.read_file.handler(
      { path: '../secret.txt' },
      makeCtx(workdir),
    );
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
    const result = await tools.read_file.handler(
      { path: 'hello.txt' },
      makeCtx(workdir),
    );
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
    const result = await tools.read_file.handler(
      { path: 'roundtrip.txt' },
      makeCtx(workdir),
    );
    expect(String(result)).toMatch(/roundtrip value/);
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
    expect(['totalTools', 'byDecision', 'globalPolicy']
      .every(k => Object.keys(report).includes(k))).toBe(true);
  });
});
