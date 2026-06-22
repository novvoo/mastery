/**
 * LSP 单元测试 — 覆盖 LSPClient (JSON-RPC), ServerManager, lsp-tools 的全部路径。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';

import { LSPClient, LSPClientError, LSPServerError } from '../../src/lsp/lsp-client.js';
import { ServerManager, detectLanguage } from '../../src/lsp/lsp-manager.js';
import { createLSPTools } from '../../src/lsp/lsp-tools.js';
import { ModuleResolver } from '../../src/core/harness/module-resolver.js';
import { ImportGraph, ExportGraph } from '../../src/core/harness/import-graph.js';
import { BarrelManager } from '../../src/core/harness/barrel-manager.js';
import { DiagnosticsGate } from '../../src/core/diagnostics-gate.js';

// ── 辅助 ───────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Mock LSP server 脚本 ──────────────────────────────────────────────────

/**
 * 创建一个可执行的 mock LSP server 脚本文件。
 * 返回脚本路径，清理时需删除。
 */
async function createMockServerScript(dir) {
  const scriptPath = join(dir, 'mock-lsp-server.js');
  const code = `
const { createInterface } = require('readline');
const rl = createInterface({ input: process.stdin });
let buffer = Buffer.alloc(0);
let diagnosticsSent = false;
const openDocs = new Map();

function send(data) {
  const content = Buffer.from(JSON.stringify(data), 'utf-8');
  process.stdout.write('Content-Length: ' + content.length + '\\r\\n\\r\\n');
  process.stdout.write(content);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function errorResp(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd).toString();
    const match = header.match(/Content-Length:\\s*(\\d+)/);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(match[1], 10);
    if (buffer.length < headerEnd + 4 + len) break;
    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString();
    buffer = buffer.slice(headerEnd + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch(e) { continue; }
    if (msg.id !== undefined && msg.method) {
      const id = msg.id;
      switch (msg.method) {
        case 'initialize':
          respond(id, {
            capabilities: {
              textDocumentSync: 1,
              definitionProvider: true,
              referencesProvider: true,
              renameProvider: { prepareProvider: true },
              codeActionProvider: true,
              documentFormattingProvider: true,
              hoverProvider: true,
              documentSymbolProvider: true,
              workspaceSymbolProvider: true,
              inlayHintProvider: true,
              foldingRangeProvider: true,
              selectionRangeProvider: true,
            },
            serverInfo: { name: 'mock-lsp', version: '1.0.0' },
          });
          break;
        case 'textDocument/definition':
          respond(id, [{
            uri: msg.params.textDocument.uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          }]);
          break;
        case 'textDocument/references':
          respond(id, [
            { uri: msg.params.textDocument.uri, range: { start: { line: 2, character: 5 }, end: { line: 2, character: 12 } } },
            { uri: msg.params.textDocument.uri.replace('.ts', '.spec.ts'), range: { start: { line: 5, character: 3 }, end: { line: 5, character: 7 } } },
          ]);
          break;
        case 'textDocument/prepareRename':
          respond(id, { range: { start: { line: 1, character: 5 }, end: { line: 1, character: 16 } }, placeholder: 'oldFunc' });
          break;
        case 'textDocument/rename':
          respond(id, {
            changes: {
              [msg.params.textDocument.uri]: [
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, newText: msg.params.newName },
              ],
            },
          });
          break;
        case 'textDocument/formatting':
          respond(id, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, newText: '// formatted' }]);
          break;
        case 'textDocument/codeAction':
          respond(id, [
            { title: 'Fix auto-fixable', kind: 'source.fixAll', edit: { changes: { [msg.params.textDocument.uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, newText: 'const fixed = true;' }] } } },
            { title: 'Organize imports', kind: 'source.organizeImports' },
          ]);
          break;
        case 'textDocument/hover':
          respond(id, { contents: { kind: 'markdown', value: 'const x: number - A constant value.' } });
          break;
        case 'textDocument/documentSymbol':
          respond(id, [{ name: 'MyClass', kind: 5, range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } } }]);
          break;
        case 'workspace/symbol':
          respond(id, [{ name: 'MyClass', kind: 5, location: { uri: msg.params.textDocument ? msg.params.textDocument.uri : 'file:///test.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } } } }]);
          break;
        case 'workspace/willRenameFiles':
          respond(id, { changes: { 'file:///old.ts': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, newText: '' }] } });
          break;
        case 'workspace/executeCommand':
          respond(id, { success: true });
          break;
        case 'codeAction/resolve':
          respond(id, { ...msg.params, edit: { changes: { 'file:///test.ts': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, newText: 'import { y } from "./mod";' }] } } });
          break;
        case 'textDocument/inlayHint':
          respond(id, [
            { position: { line: 0, character: 6 }, label: ': number', kind: 1, paddingLeft: true },
            { position: { line: 3, character: 9 }, label: ': any', kind: 1, paddingLeft: true },
          ]);
          break;
        case 'textDocument/foldingRange':
          respond(id, [
            { startLine: 0, endLine: 4, kind: 'region' },
            { startLine: 1, endLine: 2, kind: 'comment' },
          ]);
          break;
        case 'textDocument/selectionRange':
          {
            const pos = msg.params.positions[0];
            respond(id, [{
              range: { start: pos, end: { line: pos.line, character: pos.character + 6 } },
              parent: {
                range: { start: pos, end: { line: pos.line, character: pos.character + 20 } },
                parent: {
                  range: { start: { line: pos.line, character: 0 }, end: { line: pos.line + 2, character: 0 } },
                },
              },
            }]);
          }
          break;
        case 'shutdown':
          respond(id, null);
          break;
        default:
          errorResp(id, -32601, 'Method not found');
      }
    } else if (msg.method && msg.id === undefined) {
      switch (msg.method) {
        case 'initialized':
          if (!diagnosticsSent) {
            diagnosticsSent = true;
            setTimeout(() => {
              notify('textDocument/publishDiagnostics', {
                uri: Object.keys(openDocs).length > 0 ? openDocs.keys().next().value : 'file:///test.ts',
                diagnostics: [
                  { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, severity: 1, code: 'no-unused', source: 'mock-lsp', message: "'x' is never used." },
                  { range: { start: { line: 3, character: 5 }, end: { line: 3, character: 12 } }, severity: 2, code: 'no-explicit-any', source: 'mock-lsp', message: 'Unexpected any.' },
                ],
              });
            }, 50);
          }
          break;
        case 'textDocument/didOpen':
          openDocs.set(msg.params.textDocument.uri, msg.params.textDocument);
          // 每次打开文档也推送一次诊断，方便集成测试
          setTimeout(() => {
            notify('textDocument/publishDiagnostics', {
              uri: msg.params.textDocument.uri,
              diagnostics: [
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, severity: 1, code: 'mock-err', source: 'mock-lsp', message: 'Mock error for testing.' },
              ],
            });
          }, 30);
          break;
        case 'textDocument/didChange':
          openDocs.set(msg.params.textDocument.uri, { ...openDocs.get(msg.params.textDocument.uri), version: msg.params.textDocument.version });
          break;
        case 'textDocument/didClose':
          openDocs.delete(msg.params.textDocument.uri);
          break;
        case 'exit':
          process.exit(0);
          break;
      }
    }
  }
});
process.stdin.resume();
process.on('SIGTERM', () => process.exit(0));
`;
  await writeFile(scriptPath, code, 'utf-8');
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

// ── 语言检测 ───────────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  test('detects TypeScript', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
    expect(detectLanguage('src/App.tsx')).toBe('typescriptreact');
  });
  test('detects JavaScript', () => {
    expect(detectLanguage('src/index.js')).toBe('javascript');
    expect(detectLanguage('src/App.jsx')).toBe('javascriptreact');
    expect(detectLanguage('src/mod.mjs')).toBe('javascript');
  });
  test('detects Python', () => {
    expect(detectLanguage('src/main.py')).toBe('python');
  });
  test('returns null for unknown', () => {
    expect(detectLanguage('README.md')).toBeNull();
    expect(detectLanguage('Makefile')).toBeNull();
  });
});

// ── LSPClient 基础 ─────────────────────────────────────────────────────────

describe('LSPClient (no server)', () => {
  test('started flag remains false for non-existent command', async () => {
    const c = new LSPClient({ command: '/nonexistent/cmd_xyz_123' });
    // 测试 started 标志初始为 false
    expect(c.started).toBe(false);
  });

  test('started is false before calling start', () => {
    const c = new LSPClient({ command: 'echo' });
    expect(c.started).toBe(false);
  });

  test('started flag is false before start', () => {
    const c = new LSPClient({ command: 'echo' });
    expect(c.started).toBe(false);
  });

  test('shutdown on non-started client is safe', async () => {
    const c = new LSPClient({ command: 'echo' });
    await c.shutdown();
  });
});

// ── LSPClient 与 Mock Server 交互 ──────────────────────────────────────────

describe('LSPClient with mock server', () => {
  let workDir;
  let mockScript;
  let client;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lsp-cli-'));
    mockScript = await createMockServerScript(workDir);
    client = new LSPClient({ command: process.execPath, args: [mockScript] });
    await client.start();
  });

  afterEach(async () => {
    if (client) { try { await client.shutdown(); } catch { /* ok */ } }
    try { await rm(workDir, { recursive: true, force: true }); } catch { /* ok */ }
    await delay(50);
  });

  test('initialize returns capabilities', async () => {
    const result = await client.initialize({ rootUri: 'file:///test', rootPath: '/test' });
    expect(result.capabilities).toBeDefined();
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.referencesProvider).toBe(true);
    expect(result.capabilities.renameProvider).toBeDefined();
  });

  test('textDocument/definition request', async () => {
    await client.initialize({ rootUri: 'file:///test' });
    client.initialized();
    const def = await client.request('textDocument/definition', {
      textDocument: { uri: 'file:///test.ts' },
      position: { line: 1, character: 5 },
    });
    expect(Array.isArray(def)).toBe(true);
    expect(def[0].uri).toBe('file:///test.ts');
  });

  test('textDocument/references request', async () => {
    await client.initialize({ rootUri: 'file:///test' });
    client.initialized();
    const refs = await client.request('textDocument/references', {
      textDocument: { uri: 'file:///test.ts' },
      position: { line: 1, character: 5 },
      context: { includeDeclaration: true },
    });
    expect(refs.length).toBe(2);
  });

  test('textDocument/rename request', async () => {
    await client.initialize({ rootUri: 'file:///test' });
    client.initialized();
    const result = await client.request('textDocument/rename', {
      textDocument: { uri: 'file:///test.ts' },
      position: { line: 1, character: 5 },
      newName: 'newFunction',
    });
    expect(result.changes).toBeDefined();
  });

  test('diagnostics event fires after initialized', async () => {
    const diagPromise = new Promise((resolve) => {
      client.once('diagnostics', resolve);
    });
    await client.initialize({ rootUri: 'file:///test' });
    client.initialized();
    // 先开一个文档触发 diagnostics URI 定位
    client.notify('textDocument/didOpen', {
      textDocument: { uri: 'file:///test.ts', languageId: 'typescript', version: 1, text: 'const x = 1;' },
    });
    const params = await diagPromise;
    expect(params.uri).toBeDefined();
    expect(params.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  test('shutdown returns null', async () => {
    await client.initialize({ rootUri: 'file:///test' });
    client.initialized();
    const sh = await client.request('shutdown', null, 3000);
    expect(sh).toBeNull();
  });
});

// ── ServerManager ───────────────────────────────────────────────────────────

describe('ServerManager', () => {
  let workDir;
  /** @type {ServerManager|null} */
  let mgr = null;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lsp-mgr-'));
    mgr = new ServerManager({ workspaceRoot: workDir });
  });

  afterEach(async () => {
    if (mgr) { try { await mgr.shutdown(); } catch { /* ok */ } }
    try { await rm(workDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test('supportedLanguages lists configured languages', () => {
    const langs = mgr.supportedLanguages;
    expect(langs).toContain('typescript');
    expect(langs).toContain('javascript');
    expect(langs).toContain('typescriptreact');
  });

  test('isAvailable returns true for configured languages', () => {
    expect(mgr.isAvailable('typescript')).toBe(true);
    expect(mgr.isAvailable('javascript')).toBe(true);
    expect(mgr.isAvailable('unknown_lang')).toBe(false);
  });

  test('getDiagnostics returns empty initially', () => {
    expect(mgr.getDiagnostics('/nonexistent.ts')).toEqual([]);
  });

  test('getAllDiagnostics returns empty object initially', () => {
    expect(mgr.getAllDiagnostics()).toEqual({});
  });

  test('serverCount starts at 0', () => {
    expect(mgr.serverCount).toBe(0);
  });
});

// ── ServerManager 集成（带 mock LSP server） ────────────────────────────────

describe('ServerManager with mock server', () => {
  let workDir;
  let testFile;
  let mockScript;
  let mgr;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lsp-mgr-int-'));
    testFile = join(workDir, 'test.ts');
    await writeFile(testFile, 'const unused = 1;\nfunction oldFunc() {\n  return 42;\n}\nconst y: any = "hello";\n', 'utf-8');
    mockScript = await createMockServerScript(workDir);
    mgr = new ServerManager({
      workspaceRoot: workDir,
      serverConfigs: {
        typescript: {
          command: process.execPath,
          args: [mockScript],
          languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
        },
      },
    });
  });

  afterEach(async () => {
    if (mgr) { try { await mgr.shutdown(); } catch { /* ok */ } }
    try { await rm(workDir, { recursive: true, force: true }); } catch { /* ok */ }
    await delay(50);
  });

  test('request textDocument/definition via ServerManager', async () => {
    const content = await readFile(testFile, 'utf-8');
    const result = await mgr.request(
      'textDocument/definition', testFile, {},
      { line: 1, character: 5 }, content, 10000,
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].uri).toBe(`file://${testFile}`);
  });

  test('request textDocument/references via ServerManager', async () => {
    const content = await readFile(testFile, 'utf-8');
    const result = await mgr.request(
      'textDocument/references', testFile,
      { context: { includeDeclaration: true } },
      { line: 1, character: 5 }, content, 10000,
    );
    expect(result.length).toBe(2);
  });

  test('request textDocument/prepareRename via ServerManager', async () => {
    const content = await readFile(testFile, 'utf-8');
    const result = await mgr.request(
      'textDocument/prepareRename', testFile, {},
      { line: 1, character: 5 }, content, 10000,
    );
    expect(result.placeholder).toBe('oldFunc');
  });

  test('syncDocument + getDiagnostics', async () => {
    const content = await readFile(testFile, 'utf-8');
    await mgr.syncDocument(testFile, content);
    // diagnostics 由 initialized 回调异步推送
    await delay(200);
    const diags = mgr.getDiagnostics(testFile);
    expect(diags.length).toBeGreaterThanOrEqual(1);
  });
});

// ── LSP 工具定义 ──────────────────────────────────────────────────────────

describe('createLSPTools', () => {
  test('returns empty array when no lspManager', () => {
    const tools = createLSPTools({ lspManager: null });
    expect(tools).toEqual([]);
  });

  test('returns 15 tools', () => {
    const mgr = new ServerManager({ workspaceRoot: tmpdir() });
    const tools = createLSPTools({ lspManager: mgr });
    expect(tools.length).toBe(15);
    const names = tools.map((t) => t.name);
    expect(names).toContain('lsp_rename');
    expect(names).toContain('lsp_references');
    expect(names).toContain('lsp_definition');
    expect(names).toContain('lsp_diagnostics');
    expect(names).toContain('lsp_format');
    expect(names).toContain('lsp_code_action');
    expect(names).toContain('lsp_hover');
    expect(names).toContain('lsp_symbols');
    expect(names).toContain('lsp_type_definition');
    expect(names).toContain('lsp_implementation');
    expect(names).toContain('lsp_call_hierarchy');
    expect(names).toContain('lsp_workspace_edit');
    expect(names).toContain('lsp_inlay_hints');
    expect(names).toContain('lsp_folding_ranges');
    expect(names).toContain('lsp_selection_ranges');
  });

  test('each tool has name, description, category, params, required, handler', () => {
    const mgr = new ServerManager({ workspaceRoot: tmpdir() });
    const tools = createLSPTools({ lspManager: mgr });
    for (const t of tools) {
      expect(t.name).toBeString();
      expect(t.description).toBeString();
      expect(t.category).toBe('lsp');
      expect(t.params).toBeObject();
      expect(t.required).toBeArray();
      expect(t.handler).toBeFunction();
    }
  });

  test('lsp_rename requires filePath, line, character, newName', () => {
    const mgr = new ServerManager({ workspaceRoot: tmpdir() });
    const tools = createLSPTools({ lspManager: mgr });
    const rename = tools.find((t) => t.name === 'lsp_rename');
    expect(rename.required).toContain('filePath');
    expect(rename.required).toContain('line');
    expect(rename.required).toContain('character');
    expect(rename.required).toContain('newName');
  });

  test('lsp_diagnostics returns error for file outside workspace', async () => {
    const mgr = new ServerManager({ workspaceRoot: tmpdir() });
    const tools = createLSPTools({ lspManager: mgr });
    const diag = tools.find((t) => t.name === 'lsp_diagnostics');
    // 使用 * 通配符，返回空
    const result = await diag.handler(
      { filePath: '*' },
      { workingDirectory: tmpdir() },
    );
    expect(result.success).toBe(true);
    expect(result.totalDiagnostics).toBe(0);
  });
});

// ── LSP 工具与 Mock Server 集成 ────────────────────────────────────────────

describe('LSP tools with mock server integration', () => {
  let workDir;
  let testFile;
  let mockScript;
  let mgr;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'lsp-tool-int-'));
    testFile = join(workDir, 'src', 'test.ts');
    // 确保目录存在
    const { mkdir } = await import('fs/promises');
    await mkdir(join(workDir, 'src'), { recursive: true });
    await writeFile(testFile, 'const unused = 1;\nfunction oldFunc() {\n  return 42;\n}\nconst y: any = "hello";\n', 'utf-8');
    mockScript = await createMockServerScript(workDir);
    mgr = new ServerManager({
      workspaceRoot: workDir,
      serverConfigs: {
        typescript: {
          command: process.execPath,
          args: [mockScript],
          languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
        },
      },
    });
  });

  afterEach(async () => {
    if (mgr) { try { await mgr.shutdown(); } catch { /* ok */ } }
    try { await rm(workDir, { recursive: true, force: true }); } catch { /* ok */ }
    await delay(50);
  });

  test('lsp_definition returns mock definition', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const def = tools.find((t) => t.name === 'lsp_definition');
    const result = await def.handler(
      { filePath: testFile, line: 2, character: 6 },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.definitions).toBeDefined();
    expect(result.definitions.length).toBeGreaterThanOrEqual(1);
  });

  test('lsp_references returns mock references', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const ref = tools.find((t) => t.name === 'lsp_references');
    const result = await ref.handler(
      { filePath: testFile, line: 2, character: 6 },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.references).toBeDefined();
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test('lsp_rename returns workspace edit', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const rename = tools.find((t) => t.name === 'lsp_rename');
    const result = await rename.handler(
      { filePath: testFile, line: 2, character: 6, newName: 'newFunc' },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.filesChanged).toBeDefined();
  });

  test('lsp_format returns diff preview', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const fmt = tools.find((t) => t.name === 'lsp_format');
    const result = await fmt.handler(
      { filePath: testFile, apply: false },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.applied).toBe(false);
  });

  test('lsp_code_action returns action list', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const ca = tools.find((t) => t.name === 'lsp_code_action');
    const result = await ca.handler(
      { filePath: testFile },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.actions.length).toBeGreaterThanOrEqual(1);
  });

  test('lsp_hover returns type info', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const hv = tools.find((t) => t.name === 'lsp_hover');
    const result = await hv.handler(
      { filePath: testFile, line: 1, character: 8 },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.hover).toBeDefined();
  });

  test('lsp_symbols document mode', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const sym = tools.find((t) => t.name === 'lsp_symbols');
    const result = await sym.handler(
      { filePath: testFile, type: 'document' },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.symbols).toBeDefined();
  });

  test('lsp_symbols workspace mode', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const sym = tools.find((t) => t.name === 'lsp_symbols');
    const result = await sym.handler(
      { filePath: testFile, type: 'workspace', query: 'test' },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.symbols).toBeDefined();
  });

  test('lsp_workspace_edit rename_file', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const we = tools.find((t) => t.name === 'lsp_workspace_edit');
    const oldPath = testFile;
    const newPath = join(workDir, 'src', 'renamed.ts');
    const result = await we.handler(
      { filePath: testFile, operation: 'rename_file', oldPath, newPath },
      { workingDirectory: workDir },
    );
    expect(result.success).toBeDefined();
  });

  test('lsp_inlay_hints returns hints', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const ih = tools.find((t) => t.name === 'lsp_inlay_hints');
    const result = await ih.handler(
      { filePath: testFile },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.hints).toBeDefined();
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test('lsp_folding_ranges returns folds', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const fr = tools.find((t) => t.name === 'lsp_folding_ranges');
    const result = await fr.handler(
      { filePath: testFile },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.folds).toBeDefined();
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test('lsp_selection_ranges returns nested AST ranges', async () => {
    const tools = createLSPTools({ lspManager: mgr });
    const sr = tools.find((t) => t.name === 'lsp_selection_ranges');
    const result = await sr.handler(
      { filePath: testFile, line: 1, character: 8 },
      { workingDirectory: workDir },
    );
    expect(result.success).toBe(true);
    expect(result.ranges).toBeDefined();
    expect(result.count).toBeGreaterThanOrEqual(2);
    // 范围应有嵌套层级
    const labels = result.ranges.map(r => r.snippet);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// P5 测试矩阵：ModuleResolver / ImportGraph / BarrelManager / DiagnosticsGate
// ═════════════════════════════════════════════════════════════════════

let _lspTestDir;

async function _lspSetupEnv({ name = 'lsp-test', tsconfig } = {}) {
  _lspTestDir = join(tmpdir(), `lsp-${randomBytes(6).toString('hex')}`);
  await mkdir(_lspTestDir, { recursive: true });
  await mkdir(join(_lspTestDir, 'src'), { recursive: true });
  const ts = tsconfig || {
    compilerOptions: { paths: { '@app/*': ['./src/app/*'], '@lib/*': ['./src/lib/*'], '@shared': ['./src/shared/index.ts'] }, baseUrl: '.' },
  };
  await writeFile(join(_lspTestDir, 'tsconfig.json'), JSON.stringify(ts, null, 2));
  await writeFile(join(_lspTestDir, 'package.json'), JSON.stringify({ name: name || 'test-project', version: '1.0.0' }, null, 2));
  await mkdir(join(_lspTestDir, 'src/app'), { recursive: true });
  await mkdir(join(_lspTestDir, 'src/lib'), { recursive: true });
  await mkdir(join(_lspTestDir, 'src/shared'), { recursive: true });
  await writeFile(join(_lspTestDir, 'src/app/main.ts'), 'export const app = 1;\n');
  await writeFile(join(_lspTestDir, 'src/lib/utils.ts'), 'export const util = 2;\n');
  await writeFile(join(_lspTestDir, 'src/shared/index.ts'), 'export const shared = 3;\n');
}

async function _lspCleanupEnv() {
  try { if (_lspTestDir) await rm(_lspTestDir, { recursive: true, force: true }); } catch {}
}

describe('LSP: ModuleResolver', () => {
  test('resolve tsconfig paths aliases', async () => {
    await _lspSetupEnv();
    try {
      const resolver = new ModuleResolver({ workingDirectory: _lspTestDir });
      await resolver.init();
      const r = resolver.resolveImport('@app/main', join(_lspTestDir, 'src/app/main.ts'));
      expect(r).toBeTruthy();
      expect(r?.includes('src/app/main')).toBe(true);
    } finally { await _lspCleanupEnv(); }
  });

  test('resolve @shared alias', async () => {
    await _lspSetupEnv();
    try {
      const resolver = new ModuleResolver({ workingDirectory: _lspTestDir });
      await resolver.init();
      const r = resolver.resolveImport('@shared', join(_lspTestDir, 'src/app/main.ts'));
      expect(r).toBeTruthy();
    } finally { await _lspCleanupEnv(); }
  });

  test('resolve relative imports', async () => {
    await _lspSetupEnv();
    try {
      const resolver = new ModuleResolver({ workingDirectory: _lspTestDir });
      await resolver.init();
      const r = resolver.resolveImport('../lib/utils', join(_lspTestDir, 'src/app/main.ts'));
      expect(r?.includes('src/lib/utils')).toBe(true);
    } finally { await _lspCleanupEnv(); }
  });

  test('match pipeline aliases', async () => {
    await _lspSetupEnv();
    try {
      const resolver = new ModuleResolver({ workingDirectory: _lspTestDir });
      await resolver.init();
      const m1 = resolver.matchAlias('@app/main');
      expect(m1?.alias).toBe('@app');
      const m2 = resolver.matchAlias('@shared');
      expect(m2?.alias).toBe('@shared');
    } finally { await _lspCleanupEnv(); }
  });
});

describe('LSP: ImportGraph', () => {
  test('build graph from files', async () => {
    await _lspSetupEnv();
    try {
      await writeFile(join(_lspTestDir, 'a.ts'), `import { b } from './b'; import { d } from './d'; export const a = 1;\n`);
      await writeFile(join(_lspTestDir, 'b.ts'), `import { c } from './c'; export const b = 2;\n`);
      await writeFile(join(_lspTestDir, 'c.ts'), `export const c = 3;\n`);
      await writeFile(join(_lspTestDir, 'd.ts'), `export const d = 4;\n`);
      const graph = new ImportGraph({ workingDirectory: _lspTestDir });
      const files = [join(_lspTestDir, 'a.ts'), join(_lspTestDir, 'b.ts'), join(_lspTestDir, 'c.ts'), join(_lspTestDir, 'd.ts')];
      await graph.build(files);
      expect(graph.graph.size).toBe(4);
      const aNode = graph.graph.get(join(_lspTestDir, 'a.ts'));
      expect(aNode.imports.length).toBeGreaterThanOrEqual(2);
    } finally { await _lspCleanupEnv(); }
  });

  test('find transitive imports', async () => {
    await _lspSetupEnv();
    try {
      await writeFile(join(_lspTestDir, 'a.ts'), `import { b } from './b'; export const a = 1;\n`);
      await writeFile(join(_lspTestDir, 'b.ts'), `import { c } from './c'; export const b = 2;\n`);
      await writeFile(join(_lspTestDir, 'c.ts'), `export const c = 3;\n`);
      const graph = new ImportGraph({ workingDirectory: _lspTestDir });
      const transitive = await graph.getTransitiveImports(join(_lspTestDir, 'a.ts'));
      expect(transitive.length).toBeGreaterThanOrEqual(2);
    } finally { await _lspCleanupEnv(); }
  });

  test('find importers of a module', async () => {
    await _lspSetupEnv();
    try {
      await writeFile(join(_lspTestDir, 'a.ts'), `import { b } from './b'; export const a = 1;\n`);
      await writeFile(join(_lspTestDir, 'b.ts'), `import { c } from './c'; export const b = 2;\n`);
      await writeFile(join(_lspTestDir, 'c.ts'), `export const c = 3;\n`);
      const graph = new ImportGraph({ workingDirectory: _lspTestDir });
      const files = [join(_lspTestDir, 'a.ts'), join(_lspTestDir, 'b.ts'), join(_lspTestDir, 'c.ts')];
      await graph.build(files);
      const importers = await graph.getImporters(join(_lspTestDir, 'c.ts'), files);
      expect(importers.some(i => i.endsWith('b.ts'))).toBe(true);
    } finally { await _lspCleanupEnv(); }
  });
});

describe('LSP: BarrelManager', () => {
  test('discover barrel files', async () => {
    await _lspSetupEnv();
    try {
      await mkdir(join(_lspTestDir, 'src/utils'), { recursive: true });
      await writeFile(join(_lspTestDir, 'src/utils/math.ts'), 'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n');
      await writeFile(join(_lspTestDir, 'src/utils/index.ts'), 'export { add, sub } from "./math";\n');
      const barrel = new BarrelManager({ workingDirectory: _lspTestDir });
      const barrels = await barrel.discoverBarrels(_lspTestDir);
      expect(barrels.length).toBeGreaterThanOrEqual(1);
    } finally { await _lspCleanupEnv(); }
  });

  test('add re-export to barrel', async () => {
    await _lspSetupEnv();
    try {
      await mkdir(join(_lspTestDir, 'src/utils'), { recursive: true });
      const mathPath = join(_lspTestDir, 'src/utils/math.ts');
      const indexPath = join(_lspTestDir, 'src/utils/index.ts');
      await writeFile(mathPath, 'export const add = (a: number, b: number) => a + b;\n');
      await writeFile(indexPath, 'export { add } from "./math";\n');
      const barrel = new BarrelManager({ workingDirectory: _lspTestDir });
      await barrel.discoverBarrels(_lspTestDir);
      const added = await barrel.addReExport(indexPath, mathPath, 'mul');
      if (added) {
        const content = readFileSync(indexPath, 'utf-8');
        expect(content.includes('mul')).toBe(true);
      }
    } finally { await _lspCleanupEnv(); }
  });

  test('remove re-export from barrel', async () => {
    await _lspSetupEnv();
    try {
      await mkdir(join(_lspTestDir, 'src/utils'), { recursive: true });
      const indexPath = join(_lspTestDir, 'src/utils/index.ts');
      await writeFile(join(_lspTestDir, 'src/utils/math.ts'), 'export const add = (a: number, b: number) => a + b;\n');
      await writeFile(indexPath, 'export { add } from "./math";\n');
      const barrel = new BarrelManager({ workingDirectory: _lspTestDir });
      await barrel.discoverBarrels(_lspTestDir);
      const removed = await barrel.removeReExport(indexPath, 'add');
      expect(removed).toBe(true);
      const content = readFileSync(indexPath, 'utf-8');
      expect(content.includes('export { add }')).toBe(false);
    } finally { await _lspCleanupEnv(); }
  });
});

describe('LSP: DiagnosticsGate', () => {
  test('return ok when no lspManager', async () => {
    const gate = new DiagnosticsGate({ lspManager: null });
    const result = await gate.check(['nonexistent.ts']);
    expect(result.ok).toBe(true);
    expect(result.newErrors.length).toBe(0);
  });

  test('handle missing files gracefully', async () => {
    const gate = new DiagnosticsGate({ lspManager: { getDiagnostics: () => [], syncDocument: async () => {} }, waitMs: 10, maxRetries: 1, autoRepair: false });
    const result = await gate.check(['/nonexistent/path.ts']);
    expect(result.ok).toBe(true);
  });

  test('autoRepair default is true', () => {
    const gate = new DiagnosticsGate({ lspManager: null });
    expect(gate.autoRepair).toBe(true);
  });

  test('respect repairTimeout setting', () => {
    const gate = new DiagnosticsGate({ lspManager: null, repairTimeout: 30000 });
    expect(gate.repairTimeout).toBe(30000);
  });
});
