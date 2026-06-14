import React, { useState, useMemo, useCallback } from 'react';
import { styles } from '../MessageLog.styles.js';
import { useIPC } from '../../hooks/useIPC.js';
import {
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
  { id: 'overview', label: '概览', icon: '◉' },
  { id: 'files', label: '文件', icon: '🖹' },
  { id: 'activity', label: '活动', icon: '⚡' },
  { id: 'log', label: '日志', icon: '☰' },
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
  { value: 'all', label: '全部' },
  { value: 'read', label: '读取' },
  { value: 'write', label: '写入' },
  { value: 'edit', label: '编辑' },
  { value: 'delete', label: '删除' },
  { value: 'verify', label: '验证' },
  { value: 'command', label: '命令' },
  { value: 'interaction', label: '交互' },
];

const PHASE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'waiting', label: '等待' },
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

  if (visibleRuntimeDetails.length === 0 && !isRunningGroup && activitySummary.activities.length === 0) {
    return null;
  }

  // ===== 过滤活动 =====
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
          title={tab.label}
        >
          <span style={localStyles.tabIcon}>{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.id === 'files' && activitySummary.files.length > 0 && (
            <span style={localStyles.tabBadge}>{activitySummary.files.length}</span>
          )}
          {tab.id === 'activity' && activitySummary.activities.length > 0 && (
            <span style={localStyles.tabBadge}>{activitySummary.activities.length}</span>
          )}
          {tab.id === 'log' && visibleRuntimeDetails.length > 0 && (
            <span style={localStyles.tabBadge}>{visibleRuntimeDetails.length}</span>
          )}
        </button>
      ))}
    </div>
  );

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
          <span style={localStyles.overviewStatLabel}>文件</span>
        </span>
        <span style={localStyles.overviewStat}>
          <span style={localStyles.overviewStatValue}>{activitySummary.completed}</span>
          <span style={localStyles.overviewStatLabel}>完成</span>
        </span>
        <span style={localStyles.overviewStat}>
          <span style={{ ...localStyles.overviewStatValue, color: activitySummary.reviewable > 0 ? 'var(--warning-color)' : 'var(--text-muted)' }}>{activitySummary.reviewable}</span>
          <span style={localStyles.overviewStatLabel}>审核</span>
        </span>
        <span style={localStyles.overviewStat}>
          <span style={{ ...localStyles.overviewStatValue, color: activitySummary.undoable > 0 ? 'var(--info-color)' : 'var(--text-muted)' }}>{activitySummary.undoable}</span>
          <span style={localStyles.overviewStatLabel}>可撤销</span>
        </span>
        {activitySummary.waitingForUser && (
          <span style={{ ...localStyles.overviewStat, color: 'var(--warning-color)' }}>
            <span>等待确认</span>
            <button
              type="button"
              style={styles.activityActionButton}
              title="确认继续执行"
              onClick={(event) => {
                event.stopPropagation();
                onActivityAction?.('continue', {
                  kind: 'tool_activity',
                  phase: 'waiting',
                  intent: 'interaction',
                  statusText: '等待用户确认',
                });
              }}
            >
              确认继续
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
              +{activitySummary.files.length - 4} 个文件
            </button>
          )}
        </div>
      )}
    </>
  );

  // ===== 文件 Tab =====
  const renderFiles = () => (
    <>
      <div style={localStyles.fileListHeader}>
        <span style={localStyles.fileListCount}>{activitySummary.files.length} 个文件</span>
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
              {filter === 'all' ? '全部' : getFileStatusLabel(filter)}
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
                title={isDiffExpanded ? '收起 diff' : '展开 diff'}
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
                  {isDiffLoading && <div style={localStyles.fileDiffEmpty}>正在读取 diff...</div>}
                  {!isDiffLoading && diffResult?.success === false && (
                    <div style={localStyles.fileDiffEmpty}>{diffResult.error || '无法读取 diff'}</div>
                  )}
                  {!isDiffLoading && diffResult?.success !== false && !diffResult?.hasDiff && (
                    <div style={localStyles.fileDiffEmpty}>没有未提交 diff</div>
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
          显示全部 {activitySummary.files.length} 个文件
        </button>
      )}
      {showAllFiles && hasMoreFiles && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllFiles(false); }}
        >
          收起
        </button>
      )}
      {activitySummary.files.length === 0 && (
        <div style={localStyles.emptyTab}>暂无文件操作记录</div>
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
          placeholder="搜索活动..."
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
              title={`筛选: ${f.label}`}
            >
              {f.label}
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
              title={`状态: ${f.label}`}
            >
              {f.label}
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
                        title={isExpandedDetail ? '收起详情' : '展开详情'}
                      >
                        {isExpandedDetail ? '▾' : '▸'} 详情
                      </button>
                    )}
                  </div>
                </div>
                <div style={styles.activityActions}>
                  {activity.canUndo && (
                    <button
                      type="button"
                      style={styles.activityActionButton}
                      title="让 Agent 准备撤销这次变更"
                      onClick={(event) => {
                        event.stopPropagation();
                        onActivityAction?.('undo', activity);
                      }}
                    >
                      撤销
                    </button>
                  )}
                  {activity.canReview && (
                    <button
                      type="button"
                      style={styles.activityActionButton}
                      title="审核这次文件变更"
                      onClick={(event) => {
                        event.stopPropagation();
                        onActivityAction?.('review', activity);
                      }}
                    >
                      审核
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
          显示全部 {filteredActivities.length} 条活动
        </button>
      )}
      {showAllActivities && hasMoreActivities && (
        <button
          type="button"
          style={localStyles.showMoreButton}
          onClick={(e) => { e.stopPropagation(); setShowAllActivities(false); }}
        >
          收起
        </button>
      )}
      {filteredActivities.length === 0 && (
        <div style={localStyles.emptyTab}>
          {activitySearch ? '没有匹配的活动' : '暂无活动记录'}
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
          ? (content ? content.split('\n')[0].trim() : '(无内容)')
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
            title={detailExpanded ? '收起' : '展开'}
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
      {visibleRuntimeDetails.length === 0 && (
        <div style={localStyles.emptyTab}>暂无运行日志</div>
      )}
    </div>
  );

  // ===== 渲染 Tab 内容 =====
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview': return renderOverview();
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
        title={isExpanded ? '收起运行详情' : '展开运行详情'}
      >
        <span style={styles.runtimeDetailsTitle}>
          {isRunningGroup && <span style={styles.spinner}></span>}
          <span>{isRunningGroup ? '执行过程' : '执行摘要'}</span>
        </span>
        <span style={styles.runtimeDetailsActions}>
          <span style={styles.runtimeStatusChip} title={statusText}>{statusText}</span>
          <span>{activitySummary.total || visibleRuntimeDetails.length} 项</span>
          {visibleRuntimeDetails.length > 0 && (
            <button
              type="button"
              style={styles.runtimeDetailsToggle}
              title="导出运行详情为 JSON"
              aria-label="导出运行详情"
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
            title={isLarge ? '还原执行过程窗口' : '放大执行过程窗口'}
            aria-label={isLarge ? '还原执行过程窗口' : '放大执行过程窗口'}
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
            title={isExpanded ? '收起运行详情' : '展开运行详情'}
            aria-label={isExpanded ? '收起运行详情' : '展开运行详情'}
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
    backgroundColor: 'rgba(16, 16, 17, 0.5)',
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
    backgroundColor: 'rgba(232, 120, 74, 0.04)',
  },
  tabIcon: {
    fontSize: '11px',
  },
  tabBadge: {
    padding: '0 5px',
    borderRadius: '999px',
    backgroundColor: 'rgba(245, 240, 235, 0.08)',
    color: 'var(--text-dark)',
    fontSize: '10px',
    fontWeight: 700,
    minWidth: '16px',
    textAlign: 'center',
  },
  tabContent: {
    overflow: 'hidden',
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
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
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
    backgroundColor: 'rgba(245, 240, 235, 0.06)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
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
    backgroundColor: 'rgba(245, 240, 235, 0.06)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: 600,
    transition: 'all 0.15s',
  },
  filterChipActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    borderColor: 'rgba(232, 120, 74, 0.3)',
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
    backgroundColor: 'rgba(245, 240, 235, 0.08)',
    color: 'var(--text-muted)',
    marginTop: '1px',
  },
  checkMarkDone: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    color: 'var(--success-color)',
  },
  checkMarkFail: {
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
    color: 'var(--error-color)',
  },
  checkMarkWait: {
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
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
    backgroundColor: 'rgba(245, 240, 235, 0.06)',
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
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
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
