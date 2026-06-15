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
import { MarkdownMessageContent } from './MarkdownMessageContent.jsx';
import { styles } from './MessageLog.styles.js';
import { useIPC } from '../hooks/useIPC.js';
import { RuntimeDetailsPanel } from './message-log/RuntimeDetailsPanel.jsx';
import { t } from '../i18n.js';
import {
  buildThinkingSummary,
  buildRuntimeDetailsExportData,
  createConversationGroups,
  isPrimaryMessage,
  isRuntimeDetailMessage,
} from './message-log/runtime-details.js';

// 样式定义
/**
 * 消息日志组件
 * @param {Object} props - 组件属性
 * @param {Array} props.messages - 消息列表
 * @param {string} props.status - 当前状态
 * @param {Function} props.onClear - 清空消息回调
 * @param {Function} props.onAskAgent - 将错误消息交给 Agent 处理
 */
function MessageLog({ messages, status, workingDirectory, fileServerUrl, onClear, onAskAgent }) {
  const ipc = useIPC();

  // 在消息容器上用事件委托捕获所有 <a> 标签的点击
  // 这样无论链接是 ReactMarkdown 生成的，还是嵌入的 HTML 结构，都能被正确拦截
  // 比自定义 ReactMarkdown components 更可靠（components 对复杂嵌套内容可能不生效）
  const handleMessageContainerClick = useCallback((e) => {
    const target = e.target;
    if (!target || target.nodeType !== 1) return;

    // 查找最近的 <a> 祖先元素
    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href') || anchor.href;
    if (!href) return;

    // 只处理外部链接（http/https）
    if (!/^https?:\/\//i.test(href) && !/^www\./i.test(href)) return;

    e.preventDefault();
    e.stopPropagation();

    let finalUrl = href;
    if (/^www\./i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    if (typeof ipc?.openExternal === 'function') {
      ipc.openExternal(finalUrl).catch((err) => {
        console.error('[MessageLog] openExternal 失败:', err);
        window.open(finalUrl, '_blank', 'noopener,noreferrer');
      });
    } else {
      window.open(finalUrl, '_blank', 'noopener,noreferrer');
    }
  }, [ipc]);

  // ReactMarkdown 自定义组件：为 <img> 设置安全策略
  const markdownComponents = useMemo(() => ({
    img: ({ src, alt, ...rest }) => (
      <img
        src={src}
        alt={alt || ''}
        referrerPolicy="no-referrer"
        style={{ maxWidth: '100%', height: 'auto', borderRadius: '6px' }}
        {...rest}
      />
    ),
  }), []);

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
  const [expandedRuntimePanels, setExpandedRuntimePanels] = useState(new Set());
  const [largeRuntimePanels, setLargeRuntimePanels] = useState(new Set());
  const [expandedRuntimeDetails, setExpandedRuntimeDetails] = useState(new Set());
  const [expandedThinkingPanels, setExpandedThinkingPanels] = useState(new Set());
  
  // 引用
  const listRef = useRef(null);
  const runtimeDetailsRefs = useRef(new Map());
  const thinkingPanelRefs = useRef(new Map());
  const searchRef = useRef(null);
  
  // 自动滚动到底部
  useEffect(() => {
    if (!listRef.current) return;

    const lastMessage = messages.filter(msg => !isRuntimeDetailMessage(msg)).at(-1);
    // 不因 Agent 回答结果而滚动（保持运行详情可见）
    const isAnswerMessage = lastMessage?.type === 'result' || lastMessage?.type === 'success';
    const shouldScroll = !isAnswerMessage && (autoScroll || lastMessage?.type === 'event');

    if (shouldScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  function messageMatchesFilter(msg) {
    return filter === 'all' || msg?.type === filter;
  }

  function messageMatchesSearch(msg) {
    if (!searchQuery) {
      return true;
    }
    const query = searchQuery.toLowerCase();
    return (
      (msg.content || msg.message || '').toLowerCase().includes(query) ||
      (msg.toolName || '').toLowerCase().includes(query) ||
      (msg.event || '').toLowerCase().includes(query) ||
      (msg.payloadSummary || '').toLowerCase().includes(query)
    );
  }

  function messageIsVisible(msg) {
    return messageMatchesFilter(msg) && messageMatchesSearch(msg);
  }

  // 搜索焦点
  useEffect(() => {
    if (searchExpanded && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchExpanded]);
  
  // 过滤和搜索消息
  const filteredMessages = useMemo(() => {
    return messages.filter(messageIsVisible);
  }, [messages, filter, searchQuery]);

  const runtimeDetailMessages = useMemo(() => (
    messages.filter(msg => isRuntimeDetailMessage(msg) && messageMatchesSearch(msg))
  ), [messages, searchQuery]);

  const primaryMessages = useMemo(() => (
    filteredMessages.filter(isPrimaryMessage)
  ), [filteredMessages]);

  const conversationGroups = useMemo(() => createConversationGroups(messages, {
    messageIsVisible,
    messageMatchesSearch,
  }), [messages, filter, searchQuery]);

  useEffect(() => {
    for (const group of conversationGroups) {
      if (group.runtimeDetails.length === 0) {
        continue;
      }
      const panelRef = runtimeDetailsRefs.current.get(group.id);
      if (panelRef) {
        panelRef.scrollTop = panelRef.scrollHeight;
      }

      const thinkingRef = thinkingPanelRefs.current.get(group.id);
      if (thinkingRef) {
        thinkingRef.scrollTop = thinkingRef.scrollHeight;
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

  const handleThinkingPanelToggle = useCallback((panelId, isRunningGroup) => {
    if (isRunningGroup) {
      return;
    }
    setExpandedThinkingPanels(prev => {
      const next = new Set(prev);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
  }, []);

  /**
   * 导出运行详情为 JSON 文件
   */
  const handleExportRuntimeDetails = useCallback((group) => {
    const details = group?.runtimeDetails || [];
    if (details.length === 0) return;

    const exportData = buildRuntimeDetailsExportData(details);

    const blob = new Blob(
      [JSON.stringify(exportData, null, 2)],
      { type: 'application/json;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runtime-details-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleRuntimeDetailsRefChange = useCallback((groupId, node) => {
    if (node) {
      runtimeDetailsRefs.current.set(groupId, node);
    } else {
      runtimeDetailsRefs.current.delete(groupId);
    }
  }, []);

  const handleThinkingPanelRefChange = useCallback((groupId, node) => {
    if (node) {
      thinkingPanelRefs.current.set(groupId, node);
    } else {
      thinkingPanelRefs.current.delete(groupId);
    }
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
    setExpandedThinkingPanels(new Set());
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

  const handleActivityAction = useCallback(async (action, activity) => {
    if (!activity) {
      return;
    }

    try {
      if (action === 'undo') {
        await ipc.undoActivity?.(activity, { confirm: false });
      } else if (action === 'continue' || action === 'approve') {
        await ipc.approveActivity?.(activity);
      } else {
        await ipc.reviewActivity?.(activity);
      }
    } catch (error) {
      console.error(`[MessageLog] activity:${action} 失败:`, error);
      if (onAskAgent) {
        onAskAgent({
          type: 'error',
          event: `activity:${action}:error`,
          content: `结构化活动操作失败: ${error.message}`,
          activity,
          timestamp: Date.now(),
        });
      }
    }
  }, [ipc, onAskAgent]);

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
      case 'thinking':
        return { ...styles.messageType, ...styles.typeThinking };
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
      case 'thinking':
        return { icon: '思', text: '思考' };
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
    const isUser = msg.type === 'user';
    const isAgent = msg.type === 'agent';
    
    return (
      <div 
        key={msgId}
        style={{
          ...styles.messageItem,
          ...(isCollapsed ? styles.messageItemCollapsed : {}),
          ...(isSelected ? styles.messageItemHover : {}),
          ...(isUser ? styles.messageItemUser : {}),
          ...(isAgent ? styles.messageItemAgent : {}),
          ...(isTimeline && !isUser ? { marginLeft: '16px' } : {}),
          ...(isTimeline && isUser ? { marginRight: '16px' } : {})
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
        
        {/* 消息头部 - 在气泡外面 */}
        <div 
          style={{
            ...styles.messageHeader,
            ...(isUser ? { flexDirection: 'row-reverse' } : {})
          }}
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
        
        {/* 消息气泡 */}
        <div style={{
          ...styles.messageBubble,
          ...(isUser ? styles.messageBubbleUser : {}),
          ...(isAgent ? styles.messageBubbleAgent : {})
        }}>
          {/* 消息内容 */}
          <MarkdownMessageContent
            text={msg.content || msg.message || ''}
            isCollapsed={isCollapsed}
            isUser={isUser}
            workingDirectory={workingDirectory}
            fileServerUrl={fileServerUrl}
            markdownComponents={markdownComponents}
            onLinkClick={handleMessageContainerClick}
          />
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
            <div style={{ marginBottom: '6px', color: 'var(--text-muted)' }}>{t('msg.payload')}</div>
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
            title={t('msg.hand_to_agent_hint')}
          >
            {t('msg.hand_to_agent')}
          </button>
        )}

        <button
          style={styles.actionButton}
          onClick={(e) => {
            e.stopPropagation();
            handleCopyMessage(msg);
          }}
          title={t('msg.copy_hint')}
        >
          📋 {t('msg.copy')}
        </button>
        
        <button
          style={styles.actionButton}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleDetails(msgId);
          }}
          title={t('msg.details')}
        >
          {showDetail ? `📖 ${t('msg.hide_details')}` : `📖 ${t('msg.details')}`}
        </button>
        
        <button
          style={styles.actionButton}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleCollapse(msgId);
          }}
          title={t('msg.expand')}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>
      
      {/* 详情面板 */}
      {showDetail && !isCollapsed && (
        <div style={styles.detailPanel}>
          <div style={styles.detailTitle}>{t('msg.message_details')}</div>
          <div style={styles.detailRow}>
            <span>{t('msg.message_id')}</span>
            <span style={styles.detailValue}>{msgId}</span>
          </div>
          <div style={styles.detailRow}>
            <span>{t('msg.type')}</span>
            <span style={styles.detailValue}>{msg.type}</span>
          </div>
          <div style={styles.detailRow}>
            <span>{t('msg.time')}</span>
            <span style={styles.detailValue}>
              {msg.timestamp ? new Date(msg.timestamp).toISOString() : 'N/A'}
            </span>
          </div>
          {msg.toolName && (
            <div style={styles.detailRow}>
              <span>{t('msg.tool_name_label')}</span>
              <span style={styles.detailValue}>{msg.toolName}</span>
            </div>
          )}
          {msg.duration && (
            <div style={styles.detailRow}>
              <span>{t('msg.duration_label')}</span>
              <span style={styles.detailValue}>{msg.duration}ms</span>
            </div>
          )}
          {msg.payload && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{t('msg.payload')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload, null, 2)}</pre>
            </div>
          )}
          {msg.raw && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{t('msg.raw_data')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{typeof msg.raw === 'string' ? msg.raw : JSON.stringify(msg.raw, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      </div>
    );
  };
  
  const renderRuntimeDetailsPanel = (group, isActiveGroup = false) => (
    <RuntimeDetailsPanel
      group={group}
      status={status}
      isActiveGroup={isActiveGroup}
      isExpanded={expandedRuntimePanels.has(group.id)}
      isLarge={largeRuntimePanels.has(group.id)}
      expandedRuntimeDetails={expandedRuntimeDetails}
      getTypeDisplay={getTypeDisplay}
                onExport={handleExportRuntimeDetails}
                onPanelSizeToggle={handleRuntimePanelSizeToggle}
                onActivityAction={handleActivityAction}
                onRefChange={handleRuntimeDetailsRefChange}
      onRuntimeDetailToggle={handleRuntimeDetailToggle}
      onRuntimeDetailsToggle={handleRuntimeDetailsToggle}
    />
  );

  const renderThinkingPanel = (group, isActiveGroup = false) => {
    const thinkingSummary = buildThinkingSummary(group.runtimeDetails);
    if (thinkingSummary.count === 0) {
      return null;
    }

    const isRunningGroup = status === 'running' && isActiveGroup;
    const isExpanded = isRunningGroup || expandedThinkingPanels.has(group.id);
    const latestIteration = thinkingSummary.latest?.iteration;
    const summaryText = thinkingSummary.summary || t('msg.thinking_summary');

    return (
      <div style={styles.thinkingPanel}>
        <button
          type="button"
          style={styles.thinkingHeader}
          onClick={() => handleThinkingPanelToggle(group.id, isRunningGroup)}
          title={isExpanded ? t('msg.collapse_thinking') : t('msg.expand_thinking')}
        >
          <span style={styles.thinkingTitle}>
            <span style={{
              ...styles.thinkingPulse,
              ...(isRunningGroup ? styles.thinkingPulseRunning : {})
            }}>
              {isRunningGroup ? '...' : 'OK'}
            </span>
            <span>{isRunningGroup ? t('msg.thinking_in_progress') : t('msg.thinking_summary_label')}</span>
          </span>
          <span style={styles.thinkingMeta}>
            {latestIteration ? t('msg.iteration_x', { n: latestIteration }) : t('msg.count_messages', { count: thinkingSummary.count })}
            {thinkingSummary.iterationCount > 1 ? t('msg.iteration_x_of_y', { n: latestIteration, total: thinkingSummary.iterationCount }).replace(/^[^/]+\//, ' / ') : ''}
            <span>{isExpanded ? t('msg.collapse') : t('msg.expand')}</span>
          </span>
        </button>

        {!isExpanded && (
          <div style={styles.thinkingSummaryText}>{summaryText}</div>
        )}

        {isExpanded && (
          <div
            ref={(node) => handleThinkingPanelRefChange(group.id, node)}
            style={styles.thinkingScroll}
          >
            {thinkingSummary.messages.map((msg, index) => (
              <div key={msg.id || `${group.id}_thinking_${index}`} style={styles.thinkingStep}>
                <div style={styles.thinkingStepHeader}>
                  <span>{msg.iteration ? `第 ${msg.iteration} 轮` : `片段 ${index + 1}`}</span>
                  {msg.timestamp && <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>}
                </div>
                <div style={styles.thinkingStepContent}>
                  {msg.thinkingText || msg.summary || msg.content || '模型正在思考'}
                </div>
              </div>
            ))}
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
        {renderThinkingPanel(group, isActiveGroup)}
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
          <div style={styles.emptyText}>{t('ui.root')}</div>
          <div style={styles.emptyHint}>
            {t('chat.placeholder')}
          </div>
          
          {/* 快捷提示 */}
          <div style={{
            marginTop: '24px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            <span style={styles.emptyChip}>{t('ui.root')}</span>
            <span style={styles.emptyChip}>{t('msg.tool')}</span>
            <span style={styles.emptyChip}>{t('msg.result')}</span>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div style={styles.container}>
      {/* 消息容器内部链接样式：确保 ReactMarkdown 生成的 <a> 标签有明确的链接外观 */}
      <style>{`
        .markdown a {
          color: var(--primary-color, #4a9eff);
          text-decoration: underline;
          cursor: pointer;
          word-break: break-all;
          padding: 0 2px;
          border-radius: 2px;
          transition: background-color 0.15s;
        }
        .markdown a:hover {
          background-color: var(--primary-faint);
          text-decoration: underline;
        }
        .markdown code {
          background-color: var(--surface-color, #1a1f2e);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 12px;
          color: var(--text-color, #e6e9ef);
        }
        .markdown pre {
          background-color: var(--surface-color, #1a1f2e);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          font-size: 12px;
        }
        .markdown pre code {
          background: transparent;
          padding: 0;
        }
        .markdown p {
          margin: 4px 0;
          line-height: 1.5;
          font-size: 13px;
          color: var(--text-color, #e6e9ef);
        }
        .markdown ul, .markdown ol {
          margin: 4px 0;
          padding-left: 20px;
          font-size: 13px;
        }
        .markdown li {
          margin: 2px 0;
          line-height: 1.4;
        }
        @keyframes thinkingPulse {
          0%, 100% { opacity: 0.58; }
          50% { opacity: 1; }
        }
      `}</style>
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.title}>
          <span>{t('msg.message_details')}</span>
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
                placeholder={t('msg.search_messages')}
                onBlur={() => {
                  if (!searchQuery) setSearchExpanded(false);
                }}
              />
            )}
            <button
              style={styles.button}
              onClick={handleSearchToggle}
              title={t('msg.search_hint')}
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
              title={t('msg.list_view')}
            >
              📋
            </button>
            <button
              style={{
                ...styles.viewButton,
                ...(viewMode === 'timeline' ? styles.viewButtonActive : {})
              }}
              onClick={() => handleViewChange('timeline')}
              title={t('msg.timeline_view')}
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
            <option value="all">{t('ui.root')}</option>
            <option value="user">👤 {t('msg.user')}</option>
            <option value="info">ℹ️ {t('msg.info')}</option>
            <option value="success">✅ {t('msg.success')}</option>
            <option value="error">❌ {t('msg.error')}</option>
            <option value="tool">🔧 {t('msg.tool')}</option>
            <option value="result">📊 {t('msg.result')}</option>
          </select>
          
          {/* 自动滚动按钮 */}
          <button
            style={{
              ...styles.button,
              ...(autoScroll ? styles.buttonActive : {})
            }}
            onClick={handleAutoScrollChange}
            title={autoScroll ? t('msg.auto_scroll_stop') : t('msg.auto_scroll_start')}
          >
            {autoScroll ? '📍' : '📌'}
          </button>
          
          {/* 清空按钮 */}
          <button
            style={styles.button}
            onClick={handleClear}
            title={t('msg.clear_hint')}
          >
            🗑️
          </button>
        </div>
      </div>
      
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
            <div style={styles.emptyText}>{t('status.not_set')}</div>
            <div style={styles.emptyHint}>
              {t('msg.search_messages')}
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
