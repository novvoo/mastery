import { LAYOUT } from './config.js';

export const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--window-tint)',
    color: 'var(--text-color)',
    fontFamily: 'var(--font-family)',
    overflow: 'hidden',
    position: 'relative'
  },
  
  menuItem: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    height: '32px',
    padding: '0 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'all 0.15s'
  },
  
  menuItemHover: {
    backgroundColor: 'var(--glass-bg-light)',
    color: 'var(--text-color)'
  },
  
  menuItemActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)'
  },
  
  menuDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    minWidth: '200px',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--glass-border)',
    borderRadius: '10px',
    boxShadow: 'var(--glass-shadow-lg)',
    padding: '6px 0',
    zIndex: 1000
  },
  
  menuDropdownItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
    transition: 'all var(--transition-fast)'
  },
  
  menuDropdownShortcut: {
    fontSize: '11px',
    color: 'var(--text-dark)',
    fontFamily: 'monospace'
  },
  
  menuDivider: {
    height: '1px',
    backgroundColor: 'var(--glass-border)',
    margin: '6px 0'
  },
  
  menuSectionTitle: {
    padding: '6px 14px',
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-dark)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  
  // ================== 主内容区 ==================
  mainContentWrapper: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    padding: '40px 12px 32px',
    gap: '10px',
    position: 'relative',
    borderRadius: '20px',
  },

  activityRail: {
    width: `${LAYOUT.activityRailWidth}px`,
    flexShrink: 0,
    backgroundColor: 'var(--glass-control-bg)',
    backdropFilter: 'blur(18px) saturate(170%)',
    WebkitBackdropFilter: 'blur(18px) saturate(170%)',
    border: '1px solid var(--glass-border-strong)',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '10px 6px',
    gap: '6px',
    boxShadow: 'var(--glass-shadow), var(--glass-inner-hl)',
    position: 'relative',
    zIndex: 1,
  },

  activityButton: {
    width: '38px',
    height: '38px',
    borderRadius: '8px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-dark)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'all var(--transition-fast)'
  },

  activityButtonActive: {
    backgroundColor: 'var(--primary-soft)',
    border: '1px solid var(--primary-strong)',
    color: 'var(--primary-color)',
    boxShadow: 'var(--shadow-inset)'
  },
  
  // ================== 左侧工具面板 ==================
  leftSidebar: {
    width: `${LAYOUT.sidebarWidth}px`,
    backgroundColor: 'var(--glass-control-bg)',
    backdropFilter: 'blur(16px) saturate(160%)',
    WebkitBackdropFilter: 'blur(16px) saturate(160%)',
    borderRight: '1px solid var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width var(--transition-normal)',
    boxShadow: 'var(--glass-shadow)',
    position: 'relative',
    zIndex: 1,
  },

  sidebarHeader: {
    minHeight: '46px',
    padding: '8px var(--spacing-md)',
    borderBottom: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-sm)',
    backgroundColor: 'transparent',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    boxShadow: 'none'
  },

  sidebarTitle: {
    minHeight: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 12px',
    borderRadius: '999px',
    border: '1px solid var(--title-capsule-border)',
    backgroundColor: 'var(--title-capsule-bg)',
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    boxShadow: 'var(--glass-inner-hl)'
  },
  
  // ================== 右侧 Inspector 面板 ==================
  summaryPanel: {
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(16px) saturate(160%)',
    WebkitBackdropFilter: 'blur(16px) saturate(160%)',
    borderLeft: '1px solid var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: 'var(--glass-shadow)',
    zIndex: 1,
  },

  inspectorResizeHandle: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '6px',
    cursor: 'col-resize',
    zIndex: 2,
    backgroundColor: 'transparent'
  },

  inspectorHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderBottom: 'none',
    backgroundColor: 'transparent',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    boxShadow: 'none'
  },

  previewHeader: {
    minHeight: '44px',
    padding: '8px 10px',
    borderBottom: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'transparent'
  },

  inspectorTabs: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
    gap: '4px',
    minWidth: 0,
    padding: '2px',
    borderRadius: '999px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-control-bg)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  inspectorTab: {
    height: '30px',
    borderRadius: '999px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    transition: 'all var(--transition-fast)'
  },

  inspectorTabActive: {
    backgroundColor: 'var(--glass-bg-strong)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-color)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  iconButton: {
    width: '30px',
    height: '30px',
    borderRadius: '999px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flex: '0 0 auto',
    transition: 'all var(--transition-fast)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  previewFrame: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    border: 'none',
    backgroundColor: 'var(--background-color)'
  },
  
  summarySection: {
    padding: '14px',
    borderBottom: 'none'
  },
  
  summarySectionTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    marginBottom: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  
  summaryItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: '8px',
    backgroundColor: 'var(--glass-bg-light)',
    border: '1px solid var(--glass-border)',
    marginBottom: '6px',
    fontSize: '12px'
  },
  
  summaryItemIcon: {
    fontSize: '12px',
    flexShrink: 0,
    marginTop: '2px'
  },
  
  summaryItemText: {
    flex: 1,
    color: 'var(--text-color)',
    lineHeight: 1.4
  },
  
  summaryItemEmpty: {
    color: 'var(--text-dark)',
    fontStyle: 'italic'
  },

  inspectorHelpText: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginBottom: '10px',
    lineHeight: 1.5
  },

  inspectorDocumentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '9px 10px',
    borderRadius: '8px',
    backgroundColor: 'var(--glass-bg-light)',
    marginBottom: '6px',
    fontSize: '12px',
    border: '1px solid var(--glass-border)'
  },

  inspectorDocumentName: {
    fontSize: '13px',
    color: 'var(--text-color)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  inspectorDocumentPath: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  inspectorKicker: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-muted)'
  },

  previewUrlLine: {
    fontSize: '11px',
    color: 'var(--text-dark)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  previewUrlLink: {
    color: 'var(--primary-color)',
    textDecoration: 'none',
    cursor: 'pointer',
    fontSize: '11px'
  },

  previewUrlForm: {
    display: 'flex',
    gap: '8px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--glass-border)'
  },

  previewUrlInput: {
    flex: 1,
    minWidth: 0,
    height: '32px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-color)',
    padding: '0 10px',
    fontSize: '12px',
    boxShadow: 'var(--glass-inner-hl)'
  },

  previewPipeline: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--glass-border)',
    display: 'flex',
    gap: '6px',
    overflowX: 'auto'
  },

  previewPipelineStage: {
    flex: '0 0 auto',
    maxWidth: '180px',
    padding: '5px 10px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(6px) saturate(130%)',
    WebkitBackdropFilter: 'blur(6px) saturate(130%)',
    boxShadow: 'var(--glass-inner-hl)',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },

  button: {
    height: '32px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'all var(--transition-fast)',
    boxShadow: 'var(--glass-inner-hl)'
  },
  
  // ================== 聊天区域 ==================
  chatAreaWrapper: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    backgroundColor: 'var(--surface-base)',
    borderRadius: '20px',
    overflow: 'hidden',
  },

  chatArea: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: '20px',
  },
  
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px var(--spacing-xl) 8px',
    borderBottom: 'none',
    backgroundColor: 'transparent',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    boxShadow: 'none'
  },
  
  chatTitle: {
    minHeight: '32px',
    padding: '2px 12px 2px 4px',
    borderRadius: '999px',
    border: '1px solid var(--title-capsule-border)',
    backgroundColor: 'var(--title-capsule-bg)',
    boxShadow: 'var(--glass-inner-hl)',
    fontSize: '13px',
    fontWeight: '700',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },

  chatTitleMark: {
    width: '26px',
    height: '26px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(145deg, var(--primary-strong), var(--primary-faint))',
    color: 'var(--text-color)',
    border: '1px solid var(--primary-border)',
    fontSize: '10px',
    fontWeight: 800
  },

  chatMessageCount: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text-muted)',
    marginLeft: '8px',
    textTransform: 'none',
    letterSpacing: 0
  },

  chatHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '32px',
    padding: '2px',
    borderRadius: '999px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-control-bg)',
    boxShadow: 'var(--glass-inner-hl)'
  },
  
  chatStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: '500',
    border: 'none'
  },
  
  statusReady: {
    backgroundColor: 'var(--success-soft)',
    border: 'none',
    color: 'var(--success-color)'
  },
  
  statusRunning: {
    backgroundColor: 'var(--warning-soft)',
    border: 'none',
    color: 'var(--warning-color)'
  },
  
  // ================== 消息列表 ==================
  messageContainer: {
    flex: 1,
    minHeight: 0,
    overflow: 'visible',
    padding: '10px 14px 12px',
  },
  
  // ================== 输入区域 ==================
  inputArea: {
    margin: '0 var(--spacing-xl) 16px',
    padding: '12px',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid var(--glass-border-strong)',
    borderRadius: '18px',
    boxShadow: 'var(--glass-shadow), var(--glass-inner-hl)'
  },

  interactionConsole: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '10px',
    padding: '8px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  interactionStages: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '6px'
  },

  interactionStage: {
    minWidth: 0,
    minHeight: '34px',
    display: 'grid',
    gridTemplateColumns: '8px minmax(0, auto) minmax(0, 1fr)',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--neutral-faint)',
    color: 'var(--text-muted)',
    transition: 'all var(--transition-fast)'
  },

  interactionStageActive: {
    border: '1px solid var(--warning-strong)',
    backgroundColor: 'var(--warning-faint)',
    color: 'var(--warning-color)'
  },

  interactionStageDone: {
    border: '1px solid var(--primary-border)',
    backgroundColor: 'var(--success-faint)',
    color: 'var(--success-color)'
  },

  interactionStageAttention: {
    border: '1px solid var(--warning-strong)',
    backgroundColor: 'var(--warning-soft)',
    color: 'var(--warning-color)'
  },

  interactionStageError: {
    border: '1px solid var(--error-soft)',
    backgroundColor: 'var(--error-faint)',
    color: 'var(--error-color)'
  },

  interactionStageDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'currentColor',
    boxShadow: '0 0 0 3px var(--neutral-faint)'
  },

  interactionStageLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '11px',
    fontWeight: 800
  },

  interactionStageDetail: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '11px',
    color: 'var(--text-dark)'
  },

  interactionMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0
  },

  interactionMetaPill: {
    flex: '0 0 auto',
    minHeight: '22px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 8px',
    borderRadius: '999px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 700
  },

  interactionRiskPill: {
    flex: '0 0 auto',
    minHeight: '22px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 8px',
    borderRadius: '999px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--neutral-faint)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 800
  },

  interactionRiskLow: {
    border: '1px solid var(--primary-border)',
    backgroundColor: 'var(--success-faint)',
    color: 'var(--success-color)'
  },

  interactionRiskMedium: {
    border: '1px solid var(--warning-strong)',
    backgroundColor: 'var(--warning-faint)',
    color: 'var(--warning-color)'
  },

  interactionRiskHigh: {
    border: '1px solid var(--error-soft)',
    backgroundColor: 'var(--error-faint)',
    color: 'var(--error-color)'
  },

  interactionRunNarrative: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600
  },

  interactionShortcut: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--text-dark)',
    fontSize: '11px'
  },

  interactionShortcutKey: {
    minHeight: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 5px',
    borderRadius: '4px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 700
  },
  
  interactionAssistText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-dark)',
    fontSize: '11px'
  },

  interactionAssistWarning: {
    color: 'var(--warning-color)',
    fontWeight: 700
  },
  
  inputWrapper: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-end',
    position: 'relative',
    zIndex: 50
  },

  userInputRequestPanel: {
    marginBottom: '10px',
    borderRadius: '16px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)',
    overflow: 'hidden'
  },

  userInputRequestHeader: {
    minHeight: '40px',
    padding: '6px 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    borderBottom: 'none',
    color: 'var(--text-color)',
    fontSize: '12px',
    fontWeight: 700
  },

  userInputRequestMeta: {
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 500
  },

  userInputRequestBody: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '8px',
    padding: '8px'
  },

  userInputRequestTextarea: {
    minHeight: '54px',
    maxHeight: '120px',
    resize: 'vertical',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-color)',
    padding: '8px',
    fontSize: '13px',
    fontFamily: 'inherit',
    lineHeight: 1.4,
    outline: 'none',
    boxShadow: 'var(--glass-inner-hl)'
  },

  userInputRequestButton: {
    width: '64px',
    minHeight: '54px',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--primary-color)',
    color: 'var(--text-on-primary)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 800,
    transition: 'all var(--transition-fast)'
  },

  userInputRequestButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  
  inputTextarea: {
    flex: 1,
    minHeight: '48px',
    maxHeight: '200px',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    color: 'var(--text-color)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
    boxShadow: 'var(--glass-inner-hl)',
    transition: 'all var(--transition-fast)'
  },
  
  inputTextareaFocused: {
    border: '1px solid var(--primary-color)',
    backgroundColor: 'var(--glass-bg-strong)',
    boxShadow: '0 0 0 3px var(--primary-soft), var(--glass-inner-hl)'
  },
  
  sendButton: {
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--primary-color)',
    color: 'var(--text-on-primary)',
    cursor: 'pointer',
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  
  sendButtonDisabled: {
    backgroundColor: 'var(--glass-bg-light)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-muted)',
    cursor: 'not-allowed'
  },
  
  inputHint: {
    marginTop: '4px',
    fontSize: '11px',
    color: 'var(--text-dark)'
  },
  
  // ================== 通用标签按钮 ==================
  tabButton: {
    flex: 1,
    height: '32px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    transition: 'all 0.15s'
  },
  
  tabButtonActive: {
    backgroundColor: 'var(--primary-soft)',
    border: 'none',
    color: 'var(--primary-color)'
  },

  headerActionButton: {
    height: '32px',
    padding: '0 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  
  // ================== 模态框样式 ==================
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--overlay-soft)',
    backdropFilter: 'blur(8px) saturate(150%)',
    WebkitBackdropFilter: 'blur(8px) saturate(150%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px'
  },
  
  modal: {
    width: 'min(560px, 100%)',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--glass-border)',
    borderRadius: '12px',
    boxShadow: 'var(--glass-shadow-lg)',
    overflow: 'hidden'
  },
  
  modalHeader: {
    padding: '18px 20px',
    borderBottom: 'none'
  },
  
  modalTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--text-color)'
  },
  
  modalSubtitle: {
    margin: '8px 0 0',
    color: 'var(--text-muted)',
    fontSize: '13px',
    lineHeight: 1.5
  },
  
  modalBody: {
    padding: '18px 20px',
    display: 'grid',
    gap: '14px'
  },
  
  formRow: {
    display: 'grid',
    gap: '7px'
  },
  
  formLabel: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)'
  },
  
  formInput: {
    width: '100%',
    height: '36px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-color)',
    padding: '0 10px',
    boxShadow: 'var(--glass-inner-hl)',
    transition: 'all var(--transition-fast)',
    outline: 'none'
  },
  
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 20px',
    borderTop: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)'
  },
  
  modalActions: {
    display: 'flex',
    gap: '8px',
    flexShrink: 0
  },
  
  textButton: {
    height: '34px',
    padding: '0 12px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    minWidth: '86px',
    whiteSpace: 'nowrap'
  },
  
  primaryAction: {
    height: '34px',
    padding: '0 14px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'var(--primary-color)',
    color: 'var(--text-on-primary)',
    fontWeight: '700',
    cursor: 'pointer',
    minWidth: '108px',
    whiteSpace: 'nowrap'
  },
  
  formError: {
    color: 'var(--error-color)',
    fontSize: '12px'
  },
  
  formHint: {
    color: 'var(--text-dark)',
    fontSize: '12px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  // ================== 管理页面 ==================
  managementOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    backgroundColor: 'rgba(20, 20, 22, 0.45)',
    backdropFilter: 'blur(8px) saturate(150%)',
    WebkitBackdropFilter: 'blur(8px) saturate(150%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  managementContainer: {
    display: 'flex',
    width: '90vw',
    maxWidth: '800px',
    height: '80vh',
    maxHeight: '600px',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--glass-border)',
    borderRadius: '14px',
    boxShadow: 'var(--glass-shadow-lg)',
    overflow: 'hidden',
  },

  managementSidebar: {
    display: 'flex',
    flexDirection: 'column',
    width: '180px',
    minWidth: '180px',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(16px) saturate(160%)',
    WebkitBackdropFilter: 'blur(16px) saturate(160%)',
    borderRight: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-inner-hl)',
    paddingTop: '12px',
  },

  managementSidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px 14px',
    color: 'var(--text-color)',
    borderBottom: '1px solid var(--glass-border)',
    marginBottom: '4px',
  },

  managementTab: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    height: '36px',
    padding: '0 14px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    textAlign: 'left',
    transition: 'all var(--transition-fast)',
  },

  managementTabActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    fontWeight: 700,
  },

  managementContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },

  managementCloseBtn: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--glass-border)',
    borderRadius: '6px',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    zIndex: 1,
    transition: 'all var(--transition-fast)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  mgmtContentInner: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
  },

  mgmtContentHeader: {
    marginBottom: '16px',
    padding: '8px 0 12px',
    borderBottom: 'none',
  },

  mgmtSection: {
    marginBottom: '16px',
  },

  mgmtSectionTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '24px',
    borderRadius: '999px',
    border: '1px solid var(--title-capsule-border)',
    backgroundColor: 'var(--title-capsule-bg)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    padding: '0 10px',
  },

  mgmtCheckboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },

  mgmtCheckbox: {
    width: '14px',
    height: '14px',
    accentColor: 'var(--primary-color)',
    cursor: 'pointer',
  },

  // ================== 模型管理 ==================
  modelGroup: {
    marginBottom: '8px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)',
    overflow: 'hidden',
  },

  modelGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    backgroundColor: 'var(--title-capsule-bg)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left',
  },

  modelGroupBody: {
    borderTop: '1px solid var(--glass-border)',
    padding: '8px',
  },

  modelCard: {
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    marginBottom: '6px',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)',
    overflow: 'hidden',
  },

  modelCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
  },

  modelCardInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flex: 1,
    minWidth: 0,
  },

  modelCardName: {
    fontWeight: 600,
    fontSize: '13px',
    color: 'var(--text-color)',
  },

  modelCardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
  },

  modelActionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    border: '1px solid var(--glass-border)',
    borderRadius: '4px',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all var(--transition-fast)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  modelAddBtn: {
    display: 'block',
    width: '100%',
    padding: '8px',
    border: '1px dashed var(--glass-border-strong)',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
    transition: 'all var(--transition-fast)',
  },

  modelForm: {
    padding: '12px',
    borderTop: '1px solid var(--glass-border)',
  },

  modelFormActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px',
  },

  modelNameInput: {
    height: '28px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--primary-soft)',
    backgroundColor: 'var(--glass-bg-light)',
    color: 'var(--text-color)',
    fontSize: '12px',
    width: '160px',
  },

  // ================== MCP 管理 ==================
  mcpServerCard: {
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    marginBottom: '8px',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)',
    overflow: 'hidden',
  },

  mcpServerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
  },

  mcpServerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
};
