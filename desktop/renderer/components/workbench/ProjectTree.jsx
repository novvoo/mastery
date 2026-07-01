/**
 * 增强版项目目录树组件
 * 提供现代化的文件/目录展示界面，支持右键菜单操作
 */

import React, { useState, useCallback, useMemo } from 'react';
import { ContextMenu } from '../ui/ContextMenu.jsx';
import { InputDialog } from '../ui/InputDialog.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';

// 图标 SVG
const Icons = {
  file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  ),
  folder: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  newFile: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  newFolder: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  ),
  rename: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  delete: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
};

const FILE_TYPE_ICONS = {
  js: { icon: '📄', color: '#f7df1e' },
  jsx: { icon: '⚛️', color: '#61dafb' },
  ts: { icon: '📘', color: '#3178c6' },
  tsx: { icon: '⚛️', color: '#3178c6' },
  json: { icon: '📋', color: '#8b5cf6' },
  css: { icon: '🎨', color: '#264de4' },
  scss: { icon: '🎨', color: '#c6538c' },
  less: { icon: '🎨', color: '#1d365d' },
  md: { icon: '📝', color: '#0ea5e9' },
  html: { icon: '🌐', color: '#e34c26' },
  py: { icon: '🐍', color: '#3776ab' },
  go: { icon: '🐹', color: '#00add8' },
  rs: { icon: '🦀', color: '#dea584' },
  java: { icon: '☕', color: '#ed8b00' },
  vue: { icon: '💚', color: '#42b883' },
  svelte: { icon: '🔶', color: '#ff3e00' },
  yaml: { icon: '📋', color: '#cb171e' },
  yml: { icon: '📋', color: '#cb171e' },
  toml: { icon: '📋', color: '#9270ca' },
  sh: { icon: '🐚', color: '#89e051' },
  mjs: { icon: '📄', color: '#f7df1e' },
  cjs: { icon: '📄', color: '#f7df1e' },
};

const FOLDER_ICON = '📁';
const FOLDER_OPEN_ICON = '📂';
const DEFAULT_FILE_ICON = '📄';

const INDENT_SIZE = 24;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    flexShrink: 0,
  },
  title: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '12px',
    fontWeight: '700',
    color: 'var(--text-muted)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  actionButton: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  searchContainer: {
    padding: '6px 10px',
    borderBottom: '1px solid var(--border-subtle)',
    flexShrink: 0,
  },
  searchInput: {
    width: '100%',
    padding: '6px 10px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'var(--background-color)',
    color: 'var(--text-color)',
    fontSize: '12px',
    outline: 'none',
    transition: 'all 0.15s',
  },
  searchInputFocused: {
    backgroundColor: 'var(--surface-color)',
    boxShadow: '0 0 0 2px var(--primary-soft)',
  },
  tree: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '4px 0',
  },
  treeRow: {
    width: '100%',
    minHeight: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    textAlign: 'left',
    padding: '3px 6px',
    transition: 'all 0.15s ease',
    border: 'none',
    outline: 'none',
  },
  treeRowHover: {
    backgroundColor: 'var(--primary-faint)',
  },
  treeRowActive: {
    backgroundColor: 'var(--primary-faint)',
    color: 'var(--primary-color)',
  },
  treeRowLoading: {
    opacity: 0.5,
  },
  toggleButton: {
    width: '16px',
    height: '16px',
    flexShrink: 0,
    borderRadius: '3px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-dark)',
    cursor: 'pointer',
    fontSize: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  toggleButtonHover: {
    backgroundColor: 'var(--border-subtle)',
    color: 'var(--text-muted)',
  },
  icon: {
    width: '20px',
    flexShrink: 0,
    fontSize: '14px',
    textAlign: 'center',
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-color)',
    flex: 1,
  },
  meta: {
    marginLeft: 'auto',
    flexShrink: 0,
    color: 'var(--text-dark)',
    fontSize: '10px',
    fontWeight: 500,
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: 'var(--background-color)',
  },
  empty: {
    padding: '16px 10px',
    color: 'var(--text-dark)',
    fontSize: '12px',
    textAlign: 'center',
  },
  error: {
    padding: '12px 10px',
    color: 'var(--danger-color)',
    fontSize: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderRadius: '6px',
    margin: '4px 6px',
  },
  loadingIndicator: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    border: '2px solid var(--text-dark)',
    borderTopColor: 'var(--primary-color)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

function TreeNode({
  entry,
  depth = 0,
  isExpanded = false,
  isLoading = false,
  isActiveFile = false,
  hasChildren = false,
  onToggle,
  onOpen,
  onContextMenu,
  filteredCount = 0,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isDirectory = entry.type === 'directory';

  const ext =
    !isDirectory && entry.name?.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';

  const fileIcon = isDirectory
    ? isExpanded
      ? FOLDER_OPEN_ICON
      : FOLDER_ICON
    : FILE_TYPE_ICONS[ext]?.icon || DEFAULT_FILE_ICON;

  const fileColor = !isDirectory && FILE_TYPE_ICONS[ext]?.color;

  const handleClick = useCallback(() => {
    if (isDirectory) {
      onToggle?.(entry.path);
    } else {
      onOpen?.(entry);
    }
  }, [entry, isDirectory, onToggle, onOpen]);

  return (
    <button
      type="button"
      style={{
        ...styles.treeRow,
        ...(isHovered ? styles.treeRowHover : {}),
        ...(isActiveFile ? styles.treeRowActive : {}),
        ...(isLoading ? styles.treeRowLoading : {}),
        paddingLeft: depth > 0 ? `${depth * INDENT_SIZE}px` : '6px',
      }}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu?.(e, entry)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={entry.path}
    >
      {isDirectory && hasChildren && (
        <button
          type="button"
          style={{
            ...styles.toggleButton,
            ...(isHovered ? styles.toggleButtonHover : {}),
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(entry.path);
          }}
          aria-label={isExpanded ? '折叠目录' : '展开目录'}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transition: 'transform 0.2s',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      )}
      {isDirectory && !hasChildren && <span style={{ width: '16px', flexShrink: 0 }} />}
      {!isDirectory && <span style={{ width: '16px', flexShrink: 0 }} />}

      <span style={{ ...styles.icon, color: fileColor }}>{fileIcon}</span>

      <span style={styles.name}>{entry.name}</span>

      {isDirectory && filteredCount > 0 && <span style={styles.meta}>{filteredCount}</span>}

      {isLoading && <span style={styles.loadingIndicator} />}
    </button>
  );
}

export function ProjectTree({ projectTree, workingDirectory, onOpenFile, activeOpenFile }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }

  // 对话框状态
  const [dialog, setDialog] = useState(null);
  // dialog: { type: 'createFile' | 'createDir' | 'rename', parentPath?, entry? }

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState(null);
  // confirmDialog: { title, message, onConfirm }

  const {
    directoryChildren = {},
    expandedDirectories = new Set(),
    loadingDirectories = new Set(),
    status = 'idle',
    error = '',
    onToggleDirectory,
    onRefresh,
    onCreateFile,
    onCreateDirectory,
    onDeleteItem,
    onRenameItem,
  } = projectTree || {};

  // 计算相对路径
  const getRelativePath = useCallback((fullPath) => {
    if (!workingDirectory) {return fullPath;}
    return fullPath.replace(workingDirectory + '/', '').replace(workingDirectory + '\\', '');
  }, [workingDirectory]);

  // 获取父目录路径
  const getParentPath = useCallback((fullPath) => {
    const parts = fullPath.split(/[\\/]/);
    parts.pop();
    return parts.join('/');
  }, []);

  // 右键菜单
  const handleContextMenu = useCallback((e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // 创建文件
  const handleCreateFile = useCallback((parentPath = '') => {
    setContextMenu(null);
    setDialog({ type: 'createFile', parentPath });
  }, []);

  // 创建目录
  const handleCreateDirectory = useCallback((parentPath = '') => {
    setContextMenu(null);
    setDialog({ type: 'createDir', parentPath });
  }, []);

  // 重命名
  const handleRename = useCallback((entry) => {
    setContextMenu(null);
    setDialog({ type: 'rename', entry });
  }, []);

  // 删除
  const handleDelete = useCallback((entry) => {
    setContextMenu(null);
    setConfirmDialog({
      title: '确认删除',
      message: `确定要删除 ${entry.type === 'directory' ? '目录' : '文件'} "${entry.name}" 吗？此操作不可撤销。`,
      danger: true,
      onConfirm: async () => {
        const result = await onDeleteItem?.(entry.path);
        if (result?.success) {
          onRefresh?.();
        }
      },
    });
  }, [onDeleteItem, onRefresh]);

  // 确认创建/重命名
  const handleDialogConfirm = useCallback(async (value) => {
    const { type, parentPath, entry } = dialog;

    if (type === 'createFile') {
      const targetPath = parentPath ? `${parentPath}/${value}` : value;
      const result = await onCreateFile?.(targetPath);
      if (result?.success) {
        onRefresh?.();
        // 打开新创建的文件
        const newEntry = { path: result.path, name: value, type: 'file' };
        onOpenFile?.(newEntry);
      }
    } else if (type === 'createDir') {
      const targetPath = parentPath ? `${parentPath}/${value}` : value;
      const result = await onCreateDirectory?.(targetPath);
      if (result?.success) {
        onRefresh?.();
      }
    } else if (type === 'rename') {
      const parent = getParentPath(entry.path);
      const newPath = parent ? `${parent}/${value}` : value;
      const result = await onRenameItem?.(entry.path, newPath);
      if (result?.success) {
        onRefresh?.();
      }
    }

    setDialog(null);
  }, [dialog, onCreateFile, onCreateDirectory, onRenameItem, onRefresh, onOpenFile, getParentPath]);

  // 构建右键菜单项
  const contextMenuItems = useMemo(() => {
    if (!contextMenu?.entry) {return [];}

    const { entry } = contextMenu;
    const isDirectory = entry.type === 'directory';
    const baseItems = [
      {
        id: 'rename',
        label: '重命名',
        icon: Icons.rename,
        onClick: () => handleRename(entry),
      },
      {
        id: 'delete',
        label: '删除',
        icon: Icons.delete,
        danger: true,
        onClick: () => handleDelete(entry),
      },
    ];

    if (isDirectory) {
      return [
        {
          id: 'newFile',
          label: '新建文件',
          icon: Icons.newFile,
          onClick: () => handleCreateFile(entry.path),
        },
        {
          id: 'newFolder',
          label: '新建子目录',
          icon: Icons.newFolder,
          onClick: () => handleCreateDirectory(entry.path),
        },
        { type: 'divider' },
        ...baseItems,
      ];
    }

    return baseItems;
  }, [contextMenu, handleRename, handleDelete, handleCreateFile, handleCreateDirectory]);

  // 空白区域右键菜单
  const blankContextMenuItems = useMemo(() => [
    {
      id: 'newFile',
      label: '新建文件',
      icon: Icons.newFile,
      onClick: () => handleCreateFile(''),
    },
    {
      id: 'newFolder',
      label: '新建目录',
      icon: Icons.newFolder,
      onClick: () => handleCreateDirectory(''),
    },
  ], [handleCreateFile, handleCreateDirectory]);

  const rootName = useMemo(() => {
    if (!workingDirectory) {return '未设置';}
    const parts = workingDirectory.split(/[\\/]/).filter(Boolean);
    return parts.pop() || workingDirectory;
  }, [workingDirectory]);

  const filterEntries = useCallback((entries, query) => {
    if (!query) {return entries;}
    const lowerQuery = query.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase().includes(lowerQuery));
  }, []);

  const countFilteredChildren = useCallback(
    (path, query) => {
      if (!query) {return 0;}
      const entries = directoryChildren[path] || [];
      let count = 0;
      for (const entry of entries) {
        if (entry.type === 'directory') {
          count += countFilteredChildren(entry.path, query);
        } else if (entry.name.toLowerCase().includes(query.toLowerCase())) {
          count += 1;
        }
      }
      return count;
    },
    [directoryChildren],
  );

  const renderTree = useCallback(
    (parentPath = '', depth = 0) => {
      const entries = directoryChildren[parentPath] || [];
      const isLoading = loadingDirectories.has(parentPath);
      const filteredEntries = searchQuery ? filterEntries(entries, searchQuery) : entries;

      if (isLoading && entries.length === 0) {
        return (
          <div style={{ paddingLeft: `${depth * INDENT_SIZE + 6}px` }}>
            <div style={{ ...styles.treeRow, ...styles.treeRowLoading }}>
              <span style={{ width: '16px', flexShrink: 0 }} />
              <span style={styles.icon}>{FOLDER_ICON}</span>
              <span style={{ ...styles.name, color: 'var(--text-dark)' }}>读取中...</span>
              <span style={styles.loadingIndicator} />
            </div>
          </div>
        );
      }

      const shouldFilter = searchQuery && filteredEntries.length !== entries.length;

      if (!shouldFilter && filteredEntries.length === 0) {
        return null;
      }

      const displayEntries = shouldFilter
        ? entries.filter((entry) => {
            if (entry.name.toLowerCase().includes(searchQuery.toLowerCase())) {
              return true;
            }
            if (entry.type === 'directory') {
              return countFilteredChildren(entry.path, searchQuery) > 0;
            }
            return false;
          })
        : filteredEntries;

      if (displayEntries.length === 0) {
        return null;
      }

      return (
        <React.Fragment>
          {displayEntries.map((entry) => {
            const isDirectory = entry.type === 'directory';
            const hasChildren =
              directoryChildren[entry.path]?.length > 0 || loadingDirectories.has(entry.path);
            const isExpanded = expandedDirectories.has(entry.path) || (shouldFilter && hasChildren);
            const isLoading = loadingDirectories.has(entry.path);
            const isActiveFile = !isDirectory && activeOpenFile?.path === entry.path;
            const filteredCount =
              searchQuery && isDirectory ? countFilteredChildren(entry.path, searchQuery) : 0;

            return (
              <React.Fragment key={entry.path}>
                <TreeNode
                  entry={entry}
                  depth={depth}
                  isExpanded={isExpanded}
                  isLoading={isLoading}
                  isActiveFile={isActiveFile}
                  hasChildren={hasChildren}
                  onToggle={onToggleDirectory}
                  onOpen={onOpenFile}
                  onContextMenu={handleContextMenu}
                  filteredCount={filteredCount}
                />
                {isDirectory && isExpanded && renderTree(entry.path, depth + 1)}
              </React.Fragment>
            );
          })}
        </React.Fragment>
      );
    },
    [
      directoryChildren,
      expandedDirectories,
      loadingDirectories,
      searchQuery,
      activeOpenFile,
      onToggleDirectory,
      onOpenFile,
      handleContextMenu,
      filterEntries,
      countFilteredChildren,
    ],
  );

  const hasAnyEntries = Object.keys(directoryChildren).length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title} title={workingDirectory || ''}>
          {rootName}
        </span>
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.actionButton}
            onClick={onRefresh}
            disabled={!workingDirectory || status === 'loading'}
            title="刷新文件列表"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        </div>
      </div>

      <div style={styles.searchContainer}>
        <input
          type="text"
          style={{
            ...styles.searchInput,
            ...(searchFocused ? styles.searchInputFocused : {}),
          }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="搜索文件或目录..."
        />
      </div>

      <div
        style={styles.tree}
        onContextMenu={(e) => {
          // Find if clicking on a tree item (button)
          const treeRow = e.target.closest('button');
          if (treeRow) {
            // Tree item will handle its own context menu via TreeNode
            return;
          }
          // Clicking on empty space - show blank area menu
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, entry: null });
        }}
      >
        {error ? (
          <div style={styles.error}>{error}</div>
        ) : status === 'loading' && !hasAnyEntries ? (
          <div style={styles.empty}>
            <div>📁</div>
            <div style={{ marginTop: '8px' }}>正在读取项目文件...</div>
          </div>
        ) : directoryChildren[''] && directoryChildren[''].length === 0 ? (
          <div style={styles.empty}>
            <div>📭</div>
            <div style={{ marginTop: '8px' }}>工作目录为空</div>
          </div>
        ) : searchQuery && !renderTree('', 0) ? (
          <div style={styles.empty}>
            <div>🔍</div>
            <div style={{ marginTop: '8px' }}>未找到匹配的文件</div>
          </div>
        ) : (
          renderTree('', 0)
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.entry ? contextMenuItems : blankContextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 输入对话框 */}
      {dialog && (
        <InputDialog
          title={
            dialog.type === 'createFile'
              ? '新建文件'
              : dialog.type === 'createDir'
              ? '新建目录'
              : '重命名'
          }
          label={
            dialog.type === 'createFile'
              ? '文件名'
              : dialog.type === 'createDir'
              ? '目录名'
              : '新名称'
          }
          placeholder={
            dialog.type === 'createFile'
              ? '例如: index.js'
              : dialog.type === 'createDir'
              ? '例如: src'
              : '输入新名称'
          }
          defaultValue={dialog.type === 'rename' ? dialog.entry?.name || '' : ''}
          onConfirm={handleDialogConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* 确认对话框 */}
      {confirmDialog && (
        <ConfirmDialog
          isOpen
          title={confirmDialog.title}
          message={confirmDialog.message}
          danger={confirmDialog.danger}
          onConfirm={() => {
            confirmDialog.onConfirm?.();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

export default ProjectTree;
