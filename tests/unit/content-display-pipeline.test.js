import { describe, expect, test } from 'bun:test';
import {
  createCollapsedContentPreview,
  stripToolProtocolText,
} from '../../desktop/renderer/app/content/content-pipeline.js';
import { prepareMarkdownDisplay } from '../../desktop/renderer/components/MarkdownMessageContent.jsx';
import {
  getMessageDisplayText,
} from '../../desktop/renderer/components/message-log/utils/message-utils.js';

describe('content display pipeline', () => {
  test('uses the same protocol filter for runtime and final message display', () => {
    const source = [
      '可见内容',
      '<tool_call>{"name":"read_file"}</tool_call>',
      'CALL shell("pwd")',
      '<function=test>{"path":"x"}</function>',
    ].join('\n');

    const expected = '可见内容';
    expect(stripToolProtocolText(source).trim()).toBe(expected);
    expect(getMessageDisplayText({ content: source })).toBe(expected);
  });

  test('hides a complete bare control object', () => {
    expect(stripToolProtocolText('{"action":{"name":"shell"}}')).toBe('');
  });

  test('falls back to the next content candidate when the preferred field is protocol-only', () => {
    expect(
      getMessageDisplayText({
        content: '<tool_call>{"name":"shell"}</tool_call>',
        answer: '最终可见答案',
      }),
    ).toBe('最终可见答案');
  });

  test('stabilizes streaming fences and resolves workspace images', () => {
    const output = prepareMarkdownDisplay(
      '查看 https://example.com/docs\n\n![demo](images/demo.png)\n\n```js\nconst x = 1;',
      {
        isStreaming: true,
        workingDirectory: '/workspace/mastery',
        fileServerUrl: 'http://127.0.0.1:4312/',
      },
    );

    expect(output).toContain('[https://example.com/docs](https://example.com/docs)');
    expect(output).toContain('![demo](http://127.0.0.1:4312/images/demo.png)');
    expect(output.endsWith('```')).toBe(true);
  });

  test('escapes XML-like content instead of dropping it', () => {
    expect(prepareMarkdownDisplay('<result>visible</result>')).toBe(
      '&lt;result&gt;visible&lt;/result&gt;',
    );
  });

  test('does not rewrite URLs or image syntax inside fenced code', () => {
    const source = [
      '外部 https://example.com',
      '```md',
      'https://inside.example.com',
      '![code](images/raw.png)',
      '```',
      '![outside](images/visible.png)',
    ].join('\n');
    const output = prepareMarkdownDisplay(source, {
      fileServerUrl: 'http://127.0.0.1:4312',
    });

    expect(output).toContain('[https://example.com](https://example.com)');
    expect(output).toContain('https://inside.example.com\n![code](images/raw.png)');
    expect(output).toContain('![outside](http://127.0.0.1:4312/images/visible.png)');
    expect(output).not.toContain('[https://inside.example.com]');
  });

  test('limits collapsed content before the Markdown parser receives it', () => {
    const preview = createCollapsedContentPreview('a'.repeat(2000), 1200);
    expect(preview.length).toBeLessThan(1210);
    expect(preview.endsWith('…')).toBe(true);
    expect(createCollapsedContentPreview('short', 1200)).toBe('short');
  });
});
