import { LAYOUT } from './config/index.js';
import { managementStyles } from './styles/management-styles.js';

export const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--window-tint)',
    color: 'var(--text-color)',
    fontFamily: 'var(--font-family)',
    overflow: 'hidden',
    position: 'relative',
    border: '1px solid var(--window-border-color)',
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
  // 顶部 padding 留出隐形拖拽带（DRAG_REGION 高度 40px），
  // 避免面板标题被浮动 chrome 元素遮挡。
  mainContentWrapper: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    padding: '38px 12px 14px',
    gap: '10px',
    position: 'relative',
    borderRadius: 'var(--radius-xl)',
  },

  // WorkbenchControls 属于 chrome 层（与 DragRegion / 状态胶囊同级），
  // absolute 定位到窗口右上角，悬浮在拖拽带上。
  // 必须设 WebkitAppRegion:'no-drag'，否则被拖拽带吞掉点击事件。
  workspaceControls: {
    position: 'absolute',
    top: '8px',
    right: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '28px',
    padding: 0,
    borderRadius: '8px',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    boxShadow: 'none',
    zIndex: 40,
    WebkitAppRegion: 'no-drag',
  },

  activityRail: {
    width: `${LAYOUT.activityRailWidth}px`,
    flexShrink: 0,
    backgroundColor: 'var(--surface-card)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius-lg)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '7px 5px',
    gap: '6px',
    boxShadow: 'var(--shadow-sm), var(--glass-inner-hl)',
    position: 'relative',
    zIndex: 1,
  },

  activityButton: {
    width: '34px',
    height: '34px',
    borderRadius: 'var(--radius-md)',
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
    border: '1px solid var(--primary-border)',
    color: 'var(--primary-color)',
    boxShadow: 'none'
  },
  
  // ================== 左侧工具面板 ==================
  leftSidebar: {
    width: `${LAYOUT.sidebarWidth}px`,
    backgroundColor: 'var(--surface-card)',
    borderRight: '1px solid var(--border-divider)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width var(--transition-normal)',
    boxShadow: 'var(--shadow-sm)',
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
    padding: '0 4px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    boxShadow: 'none'
  },
  
  // ================== 右侧 Inspector 面板 ==================
  summaryPanel: {
    backgroundColor: 'var(--surface-card)',
    borderLeft: '1px solid var(--border-divider)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: 'var(--shadow-sm)',
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
    borderBottom: '1px solid var(--border-divider)',
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
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-base)',
    boxShadow: 'none'
  },

  inspectorTab: {
    height: '30px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    transition: 'all var(--transition-fast)'
  },

  inspectorTabActive: {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-color)',
    boxShadow: 'var(--shadow-sm)'
  },

  iconButton: {
    width: '30px',
    height: '30px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flex: '0 0 auto',
    transition: 'all var(--transition-fast)',
    boxShadow: 'none'
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
    flexDirection: 'column',
    backgroundColor: 'var(--surface-base)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-panel)',
    overflow: 'hidden',
  },

  chatArea: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 'var(--radius-xl)',
  },
  
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border-divider)',
    backgroundColor: 'var(--surface-card)',
    boxShadow: 'none'
  },
  
  chatTitle: {
    minHeight: '28px',
    padding: '2px 2px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    boxShadow: 'none',
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.035em'
  },

  chatTitleMark: {
    width: '22px',
    height: '22px',
    borderRadius: 'var(--radius-md)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: '1px solid var(--primary-border)',
    fontSize: '10px',
    fontWeight: 800
  },

  chatMessageCount: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--text-muted)',
    marginLeft: '8px',
    textTransform: 'none',
    letterSpacing: 0
  },

  chatHeaderActionDivider: {
    width: '1px',
    height: '18px',
    margin: '0 2px',
    backgroundColor: 'var(--border-subtle)',
    flexShrink: 0,
  },
  
  chatStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
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
    padding: '10px 12px 12px',
  },
  
  // ================== 输入区域 ==================
  inputArea: {
    margin: '0 12px 12px',
    padding: '8px',
    backgroundColor: 'var(--surface-card)',
    border: '1px solid var(--glass-border-strong)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-sm), var(--glass-inner-hl)'
  },

  interactionConsole: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '7px',
    padding: '4px 6px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-base)',
    boxShadow: 'none'
  },

  interactionStages: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '6px'
  },

  interactionStage: {
    minWidth: 0,
    minHeight: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '0 8px',
    borderRadius: 'var(--radius-sm)',
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
    width: '6px',
    height: '6px',
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
    display: 'none',
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
    gap: '5px',
    minWidth: 0
  },

  interactionMetaPill: {
    flex: '0 0 auto',
    minHeight: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 7px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-bg)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 700
  },

  interactionRiskPill: {
    flex: '0 0 auto',
    minHeight: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 8px',
    borderRadius: 'var(--radius-sm)',
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
    borderRadius: 'var(--radius-sm)',
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
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--surface-raised)',
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
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--surface-input)',
    color: 'var(--text-color)',
    padding: '8px',
    fontSize: '13px',
    fontFamily: 'inherit',
    lineHeight: 1.4,
    outline: 'none',
    boxShadow: 'none'
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
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-input)',
    color: 'var(--text-color)',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
    lineHeight: 1.5,
    boxShadow: 'none',
    transition: 'all var(--transition-fast)'
  },
  
  inputTextareaFocused: {
    border: '1px solid var(--primary-color)',
    backgroundColor: 'var(--surface-input-focused)',
    boxShadow: 'var(--focus-ring-soft)'
  },
  
  sendButton: {
    width: '36px',
    height: '36px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-brand-s2)',
    backgroundColor: 'var(--ds-brand)',
    color: 'var(--text-on-primary)',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    boxShadow: 'none',
    flexShrink: 0,
  },

  sendButtonDisabled: {
    backgroundColor: 'var(--ds-bg-raised)',
    border: '1px solid var(--ds-border-l1)',
    color: 'var(--ds-text-tertiary)',
    cursor: 'not-allowed',
    opacity: 0.6,
  },

  /* 运行时停止按钮 — 圆形 + 脉冲光环 */
  sendButtonRunning: {
    backgroundColor: 'var(--ds-status-error)',
    border: '1px solid var(--ds-status-error)',
    color: '#fff',
    cursor: 'pointer',
    animation: 'planDotPulse 2s ease-in-out infinite',
  },

  /* 运行时发送按钮（次要） */
  sendButtonRunningSecondary: {
    width: '36px',
    height: '36px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-raised)',
    color: 'var(--ds-text-primary)',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    flexShrink: 0,
  },
  
  inputHint: {
    marginTop: '4px',
    fontSize: '11px',
    color: 'var(--text-dark)'
  },

  askUserFloatingCapsule: {
    position: 'fixed',
    top: '80px',
    left: '50%',
    zIndex: 1000,
    minWidth: '320px',
    maxWidth: '480px',
    borderRadius: '24px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'rgba(20, 20, 24, 0.85)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), var(--glass-inner-hl)',
    padding: '14px 18px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    opacity: 0,
    pointerEvents: 'none',
    transform: 'translateX(-50%) translateY(-20px)'
  },

  askUserFloatingCapsuleVisible: {
    opacity: 1,
    pointerEvents: 'auto',
    transform: 'translateX(-50%) translateY(0)'
  },

  askUserIconWrapper: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    backgroundColor: 'var(--primary-soft)',
    border: '1px solid var(--primary-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },

  askUserContent: {
    flex: 1,
    minWidth: 0
  },

  askUserTitle: {
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '2px'
  },

  askUserMessage: {
    fontSize: '14px',
    color: 'var(--text-color)',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  askUserInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '10px',
    padding: '6px',
    borderRadius: '12px',
    backgroundColor: 'var(--surface-input)',
    border: '1px solid var(--border-subtle)',
    transition: 'all var(--transition-fast)'
  },

  askUserInputWrapperFocused: {
    border: '1px solid var(--primary-color)',
    boxShadow: 'var(--focus-ring-soft)'
  },

  askUserInput: {
    flex: 1,
    minWidth: 0,
    height: '32px',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--text-color)',
    fontSize: '13px',
    outline: 'none',
    padding: '0 8px'
  },

  askUserButton: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    backgroundColor: 'var(--primary-color)',
    color: 'var(--text-on-primary)',
    cursor: 'pointer',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all var(--transition-fast)'
  },

  askUserButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  
  // ================== 通用标签按钮 ==================
  tabButton: {
    flex: 1,
    height: '32px',
    borderRadius: 'var(--radius-sm)',
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
    borderRadius: 'var(--radius-md)',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  ...managementStyles,
};
