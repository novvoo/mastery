import { describe, test, expect } from 'bun:test';
import { ObservationSummarizer } from '../../src/core/observation-summarizer.js';
import { WorkspaceState } from '../../src/core/workspace-state.js';

describe('ObservationSummarizer', () => {
  test('processToolResult for unknown tool returns default', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('unknown_tool', {}, 'some result');
    expect(result.shouldCache).toBe(true);
    expect(result.summary).toBeDefined();
  });

  test('processToolResult for list_dir with string result', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('list_dir', { path: '/src' }, 'file1.js\nfile2.js\nfile3.js');
    expect(result.summary).toContain('3');
    expect(result.facts.length).toBeGreaterThan(0);
  });

  test('processToolResult for read_file success', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const content = 'function hello() {\n  return "world";\n}';
    const result = os.processToolResult('read_file', { path: '/src/app.js' }, content);
    expect(result.summary).toContain('/src/app.js');
  });

  test('processToolResult for read_file failure', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('read_file', { path: '/missing.js' }, 'Error: No such file');
    expect(result.summary).toContain('missing.js');
  });

  test('processToolResult for write_file success', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('write_file', { path: '/new.js' }, 'success: written');
    expect(result.summary).toContain('成功写入');
  });

  test('processToolResult for glob with array result', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('glob', { pattern: '**/*.js' }, ['a.js', 'b.js', 'c.js']);
    expect(result.summary).toContain('3');
  });

  test('processToolResult for search', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('search', { query: 'hello' }, '---\nfile1.js\n---\nfile2.js\n');
    expect(result.summary).toContain('2');
  });

  test('processToolResult for shell with git status', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    const result = os.processToolResult('shell', { command: 'git status' }, ' M file1.js\n?? new.js');
    expect(result.facts.length).toBeGreaterThan(0);
  });

  test('generateContextSummary returns string', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    ws.recordFileRead('/a.js', true, 'ok');
    const summary = os.generateContextSummary();
    expect(typeof summary).toBe('string');
  });

  test('generateWorkspaceDescription returns description', () => {
    const ws = new WorkspaceState();
    const os = new ObservationSummarizer(ws);
    ws.recordFileRead('/a.js', true, 'ok');
    const desc = os.generateWorkspaceDescription();
    expect(desc).toContain('工作区');
  });
});
