/**
 * ManagementPage — 管理设置主页面
 *
 * 全屏覆盖层，左侧 Tab 导航 + 右侧内容区。
 * 包含：基本设置、模型管理、MCP管理 等模块。
 */
import React, { useState } from 'react';
import { t, getI18n, SupportedLanguages } from '../../i18n.js';
import ModelManagement from './ModelManagement.jsx';
import { styles } from '../../app/styles.js';

const TABS = [
  { key: 'general', label: 'management.general' },
  { key: 'models', label: 'management.models' },
];

export function ManagementPage({
  agentOptions,
  setAgentOptions,
  theme,
  onToggleTheme,
  language,
  onChangeLanguage,
  modelConfigs,
  onAddModel,
  onUpdateModel,
  onDeleteModel,
  onToggleModel,
  toggleError = null,
  toggleSuccess = null,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('general');
  const i18n = getI18n();
  const currentLang = language || i18n.getLanguage();

  const handleLanguageChange = (lang) => {
    onChangeLanguage && onChangeLanguage(lang);
  };

  const rowHover = {
    onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)',
    onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent',
  };

  const renderGeneralSettings = () => (
    <div style={styles.mgmtContentInner}>
      <div style={styles.mgmtContentHeader}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{t('management.general')}</h3>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
          {t('management.general_desc')}
        </p>
      </div>

      {/* 基本 Agent 选项 */}
      <div style={styles.mgmtSection}>
        <div style={styles.mgmtSectionTitle}>对话体验</div>

        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="checkbox" checked={agentOptions.autoSave}
            onChange={(e) => setAgentOptions(p => ({ ...p, autoSave: e.target.checked }))}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.auto_save')}</span>
        </label>

        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="checkbox" checked={agentOptions.autoScroll !== false}
            onChange={(e) => setAgentOptions(p => ({ ...p, autoScroll: e.target.checked }))}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.auto_scroll')}</span>
        </label>

      </div>

      {/* 语言 */}
      <div style={styles.mgmtSection}>
        <div style={styles.mgmtSectionTitle}>{t('ui.language')}</div>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'zh-CN'}
            onChange={() => handleLanguageChange('zh-CN')}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.language_zh')}</span>
        </label>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'en'}
            onChange={() => handleLanguageChange('en')}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.language_en')}</span>
        </label>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'zh-TW'}
            onChange={() => handleLanguageChange('zh-TW')}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.language_tw')}</span>
        </label>
      </div>

      {/* 主题 */}
      <div style={styles.mgmtSection}>
        <div style={styles.mgmtSectionTitle}>{t('ui.theme')}</div>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="theme" checked={theme === 'light'}
            onChange={onToggleTheme}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.theme_light')}</span>
        </label>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="theme" checked={theme === 'dark'}
            onChange={onToggleTheme}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.theme_dark')}</span>
        </label>
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'models':
        return (
          <ModelManagement
            modelConfigs={modelConfigs}
            onAddModel={onAddModel}
            onUpdateModel={onUpdateModel}
            onDeleteModel={onDeleteModel}
            onToggleModel={onToggleModel}
            toggleError={toggleError}
            toggleSuccess={toggleSuccess}
          />
        );
      case 'general':
      default:
        return renderGeneralSettings();
    }
  };

  return (
    <div style={styles.managementOverlay} onClick={onClose}>
      <div style={styles.managementContainer} onClick={(e) => e.stopPropagation()}>
        {/* Sidebar */}
        <nav style={styles.managementSidebar}>
          <div style={styles.managementSidebarHeader}>
            <span style={{ fontWeight: 700, fontSize: '13px' }}>{t('management.title')}</span>
          </div>
          {TABS.map(tab => (
            <button
              key={tab.key}
              style={{
                ...styles.managementTab,
                ...(activeTab === tab.key ? styles.managementTabActive : {}),
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              <span>{t(tab.label)}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div style={styles.managementContent}>
          {/* Close button */}
          <button
            style={styles.managementCloseBtn}
            onClick={onClose}
            title={t('common.close')}
          >
            ✕
          </button>
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}

export default ManagementPage;
