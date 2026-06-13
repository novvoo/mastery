/**
 * 状态栏组件
 * 显示应用状态、连接状态等信息
 */

import React from 'react';
import { getRuntimeStatusMeta } from '../runtime-status.js';

// 样式定义
const styles = {
  container: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: '32px',
    padding: '0 14px',
    backgroundColor: '#11161e',
    borderTop: '1px solid var(--border-subtle)'
  },
  
  leftSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: 'var(--text-muted)'
  },
  
  statusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%'
  },
  
  dotConnected: {
    backgroundColor: 'var(--success-color)'
  },
  
  dotDisconnected: {
    backgroundColor: 'var(--error-color)'
  },
  
  dotRunning: {
    backgroundColor: 'var(--warning-color)',
    animation: 'pulse 1s infinite'
  },
  
  dotIdle: {
    backgroundColor: 'var(--info-color)'
  },
  
  dotError: {
    backgroundColor: 'var(--error-color)'
  },

  dotCompleted: {
    backgroundColor: 'var(--info-color)'
  },

  dotWaiting: {
    backgroundColor: 'var(--warning-color)',
    animation: 'pulse 1s infinite'
  },
  
  statusText: {
    fontSize: '12px'
  },
  
  separator: {
    width: '1px',
    height: '16px',
    backgroundColor: 'var(--border-subtle)'
  },
  
  versionText: {
    fontSize: '11px',
    color: 'var(--text-dark)'
  }
};

/**
 * 状态栏组件
 * @param {Object} props - 组件属性
 * @param {string} props.status - Agent 状态
 * @param {string} props.workingDirectory - 工作目录
 * @param {number} props.toolCount - 工具数量
 * @param {boolean} props.isConnected - 是否已连接
 * @param {Object} props.stats - 统计信息
 */
function StatusBar({ status, workingDirectory, toolCount, isConnected, stats }) {
  // 获取状态点样式
  const getStatusDotStyle = () => {
    switch (status) {
      case 'running':
      case 'initializing':
        return { ...styles.statusDot, ...styles.dotRunning };
      case 'idle':
      case 'ready':
        return { ...styles.statusDot, ...styles.dotIdle };
      case 'error':
        return { ...styles.statusDot, ...styles.dotError };
      case 'completed':
        return { ...styles.statusDot, ...styles.dotCompleted };
      case 'needs_user_input':
        return { ...styles.statusDot, ...styles.dotWaiting };
      default:
        return styles.statusDot;
    }
  };
  
  // 获取连接状态点样式
  const getConnectDotStyle = () => {
    return isConnected 
      ? { ...styles.statusDot, ...styles.dotConnected }
      : { ...styles.statusDot, ...styles.dotDisconnected };
  };
  
  // 获取状态文本
  const getStatusText = () => {
    return getRuntimeStatusMeta(status).text;
  };
  
  // 格式化工作目录（显示最后两级）
  const formatWorkingDirectory = () => {
    if (!workingDirectory) return '未设置';
    
    const parts = workingDirectory.split('/');
    if (parts.length <= 2) return workingDirectory;
    
    return '...' + parts.slice(-2).join('/');
  };
  
  return (
    <div style={styles.container}>
      {/* 左侧状态 */}
      <div style={styles.leftSection}>
        {/* Agent 状态 */}
        <div style={styles.statusItem}>
          <div style={getStatusDotStyle()}></div>
          <span style={styles.statusText}>
            Agent: {getStatusText()}
          </span>
        </div>
        
        <div style={styles.separator}></div>
        
        {/* 连接状态 */}
        <div style={styles.statusItem}>
          <div style={getConnectDotStyle()}></div>
          <span style={styles.statusText}>
            IPC: {isConnected ? '已连接' : '未连接'}
          </span>
        </div>
        
        <div style={styles.separator}></div>
        
        {/* 工作目录 */}
        <div style={styles.statusItem}>
          <span style={styles.statusText}>
            {formatWorkingDirectory()}
          </span>
        </div>
        
        <div style={styles.separator}></div>
        
        {/* 工具数量 */}
        <div style={styles.statusItem}>
          <span style={styles.statusText}>
            {toolCount} 工具
          </span>
        </div>
      </div>
      
      {/* 右侧状态 */}
      <div style={styles.rightSection}>
        {/* 统计信息 */}
        {stats && (
          <>
            <div style={styles.statusItem}>
              <span style={styles.statusText}>
                消息: {stats.messageCount || 0}
              </span>
            </div>
            
            <div style={styles.separator}></div>
            
            <div style={styles.statusItem}>
              <span style={styles.statusText}>
                工具调用: {stats.toolCalls || 0}
              </span>
            </div>
          </>
        )}
        
        <div style={styles.separator}></div>
        
        {/* 版本信息 */}
        <div style={styles.statusItem}>
          <span style={styles.versionText}>
            v1.0.13
          </span>
        </div>
      </div>
      
      {/* CSS 动画 */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
}

export default StatusBar;
