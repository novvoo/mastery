import { useState, useCallback, useEffect } from 'react';
import {
  getDocumentDisplayName,
  mergeRagDocuments,
  normalizeRagDocuments,
} from '../app/session/session-storage.js';

/**
 * RAG 文档管理 — 添加/索引/删除/重置
 *
 * @param {object} ipc - IPC 实例
 * @param {string} workingDirectory - 当前工作目录
 */
export function useRagDocuments(ipc, workingDirectory) {
  const [ragDocs, setRagDocs] = useState([]);
  const [ragStatus, setRagStatus] = useState('idle');
  const [ragIndexProgress, setRagIndexProgress] = useState(0);

  const refreshRagDocuments = useCallback(async () => {
    setRagStatus(ragDocs.length > 0 ? 'ready' : 'idle');
    setRagIndexProgress(ragDocs.length > 0 ? 100 : 0);
    return ragDocs;
  }, [ragDocs]);

  // 工作目录变更时刷新 RAG 文档
  useEffect(() => {
    if (!workingDirectory || !ipc.isConnected) return;
    refreshRagDocuments();
  }, [workingDirectory, ipc.isConnected, refreshRagDocuments]);

  const handleAddRagDocuments = useCallback(async () => {
    try {
      if (!ipc.hasElectronAPI()) return;
      const result = await ipc.openFileDialog({ properties: ['openFile', 'multiSelections'] });
      const paths = result?.filePaths || result || [];
      const files = (paths || []).map((path) => ({
        name: getDocumentDisplayName(path),
        path,
        indexed: false,
      }));
      setRagDocs((prev) => mergeRagDocuments(prev, files));
    } catch (error) {
      console.error('选择文件失败', error);
    }
  }, [ipc]);

  const handleInitializeRagIndex = useCallback(async () => {
    if (ragDocs.length === 0) return;
    setRagStatus('indexing');
    setRagIndexProgress(0);
    try {
      setRagDocs((prev) => prev.map((doc) => ({ ...doc, indexed: true })));
      setRagStatus('ready');
      setRagIndexProgress(100);
    } catch (error) {
      console.error('RAG 初始化失败', error);
      setRagStatus('error');
    }
  }, [ipc, ragDocs, refreshRagDocuments]);

  const handleRemoveRagDocument = useCallback(
    async (doc, index) => {
      setRagDocs((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    },
    [ipc, refreshRagDocuments],
  );

  const handleResetRag = useCallback(async () => {
    setRagDocs([]);
    setRagStatus('idle');
    setRagIndexProgress(0);
  }, []);

  /** 重置 RAG 状态 (工作目录切换时调用) */
  const resetRag = useCallback(() => {
    setRagDocs([]);
    setRagStatus('idle');
    setRagIndexProgress(0);
  }, []);

  return {
    ragDocs,
    ragStatus,
    ragIndexProgress,
    refreshRagDocuments,
    handleAddRagDocuments,
    handleInitializeRagIndex,
    handleRemoveRagDocument,
    handleResetRag,
    resetRag,
  };
}
