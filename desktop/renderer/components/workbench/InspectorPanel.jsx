import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n.js';
import { Button, Icon, Panel } from '../ui/index.js';
import { TabGroup, TabItem } from '../ui/Tab.jsx';
import { LAYOUT } from '../../app/config/index.js';
import { styles } from '../../app/styles.js';

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
  previewFrameKey,
  previewSession,
  previewStatus,
  previewUrlDraft,
  ragDocs,
  ragStatus,
  workingDirectory,
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
