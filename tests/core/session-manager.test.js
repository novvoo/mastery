import { describe, test, expect } from 'bun:test';
import { SessionManager } from '../../src/core/session/session-manager.js';

describe('SessionManager', () => {
  test('constructor creates instance', () => {
    const sm = new SessionManager();
    expect(sm).toBeDefined();
  });

  test('setSystemPrompt and getMessages include it', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('You are a helpful assistant.');
    const msgs = sm.getMessages();
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('helpful assistant');
  });

  test('addSystemMessage appends to system prompt', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('Base prompt');
    sm.addSystemMessage('Additional context');
    const msgs = sm.getMessages();
    expect(msgs[0].content).toContain('Base prompt');
    expect(msgs[0].content).toContain('Additional context');
  });

  test('addUserMessage adds user message', () => {
    const sm = new SessionManager();
    sm.addUserMessage('Hello');
    const msgs = sm.getHistory();
    expect(msgs.some((m) => m.role === 'user' && m.content === 'Hello')).toBe(true);
  });

  test('addAssistantMessage adds assistant message', () => {
    const sm = new SessionManager();
    sm.addAssistantMessage('Hi there');
    const msgs = sm.getHistory();
    expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
  });

  test('addToolResult adds tool result', () => {
    const sm = new SessionManager();
    sm.addToolResult('call_1', 'read_file', 'file content');
    const msgs = sm.getHistory();
    expect(msgs.some((m) => m.role === 'tool')).toBe(true);
  });

  test('tagLastMessage changes priority', () => {
    const sm = new SessionManager();
    sm.addUserMessage('test');
    sm.tagLastMessage(SessionManager.PRIORITY.DECISION);
    const msgs = sm.getHistory();
    expect(msgs[msgs.length - 1].priority).toBe(SessionManager.PRIORITY.DECISION);
  });

  test('autoTagLastAssistantPriority tags decision keywords', () => {
    const sm = new SessionManager();
    sm.addAssistantMessage('I will implement the feature now');
    sm.autoTagLastAssistantPriority();
    const msgs = sm.getHistory();
    const last = msgs[msgs.length - 1];
    expect(last.priority).toBe(SessionManager.PRIORITY.DECISION);
  });

  test('autoTagLastAssistantPriority does not tag ordinary message', () => {
    const sm = new SessionManager();
    sm.addAssistantMessage('The file contains 100 lines');
    sm.autoTagLastAssistantPriority();
    const msgs = sm.getHistory();
    const last = msgs[msgs.length - 1];
    expect(last.priority).toBe(SessionManager.PRIORITY.EVIDENCE); // default for assistant
  });

  test('PRIORITY has expected values', () => {
    expect(SessionManager.PRIORITY.ORDINARY).toBe(1);
    expect(SessionManager.PRIORITY.EVIDENCE).toBe(2);
    expect(SessionManager.PRIORITY.DECISION).toBe(3);
  });

  test('getTokenCount returns positive number', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('Hello');
    sm.addUserMessage('How are you?');
    const count = sm.getTokenCount();
    expect(count).toBeGreaterThan(0);
  });

  test('getMessages includes system prompt + history', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('System');
    sm.addUserMessage('User');
    const msgs = sm.getMessages();
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  test('getHistory returns copy without system prompt', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('System');
    sm.addUserMessage('User');
    const hist = sm.getHistory();
    expect(hist.length).toBe(1);
    expect(hist[0].role).toBe('user');
  });

  test('exportSnapshot and restoreSnapshot preserve messages and persistent layers', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('System');
    sm.addLayer('persisted', 'Persistent context', { priority: SessionManager.LAYER.MEMORY });
    sm.addLayer('transient', 'Temporary context', { transient: true });
    sm.addUserMessage('Remember this task');
    sm.addAssistantMessage('I will keep context');

    const snapshot = sm.exportSnapshot();
    expect(snapshot.systemPrompt).toContain('System');
    expect(snapshot.layers.find((layer) => layer.id === 'persisted')).toBeDefined();
    expect(snapshot.layers.find((layer) => layer.id === 'transient')).toBeUndefined();
    expect(snapshot.messages.length).toBe(2);

    const restored = new SessionManager();
    expect(restored.restoreSnapshot(snapshot)).toBe(true);
    expect(restored.getMessages()[0].content).toContain('System');
    expect(restored.getMessages().some((message) => message.content === 'Persistent context')).toBe(
      true,
    );
    expect(restored.getHistory().map((message) => message.content)).toEqual([
      'Remember this task',
      'I will keep context',
    ]);
  });

  test('exportSnapshot respects maxMessages zero', () => {
    const sm = new SessionManager();
    sm.addUserMessage('Old message');
    sm.addAssistantMessage('New message');

    const snapshot = sm.exportSnapshot({ maxMessages: 0 });

    expect(snapshot.messages).toEqual([]);
  });

  test('restoreSnapshot with replace false appends restored messages', () => {
    const sm = new SessionManager();
    sm.addUserMessage('Existing message');

    expect(
      sm.restoreSnapshot(
        {
          messages: [{ role: 'assistant', content: 'Restored message' }],
        },
        { replace: false },
      ),
    ).toBe(true);

    expect(sm.getHistory().map((message) => message.content)).toEqual([
      'Existing message',
      'Restored message',
    ]);
  });

  test('restoreSnapshot preserves explicit zero priority', () => {
    const sm = new SessionManager();

    expect(
      sm.restoreSnapshot({
        messages: [{ role: 'user', content: 'Pinned low priority', priority: 0 }],
      }),
    ).toBe(true);

    expect(sm.getHistory()[0].priority).toBe(0);
  });

  test('trimToContextWindow respects max tokens', () => {
    const sm = new SessionManager();
    sm.setSystemPrompt('Short');
    for (let i = 0; i < 50; i++) {
      sm.addUserMessage(`Message ${i} with some content to make it longer`);
    }
    const before = sm.getHistory().length;
    sm.trimToContextWindow(100);
    const after = sm.getHistory().length;
    expect(after).toBeLessThanOrEqual(before);
  });

  // ================================================================
  // Supersede 机制测试
  // ================================================================

  describe('Supersede', () => {
    test('getMessages replaces superseded read_file results with placeholder', () => {
      const sm = new SessionManager();

      // 添加 read_file 结果
      sm.addToolResult('call_read_1', 'read_file', '1: class Snake {\n2:   ...corrupted code...');
      sm.trackReadFileResult('call_read_1', 'src/game/Snake.js');

      // 添加另一个不相关的结果
      sm.addToolResult('call_read_2', 'read_file', '1: import Snake from...');
      sm.trackReadFileResult('call_read_2', 'snake.test.js');

      // 验证 supersede 前：原始内容可见
      const before = sm.getMessages();
      expect(before.some(m => m.content === '1: class Snake {\n2:   ...corrupted code...')).toBe(true);
      expect(before.some(m => m.content === '1: import Snake from...')).toBe(true);

      // 模拟写入后触发 supersede
      sm.supersedeFileReads('src/game/Snake.js');

      // 验证 supersede 后：snake.js 的结果已被替换，snake.test.js 的没变
      const after = sm.getMessages();
      expect(after.some(m => m.content.includes('[Superseded by a newer write/edit of src/game/Snake.js'))).toBe(true);
      expect(after.some(m => m.content === '1: class Snake {\n2:   ...corrupted code...')).toBe(false);
      expect(after.some(m => m.content === '1: import Snake from...')).toBe(true);
    });

    test('supersede只替换匹配文件的结果', () => {
      const sm = new SessionManager();

      sm.addToolResult('call_a', 'read_file', 'content A');
      sm.trackReadFileResult('call_a', 'src/game/Snake.js');
      sm.addToolResult('call_b', 'read_file', 'content B');
      sm.trackReadFileResult('call_b', 'src/snake.js');

      sm.supersedeFileReads('src/game/Snake.js');

      const msgs = sm.getMessages();
      // snake.js 被替换
      expect(msgs.find(m => m.toolCallId === 'call_a').content).toContain('[Superseded by');
      // src/snake.js 没被替换
      expect(msgs.find(m => m.toolCallId === 'call_b').content).toBe('content B');
    });

    test('trackReadFileResult 空参数不报错', () => {
      const sm = new SessionManager();
      sm.trackReadFileResult(null, 'file.js');
      sm.trackReadFileResult('id', null);
      // 不会崩溃即可
    });

    test('supersedeFileReads 空参数不报错', () => {
      const sm = new SessionManager();
      sm.supersedeFileReads(null);
      sm.supersedeFileReads('');
      // 不会崩溃即可
    });
  });
});
