import { describe, expect, test } from 'bun:test';
import {
  describeToolActivity,
  describeToolProgress,
  summarizeActivityForCLI,
} from '../../src/core/tool-activity.js';

describe('tool-activity integration', () => {
  // --- describeToolActivity comprehensive ---

  describe('describeToolActivity', () => {
    test('classifies write tools', () => {
      const activity = describeToolActivity('write_file', { path: 'out.txt' }, 'running');
      expect(activity.intent).toBe('write');
      expect(activity.target).toBe('out.txt');
      expect(activity.statusText).toContain('正在写入');
    });

    test('classifies delete tools', () => {
      const activity = describeToolActivity('delete_file', { file: 'old.txt' }, 'running');
      expect(activity.intent).toBe('delete');
      expect(activity.target).toBe('old.txt');
    });

    test('classifies review tools', () => {
      const activity = describeToolActivity('review', { path: 'code.js' }, 'running');
      expect(activity.intent).toBe('review');
    });

    test('classifies interaction tools', () => {
      const activity = describeToolActivity('ask_user', {}, 'running');
      expect(activity.intent).toBe('interaction');
      expect(activity.requiresInteraction).toBe(true);
    });

    test('classifies git_ prefixed tools as version_control', () => {
      const activity = describeToolActivity('git_commit', { path: 'a.js' }, 'completed');
      expect(activity.intent).toBe('version_control');
    });

    test('classifies web/browser tools as browse', () => {
      const activity = describeToolActivity('web_search', { query: 'test' }, 'running');
      expect(activity.intent).toBe('browse');
    });

    test('falls back to "tool" intent for unknown tools', () => {
      const activity = describeToolActivity('custom_tool', {}, 'running');
      expect(activity.intent).toBe('tool');
    });

    test('normalizePhase maps success→completed', () => {
      const activity = describeToolActivity('read_file', { path: 'a.js' }, 'success');
      expect(activity.phase).toBe('completed');
    });

    test('normalizePhase maps error→failed', () => {
      const activity = describeToolActivity('read_file', { path: 'a.js' }, 'error');
      expect(activity.phase).toBe('failed');
    });

    test('normalizePhase keeps waiting phase', () => {
      const activity = describeToolActivity('ask_user', {}, 'waiting');
      expect(activity.phase).toBe('waiting');
    });

    test('normalizePhase defaults unknown to running', () => {
      const activity = describeToolActivity('read_file', { path: 'a.js' }, 'unknown_phase');
      expect(activity.phase).toBe('running');
    });

    test('canReview is true for completed write/edit/delete/version_control', () => {
      for (const tool of ['write_file', 'edit_file', 'delete_file', 'git_commit']) {
        const a = describeToolActivity(tool, { path: 'x' }, 'completed');
        expect(a.canReview).toBe(true);
      }
    });

    test('canReview is false for read or running phase', () => {
      const read = describeToolActivity('read_file', { path: 'x' }, 'completed');
      expect(read.canReview).toBe(false);
      const writeRunning = describeToolActivity('write_file', { path: 'x' }, 'running');
      expect(writeRunning.canReview).toBe(false);
    });

    test('canUndo is true for completed write/edit/delete', () => {
      for (const tool of ['write_file', 'edit_file', 'delete_file']) {
        const a = describeToolActivity(tool, { path: 'x' }, 'completed');
        expect(a.canUndo).toBe(true);
      }
    });

    test('canUndo is false for version_control', () => {
      const a = describeToolActivity('git_commit', { path: 'x' }, 'completed');
      expect(a.canUndo).toBe(false);
    });

    // Shell command intent classification
    test('shell: npm test → verify', () => {
      const a = describeToolActivity('shell', { command: 'npm test' }, 'running');
      expect(a.intent).toBe('verify');
    });

    test('shell: pytest → verify', () => {
      const a = describeToolActivity('shell', { command: 'pytest tests/' }, 'running');
      expect(a.intent).toBe('verify');
    });

    test('shell: bun run lint → verify', () => {
      const a = describeToolActivity('shell', { command: 'bun run lint' }, 'running');
      expect(a.intent).toBe('verify');
    });

    test('shell: sed replacement → edit', () => {
      // The regex requires (>|writeFile|fs\.writeFile|replace\(|rename\(|unlink\(|rm\s+-|mv\s+) after sed
      const a = describeToolActivity(
        'shell',
        { command: "sed 's/old/new/g' > output.txt" },
        'running',
      );
      expect(a.intent).toBe('edit');
    });

    test('shell: cat → read', () => {
      const a = describeToolActivity('shell', { command: 'cat README.md' }, 'running');
      expect(a.intent).toBe('read');
    });

    test('shell: git diff → review', () => {
      const a = describeToolActivity('shell', { command: 'git diff HEAD~1' }, 'running');
      expect(a.intent).toBe('review');
    });

    test('shell: git add → version_control', () => {
      const a = describeToolActivity('shell', { command: 'git add .' }, 'running');
      expect(a.intent).toBe('version_control');
    });

    test('shell: arbitrary command → command', () => {
      const a = describeToolActivity('shell', { command: 'echo hello' }, 'running');
      expect(a.intent).toBe('command');
    });

    test('shell: empty command → command', () => {
      const a = describeToolActivity('shell', { command: '' }, 'running');
      expect(a.intent).toBe('command');
    });

    // Shell target extraction
    test('shell target extracts file from cat command', () => {
      const a = describeToolActivity('shell', { command: 'cat src/app.js' }, 'running');
      expect(a.target).toContain('app.js');
    });

    test('shell target extracts directory from cd', () => {
      const a = describeToolActivity('shell', { command: 'cd /tmp/project' }, 'running');
      expect(a.target).toBe('/tmp/project');
    });

    // inferTarget from args
    test('inferTarget picks query arg', () => {
      const a = describeToolActivity('search', { query: 'find me' }, 'running');
      expect(a.target).toBe('find me');
    });

    test('inferTarget picks url arg', () => {
      const a = describeToolActivity('web_fetch', { url: 'https://example.com' }, 'running');
      expect(a.target).toBe('https://example.com');
    });

    test('inferTarget picks pattern arg', () => {
      const a = describeToolActivity('glob', { pattern: '*.js' }, 'running');
      expect(a.target).toBe('*.js');
    });

    // inferCounts
    test('inferCounts from git diff output', () => {
      const result = '3 files changed, 42 insertions(+), 10 deletions(-)';
      const a = describeToolActivity('shell', { command: 'git diff' }, 'completed', result);
      expect(a.counts).toEqual({ files: 3, additions: 42, deletions: 10 });
    });

    test('inferCounts returns null for non-string result', () => {
      const a = describeToolActivity('read_file', { path: 'a.js' }, 'completed', { content: 'hi' });
      expect(a.counts).toBeNull();
    });

    // Activity labels in Chinese
    test('completed activity labels in Chinese', () => {
      const a = describeToolActivity('edit_file', { path: 'a.js' }, 'completed');
      expect(a.statusText).toContain('已编辑');
    });

    test('failed activity labels in Chinese', () => {
      const a = describeToolActivity('write_file', { path: 'a.js' }, 'failed');
      expect(a.statusText).toContain('写入失败');
    });

    test('waiting activity label', () => {
      const a = describeToolActivity('ask_user', {}, 'waiting');
      expect(a.statusText).toContain('等待');
    });
  });

  // --- describeToolProgress ---

  describe('describeToolProgress', () => {
    test('creates a progress activity with clamped progress', () => {
      const p = describeToolProgress('read_file', { path: 'a.js' }, 75, null);
      expect(p.kind).toBe('tool_activity');
      expect(p.phase).toBe('running');
      expect(p.progress).toBe(75);
      expect(p.intent).toBe('read');
      expect(p.target).toBe('a.js');
    });

    test('clamps progress to 0-100 range', () => {
      const over = describeToolProgress('read_file', {}, 150);
      expect(over.progress).toBe(100);

      const under = describeToolProgress('read_file', {}, -10);
      expect(under.progress).toBe(0);
    });

    test('uses custom statusText when provided', () => {
      const p = describeToolProgress('shell', { command: 'npm test' }, 50, 'Running tests...');
      expect(p.statusText).toBe('Running tests...');
    });

    test('generates default statusText from progress percent', () => {
      const p = describeToolProgress('read_file', {}, 33);
      expect(p.statusText).toContain('33%');
    });

    test('has a timestamp', () => {
      const before = Date.now();
      const p = describeToolProgress('read_file', {}, 0);
      const after = Date.now();
      expect(p.timestamp).toBeGreaterThanOrEqual(before);
      expect(p.timestamp).toBeLessThanOrEqual(after);
    });

    test('has consistent id with same tool+args', () => {
      const p1 = describeToolProgress('read_file', { path: 'a.js' }, 0);
      const p2 = describeToolActivity('read_file', { path: 'a.js' }, 'running');
      expect(p1.id).toBe(p2.id);
    });
  });

  // --- summarizeActivityForCLI ---

  describe('summarizeActivityForCLI', () => {
    test('returns empty string for null/undefined', () => {
      expect(summarizeActivityForCLI(null)).toBe('');
      expect(summarizeActivityForCLI(undefined)).toBe('');
    });

    test('prefixes completed with "done"', () => {
      const activity = describeToolActivity('edit_file', { path: 'a.js' }, 'completed');
      const summary = summarizeActivityForCLI(activity);
      expect(summary).toMatch(/^done:/);
    });

    test('prefixes failed with "failed"', () => {
      const activity = describeToolActivity('write_file', { path: 'a.js' }, 'failed');
      const summary = summarizeActivityForCLI(activity);
      expect(summary).toMatch(/^failed:/);
    });

    test('prefixes waiting with "waiting"', () => {
      const activity = describeToolActivity('ask_user', {}, 'waiting');
      const summary = summarizeActivityForCLI(activity);
      expect(summary).toMatch(/^waiting:/);
    });

    test('prefixes running with "doing"', () => {
      const activity = describeToolActivity('read_file', { path: 'a.js' }, 'running');
      const summary = summarizeActivityForCLI(activity);
      expect(summary).toMatch(/^doing:/);
    });

    test('falls back to title when statusText is missing', () => {
      const activity = { phase: 'running', statusText: '', title: 'Custom Title' };
      const summary = summarizeActivityForCLI(activity);
      expect(summary).toContain('Custom Title');
    });
  });
});
