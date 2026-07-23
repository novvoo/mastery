import { describe, expect, test } from 'bun:test';
import { createUIErrorReport } from '../../desktop/renderer/components/chrome/UIErrorBoundary.jsx';

describe('UI error reporting', () => {
  test('normalizes render errors into a serializable diagnostic report', () => {
    const error = new TypeError('panel crashed');
    const report = createUIErrorReport(error, '\n  at InspectorPanel\n  at App');

    expect(report.name).toBe('TypeError');
    expect(report.message).toBe('panel crashed');
    expect(report.componentStack).toBe('at InspectorPanel\n  at App');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  test('handles non-Error throw values', () => {
    const report = createUIErrorReport('render failed');
    expect(report.name).toBe('Error');
    expect(report.message).toBe('render failed');
  });
});
