/**
 * CALL format parser edge case: nested braces in string values
 * Repro: CALL shell({\"command\": \"code with {x: 10} in it\"})
 * The non-greedy regex \{[\s\S]*?\} stops at the first } which
 * lives inside a JSON string value, truncating the argument object.
 */

import { describe, it, expect } from 'bun:test';
import { TextToolParser } from '../../src/core/parsing/text-tool-parser.js';

function createParser() {
  const tools = {
    has: (name) => ['shell', 'write_file', 'list_dir', 'read_file', 'verify'].includes(name),
    getAll: () => [{ name: 'shell', category: 'runtime' }],
  };
  return new TextToolParser(tools);
}

describe('CALL format: nested braces in string values', () => {
  it('parses CALL with simple string argument (baseline)', () => {
    const parser = createParser();
    const text = 'CALL shell({"command": "echo hello"})';
    const result = parser.parse(text);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('shell');
    expect(result[0].arguments.command).toBe('echo hello');
  });

  it('parses CALL with curly braces inside string value', () => {
    const parser = createParser();
    const text = 'CALL shell({"command": "const obj = { x: 10, y: 20 };"})';
    const result = parser.parse(text);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('shell');
    expect(result[0].arguments.command).toBe('const obj = { x: 10, y: 20 };');
  });

  it('parses CALL with deeply nested braces (snake game scenario)', () => {
    const parser = createParser();
    const innerCode = 'let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }]; if (true) { score++; }';
    const text = `CALL shell({"command": "python3 -c \\"code = '''${innerCode}'''\nprint('ok')\\""})`;
    const result = parser.parse(text);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('shell');
    expect(typeof result[0].arguments.command).toBe('string');
    expect(result[0].arguments.command.length).toBeGreaterThan(10);
  });

  it('parses CALL with multiline argument containing multiple code braces', () => {
    const parser = createParser();
    const text = `CALL shell({"command": "python3 -c \\"\nimport sys\ncode = '''function init() {\n  const mid = { x: 10, y: 10 };\n  snake = [{ x: mid.x, y: mid.y }, { x: mid.x - 1, y: mid.y }];\n  score = 0;\n}\ninit();\n'''\nwith open('/tmp/snake.js', 'w') as f:\n    f.write(code)\nprint('Written', len(code), 'bytes')\n\\""})`;
    const result = parser.parse(text);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('shell');
    expect(result[0].arguments.command).toContain('init');
  });
});
