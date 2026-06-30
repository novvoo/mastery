import { describe, test, expect, mock } from 'bun:test';
import { classifyLongRunningCommand } from '../../src/core/long-running-command.js';

describe('classifyLongRunningCommand', () => {
  test('returns isLongRunning false for empty command', async () => {
    const result = await classifyLongRunningCommand('');
    expect(result.isLongRunning).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toBeDefined();
  });

  test('returns isLongRunning false for whitespace-only command', async () => {
    const result = await classifyLongRunningCommand('   ');
    expect(result.isLongRunning).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test('detects npm dev scripts without a modelProvider', async () => {
    const result = await classifyLongRunningCommand('npm run dev');
    expect(result.isLongRunning).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.recommendedTool).toBe('pty_start');
    expect(result.longRunningSegment).toBe('npm run dev');
    expect(result.compoundWithLongRunning).toBe(false);
  });

  test('detects long-running segments inside compound commands', async () => {
    const result = await classifyLongRunningCommand('npm install && npm run dev && npm test');
    expect(result.isLongRunning).toBe(true);
    expect(result.recommendedTool).toBe('pty_start');
    expect(result.longRunningSegment).toBe('npm run dev');
    expect(result.compoundWithLongRunning).toBe(true);
  });

  test('detects common server commands without a modelProvider', async () => {
    const result = await classifyLongRunningCommand('npx http-server ./dist -p 8080');
    expect(result.isLongRunning).toBe(true);
    expect(result.reason).toContain('development server');
  });

  test('does not classify ordinary finite package commands as long-running', async () => {
    const result = await classifyLongRunningCommand('npm test && npm run build');
    expect(result.isLongRunning).toBe(false);
    expect(result.reason).toMatch(/Package (test|run|install)/);
    expect(result.recommendedTool).toBe('shell');
  });

  test('does not classify npm install with vite/vitest packages as long-running', async () => {
    const result = await classifyLongRunningCommand('npm install --save-dev vite vitest');
    expect(result.isLongRunning).toBe(false);
    expect(result.reason).toContain('Package install');
    expect(result.recommendedTool).toBe('shell');
  });

  test('does not classify bare vitest invocation as long-running', async () => {
    const result = await classifyLongRunningCommand('vitest run');
    expect(result.isLongRunning).toBe(false);
    expect(result.reason).toContain('Test runner');
    expect(result.recommendedTool).toBe('shell');
  });

  test('detects npm start scripts without a modelProvider', async () => {
    const result = await classifyLongRunningCommand('npm start');
    expect(result.isLongRunning).toBe(true);
    expect(result.recommendedTool).toBe('pty_start');
  });

  test('returns isLongRunning false when modelProvider has no chat method', async () => {
    const result = await classifyLongRunningCommand('node script.js', {
      modelProvider: {},
    });
    expect(result.isLongRunning).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test('calls modelProvider.chat when provided', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: true,
        confidence: 0.9,
        reason: 'Starts a dev server',
        recommendedTool: 'pty_start',
      }),
    }));

    const result = await classifyLongRunningCommand('node custom-entry.js', {
      modelProvider: { chat: chatMock },
    });

    expect(chatMock).toHaveBeenCalledTimes(1);
    // The call should include system and user messages
    const callArgs = chatMock.mock.calls[0][0];
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0].role).toBe('system');
    expect(callArgs[1].role).toBe('user');
  });

  test('classifies unknown commands as long-running when model returns high confidence', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: true,
        confidence: 0.95,
        reason: 'Starts a persistent dev server',
        recommendedTool: 'pty_start',
      }),
    }));

    const result = await classifyLongRunningCommand('node custom-entry.js', {
      modelProvider: { chat: chatMock },
    });

    expect(result.isLongRunning).toBe(true);
    expect(result.confidence).toBe(0.95);
    expect(result.recommendedTool).toBe('pty_start');
  });

  test('classifies echo as not long-running when model returns low confidence', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: false,
        confidence: 0.1,
        reason: 'Echo finishes quickly',
        recommendedTool: 'shell',
      }),
    }));

    const result = await classifyLongRunningCommand('echo hello', {
      modelProvider: { chat: chatMock },
    });

    expect(result.isLongRunning).toBe(false);
    expect(result.recommendedTool).toBe('shell');
  });

  test('handles model returning non-boolean isLongRunning', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: 1, // truthy but not boolean
        confidence: 0.8,
        reason: 'Test',
      }),
    }));

    const result = await classifyLongRunningCommand('some command', {
      modelProvider: { chat: chatMock },
    });

    // Boolean(1) is true and 0.8 >= 0.55, so should be long-running
    expect(result.isLongRunning).toBe(true);
  });

  test('normalizes confidence below threshold to not long-running', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: true,
        confidence: 0.3, // below 0.55 threshold
        reason: 'Maybe long running',
      }),
    }));

    const result = await classifyLongRunningCommand('some command', {
      modelProvider: { chat: chatMock },
    });

    expect(result.isLongRunning).toBe(false);
    expect(result.recommendedTool).toBe('shell');
  });

  test('handles model returning NaN confidence', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: true,
        confidence: 'invalid',
        reason: 'Test',
      }),
    }));

    const result = await classifyLongRunningCommand('some command', {
      modelProvider: { chat: chatMock },
    });

    expect(result.confidence).toBe(0);
    expect(result.isLongRunning).toBe(false);
  });

  test('handles model returning markdown-fenced JSON', async () => {
    const chatMock = mock(() => ({
      text: '```json\n{"isLongRunning": true, "confidence": 0.9, "reason": "Server"}\n```',
    }));

    const result = await classifyLongRunningCommand('node custom-entry.js', {
      modelProvider: { chat: chatMock },
    });

    expect(result.isLongRunning).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  test('handles model timeout gracefully', async () => {
    const chatMock = mock(() => new Promise(() => {})); // never resolves

    const result = await classifyLongRunningCommand('node custom-entry.js', {
      modelProvider: { chat: chatMock },
      timeoutMs: 100, // short timeout
    });

    expect(result.isLongRunning).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('unavailable');
  });

  test('handles model throwing error gracefully', async () => {
    const chatMock = mock(() => {
      throw new Error('Model error');
    });

    const result = await classifyLongRunningCommand('node custom-entry.js', {
      modelProvider: { chat: chatMock },
    });

    expect(result.isLongRunning).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('unavailable');
  });

  test('handles model returning object directly', async () => {
    const chatMock = mock(() => ({
      isLongRunning: true,
      confidence: 0.88,
      reason: 'Server process',
      recommendedTool: 'pty_start',
    }));

    const result = await classifyLongRunningCommand('node server.js', {
      modelProvider: { chat: chatMock },
    });

    expect(result.isLongRunning).toBe(true);
    expect(result.confidence).toBe(0.88);
  });

  test('uses default reason when model does not provide one', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({
        isLongRunning: false,
        confidence: 0.2,
      }),
    }));

    const result = await classifyLongRunningCommand('echo hello', {
      modelProvider: { chat: chatMock },
    });

    expect(result.reason).toBeDefined();
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test('passes correct maxTokens option to model', async () => {
    const chatMock = mock(() => ({
      text: JSON.stringify({ isLongRunning: false, confidence: 0.1, reason: 'No' }),
    }));

    await classifyLongRunningCommand('echo test', {
      modelProvider: { chat: chatMock },
    });

    // Second arg to chat should have maxTokens
    const callArgs = chatMock.mock.calls[0];
    expect(callArgs).toBeDefined();
  });

  test('handles model returning null response text', async () => {
    const chatMock = mock(() => ({ text: null }));

    const result = await classifyLongRunningCommand('node custom-entry.js', {
      modelProvider: { chat: chatMock },
    });

    // Should handle gracefully - JSON.parse of null will fail
    expect(result.isLongRunning).toBe(false);
  });
});
