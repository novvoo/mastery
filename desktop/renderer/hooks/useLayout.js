import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  DESKTOP_LAYOUT_STORAGE_KEY,
  INSPECTOR_WIDTH,
  TERMINAL_PANEL_STORAGE_KEY,
  clampInspectorWidth,
  readTerminalPanelLayout,
  readDesktopLayout,
  clampTerminalHeight,
  isTerminalToggleShortcut,
  resolveWorkbenchLayoutMode,
} from '../app/layout/layout-state.js';
import { LAYOUT } from '../app/config/index.js';

/**
 * 布局状态管理 — sidebar / inspector / terminal
 *
 * 包含: 状态声明、localStorage 持久化、resize 全局监听、terminal 快捷键
 */
export function useLayout() {
  const initialDesktopLayoutRef = useRef(null);
  if (initialDesktopLayoutRef.current === null) {
    initialDesktopLayoutRef.current = readDesktopLayout();
  }
  const initialDesktopLayout = initialDesktopLayoutRef.current;

  const initialTerminalLayoutRef = useRef(null);
  if (initialTerminalLayoutRef.current === null) {
    initialTerminalLayoutRef.current = readTerminalPanelLayout();
  }
  const initialTerminalLayout = initialTerminalLayoutRef.current;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialDesktopLayout.sidebarCollapsed);
  const [summaryPanelVisible, setSummaryPanelVisible] = useState(() => {
    // The inspector is an on-demand drawer in the conversation-first layout.
    // Do not restore the legacy permanent-panel state across app launches.
    return false;
  });
  const [activeInspectorTab, setActiveInspectorTab] = useState(initialDesktopLayout.activeInspectorTab);
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(initialDesktopLayout.inspectorPanelWidth);
  const [inspectorExpanded, setInspectorExpanded] = useState(initialDesktopLayout.inspectorExpanded);
  const [viewportWidth, setViewportWidth] = useState(() => globalThis.innerWidth);

  const [terminalClosed, setTerminalClosed] = useState(initialTerminalLayout.closed);
  const [terminalOpen, setTerminalOpen] = useState(initialTerminalLayout.open);
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(() =>
    clampTerminalHeight(initialTerminalLayout.height),
  );
  const [activeTerminalTab, setActiveTerminalTab] = useState(initialTerminalLayout.activeTab);

  const inspectorResizeRef = useRef(null);

  // ── 持久化 ──────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(
      DESKTOP_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        sidebarCollapsed,
        summaryPanelVisible,
        activeInspectorTab,
        inspectorPanelWidth,
        inspectorExpanded,
      }),
    );
  }, [
    activeInspectorTab,
    inspectorExpanded,
    inspectorPanelWidth,
    sidebarCollapsed,
    summaryPanelVisible,
  ]);

  useEffect(() => {
    localStorage.setItem(
      TERMINAL_PANEL_STORAGE_KEY,
      JSON.stringify({
        activeTab: activeTerminalTab,
        closed: terminalClosed,
        height: terminalPanelHeight,
        open: terminalOpen,
      }),
    );
  }, [activeTerminalTab, terminalClosed, terminalOpen, terminalPanelHeight]);

  // ── Inspector resize 全局监听 ───────────────────────────
  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = inspectorResizeRef.current;
      if (!resizeState) return;
      const nextWidth = resizeState.startWidth + (resizeState.startX - event.clientX);
      setInspectorPanelWidth(clampInspectorWidth(nextWidth));
      setInspectorExpanded(false);
    };

    const handlePointerUp = () => {
      inspectorResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      const nextViewportWidth = globalThis.innerWidth;
      setViewportWidth(nextViewportWidth);
      setInspectorPanelWidth((width) => clampInspectorWidth(width, nextViewportWidth));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const workbenchLayoutMode = useMemo(() => resolveWorkbenchLayoutMode({
    viewportWidth,
    sidebarVisible: !sidebarCollapsed,
    inspectorVisible: summaryPanelVisible,
    inspectorWidth: inspectorPanelWidth,
  }), [
    inspectorPanelWidth,
    sidebarCollapsed,
    summaryPanelVisible,
    viewportWidth,
  ]);

  // ── Terminal 快捷键 (Ctrl/Cmd + `) ─────────────────────
  useEffect(() => {
    const handleTerminalShortcut = (event) => {
      if (!isTerminalToggleShortcut(event)) return;
      event.preventDefault();
      setTerminalClosed(false);
      setTerminalOpen((prev) => !prev);
      setActiveTerminalTab('terminal');
    };

    window.addEventListener('keydown', handleTerminalShortcut);
    return () => window.removeEventListener('keydown', handleTerminalShortcut);
  }, []);

  // ── 回调 ────────────────────────────────────────────────
  const handleTerminalOpenChange = useCallback((open) => {
    setTerminalClosed(false);
    setTerminalOpen(Boolean(open));
    if (open) setActiveTerminalTab('terminal');
  }, []);

  const toggleTerminalPanel = useCallback(() => {
    setTerminalClosed(false);
    setTerminalOpen((prev) => !prev);
    setActiveTerminalTab('terminal');
  }, []);

  const handleTerminalClose = useCallback(() => {
    setTerminalClosed(true);
    setTerminalOpen(false);
  }, []);

  const handleInspectorResizeStart = useCallback(
    (event) => {
      event.preventDefault();
      inspectorResizeRef.current = {
        startX: event.clientX,
        startWidth: inspectorPanelWidth,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [inspectorPanelWidth],
  );

  const handleInspectorResizeKeyDown = useCallback((event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? 1 : -1;
    const step = event.shiftKey
      ? INSPECTOR_WIDTH.keyboardLargeStep
      : INSPECTOR_WIDTH.keyboardStep;
    setInspectorPanelWidth((width) => clampInspectorWidth(width + direction * step));
    setInspectorExpanded(false);
  }, []);

  const handleInspectorExpandToggle = useCallback(() => {
    setInspectorPanelWidth((prev) => {
      if (inspectorExpanded) {
        return clampInspectorWidth(LAYOUT.inspectorPanelWidth);
      }
      return clampInspectorWidth(Math.max(prev, LAYOUT.inspectorExpandedWidth));
    });
    setInspectorExpanded((prev) => !prev);
    setSummaryPanelVisible(true);
  }, [inspectorExpanded]);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    summaryPanelVisible,
    setSummaryPanelVisible,
    activeInspectorTab,
    setActiveInspectorTab,
    inspectorPanelWidth,
    workbenchLayoutMode,
    inspectorExpanded,
    handleInspectorResizeStart,
    handleInspectorResizeKeyDown,
    handleInspectorExpandToggle,
    terminalClosed,
    terminalOpen,
    terminalPanelHeight,
    setTerminalPanelHeight,
    activeTerminalTab,
    setActiveTerminalTab,
    toggleTerminalPanel,
    handleTerminalOpenChange,
    handleTerminalClose,
  };
}
