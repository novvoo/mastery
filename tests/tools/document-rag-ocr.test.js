import { describe, test, expect } from 'bun:test';
import { inferKind, loadDocument } from '../../src/tools/memory/document-rag-parsing.js';

describe('Document RAG OCR-aware parsing', () => {
  test('inferKind detects common image files as OCR-capable images', () => {
    expect(inferKind('scan.png')).toBe('image');
    expect(inferKind('receipt.jpeg')).toBe('image');
    expect(inferKind('https://example.com/page.webp')).toBe('image');
  });

  test('inline documents report text extraction metadata', async () => {
    const parsed = await loadDocument({ content: 'hello document' }, {});
    expect(parsed.text).toBe('hello document');
    expect(parsed.extractionMethod).toBe('text');
    expect(parsed.ocrConfidence).toBeNull();
  });
});
