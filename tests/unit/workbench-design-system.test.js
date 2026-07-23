import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const readRendererFile = (relativePath) => readFileSync(
  path.resolve(import.meta.dir, '../../desktop/renderer', relativePath),
  'utf8',
);

describe('workbench design system', () => {
  test('sidebar appearance is driven by semantic theme tokens', () => {
    const css = readRendererFile('index.css');
    const sidebar = readRendererFile('components/workbench/SidebarPanel.jsx');

    for (const token of [
      '--sidebar-bg',
      '--sidebar-header-bg',
      '--sidebar-text',
      '--sidebar-muted',
      '--sidebar-hover',
      '--sidebar-active',
      '--sidebar-border',
      '--sidebar-footer-bg',
    ]) {
      expect(css).toContain(`${token}:`);
      expect(css).toContain(`var(${token})`);
    }

    expect(sidebar).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sidebar).toContain('aria-current=');
    expect(sidebar).toContain('aria-label="搜索任务"');
  });

  test('settings behaves as an accessible modal tab surface', () => {
    const settings = readRendererFile('components/management/ManagementPage.jsx');

    expect(settings).toContain('role="dialog"');
    expect(settings).toContain('aria-modal="true"');
    expect(settings).toContain('role="tablist"');
    expect(settings).toContain('role="tabpanel"');
    expect(settings).toContain("event.key === 'Escape'");
    expect(settings).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  test('terminal exposes status and keyboard-resizable panel semantics', () => {
    const terminal = readRendererFile('components/workbench/BottomTerminalPanel.jsx');
    const css = readRendererFile('index.css');

    expect(terminal).toContain('role="separator"');
    expect(terminal).toContain('aria-valuenow={height}');
    expect(terminal).toContain("event.key === 'ArrowUp'");
    expect(terminal).toContain('TERMINAL_HEIGHT.keyboardLargeStep');
    expect(terminal).toContain('aria-controls={`terminal-panel-${tab.id}`}');
    expect(terminal).not.toContain('<style>');
    expect(terminal).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toContain('@keyframes termBlink');
    expect(css).toContain('--terminal-ansi-red:');
  });

  test('inspector exposes the same keyboard-resize contract', () => {
    const inspector = readRendererFile('components/workbench/InspectorPanel.jsx');
    const layoutHook = readRendererFile('hooks/useLayout.js');

    expect(inspector).toContain('role="separator"');
    expect(inspector).toContain('aria-valuenow={inspectorPanelWidth}');
    expect(inspector).toContain('onKeyDown={onResizeKeyDown}');
    expect(layoutHook).toContain("event.key === 'ArrowLeft'");
    expect(layoutHook).toContain('INSPECTOR_WIDTH.keyboardLargeStep');
    expect(layoutHook).toContain("window.addEventListener('resize'");
  });
});
