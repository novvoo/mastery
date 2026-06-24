import { SECTION_KEYWORDS_EN, SECTION_KEYWORDS_ZH } from '../../utils/patterns.js';

const PREFIX_STRIP_RE =
  /^(?:\s*(?:\d+[.\)、\)）:]|[①-⑳][.:\s]+|[一二三四五六七八九十]+[、.:\s]+|Chapter\s+\d+[:\s]+|[IVXLCDM]+\.\s*))?\s*/i;

export function normalizeHeading(raw) {
  if (!raw) {
    return '';
  }
  let s = String(raw).trim();
  s = s.replace(PREFIX_STRIP_RE, '');
  s = s.replace(/[:：|\-\s]+$/g, '').trim();
  s = s.replace(/^\*+\s*|\s*\*+$/g, '').trim();
  s = s.replace(/^#+\s*/, '').trim();
  return s;
}

export function looksLikeHeading(line) {
  if (!line) {
    return null;
  }
  const trimmed = line.trim();
  const len = Array.from(trimmed).length;

  if (len > 60 || len < 2) {
    return null;
  }
  if (/^[\-\*•\d][\.\)\s]/.test(trimmed)) {
    return null;
  }
  if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)) {
    return null;
  }

  const normalized = normalizeHeading(trimmed);
  if (!normalized) {
    return null;
  }

  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return { text: normalized, kind: 'markdown' };
  }

  if (/^(\*+|_+)\s*\S.*\S\s*\1\s*:?$/.test(trimmed)) {
    return { text: normalized, kind: 'bold' };
  }

  if (/^[A-Z][A-Z0-9\s&/\-]{2,40}$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
    const lower = normalized.toLowerCase();
    if (SECTION_KEYWORDS_EN.some((k) => lower.includes(k)) || len <= 25) {
      return { text: normalized, kind: 'allcaps' };
    }
  }

  const lowerNorm = normalized.toLowerCase();
  const zhHit = SECTION_KEYWORDS_ZH.find((k) => normalized.includes(k));
  if (zhHit) {
    return { text: normalized, kind: 'zh-keyword', matched: zhHit };
  }

  const enHit = SECTION_KEYWORDS_EN.find((k) => lowerNorm.includes(k));
  if (enHit) {
    return { text: normalized, kind: 'en-keyword', matched: enHit };
  }

  if (/[:：]\s*$/.test(trimmed) && len <= 30) {
    return { text: normalized, kind: 'trailing-colon' };
  }

  return null;
}

export function detectSections(rawText) {
  if (!rawText) {
    return [];
  }
  const lines = rawText.split('\n');
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) {
      continue;
    }

    const trimmed = line.trim();
    if (Array.from(trimmed).length > 60) {
      continue;
    }

    const match = looksLikeHeading(trimmed);
    if (match) {
      hits.push({ lineIndex: i, ...match });
    }
  }

  const sections = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].lineIndex;
    const end = i + 1 < hits.length ? hits[i + 1].lineIndex : lines.length;

    let bodyLines = 0;
    for (let j = start + 1; j < end; j++) {
      if (lines[j] && lines[j].trim()) {
        bodyLines++;
      }
    }

    if (bodyLines >= 1 || hits.length === 1) {
      sections.push({
        startLine: start,
        endLine: end,
        heading: hits[i].text,
        kind: hits[i].kind,
        bodyLines,
      });
    }
  }

  if (sections.length === 0 && lines.some((line) => line && line.trim())) {
    sections.push({
      startLine: 0,
      endLine: lines.length,
      heading: 'Content',
      kind: 'default',
      bodyLines: lines.filter((line) => line && line.trim()).length,
    });
  }

  return sections;
}

export function buildSectionPaths(sections) {
  return sections.map((section) => [section.heading]);
}