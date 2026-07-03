import { describe, test, expect } from 'bun:test';
import { WorkspaceState } from '../../src/core/workspace/workspace-state.js';

describe('WorkspaceState', () => {
  test('constructor initializes empty state', () => {
    const ws = new WorkspaceState();
    expect(ws.checkPathExists('/foo')).toBe('unknown');
    const summary = ws.getSummary();
    expect(summary.trackedFiles).toBe(0);
    expect(summary.trackedDirectories).toBe(0);
  });

  test('recordDirectoryListing tracks directory', () => {
    const ws = new WorkspaceState();
    ws.recordDirectoryListing('/src', ['index.js', 'utils.js']);
    expect(ws.checkPathExists('/src')).toBe('exists');
    expect(ws.checkPathExists('/src/index.js')).toBe('exists');
  });

  test('recordFileRead success tracks file', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/src/app.js', true, 'content');
    expect(ws.checkPathExists('/src/app.js')).toBe('exists');
  });

  test('recordFileRead success infers parent directories exist', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('src/game/Snake.js', true, 'content');

    expect(ws.checkPathExists('src')).toBe('exists');
    expect(ws.checkPathExists('src/game')).toBe('exists');
    expect(ws.checkPathExists('src/game/Snake.js')).toBe('exists');
  });

  test('recordFileRead caches string and empty content snapshots', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/src/app.js', true, 'content');
    ws.recordFileRead('/src/empty.js', true, '');

    expect(ws.getFileSnapshot('/src/app.js').content).toBe('content');
    expect(ws.getFileSnapshot('/src/empty.js').content).toBe('');
  });

  test('recordFileRead failure marks not_found', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/src/missing.js', false, { error: 'not found' });
    expect(ws.checkPathExists('/src/missing.js')).toBe('not_found');
  });

  test('recordFileWrite marks file as exists and clears failedPaths', () => {
    const ws = new WorkspaceState();
    ws.recordPathNotFound('/newfile.js', 'not found');
    expect(ws.checkPathExists('/newfile.js')).toBe('not_found');
    ws.recordFileWrite('/newfile.js');
    expect(ws.checkPathExists('/newfile.js')).toBe('exists');
  });

  test('recordGlobResults marks matched files', () => {
    const ws = new WorkspaceState();
    ws.recordGlobResults('**/*.js', ['src/a.js', 'src/b.js']);
    expect(ws.checkPathExists('src/a.js')).toBe('exists');
  });

  test('checkPathExists returns unknown for untracked', () => {
    const ws = new WorkspaceState();
    expect(ws.checkPathExists('/unknown')).toBe('unknown');
  });

  test('directoryHasEntry checks directory contents', () => {
    const ws = new WorkspaceState();
    ws.recordDirectoryListing('/src', ['app.js', 'utils.js']);
    expect(ws.directoryHasEntry('/src', 'app.js')).toBe(true);
    expect(ws.directoryHasEntry('/src', 'missing.js')).toBe(null);
  });

  test('getPathNotFoundReason returns reason', () => {
    const ws = new WorkspaceState();
    ws.recordPathNotFound('/bad.js', 'file deleted');
    expect(ws.getPathNotFoundReason('/bad.js')).toBe('file deleted');
    expect(ws.getPathNotFoundReason('/ok.js')).toBe(null);
  });

  test('queryFacts finds matching facts', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/src/app.js', true, 'content');
    const facts = ws.queryFacts('app.js');
    expect(facts.length).toBeGreaterThan(0);
  });

  test('getCriticalFacts returns high priority facts', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/src/app.js', true, 'content');
    ws.recordFileRead('/src/missing.js', false, { error: 'not found' });
    const critical = ws.getCriticalFacts();
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((f) => f.priority === 'high')).toBe(true);
  });

  test('predictToolResult predicts failure for not_found path', () => {
    const ws = new WorkspaceState();
    ws.recordPathNotFound('/gone.js', 'deleted');
    const pred = ws.predictToolResult('read_file', { path: '/gone.js' });
    expect(pred.canSkip).toBe(true);
    expect(pred.type).toBe('will_fail');
  });

  test('predictToolResult predicts success for existing path', () => {
    const ws = new WorkspaceState();
    ws.recordFileWrite('/src/app.js');
    const pred = ws.predictToolResult('read_file', { path: '/src/app.js' });
    expect(pred.type).toBe('will_succeed');
    expect(pred.canSkip).toBe(false);
  });

  test('predictToolResult returns cached empty file snapshots', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/src/empty.js', true, '');

    const pred = ws.predictToolResult('read_file', { path: '/src/empty.js' });

    expect(pred.canSkip).toBe(true);
    expect(pred.type).toBe('cached');
    expect(pred.predicted.text).toBe('');
  });

  test('recordToolResult caches empty read and write content', () => {
    const ws = new WorkspaceState();
    ws.recordToolResult('read_file', { path: '/src/read-empty.js' }, { content: '' }, true);
    ws.recordToolResult('write_file', { path: '/src/write-empty.js', content: '' }, '', true);

    expect(ws.getFileSnapshot('/src/read-empty.js').content).toBe('');
    expect(ws.getFileSnapshot('/src/write-empty.js').content).toBe('');
  });

  test('recordToolResult parses string directory listings into workspace facts', () => {
    const ws = new WorkspaceState();

    ws.recordToolResult(
      'list_dir',
      { path: '.' },
      '.agent-data\n.agent-logs\n.agent-memory\ntest',
      true,
    );

    expect(ws.getWorkspaceRootEntries()).toEqual([
      '.agent-data',
      '.agent-logs',
      '.agent-memory',
      'test',
    ]);
    expect(ws.isWorkspaceEmpty()).toBe(true);
  });

  test('recordToolResult missing read marks path not found without caching error text', () => {
    const ws = new WorkspaceState();

    ws.recordToolResult(
      'read_file',
      { path: 'package.json' },
      'Error: File not found: "package.json"',
      false,
    );

    expect(ws.checkPathExists('package.json')).toBe('not_found');
    expect(ws.getFileSnapshot('package.json')).toBe(null);
  });

  test('recordToolResult tolerates circular object results', () => {
    const ws = new WorkspaceState();
    const result = { ok: true };
    result.self = result;

    expect(() => ws.recordToolResult('custom_tool', {}, result, true)).not.toThrow();
  });

  test('predictToolResult for shell with not_found path', () => {
    const ws = new WorkspaceState();
    ws.recordPathNotFound('/gone.js', 'deleted');
    const pred = ws.predictToolResult('shell', { command: 'cat /gone.js' });
    expect(pred.canSkip).toBe(true);
  });

  test('predictToolResult skips redundant mkdir after parent directory was inferred', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('src/game/Snake.js', true, 'content');

    const pred = ws.predictToolResult('shell', { command: "mkdir -p 'src/game'" });

    expect(pred.canSkip).toBe(true);
    expect(pred.type).toBe('redundant_success');
    expect(pred.predicted).toContain('Skipped redundant mkdir');
  });

  test('recordToolResult records successful shell mkdir directories', () => {
    const ws = new WorkspaceState();
    ws.recordToolResult('shell', { command: "mkdir -p 'tests'" }, 'ok', true);

    expect(ws.checkPathExists('tests')).toBe('exists');
  });

  test('predictToolResult returns unknown for unrecognized tool', () => {
    const ws = new WorkspaceState();
    const pred = ws.predictToolResult('unknown_tool', {});
    expect(pred.type).toBe('unknown');
  });

  test('addFact adds manual fact', () => {
    const ws = new WorkspaceState();
    ws.addFact('custom', 'some info', 'high');
    const facts = ws.queryFacts('custom');
    expect(facts.length).toBeGreaterThan(0);
  });

  test('export and import roundtrip', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/a.js', true, 'ok');
    ws.recordPathNotFound('/b.js', 'gone');
    const state = ws.export();
    const ws2 = new WorkspaceState();
    ws2.import(state);
    expect(ws2.checkPathExists('/a.js')).toBe('exists');
    expect(ws2.checkPathExists('/b.js')).toBe('not_found');
  });

  test('clear resets all state', () => {
    const ws = new WorkspaceState();
    ws.recordFileRead('/a.js', true, 'ok');
    ws.clear();
    expect(ws.checkPathExists('/a.js')).toBe('unknown');
  });

  test('_normalizePath handles edge cases', () => {
    const ws = new WorkspaceState();
    expect(ws._normalizePath('')).toBe('');
    expect(ws._normalizePath('/')).toBe('/');
    expect(ws._normalizePath('//foo//bar//')).toBe('/foo/bar');
  });

  test('addFact deduplicates', () => {
    const ws = new WorkspaceState();
    ws.addFact('type1', { x: 1 }, 'high');
    ws.addFact('type1', { x: 1 }, 'high');
    ws.addFact('type1', { x: 2 }, 'high');
    const facts = ws.queryFacts('type1');
    // dedup: same type+value should be one entry
    const type1X1 = facts.filter((f) => JSON.stringify(f.value) === JSON.stringify({ x: 1 }));
    expect(type1X1.length).toBe(1);
  });
});
