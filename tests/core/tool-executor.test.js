import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ToolExecutor } from '../../src/core/runtime/agent/tool-executor.js';
import { Decision } from '../../src/core/runtime/agent/support/security-policy.js';
import { WorkspaceState } from '../../src/core/workspace/workspace-state.js';

function makeTool(name, extra = {}) {
  return {
    name,
    description: `${name} tool`,
    handler: extra.handler || (async () => `${name} result`),
    required: extra.required || [],
    ...extra,
  };
}

function makeMockRegistry(tools = []) {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    get: mock((name) => map.get(name)),
    validateAndCoerceArgs: mock((name, args) => ({ valid: true, coercedArgs: args || {} })),
    has: mock((name) => map.has(name)),
  };
}

function makeMockExecutor({
  tools = [],
  securityPolicy = null,
  config = {},
  snapshotStore = null,
} = {}) {
  const registry = makeMockRegistry(tools);
  const textToolParser = { parse: mock(() => []) };
  const ui = {
    toolCall: mock(() => {}),
    toolResult: mock(() => {}),
    toolError: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    debugEvent: mock(() => {}),
  };
  const executor = new ToolExecutor({
    toolRegistry: registry,
    securityPolicy,
    textToolParser,
    ui,
    config: { toolResultCacheEnabled: false, ...config },
    snapshotStore,
  });
  return { executor, registry, textToolParser, ui };
}

describe('ToolExecutor', () => {
  test('executes a registered tool and returns result', async () => {
    const tool = makeTool('read_file', { handler: async () => 'file content' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.name).toBe('read_file');
    expect(result.result).toBe('file content');
    expect(result.skipped).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test('returns error for unregistered tool', async () => {
    const { executor } = makeMockExecutor({ tools: [] });

    const result = await executor.execute({ id: '1', name: 'unknown_tool', arguments: {} });

    expect(result.name).toBe('unknown_tool');
    expect(result.error).toContain('not registered');
    expect(result.result).toContain('not registered');
  });

  test('blocks tools outside the current routed plan task before emitting toolCall', async () => {
    const browserHandler = mock(async () => 'opened');
    const browserTool = makeTool('browser_open', { handler: browserHandler });
    const writeTool = makeTool('write_file', { required: ['path', 'content'] });
    const { executor, ui } = makeMockExecutor({ tools: [browserTool, writeTool] });

    const result = await executor.execute(
      { id: '1', name: 'browser_open', arguments: {} },
      {
        activeRoutedToolNames: new Set(['write_file', 'change_plan']),
        currentTask: { id: 'write_step', allowedTools: ['write_file'] },
      },
    );

    expect(result.routeBlocked).toBe(true);
    expect(result.error).toContain('not available');
    expect(result.error).toContain('write_file');
    expect(browserHandler).not.toHaveBeenCalled();
    expect(ui.toolCall).not.toHaveBeenCalled();
  });

  test('does not treat an empty routed tool set as a deny-all policy', async () => {
    const customHandler = mock(async () => 'custom ok');
    const customTool = makeTool('custom_tool', { handler: customHandler });
    const { executor } = makeMockExecutor({ tools: [customTool] });

    const result = await executor.execute(
      { id: '1', name: 'custom_tool', arguments: {} },
      { activeRoutedToolNames: new Set() },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe('custom ok');
    expect(customHandler).toHaveBeenCalled();
  });

  test('read-only tools are not skipped on duplicate calls', async () => {
    const tool = makeTool('read_file', { handler: async () => 'content' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const callArgs = { path: '/a.txt' };
    const result1 = await executor.execute({ id: '1', name: 'read_file', arguments: callArgs });
    const result2 = await executor.execute({ id: '2', name: 'read_file', arguments: callArgs });

    expect(result1.skipped).toBeUndefined();
    expect(result2.skipped).toBeUndefined();
    expect(result2.result).toBe('content');
  });

  test('missing read_file uses prior list_dir evidence to suggest existing paths', async () => {
    const readHandler = mock(async () => 'should not run');
    const tool = makeTool('read_file', { handler: readHandler });
    const workspaceState = new WorkspaceState();
    workspaceState.recordDirectoryListing('src', ['main.ts', 'game.js'], 'list_dir');
    workspaceState.recordPathNotFound('src/main.js', 'File not found');
    const { executor } = makeMockExecutor({
      tools: [tool],
      config: { workspaceState },
    });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: 'src/main.js' },
    });

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.predicted).toBe(true);
    expect(result.result).toContain('File not found: "src/main.js"');
    expect(result.result).toContain('src/main.ts');
    expect(result.result).toContain('do not retry "src/main.js"');
    expect(readHandler).not.toHaveBeenCalled();
  });

  test('read-only stagnation warning asks for evidence-based action', async () => {
    const tool = makeTool('read_file', { handler: async () => 'content' });
    const sessionManager = { addSystemMessage: mock(() => {}) };
    const activePlanManager = {
      checkReadOnlyStagnation: mock(() => ({
        isReadOnlyLoop: true,
        streak: 5,
        recentReadOnlyActions: [{ toolName: 'read_file' }, { toolName: 'search' }],
        overExploredTargets: [{ key: 'src/app.js', count: 3 }],
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute(
      {
        id: '1',
        name: 'read_file',
        arguments: { path: 'src/app.js' },
      },
      { activePlanManager, sessionManager },
    );

    expect(sessionManager.addSystemMessage).toHaveBeenCalled();
    const message = sessionManager.addSystemMessage.mock.calls.at(-1)[0];
    expect(message).toContain('READ-ONLY LOOP CHECK');
    expect(message).toContain('without decisive progress');
    expect(message).toContain('evidence-based step');
    expect(message).toContain('single missing fact');
    expect(message).toContain('focused read/search/diagnostic');
    expect(message).not.toContain('without any mutation');
    expect(message).not.toContain('You MUST now take action');
    expect(message).not.toContain('Do NOT continue reading');
  });

  test('read-only cache returns empty string results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-empty-cache-'));
    try {
      writeFileSync(join(root, 'empty.txt'), '', 'utf-8');
      const readHandler = mock(async () => '');
      const tool = makeTool('read_file', { handler: readHandler });
      const snapshotStore = { head: mock(() => 'tag-empty') };
      const { executor } = makeMockExecutor({
        tools: [tool],
        snapshotStore,
        config: { workingDirectory: root, toolResultCacheEnabled: true },
      });

      const call = { name: 'read_file', arguments: { path: 'empty.txt' } };
      const result1 = await executor.execute({ id: '1', ...call });
      const result2 = await executor.execute({ id: '2', ...call });

      expect(result1.result).toBe('');
      expect(result2.cached).toBe(true);
      expect(result2.result).toBe('');
      expect(readHandler).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('read_file range cache honors explicit zero limit from snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-range-cache-'));
    try {
      writeFileSync(join(root, 'a.txt'), 'alpha\nbeta', 'utf-8');
      const readHandler = mock(async () => 'should not run');
      const tool = makeTool('read_file', { handler: readHandler });
      const snapshotStore = {
        head: mock(() => 'tag-a'),
        byHash: mock(() => ({ content: 'alpha\nbeta' })),
      };
      const { executor } = makeMockExecutor({
        tools: [tool],
        snapshotStore,
        config: { workingDirectory: root, toolResultCacheEnabled: true },
      });

      const result = await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'a.txt', offset: 1, limit: 0 },
      });

      expect(result.cached).toBe(true);
      expect(result.result).toBe('');
      expect(readHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('mutation tools are skipped on duplicate calls', async () => {
    const tool = makeTool('write_file', { handler: async () => 'written' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const callArgs = { path: '/a.txt', content: 'hello' };
    const result1 = await executor.execute({ id: '1', name: 'write_file', arguments: callArgs });
    const result2 = await executor.execute({ id: '2', name: 'write_file', arguments: callArgs });

    expect(result1.skipped).toBeUndefined();
    expect(result2.skipped).toBe(true);
    expect(result2.duplicateMutation).toBe(true);
    expect(result2.result.message).toContain('Duplicate mutation write_file skipped');
    expect(result2.result.message).not.toContain('blocked');
  });

  test('requires workspace root observation before first create-task mutation', async () => {
    const writeHandler = mock(async () => 'written');
    const listHandler = mock(async () => 'package.json\nsrc');
    const writeTool = makeTool('write_file', { handler: writeHandler });
    const listTool = makeTool('list_dir', { handler: listHandler });
    const { executor } = makeMockExecutor({ tools: [writeTool, listTool] });

    const blocked = await executor.execute(
      { id: '1', name: 'write_file', arguments: { path: 'package.json', content: '{}' } },
      { currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' } },
    );

    expect(blocked.workspaceContextRequired).toBe(true);
    expect(blocked.skipped).toBe(true);
    expect(writeHandler).not.toHaveBeenCalled();

    await executor.execute(
      { id: '2', name: 'list_dir', arguments: { path: '.' } },
      { currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' } },
    );

    const written = await executor.execute(
      { id: '3', name: 'write_file', arguments: { path: 'snake/package.json', content: '{}' } },
      { currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' } },
    );

    expect(written.result).toBe('written');
    expect(writeHandler).toHaveBeenCalledTimes(1);
  });

  test('write-before-read guardrail requires current file evidence before editing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-write-before-read-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const writeHandler = mock(async () => 'written');
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const sessionManager = { addSystemMessage: mock(() => {}) };
      const { executor } = makeMockExecutor({
        tools: [writeTool],
        config: { workingDirectory: root },
      });

      const result = await executor.execute(
        {
          id: '1',
          name: 'write_file',
          arguments: { path: 'src.js', content: 'export const newValue = 2;\n' },
        },
        { sessionManager },
      );

      expect(result.success).toBe(false);
      expect(result.writeBeforeReadRequired).toBe(true);
      expect(result.result).toContain('without first reading');
      const message = sessionManager.addSystemMessage.mock.calls.at(-1)[0];
      expect(message).toContain('WRITE-BEFORE-READ GUARDRAIL');
      expect(message).toContain('needs current-file evidence');
      expect(message).not.toContain('You MUST read');
      expect(readFileSync(join(root, 'src.js'), 'utf-8')).toBe('export const oldValue = 1;\n');
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('allows write_file to create a new file before read_file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-create-before-read-'));
    try {
      const writeHandler = mock(async () => 'created');
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [writeTool],
        config: { workingDirectory: root },
      });

      const result = await executor.execute({
        id: '1',
        name: 'write_file',
        arguments: { path: 'new-file.js', content: 'export const value = 1;\n' },
      });

      expect(result.result).toBe('created');
      expect(result.writeBeforeReadRequired).toBeUndefined();
      expect(writeHandler).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('checks write-before-read before write_file approval preview', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-approval-before-read-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const writeHandler = mock(async () => 'written');
      const approval = mock(async () => true);
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [writeTool],
        config: { workingDirectory: root, writeFileApproval: approval },
      });

      const result = await executor.execute({
        id: '1',
        name: 'write_file',
        arguments: { path: 'src.js', content: 'export const newValue = 2;\n' },
      });

      expect(result.writeBeforeReadRequired).toBe(true);
      expect(approval).not.toHaveBeenCalled();
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('blocks write_file full overwrite of an existing file after read_file observed it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-write-after-read-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const readHandler = mock(async () => '1: export const oldValue = 1;');
      const writeHandler = mock(async () => 'written');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [readTool, writeTool],
        config: { workingDirectory: root },
      });

      await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'src.js' },
      });
      const result = await executor.execute({
        id: '2',
        name: 'write_file',
        arguments: { path: 'src.js', content: 'export const newValue = 2;\n' },
      });

      expect(result.success).toBe(false);
      expect(result.fullOverwriteBlocked).toBe(true);
      expect(result.result).toContain('Refusing write_file overwrite');
      expect(readFileSync(join(root, 'src.js'), 'utf-8')).toBe('export const oldValue = 1;\n');
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('allows explicit write_file full overwrite of an existing file after read_file observed it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-explicit-overwrite-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const readHandler = mock(async () => '1: export const oldValue = 1;');
      const writeHandler = mock(async () => 'written');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [readTool, writeTool],
        config: { workingDirectory: root },
      });

      await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'src.js' },
      });
      const result = await executor.execute({
        id: '2',
        name: 'write_file',
        arguments: {
          path: 'src.js',
          content: 'export const newValue = 2;\n',
          overwrite: true,
          overwrite_reason: 'Replacing a generated fixture file in full.',
        },
      });

      expect(result.result).toBe('written');
      expect(result.fullOverwriteBlocked).toBeUndefined();
      expect(writeHandler).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires overwrite_reason for explicit write_file full overwrite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-overwrite-reason-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const readHandler = mock(async () => '1: export const oldValue = 1;');
      const writeHandler = mock(async () => 'written');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [readTool, writeTool],
        config: { workingDirectory: root },
      });

      await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'src.js' },
      });
      const result = await executor.execute({
        id: '2',
        name: 'write_file',
        arguments: {
          path: 'src.js',
          content: 'export const newValue = 2;\n',
          overwrite: true,
        },
      });

      expect(result.success).toBe(false);
      expect(result.fullOverwriteBlocked).toBe(true);
      expect(result.result).toContain('overwrite_reason');
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not unlock write_file after a failed read_file observation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-failed-read-before-write-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const readHandler = mock(async () => 'Error: Permission denied');
      const writeHandler = mock(async () => 'written');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [readTool, writeTool],
        config: { workingDirectory: root },
      });

      const readResult = await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'src.js' },
      });
      const writeResult = await executor.execute({
        id: '2',
        name: 'write_file',
        arguments: { path: 'src.js', content: 'export const newValue = 2;\n' },
      });

      expect(readResult.success).toBe(false);
      expect(writeResult.writeBeforeReadRequired).toBe(true);
      expect(writeHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('read_file file_path alias unlocks write_file path for the same file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-read-alias-before-write-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const readHandler = mock(async () => '1: export const oldValue = 1;');
      const writeHandler = mock(async () => 'written');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const writeTool = makeTool('write_file', { handler: writeHandler });
      const { executor } = makeMockExecutor({
        tools: [readTool, writeTool],
        config: { workingDirectory: root },
      });

      await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { file_path: 'src.js', path: 'src.js' },
      });
      const result = await executor.execute({
        id: '2',
        name: 'write_file',
        arguments: {
          path: 'src.js',
          content: 'export const newValue = 2;\n',
          overwrite: true,
          overwrite_reason: 'Testing alias-based read unlock before intentional replacement.',
        },
      });

      expect(result.result).toBe('written');
      expect(writeHandler).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('blocks edit_file before read_file for an existing file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-edit-before-read-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const editHandler = mock(async () => 'edited');
      const editTool = makeTool('edit_file', { handler: editHandler });
      const { executor } = makeMockExecutor({
        tools: [editTool],
        config: { workingDirectory: root },
      });

      const result = await executor.execute({
        id: '1',
        name: 'edit_file',
        arguments: { path: 'src.js', old_text: 'oldValue', new_text: 'newValue' },
      });

      expect(result.writeBeforeReadRequired).toBe(true);
      expect(result.result).toContain('without first reading');
      expect(editHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('allows edit_file after read_file observed the target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-edit-after-read-'));
    try {
      writeFileSync(join(root, 'src.js'), 'export const oldValue = 1;\n', 'utf-8');
      const readHandler = mock(async () => '1: export const oldValue = 1;');
      const editHandler = mock(async () => 'edited');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const editTool = makeTool('edit_file', { handler: editHandler });
      const { executor } = makeMockExecutor({
        tools: [readTool, editTool],
        config: { workingDirectory: root },
      });

      await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'src.js' },
      });
      const result = await executor.execute({
        id: '2',
        name: 'edit_file',
        arguments: { path: 'src.js', old_text: 'oldValue', new_text: 'newValue' },
      });

      expect(result.result).toBe('edited');
      expect(editHandler).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('allows scoped create tasks to inspect workspace root before writing', async () => {
    const listHandler = mock(async () => 'package.json\nsrc');
    const listTool = makeTool('list_dir', { handler: listHandler });
    const { executor } = makeMockExecutor({ tools: [listTool] });

    const result = await executor.execute(
      { id: '1', name: 'list_dir', arguments: { path: '.' } },
      {
        scopeFiles: ['src/game.js'],
        currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBe('package.json\nsrc');
    expect(listHandler).toHaveBeenCalledTimes(1);
  });

  test('still blocks scoped list_dir outside workspace-root observation', async () => {
    const listHandler = mock(async () => 'should not run');
    const listTool = makeTool('list_dir', { handler: listHandler });
    const { executor } = makeMockExecutor({ tools: [listTool] });

    const result = await executor.execute(
      { id: '1', name: 'list_dir', arguments: { path: 'other' } },
      {
        scopeFiles: ['src/game.js'],
        currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' },
      },
    );

    expect(result.scopeBlocked).toBe(true);
    expect(result.result).toContain('SCOPE_BLOCKED');
    expect(listHandler).not.toHaveBeenCalled();
  });

  test('allows scoped create tasks to read root project context after workspace root observation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-context-read-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"name":"existing"}', 'utf-8');
      const listTool = makeTool('list_dir', { handler: mock(async () => 'package.json\nsrc') });
      const readHandler = mock(async () => '{"name":"existing"}');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const { executor } = makeMockExecutor({
        tools: [listTool, readTool],
        config: { workingDirectory: root },
      });
      const context = {
        scopeFiles: ['src/game.js'],
        currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' },
      };

      await executor.execute({ id: '1', name: 'list_dir', arguments: { path: '.' } }, context);
      const result = await executor.execute(
        { id: '2', name: 'read_file', arguments: { path: 'package.json' } },
        context,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe('{"name":"existing"}');
      expect(readHandler).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('still blocks scoped read_file outside root project context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-context-read-block-'));
    try {
      writeFileSync(join(root, 'other.txt'), 'nope', 'utf-8');
      const listTool = makeTool('list_dir', { handler: mock(async () => 'other.txt\nsrc') });
      const readHandler = mock(async () => 'should not run');
      const readTool = makeTool('read_file', { required: ['path'], handler: readHandler });
      const { executor } = makeMockExecutor({
        tools: [listTool, readTool],
        config: { workingDirectory: root },
      });
      const context = {
        scopeFiles: ['src/game.js'],
        currentTask: { phase: 'implementation', name: '实现一个工程化的贪吃蛇游戏' },
      };

      await executor.execute({ id: '1', name: 'list_dir', arguments: { path: '.' } }, context);
      const result = await executor.execute(
        { id: '2', name: 'read_file', arguments: { path: 'other.txt' } },
        context,
      );

      expect(result.scopeBlocked).toBe(true);
      expect(result.result).toContain('SCOPE_BLOCKED');
      expect(readHandler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('duplicate mutation preserves empty previous result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-empty-mutation-'));
    try {
      const tool = makeTool('write_file', { handler: async () => '' });
      const { executor } = makeMockExecutor({
        tools: [tool],
        config: { workingDirectory: root, toolResultCacheEnabled: true },
      });

      const callArgs = { path: '/a.txt', content: '' };
      const result1 = await executor.execute({ id: '1', name: 'write_file', arguments: callArgs });
      const result2 = await executor.execute({ id: '2', name: 'write_file', arguments: callArgs });

      expect(result1.result).toBe('');
      expect(result2.skipped).toBe(true);
      expect(result2.cached).toBe(true);
      expect(result2.result.previousResult).toBe('');
      expect(result2.result.message).toContain('Previous result');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('blocks tool call when security policy denies', async () => {
    const tool = makeTool('shell', { handler: async () => 'output' });
    const policy = {
      evaluate: mock(() => ({ decision: Decision.DENY, suggestedMessage: 'dangerous command' })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({
      id: '1',
      name: 'shell',
      arguments: { command: 'rm -rf /' },
    });

    expect(result.error).toContain('dangerous command');
    expect(result.result).toContain('Security policy blocked');
  });

  test('blocks tool call when security policy requires approval', async () => {
    const tool = makeTool('shell', { handler: async () => 'output' });
    const policy = {
      evaluate: mock(() => ({
        decision: Decision.REQUIRE_APPROVAL,
        suggestedMessage: 'needs approval',
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('needs approval');
  });

  test('blocks tool call when security policy rate limited', async () => {
    const tool = makeTool('shell', { handler: async () => 'output' });
    const policy = {
      evaluate: mock(() => ({
        decision: Decision.RATE_LIMITED,
        suggestedMessage: 'too many calls',
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('too many calls');
  });

  test('returns error when required parameters are missing', async () => {
    const tool = makeTool('write_file', { required: ['path', 'content'] });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'write_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.error).toContain('Missing required parameter');
    expect(result.error).toContain('content');
  });

  test('normalizes write_file new_content alias before required parameter validation', async () => {
    const writeHandler = mock(async (args) => `wrote ${args.content}`);
    const tool = makeTool('write_file', {
      required: ['path', 'content'],
      handler: writeHandler,
    });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'write_file',
      arguments: { file_path: '/tmp/package.json', new_content: '{"ok":true}' },
    });

    expect(result.error).toBeUndefined();
    expect(result.args).toMatchObject({
      path: '/tmp/package.json',
      content: '{"ok":true}',
    });
    expect(writeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/package.json', content: '{"ok":true}' }),
      expect.any(Object),
    );
  });

  test('normalizes project_profile issue fields into task before required parameter validation', async () => {
    const profileHandler = mock(async (args) => `profile ${args.task}`);
    const tool = makeTool('project_profile', {
      required: ['task'],
      handler: profileHandler,
    });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'project_profile',
      arguments: {
        issue: 'Webpack export/import mismatch causing TypeError',
        finding: 'ES6 classes are imported as named function exports',
        solution: 'Use default imports and instantiate classes with new',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.args.task).toContain('Webpack export/import mismatch');
    expect(result.args.task).toContain('ES6 classes are imported');
    expect(result.args.task).toContain('Use default imports');
    expect(profileHandler).toHaveBeenCalledWith(
      expect.objectContaining({ task: expect.stringContaining('Webpack export/import mismatch') }),
      expect.any(Object),
    );
  });

  test('read_file missing-file fallback emits read_file result, not list_dir result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-read-fallback-'));
    try {
      const readTool = makeTool('read_file', {
        required: ['path'],
        handler: mock(async () => 'should not run'),
      });
      const listTool = makeTool('list_dir', {
        handler: mock(async () => 'F webpack.config.cjs'),
      });
      const { executor, ui } = makeMockExecutor({
        tools: [readTool, listTool],
        config: { workingDirectory: root },
      });

      const result = await executor.execute({
        id: '1',
        name: 'read_file',
        arguments: { path: 'webpack.config.js' },
      });

      expect(result.name).toBe('read_file');
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
      expect(result.skipped).toBe(true);
      expect(result.fallbackToDir).toBe(true);
      expect(result.result).toContain('File not found');
      expect(result.result).toContain('F webpack.config.cjs');
      expect(result.result).toContain('switch to write_file');
      expect(ui.toolResult).toHaveBeenCalledWith(
        'read_file',
        expect.stringContaining('File not found'),
        expect.objectContaining({ path: 'webpack.config.js' }),
      );
      expect(ui.toolResult).not.toHaveBeenCalledWith(
        'list_dir',
        expect.anything(),
        expect.anything(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing read_file in empty create-from-scratch workspace returns file context instead of fact-blocking', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-executor-empty-read-'));
    const workspaceState = new WorkspaceState();
    try {
      workspaceState.recordToolResult(
        'list_dir',
        { path: '.' },
        '.agent-data\n.agent-logs\n.agent-memory\ntest',
        true,
      );
      const readTool = makeTool('read_file', {
        required: ['path'],
        handler: mock(async () => 'should not run'),
      });
      const listTool = makeTool('list_dir', {
        handler: mock(async () => '.agent-data\n.agent-logs\n.agent-memory\ntest'),
      });
      const { executor } = makeMockExecutor({
        tools: [readTool, listTool],
        config: { workspaceState, workingDirectory: root },
      });

      const result = await executor.execute(
        {
          id: '1',
          name: 'read_file',
          arguments: { path: 'package.json' },
        },
        {
          workspaceState,
          activePlan: { context: { createFromScratch: true } },
          currentTask: {
            id: 'profile_project',
            phase: 'exploration',
            allowedTools: ['read_file'],
          },
        },
      );

      expect(result.skipped).toBe(true);
      expect(result.fallbackToDir).toBe(true);
      expect(result.result).toContain('File not found');
      expect(result.result).not.toContain('FACT_BLOCKED');
      expect(readTool.handler).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('normalizes OpenAI-style function tool calls', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: 'call_abc',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"/a.txt"}' },
    });

    expect(result.name).toBe('read_file');
    expect(result.result).toBe('ok');
  });

  test('records events accessible via events getter', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute({ id: '1', name: 'read_file', arguments: { path: '/a.txt' } });

    const events = executor.events;
    expect(events.length).toBe(1);
    expect(events[0].name).toBe('read_file');
    expect(events[0].success).toBe(true);
  });

  test('onEvent subscribes and receives events', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });
    const received = [];

    const unsub = executor.onEvent((event) => received.push(event));
    await executor.execute({ id: '1', name: 'read_file', arguments: { path: '/a.txt' } });

    expect(received.length).toBe(1);
    expect(received[0].name).toBe('read_file');

    // Unsubscribe and verify no more events
    unsub();
    await executor.execute({ id: '2', name: 'read_file', arguments: { path: '/b.txt' } });
    expect(received.length).toBe(1); // still 1 after unsubscribe
  });

  test('reset clears call history and events', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute({ id: '1', name: 'read_file', arguments: { path: '/a.txt' } });
    expect(executor.events.length).toBe(1);

    executor.reset();
    expect(executor.events.length).toBe(0);

    // After reset, same call should not be deduped
    const result = await executor.execute({
      id: '2',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.result).toBe('ok');
  });

  test('handles tool handler errors gracefully', async () => {
    const tool = makeTool('fail_tool', {
      handler: async () => {
        throw new Error('something broke');
      },
    });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({ id: '1', name: 'fail_tool', arguments: {} });

    expect(result.error).toContain('something broke');
    expect(result.result).toContain('Error: something broke');
    expect(executor.events.length).toBe(1);
    expect(executor.events[0].success).toBe(false);
  });

  test('normalizes string arguments to object', async () => {
    const tool = makeTool('read_file', { handler: async (args) => args.path });
    const { executor } = makeMockExecutor({ tools: [tool] });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: '{"path":"/x.txt"}',
    });

    expect(result.name).toBe('read_file');
  });

  test('uses coerceArgs from registry when available', async () => {
    const tool = makeTool('search', { handler: async (args) => args.query });
    const registry = makeMockRegistry([tool]);
    registry.validateAndCoerceArgs = mock((name, args) => ({
      valid: false,
      errors: ['query is required'],
      coercedArgs: args || {},
    }));
    const textToolParser = { parse: mock(() => []) };
    const ui = {
      toolCall: mock(() => {}),
      toolResult: mock(() => {}),
      toolError: mock(() => {}),
      warn: mock(() => {}),
      debug: mock(() => {}),
    };
    const executor = new ToolExecutor({
      toolRegistry: registry,
      textToolParser,
      ui,
      config: { toolResultCacheEnabled: false },
    });

    const result = await executor.execute({ id: '1', name: 'search', arguments: {} });

    expect(result.name).toBe('search');
    expect(ui.warn).toHaveBeenCalled();
  });

  test('backward-compatible security policy: requiresApproval', async () => {
    const tool = makeTool('shell', { handler: async () => 'ok' });
    const policy = {
      requiresApproval: mock((name) => name === 'shell'),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('approval_required');
  });

  test('backward-compatible security policy: validateToolCall returns false', async () => {
    const tool = makeTool('shell', { handler: async () => 'ok' });
    const policy = {
      validateToolCall: mock(() => false),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({ id: '1', name: 'shell', arguments: { command: 'ls' } });

    expect(result.error).toContain('denied');
  });

  test('workspaceState prediction skips tool', async () => {
    const tool = makeTool('read_file', { handler: async () => 'content' });
    const workspaceState = {
      predictToolResult: mock(() => ({
        canSkip: true,
        reason: 'file already read',
        predicted: 'cached content',
      })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], config: { workspaceState } });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.skipped).toBe(true);
    expect(result.predicted).toBe(true);
    expect(result.result).toBe('cached content');
  });

  test('skips redundant shell mkdir when workspace facts already prove directory exists', async () => {
    const workspaceState = new WorkspaceState();
    workspaceState.recordFileRead('src/game/Snake.js', true, 'class Snake {}');
    const handler = mock(async () => 'mkdir executed');
    const tool = makeTool('shell', { handler });
    const { executor } = makeMockExecutor({ tools: [tool], config: { workspaceState } });

    const result = await executor.execute({
      id: '1',
      name: 'shell',
      arguments: { command: "mkdir -p 'src/game'" },
    });

    expect(result.skipped).toBe(true);
    expect(result.predicted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.result).toContain('Skipped redundant mkdir');
    expect(handler).not.toHaveBeenCalled();
  });

  test('events getter returns a copy (not the internal array)', async () => {
    const { executor } = makeMockExecutor({ tools: [] });
    const e1 = executor.events;
    const e2 = executor.events;
    expect(e1).not.toBe(e2); // different array instances
  });

  test('works with minimal constructor args (defaults)', async () => {
    const executor = new ToolExecutor({});
    // Should not throw on construction
    expect(executor.events).toEqual([]);
  });

  test('calls emitObservation when provided in options', async () => {
    const tool = makeTool('read_file', { handler: async () => 'data' });
    const { executor } = makeMockExecutor({ tools: [tool] });
    const observations = [];
    const emitObservation = mock((id, name, result, mode) =>
      observations.push({ id, name, result, mode }),
    );

    await executor.execute(
      { id: '1', name: 'read_file', arguments: { path: '/a.txt' } },
      {},
      { resultMode: 'observation', emitObservation },
    );

    expect(observations.length).toBe(1);
    expect(observations[0].name).toBe('read_file');
    expect(observations[0].mode).toBe('observation');
  });

  test('passes execution context to tool handler', async () => {
    let capturedCtx = null;
    const tool = makeTool('ctx_tool', {
      handler: async (args, ctx) => {
        capturedCtx = ctx;
        return 'ok';
      },
    });
    const { executor } = makeMockExecutor({ tools: [tool] });

    await executor.execute(
      { id: '1', name: 'ctx_tool', arguments: {} },
      { memoryManager: { mem: true }, sessionManager: { sess: true }, debug: true },
    );

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx.memoryManager).toEqual({ mem: true });
    expect(capturedCtx.sessionManager).toEqual({ sess: true });
    expect(capturedCtx.debug).toBe(true);
  });

  test('security policy allows tool when decision is ALLOW', async () => {
    const tool = makeTool('read_file', { handler: async () => 'ok' });
    const policy = {
      evaluate: mock(() => ({ decision: Decision.ALLOW })),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.error).toBeUndefined();
    expect(result.result).toBe('ok');
  });

  test('applies security result policy (truncateResult)', async () => {
    const tool = makeTool('read_file', { handler: async () => 'long content here' });
    const policy = {
      evaluate: mock(() => ({ decision: Decision.ALLOW })),
      truncateResult: mock((name, result) => result.substring(0, 5)),
    };
    const { executor } = makeMockExecutor({ tools: [tool], securityPolicy: policy });

    const result = await executor.execute({
      id: '1',
      name: 'read_file',
      arguments: { path: '/a.txt' },
    });

    expect(result.result).toBe('long ');
  });
});
