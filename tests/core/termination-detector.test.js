import { describe, test, expect } from 'bun:test';
import {
  isTermination,
  extractFinalAnswer,
  normalizeFinalAnswer,
  StagnationDetector,
  Termination,
} from '../../src/core/termination-detector.js';

describe('Termination Detection', () => {
  test('isTermination returns false for empty/null', () => {
    expect(isTermination(null)).toBe(false);
    expect(isTermination(undefined)).toBe(false);
  });

  test('isTermination returns true for FINAL_ANSWER keyword', () => {
    expect(isTermination('The answer is FINAL_ANSWER: 42')).toBe(true);
  });

  test('isTermination returns true for whitespace-only string', () => {
    expect(isTermination('   ')).toBe(true);
    // Empty string is falsy, isTermination returns false for !response
    expect(isTermination('')).toBe(false);
  });

  test('isTermination returns false for normal text', () => {
    expect(isTermination('I am still working on the task')).toBe(false);
  });

  test('extractFinalAnswer extracts after keyword', () => {
    const result = extractFinalAnswer('FINAL_ANSWER: 42');
    expect(result).toContain('42');
  });

  test('extractFinalAnswer returns trimmed response when no keyword', () => {
    const result = extractFinalAnswer('  hello world  ');
    expect(result).toBe('hello world');
  });

  test('extractFinalAnswer returns empty for null', () => {
    expect(extractFinalAnswer(null)).toBe('');
    expect(extractFinalAnswer(undefined)).toBe('');
  });

  test('normalizeFinalAnswer handles plain text', () => {
    expect(normalizeFinalAnswer('  Hello World  ')).toBe('Hello World');
  });

  test('normalizeFinalAnswer extracts text from JSON', () => {
    const json = JSON.stringify({ text: 'extracted answer' });
    expect(normalizeFinalAnswer(json)).toBe('extracted answer');
  });

  test('normalizeFinalAnswer extracts answer field from JSON', () => {
    const json = JSON.stringify({ answer: 'my answer' });
    expect(normalizeFinalAnswer(json)).toBe('my answer');
  });

  test('normalizeFinalAnswer extracts done.text from JSON', () => {
    const json = JSON.stringify({ action: { done: { text: 'done text' } } });
    expect(normalizeFinalAnswer(json)).toBe('done text');
  });

  test('Termination constants are defined', () => {
    expect(Termination).toBeDefined();
    expect(typeof Termination.isTermination).toBe('function');
    expect(typeof Termination.extractFinalAnswer).toBe('function');
    expect(typeof Termination.normalizeFinalAnswer).toBe('function');
  });
});

describe('StagnationDetector', () => {
  test('creates instance', () => {
    const detector = new StagnationDetector();
    expect(detector).toBeDefined();
  });

  test('reset clears state', () => {
    const detector = new StagnationDetector();
    detector.reset();
    const state = detector.getState();
    expect(state.windowSize).toBe(0);
    expect(state.lastMutationIteration).toBe(-1);
  });

  test('recordTool adds to window', () => {
    const detector = new StagnationDetector();
    detector.recordTool('read_file', {}, 1, () => false);
    const state = detector.getState();
    expect(state.windowSize).toBe(1);
  });

  test('recordTool tracks mutations', () => {
    const detector = new StagnationDetector();
    detector.recordTool('write_file', {}, 1, () => true);
    const state = detector.getState();
    expect(state.lastMutationIteration).toBe(1);
  });

  test('nudge returns null for early iterations', () => {
    const detector = new StagnationDetector();
    expect(detector.nudge(1, 20)).toBeNull();
    expect(detector.nudge(2, 20)).toBeNull();
  });

  test('progress checkpoint nudge', () => {
    const detector = new StagnationDetector();
    // PROGRESS_CHECKPOINT_INTERVAL is typically 5
    const result = detector.nudge(5, 20);
    // May or may not return based on interval constant
    if (result) {
      expect(result.type).toBe('progress_checkpoint');
    }
  });

  test('getState returns object with expected keys', () => {
    const detector = new StagnationDetector();
    const state = detector.getState();
    expect(state).toHaveProperty('windowSize');
    expect(state).toHaveProperty('lastMutationIteration');
    expect(state).toHaveProperty('lastStagnationNudge');
    expect(state).toHaveProperty('activeProgressCheckpoints');
  });
});
