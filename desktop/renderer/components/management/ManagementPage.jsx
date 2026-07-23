/**
 * ManagementPage — 管理设置主页面
 *
 * 全屏覆盖层，左侧 Tab 导航 + 右侧内容区。
 * 包含：基本设置、模型管理、MCP管理 等模块。
 */
import React, { useEffect, useState } from 'react';
import { t, getI18n } from '../../i18n.js';
import ModelManagement from './ModelManagement.jsx';
import { styles } from '../../app/styles.js';
import { Icon } from '../ui/index.js';

const TABS = [
  { key: 'general', label: 'management.general', icon: 'settings' },
  { key: 'models', label: 'management.models', icon: 'agent' },
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

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') { onClose?.(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
        <h2 id="management-page-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{t('management.general')}</h2>
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
          <span style={styles.mgmtOptionCopy}>
            <strong>{t('ui.auto_save')}</strong>
            <small style={styles.mgmtOptionHint}>自动保存当前任务的会话状态</small>
          </span>
        </label>

        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="checkbox" checked={agentOptions.autoScroll !== false}
            onChange={(e) => setAgentOptions(p => ({ ...p, autoScroll: e.target.checked }))}
            style={styles.mgmtCheckbox} />
          <span style={styles.mgmtOptionCopy}>
            <strong>{t('ui.auto_scroll')}</strong>
            <small style={styles.mgmtOptionHint}>运行期间持续跟随最新输出</small>
          </span>
        </label>

      </div>

      {/* 语言 */}
      <div style={styles.mgmtSection}>
        <div style={styles.mgmtSectionTitle}>{t('ui.language')}</div>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'zh-CN'}
            onChange={() => handleLanguageChange('zh-CN')}
            style={styles.mgmtCheckbox} />
          <span style={styles.mgmtOptionCopy}><strong>{t('ui.language_zh')}</strong><small style={styles.mgmtOptionHint}>简体中文界面</small></span>
        </label>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'en'}
            onChange={() => handleLanguageChange('en')}
            style={styles.mgmtCheckbox} />
          <span style={styles.mgmtOptionCopy}><strong>{t('ui.language_en')}</strong><small style={styles.mgmtOptionHint}>English interface</small></span>
        </label>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'zh-TW'}
            onChange={() => handleLanguageChange('zh-TW')}
            style={styles.mgmtCheckbox} />
          <span style={styles.mgmtOptionCopy}><strong>{t('ui.language_tw')}</strong><small style={styles.mgmtOptionHint}>繁體中文介面</small></span>
        </label>
      </div>

      {/* 主题 */}
      <div style={styles.mgmtSection}>
        <div style={styles.mgmtSectionTitle}>{t('ui.theme')}</div>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="theme" checked={theme === 'light'}
            onChange={() => { if (theme !== 'light') { onToggleTheme?.(); } }}
            style={styles.mgmtCheckbox} />
          <span style={styles.mgmtOptionCopy}><strong>{t('ui.theme_light')}</strong><small style={styles.mgmtOptionHint}>适合明亮环境</small></span>
        </label>
        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="radio" name="theme" checked={theme === 'dark'}
            onChange={() => { if (theme !== 'dark') { onToggleTheme?.(); } }}
            style={styles.mgmtCheckbox} />
          <span style={styles.mgmtOptionCopy}><strong>{t('ui.theme_dark')}</strong><small style={styles.mgmtOptionHint}>降低暗光环境视觉负担</small></span>
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
    <div className="mastery-management-overlay" style={styles.managementOverlay} onClick={onClose}>
      <div
        className="mastery-management-dialog"
        style={styles.managementContainer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="management-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <nav className="mastery-management-nav" style={styles.managementSidebar} role="tablist" aria-label={t('management.title')}>
          <div style={styles.managementSidebarHeader}>
            <span id="management-dialog-title" style={{ fontWeight: 700, fontSize: '13px' }}>{t('management.title')}</span>
          </div>
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              style={{
                ...styles.managementTab,
                ...(activeTab === tab.key ? styles.managementTabActive : {}),
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon name={tab.icon} size={15} />
              <span>{t(tab.label)}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="mastery-management-content" style={styles.managementContent} role="tabpanel">
          {/* Close button */}
          <button
            style={styles.managementCloseBtn}
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <Icon name="close" size={15} />
          </button>
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}

export default ManagementPage;
