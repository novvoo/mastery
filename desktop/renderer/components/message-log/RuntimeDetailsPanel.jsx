import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { styles } from './styles/MessageLog.styles.js';
import { localStyles } from './styles/RuntimeDetailsPanel.styles.js';
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
} from './utils/runtime-details.js';
import { buildActivitySummary, getActivityTone, getFileStatusLabel, getFileTypeIcon, formatDuration } from './utils/activity-summary.js';

// ===== Tab 定义（2 个 Tab：文件 / 活动） =====
const TABS = [
  { id: 'files', key: 'exec.tools_used', icon: '🗂' },
  { id: 'activity', key: 'exec.activity_log', icon: '⚡' },
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

function phaseLabel(phase) {
  return {
    pending: '未开始',
    queued: '开始',
    running: '进行中',
    completed: '完成',
    failed: '失败',
    waiting: '等待',
    skipped: '跳过',
  }[String(phase || 'pending').toLowerCase()] || phase;
}

function lineChangeParts(counts) {
  if (!counts) return null;
  const additions = Number(counts.additions || counts.lines || 0);
  const deletions = Number(counts.deletions || 0);
  if (additions === 0 && deletions === 0) return null;
  return { additions, deletions };
}

function fileLineChangeParts(file) {
  const added = Number(file?.linesWritten || file?.linesAdded || 0);
  const deleted = Number(file?.linesDeleted || 0);
  if (added === 0 && deleted === 0) return null;
  return { additions: added, deletions: deleted };
}

function activitySubject(activity) {
  return activity?.target || activity?.toolName || activity?.title || '活动';
}

function diffLineStyle(line) {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
    return localStyles.diffLineMeta;
  }
  if (line.startsWith('+')) {
    return localStyles.diffLineAdd;
  }
  if (line.startsWith('-')) {
    return localStyles.diffLineDelete;
  }
  return localStyles.diffLineNeutral;
}

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
  const runtimeDurationMs = useMemo(() => {
    const timestamps = runtimeDetails
      .map(detail => Number(detail?.timestamp || 0))
      .filter(Boolean);
    if (timestamps.length < 2) {
      return 0;
    }
    return Math.max(...timestamps) - Math.min(...timestamps);
  }, [runtimeDetails]);
  const changedFiles = useMemo(() => activitySummary.files.filter(file => (
    Number(file.linesAdded || 0) > 0 ||
    Number(file.linesDeleted || 0) > 0 ||
    ['write', 'edit', 'delete'].includes(file.operation)
  )), [activitySummary.files]);
  const changeTotals = useMemo(() => changedFiles.reduce((total, file) => ({
    additions: total.additions + Number(file.linesAdded || file.linesWritten || 0),
    deletions: total.deletions + Number(file.linesDeleted || 0),
  }), { additions: 0, deletions: 0 }), [changedFiles]);
  const hasFileChanges = changedFiles.length > 0;

  // Tab 状态
  const [activeTab, setActiveTab] = useState('files');
  // 文件列表展开状态
  const [showAllFiles, setShowAllFiles] = useState(false);
  // 活动列表展开状态
  const [showAllActivities, setShowAllActivities] = useState(false);
  // 文件 intent 过滤（files Tab 专用，与 activity 分离避免互相干扰）
  const [fileIntentFilter, setFileIntentFilter] = useState('all');
  // 活动 intent 过滤（activity Tab 专用）
  const [activityIntentFilter, setActivityIntentFilter] = useState('all');
  // 活动 phase 过滤
  const [activityPhaseFilter, setActivityPhaseFilter] = useState('all');
  // 活动搜索
  const [activitySearch, setActivitySearch] = useState('');
  // activity Tab 视图模式：'structured' 结构化 checklist | 'raw' 原始日志
  const [activityViewMode, setActivityViewMode] = useState('structured');
  // 活动 Tab 中的 reasoning 折叠状态
  const [showActivityReasoning, setShowActivityReasoning] = useState(false);
  // 展开的活动详情
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [expandedFileDiffs, setExpandedFileDiffs] = useState(new Set());
  const [fileDiffs, setFileDiffs] = useState({});
  const [loadingDiffs, setLoadingDiffs] = useState(new Set());
  const [changeDrawer, setChangeDrawer] = useState({
    open: false,
    mode: 'review',
    loading: false,
    diffs: {},
  });
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

  const openChangeDrawer = useCallback(async (mode) => {
    if (changedFiles.length === 0) {
      return;
    }

    setChangeDrawer({
      open: true,
      mode,
      loading: true,
      diffs: {},
    });

    const entries = await Promise.all(changedFiles.map(async (file) => {
      try {
        const result = await ipc.getFileDiff?.(file.path);
        return [file.path, result || { success: false, error: '无法读取 diff' }];
      } catch (error) {
        return [file.path, { success: false, error: error.message }];
      }
    }));

    setChangeDrawer({
      open: true,
      mode,
      loading: false,
      diffs: Object.fromEntries(entries),
    });
  }, [changedFiles, ipc]);

  const closeChangeDrawer = useCallback(() => {
    setChangeDrawer(prev => ({ ...prev, open: false }));
  }, []);

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

  const fileListFiltered = useMemo(() => {
    if (fileIntentFilter === 'all') return activitySummary.files;
    return activitySummary.files.filter(f => f.status === fileIntentFilter);
  }, [activitySummary.files, fileIntentFilter]);

  const displayedFiles = showAllFiles ? activitySummary.files : activitySummary.files.slice(0, 6);
  const displayedActivities = showAllActivities ? filteredActivities : filteredActivities.slice(-8);
  const hasMoreFiles = activitySummary.files.length > 6;
  const hasMoreActivities = filteredActivities.length > 8;

  const renderLineDelta = (parts, compact = false) => {
    if (!parts) {
      return null;
    }
    return (
      <span style={compact ? localStyles.lineDeltaCompact : localStyles.lineDeltaGroup}>
        {parts.additions > 0 && (
          <span style={{ ...localStyles.lineDeltaChip, ...localStyles.lineDeltaAdd }}>
            (+{parts.additions})
          </span>
        )}
        {parts.deletions > 0 && (
          <span style={{ ...localStyles.lineDeltaChip, ...localStyles.lineDeltaDelete }}>
            (-{parts.deletions})
          </span>
        )}
      </span>
    );
  };

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
        </button>
      ))}
    </div>
  );

  // ===== 文件 Tab：完整文件列表 + diff + 独立过滤（不与 activity 共享） =====
  const renderFiles = () => (
    <>
      <div style={localStyles.fileListHeader}>
        <span style={localStyles.fileListCount}>
          {fileIntentFilter !== 'all'
            ? `${fileListFiltered.length} / ${activitySummary.files.length}`
            : activitySummary.files.length}
        </span>
        <div style={localStyles.fileFilterGroup}>
          {['all', 'running', 'completed', 'failed', 'waiting'].map(filter => (
            <button
              key={filter}
              type="button"
              style={{
                ...localStyles.filterChip,
                ...(fileIntentFilter === filter ? localStyles.filterChipActive : {}),
              }}
              onClick={(e) => { e.stopPropagation(); setFileIntentFilter(filter); }}
            >
              {filter === 'all' ? t('ui.root') : getFileStatusLabel(filter)}
            </button>
          ))}
        </div>
      </div>
      <div style={localStyles.fileList}>
        {(showAllFiles ? fileListFiltered : fileListFiltered.slice(0, 8)).map(file => {
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
                {renderLineDelta(fileLineChangeParts(file))}
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
      {fileListFiltered.length > 8 && !showAllFiles && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllFiles(true); }}
        >
          {fileListFiltered.length}
        </button>
      )}
      {showAllFiles && fileListFiltered.length > 8 && (
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

  // ===== 活动 Tab：视图切换（结构化 checklist | 原始日志）+ 顶部 reasoning 折叠 =====
  const renderActivity = () => (
    <>
      {/* 视图切换栏：顶部有 reasoning 折叠和 结构化/原始日志 切换 */}
      <div style={localStyles.activityTopBar}>
        {/* 顶部 reasoning 折叠 */}
        {thinkingSummary.count > 0 && (
          <button
            type="button"
            style={localStyles.activityReasoningToggle}
            onClick={(e) => { e.stopPropagation(); setShowActivityReasoning(v => !v); }}
          >
            <span style={localStyles.activityReasoningIcon}>◇</span>
            <span style={localStyles.activityReasoningTitle}>
              {t('msg.thinking_summary_label')} ({thinkingSummary.count})
            </span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {showActivityReasoning ? '▾' : '▸'}
            </span>
          </button>
        )}
        {showActivityReasoning && thinkingSummary.count > 0 && (
          <div style={localStyles.reasoningList}>
            {thinkingSummary.messages.map((msg, index) => (
              <div key={msg.id || `${group.id}_activity_thinking_${index}`} style={localStyles.reasoningItem}>
                <div style={localStyles.reasoningHeader}>
                  <span style={localStyles.reasoningTitle}>
                    {msg.payload?.eventName || msg.summary || (msg.iteration ? t('msg.iteration_x', { n: msg.iteration }) : t('msg.fragment_n', { n: index + 1 }))}
                  </span>
                  {msg.timestamp && <span style={localStyles.reasoningTime}>{new Date(msg.timestamp).toLocaleTimeString()}</span>}
                </div>
                <div style={localStyles.reasoningText}>
                  {msg.thinkingText || msg.summary || msg.payload?.message || msg.payload?.data?.textPreview || msg.content || t('msg.model_thinking')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 视图切换：结构化 checklist | 原始日志 */}
        <div style={localStyles.activityViewSwitcher}>
          <button
            type="button"
            style={{
              ...localStyles.viewTab,
              ...(activityViewMode === 'structured' ? localStyles.viewTabActive : {}),
            }}
            onClick={(e) => { e.stopPropagation(); setActivityViewMode('structured'); }}
          >
            ☑ 结构化 ({activitySummary.total || filteredActivities.length})
          </button>
          <button
            type="button"
            style={{
              ...localStyles.viewTab,
              ...(activityViewMode === 'raw' ? localStyles.viewTabActive : {}),
            }}
            onClick={(e) => { e.stopPropagation(); setActivityViewMode('raw'); }}
          >
            ☰ 原始日志 ({visibleRuntimeDetails.length})
          </button>
        </div>
      </div>

      {/* 结构化视图：搜索 + 过滤 + checklist */}
      {activityViewMode === 'structured' && (
        <>
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
                          <span style={styles.activityTitle} title={activitySubject(activity)}>
                            {activitySubject(activity)}
                          </span>
                          <span style={localStyles.activityPhaseChip}>{phaseLabel(activity.phase)}</span>
                          {duration !== null && (
                            <span style={localStyles.activityDuration}>{formatDuration(duration)}</span>
                          )}
                        </div>
                        {renderLineDelta(lineChangeParts(activity.counts))}
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
      )}

      {/* 原始日志视图：完整 runtime details */}
      {activityViewMode === 'raw' && (
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
      )}
    </>
  );

  // ===== 渲染 Tab 内容 =====
  const renderTabContent = () => {
    switch (activeTab) {
      case 'files': return renderFiles();
      case 'activity': return renderActivity();
      default: return renderFiles();
    }
  };

  const renderDiffBlock = (diffText) => (
    <pre style={localStyles.drawerDiffPre}>
      {String(diffText || '').split('\n').map((line, index) => (
        <span key={`${index}_${line.slice(0, 16)}`} style={{ ...localStyles.drawerDiffLine, ...diffLineStyle(line) }}>
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );

  const renderChangeDrawer = () => {
    if (!changeDrawer.open) {
      return null;
    }

    return (
      <div style={localStyles.drawerBackdrop} onClick={closeChangeDrawer}>
        <aside style={localStyles.changeDrawer} onClick={(event) => event.stopPropagation()}>
          <div style={localStyles.drawerHeader}>
            <div>
              <div style={localStyles.drawerTitle}>
                {changeDrawer.mode === 'undo' ? '撤销变更' : '审核变更'}
              </div>
              <div style={localStyles.drawerMeta}>
                {changedFiles.length} 个文件 · {renderLineDelta(changeTotals, true)}
              </div>
            </div>
            <button type="button" style={localStyles.drawerCloseButton} onClick={closeChangeDrawer}>
              ×
            </button>
          </div>

          <div style={localStyles.drawerFileList}>
            {changedFiles.map((file) => {
              const diffResult = changeDrawer.diffs[file.path];
              return (
                <section key={file.path} style={localStyles.drawerFileSection}>
                  <div style={localStyles.drawerFileHeader}>
                    <span style={localStyles.fileTypeIcon}>{getFileTypeIcon(file.path)}</span>
                    <span style={localStyles.drawerFilePath} title={file.path}>{file.path}</span>
                    {renderLineDelta(fileLineChangeParts(file), true)}
                  </div>
                  {changeDrawer.loading && (
                    <div style={localStyles.fileDiffEmpty}>{t('common.loading')}</div>
                  )}
                  {!changeDrawer.loading && diffResult?.success === false && (
                    <div style={localStyles.fileDiffEmpty}>{diffResult.error || t('common.error')}</div>
                  )}
                  {!changeDrawer.loading && diffResult?.success !== false && !diffResult?.hasDiff && (
                    <div style={localStyles.fileDiffEmpty}>没有可显示的未提交 diff</div>
                  )}
                  {!changeDrawer.loading && diffResult?.diff && renderDiffBlock(diffResult.diff)}
                </section>
              );
            })}
          </div>
        </aside>
      </div>
    );
  };

  const renderCompactCompletedPanel = () => {
    const failedActivityCount = activitySummary.activities.filter(activity => activity.phase === 'failed').length;
    const totalActivityCount = activitySummary.total || visibleRuntimeDetails.length || activitySummary.activities.length;
    const fileCount = changedFiles.length || activitySummary.files.length;
    const summaryItems = [
      runtimeDurationMs > 0 ? formatDuration(runtimeDurationMs) : null,
      totalActivityCount > 0 ? `${totalActivityCount} steps` : null,
      fileCount > 0 ? `${fileCount} files` : null,
      failedActivityCount > 0 ? `${failedActivityCount} failed` : null,
    ].filter(Boolean);

    return (
      <div key={`${group.id}_runtime`} style={localStyles.completedCapsuleHost}>
        <div
          style={localStyles.executionHud}
          onClick={() => onRuntimeDetailsToggle(group.id)}
          title={t('msg.details')}
        >
          <div style={localStyles.executionHudMain}>
            <div style={localStyles.executionHudTitleRow}>
              <span style={localStyles.executionStatusMark}>
                <span style={localStyles.capsuleDot} />
                {statusText}
              </span>
              {summaryItems.length > 0 && (
                <span style={localStyles.executionSummaryText}>
                  {summaryItems.map((item, index) => (
                    <React.Fragment key={item}>
                      {index > 0 && <span style={localStyles.executionSeparator}>·</span>}
                      <span style={failedActivityCount > 0 && item.endsWith('failed') ? localStyles.executionSummaryError : undefined}>
                        {item}
                      </span>
                    </React.Fragment>
                  ))}
                </span>
              )}
              {hasFileChanges && renderLineDelta(changeTotals, true)}
            </div>
          </div>

          <div style={localStyles.executionActionCluster}>
            {hasFileChanges && (
              <>
                <button
                  type="button"
                  style={localStyles.capsuleActionButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    openChangeDrawer('undo');
                  }}
                >
                  撤销
                </button>
                <button
                  type="button"
                  style={localStyles.capsuleActionButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    openChangeDrawer('review');
                  }}
                >
                  审核
                </button>
              </>
            )}
            <button
              type="button"
              style={localStyles.capsuleDetailsButton}
              onClick={(event) => {
                event.stopPropagation();
                onRuntimeDetailsToggle(group.id);
              }}
            >
              详情
            </button>
          </div>
        </div>
        {renderChangeDrawer()}
      </div>
    );
  };

  if (!isRunningGroup && !isExpanded) {
    return renderCompactCompletedPanel();
  }

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
          {hasFileChanges && renderLineDelta(changeTotals, true)}
          {hasFileChanges && (
            <>
              <button
                type="button"
                style={styles.activityActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  openChangeDrawer('undo');
                }}
              >
                撤销
              </button>
              <button
                type="button"
                style={styles.activityActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  openChangeDrawer('review');
                }}
              >
                审核
              </button>
            </>
          )}
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
      {renderChangeDrawer()}
    </div>
  );
}
