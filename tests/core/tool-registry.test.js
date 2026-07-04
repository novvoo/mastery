import { describe, test, expect } from 'bun:test';
import { ToolRegistry } from '../../src/core/runtime/agent/tool-registry.js';

function makeTool(name, extra = {}) {
  return {
    name,
    description: `${name} tool`,
    handler: async () => 'ok',
    ...extra,
  };
}

describe('ToolRegistry', () => {
  test('register and get tool', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('read_file'));
    expect(reg.get('read_file')).toBeDefined();
    expect(reg.get('read_file').name).toBe('read_file');
  });

  test('register throws for invalid tool', () => {
    const reg = new ToolRegistry();
    expect(() => reg.register(null)).toThrow();
    expect(() => reg.register({})).toThrow();
    expect(() => reg.register({ name: '' })).toThrow();
    expect(() => reg.register({ name: 'bad' })).toThrow(); // no handler/call
  });

  test('register throws for duplicate name', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('tool1'));
    expect(() => reg.register(makeTool('tool1'))).toThrow();
  });

  test('getAll returns all tools', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    expect(reg.getAll().length).toBe(2);
  });

  test('getByName returns matching tools', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    const tools = reg.getByName(['a', 'c']);
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('a');
  });

  test('getByCategory filters tools', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a', { category: 'filesystem' }));
    reg.register(makeTool('b', { category: 'system' }));
    expect(reg.getByCategory('filesystem').length).toBe(1);
  });

  test('has returns boolean', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    expect(reg.has('a')).toBe(true);
    expect(reg.has('b')).toBe(false);
  });

  test('validateAndCoerceArgs validates required params', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a', { params: { path: { type: 'string' } }, required: ['path'] }));
    const result = reg.validateAndCoerceArgs('a', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateAndCoerceArgs coerces string to number', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a', { params: { count: { type: 'number' } } }));
    const result = reg.validateAndCoerceArgs('a', { count: '42' });
    expect(result.coercedArgs.count).toBe(42);
  });

  test('validateAndCoerceArgs coerces string to boolean', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a', { params: { flag: { type: 'boolean' } } }));
    const result = reg.validateAndCoerceArgs('a', { flag: 'true' });
    expect(result.coercedArgs.flag).toBe(true);
  });

  test('validateAndCoerceArgs returns error for unknown tool', () => {
    const reg = new ToolRegistry();
    const result = reg.validateAndCoerceArgs('unknown', {});
    expect(result.valid).toBe(false);
  });

  test('register with call method instead of handler', () => {
    const reg = new ToolRegistry();
    reg.register({ name: 'a', description: 'test', call: async () => 'ok' });
    expect(reg.has('a')).toBe(true);
  });

  test('register normalizes params/parameters', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('a', { parameters: { properties: { x: { type: 'string' } }, required: ['x'] } }),
    );
    const tool = reg.get('a');
    expect(tool._schema).toBeDefined();
    expect(tool._schema.properties.x).toBeDefined();
  });

  test('size returns correct count', () => {
    const reg = new ToolRegistry();
    expect(reg.size).toBe(0);
    reg.register(makeTool('a'));
    expect(reg.size).toBe(1);
  });

  test('executeWithMeta normalizes string error results', async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('read_file', { handler: async () => 'Error: File not found: "x.js"' }));

    const result = await reg.executeWithMeta('read_file', { path: 'x.js' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
    expect(result.result).toContain('File not found');
  });

  test('executeWithMeta normalizes object failure results', async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('shell', {
        handler: async () => ({ success: false, error: 'Command failed', code: 1 }),
      }),
    );

    const result = await reg.executeWithMeta('shell', { command: 'exit 1' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Command failed');
  });

  // —— paramAliases 别名映射测试 ——
  test('paramAliases maps alias to canonical name', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('edit_file', {
        params: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string', allowEmpty: true },
        },
        required: ['path', 'new_text'],
        paramAliases: { file_path: 'path', old_str: 'old_text', new_str: 'new_text' },
      }),
    );

    // LLM 用 old_str/new_str（如 system-prompt 示例曾用过的参数名）
    const result = reg.validateAndCoerceArgs('edit_file', {
      path: 'test.js',
      old_str: 'foo',
      new_str: 'bar',
    });
    expect(result.valid).toBe(true);
    expect(result.coercedArgs.old_text).toBe('foo');
    expect(result.coercedArgs.new_text).toBe('bar');
    expect(result.coercedArgs.old_str).toBeUndefined();
    expect(result.coercedArgs.new_str).toBeUndefined();
  });

  test('paramAliases maps file_path to path', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('read_file', {
        params: { path: { type: 'string' } },
        required: ['path'],
        paramAliases: { file_path: 'path' },
      }),
    );

    const result = reg.validateAndCoerceArgs('read_file', { file_path: 'test.js' });
    expect(result.valid).toBe(true);
    expect(result.coercedArgs.path).toBe('test.js');
  });

  // —— allowEmpty 空字符串测试 ——
  test('allowEmpty: true allows empty string for required field', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('edit_file', {
        params: {
          path: { type: 'string' },
          new_text: { type: 'string', allowEmpty: true },
        },
        required: ['path', 'new_text'],
      }),
    );

    // new_text: "" 表示删除操作，应通过校验
    const result = reg.validateAndCoerceArgs('edit_file', {
      path: 'test.js',
      new_text: '',
    });
    expect(result.valid).toBe(true);
    expect(result.coercedArgs.new_text).toBe('');
  });

  test('allowEmpty: false (default) rejects empty string for required field', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('write_file', {
        params: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      }),
    );

    // content: "" 应被拦截（write_file 不允许空内容）
    const result = reg.validateAndCoerceArgs('write_file', {
      path: 'test.js',
      content: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('content'))).toBe(true);
  });

  test('allowEmpty only applies to fields that declare it', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('edit_file', {
        params: {
          path: { type: 'string' },
          new_text: { type: 'string', allowEmpty: true },
        },
        required: ['path', 'new_text'],
      }),
    );

    // path: "" 仍然应被拦截（path 没声明 allowEmpty）
    const result = reg.validateAndCoerceArgs('edit_file', {
      path: '',
      new_text: 'content',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('path'))).toBe(true);
  });

  // —— edit_file 别名 + allowEmpty 组合测试 ——
  test('edit_file: old_str/new_str aliases + new_str="" (delete via alias)', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('edit_file', {
        params: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string', allowEmpty: true },
        },
        required: ['path', 'new_text'],
        paramAliases: { file_path: 'path', old_str: 'old_text', new_str: 'new_text' },
      }),
    );

    // LLM 用别名 new_str: "" 删除内容
    const result = reg.validateAndCoerceArgs('edit_file', {
      file_path: 'test.js',
      old_str: 'line to delete',
      new_str: '',
    });
    expect(result.valid).toBe(true);
    expect(result.coercedArgs.path).toBe('test.js');
    expect(result.coercedArgs.old_text).toBe('line to delete');
    expect(result.coercedArgs.new_text).toBe('');
  });

  // —— old_string/new_string 别名测试（claude-code/Aider 惯例）——
  test('edit_file: old_string/new_string aliases (claude-code convention)', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('edit_file', {
        params: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string', allowEmpty: true },
        },
        required: ['path', 'new_text'],
        paramAliases: {
          file_path: 'path',
          old_str: 'old_text',
          new_str: 'new_text',
          old_string: 'old_text',
          new_string: 'new_text',
        },
      }),
    );

    const result = reg.validateAndCoerceArgs('edit_file', {
      file_path: 'test.js',
      old_string: 'old code',
      new_string: 'new code',
    });
    expect(result.valid).toBe(true);
    expect(result.coercedArgs.path).toBe('test.js');
    expect(result.coercedArgs.old_text).toBe('old code');
    expect(result.coercedArgs.new_text).toBe('new code');
  });

  test('edit_file: new_string="" (delete via old_string/new_string alias)', () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('edit_file', {
        params: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string', allowEmpty: true },
        },
        required: ['path', 'new_text'],
        paramAliases: {
          file_path: 'path',
          old_str: 'old_text',
          new_str: 'new_text',
          old_string: 'old_text',
          new_string: 'new_text',
        },
      }),
    );

    const result = reg.validateAndCoerceArgs('edit_file', {
      path: 'test.js',
      old_string: 'line to delete',
      new_string: '',
    });
    expect(result.valid).toBe(true);
    expect(result.coercedArgs.new_text).toBe('');
  });
});
