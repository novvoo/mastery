/**
 * 消息日志组件（增强版）
 * 显示 Agent 执行过程中的消息和结果
 * 
 * 新增功能：
 * - 消息折叠/展开
 * - 复制消息内容
 * - 时间线视图
 * - 消息详情查看
 * - 消息搜索过滤
 * - 消息分组
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';

// 样式定义
const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#11161e',
    borderRadius: '8px',
    border: '1px solid var(--border-subtle)',
    boxShadow: 'var(--shadow-sm)'
  },
  
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: '48px',
    padding: '0 14px',
    borderBottom: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-color)'
  },
  
  title: {
    fontSize: '13px',
    fontWeight: '700',
    color: 'var(--text-color)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  headerButtons: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  
  searchContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginRight: '8px'
  },
  
  searchInput: {
    width: '150px',
    height: '28px',
    padding: '0 9px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    backgroundColor: '#0f141c',
    color: 'var(--text-color)',
    fontSize: '12px',
    transition: 'width 0.2s ease'
  },
  
  searchInputExpanded: {
    width: '200px'
  },
  
  button: {
    height: '28px',
    padding: '0 9px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  
  buttonActive: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: '1px solid rgba(76, 201, 240, 0.28)'
  },
  
  viewToggle: {
    display: 'flex',
    gap: '2px',
    padding: '2px',
    borderRadius: '7px',
    backgroundColor: '#0f141c',
    border: '1px solid var(--border-subtle)'
  },
  
  viewButton: {
    padding: '4px 8px',
    borderRadius: '5px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s'
  },
  
  viewButtonActive: {
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-color)'
  },
  
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px',
    scrollBehavior: 'smooth'
  },
  
  // 时间线视图样式
  timelineView: {
    position: 'relative',
    paddingLeft: '24px'
  },
  
  timelineLine: {
    position: 'absolute',
    left: '8px',
    top: '0',
    bottom: '0',
    width: '2px',
    backgroundColor: 'var(--border-subtle)'
  },
  
  timelineDot: {
    position: 'absolute',
    left: '4px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--primary-color)',
    border: '2px solid var(--surface-color)',
    transition: 'all 0.2s'
  },
  
  // 消息项样式
  messageItem: {
    marginBottom: '10px',
    borderRadius: '8px',
    padding: '12px',
    backgroundColor: 'var(--surface-color)',
    border: '1px solid var(--border-subtle)',
    transition: 'all 0.2s ease',
    position: 'relative',
    cursor: 'pointer'
  },
  
  messageItemHover: {
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--surface-raised)'
  },
  
  messageItemCollapsed: {
    padding: '8px 12px'
  },
  
  messageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    cursor: 'pointer'
  },
  
  messageType: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '500',
    gap: '4px'
  },
  
  typeInfo: {
    backgroundColor: 'rgba(125, 211, 252, 0.12)',
    color: 'var(--info-color)',
    border: '1px solid var(--info-color)'
  },
  
  typeSuccess: {
    backgroundColor: 'rgba(93, 211, 158, 0.12)',
    color: 'var(--success-color)',
    border: '1px solid var(--success-color)'
  },
  
  typeError: {
    backgroundColor: 'rgba(255, 107, 122, 0.12)',
    color: 'var(--error-color)',
    border: '1px solid var(--error-color)'
  },
  
  typeWarning: {
    backgroundColor: 'rgba(246, 200, 95, 0.12)',
    color: 'var(--warning-color)',
    border: '1px solid var(--warning-color)'
  },
  
  typeDebug: {
    backgroundColor: 'rgba(108, 117, 125, 0.2)',
    color: '#6c757d',
    border: '1px solid #6c757d'
  },
  
  typeTool: {
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: '1px solid var(--primary-color)'
  },
  
  typeEvent: {
    backgroundColor: 'rgba(255, 193, 7, 0.14)',
    color: 'var(--warning-color)',
    border: '1px solid rgba(255, 193, 7, 0.5)'
  },
  
  typeResult: {
    backgroundColor: 'rgba(0, 123, 255, 0.2)',
    color: '#007bff',
    border: '1px solid #007bff'
  },
  
  typeUser: {
    backgroundColor: 'rgba(111, 66, 193, 0.2)',
    color: '#6f42c1',
    border: '1px solid #6f42c1'
  },

  typeAgent: {
    backgroundColor: 'rgba(76, 201, 240, 0.12)',
    color: 'var(--primary-color)',
    border: '1px solid rgba(76, 201, 240, 0.5)'
  },
  
  messageTime: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  
  messageContent: {
    fontSize: '13px',
    color: 'var(--text-color)',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '300px',
    overflowY: 'auto',
    transition: 'max-height 0.3s ease'
  },
  
  messageContentCollapsed: {
    maxHeight: '40px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  
  messageMeta: {
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  
  messageActions: {
    display: 'flex',
    gap: '4px',
    marginTop: '8px',
    opacity: '0',
    transition: 'opacity 0.2s'
  },
  
  messageActionsVisible: {
    opacity: '1'
  },
  
  actionButton: {
    padding: '3px 7px',
    borderRadius: '5px',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-hover)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s'
  },

  emptyChip: {
    padding: '5px 12px',
    backgroundColor: '#151a23',
    border: '1px solid var(--border-subtle)',
    borderRadius: '999px',
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  
  // 详情面板
  detailPanel: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: '#0f141c',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    fontSize: '12px',
    maxHeight: '200px',
    overflowY: 'auto'
  },
  
  detailTitle: {
    color: 'var(--text-color)',
    fontWeight: '600',
    marginBottom: '8px'
  },
  
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    color: 'var(--text-muted)'
  },
  
  detailValue: {
    color: 'var(--text-color)',
    textAlign: 'right',
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  
  // 空状态
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '32px',
    background: 'radial-gradient(circle at center, rgba(76, 201, 240, 0.06), transparent 42%)'
  },
  
  emptyIcon: {
    fontSize: '13px',
    marginBottom: '14px',
    opacity: '1',
    width: '42px',
    height: '42px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--primary-soft)',
    color: 'var(--primary-color)',
    border: '1px solid rgba(76, 201, 240, 0.22)'
  },
  
  emptyText: {
    fontSize: '16px',
    marginBottom: '8px',
    color: 'var(--text-color)'
  },
  
  emptyHint: {
    fontSize: '13px',
    color: 'var(--text-dark)',
    maxWidth: '300px'
  },
  
  // 运行指示器
  runningIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#151a23',
    borderRadius: '8px',
    marginBottom: '12px',
    border: '1px solid rgba(246, 200, 95, 0.36)',
    animation: 'pulse 2s ease-in-out infinite'
  },
  
  spinner: {
    width: '20px',
    height: '20px',
    border: '3px solid var(--border-color)',
    borderTopColor: 'var(--warning-color)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  
  runningText: {
    fontSize: '14px',
    color: 'var(--warning-color)',
    fontWeight: '500'
  },
  
  progressBar: {
    width: '100%',
    height: '4px',
    backgroundColor: 'var(--border-color)',
    borderRadius: '2px',
    marginTop: '8px',
    overflow: 'hidden'
  },
  
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--warning-color)',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
    animation: 'progressPulse 1.5s ease-in-out infinite'
  },
  
  // 分组样式
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: 'var(--border-color)',
    borderRadius: '4px',
    marginBottom: '8px',
    marginTop: '16px',
    cursor: 'pointer'
  },
  
  groupIcon: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  
  groupTitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: '500'
  },
  
  groupCount: {
    fontSize: '11px',
    color: 'var(--text-dark)'
  },
  
  // 复制成功提示
  copyToast: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '8px 16px',
    backgroundColor: 'var(--success-color)',
    color: '#ffffff',
    borderRadius: '4px',
    fontSize: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
    animation: 'fadeIn 0.2s ease-out',
    zIndex: 1000
  }
};

/**
 * 消息日志组件
 * @param {Object} props - 组件属性
 * @param {Array} props.messages - 消息列表
 * @param {string} props.status - 当前状态
 * @param {Function} props.onClear - 清空消息回调
 */
function MessageLog({ messages, status, onClear }) {
  // 状态
  const [filter, setFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'timeline'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState(new Set());
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showDetails, setShowDetails] = useState(new Set());
  const [copiedMessage, setCopiedMessage] = useState(null);
  const [progress, setProgress] = useState(0);
  
  // 引用
  const listRef = useRef(null);
  const searchRef = useRef(null);
  
  // 模拟进度更新（运行时）
  useEffect(() => {
    if (status === 'running') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 10;
        });
      }, 1000);
      
      return () => clearInterval(interval);
    } else {
      setProgress(0);
    }
  }, [status]);
  
  // 自动滚动到底部
  useEffect(() => {
    if (!listRef.current) return;

    const lastMessage = messages[messages.length - 1];
    const shouldScroll = autoScroll || lastMessage?.type === 'event';

    if (shouldScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);
  
  // 搜索焦点
  useEffect(() => {
    if (searchExpanded && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchExpanded]);
  
  // 过滤和搜索消息
  const filteredMessages = useMemo(() => {
    let result = messages;
    
    // 类型过滤
    if (filter !== 'all') {
      result = result.filter(msg => msg.type === filter);
    }
    
    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(msg => 
        (msg.content || msg.message || '').toLowerCase().includes(query) ||
        (msg.toolName || '').toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [messages, filter, searchQuery]);
  
  // 按时间分组消息（时间线视图）
  const groupedMessages = useMemo(() => {
    if (viewMode !== 'timeline') return null;
    
    const groups = {};
    filteredMessages.forEach(msg => {
      const timestamp = msg.timestamp || Date.now();
      const minute = Math.floor(timestamp / 60000);
      const groupKey = new Date(minute * 60000).toLocaleTimeString();
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(msg);
    });
    
    return groups;
  }, [filteredMessages, viewMode]);
  
  // 处理过滤变更
  const handleFilterChange = useCallback((newFilter) => {
    setFilter(newFilter);
  }, []);
  
  // 处理搜索
  const handleSearch = useCallback((e) => {
    setSearchQuery(e.target.value);
  }, []);
  
  // 处理搜索展开/收起
  const handleSearchToggle = useCallback(() => {
    setSearchExpanded(!searchExpanded);
    if (searchExpanded) {
      setSearchQuery('');
    }
  }, [searchExpanded]);
  
  // 处理自动滚动变更
  const handleAutoScrollChange = useCallback(() => {
    setAutoScroll(!autoScroll);
  }, [autoScroll]);
  
  // 处理视图切换
  const handleViewChange = useCallback((mode) => {
    setViewMode(mode);
  }, []);
  
  // 处理清空
  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
    }
    setCollapsedMessages(new Set());
    setShowDetails(new Set());
    setSelectedMessage(null);
  }, [onClear]);
  
  // 处理消息折叠/展开
  const handleToggleCollapse = useCallback((msgId) => {
    setCollapsedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(msgId)) {
        newSet.delete(msgId);
      } else {
        newSet.add(msgId);
      }
      return newSet;
    });
  }, []);
  
  // 处理消息详情显示/隐藏
  const handleToggleDetails = useCallback((msgId) => {
    setShowDetails(prev => {
      const newSet = new Set(prev);
      if (newSet.has(msgId)) {
        newSet.delete(msgId);
      } else {
        newSet.add(msgId);
      }
      return newSet;
    });
  }, []);
  
  // 处理复制消息
  const handleCopyMessage = useCallback(async (msg) => {
    const content = msg.content || msg.message || '';
    
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessage(msg.id);
      
      // 3秒后清除提示
      setTimeout(() => {
        setCopiedMessage(null);
      }, 3000);
    } catch (error) {
      console.error('[MessageLog] 复制失败:', error);
    }
  }, []);
  
  // 处理消息悬停
  const handleMouseEnter = useCallback((msgId) => {
    setSelectedMessage(msgId);
  }, []);
  
  const handleMouseLeave = useCallback(() => {
    setSelectedMessage(null);
  }, []);
  
  // 获取消息类型样式
  const getTypeStyle = (type) => {
    switch (type) {
      case 'info':
        return { ...styles.messageType, ...styles.typeInfo };
      case 'success':
        return { ...styles.messageType, ...styles.typeSuccess };
      case 'error':
        return { ...styles.messageType, ...styles.typeError };
      case 'warning':
        return { ...styles.messageType, ...styles.typeWarning };
      case 'debug':
        return { ...styles.messageType, ...styles.typeDebug };
      case 'tool':
        return { ...styles.messageType, ...styles.typeTool };
      case 'tool_result':
        return { ...styles.messageType, ...styles.typeResult };
      case 'event':
        return { ...styles.messageType, ...styles.typeEvent };
      case 'result':
        return { ...styles.messageType, ...styles.typeResult };
      case 'user':
        return { ...styles.messageType, ...styles.typeUser };
      case 'agent':
        return { ...styles.messageType, ...styles.typeAgent };
      default:
        return styles.messageType;
    }
  };
  
  // 获取消息类型图标和文本
  const getTypeDisplay = (type) => {
    switch (type) {
      case 'info':
        return { icon: 'ℹ️', text: '信息' };
      case 'success':
        return { icon: '✅', text: '成功' };
      case 'error':
        return { icon: '❌', text: '错误' };
      case 'warning':
        return { icon: '⚠️', text: '警告' };
      case 'debug':
        return { icon: '🔍', text: '调试' };
      case 'tool':
        return { icon: '🔧', text: '工具' };
      case 'tool_result':
        return { icon: '📦', text: '工具结果' };
      case 'event':
        return { icon: '✨', text: '事件' };
      case 'result':
        return { icon: '📊', text: '结果' };
      case 'user':
        return { icon: '👤', text: '用户' };
      case 'agent':
        return { icon: 'AI', text: 'Agent' };
      default:
        return { icon: '📄', text: '消息' };
    }
  };
  
  // 渲染消息项
  const renderMessage = (msg, index, isTimeline = false) => {
    const msgId = msg.id || `msg_${index}`;
    const isCollapsed = collapsedMessages.has(msgId);
    const showDetail = showDetails.has(msgId);
    const isSelected = selectedMessage === msgId;
    const typeDisplay = getTypeDisplay(msg.type);
    
    return (
      <div 
        key={msgId}
        style={{
          ...styles.messageItem,
          ...(isCollapsed ? styles.messageItemCollapsed : {}),
          ...(isSelected ? styles.messageItemHover : {}),
          ...(isTimeline ? { marginLeft: '16px' } : {})
        }}
        onMouseEnter={() => handleMouseEnter(msgId)}
        onMouseLeave={handleMouseLeave}
      >
        {/* 时间线指示器 */}
        {isTimeline && (
          <div style={{
            ...styles.timelineDot,
            top: '12px',
            backgroundColor: getTypeStyle(msg.type).border?.split(' ')[1] || 'var(--primary-color)'
          }} />
        )}
        
        {/* 消息头部 */}
        <div 
          style={styles.messageHeader}
          onClick={() => handleToggleCollapse(msgId)}
        >
          <span style={getTypeStyle(msg.type)}>
            <span>{typeDisplay.icon}</span>
            <span>{typeDisplay.text}</span>
          </span>
          
          <div style={styles.messageTime}>
            <span>
              {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
            </span>
            <span style={{ fontSize: '10px', cursor: 'pointer' }}>
              {isCollapsed ? '▶ 展开' : '▼ 折叠'}
            </span>
          </div>
        </div>
        
        {/* 消息内容 */}
        <div style={{
          ...styles.messageContent,
          ...(isCollapsed ? styles.messageContentCollapsed : {})
        }}>
          {msg.content || msg.message || ''}
        </div>
        
        {/* 元数据 */}
        {!isCollapsed && msg.toolName && (
          <div style={styles.messageMeta}>
            <span>🔧 工具: {msg.toolName}</span>
            {msg.args && <span>📝 参数: {JSON.stringify(msg.args).slice(0, 50)}...</span>}
            {msg.duration && <span>⏱️ 耗时: {msg.duration}ms</span>}
          </div>
        )}

        {/* 对于事件类型，在消息流中显示简要负载，方便直接查看 */}
        {!isCollapsed && msg.type === 'event' && msg.payloadSummary && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <div style={{ marginBottom: '6px', color: 'var(--text-muted)' }}>事件负载预览</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{msg.payloadSummary}</pre>
          </div>
        )}
        
        {/* 操作按钮 */}
        <div style={{
          ...styles.messageActions,
          ...(isSelected ? styles.messageActionsVisible : {})
        }}>
          <button
            style={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              handleCopyMessage(msg);
            }}
            title="复制内容"
          >
            📋 复制
          </button>
          
          <button
            style={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleDetails(msgId);
            }}
            title="查看详情"
          >
            {showDetail ? '📖 隐藏详情' : '📖 详情'}
          </button>
          
          <button
            style={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleCollapse(msgId);
            }}
            title="折叠/展开"
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
        </div>
        
        {/* 详情面板 */}
        {showDetail && !isCollapsed && (
          <div style={styles.detailPanel}>
            <div style={styles.detailTitle}>消息详情</div>
            <div style={styles.detailRow}>
              <span>消息ID:</span>
              <span style={styles.detailValue}>{msgId}</span>
            </div>
            <div style={styles.detailRow}>
              <span>类型:</span>
              <span style={styles.detailValue}>{msg.type}</span>
            </div>
            <div style={styles.detailRow}>
              <span>时间:</span>
              <span style={styles.detailValue}>
                {msg.timestamp ? new Date(msg.timestamp).toISOString() : 'N/A'}
              </span>
            </div>
            {msg.toolName && (
              <div style={styles.detailRow}>
                <span>工具名称:</span>
                <span style={styles.detailValue}>{msg.toolName}</span>
              </div>
            )}
            {msg.duration && (
              <div style={styles.detailRow}>
                <span>执行耗时:</span>
                <span style={styles.detailValue}>{msg.duration}ms</span>
              </div>
            )}
            {msg.payload && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>负载 (payload)</div>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload, null, 2)}</pre>
              </div>
            )}
            {msg.raw && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>原始数据</div>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{typeof msg.raw === 'string' ? msg.raw : JSON.stringify(msg.raw, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  
  // 渲染运行指示器
  const renderRunningIndicator = () => {
    if (status !== 'running') return null;
    
    return (
      <div style={styles.runningIndicator}>
        <div style={styles.spinner}></div>
        <div style={styles.runningText}>
          Agent 正在执行...
        </div>
        <div style={styles.progressBar}>
          <div style={{
            ...styles.progressFill,
            width: `${progress}%`
          }} />
        </div>
      </div>
    );
  };
  
  // 渲染分组标题
  const renderGroupHeader = (title, count) => (
    <div style={styles.groupHeader}>
      <span style={styles.groupIcon}>📁</span>
      <span style={styles.groupTitle}>{title}</span>
      <span style={styles.groupCount}>{count} 条消息</span>
    </div>
  );
  
  // 渲染空状态
  if (messages.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyContainer}>
          <div style={styles.emptyIcon}>AI</div>
          <div style={styles.emptyText}>开始与 AI Agent 对话</div>
          <div style={styles.emptyHint}>
            在中间输入框输入您的任务描述，点击发送或按 Ctrl+Enter 开始。
            Agent 将自动分析任务并调用相应工具完成。
          </div>
          
          {/* 快捷提示 */}
          <div style={{
            marginTop: '24px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            <span style={styles.emptyChip}>输入任务描述</span>
            <span style={styles.emptyChip}>点击执行</span>
            <span style={styles.emptyChip}>查看结果</span>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.title}>
          <span>消息日志</span>
          <span style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginLeft: '4px'
          }}>
            ({filteredMessages.length}/{messages.length})
          </span>
        </div>
        
        <div style={styles.headerButtons}>
          {/* 搜索 */}
          <div style={styles.searchContainer}>
            {searchExpanded && (
              <input
                ref={searchRef}
                style={{
                  ...styles.searchInput,
                  ...styles.searchInputExpanded
                }}
                value={searchQuery}
                onChange={handleSearch}
                placeholder="搜索消息..."
                onBlur={() => {
                  if (!searchQuery) setSearchExpanded(false);
                }}
              />
            )}
            <button
              style={styles.button}
              onClick={handleSearchToggle}
              title="搜索消息"
            >
              🔍
            </button>
          </div>
          
          {/* 视图切换 */}
          <div style={styles.viewToggle}>
            <button
              style={{
                ...styles.viewButton,
                ...(viewMode === 'list' ? styles.viewButtonActive : {})
              }}
              onClick={() => handleViewChange('list')}
              title="列表视图"
            >
              📋
            </button>
            <button
              style={{
                ...styles.viewButton,
                ...(viewMode === 'timeline' ? styles.viewButtonActive : {})
              }}
              onClick={() => handleViewChange('timeline')}
              title="时间线视图"
            >
              📅
            </button>
          </div>
          
          {/* 过滤按钮 */}
          <select
            style={{
              ...styles.button,
              padding: '4px 8px',
              cursor: 'pointer'
            }}
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="user">👤 用户</option>
            <option value="info">ℹ️ 信息</option>
            <option value="success">✅ 成功</option>
            <option value="error">❌ 错误</option>
            <option value="tool">🔧 工具</option>
            <option value="result">📊 结果</option>
          </select>
          
          {/* 自动滚动按钮 */}
          <button
            style={{
              ...styles.button,
              ...(autoScroll ? styles.buttonActive : {})
            }}
            onClick={handleAutoScrollChange}
            title={autoScroll ? '停止自动滚动' : '启用自动滚动'}
          >
            {autoScroll ? '📍 自动' : '📌 手动'}
          </button>
          
          {/* 清空按钮 */}
          <button
            style={styles.button}
            onClick={handleClear}
            title="清空消息"
          >
            🗑️ 清空
          </button>
        </div>
      </div>
      
      {/* 消息列表 */}
      <div ref={listRef} style={styles.messageList}>
        {/* 运行指示器 */}
        {renderRunningIndicator()}
        
        {/* 时间线视图 */}
        {viewMode === 'timeline' && groupedMessages && (
          <div style={styles.timelineView}>
            <div style={styles.timelineLine} />
            {Object.entries(groupedMessages).map(([groupTitle, msgs]) => (
              <React.Fragment key={groupTitle}>
                {renderGroupHeader(groupTitle, msgs.length)}
                {msgs.map((msg, index) => renderMessage(msg, index, true))}
              </React.Fragment>
            ))}
          </div>
        )}
        
        {/* 列表视图 */}
        {viewMode === 'list' && (
          filteredMessages.map((msg, index) => renderMessage(msg, index))
        )}
        
        {/* 无匹配消息 */}
        {filteredMessages.length === 0 && messages.length > 0 && (
          <div style={styles.emptyContainer}>
            <div style={styles.emptyIcon}>🔍</div>
            <div style={styles.emptyText}>没有找到匹配的消息</div>
            <div style={styles.emptyHint}>
              尝试更改过滤条件或搜索关键词
            </div>
          </div>
        )}
      </div>
      
      {/* 复制成功提示 */}
      {copiedMessage && (
        <div style={styles.copyToast}>
          ✅ 已复制到剪贴板
        </div>
      )}
      
      {/* CSS 动画 */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
          }
          
          @keyframes progressPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
          
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}

export default MessageLog;
