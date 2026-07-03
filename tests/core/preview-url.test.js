import { describe, test, expect } from 'bun:test';
import { normalizePreviewUrlInput, formatPreviewUrlInput } from '../../src/core/runtime/preview-url.js';

describe('preview-url (src/core)', () => {
  test('normalizePreviewUrlInput normalizes localhost URLs', () => {
    expect(normalizePreviewUrlInput('localhost:3000')).toContain('localhost:3000');
    expect(normalizePreviewUrlInput('http://localhost:3000')).toContain('localhost:3000');
    expect(normalizePreviewUrlInput('127.0.0.1:8080')).toContain('127.0.0.1:8080');
  });

  test('normalizePreviewUrlInput rejects non-local URLs', () => {
    expect(normalizePreviewUrlInput('https://example.com')).toBeNull();
    expect(normalizePreviewUrlInput('http://192.168.1.1:3000')).toBeNull();
  });

  test('normalizePreviewUrlInput rejects empty input', () => {
    expect(normalizePreviewUrlInput('')).toBeNull();
    expect(normalizePreviewUrlInput(null)).toBeNull();
  });

  test('normalizePreviewUrlInput rejects non-http protocols', () => {
    expect(normalizePreviewUrlInput('ftp://localhost:21')).toBeNull();
  });

  test('formatPreviewUrlInput formats for display', () => {
    expect(formatPreviewUrlInput('localhost:3000')).toContain('localhost:3000');
    expect(formatPreviewUrlInput('invalid-url')).toBe('invalid-url');
    expect(formatPreviewUrlInput('')).toBe('');
  });
});
