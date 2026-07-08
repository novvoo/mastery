export const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'visible',
    backgroundColor: 'var(--surface-hover)',
    borderWidth: '0',
    borderStyle: 'none',
    borderColor: 'transparent',
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
    padding: '0 4px',
    borderRadius: 'var(--radius-sm)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    boxShadow: 'none',
    fontSize: '12px',
    fontWeight: '800',
    color: 'var(--ds-text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
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
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)',
    backgroundColor: 'var(--surface-base)',
    boxShadow: 'none'
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
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)',
    backgroundColor: 'var(--surface-input)',
    color: 'var(--ds-text-primary)',
    fontSize: '12px',
    transition: 'width 0.2s ease'
  },
  
  searchInputExpanded: {
    width: 'min(240px, 42vw)'
  },
  
  button: {
    height: '28px',
    padding: '0 9px',
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)',
    backgroundColor: 'var(--ds-bg-raised)',
    color: 'var(--ds-text-primary)',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  
  buttonActive: {
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
    borderWidth: '0',
    borderStyle: 'none',
    borderColor: 'transparent'
  },
  
  viewToggle: {
    display: 'flex',
    gap: '2px',
    padding: '2px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--surface-base)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)',
    flex: '0 0 auto'
  },
  
  viewButton: {
    width: '28px',
    height: '24px',
    padding: 0,
    borderRadius: 'var(--radius-sm)',
    borderWidth: '0',
    borderStyle: 'none',
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: 'var(--ds-text-secondary)',
    cursor: 'pointer',
    fontSize: '11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s'
  },
  
  viewButtonActive: {
    backgroundColor: 'var(--ds-bg-overlay-l2)',
    color: 'var(--ds-text-primary)'
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
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--ds-border-l2)',
    backgroundColor: 'var(--ds-bg-raised)',
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
    borderBottom: '1px solid var(--border-divider)',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
    color: 'var(--ds-text-secondary)',
    fontSize: '12px',
    fontWeight: '600'
  },

  runtimeDetailsHeaderInteractive: {
    cursor: 'pointer',
    userSelect: 'text'
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
    color: 'var(--ds-text-secondary)',
    fontWeight: 500
  },

  runtimeDetailsToggle: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)',
    backgroundColor: 'var(--ds-bg-raised)',
    color: 'var(--ds-text-secondary)',
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
    borderBottom: '1px solid var(--ds-border-l2)'
  },

  runtimeProgressText: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--ds-text-secondary)'
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
    border: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
    padding: '8px',
    color: 'var(--ds-text-secondary)',
    fontSize: '12px',
    lineHeight: '1.5'
  },

  runtimeDetailItemInteractive: {
    cursor: 'pointer'
  },

  runtimeDetailItemDebug: {
    border: 'none',
    backgroundColor: 'var(--ds-bg-overlay-l1)',
  },

  runtimeDetailItemStatus: {
    border: 'none',
    backgroundColor: 'var(--ds-brand-soft)'
  },

  runtimeDetailMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
    color: 'var(--ds-text-tertiary)',
    fontSize: '11px'
  },

  runtimeDetailContent: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--ds-text-secondary)',
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

  /* ── Plan Card（对齐 TRAE Work 设计体系） ── */

  /* 消息流中的轻量 plan 指示器（plan 详情在右侧面板） */
  planInlineIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-xs)',
    padding: '4px 10px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
    border: '1px solid var(--ds-brand-s2)',
    maxWidth: 'fit-content',
  },

  planCard: {
    borderRadius: 'var(--radius-lg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-default)',
    padding: 'var(--spacing-lg)',
    color: 'var(--ds-text-primary)',
    animation: 'planSectionFadeIn 0.25s ease-out',
  },

  /* Section 编号头部 — 参考 TRAE Work .section-head */
  planSectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-sm)',
    marginBottom: 'var(--spacing-sm)',
  },
  planSectionIndex: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '28px',
    height: '22px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--ds-border-l1)',
    background: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-tertiary)',
    fontSize: '10px',
    fontWeight: 600,
    fontFamily: 'var(--ds-font-mono)',
    padding: '0 6px',
  },
  planSectionTitle: {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 600,
    color: 'var(--ds-text-primary)',
    margin: 0,
    lineHeight: 1.4,
  },
  planSectionIntro: {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--ds-text-secondary)',
    maxWidth: '680px',
    lineHeight: 1.5,
    marginBottom: 'var(--spacing-md)',
  },

  /* 卡片头部 */
  planCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-sm)',
    marginBottom: 'var(--spacing-md)',
  },

  planIconBox: {
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
  },

  planProgressBadge: {
    marginLeft: 'auto',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: 'var(--ds-font-mono)',
    transition: 'color 0.2s ease',
  },

  /* ── 摘要指标网格（替代 planMetaRow pills） ── */
  planSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 'var(--spacing-xs)',
    marginBottom: 'var(--spacing-md)',
  },
  planSummaryCard: {
    minWidth: 0,
    padding: 'var(--spacing-sm) var(--spacing-xs)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    background: 'var(--ds-bg-secondary)',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  planSummaryLabel: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--ds-text-tertiary)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    lineHeight: 1.4,
  },
  planSummaryValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 'var(--font-size-base)',
    fontWeight: 700,
    color: 'var(--ds-text-primary)',
    fontFamily: 'var(--ds-font-mono)',
    fontVariantNumeric: 'tabular-nums',
  },

  /* 通用 Tag — 参考 TRAE Work .ds-tag */
  planTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--spacing-xs)',
    height: '20px',
    padding: '0 6px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
    lineHeight: 1.5,
    background: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-secondary)',
    border: '1px solid var(--ds-border-l1)',
    transition: 'background 0.12s ease, color 0.12s ease',
  },
  planTagBrand: {
    background: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
    borderColor: 'var(--ds-brand-s2)',
  },
  planTagSuccess: {
    background: 'var(--ds-status-success-s1)',
    color: 'var(--ds-status-success)',
    borderColor: 'var(--ds-status-success-s2)',
  },
  planTagDanger: {
    background: 'var(--ds-status-error-s1)',
    color: 'var(--ds-status-error)',
    borderColor: 'var(--ds-status-error-s2)',
  },
  planTagWarning: {
    background: 'var(--ds-status-warning-s1)',
    color: 'var(--ds-status-warning)',
    borderColor: 'var(--ds-status-warning-s2)',
  },

  /* 快照时间线 */
  planTimelineControl: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: 'var(--spacing-xs) var(--spacing-sm)',
    marginBottom: 'var(--spacing-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    background: 'var(--ds-bg-secondary)',
  },

  planTimelineMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-sm)',
    color: 'var(--ds-text-secondary)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },

  planTimelineSliderRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 'var(--spacing-sm)',
  },

  planTimelineSlider: {
    width: '100%',
    minWidth: 0,
    accentColor: 'var(--ds-brand)',
    cursor: 'pointer',
    height: '4px',
  },

  planTimelineLatestButton: {
    height: '22px',
    padding: '0 6px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--ds-border-l2)',
    background: 'var(--ds-bg-raised)',
    color: 'var(--ds-text-secondary)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.12s ease, color 0.12s ease',
  },
  planTimelineLatestButtonActive: {
    background: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
    borderColor: 'transparent',
  },

  /* 策略网格 — Section 02 */
  planStrategyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 'var(--spacing-xs)',
    marginBottom: 'var(--spacing-md)',
  },

  planStrategyItem: {
    minWidth: 0,
    padding: 'var(--spacing-xs) var(--spacing-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    background: 'var(--ds-bg-secondary)',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  planStrategyItemWide: {
    minWidth: 0,
    gridColumn: 'span 2',
    padding: 'var(--spacing-xs) var(--spacing-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    background: 'var(--ds-bg-raised)',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  planStrategyLabel: {
    color: 'var(--ds-text-tertiary)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    lineHeight: 1.4,
  },
  planStrategyValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--ds-text-primary)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
  },

  /* 进度条 — 参考 TRAE Work .ds-progress (6px) */
  planProgressTrack: {
    height: '6px',
    borderRadius: 'var(--radius-full)',
    background: 'var(--ds-bg-overlay-l1)',
    overflow: 'hidden',
    marginBottom: 'var(--spacing-md)',
  },
  planProgressFill: {
    height: '100%',
    borderRadius: 'inherit',
    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease',
    transformOrigin: 'left',
    animation: 'planProgressGrow 0.4s ease-out',
  },

  /* ── 任务列表 — Section 03: 带轨道的垂直时间线 ── */
  planTaskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-xs)',
  },

  planPhaseGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-xs)',
    paddingTop: 'var(--spacing-xs)',
    borderTop: '1px solid var(--ds-border-l1)',
  },
  planPhaseGroupFirst: {
    borderTop: 'none',
    paddingTop: 0,
  },

  planPhaseHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-sm)',
    color: 'var(--ds-text-primary)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 700,
    lineHeight: 1.5,
  },

  /* 三列时间线网格: 阶段 | 轨道 | 内容 */
  planTimelineRow: {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr)',
    gap: 'var(--spacing-sm)',
    alignItems: 'start',
    minHeight: '22px',
  },

  /* 轨道 */
  planTimelineDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    border: '2px solid var(--ds-border-l2)',
    background: 'var(--ds-bg-default)',
    flexShrink: 0,
    transition: 'background 0.2s ease, border-color 0.2s ease',
  },
  planTimelineDotDone: {
    borderColor: 'var(--ds-status-success)',
    background: 'var(--ds-status-success)',
  },
  planTimelineDotRunning: {
    borderColor: 'var(--ds-status-warning)',
    background: 'var(--ds-status-warning)',
    animation: 'planDotPulse 1.6s ease-in-out infinite',
  },
  planTimelineDotFailed: {
    borderColor: 'var(--ds-status-error)',
    background: 'var(--ds-status-error)',
  },
  planTimelineDotRepair: {
    borderColor: 'var(--ds-status-warning)',
    background: 'var(--ds-status-warning)',
  },
  planTimelineLine: {
    width: '2px',
    minHeight: '8px',
    background: 'var(--ds-border-l2)',
    justifySelf: 'center',
  },

  /* 任务内容 */
  planTaskName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--ds-text-primary)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 500,
    lineHeight: 1.4,
  },
  planTaskDependency: {
    marginLeft: '4px',
    color: 'var(--ds-text-tertiary)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 600,
  },
  planTaskStatus: {
    color: 'var(--ds-text-tertiary)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 500,
    justifySelf: 'end',
    flexShrink: 0,
  },

  /* 任务行内容容器 */
  planTaskContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--spacing-sm)',
    minWidth: 0,
  },

  activityPanel: {
    padding: '10px',
    borderBottom: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
  },

  activitySummaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
    color: 'var(--ds-text-secondary)',
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
    backgroundColor: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-secondary)',
    fontSize: '11px',
    fontWeight: 700
  },

  taskStageCompleted: {
    backgroundColor: 'var(--ds-status-success-s1)',
    color: 'var(--ds-text-primary)'
  },

  taskStageRunning: {
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-text-primary)'
  },

  taskStageWaiting: {
    backgroundColor: 'var(--ds-status-warning-s1)',
    color: 'var(--ds-text-primary)'
  },

  taskStageFailed: {
    backgroundColor: 'var(--ds-status-error-s1)',
    color: 'var(--ds-text-primary)'
  },

  taskStageMark: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--ds-border-l2)',
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
    backgroundColor: 'var(--ds-bg-secondary)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)'
  },

  fileStatusPath: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--ds-text-primary)',
    fontSize: '12px',
    fontWeight: 600
  },

  fileStatusChip: {
    flexShrink: 0,
    color: 'var(--ds-brand)',
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
    backgroundColor: 'var(--ds-bg-secondary)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)'
  },

  activityItemCompleted: {
    backgroundColor: 'var(--ds-status-success-s1)',
    borderColor: 'var(--ds-status-success-s1)'
  },

  activityItemFailed: {
    backgroundColor: 'var(--ds-status-error-s1)',
    borderColor: 'var(--ds-status-error-s1)'
  },

  activityItemWaiting: {
    backgroundColor: 'var(--ds-brand-soft)',
    borderColor: 'var(--ds-brand-soft)'
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
    backgroundColor: 'var(--ds-brand)',
    flexShrink: 0
  },

  activityTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--ds-text-primary)',
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
    borderColor: 'var(--ds-border-l1)',
    backgroundColor: 'var(--ds-border-l1)',
    color: 'var(--ds-text-primary)',
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
    backgroundColor: 'var(--ds-border-l1)'
  },
  
  timelineDot: {
    position: 'absolute',
    left: '4px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--ds-brand)',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-bg-raised)',
    transition: 'all 0.2s'
  },
  
  // 消息项外层容器
  messageItem: {
    marginBottom: '10px',
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
    borderRadius: 'var(--radius-lg)',
    padding: '10px 12px',
    backgroundColor: 'var(--message-agent-bg)',
    border: '1px solid var(--message-agent-border)',
    boxShadow: 'var(--message-shadow)',
    color: 'var(--ds-text-primary)',
    maxWidth: '82%',
    lineHeight: 1.45
  },

  messageBubbleUser: {
    backgroundColor: 'var(--message-user-bg)',
    borderColor: 'var(--message-user-border)',
    color: 'var(--message-user-text)',
    borderRadius: 'var(--radius-lg)',
    maxWidth: '78%',
    textAlign: 'left'
  },

  messageBubbleAgent: {
    borderRadius: 'var(--radius-lg)',
    maxWidth: '82%'
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
    borderRadius: 'var(--radius-sm)',
    fontSize: '11px',
    fontWeight: '500',
    gap: '4px'
  },
  
  typeInfo: {
    backgroundColor: 'transparent',
    color: 'var(--ds-brand)',
    border: 'none'
  },
  
  typeSuccess: {
    backgroundColor: 'transparent',
    color: 'var(--ds-status-success)',
    border: 'none'
  },
  
  typeError: {
    backgroundColor: 'transparent',
    color: 'var(--ds-status-error)',
    border: 'none'
  },
  
  typeWarning: {
    backgroundColor: 'transparent',
    color: 'var(--ds-status-warning)',
    border: 'none'
  },
  
  typeDebug: {
    backgroundColor: 'transparent',
    color: 'var(--ds-text-tertiary)',
    border: 'none'
  },
  
  typeTool: {
    backgroundColor: 'transparent',
    color: 'var(--ds-brand)',
    border: 'none'
  },

  typeEvent: {
    backgroundColor: 'transparent',
    color: 'var(--ds-status-warning)',
    border: 'none'
  },
  
  typeResult: {
    backgroundColor: 'transparent',
    color: 'var(--ds-brand)',
    border: 'none'
  },
  
  typeUser: {
    backgroundColor: 'transparent',
    color: 'var(--ds-text-primary)',
    border: 'none'
  },

  typeAgent: {
    backgroundColor: 'transparent',
    color: 'var(--ds-brand)',
    border: 'none'
  },

  typeThinking: {
    backgroundColor: 'transparent',
    color: 'var(--ds-brand)',
    border: 'none'
  },

  thinkingPanel: {
    margin: '0 0 10px 0',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-brand-s2)',
    backgroundColor: 'var(--ds-brand-soft)',
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
    borderBottom: '1px solid var(--ds-brand-soft)',
    borderRadius: '8px 8px 0 0',
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-text-primary)',
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
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
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
    color: 'var(--ds-text-secondary)',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },

  thinkingSummaryText: {
    padding: '8px 10px',
    color: 'var(--ds-text-secondary)',
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
    backgroundColor: 'var(--ds-bg-secondary)',
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
    color: 'var(--ds-text-tertiary)',
    fontSize: '11px',
    fontWeight: 700
  },

  thinkingStepContent: {
    color: 'var(--ds-text-secondary)',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  
  messageTime: {
    fontSize: '11px',
    color: 'var(--ds-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  messageContent: {
    fontSize: '13px',
    color: 'var(--ds-text-primary)',
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
    color: 'var(--ds-text-secondary)',
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
    height: '24px',
    padding: '0 8px',
    borderRadius: 'var(--radius-sm, 4px)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--ds-text-secondary)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    transition: 'all 0.12s ease'
  },

  emptyChip: {
    padding: '5px 12px',
    backgroundColor: 'var(--ds-border-l1)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: '12px',
    color: 'var(--ds-text-secondary)'
  },
  
  // 详情面板
  detailPanel: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: 'var(--ds-bg-raised)',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l1)',
    fontSize: '12px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  
  detailTitle: {
    color: 'var(--ds-text-primary)',
    fontWeight: '600',
    marginBottom: '8px'
  },
  
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    color: 'var(--ds-text-secondary)'
  },
  
  detailValue: {
    color: 'var(--ds-text-primary)',
    textAlign: 'right',
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  
  /* 空状态 */
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    color: 'var(--ds-text-secondary)',
    textAlign: 'center',
    padding: '40px 24px',
    gap: '12px',
    background: 'var(--gradient-primary)'
  },
  
  emptyIcon: {
    width: '36px',
    height: '36px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)',
    border: 'none'
  },
  
  emptyText: {
    fontSize: '16px',
    marginBottom: '8px',
    color: 'var(--ds-text-primary)'
  },
  
  emptyHint: {
    fontSize: '13px',
    color: 'var(--ds-text-tertiary)',
    maxWidth: '300px'
  },
  
  // 运行指示器
  spinner: {
    width: '14px',
    height: '14px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l3)',
    borderTopColor: 'var(--ds-status-warning)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  
  runningText: {
    fontSize: '14px',
    color: 'var(--ds-status-warning)',
    fontWeight: '500'
  },
  
  progressBar: {
    width: '100%',
    height: '4px',
    backgroundColor: 'var(--ds-border-l3)',
    borderRadius: '2px',
    marginTop: '8px',
    overflow: 'hidden'
  },
  
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--ds-status-warning)',
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
    backgroundColor: 'var(--ds-border-l2)',
    borderRadius: '4px',
    marginBottom: '4px',
    marginTop: '8px',
    cursor: 'pointer'
  },
  
  groupIcon: {
    fontSize: '12px',
    color: 'var(--ds-text-secondary)'
  },
  
  groupTitle: {
    fontSize: '12px',
    color: 'var(--ds-text-secondary)',
    fontWeight: '500'
  },
  
  groupCount: {
    fontSize: '11px',
    color: 'var(--ds-text-tertiary)'
  },
  
  // 复制成功提示
  copyToast: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '8px 14px',
    backgroundColor: 'var(--ds-status-success)',
    color: 'var(--text-on-success)',
    borderRadius: 'var(--radius-md)',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: 1.4,
    boxShadow: 'var(--shadow-toast)',
    animation: 'fadeIn 0.2s ease-out',
    zIndex: 1000,
    border: 'none'
  },

  // ─── 优雅 Action / 工具调用卡片 ───

  actionCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    padding: '12px',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--message-tool-bg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--message-tool-border)',
    boxShadow: 'var(--message-shadow)',
    overflow: 'hidden',
    maxWidth: '82%',
    transition: 'border-color 0.15s ease'
  },

  actionCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '30px',
    paddingBottom: '0',
    borderBottom: 'none'
  },

  actionIconBox: {
    width: '28px',
    height: '28px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '15px',
    flexShrink: 0
  },

  actionIconBoxTool: {
    backgroundColor: 'var(--ds-brand-soft)',
    color: 'var(--ds-brand)'
  },

  actionIconBoxResult: {
    backgroundColor: 'var(--ds-status-success-s1)',
    color: 'var(--ds-status-success)'
  },

  actionIconBoxError: {
    backgroundColor: 'var(--ds-status-error-s1)',
    color: 'var(--ds-status-error)'
  },

  actionTitleWrap: {
    flex: 1,
    minWidth: 0
  },

  actionName: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--ds-text-primary)',
    lineHeight: 1.3,
    marginBottom: '2px'
  },

  actionSubtitle: {
    fontSize: '12px',
    color: 'var(--ds-text-secondary)',
    fontWeight: 400
  },

  actionDurationBadge: {
    fontSize: '11px',
    color: 'var(--ds-text-secondary)',
    backgroundColor: 'var(--ds-bg-raised)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l1)',
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 500,
    flexShrink: 0
  },

  actionExitCode: {
    fontSize: '11px',
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    padding: '2px 7px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--ds-bg-raised)',
    border: '1px solid var(--ds-border-l1)',
    flexShrink: 0,
    lineHeight: 1.4,
  },

  actionLoader: {
    width: '14px',
    height: '14px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'var(--ds-border-l2)',
    borderTopColor: 'var(--ds-brand)',
    borderRadius: '50%',
    animation: 'spin 600ms linear infinite',
    display: 'inline-block',
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
    color: 'var(--ds-text-secondary)',
    fontSize: '11px',
    fontWeight: 500,
    flexShrink: 0,
    paddingTop: '1px'
  },

  actionArgValue: {
    color: 'var(--ds-text-primary)',
    fontSize: '12px',
    flex: 1,
    wordBreak: 'break-word',
    fontFamily: 'var(--font-mono)',
    minWidth: 0
  },

  actionArgValueString: {
    color: 'var(--ds-brand)'
  },

  actionArgValueNumber: {
    color: 'var(--ds-status-warning)'
  },

  // 结果摘要区
  actionResultSummary: {
    fontSize: '12px',
    color: 'var(--ds-text-secondary)',
    lineHeight: 1.6,
    padding: '8px 10px',
    marginTop: '10px',
    backgroundColor: 'var(--message-result-bg)',
    border: '1px solid var(--message-result-border)',
    borderRadius: 'var(--radius-md)'
  },

  // 错误区
  actionErrorBody: {
    fontSize: '12px',
    color: 'var(--ds-status-error)',
    lineHeight: 1.6,
    padding: '8px 10px',
    marginTop: '10px',
    backgroundColor: 'var(--ds-status-error-s1)',
    borderRadius: 'var(--radius-md)',
    borderLeft: '3px solid var(--ds-status-error)'
  },

  // 思考卡片（折叠式）
  thinkingCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--ds-brand-soft)',
    border: '1px solid var(--ds-brand-s2)',
    fontSize: '13px',
    color: 'var(--ds-text-secondary)',
    lineHeight: 1.7
  },

  thinkingCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--ds-brand)',
    fontSize: '12px',
    fontWeight: 600
  },

  // Agent 普通文本气泡增强
  enhancedMessageBubble: {
    padding: '12px 14px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--message-agent-border)',
    backgroundColor: 'var(--message-agent-bg)',
    boxShadow: 'var(--message-shadow)',
    fontSize: '14px',
    lineHeight: 1.7,
    maxWidth: '82%',
    minWidth: '120px'
  },

  enhancedMessageBubbleAgent: {
    borderRadius: 'var(--radius-lg)'
  },

  assistantMarkdownBubble: {
    width: 'min(780px, 86%)',
    maxWidth: '86%',
    backgroundColor: 'var(--message-agent-bg)',
    borderColor: 'var(--message-agent-border)',
    boxShadow: 'var(--message-shadow)',
  },

  enhancedMessageBubbleUser: {
    backgroundColor: 'var(--message-user-bg)',
    borderColor: 'var(--message-user-border)',
    color: 'var(--message-user-text)',
    borderRadius: 'var(--radius-lg)',
    textAlign: 'left'
  },

  emptyAssistantMessage: {
    minHeight: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--ds-text-secondary)',
    fontSize: '12px',
    fontWeight: 500
  },

  emptyAssistantPulse: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--ds-text-tertiary)',
    animation: 'pulse 1.6s ease-in-out infinite',
    flexShrink: 0,
  },

  streamingBubble: {
    width: 'min(780px, 86%)',
    minWidth: '220px',
    padding: '11px 13px',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--message-agent-border)',
    backgroundColor: 'var(--message-agent-bg)',
    boxShadow: 'var(--message-shadow)',
    fontSize: '14px',
    lineHeight: 1.68,
    animation: 'streamingEdge 1.8s ease-in-out infinite'
  },

  streamingBubbleActive: {
    backgroundColor: 'var(--message-agent-bg)',
    borderColor: 'var(--ds-brand-s2)'
  },

  streamingStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    marginBottom: '10px',
    color: 'var(--ds-text-secondary)',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: 0
  },

  streamingStatusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--ds-brand)',
    boxShadow: '0 0 0 4px var(--ds-brand-soft)'
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
    backgroundColor: 'var(--ds-text-secondary)',
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
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--ds-bg-overlay-l1)',
    animation: 'streamingSkeleton 1.2s ease-in-out infinite'
  },

  // 分隔线
  subtleDivider: {
    height: '1px',
    backgroundColor: 'var(--ds-border-l1)',
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
