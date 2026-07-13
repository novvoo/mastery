import { describe, expect, test } from 'bun:test';
import { mergeToolLifecycleMessage, normalizeRuntimeEventMessage } from '../../desktop/renderer/hooks/useRuntime.js';

describe('OMP tool lifecycle UI aggregation', () => {
  test('preserves toolCallId across call and result events', () => {
    const call = normalizeRuntimeEventMessage('tool:call', {
      name: 'read', toolCallId: 'call-1', arguments: { path: 'a.js' }, timestamp: 100,
    }).message;
    const result = normalizeRuntimeEventMessage('tool:result', {
      name: 'read', toolCallId: 'call-1', result: 'content', timestamp: 175,
    }).message;

    expect(call.toolCallId).toBe('call-1');
    expect(result.toolCallId).toBe('call-1');
  });

  test('merges successful completion and computes duration', () => {
    const merged = mergeToolLifecycleMessage(
      { type: 'tool', toolName: 'read', toolCallId: 'call-1', startedAt: 100 },
      { toolCallId: 'call-1', result: 'ok', completedAt: 175 },
      'tool:result',
    );

    expect(merged.toolResult).toBe(true);
    expect(merged.result).toBe('ok');
    expect(merged.duration).toBe(75);
    expect(merged.durationMs).toBe(75);
    expect(merged.phase).toBe('completed');
    expect(merged.isError).toBe(false);
  });

  test('merges error into the original tool card', () => {
    const merged = mergeToolLifecycleMessage(
      { type: 'tool', toolName: 'shell', toolCallId: 'call-2', startedAt: 200 },
      { toolCallId: 'call-2', error: 'exit 1', completedAt: 240 },
      'tool:error',
    );

    expect(merged.toolResult).toBe(true);
    expect(merged.isError).toBe(true);
    expect(merged.error).toBe('exit 1');
    expect(merged.exitCode).toBe(1);
    expect(merged.phase).toBe('failed');
  });

  test('keeps progress on the same running card', () => {
    const merged = mergeToolLifecycleMessage(
      { type: 'tool', toolName: 'shell', toolCallId: 'call-3' },
      { activity: { progress: 45, statusText: '安装依赖' } },
      'tool:progress',
    );

    expect(merged.toolResult).toBeUndefined();
    expect(merged.progress).toBe(45);
    expect(merged.progressText).toBe('安装依赖');
  });
});
