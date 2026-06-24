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
import { pathToFileURL } from 'url';
import { ToolCategory } from '../core/types/index.js';
import { computeTag } from '../core/harness/hashline.js';

// ── 辅助 ───────────────────────────────────────────────────────────────────

/**
 * 安全解析路径。
 * @param {string} workingDir
 * @param {string} userPath
 * @returns {string}
 */
function safePath(workingDir, userPath) {
  const r = resolve(workingDir || process.cwd(), userPath || '.');
  if (!r.startsWith(resolve(workingDir || process.cwd()))) {
    throw new Error(`path escapes workspace: ${userPath}`);
  }
  return r;
}

/**
 * 验证参数是否满足基本类型和范围要求。
 * @param {object} args
 * @param {object} schema
 * @returns {string|null} 错误信息或 null
 */
function validateArgs(args, schema) {
  for (const [key, def] of Object.entries(schema)) {
    const value = args[key];
    if (def.required && (value === undefined || value === null)) {
      return `${key} is required`;
    }
    if (value !== undefined && value !== null) {
      if (def.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
        return `${key} must be a number`;
      }
      if (def.type === 'string' && typeof value !== 'string') {
        return `${key} must be a string`;
      }
      if (def.type === 'boolean' && typeof value !== 'boolean') {
        return `${key} must be a boolean`;
      }
      if (def.type === 'number' && def.min !== undefined && value < def.min) {
        return `${key} must be >= ${def.min}`;
      }
      if (def.type === 'number' && def.max !== undefined && value > def.max) {
        return `${key} must be <= ${def.max}`;
      }
      if (def.type === 'string' && def.minLength !== undefined && value.length < def.minLength) {
        return `${key} must be at least ${def.minLength} characters`;
      }
      if (def.type === 'string' && def.maxLength !== undefined && value.length > def.maxLength) {
        return `${key} must be at most ${def.maxLength} characters`;
      }
      if (def.enum && !def.enum.includes(value)) {
        return `${key} must be one of: ${def.enum.join(', ')}`;
      }
    }
  }
  return null;
}

/**
 * 捕获 LSP 请求错误，统一错误格式。
 */
async function withLSPErrorHandling(promise, context) {
  try {
    const result = await promise;
    return { success: true, result };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        success: false,
        error: `File not found: ${context.filePath || ''}`,
        code: 'FILE_NOT_FOUND',
      };
    }
    if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
      return {
        success: false,
        error: `LSP request timed out: ${context.method || ''}`,
        code: 'TIMEOUT',
      };
    }
    if (err.message?.includes('server not found')) {
      return {
        success: false,
        error: 'LSP server not found. Please install the appropriate language server.',
        code: 'SERVER_NOT_FOUND',
      };
    }
    if (err.message?.includes('disconnected')) {
      return { success: false, error: 'LSP server disconnected', code: 'SERVER_DISCONNECTED' };
    }
    return {
      success: false,
      error: `LSP error: ${err.message || 'unknown'}`,
      code: 'LSP_ERROR',
      details: context,
    };
  }
}

// ── 工具工厂 ───────────────────────────────────────────────────────────────

/**
 * 创建 LSP 工具集。
 *
 * @param {object} opts
 * @param {import('./lsp-manager.js').ServerManager} opts.lspManager
 * @param {import('../core/harness/content-addressing.js').ContentAddressableStore} [opts.contentStore]
 * @param {import('../core/harness/hashline.js').Patcher} [opts.hashlinePatcher]
 * @param {import('../core/harness/module-resolver.js').ModuleResolver} [opts.moduleResolver]  精确模块解析器（barrel/alias 同步）
 * @param {import('../core/harness/import-graph.js').ImportGraph} [opts.importGraph]          导入依赖图
 * @param {import('../core/harness/barrel-manager.js').BarrelManager} [opts.barrelManager]     Barrel 文件管理器
 * @returns {object[]} 工具对象数组
 */
export function createLSPTools({
  lspManager,
  contentStore = null,
  hashlinePatcher = null,
  moduleResolver = null,
  importGraph = null,
  barrelManager = null,
}) {
  if (!lspManager) {
    return [];
  }

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
        filePath: {
          type: 'string',
          description: 'Path to the file containing the symbol',
          required: true,
        },
        line: {
          type: 'number',
          description: '1-based line number of the symbol',
          required: true,
          min: 1,
        },
        character: {
          type: 'number',
          description: '1-based character (column) of the symbol',
          required: true,
          min: 1,
        },
        newName: {
          type: 'string',
          description: 'New name for the symbol',
          required: true,
          minLength: 1,
        },
      },
      required: ['filePath', 'line', 'character', 'newName'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
          newName: { type: 'string', required: true, minLength: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        const prepareResult = await withLSPErrorHandling(
          lspManager.request('textDocument/prepareRename', filePath, {}, position, content, 15000),
          { method: 'textDocument/prepareRename', filePath },
        );
        if (!prepareResult.success) {
          return prepareResult;
        }
        if (!prepareResult.result) {
          return {
            success: false,
            error: 'LSP server returned null — rename not available at this location.',
          };
        }

        const renameResult = await withLSPErrorHandling(
          lspManager.request(
            'textDocument/rename',
            filePath,
            { newName: args.newName },
            position,
            content,
            30000,
          ),
          { method: 'textDocument/rename', filePath },
        );
        if (!renameResult.success) {
          return renameResult;
        }

        const workspaceEdit = renameResult.result;
        if (!workspaceEdit || !workspaceEdit.changes) {
          return { success: false, error: 'Rename returned no changes.' };
        }

        const appResult = await applyWorkspaceEdit(workspaceEdit, {
          workingDirectory: ctx.workingDirectory,
          contentStore,
          hashlinePatcher,
          snapshotStore: ctx.snapshotStore,
        });

        if (!appResult.success && appResult.rolledBack) {
          return {
            success: false,
            error: `Rename rolled back: ${appResult.filesFailed.join(', ')}`,
            rolledBack: true,
          };
        }

        const syncResult = await syncBarrelAndAliasImports({
          renamedFile: filePath,
          oldName: prepareResult.result.placeholder || (await extractSymbolName(content, position)),
          newName: args.newName,
          workingDirectory: ctx.workingDirectory,
          lspManager,
          moduleResolver,
          importGraph,
          barrelManager,
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
        filePath: {
          type: 'string',
          description: 'Path to the file containing the symbol',
          required: true,
        },
        line: {
          type: 'number',
          description: '1-based line number of the symbol',
          required: true,
          min: 1,
        },
        character: {
          type: 'number',
          description: '1-based character position of the symbol',
          required: true,
          min: 1,
        },
        includeDeclaration: {
          type: 'boolean',
          description: 'Include the declaration itself (default: true)',
        },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        const refsResult = await withLSPErrorHandling(
          lspManager.request(
            'textDocument/references',
            filePath,
            {
              context: { includeDeclaration: args.includeDeclaration !== false },
            },
            position,
            content,
            15000,
          ),
          { method: 'textDocument/references', filePath },
        );
        if (!refsResult.success) {
          return refsResult;
        }

        const refs = refsResult.result;
        if (!refs || refs.length === 0) {
          return { success: true, references: [], count: 0 };
        }

        const enriched = await Promise.all(
          refs.map(async (ref) => {
            const uriToPath = ref.uri.startsWith('file://') ? ref.uri.slice(7) : ref.uri;
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

        return { success: true, references: enriched, count: enriched.length };
      },
    },

    // ── lsp_definition ────────────────────────────────────────────────────
    {
      name: 'lsp_definition',
      description:
        'Go to the definition of a symbol using LSP. Returns file path, line, and context.',
      category: ToolCategory.LSP,
      params: {
        filePath: {
          type: 'string',
          description: 'Path to the file containing the symbol',
          required: true,
        },
        line: { type: 'number', description: '1-based line number', required: true, min: 1 },
        character: {
          type: 'number',
          description: '1-based character position',
          required: true,
          min: 1,
        },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        const defResult = await withLSPErrorHandling(
          lspManager.request('textDocument/definition', filePath, {}, position, content, 10000),
          { method: 'textDocument/definition', filePath },
        );
        if (!defResult.success) {
          return defResult;
        }

        const result = defResult.result;
        if (!result) {
          return { success: true, definitions: [], message: 'No definition found.' };
        }

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
          return {
            success: true,
            diagnostics: result,
            totalFiles: Object.keys(result).length,
            totalDiagnostics: total,
          };
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
        apply: {
          type: 'boolean',
          description: 'Apply formatting to the file (default: false, just preview)',
        },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        const filePath = safePath(ctx.workingDirectory, args.filePath);
        const content = await readFile(filePath, 'utf-8');

        const edits = await lspManager.request(
          'textDocument/formatting',
          filePath,
          {
            options: { tabSize: 2, insertSpaces: true },
          },
          null,
          content,
          15000,
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
          return {
            success: true,
            message: 'Formatting applied.',
            applied: true,
            editCount: edits.length,
          };
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
        startLine: {
          type: 'number',
          description: '1-based start line for range (omit for whole file)',
        },
        startChar: { type: 'number', description: '1-based start character' },
        endLine: { type: 'number', description: '1-based end line' },
        endChar: { type: 'number', description: '1-based end character' },
        title: {
          type: 'string',
          description: 'If specified, execute the code action with this title',
        },
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
            'textDocument/codeAction',
            filePath,
            extraParams,
            null,
            content,
            15000,
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
            (a) =>
              a.title === args.title || a.title.toLowerCase().includes(args.title.toLowerCase()),
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
      description: 'Get hover information (type info, documentation) for a symbol at a position.',
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
          'textDocument/hover',
          filePath,
          {},
          position,
          content,
          8000,
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
        filePath: {
          type: 'string',
          description: 'Path to the file (required for document symbols)',
        },
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
            'workspace/symbol',
            filePath,
            { query: args.query },
            null,
            null,
            15000,
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
                file: s.location.uri.startsWith('file://')
                  ? s.location.uri.slice(7)
                  : s.location.uri,
                line: s.location.range.start.line + 1,
              },
            })),
            count: symbols.length,
          };
        }

        // document symbols
        const content = await readFile(filePath, 'utf-8');
        const symbols = await lspManager.request(
          'textDocument/documentSymbol',
          filePath,
          {},
          null,
          content,
          10000,
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

    // ── lsp_type_definition ───────────────────────────────────────────────
    {
      name: 'lsp_type_definition',
      description:
        'Go to the type definition of a symbol using LSP (e.g. interface, type alias). ' +
        'Returns file path, line, and context snippet for each type definition.',
      category: ToolCategory.LSP,
      params: {
        filePath: {
          type: 'string',
          description: 'Path to the file containing the symbol',
          required: true,
        },
        line: { type: 'number', description: '1-based line number', required: true, min: 1 },
        character: {
          type: 'number',
          description: '1-based character position',
          required: true,
          min: 1,
        },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        const typeDefResult = await withLSPErrorHandling(
          lspManager.request('textDocument/typeDefinition', filePath, {}, position, content, 10000),
          { method: 'textDocument/typeDefinition', filePath },
        );
        if (!typeDefResult.success) {
          return typeDefResult;
        }

        const result = typeDefResult.result;
        if (!result) {
          return { success: true, typeDefinitions: [], message: 'No type definition found.' };
        }

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

        return { success: true, typeDefinitions: enriched, count: enriched.length };
      },
    },

    // ── lsp_implementation ─────────────────────────────────────────────────
    {
      name: 'lsp_implementation',
      description:
        'Find all implementations of an interface method, abstract method, or overridable symbol. ' +
        'Returns file path, line, and context for each implementation.',
      category: ToolCategory.LSP,
      params: {
        filePath: {
          type: 'string',
          description: 'Path to the file containing the symbol',
          required: true,
        },
        line: { type: 'number', description: '1-based line number', required: true, min: 1 },
        character: {
          type: 'number',
          description: '1-based character position',
          required: true,
          min: 1,
        },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        const implResult = await withLSPErrorHandling(
          lspManager.request('textDocument/implementation', filePath, {}, position, content, 15000),
          { method: 'textDocument/implementation', filePath },
        );
        if (!implResult.success) {
          return implResult;
        }

        const result = implResult.result;
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return {
            success: true,
            implementations: [],
            count: 0,
            message: 'No implementations found.',
          };
        }

        const impls = Array.isArray(result) ? result : [result];
        const enriched = await Promise.all(
          impls.map(async (d) => {
            const uriToPath = d.uri.startsWith('file://') ? d.uri.slice(7) : d.uri;
            try {
              const implContent = await readFile(uriToPath, 'utf-8');
              const lines = implContent.split('\n');
              const startLine = d.range.start.line;
              return {
                uri: d.uri,
                file: uriToPath,
                line: startLine + 1,
                context: lines[startLine] || '',
              };
            } catch {
              return {
                uri: d.uri,
                file: uriToPath,
                line: d.range.start.line + 1,
                context: '<unable to read>',
              };
            }
          }),
        );

        return { success: true, implementations: enriched, count: enriched.length };
      },
    },

    // ── lsp_call_hierarchy ─────────────────────────────────────────────────
    {
      name: 'lsp_call_hierarchy',
      description:
        'Analyze call hierarchy for a function/method. Use direction="incoming" for callers, direction="outgoing" for callees. ' +
        'Returns structured tree of call relationships.',
      category: ToolCategory.LSP,
      params: {
        filePath: {
          type: 'string',
          description: 'Path to the file containing the function',
          required: true,
        },
        line: { type: 'number', description: '1-based line number', required: true, min: 1 },
        character: {
          type: 'number',
          description: '1-based character position',
          required: true,
          min: 1,
        },
        direction: {
          type: 'string',
          description: '"incoming" for callers, "outgoing" for callees (default: incoming)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth of call hierarchy (default: 2, max: 5)',
          min: 1,
          max: 5,
        },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        const direction = args.direction === 'outgoing' ? 'outgoing' : 'incoming';

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        // Step 1: Prepare call hierarchy
        const prepareResult = await withLSPErrorHandling(
          lspManager.request(
            'textDocument/prepareCallHierarchy',
            filePath,
            {},
            position,
            content,
            10000,
          ),
          { method: 'textDocument/prepareCallHierarchy', filePath },
        );
        if (!prepareResult.success) {
          return prepareResult;
        }

        const items = prepareResult.result;
        if (!items || (Array.isArray(items) && items.length === 0)) {
          return {
            success: true,
            hierarchy: [],
            message: 'No call hierarchy available at this position.',
          };
        }

        const rootItem = Array.isArray(items) ? items[0] : items;
        const maxDepth = Math.min(args.maxDepth || 2, 5);

        // Step 2: Traverse call hierarchy recursively
        const buildCallTree = async (item, depth) => {
          if (depth > maxDepth) {
            return null;
          }

          const node = {
            name: item.name,
            kind: symbolKindLabel(item.kind),
            file: (item.uri || '').startsWith('file://')
              ? (item.uri || '').slice(7)
              : item.uri || '',
            line: (item.range?.start?.line || 0) + 1,
            children: [],
          };

          if (depth < maxDepth) {
            try {
              const calls = await lspManager.request(
                direction === 'incoming'
                  ? 'callHierarchy/incomingCalls'
                  : 'callHierarchy/outgoingCalls',
                filePath,
                { item },
                null,
                null,
                10000,
              );

              if (calls && calls.length > 0) {
                const children = await Promise.all(
                  calls.slice(0, 20).map(async (call) => {
                    const childItem = call.from || call;
                    const child = await buildCallTree(childItem, depth + 1);
                    if (child) {
                      // Add caller/callee range info
                      child.fromRanges = (call.fromRanges || []).map((r) => ({
                        start: {
                          line: (r.start?.line || 0) + 1,
                          character: (r.start?.character || 0) + 1,
                        },
                        end: {
                          line: (r.end?.line || 0) + 1,
                          character: (r.end?.character || 0) + 1,
                        },
                      }));
                    }
                    return child;
                  }),
                );
                node.children = children.filter(Boolean);
              }
            } catch {
              // Call hierarchy not supported for this level
            }
          }

          return node;
        };

        const tree = await buildCallTree(rootItem, 1);

        return {
          success: true,
          direction,
          hierarchy: tree,
        };
      },
    },

    // ── lsp_inlay_hints ───────────────────────────────────────────────────
    {
      name: 'lsp_inlay_hints',
      description:
        'Get LSP inlay hints (inline type annotations, parameter names, etc.) for a file or range. ' +
        'Helps understand inferred types and implicit parameters without cluttering source code.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file', required: true },
        startLine: {
          type: 'number',
          description: '1-based start line for range (optional, omit for whole file)',
          min: 1,
        },
        endLine: { type: 'number', description: '1-based end line for range', min: 1 },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const requestParams = { textDocument: { uri: pathToFileURL(filePath).href } };

        if (args.startLine !== undefined && args.endLine !== undefined) {
          requestParams.range = {
            start: { line: args.startLine - 1, character: 0 },
            end: { line: args.endLine - 1, character: 1000 },
          };
        }

        const hintsResult = await withLSPErrorHandling(
          lspManager.request(
            'textDocument/inlayHint',
            filePath,
            requestParams,
            null,
            content,
            10000,
          ),
          { method: 'textDocument/inlayHint', filePath },
        );
        if (!hintsResult.success) {
          return hintsResult;
        }

        const hints = hintsResult.result;
        if (!hints || (Array.isArray(hints) && hints.length === 0)) {
          return { success: true, hints: [], count: 0, message: 'No inlay hints available.' };
        }

        const enriched = (Array.isArray(hints) ? hints : [hints]).map((h) => {
          const hintLine = h.position?.line !== undefined ? h.position.line + 1 : '?';
          const hintLabel =
            typeof h.label === 'string' ? h.label : h.label?.[0]?.value || JSON.stringify(h.label);
          return {
            line: hintLine,
            character: (h.position?.character || 0) + 1,
            label: hintLabel,
            kind: typeof h.kind === 'number' ? inlayHintKindLabel(h.kind) : 'unknown',
            paddingLeft: h.paddingLeft || false,
            paddingRight: h.paddingRight || false,
            tooltip: typeof h.tooltip === 'string' ? h.tooltip : h.tooltip?.value || null,
          };
        });

        return { success: true, hints: enriched, count: enriched.length };
      },
    },

    // ── lsp_folding_ranges ─────────────────────────────────────────────────
    {
      name: 'lsp_folding_ranges',
      description:
        'Get LSP folding ranges for a file. Returns regions that can be folded/collapsed by the editor ' +
        '(imports, comments, code blocks, etc.). Useful for understanding file structure at a glance.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file', required: true },
      },
      required: ['filePath'],
      handler: async (args, ctx) => {
        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const foldResult = await withLSPErrorHandling(
          lspManager.request(
            'textDocument/foldingRange',
            filePath,
            {
              textDocument: { uri: pathToFileURL(filePath).href },
            },
            null,
            content,
            10000,
          ),
          { method: 'textDocument/foldingRange', filePath },
        );
        if (!foldResult.success) {
          return foldResult;
        }

        const folds = foldResult.result;
        if (!folds || folds.length === 0) {
          return { success: true, folds: [], count: 0, message: 'No folding ranges.' };
        }

        const enriched = folds.map((f) => ({
          startLine: (f.startLine || 0) + 1,
          endLine: (f.endLine || 0) + 1,
          kind: typeof f.kind === 'string' ? f.kind : 'region',
          collapsedText: f.collapsedText || null,
        }));

        return {
          success: true,
          folds: enriched,
          count: enriched.length,
          summary: `File has ${enriched.length} foldable regions spanning lines 1-${enriched.reduce((m, f) => Math.max(m, f.endLine), 0)}`,
        };
      },
    },

    // ── lsp_selection_ranges ───────────────────────────────────────────────
    {
      name: 'lsp_selection_ranges',
      description:
        'Get LSP selection ranges for positions in a file. Smart selection expansion returns nested AST-aware ranges ' +
        '(word → expression → statement → block → function). Useful for understanding code structure hierarchy.',
      category: ToolCategory.LSP,
      params: {
        filePath: { type: 'string', description: 'Path to the file', required: true },
        line: { type: 'number', description: '1-based line number', required: true, min: 1 },
        character: {
          type: 'number',
          description: '1-based character position',
          required: true,
          min: 1,
        },
      },
      required: ['filePath', 'line', 'character'],
      handler: async (args, ctx) => {
        const validationErr = validateArgs(args, {
          filePath: { type: 'string', required: true },
          line: { type: 'number', required: true, min: 1 },
          character: { type: 'number', required: true, min: 1 },
        });
        if (validationErr) {
          return { success: false, error: `Invalid parameters: ${validationErr}` };
        }

        let filePath;
        try {
          filePath = safePath(ctx.workingDirectory, args.filePath);
        } catch (err) {
          return { success: false, error: err.message };
        }

        let content;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (err) {
          return { success: false, error: `Failed to read file: ${err.message}` };
        }

        const position = { line: args.line - 1, character: args.character - 1 };

        const selResult = await withLSPErrorHandling(
          lspManager.request(
            'textDocument/selectionRange',
            filePath,
            {
              textDocument: { uri: pathToFileURL(filePath).href },
              positions: [position],
            },
            null,
            content,
            10000,
          ),
          { method: 'textDocument/selectionRange', filePath },
        );
        if (!selResult.success) {
          return selResult;
        }

        const selectionRanges = selResult.result;
        if (!selectionRanges || selectionRanges.length === 0) {
          return { success: true, ranges: [], count: 0, message: 'No selection ranges available.' };
        }

        // 扁平化嵌套范围
        const flatten = (range) => {
          const results = [];
          let current = range;
          while (current) {
            const lines = content.split('\n');
            const startLine = current.range?.start?.line || 0;
            const endLine = current.range?.end?.line || 0;
            const startChar = current.range?.start?.character || 0;
            const endChar = current.range?.end?.character || 0;
            let snippet = '';
            try {
              if (startLine === endLine) {
                const line = lines[startLine] || '';
                snippet = line.substring(startChar, Math.min(endChar, line.length));
              } else {
                snippet = lines
                  .slice(startLine, endLine + 1)
                  .join('\n')
                  .substring(0, 100);
              }
            } catch {
              /* ignore */
            }

            results.push({
              start: { line: startLine + 1, character: startChar + 1 },
              end: { line: endLine + 1, character: endChar + 1 },
              snippet,
            });
            current = current.parent || null;
          }
          return results;
        };

        const ranges = flatten(selectionRanges[0]);

        return {
          success: true,
          position: { line: args.line, character: args.character },
          ranges,
          count: ranges.length,
          hint: 'Ranges are ordered from narrowest to widest (word → expression → statement → block).',
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
            return {
              success: false,
              error: 'oldPath and newPath are required for move/rename_file.',
            };
          }
          const oldPath = safePath(ctx.workingDirectory, args.oldPath);
          const newPath = safePath(ctx.workingDirectory, args.newPath);

          // 通过 LSP workspace/willRenameFiles 请求获取 import 更新
          const renameResult = await lspManager.request(
            'workspace/willRenameFiles',
            filePath,
            {
              files: [{ oldUri: pathToFileURL(oldPath).href, newUri: pathToFileURL(newPath).href }],
            },
            null,
            null,
            20000,
          );

          const changes = {};
          if (renameResult && renameResult.changes) {
            Object.assign(changes, renameResult.changes);
          }
          if (renameResult && renameResult.documentChanges) {
            for (const dc of renameResult.documentChanges) {
              if (dc.textDocument && dc.edits) {
                const uri = dc.textDocument.uri;
                if (!changes[uri]) {
                  changes[uri] = [];
                }
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

          return await applyWorkspaceEdit(
            { changes },
            {
              workingDirectory: ctx.workingDirectory,
              contentStore,
              hashlinePatcher,
              snapshotStore: ctx.snapshotStore,
              lspManager,
            },
          );
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

        return {
          success: false,
          error: `Unknown operation: ${args.operation}. Use move, rename_file, or update_imports.`,
        };
      },
    },
  ];
}

// ── Workspace Edit 应用 ────────────────────────────────────────────────────

function lspTextEditsToHashlinePatch(editsByPath) {
  const lines = [];
  for (const [filePath, { originalContent, edits }] of Object.entries(editsByPath)) {
    const normalized = originalContent.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const tag = computeTag(normalized);
    lines.push(`[${filePath}#${tag}]`);

    const sortedEdits = [...edits].sort((a, b) => {
      if (a.range.start.line !== b.range.start.line) {
        return b.range.start.line - a.range.start.line;
      }
      return b.range.start.character - a.range.start.character;
    });

    let content = normalized;
    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line + 1;
      const endLine = edit.range.end.line + 1;
      const startChar = edit.range.start.character;
      const endChar = edit.range.end.character;

      const contentLines = content.split('\n');
      const startLineContent = contentLines[startLine - 1] || '';

      if (startLine === endLine) {
        const lineContent = contentLines[startLine - 1] || '';
        const oldText = lineContent.substring(startChar, endChar);
        const newText = edit.newText || '';
        if (oldText === '' && newText !== '') {
          lines.push(`INS.PRE ${startLine}=`);
          for (const newLine of newText.split('\n')) {
            lines.push(`+${newLine}`);
          }
        } else if (newText === '' && oldText !== '') {
          const before = startLineContent.substring(0, startChar);
          const after = startLineContent.substring(endChar);
          if (before === '' && after === '') {
            lines.push(`DEL ${startLine}.=${startLine}`);
          } else {
            lines.push(`SWAP ${startLine}.=${startLine}:`);
            const replacement = before + after;
            if (replacement !== '') {
              lines.push(`+${replacement}`);
            }
          }
        } else {
          lines.push(`SWAP ${startLine}.=${startLine}:`);
          for (const newLine of newText.split('\n')) {
            lines.push(`+${newLine}`);
          }
        }
      } else {
        lines.push(`SWAP ${startLine}.=${endLine}:`);
        for (const newLine of edit.newText.split('\n')) {
          lines.push(`+${newLine}`);
        }
      }

      content = applyTextEdits(content, [edit]);
    }
  }
  return lines.join('\n');
}

/**
 * 检测 workspace edit 中的冲突编辑（重叠 TextEdit）。
 * 返回冲突详情列表，空数组表示无冲突。
 *
 * @param {object} editsByPath  { [path]: { edits: TextEdit[] } }
 * @returns {{ path: string, conflicts: Array<{editA: object, editB: object, overlap: object}> }[]}
 */
function detectWorkspaceEditConflicts(editsByPath) {
  const allConflicts = [];

  for (const [filePath, { edits }] of Object.entries(editsByPath)) {
    const conflicts = [];
    const sorted = [...edits]
      .map((e, i) => ({ ...e, _idx: i }))
      .sort(
        (a, b) =>
          a.range.start.line - b.range.start.line ||
          a.range.start.character - b.range.start.character,
      );

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i],
          b = sorted[j];

        // 检查行重叠
        if (b.range.start.line <= a.range.end.line) {
          // 同一行内检查字符重叠
          if (b.range.start.line === a.range.end.line) {
            if (b.range.start.character < a.range.end.character) {
              conflicts.push({
                editA: {
                  start: a.range.start,
                  end: a.range.end,
                  newText: a.newText?.substring(0, 50),
                },
                editB: {
                  start: b.range.start,
                  end: b.range.end,
                  newText: b.newText?.substring(0, 50),
                },
                overlap: {
                  line: a.range.start.line + 1,
                  range: `${a.range.end.character} overlaps with ${b.range.start.character}`,
                },
              });
            }
          } else {
            // 跨行重叠（b 的 start 在 a 的范围内）
            conflicts.push({
              editA: {
                start: a.range.start,
                end: a.range.end,
                newText: a.newText?.substring(0, 50),
              },
              editB: {
                start: b.range.start,
                end: b.range.end,
                newText: b.newText?.substring(0, 50),
              },
              overlap: {
                lineRange: `${a.range.start.line + 1}-${a.range.end.line + 1}`,
                reason: 'editB starts within editA range',
              },
            });
          }
        }
      }
    }

    if (conflicts.length > 0) {
      allConflicts.push({ path: filePath, conflicts });
    }
  }

  return allConflicts;
}

/**
 * 应用 LSP workspace edit（跨文件文本编辑）。
 * 当 hashlinePatcher 可用时，使用 Hashline 进行原子性应用（带 rollback）。
 * @returns {Promise<{success: boolean, filesChanged: string[], filesFailed: string[], totalEdits: number}>}
 */
async function applyWorkspaceEdit(
  workspaceEdit,
  { workingDirectory, contentStore, hashlinePatcher, snapshotStore, lspManager },
) {
  const filesChanged = [];
  const filesFailed = [];
  let totalEdits = 0;

  const editsByPath = {};

  const collectEdits = (uri, edits) => {
    const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
    if (!editsByPath[filePath]) {
      editsByPath[filePath] = { edits: [], originalContent: null };
    }
    editsByPath[filePath].edits.push(...edits);
    totalEdits += edits.length;
  };

  const changes = workspaceEdit.changes || {};
  for (const [uri, edits] of Object.entries(changes)) {
    if (edits.length > 0) {
      collectEdits(uri, edits);
    }
  }

  if (workspaceEdit.documentChanges) {
    for (const dc of workspaceEdit.documentChanges) {
      if (dc.textDocument && dc.edits) {
        collectEdits(dc.textDocument.uri, dc.edits);
      }
    }
  }

  for (const filePath of Object.keys(editsByPath)) {
    try {
      editsByPath[filePath].originalContent = await readFile(filePath, 'utf-8');
    } catch {
      filesFailed.push(`${filePath}: file not found`);
      delete editsByPath[filePath];
    }
  }

  // 冲突检测：在应用编辑前检查是否有重叠 TextEdit
  const editConflicts = detectWorkspaceEditConflicts(editsByPath);
  const hasHardConflicts = editConflicts.some((c) => c.conflicts.length > 0);
  if (hasHardConflicts) {
    return {
      success: false,
      filesChanged: [],
      filesFailed: [],
      totalEdits,
      editConflicts,
      error: `Workspace edit contains ${editConflicts.length} file(s) with overlapping TextEdits. Resolve conflicts first.`,
    };
  }

  if (
    filesFailed.length ===
    Object.keys(workspaceEdit.changes || {}).length + (workspaceEdit.documentChanges || []).length
  ) {
    return { success: false, filesChanged: [], filesFailed, totalEdits: 0 };
  }

  if (hashlinePatcher && Object.keys(editsByPath).length > 0) {
    try {
      const patchText = lspTextEditsToHashlinePatch(editsByPath);
      const preflight = await hashlinePatcher.preflight(patchText);

      const fatalSection = preflight.preflight.find((p) => !p.ok && !p.recoverable);
      if (fatalSection) {
        filesFailed.push(`${fatalSection.path}: preflight failed - ${fatalSection.error}`);
        return { success: false, filesChanged: [], filesFailed, totalEdits };
      }

      const result = await hashlinePatcher.apply(preflight.patch);
      if (!result.ok) {
        if (result.rolledBack) {
          return {
            success: false,
            filesChanged: [],
            filesFailed: [`Workspace edit rolled back: ${result.error}`],
            totalEdits,
            rolledBack: true,
          };
        }
        filesFailed.push(`Workspace edit failed: ${result.error}`);
        return { success: false, filesChanged: [], filesFailed, totalEdits };
      }

      for (const section of result.sections) {
        filesChanged.push(section.path);
        if (contentStore) {
          const blob = contentStore.storeBlob(await readFile(section.path, 'utf-8'));
          contentStore.setRef(`file:${section.path}`, blob);
        }
        if (lspManager) {
          lspManager
            .syncDocument(section.path, await readFile(section.path, 'utf-8'))
            .catch(() => {});
        }
      }

      return {
        success: true,
        filesChanged: [...new Set(filesChanged)],
        filesFailed,
        totalEdits,
        atomic: true,
      };
    } catch (err) {
      return {
        success: false,
        filesChanged: [],
        filesFailed: [`Hashline workspace edit error: ${err.message}`],
        totalEdits,
      };
    }
  }

  // Non-Hashline fallback: 带备份/回滚的逐文件应用
  const backups = new Map();
  const writtenPaths = [];
  let hasFailure = false;

  for (const [filePath, { originalContent, edits }] of Object.entries(editsByPath)) {
    try {
      // 备份原始内容
      backups.set(filePath, originalContent);

      let content = originalContent;
      content = applyTextEdits(content, edits);
      await writeFile(filePath, content, 'utf-8');
      writtenPaths.push(filePath);
      filesChanged.push(filePath);

      if (contentStore) {
        const blob = contentStore.storeBlob(content);
        contentStore.setRef(`file:${filePath}`, blob);
      }
      if (snapshotStore) {
        snapshotStore.record(filePath, content);
      }
      if (lspManager) {
        lspManager.syncDocument(filePath, content).catch(() => {});
      }
    } catch (err) {
      filesFailed.push(`${filePath}: ${err.message}`);
      hasFailure = true;

      // 回滚已写入的文件
      for (const writtenPath of writtenPaths) {
        try {
          await writeFile(writtenPath, backups.get(writtenPath), 'utf-8');
        } catch (rollbackErr) {
          filesFailed.push(`${writtenPath}: rollback failed - ${rollbackErr.message}`);
        }
      }

      return {
        success: false,
        filesChanged: [],
        filesFailed,
        totalEdits,
        rolledBack: true,
      };
    }
  }

  return {
    success: !hasFailure,
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
  contentStore,
  moduleResolver,
  importGraph,
  barrelManager,
} = {}) {
  const synced = [];
  const wd = workingDirectory || process.cwd();

  try {
    // 1) Barrel 导出同步：优先使用 BarrelManager 精确管理，fallback 到简单扫描
    if (barrelManager && moduleResolver) {
      await barrelManager.initialize();
      // 使用 BarrelManager 发现并更新 re-export chain
      const relayBarrels = await barrelManager.discoverBarrels({
        rootDir: wd,
        touchFile: renamedFile,
      });
      for (const barrelPath of relayBarrels) {
        try {
          await barrelManager.updateReExports(barrelPath, {
            renamedFile,
            oldName,
            newName,
          });
          synced.push(`barrel:${barrelPath}`);
          if (lspManager) {
            const updated = await readFile(barrelPath, 'utf-8');
            lspManager.syncDocument(barrelPath, updated).catch(() => {});
          }
        } catch (err) {
          synced.push(`barrel:${barrelPath}:error:${err.message}`);
        }
      }
    } else {
      // Fallback: 简单 regex 扫描 barrel 文件
      const relativePath = relative(wd, renamedFile);
      const fileName = basename(renamedFile);
      const barrelCandidates = findBarrelFiles(wd, renamedFile);
      for (const barrelPath of barrelCandidates) {
        try {
          const barrelContent = await readFile(barrelPath, 'utf-8');
          const updated = updateBarrelExport(
            barrelContent,
            fileName,
            relativePath,
            oldName,
            newName,
          );
          if (updated !== barrelContent) {
            await writeFile(barrelPath, updated, 'utf-8');
            synced.push(`barrel:${barrelPath}`);
            if (lspManager) {
              lspManager.syncDocument(barrelPath, updated).catch(() => {});
            }
          }
        } catch {
          /* skip unreadable barrels */
        }
      }
    }
  } catch (err) {
    synced.push(`barrel:error:${err.message}`);
  }

  // 2) Alias import 同步：优先使用 ModuleResolver 精确解析，fallback 到 tsconfig JSON 解析
  try {
    const aliasResult = await syncAliasImports({
      renamedFile,
      oldName,
      newName,
      workingDirectory: wd,
      lspManager,
      contentStore,
      moduleResolver,
    });
    synced.push(...aliasResult.synced);
  } catch (err) {
    synced.push(`alias:error:${err.message}`);
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
    if (parent === current || !parent.startsWith(workspaceRoot)) {
      break;
    }
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
    const exportNamedRe = new RegExp(
      `(export\\s*\\{[^}]*)\\b${escapeRegex(oldName)}\\b([^}]*\\}\\s*from\\s*['"]\\.\\/?${escapeRegex(nameWithoutExt)}['"])`,
      'g',
    );
    updated = updated.replace(exportNamedRe, `$1${newName}$2`);
  }

  // 匹配: export * from './file' 或 export { default } from './file'
  // 如果文件名变了，更新路径
  if (newNameWithoutExt && nameWithoutExt !== newNameWithoutExt) {
    const exportFromRe = new RegExp(
      `(from\\s*['"]\\.\\/?)${escapeRegex(nameWithoutExt)}(['"])`,
      'g',
    );
    updated = updated.replace(exportFromRe, `$1${newNameWithoutExt}$2`);
  }

  return updated;
}

/**
 * 从 tsconfig.json 解析 paths 别名配置。
 */
async function parseTsconfigPaths(workspaceRoot) {
  const tsconfigPath = resolve(workspaceRoot, 'tsconfig.json');
  const tsconfigBasePath = resolve(workspaceRoot, 'tsconfig.base.json');

  const paths = {};

  for (const configPath of [tsconfigPath, tsconfigBasePath]) {
    try {
      const content = await readFile(configPath, 'utf-8');
      const json = JSON.parse(content);
      if (json.compilerOptions && json.compilerOptions.paths) {
        const baseUrl = json.compilerOptions.baseUrl || '.';
        const basePath = resolve(workspaceRoot, baseUrl);
        for (const [alias, mappings] of Object.entries(json.compilerOptions.paths)) {
          const targetPaths = mappings.map((m) => resolve(basePath, m.replace(/\*/g, '')));
          paths[alias.replace(/\*/g, '')] = targetPaths;
        }
      }
    } catch {
      // skip if file doesn't exist or parse fails
    }
  }

  return paths;
}

/**
 * 更新文件中的 alias import 路径。
 */
function updateAliasImports(content, oldPath, newPath, paths) {
  let updated = content;

  for (const [alias, targetPaths] of Object.entries(paths)) {
    for (const targetPath of targetPaths) {
      if (oldPath.startsWith(targetPath)) {
        // oldPath 在 alias 映射范围内：计算相对后缀
        const suffix = oldPath.substring(targetPath.length);
        // 旧 alias import 路径（import 语句中实际出现的）
        const oldAliasPath = alias + (suffix || '');
        // 新 alias import 路径：newPath 也应在同一 targetPath 下
        const newSuffix = newPath.startsWith(targetPath)
          ? newPath.substring(targetPath.length)
          : newPath;

        // 将旧 alias path 替换为新 alias path（保持 alias 前缀）
        const importRe = new RegExp(`(from\\s*['"])${escapeRegex(oldAliasPath)}(['"])`, 'g');
        const newImportPath = alias + (newSuffix || '');
        updated = updated.replace(importRe, `$1${newImportPath}$2`);
      }
    }
  }

  return updated;
}

/**
 * 同步 alias import 路径。
 */
async function syncAliasImports({
  renamedFile,
  oldName,
  newName,
  workingDirectory,
  lspManager,
  contentStore,
  moduleResolver,
} = {}) {
  const synced = [];
  const wd = workingDirectory || process.cwd();

  try {
    const paths = moduleResolver ? moduleResolver.aliases || {} : await parseTsconfigPaths(wd);
    if (Object.keys(paths).length === 0) {
      return { synced };
    }

    const glob = (await import('glob')).glob;
    const files = await glob('**/*.{ts,tsx,js,jsx,mjs}', {
      cwd: wd,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
    });

    const oldFilePath = renamedFile;
    const newFilePath = renamedFile.replace(
      basename(renamedFile),
      newName || basename(renamedFile),
    );

    for (const file of files) {
      const fullPath = resolve(wd, file);
      if (fullPath === oldFilePath || fullPath === newFilePath) {
        continue;
      }

      try {
        const content = await readFile(fullPath, 'utf-8');
        const updated = updateAliasImports(content, oldFilePath, newFilePath, paths);
        if (updated !== content) {
          await writeFile(fullPath, updated, 'utf-8');
          synced.push(`alias:${fullPath}`);
          if (lspManager) {
            lspManager.syncDocument(fullPath, updated).catch(() => {});
          }
          if (contentStore) {
            contentStore.setRef(`file:${fullPath}`, contentStore.storeBlob(updated));
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
  } catch (err) {
    synced.push(`alias:error:${err.message}`);
  }

  return { synced };
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
        'workspace/executeCommand',
        ctx.workingDirectory,
        {
          command: action.command.command,
          arguments: action.command.arguments || [],
        },
        null,
        null,
        15000,
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
      'codeAction/resolve',
      ctx.workingDirectory,
      action,
      null,
      null,
      10000,
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
  if (!severity) {
    return diags;
  }
  const labels = { error: 1, warning: 2, info: 3, hint: 4 };
  const target = labels[severity.toLowerCase()];
  if (!target) {
    return diags;
  }
  return diags.filter((d) => d.severity === target);
}

function severityLabel(sev) {
  return { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }[sev] || 'unknown';
}

function symbolKindLabel(kind) {
  const map = {
    1: 'file',
    2: 'module',
    3: 'namespace',
    4: 'package',
    5: 'class',
    6: 'method',
    7: 'property',
    8: 'field',
    9: 'constructor',
    10: 'enum',
    11: 'interface',
    12: 'function',
    13: 'variable',
    14: 'constant',
    15: 'string',
    16: 'number',
    17: 'boolean',
    18: 'array',
    19: 'object',
    20: 'key',
    21: 'null',
    22: 'enumMember',
    23: 'struct',
    24: 'event',
    25: 'operator',
    26: 'typeParameter',
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
  if (typeof contents === 'string') {
    return { value: contents };
  }
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
  if (position.line >= lines.length) {
    return 'unknown';
  }
  const line = lines[position.line];
  let start = position.character;
  let end = position.character;
  const idRe = /[a-zA-Z0-9_$]/;
  while (start > 0 && idRe.test(line[start - 1])) {
    start--;
  }
  while (end < line.length && idRe.test(line[end])) {
    end++;
  }
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

function inlayHintKindLabel(kind) {
  const map = { 1: 'type', 2: 'parameter' };
  return map[kind] || `kind_${kind}`;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
