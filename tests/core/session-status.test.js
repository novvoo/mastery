import { describe, test, expect } from 'bun:test';
import {
  SessionStatus,
  deriveSessionStatus,
  isFinalStatus,
  isActiveStatus,
  getStatusLabel,
  getStatusColor,
} from '../../src/core/session/session-status.js';

describe('session-status (src/core)', () => {
  test('SessionStatus enum has 6 values', () => {
    const values = Object.values(SessionStatus);
    expect(values.length).toBe(6);
    expect(values).toContain('pending');
    expect(values).toContain('running');
    expect(values).toContain('complete');
    expect(values).toContain('interrupted');
    expect(values).toContain('error');
    expect(values).toContain('unknown');
  });

  test('SessionStatus is frozen and cannot be modified', () => {
    expect(Object.isFrozen(SessionStatus)).toBe(true);
    expect(() => {
      SessionStatus.NEW_STATUS = 'new';
    }).toThrow();
    expect(SessionStatus.NEW_STATUS).toBeUndefined();
  });

  test('deriveSessionStatus returns meta.status when provided', () => {
    const result = deriveSessionStatus([], { status: 'running' });
    expect(result).toBe('running');
  });

  test('deriveSessionStatus meta.status overrides messages', () => {
    const messages = [{ type: 'error', content: 'oops' }];
    const result = deriveSessionStatus(messages, { status: 'complete' });
    expect(result).toBe('complete');
  });

  test('deriveSessionStatus empty messages returns pending', () => {
    expect(deriveSessionStatus([])).toBe(SessionStatus.PENDING);
    expect(deriveSessionStatus()).toBe(SessionStatus.PENDING);
    expect(deriveSessionStatus(undefined)).toBe(SessionStatus.PENDING);
  });

  test('deriveSessionStatus last message type=result returns complete', () => {
    const messages = [
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'hello' },
      { type: 'result', content: 'done' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.COMPLETE);
  });

  test('deriveSessionStatus last message type=success returns complete', () => {
    const messages = [
      { type: 'user', content: 'hi' },
      { type: 'success', content: 'done' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.COMPLETE);
  });

  test('deriveSessionStatus last message type=error returns error', () => {
    const messages = [
      { type: 'user', content: 'hi' },
      { type: 'error', content: 'failed' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.ERROR);
  });

  test('deriveSessionStatus has tool messages but no terminal returns interrupted', () => {
    const messages = [
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'let me check' },
      { type: 'tool', name: 'read_file' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.INTERRUPTED);
  });

  test('deriveSessionStatus has tool_call messages returns interrupted', () => {
    const messages = [
      { type: 'user', content: 'hi' },
      { type: 'tool_call', toolName: 'test' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.INTERRUPTED);
  });

  test('deriveSessionStatus has user but no assistant returns interrupted', () => {
    const messages = [{ type: 'user', content: 'hello' }];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.INTERRUPTED);
  });

  test('deriveSessionStatus role field is recognized (compatible format)', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('assistant');
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.UNKNOWN);
  });

  test('deriveSessionStatus role=user no assistant returns interrupted', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.INTERRUPTED);
  });

  test('deriveSessionStatus role=tool returns interrupted', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
      { role: 'tool', content: 'result' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.INTERRUPTED);
  });

  test('deriveSessionStatus mixed messages ending with assistant returns unknown', () => {
    const messages = [
      { type: 'user', content: 'hi' },
      { type: 'assistant', content: 'hello' },
    ];
    expect(deriveSessionStatus(messages)).toBe(SessionStatus.UNKNOWN);
  });

  test('deriveSessionStatus non-array messages returns pending', () => {
    expect(deriveSessionStatus(null)).toBe(SessionStatus.PENDING);
    expect(deriveSessionStatus('string')).toBe(SessionStatus.PENDING);
    expect(deriveSessionStatus(123)).toBe(SessionStatus.PENDING);
    expect(deriveSessionStatus({})).toBe(SessionStatus.PENDING);
  });

  test('isFinalStatus returns true for complete, interrupted, error', () => {
    expect(isFinalStatus(SessionStatus.COMPLETE)).toBe(true);
    expect(isFinalStatus(SessionStatus.INTERRUPTED)).toBe(true);
    expect(isFinalStatus(SessionStatus.ERROR)).toBe(true);
  });

  test('isFinalStatus returns false for pending, running, unknown', () => {
    expect(isFinalStatus(SessionStatus.PENDING)).toBe(false);
    expect(isFinalStatus(SessionStatus.RUNNING)).toBe(false);
    expect(isFinalStatus(SessionStatus.UNKNOWN)).toBe(false);
  });

  test('isFinalStatus returns false for invalid status', () => {
    expect(isFinalStatus('invalid')).toBe(false);
    expect(isFinalStatus(null)).toBe(false);
    expect(isFinalStatus(undefined)).toBe(false);
  });

  test('isActiveStatus returns true for running and pending', () => {
    expect(isActiveStatus(SessionStatus.RUNNING)).toBe(true);
    expect(isActiveStatus(SessionStatus.PENDING)).toBe(true);
  });

  test('isActiveStatus returns false for complete, interrupted, error, unknown', () => {
    expect(isActiveStatus(SessionStatus.COMPLETE)).toBe(false);
    expect(isActiveStatus(SessionStatus.INTERRUPTED)).toBe(false);
    expect(isActiveStatus(SessionStatus.ERROR)).toBe(false);
    expect(isActiveStatus(SessionStatus.UNKNOWN)).toBe(false);
  });

  test('isActiveStatus returns false for invalid status', () => {
    expect(isActiveStatus('invalid')).toBe(false);
    expect(isActiveStatus(null)).toBe(false);
    expect(isActiveStatus(undefined)).toBe(false);
  });

  test('getStatusLabel returns correct Chinese labels for all statuses', () => {
    expect(getStatusLabel(SessionStatus.PENDING)).toBe('待开始');
    expect(getStatusLabel(SessionStatus.RUNNING)).toBe('运行中');
    expect(getStatusLabel(SessionStatus.COMPLETE)).toBe('已完成');
    expect(getStatusLabel(SessionStatus.INTERRUPTED)).toBe('已中断');
    expect(getStatusLabel(SessionStatus.ERROR)).toBe('出错');
    expect(getStatusLabel(SessionStatus.UNKNOWN)).toBe('未知');
  });

  test('getStatusLabel returns 未知 for unknown status values', () => {
    expect(getStatusLabel('invalid_status')).toBe('未知');
    expect(getStatusLabel(null)).toBe('未知');
    expect(getStatusLabel(undefined)).toBe('未知');
    expect(getStatusLabel('')).toBe('未知');
  });

  test('getStatusColor returns correct color names for all statuses', () => {
    expect(getStatusColor(SessionStatus.PENDING)).toBe('muted');
    expect(getStatusColor(SessionStatus.RUNNING)).toBe('primary');
    expect(getStatusColor(SessionStatus.COMPLETE)).toBe('success');
    expect(getStatusColor(SessionStatus.INTERRUPTED)).toBe('warning');
    expect(getStatusColor(SessionStatus.ERROR)).toBe('error');
    expect(getStatusColor(SessionStatus.UNKNOWN)).toBe('muted');
  });

  test('getStatusColor returns muted for unknown status values', () => {
    expect(getStatusColor('invalid_status')).toBe('muted');
    expect(getStatusColor(null)).toBe('muted');
    expect(getStatusColor(undefined)).toBe('muted');
    expect(getStatusColor('')).toBe('muted');
  });
});
