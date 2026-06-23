export function withRoutedToolContext(messages, toolPrompt, currentPhase) {
  const toolContext = [`Current execution phase: ${currentPhase || 'general'}.`, toolPrompt].join(
    '\n\n',
  );

  const nextMessages = [...messages];
  const firstSystemIndex = nextMessages.findIndex((message) => message.role === 'system');
  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: toolContext }, ...nextMessages];
  }

  const firstSystemMessage = nextMessages[firstSystemIndex];
  nextMessages[firstSystemIndex] = {
    ...firstSystemMessage,
    content: `${firstSystemMessage.content}\n\n## Current Request Tool Context\n${toolContext}`,
  };
  return nextMessages;
}
