import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DESKTOP_LAYOUT_STORAGE_KEY,
  clampInspectorWidth,
  readDesktopLayout,
  readStoredInspectorTab,
} from '../app/session/session-storage.js';
import {
  TERMINAL_PANEL_STORAGE_KEY,
  readTerminalPanelLayout,
  clampTerminalHeight,
} from '../components/workbench/controls/WorkbenchControls.jsx';
import { LAYOUT } from '../app/config/index.js';

/**
 * 布局状态管理 — sidebar / inspector / terminal
 *
 * 包含: 状态声明、localStorage 持久化、resize 全局监听、terminal 快捷键
 */
export function useLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = readDesktopLayout().sidebarCollapsed;
    return stored === undefined ? true : Boolean(stored);
  });
  const [summaryPanelVisible, setSummaryPanelVisible] = useState(() => {
    const stored = readDesktopLayout().summaryPanelVisible;
    return stored === undefined ? false : Boolean(stored);
  });
  const [activeInspectorTab, setActiveInspectorTab] = useState(readStoredInspectorTab);
  const [inspectorPanelWidth, setInspectorPanelWidth] = useState(() =>
    clampInspectorWidth(readDesktopLayout().inspectorPanelWidth),
  );
  const [inspectorExpanded, setInspectorExpanded] = useState(() =>
    Boolean(readDesktopLayout().inspectorExpanded),
  );

  const [terminalClosed, setTerminalClosed] = useState(() =>
    Boolean(readTerminalPanelLayout().closed),
  );
  const [terminalOpen, setTerminalOpen] = useState(() => readTerminalPanelLayout().open !== false);
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(() =>
    clampTerminalHeight(readTerminalPanelLayout().height),
  );
  const [activeTerminalTab, setActiveTerminalTab] = useState(
    () => readTerminalPanelLayout().activeTab || 'terminal',
  );

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

  // ── Terminal 快捷键 (Ctrl/Cmd/Shift + `) ───────────────
  useEffect(() => {
    const handleTerminalShortcut = (event) => {
      const isBacktick = event.key === '`' || event.code === 'Backquote';
      if (!isBacktick || !(event.ctrlKey || event.metaKey || event.shiftKey)) return;
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
    inspectorExpanded,
    handleInspectorResizeStart,
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
