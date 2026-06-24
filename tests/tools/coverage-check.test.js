import { describe, expect, test } from 'bun:test';
import createCoverageCheckTool from '../../src/tools/skills/coverage_check.js';

describe('coverage_check skill', () => {
  test('should identify missing RAG evidence and recommend document search', async () => {
    const tool = createCoverageCheckTool();
    const result = await tool.handler({
      question: '根据产品文档总结上线风险',
      current_evidence: '',
      available_sources: 'rag',
    });

    expect(result).toContain('NEEDS_RETRIEVAL');
    expect(result).toContain('Relevant document passages');
    expect(result).toContain('document_search');
  });

  test('should recommend web search for time-sensitive facts', async () => {
    const tool = createCoverageCheckTool();
    const result = await tool.handler({
      question: 'OpenAI 最新模型现在支持多大的上下文窗口？',
      current_evidence: 'I remember an older model had a smaller context window.',
      risk_level: 'medium',
    });

    expect(result).toContain('NEEDS_RETRIEVAL');
    expect(result).toContain('web_search');
    expect(result).toContain('Fresh external source');
  });

  test('should mark answer ready when required facts are covered', async () => {
    const tool = createCoverageCheckTool();
    const result = await tool.handler({
      question: '这个模块的主要风险是什么？',
      required_facts: 'Relevant code locations or logs',
      current_evidence:
        'Relevant code locations or logs: src/runtime/agent-engine.js handles tool registration and event flow.',
    });

    expect(result).toContain('READY');
    expect(result).toContain('None detected');
  });

  test('should recommend asking the user when decision criteria are missing', async () => {
    const tool = createCoverageCheckTool();
    const result = await tool.handler({
      question: '这两个方案我应该选哪个？',
      current_evidence: '',
      available_sources: 'context,user',
    });

    expect(result).toContain('ASK_USER');
    expect(result).toContain('ask_user');
    expect(result).toContain('Decision criteria or constraints');
  });
});
