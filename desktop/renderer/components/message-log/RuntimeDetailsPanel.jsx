import React, { useState, useMemo, useCallback } from 'react';
import { styles } from '../MessageLog.styles.js';
import { useIPC } from '../../hooks/useIPC.js';
import { t } from '../../i18n.js';
import {
  buildThinkingSummary,
  createRuntimeDetailId,
  getRuntimeDetailContent,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  isThinkingMessage,
  isStatusUpdateMessage,
} from './runtime-details.js';
import { buildActivitySummary, getActivityTone, getFileStatusLabel, getFileTypeIcon, formatDuration } from './activity-summary.js';

// ===== Tab 定义 =====
const TABS = [
  { id: 'overview', key: 'exec.overview', icon: '◉' },
  { id: 'reasoning', key: 'msg.thinking_summary_label', icon: '◇' },
  { id: 'files', key: 'exec.tools_used', icon: '🖹' },
  { id: 'activity', key: 'exec.activity_log', icon: '⚡' },
  { id: 'log', key: 'ui.root', icon: '☰' },
];

// ===== 文件状态颜色 =====
function fileStatusColor(status) {
  switch (status) {
    case 'read': return 'var(--info-color)';
    case 'edited': return 'var(--warning-color)';
    case 'created': return 'var(--success-color)';
    case 'deleted': return 'var(--error-color)';
    case 'completed': return 'var(--success-color)';
    case 'running': return 'var(--primary-color)';
    case 'waiting': return 'var(--warning-color)';
    case 'failed': return 'var(--error-color)';
    default: return 'var(--text-muted)';
  }
}

// ===== 进度条颜色 =====
function progressFillColor(summary, isRunning) {
  if (summary.failed > 0) return 'var(--error-color)';
  if (!isRunning && summary.completed > 0) return 'var(--success-color)';
  if (summary.waitingForUser) return 'var(--warning-color)';
  return 'var(--warning-color)';
}

// ===== 活动 intent 过滤选项 =====
const INTENT_FILTERS = [
  { value: 'all', key: 'ui.root' },
  { value: 'read', key: 'exec.file_read' },
  { value: 'write', key: 'exec.file_write' },
  { value: 'edit', key: 'exec.file_edit' },
  { value: 'delete', key: 'exec.file_delete' },
  { value: 'verify', key: 'exec.verify' },
  { value: 'command', key: 'exec.command' },
  { value: 'interaction', key: 'exec.interaction' },
];

const PHASE_FILTERS = [
  { value: 'all', key: 'ui.root' },
  { value: 'running', key: 'status.running' },
  { value: 'completed', key: 'status.completed' },
  { value: 'failed', key: 'status.failed' },
  { value: 'waiting', key: 'status.not_set' },
];

export function RuntimeDetailsPanel({
  group,
  status,
  isActiveGroup,
  isExpanded,
  isLarge,
  expandedRuntimeDetails,
  getTypeDisplay,
  onExport,
  onPanelSizeToggle,
  onActivityAction,
  onRefChange,
  onRuntimeDetailToggle,
  onRuntimeDetailsToggle,
}) {
  const ipc = useIPC();
  const runtimeDetails = group?.runtimeDetails || [];
  const visibleRuntimeDetails = runtimeDetails.filter(msg => !isStatusUpdateMessage(msg) && !isThinkingMessage(msg));
  const latestStatusUpdate = [...runtimeDetails].reverse().find(isStatusUpdateMessage);
  const thinkingSummary = buildThinkingSummary(runtimeDetails);
  const activitySummary = buildActivitySummary(runtimeDetails);
  const isRunningGroup = status === 'running' && isActiveGroup;
  const statusText = isRunningGroup || latestStatusUpdate
    ? getStatusUpdateText(latestStatusUpdate)
    : '执行完成';

  // Tab 状态
  const [activeTab, setActiveTab] = useState('overview');
  // 文件列表展开状态
  const [showAllFiles, setShowAllFiles] = useState(false);
  // 活动列表展开状态
  const [showAllActivities, setShowAllActivities] = useState(false);
  // 活动 intent 过滤
  const [activityIntentFilter, setActivityIntentFilter] = useState('all');
  // 活动 phase 过滤
  const [activityPhaseFilter, setActivityPhaseFilter] = useState('all');
  // 活动搜索
  const [activitySearch, setActivitySearch] = useState('');
  // 展开的活动详情
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [expandedFileDiffs, setExpandedFileDiffs] = useState(new Set());
  const [fileDiffs, setFileDiffs] = useState({});
  const [loadingDiffs, setLoadingDiffs] = useState(new Set());

  const toggleActivityExpand = useCallback((activityId) => {
    setExpandedActivities(prev => {
      const next = new Set(prev);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return next;
    });
  }, []);

  const toggleFileDiff = useCallback(async (filePath) => {
    if (!filePath) {
      return;
    }

    setExpandedFileDiffs(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });

    if (fileDiffs[filePath] || loadingDiffs.has(filePath)) {
      return;
    }

    setLoadingDiffs(prev => new Set(prev).add(filePath));
    try {
      const result = await ipc.getFileDiff?.(filePath);
      setFileDiffs(prev => ({
        ...prev,
        [filePath]: result || { success: false, error: '无法读取 diff' },
      }));
    } catch (error) {
      setFileDiffs(prev => ({
        ...prev,
        [filePath]: { success: false, error: error.message },
      }));
    } finally {
      setLoadingDiffs(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  }, [fileDiffs, ipc, loadingDiffs]);

  // ===== 过滤活动 =====
  // 注意：所有 Hooks 必须在条件返回之前调用，否则违反 Rules of Hooks
  const filteredActivities = useMemo(() => {
    let activities = activitySummary.activities;
    if (activityIntentFilter !== 'all') {
      activities = activities.filter(a => a.intent === activityIntentFilter);
    }
    if (activityPhaseFilter !== 'all') {
      activities = activities.filter(a => a.phase === activityPhaseFilter);
    }
    if (activitySearch.trim()) {
      const q = activitySearch.toLowerCase();
      activities = activities.filter(a =>
        (a.statusText || a.title || '').toLowerCase().includes(q) ||
        (a.toolName || '').toLowerCase().includes(q) ||
        (a.target || '').toLowerCase().includes(q) ||
        (a.detail || '').toLowerCase().includes(q)
      );
    }
    return activities;
  }, [activitySummary.activities, activityIntentFilter, activityPhaseFilter, activitySearch]);

  const displayedFiles = showAllFiles ? activitySummary.files : activitySummary.files.slice(0, 6);
  const displayedActivities = showAllActivities ? filteredActivities : filteredActivities.slice(-8);
  const hasMoreFiles = activitySummary.files.length > 6;
  const hasMoreActivities = filteredActivities.length > 8;
  const overviewHighlights = useMemo(() => {
    const items = runtimeDetails
      .filter(msg => !isThinkingMessage(msg))
      .filter(msg => msg.event || msg.type || msg.content || msg.message || msg.toolName)
      .slice(-4)
      .map((msg, index) => {
        const label = msg.toolName || (isThinkingMessage(msg) ? t('msg.thinking_in_progress') : msg.event || msg.type || t('msg.message'));
        const text = isStatusUpdateMessage(msg)
          ? getStatusUpdateText(msg)
          : getRuntimeDetailPreviewText(msg);
        return {
          id: msg.id || `${msg.event || msg.type || 'runtime'}_${msg.timestamp || index}`,
          label,
          text,
          tone: msg.type === 'error' || msg.event === 'tool:error' ? 'error'
            : msg.event === 'tool:result' || msg.event === 'agent:complete' ? 'success'
              : msg.event === 'agent:thinking' ? 'thinking'
                : 'neutral',
        };
      });

    if (items.length > 0) {
      return items;
    }

    return [{
      id: 'ready',
      label: t('common.status'),
      text: isRunningGroup ? '正在等待运行事件' : statusText,
      tone: 'neutral',
    }];
  }, [runtimeDetails, isRunningGroup, statusText]);

  // 使用 runtimeDetails（而非 visibleRuntimeDetails）判断，避免完成后过滤掉 thinking/status 消息导致面板消失
  // 必须在所有 Hooks 之后才能条件返回，否则违反 Rules of Hooks
  if (runtimeDetails.length === 0 && activitySummary.activities.length === 0) {
    return null;
  }

  // ===== 渲染 Tab 栏 =====
  const renderTabs = () => (
    <div style={localStyles.tabBar}>
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          style={{
            ...localStyles.tabButton,
            ...(activeTab === tab.id ? localStyles.tabButtonActive : {}),
          }}
          onClick={(e) => { e.stopPropagation(); setActiveTab(tab.id); }}
          title={t(tab.key)}
        >
          <span style={localStyles.tabIcon}>{tab.icon}</span>
          <span>{t(tab.key)}</span>
          {tab.id === 'files' && activitySummary.files.length > 0 && (
            <span style={localStyles.tabBadge}>{activitySummary.files.length}</span>
          )}
          {tab.id === 'activity' && activitySummary.activities.length > 0 && (
            <span style={localStyles.tabBadge}>{activitySummary.activities.length}</span>
          )}
          {tab.id === 'reasoning' && thinkingSummary.count > 0 && (
            <span style={localStyles.tabBadge}>{thinkingSummary.count}</span>
          )}
          {tab.id === 'log' && visibleRuntimeDetails.length > 0 && (
            <span style={localStyles.tabBadge}>{visibleRuntimeDetails.length}</span>
          )}
        </button>
      ))}
    </div>
  );

  const renderReasoning = () => {
    if (thinkingSummary.count === 0) {
      return <div style={localStyles.emptyTab}>{t('status.not_set')}</div>;
    }

    return (
      <div style={localStyles.reasoningList}>
        {thinkingSummary.messages.map((msg, index) => {
          const title = msg.payload?.eventName || msg.summary || (msg.iteration ? t('msg.iteration_x', { n: msg.iteration }) : t('msg.fragment_n', { n: index + 1 }));
          const detail = msg.thinkingText || msg.summary || msg.payload?.message || msg.payload?.data?.textPreview || msg.content || t('msg.model_thinking');
          return (
            <div key={msg.id || `${group.id}_reasoning_${index}`} style={localStyles.reasoningItem}>
              <div style={localStyles.reasoningHeader}>
                <span style={localStyles.reasoningTitle}>{title}</span>
                {msg.timestamp && <span style={localStyles.reasoningTime}>{new Date(msg.timestamp).toLocaleTimeString()}</span>}
              </div>
              <div style={localStyles.reasoningText}>{detail}</div>
            </div>
          );
        })}
      </div>
    );
  };

  // ===== 概览 Tab =====
  const renderOverview = () => (
    <>
      {/* 进度条 - 始终显示 */}
      <div style={styles.runtimeProgress}>
        <div style={styles.runtimeProgressText}>
          <span style={styles.runtimeProgressLabel}>{statusText}</span>
          <span>
            {activitySummary.running} 进行中 / {activitySummary.completed} 完成
            {activitySummary.failed > 0 ? ` / ${activitySummary.failed} 失败` : ''}
          </span>
        </div>
        <div style={styles.progressBar}>
          <div style={{
            ...styles.progressFill,
            width: `${Math.max(6, activitySummary.progress)}%`,
            backgroundColor: progressFillColor(activitySummary, isRunningGroup),
            animation: isRunningGroup ? 'progressPulse 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>
      </div>

      {/* 活动摘要行 */}
      <div style={localStyles.overviewRow}>
        <span style={localStyles.overviewStat}>
          <span style={localStyles.overviewStatValue}>{activitySummary.fileCount}</span>
          <span style={localStyles.overviewStatLabel}>{t('exec.tools_used')}</span>
        </span>
        <span style={localStyles.overviewStat}>
          <span style={localStyles.overviewStatValue}>{activitySummary.completed}</span>
          <span style={localStyles.overviewStatLabel}>{t('msg.success')}</span>
        </span>
        <span style={localStyles.overviewStat}>
          <span style={{ ...localStyles.overviewStatValue, color: activitySummary.reviewable > 0 ? 'var(--warning-color)' : 'var(--text-muted)' }}>{activitySummary.reviewable}</span>
          <span style={localStyles.overviewStatLabel}>{t('exec.review_change')}</span>
        </span>
        <span style={localStyles.overviewStat}>
          <span style={{ ...localStyles.overviewStatValue, color: activitySummary.undoable > 0 ? 'var(--info-color)' : 'var(--text-muted)' }}>{activitySummary.undoable}</span>
          <span style={localStyles.overviewStatLabel}>{t('exec.ask_revert')}</span>
        </span>
        {activitySummary.waitingForUser && (
          <span style={{ ...localStyles.overviewStat, color: 'var(--warning-color)' }}>
            <span>{t('common.confirm')}</span>
            <button
              type="button"
              style={styles.activityActionButton}
              title={t('exec.confirm_continue')}
              onClick={(event) => {
                event.stopPropagation();
                onActivityAction?.('continue', {
                  kind: 'tool_activity',
                  phase: 'waiting',
                  intent: 'interaction',
                  statusText: t('exec.confirm_continue'),
                });
              }}
            >
              {t('chat.continue')}
            </button>
          </span>
        )}
      </div>

      {/* 任务阶段 */}
      <div style={styles.taskStageList}>
        {activitySummary.taskStages.map(stage => (
          <div
            key={stage.id}
            style={{
              ...styles.taskStageItem,
              ...(stage.status === 'completed' ? styles.taskStageCompleted : {}),
              ...(stage.status === 'running' ? styles.taskStageRunning : {}),
              ...(stage.status === 'waiting' ? styles.taskStageWaiting : {}),
              ...(stage.status === 'failed' ? styles.taskStageFailed : {}),
            }}
          >
            <span style={styles.taskStageMark}>
              {stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '!' : stage.status === 'pending' ? '·' : '…'}
            </span>
            <span style={styles.taskStageLabel}>{stage.label}</span>
          </div>
        ))}
      </div>

      {/* 迷你文件列表 */}
      {activitySummary.files.length > 0 && (
        <div style={localStyles.miniFileList}>
          {activitySummary.files.slice(0, 4).map(file => (
            <div key={file.path} style={localStyles.miniFileItem}>
              <span style={localStyles.fileTypeIcon}>{getFileTypeIcon(file.path)}</span>
              <span style={localStyles.miniFilePath} title={file.path}>{file.path}</span>
              <span style={{ ...localStyles.miniFileStatus, color: fileStatusColor(file.status) }}>
                {getFileStatusLabel(file.status)}
              </span>
            </div>
          ))}
          {activitySummary.files.length > 4 && (
            <button
              type="button"
              style={localStyles.showMoreButton}
              onClick={(e) => { e.stopPropagation(); setActiveTab('files'); }}
            >
              +{activitySummary.files.length - 4}
            </button>
          )}
        </div>
      )}

      {activitySummary.files.length === 0 && (
        <div style={localStyles.overviewHighlights}>
          {overviewHighlights.map(item => (
            <div
              key={item.id}
              style={{
                ...localStyles.overviewHighlightItem,
                ...(item.tone === 'success' ? localStyles.overviewHighlightSuccess : {}),
                ...(item.tone === 'error' ? localStyles.overviewHighlightError : {}),
                ...(item.tone === 'thinking' ? localStyles.overviewHighlightThinking : {}),
              }}
            >
              <span style={localStyles.overviewHighlightLabel}>{item.label}</span>
              <span style={localStyles.overviewHighlightText}>{item.text || t('status.not_set')}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // ===== 文件 Tab =====
  const renderFiles = () => (
    <>
      <div style={localStyles.fileListHeader}>
        <span style={localStyles.fileListCount}>{activitySummary.files.length}</span>
        <div style={localStyles.fileFilterGroup}>
          {['all', 'read', 'edited', 'created', 'deleted'].map(filter => (
            <button
              key={filter}
              type="button"
              style={{
                ...localStyles.filterChip,
                ...(activityIntentFilter === filter && filter !== 'all' ? localStyles.filterChipActive : {}),
              }}
              onClick={(e) => { e.stopPropagation(); setActivityIntentFilter(filter); }}
            >
              {filter === 'all' ? t('ui.root') : getFileStatusLabel(filter)}
            </button>
          ))}
        </div>
      </div>
      <div style={localStyles.fileList}>
        {displayedFiles.map(file => {
          const isDiffExpanded = expandedFileDiffs.has(file.path);
          const diffResult = fileDiffs[file.path];
          const isDiffLoading = loadingDiffs.has(file.path);

          return (
            <div key={file.path}>
              <button
                type="button"
                style={localStyles.fileItemButton}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFileDiff(file.path);
                }}
                title={isDiffExpanded ? t('exec.collapse_diff') : t('exec.expand_diff')}
              >
                <span style={localStyles.fileTypeIcon}>{getFileTypeIcon(file.path)}</span>
                <span style={localStyles.filePath} title={file.path}>{file.path}</span>
                <span style={{ ...localStyles.fileStatusChip, color: fileStatusColor(file.status) }}>
                  {getFileStatusLabel(file.status)}
                </span>
                {file.updatedAt && (
                  <span style={localStyles.fileTime}>
                    {new Date(file.updatedAt).toLocaleTimeString()}
                  </span>
                )}
                <span style={localStyles.fileDiffToggle}>{isDiffExpanded ? '▾' : '▸'}</span>
              </button>
              {isDiffExpanded && (
                <div style={localStyles.fileDiffPanel}>
                  {isDiffLoading && <div style={localStyles.fileDiffEmpty}>{t('common.loading')}</div>}
                  {!isDiffLoading && diffResult?.success === false && (
                    <div style={localStyles.fileDiffEmpty}>{diffResult.error || t('common.error')}</div>
                  )}
                  {!isDiffLoading && diffResult?.success !== false && !diffResult?.hasDiff && (
                    <div style={localStyles.fileDiffEmpty}>{t('status.completed')}</div>
                  )}
                  {!isDiffLoading && diffResult?.diff && (
                    <pre style={localStyles.fileDiffPre}>{diffResult.diff}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hasMoreFiles && !showAllFiles && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllFiles(true); }}
        >
          {activitySummary.files.length}
        </button>
      )}
      {showAllFiles && hasMoreFiles && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllFiles(false); }}
        >
          {t('msg.collapse')}
        </button>
      )}
      {activitySummary.files.length === 0 && (
        <div style={localStyles.emptyTab}>{t('status.not_set')}</div>
      )}
    </>
  );

  // ===== 活动 Tab =====
  const renderActivity = () => (
    <>
      {/* 过滤栏 */}
      <div style={localStyles.activityFilterBar}>
        <input
          type="text"
          style={localStyles.activitySearch}
          placeholder={t('exec.search_activity')}
          value={activitySearch}
          onChange={(e) => { e.stopPropagation(); setActivitySearch(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
        />
        <div style={localStyles.filterGroup}>
          {INTENT_FILTERS.map(f => (
            <button
              key={`intent-${f.value}`}
              type="button"
              style={{
                ...localStyles.filterChip,
                ...(activityIntentFilter === f.value ? localStyles.filterChipActive : {}),
              }}
              onClick={(e) => { e.stopPropagation(); setActivityIntentFilter(f.value); }}
              title={t(f.key)}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
        <div style={localStyles.filterGroup}>
          {PHASE_FILTERS.map(f => (
            <button
              key={`phase-${f.value}`}
              type="button"
              style={{
                ...localStyles.filterChip,
                ...(activityPhaseFilter === f.value ? localStyles.filterChipActive : {}),
              }}
              onClick={(e) => { e.stopPropagation(); setActivityPhaseFilter(f.value); }}
              title={t(f.key)}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
      </div>

      {/* 活动 checklist 列表 */}
      <div style={localStyles.activityList}>
        {displayedActivities.map((activity, index) => {
          const tone = getActivityTone(activity);
          const isExpandedDetail = expandedActivities.has(activity.id || index);
          const duration = activity.startedAt && activity.updatedAt
            ? activity.updatedAt - activity.startedAt
            : null;

          return (
            <div key={`${activity.id || activity.toolName}_${index}`}>
              <div
                style={{
                  ...styles.activityItem,
                  ...(tone === 'completed' ? styles.activityItemCompleted : {}),
                  ...(tone === 'failed' ? styles.activityItemFailed : {}),
                  ...(tone === 'waiting' ? styles.activityItemWaiting : {}),
                }}
              >
                <div style={localStyles.activityCheckRow}>
                  {/* Checklist 标记 */}
                  <span style={{
                    ...localStyles.checkMark,
                    ...(tone === 'completed' ? localStyles.checkMarkDone : {}),
                    ...(tone === 'failed' ? localStyles.checkMarkFail : {}),
                    ...(tone === 'waiting' ? localStyles.checkMarkWait : {}),
                  }}>
                    {tone === 'completed' ? '✓' : tone === 'failed' ? '✗' : tone === 'waiting' ? '?' : '…'}
                  </span>
                  <div style={localStyles.activityMainContent}>
                    <div style={localStyles.activityTitleRow}>
                      <span style={styles.activityTitle} title={activity.statusText || activity.title}>
                        {activity.statusText || activity.title}
                      </span>
                      {duration !== null && (
                        <span style={localStyles.activityDuration}>{formatDuration(duration)}</span>
                      )}
                    </div>
                    {/* 展开按钮 */}
                    {activity.detail && (
                      <button
                        type="button"
                        style={localStyles.expandDetailButton}
                        onClick={(e) => { e.stopPropagation(); toggleActivityExpand(activity.id || index); }}
                        title={isExpandedDetail ? t('msg.hide_details') : t('msg.details')}
                      >
                        {isExpandedDetail ? '▾' : '▸'}
                      </button>
                    )}
                  </div>
                </div>
                <div style={styles.activityActions}>
                  {activity.canUndo && (
                    <button
                      type="button"
                      style={styles.activityActionButton}
                      title={t('exec.ask_revert')}
                      onClick={(event) => {
                        event.stopPropagation();
                        onActivityAction?.('undo', activity);
                      }}
                    >
                      {t('common.undo')}
                    </button>
                  )}
                  {activity.canReview && (
                    <button
                      type="button"
                      style={styles.activityActionButton}
                      title={t('exec.review_change')}
                      onClick={(event) => {
                        event.stopPropagation();
                        onActivityAction?.('review', activity);
                      }}
                    >
                      {t('exec.review_change')}
                    </button>
                  )}
                </div>
              </div>
              {/* 展开的详情 */}
              {isExpandedDetail && activity.detail && (
                <div style={localStyles.activityDetailExpanded}>
                  <pre style={localStyles.activityDetailPre}>{activity.detail}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMoreActivities && !showAllActivities && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllActivities(true); }}
        >
          {filteredActivities.length}
        </button>
      )}
      {showAllActivities && hasMoreActivities && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllActivities(false); }}
        >
          {t('msg.collapse')}
        </button>
      )}
      {filteredActivities.length === 0 && (
        <div style={localStyles.emptyTab}>
          {activitySearch ? t('status.not_set') : t('status.not_set')}
        </div>
      )}
    </>
  );

  // ===== 日志 Tab =====
  const renderLog = () => (
    <div
      ref={(node) => onRefChange(group.id, node)}
      style={{
        ...styles.runtimeDetailsList,
        ...(isLarge
          ? styles.runtimeDetailsListLarge
          : isExpanded
            ? styles.runtimeDetailsListExpanded
            : styles.runtimeDetailsListCollapsed),
      }}
    >
      {visibleRuntimeDetails.map((msg, index) => {
        const runtimeDetailId = createRuntimeDetailId(group.id, msg, index);
        const detailExpanded = expandedRuntimeDetails.has(runtimeDetailId);
        const typeDisplay = getTypeDisplay(msg.type);
        const isDebug = msg.type === 'debug';
        const content = detailExpanded ? getRuntimeDetailContent(msg) : '';
        const firstLine = detailExpanded
          ? (content ? content.split('\n')[0].trim() : t('status.not_set'))
          : getRuntimeDetailPreviewText(msg);
        const scoreInfo = msg.type === 'tool_result' && typeof msg.result === 'string'
          ? ((m) => m ? { file: m[1], score: parseInt(m[2]) } : null)(msg.result.match(/^\[(.+?)\] → (\d+)% match/))
          : null;

        return (
          <div
            key={runtimeDetailId}
            style={{
              ...styles.runtimeDetailItem,
              ...styles.runtimeDetailItemInteractive,
              ...(isDebug ? styles.runtimeDetailItemDebug : styles.runtimeDetailItemStatus),
              ...(detailExpanded ? {} : { padding: '3px 8px' }),
            }}
            onClick={() => onRuntimeDetailToggle(runtimeDetailId)}
            title={detailExpanded ? t('msg.collapse') : t('msg.expand')}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--text-dark)',
              fontSize: '11px',
              ...(detailExpanded ? { marginBottom: '4px' } : {}),
            }}>
              <span style={{
                flex: detailExpanded ? '0 0 auto' : 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <span style={{ flexShrink: 0 }}>{typeDisplay.text}</span>
                {scoreInfo && (
                  <span style={{ padding: '1px 6px', borderRadius: '3px', backgroundColor: 'var(--primary-soft)', color: 'var(--primary-color)', fontSize: '10px', fontWeight: '700', flexShrink: 0, marginRight: '2px' }}>
                    {scoreInfo.score}%
                  </span>
                )}
                {!detailExpanded && (
                  <span style={{
                    marginLeft: '4px',
                    color: 'var(--text-muted)',
                    fontWeight: 400,
                    fontSize: '11px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {firstLine.substring(0, 120)}
                  </span>
                )}
              </span>
              <span style={{ flexShrink: 0 }}>
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                <span style={{ marginLeft: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  {detailExpanded ? '▾' : '▸'}
                </span>
              </span>
            </div>
            {detailExpanded && (
              <div
                style={{
                  ...styles.runtimeDetailContent,
                  ...styles.runtimeDetailContentExpanded,
                }}
              >
                {content || '(无内容)'}
              </div>
            )}
          </div>
        );
      })}
      {visibleRuntimeDetails.length === 0 && runtimeDetails.length > 0 && (
        <div style={localStyles.emptyTab}>{t('ui.root')}</div>
      )}
      {visibleRuntimeDetails.length === 0 && runtimeDetails.length === 0 && (
        <div style={localStyles.emptyTab}>{t('status.not_set')}</div>
      )}
    </div>
  );

  // ===== 渲染 Tab 内容 =====
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'reasoning': return renderReasoning();
      case 'files': return renderFiles();
      case 'activity': return renderActivity();
      case 'log': return renderLog();
      default: return renderOverview();
    }
  };

  return (
    <div key={`${group.id}_runtime`} style={styles.runtimeDetailsPanel}>
      {/* 面板头部 */}
      <div
        style={{
          ...styles.runtimeDetailsHeader,
          ...styles.runtimeDetailsHeaderInteractive,
        }}
        onClick={() => onRuntimeDetailsToggle(group.id)}
        title={isExpanded ? t('msg.hide_details') : t('msg.details')}
      >
        <span style={styles.runtimeDetailsTitle}>
          {isRunningGroup && <span style={styles.spinner}></span>}
          <span>{isRunningGroup ? t('exec.activity_log') : t('exec.summary')}</span>
        </span>
        <span style={styles.runtimeDetailsActions}>
          <span style={styles.runtimeStatusChip} title={statusText}>{statusText}</span>
          <span>{activitySummary.total || visibleRuntimeDetails.length} {t('ui.root')}</span>
          {visibleRuntimeDetails.length > 0 && (
            <button
              type="button"
              style={styles.runtimeDetailsToggle}
              title={t('common.export')}
              aria-label={t('common.export')}
              onClick={(event) => {
                event.stopPropagation();
                onExport(group);
              }}
            >
              ↓
            </button>
          )}
          <button
            type="button"
            style={styles.runtimeDetailsToggle}
            title={isLarge ? t('msg.collapse') : t('msg.expand')}
            aria-label={isLarge ? t('msg.collapse') : t('msg.expand')}
            onClick={(event) => {
              event.stopPropagation();
              onPanelSizeToggle(group.id);
            }}
          >
            {isLarge ? '↙' : '⛶'}
          </button>
          <button
            type="button"
            style={styles.runtimeDetailsToggle}
            title={isExpanded ? t('msg.hide_details') : t('msg.details')}
            aria-label={isExpanded ? t('msg.hide_details') : t('msg.details')}
            onClick={(event) => {
              event.stopPropagation();
              onRuntimeDetailsToggle(group.id);
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        </span>
      </div>

      {/* Tab 栏 - 始终显示 */}
      {renderTabs()}

      {/* Tab 内容 - 始终显示（修复 P3: 不再依赖 isRunningGroup） */}
      <div style={localStyles.tabContent}>
        {renderTabContent()}
      </div>
    </div>
  );
}

// ===== 本地样式 =====
const localStyles = {
  tabBar: {
    display: 'flex',
    gap: '0',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--glass-bg-light)',
  },
  tabButton: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: '7px 4px',
    border: 'none',
    borderBottom: '2px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    transition: 'all 0.15s',
  },
  tabButtonActive: {
    color: 'var(--primary-color)',
    borderBottomColor: 'var(--primary-color)',
    backgroundColor: 'var(--primary-faint)',
  },
  tabIcon: {
    fontSize: '11px',
  },
  tabBadge: {
    padding: '0 5px',
    borderRadius: '999px',
    backgroundColor: 'var(--neutral-faint)',
    color: 'var(--text-dark)',
    fontSize: '10px',
    fontWeight: 700,
    minWidth: '16px',
    textAlign: 'center',
  },
  tabContent: {
    overflow: 'visible',
  },

  // 概览
  overviewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    flexWrap: 'wrap',
  },
  overviewStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  overviewStatValue: {
    fontSize: '16px',
    fontWeight: 800,
    color: 'var(--text-color)',
  },
  overviewStatLabel: {
    fontSize: '10px',
    fontWeight: 500,
  },

  // 迷你文件列表
  miniFileList: {
    padding: '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  miniFileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '24px',
  },
  miniFilePath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    fontSize: '11px',
    fontWeight: 500,
  },
  miniFileStatus: {
    flexShrink: 0,
    fontSize: '10px',
    fontWeight: 700,
  },
  overviewHighlights: {
    padding: '8px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  overviewHighlightItem: {
    minHeight: '30px',
    display: 'grid',
    gridTemplateColumns: 'minmax(76px, auto) minmax(0, 1fr)',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-subtle)',
  },
  overviewHighlightSuccess: {
    borderColor: 'var(--success-border)',
    backgroundColor: 'var(--success-faint)',
  },
  overviewHighlightError: {
    borderColor: 'var(--error-border)',
    backgroundColor: 'var(--error-faint)',
  },
  overviewHighlightThinking: {
    borderColor: 'var(--info-border)',
    backgroundColor: 'var(--info-faint)',
  },
  overviewHighlightLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-dark)',
    fontSize: '11px',
    fontWeight: 800,
  },
  overviewHighlightText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
  },
  reasoningList: {
    padding: '8px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  reasoningItem: {
    padding: '8px 9px',
    borderRadius: '6px',
    border: '1px solid var(--info-border)',
    backgroundColor: 'var(--info-faint)',
  },
  reasoningHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '4px',
  },
  reasoningTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    fontSize: '11px',
    fontWeight: 800,
  },
  reasoningTime: {
    flexShrink: 0,
    color: 'var(--text-muted)',
    fontSize: '10px',
    fontWeight: 600,
  },
  reasoningText: {
    color: 'var(--text-dark)',
    fontSize: '11px',
    lineHeight: 1.55,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    wordBreak: 'break-word',
  },

  // 文件 Tab
  fileListHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
  },
  fileListCount: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  fileFilterGroup: {
    display: 'flex',
    gap: '4px',
  },
  fileList: {
    padding: '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '300px',
    overflowY: 'auto',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '28px',
    padding: '2px 8px',
    borderRadius: '6px',
    backgroundColor: 'var(--surface-subtle)',
  },
  fileItemButton: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '28px',
    padding: '2px 8px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'var(--surface-subtle)',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  },
  fileTypeIcon: {
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 800,
    flexShrink: 0,
    borderRadius: '3px',
    backgroundColor: 'var(--neutral-faint)',
    color: 'var(--text-muted)',
  },
  filePath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    fontSize: '12px',
    fontWeight: 600,
  },
  fileStatusChip: {
    flexShrink: 0,
    fontSize: '11px',
    fontWeight: 800,
  },
  fileTime: {
    flexShrink: 0,
    fontSize: '10px',
    color: 'var(--text-dark)',
  },
  fileDiffToggle: {
    flexShrink: 0,
    color: 'var(--text-dark)',
    fontSize: '11px',
  },
  fileDiffPanel: {
    margin: '4px 0 4px 26px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--glass-bg-light)',
    overflow: 'hidden',
  },
  fileDiffPre: {
    margin: 0,
    padding: '8px',
    maxHeight: '260px',
    overflow: 'auto',
    whiteSpace: 'pre',
    fontSize: '11px',
    lineHeight: 1.45,
    color: 'var(--text-muted)',
  },
  fileDiffEmpty: {
    padding: '8px',
    color: 'var(--text-dark)',
    fontSize: '11px',
  },

  // 活动 Tab
  activityFilterBar: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  activitySearch: {
    width: '100%',
    height: '26px',
    padding: '0 8px',
    borderRadius: '5px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--glass-bg-light)',
    color: 'var(--text-color)',
    fontSize: '11px',
    outline: 'none',
  },
  filterGroup: {
    display: 'flex',
    gap: '3px',
    flexWrap: 'wrap',
  },
  filterChip: {
    padding: '2px 7px',
    borderRadius: '999px',
    border: '1px solid transparent',
    backgroundColor: 'var(--neutral-faint)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: 600,
    transition: 'all 0.15s',
  },
  filterChipActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    borderColor: 'var(--primary-border)',
  },
  activityList: {
    padding: '6px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '400px',
    overflowY: 'auto',
  },

  // Checklist 样式
  activityCheckRow: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  checkMark: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 800,
    flexShrink: 0,
    backgroundColor: 'var(--neutral-faint)',
    color: 'var(--text-muted)',
    marginTop: '1px',
  },
  checkMarkDone: {
    backgroundColor: 'var(--success-soft)',
    color: 'var(--success-color)',
  },
  checkMarkFail: {
    backgroundColor: 'var(--error-soft)',
    color: 'var(--error-color)',
  },
  checkMarkWait: {
    backgroundColor: 'var(--info-soft)',
    color: 'var(--info-color)',
    animation: 'pulse 1s infinite',
  },
  activityMainContent: {
    flex: 1,
    minWidth: 0,
  },
  activityTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  activityDuration: {
    flexShrink: 0,
    fontSize: '10px',
    color: 'var(--text-dark)',
    fontWeight: 600,
    padding: '0 4px',
    borderRadius: '3px',
    backgroundColor: 'var(--neutral-faint)',
  },
  expandDetailButton: {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-dark)',
    cursor: 'pointer',
    fontSize: '10px',
    padding: '1px 4px',
    marginTop: '2px',
  },
  activityDetailExpanded: {
    padding: '6px 8px',
    backgroundColor: 'var(--glass-bg-light)',
    borderRadius: '4px',
    margin: '2px 0 4px 26px',
  },
  activityDetailPre: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '11px',
    color: 'var(--text-muted)',
    margin: 0,
    maxHeight: '150px',
    overflowY: 'auto',
  },

  // 通用
  showMoreButton: {
    display: 'block',
    width: '100%',
    padding: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--primary-color)',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    textAlign: 'center',
    transition: 'background-color 0.15s',
  },
  emptyTab: {
    padding: '20px 10px',
    textAlign: 'center',
    color: 'var(--text-dark)',
    fontSize: '12px',
  },
};
