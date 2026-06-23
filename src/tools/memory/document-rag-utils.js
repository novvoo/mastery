/**
 * Shared utility functions for Document RAG.
 *
 * Text normalization, HTML cleaning, snippet extraction, search result
 * formatting, and miscellaneous helpers.
 */

/* ─── constants ─────────────────────────────────────────────────────── */
export const LEXICAL_SCORE_BOOST = 0.25;
export const CHINESE_STOP_TERMS = new Set(['哪个', '什么', '的是', '是哪个', '做过']);

/* ─── text normalization ────────────────────────────────────────────── */
export function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

/* ─── HTML cleaning ─────────────────────────────────────────────────── */
export function cleanHTML(html) {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

/* ─── snippet extraction ────────────────────────────────────────────── */
export function extractRelevantSnippet(text, query, maxLen) {
  const terms = extractSearchTerms(query || '');
  if (terms.length === 0 || !text) {
    return (text || '').slice(0, maxLen || 500);
  }

  const lines = text.split('\n').filter(Boolean);
  const scored = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = lower.split(term.value).length - 1;
      score += count * term.weight * 10;
    }
    return {
      text: line,
      score: score - Math.min(line.length / 100, 1),
      index: lines.indexOf(line),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((m) => m.score > 0.5);
  if (!best) {
    return (text || '').slice(0, maxLen || 500);
  }

  let startPos = 0;
  for (let i = 0; i < best.index; i++) {
    startPos += lines[i].length + 1;
  }
  return text.substring(startPos, startPos + (maxLen || 500)).trim();
}

function extractSearchTerms(query) {
  const normalized = normalizeSearchText(query);
  const terms = new Map();

  for (const token of normalized.match(/[\p{L}\p{N}_-]{2,}/gu) || []) {
    addSearchTerm(terms, token, token.length >= 4 ? 1.4 : 1);
  }
  for (const gram of createCjkGrams(normalized, 2)) {
    addSearchTerm(terms, gram, 0.45);
  }
  return Array.from(terms.entries()).map(([value, weight]) => ({ value, weight }));
}

function addSearchTerm(terms, value, weight) {
  const normalized = normalizeSearchText(value);
  if (normalized.length < 2 || CHINESE_STOP_TERMS.has(normalized)) {
    return;
  }
  terms.set(normalized, Math.max(terms.get(normalized) || 0, weight));
}

function createCjkGrams(text, size) {
  const chars = Array.from(text).filter((char) => /[\p{Script=Han}]/u.test(char));
  const grams = [];
  for (let i = 0; i <= chars.length - size; i++) {
    grams.push(chars.slice(i, i + size).join(''));
  }
  return grams;
}

/* ─── search result formatting ──────────────────────────────────────── */
export function formatSearchResults(results, meta = {}) {
  if (!results || results.length === 0) {
    if (meta.minScore !== null) {
      return `No document matches above min_score=${meta.minScore}. Try a lower min_score or broader query.`;
    }
    return 'No document matches found.';
  }

  const header = [
    `Found ${results.length} relevant snippet${results.length === 1 ? '' : 's'}${meta.totalChunks ? ` (from ${meta.totalChunks} indexed chunk${meta.totalChunks === 1 ? '' : 's'})` : ''}.`,
    meta.minScore !== null ? `min_score ≥ ${meta.minScore}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const items = results.map((result, index) => {
    const metadata = result.metadata || {};
    const preview = extractRelevantSnippet(result.text, result.query || '', 500);
    const display = preview.length > 500 ? preview.slice(0, 497) + '...' : preview;
    const scorePct =
      typeof result.semanticScore === 'number'
        ? Math.round(((result.semanticScore + 1) / 2) * 100)
        : Math.round(((Number(result.score) + 1) / 2) * 100);
    const sectionPath = metadata.sectionPath ? metadata.sectionPath.join(' › ') : null;

    const lines = [];
    lines.push(`#${index + 1} [${metadata.title || 'Untitled'}] ${scorePct}%`);
    if (sectionPath) {
      lines.push(`Section: ${sectionPath}`);
    }
    if (metadata.source) {
      lines.push(`Source : ${metadata.source}`);
    }
    if (metadata.chunkIndex) {
      lines.push(`Chunk  : ${metadata.chunkIndex}`);
    }
    if (typeof result.semanticScore === 'number') {
      lines.push(`Semantic: ${result.semanticScore.toFixed(3)}`);
    }
    if (typeof result.lexicalScore === 'number' && result.lexicalScore > 0) {
      lines.push(`Lexical (BM25) : ${result.lexicalScore.toFixed(3)}`);
    }
    lines.push('---');
    lines.push(display);
    return lines.join('\n');
  });

  return header + '\n\n' + items.join('\n\n');
}

/* ─── miscellaneous helpers ─────────────────────────────────────────── */
export function normalizeLimit(limit) {
  return Math.max(1, Math.min(Number(limit) || 5, 20));
}

export function sanitizeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function condenseForAnswer(text, question, maxChars) {
  if (!text) {
    return '';
  }
  const queryTerms = new Set(
    String(question || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}_-]{2,}/gu) || [],
  );
  const sentences = text.split(/(?<=[.!?。！？])\s+/);
  const scored = sentences.map((s, i) => {
    const lower = s.toLowerCase();
    let hit = 0;
    for (const t of queryTerms) {
      if (lower.includes(t)) {
        hit++;
      }
    }
    return { text: s, score: hit, index: i };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  let used = 0;
  for (const s of scored) {
    if (used + s.text.length > maxChars) {
      break;
    }
    picked.push(s);
    used += s.text.length;
  }
  picked.sort((a, b) => a.index - b.index);
  const out = picked
    .map((p) => p.text)
    .join(' ')
    .trim();
  if (!out) {
    return text.slice(0, maxChars);
  }
  return out.length > maxChars ? out.slice(0, maxChars - 3) + '...' : out;
}
