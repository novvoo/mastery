export function buildConversationMarkdown(messages = [], workingDirectory = '') {
  return [
    '# 对话记录',
    '',
    `- Exported: ${new Date().toISOString()}`,
    `- Working directory: ${workingDirectory || '未设置'}`,
    '',
    ...messages.map((message, index) =>
      [
        `## ${index + 1}. ${message.type || 'message'}`,
        '',
        String(message.content || message.result || message.details || '').trim() || '(empty)',
        '',
      ].join('\n'),
    ),
  ].join('\n');
}

export function createConversationExportFilename(date = new Date()) {
  return `ai-agent-conversation-${date.toISOString().slice(0, 10)}.md`;
}

export function downloadConversationMarkdown(messages, workingDirectory) {
  const blob = new Blob([buildConversationMarkdown(messages, workingDirectory)], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = createConversationExportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
