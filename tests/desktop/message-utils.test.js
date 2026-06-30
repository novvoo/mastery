import { describe, expect, test } from 'bun:test';
import { getMessageDisplayText } from '../../desktop/renderer/components/message-log/utils/message-utils.js';

describe('message display text', () => {
  test('does not expose CALL tool commands in primary message bubbles', () => {
    const text = getMessageDisplayText({
      type: 'agent',
      content: 'I will inspect the file.\nCALL read_file({"path":"README.md"})',
    });

    expect(text).toBe('I will inspect the file.');
    expect(text).not.toContain('CALL read_file');
  });
});
