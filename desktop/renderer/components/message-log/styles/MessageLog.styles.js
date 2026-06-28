export const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'visible',
    backgroundColor: 'transparent',
    border: 'none',
    boxShadow: 'none'
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: '42px',
    padding: '7px 10px',
    gap: '10px',
    flexWrap: 'wrap',
    borderBottom: 'none',
    backgroundColor: 'transparent'
  },
  
  title: {
    minHeight: '28px',
    padding: '0 2px',
    borderRadius: '999px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    boxShadow: 'none',
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em'
  },
  
  headerButtons: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    maxWidth: '100%',
    minHeight: '30px',
    padding: '2px',
    borderRadius: '999px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    backgroundColor: 'var(--glass-control-bg)',
    boxShadow: 'var(--glass-inner-hl)'
  },
  
  searchContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0
  },
  
  searchInput: {
    width: 'min(180px, 32vw)',
    minWidth: '120px',
    height: '28px',
    padding: '0 9px',
    borderRadius: '999px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    color: 'var(--text-color)',
    fontSize: '12px',
    transition: 'width 0.2s ease'
  },
  
  searchInputExpanded: {
    width: 'min(240px, 42vw)'
  },
  
  button: {
    height: '28px',
    padding: '0 9px',
    borderRadius: '999px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
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
    borderRadius: '999px',
    backgroundColor: 'var(--glass-control-bg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    flex: '0 0 auto'
  },
  
  viewButton: {
    width: '28px',
    height: '24px',
    padding: 0,
    borderRadius: '999px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s'
  },
  
  viewButtonActive: {
    backgroundColor: 'var(--glass-bg-strong)',
    color: 'var(--text-color)'
  },
  
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 8px 14px',
    scrollBehavior: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },

  runtimeDetailsPanel: {
    marginBottom: '12px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    overflow: 'visible',
    position: 'relative',
    zIndex: 2
  },

  runtimeDetailsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '42px',
    padding: '0 12px',
    borderBottom: '1px solid var(--glass-border)',
    borderRadius: '8px 8px 0 0',
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
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    color: 'var(--text-muted)',
    borderRadius: '6px',
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
    borderBottom: '1px solid var(--glass-border)'
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
    backgroundColor: 'var(--surface-subtle)',
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
    backgroundColor: 'var(--neutral-soft)',
  },

  runtimeDetailItemStatus: {
    border: 'none',
    backgroundColor: 'var(--primary-faint)'
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

  planCard: {
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    backgroundColor: 'var(--surface-subtle)',
    padding: '10px',
    color: 'var(--text-color)'
  },

  planCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px'
  },

  planIconBox: {
    backgroundColor: 'var(--neutral-soft)',
    color: 'var(--text-dark)'
  },

  planProgressBadge: {
    marginLeft: 'auto',
    fontSize: '12px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums'
  },

  planProgressTrack: {
    height: '5px',
    borderRadius: '999px',
    backgroundColor: 'var(--glass-bg-light)',
    overflow: 'hidden',
    marginBottom: '8px'
  },

  planProgressFill: {
    height: '100%',
    borderRadius: '999px',
    transition: 'width 0.2s ease'
  },

  planTaskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },

  planTaskRow: {
    display: 'grid',
    gridTemplateColumns: '12px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '8px',
    minHeight: '24px',
    fontSize: '12px',
    color: 'var(--text-muted)'
  },

  planTaskDot: {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'var(--glass-border)'
  },

  planTaskDotDone: {
    backgroundColor: 'var(--success-color)'
  },

  planTaskDotRunning: {
    backgroundColor: 'var(--warning-color)',
    boxShadow: '0 0 0 3px var(--warning-soft)'
  },

  planTaskDotFailed: {
    backgroundColor: 'var(--error-color)'
  },

  planTaskName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)'
  },

  planTaskStatus: {
    color: 'var(--text-muted)',
    fontSize: '11px'
  },

  activityPanel: {
    padding: '10px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-subtle)',
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
    backgroundColor: 'var(--surface-subtle)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 700
  },

  taskStageCompleted: {
    backgroundColor: 'var(--success-faint)',
    color: 'var(--text-color)'
  },

  taskStageRunning: {
    backgroundColor: 'var(--info-faint)',
    color: 'var(--text-color)'
  },

  taskStageWaiting: {
    backgroundColor: 'var(--warning-faint)',
    color: 'var(--text-color)'
  },

  taskStageFailed: {
    backgroundColor: 'var(--error-faint)',
    color: 'var(--text-color)'
  },

  taskStageMark: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--glass-border)',
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
    backgroundColor: 'var(--glass-bg-light)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)'
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
    backgroundColor: 'var(--glass-bg-light)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)'
  },

  activityItemCompleted: {
    backgroundColor: 'var(--success-faint)',
    borderColor: 'var(--success-soft)'
  },

  activityItemFailed: {
    backgroundColor: 'var(--error-faint)',
    borderColor: 'var(--error-soft)'
  },

  activityItemWaiting: {
    backgroundColor: 'var(--info-faint)',
    borderColor: 'var(--info-soft)'
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
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border-subtle)',
    backgroundColor: 'var(--border-subtle)',
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
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'var(--surface-color)',
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
    borderRadius: '16px',
    padding: '9px 12px',
    backgroundColor: 'var(--message-agent-bg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--message-agent-border)',
    boxShadow: 'var(--message-shadow)',
    color: 'var(--text-color)',
    maxWidth: '85%',
    lineHeight: '1.2'
  },

  messageBubbleUser: {
    backgroundColor: 'var(--message-user-bg)',
    borderColor: 'var(--message-user-border)',
    color: 'var(--message-user-text)',
    borderRadius: '16px',
    maxWidth: '80%',
    textAlign: 'center'
  },

  messageBubbleAgent: {
    borderRadius: '16px',
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
    padding: '2px 0',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '500',
    gap: '4px'
  },
  
  typeInfo: {
    backgroundColor: 'transparent',
    color: 'var(--info-color)',
    border: 'none'
  },
  
  typeSuccess: {
    backgroundColor: 'transparent',
    color: 'var(--success-color)',
    border: 'none'
  },
  
  typeError: {
    backgroundColor: 'transparent',
    color: 'var(--error-color)',
    border: 'none'
  },
  
  typeWarning: {
    backgroundColor: 'transparent',
    color: 'var(--warning-color)',
    border: 'none'
  },
  
  typeDebug: {
    backgroundColor: 'transparent',
    color: 'var(--text-dark)',
    border: 'none'
  },
  
  typeTool: {
    backgroundColor: 'transparent',
    color: 'var(--primary-color)',
    border: 'none'
  },
  
  typeEvent: {
    backgroundColor: 'transparent',
    color: 'var(--warning-color)',
    border: 'none'
  },
  
  typeResult: {
    backgroundColor: 'transparent',
    color: 'var(--info-color)',
    border: 'none'
  },
  
  typeUser: {
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    border: 'none'
  },

  typeAgent: {
    backgroundColor: 'transparent',
    color: 'var(--primary-color)',
    border: 'none'
  },

  typeThinking: {
    backgroundColor: 'transparent',
    color: 'var(--info-color)',
    border: 'none'
  },

  thinkingPanel: {
    margin: '0 0 10px 0',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--info-border)',
    backgroundColor: 'var(--info-faint)',
    overflow: 'visible'
  },

  thinkingHeader: {
    width: '100%',
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 10px',
    border: 'none',
    borderBottom: '1px solid var(--info-soft)',
    borderRadius: '8px 8px 0 0',
    backgroundColor: 'var(--info-faint)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700
  },

  thinkingTitle: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '7px'
  },

  thinkingPulse: {
    width: '24px',
    height: '18px',
    borderRadius: '5px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--info-soft)',
    color: 'var(--info-color)',
    fontSize: '10px',
    fontWeight: 800,
    flexShrink: 0
  },

  thinkingPulseRunning: {
    animation: 'thinkingPulse 1.2s ease-in-out infinite'
  },

  thinkingMeta: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '8px',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },

  thinkingSummaryText: {
    padding: '8px 10px',
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: 1.45,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },

  thinkingScroll: {
    maxHeight: '220px',
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    scrollBehavior: 'smooth'
  },

  thinkingStep: {
    padding: '8px',
    borderRadius: '6px',
    backgroundColor: 'var(--surface-subtle)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border-divider)'
  },

  thinkingStepHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '4px',
    color: 'var(--text-dark)',
    fontSize: '11px',
    fontWeight: 700
  },

  thinkingStepContent: {
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
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
    backgroundColor: 'var(--border-subtle)',
    border: 'none',
    borderRadius: '999px',
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  
  // 详情面板
  detailPanel: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: 'var(--surface-card)',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border-subtle)',
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
    background: 'var(--gradient-primary)'
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
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'var(--border-color)',
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
    backgroundColor: 'var(--border-card)',
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
    color: 'var(--text-on-success)',
    borderRadius: '4px',
    fontSize: '12px',
    boxShadow: 'var(--shadow-toast)',
    animation: 'fadeIn 0.2s ease-out',
    zIndex: 1000
  },

  // ─── 优雅 Action / 工具调用卡片 ───

  actionCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    borderRadius: '16px',
    backgroundColor: 'var(--message-tool-bg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--message-tool-border)',
    boxShadow: 'var(--message-shadow)',
    overflow: 'hidden',
    maxWidth: '85%'
  },

  actionCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '30px',
    paddingBottom: '8px',
    borderBottom: '1px solid var(--border-subtle)'
  },

  actionIconBox: {
    width: '28px',
    height: '28px',
    borderRadius: '999px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '15px',
    flexShrink: 0
  },

  actionIconBoxTool: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)'
  },

  actionIconBoxResult: {
    backgroundColor: 'var(--success-soft)',
    color: 'var(--success-color)'
  },

  actionIconBoxError: {
    backgroundColor: 'var(--error-soft)',
    color: 'var(--error-color)'
  },

  actionTitleWrap: {
    flex: 1,
    minWidth: 0
  },

  actionName: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text-color)',
    lineHeight: 1.3,
    marginBottom: '2px'
  },

  actionSubtitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: 400
  },

  actionDurationBadge: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--glass-bg-light)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--glass-border)',
    padding: '3px 8px',
    borderRadius: '999px',
    fontWeight: 500,
    flexShrink: 0
  },

  // 参数键值对列表
  actionArgs: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '12px',
    lineHeight: 1.55
  },

  actionArgRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '4px 0'
  },

  actionArgKey: {
    minWidth: '72px',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 500,
    flexShrink: 0,
    paddingTop: '1px'
  },

  actionArgValue: {
    color: 'var(--text-color)',
    fontSize: '12px',
    flex: 1,
    wordBreak: 'break-word',
    fontFamily: 'var(--font-mono)',
    minWidth: 0
  },

  actionArgValueString: {
    color: 'var(--info-color)'
  },

  actionArgValueNumber: {
    color: 'var(--warning-color)'
  },

  // 结果摘要区
  actionResultSummary: {
    fontSize: '12px',
    color: 'var(--text-dark)',
    lineHeight: 1.6,
    padding: '8px 10px',
    backgroundColor: 'var(--message-result-bg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--message-result-border)',
    borderRadius: '12px'
  },

  // 错误区
  actionErrorBody: {
    fontSize: '12px',
    color: 'var(--error-color)',
    lineHeight: 1.6,
    padding: '8px 10px',
    backgroundColor: 'var(--error-soft)',
    borderRadius: '6px',
    borderLeft: '3px solid var(--error-color)'
  },

  // 思考卡片（折叠式）
  thinkingCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
    borderRadius: '16px',
    backgroundColor: 'var(--info-faint)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--info-border)',
    fontSize: '13px',
    color: 'var(--text-dark)',
    lineHeight: 1.7
  },

  thinkingCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--info-color)',
    fontSize: '12px',
    fontWeight: 500
  },

  // Agent 普通文本气泡增强
  enhancedMessageBubble: {
    padding: '12px 14px',
    borderRadius: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--message-agent-border)',
    backgroundColor: 'var(--message-agent-bg)',
    boxShadow: 'var(--message-shadow)',
    fontSize: '14px',
    lineHeight: 1.7,
    maxWidth: '85%',
    minWidth: '120px'
  },

  enhancedMessageBubbleAgent: {
    borderRadius: '16px'
  },

  assistantMarkdownBubble: {
    width: 'min(760px, 88%)',
    maxWidth: '88%',
    backgroundColor: 'var(--message-agent-bg)',
    borderColor: 'var(--message-agent-border)',
    boxShadow: 'var(--message-shadow)',
  },

  enhancedMessageBubbleUser: {
    backgroundColor: 'var(--message-user-bg)',
    borderColor: 'var(--message-user-border)',
    color: 'var(--message-user-text)',
    borderRadius: '16px',
    textAlign: 'center'
  },

  emptyAssistantMessage: {
    minHeight: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--text-muted)',
    fontSize: '13px',
    fontWeight: 600
  },

  emptyAssistantDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--text-muted)',
    boxShadow: '0 0 0 4px var(--neutral-faint)'
  },

  streamingBubble: {
    width: 'min(760px, 88%)',
    minWidth: '220px',
    padding: '11px 13px',
    borderRadius: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--message-agent-border)',
    backgroundColor: 'var(--message-agent-bg)',
    boxShadow: 'var(--message-shadow)',
    fontSize: '14px',
    lineHeight: 1.68,
    animation: 'streamingEdge 1.8s ease-in-out infinite'
  },

  streamingBubbleActive: {
    backgroundColor: 'var(--message-agent-bg)',
    borderColor: 'var(--primary-border)'
  },

  streamingStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    marginBottom: '10px',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: 0
  },

  streamingStatusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--primary-color)',
    boxShadow: '0 0 0 4px var(--primary-faint)'
  },

  streamingDots: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    marginLeft: '1px'
  },

  streamingDot: {
    width: '3px',
    height: '3px',
    borderRadius: '50%',
    backgroundColor: 'var(--text-muted)',
    animation: 'streamingDot 1.1s ease-in-out infinite'
  },

  streamingSkeleton: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '2px 0 4px'
  },

  streamingSkeletonLine: {
    display: 'block',
    height: '9px',
    borderRadius: '999px',
    backgroundColor: 'var(--neutral-faint)',
    animation: 'streamingSkeleton 1.2s ease-in-out infinite'
  },

  // 分隔线
  subtleDivider: {
    height: '1px',
    backgroundColor: 'var(--border-subtle)',
    margin: '8px 0'
  },

  // 小型芯片样式
  smallChip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    fontSize: '11px',
    borderRadius: '6px',
    gap: '4px',
    fontWeight: 500
  }
};
