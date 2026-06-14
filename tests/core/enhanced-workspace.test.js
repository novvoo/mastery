import { describe, test, expect, mock } from 'bun:test';
import { createEnhancedWorkspace } from '../../src/core/enhanced-workspace.js';
import { WorkspaceState } from '../../src/core/workspace-state.js';
import { ObservationSummarizer } from '../../src/core/observation-summarizer.js';

describe('createEnhancedWorkspace', () => {
  test('returns all expected API properties', () => {
    const ew = createEnhancedWorkspace();
    expect(ew.workspaceState).toBeInstanceOf(WorkspaceState);
    expect(ew.observationSummarizer).toBeInstanceOf(ObservationSummarizer);
    expect(typeof ew.processToolResult).toBe('function');
    expect(typeof ew.checkToolPrediction).toBe('function');
    expect(typeof ew.checkPathExists).toBe('function');
    expect(typeof ew.getContextPreservationHint).toBe('function');
    expect(typeof ew.getState).toBe('function');
    expect(typeof ew.restoreState).toBe('function');
    expect(typeof ew.clear).toBe('function');
    expect(typeof ew.getToolAdvice).toBe('function');
  });

  test('processToolResult delegates to observationSummarizer and returns processed result', () => {
    const ew = createEnhancedWorkspace();
    const result = ew.processToolResult('list_dir', { path: '/src' }, 'file1.js\nfile2.js');
    expect(result.summary).toBeDefined();
    expect(result.facts).toBeDefined();
    expect(result.shouldCache).toBe(true);
  });

  test('checkToolPrediction delegates to workspaceState', () => {
    const ew = createEnhancedWorkspace();
    // Record a failed path first
    ew.workspaceState.recordPathNotFound('/gone.js', 'deleted');
    const prediction = ew.checkToolPrediction('read_file', { path: '/gone.js' });
    expect(prediction.canSkip).toBe(true);
    expect(prediction.type).toBe('will_fail');
  });

  test('checkPathExists delegates to workspaceState', () => {
    const ew = createEnhancedWorkspace();
    ew.workspaceState.recordFileRead('/src/app.js', true, 'content');
    expect(ew.checkPathExists('/src/app.js')).toBe('exists');
    expect(ew.checkPathExists('/unknown')).toBe('unknown');
  });

  test('getState and restoreState roundtrip preserves state', () => {
    const ew = createEnhancedWorkspace();
    ew.workspaceState.recordFileRead('/a.js', true, 'ok');
    ew.workspaceState.recordPathNotFound('/b.js', 'gone');

    const state = ew.getState();
    expect(state).toBeDefined();

    const ew2 = createEnhancedWorkspace();
    ew2.restoreState(state);
    expect(ew2.checkPathExists('/a.js')).toBe('exists');
    expect(ew2.checkPathExists('/b.js')).toBe('not_found');
  });

  test('restoreState with null does not throw', () => {
    const ew = createEnhancedWorkspace();
    expect(() => ew.restoreState(null)).not.toThrow();
    expect(() => ew.restoreState(undefined)).not.toThrow();
  });

  test('clear resets workspaceState and observation history', () => {
    const ew = createEnhancedWorkspace();
    ew.workspaceState.recordFileRead('/a.js', true, 'ok');
    ew.processToolResult('list_dir', { path: '/src' }, 'file1.js');

    ew.clear();
    expect(ew.checkPathExists('/a.js')).toBe('unknown');

    // After clear, getToolAdvice for a tool should not have recent observations
    const advice = ew.getToolAdvice('list_dir', { path: '/src' });
    expect(advice.recentObservations).toEqual([]);
  });

  test('workspaceState and observationSummarizer are accessible after creation', () => {
    const ew = createEnhancedWorkspace();
    ew.workspaceState.recordPathNotFound('/missing.js', 'not found');

    // Test workspaceState directly
    expect(ew.workspaceState.checkPathExists('/missing.js')).toBe('not_found');
    const facts = ew.workspaceState.getCriticalFacts();
    expect(facts.some(f => f.type === 'path_not_found')).toBe(true);
  });

  test('knownNonExistent paths are derivable from workspaceState critical facts', () => {
    const ew = createEnhancedWorkspace();
    // No failed paths
    const facts1 = ew.workspaceState.getCriticalFacts().filter(f => f.type === 'path_not_found');
    expect(facts1.length).toBe(0);

    // Add a failed path
    ew.workspaceState.recordPathNotFound('/gone.js', 'deleted');
    const facts2 = ew.workspaceState.getCriticalFacts().filter(f => f.type === 'path_not_found');
    expect(facts2.length).toBeGreaterThan(0);
    expect(facts2[0].value.path).toBe('/gone.js');
  });

  test('getToolAdvice returns prediction and suggestions', () => {
    const ew = createEnhancedWorkspace();
    ew.workspaceState.recordPathNotFound('/gone.js', 'deleted');

    const advice = ew.getToolAdvice('read_file', { path: '/gone.js' });
    expect(advice.prediction).toBeDefined();
    expect(advice.prediction.canSkip).toBe(true);
    expect(advice.suggestion).toBeDefined();
    expect(typeof advice.suggestion).toBe('string');
  });

  test('getToolAdvice for unknown tool returns default suggestion', () => {
    const ew = createEnhancedWorkspace();
    const advice = ew.getToolAdvice('unknown_tool', {});
    expect(advice.prediction.type).toBe('unknown');
    expect(advice.suggestion).toContain('workspace_knowledge');
  });

  test('registers tools to toolRegistry when provided', () => {
    const registeredTools = [];
    const toolRegistry = {
      register: mock((tool) => {
        registeredTools.push(tool);
      }),
    };

    const ew = createEnhancedWorkspace({ toolRegistry });
    expect(registeredTools.length).toBeGreaterThan(0);
    expect(registeredTools.some(t => t.name === 'workspace_knowledge')).toBe(true);
    expect(registeredTools.some(t => t.name === 'workspace_check_operation')).toBe(true);
  });

  test('does not register tools when includeToolsInRegistry is false', () => {
    const registeredTools = [];
    const toolRegistry = {
      register: mock((tool) => {
        registeredTools.push(tool);
      }),
    };

    const ew = createEnhancedWorkspace({ toolRegistry, includeToolsInRegistry: false });
    expect(registeredTools.length).toBe(0);
  });

  test('does not register tools when toolRegistry is not provided', () => {
    const ew = createEnhancedWorkspace();
    // Should not throw
    expect(ew.workspaceState).toBeInstanceOf(WorkspaceState);
  });

  test('observation history is capped at 50 after exceeding 100', () => {
    const ew = createEnhancedWorkspace();
    // Process 105 tool results
    for (let i = 0; i < 105; i++) {
      ew.processToolResult('list_dir', { path: `/dir${i}` }, `file${i}.js`);
    }
    // Internal observationHistory is not exposed, but getToolAdvice
    // uses it for recentObservations — verify it still works
    const advice = ew.getToolAdvice('list_dir', { path: '/dir0' });
    expect(advice.recentObservations.length).toBeLessThanOrEqual(3);
  });
});
