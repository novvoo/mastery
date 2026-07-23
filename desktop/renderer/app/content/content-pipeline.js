/**
 * Remove internal tool-control protocol from user-visible content.
 * This is the single sanitization stage shared by streaming ingestion and
 * final message selection.
 */
export function stripToolProtocolText(text = '') {
  if (typeof text !== 'string') return text;

  let output = text
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    .replace(
      /<[|｜]+\s*DSML\s*[|｜]+tool_calls\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+tool_calls\s*>/gi,
      '',
    )
    .replace(/<[|｜]+\s*DSML\s*[|｜]+invoke\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+invoke\s*>/gi, '')
    .replace(
      /<[|｜]+\s*DSML\s*[|｜]+parameter\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+parameter\s*>/gi,
      '',
    )
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, '')
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<function\b[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/<tool=[^>]+>[\s\S]*?<\/tool>/gi, '')
    .replace(/<tool\b[^>]*>[\s\S]*?<\/tool>/gi, '')
    .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
    .replace(/<output\b[^>]*>\s*<\/output>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<arguments>[\s\S]*?<\/arguments>/gi, '')
    .replace(/<args\b[^>]*>[\s\S]*?<\/args>/gi, '')
    .replace(/```(?:json|tool)?\s*\{[\s\S]*?\}\s*```/gi, '');

  output = output
    .split('\n')
    .filter((line) => !/^\s*CALL\s+[A-Za-z_][\w.-]*\s*\(/.test(line))
    .join('\n');

  const trimmed = output.trim();
  if (
    trimmed.startsWith('{') &&
    trimmed.endsWith('}') &&
    /"action"\s*:|"evaluation_previous_goal"\s*:|"next_goal"\s*:|"memory"\s*:/.test(trimmed)
  ) {
    return '';
  }

  return output.trimEnd();
}

export function createCollapsedContentPreview(text, maxChars = 1200) {
  const content = typeof text === 'string' ? text : String(text ?? '');
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars).trimEnd()}\n\n…`;
}
