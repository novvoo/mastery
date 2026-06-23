/**
 * MetricsSink —— 把 agent 的运行时指标落盘到 NDJSON 文件。
 *
 * 设计：
 *   - 三类事件：request (LLM) 、 tool 、 session
 *   - 每个事件带有 timestamp / runId / durationMs / error（如失败）
 *   - 写文件使用 appendFileSync，Node/Electron 主进程下安全；其他环境优雅降级
 *   - 可选地暴露 `latestSnapshot`（渲染进程可通过 IPC 拉取"最近一次运行的指标"）
 */

import fs from 'fs';
import path from 'path';

export class MetricsSink {
  /**
   * @param {object} opts
   * @param {string} [opts.logDir]   日志目录，默认 `${cwd}/.agent-logs`
   * @param {number} [opts.maxEventsPerFile] 单个文件最多多少行（滚动）
   * @param {boolean} [opts.enabled] 是否真正写盘（便于测试）
   */
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.maxEventsPerFile = opts.maxEventsPerFile || 20000;
    this.logDir = opts.logDir || null;
    this._latestSnapshot = { requests: [], tools: [], sessions: [] };
    this._lineCount = 0;
    this._currentFile = null;
    this._lastRunId = null;
    this._ensureDirCalled = false;
  }

  // ---------- 公共 API ----------

  startRun(runId) {
    this._lastRunId = runId;
    this.emit('session', { runId, phase: 'start' });
    return runId;
  }

  finishRun(
    runId,
    {
      success = true,
      iterations = 0,
      durationMs = 0,
      reason = null,
      toolCount = 0,
      llmRequestCount = 0,
    } = {},
  ) {
    this.emit('session', {
      runId,
      phase: 'finish',
      success,
      iterations,
      durationMs,
      reason,
      toolCount,
      llmRequestCount,
    });
  }

  recordLLMRequest({
    runId,
    model,
    durationMs,
    tokensIn = null,
    tokensOut = null,
    success = true,
    error = null,
    attempt = 1,
  }) {
    this.emit('request', {
      runId: runId || this._lastRunId,
      model,
      durationMs,
      tokensIn,
      tokensOut,
      success,
      error: error ? String(error) : null,
      attempt,
    });
  }

  recordToolCall({
    runId,
    toolName,
    durationMs,
    success = true,
    error = null,
    predicted = false,
    skipped = false,
  }) {
    this.emit('tool', {
      runId: runId || this._lastRunId,
      toolName,
      durationMs,
      success,
      error: error ? String(error) : null,
      predicted,
      skipped,
    });
  }

  /** 最近一次 run 的摘要（渲染进程可通过 IPC 拉取） */
  latestSnapshot() {
    return {
      lastRunId: this._lastRunId,
      totalEvents: this._lineCount,
      latestRequest: this._latestSnapshot.requests[0] || null,
      latestTool: this._latestSnapshot.tools[0] || null,
      latestSession: this._latestSnapshot.sessions[0] || null,
      requestCount: this._latestSnapshot.requests.length,
      toolCount: this._latestSnapshot.tools.length,
    };
  }

  /** 直接发一个自定义事件（暴露给外部订阅） */
  emit(type, payload) {
    const event = { type, ts: new Date().toISOString(), ...payload };
    this._latestSnapshot[type + 's'] = [event, ...(this._latestSnapshot[type + 's'] || [])].slice(
      0,
      100,
    );
    this._lineCount++;
    if (!this.enabled) {
      return;
    }
    try {
      const file = this._pickFile();
      if (!file) {
        return;
      }
      fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
      if (this._lineCount % 1000 === 0) {
        this._maybeRoll(file);
      }
    } catch (_) {
      /* 磁盘不可写时静默失败 */
    }
  }

  // ---------- 内部 ----------

  _resolveLogDir() {
    try {
      const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : null;
      const base = this.logDir || (cwd ? path.join(cwd, '.agent-logs') : null);
      return base;
    } catch (_) {
      return null;
    }
  }

  _ensureDir() {
    if (this._ensureDirCalled) {
      return;
    }
    const dir = this._resolveLogDir();
    if (!dir) {
      this.enabled = false;
      return;
    }
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (_) {
      this.enabled = false;
    }
    this._ensureDirCalled = true;
    this._currentFile = path.join(dir, `metrics-${this._dateKey()}.ndjson`);
  }

  _pickFile() {
    this._ensureDir();
    return this._currentFile;
  }

  _maybeRoll(file) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > 8 * 1024 * 1024) {
        this._currentFile = path.join(
          this._resolveLogDir(),
          `metrics-${this._dateKey()}-${Date.now()}.ndjson`,
        );
      }
    } catch (_) {}
  }

  _dateKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }
}

/** 全局单例 —— 由 agent.js / desktop-core / cli 共享。 */
export const metricsSink = new MetricsSink();
export default metricsSink;
