/**
 * DiagnosticsGate — 独立诊断门控模块（带 codeAction 自动修复）
 *
 * 对标文档 P4 要求：
 *   写后自动 detect new errors → codeAction repair → rollback if failed
 *   每次 edit/refactor 后的强制 gate
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// DiagnosticsGate
// ─────────────────────────────────────────────────────────────────────────────

export class DiagnosticsGate {
  /**
   * @param {object} opts
   * @param {object} opts.lspManager      ServerManager 实例
   * @param {object} [opts.hashlinePatcher]  Patcher 实例（用于回滚）
   * @param {object} [opts.snapshotStore]    快照存储（用于比较前后文件内容）
   * @param {number} [opts.waitMs=800]       等待 diagnostics 的毫秒数
   * @param {number} [opts.maxRetries=3]     最大重试次数
   * @param {string[]} [opts.blockingSeverities]  触发回滚的 severity
   * @param {boolean} [opts.autoRepair=true]  是否自动尝试 codeAction 修复
   * @param {number} [opts.repairTimeout=15000] codeAction 超时（ms）
   */
  constructor(opts = {}) {
    this.lspManager = opts.lspManager || null;
    this.hashlinePatcher = opts.hashlinePatcher || null;
    this.snapshotStore = opts.snapshotStore || null;
    this.waitMs = opts.waitMs || 800;
    this.maxRetries = opts.maxRetries || 3;
    this.blockingSeverities = opts.blockingSeverities || ['error'];
    this.autoRepair = opts.autoRepair !== false;
    this.repairTimeout = opts.repairTimeout || 15000;
    this.workingDirectory = opts.workingDirectory || process.cwd();
  }

  // ── 核心方法：编辑后诊断检查（带自动修复） ──────────────────────────

  /**
   * 执行完整的诊断门控流程：
   *   1. 收集编辑前的基线 diagnostics（如果提供）
   *   2. 同步文档到 LSP server
   *   3. 等待新 diagnostics 到达
   *   4. compare before/after → detect new errors
   *   5. 如果有新错误 → auto codeAction repair（如启用）
   *   6. 修复后再 check → 仍有 blocking errors → rollback
   *
   * @param {string[]} filePaths               被编辑的文件路径列表
   * @param {object} [baselineDiags]           编辑前的 diagnostics baseline
   * @param {object} [snapshotData]            编辑前的文件快照（用于 rollback）
   * @returns {Promise<DiagnosticsGateResult>}
   */
  async gate(filePaths, baselineDiags = null, snapshotData = null) {
    const result = {
      ok: true,
      newErrors: [],
      allDiagnostics: {},
      repaired: [],
      repairFailed: [],
      rolledBack: false,
      rollbackReason: null,
    };

    if (!this.lspManager || filePaths.length === 0) {
      return result;
    }

    // Step 1-3: 收集 diagnostics
    const diagResult = await this._collectDiagnostics(filePaths, baselineDiags);
    result.allDiagnostics = diagResult.allDiagnostics;
    result.newErrors = diagResult.newErrors;

    // 没有新错误 → 通过
    if (diagResult.newErrors.length === 0) {
      return result;
    }

    // Step 4: 有新的 blocking errors → 尝试自动修复
    if (this.autoRepair) {
      const repairResult = await this._attemptCodeActionRepair(diagResult.newErrors, filePaths);
      result.repaired = repairResult.repaired;
      result.repairFailed = repairResult.failed;

      // 修复后重新检查
      if (repairResult.repaired.length > 0) {
        const recheck = await this._collectDiagnostics(filePaths, baselineDiags);
        result.allDiagnostics = recheck.allDiagnostics;
        result.newErrors = recheck.newErrors;
      }
    }

    // Step 5: 仍有 blocking errors → rollback
    if (result.newErrors.length > 0 && snapshotData) {
      const rolledBack = await this._rollback(snapshotData, filePaths);
      result.rolledBack = rolledBack;
      result.ok = false;
      result.rollbackReason = `New blocking errors remain after repair: ${result.newErrors.map((e) => `${e.file}:${e.line} ${e.message}`).join('; ')}`;
    } else if (result.newErrors.length > 0) {
      result.ok = false;
    }

    return result;
  }

  /**
   * 简单版 check（只检测不修复不回滚）。
   * @param {string[]} filePaths
   * @param {object} [baselineDiags]
   * @returns {Promise<{ok: boolean, newErrors: object[], allDiagnostics: object}>}
   */
  async check(filePaths, baselineDiags = null) {
    return this._collectDiagnostics(filePaths, baselineDiags);
  }

  /**
   * 尝试用 codeAction 修复 detected errors。
   * @param {object[]} errors
   * @param {string[]} filePaths
   * @returns {Promise<{repaired: object[], failed: object[]}>}
   */
  async repair(errors, filePaths) {
    return this._attemptCodeActionRepair(errors, filePaths);
  }

  // ── 私有方法 ───────────────────────────────────────────────────────

  async _collectDiagnostics(filePaths, baselineDiags) {
    const allDiags = {};
    const newErrors = [];

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      // 同步文档触发 diagnostics
      for (const fp of filePaths) {
        try {
          const content = await readFile(fp, 'utf-8');
          if (this.lspManager?.syncDocument) {
            await this.lspManager.syncDocument(fp, content);
          }
        } catch {
          /* skip unreadable */
        }
      }

      // 等待 diagnostics 推送
      await new Promise((r) => setTimeout(r, this.waitMs));

      // 收集 diagnostics
      for (const fp of filePaths) {
        let diags = [];
        if (this.lspManager?.getDiagnostics) {
          diags = this.lspManager.getDiagnostics(fp);
        } else if (this.lspManager?.diagnosticsCache) {
          diags = this.lspManager.diagnosticsCache.get(fp) || [];
        }
        allDiags[fp] = diags;

        for (const d of diags) {
          const sev = this._severityLabel(d.severity);
          if (this.blockingSeverities.includes(sev)) {
            if (!this._wasInBaseline(fp, d, baselineDiags)) {
              newErrors.push({
                file: fp,
                line: (d.range?.start?.line || 0) + 1,
                character: (d.range?.start?.character || 0) + 1,
                message: d.message,
                code: d.code || null,
                severity: sev,
                source: d.source || null,
                diagnostic: d, // 保留原始对象用于 codeAction
              });
            }
          }
        }
      }

      // 如果本批次没有新错误或已达最大重试，跳出
      if (attempt >= this.maxRetries - 1 || newErrors.length === 0) {
        break;
      }

      // 可能 diagnostics 还没完全到达，等待并重试
      await new Promise((r) => setTimeout(r, 500));
      newErrors.length = 0;
    }

    return { ok: newErrors.length === 0, newErrors, allDiagnostics: allDiags };
  }

  async _attemptCodeActionRepair(errors, filePaths) {
    const repaired = [];
    const failed = [];

    if (!this.lspManager || !this.lspManager.request) {
      return {
        repaired: [],
        failed: errors.map((e) => ({ ...e, reason: 'No LSP manager for repair' })),
      };
    }

    for (const error of errors) {
      try {
        const fileDir = existsSync(error.file) ? dirname(error.file) : this.workingDirectory;
        const codeActions = await this.lspManager.request(
          'textDocument/codeAction',
          fileDir,
          {
            textDocument: { uri: this._fileUri(error.file) },
            range: {
              start: { line: error.line - 1, character: Math.max(0, error.character - 1) },
              end: { line: error.line - 1, character: error.character + 1 },
            },
            context: { diagnostics: [error.diagnostic] },
          },
          null,
          null,
          this.repairTimeout,
        );

        if (Array.isArray(codeActions) && codeActions.length > 0) {
          // 优先使用 "quickfix" 类型的 action
          const quickfix = codeActions.find((a) => a.kind?.includes('quickfix')) || codeActions[0];

          // 如果 action 需要 resolve
          let resolvedAction = quickfix;
          if (!quickfix.edit && this.lspManager.request) {
            try {
              resolvedAction = await this.lspManager.request(
                'codeAction/resolve',
                fileDir,
                quickfix,
                null,
                null,
                this.repairTimeout,
              );
            } catch {
              /* keep original */
            }
          }

          if (resolvedAction?.edit) {
            // 应用 workspace edit
            if (this.lspManager.applyWorkspaceEdit) {
              const applyResult = await this.lspManager.applyWorkspaceEdit(resolvedAction.edit);
              if (applyResult?.applied) {
                repaired.push({
                  file: error.file,
                  line: error.line,
                  oldError: error.message,
                  codeAction: resolvedAction.title || quickfix.title || 'unknown',
                  applied: true,
                });
                continue;
              }
            }
          }
        }

        failed.push({ ...error, reason: 'No applicable codeAction found or repair failed' });
      } catch (err) {
        failed.push({ ...error, reason: err.message });
      }
    }

    return { repaired, failed };
  }

  async _rollback(snapshotData, filePaths) {
    if (!snapshotData) {
      return false;
    }

    try {
      // 如果有 hashline patcher，使用它的 rollback
      if (this.hashlinePatcher && this.hashlinePatcher.rollbackAll) {
        await this.hashlinePatcher.rollbackAll(snapshotData.transactionId || 'last');
        return true;
      }

      // 否则用快照数据直接恢复
      if (snapshotData.files) {
        for (const [fp, content] of Object.entries(snapshotData.files)) {
          if (filePaths.includes(fp)) {
            const { writeFile } = await import('fs/promises');
            await writeFile(fp, content, 'utf-8');
          }
        }
        return true;
      }

      return false;
    } catch (err) {
      return false;
    }
  }

  _wasInBaseline(filePath, diagnostic, baselineDiags) {
    if (!baselineDiags || !baselineDiags[filePath]) {
      return false;
    }
    const baseline = baselineDiags[filePath];
    return baseline.some(
      (b) =>
        b.message === diagnostic.message &&
        (b.range?.start?.line || 0) === (diagnostic.range?.start?.line || 0) &&
        (b.range?.start?.character || 0) === (diagnostic.range?.start?.character || 0),
    );
  }

  _fileUri(filePath) {
    return `file://${filePath.replace(/\\/g, '/')}`;
  }

  _severityLabel(sev) {
    return { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }[sev] || 'unknown';
  }
}

/**
 * @typedef {Object} DiagnosticsGateResult
 * @property {boolean} ok
 * @property {{file:string, line:number, character:number, message:string, code:string|null, severity:string}[]} newErrors
 * @property {object} allDiagnostics
 * @property {{file:string, line:number, oldError:string, codeAction:string, applied:boolean}[]} repaired
 * @property {{file:string, line:number, reason:string}[]} repairFailed
 * @property {boolean} rolledBack
 * @property {string|null} rollbackReason
 */
