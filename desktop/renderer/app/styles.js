import { LAYOUT } from './config.js';

export const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'linear-gradient(180deg, var(--container-gradient-start) 0%, var(--background-color) 42%, var(--container-gradient-end) 100%)',
    color: 'var(--text-color)',
    fontFamily: 'var(--font-family)',
    overflow: 'hidden'
  },
  
  // ================== 顶部菜单栏 ==================
  menuBar: {
    display: 'flex',
    alignItems: 'center',
    minHeight: `${LAYOUT.headerHeight}px`,
    padding: '0 var(--spacing-md)',
    backgroundColor: 'var(--surface-warm)',
    borderBottom: '1px solid var(--primary-soft)',
    gap: 'var(--spacing-sm)',
    boxShadow: 'var(--shadow-sm)'
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
    background: 'linear-gradient(145deg, rgba(232, 120, 74, 0.22), rgba(232, 120, 74, 0.07))',
    color: 'var(--text-color)',
    border: '1px solid rgba(232, 120, 74, 0.35)',
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
    backgroundColor: 'var(--surface-hover)',
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
    border: 'none',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
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
    transition: 'background-color 0.1s'
  },
  
  menuDropdownShortcut: {
    fontSize: '11px',
    color: 'var(--text-dark)',
    fontFamily: 'monospace'
  },
  
  menuDivider: {
    height: '1px',
    backgroundColor: 'var(--border-subtle)',
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
    backgroundColor: 'var(--bg-depth-0)',
    borderRight: '1px solid rgba(245, 240, 235, 0.07)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'var(--spacing-sm) 6px',
    gap: '6px'
  },

  activityButton: {
    width: '38px',
    height: '38px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-dark)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0
  },

  activityButtonActive: {
    backgroundColor: 'var(--primary-soft)',
    border: '1px solid rgba(232, 120, 74, 0.24)',
    color: 'var(--primary-color)'
  },
  
  // ================== 左侧工具面板 ==================
  leftSidebar: {
    width: `${LAYOUT.sidebarWidth}px`,
    backgroundColor: 'var(--bg-depth-3)',
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width var(--transition-normal)'
  },

  sidebarHeader: {
    minHeight: '42px',
    padding: '0 var(--spacing-md)',
    borderBottom: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-sm)',
    backgroundColor: 'var(--bg-depth-2)'
  },

  sidebarTitle: {
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase'
  },
  
  // ================== 右侧 Inspector 面板 ==================
  summaryPanel: {
    backgroundColor: 'var(--bg-depth-3)',
    borderLeft: 'none',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative'
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
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--bg-depth-2)'
  },

  previewHeader: {
    minHeight: '42px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
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
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700'
  },

  inspectorTabActive: {
    backgroundColor: 'var(--primary-soft)',
    border: 'none',
    color: 'var(--primary-color)'
  },

  iconButton: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flex: '0 0 auto'
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
    borderRadius: '6px',
    backgroundColor: 'var(--background-color)',
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
    backgroundColor: 'var(--background-color)',
    marginBottom: '6px',
    fontSize: '12px',
    border: '1px solid var(--border-subtle)'
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
    borderBottom: '1px solid var(--border-subtle)'
  },

  previewUrlInput: {
    flex: 1,
    minWidth: 0,
    height: '30px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    padding: '0 10px',
    fontSize: '12px'
  },

  previewPipeline: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'flex',
    gap: '6px',
    overflowX: 'auto'
  },

  previewPipelineStage: {
    flex: '0 0 auto',
    maxWidth: '180px',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },

  button: {
    height: '32px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'rgba(245, 240, 235, 0.055)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '13px'
  },
  
  // ================== 聊天区域 ==================
  chatArea: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'linear-gradient(180deg, var(--primary-faint) 0%, transparent 170px), var(--background-color)'
  },
  
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px var(--spacing-xl)',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-warm)'
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
    background: 'linear-gradient(145deg, rgba(232, 120, 74, 0.24), rgba(232, 120, 74, 0.08))',
    color: 'var(--text-color)',
    border: '1px solid rgba(232, 120, 74, 0.3)',
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
    backgroundColor: 'rgba(93, 211, 158, 0.12)',
    border: 'none',
    color: 'var(--success-color)'
  },
  
  statusRunning: {
    backgroundColor: 'rgba(246, 200, 95, 0.12)',
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
    backgroundColor: 'var(--surface-warm)',
    borderTop: '1px solid var(--primary-soft)',
    boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.06)'
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
    borderRadius: '8px',
    border: '1px solid var(--primary-soft)',
    backgroundColor: 'var(--primary-faint)',
    overflow: 'hidden'
  },

  userInputRequestHeader: {
    minHeight: '32px',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    borderBottom: '1px solid var(--primary-soft)',
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
    border: '1px solid var(--border-subtle)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface-input)',
    color: 'var(--text-color)',
    padding: '8px',
    fontSize: '13px',
    fontFamily: 'inherit',
    lineHeight: 1.4,
    outline: 'none'
  },

  userInputRequestButton: {
    width: '64px',
    minHeight: '54px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: 'var(--warning-color)',
    color: 'var(--text-on-warning)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 800
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
    borderRadius: '8px',
    border: '1px solid rgba(245, 240, 235, 0.1)',
    backgroundColor: 'var(--surface-input)',
    color: 'var(--text-color)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
    transition: 'border-color 0.2s, box-shadow 0.2s, background-color 0.2s'
  },
  
  inputTextareaFocused: {
    border: '1px solid rgba(232, 120, 74, 0.45)',
    backgroundColor: 'var(--surface-input-focused)',
    boxShadow: '0 0 0 3px var(--primary-soft)'
  },
  
  sendButton: {
    width: '44px',
    height: '44px',
    borderRadius: '8px',
    border: '1px solid rgba(245, 240, 235, 0.12)',
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
    backgroundColor: 'var(--border-subtle)',
    color: 'var(--text-dark)',
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
    backgroundColor: 'var(--surface-footer)',
    borderTop: '1px solid var(--border-subtle)'
  },
  
  // ================== 模态框样式 ==================
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(10, 10, 12, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px'
  },
  
  modal: {
    width: 'min(560px, 100%)',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid rgba(245, 240, 235, 0.1)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-lg)',
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
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-modal-body)',
    color: 'var(--text-color)',
    padding: '0 10px'
  },
  
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 20px',
    borderTop: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-modal-footer)'
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
