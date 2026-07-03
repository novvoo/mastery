import { ToolCategory } from '../../core/types/index.js';

/**
 * ask_user - Structured clarification/request-for-input gate.
 *
 * IMPORTANT (self-answer first): Before calling this tool, try to reason through
 * and answer the questions yourself using your knowledge and context. The engine
 * will also attempt auto-answering before interrupting the user.
 *
 * Only call this tool when you TRULY cannot determine the answer and need:
 * - User's personal preferences or subjective choices
 * - Credentials, API keys, or secrets
 * - Organization-specific business rules not deducible from context
 * - Ambiguous requirements with multiple valid interpretations
 */
export default function askUser() {
  return {
    name: 'ask_user',
    description:
      'Ask the user for missing information. ONLY use as last resort when you cannot reason through the answer yourself. First try to answer using your knowledge and context. The engine will also attempt to auto-answer before interrupting the user. Use only for user preferences, credentials, org-specific business rules, or truly ambiguous requirements.',
    category: ToolCategory.skill_engineering,
    params: {
      reason: {
        type: 'string',
        description:
          'Why the agent cannot determine the answer on its own (must be a genuine gap, not something deducible through reasoning).',
      },
      questions: {
        type: 'array',
        description:
          'One to three concise questions. Only ask what you genuinely cannot figure out—answerable questions will be auto-resolved by the engine.',
        items: { type: 'string', description: 'Question to ask the user.' },
      },
      blocking_facts: {
        type: 'array',
        description: 'Facts that are missing and block a reliable answer or action.',
        items: { type: 'string', description: 'Missing fact.' },
      },
      suggestions: {
        type: 'array',
        description: 'Optional examples of acceptable answers or choices.',
        items: { type: 'string', description: 'Suggested answer or choice.' },
      },
    },
    required: ['reason', 'questions'],
    handler: async (params) => {
      const questions = normalizeList(params.questions).slice(0, 3);
      const blockingFacts = normalizeList(params.blocking_facts);
      const suggestions = normalizeList(params.suggestions);
      const reason = String(params.reason || '').trim() || 'Need user input before continuing.';

      return {
        type: 'user_input_required',
        requiresUserInput: true,
        status: 'needs_user_input',
        reason,
        questions,
        blockingFacts,
        suggestions,
        answer: formatUserInputRequest({ reason, questions, blockingFacts, suggestions }),
      };
    },
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\n|[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatUserInputRequest({ reason, questions, blockingFacts, suggestions }) {
  const lines = ['需要你补充一点信息后我才能继续。', '', `原因：${reason}`];

  if (blockingFacts.length > 0) {
    lines.push('', '缺少的信息：');
    for (const fact of blockingFacts) {
      lines.push(`- ${fact}`);
    }
  }

  lines.push('', '请回答：');
  questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question}`);
  });

  if (suggestions.length > 0) {
    lines.push('', '可选参考：');
    for (const suggestion of suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join('\n');
}
