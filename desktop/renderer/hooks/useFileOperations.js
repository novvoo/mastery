import { useState, useCallback, useRef } from 'react';

/**
 * 文件操作 Hook
 * 封装文件打开、保存、关闭等操作的状态和逻辑
 */
export function useFileOperations({ ipc }) {
  const [openFile, setOpenFile] = useState(null);
  const [fileDraft, setFileDraft] = useState('');
  const [fileMode, setFileMode] = useState('preview');
  const [fileStatus, setFileStatus] = useState('idle');
  const [fileError, setFileError] = useState('');

  // 使用 ref 存储回调，避免依赖问题
  const onAfterSaveRef = useRef(null);

  const setAfterSaveCallback = useCallback((fn) => {
    onAfterSaveRef.current = fn;
  }, []);

  // 读取文件的辅助函数
  const readWorkspaceFile = useCallback(
    async (entry) => {
      if (!entry?.path || entry.type === 'directory') {
        return;
      }

      setOpenFile({
        path: entry.path,
        name: entry.name,
        content: '',
        size: 0,
      });
      setFileDraft('');
      setFileMode('preview');
      setFileStatus('loading');
      setFileError('');

      try {
        const result = await ipc.readWorkspaceFile(entry.path);
        if (!result?.success) {
          setFileStatus('error');
          setFileError(result?.error || '无法读取文件');
          return;
        }
        setOpenFile({
          path: result.path || entry.path,
          name: result.name || entry.name,
          content: result.content || '',
          size: result.size || 0,
          mtimeMs: result.mtimeMs,
        });
        setFileDraft(result.content || '');
        setFileStatus('ready');
      } catch (error) {
        setFileStatus('error');
        setFileError(error.message || '无法读取文件');
      }
    },
    [ipc],
  );

  // 保存文件的辅助函数
  const writeWorkspaceFile = useCallback(async () => {
    if (!openFile?.path) {
      return;
    }
    setFileStatus('saving');
    setFileError('');
    try {
      const result = await ipc.writeWorkspaceFile(openFile.path, fileDraft);
      if (!result?.success) {
        setFileStatus('error');
        setFileError(result?.error || '保存失败');
        return;
      }
      setOpenFile((prev) => ({
        ...prev,
        content: fileDraft,
        size: result.size || fileDraft.length,
        mtimeMs: result.mtimeMs,
      }));
      setFileMode('preview');
      setFileStatus('ready');
      onAfterSaveRef.current?.();
    } catch (error) {
      setFileStatus('error');
      setFileError(error.message || '保存失败');
    }
  }, [fileDraft, ipc, openFile?.path]);

  // 关闭文件的辅助函数
  const closeFile = useCallback(() => {
    setOpenFile(null);
    setFileDraft('');
    setFileMode('preview');
    setFileStatus('idle');
    setFileError('');
  }, []);

  // 创建文件
  const createFile = useCallback(
    async (path, content = '') => {
      try {
        const result = await ipc.createWorkspaceFile(path, content);
        if (!result?.success) {
          return { success: false, error: result?.error || '创建文件失败' };
        }
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    [ipc],
  );

  // 创建目录
  const createDirectory = useCallback(
    async (path) => {
      try {
        const result = await ipc.createWorkspaceDirectory(path);
        if (!result?.success) {
          return { success: false, error: result?.error || '创建目录失败' };
        }
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    [ipc],
  );

  // 删除文件或目录
  const deleteItem = useCallback(
    async (path) => {
      try {
        const result = await ipc.deleteWorkspaceFile(path);
        if (!result?.success) {
          return { success: false, error: result?.error || '删除失败' };
        }
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    [ipc],
  );

  // 重命名文件或目录
  const renameItem = useCallback(
    async (path, newPath) => {
      try {
        const result = await ipc.renameWorkspaceItem(path, newPath);
        if (!result?.success) {
          return { success: false, error: result?.error || '重命名失败' };
        }
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    [ipc],
  );

  const handleFileModeToggle = useCallback(() => {
    setFileMode((prev) => (prev === 'edit' ? 'preview' : 'edit'));
  }, []);

  return {
    // State
    openFile,
    fileDraft,
    fileMode,
    fileStatus,
    fileError,
    // Setters
    setOpenFile,
    setFileDraft,
    setFileMode,
    setFileStatus,
    setFileError,
    // File operations
    readWorkspaceFile,
    writeWorkspaceFile,
    closeFile,
    createFile,
    createDirectory,
    deleteItem,
    renameItem,
    // Utilities
    handleFileModeToggle,
    // Callback setter
    setAfterSaveCallback,
  };
}

/**
 * 检查是否有未保存的文件草稿
 */
export function hasUnsavedFileDraft(openFile, fileDraft) {
  if (!openFile?.content) return false;
  return openFile.content !== fileDraft;
}
