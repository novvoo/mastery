import React, { useEffect, useMemo, useState } from 'react';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function normalizeModel(model) {
  if (typeof model === 'string') {
    const [provider, ...rest] = model.includes('/') ? model.split('/') : [];
    return {
      id: rest.length > 0 ? rest.join('/') : model,
      label: model,
      provider: provider || 'openai',
    };
  }
  const id = model?.id || model?.modelId || model?.model || model?.name;
  return {
    id,
    label: model?.name || model?.label || id || '未知模型',
    provider: model?.provider || model?.providerId || 'openai',
  };
}

function currentModelLabel(model) {
  if (typeof model === 'string') return model;
  return model?.name || model?.label || model?.id || model?.modelId || model?.model || '选择模型';
}

export function RuntimeSelector({ runtime }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentModel = runtime.runtimeInfo?.model;
  const thinkingLevel = runtime.runtimeInfo?.thinkingLevel || 'medium';
  const disabled = runtime.status === 'running' || runtime.status === 'needs_user_input';
  const normalizedModels = useMemo(() => models.map(normalizeModel).filter((model) => model.id), [models]);

  useEffect(() => {
    if (!currentModel || models.length > 0) return;
    setModels([currentModel]);
  }, [currentModel, models.length]);

  const loadModels = async () => {
    if (disabled || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await runtime.getAvailableModels();
      setModels(result);
    } catch (cause) {
      setError(cause?.message || '模型列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const updateModel = async (model) => {
    setLoading(true);
    setError('');
    try {
      await runtime.setModel(model.provider, model.id);
    } catch (cause) {
      setError(cause?.message || '模型切换失败');
    } finally {
      setLoading(false);
    }
  };

  const updateThinking = async (level) => {
    setLoading(true);
    setError('');
    try {
      await runtime.setThinkingLevel(level);
    } catch (cause) {
      setError(cause?.message || '思考强度切换失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <details style={{ position: 'relative', marginLeft: 'auto' }} onToggle={(event) => event.currentTarget.open && loadModels()}>
      <summary
        aria-label="模型与思考强度"
        title={disabled ? '任务执行中不可切换模型' : '切换模型与思考强度'}
        style={{
          listStyle: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          pointerEvents: disabled ? 'none' : 'auto',
          padding: '4px 9px',
          borderRadius: '999px',
          background: 'var(--primary-soft)',
          border: '1px solid var(--primary-border)',
          color: 'var(--text-secondary)',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'none',
          letterSpacing: 0,
          opacity: disabled ? 0.55 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {currentModel ? currentModelLabel(currentModel) : '选择模型'} · {thinkingLevel}
      </summary>
      <div style={{
        position: 'absolute',
        zIndex: 30,
        top: '34px',
        right: 0,
        width: '260px',
        padding: '10px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-card)',
        boxShadow: 'var(--shadow-md)',
        textTransform: 'none',
        letterSpacing: 0,
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '1px 4px 6px' }}>模型</div>
        <div style={{ maxHeight: '190px', overflowY: 'auto', display: 'grid', gap: '3px' }}>
          {normalizedModels.map((model) => (
            <button
              key={`${model.provider}:${model.id}`}
              type="button"
              disabled={loading}
              onClick={() => updateModel(model)}
              style={{
                padding: '7px 8px',
                border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)',
                background: model.label === currentModelLabel(currentModel) ? 'var(--primary-soft)' : 'transparent',
                color: 'var(--text-color)',
                cursor: loading ? 'wait' : 'pointer',
                textAlign: 'left',
                fontSize: '12px',
              }}
            >
              {model.label}
              <span style={{ display: 'block', marginTop: '2px', color: 'var(--text-muted)', fontSize: '10px' }}>{model.provider}</span>
            </button>
          ))}
          {loading && normalizedModels.length === 0 && <span style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>正在读取模型…</span>}
        </div>
        <div style={{ height: '1px', background: 'var(--border-divider)', margin: '9px 0' }} />
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', margin: '1px 4px 6px' }}>思考强度</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {THINKING_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              disabled={loading}
              onClick={() => updateThinking(level)}
              style={{
                padding: '5px 7px',
                borderRadius: '999px',
                border: '1px solid var(--border-subtle)',
                background: level === thinkingLevel ? 'var(--primary-soft)' : 'var(--surface-raised)',
                color: level === thinkingLevel ? 'var(--primary-color)' : 'var(--text-secondary)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: '10px',
              }}
            >
              {level}
            </button>
          ))}
        </div>
        {error && <div role="alert" style={{ marginTop: '8px', color: 'var(--error-color)', fontSize: '11px' }}>{error}</div>}
      </div>
    </details>
  );
}
