import React from 'react';
import { Badge, Button } from '../ui/index.js';
import { styles } from '../../app/styles.js';

export function TopBar({
  platformInfo,
  windowState,
  runtimeStatusMeta,
  sidebarCollapsed,
  onToggleSidebar,
  onMinimize,
  onMaximize,
  onClose,
}) {
  const shouldReserveMacTrafficLightSpace = platformInfo?.isMac
    && !windowState.isFullScreen
    && !windowState.isMaximized;

  // 阻止 drag 事件冒泡到 React，避免 React DOM 开发版中
  // "ReferenceError: dragEvent is not defined" 错误
  const suppressDragEvents = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <header
      onDragStart={suppressDragEvents}
      onDragOver={suppressDragEvents}
      onDragEnd={suppressDragEvents}
      style={{
        ...styles.menuBar,
        paddingLeft: shouldReserveMacTrafficLightSpace ? '86px' : 'var(--spacing-md)',
        WebkitAppRegion: 'drag'
      }
    }>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', WebkitAppRegion: 'no-drag' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          ariaLabel={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {sidebarCollapsed ? '☰' : '×'}
        </Button>
      </div>

      <div style={styles.topBarBrand}>
        <div style={styles.brandMark}>AI</div>
        <div style={styles.brandText}>
          <span style={styles.brandTitle}>Engineering Agent</span>
          <span style={styles.brandSubtitle}>Desktop Workbench</span>
        </div>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', WebkitAppRegion: 'no-drag' }}>
        <Badge variant={runtimeStatusMeta.badgeVariant} size="md">
          <span>{runtimeStatusMeta.icon}</span>
          <span>{runtimeStatusMeta.text}</span>
        </Badge>

        {!platformInfo?.isMac && (
          <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginLeft: 'var(--spacing-sm)' }}>
            <Button variant="ghost" size="sm" onClick={onMinimize} title="最小化">−</Button>
            <Button variant="ghost" size="sm" onClick={onMaximize} title={windowState.isMaximized ? '还原' : '最大化'}>
              {windowState.isMaximized ? '❐' : '□'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} title="关闭" style={{ color: 'var(--error-color)' }}>×</Button>
          </div>
        )}
      </div>
    </header>
  );
}
