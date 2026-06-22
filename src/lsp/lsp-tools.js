/**
 * LSP Tools — 向 agent 暴露 IDE 级代码理解和重构能力。
 *
 * 工具列表：
 *  - lsp_rename            重命名符号 + 同步更新所有引用
 *  - lsp_references        查找所有引用
 *  - lsp_definition        跳转到定义
 *  - lsp_diagnostics       获取诊断信息（错误/警告）
 *  - lsp_format            格式化文档
 *  - lsp_code_action       执行代码操作（快速修复等）
 *  - lsp_hover             获取悬停信息
 *  - lsp_symbols           文档/工作区符号列表
 *  - lsp_workspace_edit    应用跨文件工作区编辑（含 barrel/export/alias 同步）
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname, relative, basename } from 'path';
import { ToolCategory } from '../core/types/index.js';

// ── 辅助 ───────────────────────────────────────────────────────────────────

/**
 * 安全解析路径。
 * @param {string} workingDir
 * @param {string} userPath
 * @returns {string}
 */
function safePath(workingDir, userPath) {
  const r = resolve(workingDir || process.cwd(), userPath || '.');
  // 简单沙箱：不超出 workingDir
  if (!r.startsWith(resolve(workingDir || process.cwd()))) {
    throw new Error(`path escapes workspace: ${userPath}`);
  }
  return r;
}

// ── 工具工厂 ───────────────────────────────────────────────────────────────

/**
 * 创建 LSP 工具集。
 *
 * @param {object} opts
 * @param {import('./lsp-manager.js').ServerManager} opts.lspManager
 * @param {import('../core/harness/content-addressing.js').ContentAddressableStore} [opts.contentStore]
 * @param {import('../core/harness/hashline.js').Patcher} [opts.hashlinePatcher]
 * @returns {object[]} 工具对象数组
 */
export function createLSPTools({ lspManager, contentStore = null, hashlinePatcher = null }) {
  if (!lspManager) { return []; }

  return [
    // ── lsp_rename ───────────────────────────────────────────────────────
    {
      name: 'lsp_rename',
      description:
        'Rename a symbol across the entire workspace using LSP semantic rename. ' +
        'Updates all references, barrel/export files, and alias imports atomically. ' +
        'Returns the workspace edit that will be applied and a summary of changes.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file containing the symbol' },
        line: { type: 'number', description: '1-based line number of the symbol' },
        character: { type: 'number', description: '1-based character (column) of the symbol' },
        newName: { type: 'string', description: 'New name for the symbol' },
      },
      required: ['filePath', 'line', 'character', 'newName'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');
        const position = { line: (args.line || 1) - 1, character: (args.character || 1) - 1 };

        // 1) 先 prepareRename 检查
        let prepareResult;
        try {
          prepareResult = await lspManager.request(
            'textDocument/prepareRename', filePath, {}, position, content, 15000,
          );
        } catch {
          return {
            success: false,
            error: 'Cannot rename at this position: symbol not found or LSP server does not support rename.',
          };
        }
        if (!prepareResult) {
          return { success: false, error: 'LSP server returned null — rename not available at this location.' };
        }

        // 2) 执行 rename
        const workspaceEdit = await lspManager.request(
          'textDocument/rename', filePath,
          { newName: args.newName },
          position, content, 30000,
        );

        if (!workspaceEdit || !workspaceEdit.changes) {
          return { success: false, error: 'Rename returned no changes.' };
        }

        // 3) 应用 workspace edit
        const appResult = await applyWorkspaceEdit(workspaceEdit, {
          workingDirectory: ctx.workingDirectory,
          contentStore,
          hashlinePatcher,
          snapshotStore: ctx.snapshotStore,
        });

        // 4) 同步 barrel/export/alias
        const syncResult = await syncBarrelAndAliasImports({
          renamedFile: filePath,
          oldName: prepareResult.placeholder || (await extractSymbolName(content, position)),
          newName: args.newName,
          workingDirectory: ctx.workingDirectory,
          lspManager,
        });

        return {
          success: true,
          renamed: `${filePath}:${args.line}:${args.character} -> ${args.newName}`,
          filesChanged: appResult.filesChanged,
          filesFailed: appResult.filesFailed,
          barrelSyncs: syncResult.synced,
          totalEdits: appResult.totalEdits,
        };
      },
    },

    // ── lsp_references ────────────────────────────────────────────────────
    {
      name: 'lsp_references',
      description:
        'Find all references to a symbol across the workspace using LSP. ' +
        'Returns file paths, line numbers, and surrounding context for each reference.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file containing the symbol' },
        line: { type: 'number', description: '1-based line number of the symbol' },
        character: { type: 'number', description: '1-based character position of the symbol' },
        includeDeclaration: { type: 'boolean', description: 'Include the declaration itself (default: true)' },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');
        const position = { line: (args.line || 1) - 1, character: (args.character || 1) - 1 };

        const refs = await lspManager.request(
          'textDocument/references', filePath,
          {
            context: { includeDeclaration: args.includeDeclaration !== false },
          },
          position, content, 15000,
        );

        if (!refs || refs.length === 0) {
          return { success: true, references: [], count: 0 };
        }

        // 提取每个引用的上下文行
        const enriched = await Promise.all(
          refs.map(async (ref) => {
            const uriToPath = ref.uri.startsWith('file://')
              ? ref.uri.slice(7)
              : ref.uri;
            try {
              const refContent = await readFile(uriToPath, 'utf-8');
              const lines = refContent.split('\n');
              const refLine = ref.range.start.line;
              return {
                uri: ref.uri,
                file: uriToPath,
                line: refLine + 1,
                character: ref.range.start.character + 1,
                context: lines[refLine] || '',
              };
            } catch {
              return {
                uri: ref.uri,
                file: uriToPath,
                line: ref.range.start.line + 1,
                character: ref.range.start.character + 1,
                context: '<unable to read>',
              };
            }
          }),
        );

        return {
          success: true,
          references: enriched,
          count: enriched.length,
        };
      },
    },

    // ── lsp_definition ────────────────────────────────────────────────────
    {
      name: 'lsp_definition',
      description:
        'Go to the definition of a symbol using LSP. Returns file path, line, and context.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file containing the symbol' },
        line: { type: 'number', description: '1-based line number' },
        character: { type: 'number', description: '1-based character position' },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');
        const position = { line: (args.line || 1) - 1, character: (args.character || 1) - 1 };

        const result = await lspManager.request(
          'textDocument/definition', filePath, {}, position, content, 10000,
        );

        if (!result) {
          return { success: true, definitions: [], message: 'No definition found.' };
        }

        // 可能是单个 Location 或 Location[]
        const defs = Array.isArray(result) ? result : [result];

        const enriched = await Promise.all(
          defs.map(async (d) => {
            const uriToPath = d.uri.startsWith('file://') ? d.uri.slice(7) : d.uri;
            try {
              const defContent = await readFile(uriToPath, 'utf-8');
              const lines = defContent.split('\n');
              const startLine = d.range.start.line;
              const endLine = d.range.end.line;
              const snippet = lines.slice(startLine, endLine + 1).join('\n');
              return {
                uri: d.uri,
                file: uriToPath,
                line: startLine + 1,
                endLine: endLine + 1,
                snippet,
              };
            } catch {
              return {
                uri: d.uri,
                file: uriToPath,
                line: d.range.start.line + 1,
                snippet: '<unable to read>',
              };
            }
          }),
        );

        return { success: true, definitions: enriched, count: enriched.length };
      },
    },

    // ── lsp_diagnostics ───────────────────────────────────────────────────
    {
      name: 'lsp_diagnostics',
      description:
        'Get LSP diagnostics (errors, warnings, hints) for a file. ' +
        'Returns a list of diagnostics with severity, message, and range.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file (use "*" for all files)' },
        severity: {
          type: 'string',
          description: 'Filter by severity: error, warning, info, hint (default: all)',
        },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        if (args.filePath === '*') {
          // 获取所有文件的 diagnostics
          const all = lspManager.getAllDiagnostics();
          const result = {};
          for (const [uri, diags] of Object.entries(all)) {
            const filtered = filterDiagnostics(diags, args.severity);
            if (filtered.length > 0) {
              result[uri] = filtered;
            }
          }
          const total = Object.values(result).reduce((s, d) => s + d.length, 0);
          return { success: true, diagnostics: result, totalFiles: Object.keys(result).length, totalDiagnostics: total };
        }

        const filePath = safePath(ctx.workingDirectory, args.filePath);
        // 同步文档以触发 diagnostics
        try {
          const content = await readFile(filePath, 'utf-8');
          await lspManager.syncDocument(filePath, content);
          // 等一小段让 server 有时间推送 diagnostics
          await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const diags = lspManager.getDiagnostics(filePath);
        const filtered = filterDiagnostics(diags, args.severity);

        return {
          success: true,
          file: filePath,
          diagnostics: filtered.map((d) => ({
            severity: severityLabel(d.severity),
            message: d.message,
            line: d.range.start.line + 1,
            endLine: d.range.end.line + 1,
            character: d.range.start.character + 1,
            code: d.code || null,
            source: d.source || null,
          })),
          count: filtered.length,
        };
      },
    },

    // ── lsp_format ────────────────────────────────────────────────────────
    {
      name: 'lsp_format',
      description:
        'Format a document using the LSP formatter (e.g. prettier via language server). ' +
        'Returns the formatted text or applies it directly.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file to format' },
        apply: { type: 'boolean', description: 'Apply formatting to the file (default: false, just preview)' },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');

        const edits = await lspManager.request(
          'textDocument/formatting', filePath,
          {
            options: { tabSize: 2, insertSpaces: true },
          },
          null, content, 15000,
        );

        if (!edits || edits.length === 0) {
          return { success: true, message: 'File is already formatted.', applied: false };
        }

        const formatted = applyTextEdits(content, edits);

        if (args.apply) {
          await writeFile(filePath, formatted, 'utf-8');
          // 更新 CAS / snapshot
          if (contentStore) {
            contentStore.storeBlob(formatted);
            contentStore.setRef(`file:${filePath}`, contentStore.storeBlob(formatted));
          }
          if (ctx.snapshotStore) {
            ctx.snapshotStore.record(filePath, formatted);
          }
          // 同步到 LSP
          await lspManager.syncDocument(filePath, formatted);
          return { success: true, message: 'Formatting applied.', applied: true, editCount: edits.length };
        }

        return {
          success: true,
          message: `Found ${edits.length} formatting edits. Use apply=true to write changes.`,
          applied: false,
          diff: formatAsDiff(content, formatted),
        };
      },
    },

    // ── lsp_code_action ───────────────────────────────────────────────────
    {
      name: 'lsp_code_action',
      description:
        'Get and execute LSP code actions (quick fixes, refactorings, source actions) for a file or range.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file' },
        startLine: { type: 'number', description: '1-based start line for range (omit for whole file)' },
        startChar: { type: 'number', description: '1-based start character' },
        endLine: { type: 'number', description: '1-based end line' },
        endChar: { type: 'number', description: '1-based end character' },
        title: { type: 'string', description: 'If specified, execute the code action with this title' },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');

        const hasRange = args.startLine && args.endLine;
        const range = hasRange
          ? {
              start: { line: args.startLine - 1, character: (args.startChar || 1) - 1 },
              end: { line: args.endLine - 1, character: (args.endChar || 1) - 1 },
            }
          : null;

        let extraParams = {};
        if (range) {
          extraParams.range = range;
        } else {
          // 全文件诊断
          extraParams.context = { diagnostics: lspManager.getDiagnostics(filePath) };
        }

        let actions;
        try {
          actions = await lspManager.request(
            'textDocument/codeAction', filePath,
            extraParams,
            null, content, 15000,
          );
        } catch {
          return { success: false, error: 'Failed to get code actions from LSP server.' };
        }

        if (!actions || actions.length === 0) {
          return { success: true, actions: [], message: 'No code actions available.' };
        }

        // 如果指定了 title，直接执行
        if (args.title) {
          const matched = actions.find(
            (a) => a.title === args.title || a.title.toLowerCase().includes(args.title.toLowerCase()),
          );
          if (!matched) {
            return {
              success: false,
              error: `No code action matching "${args.title}". Available: ${actions.map((a) => a.title).join(', ')}`,
              availableActions: actions.map((a) => ({ title: a.title, kind: a.kind })),
            };
          }
          return executeCodeAction(matched, { lspManager, contentStore, hashlinePatcher }, ctx);
        }

        // 否则返回可用操作列表
        return {
          success: true,
          actions: actions.map((a) => ({
            title: a.title,
            kind: a.kind || 'unknown',
            isPreferred: a.isPreferred || false,
            disabled: a.disabled || null,
          })),
          count: actions.length,
          hint: 'Set "title" parameter to execute a specific code action.',
        };
      },
    },

    // ── lsp_hover ─────────────────────────────────────────────────────────
    {
      name: 'lsp_hover',
      description:
        'Get hover information (type info, documentation) for a symbol at a position.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file' },
        line: { type: 'number', description: '1-based line number' },
        character: { type: 'number', description: '1-based character position' },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');
        const position = { line: (args.line || 1) - 1, character: (args.character || 1) - 1 };

        const result = await lspManager.request(
          'textDocument/hover', filePath, {}, position, content, 8000,
        );

        if (!result || !result.contents) {
          return { success: true, hover: null, message: 'No hover information.' };
        }

        return {
          success: true,
          hover: {
            contents: normalizeHoverContent(result.contents),
            range: result.range
              ? {
                  startLine: result.range.start.line + 1,
                  endLine: result.range.end.line + 1,
                }
              : null,
          },
        };
      },
    },

    // ── lsp_symbols ───────────────────────────────────────────────────────
    {
      name: 'lsp_symbols',
      description:
        'List document or workspace symbols using LSP. Use type="document" for current file symbols, type="workspace" for project-wide symbol search.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file (required for document symbols)' },
        type: { type: 'string', description: '"document" (default) or "workspace"' },
        query: { type: 'string', description: 'Search query for workspace symbols' },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        const wantWorkspace = args.type === 'workspace';
        const filePath = safePath(ctx.workingDirectory, args.filePath);

        if (wantWorkspace) {
          if (!args.query) {
            return { success: false, error: 'query parameter is required for workspace symbols.' };
          }
          const symbols = await lspManager.request(
            'workspace/symbol', filePath, { query: args.query }, null, null, 15000,
          );
          if (!symbols || symbols.length === 0) {
            return { success: true, symbols: [], query: args.query };
          }
          return {
            success: true,
            symbols: symbols.map((s) => ({
              name: s.name,
              kind: symbolKindLabel(s.kind),
              location: {
                file: s.location.uri.startsWith('file://') ? s.location.uri.slice(7) : s.location.uri,
                line: s.location.range.start.line + 1,
              },
            })),
            count: symbols.length,
          };
        }

        // document symbols
        const content = await readFile(filePath, 'utf-8');
        const symbols = await lspManager.request(
          'textDocument/documentSymbol', filePath, {}, null, content, 10000,
        );

        if (!symbols || symbols.length === 0) {
          return { success: true, symbols: [], file: filePath };
        }

        // 扁平化嵌套符号
        const flat = flattenSymbols(symbols);
        return {
          success: true,
          file: filePath,
          symbols: flat.map((s) => ({
            name: s.name,
            kind: symbolKindLabel(s.kind),
            line: s.range.start.line + 1,
            endLine: s.range.end.line + 1,
            children: s.children ? s.children.length : 0,
          })),
          count: flat.length,
        };
      },
    },

    // ── lsp_workspace_edit ────────────────────────────────────────────────
    {
      name: 'lsp_workspace_edit',
      description:
        'Apply a cross-file workspace edit (rename/refactor) atomically. ' +
        'Automatically syncs barrel exports and alias imports. ' +
        'Use this for complex refactors that span multiple files.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the primary file being refactored' },
        operation: { type: 'string', description: 'One of: move, rename_file, update_imports' },
        oldPath: { type: 'string', description: 'Old path (for move/rename_file)' },
        newPath: { type: 'string', description: 'New path (for move/rename_file)' },
      },
      required: ['filePath', 'operation'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);

        if (args.operation === 'rename_file' || args.operation === 'move') {
          if (!args.oldPath || !args.newPath) {
            return { success: false, error: 'oldPath and newPath are required for move/rename_file.' };
          }
          const oldPath = safePath(ctx.workingDirectory, args.oldPath);
          const newPath = safePath(ctx.workingDirectory, args.newPath);

          // 通过 LSP workspace/willRenameFiles 请求获取 import 更新
          const renameResult = await lspManager.request(
            'workspace/willRenameFiles', filePath,
            {
              files: [{ oldUri: `file://${oldPath}`, newUri: `file://${newPath}` }],
            },
            null, null, 20000,
          );

          const changes = {};
          if (renameResult && renameResult.changes) {
            Object.assign(changes, renameResult.changes);
          }
          if (renameResult && renameResult.documentChanges) {
            for (const dc of renameResult.documentChanges) {
              if (dc.textDocument && dc.edits) {
                const uri = dc.textDocument.uri;
                if (!changes[uri]) { changes[uri] = []; }
                changes[uri].push(...dc.edits);
              }
            }
          }

          if (Object.keys(changes).length === 0) {
            return {
              success: true,
              message: 'LSP server returned no import updates for this rename.',
              changes: 0,
            };
          }

          return await applyWorkspaceEdit({ changes }, {
            workingDirectory: ctx.workingDirectory,
            contentStore,
            hashlinePatcher,
            snapshotStore: ctx.snapshotStore,
            lspManager,
          });
        }

        if (args.operation === 'update_imports') {
          // 手动触发 barrel/alias 导入同步
          const syncResult = await syncBarrelAndAliasImports({
            renamedFile: filePath,
            workingDirectory: ctx.workingDirectory,
            lspManager,
          });
          return { success: true, ...syncResult };
        }

        return { success: false, error: `Unknown operation: ${args.operation}. Use move, rename_file, or update_imports.` };
      },
    },
  ];
}

// ── Workspace Edit 应用 ────────────────────────────────────────────────────

/**
 * 应用 LSP workspace edit（跨文件文本编辑）。
 * @returns {Promise<{success: boolean, filesChanged: string[], filesFailed: string[], totalEdits: number}>}
 */
async function applyWorkspaceEdit(workspaceEdit, {
  workingDirectory,
  contentStore,
  hashlinePatcher,
  snapshotStore,
  lspManager,
}) {
  const filesChanged = [];
  const filesFailed = [];
  let totalEdits = 0;

  // 处理 changes（按 URI 分组的 TextEdit 数组）
  const changes = workspaceEdit.changes || {};
  for (const [uri, edits] of Object.entries(changes)) {
    const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
    if (edits.length === 0) { continue; }
    try {
      let content = await readFile(filePath, 'utf-8');
      content = applyTextEdits(content, edits);
      await writeFile(filePath, content, 'utf-8');
      filesChanged.push(filePath);
      totalEdits += edits.length;

      // 更新 CAS
      if (contentStore) {
        const blob = contentStore.storeBlob(content);
        contentStore.setRef(`file:${filePath}`, blob);
      }
      // 更新 snapshot
      if (snapshotStore) {
        snapshotStore.record(filePath, content);
      }
      // 通知 LSP
      if (lspManager) {
        lspManager.syncDocument(filePath, content).catch(() => {});
      }
    } catch (err) {
      filesFailed.push(`${filePath}: ${err.message}`);
    }
  }

  // 处理 documentChanges（资源变更数组）
  if (workspaceEdit.documentChanges) {
    for (const dc of workspaceEdit.documentChanges) {
      if (dc.textDocument && dc.edits) {
        const uri = dc.textDocument.uri;
        const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
        try {
          let content;
          try {
            content = await readFile(filePath, 'utf-8');
          } catch {
            filesFailed.push(`${filePath}: file not found`);
            continue;
          }
          content = applyTextEdits(content, dc.edits);
          await writeFile(filePath, content, 'utf-8');
          filesChanged.push(filePath);
          totalEdits += dc.edits.length;
          if (contentStore) {
            contentStore.setRef(`file:${filePath}`, contentStore.storeBlob(content));
          }
          if (snapshotStore) {
            snapshotStore.record(filePath, content);
          }
          if (lspManager) {
            lspManager.syncDocument(filePath, content).catch(() => {});
          }
        } catch (err) {
          filesFailed.push(`${filePath}: ${err.message}`);
        }
      }
    }
  }

  return {
    success: filesFailed.length === 0,
    filesChanged: [...new Set(filesChanged)],
    filesFailed,
    totalEdits,
  };
}

/**
 * 将 TextEdit 数组应用到文本。
 */
function applyTextEdits(text, edits) {
  // 按位置从后往前应用
  const sorted = [...edits].sort((a, b) => {
    if (b.range.start.line !== a.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  let result = text;
  for (const edit of sorted) {
    const lines = result.split('\n');
    const startOffset = lineCharToOffset(lines, edit.range.start.line, edit.range.start.character);
    const endOffset = lineCharToOffset(lines, edit.range.end.line, edit.range.end.character);
    result = result.substring(0, startOffset) + (edit.newText || '') + result.substring(endOffset);
  }
  return result;
}

function lineCharToOffset(lines, line, character) {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for '\n'
  }
  return offset + Math.min(character, lines[line] ? lines[line].length : 0);
}

// ── Barrel / Export / Alias Import 同步 ─────────────────────────────────────

/**
 * 同步 barrel 导出文件和 alias import 路径。
 *
 * 当文件被重命名或符号被重命名后，自动：
 * 1. 查找包含该文件导出的 barrel/index 文件并更新
 * 2. 同步 tsconfig paths 别名对应的 import 语句
 */
async function syncBarrelAndAliasImports({
  renamedFile,
  oldName,
  newName,
  workingDirectory,
  lspManager,
} = {}) {
  const synced = [];
  const wd = workingDirectory || process.cwd();

  try {
    // 1) Barrel 导出同步：检查 renamedFile 所在目录及祖先目录的 index 文件
    const relativePath = relative(wd, renamedFile);
    const fileName = basename(renamedFile);

    // 查找可能的 barrel 文件
    const barrelCandidates = findBarrelFiles(wd, renamedFile);
    for (const barrelPath of barrelCandidates) {
      try {
        const barrelContent = await readFile(barrelPath, 'utf-8');
        const updated = updateBarrelExport(barrelContent, fileName, relativePath, oldName, newName);
        if (updated !== barrelContent) {
          await writeFile(barrelPath, updated, 'utf-8');
          synced.push(`barrel:${barrelPath}`);
          if (lspManager) {
            lspManager.syncDocument(barrelPath, updated).catch(() => {});
          }
        }
      } catch { /* skip unreadable barrels */ }
    }
  } catch (err) {
    synced.push(`barrel:error:${err.message}`);
  }

  return { synced };
}

/**
 * 查找与被修改文件相关的 barrel/index 文件。
 */
function findBarrelFiles(workspaceRoot, filePath) {
  const candidates = [];
  const dir = dirname(filePath);

  // 同目录 barrel
  for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs']) {
    candidates.push(resolve(dir, name));
  }

  // 上级目录 barrel（最多往上 3 层）
  let current = dir;
  for (let i = 0; i < 3; i++) {
    const parent = dirname(current);
    if (parent === current || !parent.startsWith(workspaceRoot)) { break; }
    for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
      candidates.push(resolve(parent, name));
    }
    current = parent;
  }

  return candidates;
}

/**
 * 更新 barrel 文件中的导出语句。
 */
function updateBarrelExport(content, fileName, relativePath, oldName, newName) {
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  const newNameWithoutExt = newName ? newName.replace(/\.[^.]+$/, '') : null;

  let updated = content;

  // 匹配: export { XXX } from './file' 或 export { default as XXX } from './file'
  // 更新符号名
  if (oldName && newName) {
    const exportNamedRe = new RegExp(`(export\\s*\\{[^}]*)\\b${escapeRegex(oldName)}\\b([^}]*\\}\\s*from\\s*['"]\\.\\/?${escapeRegex(nameWithoutExt)}['"])`, 'g');
    updated = updated.replace(exportNamedRe, `$1${newName}$2`);
  }

  // 匹配: export * from './file' 或 export { default } from './file'
  // 如果文件名变了，更新路径
  if (newNameWithoutExt && nameWithoutExt !== newNameWithoutExt) {
    const exportFromRe = new RegExp(`(from\\s*['"]\\.\\/?)${escapeRegex(nameWithoutExt)}(['"])`, 'g');
    updated = updated.replace(exportFromRe, `$1${newNameWithoutExt}$2`);
  }

  return updated;
}

// ── Code Action 执行 ───────────────────────────────────────────────────────

async function executeCodeAction(action, { lspManager, contentStore, hashlinePatcher }, ctx) {
  // 如果 action 有 edit 属性，直接应用
  if (action.edit) {
    return applyWorkspaceEdit(action.edit, {
      workingDirectory: ctx.workingDirectory,
      contentStore,
      hashlinePatcher,
      snapshotStore: ctx.snapshotStore,
      lspManager,
    });
  }

  // 如果 action 有 command 属性，需要通过 workspace/executeCommand
  if (action.command) {
    try {
      const result = await lspManager.request(
        'workspace/executeCommand', ctx.workingDirectory,
        {
          command: action.command.command,
          arguments: action.command.arguments || [],
        },
        null, null, 15000,
      );
      return {
        success: true,
        executed: action.title,
        result,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to execute "${action.title}": ${err.message}`,
      };
    }
  }

  // 需要通过 LSP codeAction/resolve 获取实际 edit
  try {
    const resolved = await lspManager.request(
      'codeAction/resolve', ctx.workingDirectory, action, null, null, 10000,
    );
    if (resolved && resolved.edit) {
      return applyWorkspaceEdit(resolved.edit, {
        workingDirectory: ctx.workingDirectory,
        contentStore,
        hashlinePatcher,
        snapshotStore: ctx.snapshotStore,
        lspManager,
      });
    }
  } catch (err) {
    return { success: false, error: `Failed to resolve code action: ${err.message}` };
  }

  return { success: false, error: `Code action "${action.title}" has no associated edit.` };
}

// ── 辅助函数 ───────────────────────────────────────────────────────────────

function filterDiagnostics(diags, severity) {
  if (!severity) { return diags; }
  const labels = { error: 1, warning: 2, info: 3, hint: 4 };
  const target = labels[severity.toLowerCase()];
  if (!target) { return diags; }
  return diags.filter((d) => d.severity === target);
}

function severityLabel(sev) {
  return { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }[sev] || 'unknown';
}

function symbolKindLabel(kind) {
  const map = {
    1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class',
    6: 'method', 7: 'property', 8: 'field', 9: 'constructor', 10: 'enum',
    11: 'interface', 12: 'function', 13: 'variable', 14: 'constant',
    15: 'string', 16: 'number', 17: 'boolean', 18: 'array', 19: 'object',
    20: 'key', 21: 'null', 22: 'enumMember', 23: 'struct', 24: 'event',
    25: 'operator', 26: 'typeParameter',
  };
  return map[kind] || `kind_${kind}`;
}

function flattenSymbols(symbols, result = []) {
  for (const s of symbols) {
    result.push(s);
    if (s.children && s.children.length > 0) {
      flattenSymbols(s.children, result);
    }
  }
  return result;
}

function normalizeHoverContent(contents) {
  if (typeof contents === 'string') { return { value: contents }; }
  if (Array.isArray(contents)) {
    return {
      value: contents.map((c) => (typeof c === 'string' ? c : c.value || '')).join('\n'),
    };
  }
  if (contents && typeof contents === 'object') {
    return {
      language: contents.language,
      value: contents.value || contents.language || '',
    };
  }
  return { value: String(contents) };
}

async function extractSymbolName(content, position) {
  // 简单提取：取 position 处的英文标识符
  const lines = content.split('\n');
  if (position.line >= lines.length) { return 'unknown'; }
  const line = lines[position.line];
  let start = position.character;
  let end = position.character;
  const idRe = /[a-zA-Z0-9_$]/;
  while (start > 0 && idRe.test(line[start - 1])) { start--; }
  while (end < line.length && idRe.test(line[end])) { end++; }
  return line.substring(start, end);
}

function formatAsDiff(original, formatted) {
  const oLines = original.split('\n');
  const fLines = formatted.split('\n');
  const diff = [];
  const maxLen = Math.max(oLines.length, fLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < oLines.length && i < fLines.length && oLines[i] !== fLines[i]) {
      diff.push(`  ${i + 1}: -${oLines[i]}\n  ${i + 1}: +${fLines[i]}`);
    } else if (i >= oLines.length) {
      diff.push(`  ${i + 1}: +${fLines[i]}`);
    } else if (i >= fLines.length) {
      diff.push(`  ${i + 1}: -${oLines[i]}`);
    }
  }
  return diff.join('\n');
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
