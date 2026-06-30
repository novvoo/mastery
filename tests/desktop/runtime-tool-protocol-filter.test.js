import { describe, expect, test } from 'bun:test';
import { stripActionBlocks } from '../../desktop/renderer/hooks/useRuntime.js';

describe('runtime tool protocol filtering', () => {
  test('strips XML tool-call blocks from visible assistant text', () => {
    const text =
      'Before\n' +
      '<tool_call><name>read_file</name><arguments>{"path":"README.md"}</arguments></tool_call>\n' +
      '<invoke name="list_dir"><parameter name="path">.</parameter></invoke>\n' +
      'After';

    const result = stripActionBlocks(text);

    expect(result).toBe('Before\n\n\nAfter');
    expect(result).not.toContain('tool_call');
    expect(result).not.toContain('invoke');
    expect(result).not.toContain('read_file');
  });

  test('strips DSML tool-call envelopes from visible assistant text', () => {
    const text =
      'Before\n' +
      '<||DSML||tool_calls>\n' +
      '<||DSML||invoke name="list_dir">\n' +
      '<||DSML||parameter name="path" string="true">/tmp<||DSML||parameter>\n' +
      '<||DSML||invoke>\n' +
      '<||DSML||tool_calls>\n' +
      'After';

    const result = stripActionBlocks(text);

    expect(result).toBe('Before\n\nAfter');
    expect(result).not.toContain('DSML');
    expect(result).not.toContain('list_dir');
    expect(result).not.toContain('/tmp');
  });

  test('strips empty output protocol shells from visible assistant text', () => {
    expect(stripActionBlocks('<output>\n\n</output><output>\n\n</output>')).toBe('');
    expect(stripActionBlocks('Done\n<output>\n</output>')).toBe('Done');
  });

  test('strips CALL tool commands from visible assistant text', () => {
    const text = 'Before\nCALL read_file({"path":"README.md"})\nAfter';

    expect(stripActionBlocks(text)).toBe('Before\nAfter');
  });

  test('keeps ordinary XML-like content for markdown escaping layer', () => {
    const text = 'Use <config>value</config> in the docs.';

    expect(stripActionBlocks(text)).toBe(text);
  });
});
