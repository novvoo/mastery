import React from 'react';
import { Button } from '../ui/index.js';
import { styles } from '../../app/styles.js';

export function ActivityRail({
  activeTab,
  sidebarCollapsed,
  onShowAgent,
  onShowTools,
  onToggleSettings,
}) {
  return (
    <nav style={styles.activityRail} aria-label="工作区导航">
      <Button
        variant="icon"
        size="md"
        onClick={onShowAgent}
        title="Agent"
        ariaLabel="Agent 面板"
        style={activeTab === 'agent' && !sidebarCollapsed ? styles.activityButtonActive : {}}
      >
        AG
      </Button>
      <Button
        variant="icon"
        size="md"
        onClick={onShowTools}
        title="工具"
        ariaLabel="工具面板"
        style={activeTab === 'tools' && !sidebarCollapsed ? styles.activityButtonActive : {}}
      >
        TL
      </Button>
      <Button
        variant="icon"
        size="md"
        onClick={onToggleSettings}
        title="设置"
        ariaLabel="设置"
        style={{ marginTop: 'auto' }}
      >
        ⚙
      </Button>
    </nav>
  );
}
