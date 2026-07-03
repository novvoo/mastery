import { useState, useCallback, useRef, useEffect } from 'react';
import {
  PROJECT_TREE_REFRESH_CONCURRENCY,
} from '../app/session/session-storage.js';

/**
 * 项目目录树管理 — 加载/展开/刷新
 *
 * @param {object} ipc - IPC 实例
 * @param {string} workingDirectory - 当前工作目录
 */
export function useProjectTree(ipc, workingDirectory) {
  const [directoryChildren, setDirectoryChildren] = useState({});
  const [expandedDirectories, setExpandedDirectories] = useState(() => new Set(['']));
  const [loadingDirectories, setLoadingDirectories] = useState(() => new Set());
  const [projectTreeStatus, setProjectTreeStatus] = useState('idle');
  const [projectTreeError, setProjectTreeError] = useState('');

  const directoryChildrenRef = useRef(directoryChildren);
  const workspaceRefreshTimerRef = useRef(null);

  useEffect(() => {
    directoryChildrenRef.current = directoryChildren;
  }, [directoryChildren]);

  // 工作目录变更时加载根目录
  useEffect(() => {
    if (!workingDirectory || !ipc.isConnected || !ipc.listDirectory) return;

    let cancelled = false;
    setProjectTreeStatus('loading');
    setProjectTreeError('');
    setDirectoryChildren({});
    setExpandedDirectories(new Set(['']));
    setLoadingDirectories(new Set(['']));

    ipc
      .listDirectory('')
      .then((result) => {
        if (cancelled) return;
        if (!result?.success) {
          setProjectTreeStatus('error');
          setProjectTreeError(result?.error || '无法读取工作目录');
          return;
        }
        setDirectoryChildren({ '': result.entries || [] });
        setProjectTreeStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectTreeStatus('error');
        setProjectTreeError(error.message || '无法读取工作目录');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingDirectories(new Set());
      });

    return () => { cancelled = true; };
  }, [workingDirectory, ipc.isConnected]);

  const loadProjectDirectory = useCallback(
    async (directoryPath = '') => {
      if (!ipc.listDirectory) return null;

      setLoadingDirectories((prev) => new Set(prev).add(directoryPath));
      setProjectTreeError('');

      try {
        const result = await ipc.listDirectory(directoryPath);
        if (!result?.success) {
          setProjectTreeError(result?.error || '无法读取目录');
          return null;
        }
        setDirectoryChildren((prev) => ({
          ...prev,
          [directoryPath]: result.entries || [],
        }));
        setProjectTreeStatus('ready');
        return result;
      } catch (error) {
        setProjectTreeError(error.message || '无法读取目录');
        return null;
      } finally {
        setLoadingDirectories((prev) => {
          const next = new Set(prev);
          next.delete(directoryPath);
          return next;
        });
      }
    },
    [ipc],
  );

  const handleProjectDirectoryToggle = useCallback(
    async (directoryPath) => {
      const isExpanded = expandedDirectories.has(directoryPath);
      if (isExpanded) {
        setExpandedDirectories((prev) => {
          const next = new Set(prev);
          next.delete(directoryPath);
          return next;
        });
        return;
      }
      setExpandedDirectories((prev) => new Set(prev).add(directoryPath));
      if (!directoryChildren[directoryPath]) {
        await loadProjectDirectory(directoryPath);
      }
    },
    [directoryChildren, expandedDirectories, loadProjectDirectory],
  );

  const handleProjectTreeRefresh = useCallback(async () => {
    setDirectoryChildren({});
    setExpandedDirectories(new Set(['']));
    setProjectTreeStatus('loading');
    await loadProjectDirectory('');
  }, [loadProjectDirectory]);

  const refreshLoadedProjectDirectories = useCallback(async () => {
    if (!ipc.listDirectory) return;

    const loadedPaths = Object.keys(directoryChildrenRef.current);
    const pathsToRefresh = loadedPaths.length > 0 ? loadedPaths : [''];
    setProjectTreeError('');

    try {
      const results = [];
      for (let i = 0; i < pathsToRefresh.length; i += PROJECT_TREE_REFRESH_CONCURRENCY) {
        const batch = pathsToRefresh.slice(i, i + PROJECT_TREE_REFRESH_CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (directoryPath) => {
            const result = await ipc.listDirectory(directoryPath);
            return { directoryPath, result };
          }),
        );
        results.push(...batchResults);
      }

      const nextChildren = {};
      const missingDirectories = new Set();
      let hasError = false;
      for (const { directoryPath, result } of results) {
        if (result?.success) {
          nextChildren[directoryPath] = result.entries || [];
        } else {
          missingDirectories.add(directoryPath);
          if (directoryPath === '') hasError = true;
        }
      }

      setDirectoryChildren((prev) => {
        const next = { ...prev, ...nextChildren };
        for (const missingPath of missingDirectories) {
          if (missingPath !== '') delete next[missingPath];
        }
        return next;
      });
      if (missingDirectories.size > 0) {
        setExpandedDirectories((prev) => {
          const next = new Set(prev);
          for (const missingPath of missingDirectories) {
            if (missingPath !== '') next.delete(missingPath);
          }
          return next;
        });
      }
      setProjectTreeStatus(hasError ? 'error' : 'ready');
      setProjectTreeError(hasError ? '工作目录无法刷新' : '');
    } catch (error) {
      setProjectTreeStatus('error');
      setProjectTreeError(error.message || '无法刷新项目文件');
    }
  }, [ipc.listDirectory]);

  // 工作区变更监听 (防抖刷新)
  useEffect(() => {
    if (!ipc.isConnected || !ipc.onWorkspaceChanged) return undefined;

    const unsubscribe = ipc.onWorkspaceChanged(() => {
      clearTimeout(workspaceRefreshTimerRef.current);
      workspaceRefreshTimerRef.current = setTimeout(() => {
        refreshLoadedProjectDirectories();
      }, 120);
    });

    return () => {
      clearTimeout(workspaceRefreshTimerRef.current);
      unsubscribe?.();
    };
  }, [ipc.isConnected, ipc.onWorkspaceChanged, refreshLoadedProjectDirectories]);

  /** 重置目录树状态 (工作目录切换时调用) */
  const resetProjectTree = useCallback(() => {
    setDirectoryChildren({});
    setExpandedDirectories(new Set(['']));
    setProjectTreeError('');
  }, []);

  return {
    directoryChildren,
    expandedDirectories,
    loadingDirectories,
    projectTreeStatus,
    projectTreeError,
    loadProjectDirectory,
    handleProjectDirectoryToggle,
    handleProjectTreeRefresh,
    resetProjectTree,
  };
}
