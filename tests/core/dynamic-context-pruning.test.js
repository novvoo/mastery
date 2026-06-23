import { describe, test, expect, mock } from 'bun:test';
import { DynamicContextPruning } from '../../src/core/dynamic-context-pruning.js';

describe('DynamicContextPruning', () => {
  test('constructor creates instance with default config', () => {
    const pruning = new DynamicContextPruning();
    const config = pruning.getConfig();
    expect(config.maxTokens).toBe(128000);
    expect(config.targetTokens).toBe(80000);
    expect(config.minMessages).toBe(5);
    expect(config.preserveSystemPrompt).toBe(true);
    expect(config.preserveRecentMessages).toBe(6);
    expect(config.importanceThreshold).toBe(0.4);
    expect(config.compressionRatio).toBe(0.7);
  });

  test('constructor accepts custom options', () => {
    const pruning = new DynamicContextPruning({
      maxTokens: 50000,
      targetTokens: 30000,
      minMessages: 3,
      preserveSystemPrompt: false,
      preserveRecentMessages: 4,
      importanceThreshold: 0.6,
    });
    const config = pruning.getConfig();
    expect(config.maxTokens).toBe(50000);
    expect(config.targetTokens).toBe(30000);
    expect(config.minMessages).toBe(3);
    expect(config.preserveSystemPrompt).toBe(false);
    expect(config.preserveRecentMessages).toBe(4);
    expect(config.importanceThreshold).toBe(0.6);
  });

  test('prune returns empty for empty input', () => {
    const pruning = new DynamicContextPruning();
    const result = pruning.prune([]);
    expect(result.messages).toEqual([]);
    expect(result.stats.originalTokens).toBe(0);
    expect(result.stats.prunedTokens).toBe(0);
    expect(result.stats.messagesRemoved).toBe(0);
    expect(result.stats.compressionRatio).toBe(1);
  });

  test('prune returns empty for non-array input', () => {
    const pruning = new DynamicContextPruning();
    const result = pruning.prune(null);
    expect(result.messages).toEqual([]);
  });

  test('prune returns messages unchanged when under target tokens', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 100000, targetTokens: 50000 });
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = pruning.prune(messages);
    expect(result.messages.length).toBe(2);
    expect(result.stats.compressionRatio).toBe(1);
    expect(result.stats.prunedTokens).toBe(0);
  });

  test('prune preserves system prompt when configured', () => {
    const pruning = new DynamicContextPruning({
      maxTokens: 500,
      targetTokens: 200,
      preserveSystemPrompt: true,
      preserveRecentMessages: 1,
    });
    const messages = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Question one about something long enough to matter' },
      { role: 'assistant', content: 'Answer one that is also somewhat long to take up tokens' },
      { role: 'user', content: 'Question two about another topic that is interesting' },
      { role: 'assistant', content: 'Answer two that is also somewhat detailed' },
    ];
    const result = pruning.prune(messages);
    const systemMessages = result.messages.filter(m => m.role === 'system');
    // The original system prompt should be preserved (or a summary injected)
    expect(systemMessages.length).toBeGreaterThanOrEqual(1);
  });

  test('prune reduces messages when over target tokens', () => {
    const pruning = new DynamicContextPruning({
      maxTokens: 300,
      targetTokens: 150,
      preserveRecentMessages: 2,
      importanceThreshold: 0.4,
    });

    // Create many messages that exceed target
    const messages = [];
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'user', content: `This is message number ${i} with some content to add tokens to the context window` });
      messages.push({ role: 'assistant', content: `This is response number ${i} with enough content to make the total tokens exceed the target` });
    }

    const result = pruning.prune(messages);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.stats.prunedTokens).toBeGreaterThan(0);
    expect(result.stats.messagesRemoved).toBeGreaterThan(0);
    expect(result.stats.compressionRatio).toBeLessThan(1);
  });

  test('prune preserves recent messages', () => {
    const pruning = new DynamicContextPruning({
      maxTokens: 500,
      targetTokens: 200,
      preserveRecentMessages: 3,
    });

    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `Message ${i} with enough text to take up token space in the overall context` });
    }

    const result = pruning.prune(messages);
    // Last 3 messages should be preserved
    const lastThree = messages.slice(-3);
    for (const msg of lastThree) {
      const found = result.messages.some(m => m.content === msg.content);
      expect(found).toBe(true);
    }
  });

  test('prune injects summary when messages are removed', () => {
    const pruning = new DynamicContextPruning({
      maxTokens: 300,
      targetTokens: 150,
      preserveRecentMessages: 1,
    });

    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `User message number ${i} with some meaningful content about topic ${i}` });
      messages.push({ role: 'assistant', content: `Assistant response number ${i} with helpful information about topic ${i}` });
    }

    const result = pruning.prune(messages);
    if (result.stats.messagesRemoved > 0) {
      // A summary message should be injected
      const summaryMsg = result.messages.find(m => m.role === 'system' && m.content?.includes('[Context summary'));
      expect(summaryMsg).toBeDefined();
    }
  });

  test('analyzeImportance returns importance analysis for each message', () => {
    const pruning = new DynamicContextPruning();
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' },
      { role: 'assistant', content: 'Assistant response' },
    ];

    const analysis = pruning.analyzeImportance(messages);
    expect(analysis).toHaveLength(3);
    expect(analysis[0].index).toBe(0);
    expect(analysis[0].role).toBe('system');
    expect(typeof analysis[0].importance).toBe('number');
    expect(typeof analysis[0].tokens).toBe('number');
    expect(typeof analysis[0].preview).toBe('string');
  });

  test('analyzeImportance assigns higher importance to system messages', () => {
    const pruning = new DynamicContextPruning();
    const messages = [
      { role: 'system', content: 'Important system prompt with details' },
      { role: 'thought', content: 'Internal thinking about the problem' },
    ];

    const analysis = pruning.analyzeImportance(messages);
    expect(analysis[0].importance).toBeGreaterThan(analysis[1].importance);
  });

  test('analyzeImportance returns numeric importance for each message', () => {
    const pruning = new DynamicContextPruning();
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Response' },
    ];

    const analysis = pruning.analyzeImportance(messages);
    expect(analysis).toHaveLength(3);
    for (const item of analysis) {
      expect(typeof item.importance).toBe('number');
      expect(item.importance).toBeGreaterThanOrEqual(0);
      expect(item.importance).toBeLessThanOrEqual(100);
    }
    // System messages should have non-zero importance
    expect(analysis[0].importance).toBeGreaterThan(0);
  });

  test('suggestOptimizations returns suggestions', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 100 });

    // Create many messages to exceed token capacity
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `Message ${i} with substantial content about various programming topics and issues` });
    }

    const suggestions = pruning.suggestOptimizations(messages);
    expect(Array.isArray(suggestions)).toBe(true);
    // Should have at least one suggestion given many messages
    expect(suggestions.length).toBeGreaterThan(0);
  });

  test('suggestOptimizations returns critical_overflow when near limit', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 200, targetTokens: 100 });

    const messages = [];
    for (let i = 0; i < 50; i++) {
      messages.push({ role: 'user', content: `This is a long message ${i} with lots of content that will push the total token count very high beyond the maximum limit configured` });
    }

    const suggestions = pruning.suggestOptimizations(messages);
    const overflow = suggestions.find(s => s.type === 'critical_overflow');
    expect(overflow).toBeDefined();
  });

  test('suggestOptimizations detects excessive tool results', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 100000 });

    const messages = [];
    for (let i = 0; i < 15; i++) {
      messages.push({ role: 'tool', content: `Tool result ${i}` });
    }

    const suggestions = pruning.suggestOptimizations(messages);
    const toolSuggestion = suggestions.find(s => s.type === 'excessive_tool_results');
    expect(toolSuggestion).toBeDefined();
  });

  test('getConfig returns a copy of config', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 5000 });
    const config1 = pruning.getConfig();
    const config2 = pruning.getConfig();
    expect(config1).toEqual(config2);
    expect(config1).not.toBe(config2); // different object references
  });

  test('updateConfig merges new config values', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 5000 });
    pruning.updateConfig({ maxTokens: 10000, targetTokens: 7000 });
    const config = pruning.getConfig();
    expect(config.maxTokens).toBe(10000);
    expect(config.targetTokens).toBe(7000);
  });

  test('prune with custom importanceScorer', () => {
    let scorerCalled = false;
    const customScorer = (message) => {
      scorerCalled = true;
      if (message.role === 'system') {return 100;}
      return 10;
    };
    const pruning = new DynamicContextPruning({
      importanceScorer: customScorer,
      maxTokens: 300,
      targetTokens: 100,
      preserveRecentMessages: 1,
    });
    // Create enough messages to trigger pruning (which calls the scorer)
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `Message ${i} with some content for token counting` });
    }
    pruning.prune(messages);
    expect(scorerCalled).toBe(true);
  });

  test('prune with custom tokenCounter', () => {
    const customCounter = mock((text) => {
      return text.length;
    });
    const pruning = new DynamicContextPruning({
      tokenCounter: customCounter,
      maxTokens: 100000,
      targetTokens: 50000,
    });
    const messages = [
      { role: 'user', content: 'Hello world' },
    ];
    pruning.prune(messages);
    expect(customCounter).toHaveBeenCalled();
  });

  test('prune handles messages with tool_calls', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 100000, targetTokens: 50000 });
    const messages = [
      { role: 'assistant', content: 'Using tool', tool_calls: [{ function: { name: 'read_file', arguments: '{"path": "/test"}' } }] },
    ];
    const result = pruning.prune(messages);
    expect(result.messages.length).toBe(1);
  });

  test('prune handles messages with tool_call_id', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 100000, targetTokens: 50000 });
    const messages = [
      { role: 'tool', content: 'Result', tool_call_id: 'call_123' },
    ];
    const result = pruning.prune(messages);
    expect(result.messages.length).toBe(1);
  });

  test('prune handles messages with name field', () => {
    const pruning = new DynamicContextPruning({ maxTokens: 100000, targetTokens: 50000 });
    const messages = [
      { role: 'assistant', content: 'Response', name: 'helper_agent' },
    ];
    const result = pruning.prune(messages);
    expect(result.messages.length).toBe(1);
  });
});
