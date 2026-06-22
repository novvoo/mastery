/**
 * Mock LSP Server — 用于测试 LSPClient, ServerManager, lsp-tools，
 * 无需安装真实的语言服务器。
 *
 * 支持：initialize, shutdown, 文档同步, definition, references,
 * rename, diagnostics, formatting, codeAction, hover, symbols
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

/**
 * 在子进程中启动一个 mock LSP server。
 * 通过 stdin/stdout 使用标准 LSP JSON-RPC 协议通信。
 *
 * @returns {import('child_process').ChildProcess}
 */
export function createMockLSPServer() {
  const server = spawn(process.execPath, [
    '-e',
    `
    const { createInterface } = require('readline');
    const rl = createInterface({ input: process.stdin });
    let buffer = Buffer.alloc(0);
    let diagnosticsSent = false;
    let openDocs = new Map();

    function send(data) {
      const content = Buffer.from(JSON.stringify(data), 'utf-8');
      process.stdout.write('Content-Length: ' + content.length + '\\r\\n\\r\\n');
      process.stdout.write(content);
    }

    function respond(id, result) {
      send({ jsonrpc: '2.0', id, result });
    }

    function error(id, code, message) {
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

        // Request from client
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
                },
                serverInfo: { name: 'mock-lsp', version: '1.0.0' },
              });
              // Send initialized notification after a tick
              break;
            case 'textDocument/definition':
              respond(id, [{
                uri: msg.params.textDocument.uri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 10 },
                },
              }]);
              break;
            case 'textDocument/references':
              respond(id, [
                {
                  uri: msg.params.textDocument.uri,
                  range: {
                    start: { line: 2, character: 5 },
                    end: { line: 2, character: 12 },
                  },
                },
                {
                  uri: msg.params.textDocument.uri.replace('.ts', '.test.ts'),
                  range: {
                    start: { line: 5, character: 3 },
                    end: { line: 5, character: 7 },
                  },
                },
              ]);
              break;
            case 'textDocument/prepareRename':
              respond(id, {
                range: {
                  start: { line: 1, character: 5 },
                  end: { line: 1, character: 12 },
                },
                placeholder: 'oldFunction',
              });
              break;
            case 'textDocument/rename':
              respond(id, {
                changes: {
                  [msg.params.textDocument.uri]: [
                    {
                      range: {
                        start: { line: 1, character: 5 },
                        end: { line: 1, character: 12 },
                      },
                      newText: msg.params.newName,
                    },
                  ],
                },
              });
              break;
            case 'textDocument/formatting':
              respond(id, [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 14 },
                  },
                  newText: 'const x = 1;',
                },
              ]);
              break;
            case 'textDocument/codeAction':
              respond(id, [
                {
                  title: 'Fix all auto-fixable problems',
                  kind: 'source.fixAll',
                  edit: {
                    changes: {
                      [msg.params.textDocument.uri]: [
                        {
                          range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 14 },
                          },
                          newText: 'const fixed = true;',
                        },
                      ],
                    },
                  },
                },
                {
                  title: 'Organize imports',
                  kind: 'source.organizeImports',
                  command: {
                    command: 'typescript.organizeImports',
                    arguments: [msg.params.textDocument.uri],
                  },
                },
              ]);
              break;
            case 'textDocument/hover':
              respond(id, {
                contents: {
                  kind: 'markdown',
                  value: '\\\`\\\`\\\`typescript\\nconst x: number\\n\\\`\\\`\\\`\\nA constant value.',
                },
                range: {
                  start: { line: 1, character: 5 },
                  end: { line: 1, character: 6 },
                },
              });
              break;
            case 'textDocument/documentSymbol':
              respond(id, [
                {
                  name: 'MyClass',
                  kind: 5,
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 10, character: 1 },
                  },
                  selectionRange: {
                    start: { line: 0, character: 6 },
                    end: { line: 0, character: 13 },
                  },
                  children: [
                    {
                      name: 'myMethod',
                      kind: 6,
                      range: {
                        start: { line: 2, character: 2 },
                        end: { line: 4, character: 3 },
                      },
                      selectionRange: {
                        start: { line: 2, character: 2 },
                        end: { line: 2, character: 10 },
                      },
                    },
                  ],
                },
              ]);
              break;
            case 'workspace/symbol':
              respond(id, [
                {
                  name: 'MyClass',
                  kind: 5,
                  location: {
                    uri: msg.params.textDocument ? msg.params.textDocument.uri : 'file:///test.ts',
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 7 },
                    },
                  },
                },
              ]);
              break;
            case 'workspace/willRenameFiles':
              respond(id, {
                changes: {
                  'file:///test.ts': [
                    {
                      range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 24 },
                      },
                      newText: "import { x } from './new';",
                    },
                  ],
                },
              });
              break;
            case 'workspace/executeCommand':
              respond(id, { success: true });
              break;
            case 'codeAction/resolve':
              respond(id, {
                ...msg.params,
                edit: {
                  changes: {
                    'file:///test.ts': [
                      {
                        range: {
                          start: { line: 0, character: 0 },
                          end: { line: 0, character: 14 },
                        },
                        newText: 'import { y } from "./mod";',
                      },
                    ],
                  },
                },
              });
              break;
            case 'shutdown':
              respond(id, null);
              break;
            default:
              error(id, -32601, 'Method not found: ' + msg.method);
          }
        }
        // Notification
        else if (msg.method && msg.id === undefined) {
          switch (msg.method) {
            case 'initialized':
              // 发送一个假的诊断
              if (!diagnosticsSent && msg.params) {
                diagnosticsSent = true;
                setTimeout(() => {
                  notify('textDocument/publishDiagnostics', {
                    uri: 'file:///test.ts',
                    diagnostics: [
                      {
                        range: {
                          start: { line: 0, character: 0 },
                          end: { line: 0, character: 10 },
                        },
                        severity: 1,
                        code: 'no-unused-vars',
                        source: 'mock-lsp',
                        message: "'x' is declared but never used.",
                      },
                      {
                        range: {
                          start: { line: 3, character: 5 },
                          end: { line: 3, character: 12 },
                        },
                        severity: 2,
                        code: 'no-explicit-any',
                        source: 'mock-lsp',
                        message: 'Unexpected any. Specify a different type.',
                      },
                    ],
                  });
                }, 50);
              }
              break;
            case 'textDocument/didOpen':
              openDocs.set(msg.params.textDocument.uri, msg.params.textDocument);
              break;
            case 'textDocument/didChange':
              openDocs.set(msg.params.textDocument.uri, {
                ...openDocs.get(msg.params.textDocument.uri),
                version: msg.params.textDocument.version,
              });
              break;
            case 'textDocument/didClose':
              openDocs.delete(msg.params.textDocument.uri);
              break;
            case 'textDocument/didSave':
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
    `,
  ]);

  return server;
}
