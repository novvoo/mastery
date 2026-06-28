import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SessionManager } from '../../src/core/session-manager.js';
import { SessionPersistence } from '../../src/core/session/session-persistence.js';

describe('SessionPersistence', () => {
  test('saves and restores session context from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-persistence-'));
    try {
      const original = new SessionManager();
      original.setSystemPrompt('System prompt');
      original.addLayer('layer_task_anchor', 'Original task anchor');
      original.addUserMessage('User request before restart');
      original.addAssistantMessage('Assistant context before restart');

      const persistence = new SessionPersistence(dir);
      expect(persistence.save(original, { phase: 'test' })).toBe(true);
      expect(existsSync(persistence.filePath)).toBe(true);

      const restored = new SessionManager();
      expect(persistence.restoreInto(restored)).toBe(true);

      const messages = restored.getMessages();
      expect(messages[0].content).toContain('System prompt');
      expect(messages.some((message) => message.content === 'Original task anchor')).toBe(true);
      expect(restored.getHistory().map((message) => message.content)).toEqual([
        'User request before restart',
        'Assistant context before restart',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('restores falsy message metadata and empty tool results', () => {
    const original = new SessionManager();
    original.addAssistantMessage('', []);
    original.addToolResult('', 'empty_tool', '', 0);

    const snapshot = original.exportSnapshot();
    const restored = new SessionManager();

    expect(restored.restoreSnapshot(snapshot)).toBe(true);
    expect(restored.getHistory()).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [],
        priority: SessionManager.PRIORITY.EVIDENCE,
      },
      {
        role: 'tool',
        content: '',
        toolCallId: '',
        priority: 0,
      },
    ]);
  });

  test('trimToContextWindow respects explicit zero priority', () => {
    const session = new SessionManager({ tokenCounter: (text) => text.length });
    session.addToolResult('low', 'tool', 'x'.repeat(100), 0);
    session.addUserMessage('y'.repeat(100));

    session.trimToContextWindow(1, { minPriority: 1, minRecentMessages: 0 });

    expect(session.getHistory().map((message) => message.toolCallId ?? message.role)).toEqual([
      'user',
    ]);
  });
});
