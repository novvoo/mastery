import { describe, test, expect } from 'bun:test';
import {
  findBalancedJSON,
  parseCALLFormat,
  recoverCallArguments,
  findMatchingBrace,
  findTopLevelKeyPositions,
  findNextUnescapedQuote,
  extractRecoveredValue,
  findMatchingBracket,
} from '../../src/core/parsing/text-tool-parser-call.js';

// ── findBalancedJSON ──────────────────────────────────────────────

describe('findBalancedJSON', () => {
  test('finds simple balanced object', () => {
    const result = findBalancedJSON('{"a":1}', 0);
    expect(result).not.toBeNull();
    expect(result.endIdx).toBe(7);
    expect(result.content).toBe('{"a":1}');
  });

  test('finds nested balanced object', () => {
    const text = '{"a": {"b": 2}}';
    const result = findBalancedJSON(text, 0);
    expect(result).not.toBeNull();
    expect(result.content).toBe('{"a": {"b": 2}}');
  });

  test('ignores braces inside double-quoted strings', () => {
    const text = '{"cmd": "echo {hello}"}';
    const result = findBalancedJSON(text, 0);
    expect(result).not.toBeNull();
    expect(result.content).toBe('{"cmd": "echo {hello}"}');
  });

  test('ignores braces inside single-quoted strings', () => {
    const text = "{'cmd': '{val}'}";
    const result = findBalancedJSON(text, 0);
    expect(result).not.toBeNull();
    expect(result.content).toBe("{'cmd': '{val}'}");
  });

  test('handles escaped quotes inside strings', () => {
    const text = '{"a": "b\\"c"}';
    const result = findBalancedJSON(text, 0);
    expect(result).not.toBeNull();
    expect(result.content).toBe('{"a": "b\\"c"}');
  });

  test('returns null for unbalanced input', () => {
    const result = findBalancedJSON('{"a": 1', 0);
    expect(result).toBeNull();
  });

  test('starts scanning from startIdx', () => {
    const text = 'prefix {"a":1} suffix';
    const result = findBalancedJSON(text, 7);
    expect(result).not.toBeNull();
    expect(result.content).toBe('{"a":1}');
    expect(result.endIdx).toBe(14);
  });

  test('returns null for empty string', () => {
    const result = findBalancedJSON('', 0);
    expect(result).toBeNull();
  });
});

// ── findMatchingBrace ─────────────────────────────────────────────

describe('findMatchingBrace', () => {
  test('finds matching brace for simple object', () => {
    expect(findMatchingBrace('{"a":1}', 0)).toBe(7);
  });

  test('finds matching brace for nested object', () => {
    expect(findMatchingBrace('{"a":{"b":2}}', 0)).toBe(13);
  });

  test('returns -1 when openIdx is not a brace', () => {
    expect(findMatchingBrace('abc', 0)).toBe(-1);
  });

  test('returns -1 for unmatched brace', () => {
    expect(findMatchingBrace('{', 0)).toBe(-1);
  });

  test('handles braces inside strings', () => {
    expect(findMatchingBrace('{"a":"}"}', 0)).toBe(9);
  });

  test('tracks both braces and brackets for depth', () => {
    expect(findMatchingBrace('{"a":[1,2]}', 0)).toBe(11);
  });
});

// ── findMatchingBracket ───────────────────────────────────────────

describe('findMatchingBracket', () => {
  test('finds matching bracket for simple array', () => {
    expect(findMatchingBracket('[1,2,3]', 0)).toBe(7);
  });

  test('returns -1 when openIdx is not a bracket', () => {
    expect(findMatchingBracket('abc', 0)).toBe(-1);
  });

  test('returns -1 for unmatched bracket', () => {
    expect(findMatchingBracket('[', 0)).toBe(-1);
  });

  test('handles nested brackets and braces', () => {
    expect(findMatchingBracket('[{"a":1}]', 0)).toBe(9);
  });

  test('handles strings inside arrays', () => {
    expect(findMatchingBracket('["a]b"]', 0)).toBe(7);
  });
});

// ── findNextUnescapedQuote ────────────────────────────────────────

describe('findNextUnescapedQuote', () => {
  test('finds next unescaped double quote', () => {
    expect(findNextUnescapedQuote('abc"def', 0, '"')).toBe(4);
  });

  test('finds next unescaped single quote', () => {
    expect(findNextUnescapedQuote("abc'def", 0, "'")).toBe(4);
  });

  test('skips escaped quotes', () => {
    expect(findNextUnescapedQuote('a\\"bc"def', 0, '"')).toBe(6);
  });

  test('returns -1 when no matching quote found', () => {
    expect(findNextUnescapedQuote('abcdef', 0, '"')).toBe(-1);
  });

  test('handles multiple escaped quotes', () => {
    expect(findNextUnescapedQuote('\\"\\\\"x', 0, '"')).toBe(5);
  });

  test('starts search from given index', () => {
    expect(findNextUnescapedQuote('a"b"c', 3, '"')).toBe(4);
  });
});

// ── findTopLevelKeyPositions ──────────────────────────────────────

describe('findTopLevelKeyPositions', () => {
  test('finds top-level keys with colon separator', () => {
    const positions = findTopLevelKeyPositions('"name": "test"');
    expect(positions.length).toBe(1);
    expect(positions[0].key).toBe('name');
  });

  test('finds multiple top-level keys', () => {
    const positions = findTopLevelKeyPositions('"a": 1, "b": 2');
    expect(positions.length).toBe(2);
    expect(positions[0].key).toBe('a');
    expect(positions[1].key).toBe('b');
  });

  test('ignores keys inside nested objects', () => {
    const positions = findTopLevelKeyPositions('"outer": {"inner": 1}, "top": 2');
    expect(positions.length).toBe(2);
    expect(positions[0].key).toBe('outer');
    expect(positions[1].key).toBe('top');
  });

  test('recognizes equals sign as key separator', () => {
    const positions = findTopLevelKeyPositions('"name"= "test"');
    expect(positions.length).toBe(1);
    expect(positions[0].key).toBe('name');
  });

  test('ignores non-identifier keys', () => {
    const positions = findTopLevelKeyPositions('"123": 1');
    expect(positions.length).toBe(0);
  });

  test('returns empty array for empty string', () => {
    const positions = findTopLevelKeyPositions('');
    expect(positions.length).toBe(0);
  });
});

// ── extractRecoveredValue ─────────────────────────────────────────

describe('extractRecoveredValue', () => {
  const mockSafeJSONParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  test('extracts double-quoted string value', () => {
    expect(extractRecoveredValue('"hello"', mockSafeJSONParse)).toBe('hello');
  });

  test('extracts single-quoted string value', () => {
    expect(extractRecoveredValue("'hello'", mockSafeJSONParse)).toBe('hello');
  });

  test('handles trailing comma in value', () => {
    expect(extractRecoveredValue('"hello",', mockSafeJSONParse)).toBe('hello');
  });

  test('parses JSON object value', () => {
    const result = extractRecoveredValue('{"a":1}', mockSafeJSONParse);
    expect(result).toEqual({ a: 1 });
  });

  test('parses JSON array value', () => {
    const result = extractRecoveredValue('[1,2]', mockSafeJSONParse);
    expect(result).toEqual([1, 2]);
  });

  test('returns null for null input', () => {
    expect(extractRecoveredValue(null, mockSafeJSONParse)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(extractRecoveredValue(undefined, mockSafeJSONParse)).toBeNull();
  });

  test('returns raw value for unquoted non-JSON value', () => {
    expect(extractRecoveredValue('true', mockSafeJSONParse)).toBe(true);
  });

  test('returns empty string for empty trimmed value', () => {
    expect(extractRecoveredValue('  ', mockSafeJSONParse)).toBe('');
  });
});

// ── recoverCallArguments ──────────────────────────────────────────

describe('recoverCallArguments', () => {
  const mockExtractor = (raw) => {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    let val = raw.trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      return val.slice(1, -1);
    }
    if (val.startsWith("'") && val.endsWith("'")) {
      return val.slice(1, -1);
    }
    return val;
  };

  test('recovers key-value pairs from valid CALL payload', () => {
    const result = recoverCallArguments('{"command": "ls"}', mockExtractor);
    expect(result).not.toBeNull();
    expect(result.command).toBe('ls');
  });

  test('returns null for non-object input', () => {
    expect(recoverCallArguments('not an object', mockExtractor)).toBeNull();
  });

  test('returns null for null input', () => {
    expect(recoverCallArguments(null, mockExtractor)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(recoverCallArguments(undefined, mockExtractor)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(recoverCallArguments('', mockExtractor)).toBeNull();
  });

  test('handles multiple key-value pairs', () => {
    const result = recoverCallArguments('{"a": "1", "b": "2"}', mockExtractor);
    expect(result).not.toBeNull();
    expect(result.a).toBe('1');
    expect(result.b).toBe('2');
  });
});

// ── parseCALLFormat ───────────────────────────────────────────────

describe('parseCALLFormat', () => {
  function makeToolRegistry(names = ['read_file']) {
    const set = new Set(names);
    return { has: (name) => set.has(name) };
  }

  const deps = {
    toolRegistry: makeToolRegistry(['read_file', 'shell', 'web_search']),
    safeJSONParse: (str) => {
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    },
    normalizeJSONToolCall: (name, args) => ({ name, args }),
    recoverCallArguments: (raw) => null,
  };

  test('parses simple CALL format', () => {
    const result = parseCALLFormat('CALL read_file({"path": "/tmp/f.txt"})', deps);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('read_file');
    expect(result[0].arguments.path).toBe('/tmp/f.txt');
    expect(result[0].source).toBe('CALL_format');
  });

  test('parses CALL with leading slash', () => {
    const result = parseCALLFormat('CALL /read_file({"path": "/tmp/f.txt"})', deps);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('read_file');
  });

  test('returns empty for text without CALL', () => {
    const result = parseCALLFormat('no tool calls here', deps);
    expect(result.length).toBe(0);
  });

  test('skips CALL when tool not in registry', () => {
    const result = parseCALLFormat('CALL unknown_tool({"a": 1})', deps);
    expect(result.length).toBe(0);
  });

  test('parses multiple CALL statements', () => {
    const text = 'CALL read_file({"path": "/a"})\nCALL shell({"command": "ls"})';
    const result = parseCALLFormat(text, deps);
    expect(result.length).toBe(2);
  });

  test('handles CALL with nested JSON arguments', () => {
    const result = parseCALLFormat(
      'CALL read_file({"path": "/tmp", "opts": {"verbose": true}})',
      deps,
    );
    expect(result.length).toBe(1);
    expect(result[0].arguments.opts.verbose).toBe(true);
  });

  test('returns empty array for empty string', () => {
    const result = parseCALLFormat('', deps);
    expect(result.length).toBe(0);
  });
});
