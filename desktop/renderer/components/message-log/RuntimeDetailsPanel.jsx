import React from 'react';
import { styles } from '../MessageLog.styles.js';
import {
  createRuntimeDetailId,
  getRuntimeDetailContent,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  isStatusUpdateMessage,
} from './runtime-details.js';
import { buildActivitySummary, getActivityTone, getFileStatusLabel } from './activity-summary.js';

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
  const runtimeDetails = group?.runtimeDetails || [];
  const visibleRuntimeDetails = runtimeDetails.filter(msg => !isStatusUpdateMessage(msg));
  const latestStatusUpdate = [...runtimeDetails].reverse().find(isStatusUpdateMessage);
  const activitySummary = buildActivitySummary(runtimeDetails);
  const isRunningGroup = status === 'running' && isActiveGroup;
  const statusText = isRunningGroup || latestStatusUpdate
    ? getStatusUpdateText(latestStatusUpdate)
    : '执行完成';

  if (visibleRuntimeDetails.length === 0 && !isRunningGroup) {
    return null;
  }

  return (
    <div key={`${group.id}_runtime`} style={styles.runtimeDetailsPanel}>
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
      {isRunningGroup && (
        <div style={styles.runtimeProgress}>
          <div style={styles.runtimeProgressText}>
            <span style={styles.runtimeProgressLabel}>{statusText}</span>
            <span>
              {activitySummary.running} 进行中 / {activitySummary.completed} 完成
              {activitySummary.failed > 0 ? ` / ${activitySummary.failed} 失败` : ''}
            </span>
          </div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${Math.max(6, activitySummary.progress)}%` }} />
          </div>
        </div>
      )}
      {activitySummary.activities.length > 0 && (
        <div style={styles.activityPanel}>
          <div style={styles.activitySummaryRow}>
            <span>文件 {activitySummary.fileCount}</span>
            <span>完成 {activitySummary.completed}</span>
            <span>审核 {activitySummary.reviewable}</span>
            <span>可撤销 {activitySummary.undoable}</span>
            {activitySummary.waitingForUser && <span>等待确认</span>}
            {activitySummary.waitingForUser && (
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
            )}
          </div>
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
          {activitySummary.files.length > 0 && (
            <div style={styles.fileStatusList}>
              {activitySummary.files.slice(0, 6).map(file => (
                <div key={file.path} style={styles.fileStatusItem}>
                  <span style={styles.fileStatusPath} title={file.path}>{file.path}</span>
                  <span style={styles.fileStatusChip}>{getFileStatusLabel(file.status)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={styles.activityList}>
            {activitySummary.activities.slice(-8).map((activity, index) => {
              const tone = getActivityTone(activity);
              return (
                <div
                  key={`${activity.id || activity.toolName}_${index}`}
                  style={{
                    ...styles.activityItem,
                    ...(tone === 'completed' ? styles.activityItemCompleted : {}),
                    ...(tone === 'failed' ? styles.activityItemFailed : {}),
                    ...(tone === 'waiting' ? styles.activityItemWaiting : {}),
                  }}
                >
                  <div style={styles.activityMain}>
                    <span style={styles.activityStatusDot}></span>
                    <span style={styles.activityTitle} title={activity.statusText || activity.title}>
                      {activity.statusText || activity.title}
                    </span>
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
              );
            })}
          </div>
        </div>
      )}
      {visibleRuntimeDetails.length > 0 && (
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
        </div>
      )}
    </div>
  );
}
