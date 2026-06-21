import { describe, expect, test } from 'bun:test';
import {
  STATUS_TONE,
  getCapsuleTone,
  isStatusPulseEnabled,
  statusDotStyle,
} from '../../desktop/renderer/components/chrome/styles/capsule-styles.js';

describe('STATUS_TONE', () => {
  test('maps runtime tone to a color token', () => {
    expect(STATUS_TONE.warning.color).toBe('var(--warning-color)');
    expect(STATUS_TONE.error.color).toBe('var(--error-color)');
    expect(STATUS_TONE.success.color).toBe('var(--success-color)');
    expect(STATUS_TONE.info.color).toBe('var(--info-color)');
    expect(STATUS_TONE.muted.color).toBe('var(--text-muted)');
  });

  test('tone colors do not decide animation by themselves', () => {
    expect(STATUS_TONE.warning.pulse).toBeUndefined();
    expect(STATUS_TONE.error.pulse).toBe(false);
    expect(STATUS_TONE.success.pulse).toBe(false);
    expect(STATUS_TONE.info.pulse).toBe(false);
  });
});

describe('getCapsuleTone', () => {
  test('returns the tone from runtime status meta', () => {
    expect(getCapsuleTone({ tone: 'warning' })).toBe('warning');
    expect(getCapsuleTone({ tone: 'error' })).toBe('error');
  });

  test('falls back to muted for missing/unknown tone', () => {
    expect(getCapsuleTone({})).toBe('muted');
    expect(getCapsuleTone({ tone: 'unknown' })).toBe('muted');
    expect(getCapsuleTone(null)).toBe('muted');
    expect(getCapsuleTone(undefined)).toBe('muted');
  });
});

describe('status pulse', () => {
  test('pulse is enabled only for active runtime statuses', () => {
    expect(isStatusPulseEnabled('running')).toBe(true);
    expect(isStatusPulseEnabled('initializing')).toBe(true);
    expect(isStatusPulseEnabled('needs_user_input')).toBe(true);
    expect(isStatusPulseEnabled('waiting')).toBe(false);
    expect(isStatusPulseEnabled('idle')).toBe(false);
    expect(isStatusPulseEnabled('error')).toBe(false);
  });

  test('statusDotStyle uses runtime status, not warning tone alone', () => {
    expect(statusDotStyle('warning', 'running').animation).toBe('capsule-pulse 1s infinite');
    expect(statusDotStyle('warning', 'waiting').animation).toBeUndefined();
  });
});
