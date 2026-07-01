/**
 * Document loading and parsing for Document RAG.
 *
 * Handles local files, URLs, inline content, and format-specific
 * parsing (PDF, DOCX, HTML, plain text).
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, extname, isAbsolute, join, resolve } from 'path';
import { Buffer } from 'buffer';
import { normalizeText, cleanHTML } from './document-rag-utils.js';
import { OCRRuntime } from '../../core/ocr-runtime.js';

/* ─── constants ─────────────────────────────────────────────────────── */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const USER_AGENT = 'Mastery-Agent/1.0 (+document-rag)';

/* ─── public API ────────────────────────────────────────────────────── */
export async function loadDocument({ source, content, title, ocr = 'auto' }, ctx) {
  if (typeof content === 'string' && content.trim()) {
    return {
      title: title || 'Inline document',
      source: 'inline',
      kind: 'text',
      text: content,
      extractionMethod: 'text',
      ocrConfidence: null,
    };
  }

  if (!source) {
    throw new Error('document_add requires either source or content.');
  }

  const sourceValue = String(source).trim();
  if (/^https?:\/\//i.test(sourceValue)) {
    return await loadURL(sourceValue, title, { ocr });
  }

  return await loadLocalFile(sourceValue, title, ctx?.workingDirectory || process.cwd(), { ocr });
}

/* ─── local file loading ────────────────────────────────────────────── */
async function loadLocalFile(path, title, workingDirectory, options = {}) {
  const absolutePath = isAbsolute(path) ? path : resolve(workingDirectory, path);
  const fileStat = await stat(absolutePath);
  if (fileStat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `Document is too large (${fileStat.size} bytes). Limit is ${MAX_DOCUMENT_BYTES} bytes.`,
    );
  }

  const buffer = await readFile(absolutePath);
  const kind = inferKind(absolutePath, '');
  const parsed = await parseBuffer(buffer, kind, {
    ...options,
    sourcePath: absolutePath,
  });
  return {
    title: title || basename(absolutePath),
    source: absolutePath,
    kind,
    ...parsed,
  };
}

/* ─── URL loading ───────────────────────────────────────────────────── */
async function loadURL(url, title, options = {}) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch document URL: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `Document is too large (${buffer.length} bytes). Limit is ${MAX_DOCUMENT_BYTES} bytes.`,
    );
  }

  const kind = inferKind(url, contentType);
  const parsed = await parseBuffer(buffer, kind, {
    ...options,
    sourcePath: url,
    sourceBuffer: buffer,
  });
  return {
    title: title || inferTitleFromURL(url),
    source: url,
    kind,
    ...parsed,
  };
}

/* ─── format-specific parsing ───────────────────────────────────────── */
async function parseBuffer(buffer, kind, options = {}) {
  const forceOCR = options.ocr === true || options.ocr === 'force';
  const autoOCR = options.ocr !== false && options.ocr !== 'false';

  if (kind === 'image') {
    const ocrResult = await parseWithOCR(options);
    return {
      text: ocrResult.text,
      extractionMethod: 'ocr',
      ocrConfidence: ocrResult.confidence,
    };
  }

  if (forceOCR && supportsOCRFallback(kind)) {
    const ocrResult = await parseWithOCR(options);
    return {
      text: ocrResult.text,
      extractionMethod: 'ocr',
      ocrConfidence: ocrResult.confidence,
    };
  }

  if (kind === 'pdf') {
    ensurePdfJsNodeGlobals();
    const text = await withSuppressedPdfJsCanvasWarnings(async () => {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return normalizeText(result.text || '');
      } finally {
        await parser.destroy();
      }
    });
    if (!text && autoOCR) {
      const ocrResult = await parseWithOCR(options);
      return {
        text: ocrResult.text,
        extractionMethod: 'ocr',
        ocrConfidence: ocrResult.confidence,
      };
    }
    return {
      text,
      extractionMethod: 'text',
      ocrConfidence: null,
    };
  }

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: normalizeText(result.value || ''),
      extractionMethod: 'text',
      ocrConfidence: null,
    };
  }

  const text = buffer.toString('utf-8');
  if (kind === 'html') {
    return {
      text: cleanHTML(text),
      extractionMethod: 'text',
      ocrConfidence: null,
    };
  }
  return {
    text: normalizeText(text),
    extractionMethod: 'text',
    ocrConfidence: null,
  };
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
    const message = args.map((arg) => String(arg)).join(' ');
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
  if (ext === '.pdf' || type.includes('application/pdf')) {
    return 'pdf';
  }
  if (ext === '.docx' || type.includes('wordprocessingml.document')) {
    return 'docx';
  }
  if (ext === '.html' || ext === '.htm' || type.includes('text/html')) {
    return 'html';
  }
  if (
    ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(ext) ||
    type.startsWith('image/')
  ) {
    return 'image';
  }
  if (ext === '.json' || type.includes('application/json')) {
    return 'json';
  }
  if (ext === '.md' || ext === '.markdown') {
    return 'markdown';
  }
  return 'text';
}

function supportsOCRFallback(kind) {
  return kind === 'pdf' || kind === 'image';
}

async function parseWithOCR(options = {}) {
  const cleanupPaths = [];
  let sourcePath = options.sourcePath;

  if (/^https?:\/\//i.test(String(sourcePath || ''))) {
    sourcePath = await writeOCRTempFile(options.sourceBuffer, sourcePath, cleanupPaths);
  }

  try {
    const runtime = new OCRRuntime();
    const result = await runtime.recognize(sourcePath);
    const parsed = normalizeOCRResult(result);
    if (!parsed.text) {
      throw new Error('OCR produced no text.');
    }
    return parsed;
  } finally {
    await Promise.all(cleanupPaths.map((path) => rm(path, { recursive: true, force: true })));
  }
}

async function writeOCRTempFile(buffer, source, cleanupPaths) {
  if (!buffer) {
    throw new Error('OCR fallback requires document bytes.');
  }
  const dir = await mkdtemp(join(tmpdir(), 'mastery-ocr-'));
  cleanupPaths.push(dir);
  const ext = extname(getURLSafePath(source)) || '.bin';
  const path = join(dir, `document${ext}`);
  await writeFile(path, buffer);
  return path;
}

function normalizeOCRResult(result) {
  if (typeof result === 'string') {
    return { text: normalizeText(result), confidence: null };
  }

  if (Array.isArray(result)) {
    const lines = [];
    const confidences = [];
    for (const item of result) {
      if (typeof item === 'string') {
        lines.push(item);
        continue;
      }
      const text = item?.text || item?.line || item?.value || item?.[1]?.[0] || '';
      if (text) {
        lines.push(String(text));
      }
      const confidence = item?.confidence ?? item?.score ?? item?.[1]?.[1];
      if (Number.isFinite(confidence)) {
        confidences.push(Number(confidence));
      }
    }
    return {
      text: normalizeText(lines.join('\n')),
      confidence: averageConfidence(confidences),
    };
  }

  if (result && typeof result === 'object') {
    const text = result.text || result.markdown || result.content || result.result || '';
    const confidence = result.confidence ?? result.score ?? null;
    return {
      text: normalizeText(Array.isArray(text) ? text.join('\n') : text),
      confidence: Number.isFinite(confidence) ? Number(confidence) : null,
    };
  }

  return { text: '', confidence: null };
}

function averageConfidence(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getURLSafePath(source) {
  try {
    return new URL(source).pathname;
  } catch {
    return source;
  }
}

function inferTitleFromURL(url) {
  try {
    const parsed = new URL(url);
    return basename(parsed.pathname) || parsed.hostname;
  } catch {
    return url;
  }
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept:
          'text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
