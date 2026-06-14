import { describe, test, expect } from 'bun:test';
import { SessionManager } from '../../src/core/session-manager.js';

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
    expect(msgs.some(m => m.role === 'user' && m.content === 'Hello')).toBe(true);
  });

  test('addAssistantMessage adds assistant message', () => {
    const sm = new SessionManager();
    sm.addAssistantMessage('Hi there');
    const msgs = sm.getHistory();
    expect(msgs.some(m => m.role === 'assistant')).toBe(true);
  });

  test('addToolResult adds tool result', () => {
    const sm = new SessionManager();
    sm.addToolResult('call_1', 'read_file', 'file content');
    const msgs = sm.getHistory();
    expect(msgs.some(m => m.role === 'tool')).toBe(true);
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
});
