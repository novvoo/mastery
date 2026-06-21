import React from 'react';
import { LLM_PROVIDER_OPTIONS } from '../app/config/index.js';
import { styles } from '../app/styles.js';

export function LLMSetupModal({
  llmConfigStatus,
  llmForm,
  llmSetupError,
  llmSetupSaving,
  onClose,
  onFormChange,
  onProviderChange,
  onSave,
}) {
  const formatEnvPath = (path) => {
    if (!path) return '~/.config/mastery/.env';
    return path.replace(/^\/Users\/[^/]+/, '~');
  };

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>配置模型服务</h2>
          <p style={styles.modalSubtitle}>
            Desktop 需要 LLM 配置后才能执行智能任务。配置会保存到 CLI 共用的用户 .env 文件中。
          </p>
        </div>

        <div style={styles.modalBody}>
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

          <div style={styles.formRow}>
            <label style={styles.formLabel}>
              {LLM_PROVIDER_OPTIONS[llmForm.provider]?.keyLabel || 'API Key'}
            </label>
            <input
              style={styles.formInput}
              type="password"
              value={llmForm.apiKey}
              onChange={(event) => onFormChange('apiKey', event.target.value)}
              placeholder="输入 API Key"
              disabled={llmSetupSaving}
            />
          </div>

          <div style={styles.formRow}>
            <label style={styles.formLabel}>模型名称</label>
            <input
              style={styles.formInput}
              value={llmForm.model}
              onChange={(event) => onFormChange('model', event.target.value)}
              placeholder={LLM_PROVIDER_OPTIONS[llmForm.provider]?.defaultModel}
              disabled={llmSetupSaving}
            />
          </div>

          <div style={styles.formRow}>
            <label style={styles.formLabel}>Base URL</label>
            <input
              style={styles.formInput}
              value={llmForm.baseUrl}
              onChange={(event) => onFormChange('baseUrl', event.target.value)}
              placeholder={LLM_PROVIDER_OPTIONS[llmForm.provider]?.defaultBaseUrl}
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
