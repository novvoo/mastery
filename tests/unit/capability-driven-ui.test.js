import { describe, expect, test } from 'bun:test';
import {
  UI_CAPABILITY_BINDINGS,
  createBrowserCapabilityGraph,
  createCapabilityGraph,
} from '../../desktop/renderer/app/capabilities/capability-graph.js';

describe('capability-driven UI graph', () => {
  test('maps backend capabilities to stable UI surfaces', () => {
    const graph = createCapabilityGraph([
      { id: 'agent.runtime', status: 'available', version: 1 },
      { id: 'terminal.execute', status: 'degraded', version: 1, reason: 'recovering' },
      { id: 'preview.viewer', status: 'available', version: 1 },
      { id: 'preview.process', status: 'unavailable', version: 1 },
    ], [
      { channel: 'agent:processInput', schemaVersion: 1 },
    ]);

    expect(UI_CAPABILITY_BINDINGS.agent).toBe('agent.runtime');
    expect(graph.ui.agent.enabled).toBe(true);
    expect(graph.ui.terminal).toMatchObject({
      enabled: false,
      degraded: true,
      reason: 'recovering',
    });
    expect(graph.ui.preview.enabled).toBe(true);
    expect(graph.ui.previewProcess.enabled).toBe(false);
    expect(graph.hasContract('agent:processInput')).toBe(true);
  });

  test('fails closed for missing privileged capabilities', () => {
    const graph = createCapabilityGraph();
    expect(graph.ui.agent.enabled).toBe(false);
    expect(graph.ui.terminal.enabled).toBe(false);
    expect(graph.ui.models.enabled).toBe(false);
  });

  test('browser fallback only enables the local preview viewer', () => {
    const graph = createBrowserCapabilityGraph();
    expect(graph.ui.preview.enabled).toBe(true);
    expect(graph.ui.agent.enabled).toBe(false);
    expect(graph.ui.terminal.enabled).toBe(false);
  });
});
