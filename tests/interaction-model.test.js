import { describe, expect, test } from 'bun:test';
import {
  assessPromptRisk,
  createRunNarrative,
  createComposerInteractionState,
  deriveInteractionStages,
  getComposerSubmitTransition,
  getComposerAssistText,
  getShortcutHints,
  getToolActivitySummary,
  handleComposerKey,
} from '../desktop/renderer/app/interaction/interaction-model.js';

describe('desktop interaction model', () => {
  test('Ctrl+Enter submits when input is non-empty and runtime is not running', () => {
    const initial = createComposerInteractionState();
    const result = handleComposerKey({ key: 'Enter', ctrlKey: true }, initial, {
      value: 'ship the feature',
      status: 'idle',
      now: 1000,
    });

    expect(result.action).toBe('submit');
    expect(result.state.historyIndex).toBe(-1);
  });

  test('accepted composer submissions clear immediately and keep a restore value', () => {
    const transition = getComposerSubmitTransition({
      value: '  build the dashboard  ',
      status: 'idle',
    });

    expect(transition.accepted).toBe(true);
    expect(transition.input).toBe('build the dashboard');
    expect(transition.nextValue).toBe('');
    expect(transition.restoreValue).toBe('build the dashboard');
    expect(transition.showSuggestions).toBe(false);
  });

  test('composer submission can keep drafts for continuation inputs', () => {
    const transition = getComposerSubmitTransition({
      value: 'answer the follow-up',
      status: 'needs_user_input',
      clearInput: false,
    });

    expect(transition.accepted).toBe(true);
    expect(transition.nextValue).toBe('answer the follow-up');
  });

  test('composer submission while running preserves the draft', () => {
    const transition = getComposerSubmitTransition({
      value: '/doc search auth',
      status: 'running',
    });

    expect(transition.accepted).toBe(false);
    expect(transition.nextValue).toBe('/doc search auth');
    expect(transition.focus).toBe(true);
    expect(transition.showSuggestions).toBe(true);
  });

  test('high-risk prompts require a second Ctrl+Enter confirmation', () => {
    const first = handleComposerKey(
      { key: 'Enter', ctrlKey: true },
      createComposerInteractionState(),
      { value: 'run rm -rf ./dist and deploy to production', status: 'idle', now: 1000 },
    );

    expect(first.action).toBe('notice');
    expect(first.risk.level).toBe('high');
    expect(first.state.notice.text).toContain('again');

    const second = handleComposerKey({ key: 'Enter', ctrlKey: true }, first.state, {
      value: 'run rm -rf ./dist and deploy to production',
      status: 'idle',
      now: 1500,
    });

    expect(second.action).toBe('submit');
  });

  test('Ctrl+Enter is a noop while runtime is running', () => {
    const result = handleComposerKey(
      { key: 'Enter', metaKey: true },
      createComposerInteractionState(),
      { value: 'new task', status: 'running', now: 1000 },
    );

    expect(result.action).toBe('noop');
  });

  test('Escape requires a second press before clearing a draft', () => {
    const first = handleComposerKey({ key: 'Escape' }, createComposerInteractionState(), {
      value: 'half written prompt',
      now: 1000,
    });

    expect(first.action).toBe('notice');
    expect(first.state.notice.text).toContain('Esc again');

    const second = handleComposerKey({ key: 'Escape' }, first.state, {
      value: 'half written prompt',
      now: 1800,
    });

    expect(second.action).toBe('clear');
    expect(second.state.notice).toBe(null);
  });

  test('ArrowUp and ArrowDown navigate normalized input history', () => {
    const history = [
      { input: 'fix failing tests' },
      { input: 'fix failing tests' },
      { input: 'add docs' },
    ];
    const up = handleComposerKey({ key: 'ArrowUp' }, createComposerInteractionState(), {
      value: '',
      history,
      now: 1000,
    });

    expect(up.action).toBe('replace_input');
    expect(up.value).toBe('fix failing tests');

    const upAgain = handleComposerKey({ key: 'ArrowUp' }, up.state, {
      value: '',
      history,
      now: 1100,
    });

    expect(upAgain.value).toBe('add docs');

    const down = handleComposerKey({ key: 'ArrowDown' }, upAgain.state, {
      value: '',
      history,
      now: 1200,
    });

    expect(down.value).toBe('fix failing tests');
  });

  test('interaction stages describe active tool work and final answer', () => {
    const messages = [
      { type: 'user', content: 'build it' },
      { type: 'thinking', content: 'planning' },
      {
        type: 'tool',
        toolName: 'read_file',
        activity: { phase: 'running', toolName: 'read_file' },
      },
      {
        type: 'tool_result',
        toolName: 'read_file',
        activity: { phase: 'completed', toolName: 'read_file' },
      },
      { type: 'result', content: 'done' },
    ];

    const stages = deriveInteractionStages({ status: 'completed', messages });
    expect(stages.map((stage) => stage.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(stages.find((stage) => stage.key === 'tools').detail).toContain('read_file');
  });

  test('tool activity summary reports latest tool and counts', () => {
    const summary = getToolActivitySummary([
      { type: 'tool', toolName: 'shell', activity: { phase: 'running', toolName: 'shell' } },
      {
        type: 'tool_result',
        toolName: 'shell',
        activity: { phase: 'completed', toolName: 'shell' },
      },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.latestTool).toBe('shell');
    expect(summary.label).toContain('done');
  });

  test('prompt risk separates read-only, workspace-changing, and destructive tasks', () => {
    expect(assessPromptRisk('explain this architecture').level).toBe('low');
    expect(assessPromptRisk('修改 README 并运行测试').level).toBe('medium');
    expect(assessPromptRisk('git push --force to main').level).toBe('high');
  });

  test('shortcut hints expose discoverable composer controls', () => {
    const hints = getShortcutHints({ hasHistory: true, status: 'idle' });
    expect(hints.map((hint) => hint.key)).toContain('Ctrl+Enter');
    expect(hints.map((hint) => hint.key)).toContain('Esc Esc');
    expect(hints.find((hint) => hint.key === 'Up').label).toBe('history');
  });

  test('run narrative explains current state in plain language', () => {
    expect(createRunNarrative({ status: 'idle', messages: [] })).toContain('Ready');
    expect(
      createRunNarrative({
        status: 'running',
        messages: [{ type: 'tool', toolName: 'read_file' }],
      }),
    ).toContain('read_file');
    expect(createRunNarrative({ status: 'needs_user_input', messages: [] })).toContain('waiting');
  });

  test('assist text prioritizes notice and running state', () => {
    expect(
      getComposerAssistText({
        status: 'idle',
        value: 'draft',
        notice: { tone: 'warning', text: 'Esc again to clear draft' },
      }),
    ).toBe('Esc again to clear draft');

    expect(getComposerAssistText({ status: 'running', value: '', notice: null })).toContain(
      'running',
    );
  });
});
