import { describe, expect, test } from 'bun:test';
import {
  formatPreviewUrlInput,
  normalizePreviewUrlInput
} from '../../desktop/renderer/runtime/preview-url.js';

describe('desktop preview URL helpers', () => {
  test('normalizes localhost preview addresses', () => {
    expect(normalizePreviewUrlInput('127.0.0.1:41730')).toBe('http://127.0.0.1:41730/');
    expect(normalizePreviewUrlInput('http://localhost:41730/app?x=1')).toBe('http://localhost:41730/app?x=1');
  });

  test('rejects non-local preview addresses', () => {
    expect(normalizePreviewUrlInput('https://example.com')).toBe(null);
    expect(normalizePreviewUrlInput('file:///tmp/index.html')).toBe(null);
    expect(normalizePreviewUrlInput('')).toBe(null);
  });

  test('formats local preview addresses for compact display', () => {
    expect(formatPreviewUrlInput('http://127.0.0.1:41730/index.html')).toBe('127.0.0.1:41730/index.html');
    expect(formatPreviewUrlInput('http://localhost:41730/')).toBe('localhost:41730');
  });
});
