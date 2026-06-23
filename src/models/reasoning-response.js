/**
 * Helpers for OpenAI-compatible providers that expose thinking/reasoning output
 * in slightly different response shapes.
 */

export function extractReasoningFromChoice(choice = {}) {
  const message = choice?.message || {};
  const directText = firstNonEmptyString(
    message.reasoning_content,
    message.reasoningContent,
    message.reasoning,
    message.thinking,
    choice.reasoning_content,
    choice.reasoningContent,
    choice.reasoning,
    choice.thinking,
  );
  const details = normalizeReasoningDetails(
    message.reasoning_details ||
      message.reasoningDetails ||
      choice.reasoning_details ||
      choice.reasoningDetails,
  );

  if (!directText && details.length === 0) {
    return null;
  }

  const detailsText = details
    .map((detail) => detail.summary || detail.text || detail.content || '')
    .filter(Boolean)
    .join('\n\n');

  return {
    text: directText || detailsText,
    summary: summarizeReasoning(directText || detailsText),
    details,
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeReasoningDetails(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((detail) => {
      if (typeof detail === 'string') {
        return { type: 'text', text: detail };
      }
      if (!detail || typeof detail !== 'object') {
        return null;
      }
      return {
        type: detail.type || 'reasoning',
        text: firstNonEmptyString(detail.text, detail.content, detail.reasoning),
        summary: firstNonEmptyString(detail.summary),
      };
    })
    .filter(Boolean);
}

export function summarizeReasoning(text = '') {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '';
  }
  if (clean.length <= 160) {
    return clean;
  }
  return `${clean.slice(0, 157)}...`;
}
