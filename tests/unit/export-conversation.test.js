import { describe, expect, test } from 'bun:test';
import {
  buildConversationMarkdown,
  createConversationExportFilename,
} from '../../desktop/renderer/app/export-conversation.js';

describe('conversation export', () => {
  test('builds one stable markdown section per message', () => {
    const markdown = buildConversationMarkdown(
      [
        { type: 'user', content: '检查项目' },
        { type: 'assistant', result: '检查完成' },
        { type: 'tool' },
      ],
      '/workspace/mastery',
    );

    expect(markdown).toContain('- Working directory: /workspace/mastery');
    expect(markdown).toContain('## 1. user\n\n检查项目');
    expect(markdown).toContain('## 2. assistant\n\n检查完成');
    expect(markdown).toContain('## 3. tool\n\n(empty)');
  });

  test('uses a deterministic date-based filename', () => {
    expect(createConversationExportFilename(new Date('2026-07-23T12:34:56.000Z'))).toBe(
      'ai-agent-conversation-2026-07-23.md',
    );
  });
});
