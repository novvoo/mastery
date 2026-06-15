import { LAYOUT } from './config.js';

export const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'linear-gradient(180deg, var(--container-gradient-start) 0%, var(--background-color) 42%, var(--container-gradient-end) 100%)',
    color: 'var(--text-color)',
    fontFamily: 'var(--font-family)',
    overflow: 'hidden',
    position: 'relative'
  },
  
  // ================== 顶部菜单栏 ==================
  menuBar: {
    display: 'flex',
    alignItems: 'center',
    minHeight: `${LAYOUT.headerHeight}px`,
    padding: '0 var(--spacing-md)',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    borderBottom: '1px solid var(--glass-border)',
    gap: 'var(--spacing-sm)',
    boxShadow: 'var(--glass-inner-hl)',
    zIndex: 20
  },

  topBarBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    WebkitAppRegion: 'no-drag'
  },

  brandMark: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--gradient-brand)',
    color: 'var(--text-color)',
    border: '1px solid var(--primary-strong)',
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: 0
  },

  brandText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    lineHeight: 1.15
  },

  brandTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--text-color)',
    letterSpacing: '0.01em'
  },

  brandSubtitle: {
    fontSize: '11px',
    color: 'var(--text-dark)'
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
    backgroundColor: 'var(--glass-bg-strong)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
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
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },

  activityRail: {
    width: `${LAYOUT.activityRailWidth}px`,
    flexShrink: 0,
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    borderRight: '1px solid var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'var(--spacing-sm) 6px',
    gap: '6px',
    boxShadow: 'var(--glass-inner-hl)'
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
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(16px) saturate(160%)',
    WebkitBackdropFilter: 'blur(16px) saturate(160%)',
    borderRight: '1px solid var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width var(--transition-normal)',
    boxShadow: 'var(--glass-shadow)'
  },

  sidebarHeader: {
    minHeight: '42px',
    padding: '0 var(--spacing-md)',
    borderBottom: '1px solid var(--glass-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-sm)',
    backgroundColor: 'var(--glass-bg-light)'
  },

  sidebarTitle: {
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase'
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
    boxShadow: 'var(--glass-shadow)'
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
    gap: '6px',
    padding: 'var(--spacing-sm)',
    borderBottom: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)'
  },

  previewHeader: {
    minHeight: '42px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--glass-border)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  inspectorTabs: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
    gap: '4px',
    minWidth: 0
  },

  inspectorTab: {
    height: '30px',
    borderRadius: '6px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    transition: 'all var(--transition-fast)'
  },

  inspectorTabActive: {
    backgroundColor: 'var(--glass-bg-light)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-color)',
    boxShadow: 'var(--glass-inner-hl)'
  },

  iconButton: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flex: '0 0 auto',
    transition: 'all var(--transition-fast)'
  },

  previewFrame: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    border: 'none',
    backgroundColor: '#fff'
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
    transition: 'all var(--transition-fast)'
  },
  
  // ================== 聊天区域 ==================
  chatArea: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'linear-gradient(180deg, var(--primary-faint) 0%, transparent 170px), transparent'
  },
  
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px var(--spacing-xl)',
    borderBottom: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)'
  },
  
  chatTitle: {
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
    width: '24px',
    height: '24px',
    borderRadius: '7px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(145deg, rgba(61, 139, 139, 0.24), rgba(61, 139, 139, 0.08))',
    color: 'var(--text-color)',
    border: '1px solid rgba(61, 139, 139, 0.3)',
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
    padding: '10px 14px 0',
  },
  
  // ================== 输入区域 ==================
  inputArea: {
    padding: '12px var(--spacing-xl) 14px',
    backgroundColor: 'var(--glass-bg)',
    backdropFilter: 'blur(16px) saturate(160%)',
    WebkitBackdropFilter: 'blur(16px) saturate(160%)',
    borderTop: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-overlay)'
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
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(10px) saturate(140%)',
    WebkitBackdropFilter: 'blur(10px) saturate(140%)',
    boxShadow: 'var(--glass-inner-hl)',
    overflow: 'hidden'
  },

  userInputRequestHeader: {
    minHeight: '32px',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    borderBottom: '1px solid var(--glass-border)',
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
  
  // ================== 底部状态栏 ==================
  footer: {
    backgroundColor: 'var(--glass-bg-light)',
    backdropFilter: 'blur(16px) saturate(150%)',
    WebkitBackdropFilter: 'blur(16px) saturate(150%)',
    borderTop: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-inner-hl)'
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
    backgroundColor: 'var(--glass-bg-strong)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
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
    color: 'var(--text-color)',
    padding: '0 10px',
    boxShadow: 'var(--shadow-inset)',
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
    backgroundColor: 'var(--glass-bg-light)'
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
  }
};
