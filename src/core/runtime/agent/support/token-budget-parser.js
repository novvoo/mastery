const SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i;
const SHORTHAND_END_RE = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i;
const VERBOSE_RE = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i;
const VERBOSE_RE_G = new RegExp(VERBOSE_RE.source, 'gi');

const MULTIPLIERS = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

function parseBudgetMatch(value, suffix) {
  return parseFloat(value) * (MULTIPLIERS[suffix.toLowerCase()] || 1);
}

export function parseTokenBudget(text) {
  if (typeof text !== 'string') return null;
  const startMatch = text.match(SHORTHAND_START_RE);
  if (startMatch) return parseBudgetMatch(startMatch[1], startMatch[2]);
  const endMatch = text.match(SHORTHAND_END_RE);
  if (endMatch) return parseBudgetMatch(endMatch[1], endMatch[2]);
  const verboseMatch = text.match(VERBOSE_RE);
  if (verboseMatch) return parseBudgetMatch(verboseMatch[1], verboseMatch[2]);
  return null;
}

export function findTokenBudgetPositions(text) {
  if (typeof text !== 'string') return [];
  const positions = [];
  const startMatch = text.match(SHORTHAND_START_RE);
  if (startMatch) {
    const offset = startMatch.index + startMatch[0].length - startMatch[0].trimStart().length;
    positions.push({
      start: offset,
      end: startMatch.index + startMatch[0].length,
    });
  }
  const endMatch = text.match(SHORTHAND_END_RE);
  if (endMatch) {
    const endStart = endMatch.index + 1;
    const alreadyCovered = positions.some((p) => endStart >= p.start && endStart < p.end);
    if (!alreadyCovered) {
      positions.push({
        start: endStart,
        end: endMatch.index + endMatch[0].length,
      });
    }
  }
  for (const match of text.matchAll(VERBOSE_RE_G)) {
    positions.push({ start: match.index, end: match.index + match[0].length });
  }
  return positions;
}

export function getBudgetContinuationMessage(pct, turnTokens, budget) {
  const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
  return `Stopped at ${pct}% of token target (${fmt(turnTokens)} / ${fmt(budget)}). Keep working — do not summarize.`;
}

export function stripTokenBudgetAnnotations(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  const positions = findTokenBudgetPositions(text);
  for (let i = positions.length - 1; i >= 0; i--) {
    const { start, end } = positions[i];
    result = result.slice(0, start) + result.slice(end);
  }
  return result.trim();
}
