export function generateTextToolPrompt(toolRegistry, tools = null) {
  const visibleTools = Array.isArray(tools) ? tools : toolRegistry ? toolRegistry.getAll() : [];
  const grouped = new Map();
  for (const tool of visibleTools) {
    const category = tool.category || 'general';
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category).push(tool.name);
  }

  const lines = [
    'You can call tools exposed for the current request. Tool availability is intentionally task-scoped to keep reasoning fast.',
    '',
    visibleTools.length > 0
      ? 'Available tools for this request:'
      : 'No tools are currently exposed for this request.',
    ...Array.from(grouped.entries()).map(
      ([category, names]) => `- ${category}: ${names.join(', ')}`,
    ),
    '',
    'To use a tool, output ONLY this format:',
    'CALL tool_name({"param": "value"})',
    '',
    'IMPORTANT: Do NOT output raw JSON, DSML, <action>, memory, evaluation_previous_goal,',
    'next_goal, or reasoning fields. Tool call format is internal protocol — it must not be shown',
    'as user-facing text. Only use the CALL format above.',
    '',
    'After receiving tool results, continue reasoning or output FINAL_ANSWER: followed by your final response.',
  ];

  return lines.join('\n');
}
