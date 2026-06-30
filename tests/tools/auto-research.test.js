import { describe, expect, test } from 'bun:test';
import createAutoResearchTool from '../../src/tools/skills/auto_research.js';

describe('auto_research tool', () => {
  test('builds a metric-driven bounded research loop', async () => {
    const tool = createAutoResearchTool();
    const result = await tool.handler({
      question: 'Compare two indexing strategies for semantic search latency',
      objective_metric: 'p95 search latency improves without recall loss',
      budget: '3 iterations',
      evidence_sources: 'code, benchmark, docs',
      constraints: 'do not weaken benchmark',
    });

    expect(tool.name).toBe('auto_research');
    expect(result).toContain('Auto Research Loop');
    expect(result).toContain('p95 search latency improves without recall loss');
    expect(result).toContain('3 iterations');
    expect(result).toContain('Do not edit the metric');
    expect(result).toContain('do not weaken benchmark');
  });
});
