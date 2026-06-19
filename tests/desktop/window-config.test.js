import { describe, expect, test } from 'bun:test';
import { buildWindowConfig } from '../../desktop/main-app/window-config.js';

describe('buildWindowConfig', () => {
  test('common to all platforms: transparent + no opaque bg + show:false + hasShadow', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const cfg = buildWindowConfig(platform, { width: 1400, height: 900, minWidth: 800, minHeight: 600 });
      expect(cfg.transparent).toBe(true);
      expect(cfg.backgroundColor).toBe('#00000000');
      expect(cfg.show).toBe(false);
      expect(cfg.hasShadow).toBe(true);
      expect(cfg.roundedCorners).toBe(true);
      expect(cfg.width).toBe(1400);
      expect(cfg.minHeight).toBe(600);
    }
  });

  test('macOS: vibrancy under-window + hiddenInset titleBarStyle + frame true', () => {
    const cfg = buildWindowConfig('darwin', {});
    expect(cfg.vibrancy).toBe('under-window');
    expect(cfg.visualEffectState).toBe('active');
    expect(cfg.titleBarStyle).toBe('hiddenInset');
    expect(cfg.trafficLightPosition).toEqual({ x: 14, y: 14 });
    expect(cfg.frame).toBe(true);
  });

  test('win32: backgroundMaterial mica', () => {
    const cfg = buildWindowConfig('win32', {});
    expect(cfg.backgroundMaterial).toBe('mica');
    expect(cfg.titleBarStyle).toBe('default');
    // win32 仍 transparent（强行透明，不降级）
    expect(cfg.transparent).toBe(true);
  });

  test('linux: forced transparent, no downgrade (user decision)', () => {
    const cfg = buildWindowConfig('linux', {});
    expect(cfg.transparent).toBe(true);
    expect(cfg.vibrancy).toBeUndefined();
    expect(cfg.backgroundMaterial).toBeUndefined();
    expect(cfg.titleBarStyle).toBe('default');
  });

  test('does not set frame:false (keep native frame, no self-drawn chrome)', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const cfg = buildWindowConfig(platform, {});
      expect(cfg.frame).not.toBe(false);
    }
  });
});
