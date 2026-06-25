/**
 * Integration tests: runtime-bootstrap.js
 * 验证 CLI / Desktop 共享的内核初始化路径。
 * - bootstrapRuntime 正确构造 engine + toolRegistry + securityPolicy + workspaceState + metricsSink
 * - metricsSink 真正写盘
 * - workspaceState 聚合并读取文件上下文
 * - securityPolicy 正确拒绝 write 类操作
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  bootstrapRuntime,
  ensureMetricsSink,
  resolveSecurityPolicy,
  registerMCPTools,
} from '../../src/core/runtime-bootstrap.js';
import { metricsSink } from '../../src/core/metrics-sink.js';

describe('runtime-bootstrap', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rb-'));
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('bootstrapRuntime 返回完整的 runtime 组件', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      maxIterations: 10,
      debug: false,
      securityPolicy: 'full',
      metrics: { enabled: false },
      autoInitMCP: false,
    });

    expect(rt.engine).toBeTruthy();
    expect(rt.toolRegistry).toBeTruthy();
    expect(rt.securityPolicy).toBeTruthy();
    expect(rt.workspaceState).toBeTruthy();
    expect(rt.metricsSink).toBeTruthy();
    expect(rt.mcpClient).toBeTruthy();
    expect(rt.workingDirectory).toBe(dir);
  });

  it('bootstrapRuntime 暴露 engine 实际使用的 workspaceState', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: false },
      autoInitMCP: false,
    });

    expect(rt.workspaceState).toBe(rt.engine.getWorkspaceState());
  });

  it('bootstrapRuntime engine 状态同时提供 state/status 兼容字段', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: false },
      autoInitMCP: false,
    });

    const state = rt.engine.getState();
    expect(state.state).toBe('idle');
    expect(state.status).toBe('idle');
  });

  it('默认工具集不暴露实验编辑工具，避免 list/write 能力重复', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: false },
      autoInitMCP: false,
    });

    const names = rt.toolRegistry.getAll().map((tool) => tool.name);
    expect(names).toContain('list_dir');
    expect(names).toContain('tree');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names.some((name) => name.startsWith('harness_'))).toBe(false);
    expect(names.some((name) => name.startsWith('sg_'))).toBe(false);
  });

  it('includeExperimentalTools=true 时仍可显式启用实验编辑工具', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: false },
      autoInitMCP: false,
      includeExperimentalTools: true,
    });

    const names = rt.toolRegistry.getAll().map((tool) => tool.name);
    expect(names).toContain('harness_analyze');
    expect(names).toContain('harness_replace');
    expect(names).toContain('sg_index');
    expect(names).toContain('sg_edit');
  });

  it('metrics.enabled=true 时 metricsSink 写盘', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: true, logDir: join(dir, '.agent-logs') },
      autoInitMCP: false,
    });

    // 手动写一条事件
    rt.metricsSink.startRun('op-1');
    rt.metricsSink.recordToolCall({
      toolName: 'list_dir',
      durationMs: 2,
      success: true,
    });
    rt.metricsSink.finishRun('op-1');

    // 给文件系统一点时间刷盘
    await new Promise((r) => setTimeout(r, 50));

    const logDir = join(dir, '.agent-logs');
    expect(existsSync(logDir)).toBe(true);
    const files = readdirSync(logDir).filter(
      (n) => n.startsWith('metrics-') && n.endsWith('.ndjson'),
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it('metrics.enabled=false 时不写盘（memory-only）', async () => {
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: false, logDir: join(dir, '.agent-logs') },
      autoInitMCP: false,
    });

    rt.metricsSink.startRun('op-2');
    rt.metricsSink.recordToolCall({ toolName: 'noop', durationMs: 1, success: true });
    rt.metricsSink.finishRun('op-2');

    await new Promise((r) => setTimeout(r, 50));
    // memory snapshot 仍可读到
    const snap = metricsSink.latestSnapshot();
    expect(snap.latestTool).toBeTruthy();
    // 但磁盘上没有日志目录（或空）
    const logDir = join(dir, '.agent-logs');
    if (existsSync(logDir)) {
      const files = readdirSync(logDir).filter((n) => n.startsWith('metrics-'));
      expect(files.length).toBe(0);
    }
  });

  it('workspaceState 可记录文件引用并聚合', async () => {
    // 写一个文件 & 记录快照
    writeFileSync(join(dir, 'notes.txt'), 'hello world\nline 2\nline 3\n', 'utf8');
    const rt = await bootstrapRuntime({
      workingDirectory: dir,
      metrics: { enabled: false },
      autoInitMCP: false,
    });

    // 记录文件快照（类似 read_file 的后续结果）
    rt.workspaceState.setFileSnapshot('notes.txt', 'hello world\nline 2\nline 3\n');
    rt.workspaceState.recordReference('notes.txt', 'read_file');

    const agg = rt.workspaceState.aggregateContext({ maxCharsPerFile: 100, maxTotalChars: 500 });
    expect(agg).toBeTruthy();
    expect(Array.isArray(agg.files)).toBe(true);
    expect(agg.files.length).toBeGreaterThan(0);
    expect(agg.summary).toContain('notes.txt');
  });

  it('securityPolicy=readonly 拒绝 write 类工具', () => {
    const policy = resolveSecurityPolicy('readonly');
    const verdict = policy.evaluate('write_file', { filePath: 'x.txt', content: 'hi' });
    // READ_ONLY 策略下写文件会被 deny / requireApproval
    const isAllowed = verdict && verdict.decision === 'allow';
    expect(isAllowed).toBe(false);
  });

  it('securityPolicy=full 允许默认工具', () => {
    const policy = resolveSecurityPolicy('full');
    const verdict = policy.evaluate('list_dir', { directory: '.' });
    const denied = verdict && verdict.decision === 'deny';
    expect(denied).toBe(false);
  });

  it('ensureMetricsSink 幂等：重复调用不抛错', () => {
    expect(() => {
      ensureMetricsSink({ enabled: false });
      ensureMetricsSink({ enabled: false });
      ensureMetricsSink({ enabled: true, logDir: join(dir, 'logs'), workingDirectory: dir });
      ensureMetricsSink({ enabled: true, logDir: join(dir, 'logs'), workingDirectory: dir });
    }).not.toThrow();
  });

  it('registerMCPTools 对空 mcpClient/mock 不抛错', () => {
    const mockMcpClient = {
      getTools: () => [],
    };
    const mockRegistry = { has: () => false, register: () => {} };
    // 空 tools 列表 -> 不报错
    expect(() => registerMCPTools(mockMcpClient, mockRegistry, 'fake')).not.toThrow();
  });
});
