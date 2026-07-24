import { describe, expect, test } from 'bun:test';
import {
  clampInspectorWidth,
  TERMINAL_HEIGHT,
  clampTerminalHeight,
  isTerminalToggleShortcut,
  normalizeDesktopLayout,
  normalizeTerminalPanelLayout,
  readDesktopLayout,
  readTerminalPanelLayout,
  resolveWorkbenchLayoutMode,
} from '../../desktop/renderer/app/layout/layout-state.js';

describe('workbench layout state', () => {
  test('uses one terminal height contract for interaction and restore', () => {
    expect(clampTerminalHeight(-1)).toBe(TERMINAL_HEIGHT.min);
    expect(clampTerminalHeight(9999)).toBe(TERMINAL_HEIGHT.max);
    expect(clampTerminalHeight('invalid')).toBe(TERMINAL_HEIGHT.default);
    expect(normalizeTerminalPanelLayout({ height: 560 }).height).toBe(560);
  });

  test('normalizes impossible and stale terminal panel state', () => {
    expect(normalizeTerminalPanelLayout({
      activeTab: 'unknown',
      closed: true,
      open: true,
    })).toEqual({
      activeTab: 'terminal',
      closed: true,
      height: TERMINAL_HEIGHT.default,
      open: false,
    });
  });

  test('recovers safely from invalid persisted JSON', () => {
    const storage = { getItem: () => '{broken' };
    expect(readTerminalPanelLayout(storage)).toEqual({
      activeTab: 'terminal',
      closed: false,
      height: TERMINAL_HEIGHT.default,
      open: true,
    });
  });

  test('does not capture Shift+Backquote used to type a tilde', () => {
    expect(isTerminalToggleShortcut({
      key: '~',
      code: 'Backquote',
      shiftKey: true,
    })).toBe(false);
    expect(isTerminalToggleShortcut({
      key: '`',
      code: 'Backquote',
      ctrlKey: true,
    })).toBe(true);
    expect(isTerminalToggleShortcut({
      key: '`',
      code: 'Backquote',
      metaKey: true,
    })).toBe(true);
  });

  test('normalizes inspector tabs and clamps width to the viewport', () => {
    expect(normalizeDesktopLayout({
      activeInspectorTab: 'rag',
      inspectorPanelWidth: 900,
      sidebarCollapsed: false,
    }, 600)).toEqual({
      activeInspectorTab: 'history',
      inspectorExpanded: false,
      inspectorPanelWidth: 432,
      sidebarCollapsed: false,
    });
    expect(clampInspectorWidth(700, 500)).toBe(360);
  });

  test('recovers desktop layout from malformed persistence', () => {
    const storage = { getItem: () => 'not-json' };
    expect(readDesktopLayout(storage, 1280)).toEqual({
      activeInspectorTab: 'activity',
      inspectorExpanded: false,
      inspectorPanelWidth: 340,
      sidebarCollapsed: true,
    });
  });

  test('protects the primary task surface by projecting inspector layout mode', () => {
    expect(resolveWorkbenchLayoutMode({
      viewportWidth: 1510,
      sidebarVisible: true,
      inspectorVisible: true,
      inspectorWidth: 388,
    })).toBe('docked');
    expect(resolveWorkbenchLayoutMode({
      viewportWidth: 1280,
      sidebarVisible: true,
      inspectorVisible: true,
      inspectorWidth: 388,
    })).toBe('docked');
    expect(resolveWorkbenchLayoutMode({
      viewportWidth: 1024,
      sidebarVisible: true,
      inspectorVisible: true,
      inspectorWidth: 340,
    })).toBe('overlay');
    expect(resolveWorkbenchLayoutMode({
      viewportWidth: 720,
      sidebarVisible: false,
      inspectorVisible: false,
    })).toBe('compact');
  });
});
