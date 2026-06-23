import { ToolCategory } from '../../core/types.js';

/**
 * ask_user - Structured clarification/request-for-input gate.
 * Use when progress depends on user-owned context that cannot be safely
 * retrieved from code, RAG, web search, or command output.
 */
export default function askUser() {
  return {
    name: 'ask_user',
    description:
      'Ask the user for missing information before continuing. Use when business constraints, acceptance criteria, credentials, confirmations, or high-risk assumptions are required and cannot be safely inferred or retrieved.',
    category: ToolCategory.skill_engineering,
    params: {
      reason: {
        type: 'string',
        description: 'Why the agent cannot safely continue without user input.',
      },
      questions: {
        type: 'array',
        description: 'One to three concise questions for the user.',
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
