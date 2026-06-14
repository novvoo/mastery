import { describe, test, expect } from 'bun:test';
import { Tokenizer } from '../../src/core/tokenizer.js';

describe('Tokenizer', () => {
  test('constructor with default model', () => {
    const t = new Tokenizer();
    expect(t).toBeDefined();
  });

  test('constructor with specific model', () => {
    const t = new Tokenizer({ model: 'claude-3' });
    expect(t).toBeDefined();
  });

  test('createTokenCounter returns function', () => {
    const counter = Tokenizer.createTokenCounter({ model: 'gpt-4o' });
    expect(typeof counter).toBe('function');
    const count = counter('hello world');
    expect(count).toBeGreaterThan(0);
  });

  test('createTokenCounter handles empty string', () => {
    const counter = Tokenizer.createTokenCounter({ model: 'gpt-4o' });
    expect(counter('')).toBe(0);
  });

  test('createTokenCounter handles CJK characters', () => {
    const counter = Tokenizer.createTokenCounter({ model: 'gpt-4o' });
    const count = counter('你好世界这是一个测试');
    expect(count).toBeGreaterThan(0);
  });

  test('normalizeModelName handles known models', () => {
    const name = Tokenizer.normalizeModelName('gpt-4o');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  test('normalizeModelName handles unknown models', () => {
    const name = Tokenizer.normalizeModelName('totally-unknown-xyz');
    expect(typeof name).toBe('string');
  });
});
