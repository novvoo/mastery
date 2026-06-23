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
    'To use a tool, output in one of these formats:',
    '1. CALL tool_name({"param": "value"})',
    '2. ```tool\n{"name": "tool_name", "arguments": {"param": "value"}}\n```',
    '3. <action>{"tool_name": {"param": "value"}}</action>',
    '4. {"action": {"tool_name": {"param": "value"}}}',
    '5. <||DSML||tool_calls>\n<||DSML||invoke name="tool_name">\n<||DSML||parameter name="param" string="true">value<||DSML||parameter>\n<||DSML||invoke>\n<||DSML||tool_calls>',
    '',
    'After receiving tool results, continue reasoning or output FINAL_ANSWER: followed by your final response.',
  ];

  return lines.join('\n');
}
