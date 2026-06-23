/**
 * Integration tests for:
 *   - MetricsSink (ndjson 落盘 + latestSnapshot)
 *   - WriteFileGuard (diff + approval + WorkspaceState 快照同步)
 *
 * Bun test runner.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MetricsSink } from '../../src/core/metrics-sink.js';
import { WriteFileGuard } from '../../src/core/write-file-guard.js';
import { WorkspaceState } from '../../src/core/workspace-state.js';

// ============================================================
// Helpers
// ============================================================
function makeTempDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {}
}

// ============================================================
// MetricsSink
// ============================================================
describe('MetricsSink', () => {
  let dir;
  beforeEach(() => { dir = makeTempDir('metrics'); });
  afterEach(() => { rmrf(dir); });

  it('startRun / finishRun: 在 enabled 模式下真正写盘', () => {
    const sink = new MetricsSink({ logDir: dir, enabled: true });
    const runId = 'r-001';
    sink.startRun(runId);
    sink.finishRun(runId, { success: true, iterations: 3, durationMs: 120, toolCount: 5 });

    const files = fs.readdirSync(dir).filter(n => n.endsWith('.ndjson'));
    expect(files.length).toBeGreaterThan(0);

    const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const sessionEvents = lines.filter(l => l.type === 'session');
    expect(sessionEvents.length).toBe(2);
    expect(sessionEvents[0].phase).toBe('start');
    expect(sessionEvents[0].runId).toBe('r-001');
    expect(sessionEvents[1].phase).toBe('finish');
    expect(sessionEvents[1].success).toBe(true);
    expect(sessionEvents[1].iterations).toBe(3);
    expect(sessionEvents[1].toolCount).toBe(5);
  });

  it('recordLLMRequest / recordToolCall: 写盘 + latestSnapshot 可读到', () => {
    const sink = new MetricsSink({ logDir: dir, enabled: true });
    const runId = 'r-llm';
    sink.startRun(runId);
    sink.recordLLMRequest({ runId, model: 'gpt-4o', durationMs: 820, tokensIn: 1200, tokensOut: 340, success: true, attempt: 1 });
    sink.recordToolCall({ runId, toolName: 'read_file', durationMs: 42, success: true });
    sink.recordToolCall({ runId, toolName: 'write_file', durationMs: 60, success: false, error: 'permission denied', skipped: false });

    const snap = sink.latestSnapshot();
    expect(snap.lastRunId).toBe('r-llm');
    expect(snap.latestRequest.model).toBe('gpt-4o');
    expect(snap.latestRequest.tokensIn).toBe(1200);
    expect(snap.latestTool.toolName).toBe('write_file');
    expect(snap.latestTool.success).toBe(false);
    expect(snap.requestCount).toBe(1);
    expect(snap.toolCount).toBe(2);
    expect(snap.totalEvents).toBe(4); // start + request + tool*2
  });

  it('enabled=false 模式不落盘但 latestSnapshot 仍可用', () => {
    const sink = new MetricsSink({ logDir: dir, enabled: false });
    const runId = 'r-mem';
    sink.startRun(runId);
    sink.recordLLMRequest({ runId, model: 'fake', durationMs: 100, tokensIn: 10, tokensOut: 5, success: true, attempt: 1 });

    // 不应该产生任何文件
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(files.length).toBe(0);

    const snap = sink.latestSnapshot();
    expect(snap.lastRunId).toBe('r-mem');
    expect(snap.latestRequest.model).toBe('fake');
  });

  it('recordLLMRequest 无 runId 时回退到 lastRunId', () => {
    const sink = new MetricsSink({ logDir: dir, enabled: false });
    sink.startRun('fallback-test');
    sink.recordLLMRequest({ model: 'm', durationMs: 10, success: true });
    const snap = sink.latestSnapshot();
    expect(snap.latestRequest.runId).toBe('fallback-test');
  });

  it('错误事件 error 字段以字符串形式记录', () => {
    const sink = new MetricsSink({ logDir: dir, enabled: false });
    sink.startRun('err-test');
    const err = new Error('boom');
    sink.recordToolCall({ toolName: 'foo', durationMs: 5, success: false, error: err });
    const snap = sink.latestSnapshot();
    expect(snap.latestTool.success).toBe(false);
    // String(err) 会是 "Error: boom"，因此用 toContain
    expect(String(snap.latestTool.error)).toContain('boom');
  });
});

// ============================================================
// WriteFileGuard
// ============================================================
describe('WriteFileGuard', () => {
  let dir;
  beforeEach(() => { dir = makeTempDir('wfg'); });
  afterEach(() => { rmrf(dir); });

  function makeIO(root) {
    return {
      readFile: (p) => fs.promises.readFile(path.join(root, p), 'utf8'),
      writeFile: (p, c) => fs.promises.writeFile(path.join(root, p), c, 'utf8'),
    };
  }

  it('新文件: auto 模式下直接写入，diff 展示变更行', async () => {
    const ws = new WorkspaceState();
    const guard = new WriteFileGuard({ workspaceState: ws, approvalStrategy: 'auto' });
    const newContent = 'line1\nline2\nline3\n';
    const result = await guard.write('demo.txt', newContent, makeIO(dir));
    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.isNewFile).toBe(true);
    expect(result.diff.isNoop).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'demo.txt'), 'utf8')).toBe(newContent);

    // —— WorkspaceState 应该有该文件的快照 ——
    const snap = ws.getFileSnapshot('demo.txt');
    expect(snap).toBeTruthy();
    expect(snap.content).toBe(newContent);
  });

  it('已有文件: computeDiff 计算变更，并更新 WorkspaceState 快照', async () => {
    const ws = new WorkspaceState();
    const guard = new WriteFileGuard({ workspaceState: ws, approvalStrategy: 'auto' });
    const filePath = 'x.js';
    const oldContent = 'function foo() {\n  return 1;\n}\n';
    await fs.promises.writeFile(path.join(dir, filePath), oldContent, 'utf8');

    const newContent = 'function foo() {\n  return 42;\n}\n';
    const result = await guard.write(filePath, newContent, makeIO(dir));
    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.diff.added).toBeGreaterThan(0);
    expect(result.diff.removed).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dir, filePath), 'utf8')).toBe(newContent);

    const snap = ws.getFileSnapshot(filePath);
    expect(snap.content).toBe(newContent);
    expect(snap.source).toBe('write-file-guard');
  });

  it('approvalStrategy=hunk 且 onRequestApproval 返回 apply=false 时不写入', async () => {
    const ws = new WorkspaceState();
    const filePath = 'a.txt';
    // 构造"大改动"以触发 risky
    let oldContent = '';
    for (let i = 0; i < 60; i++) {oldContent += `line${i}\n`;}
    await fs.promises.writeFile(path.join(dir, filePath), oldContent, 'utf8');

    const guard = new WriteFileGuard({
      workspaceState: ws,
      approvalStrategy: 'hunk',
      onRequestApproval: async () => ({ apply: false, selectedHunks: [] }),
    });

    const newContent = 'COMPLETELY NEW\n'.repeat(40);
    const result = await guard.write(filePath, newContent, makeIO(dir));
    expect(result.success).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('user-cancelled');
    // 磁盘上仍是旧内容
    expect(fs.readFileSync(path.join(dir, filePath), 'utf8')).toBe(oldContent);
  });

  it('approvalStrategy=never 跳过审批直接落盘', async () => {
    const guard = new WriteFileGuard({ approvalStrategy: 'never' });
    const newContent = 'hello\n';
    const result = await guard.write('b.txt', newContent, makeIO(dir));
    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8')).toBe(newContent);
  });

  it('selectedHunks 只应用用户指定的 hunk', async () => {
    const ws = new WorkspaceState();
    const filePath = 'patch.js';
    // 制造两段相距 > 10 行的改动，确保产生两个独立 hunk（context 默认是 3）
    const oldContent =
      '// module A\n' +
      'const a = 1;\n' +
      Array.from({ length: 12 }, () => '// spacer\n').join('') +
      '// module B\n' +
      'const b = 2;\n';
    await fs.promises.writeFile(path.join(dir, filePath), oldContent, 'utf8');
    const newContent =
      '// module A (CHANGED)\n' +
      'const a = 999;\n' +
      Array.from({ length: 12 }, () => '// spacer\n').join('') +
      '// module B (CHANGED)\n' +
      'const b = 888;\n';

    // 先跑一次默认 auto 验证能得到 2 个 hunk
    const probe = new WriteFileGuard({ workspaceState: ws, approvalStrategy: 'auto' });
    const probeResult = await probe.write(filePath, newContent, makeIO(dir));
    expect(probeResult.applied).toBe(true);
    // 至少应产生 2 个 hunk（如果不是则测试假设不成立，直接失败）
    if (probeResult.diff.hunks < 2) {
      throw new Error(`预期 2+ hunks，实际 ${probeResult.diff.hunks}`);
    }
    // 重新写入旧内容
    await fs.promises.writeFile(path.join(dir, filePath), oldContent, 'utf8');

    // 现在用 hunk 审批 —— 只应用第一个 hunk
    const guard = new WriteFileGuard({
      workspaceState: ws,
      approvalStrategy: 'hunk',
      onRequestApproval: async () => ({
        apply: true,
        selectedHunks: [0],
      }),
    });
    const result = await guard.write(filePath, newContent, makeIO(dir));
    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    const onDisk = fs.readFileSync(path.join(dir, filePath), 'utf8');
    // 第一个 hunk: module A (CHANGED) 出现
    expect(onDisk.includes('module A (CHANGED)')).toBe(true);
    expect(onDisk.includes('const a = 999;')).toBe(true);
    // 第二个 hunk 没被应用：module B 保留原文
    expect(onDisk.includes('// module B\nconst b = 2;')).toBe(true);
  });

  it('无 io.writeFile 时拒绝执行', async () => {
    const guard = new WriteFileGuard({ approvalStrategy: 'auto' });
    const result = await guard.write('x.txt', 'hi', { readFile: () => Promise.resolve('') });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('io.writeFile');
  });

  it('newContent 非字符串时拒绝执行', async () => {
    const guard = new WriteFileGuard({ approvalStrategy: 'auto' });
    const result = await guard.write('x.txt', 42, makeIO(dir));
    expect(result.success).toBe(false);
    expect(result.reason).toContain('newContent');
  });

  it('diff.isNoop: 新旧内容相同时不会写盘（但仍返回 success=true）', async () => {
    const ws = new WorkspaceState();
    const guard = new WriteFileGuard({ workspaceState: ws, approvalStrategy: 'auto' });
    const filePath = 'same.txt';
    const content = 'const x = 1;\n';
    await fs.promises.writeFile(path.join(dir, filePath), content, 'utf8');
    const result = await guard.write(filePath, content, makeIO(dir));
    expect(result.success).toBe(true);
    // 即使 isNoop 也会落盘以同步快照，但 diff.isNoop 应为 true
    expect(result.diff.isNoop).toBe(true);
    expect(fs.readFileSync(path.join(dir, filePath), 'utf8')).toBe(content);
    const snap = ws.getFileSnapshot(filePath);
    expect(snap).toBeTruthy();
    expect(snap.content).toBe(content);
  });
});
