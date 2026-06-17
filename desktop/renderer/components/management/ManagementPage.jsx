/**
 * ManagementPage — 管理设置主页面
 *
 * 全屏覆盖层，左侧 Tab 导航 + 右侧内容区。
 * 包含：基本设置、模型管理、MCP管理 等模块。
 */
import React, { useState } from 'react';
import { t, getI18n, SupportedLanguages } from '../../i18n.js';
import ModelManagement from './ModelManagement.jsx';
import McpManagement from './McpManagement.jsx';
import { styles } from '../../app/styles.js';

const TABS = [
  { key: 'general', label: 'management.general', icon: '⚙' },
  { key: 'models', label: 'management.models', icon: '🤖' },
  { key: 'mcp', label: 'management.mcp', icon: '🔌' },
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
  mcpServers,
  onAddMcpServer,
  onDeleteMcpServer,
  onToggleMcpServer,
  onConnectMcpServer,
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
        <div style={styles.mgmtSectionTitle}>{t('ui.root')}</div>

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

        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="checkbox" checked={agentOptions.debug || false}
            onChange={(e) => setAgentOptions(p => ({ ...p, debug: e.target.checked }))}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.developer_mode')}</span>
        </label>

        <label style={styles.mgmtCheckboxRow} {...rowHover}>
          <input type="checkbox" checked={agentOptions.verbose || false}
            onChange={(e) => setAgentOptions(p => ({ ...p, verbose: e.target.checked }))}
            style={styles.mgmtCheckbox} />
          <span>{t('ui.verbose_logging')}</span>
        </label>
      </div>

      {/* 最大迭代 */}
      <div style={styles.mgmtSection}>
        <div style={styles.mgmtSectionTitle}>{t('ui.max_iterations')}</div>
        <div style={{ padding: '8px 12px' }}>
          <input type="number" value={agentOptions.maxIterations}
            onChange={(e) => setAgentOptions(p => ({ ...p, maxIterations: parseInt(e.target.value) || 60 }))}
            style={styles.formInput}
            min={1} max={500} />
        </div>
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
          />
        );
      case 'mcp':
        return (
          <McpManagement
            mcpServers={mcpServers}
            onAddServer={onAddMcpServer}
            onDeleteServer={onDeleteMcpServer}
            onToggleServer={onToggleMcpServer}
            onConnectServer={onConnectMcpServer}
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
            <span style={{ fontSize: '14px' }}>⚙</span>
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
              <span style={{ fontSize: '14px' }}>{tab.icon}</span>
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
