import { describe, test, expect } from 'bun:test';
import {
  ToolCategory,
  ErrorCategory,
  ErrorSeverity,
  PermissionLevel,
  ToolScope,
  ExperienceOutcome,
} from '../../src/core/types/index.js';

describe('types', () => {
  test('ToolCategory has expected values', () => {
    expect(ToolCategory.FILESYSTEM).toBe('filesystem');
    expect(ToolCategory.SYSTEM).toBe('system');
    expect(ToolCategory.WEB).toBe('web');
    expect(ToolCategory.SKILL_ENGINEERING).toBe('skill_engineering');
  });

  test('ToolCategory is frozen', () => {
    expect(Object.isFrozen(ToolCategory)).toBe(true);
  });

  test('ErrorCategory has expected values', () => {
    expect(ErrorCategory.MODEL_ERROR).toBe('model_error');
    expect(ErrorCategory.TOOL_ERROR).toBe('tool_error');
    expect(ErrorCategory.TIMEOUT_ERROR).toBe('timeout_error');
  });

  test('ErrorSeverity has expected values', () => {
    expect(ErrorSeverity.RECOVERABLE).toBe('recoverable');
    expect(ErrorSeverity.FATAL).toBe('fatal');
    expect(ErrorSeverity.DEGRADED).toBe('degraded');
  });

  test('PermissionLevel is ordered', () => {
    expect(PermissionLevel.NONE).toBe('none');
    expect(PermissionLevel.READ_ONLY).toBe('readonly');
    expect(PermissionLevel.WRITE).toBe('write');
    expect(PermissionLevel.EXECUTE).toBe('execute');
    expect(PermissionLevel.DANGEROUS).toBe('dangerous');
  });

  test('ToolScope has expected values', () => {
    expect(ToolScope.ALL).toBe('all');
    expect(ToolScope.AGENT_ONLY).toBe('agent');
    expect(ToolScope.CLI_ONLY).toBe('cli');
  });

  test('ExperienceOutcome has expected values', () => {
    expect(ExperienceOutcome.SUCCESS).toBe('success');
    expect(ExperienceOutcome.FAILURE).toBe('failure');
    expect(ExperienceOutcome.PARTIAL).toBe('partial');
  });
});
