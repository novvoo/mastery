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
import { DiagnosticsGate } from './diagnostics-gate.js';

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

    // 诊断门控（默认启用 autoRepair）
    this.diagGate = opts.diagGate || new DiagnosticsGate({
      lspManager: this.lspManager,
      hashlinePatcher: this.hashlinePatcher,
      snapshotStore: this.snapshotStore,
      workingDirectory: this.workingDirectory,
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

    // Diagnostics gate — 默认强制，带 autoRepair
    if (!opts.skipDiagnostics && this.lspManager && result.filesChanged.length > 0) {
      // 构建 snapshot data 用于 rollback
      const snapshotData = { files: {} };
      for (const fp of result.filesChanged) {
        try {
          const snap = this.snapshotStore.head(fp);
          if (snap?.text) {snapshotData.files[fp] = snap.text;}
        } catch { /* skip */ }
      }

      const diagResult = await this.diagGate.gate(result.filesChanged, baselineDiags, snapshotData);
      result.diagnostics = diagResult;

      // 记录自动修复
      if (diagResult.repaired?.length > 0) {
        result.repaired = diagResult.repaired;
        result.diagnosticsWarning = `Auto-repaired ${diagResult.repaired.length} error(s) via codeAction`;
      }

      if (!diagResult.ok) {
        // gate 内部已尝试回滚，这里标记状态
        result.success = false;
        if (diagResult.rolledBack) {
          result.rolledBack = true;
          result.error = `Diagnostics gate: rollback after ${diagResult.newErrors.length} new errors (repair failed: ${diagResult.repairFailed?.length || 0})`;
        } else {
          result.error = `Diagnostics gate: ${diagResult.newErrors.length} new blocking errors (no snapshot for rollback)`;
        }
        result.newErrors = diagResult.newErrors;

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
      for (const l of lines) {patchLines.push(`+${l}`);}
    } else if (totalLines === 0) {
      patchLines.push(`INS.POST 0=`);
      for (const l of lines) {patchLines.push(`+${l}`);}
    } else {
      patchLines.push(`SWAP 1.=${Math.max(1, totalLines)}:`);
      for (const l of lines) {patchLines.push(`+${l}`);}
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
   * 支持 documentChanges（create/delete/rename）和 text edits。
   */
  async _applyWorkspaceEditViaHashline(workspaceEdit, baselineDiags) {
    const editsByPath = {};
    const documentOps = []; // create/delete/rename operations

    // 收集 edits + document changes
    const collectEdits = (uri, edits) => {
      const fp = uri.startsWith('file://') ? uri.slice(7) : uri;
      if (!editsByPath[fp]) {
        editsByPath[fp] = { edits: [], originalContent: null };
      }
      editsByPath[fp].edits.push(...edits);
    };

    const changes = workspaceEdit.changes || {};
    for (const [uri, edits] of Object.entries(changes)) {
      if (edits.length > 0) {collectEdits(uri, edits);}
    }

    if (workspaceEdit.documentChanges) {
      for (const dc of workspaceEdit.documentChanges) {
        if (dc.kind === 'create' && dc.uri) {
          const fp = (dc.uri.startsWith('file://') ? dc.uri.slice(7) : dc.uri);
          documentOps.push({ kind: 'create', path: fp, options: dc.options || {} });
        } else if (dc.kind === 'delete' && dc.uri) {
          const fp = (dc.uri.startsWith('file://') ? dc.uri.slice(7) : dc.uri);
          documentOps.push({ kind: 'delete', path: fp, options: dc.options || {} });
        } else if (dc.kind === 'rename' && dc.oldUri && dc.newUri) {
          const oldFp = (dc.oldUri.startsWith('file://') ? dc.oldUri.slice(7) : dc.oldUri);
          const newFp = (dc.newUri.startsWith('file://') ? dc.newUri.slice(7) : dc.newUri);
          documentOps.push({ kind: 'rename', oldPath: oldFp, newPath: newFp, options: dc.options || {} });
        } else if (dc.textDocument && dc.edits) {
          collectEdits(dc.textDocument.uri, dc.edits);
        }
      }
    }

    // 处理 documentOps（create/delete/rename）
    let docOpResults = { success: true, paths: [] };
    if (documentOps.length > 0) {
      docOpResults = await this._applyDocumentOps(documentOps);
    }

    if (Object.keys(editsByPath).length === 0) {
      if (docOpResults.success) {
        return {
          success: true,
          filesChanged: docOpResults.paths,
          filesFailed: [],
          totalEdits: documentOps.length,
        };
      }
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
        // 检测重叠并合并同位置编辑
        const mergedEdits = this._mergeOverlappingEdits(edits);
        const section = this._editsToHashlineSection(fp, tag, normalized, mergedEdits);
        patchSections.push(section);
      } catch (err) {
        return {
          success: false,
          error: `Failed to read ${fp}: ${err.message}`,
          filesChanged: docOpResults.paths, filesFailed: [fp], totalEdits: 0,
        };
      }
    }

    const patchText = patchSections.join('\n');
    const result = await this.editViaHashline(patchText, {
      skipDiagnostics: !baselineDiags,
    });

    // 合并 documentOps 结果
    if (result.success && docOpResults.success) {
      result.filesChanged = [...new Set([...result.filesChanged, ...docOpResults.paths])];
    }
    return result;
  }

  /**
   * @private 应用 document operations（create/delete/rename）
   */
  async _applyDocumentOps(ops) {
    const paths = [];
    for (const op of ops) {
      try {
        switch (op.kind) {
          case 'create': {
            const dir = op.path.substring(0, op.path.lastIndexOf('/'));
            if (dir) {
              const { mkdir } = await import('fs/promises');
              await mkdir(dir, { recursive: true });
            }
            if (op.options?.overwrite === false) {
              try { await import('fs').then(fs => fs.existsSync(op.path)); }
              catch { /* doesn't exist, proceed */ }
            }
            if (this.hashlinePatcher?.fs) {
              await this.hashlinePatcher.fs.write(op.path, '');
            } else {
              await writeFile(op.path, '', 'utf-8');
            }
            paths.push(op.path);
            break;
          }
          case 'delete': {
            if (this.hashlinePatcher?.fs?.delete) {
              await this.hashlinePatcher.fs.delete(op.path);
            } else {
              const { unlink } = await import('fs/promises');
              await unlink(op.path);
            }
            paths.push(op.path);
            break;
          }
          case 'rename': {
            if (this.hashlinePatcher?.fs?.rename) {
              await this.hashlinePatcher.fs.rename(op.oldPath, op.newPath);
            } else {
              const { rename: fsRename } = await import('fs/promises');
              await fsRename(op.oldPath, op.newPath);
            }
            paths.push(op.newPath);
            break;
          }
        }
      } catch (err) {
        // best-effort: continue with other ops
      }
    }
    return { success: paths.length > 0, paths };
  }

  /**
   * @private 检测并合并重叠的 TextEdit。
   * 多个 edit 可能修改同一行或重叠范围，合并它们避免二次应用时的冲突。
   */
  _mergeOverlappingEdits(edits) {
    if (edits.length <= 1) {return edits;}

    // 按位置降序排序
    const sorted = [...edits].sort((a, b) => {
      const aPos = a.range.start.line * 100000 + a.range.start.character;
      const bPos = b.range.start.line * 100000 + b.range.start.character;
      return bPos - aPos;
    });

    const merged = [];
    for (const edit of sorted) {
      // 检查是否与已合并的 edit 重叠
      let overlapping = false;
      for (const m of merged) {
        if (this._rangesOverlap(edit.range, m.range)) {
          overlapping = true;
          break;
        }
      }
      if (!overlapping) {
        merged.push(edit);
      }
      // 重叠的 edit 跳过：因为按降序处理，先处理靠后的 edit，
      // 重叠的后续 edit 基于未修改的内容计算位置，已经失效。
    }
    // 恢复升序
    return merged.reverse();
  }

  /**
   * @private 检查两个 range 是否重叠
   */
  _rangesOverlap(a, b) {
    const aStart = a.start.line * 100000 + a.start.character;
    const aEnd = a.end.line * 100000 + a.end.character;
    const bStart = b.start.line * 100000 + b.start.character;
    const bEnd = b.end.line * 100000 + b.end.character;
    return !(aEnd <= bStart || bEnd <= aStart);
  }

  /**
   * @private LSP TextEdit → Hashline section（增强版）
   * 处理：多行编辑、同位置插入、换行边界、空文本
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
      const newText = edit.newText || '';

      // 单行编辑
      if (startLine === endLine) {
        // 情况1：纯插入（oldText为空，newText非空）
        if (startChar === endChar && newText !== '') {
          // newText 可能包含换行 → 多行插入
          const nlParts = newText.split('\n');
          if (nlParts.length === 1) {
            // 单行插入：在 startChar 位置之前插入
            const before = startLineContent.substring(0, startChar);
            const after = startLineContent.substring(startChar);
            lines.push(`SWAP ${startLine}.=${startLine}:`);
            lines.push(`+${before}${nlParts[0]}${after}`);
          } else {
            // 多行插入：拆分当前行
            const before = startLineContent.substring(0, startChar);
            const after = startLineContent.substring(startChar);
            lines.push(`SWAP ${startLine}.=${startLine}:`);
            lines.push(`+${before}${nlParts[0]}`);
            for (let i = 1; i < nlParts.length - 1; i++) {
              lines.push(`+${nlParts[i]}`);
            }
            lines.push(`+${nlParts[nlParts.length - 1]}${after}`);
          }
        }
        // 情况2：纯删除（newText为空，oldText非空）
        else if (newText === '' && startChar !== endChar) {
          const before = startLineContent.substring(0, startChar);
          const after = startLineContent.substring(endChar);
          if (before === '' && after === '') {
            lines.push(`DEL ${startLine}.=${startLine}`);
          } else {
            lines.push(`SWAP ${startLine}.=${startLine}:`);
            const replacement = before + after;
            if (replacement !== '') {lines.push(`+${replacement}`);}
          }
        }
        // 情况3：替换（oldText和newText都非空）
        else if (startChar !== endChar && newText !== '') {
          const before = startLineContent.substring(0, startChar);
          const after = startLineContent.substring(endChar);
          const nlParts = newText.split('\n');
          lines.push(`SWAP ${startLine}.=${startLine}:`);
          if (nlParts.length === 1) {
            lines.push(`+${before}${nlParts[0]}${after}`);
          } else {
            lines.push(`+${before}${nlParts[0]}`);
            for (let i = 1; i < nlParts.length - 1; i++) {
              lines.push(`+${nlParts[i]}`);
            }
            lines.push(`+${nlParts[nlParts.length - 1]}${after}`);
          }
        }
        // 情况4：空操作（startChar === endChar && newText === ''）→ 跳过
      }
      // 多行编辑
      else {
        lines.push(`SWAP ${startLine}.=${endLine}:`);
        for (const nl of newText.split('\n')) {lines.push(`+${nl}`);}
      }

      currentContent = this._applyTextEdits(currentContent, [edit]);
    }

    return lines.join('\n');
  }

  _applyTextEdits(text, edits) {
    const sorted = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) {return b.range.start.line - a.range.start.line;}
      return b.range.start.character - a.range.start.character;
    });
    let result = text;
    for (const edit of sorted) {
      const lines = result.split('\n');
      let startOffset = 0;
      for (let i = 0; i < edit.range.start.line; i++) {startOffset += lines[i].length + 1;}
      startOffset += edit.range.start.character;
      let endOffset = 0;
      for (let i = 0; i < edit.range.end.line; i++) {endOffset += lines[i].length + 1;}
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
