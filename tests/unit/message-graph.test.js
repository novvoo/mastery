import { describe, expect, test } from 'bun:test';
import {
  buildMessageDisplayGraph,
  computeNextCollapsedGroups,
  computeNextCollapsedMessages,
  createCompletedCollapseSignature,
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

  test('completed signature ignores running stream updates', () => {
    const getId = (message) => message.id;
    const messages = [
      { id: 'old', type: 'result', content: '旧答案' },
      { id: 'active', type: 'assistant_stream', isStreaming: true, content: '生成中' },
    ];

    expect(createCompletedCollapseSignature(messages, getId)).toBe('old');
    expect(createCompletedCollapseSignature([
      ...messages.slice(0, 1),
      { ...messages[1], content: '新的增量' },
    ], getId)).toBe('old');
    expect(createCompletedCollapseSignature([
      messages[0],
      { ...messages[1], streamComplete: true },
    ], getId)).toBe('old|active');
  });

  test('message collapse preserves manual expansion and keeps latest completion open', () => {
    const messages = [
      { id: 'first', type: 'result' },
      { id: 'second', type: 'result' },
      { id: 'running', type: 'assistant_stream', isStreaming: true },
    ];
    const getId = (message) => message.id;

    const automatic = computeNextCollapsedMessages({
      messages,
      getMessageId: getId,
    });
    expect(automatic.has('first')).toBe(true);
    expect(automatic.has('second')).toBe(false);
    expect(automatic.has('running')).toBe(false);

    const userControlled = computeNextCollapsedMessages({
      messages,
      userExpandedMessageIds: new Set(['first']),
      getMessageId: getId,
    });
    expect(userControlled.has('first')).toBe(false);
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
