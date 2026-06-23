/**
 * 增强版项目目录树组件
 * 提供现代化的文件/目录展示界面
 */

import React, { useState, useCallback, useMemo } from 'react';

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

  const {
    directoryChildren = {},
    expandedDirectories = new Set(),
    loadingDirectories = new Set(),
    status = 'idle',
    error = '',
    onToggleDirectory,
    onRefresh,
  } = projectTree || {};

  const rootName = useMemo(() => {
    if (!workingDirectory) return '未设置';
    const parts = workingDirectory.split(/[\\/]/).filter(Boolean);
    return parts.pop() || workingDirectory;
  }, [workingDirectory]);

  const filterEntries = useCallback((entries, query) => {
    if (!query) return entries;
    const lowerQuery = query.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase().includes(lowerQuery));
  }, []);

  const countFilteredChildren = useCallback(
    (path, query) => {
      if (!query) return 0;
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

      <div style={styles.tree}>
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
    </div>
  );
}

export default ProjectTree;
