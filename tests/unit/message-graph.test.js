import { describe, expect, test } from 'bun:test';
import {
  buildMessageDisplayGraph,
  buildMessageViewProjection,
  computeNextCollapsedGroups,
  messageMatchesViewQuery,
  resolveTurnVisibility,
} from '../../desktop/renderer/runtime/message-graph.js';
import { buildToolRuntimeCollections } from '../../desktop/renderer/runtime/runtime-details.js';

describe('message display graph', () => {
  test('projects lifecycle and paired tool messages into one conversation group', () => {
    const graph = buildMessageDisplayGraph([
      { id: 'start', type: 'lifecycle', event: 'agent:start', lifecyclePhase: 'started', timestamp: 1 },
      {
        id: 'call',
        type: 'tool',
        event: 'tool:call',
        toolCallId: 'call-1',
        toolName: 'read_file',
        args: { path: 'README.md' },
        timestamp: 2,
      },
      {
        id: 'result',
        type: 'tool_result',
        event: 'tool:result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        result: 'contents',
        timestamp: 3,
      },
      { id: 'answer', type: 'result', content: '完成', timestamp: 4 },
      { id: 'complete', type: 'lifecycle', event: 'agent:complete', runtimeDetail: true, timestamp: 5 },
    ]);

    expect(graph).toHaveLength(1);
    expect(graph[0].primaryMessage.id).toBe('answer');
    expect(graph[0].toolCollections).toHaveLength(1);
    expect(graph[0].toolCollections[0].request.id).toBe('call');
    expect(graph[0].toolCollections[0].result.id).toBe('result');
    expect(graph[0].lifecycleGraph.map((node) => node.id)).toEqual(['started', 'tools', 'completed']);
  });

  test('keeps one user request, its tools, and final response in the same turn', () => {
    const graph = buildMessageDisplayGraph([
      { id: 'user-1', type: 'user', turnId: 'run-1', content: '运行测试' },
      {
        id: 'tool-1',
        type: 'tool',
        turnId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'shell',
        args: { cmd: 'bun test' },
      },
      {
        id: 'answer-1',
        type: 'result',
        turnId: 'run-1',
        content: '测试通过',
      },
    ]);

    expect(graph).toHaveLength(1);
    expect(graph[0].id).toBe('turn:run-1');
    expect(graph[0].requestMessage.id).toBe('user-1');
    expect(graph[0].responseMessage.id).toBe('answer-1');
    expect(graph[0].primaryMessages.map((message) => message.id)).toEqual(['user-1', 'answer-1']);
    expect(graph[0].toolCollections).toHaveLength(1);
    expect(graph[0].status).toBe('completed');
  });

  test('routes a late correlated tool result back to its original turn', () => {
    const graph = buildMessageDisplayGraph([
      { id: 'user-1', type: 'user', turnId: 'run-1', content: '第一个任务' },
      {
        id: 'tool-1',
        type: 'tool',
        turnId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'read',
      },
      { id: 'user-2', type: 'user', turnId: 'run-2', content: '第二个任务' },
      {
        id: 'result-1',
        type: 'tool_result',
        turnId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'read',
        result: 'done',
      },
    ]);

    expect(graph).toHaveLength(2);
    expect(graph[0].toolCollections[0].messages.map((message) => message.id)).toEqual([
      'tool-1',
      'result-1',
    ]);
    expect(graph[1].runtimeDetails).toHaveLength(0);
  });

  test('does not merge sequential same-name tools when an upstream call ID is missing', () => {
    const collections = buildToolRuntimeCollections([
      { id: 'call-a', type: 'tool', toolName: 'read', args: { path: 'a.js' } },
      { id: 'result-a', type: 'tool_result', toolName: 'read', result: 'a' },
      { id: 'call-b', type: 'tool', toolName: 'read', args: { path: 'b.js' } },
      { id: 'result-b', type: 'tool_result', toolName: 'read', result: 'b' },
    ]);

    expect(collections).toHaveLength(2);
    expect(collections[0].messages.map((message) => message.id)).toEqual(['call-a', 'result-a']);
    expect(collections[1].messages.map((message) => message.id)).toEqual(['call-b', 'result-b']);
  });

  test('a request-only turn remains running until a terminal response or lifecycle arrives', () => {
    const [running] = buildMessageDisplayGraph([
      { id: 'user-1', type: 'user', content: '等待回答' },
    ]);
    const [completed] = buildMessageDisplayGraph([
      { id: 'user-1', type: 'user', content: '等待回答' },
      { id: 'answer-1', type: 'result', content: '完成' },
    ]);

    expect(running.status).toBe('running');
    expect(running.isCompleted).toBe(false);
    expect(completed.status).toBe('completed');
    expect(completed.isCompleted).toBe(true);
  });

  test('legacy user input adopts a preceding correlated runtime-only turn', () => {
    const [turn] = buildMessageDisplayGraph([
      {
        id: 'start-1',
        type: 'lifecycle',
        runId: 'run-1',
        event: 'agent:start',
        lifecyclePhase: 'started',
      },
      { id: 'user-1', type: 'user', content: '继续执行' },
      { id: 'answer-1', type: 'result', content: '完成' },
    ]);

    expect(turn.id).toBe('turn:run-1');
    expect(turn.requestMessage.id).toBe('user-1');
    expect(turn.responseMessage.id).toBe('answer-1');
  });

  test('turn status follows the latest terminal signal after waiting for input', () => {
    const [turn] = buildMessageDisplayGraph([
      { id: 'user-1', type: 'user', content: '执行任务' },
      { id: 'wait-1', type: 'warning', content: '需要输入' },
      { id: 'answer-1', type: 'result', content: '继续后完成' },
    ]);

    expect(turn.status).toBe('completed');
  });

  test('query projection keeps the complete matching turn as display context', () => {
    const projection = buildMessageViewProjection([
      { id: 'user-1', type: 'user', turnId: 'run-1', content: '检查项目', timestamp: 60_000 },
      {
        id: 'tool-1',
        type: 'tool',
        turnId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'read_file',
        args: { path: 'architecture.md' },
        timestamp: 61_000,
      },
      { id: 'answer-1', type: 'result', turnId: 'run-1', content: '检查完成', timestamp: 62_000 },
      { id: 'user-2', type: 'user', turnId: 'run-2', content: '运行测试', timestamp: 120_000 },
    ], {
      filter: 'tool',
      searchQuery: 'architecture.md',
      formatTimelineLabel: (timestamp) => `minute:${timestamp}`,
    });

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0].id).toBe('turn:run-1');
    expect(projection.groups[0].primaryMessages.map((message) => message.id)).toEqual([
      'user-1',
      'answer-1',
    ]);
    expect(projection.groups[0].queryMatchCount).toBe(1);
    expect(projection.matchingMessageCount).toBe(1);
    expect(projection.timelineBuckets).toHaveLength(1);
    expect(projection.timelineBuckets[0].label).toBe('minute:60000');
    expect(projection.timelineBuckets[0].groups[0].id).toBe('turn:run-1');
  });

  test('query and view mode do not redefine the canonical active turn', () => {
    const projection = buildMessageViewProjection([
      { id: 'old-user', type: 'user', turnId: 'old', content: '旧任务' },
      { id: 'old-answer', type: 'result', turnId: 'old', content: '旧答案' },
      { id: 'active-user', type: 'user', turnId: 'active', content: '当前任务' },
    ], {
      searchQuery: '旧答案',
    });

    expect(projection.groups.map((group) => group.id)).toEqual(['turn:old']);
    expect(projection.activeGroupId).toBe('turn:active');
    expect(computeNextCollapsedGroups({
      groups: projection.groups,
      activeGroupId: projection.activeGroupId,
    }).has('turn:old')).toBe(true);
  });

  test('view query safely searches structured tool payloads', () => {
    expect(messageMatchesViewQuery({
      type: 'tool',
      args: { path: 'docs/architecture.md' },
    }, {
      filter: 'tool',
      searchQuery: 'architecture',
    })).toBe(true);
  });

  test('group collapse does not override a user-expanded completed group', () => {
    const groups = [
      { id: 'old', primaryMessage: { id: 'answer', type: 'result' } },
      {
        id: 'active',
        primaryMessage: {
          id: 'stream',
          type: 'assistant_stream',
          isStreaming: true,
          streamComplete: false,
        },
      },
    ];

    expect(computeNextCollapsedGroups({ groups }).has('old')).toBe(true);
    expect(computeNextCollapsedGroups({
      groups,
      userExpandedGroupIds: new Set(['old']),
    }).has('old')).toBe(false);
  });

  test('runtime detail updates cannot override explicit turn visibility', () => {
    const completedTurn = {
      id: 'old',
      status: 'completed',
      primaryMessage: { id: 'answer', type: 'result' },
      runtimeDetails: [],
    };
    const activeTurn = {
      id: 'active',
      status: 'running',
      primaryMessage: { id: 'stream', type: 'assistant_stream', isStreaming: true },
    };
    const preference = new Set(['old']);

    const beforeToolResult = computeNextCollapsedGroups({
      groups: [completedTurn, activeTurn],
      userExpandedGroupIds: preference,
    });
    const afterToolResult = computeNextCollapsedGroups({
      groups: [
        {
          ...completedTurn,
          runtimeDetails: [
            { id: 'tool-result', type: 'tool_result', event: 'tool:result' },
          ],
        },
        activeTurn,
      ],
      previousCollapsed: beforeToolResult,
      userExpandedGroupIds: preference,
    });

    expect(beforeToolResult.has('old')).toBe(false);
    expect(afterToolResult.has('old')).toBe(false);
  });

  test('turn visibility keeps waiting turns open and preserves explicit collapse', () => {
    const waitingGroups = [
      {
        id: 'waiting',
        status: 'waiting',
        primaryMessage: { id: 'question', type: 'warning' },
      },
      {
        id: 'current',
        status: 'running',
        primaryMessage: { id: 'stream', type: 'assistant_stream', isStreaming: true },
      },
    ];
    const waitingResult = computeNextCollapsedGroups({
      groups: waitingGroups,
      previousCollapsed: new Set(['waiting']),
    });
    expect(waitingResult.has('waiting')).toBe(false);

    const terminalCurrent = [{
      id: 'current',
      status: 'completed',
      primaryMessage: { id: 'answer', type: 'result' },
    }];
    const explicitCollapse = computeNextCollapsedGroups({
      groups: terminalCurrent,
      userCollapsedGroupIds: new Set(['current']),
    });
    expect(explicitCollapse.has('current')).toBe(true);
  });

  test('a current terminal turn reopens when its old collapse was automatic', () => {
    const currentOnly = [{
      id: 'turn-1',
      status: 'completed',
      primaryMessage: { id: 'answer', type: 'result' },
    }];

    const next = computeNextCollapsedGroups({
      groups: currentOnly,
      previousCollapsed: new Set(['turn-1']),
    });

    expect(next.has('turn-1')).toBe(false);
  });

  test('turn visibility exposes the documented decision reason', () => {
    expect(resolveTurnVisibility({
      group: { id: 'waiting', status: 'waiting' },
      userPreference: 'collapsed',
    })).toEqual({ state: 'expanded', reason: 'attention-required' });
    expect(resolveTurnVisibility({
      group: { id: 'done', status: 'completed' },
      userPreference: 'expanded',
    })).toEqual({ state: 'expanded', reason: 'user-expanded' });
    expect(resolveTurnVisibility({
      group: { id: 'done', status: 'completed' },
      isCurrent: false,
    })).toEqual({ state: 'collapsed', reason: 'historical-terminal' });
  });
});
