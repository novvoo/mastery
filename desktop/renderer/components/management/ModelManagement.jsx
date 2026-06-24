/**
 * ModelManagement — 模型管理组件
 *
 * 按提供商分组展示模型配置，支持添加/编辑/删除/启用切换。
 * 每个提供商可配置多个模型实例。
 */
import React, { useState, useCallback } from 'react';
import Switch from '../ui/Switch.jsx';
import { LLM_PROVIDER_OPTIONS } from '../../app/config/index.js';
import { t } from '../../i18n.js';
import { styles } from '../../app/styles.js';

let _modelIdCounter = Date.now();

function generateModelId() {
  return `model_${++_modelIdCounter}`;
}

const PROVIDER_ORDER = ['openai', 'deepseek', 'zhipu', 'openrouter'];

function groupByProvider(configs) {
  const groups = {};
  for (const provider of PROVIDER_ORDER) {
    groups[provider] = [];
  }
  for (const config of configs || []) {
    const key = config.provider || 'openai';
    if (!groups[key]) groups[key] = [];
    groups[key].push(config);
  }
  return groups;
}

function getDefaultModelConfig(provider) {
  const option = LLM_PROVIDER_OPTIONS[provider] || LLM_PROVIDER_OPTIONS.openai;
  return {
    id: generateModelId(),
    provider,
    name: '',
    apiKey: '',
    model: option.defaultModel,
    baseUrl: option.defaultBaseUrl,
    enabled: false,
  };
}

export default function ModelManagement({
  modelConfigs = [],
  onAddModel,
  onUpdateModel,
  onDeleteModel,
  onToggleModel,
  toggleError = null,
  toggleSuccess = null,
}) {
  const [expandedProviders, setExpandedProviders] = useState(() => {
    const init = {};
    PROVIDER_ORDER.forEach(p => { init[p] = true; });
    return init;
  });
  const [editingId, setEditingId] = useState(null);

  const grouped = groupByProvider(modelConfigs);
  const activeModel = modelConfigs.find(c => c.enabled);

  const toggleProvider = useCallback((provider) => {
    setExpandedProviders(prev => ({ ...prev, [provider]: !prev[provider] }));
  }, []);

  const handleAdd = useCallback((provider) => {
    const newConfig = getDefaultModelConfig(provider);
    onAddModel && onAddModel(newConfig);
    setEditingId(newConfig.id);
  }, [onAddModel]);

  const handleSave = useCallback((id, config) => {
    onUpdateModel && onUpdateModel(id, config);
    setEditingId(null);
  }, [onUpdateModel]);

  const handleDelete = useCallback((id) => {
    onDeleteModel && onDeleteModel(id);
  }, [onDeleteModel]);

  const rowHover = {
    onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)',
    onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent',
  };

  return (
    <div style={styles.mgmtContentInner}>
      <div style={styles.mgmtContentHeader}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{t('management.models')}</h3>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
          {t('management.models_desc')}
        </p>
      </div>

      {activeModel && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '12px',
          backgroundColor: 'var(--success-soft)',
          borderRadius: '6px',
          border: '1px solid var(--success-color)',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--success-color)' }}>
            ✓ 当前激活模型: {activeModel.name || activeModel.provider} ({activeModel.model})
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            配置已同步到 CLI 共享的 .env 文件
          </div>
        </div>
      )}

      {toggleSuccess && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '12px',
          backgroundColor: 'var(--success-soft)',
          borderRadius: '6px',
          border: '1px solid var(--success-color)',
          animation: 'fadeIn 0.3s ease-in-out',
        }}>
          <div style={{ fontSize: '13px', color: 'var(--success-color)' }}>
            {toggleSuccess}
          </div>
        </div>
      )}

      {toggleError && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '12px',
          backgroundColor: 'var(--error-soft)',
          borderRadius: '6px',
          border: '1px solid var(--error-color)',
        }}>
          <div style={{ fontSize: '13px', color: 'var(--error-color)' }}>
            ⚠️ {toggleError}
          </div>
        </div>
      )}

      {PROVIDER_ORDER.map(provider => {
        const option = LLM_PROVIDER_OPTIONS[provider];
        const configs = grouped[provider] || [];
        const isExpanded = expandedProviders[provider];

        return (
          <div key={provider} style={styles.modelGroup}>
            {/* Provider header */}
            <button
              style={styles.modelGroupHeader}
              onClick={() => toggleProvider(provider)}
              {...rowHover}
            >
              <span style={{ fontSize: '14px', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>
                ▶
              </span>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>{option.label}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {configs.length} {t('management.model_config_count')}
              </span>
            </button>

            {/* Provider configs list */}
            {isExpanded && (
              <div style={styles.modelGroupBody}>
                {configs.length === 0 && (
                  <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    {t('management.no_models')}
                  </div>
                )}
                {configs.map(config => (
                  <ModelConfigCard
                    key={config.id}
                    config={config}
                    providerOption={option}
                    isEditing={editingId === config.id}
                    onEdit={() => setEditingId(config.id)}
                    onSave={(updated) => handleSave(config.id, updated)}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => handleDelete(config.id)}
                    onToggle={() => onToggleModel && onToggleModel(config.id)}
                    isActive={activeModel?.id === config.id}
                  />
                ))}
                <button
                  style={styles.modelAddBtn}
                  onClick={() => handleAdd(provider)}
                >
                  + {t('management.add_model')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * ModelConfigCard — 单个模型配置卡片
 */
function ModelConfigCard({
  config,
  providerOption,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onToggle,
  isActive = false,
}) {
  const [form, setForm] = useState({
    name: config.name,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveClick = () => {
    onSave(form);
  };

  const isConfigured = config.apiKey && config.model;

  return (
    <div style={{
      ...styles.modelCard,
      ...(isActive ? {
        border: '1px solid var(--success-color)',
        backgroundColor: 'var(--success-soft)',
      } : {})
    }}>
      {/* Header row: name + enabled switch + actions */}
      <div style={styles.modelCardHeader}>
        <div style={styles.modelCardInfo}>
          {isEditing ? (
            <input
              style={styles.modelNameInput}
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder={providerOption.label}
              autoFocus
            />
          ) : (
            <>
              <span style={{
                ...styles.modelCardName,
                ...(isActive ? { color: 'var(--success-color)', fontWeight: 700 } : {})
              }}>
                {config.name || providerOption.label}
                {isActive && ' ✓'}
              </span>
              <span style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                marginLeft: '8px',
              }}>
                {config.model}
              </span>
              {!isConfigured && (
                <span style={{
                  fontSize: '10px',
                  color: 'var(--warning-color)',
                  marginLeft: '6px',
                  padding: '1px 6px',
                  borderRadius: '3px',
                  backgroundColor: 'var(--warning-soft)',
                }}>
                  {t('management.not_configured')}
                </span>
              )}
            </>
          )}
        </div>

        <div style={styles.modelCardActions}>
          <Switch
            checked={config.enabled}
            onChange={onToggle}
            disabled={!isConfigured}
            ariaLabel={config.enabled ? t('management.disable') : t('management.enable')}
          />
          <span style={{
            fontSize: '10px',
            color: config.enabled ? 'var(--primary-color)' : 'var(--text-muted)',
            marginLeft: '4px',
            minWidth: '36px',
          }}>
            {config.enabled ? t('management.enabled') : t('management.disabled')}
          </span>

          {!isEditing && (
            <button style={styles.modelActionBtn} onClick={onEdit} title={t('common.edit')}>
              ✎
            </button>
          )}
          <button
            style={{ ...styles.modelActionBtn, color: 'var(--error-color)' }}
            onClick={onDelete}
            title={t('management.delete_model')}
            disabled={isActive}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Edit form */}
      {isEditing && (
        <div style={styles.modelForm}>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>{t('management.model_name_label')}</label>
            <input
              style={styles.formInput}
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder={providerOption.label}
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>{providerOption.keyLabel || 'API Key'}</label>
            <input
              style={styles.formInput}
              type="password"
              value={form.apiKey}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              placeholder={t('llm.api_key_placeholder')}
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>{t('management.model_field')}</label>
            <input
              style={styles.formInput}
              value={form.model}
              onChange={(e) => handleChange('model', e.target.value)}
              placeholder={providerOption.defaultModel}
            />
          </div>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>Base URL</label>
            <input
              style={styles.formInput}
              value={form.baseUrl}
              onChange={(e) => handleChange('baseUrl', e.target.value)}
              placeholder={providerOption.defaultBaseUrl}
            />
          </div>
          <div style={styles.modelFormActions}>
            <button style={styles.textButton} onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button style={styles.primaryAction} onClick={handleSaveClick}>
              {t('common.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
