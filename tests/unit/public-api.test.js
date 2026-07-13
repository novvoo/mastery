import { describe, expect, test } from 'bun:test';
import * as publicAPI from '../../src/index.js';

describe('公共 API 入口 (src/index.js)', () => {
  test('导出 OmpAdapter', () => {
    expect(publicAPI.OmpAdapter).toBeDefined();
    expect(publicAPI.createOmpAdapter).toBeDefined();
    expect(typeof publicAPI.createOmpAdapter).toBe('function');
  });

  test('导出 DesktopCore', () => {
    expect(publicAPI.DesktopCore).toBeDefined();
    expect(publicAPI.createDesktopCore).toBeDefined();
    expect(publicAPI.DesktopState).toBeDefined();
    expect(publicAPI.DesktopPlugin).toBeDefined();
    expect(publicAPI.UIBridge).toBeDefined();
    expect(publicAPI.createUIBridge).toBeDefined();
  });

  test('导出 RuntimeEvent', () => {
    expect(publicAPI.RuntimeEvent).toBeDefined();
    expect(typeof publicAPI.RuntimeEvent).toBe('object');
  });

  test('导出 PlatformType', () => {
    expect(publicAPI.PlatformType).toBeDefined();
    expect(publicAPI.PlatformType.DESKTOP).toBe('desktop');
  });

  test('导出 getEventBus', () => {
    expect(publicAPI.getEventBus).toBeDefined();
    expect(typeof publicAPI.getEventBus).toBe('function');
  });

  test('导出 MAX_ITERATIONS_DEFAULT', () => {
    expect(publicAPI.MAX_ITERATIONS_DEFAULT).toBeDefined();
    expect(typeof publicAPI.MAX_ITERATIONS_DEFAULT).toBe('number');
  });
});
