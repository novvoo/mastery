import { describe, expect, test } from 'bun:test';
import { mergeToolLifecycleMessage, normalizeRuntimeEventMessage } from '../../desktop/renderer/hooks/useRuntime.js';
import {
  buildLifecycleGraph,
  buildToolRuntimeCollections,
  createConversationGroups,
  isPrimaryMessage,
  isRuntimeDetailMessage,
} from '../../desktop/renderer/runtime/runtime-details.js';
import { buildActivitySummary } from '../../desktop/renderer/runtime/activity-summary.js';

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

  test('collects request, progress, and response into one visible tool unit', () => {
    const call = normalizeRuntimeEventMessage('tool:call', {
      name: 'shell',
      toolCallId: 'call-4',
      arguments: { cmd: 'bun test' },
      timestamp: 100,
    }).message;
    const progress = normalizeRuntimeEventMessage('tool:progress', {
      name: 'shell',
      toolCallId: 'call-4',
      progress: 50,
      statusText: '测试中',
      timestamp: 125,
    }).message;
    const result = normalizeRuntimeEventMessage('tool:result', {
      name: 'shell',
      toolCallId: 'call-4',
      result: '445 pass',
      timestamp: 180,
    }).message;

    const collections = buildToolRuntimeCollections([call, progress, result]);

    expect(collections).toHaveLength(1);
    expect(collections[0].toolName).toBe('shell');
    expect(collections[0].request).toBe(call);
    expect(collections[0].result).toBe(result);
    expect(collections[0].updates).toEqual([progress]);
    expect(collections[0].messageCount).toBe(3);
    expect(collections[0].phase).toBe('completed');
    expect(collections[0].requestValue).toContain('bun test');
    expect(collections[0].responseText).toBe('445 pass');
    expect(collections[0].latestProgressText).toBe('测试中');
    expect(collections[0].displaySubtitle).toBe('测试中');
  });

  test('conversation groups expose tool collections instead of raw lifecycle count', () => {
    const user = { id: 'u1', type: 'user', content: 'run tests' };
    const call = { id: 't1', type: 'tool', toolName: 'shell', toolCallId: 'call-5', args: { cmd: 'bun test' } };
    const result = { id: 'r1', type: 'tool_result', toolName: 'shell', toolCallId: 'call-5', result: 'ok' };

    const [group] = createConversationGroups([user, call, result]);

    expect(group.runtimeDetails).toHaveLength(2);
    expect(group.toolCollections).toHaveLength(1);
    expect(group.toolCollections[0].messages).toEqual([call, result]);
  });

  test('activity summary counts one tool call once even when result arrives later', () => {
    const summary = buildActivitySummary([
      { id: 't1', type: 'tool', toolName: 'read', toolCallId: 'call-6', args: { path: 'a.js' } },
      { id: 'r1', type: 'tool_result', toolName: 'read', toolCallId: 'call-6', result: 'content' },
    ]);

    expect(summary.activities).toHaveLength(1);
    expect(summary.activities[0].toolName).toBe('read');
    expect(summary.total).toBe(1);
  });

  test('event messages are runtime details instead of primary chat messages', () => {
    const eventMessage = { id: 'evt-1', type: 'event', content: 'status changed' };

    expect(isRuntimeDetailMessage(eventMessage)).toBe(true);
    expect(isPrimaryMessage(eventMessage)).toBe(false);
  });

  test('task start and empty completion become lifecycle graph nodes', () => {
    const start = normalizeRuntimeEventMessage('agent:start', { task: '修复 UI' }).message;
    const complete = normalizeRuntimeEventMessage('agent:complete', {}).message;
    const graph = buildLifecycleGraph([start, complete]);

    expect(start.type).toBe('lifecycle');
    expect(complete.type).toBe('lifecycle');
    expect(isRuntimeDetailMessage(start)).toBe(true);
    expect(isRuntimeDetailMessage(complete)).toBe(true);
    expect(graph.map((node) => node.id)).toEqual(['started', 'completed']);
  });

  test('agent completion with an answer remains a primary result message', () => {
    const complete = normalizeRuntimeEventMessage('agent:complete', {
      result: { answer: '真实回答' },
    }).message;

    expect(complete.type).toBe('result');
    expect(isPrimaryMessage(complete)).toBe(true);
    expect(isRuntimeDetailMessage(complete)).toBe(false);
  });

  test('runtime lifecycle events attach to the next primary conversation group', () => {
    const start = normalizeRuntimeEventMessage('agent:start', { task: 'run' }).message;
    const user = { id: 'u1', type: 'user', content: 'run tests' };

    const [group] = createConversationGroups([start, user]);

    expect(group.primaryMessage).toBe(user);
    expect(group.runtimeDetails).toEqual([start]);
    expect(group.messages).toEqual([user, start]);
  });
});
