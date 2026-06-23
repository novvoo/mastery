/**
 * Section-aware, token-bounded chunking for Document RAG.
 */

import { detectSections } from './document-rag-sections.js';
import { heuristicCountTokens } from '../../core/embedder.js';

/* ─── constants ─────────────────────────────────────────────────────── */
export const CHUNK_TOKENS_TARGET = 750;
export const CHUNK_TOKENS_MIN = 600;
export const CHUNK_TOKENS_MAX = 900;
export const OVERLAP_TOKENS = 125;

/* ─── public API ────────────────────────────────────────────────────── */
export function chunkText(text) {
  const normalized = normalizeText(text);
  const totalTokens = tokenCount(normalized);
  const sections = detectSections(normalized);

  if (totalTokens <= CHUNK_TOKENS_MAX) {
    const sectionPaths =
      sections.length > 1 ? sections.slice(0, 1).map((s) => s.heading) : ['Content'];
    return [{ text: normalized, sectionPath: sectionPaths, tokens: totalTokens }];
  }

  if (sections.length > 1) {
    return chunkBySections(normalized, sections);
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return legacyTokenSplit(normalized);
  }
  return packByTokens(paragraphs);
}

/* ─── internal ──────────────────────────────────────────────────────── */
function chunkBySections(text, sections) {
  const lines = text.split('\n');
  const outputChunks = [];

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const sectionLines = lines.slice(sec.startLine, sec.endLine);
    const sectionText = sectionLines.join('\n').trim();
    if (!sectionText) {
      continue;
    }

    const sectionTokens = tokenCount(sectionText);

    if (sectionTokens <= CHUNK_TOKENS_MAX) {
      outputChunks.push({
        text: sectionText,
        sectionPath: [sec.heading],
        tokens: sectionTokens,
      });
      continue;
    }

    const paragraphs = sectionText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length <= 1) {
      const subChunks = packByTokens(
        sectionText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        [sec.heading],
      );
      for (const c of subChunks) {
        outputChunks.push(c);
      }
      continue;
    }

    const subChunks = packByTokens(paragraphs, [sec.heading]);
    for (const c of subChunks) {
      outputChunks.push(c);
    }
  }

  return outputChunks;
}

function packByTokens(segments, sectionPath) {
  const result = [];
  let buffer = '';
  let bufferTokens = 0;

  for (const seg of segments) {
    if (!seg) {
      continue;
    }
    const segTokens = tokenCount(seg);

    if (segTokens > CHUNK_TOKENS_MAX) {
      if (buffer) {
        result.push(makePackResult(buffer, sectionPath, bufferTokens));
        buffer = '';
        bufferTokens = 0;
      }
      const linePieces = seg
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const piece of linePieces) {
        const pieceTokens = tokenCount(piece);
        if (pieceTokens > CHUNK_TOKENS_MAX) {
          const split = legacyTokenSplit(piece);
          for (const s of split) {
            const t = typeof s === 'string' ? s : s.text;
            result.push(makePackResult(t, sectionPath, tokenCount(t)));
          }
        } else if (bufferTokens + pieceTokens > CHUNK_TOKENS_TARGET) {
          result.push(makePackResult(buffer, sectionPath, bufferTokens));
          buffer = carryOverlap(buffer) + ' ' + piece;
          bufferTokens = tokenCount(buffer);
        } else {
          buffer = buffer ? buffer + '\n\n' + piece : piece;
          bufferTokens += pieceTokens;
        }
      }
      continue;
    }

    if (bufferTokens + segTokens > CHUNK_TOKENS_TARGET) {
      result.push(makePackResult(buffer, sectionPath, bufferTokens));
      buffer = carryOverlap(buffer) + ' ' + seg;
      bufferTokens = tokenCount(buffer);
    } else {
      buffer = buffer ? buffer + '\n\n' + seg : seg;
      bufferTokens += segTokens;
    }
  }
  if (buffer && buffer.trim()) {
    result.push(makePackResult(buffer, sectionPath, bufferTokens));
  }
  return result;
}

function makePackResult(text, sectionPath, tokens) {
  return { text: text.trim(), sectionPath: sectionPath || ['Content'], tokens };
}

function carryOverlap(text) {
  if (!text) {
    return '';
  }
  const pieces = text.split(/\s+/).filter(Boolean);
  if (pieces.length === 0) {
    return '';
  }
  const targetWords = Math.max(6, Math.round(OVERLAP_TOKENS / 1.3));
  return pieces.slice(-targetWords).join(' ');
}

function legacyTokenSplit(text) {
  const result = [];
  const s = String(text || '');
  if (!s) {
    return result;
  }
  const words = s.split(/\s+/);
  let buffer = '';
  let bufferTokens = 0;
  for (const word of words) {
    const wTokens = Math.max(1, Math.round(tokenCount(word)));
    if (bufferTokens + wTokens > CHUNK_TOKENS_TARGET) {
      result.push({ text: buffer.trim(), sectionPath: ['Content'], tokens: bufferTokens });
      buffer = carryOverlap(buffer) + ' ' + word;
      bufferTokens = tokenCount(buffer);
    } else {
      buffer = buffer ? buffer + ' ' + word : word;
      bufferTokens += wTokens;
    }
  }
  if (buffer && buffer.trim()) {
    result.push({ text: buffer.trim(), sectionPath: ['Content'], tokens: bufferTokens });
  }
  return result;
}

/* ─── token counting ────────────────────────────────────────────────── */
export function tokenCount(text) {
  try {
    if (typeof heuristicCountTokens === 'function') {
      return heuristicCountTokens(text);
    }
  } catch {
    /* noop */
  }
  const s = String(text || '');
  if (!s) {
    return 0;
  }
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (s.match(/[\p{L}\p{N}_-]+/gu) || []).length;
  return Math.max(1, Math.round(cjk + words * 1.3));
}

/* ─── text normalization (local copy) ───────────────────────────────── */
function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
