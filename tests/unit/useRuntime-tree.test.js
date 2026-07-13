import { describe, expect, test } from 'bun:test';
import {
  buildMessageTree,
  countTreeNodes,
  flattenTree,
  normalizeRuntimeEventMessage,
} from '../../desktop/renderer/hooks/useRuntime.js';

// ─── buildMessageTree ─────────────────────────────────────────────────

describe('buildMessageTree', () => {
  test('returns empty array for null/undefined', () => {
    expect(buildMessageTree(null)).toEqual([]);
    expect(buildMessageTree(undefined)).toEqual([]);
  });

  test('returns empty array for empty array', () => {
    expect(buildMessageTree([])).toEqual([]);
  });

  test('flat messages with depth=0 become root nodes', () => {
    const msgs = [
      { id: '1', type: 'user', content: 'hello', depth: 0 },
      { id: '2', type: 'agent', content: 'hi', depth: 0 },
    ];
    const tree = buildMessageTree(msgs);
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('1');
    expect(tree[1].id).toBe('2');
    expect(tree[0].children).toEqual([]);
  });

  test('tool:result (depth=1) nests under preceding tool:call', () => {
    const msgs = [
      { id: '1', type: 'tool', toolName: 'bash', content: '调用工具: bash', depth: 0, collapsible: true },
      { id: '2', type: 'tool_result', toolName: 'bash', content: '工具结果: bash', depth: 1, parentType: 'tool', result: 'done' },
    ];
    const tree = buildMessageTree(msgs);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('1');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('2');
  });

  test('progress (depth=2) nests under last tool result', () => {
    const msgs = [
      { id: '1', type: 'tool', toolName: 'bash', depth: 0, collapsible: true },
      { id: '2', type: 'tool_result', toolName: 'bash', depth: 1, parentType: 'tool' },
      { id: '3', type: 'event', toolName: 'bash', depth: 2, parentType: 'tool_result', content: '进度: 0%' },
      { id: '4', type: 'event', toolName: 'bash', depth: 2, parentType: 'tool_result', content: '进度: 50%' },
    ];
    const tree = buildMessageTree(msgs);
    expect(tree).toHaveLength(1);           // one tool call
    expect(tree[0].children).toHaveLength(1); // one result under it
    expect(tree[0].children[0].children).toHaveLength(2); // two progress under result
    expect(tree[0].children[0].children[0].content).toBe('进度: 0%');
    expect(tree[0].children[0].children[1].content).toBe('进度: 50%');
  });

  test('multiple tool calls each get their own nesting', () => {
    const msgs = [
      { id: '1', type: 'tool', toolName: 'read', depth: 0, collapsible: true },
      { id: '2', type: 'tool_result', toolName: 'read', depth: 1, parentType: 'tool' },
      { id: '3', type: 'tool', toolName: 'bash', depth: 0, collapsible: true },
      { id: '4', type: 'tool_result', toolName: 'bash', depth: 1, parentType: 'tool' },
    ];
    const tree = buildMessageTree(msgs);
    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe('1');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('2');
    expect(tree[1].id).toBe('3');
    expect(tree[1].children[0].id).toBe('4');
  });
  test('mixes flat and nested messages', () => {
    const msgs = [
      { id: 'u1', type: 'user', content: '修复报错', depth: 0 },
      { id: 'a1', type: 'agent', content: '任务开始', depth: 0 },
      { id: 't1', type: 'tool', toolName: 'bash', depth: 0, collapsible: true },
      { id: 'r1', type: 'tool_result', toolName: 'bash', depth: 1, parentType: 'tool' },
      { id: 'a2', type: 'agent', content: '已完成', depth: 0 },
    ];
    const tree = buildMessageTree(msgs);
    // 4 root nodes: user, agent-start, tool, agent-complete
    expect(tree).toHaveLength(4);
    expect(tree[0].id).toBe('u1');
    expect(tree[1].id).toBe('a1');
    // tool call with nested result
    expect(tree[2].id).toBe('t1');
    expect(tree[2].children).toHaveLength(1);
    expect(tree[2].children[0].id).toBe('r1');
    expect(tree[3].id).toBe('a2');
  });
});

// ─── countTreeNodes ───────────────────────────────────────────────────

describe('countTreeNodes', () => {
  test('counts root + children recursively', () => {
    const tree = [
      { id: '1', children: [
        { id: '1.1', children: [
          { id: '1.1.1', children: [] },
        ]},
        { id: '1.2', children: [] },
      ]},
      { id: '2', children: [] },
    ];
    expect(countTreeNodes(tree)).toBe(5);
  });

  test('returns 0 for empty', () => {
    expect(countTreeNodes([])).toBe(0);
  });
});

// ─── flattenTree ──────────────────────────────────────────────────────

describe('flattenTree', () => {
  const tree = [
    { id: '1', type: 'user', depth: 0, children: [] },
    { id: '2', type: 'tool', depth: 0, collapsible: true, children: [
      { id: '2.1', type: 'tool_result', depth: 1, children: [] },
    ]},
  ];

  test('default: includes children', () => {
    const flat = flattenTree(tree);
    expect(flat).toHaveLength(3);
    expect(flat[0].id).toBe('1');
    expect(flat[1].id).toBe('2');
    expect(flat[2].id).toBe('2.1');
  });

  test('collapsed hides children', () => {
    const collapsed = new Set(['2']);
    const flat = flattenTree(tree, { collapsed });
    expect(flat).toHaveLength(2);
    expect(flat[0].id).toBe('1');
    expect(flat[1].id).toBe('2');
  });

  test('adds treeDepth to each node', () => {
    const flat = flattenTree(tree);
    expect(flat[0].treeDepth).toBe(0);
    expect(flat[1].treeDepth).toBe(0);
    expect(flat[2].treeDepth).toBe(1);
  });
});

// ─── normalizeRuntimeEventMessage tree metadata ───────────────────────

describe('normalizeRuntimeEventMessage — tree metadata', () => {
  test('tool:call has depth=0 collapsible=true', () => {
    const result = normalizeRuntimeEventMessage('tool:call', { toolName: 'bash', args: { cmd: 'ls' } });
    expect(result.message.depth).toBe(0);
    expect(result.message.collapsible).toBe(true);
    expect(result.message.collapsed).toBe(false);
    expect(result.message.toolName).toBe('bash');
  });

  test('tool:result has depth=1 parentType=tool', () => {
    const result = normalizeRuntimeEventMessage('tool:result', { toolName: 'bash', result: 'done' });
    expect(result.message.depth).toBe(1);
    expect(result.message.parentType).toBe('tool');
    expect(result.message.collapsible).toBe(false);
  });

  test('tool:error has depth=1 parentType=tool', () => {
    const result = normalizeRuntimeEventMessage('tool:error', { toolName: 'bash', error: 'fail' });
    expect(result.message.depth).toBe(1);
    expect(result.message.parentType).toBe('tool');
  });

  test('tool:progress has depth=2 parentType=tool_result', () => {
    const result = normalizeRuntimeEventMessage('tool:progress', { toolName: 'bash', progress: 0 });
    expect(result.message.depth).toBe(2);
    expect(result.message.parentType).toBe('tool_result');
    expect(result.message.collapsible).toBe(false);
  });
});
