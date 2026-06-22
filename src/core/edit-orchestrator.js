/**
 * EditOrchestrator — 三者融合编辑闭环
 *
 * 把 LSP / Hashline / Memory 三套能力打通成一个可验证、可回滚、
 * 可长期运行的 agent substrate。
 *
 * 核心流程：
 *   LSP rename / refactor
 *   → WorkspaceEdit → Hashline Patch
 *   → Preflight (tag match / recovery)
 *   → Transactional apply (备份 → 写盘 → snapshots)
 *   → LSP sync (didChange 通知 server)
 *   → Diagnostics gate (等待新 diagnostics，检测新引入错误)
 *   → Rollback on failure / Commit on success
 *   → Memory update (记录变更、冲突、修复模式)
 *
 * 同时也统一了所有写路径：
 *   write_file → record snapshot → Hashline patch → Patcher apply
 *   edit_file → 生成内部 Hashline patch → Patcher apply
 *   lsp_workspace_edit → 转成 Hashline patch → Patcher apply
 */

import { writeFile, readFile } from 'fs/promises';
import {
  Patch, Patcher, PatchApplyError,
  InMemorySnapshotStore, DiskFilesystem,
  computeTag, hashContent,
} from './harness/hashline.js';

// ─────────────────────────────────────────────────────────────────────────────
// DiagnosticsGate — 编辑后自动检测新引入的诊断错误
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 诊断门控：编辑后等待 LSP diagnostics，检测新引入的错误。
 * 如果出现新的 blocking errors，触发回滚。
 */
export class DiagnosticsGate {
  /**
   * @param {object} opts
   * @param {import('../lsp/lsp-manager.js').ServerManager} opts.lspManager
   * @param {number} [opts.waitMs=800]      等待 diagnostics 的毫秒数
   * @param {number} [opts.maxRetries=3]    最大重试次数
   * @param {string[]} [opts.blockingSeverities]  触发回滚的 severity 列表
   */
  constructor(opts = {}) {
    this.lspManager = opts.lspManager || null;
    this.waitMs = opts.waitMs || 800;
    this.maxRetries = opts.maxRetries || 3;
    this.blockingSeverities = opts.blockingSeverities || ['error'];
  }

  /**
   * 检查编辑后是否引入了新的 blocking errors。
   *
   * @param {string[]} filePaths        被编辑的文件路径列表
   * @param {object} [baselineDiags]   编辑前的 diagnostics（可选，用于对比）
   * @returns {Promise<DiagnosticsGateResult>}
   */
  async check(filePaths, baselineDiags = null) {
    if (!this.lspManager || filePaths.length === 0) {
      return { ok: true, newErrors: [], allDiagnostics: {} };
    }

    const allDiags = {};
    const newErrors = [];

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      // 同步文档触发 diagnostics
      for (const fp of filePaths) {
        try {
          const content = await readFile(fp, 'utf-8');
          await this.lspManager.syncDocument(fp, content);
        } catch { /* skip unreadable */ }
      }

      // 等待 diagnostics 推送
      await new Promise(r => setTimeout(r, this.waitMs));

      // 收集 diagnostics
      for (const fp of filePaths) {
        const diags = this.lspManager.getDiagnostics(fp);
        allDiags[fp] = diags;

        for (const d of diags) {
          if (this.blockingSeverities.includes(severityLabel(d.severity))) {
            // 检查是否是新引入的错误
            if (!this._wasInBaseline(fp, d, baselineDiags)) {
              newErrors.push({
                file: fp,
                line: (d.range?.start?.line || 0) + 1,
                character: (d.range?.start?.character || 0) + 1,
                message: d.message,
                code: d.code || null,
                severity: severityLabel(d.severity),
              });
            }
          }
        }
      }

      // 如果本批次没有新错误，跳出重试循环
      if (attempt < this.maxRetries - 1 && newErrors.length > 0) {
        // 可能 diagnostics 还没完全到达，等待并重试
        await new Promise(r => setTimeout(r, 500));
        newErrors.length = 0; // 重置
        continue;
      }
      break;
    }

    return {
      ok: newErrors.length === 0,
      newErrors,
      allDiagnostics: allDiags,
    };
  }

  /**
   * @private 检查 diagnostics 是否在基线中存在
   */
  _wasInBaseline(filePath, diagnostic, baselineDiags) {
    if (!baselineDiags || !baselineDiags[filePath]) { return false; }
    const baseline = baselineDiags[filePath];
    return baseline.some(b =>
      b.message === diagnostic.message &&
      (b.range?.start?.line || 0) === (diagnostic.range?.start?.line || 0) &&
      (b.range?.start?.character || 0) === (diagnostic.range?.start?.character || 0)
    );
  }
}

function severityLabel(sev) {
  return { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }[sev] || 'unknown';
}

/**
 * @typedef {Object} DiagnosticsGateResult
 * @property {boolean} ok
 * @property {{file:string, line:number, character:number, message:string, code:string|null, severity:string}[]} newErrors
 * @property {object} allDiagnostics
 */

// ─────────────────────────────────────────────────────────────────────────────
// EditOrchestrator — 协调 LSP → Hashline → Diagnostics → Memory 的主入口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EditOrchestrator：统一编辑编排器。
 *
 * 用法：
 * ```js
 * const orch = new EditOrchestrator({
 *   hashlinePatcher, lspManager, memoryManager, snapshotStore, contentStore,
 *   workingDirectory,
 * });
 *
 * // 通过 Hashline patch 编辑
 * const result = await orch.editViaHashline(patchText);
 *
 * // 通过 LSP rename 编辑
 * const result = await orch.renameSymbol(filePath, position, newName);
 *
 * // 通过 LSP workspace edit 编辑
 * const result = await orch.applyWorkspaceEdit(workspaceEdit);
 *
 * // 传统 writeFile / editFile 统一走 Hashline
 * const result = await orch.writeFile(filePath, content);
 * const result = await orch.editFile(filePath, oldStr, newStr);
 * ```
 */
export class EditOrchestrator {
  /**
   * @param {object} opts
   * @param {Patcher} opts.hashlinePatcher
   * @param {import('../lsp/lsp-manager.js').ServerManager} [opts.lspManager]
   * @param {import('../memory/agent-memory.js').AgentMemory} [opts.memoryManager]
   * @param {InMemorySnapshotStore} [opts.snapshotStore]
   * @param {object} [opts.contentStore]
   * @param {string} opts.workingDirectory
   * @param {object} [opts.memoryRules]      Memory rules 配置（用于 preflight 策略）
   */
  constructor(opts = {}) {
    this.hashlinePatcher = opts.hashlinePatcher || null;
    this.lspManager = opts.lspManager || null;
    this.memoryManager = opts.memoryManager || null;
    this.snapshotStore = opts.snapshotStore || new InMemorySnapshotStore();
    this.contentStore = opts.contentStore || null;
    this.workingDirectory = opts.workingDirectory || process.cwd();
    this.memoryRules = opts.memoryRules || {};

    // 诊断门控
    this.diagGate = opts.diagGate || new DiagnosticsGate({
      lspManager: this.lspManager,
    });

    // 编辑历史（用于 memory 反馈闭环）
    this.editHistory = [];
  }

  // ── 主编辑路径：Hashline patch ────────────────────────────────────────

  /**
   * 通过 Hashline patch 编辑文件。完整流程：
   *  preflight → apply → LSP sync → diagnostics gate → memory update
   *
   * @param {string|Patch} patch
   * @param {object} [opts]
   * @param {boolean} [opts.skipDiagnostics=false]
   * @param {boolean} [opts.skipMemory=false]
   * @returns {Promise<EditOrchestratorResult>}
   */
  async editViaHashline(patch, opts = {}) {
    const result = {
      success: false,
      filesChanged: [],
      filesFailed: [],
      totalEdits: 0,
      diagnostics: null,
      memoryUpdated: false,
      conflicts: [],
      error: null,
    };

    if (!this.hashlinePatcher) {
      result.error = 'Hashline patcher not configured';
      return result;
    }

    // 检查 Memory rules：preflight 拒绝策略
    const memoryPolicy = this._getMemoryPolicy();
    const parsed = typeof patch === 'string' ? Patch.parse(patch) : patch;

    for (const section of parsed.sections) {
      // generated file 拒绝
      if (memoryPolicy.denyGeneratedFiles && this._isGeneratedPath(section.path)) {
        result.filesFailed.push(`${section.path}: blocked by rule: no edits to generated files`);
        result.conflicts.push({
          type: 'policy_deny',
          path: section.path,
          reason: 'generated_file_blocked_by_memory_rule',
          message: 'Memory rule prohibits editing generated files',
        });
        continue;
      }

      // large/binary file 拒绝
      if (memoryPolicy.maxFileSize) {
        try {
          const exists = await this.hashlinePatcher.fs.exists(section.path);
          if (exists) {
            const st = await this.hashlinePatcher.fs.stat(section.path);
            if (st.size > memoryPolicy.maxFileSize) {
              result.filesFailed.push(`${section.path}: file too large (${st.size} > ${memoryPolicy.maxFileSize})`);
              continue;
            }
          }
        } catch { /* skip stat errors */ }
      }
    }

    // 收集编辑前 diagnostics 基线
    let baselineDiags = null;
    if (!opts.skipDiagnostics && this.lspManager) {
      baselineDiags = this.lspManager.getAllDiagnostics();
    }

    // Hashline preflight + apply
    const applyResult = await this.hashlinePatcher.apply(patch);

    if (!applyResult.ok) {
      result.error = applyResult.error || 'Hashline apply failed';
      result.filesFailed = applyResult.rollbackPaths || [];
      if (applyResult.rolledBack) {
        result.rolledBack = true;
      }

      // 记录冲突到 Memory
      if (!opts.skipMemory && this.memoryManager) {
        this._recordConflictToMemory(patch, applyResult);
      }
      return result;
    }

    result.success = true;
    result.filesChanged = applyResult.sections.map(s => s.path);
    result.totalEdits = applyResult.sections.reduce((sum, s) => sum + s.hunksApplied, 0);

    // 收集 conflicts
    for (const section of applyResult.sections) {
      if (section.conflicts && section.conflicts.length > 0) {
        result.conflicts.push(...section.conflicts);
      }
    }

    // LSP sync
    if (this.lspManager) {
      for (const fp of result.filesChanged) {
        try {
          const content = await readFile(fp, 'utf-8');
          await this.lspManager.syncDocument(fp, content);
        } catch { /* sync not critical */ }
      }
    }

    // Diagnostics gate
    if (!opts.skipDiagnostics && this.lspManager && result.filesChanged.length > 0) {
      const diagResult = await this.diagGate.check(result.filesChanged, baselineDiags);
      result.diagnostics = diagResult;

      if (!diagResult.ok) {
        // 回滚
        await this._rollback(result.filesChanged, result);
        result.success = false;
        result.rolledBack = true;
        result.error = `Diagnostics gate: ${diagResult.newErrors.length} new blocking errors introduced`;
        result.newErrors = diagResult.newErrors;

        // 记录到 Memory
        if (!opts.skipMemory && this.memoryManager) {
          this._recordDiagnosticFailureToMemory(diagResult.newErrors);
        }
        return result;
      }
    }

    // Memory update
    if (!opts.skipMemory && this.memoryManager) {
      await this._recordEditToMemory(result);
      result.memoryUpdated = true;
    }

    // 记录编辑历史
    this.editHistory.push({
      timestamp: Date.now(),
      type: 'hashline_patch',
      result,
    });

    return result;
  }

  // ── LSP rename 事务 ──────────────────────────────────────────────────

  /**
   * LSP rename → WorkspaceEdit → Hashline → Diagnostics → Memory
   *
   * @param {string} filePath
   * @param {{line:number, character:number}} position  0-based
   * @param {string} newName
   * @param {string} [content]  文件内容
   * @returns {Promise<EditOrchestratorResult>}
   */
  async renameSymbol(filePath, position, newName, content = null) {
    const result = {
      success: false,
      filesChanged: [],
      filesFailed: [],
      totalEdits: 0,
      diagnostics: null,
      memoryUpdated: false,
      conflicts: [],
      error: null,
    };

    if (!this.lspManager) {
      result.error = 'LSP manager not configured';
      return result;
    }

    // 收集编辑前 diagnostics 基线
    const baselineDiags = this.lspManager.getAllDiagnostics();

    // 读取文件内容
    let fileContent = content;
    if (!fileContent) {
      try {
        fileContent = await readFile(filePath, 'utf-8');
      } catch (err) {
        result.error = `Failed to read ${filePath}: ${err.message}`;
        return result;
      }
    }

    // 1) prepareRename
    let prepareResult;
    try {
      prepareResult = await this.lspManager.request(
        'textDocument/prepareRename', filePath,
        {}, position, fileContent, 15000,
      );
    } catch (err) {
      result.error = `prepareRename failed: ${err.message}`;
      return result;
    }

    if (!prepareResult) {
      result.error = 'Rename not available at this location';
      return result;
    }

    // 2) rename → workspace edit
    let workspaceEdit;
    try {
      workspaceEdit = await this.lspManager.request(
        'textDocument/rename', filePath,
        { newName }, position, fileContent, 30000,
      );
    } catch (err) {
      result.error = `Rename failed: ${err.message}`;
      return result;
    }

    if (!workspaceEdit || !workspaceEdit.changes) {
      result.error = 'Rename returned no changes';
      return result;
    }

    // 3) WorkspaceEdit → Hashline patch
    const editResult = await this._applyWorkspaceEditViaHashline(workspaceEdit, baselineDiags);

    // 4) 成功上报 Memory
    if (editResult.success && this.memoryManager) {
      await this._recordRenameToMemory(filePath, newName, editResult);
      editResult.memoryUpdated = true;
    }

    // 5) Barrel / alias 同步 — 接 Memory rules
    if (editResult.success && this.memoryManager) {
      const barrelsRule = this._getMemoryRule('barrel_auto_sync');
      if (barrelsRule !== false) {
        try {
          const { syncBarrelAndAliasImports } = await import('../lsp/lsp-tools.js');
          const syncResult = await syncBarrelAndAliasImports({
            renamedFile: filePath,
            oldName: prepareResult.placeholder || '',
            newName,
            workingDirectory: this.workingDirectory,
            lspManager: this.lspManager,
          });
          if (syncResult?.synced?.length > 0) {
            editResult.barrelSyncs = syncResult.synced;
          }
        } catch { /* barrel sync is best-effort */ }
      }
    }

    this.editHistory.push({
      timestamp: Date.now(),
      type: 'lsp_rename',
      filePath, newName,
      result: editResult,
    });

    return editResult;
  }

  // ── 统一写路径：writeFile ─────────────────────────────────────────────

  /**
   * 统一 writeFile：走 Hashline 事务路径。
   * 自动计算 tag，生成 SWAP patch 覆盖整个文件。
   */
  async writeFile(filePath, content) {
    const result = {
      success: false,
      filesChanged: [],
      filesFailed: [],
      totalEdits: 0,
      diagnostics: null,
      memoryUpdated: false,
      conflicts: [],
      error: null,
    };

    // 检查文件是否存在
    let exists = false;
    let originalContent = '';
    try {
      if (this.hashlinePatcher && this.hashlinePatcher.fs) {
        exists = await this.hashlinePatcher.fs.exists(filePath);
        if (exists) {
          originalContent = await this.hashlinePatcher.fs.read(filePath);
        }
      } else {
        try {
          originalContent = await readFile(filePath, 'utf-8');
          exists = true;
        } catch { exists = false; }
      }
    } catch { /* ignore */ }

    // 收集基线 diagnostics
    const baselineDiags = this.lspManager?.getAllDiagnostics?.() || null;

    if (!exists) {
      // 新文件：直接写 + record snapshot
      try {
        if (this.hashlinePatcher && this.hashlinePatcher.fs) {
          await this.hashlinePatcher.fs.write(filePath, content);
        } else {
          await writeFile(filePath, content, 'utf-8');
        }
        this.snapshotStore.record(filePath, content);
        if (this.contentStore) {
          this.contentStore.setRef(`file:${filePath}`, this.contentStore.storeBlob(content));
        }
        if (this.lspManager) {
          await this.lspManager.syncDocument(filePath, content).catch(() => {});
        }

        result.success = true;
        result.filesChanged = [filePath];
        result.totalEdits = 1;

        // Diagnostics gate
        if (baselineDiags) {
          const diagResult = await this.diagGate.check([filePath], baselineDiags);
          result.diagnostics = diagResult;
          if (!diagResult.ok) {
            result.diagnosticsWarning = `${diagResult.newErrors.length} new errors detected`;
          }
        }
      } catch (err) {
        result.error = `writeFile failed: ${err.message}`;
        result.filesFailed = [filePath];
      }
      return result;
    }

    // 已存在文件：生成 SWAP patch（替换全部内容）
    const normalizedOrig = originalContent.replace(/\r\n/g, '\n');
    const tag = computeTag(normalizedOrig);
    const lines = content.split('\n');
    const totalLines = normalizedOrig.split('\n').length;

    // 生成 Hashline patch
    const patchLines = [
      `[${filePath}#${tag}]`,
    ];
    if (totalLines === 0 && lines.length === 1) {
      // 空文件 → 追加内容
      patchLines.push(`INS.POST 0=`);
      for (const l of lines) patchLines.push(`+${l}`);
    } else if (totalLines === 0) {
      patchLines.push(`INS.POST 0=`);
      for (const l of lines) patchLines.push(`+${l}`);
    } else {
      patchLines.push(`SWAP 1.=${Math.max(1, totalLines)}:`);
      for (const l of lines) patchLines.push(`+${l}`);
    }
    const patchText = patchLines.join('\n');

    return this.editViaHashline(patchText);
  }

  // ── 统一写路径：editFile（old_str → new_str） ────────────────────────

  /**
   * 统一 editFile：生成内部 Hashline patch，走事务路径。
   * 类似传统 replace_in_file，但内部走 Hashline 保证安全性。
   */
  async editFile(filePath, oldStr, newStr) {
    const result = {
      success: false,
      filesChanged: [],
      filesFailed: [],
      totalEdits: 0,
      diagnostics: null,
      memoryUpdated: false,
      conflicts: [],
      error: null,
    };

    // 读取文件
    let content;
    try {
      if (this.hashlinePatcher && this.hashlinePatcher.fs) {
        content = await this.hashlinePatcher.fs.read(filePath);
      } else {
        content = await readFile(filePath, 'utf-8');
      }
    } catch (err) {
      result.error = `Failed to read ${filePath}: ${err.message}`;
      return result;
    }

    // 查找 oldStr 在文件中的位置
    const normalized = content.replace(/\r\n/g, '\n');
    const normalizedOld = oldStr.replace(/\r\n/g, '\n');
    const normalizedNew = newStr.replace(/\r\n/g, '\n');

    const idx = normalized.indexOf(normalizedOld);
    if (idx === -1) {
      result.error = `old_str not found in ${filePath}`;
      return result;
    }

    // 计算行号范围
    const beforeMatch = normalized.substring(0, idx);
    const beforeLines = beforeMatch.split('\n');
    const startLine = beforeLines.length;
    const matchLines = normalizedOld.split('\n');
    const endLine = startLine + matchLines.length - 1;

    // 构建 Hashline patch
    const tag = computeTag(normalized);
    const newLines = normalizedNew.split('\n');
    const patchLines = [
      `[${filePath}#${tag}]`,
    ];

    if (newLines.length === 1 && newLines[0] === '') {
      // 纯删除
      patchLines.push(`DEL ${startLine}.=${endLine}`);
    } else {
      patchLines.push(`SWAP ${startLine}.=${endLine}:`);
      for (const l of newLines) {
        patchLines.push(`+${l}`);
      }
    }

    const patchText = patchLines.join('\n');
    return this.editViaHashline(patchText);
  }

  // ── LSP WorkspaceEdit 路径 ─────────────────────────────────────────────

  /**
   * 应用 LSP workspace edit，经过完整 Hashline → diagnostics → memory 流程。
   */
  async applyWorkspaceEdit(workspaceEdit) {
    const baselineDiags = this.lspManager?.getAllDiagnostics?.() || null;
    return this._applyWorkspaceEditViaHashline(workspaceEdit, baselineDiags);
  }

  /**
   * @private WorkspaceEdit → Hashline（内部实现）
   */
  async _applyWorkspaceEditViaHashline(workspaceEdit, baselineDiags) {
    const editsByPath = {};

    // 收集 edits
    const collectEdits = (uri, edits) => {
      const fp = uri.startsWith('file://') ? uri.slice(7) : uri;
      if (!editsByPath[fp]) {
        editsByPath[fp] = { edits: [], originalContent: null };
      }
      editsByPath[fp].edits.push(...edits);
    };

    const changes = workspaceEdit.changes || {};
    for (const [uri, edits] of Object.entries(changes)) {
      if (edits.length > 0) collectEdits(uri, edits);
    }

    if (workspaceEdit.documentChanges) {
      for (const dc of workspaceEdit.documentChanges) {
        if (dc.textDocument && dc.edits) {
          collectEdits(dc.textDocument.uri, dc.edits);
        }
      }
    }

    if (Object.keys(editsByPath).length === 0) {
      return { success: false, error: 'No edits to apply', filesChanged: [], filesFailed: [], totalEdits: 0 };
    }

    // 读取原始内容 + 构建 Hashline patch
    const patchSections = [];
    for (const [fp, { edits }] of Object.entries(editsByPath)) {
      try {
        const originalContent = await readFile(fp, 'utf-8');
        editsByPath[fp].originalContent = originalContent;

        const normalized = originalContent.replace(/\r\n/g, '\n').replace(/\n$/, '');
        const tag = computeTag(normalized);
        const section = this._editsToHashlineSection(fp, tag, normalized, edits);
        patchSections.push(section);
      } catch (err) {
        return {
          success: false,
          error: `Failed to read ${fp}: ${err.message}`,
          filesChanged: [], filesFailed: [fp], totalEdits: 0,
        };
      }
    }

    const patchText = patchSections.join('\n');
    return this.editViaHashline(patchText, {
      skipDiagnostics: !baselineDiags,
    });
  }

  /**
   * @private LSP TextEdit → Hashline section
   */
  _editsToHashlineSection(filePath, tag, content, edits) {
    const lines = [`[${filePath}#${tag}]`];
    const sortedEdits = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) {
        return b.range.start.line - a.range.start.line;
      }
      return b.range.start.character - a.range.start.character;
    });

    let currentContent = content;
    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line + 1;
      const endLine = edit.range.end.line + 1;
      const startChar = edit.range.start.character;
      const endChar = edit.range.end.character;

      const contentLines = currentContent.split('\n');
      const startLineContent = contentLines[startLine - 1] || '';

      if (startLine === endLine) {
        const oldText = startLineContent.substring(startChar, endChar);
        const newText = edit.newText || '';
        if (oldText === '' && newText !== '') {
          lines.push(`INS.PRE ${startLine}=`);
          for (const nl of newText.split('\n')) lines.push(`+${nl}`);
        } else if (newText === '' && oldText !== '') {
          const before = startLineContent.substring(0, startChar);
          const after = startLineContent.substring(endChar);
          if (before === '' && after === '') {
            lines.push(`DEL ${startLine}.=${startLine}`);
          } else {
            lines.push(`SWAP ${startLine}.=${startLine}:`);
            const replacement = before + after;
            if (replacement !== '') lines.push(`+${replacement}`);
          }
        } else {
          lines.push(`SWAP ${startLine}.=${startLine}:`);
          for (const nl of newText.split('\n')) lines.push(`+${nl}`);
        }
      } else {
        lines.push(`SWAP ${startLine}.=${endLine}:`);
        for (const nl of edit.newText.split('\n')) lines.push(`+${nl}`);
      }

      currentContent = this._applyTextEdits(currentContent, [edit]);
    }

    return lines.join('\n');
  }

  _applyTextEdits(text, edits) {
    const sorted = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
      return b.range.start.character - a.range.start.character;
    });
    let result = text;
    for (const edit of sorted) {
      const lines = result.split('\n');
      let startOffset = 0;
      for (let i = 0; i < edit.range.start.line; i++) startOffset += lines[i].length + 1;
      startOffset += edit.range.start.character;
      let endOffset = 0;
      for (let i = 0; i < edit.range.end.line; i++) endOffset += lines[i].length + 1;
      endOffset += edit.range.end.character;
      result = result.substring(0, startOffset) + (edit.newText || '') + result.substring(endOffset);
    }
    return result;
  }

  // ── 回滚 ───────────────────────────────────────────────────────────────

  async _rollback(filePaths, partialResult) {
    for (const fp of filePaths) {
      try {
        const snapshot = this.snapshotStore.head(fp);
        if (snapshot && snapshot.text !== undefined) {
          if (this.hashlinePatcher && this.hashlinePatcher.fs) {
            await this.hashlinePatcher.fs.write(fp, snapshot.text);
          } else {
            await writeFile(fp, snapshot.text, 'utf-8');
          }
          if (this.lspManager) {
            await this.lspManager.syncDocument(fp, snapshot.text).catch(() => {});
          }
        }
      } catch (err) {
        partialResult.rollbackErrors = partialResult.rollbackErrors || [];
        partialResult.rollbackErrors.push(`${fp}: ${err.message}`);
      }
    }
  }

  // ── Memory 集成 ────────────────────────────────────────────────────────

  /** @private 从项目 rules 中获取编辑策略 */
  _getMemoryPolicy() {
    const policy = {
      denyGeneratedFiles: false,
      maxFileSize: null,
      deniedPaths: [],
    };

    if (this.memoryManager) {
      try {
        const rulesCtx = this.memoryManager.getRulesContext?.() || '';
        if (rulesCtx.includes('禁止直接编辑 generated files') ||
            rulesCtx.includes('do not edit generated files')) {
          policy.denyGeneratedFiles = true;
        }
      } catch { /* no rules */ }
    }

    return policy;
  }

  /** @private 从 Memory rules 中获取特定规则 */
  _getMemoryRule(ruleName) {
    if (!this.memoryManager) { return null; }
    try {
      const rulesCtx = this.memoryManager.getRulesContext?.() || '';
      // 简单的规则匹配
      if (ruleName === 'barrel_auto_sync') {
        if (rulesCtx.includes('更新 barrel') || rulesCtx.includes('update barrel') ||
            rulesCtx.includes('sync barrel')) {
          return true;
        }
        return true; // 默认启用
      }
    } catch { /* ignore */ }
    return null;
  }

  _isGeneratedPath(path) {
    const generatedPatterns = [
      /\.d\.ts$/, /\.generated\./, /-generated\./,
      /\/generated\//, /\/dist\//, /\/build\//, /\/\.next\//,
      /\/coverage\//, /\/node_modules\//,
    ];
    return generatedPatterns.some(p => p.test(path));
  }

  /** @private */
  async _recordEditToMemory(result) {
    if (!this.memoryManager) { return; }
    try {
      if (result.filesChanged.length > 0) {
        const summary = `Edited ${result.filesChanged.length} file(s): ${result.filesChanged.join(', ')}`;
        if (typeof this.memoryManager.addEpisodic === 'function') {
          this.memoryManager.addEpisodic(summary, {
            type: 'hashline_edit',
            files: result.filesChanged,
            timestamp: Date.now(),
          });
        }
      }
    } catch { /* best-effort */ }
  }

  /** @private */
  async _recordRenameToMemory(filePath, newName, result) {
    if (!this.memoryManager) { return; }
    try {
      const summary = `LSP rename: ${filePath} → ${newName}, ${result.filesChanged.length} files changed`;
      if (typeof this.memoryManager.addEpisodic === 'function') {
        this.memoryManager.addEpisodic(summary, {
          type: 'lsp_rename',
          filePath, newName,
          filesChanged: result.filesChanged,
          timestamp: Date.now(),
        });
      }
    } catch { /* best-effort */ }
  }

  /** @private */
  _recordConflictToMemory(patch, applyResult) {
    if (!this.memoryManager) { return; }
    try {
      const conflicts = this.hashlinePatcher?.getLastConflicts?.() || [];
      if (conflicts.length > 0) {
        const summary = `Hashline conflict: ${conflicts.length} conflicts during apply`;
        if (typeof this.memoryManager.addEpisodic === 'function') {
          this.memoryManager.addEpisodic(summary, {
            type: 'hashline_conflict',
            conflicts,
            timestamp: Date.now(),
          });
        }
      }
    } catch { /* best-effort */ }
  }

  /** @private */
  _recordDiagnosticFailureToMemory(newErrors) {
    if (!this.memoryManager) { return; }
    try {
      const diagPatterns = {};
      for (const e of newErrors) {
        const key = e.code || e.message.substring(0, 40);
        diagPatterns[key] = (diagPatterns[key] || 0) + 1;
      }
      const summary = `Diagnostics gate blocked: ${newErrors.length} new errors`;
      if (typeof this.memoryManager.addEpisodic === 'function') {
        this.memoryManager.addEpisodic(summary, {
          type: 'diagnostics_gate_block',
          errors: newErrors,
          patterns: diagPatterns,
          timestamp: Date.now(),
        });
      }
    } catch { /* best-effort */ }
  }

  // ── 公共 API：获取编辑统计 ──────────────────────────────────────────

  getStats() {
    return {
      totalEdits: this.editHistory.length,
      recentEdits: this.editHistory.slice(-10),
      snapshotStats: this.snapshotStore.stats(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 工厂函数
// ─────────────────────────────────────────────────────────────────────────────

export function createEditOrchestrator(opts = {}) {
  let patcher = opts.hashlinePatcher;
  if (!patcher && opts.workingDirectory) {
    const fs = new DiskFilesystem(opts.workingDirectory);
    const snapshots = opts.snapshotStore || new InMemorySnapshotStore();
    patcher = new Patcher({
      fs,
      snapshots,
      autoRecord: true,
      allowRecovery: true,
      bridge: opts.bridge || null,
    });
  }
  return new EditOrchestrator({
    hashlinePatcher: patcher,
    lspManager: opts.lspManager || null,
    memoryManager: opts.memoryManager || null,
    snapshotStore: opts.snapshotStore || new InMemorySnapshotStore(),
    contentStore: opts.contentStore || null,
    workingDirectory: opts.workingDirectory || process.cwd(),
    memoryRules: opts.memoryRules || {},
  });
}

export default EditOrchestrator;

/**
 * @typedef {Object} EditOrchestratorResult
 * @property {boolean} success
 * @property {string[]} filesChanged
 * @property {string[]} filesFailed
 * @property {number} totalEdits
 * @property {DiagnosticsGateResult|null} diagnostics
 * @property {boolean} memoryUpdated
 * @property {object[]} conflicts
 * @property {string|null} error
 * @property {boolean} [rolledBack]
 * @property {string[]} [rollbackPaths]
 * @property {object[]} [newErrors]
 * @property {string[]} [barrelSyncs]
 * @property {string} [diagnosticsWarning]
 * @property {string[]} [rollbackErrors]
 */
