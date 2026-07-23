import React from 'react';

export function CapabilityStatusBar({ capabilityState }) {
  const { graph, status, error } = capabilityState;
  const runtime = graph.ui.agent;
  const primaryCapabilities = new Set([
    'agent.runtime',
    'workspace.files',
    'session.store',
    'terminal.execute',
    'model.config',
    'policy.engine',
  ]);
  const unavailable = graph.manifest.filter(
    (item) => item.status === 'unavailable' && primaryCapabilities.has(item.id),
  );
  const degraded = graph.manifest.filter((item) => item.status === 'degraded');

  if (status === 'idle' || (status === 'ready' && unavailable.length === 0 && degraded.length === 0)) {
    return null;
  }

  const tone = error || runtime?.status === 'unavailable' ? 'error' : 'warning';
  const runtimeLabel = runtime?.status === 'degraded'
    ? '正在恢复'
    : runtime?.status === 'unavailable'
      ? '不可用'
      : '可用';
  const summary = error
    ? '能力清单读取失败，特权功能已按最小权限降级'
    : `Runtime ${runtimeLabel} · ${degraded.length} 项降级 · ${unavailable.length} 项不可用`;

  return (
    <div
      className={`capability-status-bar capability-status-bar--${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className="capability-status-bar__signal" aria-hidden="true" />
      <span>{summary}</span>
      {unavailable.length > 0 && (
        <span className="capability-status-bar__detail">
          {unavailable.map((item) => item.id).join(' · ')}
        </span>
      )}
    </div>
  );
}
