import { useState, useCallback, useEffect, useRef } from 'react';
import {
  formatPreviewUrlInput,
  normalizePreviewUrlInput,
} from '../runtime/preview-url.js';
import {
  PREVIEW_URL_STORAGE_KEY,
  readStoredPreviewUrl,
} from '../app/session/session-storage.js';

/**
 * 预览会话管理 — 启动/停止/URL 管理
 *
 * @param {object} ipc - IPC 实例
 * @param {object} runtime - runtime 实例
 * @param {object} layoutCallbacks - 布局回调 { setSummaryPanelVisible, setActiveInspectorTab }
 */
export function usePreview(ipc, runtime, layoutCallbacks) {
  const { setSummaryPanelVisible, setActiveInspectorTab } = layoutCallbacks;

  const [previewSession, setPreviewSession] = useState(null);
  const [previewStatus, setPreviewStatus] = useState('idle');
  const [previewFrameKey, setPreviewFrameKey] = useState(0);
  const [activePreviewUrl, setActivePreviewUrl] = useState(readStoredPreviewUrl);
  const [previewUrlDraft, setPreviewUrlDraft] = useState(() => {
    const storedUrl = readStoredPreviewUrl();
    return storedUrl ? formatPreviewUrlInput(storedUrl) : '';
  });

  // 持久化预览 URL
  useEffect(() => {
    if (activePreviewUrl) {
      localStorage.setItem(PREVIEW_URL_STORAGE_KEY, activePreviewUrl);
      return;
    }
    localStorage.removeItem(PREVIEW_URL_STORAGE_KEY);
  }, [activePreviewUrl]);

  const followPreviewUrl = useCallback((url) => {
    const normalizedUrl = normalizePreviewUrlInput(url);
    if (!normalizedUrl) return;
    setActivePreviewUrl(normalizedUrl);
    setPreviewUrlDraft(formatPreviewUrlInput(normalizedUrl));
  }, []);

  // 显示预览面板的辅助函数
  const showPreviewPanel = useCallback(() => {
    setSummaryPanelVisible(true);
    setActiveInspectorTab('preview');
  }, [setSummaryPanelVisible, setActiveInspectorTab]);

  const handleStartPreview = useCallback(
    async (target = '.') => {
      if (!ipc.startPreview) return null;

      setPreviewStatus('starting');
      showPreviewPanel();
      try {
        const preview = await ipc.startPreview({ target, kind: 'auto' });
        setPreviewSession(preview);
        followPreviewUrl(preview.url);
        setPreviewStatus('ready');
        showPreviewPanel();
        setPreviewFrameKey((prev) => prev + 1);
        return preview;
      } catch (error) {
        setPreviewStatus('error');
        runtime.addMessage?.({
          type: 'error',
          content: `预览启动失败: ${error.message}`,
        });
        return null;
      }
    },
    [followPreviewUrl, ipc, runtime, showPreviewPanel],
  );

  const handleStopPreview = useCallback(async () => {
    if (!previewSession?.session_id || !ipc.stopPreview) return;

    await ipc.stopPreview(previewSession.session_id);
    setPreviewSession(null);
    setActivePreviewUrl(null);
    setPreviewUrlDraft('');
    setPreviewStatus('idle');
  }, [ipc, previewSession]);

  const handlePreviewUrlSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const normalizedUrl = normalizePreviewUrlInput(previewUrlDraft);
      if (!normalizedUrl) {
        setPreviewStatus('error');
        return;
      }
      setPreviewStatus('ready');
      setActivePreviewUrl(normalizedUrl);
      setPreviewUrlDraft(formatPreviewUrlInput(normalizedUrl));
      setPreviewFrameKey((prev) => prev + 1);
    },
    [previewUrlDraft],
  );

  const handleRefreshPreviewFrame = useCallback(() => {
    setPreviewFrameKey((prev) => prev + 1);
  }, []);

  // 预览事件监听
  useEffect(() => {
    if (!ipc.isConnected) return undefined;

    let unsubscribeStarted = null;
    let unsubscribeStopped = null;

    ipc
      .listPreviews?.()
      .then((result) => {
        const previews = result?.previews || [];
        if (previews.length > 0) {
          setPreviewSession(previews[0]);
          followPreviewUrl(previews[0].url);
          showPreviewPanel();
          setPreviewStatus('ready');
        }
      })
      .catch(() => {});

    if (ipc.onPreviewStarted) {
      unsubscribeStarted = ipc.onPreviewStarted((preview) => {
        setPreviewSession(preview);
        followPreviewUrl(preview.url);
        showPreviewPanel();
        setPreviewStatus('ready');
        setPreviewFrameKey((prev) => prev + 1);
      });
    }

    if (ipc.onPreviewStopped) {
      unsubscribeStopped = ipc.onPreviewStopped((result) => {
        if (result?.stopped === previewSession?.session_id) {
          setPreviewSession(null);
          setActivePreviewUrl(null);
          setPreviewUrlDraft('');
          setPreviewStatus('idle');
        }
      });
    }

    return () => {
      unsubscribeStarted?.();
      unsubscribeStopped?.();
    };
  }, [
    followPreviewUrl,
    ipc.isConnected,
    ipc.listPreviews,
    ipc.onPreviewStarted,
    ipc.onPreviewStopped,
    previewSession?.session_id,
    showPreviewPanel,
  ]);

  return {
    previewSession,
    setPreviewSession,
    previewStatus,
    setPreviewStatus,
    previewFrameKey,
    setPreviewFrameKey,
    activePreviewUrl,
    previewUrlDraft,
    setPreviewUrlDraft,
    followPreviewUrl,
    handleStartPreview,
    handleStopPreview,
    handlePreviewUrlSubmit,
    handleRefreshPreviewFrame,
    showPreviewPanel,
  };
}
