import React from 'react';
import { Button } from '../ui/index.js';
import { styles } from '../../app/styles.js';
import { t } from '../../i18n.js';

export function ActivityRail({
  activeTab,
  sidebarCollapsed,
  onShowAgent,
  onShowTools,
  onToggleSettings,
}) {
  return (
    <nav style={styles.activityRail} aria-label="workspace-nav">
      <Button
        variant="icon"
        size="md"
        onClick={onShowAgent}
        title="Agent"
        ariaLabel={t('inspector.agent_panel')}
        style={activeTab === 'agent' && !sidebarCollapsed ? styles.activityButtonActive : {}}
      >
        AG
      </Button>
      <Button
        variant="icon"
        size="md"
        onClick={onShowTools}
        title={t('inspector.tools_title')}
        ariaLabel={t('inspector.tools_panel')}
        style={activeTab === 'tools' && !sidebarCollapsed ? styles.activityButtonActive : {}}
      >
        TL
      </Button>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Button
          variant="icon"
          size="md"
          onClick={onToggleSettings}
          title={t('inspector.settings_title')}
          ariaLabel={t('inspector.settings_title')}
        >
          ⚙
        </Button>
      </div>
    </nav>
  );
}
