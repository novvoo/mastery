import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createAgentSessionId,
  getAgentSessionTitle,
  findAgentSession,
  upsertAgentSession,
  saveAgentInputHistory,
  normalizeRagDocuments,
  mergeRagDocuments,
  getDocumentDisplayName,
  createAgentErrorPrompt,
  createFileSystemStorageAdapter,
  MAX_AGENT_HISTORY_ITEMS,
  MAX_AGENT_SESSIONS,
} from '../../src/core/session/session-store.js';

describe('session-store (src/core)', () => {
  test('createAgentSessionId generates unique IDs', () => {
    const id1 = createAgentSessionId();
    const id2 = createAgentSessionId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^session_\d+_/);
  });

  test('getAgentSessionTitle derives from input', () => {
    expect(getAgentSessionTitle('Fix the bug')).toBe('Fix the bug');
    expect(getAgentSessionTitle('A'.repeat(100))).toBe('A'.repeat(80));
    expect(getAgentSessionTitle('')).toBe('未命名会话');
    expect(getAgentSessionTitle(0)).toBe('0');
    expect(getAgentSessionTitle(null, [{ content: '用户输入: Hello' }])).toBe('Hello');
  });

  test('findAgentSession finds by ID', () => {
    const sessions = [
      { id: 's1', messages: [] },
      { id: 's2', messages: [] },
    ];
    expect(findAgentSession(sessions, 's1').id).toBe('s1');
    expect(findAgentSession(sessions, 's3')).toBeNull();
    expect(findAgentSession([], 's1')).toBeNull();
    expect(findAgentSession(null, 's1')).toBeNull();
  });

  test('upsertAgentSession adds and updates', () => {
    const sessions = [];
    const updated = upsertAgentSession(sessions, { id: 's1', messages: [] });
    expect(updated.length).toBe(1);
    expect(updated[0].id).toBe('s1');

    const updated2 = upsertAgentSession(updated, { id: 's1', messages: [{ content: 'hi' }] });
    expect(updated2.length).toBe(1);
    expect(updated2[0].messages.length).toBe(1);
  });

  test('upsertAgentSession preserves createdAt when updating an existing session', () => {
    const sessions = [
      {
        id: 's1',
        createdAt: 100,
        updatedAt: 150,
        messages: [{ content: 'old' }],
      },
    ];

    const updated = upsertAgentSession(sessions, {
      id: 's1',
      updatedAt: 300,
      messages: [{ content: 'new' }],
    });

    expect(updated[0].createdAt).toBe(100);
    expect(updated[0].updatedAt).toBe(300);
    expect(updated[0].messages[0].content).toBe('new');
  });

  test('upsertAgentSession preserves explicit zero timestamps', () => {
    const updated = upsertAgentSession([], {
      id: 's-zero',
      createdAt: 0,
      updatedAt: 0,
      messages: [],
    });

    expect(updated[0].createdAt).toBe(0);
    expect(updated[0].updatedAt).toBe(0);
  });

  test('upsertAgentSession respects MAX_AGENT_SESSIONS', () => {
    const sessions = Array.from({ length: MAX_AGENT_SESSIONS }, (_, i) => ({
      id: `s${i}`,
      messages: [],
    }));
    const updated = upsertAgentSession(sessions, { id: 'new', messages: [] });
    expect(updated.length).toBe(MAX_AGENT_SESSIONS);
    expect(updated[0].id).toBe('new');
  });

  test('saveAgentInputHistory deduplicates', () => {
    const history = [{ input: 'hello', timestamp: 1 }];
    const updated = saveAgentInputHistory(history, 'hello', 's1');
    expect(updated.length).toBe(1);
    expect(updated[0].timestamp).toBeGreaterThan(0);
  });

  test('saveAgentInputHistory preserves numeric zero input', () => {
    const updated = saveAgentInputHistory([], 0, 's1');
    expect(updated.length).toBe(1);
    expect(updated[0].input).toBe('0');
  });

  test('saveAgentInputHistory respects MAX_AGENT_HISTORY_ITEMS', () => {
    const history = Array.from({ length: MAX_AGENT_HISTORY_ITEMS }, (_, i) => ({
      input: `cmd${i}`,
      timestamp: i,
    }));
    const updated = saveAgentInputHistory(history, 'new_cmd', 's1');
    expect(updated.length).toBe(MAX_AGENT_HISTORY_ITEMS);
    expect(updated[0].input).toBe('new_cmd');
  });

  test('normalizeRagDocuments normalizes document structure', () => {
    const docs = [
      { id: 'd1', title: 'Test', source: '/path/to/test.md', kind: 'file', chunks: 5, chars: 1000 },
    ];
    const result = normalizeRagDocuments(docs);
    expect(result[0].name).toBe('Test');
    expect(result[0].path).toBe('/path/to/test.md');
    expect(result[0].indexed).toBe(true);
  });

  test('mergeRagDocuments deduplicates by id', () => {
    const current = [
      { id: 'd1', name: 'Doc1' },
      { id: 'd2', name: 'Doc2' },
    ];
    const next = [
      { id: 'd2', name: 'Doc2 Updated' },
      { id: 'd3', name: 'Doc3' },
    ];
    const merged = mergeRagDocuments(current, next);
    expect(merged.length).toBe(3);
    const d2 = merged.find((d) => d.id === 'd2');
    expect(d2.name).toBe('Doc2 Updated');
  });

  test('getDocumentDisplayName extracts filename', () => {
    expect(getDocumentDisplayName('/path/to/file.md')).toBe('file.md');
    expect(getDocumentDisplayName('file.md')).toBe('file.md');
    expect(getDocumentDisplayName('')).toBe('未命名文档');
  });

  test('createAgentErrorPrompt builds error prompt', () => {
    const prompt = createAgentErrorPrompt({ content: 'TypeError: x is undefined' });
    expect(prompt).toContain('TypeError: x is undefined');
    expect(prompt).toContain('分析并修复');
  });

  test('createFileSystemStorageAdapter reads and writes sessions', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    try {
      const adapter = createFileSystemStorageAdapter(tempDir, fs, path);
      expect(adapter.readSessions()).toEqual([]);

      adapter.writeSessions([{ id: 's1', messages: [] }]);
      const sessions = adapter.readSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('s1');

      adapter.writeSessions([]);
      expect(adapter.readSessions()).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('createFileSystemStorageAdapter reads and writes history', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    try {
      const adapter = createFileSystemStorageAdapter(tempDir, fs, path);
      expect(adapter.readHistory()).toEqual([]);

      adapter.writeHistory([{ input: 'test', timestamp: Date.now() }]);
      const history = adapter.readHistory();
      expect(history.length).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
