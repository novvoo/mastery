import { describe, test, expect } from 'bun:test';
import {
  RUNTIME_STATUS_META,
  getRuntimeStatusMeta,
  getRuntimeStatusText,
} from '../../src/core/runtime/runtime-status.js';

describe('runtime-status (src/core)', () => {
  test('RUNTIME_STATUS_META has required statuses', () => {
    expect(RUNTIME_STATUS_META.running).toBeDefined();
    expect(RUNTIME_STATUS_META.completed).toBeDefined();
    expect(RUNTIME_STATUS_META.error).toBeDefined();
    expect(RUNTIME_STATUS_META.idle).toBeDefined();
    expect(RUNTIME_STATUS_META.needs_user_input).toBeDefined();
  });

  test('RUNTIME_STATUS_META entries have text and icon', () => {
    for (const [key, meta] of Object.entries(RUNTIME_STATUS_META)) {
      expect(meta.text).toBeDefined();
      expect(meta.icon).toBeDefined();
      expect(typeof meta.text).toBe('string');
    }
  });

  test('getRuntimeStatusMeta returns known status', () => {
    const meta = getRuntimeStatusMeta('running');
    expect(meta.text).toBe('运行中');
    expect(meta.icon).toBe('⚡');
  });

  test('getRuntimeStatusMeta returns default for unknown status', () => {
    const meta = getRuntimeStatusMeta('unknown_status');
    expect(meta.text).toBe('未知');
    expect(meta.icon).toBe('?');
  });

  test('getRuntimeStatusText returns text only', () => {
    expect(getRuntimeStatusText('running')).toBe('运行中');
    expect(getRuntimeStatusText('completed')).toBe('完成');
    expect(getRuntimeStatusText('error')).toBe('错误');
    expect(getRuntimeStatusText('unknown')).toBe('未知');
  });
});
