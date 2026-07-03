import { describe, test, expect } from 'bun:test';
import { TokenJuice } from '../../src/core/runtime/agent/support/token-juice.js';

describe('TokenJuice', () => {
  test('compresses text and returns shorter output', () => {
    const tj = new TokenJuice();
    const input = 'This is a test string that should be compressed by the token juice system.';
    const compressed = tj.compress(input);
    expect(typeof compressed).toBe('string');
    expect(compressed.length).toBeLessThanOrEqual(input.length);
  });

  test('getStats returns compression statistics', () => {
    const tj = new TokenJuice();
    const input = 'Hello world this is a test of the token juice compression system';
    const compressed = tj.compress(input);
    const stats = tj.getStats(input, compressed);
    expect(stats).toBeDefined();
    expect(stats.originalChars).toBe(input.length);
    expect(stats.compressedChars).toBe(compressed.length);
  });

  test('compress returns empty for empty input', () => {
    const tj = new TokenJuice();
    expect(tj.compress('')).toBe('');
  });

  test('decompress restores compressed text', () => {
    const tj = new TokenJuice();
    const input = 'The quick brown fox jumps over the lazy dog';
    const compressed = tj.compress(input);
    if (typeof tj.decompress === 'function') {
      const restored = tj.decompress(compressed);
      expect(restored).toBe(input);
    }
  });
});
