export function getParseHints(text, hasNamedXMLCandidate) {
  const trimmed = text.trim();
  const hasFence = text.includes('```');
  const hasAngleTag = text.includes('<');
  const hasAction = text.includes('"action"') || text.includes("'action'");
  const rawJSON = trimmed.startsWith('{') && trimmed.endsWith('}');
  const hasShellFence = hasFence && /```(?:bash|sh|zsh|shell|terminal|console)\b/i.test(text);

  return {
    dsml: text.includes('DSML') || /<invoke\b/i.test(text),
    call: text.includes('CALL'),
    jsonBlock: hasFence && text.includes('{'),
    actionTag: hasAngleTag && /<action\b/i.test(text),
    rawJSON,
    embeddedJSONAction: hasAction && !rawJSON && text.includes('{'),
    functionCalls: hasAngleTag && /<function>/i.test(text),
    functionCallTag: hasAngleTag && /<function_call\b/i.test(text),
    toolCallTag: hasAngleTag && /<tool_call\b/i.test(text),
    xmlTool: hasAngleTag && /<tool>\/?[A-Za-z_][\w-]*<\/tool>/.test(text),
    namedXML: hasAngleTag && hasNamedXMLCandidate(text),
    toolCode: hasAngleTag && /<tool_code\b/i.test(text),
    shellCodeBlock: hasShellFence,
  };
}
