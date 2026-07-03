import { describe, test, expect } from 'bun:test';
import {
  MAX_ITERATIONS_DEFAULT,
  TERMINATION_KEYWORDS,
  ITERATION_BUDGET,
  STAGNATION_LOOKBACK,
  STAGNATION_SAME_TOOL_LIMIT,
  METHODOLOGY_TOOLS,
  MUTATION_TOOLS,
  VERIFICATION_TOOLS,
  INSPECTION_ONLY_TOOLS,
  RUNTIME_VERIFICATION_TOOLS,
  RUNTIME_VERIFICATION_COMMAND_PATTERNS,
  SEMANTIC_RISK_DOMAINS,
} from '../../src/core/agent/constants.js';

describe('agent-constants', () => {
  test('MAX_ITERATIONS_DEFAULT is a positive number', () => {
    expect(MAX_ITERATIONS_DEFAULT).toBeGreaterThan(0);
  });

  test('TERMINATION_KEYWORDS is non-empty array', () => {
    expect(Array.isArray(TERMINATION_KEYWORDS)).toBe(true);
    expect(TERMINATION_KEYWORDS.length).toBeGreaterThan(0);
  });

  test('ITERATION_BUDGET has expected keys', () => {
    expect(ITERATION_BUDGET.trivial).toBeDefined();
    expect(ITERATION_BUDGET.simple).toBeDefined();
    expect(ITERATION_BUDGET.normal).toBeDefined();
    expect(ITERATION_BUDGET.intensive).toBeDefined();
    expect(ITERATION_BUDGET.exploration).toBeDefined();
    expect(ITERATION_BUDGET.trivial).toBeLessThan(ITERATION_BUDGET.normal);
  });

  test('STAGNATION constants are positive', () => {
    expect(STAGNATION_LOOKBACK).toBeGreaterThan(0);
    expect(STAGNATION_SAME_TOOL_LIMIT).toBeGreaterThan(0);
  });

  test('METHODOLOGY_TOOLS is a Set with expected entries', () => {
    expect(METHODOLOGY_TOOLS instanceof Set).toBe(true);
    expect(METHODOLOGY_TOOLS.has('review')).toBe(true);
    expect(METHODOLOGY_TOOLS.has('verify')).toBe(true);
    expect(METHODOLOGY_TOOLS.has('brainstorm')).toBe(true);
    expect(METHODOLOGY_TOOLS.has('project_profile')).toBe(true);
  });

  test('MUTATION_TOOLS is a Set with write operations', () => {
    expect(MUTATION_TOOLS instanceof Set).toBe(true);
    expect(MUTATION_TOOLS.has('write_file')).toBe(true);
    expect(MUTATION_TOOLS.has('edit_file')).toBe(true);
    expect(MUTATION_TOOLS.has('shell')).toBe(true);
  });

  test('VERIFICATION_TOOLS contains read and verify tools', () => {
    expect(VERIFICATION_TOOLS.has('read_file')).toBe(true);
    expect(VERIFICATION_TOOLS.has('verify')).toBe(true);
  });

  test('INSPECTION_ONLY_TOOLS is subset of VERIFICATION_TOOLS', () => {
    expect(INSPECTION_ONLY_TOOLS.has('read_file')).toBe(true);
    expect(INSPECTION_ONLY_TOOLS.has('shell')).toBe(false);
  });

  test('RUNTIME_VERIFICATION_TOOLS contains shell/pty', () => {
    expect(RUNTIME_VERIFICATION_TOOLS.has('shell')).toBe(true);
    expect(RUNTIME_VERIFICATION_TOOLS.has('verify')).toBe(true);
  });

  test('RUNTIME_VERIFICATION_COMMAND_PATTERNS matches test commands', () => {
    expect(RUNTIME_VERIFICATION_COMMAND_PATTERNS.length).toBeGreaterThan(0);
    expect(RUNTIME_VERIFICATION_COMMAND_PATTERNS.some((p) => p.test('bun test'))).toBe(true);
    expect(RUNTIME_VERIFICATION_COMMAND_PATTERNS.some((p) => p.test('npm run build'))).toBe(true);
    expect(RUNTIME_VERIFICATION_COMMAND_PATTERNS.some((p) => p.test('eslint src/'))).toBe(true);
  });

  test('SEMANTIC_RISK_DOMAINS is non-empty array with required fields', () => {
    expect(SEMANTIC_RISK_DOMAINS.length).toBeGreaterThan(0);
    for (const domain of SEMANTIC_RISK_DOMAINS) {
      expect(domain.id).toBeDefined();
      expect(domain.label).toBeDefined();
      expect(domain.pattern instanceof RegExp).toBe(true);
      expect(domain.checklist).toBeDefined();
    }
  });
});
