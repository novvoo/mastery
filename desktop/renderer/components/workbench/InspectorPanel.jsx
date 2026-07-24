import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
import { buildExecutionOverviewProjection } from '../../runtime/message-graph.js';
import { useActionLifecycleContext, useActionState } from '../../contexts/ActionLifecycleContext.jsx';
import { UI_ACTION_STATUS } from '../../app/actions/ui-action-graph.js';

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
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    flexShrink: 0,
    accentColor: 'var(--ds-brand)',
  },
  bulkActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-sm)',
    padding: 'var(--spacing-sm) var(--spacing-md)',
    borderBottom: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
    flexShrink: 0,
    fontSize: 'var(--font-size-sm)',
    color: 'var(--ds-text-secondary)',
  },
  bulkActionsText: {
    flex: 1,
    fontSize: 'var(--font-size-sm)',
  },
  bulkDeleteButton: {
    padding: '4px 10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-status-error)',
    backgroundColor: 'transparent',
    color: 'var(--ds-status-error)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-xs)',
    transition: 'all var(--transition-fast)',
  },
  selectAllButton: {
    padding: '4px 10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--ds-border-l1)',
    backgroundColor: 'var(--ds-bg-secondary)',
    color: 'var(--ds-text-secondary)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-xs)',
    transition: 'all var(--transition-fast)',
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
  onDeleteSessions,
  onForkSession,
  onClearHistory,
  onLoadMore,
}) {
  const [hoveredItem, setHoveredItem] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { executeActionWithFeedback } = useActionLifecycleContext();

  const newSessionState = useActionState('session.new');
  const clearHistoryState = useActionState('session.clear-history');
  const bulkDeleteState = useActionState('session.bulk-delete');
  const loadMoreState = useActionState('session.load-more');

  const getSessionStatusColor = (session) => {
    const status = session?.status || 'unknown';
    return SESSION_STATUS_COLORS[status] || SESSION_STATUS_COLORS.unknown;
  };

  const selectableIds = sessions.map((s) => s.id).filter(Boolean);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelect = (sessionId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await executeActionWithFeedback(
      'session.bulk-delete',
      async () => {
        if (typeof onDeleteSessions === 'function') {
          await onDeleteSessions(ids);
        } else {
          for (const id of ids) {
            await onDeleteSession?.(id);
          }
        }
      },
      { successMessage: `已删除 ${ids.length} 个会话`, failureMessage: '删除会话失败' },
    );
    setSelectedIds(new Set());
  }, [selectedIds, onDeleteSessions, onDeleteSession, executeActionWithFeedback]);

  const handleNewSession = useCallback(() => {
    executeActionWithFeedback(
      'session.new',
      async () => { onNewSession?.(); },
      { successMessage: '新会话已创建', failureMessage: '创建会话失败' },
    );
  }, [onNewSession, executeActionWithFeedback]);

  const handleClearHistory = useCallback(() => {
    executeActionWithFeedback(
      'session.clear-history',
      async () => { onClearHistory?.(); },
      { successMessage: '会话历史已清空', failureMessage: '清空历史失败' },
    );
  }, [onClearHistory, executeActionWithFeedback]);

  const handleLoadMore = useCallback(() => {
    executeActionWithFeedback(
      'session.load-more',
      async () => { onLoadMore?.(); },
      { successMessage: '', failureMessage: '加载更多失败' },
    );
  }, [onLoadMore, executeActionWithFeedback]);

  const handleDeleteSession = useCallback((sessionId) => {
    executeActionWithFeedback(
      'session.delete',
      async () => { onDeleteSession?.(sessionId); },
      { successMessage: '会话已删除', failureMessage: '删除会话失败' },
    );
  }, [onDeleteSession, executeActionWithFeedback]);

  const handleForkSession = useCallback((sessionId) => {
    executeActionWithFeedback(
      'session.fork',
      async () => { onForkSession?.(sessionId); },
      { successMessage: '会话已分叉', failureMessage: '分叉会话失败' },
    );
  }, [onForkSession, executeActionWithFeedback]);

  const handleSwitchSession = useCallback((sessionId) => {
    executeActionWithFeedback(
      'session.switch',
      async () => { onSwitchSession?.(sessionId); },
      { successMessage: '', failureMessage: '切换会话失败' },
    );
  }, [onSwitchSession, executeActionWithFeedback]);

  // 切换会话或会话列表变化时清除选择
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeSessionId, searchQuery]);

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
          onClick={handleNewSession}
          disabled={newSessionState.status === UI_ACTION_STATUS.RUNNING || newSessionState.status === UI_ACTION_STATUS.BLOCKED}
          title={newSessionState.reason || '新建会话'}
          data-action-id="session.new"
          aria-busy={newSessionState.status === UI_ACTION_STATUS.RUNNING || undefined}
        >
          {newSessionState.status === UI_ACTION_STATUS.RUNNING ? '...' : '+ 新建'}
        </button>
        <button
          style={{
            ...historyStyles.actionButton,
            ...(sessions.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          }}
          onClick={handleClearHistory}
          disabled={sessions.length === 0 || clearHistoryState.status === UI_ACTION_STATUS.RUNNING}
          title={clearHistoryState.reason || '清空所有会话'}
          data-action-id="session.clear-history"
          aria-busy={clearHistoryState.status === UI_ACTION_STATUS.RUNNING || undefined}
        >
          {clearHistoryState.status === UI_ACTION_STATUS.RUNNING ? '...' : '清空'}
        </button>
      </div>

      {sessions.length > 0 && (
        <div style={historyStyles.bulkActions}>
          <input
            type="checkbox"
            style={historyStyles.checkbox}
            checked={allSelected}
            onChange={toggleSelectAll}
            title={allSelected ? '取消全选' : '全选'}
          />
          <span style={historyStyles.bulkActionsText}>
            已选 {selectedIds.size} 项
          </span>
          {selectedIds.size > 0 && (
            <button
              style={historyStyles.bulkDeleteButton}
              onClick={handleBulkDelete}
              disabled={bulkDeleteState.status === UI_ACTION_STATUS.RUNNING}
              title="删除选中的会话"
              data-action-id="session.bulk-delete"
              aria-busy={bulkDeleteState.status === UI_ACTION_STATUS.RUNNING || undefined}
            >
              {bulkDeleteState.status === UI_ACTION_STATUS.RUNNING ? '...' : '删除所选'}
            </button>
          )}
        </div>
      )}

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
              const isSelected = selectedIds.has(session.id);
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  style={{
                    ...historyStyles.sessionItem,
                    ...(isActive ? historyStyles.sessionItemActive : {}),
                    ...(isHovered && !isActive ? historyStyles.sessionItemHover : {}),
                    ...(isSelected && !isActive ? { backgroundColor: 'var(--ds-brand-soft)' } : {}),
                  }}
                  onClick={() => handleSwitchSession(session.id)}
                  onMouseEnter={() => setHoveredItem(session.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSwitchSession(session.id);
                    }
                  }}
                  title={'切换到会话: ' + (session.title || session.id)}
                >
                  <div style={historyStyles.sessionItemHeader}>
                    <input
                      type="checkbox"
                      style={historyStyles.checkbox}
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(session.id)}
                      title="选择会话"
                    />
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
                      ...(isHovered || isActive || isSelected ? historyStyles.sessionActionsVisible : {}),
                    }}
                  >
                    <button
                      style={historyStyles.iconButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleForkSession(session.id);
                      }}
                      title="分叉会话"
                      data-action-id="session.fork"
                    >
                      <Icon name="timeline" size={13} />
                    </button>
                    {onDeleteSession && (
                      <button
                        style={{ ...historyStyles.iconButton, ...historyStyles.iconButtonDanger }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                        title="删除会话"
                        data-action-id="session.delete"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {sessions.length === 0 && !loading && (
              <div style={historyStyles.emptyState}>
                <Icon name="timeline" size={22} style={{ opacity: 0.35, marginBottom: '8px' }} />
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
            onClick={handleLoadMore}
            disabled={loadMoreState.status === UI_ACTION_STATUS.RUNNING}
            data-action-id="session.load-more"
            aria-busy={loadMoreState.status === UI_ACTION_STATUS.RUNNING || undefined}
          >
            {loadMoreState.status === UI_ACTION_STATUS.RUNNING ? '加载中...' : '加载更多'}
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

const executionStyles = {
  root: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '12px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '6px',
    marginBottom: '14px',
  },
  summaryCard: {
    padding: '9px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    background: 'var(--surface-raised)',
  },
  summaryLabel: {
    color: 'var(--text-muted)',
    fontSize: '10px',
  },
  summaryValue: {
    marginTop: '3px',
    fontSize: '17px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    margin: '0 2px 8px',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
  },
  activeCard: {
    padding: '12px',
    marginBottom: '14px',
    border: '1px solid var(--primary-border)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--primary-soft)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    marginBottom: '8px',
  },
  statusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusLabel: {
    color: 'var(--text-muted)',
    fontSize: '10px',
    fontWeight: 700,
  },
  request: {
    color: 'var(--text-color)',
    fontSize: '12px',
    fontWeight: 650,
    lineHeight: 1.5,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '8px',
    color: 'var(--text-muted)',
    fontSize: '10px',
  },
  step: {
    marginTop: '9px',
    padding: '8px 9px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-raised)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    lineHeight: 1.45,
  },
  response: {
    marginTop: '9px',
    paddingTop: '9px',
    borderTop: '1px solid var(--border-divider)',
    color: 'var(--text-muted)',
    fontSize: '11px',
    lineHeight: 1.5,
  },
  list: {
    display: 'grid',
    gap: '6px',
  },
  turnCard: {
    padding: '10px',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-card)',
  },
  toolRow: {
    display: 'flex',
    gap: '5px',
    marginTop: '8px',
    overflow: 'hidden',
  },
  toolChip: {
    minWidth: 0,
    maxWidth: '46%',
    padding: '3px 6px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-raised)',
    color: 'var(--text-muted)',
    fontSize: '9px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: '36px 14px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: 1.65,
  },
};

function executionStatusMeta(status) {
  if (status === 'completed') {
    return { label: '已完成', color: 'var(--success-color)' };
  }
  if (status === 'failed' || status === 'stopped') {
    return { label: status === 'stopped' ? '已停止' : '失败', color: 'var(--error-color)' };
  }
  if (status === 'waiting') {
    return { label: '等待输入', color: 'var(--warning-color)' };
  }
  return { label: '进行中', color: 'var(--warning-color)' };
}

function ExecutionTurnCard({ turn, active = false }) {
  const statusMeta = executionStatusMeta(turn.status);
  const visibleTools = turn.toolCollections.slice(-3);

  return (
    <article style={active ? executionStyles.activeCard : executionStyles.turnCard}>
      <div style={executionStyles.cardHeader}>
        <span style={{ ...executionStyles.statusDot, background: statusMeta.color }} />
        <span style={executionStyles.statusLabel}>{statusMeta.label}</span>
        {turn.toolProgress.total > 0 && (
          <span style={{ ...executionStyles.statusLabel, marginLeft: 'auto' }}>
            工具 {turn.toolProgress.completed}/{turn.toolProgress.total}
            {turn.toolProgress.failed > 0 ? ` · 失败 ${turn.toolProgress.failed}` : ''}
          </span>
        )}
      </div>
      <div style={executionStyles.request}>
        {turn.requestPreview || '未关联用户请求的运行时任务'}
      </div>
      {turn.currentStep && (
        <div style={executionStyles.step}>
          <strong style={{ color: 'var(--text-color)' }}>当前步骤</strong>
          <div>{turn.currentStep}</div>
        </div>
      )}
      {visibleTools.length > 0 && (
        <div style={executionStyles.toolRow} aria-label="工具集合进度">
          {visibleTools.map((tool) => {
            const toolMeta = executionStatusMeta(
              tool.phase === 'failed'
                ? 'failed'
                : tool.phase === 'completed' ? 'completed' : 'running',
            );
            return (
              <span
                key={tool.id}
                style={{
                  ...executionStyles.toolChip,
                  color: toolMeta.color,
                }}
                title={`${tool.toolName || '工具'} · ${toolMeta.label}`}
              >
                {tool.toolName || '工具'} · {toolMeta.label}
              </span>
            );
          })}
        </div>
      )}
      {turn.responsePreview && (
        <div style={executionStyles.response}>
          <strong style={{ color: 'var(--text-color)' }}>回复</strong>
          <div>{turn.responsePreview}</div>
        </div>
      )}
    </article>
  );
}

function ExecutionTab({ messages }) {
  const overview = useMemo(
    () => buildExecutionOverviewProjection(messages),
    [messages],
  );
  const activeTurn = overview.turns.find((turn) => turn.id === overview.activeTurnId) || null;
  const recentTurns = [...overview.turns]
    .reverse()
    .filter((turn) => turn.id !== overview.activeTurnId)
    .slice(0, 6);

  return (
    <div style={executionStyles.root}>
      <div style={executionStyles.summaryGrid} aria-label="执行状态统计">
        {[
          ['运行中', overview.totals.running, 'var(--warning-color)'],
          ['已完成', overview.totals.completed, 'var(--success-color)'],
          ['失败', overview.totals.failed, 'var(--error-color)'],
        ].map(([label, value, color]) => (
          <div key={label} style={executionStyles.summaryCard}>
            <div style={executionStyles.summaryLabel}>{label}</div>
            <div style={{ ...executionStyles.summaryValue, color }}>{value}</div>
          </div>
        ))}
      </div>

      {activeTurn ? (
        <>
          <div style={executionStyles.sectionLabel}>
            <span>
              {activeTurn.status === 'running' || activeTurn.status === 'waiting'
                ? '当前执行'
                : '最近执行'}
            </span>
            <span>消息与工具同步</span>
          </div>
          <ExecutionTurnCard turn={activeTurn} active />
        </>
      ) : (
        <div style={executionStyles.empty}>
          <Icon name="timeline" size={22} style={{ opacity: 0.35, marginBottom: '8px' }} />
          <div>尚无执行内容</div>
          <div>发送请求后，这里会按同一会话展示请求、步骤、工具进度和回复。</div>
        </div>
      )}

      {recentTurns.length > 0 && (
        <>
          <div style={executionStyles.sectionLabel}>
            <span>最近任务</span>
            <span>{recentTurns.length} 项</span>
          </div>
          <div style={executionStyles.list}>
            {recentTurns.map((turn) => (
              <ExecutionTurnCard key={turn.id} turn={turn} />
            ))}
          </div>
        </>
      )}
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
  const { executeActionWithFeedback } = useActionLifecycleContext();

  const addDocsState = useActionState('rag.add-documents');
  const initIndexState = useActionState('rag.initialize-index');
  const resetRagState = useActionState('rag.reset');
  const insertSearchState = useActionState('rag.insert-doc-search');

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

  const handleAddDocuments = useCallback(() => {
    executeActionWithFeedback(
      'rag.add-documents',
      async () => { onAddDocuments?.(); },
      { successMessage: '文档已添加', failureMessage: '添加文档失败' },
    );
  }, [onAddDocuments, executeActionWithFeedback]);

  const handleInitializeIndex = useCallback(() => {
    executeActionWithFeedback(
      'rag.initialize-index',
      async () => { onInitializeIndex?.(); },
      { successMessage: '索引已初始化', failureMessage: '初始化索引失败' },
    );
  }, [onInitializeIndex, executeActionWithFeedback]);

  const handleRemoveDocument = useCallback((doc, index) => {
    executeActionWithFeedback(
      'rag.remove-document',
      async () => { onRemoveDocument?.(doc, index); },
      { successMessage: '文档已移除', failureMessage: '移除文档失败' },
    );
  }, [onRemoveDocument, executeActionWithFeedback]);

  const handleInsertDocSearch = useCallback(() => {
    executeActionWithFeedback(
      'rag.insert-doc-search',
      async () => { onInsertDocSearch?.(); },
      { successMessage: '', failureMessage: '插入搜索命令失败' },
    );
  }, [onInsertDocSearch, executeActionWithFeedback]);

  const handleResetRag = useCallback(() => {
    executeActionWithFeedback(
      'rag.reset',
      async () => { onResetRag?.(); },
      { successMessage: 'RAG 已重置', failureMessage: '重置 RAG 失败' },
    );
  }, [onResetRag, executeActionWithFeedback]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>{t('inspector.rag_title')}</div>
        <div style={styles.inspectorHelpText}>
          {t('inspector.rag_help', {}, 'Add documents, initialize the index, then insert a document search command into chat.')}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button
            style={styles.button}
            onClick={handleAddDocuments}
            disabled={addDocsState.status === UI_ACTION_STATUS.RUNNING}
            data-action-id="rag.add-documents"
            aria-busy={addDocsState.status === UI_ACTION_STATUS.RUNNING || undefined}
          >
            {addDocsState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('common.upload')}
          </button>
          <button
            style={styles.button}
            onClick={handleInitializeIndex}
            disabled={ragDocs.length === 0 || initIndexState.status === UI_ACTION_STATUS.RUNNING}
            data-action-id="rag.initialize-index"
            aria-busy={initIndexState.status === UI_ACTION_STATUS.RUNNING || undefined}
          >
            {initIndexState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('common.init')}
          </button>
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
                onClick={() => handleRemoveDocument(doc, index)}
                data-action-id="rag.remove-document"
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
          <button
            style={styles.button}
            onClick={handleInsertDocSearch}
            disabled={insertSearchState.status === UI_ACTION_STATUS.RUNNING}
            data-action-id="rag.insert-doc-search"
            aria-busy={insertSearchState.status === UI_ACTION_STATUS.RUNNING || undefined}
          >
            {insertSearchState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('inspector.insert_doc_search', {}, 'Insert doc search')}
          </button>
          <button
            style={styles.button}
            onClick={handleResetRag}
            disabled={(!ipc.processInput && ragDocs.length === 0) || resetRagState.status === UI_ACTION_STATUS.RUNNING}
            data-action-id="rag.reset"
            aria-busy={resetRagState.status === UI_ACTION_STATUS.RUNNING || undefined}
          >
            {resetRagState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('common.reset', {}, 'Reset')}
          </button>
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
  const { executeActionWithFeedback } = useActionLifecycleContext();

  const startPreviewState = useActionState('preview.start');
  const stopPreviewState = useActionState('preview.stop');
  const refreshState = useActionState('preview.refresh');
  const openUrlState = useActionState('preview.open-url');

  const handleStartPreview = useCallback(() => {
    executeActionWithFeedback(
      'preview.start',
      async () => { onStartPreview?.('.'); },
      { successMessage: '预览服务已启动', failureMessage: '启动预览失败' },
    );
  }, [onStartPreview, executeActionWithFeedback]);

  const handleStopPreview = useCallback(() => {
    executeActionWithFeedback(
      'preview.stop',
      async () => { onStopPreview?.(); },
      { successMessage: '预览服务已停止', failureMessage: '停止预览失败' },
    );
  }, [onStopPreview, executeActionWithFeedback]);

  const handleRefreshFrame = useCallback(() => {
    executeActionWithFeedback(
      'preview.refresh',
      async () => { onRefreshFrame?.(); },
      { successMessage: '', failureMessage: '刷新失败' },
    );
  }, [onRefreshFrame, executeActionWithFeedback]);

  const handlePreviewUrlSubmit = useCallback((e) => {
    e.preventDefault();
    executeActionWithFeedback(
      'preview.open-url',
      async () => { onPreviewUrlSubmit?.(e); },
      { successMessage: '', failureMessage: '打开 URL 失败' },
    );
  }, [onPreviewUrlSubmit, executeActionWithFeedback]);

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
              previewStatus === 'starting' || startPreviewState.status === UI_ACTION_STATUS.RUNNING
                ? t('common.loading')
                : t('status.not_set')
            )}
          </div>
        </div>
        <button
          style={styles.button}
          onClick={handleRefreshFrame}
          disabled={!activePreviewUrl || refreshState.status === UI_ACTION_STATUS.RUNNING}
          data-action-id="preview.refresh"
          aria-busy={refreshState.status === UI_ACTION_STATUS.RUNNING || undefined}
        >
          {refreshState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('common.refresh')}
        </button>
        <button
          style={styles.button}
          onClick={() => activePreviewUrl && onOpenExternal(activePreviewUrl)}
          disabled={!activePreviewUrl}
        >
          {t('common.browser')}
        </button>
        <button
          style={styles.iconButton}
          onClick={onExpandToggle}
          title={inspectorExpanded ? t('inspector.restore') : t('inspector.expand')}
          aria-label={inspectorExpanded ? t('inspector.restore') : t('inspector.expand')}
        >
          <Icon name={inspectorExpanded ? 'restore' : 'expand'} size={15} />
        </button>
        {previewSession?.session_id ? (
          <button
            style={styles.button}
            onClick={handleStopPreview}
            disabled={stopPreviewState.status === UI_ACTION_STATUS.RUNNING}
            data-action-id="preview.stop"
            aria-busy={stopPreviewState.status === UI_ACTION_STATUS.RUNNING || undefined}
          >
            {stopPreviewState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('ui.stop')}
          </button>
        ) : (
          <button
            style={styles.button}
            onClick={handleStartPreview}
            disabled={startPreviewState.status === UI_ACTION_STATUS.RUNNING || startPreviewState.status === UI_ACTION_STATUS.BLOCKED}
            data-action-id="preview.start"
            aria-busy={startPreviewState.status === UI_ACTION_STATUS.RUNNING || undefined}
            title={startPreviewState.reason}
          >
            {startPreviewState.status === UI_ACTION_STATUS.RUNNING ? '...' : t('common.start')}
          </button>
        )}
      </div>

      <form style={styles.previewUrlForm} onSubmit={handlePreviewUrlSubmit}>
        <input
          style={styles.previewUrlInput}
          value={previewUrlDraft}
          onChange={(event) => onPreviewUrlDraftChange(event.target.value)}
          placeholder={t('inspector.preview_url_placeholder')}
        />
        <button
          style={styles.button}
          type="submit"
          disabled={openUrlState.status === UI_ACTION_STATUS.RUNNING}
          data-action-id="preview.open-url"
          aria-busy={openUrlState.status === UI_ACTION_STATUS.RUNNING || undefined}
        >
          {openUrlState.status === UI_ACTION_STATUS.RUNNING ? '...' : 'Go'}
        </button>
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
  onDeleteSessions,
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
  onResizeKeyDown,
  onSearchSessions,
  onStartPreview,
  onStopPreview,
  onSwitchSession,
  onClose,
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
        onKeyDown={onResizeKeyDown}
        title={t('inspector.drag_resize')}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('inspector.drag_resize')}
        aria-valuemin={LAYOUT.inspectorMinWidth}
        aria-valuemax={LAYOUT.inspectorMaxWidth}
        aria-valuenow={inspectorPanelWidth}
        tabIndex={0}
      />
        <div style={styles.inspectorHeader}>
          <div className="codex-inspector-heading">
            {activeInspectorTab === 'activity' ? '执行概览' : '工作区信息'}
          </div>
          <TabGroup activeTab={activeInspectorTab} onChange={onTabChange}>
            <TabItem id="activity">执行</TabItem>
            <TabItem id="history">会话</TabItem>
            <TabItem id="preview">预览</TabItem>
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
          <Button
            variant="icon"
            size="sm"
            onClick={onClose}
            title={t('inspector.close_panel')}
            ariaLabel={t('inspector.close_panel')}
            style={{ marginLeft: '2px' }}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>

      <div style={styles.inspectorTabContent}>
      {activeInspectorTab === 'activity' && (
        <ExecutionTab messages={messages} />
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
          onDeleteSessions={onDeleteSessions}
          onForkSession={onForkSession}
          onClearHistory={onClearHistory}
          onLoadMore={onLoadMoreSessions}
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
      </div>
    </Panel>
  );
}
