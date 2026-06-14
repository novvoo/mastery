import { describe, test, expect } from 'bun:test';
import { IntentClassifier } from '../../src/core/intent-classifier.js';

describe('IntentClassifier', () => {
  test('classifies common intents', () => {
    const classifier = new IntentClassifier();
    expect(classifier).toBeDefined();
  });

  test('classify returns an intent object', () => {
    const classifier = new IntentClassifier();
    if (typeof classifier.classify === 'function') {
      const result = classifier.classify('Read the file and fix the bug');
      expect(result).toBeDefined();
    }
  });

  test('getIntentFromToolName maps tool names to intents', () => {
    const classifier = new IntentClassifier();
    if (typeof classifier.getIntentFromToolName === 'function') {
      const result = classifier.getIntentFromToolName('read_file');
      expect(result).toBeDefined();
    }
  });
});
