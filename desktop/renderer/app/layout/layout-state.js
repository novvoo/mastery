import { LAYOUT } from '../config/index.js';

export const DESKTOP_LAYOUT_STORAGE_KEY = 'desktopWorkbenchLayout';
export const TERMINAL_PANEL_STORAGE_KEY = 'ai-agent-terminal-panel';
export const TERMINAL_HEIGHT = Object.freeze({
  min: 160,
  max: 560,
  default: 280,
  keyboardStep: 24,
  keyboardLargeStep: 80,
});
export const TERMINAL_TABS = Object.freeze(['terminal', 'problems', 'output']);
export const INSPECTOR_TABS = Object.freeze(['activity', 'history', 'preview']);
export const INSPECTOR_WIDTH = Object.freeze({
  keyboardStep: 24,
  keyboardLargeStep: 80,
});

export function clampInspectorWidth(width, viewportWidth = globalThis.innerWidth) {
  const viewportLimit = Number.isFinite(Number(viewportWidth))
    ? Math.max(
      LAYOUT.inspectorMinWidth,
      Math.min(LAYOUT.inspectorMaxWidth, Math.floor(Number(viewportWidth) * 0.72)),
    )
    : LAYOUT.inspectorMaxWidth;
  const numericWidth = Number(width) || LAYOUT.inspectorPanelWidth;
  return Math.max(LAYOUT.inspectorMinWidth, Math.min(viewportLimit, numericWidth));
}

export function normalizeDesktopLayout(value = {}, viewportWidth = globalThis.innerWidth) {
  const source = value && typeof value === 'object' ? value : {};
  const legacyTab = source.activeInspectorTab === 'plan'
    ? 'activity'
    : source.activeInspectorTab === 'rag' ? 'history' : source.activeInspectorTab;
  return {
    activeInspectorTab: INSPECTOR_TABS.includes(legacyTab) ? legacyTab : 'activity',
    inspectorExpanded: Boolean(source.inspectorExpanded),
    inspectorPanelWidth: clampInspectorWidth(source.inspectorPanelWidth, viewportWidth),
    sidebarCollapsed: source.sidebarCollapsed === undefined
      ? true
      : Boolean(source.sidebarCollapsed),
  };
}

export function readDesktopLayout(storage = globalThis.localStorage, viewportWidth = globalThis.innerWidth) {
  if (!storage) {
    return normalizeDesktopLayout({}, viewportWidth);
  }
  try {
    return normalizeDesktopLayout(
      JSON.parse(storage.getItem(DESKTOP_LAYOUT_STORAGE_KEY) || '{}'),
      viewportWidth,
    );
  } catch {
    return normalizeDesktopLayout({}, viewportWidth);
  }
}

export function clampTerminalHeight(height) {
  const numeric = Number(height);
  if (!Number.isFinite(numeric)) {
    return TERMINAL_HEIGHT.default;
  }
  return Math.min(TERMINAL_HEIGHT.max, Math.max(TERMINAL_HEIGHT.min, numeric));
}

export function normalizeTerminalPanelLayout(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const closed = source.closed === true;
  return {
    activeTab: TERMINAL_TABS.includes(source.activeTab) ? source.activeTab : 'terminal',
    closed,
    height: clampTerminalHeight(source.height),
    open: closed ? false : source.open !== false,
  };
}

export function readTerminalPanelLayout(storage = globalThis.localStorage) {
  if (!storage) {
    return normalizeTerminalPanelLayout();
  }
  try {
    return normalizeTerminalPanelLayout(
      JSON.parse(storage.getItem(TERMINAL_PANEL_STORAGE_KEY) || '{}'),
    );
  } catch {
    return normalizeTerminalPanelLayout();
  }
}

export function isTerminalToggleShortcut(event) {
  const isBacktick = event?.key === '`' || event?.code === 'Backquote';
  return isBacktick && Boolean(event?.ctrlKey || event?.metaKey) && !event?.altKey;
}
