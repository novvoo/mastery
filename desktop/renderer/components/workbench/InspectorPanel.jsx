import React from 'react';
import { Button, Panel } from '../ui/index.js';
import { TabGroup, TabItem } from '../ui/Tab.jsx';
import { LAYOUT } from '../../app/config.js';
import { styles } from '../../app/styles.js';

function RagTab({
  ipc,
  ragDocs,
  ragStatus,
  onAddDocuments,
  onInitializeIndex,
  onRemoveDocument,
  onInsertDocSearch,
  onResetRag,
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>RAG 初始化</div>
        <div style={styles.inspectorHelpText}>
          使用检索增强生成（RAG）之前，请上传/选择要索引的文档，并执行索引初始化。
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button style={styles.button} onClick={onAddDocuments}>上传文档</button>
          <button style={styles.button} onClick={onInitializeIndex} disabled={ragDocs.length === 0}>初始化索引</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ fontSize: '12px' }}>状态:</div>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>{ragStatus}</div>
        </div>
      </div>

      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>已加载文档</div>
        {ragDocs.length === 0 ? (
          <div style={{ ...styles.summaryItem, ...styles.summaryItemEmpty }}>尚未上传文档</div>
        ) : (
          ragDocs.map((doc, index) => (
            <div key={`${doc.id || doc.path}-${index}`} style={styles.inspectorDocumentItem}>
              <div style={styles.summaryItemIcon}>DOC</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.inspectorDocumentName}>{doc.name}</div>
                <div style={styles.inspectorDocumentPath}>{doc.path}</div>
              </div>
              <button
                style={styles.button}
                onClick={() => onRemoveDocument(doc, index)}
              >
                移除
              </button>
            </div>
          ))
        )}
      </div>

      <div style={styles.summarySection}>
        <div style={styles.summarySectionTitle}>操作</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button style={styles.button} onClick={onInsertDocSearch}>快速创建文档搜索命令</button>
          <button style={styles.button} onClick={onResetRag} disabled={!ipc.processInput && ragDocs.length === 0}>重置 RAG</button>
        </div>
      </div>
    </div>
  );
}

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
          <div style={styles.inspectorKicker}>预览</div>
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
                title="点击在外部浏览器中打开"
              >
                {activePreviewUrl}
              </a>
            ) : (
              previewStatus === 'starting' ? '正在启动...' : '尚未启动'
            )}
          </div>
        </div>
        <button style={styles.button} onClick={onRefreshFrame} disabled={!activePreviewUrl}>刷新</button>
        <button style={styles.button} onClick={() => activePreviewUrl && onOpenExternal(activePreviewUrl)} disabled={!activePreviewUrl}>浏览器</button>
        <button
          style={styles.iconButton}
          onClick={onExpandToggle}
          title={inspectorExpanded ? '还原预览区域' : '放大预览区域'}
          aria-label={inspectorExpanded ? '还原预览区域' : '放大预览区域'}
        >
          {inspectorExpanded ? '↙' : '⛶'}
        </button>
        {previewSession?.session_id ? (
          <button style={styles.button} onClick={onStopPreview}>停止</button>
        ) : (
          <button style={styles.button} onClick={() => onStartPreview('.')}>启动</button>
        )}
      </div>

      <form style={styles.previewUrlForm} onSubmit={onPreviewUrlSubmit}>
        <input
          style={styles.previewUrlInput}
          value={previewUrlDraft}
          onChange={(event) => onPreviewUrlDraftChange(event.target.value)}
          placeholder="127.0.0.1:41730"
        />
        <button style={styles.button} type="submit">前往</button>
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
                backgroundColor: stage.status === 'running' ? 'rgba(79, 140, 255, 0.08)' : 'var(--surface-color)',
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
            ? '预览启动失败，请查看对话中的错误消息。'
            : '点击启动，或在对话里输入 /preview index.html。'}
        </div>
      )}
    </div>
  );
}

export function InspectorPanel({
  activeInspectorTab,
  activePreviewUrl,
  inspectorExpanded,
  inspectorPanelWidth,
  ipc,
  previewFrameKey,
  previewSession,
  previewStatus,
  previewUrlDraft,
  ragDocs,
  ragStatus,
  onAddDocuments,
  onExpandToggle,
  onInitializeIndex,
  onInsertDocSearch,
  onOpenExternal,
  onPreviewUrlDraftChange,
  onPreviewUrlSubmit,
  onRefreshFrame,
  onRemoveDocument,
  onResetRag,
  onResizeStart,
  onStartPreview,
  onStopPreview,
  onTabChange,
}) {
  return (
    <Panel
      variant="inspector"
      collapsed={false}
      width={inspectorPanelWidth}
      ariaLabel="Inspector 面板"
      style={{
        minWidth: `${LAYOUT.inspectorMinWidth}px`,
        maxWidth: `${LAYOUT.inspectorMaxWidth}px`,
      }}
    >
      <div
        style={styles.inspectorResizeHandle}
        onPointerDown={onResizeStart}
        title="拖拽调整 Inspector 宽度"
        role="separator"
        aria-orientation="vertical"
      />
      <div style={styles.inspectorHeader}>
        <TabGroup activeTab={activeInspectorTab} onChange={onTabChange}>
          <TabItem id="rag">RAG</TabItem>
          <TabItem id="preview">Preview</TabItem>
        </TabGroup>
        <Button
          variant="icon"
          size="sm"
          onClick={onExpandToggle}
          title={inspectorExpanded ? '还原预览区域' : '放大预览区域'}
          ariaLabel={inspectorExpanded ? '还原预览区域' : '放大预览区域'}
        >
          {inspectorExpanded ? '↙' : '⛶'}
        </Button>
      </div>

      {activeInspectorTab === 'rag' && (
        <RagTab
          ipc={ipc}
          ragDocs={ragDocs}
          ragStatus={ragStatus}
          onAddDocuments={onAddDocuments}
          onInitializeIndex={onInitializeIndex}
          onInsertDocSearch={onInsertDocSearch}
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
