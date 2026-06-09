/**
 * 工具栏组件
 * 提供快捷操作按钮和状态指示器
 */

import React from 'react';

// 样式定义
const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '44px',
    padding: '6px 14px',
    backgroundColor: '#141922',
    borderBottom: 'none'
  },
  
  leftSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  toolbarButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    height: '30px',
    padding: '0 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    transition: 'all 0.2s',
    position: 'relative'
  },
  
  toolbarButtonHover: {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)'
  },
  
  toolbarButtonActive: {
    backgroundColor: 'var(--primary-soft)',
    border: 'none',
    color: 'var(--primary-color)'
  },
  
  icon: {
    fontSize: '12px',
    color: 'var(--text-dark)'
  },
  
  badge: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '8px',
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    fontSize: '11px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  
  separator: {
    width: '1px',
    height: '20px',
    backgroundColor: 'var(--border-subtle)',
    margin: '0 6px'
  },
  
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    height: '26px',
    padding: '0 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '600',
    border: 'none'
  },
  
  statusReady: {
    backgroundColor: 'rgba(93, 211, 158, 0.12)',
    border: 'none',
    color: 'var(--success-color)'
  },
  
  statusRunning: {
    backgroundColor: 'rgba(246, 200, 95, 0.12)',
    border: 'none',
    color: 'var(--warning-color)'
  },
  
  statusError: {
    backgroundColor: 'rgba(255, 107, 122, 0.12)',
    border: 'none',
    color: 'var(--error-color)'
  }
};

/**
 * 工具栏组件
 * @param {Object} props - 组件属性
 * @param {string} props.status - 当前状态
 * @param {number} props.taskCount - 任务数量
 * @param {Function} props.onNewTask - 新建任务回调
 * @param {Function} props.onLoadTask - 加载任务回调
 * @param {Function} props.onSaveTask - 保存任务回调
 * @param {Function} props.onExport - 导出回调
 * @param {Function} props.onSettings - 设置回调
 * @param {Function} props.onHelp - 帮助回调
 */
function Toolbar({ 
  status, 
  taskCount = 0,
  onNewTask, 
  onLoadTask, 
  onSaveTask, 
  onExport, 
  onSettings, 
  onHelp 
}) {
  // 获取状态样式
  const getStatusStyle = () => {
    switch (status) {
      case 'running':
        return { ...styles.statusIndicator, ...styles.statusRunning };
      case 'error':
        return { ...styles.statusIndicator, ...styles.statusError };
      default:
        return { ...styles.statusIndicator, ...styles.statusReady };
    }
  };
  
  // 获取状态文本
  const getStatusText = () => {
    switch (status) {
      case 'running':
        return '运行中';
      case 'error':
        return '错误';
      default:
        return '就绪';
    }
  };
  
  // 渲染按钮
  const renderButton = ({ icon, label, onClick, badge, active }) => (
    <button
      style={{
        ...styles.toolbarButton,
        ...(active ? styles.toolbarButtonActive : {})
      }}
      onClick={onClick}
      title={label}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = active ? 'var(--primary-soft)' : 'var(--surface-hover)';
        e.currentTarget.style.color = active ? 'var(--primary-color)' : 'var(--text-color)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = active ? 'var(--primary-soft)' : 'transparent';
        e.currentTarget.style.color = active ? 'var(--primary-color)' : 'var(--text-muted)';
      }}
    >
      {icon && <span style={styles.icon}>{icon}</span>}
      <span>{label}</span>
      {badge > 0 && (
        <span style={styles.badge}>{badge}</span>
      )}
    </button>
  );
  
  return (
    <div style={styles.container}>
      {/* 左侧按钮 */}
      <div style={styles.leftSection}>
        {renderButton({
          icon: '+',
          label: '新建',
          onClick: onNewTask
        })}
        
        {renderButton({
          icon: '⌘',
          label: '打开',
          onClick: onLoadTask
        })}
        
        {renderButton({
          icon: 'S',
          label: '保存',
          onClick: onSaveTask
        })}
        
        <div style={styles.separator}></div>
        
        {renderButton({
          icon: '↗',
          label: '导出',
          onClick: onExport
        })}
        
        <div style={styles.separator}></div>
        
        {renderButton({
          icon: '',
          label: '设置',
          onClick: onSettings
        })}
        
        {renderButton({
          icon: '',
          label: '帮助',
          onClick: onHelp
        })}
      </div>
      
      {/* 右侧状态 */}
      <div style={styles.rightSection}>
        {/* 任务数量 */}
        {taskCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            color: 'var(--text-muted)'
          }}>
            <span>{taskCount} 任务</span>
          </div>
        )}
        
        {/* 状态指示器 */}
        <div style={getStatusStyle()}>
          {getStatusText()}
        </div>
      </div>
    </div>
  );
}

export default Toolbar;
