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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 样式定义
const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: 'var(--background-color)'
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
    padding: '8px 12px',
    scrollBehavior: 'smooth'
  },

  runtimeDetailsPanel: {
    marginBottom: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    backgroundColor: 'rgba(15, 20, 28, 0.74)',
    overflow: 'hidden'
  },

  runtimeDetailsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '42px',
    padding: '0 12px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontWeight: '600'
  },

  runtimeDetailsHeaderInteractive: {
    cursor: 'pointer',
    userSelect: 'none'
  },

  runtimeDetailsTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  runtimeDetailsActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },

  runtimeDetailsToggle: {
    border: '1px solid rgba(148, 163, 184, 0.18)',
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
    color: 'var(--text-muted)',
    borderRadius: '5px',
    width: '24px',
    height: '24px',
    padding: 0,
    cursor: 'pointer',
    fontSize: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  runtimeProgress: {
    padding: '8px 10px 10px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.1)'
  },

  runtimeProgressText: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--text-muted)'
  },

  runtimeProgressLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },

  runtimeDetailsList: {
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    scrollBehavior: 'smooth'
  },

  runtimeDetailsListCollapsed: {
    maxHeight: '620px',
    overflow: 'hidden'
  },

  runtimeDetailsListExpanded: {
    maxHeight: 'min(50vh, 520px)'
  },

  runtimeDetailsListLarge: {
    maxHeight: 'min(72vh, 780px)'
  },

  runtimeDetailItem: {
    borderRadius: '6px',
    border: '1px solid rgba(148, 163, 184, 0.12)',
    backgroundColor: 'rgba(17, 22, 30, 0.68)',
    padding: '4px 8px',
    color: 'var(--text-muted)',
    fontSize: '12px',
    lineHeight: '1.5'
  },

  runtimeDetailItemInteractive: {
    cursor: 'pointer'
  },

  runtimeDetailItemDebug: {
    border: '1px solid rgba(108, 117, 125, 0.22)',
    backgroundColor: 'rgba(108, 117, 125, 0.08)'
  },

  runtimeDetailItemStatus: {
    border: '1px solid rgba(125, 211, 252, 0.18)',
    backgroundColor: 'rgba(125, 211, 252, 0.06)'
  },

  runtimeDetailMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '2px',
    color: 'var(--text-dark)',
    fontSize: '11px'
  },

  runtimeDetailContent: {
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    wordBreak: 'break-word',
    color: 'var(--text-muted)',
    transition: 'max-height 0.18s ease'
  },

  runtimeDetailContentCollapsed: {
    maxHeight: '18px',
    overflow: 'hidden'
  },

  runtimeDetailContentExpanded: {
    whiteSpace: 'pre-wrap',
    maxHeight: '240px',
    overflowY: 'auto'
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
  spinner: {
    width: '14px',
    height: '14px',
    border: '2px solid var(--border-color)',
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
 * @param {Function} props.onAskAgent - 将错误消息交给 Agent 处理
 */
function MessageLog({ messages, status, onClear, onAskAgent, showHeader = true }) {
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
  const [expandedRuntimePanels, setExpandedRuntimePanels] = useState(new Set());
  const [largeRuntimePanels, setLargeRuntimePanels] = useState(new Set());
  const [expandedRuntimeDetails, setExpandedRuntimeDetails] = useState(new Set());
  
  // 引用
  const listRef = useRef(null);
  const runtimeDetailsRefs = useRef(new Map());
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

    const lastMessage = messages.filter(msg => !isRuntimeDetailMessage(msg)).at(-1);
    const shouldScroll = autoScroll || lastMessage?.type === 'event';

    if (shouldScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  function isRuntimeDetailMessage(msg) {
    if (!msg) return false;
    return (
      msg.event === 'agent:start' ||
      msg.event === 'status:update' ||
      msg.event === 'tool:call' ||
      msg.event === 'tool:result' ||
      msg.event === 'tool:error' ||
      ['agent', 'tool', 'tool_result', 'debug', 'event'].includes(msg.type)
    );
  }

  function isStatusUpdateMessage(msg) {
    return msg?.event === 'status:update';
  }

  function formatRuntimeDetailValue(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function getRuntimeDetailContent(msg) {
    const sections = [];
    const primaryText = formatRuntimeDetailValue(msg.content || msg.message || msg.details);

    if (primaryText) {
      sections.push(primaryText);
    }

    if (msg.toolName) {
      sections.push(`工具: ${msg.toolName}`);
    }

    const argsText = formatRuntimeDetailValue(msg.args);
    if (argsText) {
      sections.push(`参数:\n${argsText}`);
    }

    const resultText = formatRuntimeDetailValue(msg.result);
    if (resultText) {
      sections.push(`结果:\n${resultText}`);
    }

    const payloadText = formatRuntimeDetailValue(msg.payload || msg.raw);
    if (payloadText && !sections.includes(payloadText)) {
      sections.push(`事件数据:\n${payloadText}`);
    }

    const fallbackFields = {
      event: msg.event,
      type: msg.type,
      status: msg.status,
      level: msg.level,
      source: msg.source,
      payloadSummary: msg.payloadSummary
    };
    const fallbackText = formatRuntimeDetailValue(Object.fromEntries(
      Object.entries(fallbackFields).filter(([, value]) => value !== undefined && value !== '')
    ));

    return sections.join('\n\n') || fallbackText || '(无内容)';
  }

  function getStatusUpdateText(msg) {
    if (!msg) {
      return '准备执行';
    }
    const payload = msg.payload || msg.raw || {};
    return (
      msg.content ||
      msg.message ||
      payload.message ||
      payload.status ||
      msg.status ||
      '状态更新'
    );
  }

  // 导出运行详情
  function handleExportRuntimeDetails(group) {
    const runtimeDetails = group?.runtimeDetails || [];
    const visibleRuntimeDetails = runtimeDetails.filter(msg => !isStatusUpdateMessage(msg));
    
    if (visibleRuntimeDetails.length === 0) {
      alert('没有可导出的运行详情');
      return;
    }

    // 去重 - 按消息ID或时间戳+内容去重
    const seen = new Set();
    const uniqueMessages = visibleRuntimeDetails.filter(msg => {
      const key = msg.id || `${msg.timestamp}_${msg.type}_${msg.toolName || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 格式化导出内容（精简版）
    let content = `=== 运行详情导出 ===\n`;
    content += `导出时间: ${new Date().toLocaleString()}\n`;
    content += `原始消息: ${visibleRuntimeDetails.length} 条\n`;
    content += `去重后: ${uniqueMessages.length} 条\n`;
    content += `\n==================\n\n`;

    uniqueMessages.forEach((msg, index) => {
      const typeDisplay = getTypeDisplay(msg.type);
      content += `[${index + 1}] ${typeDisplay.text}\n`;
      content += `时间: ${msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '未知时间'}\n`;
      
      // 精简内容 - 不包含冗余的事件数据
      let msgContent = '';
      const primaryText = msg.content || msg.message || msg.details || '';
      if (primaryText) {
        msgContent += primaryText;
      }
      if (msg.toolName) {
        if (msgContent) msgContent += '\n';
        msgContent += `工具: ${msg.toolName}`;
      }
      if (msg.args) {
        if (msgContent) msgContent += '\n';
        try {
          msgContent += `参数:\n${typeof msg.args === 'string' ? msg.args : JSON.stringify(msg.args, null, 2)}`;
        } catch {
          msgContent += `参数:\n${String(msg.args)}`;
        }
      }
      if (msg.result) {
        if (msgContent) msgContent += '\n';
        try {
          msgContent += `结果:\n${typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2)}`;
        } catch {
          msgContent += `结果:\n${String(msg.result)}`;
        }
      }
      
      content += `内容:\n${msgContent || '(无内容)'}\n`;
      content += `\n------------------\n\n`;
    });

    // 创建并下载文件
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `运行详情_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
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

  const runtimeDetailMessages = useMemo(() => (
    filteredMessages.filter(isRuntimeDetailMessage)
  ), [filteredMessages]);

  const primaryMessages = useMemo(() => (
    filteredMessages.filter(msg => !isRuntimeDetailMessage(msg))
  ), [filteredMessages]);

  const conversationGroups = useMemo(() => {
    const groups = [];
    let currentGroup = null;

    const createGroup = (anchor, index) => ({
      id: `conversation_${anchor || index}`,
      messages: [],
      runtimeDetails: []
    });

    filteredMessages.forEach((msg, index) => {
      if (isRuntimeDetailMessage(msg)) {
        if (!currentGroup) {
          currentGroup = createGroup(msg.id || msg.timestamp || 'runtime', index);
          groups.push(currentGroup);
        }
        currentGroup.runtimeDetails.push(msg);
        return;
      }

      if (!currentGroup || msg.type === 'user') {
        currentGroup = createGroup(msg.id || msg.timestamp || 'message', index);
        groups.push(currentGroup);
      }
      currentGroup.messages.push(msg);
    });

    return groups;
  }, [filteredMessages]);

  useEffect(() => {
    for (const group of conversationGroups) {
      if (group.runtimeDetails.length === 0) {
        continue;
      }
      const panelRef = runtimeDetailsRefs.current.get(group.id);
      if (panelRef) {
        panelRef.scrollTop = panelRef.scrollHeight;
      }
    }
  }, [conversationGroups]);
  
  // 按时间分组消息（时间线视图）
  const groupedMessages = useMemo(() => {
    if (viewMode !== 'timeline') return null;
    
    const groups = {};
    primaryMessages.forEach(msg => {
      const timestamp = msg.timestamp || Date.now();
      const minute = Math.floor(timestamp / 60000);
      const groupKey = new Date(minute * 60000).toLocaleTimeString();
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(msg);
    });
    
    return groups;
  }, [primaryMessages, viewMode]);
  
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

  const handleRuntimeDetailsToggle = useCallback((panelId) => {
    setExpandedRuntimePanels(prev => {
      const next = new Set(prev);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
  }, []);

  const handleRuntimePanelSizeToggle = useCallback((panelId) => {
    setLargeRuntimePanels(prev => {
      const next = new Set(prev);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
    setExpandedRuntimePanels(prev => {
      const next = new Set(prev);
      next.add(panelId);
      return next;
    });
  }, []);

  const handleRuntimeDetailToggle = useCallback((detailId) => {
    setExpandedRuntimeDetails(prev => {
      const next = new Set(prev);
      if (next.has(detailId)) {
        next.delete(detailId);
      } else {
        next.add(detailId);
      }
      return next;
    });
  }, []);
  
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
    setExpandedRuntimePanels(new Set());
    setLargeRuntimePanels(new Set());
    setExpandedRuntimeDetails(new Set());
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

  const handleAskAgent = useCallback((msg) => {
    if (onAskAgent) {
      onAskAgent(msg);
    }
  }, [onAskAgent]);

  const isActionableErrorMessage = useCallback((msg) => (
    msg?.type === 'error' || msg?.level === 'error' || msg?.event === 'tool:error'
  ), []);
  
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
    const isActionableError = isActionableErrorMessage(msg);
    
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
          {(msg.type === 'agent' || msg.type === 'result' || msg.type === 'info') ? (
            <div className="markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content || msg.message || ''}
              </ReactMarkdown>
            </div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {msg.content || msg.message || ''}
            </div>
          )}
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
          ...(isSelected || isActionableError ? styles.messageActionsVisible : {})
        }}>
          {isActionableError && onAskAgent && (
            <button
              style={styles.actionButton}
              onClick={(e) => {
                e.stopPropagation();
                handleAskAgent(msg);
              }}
              title="把错误消息交给 Agent 分析处理"
            >
              交给 Agent
            </button>
          )}

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
  
  const renderRuntimeDetailsPanel = (group, isActiveGroup = false) => {
    const runtimeDetails = group?.runtimeDetails || [];
    const visibleRuntimeDetails = runtimeDetails.filter(msg => !isStatusUpdateMessage(msg));
    const latestStatusUpdate = [...runtimeDetails].reverse().find(isStatusUpdateMessage);
    const isRunningGroup = status === 'running' && isActiveGroup;
    const isExpanded = expandedRuntimePanels.has(group.id);
    const isLarge = largeRuntimePanels.has(group.id);
    const statusText = isRunningGroup
      ? getStatusUpdateText(latestStatusUpdate)
      : latestStatusUpdate
        ? getStatusUpdateText(latestStatusUpdate)
        : '执行完成';

    if (visibleRuntimeDetails.length === 0 && !isRunningGroup) {
      return null;
    }

    return (
      <div key={`${group.id}_runtime`} style={styles.runtimeDetailsPanel}>
        <div
          style={{
            ...styles.runtimeDetailsHeader,
            ...styles.runtimeDetailsHeaderInteractive
          }}
          onClick={() => handleRuntimeDetailsToggle(group.id)}
          title={isExpanded ? '收起运行详情' : '展开运行详情'}
        >
          <span style={styles.runtimeDetailsTitle}>
            {isRunningGroup && <span style={styles.spinner}></span>}
            <span>{isRunningGroup ? '执行过程' : '运行详情'}</span>
          </span>
          <span style={styles.runtimeDetailsActions}>
            <span>{visibleRuntimeDetails.length} 条</span>
            <button
              type="button"
              style={styles.runtimeDetailsToggle}
              title="导出运行详情"
              aria-label="导出运行详情"
              onClick={(event) => {
                event.stopPropagation();
                handleExportRuntimeDetails(group);
              }}
            >
              📥
            </button>
            <button
              type="button"
              style={styles.runtimeDetailsToggle}
              title={isLarge ? '还原执行过程窗口' : '放大执行过程窗口'}
              aria-label={isLarge ? '还原执行过程窗口' : '放大执行过程窗口'}
              onClick={(event) => {
                event.stopPropagation();
                handleRuntimePanelSizeToggle(group.id);
              }}
            >
              {isLarge ? '↙' : '⛶'}
            </button>
            <button
              type="button"
              style={styles.runtimeDetailsToggle}
              title={isExpanded ? '收起运行详情' : '展开运行详情'}
              aria-label={isExpanded ? '收起运行详情' : '展开运行详情'}
              onClick={(event) => {
                event.stopPropagation();
                handleRuntimeDetailsToggle(group.id);
              }}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          </span>
        </div>
        {isRunningGroup && (
          <div style={styles.runtimeProgress}>
            <div style={styles.runtimeProgressText}>
              <span style={styles.runtimeProgressLabel}>{statusText}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div style={styles.progressBar}>
              <div style={{
                ...styles.progressFill,
                width: `${progress}%`
              }} />
            </div>
          </div>
        )}
        {visibleRuntimeDetails.length > 0 && (
          <div
            ref={(node) => {
              if (node) {
                runtimeDetailsRefs.current.set(group.id, node);
              } else {
                runtimeDetailsRefs.current.delete(group.id);
              }
            }}
            style={{
              ...styles.runtimeDetailsList,
              ...(isLarge
                ? styles.runtimeDetailsListLarge
                : isExpanded
                  ? styles.runtimeDetailsListExpanded
                  : styles.runtimeDetailsListCollapsed)
            }}
          >
            {visibleRuntimeDetails.map((msg, index) => {
              const runtimeDetailId = `${group.id}_${msg.id || `runtime_detail_${msg.timestamp || 'no_time'}_${index}`}`;
              const isExpanded = expandedRuntimeDetails.has(runtimeDetailId);
              const typeDisplay = getTypeDisplay(msg.type);
              const isDebug = msg.type === 'debug';
              const content = getRuntimeDetailContent(msg);
              return (
                <div
                  key={runtimeDetailId}
                  style={{
                    ...styles.runtimeDetailItem,
                    ...styles.runtimeDetailItemInteractive,
                    ...(isDebug ? styles.runtimeDetailItemDebug : styles.runtimeDetailItemStatus)
                  }}
                  onClick={() => handleRuntimeDetailToggle(runtimeDetailId)}
                  title={isExpanded ? '收起这条运行消息' : '展开这条运行消息'}
                >
                  {isExpanded ? (
                    <>
                      <div style={styles.runtimeDetailMeta}>
                        <span>{typeDisplay.text}</span>
                        <span>
                          {isExpanded ? '收起' : '展开'}
                          {msg.timestamp ? ` · ${new Date(msg.timestamp).toLocaleTimeString()}` : ''}
                        </span>
                      </div>
                      <div
                        style={{
                          ...styles.runtimeDetailContent,
                          ...styles.runtimeDetailContentExpanded
                        }}
                      >
                        {content || '(无内容)'}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-dark)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {typeDisplay.text}
                      </span>
                      <span style={{
                        ...styles.runtimeDetailContent,
                        flex: 1,
                        minWidth: 0
                      }}>
                        {content || '(无内容)'}
                      </span>
                      <span style={{
                        color: 'var(--text-dark)',
                        fontSize: '11px',
                        whiteSpace: 'nowrap'
                      }}>
                        {msg.timestamp ? ` · ${new Date(msg.timestamp).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderConversationGroup = (group, groupIndex) => {
    const isActiveGroup = groupIndex === conversationGroups.length - 1;
    const [firstMessage, ...restMessages] = group.messages;

    return (
      <React.Fragment key={group.id}>
        {firstMessage && renderMessage(firstMessage, `${group.id}_0`)}
        {renderRuntimeDetailsPanel(group, isActiveGroup)}
        {restMessages.map((msg, index) => renderMessage(msg, `${group.id}_${index + 1}`))}
      </React.Fragment>
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
      {showHeader && (
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
      )}
      
      {/* 消息列表 */}
      <div ref={listRef} style={styles.messageList}>
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
          conversationGroups.map((group, index) => renderConversationGroup(group, index))
        )}
        
        {/* 无匹配消息 */}
        {primaryMessages.length === 0 && runtimeDetailMessages.length === 0 && messages.length > 0 && (
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
