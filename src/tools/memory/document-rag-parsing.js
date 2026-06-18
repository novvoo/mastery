/**
 * Document loading and parsing for Document RAG.
 *
 * Handles local files, URLs, inline content, and format-specific
 * parsing (PDF, DOCX, HTML, plain text).
 */

import { readFile, stat } from 'fs/promises';
import { basename, extname, isAbsolute, resolve } from 'path';
import { Buffer } from 'buffer';
import { normalizeText, cleanHTML } from './document-rag-utils.js';

/* ─── constants ─────────────────────────────────────────────────────── */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const USER_AGENT = 'Mastery-Agent/1.0 (+document-rag)';

/* ─── public API ────────────────────────────────────────────────────── */
export async function loadDocument({ source, content, title }, ctx) {
  if (typeof content === 'string' && content.trim()) {
    return {
      title: title || 'Inline document',
      source: 'inline',
      kind: 'text',
      text: content,
    };
  }

  if (!source) {
    throw new Error('document_add requires either source or content.');
  }

  const sourceValue = String(source).trim();
  if (/^https?:\/\//i.test(sourceValue)) {
    return await loadURL(sourceValue, title);
  }

  return await loadLocalFile(sourceValue, title, ctx?.workingDirectory || process.cwd());
}

/* ─── local file loading ────────────────────────────────────────────── */
async function loadLocalFile(path, title, workingDirectory) {
  const absolutePath = isAbsolute(path) ? path : resolve(workingDirectory, path);
  const fileStat = await stat(absolutePath);
  if (fileStat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document is too large (${fileStat.size} bytes). Limit is ${MAX_DOCUMENT_BYTES} bytes.`);
  }

  const buffer = await readFile(absolutePath);
  const kind = inferKind(absolutePath, '');
  const text = await parseBuffer(buffer, kind);
  return {
    title: title || basename(absolutePath),
    source: absolutePath,
    kind,
    text,
  };
}

/* ─── URL loading ───────────────────────────────────────────────────── */
async function loadURL(url, title) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch document URL: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document is too large (${buffer.length} bytes). Limit is ${MAX_DOCUMENT_BYTES} bytes.`);
  }

  const kind = inferKind(url, contentType);
  const text = await parseBuffer(buffer, kind);
  return {
    title: title || inferTitleFromURL(url),
    source: url,
    kind,
    text,
  };
}

/* ─── format-specific parsing ───────────────────────────────────────── */
async function parseBuffer(buffer, kind) {
  if (kind === 'pdf') {
    ensurePdfJsNodeGlobals();
    return await withSuppressedPdfJsCanvasWarnings(async () => {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return normalizeText(result.text || '');
      } finally {
        await parser.destroy();
      }
    });
  }

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return normalizeText(result.value || '');
  }

  const text = buffer.toString('utf-8');
  if (kind === 'html') {
    return cleanHTML(text);
  }
  return normalizeText(text);
}

function ensurePdfJsNodeGlobals() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {};
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {};
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {};
  }
}

async function withSuppressedPdfJsCanvasWarnings(fn) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args.map(arg => String(arg)).join(' ');
    if (
      message.includes('Cannot load "@napi-rs/canvas"') ||
      message.includes('Cannot polyfill `DOMMatrix`') ||
      message.includes('Cannot polyfill `ImageData`') ||
      message.includes('Cannot polyfill `Path2D`')
    ) {
      return;
    }
    originalWarn(...args);
  };

  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

/* ─── format/kind inference ─────────────────────────────────────────── */
export function inferKind(source, contentType = '') {
  const ext = extname(getURLSafePath(source)).toLowerCase();
  const type = contentType.toLowerCase();
  if (ext === '.pdf' || type.includes('application/pdf')) { return 'pdf'; }
  if (ext === '.docx' || type.includes('wordprocessingml.document')) { return 'docx'; }
  if (ext === '.html' || ext === '.htm' || type.includes('text/html')) { return 'html'; }
  if (ext === '.json' || type.includes('application/json')) { return 'json'; }
  if (ext === '.md' || ext === '.markdown') { return 'markdown'; }
  return 'text';
}

function getURLSafePath(source) {
  try { return new URL(source).pathname; } catch { return source; }
}

function inferTitleFromURL(url) {
  try {
    const parsed = new URL(url);
    return basename(parsed.pathname) || parsed.hostname;
  } catch { return url; }
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
