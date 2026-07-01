import { describe, expect, test } from 'bun:test';

import {
  classifyToolObservation,
  ObservationErrorCode,
} from '../../src/core/runtime/agent/support/observation-state.js';

describe('observation-state', () => {
  test('classifies agent-only root listings as empty workspace facts', () => {
    const observation = classifyToolObservation(
      'list_dir',
      { path: '.' },
      '.agent-data\n.agent-logs\n.agent-memory\ntest',
    );

    expect(observation.errorCode).toBe(ObservationErrorCode.EMPTY_WORKSPACE);
    expect(observation.emptyWorkspace).toBe(true);
    expect(observation.directoryEntries).toEqual([
      '.agent-data',
      '.agent-logs',
      '.agent-memory',
      'test',
    ]);
  });

  test('classifies missing-file read observations with target path', () => {
    const observation = classifyToolObservation(
      'read_file',
      { path: 'package.json' },
      'Error: File not found: "package.json"',
    );

    expect(observation.errorCode).toBe(ObservationErrorCode.MISSING_FILE);
    expect(observation.missingPath).toBe('package.json');
  });

  test('classifies fact-blocked reads as fact contradictions', () => {
    const observation = classifyToolObservation(
      'read_file',
      { path: 'src/snake.js' },
      'FACT_BLOCKED: Workspace root is already known to be empty.',
    );

    expect(observation.errorCode).toBe(ObservationErrorCode.FACT_CONTRADICTION);
  });

  test('classifies shell timeout recovery messages as timeout errors', () => {
    const observation = classifyToolObservation(
      'shell',
      { command: 'npm test' },
      'STEP_ABNORMAL: shell_timeout\nCommand: npm test\nRecovery plan:\n1. Retry once with shell using timeout 60000ms.',
    );

    expect(observation.errorCode).toBe(ObservationErrorCode.TIMEOUT_ERROR);
    expect(observation.ok).toBe(false);
  });
});
