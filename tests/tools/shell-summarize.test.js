import { describe, test, expect } from 'bun:test';
import { summarizeTestOutput, stripAnsi } from '../../src/tools/system/shell.js';

describe('stripAnsi', () => {
  test('removes ANSI color codes', () => {
    const input = '\x1B[31mhello\x1B[39m \x1B[1mworld\x1B[22m';
    expect(stripAnsi(input)).toBe('hello world');
  });

  test('removes ANSI escape sequences from vitest output', () => {
    const input = '\x1B[7m\x1B[1m\x1B[36m RUN \x1B[39m\x1B[22m\x1B[27m \x1B[36mv1.6.1\x1B[39m\n\x1B[31m   \x1B[33m❯\x1B[31m snake is not defined\x1B[39m';
    const result = stripAnsi(input);
    expect(result).not.toContain('\x1B[');
    expect(result).toContain('RUN');
    expect(result).toContain('snake is not defined');
  });

  test('handles plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  test('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('summarizeTestOutput', () => {
  test('returns null for non-test output', () => {
    expect(summarizeTestOutput('ls output', '')).toBeNull();
    expect(summarizeTestOutput('node server.js', '')).toBeNull();
    expect(summarizeTestOutput('', 'some error')).toBeNull();
  });

  test('summarizes vitest output with failures', () => {
    const vitestOutput =
      ' RUN  v1.6.1\n' +
      '\n' +
      ' ✓ snake.test.js\n' +
      ' ❯ src/__tests__/snake.test.js  (10 tests | 1 failed)\n' +
      '   ❯ src/__tests__/snake.test.js > Snake Game > snake moves down\n' +
      '     → expected { x: 10, y: 9 } to deeply equal { x: 10, y: 11 }\n' +
      '       at <anonymous> (src/__tests__/snake.test.js:25:30)\n' +
      ' ❯ snake.test.js > fails to load\n' +
      '     → Failed to load url ./snake.js\n' +
      '\n' +
      ' Test Files  3 failed (3)\n' +
      ' Tests  1 failed | 9 passed (10)\n' +
      ' Duration  328ms\n';

    const result = summarizeTestOutput(vitestOutput, '');
    expect(result).not.toBeNull();
    expect(result).toContain('snake moves down');
    expect(result).toContain('expected { x: 10, y: 9 }');
    expect(result).not.toContain('✓ snake.test.js'); // passed test should be stripped
    expect(result).toContain('Test Files');
    expect(result).toContain('Tests');
  });

  test('summarizes jest-style output with failure context', () => {
    const jestOutput =
      ' FAIL  test/snake.test.js\n' +
      '  ● Snake Game › snake cannot turn 180 degrees\n' +
      '    expect(received).toBe(expected)\n' +
      '    Expected: "up"\n' +
      '    Received: "down"\n' +
      '\n' +
      ' Test Suites: 1 failed, 1 passed, 2 total\n' +
      ' Tests:       1 failed, 3 passed, 4 total\n';

    const result = summarizeTestOutput(jestOutput, '');
    expect(result).not.toBeNull();
    expect(result).toContain('snake cannot turn 180 degrees');
    expect(result).toContain('Expected: "up"');
    expect(result).toContain('Received: "down"');
    expect(result).toContain('Test Suites');
  });

  test('summarizes pytest output from stderr', () => {
    const pytestStderr =
      ' FAILED test_demo.py::test_magic - AssertionError: assert 1 == 2\n' +
      'FAILED test_demo.py::test_result - AssertionError: assert 42 == 0\n';

    const result = summarizeTestOutput('', pytestStderr);
    expect(result).not.toBeNull();
    expect(result).toContain('FAILED');
    expect(result).toContain('assert 1 == 2');
  });

  test('handles all-passing test output', () => {
    const passingOutput =
      ' ✓ test_a passed\n' +
      ' ✓ test_b passed\n' +
      ' Test Files  0 failed (0)\n' +
      ' Tests  10 passed (10)\n';

    const result = summarizeTestOutput(passingOutput, '');
    expect(result).not.toBeNull();
    expect(result).toContain('Test Files');
    expect(result).toContain('Tests');
    expect(result).not.toContain('test_a'); // individual passes stripped
  });
});
