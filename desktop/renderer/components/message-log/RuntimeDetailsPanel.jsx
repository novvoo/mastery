import React from 'react';
import { styles } from '../MessageLog.styles.js';
import {
  createRuntimeDetailId,
  getRuntimeDetailContent,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  isStatusUpdateMessage,
} from './runtime-details.js';

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
  onRefChange,
  onRuntimeDetailToggle,
  onRuntimeDetailsToggle,
}) {
  const runtimeDetails = group?.runtimeDetails || [];
  const visibleRuntimeDetails = runtimeDetails.filter(msg => !isStatusUpdateMessage(msg));
  const latestStatusUpdate = [...runtimeDetails].reverse().find(isStatusUpdateMessage);
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
          <span>{isRunningGroup ? '执行过程' : '运行详情'}</span>
        </span>
        <span style={styles.runtimeDetailsActions}>
          <span style={styles.runtimeStatusChip} title={statusText}>{statusText}</span>
          <span>{visibleRuntimeDetails.length} 条</span>
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
            <span>{visibleRuntimeDetails.length} 个事件</span>
          </div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: '100%' }} />
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
