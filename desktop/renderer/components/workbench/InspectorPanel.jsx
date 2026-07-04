import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n.js';
import { Button, Icon, Panel } from '../ui/index.js';
import { TabGroup, TabItem } from '../ui/Tab.jsx';
import { LAYOUT } from '../../app/config/index.js';
import { styles } from '../../app/styles.js';
import {
  PLAN_PHASE_LABELS,
  PLAN_ARCHITECTURE_LABELS,
  getPlanModeLabel,
  getPlanShapeLabel,
  formatPlanStrategyValue,
  groupPlanTasksByPhase,
} from '../message-log/utils/plan-display.js';
import { styles as planStyles } from '../message-log/styles/MessageLog.styles.js';

const SESSION_STATUS_COLORS = {
  running: 'var(--primary-color)',
  complete: 'var(--success-color)',
  error: 'var(--error-color)',
  interrupted: 'var(--warning-color)',
  pending: 'var(--text-muted)',
  unknown: 'var(--text-dark)',
};

const historyStyles = {
  container: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-sm)',
    padding: 'var(--spacing-sm) var(--spacing-md)',
    borderBottom: '1px solid var(--ds-border-l1)',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    height: '32px',
    padding: '0 var(--spacing-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-primary)',
    fontSize: 'var(--font-size-sm)',
    outline: 'none',
    transition: 'all var(--transition-fast)',
  },
  searchInputFocused: {
    border: '1px solid var(--ds-brand)',
    boxShadow: 'var(--focus-ring-soft)',
  },
  actionButton: {
    height: '32px',
    padding: '0 var(--spacing-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-secondary)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    transition: 'all var(--transition-fast)',
    flexShrink: 0,
  },
  actionButtonDanger: {
    color: 'var(--ds-status-error)',
  },
  listContainer: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 'var(--spacing-sm)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sessionItem: {
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--ds-bg-secondary)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    border: '1px solid transparent',
    position: 'relative',
  },
  sessionItemHover: {
    backgroundColor: 'var(--ds-bg-tertiary)',
  },
  sessionItemActive: {
    backgroundColor: 'var(--ds-brand-soft)',
    border: '1px solid var(--ds-brand-border)',
  },
  sessionItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  sessionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    color: 'var(--ds-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sessionMeta: {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--ds-text-tertiary)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sessionActions: {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    gap: '2px',
    opacity: '0',
    transition: 'opacity 0.15s',
  },
  sessionActionsVisible: {
    opacity: '1',
  },
  iconButton: {
    padding: '4px 6px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--ds-text-tertiary)',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all var(--transition-fast)',
  },
  iconButtonDanger: {
    color: 'var(--ds-status-error)',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
    color: 'var(--ds-text-tertiary)',
    fontSize: 'var(--font-size-sm)',
  },
  emptyIcon: {
    fontSize: '32px',
    marginBottom: '8px',
    opacity: '0.3',
  },
  loadingSkeleton: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: 'var(--spacing-sm)',
  },
  skeletonItem: {
    height: '48px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--ds-bg-tertiary)',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  loadMoreButton: {
    width: '100%',
    padding: '8px',
    marginTop: '8px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-tertiary)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-xs)',
    transition: 'all var(--transition-fast)',
  },
  spinner: {
    width: '16px',
    height: '16px',
    margin: '12px auto',
    border: '2px solid var(--ds-border-l1)',
    borderTopColor: 'var(--ds-brand)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  activeBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--ds-brand)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    flexShrink: 0,
  },
};

function HistoryTab({
  sessions,
  activeSessionId,
  loading,
  hasMore,
  searchQuery,
  onSearchChange,
  onSwitchSession,
  onNewSession,
  onDeleteSession,
  onForkSession,
  onClearHistory,
  onLoadMore,
}) {
  const [hoveredItem, setHoveredItem] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const getSessionStatusColor = (session) => {
    const status = session?.status || 'unknown';
    return SESSION_STATUS_COLORS[status] || SESSION_STATUS_COLORS.unknown;
  };

  return (
    <div style={historyStyles.container}>
      <div style={historyStyles.header}>
        <input
          type="text"
          style={{
            ...historyStyles.searchInput,
            ...(searchFocused ? historyStyles.searchInputFocused : {}),
          }}
          placeholder="搜索会话..."
          value={searchQuery || ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
        <button
          style={historyStyles.actionButton}
          onClick={onNewSession}
          title="新建会话"
        >
          + 新建
        </button>
        <button
          style={{
            ...historyStyles.actionButton,
            ...(sessions.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          }}
          onClick={onClearHistory}
          disabled={sessions.length === 0}
          title="清空所有会话"
        >
          清空
        </button>
      </div>

      <div style={historyStyles.listContainer}>
        {loading && sessions.length === 0 ? (
          <div style={historyStyles.loadingSkeleton}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={historyStyles.skeletonItem} />
            ))}
          </div>
        ) : (
          <div style={historyStyles.list}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isHovered = hoveredItem === session.id;
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  style={{
                    ...historyStyles.sessionItem,
                    ...(isActive ? historyStyles.sessionItemActive : {}),
                    ...(isHovered && !isActive ? historyStyles.sessionItemHover : {}),
                  }}
                  onClick={() => onSwitchSession?.(session.id)}
                  onMouseEnter={() => setHoveredItem(session.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSwitchSession?.(session.id);
                    }
                  }}
                  title={'切换到会话: ' + (session.title || session.id)}
                >
                  <div style={historyStyles.sessionItemHeader}>
                    <span
                      style={{
                        ...historyStyles.statusDot,
                        backgroundColor: getSessionStatusColor(session),
                      }}
                    />
                    <span style={historyStyles.sessionTitle}>
                      {session.title || '(未命名会话)'}
                    </span>
                    {isActive && <span style={historyStyles.activeBadge}>当前</span>}
                  </div>
                  <div style={historyStyles.sessionMeta}>
                    <span>
                      {session.updatedAt ? new Date(session.updatedAt).toLocaleString() : ''}
                    </span>
                    <span>
                      {session.messages ? session.messages.length : 0} 条消息
                    </span>
                  </div>
                  <div
                    style={{
                      ...historyStyles.sessionActions,
                      ...(isHovered || isActive ? historyStyles.sessionActionsVisible : {}),
                    }}
                  >
                    <button
                      style={historyStyles.iconButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onForkSession?.(session.id);
                      }}
                      title="分叉会话"
                    >
                      🔀
                    </button>
                    {onDeleteSession && (
                      <button
                        style={{ ...historyStyles.iconButton, ...historyStyles.iconButtonDanger }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession?.(session.id);
                        }}
                        title="删除会话"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {sessions.length === 0 && !loading && (
              <div style={historyStyles.emptyState}>
                <div style={historyStyles.emptyIcon}>📜</div>
                <div>暂无会话</div>
                <div style={{ fontSize: 'var(--font-size-xs)', marginTop: '4px' }}>
                  发送一条消息后会自动创建
                </div>
              </div>
            )}
          </div>
        )}

        {hasMore && !loading && (
          <button
            style={historyStyles.loadMoreButton}
            onClick={onLoadMore}
          >
            加载更多
          </button>
        )}

        {loading && sessions.length > 0 && (
          <div style={historyStyles.spinner} />
        )}
      </div>
    </div>
  );
}

/* ── Plan Tab：右侧面板展示执行计划 ── */
function PlanTab({ messages }) {
  // 从消息中找到最新的 plan 消息
  const planMessages = (messages || []).filter((msg) => msg.type === 'plan');
  const latestPlanMsg = planMessages.length > 0 ? planMessages[planMessages.length - 1] : null;
  const allSnapshots = latestPlanMsg?.planSnapshots || [];
  const latestFrame = allSnapshots.length > 0 ? allSnapshots[allSnapshots.length - 1] : null;

  if (!latestFrame) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--spacing-md)' }}>
        <div style={{ color: 'var(--ds-text-tertiary)', fontSize: 'var(--font-size-sm)', textAlign: 'center', paddingTop: '40px' }}>
          <Icon name="plan" size={24} style={{ opacity: 0.3, display: 'block', margin: '0 auto 8px' }} />
          {t('plan.title', {}, '执行计划')} — {t('status.not_set', {}, '暂无')}
        </div>
      </div>
    );
  }

  const planTasks = latestFrame.planTasks || [];
  const progress = latestFrame.planProgress || {};
  const plan = latestFrame.plan || {};
  const strategy = plan.strategy || plan.context?.strategy || {};
  const modeLabel = getPlanModeLabel(plan);
  const shapeLabel = getPlanShapeLabel(plan, planTasks);
  const architectureId = strategy.planningArchitecture || strategy.architecture;
  const architecture = strategy.planningArchitectureLabel || PLAN_ARCHITECTURE_LABELS[architectureId] || formatPlanStrategyValue(architectureId);
  const decomposition = String(strategy.decomposition || plan?.context?.decomposition || '').toLowerCase();
  const phaseGroups = groupPlanTasksByPhase(planTasks);
  const title = latestFrame.content || latestPlanMsg?.content || t('plan.title', {}, '执行计划');

  const statusTone = progress.failed > 0 ? 'var(--ds-status-error)'
    : progress.needsRepair > 0 ? 'var(--ds-status-warning)'
    : progress.completed === progress.total && progress.total > 0 ? 'var(--ds-status-success)'
    : 'var(--ds-status-warning)';

  const summaryItems = [
    { label: t('plan.status.completed', {}, '已完成'), value: `${progress.completed || 0}/${progress.total || planTasks.length}` },
    { label: t('plan.strategy.mode', {}, '架构'), value: architecture || modeLabel },
    ...(decomposition ? [{ label: '分解', value: decomposition === 'llm' ? 'LLM' : '模板' }] : []),
    { label: '进度', value: `${progress.progress ?? 0}%` },
  ];

  const strategyTags = [
    strategy.planningArchitectureLabel || formatPlanStrategyValue(strategy.planningArchitecture),
    strategy.verificationStrength ? `验证 ${formatPlanStrategyValue(strategy.verificationStrength)}` : null,
    strategy.parallelPotential ? `并行 ${formatPlanStrategyValue(strategy.parallelPotential)}` : null,
    strategy.recommendedReview || null,
  ].filter(Boolean);

  const statusColorFor = (sv) => {
    if (sv === 'completed') return 'var(--ds-status-success)';
    if (sv === 'running') return 'var(--ds-status-warning)';
    if (sv === 'needs_repair') return 'var(--ds-status-warning)';
    if (sv === 'failed') return 'var(--ds-status-error)';
    return 'var(--ds-text-tertiary)';
  };

  const dotStyleFor = (sv) => ({
    ...planStyles.planTimelineDot,
    ...(sv === 'completed' ? planStyles.planTimelineDotDone : {}),
    ...(sv === 'running' ? planStyles.planTimelineDotRunning : {}),
    ...(sv === 'needs_repair' ? planStyles.planTimelineDotRepair : {}),
    ...(sv === 'failed' ? planStyles.planTimelineDotFailed : {}),
  });

  const taskStatusValue = (task) => String(task.displayStatus || task.status || 'pending').toLowerCase();
  const phaseLabelMap = { pending: '未开始', running: '进行中', completed: '已完成', needs_repair: '需修复', failed: '失败' };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--spacing-sm)' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
        <div style={{ ...planStyles.actionIconBox, ...planStyles.planIconBox }}>
          <Icon name="plan" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--ds-text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--ds-text-secondary)', fontWeight: 400 }}>
            {modeLabel} · {architecture}
          </div>
        </div>
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--ds-font-mono)', color: statusTone, flexShrink: 0 }}>
          {progress.progress ?? 0}%
        </span>
      </div>

      {/* 摘要指标 */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(summaryItems.length, 4)}, 1fr)`, gap: 'var(--spacing-xs)', marginBottom: 'var(--spacing-sm)' }}>
        {summaryItems.map((item) => (
          <div key={item.label} style={planStyles.planSummaryCard}>
            <span style={planStyles.planSummaryLabel}>{item.label}</span>
            <span style={planStyles.planSummaryValue}>{item.value}</span>
          </div>
        ))}
      </div>

      {/* 状态 tags */}
      {((latestFrame.planUpdate || strategy.dynamicReplanning) || progress.running > 0 || progress.needsRepair > 0) && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: 'var(--spacing-sm)' }}>
          {(latestFrame.planUpdate || strategy.dynamicReplanning) && <span style={{ ...planStyles.planTag, ...planStyles.planTagBrand }}>动态重规划</span>}
          {progress.running > 0 && <span style={planStyles.planTag}>进行中</span>}
          {progress.needsRepair > 0 && <span style={{ ...planStyles.planTag, ...planStyles.planTagWarning }}>需修复</span>}
        </div>
      )}

      {/* 帧计数 */}
      {allSnapshots.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', padding: '3px var(--spacing-xs)', marginBottom: 'var(--spacing-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--ds-border-l1)', background: 'var(--ds-bg-secondary)', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--ds-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          <span>进度帧 {allSnapshots.length}</span>
          <span style={{ marginLeft: 'auto' }}>{latestFrame.timestamp ? new Date(latestFrame.timestamp).toLocaleTimeString() : ''}</span>
        </div>
      )}

      {/* 进度条 */}
      <div style={planStyles.planProgressTrack}>
        <div style={{ ...planStyles.planProgressFill, width: `${Math.max(4, progress.progress || 0)}%`, backgroundColor: statusTone }} />
      </div>

      {/* 策略 tags */}
      {strategyTags.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: 'var(--spacing-sm)' }}>
          {strategyTags.map((item) => (
            <span key={item} style={planStyles.planTag}>{item}</span>
          ))}
        </div>
      )}

      {/* 任务时间线 */}
      <div style={planStyles.planTaskList}>
        {phaseGroups.map(([phase, tasks], phaseIdx) => (
          <div key={phase} style={{ ...planStyles.planPhaseGroup, ...(phaseIdx === 0 ? planStyles.planPhaseGroupFirst : {}) }}>
            <div style={planStyles.planPhaseHeader}>
              <span>{typeof PLAN_PHASE_LABELS[phase] === 'function' ? PLAN_PHASE_LABELS[phase]() : PLAN_PHASE_LABELS[phase] || phase}</span>
              <span style={{ ...planStyles.planTag, ...(tasks.filter((t) => taskStatusValue(t) === 'completed').length === tasks.length ? planStyles.planTagSuccess : {}) }}>
                {tasks.filter((t) => taskStatusValue(t) === 'completed').length}/{tasks.length}
              </span>
            </div>
            {tasks.map((task, taskIndex) => {
              const sv = taskStatusValue(task);
              const isLast = taskIndex === tasks.length - 1;
              const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
              return (
                <div key={task.id || `${phase}-${taskIndex}`} style={planStyles.planTimelineRow}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                    <span style={dotStyleFor(sv)} />
                    {!isLast && <div style={planStyles.planTimelineLine} />}
                  </div>
                  <div style={planStyles.planTaskContent}>
                    <span style={planStyles.planTaskName} title={task.statusReason || task.description || task.name}>
                      {task.name || task.id || 'Task'}
                      {task.cycleLabel ? <span style={planStyles.planTaskDependency}> · {task.cycleLabel}</span> : ''}
                      {deps.length > 0 ? <span style={planStyles.planTaskDependency}>依赖 {deps.length}</span> : null}
                    </span>
                    <span style={{ ...planStyles.planTaskStatus, color: statusColorFor(sv) }}>
                      {phaseLabelMap[sv] || sv}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function RagTab({
  ipc,
  fileServerUrl,
  ragDocs,
  ragStatus,
  workingDirectory,
  onAddDocuments,
  onInitializeIndex,
  onOpenExternal,
  onRemoveDocument,
  onInsertDocSearch,
  onResetRag,
}) {
  const [selectedKey, setSelectedKey] = useState('');
  const selectedDoc = useMemo(() => {
    if (ragDocs.length === 0) {return null;}
    return ragDocs.find((doc, index) => getRagDocKey(doc, index) === selectedKey) || ragDocs[0];
  }, [ragDocs, selectedKey]);

  useEffect(() => {
    if (ragDocs.length === 0) {
      setSelectedKey('');
      return;
    }
    if (!selectedDoc) {
      setSelectedKey(getRagDocKey(ragDocs[0], 0));
    }
  }, [ragDocs, selectedDoc]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>{t('inspector.rag_title')}</div>
        <div style={styles.inspectorHelpText}>
          {t('inspector.rag_help', {}, 'Add documents, initialize the index, then insert a document search command into chat.')}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button style={styles.button} onClick={onAddDocuments}>{t('common.upload')}</button>
          <button style={styles.button} onClick={onInitializeIndex} disabled={ragDocs.length === 0}>{t('common.init')}</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ fontSize: '12px' }}>{t('common.status')}:</div>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>{ragStatus}</div>
        </div>
      </div>

      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>{t('inspector.sessions')}</div>
        {ragDocs.length === 0 ? (
          <div style={{ ...styles.summaryItem, ...styles.summaryItemEmpty }}>{t('status.not_set')}</div>
        ) : (
          ragDocs.map((doc, index) => (
            <div
              key={`${doc.id || doc.path}-${index}`}
              style={{
                ...styles.inspectorDocumentItem,
                ...(selectedDoc === doc ? { backgroundColor: 'var(--primary-soft)' } : {}),
              }}
            >
              <div style={styles.summaryItemIcon}>DOC</div>
              <button
                type="button"
                onClick={() => setSelectedKey(getRagDocKey(doc, index))}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                <div style={styles.inspectorDocumentName}>{doc.name}</div>
                <div style={styles.inspectorDocumentPath}>{doc.path}</div>
              </button>
              <button
                style={styles.button}
                onClick={() => onRemoveDocument(doc, index)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <RagDocumentPreview
        doc={selectedDoc}
        ipc={ipc}
        fileServerUrl={fileServerUrl}
        workingDirectory={workingDirectory}
        onOpenExternal={onOpenExternal}
      />

      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>{t('common.ok')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button style={styles.button} onClick={onInsertDocSearch}>{t('inspector.insert_doc_search', {}, 'Insert doc search')}</button>
          <button style={styles.button} onClick={onResetRag} disabled={!ipc.processInput && ragDocs.length === 0}>{t('common.reset', {}, 'Reset')}</button>
        </div>
      </div>
    </div>
  );
}

function RagDocumentPreview({ doc, ipc, fileServerUrl, workingDirectory, onOpenExternal }) {
  const [textPreview, setTextPreview] = useState({ status: 'idle', content: '', error: '' });
  const source = doc?.path || doc?.source || '';
  const previewKind = getPreviewKind(source, doc?.kind);
  const previewUrl = getRagPreviewUrl(source, workingDirectory, fileServerUrl);
  const canOpenInBrowser = /^(?:https?:\/\/|file:\/\/)/i.test(previewUrl || source);

  useEffect(() => {
    let cancelled = false;
    async function loadTextPreview() {
      if (!doc || previewKind !== 'text' || previewUrl.startsWith('file://')) {
        setTextPreview({ status: 'idle', content: '', error: '' });
        return;
      }
      if (!source || /^https?:\/\//i.test(source) || !ipc?.readWorkspaceFile) {
        setTextPreview({
          status: 'error',
          content: '',
          error: '此文档不在当前工作区内，无法读取文本预览。',
        });
        return;
      }
      setTextPreview({ status: 'loading', content: '', error: '' });
      try {
        const result = await ipc.readWorkspaceFile(source, { maxBytes: 512 * 1024 });
        if (cancelled) {return;}
        if (!result?.success) {
          setTextPreview({
            status: 'error',
            content: '',
            error: result?.error || '读取预览失败。',
          });
          return;
        }
        setTextPreview({
          status: 'ready',
          content: result.content || '',
          error: '',
        });
      } catch (error) {
        if (!cancelled) {
          setTextPreview({ status: 'error', content: '', error: error.message || '读取预览失败。' });
        }
      }
    }
    loadTextPreview();
    return () => {
      cancelled = true;
    };
  }, [doc, ipc, previewKind, previewUrl, source]);

  if (!doc) {
    return null;
  }

  return (
    <div style={styles.summarySection}>
      <div style={styles.summarySectionTitle}>文档预览</div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.inspectorDocumentName}>{doc.name}</div>
          <div style={styles.inspectorDocumentPath}>{source}</div>
        </div>
        <button
          style={styles.button}
          disabled={!canOpenInBrowser}
          onClick={() => onOpenExternal?.(previewUrl || source)}
        >
          {t('common.browser')}
        </button>
      </div>
      {renderRagPreviewBody({ previewKind, previewUrl, source, textPreview })}
    </div>
  );
}

function renderRagPreviewBody({ previewKind, previewUrl, source, textPreview }) {
  if (previewKind === 'remote' || previewKind === 'pdf' || previewKind === 'html') {
    if (!previewUrl) {
      return <div style={previewEmptyStyle}>此文件不在当前工作区内，无法内嵌预览。</div>;
    }
    return (
      <iframe
        title="rag-document-preview"
        src={previewUrl}
        style={{ ...styles.previewFrame, minHeight: '320px', borderRadius: '6px' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
    );
  }

  if (previewKind === 'image') {
    if (!previewUrl) {
      return <div style={previewEmptyStyle}>此图片不在当前工作区内，无法内嵌预览。</div>;
    }
    return (
      <div style={imagePreviewShellStyle}>
        <img src={previewUrl} alt={source} style={imagePreviewStyle} />
      </div>
    );
  }

  if (previewKind === 'text') {
    if (previewUrl && previewUrl.startsWith('file://')) {
      return (
        <iframe
          title="rag-text-preview"
          src={previewUrl}
          style={{ ...styles.previewFrame, minHeight: '320px', borderRadius: '6px' }}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
        />
      );
    }
    if (textPreview.status === 'loading') {
      return <div style={previewEmptyStyle}>{t('common.loading')}</div>;
    }
    if (textPreview.status === 'error') {
      return <div style={previewEmptyStyle}>{textPreview.error}</div>;
    }
    return <pre style={textPreviewStyle}>{textPreview.content || '（空文档）'}</pre>;
  }

  return (
    <div style={previewEmptyStyle}>
      暂不支持内嵌预览此类型。可使用 RAG 搜索查看已索引内容。
    </div>
  );
}

function getRagDocKey(doc, index) {
  return doc?.id || doc?.path || doc?.name || String(index);
}

function getPreviewKind(source, kind) {
  if (/^https?:\/\//i.test(source || '')) {return 'remote';}
  const ext = String(source || '').split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  if (kind === 'pdf' || ext === 'pdf') {return 'pdf';}
  if (kind === 'html' || ['html', 'htm'].includes(ext)) {return 'html';}
  if (kind === 'image' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) {
    return 'image';
  }
  if (['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yaml', 'yml'].includes(ext)) {
    return 'text';
  }
  if (['text', 'markdown', 'json'].includes(kind)) {return 'text';}
  return 'unsupported';
}

function getRagPreviewUrl(source, workingDirectory, fileServerUrl) {
  if (!source) {return '';}
  if (/^https?:\/\//i.test(source)) {return source;}

  let relative = '';
  const cleanSource = String(source).replace(/\\/g, '/');
  const cleanWorkingDirectory = String(workingDirectory || '').replace(/\\/g, '/').replace(/\/$/, '');
  if (/^[a-zA-Z]:\//.test(cleanSource) || cleanSource.startsWith('/')) {
    if (fileServerUrl && cleanWorkingDirectory && cleanSource.startsWith(cleanWorkingDirectory + '/')) {
      relative = cleanSource.slice(cleanWorkingDirectory.length + 1);
      const base = fileServerUrl.replace(/\/$/, '');
      return `${base}/${relative.split('/').map(encodeURIComponent).join('/')}`;
    }
    return `file://${cleanSource.startsWith('/') ? '' : '/'}${cleanSource}`;
  } else {
    relative = cleanSource.replace(/^\.?\//, '');
  }

  if (!fileServerUrl) {return '';}
  const base = fileServerUrl.replace(/\/$/, '');
  return `${base}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

const previewEmptyStyle = {
  padding: '18px',
  color: 'var(--text-muted)',
  fontSize: '13px',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  backgroundColor: 'var(--surface-color)',
};

const textPreviewStyle = {
  ...previewEmptyStyle,
  maxHeight: '360px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
};

const imagePreviewShellStyle = {
  ...previewEmptyStyle,
  padding: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '240px',
};

const imagePreviewStyle = {
  maxWidth: '100%',
  maxHeight: '420px',
  objectFit: 'contain',
  borderRadius: '4px',
};

function PreviewTab({
  activePreviewUrl,
  previewFrameKey,
  previewSession,
  previewStatus,
  previewUrlDraft,
  inspectorExpanded,
  ipc,
  onRefreshFrame,
  onOpenExternal,
  onExpandToggle,
  onStartPreview,
  onStopPreview,
  onPreviewUrlDraftChange,
  onPreviewUrlSubmit,
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={styles.previewHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.inspectorKicker}>{t('chat.preview')}</div>
          <div style={styles.previewUrlLine}>
            {activePreviewUrl ? (
              <a
                href={activePreviewUrl}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenExternal(activePreviewUrl);
                }}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.previewUrlLink}
                title={t('inspector.open_external')}
              >
                {activePreviewUrl}
              </a>
            ) : (
              previewStatus === 'starting' ? t('common.loading') : t('status.not_set')
            )}
          </div>
        </div>
        <button style={styles.button} onClick={onRefreshFrame} disabled={!activePreviewUrl}>{t('common.refresh')}</button>
        <button style={styles.button} onClick={() => activePreviewUrl && onOpenExternal(activePreviewUrl)} disabled={!activePreviewUrl}>{t('common.browser')}</button>
        <button
          style={styles.iconButton}
          onClick={onExpandToggle}
          title={inspectorExpanded ? t('inspector.restore') : t('inspector.expand')}
          aria-label={inspectorExpanded ? t('inspector.restore') : t('inspector.expand')}
        >
          <Icon name={inspectorExpanded ? 'restore' : 'expand'} size={15} />
        </button>
        {previewSession?.session_id ? (
          <button style={styles.button} onClick={onStopPreview}>{t('ui.stop')}</button>
        ) : (
          <button style={styles.button} onClick={() => onStartPreview('.')}>{t('common.start')}</button>
        )}
      </div>

      <form style={styles.previewUrlForm} onSubmit={onPreviewUrlSubmit}>
        <input
          style={styles.previewUrlInput}
          value={previewUrlDraft}
          onChange={(event) => onPreviewUrlDraftChange(event.target.value)}
          placeholder={t('inspector.preview_url_placeholder')}
        />
        <button style={styles.button} type="submit">Go</button>
      </form>

      {previewSession?.pipeline?.length ? (
        <div style={styles.previewPipeline}>
          {previewSession.pipeline.map((stage) => (
            <div
              key={`${stage.name}-${stage.command}`}
              title={stage.command}
              style={{
                ...styles.previewPipelineStage,
                color: stage.status === 'failed' ? 'var(--error-color)' : 'var(--text-muted)',
                backgroundColor: stage.status === 'running' ? 'var(--info-faint)' : 'var(--surface-color)',
              }}
            >
              {stage.name}: {stage.status}
            </div>
          ))}
        </div>
      ) : null}

      {activePreviewUrl ? (
        <iframe
          key={previewFrameKey}
          title="workspace-preview"
          src={activePreviewUrl}
          style={styles.previewFrame}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div style={{
          padding: '18px',
          color: previewStatus === 'error' ? 'var(--error-color)' : 'var(--text-muted)',
          fontSize: '13px'
        }}>
          {previewStatus === 'error'
            ? t('common.failed')
            : t('status.not_set')}
        </div>
      )}
    </div>
  );
}

export function InspectorPanel({
  activeInspectorTab,
  activePreviewUrl,
  fileServerUrl,
  inspectorExpanded,
  inspectorPanelWidth,
  ipc,
  messages,
  previewFrameKey,
  previewSession,
  previewStatus,
  previewUrlDraft,
  ragDocs,
  ragStatus,
  sessions,
  activeSessionId,
  sessionLoading,
  sessionHasMore,
  sessionSearchQuery,
  workingDirectory,
  onAddDocuments,
  onClearHistory,
  onDeleteSession,
  onExpandToggle,
  onForkSession,
  onInitializeIndex,
  onInsertDocSearch,
  onLoadMoreSessions,
  onNewSession,
  onOpenExternal,
  onPreviewUrlDraftChange,
  onPreviewUrlSubmit,
  onRefreshFrame,
  onRemoveDocument,
  onResetRag,
  onResizeStart,
  onSearchSessions,
  onStartPreview,
  onStopPreview,
  onSwitchSession,
  onTabChange,
}) {
  return (
    <Panel
      variant="inspector"
      collapsed={false}
      width={inspectorPanelWidth}
      ariaLabel="inspector-panel"
      style={{
        minWidth: `${LAYOUT.inspectorMinWidth}px`,
        maxWidth: `${LAYOUT.inspectorMaxWidth}px`,
      }}
    >
      <div
        style={styles.inspectorResizeHandle}
        onPointerDown={onResizeStart}
        title={t('inspector.drag_resize')}
        role="separator"
        aria-orientation="vertical"
      />
      <div style={styles.inspectorHeader}>
        <TabGroup activeTab={activeInspectorTab} onChange={onTabChange}>
          <TabItem id="plan">Plan</TabItem>
          <TabItem id="history">History</TabItem>
          <TabItem id="rag">RAG</TabItem>
          <TabItem id="preview">Preview</TabItem>
        </TabGroup>
        <Button
          variant="icon"
          size="sm"
          onClick={onExpandToggle}
          title={inspectorExpanded ? t('inspector.restore') : t('inspector.expand')}
          ariaLabel={inspectorExpanded ? t('inspector.restore') : t('inspector.expand')}
        >
          <Icon name={inspectorExpanded ? 'restore' : 'expand'} size={15} />
        </Button>
      </div>

      {activeInspectorTab === 'plan' && (
        <PlanTab messages={messages} />
      )}

      {activeInspectorTab === 'history' && (
        <HistoryTab
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={sessionLoading}
          hasMore={sessionHasMore}
          searchQuery={sessionSearchQuery}
          onSearchChange={onSearchSessions}
          onSwitchSession={onSwitchSession}
          onNewSession={onNewSession}
          onDeleteSession={onDeleteSession}
          onForkSession={onForkSession}
          onClearHistory={onClearHistory}
          onLoadMore={onLoadMoreSessions}
        />
      )}

      {activeInspectorTab === 'rag' && (
        <RagTab
          ipc={ipc}
          fileServerUrl={fileServerUrl}
          ragDocs={ragDocs}
          ragStatus={ragStatus}
          workingDirectory={workingDirectory}
          onAddDocuments={onAddDocuments}
          onInitializeIndex={onInitializeIndex}
          onInsertDocSearch={onInsertDocSearch}
          onOpenExternal={onOpenExternal}
          onRemoveDocument={onRemoveDocument}
          onResetRag={onResetRag}
        />
      )}
      {activeInspectorTab === 'preview' && (
        <PreviewTab
          activePreviewUrl={activePreviewUrl}
          previewFrameKey={previewFrameKey}
          previewSession={previewSession}
          previewStatus={previewStatus}
          previewUrlDraft={previewUrlDraft}
          inspectorExpanded={inspectorExpanded}
          ipc={ipc}
          onRefreshFrame={onRefreshFrame}
          onOpenExternal={onOpenExternal}
          onExpandToggle={onExpandToggle}
          onStartPreview={onStartPreview}
          onStopPreview={onStopPreview}
          onPreviewUrlDraftChange={onPreviewUrlDraftChange}
          onPreviewUrlSubmit={onPreviewUrlSubmit}
        />
      )}
    </Panel>
  );
}
