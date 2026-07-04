import { describe, test, expect } from 'bun:test';
import {
  runtimeToolCommandLines,
  runtimeToolCallFromBareCommand,
} from '../../src/core/parsing/text-tool-parser-toolcode.js';
import { mapRuntimeToolCommandName } from '../../src/core/prompts/text-tool-parser-normalizers.js';

function makeMockRegistry(names) {
  const set = new Set(names);
  return { has: (name) => set.has(name) };
}

const defaultDeps = {
  toolRegistry: makeMockRegistry(['write_file', 'read_file', 'list_dir', 'shell']),
  resolveToolName: (name) => name,
  safeJSONParse: (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  },
  normalizeJSONToolCall: (name, args) => ({ name, args }),
};

describe('runtimeToolCommandLines', () => {
  test('splits text into lines', () => {
    const result = runtimeToolCommandLines('line1\nline2\nline3');
    expect(result).toEqual(['line1', 'line2', 'line3']);
  });

  test('trims and removes $ prefix', () => {
    const result = runtimeToolCommandLines('  $ ls -la  \n  $ cd /tmp  ');
    expect(result).toEqual(['ls -la', 'cd /tmp']);
  });

  test('filters empty lines and comments', () => {
    const result = runtimeToolCommandLines('\n# comment\nls\n\n# another comment\n');
    expect(result).toEqual(['ls']);
  });

  test('merges tool name with following JSON on next line', () => {
    const result = runtimeToolCommandLines('write_file\n{"file_path": "test.js", "content": "hello"}');
    expect(result).toEqual(['write_file {"file_path": "test.js", "content": "hello"}']);
  });

  test('merges multiple tool calls with JSON on next line', () => {
    const result = runtimeToolCommandLines(
      'read_file\n{"path": "a.js"}\nwrite_file\n{"file_path": "b.js", "content": "test"}'
    );
    expect(result).toEqual([
      'read_file {"path": "a.js"}',
      'write_file {"file_path": "b.js", "content": "test"}',
    ]);
  });

  test('does not merge non-tool lines', () => {
    const result = runtimeToolCommandLines('echo "hello"\n{"some": "data"}');
    expect(result).toEqual(['echo "hello"', '{"some": "data"}']);
  });
});

describe('mapRuntimeToolCommandName', () => {
  test('maps write to write_file', () => {
    const result = mapRuntimeToolCommandName('write', (n) => n);
    expect(result).toBe('write_file');
  });

  test('maps read to read_file', () => {
    const result = mapRuntimeToolCommandName('read', (n) => n);
    expect(result).toBe('read_file');
  });

  test('maps cat to read_file', () => {
    const result = mapRuntimeToolCommandName('cat', (n) => n);
    expect(result).toBe('read_file');
  });

  test('maps ls to list_dir', () => {
    const result = mapRuntimeToolCommandName('ls', (n) => n);
    expect(result).toBe('list_dir');
  });

  test('maps edit to edit_file', () => {
    const result = mapRuntimeToolCommandName('edit', (n) => n);
    expect(result).toBe('edit_file');
  });

  test('returns original name if no mapping exists', () => {
    const result = mapRuntimeToolCommandName('unknown', (n) => n);
    expect(result).toBe('unknown');
  });

  test('applies resolver function for unmapped names', () => {
    const result = mapRuntimeToolCommandName('unknown_tool', (n) => `resolved_${n}`);
    expect(result).toBe('resolved_unknown_tool');
  });
});

describe('runtimeToolCallFromBareCommand', () => {
  test('parses write_file with inline JSON', () => {
    const result = runtimeToolCallFromBareCommand(
      'write_file {"file_path": "test.js", "content": "hello"}',
      0,
      defaultDeps
    );
    expect(result).not.toBeNull();
    expect(result.name).toBe('write_file');
    expect(result.arguments.file_path).toBe('test.js');
    expect(result.arguments.content).toBe('hello');
  });

  test('parses write_file alias "write" with inline JSON', () => {
    const result = runtimeToolCallFromBareCommand(
      'write {"file_path": "test.js", "content": "hello"}',
      0,
      defaultDeps
    );
    expect(result).not.toBeNull();
    expect(result.name).toBe('write_file');
  });

  test('parses read_file alias "read" with path argument', () => {
    const result = runtimeToolCallFromBareCommand('read /tmp/file.txt', 0, defaultDeps);
    expect(result).not.toBeNull();
    expect(result.name).toBe('read_file');
    expect(result.arguments.path).toBe('/tmp/file.txt');
  });

  test('parses read_file alias "cat" with path argument', () => {
    const result = runtimeToolCallFromBareCommand('cat /tmp/file.txt', 0, defaultDeps);
    expect(result).not.toBeNull();
    expect(result.name).toBe('read_file');
    expect(result.arguments.path).toBe('/tmp/file.txt');
  });

  test('parses list_dir alias "ls" with path argument', () => {
    const result = runtimeToolCallFromBareCommand('ls /tmp', 0, defaultDeps);
    expect(result).not.toBeNull();
    expect(result.name).toBe('list_dir');
    expect(result.arguments.path).toBe('/tmp');
  });

  test('parses list_dir alias "ls" without argument', () => {
    const result = runtimeToolCallFromBareCommand('ls', 0, defaultDeps);
    expect(result).not.toBeNull();
    expect(result.name).toBe('list_dir');
    expect(result.arguments.path).toBe('.');
  });

  test('returns null for unknown tool', () => {
    const result = runtimeToolCallFromBareCommand('unknown_tool {"a": 1}', 0, defaultDeps);
    expect(result).toBeNull();
  });

  test('returns null for shell tool', () => {
    const result = runtimeToolCallFromBareCommand('shell {"command": "ls"}', 0, defaultDeps);
    expect(result).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    const result = runtimeToolCallFromBareCommand('write_file {invalid json}', 0, defaultDeps);
    expect(result).toBeNull();
  });

  test('parses JSON with multiline content', () => {
    const content = 'class Snake {\n  constructor() {}\n}\n';
    const result = runtimeToolCallFromBareCommand(
      `write_file {"file_path": "test.js", "content": "${content.replace(/\n/g, '\\n')}"}`,
      0,
      defaultDeps
    );
    expect(result).not.toBeNull();
    expect(result.name).toBe('write_file');
    expect(result.arguments.content).toContain('class Snake');
  });

  test('returns null for read_file without path argument', () => {
    const result = runtimeToolCallFromBareCommand('read_file', 0, defaultDeps);
    expect(result).toBeNull();
  });

  test('returns null for write_file without arguments', () => {
    const result = runtimeToolCallFromBareCommand('write_file', 0, defaultDeps);
    expect(result).toBeNull();
  });
});

import { parseShellCodeBlockFormat, parseRuntimeToolInvocations } from '../../src/core/parsing/text-tool-parser-toolcode.js';

describe('parseShellCodeBlockFormat', () => {
  const fullDeps = {
    toolRegistry: makeMockRegistry(['write_file', 'read_file', 'list_dir', 'shell']),
    parseRuntimeToolInvocations: (command, startIndex) => {
      return parseRuntimeToolInvocations(command, startIndex, {
        ...defaultDeps,
        toolRegistry: fullDeps.toolRegistry,
        normalizeToolCodeArgs: () => ({}),
        parseToolCodeArgs: () => ({}),
      });
    }
  };

  test('does not treat tool names as shell commands', () => {
    const result = parseShellCodeBlockFormat('```bash\nread_file\n```', fullDeps);
    expect(result).toEqual([]);
  });

  test('does not treat tool names with partial args as shell commands', () => {
    const result = parseShellCodeBlockFormat('```bash\nread_file \n```', fullDeps);
    expect(result).toEqual([]);
  });

  test('parses write_file with JSON args correctly', () => {
    const result = parseShellCodeBlockFormat(
      '```bash\nwrite_file\n{"file_path": "test.js", "content": "hello"}\n```', 
      fullDeps
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('write_file');
    expect(result[0].arguments.file_path).toBe('test.js');
  });

  test('parses read_file with path correctly', () => {
    const result = parseShellCodeBlockFormat(
      '```bash\nread_file /tmp/test.js\n```', 
      fullDeps
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('read_file');
    expect(result[0].arguments.path).toBe('/tmp/test.js');
  });

  test('parses ls without argument as list_dir', () => {
    const result = parseShellCodeBlockFormat('```bash\nls\n```', fullDeps);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('list_dir');
    expect(result[0].arguments.path).toBe('.');
  });

  test('treats unknown commands as shell commands', () => {
    const result = parseShellCodeBlockFormat('```bash\nnpm install\n```', fullDeps);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('shell');
    expect(result[0].arguments.command).toBe('npm install');
  });

  test('treats mixed commands correctly', () => {
    const result = parseShellCodeBlockFormat(
      '```bash\nread_file /tmp/test.js\nnpm install\nwrite_file\n{"file_path": "test.js", "content": "hello"}\n```',
      fullDeps
    );
    expect(result.length).toBe(3);
    expect(result[0].name).toBe('read_file');
    expect(result[1].name).toBe('shell');
    expect(result[2].name).toBe('write_file');
  });
});

describe('shell alias prefix stripping (run_command/bash/exec/...)', () => {
  const fullDeps = {
    toolRegistry: makeMockRegistry(['write_file', 'read_file', 'list_dir', 'shell']),
    parseRuntimeToolInvocations: (command, startIndex) => {
      return parseRuntimeToolInvocations(command, startIndex, fullDeps);
    },
    resolveToolName: (name) => name,
    safeJSONParse: (str) => {
      try { return JSON.parse(str); } catch { return null; }
    },
    normalizeJSONToolCall: (name, args) => ({ name, args }),
  };

  describe('runtimeToolCallFromBareCommand returns null for shell aliases', () => {
    test('returns null for run_command with JSON args', () => {
      const result = runtimeToolCallFromBareCommand('run_command {"command": "ls"}', 0, fullDeps);
      expect(result).toBeNull();
    });

    test('returns null for bash with JSON args', () => {
      const result = runtimeToolCallFromBareCommand('bash {"command": "ls"}', 0, fullDeps);
      expect(result).toBeNull();
    });

    test('returns null for exec with JSON args', () => {
      const result = runtimeToolCallFromBareCommand('exec {"command": "ls"}', 0, fullDeps);
      expect(result).toBeNull();
    });

    test('returns null for run with JSON args', () => {
      const result = runtimeToolCallFromBareCommand('run {"command": "ls"}', 0, fullDeps);
      expect(result).toBeNull();
    });

    test('returns null for terminal with JSON args', () => {
      const result = runtimeToolCallFromBareCommand('terminal {"command": "ls"}', 0, fullDeps);
      expect(result).toBeNull();
    });
  });

  describe('parseShellCodeBlockFormat strips shell alias prefix', () => {
    const shellAliases = [
      'run_command',
      'bash',
      'exec',
      'run',
      'execute_command',
      'run_in_terminal',
      'terminal',
    ];

    for (const alias of shellAliases) {
      test(`strips ${alias} prefix from shell command`, () => {
        const result = parseShellCodeBlockFormat(
          '```bash\n' + alias + ' npm test\n```',
          fullDeps
        );
        expect(result.length).toBe(1);
        expect(result[0].name).toBe('shell');
        expect(result[0].arguments.command).toBe('npm test');
      });
    }

    test('strips run_command prefix with complex command', () => {
      const result = parseShellCodeBlockFormat(
        '```bash\nrun_command bun test 2>&1 | grep -iE "fail|error"\n```',
        fullDeps
      );
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('shell');
      expect(result[0].arguments.command).toBe('bun test 2>&1 | grep -iE "fail|error"');
    });

    test('strips bash prefix with quoted arguments', () => {
      const result = parseShellCodeBlockFormat(
        '```bash\nbash echo "hello world"\n```',
        fullDeps
      );
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('shell');
      expect(result[0].arguments.command).toBe('echo "hello world"');
    });

    test('preserves command when no shell alias prefix', () => {
      const result = parseShellCodeBlockFormat(
        '```bash\nnpm install\n```',
        fullDeps
      );
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('shell');
      expect(result[0].arguments.command).toBe('npm install');
    });

    test('handles shell alias with no following command (keeps original)', () => {
      const result = parseShellCodeBlockFormat(
        '```bash\nrun_command\n```',
        fullDeps
      );
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('shell');
      // No command after alias — keep original line to avoid empty command
      expect(result[0].arguments.command).toBe('run_command');
    });
  });

  describe('mixed shell alias and real tool calls', () => {
    test('mix run_command, read_file, and plain shell', () => {
      const result = parseShellCodeBlockFormat(
        '```bash\nrun_command npm install\nread_file /tmp/test.js\nbun test\n```',
        fullDeps
      );
      expect(result.length).toBe(3);
      expect(result[0].name).toBe('shell');
      expect(result[0].arguments.command).toBe('npm install');
      expect(result[1].name).toBe('read_file');
      expect(result[2].name).toBe('shell');
      expect(result[2].arguments.command).toBe('bun test');
    });

    test('multiple shell aliases in sequence', () => {
      const result = parseShellCodeBlockFormat(
        '```bash\nrun_command npm install\nbash npm test\nexec git status\n```',
        fullDeps
      );
      expect(result.length).toBe(3);
      expect(result[0].arguments.command).toBe('npm install');
      expect(result[1].arguments.command).toBe('npm test');
      expect(result[2].arguments.command).toBe('git status');
    });
  });
});
