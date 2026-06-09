/**
 * TextToolParser DSML Format Tests
 * 测试 TextToolParser 对 DSML 格式（XML 风格的 tool_calls/invoke/parameter 标签）
 * 以及各种遗留格式（CALL, JSON block, action tag 等）的解析能力
 */

import { describe, it, expect } from 'bun:test';
import { TextToolParser } from '../../src/core/text-tool-parser.js';

function createParser() {
  const tools = {
    has: (name) => ['list_dir', 'read_file', 'write_file', 'shell', 'verify', 'diagnose', 'brainstorm', 'get_data', 'process_data', 'get_weather', 'list_files', 'create_task'].includes(name),
    getAll: () => [
      { name: 'list_dir', category: 'workspace' },
      { name: 'read_file', category: 'workspace' },
      { name: 'write_file', category: 'workspace' },
      { name: 'shell', category: 'runtime' },
      { name: 'verify', category: 'methodology' },
      { name: 'diagnose', category: 'methodology' },
      { name: 'brainstorm', category: 'methodology' },
    ],
  };
  return new TextToolParser(tools);
}

describe('TextToolParser DSML Format', () => {

  describe('Unicode fullwidth bar DSML', () => {
    it('parses single list_dir invoke with path parameter', () => {
      const parser = createParser();
      const text = '<\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>\n' +
        '<\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke name="list_dir">\n' +
        '<\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter name="path" string="true">/Users/jingslunt/workspace<\uFF5C\uFF5CDSML\uFF5C\uFF5Cparameter>\n' +
        '<\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke>\n' +
        '<\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls>';

      const result = parser.parse(text);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('list_dir');
      expect(result[0].arguments.path).toBe('/Users/jingslunt/workspace');
      expect(result[0].source).toBe('DSML');
    });

    it('parses multiple invoke blocks in one tool_calls envelope', () => {
      const parser = createParser();
      const text = '<||DSML||tool_calls>\n' +
        '<||DSML||invoke name="list_dir">\n' +
        '<||DSML||parameter name="path" string="true">/tmp<||DSML||parameter>\n' +
        '<||DSML||invoke>\n' +
        '<||DSML||invoke name="read_file">\n' +
        '<||DSML||parameter name="path" string="true">/tmp/file.js<||DSML||parameter>\n' +
        '<||DSML||invoke>\n' +
        '<||DSML||tool_calls>';

      const result = parser.parse(text);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('list_dir');
      expect(result[1].name).toBe('read_file');
    });
  });

  describe('ASCII pipe DSML', () => {
    it('parses write_file with path and content parameters', () => {
      const parser = createParser();
      const text = '<||DSML||tool_calls>\n' +
        '<||DSML||invoke name="write_file">\n' +
        '<||DSML||parameter name="path" string="true">/tmp/test.js<||DSML||parameter>\n' +
        '<||DSML||parameter name="content" string="true">console.log("hello")<||DSML||parameter>\n' +
        '<||DSML||invoke>\n' +
        '<||DSML||tool_calls>';

      const result = parser.parse(text);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('write_file');
      expect(result[0].arguments.path).toBe('/tmp/test.js');
      expect(result[0].arguments.content).toBe('console.log("hello")');
    });
  });

  describe('Tool filtering', () => {
    it('filters out unknown tools silently', () => {
      const parser = createParser();
      const text = '<||DSML||tool_calls>\n' +
        '<||DSML||invoke name="nonexistent_tool">\n' +
        '<||DSML||parameter name="x" string="true">1<||DSML||parameter>\n' +
        '<||DSML||invoke>\n' +
        '<||DSML||tool_calls>';

      const result = parser.parse(text);
      expect(result.length).toBe(0);
    });

    it('preserves known tools and drops unknown ones in mixed payload', () => {
      const parser = createParser();
      const text = '<||DSML||tool_calls>\n' +
        '<||DSML||invoke name="list_dir">\n' +
        '<||DSML||parameter name="path" string="true">/tmp<||DSML||parameter>\n' +
        '<||DSML||invoke>\n' +
        '<||DSML||invoke name="phony">\n' +
        '<||DSML||parameter name="x" string="true">1<||DSML||parameter>\n' +
        '<||DSML||invoke>\n' +
        '<||DSML||tool_calls>';

      const result = parser.parse(text);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('list_dir');
    });
  });

  describe('Legacy format regression', () => {
    it('still parses CALL tool_name({...}) format', () => {
      const parser = createParser();
      const text = 'CALL list_dir({"path": "/tmp"})';
      const result = parser.parse(text);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('list_dir');
    });

    it('still parses ```tool JSON block format', () => {
      const parser = createParser();
      const text = '```tool\n{"name": "list_dir", "arguments": {"path": "/tmp"}}\n```';
      const result = parser.parse(text);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('list_dir');
    });
  });

  describe('generateToolPrompt', () => {
    it('mentions DSML so LLM knows the format is accepted', () => {
      const parser = createParser();
      const prompt = parser.generateToolPrompt();
      expect(prompt.includes('DSML')).toBe(true);
    });
  });

  describe('Empty / edge input', () => {
    it('handles empty string without throwing', () => {
      const parser = createParser();
      expect(() => parser.parse('')).not.toThrow();
      expect(parser.parse('').length).toBe(0);
    });

    it('handles non-string input without throwing', () => {
      const parser = createParser();
      expect(() => parser.parse(null)).not.toThrow();
      expect(() => parser.parse(undefined)).not.toThrow();
    });
  });
});
