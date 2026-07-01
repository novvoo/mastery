import React, { useMemo } from 'react';
import { LLM_PROVIDER_OPTIONS } from '../app/config/index.js';
import { styles } from '../app/styles.js';

export function LLMSetupModal({
  llmConfigStatus,
  llmForm,
  llmSetupError,
  llmSetupSaving,
  modelConfigs = [],
  onClose,
  onFormChange,
  onProviderChange,
  onSave,
}) {
  const formatEnvPath = (path) => {
    if (!path) {return '~/.config/mastery/.env';}
    return path.replace(/^\/Users\/[^/]+/, '~');
  };

  // 从 modelConfigs 中筛选当前 provider 的模型列表
  const currentProviderModels = useMemo(() => {
    const filtered = modelConfigs.filter(c => c.provider === llmForm.provider);
    // 如果有已保存的模型配置，使用它们；否则返回空数组（显示"请先在模型管理中添加"提示）
    return filtered.map(c => ({
      id: c.id,
      value: c.model,
      label: c.name || c.model,
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      enabled: c.enabled,
    }));
  }, [modelConfigs, llmForm.provider]);

  const currentProvider = LLM_PROVIDER_OPTIONS[llmForm.provider];

  // 当选择已保存的模型时，自动填充 apiKey 和 baseUrl
  const handleModelSelect = (modelValue) => {
    const selected = currentProviderModels.find(m => m.value === modelValue);
    if (selected) {
      // 选择已保存的模型：自动填充 model，可选填充 apiKey 和 baseUrl
      onFormChange('model', modelValue);
      if (selected.apiKey && !llmForm.apiKey) {
        onFormChange('apiKey', selected.apiKey);
      }
      if (selected.baseUrl) {
        onFormChange('baseUrl', selected.baseUrl);
      }
    } else {
      onFormChange('model', modelValue);
    }
  };

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>配置模型服务</h2>
          <p style={styles.modalSubtitle}>
            Desktop 需要 LLM 配置后才能执行智能任务。配置会保存到 CLI 共用的用户 .env 文件中。
          </p>
          {/* 当前激活状态显示 */}
          {llmConfigStatus?.configured && (
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 8,
              padding: '8px 12px',
              marginTop: 12,
              fontSize: 13,
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ 
                width: 8, 
                height: 8, 
                borderRadius: '50%', 
                background: '#22c55e',
                display: 'inline-block',
              }}></span>
              当前使用: <strong>{llmConfigStatus.provider}</strong> / <strong>{llmConfigStatus.model}</strong>
            </div>
          )}
        </div>

        <div style={styles.modalBody}>
          {/* 模型提供商 - 下拉选择 */}
          <div style={styles.formRow}>
            <label style={styles.formLabel}>模型提供商</label>
            <select
              style={styles.formInput}
              value={llmForm.provider}
              onChange={(event) => onProviderChange(event.target.value)}
              disabled={llmSetupSaving}
            >
              {Object.entries(LLM_PROVIDER_OPTIONS).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* 模型选择 - 从 models.json 已保存的配置中选择 */}
          <div style={styles.formRow}>
            <label style={styles.formLabel}>选择模型</label>
            {currentProviderModels.length > 0 ? (
              <div style={{ position: 'relative' }}>
                <select
                  style={{
                    ...styles.formInput,
                    cursor: 'pointer',
                    appearance: 'auto',
                  }}
                  value={currentProviderModels.some(m => m.value === llmForm.model) ? llmForm.model : '__custom__'}
                  onChange={(event) => {
                    if (event.target.value === '__custom__') {return;}
                    handleModelSelect(event.target.value);
                  }}
                  disabled={llmSetupSaving}
                >
                  {currentProviderModels.map((m) => (
                    <option key={m.id} value={m.value}>
                      {m.label} {m.enabled ? '(当前启用)' : ''}
                    </option>
                  ))}
                  <option value="__custom__">手动输入模型名称...</option>
                </select>
                {/* 自定义输入框 */}
                {!currentProviderModels.some(m => m.value === llmForm.model) && (
                  <input
                    style={{
                      ...styles.formInput,
                      marginTop: 6,
                      fontSize: 13,
                      borderColor: '#6366f1',
                    }}
                    value={llmForm.model}
                    onChange={(event) => onFormChange('model', event.target.value)}
                    placeholder="输入模型名称"
                    disabled={llmSetupSaving}
                  />
                )}
              </div>
            ) : (
              <div style={{
                ...styles.formInput,
                background: '#f9fafb',
                color: '#9ca3af',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>该提供商暂无已保存的模型</span>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); onClose(); }}
                  style={{ color: '#3b82f6', fontSize: 12, whiteSpace: 'nowrap' }}
                >
                  前往模型管理添加 →
                </a>
              </div>
            )}
          </div>

          {/* API Key */}
          <div style={styles.formRow}>
            <label style={styles.formLabel}>
              {currentProvider?.keyLabel || 'API Key'}
            </label>
            <input
              style={styles.formInput}
              type="password"
              value={llmForm.apiKey}
              onChange={(event) => onFormChange('apiKey', event.target.value)}
              placeholder={`输入 ${currentProvider?.keyLabel || 'API Key'}`}
              disabled={llmSetupSaving}
            />
          </div>

          {/* Base URL */}
          <div style={styles.formRow}>
            <label style={styles.formLabel}>Base URL</label>
            <input
              style={styles.formInput}
              value={llmForm.baseUrl}
              onChange={(event) => onFormChange('baseUrl', event.target.value)}
              placeholder={`可选（默认: ${currentProvider?.defaultBaseUrl || '空'}）`}
              disabled={llmSetupSaving}
            />
          </div>

          {llmSetupError && (
            <div style={styles.formError}>{llmSetupError}</div>
          )}
        </div>

        <div style={styles.modalFooter}>
          <div style={styles.formHint}>
            保存位置: {formatEnvPath(llmConfigStatus?.userEnvPath)}
          </div>
          <div style={styles.modalActions}>
            <button
              style={styles.textButton}
              onClick={onClose}
              disabled={llmSetupSaving}
            >
              稍后配置
            </button>
            <button
              style={styles.primaryAction}
              onClick={onSave}
              disabled={llmSetupSaving}
            >
              {llmSetupSaving ? '保存中...' : '保存并启用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
