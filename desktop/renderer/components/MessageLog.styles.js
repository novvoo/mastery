export const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    border: 'none',
    boxShadow: 'none'
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: '32px',
    padding: '0 10px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'rgba(20, 20, 22, 0.76)'
  },
  
  title: {
    fontSize: '13px',
    fontWeight: '700',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  headerButtons: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  
  searchContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginRight: '8px'
  },
  
  searchInput: {
    width: '150px',
    height: '28px',
    padding: '0 9px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#101011',
    color: 'var(--text-color)',
    fontSize: '12px',
    transition: 'width 0.2s ease'
  },
  
  searchInputExpanded: {
    width: '200px'
  },
  
  button: {
    height: '28px',
    padding: '0 9px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'rgba(245, 240, 235, 0.055)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  
  buttonActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: 'none'
  },
  
  viewToggle: {
    display: 'flex',
    gap: '2px',
    padding: '2px',
    borderRadius: '7px',
    backgroundColor: '#101011',
    border: 'none'
  },
  
  viewButton: {
    padding: '4px 8px',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s'
  },
  
  viewButtonActive: {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)'
  },
  
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 8px 14px',
    scrollBehavior: 'smooth',
    display: 'flex',
    flexDirection: 'column'
  },

  runtimeDetailsPanel: {
    marginBottom: '12px',
    borderRadius: '8px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'rgba(16, 16, 17, 0.78)',
    overflow: 'hidden',
    position: 'relative',
    zIndex: 2
  },

  runtimeDetailsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '42px',
    padding: '0 12px',
    borderBottom: '1px solid var(--border-subtle)',
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontWeight: '600'
  },

  runtimeDetailsHeaderInteractive: {
    cursor: 'pointer',
    userSelect: 'none'
  },

  runtimeDetailsTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  runtimeDetailsActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  runtimeStatusChip: {
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-muted)',
    fontWeight: 500
  },

  runtimeDetailsToggle: {
    border: 'none',
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
    color: 'var(--text-muted)',
    borderRadius: '5px',
    width: '24px',
    height: '24px',
    padding: 0,
    cursor: 'pointer',
    fontSize: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  runtimeProgress: {
    padding: '8px 10px 10px',
    borderBottom: '1px solid var(--border-subtle)'
  },

  runtimeProgressText: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--text-muted)'
  },

  runtimeProgressLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  runtimeDetailsList: {
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    scrollBehavior: 'smooth'
  },

  runtimeDetailsListCollapsed: {
    maxHeight: '240px'
  },

  runtimeDetailsListExpanded: {
    maxHeight: 'min(65vh, 600px)'
  },

  runtimeDetailsListLarge: {
    maxHeight: 'min(85vh, 960px)'
  },

  runtimeDetailItem: {
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'rgba(245, 240, 235, 0.045)',
    padding: '8px',
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: '1.5'
  },

  runtimeDetailItemInteractive: {
    cursor: 'pointer'
  },

  runtimeDetailItemDebug: {
    border: 'none',
    backgroundColor: 'rgba(138, 133, 128, 0.08)'
  },

  runtimeDetailItemStatus: {
    border: 'none',
    backgroundColor: 'rgba(232, 120, 74, 0.06)'
  },

  runtimeDetailMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
    color: 'var(--text-dark)',
    fontSize: '11px'
  },

  runtimeDetailContent: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--text-muted)',
    transition: 'max-height 0.18s ease'
  },

  runtimeDetailContentCollapsed: {
    maxHeight: '42px',
    overflow: 'hidden'
  },

  runtimeDetailContentExpanded: {
    maxHeight: '300px',
    overflowY: 'auto'
  },

  activityPanel: {
    padding: '10px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'rgba(245, 240, 235, 0.025)'
  },

  activitySummaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
    color: 'var(--text-muted)',
    fontSize: '11px',
    flexWrap: 'wrap'
  },

  taskStageList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
    gap: '6px',
    marginBottom: '8px'
  },

  taskStageItem: {
    minWidth: 0,
    height: '30px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(245, 240, 235, 0.035)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 700
  },

  taskStageCompleted: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    color: 'var(--text-color)'
  },

  taskStageRunning: {
    backgroundColor: 'rgba(96, 165, 250, 0.08)',
    color: 'var(--text-color)'
  },

  taskStageWaiting: {
    backgroundColor: 'rgba(250, 204, 21, 0.08)',
    color: 'var(--text-color)'
  },

  taskStageFailed: {
    backgroundColor: 'rgba(248, 113, 113, 0.09)',
    color: 'var(--text-color)'
  },

  taskStageMark: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 240, 235, 0.08)',
    flexShrink: 0
  },

  taskStageLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  fileStatusList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    marginBottom: '8px'
  },

  fileStatusItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    minHeight: '28px',
    padding: '0 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(0, 0, 0, 0.14)'
  },

  fileStatusPath: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    fontSize: '12px',
    fontWeight: 600
  },

  fileStatusChip: {
    flexShrink: 0,
    color: 'var(--primary-color)',
    fontSize: '11px',
    fontWeight: 800
  },

  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },

  activityItem: {
    minHeight: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '6px',
    backgroundColor: 'rgba(245, 240, 235, 0.04)',
    border: '1px solid transparent'
  },

  activityItemCompleted: {
    backgroundColor: 'rgba(52, 211, 153, 0.065)',
    borderColor: 'rgba(52, 211, 153, 0.12)'
  },

  activityItemFailed: {
    backgroundColor: 'rgba(248, 113, 113, 0.075)',
    borderColor: 'rgba(248, 113, 113, 0.16)'
  },

  activityItemWaiting: {
    backgroundColor: 'rgba(96, 165, 250, 0.07)',
    borderColor: 'rgba(96, 165, 250, 0.16)'
  },

  activityMain: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '7px'
  },

  activityStatusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--primary-color)',
    flexShrink: 0
  },

  activityTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    fontSize: '12px',
    fontWeight: 600
  },

  activityActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0
  },

  activityActionButton: {
    height: '24px',
    padding: '0 8px',
    borderRadius: '5px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'rgba(245, 240, 235, 0.06)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 700
  },
  
  // 时间线视图样式
  timelineView: {
    position: 'relative',
    paddingLeft: '24px'
  },
  
  timelineLine: {
    position: 'absolute',
    left: '8px',
    top: '0',
    bottom: '0',
    width: '2px',
    backgroundColor: 'var(--border-subtle)'
  },
  
  timelineDot: {
    position: 'absolute',
    left: '4px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--primary-color)',
    border: '2px solid var(--surface-color)',
    transition: 'all 0.2s'
  },
  
  // 消息项外层容器
  messageItem: {
    marginBottom: '8px',
    display: 'flex',
    flexDirection: 'column',
    border: 'none',
    transition: 'all 0.2s ease',
    position: 'relative',
    cursor: 'pointer'
  },
  
  messageItemHover: {
    backgroundColor: 'transparent'
  },
  
  messageItemCollapsed: {
  },

  messageItemUser: {
    alignItems: 'flex-end'
  },

  messageItemAgent: {
    alignItems: 'flex-start'
  },

  // 消息气泡
  messageBubble: {
    borderRadius: '8px',
    padding: '10px 12px',
    backgroundColor: 'rgba(245, 240, 235, 0.055)',
    border: '1px solid rgba(245, 240, 235, 0.07)',
    maxWidth: '85%'
  },

  messageBubbleUser: {
    backgroundColor: 'rgba(232, 120, 74, 0.12)',
    borderColor: 'rgba(232, 120, 74, 0.22)',
    borderRadius: '8px 8px 3px 8px',
    maxWidth: '80%'
  },

  messageBubbleAgent: {
    borderRadius: '8px 8px 8px 3px',
    maxWidth: '85%'
  },

  messageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
    cursor: 'pointer'
  },
  
  messageType: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '500',
    gap: '4px'
  },
  
  typeInfo: {
    backgroundColor: 'rgba(157, 183, 212, 0.12)',
    color: 'var(--info-color)',
    border: 'none'
  },
  
  typeSuccess: {
    backgroundColor: 'rgba(93, 211, 158, 0.12)',
    color: 'var(--success-color)',
    border: 'none'
  },
  
  typeError: {
    backgroundColor: 'rgba(255, 107, 122, 0.12)',
    color: 'var(--error-color)',
    border: 'none'
  },
  
  typeWarning: {
    backgroundColor: 'rgba(246, 200, 95, 0.12)',
    color: 'var(--warning-color)',
    border: 'none'
  },
  
  typeDebug: {
    backgroundColor: 'rgba(138, 133, 128, 0.16)',
    color: 'var(--text-dark)',
    border: 'none'
  },
  
  typeTool: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: 'none'
  },
  
  typeEvent: {
    backgroundColor: 'rgba(255, 193, 7, 0.14)',
    color: 'var(--warning-color)',
    border: 'none'
  },
  
  typeResult: {
    backgroundColor: 'rgba(157, 183, 212, 0.12)',
    color: 'var(--info-color)',
    border: 'none'
  },
  
  typeUser: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    color: 'var(--text-color)',
    border: 'none'
  },

  typeAgent: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: 'none'
  },
  
  messageTime: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  messageContent: {
    fontSize: '13px',
    color: 'var(--text-color)',
    lineHeight: '1.45',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '400px',
    overflowY: 'auto',
    transition: 'max-height 0.3s ease'
  },
  
  messageContentCollapsed: {
    maxHeight: '40px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  
  messageMeta: {
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  
  messageActions: {
    display: 'flex',
    gap: '4px',
    marginTop: '8px',
    opacity: '0',
    transition: 'opacity 0.2s'
  },
  
  messageActionsVisible: {
    opacity: '1'
  },
  
  actionButton: {
    padding: '3px 7px',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s'
  },

  emptyChip: {
    padding: '5px 12px',
    backgroundColor: 'rgba(245, 240, 235, 0.06)',
    border: 'none',
    borderRadius: '999px',
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  
  // 详情面板
  detailPanel: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: '#101011',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    fontSize: '12px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  
  detailTitle: {
    color: 'var(--text-color)',
    fontWeight: '600',
    marginBottom: '8px'
  },
  
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    color: 'var(--text-muted)'
  },
  
  detailValue: {
    color: 'var(--text-color)',
    textAlign: 'right',
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  
  // 空状态
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '32px',
    background: 'linear-gradient(180deg, rgba(232, 120, 74, 0.06), transparent 44%)'
  },
  
  emptyIcon: {
    fontSize: '13px',
    marginBottom: '14px',
    opacity: '1',
    width: '42px',
    height: '42px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: 'none'
  },
  
  emptyText: {
    fontSize: '16px',
    marginBottom: '8px',
    color: 'var(--text-color)'
  },
  
  emptyHint: {
    fontSize: '13px',
    color: 'var(--text-dark)',
    maxWidth: '300px'
  },
  
  // 运行指示器
  spinner: {
    width: '14px',
    height: '14px',
    border: '2px solid var(--border-color)',
    borderTopColor: 'var(--warning-color)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  
  runningText: {
    fontSize: '14px',
    color: 'var(--warning-color)',
    fontWeight: '500'
  },
  
  progressBar: {
    width: '100%',
    height: '4px',
    backgroundColor: 'var(--border-color)',
    borderRadius: '2px',
    marginTop: '8px',
    overflow: 'hidden'
  },
  
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--warning-color)',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
    animation: 'progressPulse 1.5s ease-in-out infinite'
  },
  
  // 分组样式
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    backgroundColor: 'rgba(245, 240, 235, 0.07)',
    borderRadius: '4px',
    marginBottom: '4px',
    marginTop: '8px',
    cursor: 'pointer'
  },
  
  groupIcon: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  
  groupTitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: '500'
  },
  
  groupCount: {
    fontSize: '11px',
    color: 'var(--text-dark)'
  },
  
  // 复制成功提示
  copyToast: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '8px 16px',
    backgroundColor: 'var(--success-color)',
    color: '#141416',
    borderRadius: '4px',
    fontSize: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    animation: 'fadeIn 0.2s ease-out',
    zIndex: 1000
  }
};
