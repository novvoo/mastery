import React from 'react';
import { t } from '../../i18n.js';
import { Button, Icon, Panel } from '../ui/index.js';
import { TabGroup, TabItem } from '../ui/Tab.jsx';
import { LAYOUT } from '../../app/config/index.js';
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
                ×
              </button>
            </div>
          ))
        )}
      </div>

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
