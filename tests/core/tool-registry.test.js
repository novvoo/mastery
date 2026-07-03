import { describe, test, expect } from 'bun:test';
import { ToolRegistry } from '../../src/core/tool-registry.js';

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
});
