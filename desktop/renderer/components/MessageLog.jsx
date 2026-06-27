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
import { styles } from './message-log/styles/MessageLog.styles.js';
import { useIPC } from '../hooks/useIPC.js';
import { RuntimeDetailsPanel } from './message-log/RuntimeDetailsPanel.jsx';
import { Icon } from './ui/index.js';
import { t } from '../i18n.js';
import {
  buildRuntimeDetailsExportData,
  createConversationGroups,
  isPrimaryMessage,
  isRuntimeDetailMessage,
} from './message-log/utils/runtime-details.js';
import { getMessageDisplayText, getMessageSerializableText, getStableMessageId, safeStringify } from './message-log/utils/message-utils.js';

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
  
  // 自动滚动状态 — 基于用户滚动位置智能判断
  // autoScroll = true 时跟随新内容滚动到底部；false 时锁定当前位置
  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(true);  // 用 ref 避免在滚动事件处理器中读到旧状态

  // 同步 ref 和 state
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  // 判断是否接近底部（阈值 80px）
  const isNearBottom = useCallback((el) => {
    if (!el) return false;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom < 80;
  }, []);

  // 主消息列表滚动事件：根据用户滚动行为智能切换 autoScroll
  const handleListScroll = useCallback((e) => {
    const el = e.target;
    if (!el) return;
    const nearBottom = isNearBottom(el);
    // 用户主动滚动时切换 — 滚到附近底部→开启跟随；远离底部→停止跟随
    if (nearBottom && !autoScrollRef.current) {
      setAutoScroll(true);
    } else if (!nearBottom && autoScrollRef.current) {
      // 只在向上滚动/明显远离底部时才停止跟随
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom > 150) {
        setAutoScroll(false);
      }
    }
  }, [isNearBottom]);

  // 自动滚动到底部 — 仅当用户希望自动跟随且不是结果类消息时才滚动
  useEffect(() => {
    if (!listRef.current) return;
    if (!autoScroll) return;  // 用户主动查看历史，不滚动

    const lastMessage = messages.filter(msg => !isRuntimeDetailMessage(msg)).at(-1);
    // 不因 Agent 回答结果而滚动（保持运行详情可见）
    const isAnswerMessage = lastMessage?.type === 'result' || lastMessage?.type === 'success';
    const shouldScroll = !isAnswerMessage;

    if (shouldScroll) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // 智能滚动：子面板也使用同样策略
  const handleSubPanelScroll = useCallback((e) => {
    const el = e.target;
    if (!el) return;
    // 子面板也遵循：用户离开底部后不强制跟随
  }, []);

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
    // 运行时详情消息（tool/tool_result/thinking/event/debug）
    // 只显示在执行概览的原始日志中，不显示在主消息气泡里
    if (isRuntimeDetailMessage(msg)) {
      return false;
    }
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
      // 运行时详情面板 — 仅当用户在底部附近时才跟随滚动
      const panelRef = runtimeDetailsRefs.current.get(group.id);
      if (panelRef && isNearBottom(panelRef)) {
        panelRef.scrollTop = panelRef.scrollHeight;
      }

      // 思考面板 — 同样策略
      const thinkingRef = thinkingPanelRefs.current.get(group.id);
      if (thinkingRef && isNearBottom(thinkingRef)) {
        thinkingRef.scrollTop = thinkingRef.scrollHeight;
      }
    }
  }, [conversationGroups, isNearBottom]);
  
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
        setShowDetails(detailsPrev => {
          if (!detailsPrev.has(msgId)) return detailsPrev;
          const nextDetails = new Set(detailsPrev);
          nextDetails.delete(msgId);
          return nextDetails;
        });
      }
      return newSet;
    });
  }, []);
  
  // 处理消息详情显示/隐藏
  const handleToggleDetails = useCallback((msgId) => {
    setCollapsedMessages(prev => {
      if (!prev.has(msgId)) return prev;
      const next = new Set(prev);
      next.delete(msgId);
      return next;
    });
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
  const handleCopyMessage = useCallback(async (msg, msgId) => {
    const content = getMessageSerializableText(msg);
    
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessage(msgId || msg.id);
      
      // 3秒后清除提示
      setTimeout(() => {
        setCopiedMessage(null);
      }, 3000);
    } catch (error) {
      console.error('[MessageLog] 复制失败:', error);
    }
  }, [getMessageSerializableText]);

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
      case 'assistant_stream':
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
        return { icon: 'AI', text: t('msg.assistant') };
      case 'thinking':
        return { icon: '思', text: '思考' };
      case 'plan':
        return { icon: '▦', text: '计划' };
      default:
        return { icon: '📄', text: '消息' };
    }
  };
  
  // 渲染消息项
  const renderMessage = (msg, index, isTimeline = false) => {
    const msgId = getStableMessageId(msg, index, isTimeline ? 'timeline' : 'message');
    const isCollapsed = collapsedMessages.has(msgId);
    const showDetail = showDetails.has(msgId);
    const isSelected = selectedMessage === msgId;
    const typeDisplay = getTypeDisplay(msg.type);
    const isActionableError = isActionableErrorMessage(msg);
    const isUser = msg.type === 'user';
    const isAgent = msg.type === 'agent' || msg.type === 'assistant_stream' || msg.type === 'result' || msg.type === 'success';
    const isStreaming = msg.type === 'assistant_stream' || msg.isStreaming;
    const isAssistantMarkdownMessage = !msg.toolName && (
      msg.type === 'agent' ||
      msg.type === 'assistant' ||
      msg.type === 'assistant_stream' ||
      msg.type === 'result' ||
      msg.streamComplete === true
    );

    // 判断当前任务是否有 plan（通过消息列表中是否有 plan 类型消息）
    const hasPlanInTask = messages.some(m => m.type === 'plan');
    // 判断 plan 是否已经出现（在当前消息之前或当前）
    const planHasAppeared = hasPlanInTask && messages.slice(0, index + 1).some(m => m.type === 'plan');

    const renderAssistantBubble = ({ streaming = false } = {}) => {
      const content = getMessageDisplayText(msg);

      if (!content && streaming) {
        return renderStreamingCard();
      }

      return (
        <div style={{
          ...styles.enhancedMessageBubble,
          ...styles.enhancedMessageBubbleAgent,
          ...styles.assistantMarkdownBubble,
        }}>
          {content ? (
            <MarkdownMessageContent
              text={content}
              isCollapsed={isCollapsed}
              isStreaming={streaming}
              workingDirectory={workingDirectory}
              fileServerUrl={fileServerUrl}
              markdownComponents={markdownComponents}
              onLinkClick={handleMessageContainerClick}
            />
          ) : (
            <div style={styles.emptyAssistantMessage}>
              <span style={styles.emptyAssistantDot} />
              <span>暂无回复内容</span>
            </div>
          )}
        </div>
      );
    };

    // ── 工具调用卡片渲染 ───────────────────────────
    const renderToolCard = () => {
      const toolName = msg.toolName || msg.name || (msg.content && msg.content.length < 80 ? msg.content : '未知工具');
      const toolIcon = msg.toolName?.includes('write') ? '✍️'
        : msg.toolName?.includes('subagent') ? '◫'
        : msg.toolName?.includes('read') || msg.toolName?.includes('cat') ? '📄'
        : msg.toolName?.includes('shell') || msg.toolName?.includes('exec') || msg.toolName?.includes('bash') ? '💻'
        : msg.toolName?.includes('search') || msg.toolName?.includes('find') || msg.toolName?.includes('glob') ? '🔎'
        : msg.toolName?.includes('ask_human') || msg.toolName?.includes('human') ? '🙋'
        : msg.toolName?.includes('file') ? '📁'
        : '🔧';

      let args = null;
      if (msg.args && typeof msg.args === 'object' && Object.keys(msg.args).length > 0) {
        args = msg.args;
      } else if (msg.content && msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object') args = parsed;
        } catch (e) {}
      }

      return (
        <div style={styles.actionCard}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxTool }}>{toolIcon}</div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>{toolName}</div>
              <div style={styles.actionSubtitle}>
                {toolName.includes('subagent') ? '子代理任务' : '执行工具调用'}
              </div>
            </div>
            {msg.duration && (
              <span style={styles.actionDurationBadge}>{msg.duration}ms</span>
            )}
          </div>

          {args && !isCollapsed && (
            <div style={styles.actionArgs}>
              {Object.entries(args).map(([key, value], idx) => (
                <div key={idx} style={styles.actionArgRow}>
                  <span style={styles.actionArgKey}>{key}</span>
                  <span style={{
                    ...styles.actionArgValue,
                    ...(typeof value === 'string' ? styles.actionArgValueString : {}),
                    ...(typeof value === 'number' ? styles.actionArgValueNumber : {})
                  }}>
                    {typeof value === 'string'
                      ? (value.length > 200 ? value.slice(0, 200) + '…' : value)
                      : safeStringify(value)
                    }
                  </span>
                </div>
              ))}
            </div>
          )}

          {!args && msg.content && msg.content.length > 0 && !isCollapsed && (
            <div style={styles.actionResultSummary}>
              <MarkdownMessageContent
                text={msg.content || ''}
                isCollapsed={isCollapsed}
                workingDirectory={workingDirectory}
                fileServerUrl={fileServerUrl}
                markdownComponents={markdownComponents}
                onLinkClick={handleMessageContainerClick}
              />
            </div>
          )}
        </div>
      );
    };

    // ── 结果/成功卡片渲染 ───────────────────────────
    const renderResultCard = () => {
      if (isAssistantMarkdownMessage) {
        return renderAssistantBubble();
      }

      const summary = msg.content ?? msg.message ?? msg.result ?? msg.payload ?? '执行成功';
      const displayText = safeStringify(summary, '执行成功');
      const hasContent = Boolean(displayText.trim());

      return (
        <div style={{ ...styles.actionCard, borderColor: 'var(--success-color)' }}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxResult }}>✓</div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>工具执行完成</div>
              <div style={styles.actionSubtitle}>{msg.toolName || '操作结果'}</div>
            </div>
            {msg.duration && (
              <span style={styles.actionDurationBadge}>{msg.duration}ms</span>
            )}
          </div>

          {hasContent && !isCollapsed && (
            <div style={styles.actionResultSummary}>
              <MarkdownMessageContent
                text={displayText}
                isCollapsed={isCollapsed}
                workingDirectory={workingDirectory}
                fileServerUrl={fileServerUrl}
                markdownComponents={markdownComponents}
                onLinkClick={handleMessageContainerClick}
              />
            </div>
          )}
        </div>
      );
    };

    // ── 错误卡片渲染 ───────────────────────────
    const renderErrorCard = () => {
      const errorMsg = msg.content ?? msg.message ?? msg.error ?? msg.payload ?? '操作失败';
      const displayMsg = safeStringify(errorMsg, '操作失败');

      return (
        <div style={{ ...styles.actionCard, borderColor: 'var(--error-border)' }}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxError }}>!</div>
            <div style={styles.actionTitleWrap}>
              <div style={{ ...styles.actionName, color: 'var(--error-color)' }}>
                {msg.event === 'tool:error' ? '工具执行失败' : '错误'}
              </div>
              <div style={styles.actionSubtitle}>可将此错误交由助手分析处理</div>
            </div>
          </div>

          {!isCollapsed && (
            <div style={styles.actionErrorBody}>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                fontSize: '12px',
                lineHeight: 1.6,
                color: 'var(--error-color)'
              }}>
                {displayMsg.length > 500 ? displayMsg.slice(0, 500) + '…' : displayMsg}
              </pre>
            </div>
          )}
        </div>
      );
    };

    // ── 思考卡片渲染 ───────────────────────────
    const renderThinkingCard = () => {
      const content = getMessageDisplayText(msg);
      if (!content) return null;

      return (
        <div style={styles.thinkingCard}>
          <div style={styles.thinkingCardHeader}>
            <span>💭</span>
            <span>{t('msg.thinking_in_progress')}</span>
          </div>
          {!isCollapsed && (
            <div style={{ fontSize: '13px', color: 'var(--text-dark)', lineHeight: 1.7 }}>
              <MarkdownMessageContent
                text={content}
                isCollapsed={isCollapsed}
                workingDirectory={workingDirectory}
                fileServerUrl={fileServerUrl}
                markdownComponents={markdownComponents}
                onLinkClick={handleMessageContainerClick}
              />
            </div>
          )}
        </div>
      );
    };

    const renderStreamingCard = () => {
      const content = getMessageDisplayText(msg);

      return (
        <div style={{
          ...styles.streamingBubble,
          ...(content ? styles.streamingBubbleActive : {})
        }}>
          <div style={styles.streamingStatus}>
            <span style={styles.streamingStatusDot} />
            <span>{content ? '正在生成回复' : '正在组织回复'}</span>
            <span style={styles.streamingDots} aria-hidden="true">
              <span style={styles.streamingDot} />
              <span style={styles.streamingDot} />
              <span style={styles.streamingDot} />
            </span>
          </div>

          {content ? (
            <MarkdownMessageContent
              text={content}
              isCollapsed={isCollapsed}
              isStreaming
              workingDirectory={workingDirectory}
              fileServerUrl={fileServerUrl}
              markdownComponents={markdownComponents}
              onLinkClick={handleMessageContainerClick}
            />
          ) : (
            <div style={styles.streamingSkeleton}>
              <span style={{ ...styles.streamingSkeletonLine, width: '72%' }} />
              <span style={{ ...styles.streamingSkeletonLine, width: '92%' }} />
              <span style={{ ...styles.streamingSkeletonLine, width: '48%' }} />
            </div>
          )}
        </div>
      );
    };

    const renderPlanCard = () => {
      const tasks = Array.isArray(msg.planTasks) ? msg.planTasks : [];
      const progress = msg.planProgress || {};
      const title = msg.content || '执行计划';
      const statusTone = progress.failed > 0 ? 'var(--error-color)'
        : progress.needsRepair > 0 ? 'var(--warning-color)'
        : progress.completed === progress.total && progress.total > 0 ? 'var(--success-color)'
        : 'var(--warning-color)';

      const taskLabel = (task) => task.name || task.id || 'Task';
      const taskStatus = (task) => String(task.displayStatus || task.status || 'pending').toLowerCase();
      const taskStatusText = (statusValue) => {
        switch (statusValue) {
          case 'completed': return '完成';
          case 'running': return '进行中';
          case 'needs_repair': return '需修复';
          case 'failed': return '失败';
          case 'blocked': return '等待';
          default: return '待执行';
        }
      };

      return (
        <div style={styles.planCard}>
          <div style={styles.planCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.planIconBox }}>▦</div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>{title}</div>
              <div style={styles.actionSubtitle}>
                {progress.completed || 0}/{progress.total || tasks.length} 完成
                {msg.toolName ? ` · 由 ${msg.toolName} 推进` : ''}
              </div>
            </div>
            <span style={{ ...styles.planProgressBadge, color: statusTone }}>
              {progress.progress ?? 0}%
            </span>
          </div>

          <div style={styles.planProgressTrack}>
            <div
              style={{
                ...styles.planProgressFill,
                width: `${Math.max(4, progress.progress || 0)}%`,
                backgroundColor: statusTone,
              }}
            />
          </div>

          {!isCollapsed && tasks.length > 0 && (
            <div style={styles.planTaskList}>
              {tasks.map((task, taskIndex) => {
                const statusValue = taskStatus(task);
                return (
                  <div key={task.id || taskIndex} style={styles.planTaskRow}>
                    <span
                      style={{
                        ...styles.planTaskDot,
                        ...(statusValue === 'completed' ? styles.planTaskDotDone : {}),
                        ...(statusValue === 'running' ? styles.planTaskDotRunning : {}),
                        ...(statusValue === 'needs_repair' ? styles.planTaskDotRunning : {}),
                        ...(statusValue === 'failed' ? styles.planTaskDotFailed : {}),
                      }}
                    />
                    <span style={styles.planTaskName}>
                      {taskLabel(task)}
                      {task.cycleLabel ? ` · ${task.cycleLabel}` : ''}
                    </span>
                    <span style={styles.planTaskStatus}>{taskStatusText(statusValue)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    // ── 根据消息类型渲染内容 ──────────────────────
    const renderBody = () => {
      if (isCollapsed) {
        const preview = (getMessageDisplayText(msg) || msg.toolName || msg.name || '')
          .toString().slice(0, 60);
        return (
          <div style={{
            ...styles.messageBubble,
            ...(isUser ? styles.messageBubbleUser : {}),
            ...(isAgent ? styles.messageBubbleAgent : {})
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              {preview}{preview.length >= 60 ? '…' : ''}
            </span>
          </div>
        );
      }

      if (msg.type === 'tool') return renderToolCard();
      if (isAssistantMarkdownMessage && !isStreaming) return renderAssistantBubble();
      if (msg.type === 'result' || msg.type === 'success' || msg.type === 'tool_result') return renderResultCard();
      if (msg.type === 'error') return renderErrorCard();
      if (msg.type === 'thinking') return renderThinkingCard();
      if (msg.type === 'plan') return renderPlanCard();
      // streaming card：只有在没有 plan 的任务中立即显示，或者有 plan 但 plan 已经出现后才显示
      if (isStreaming && (!hasPlanInTask || planHasAppeared)) return renderStreamingCard();

      const content = getMessageDisplayText(msg);
      return (
        <div style={{
          ...styles.enhancedMessageBubble,
          ...(isUser ? styles.enhancedMessageBubbleUser : styles.enhancedMessageBubbleAgent)
        }}>
          {content ? (
            <MarkdownMessageContent
              text={content}
              isCollapsed={isCollapsed}
              isUser={isUser}
              isStreaming={isStreaming}
              workingDirectory={workingDirectory}
              fileServerUrl={fileServerUrl}
              markdownComponents={markdownComponents}
              onLinkClick={handleMessageContainerClick}
            />
          ) : (
            <div style={styles.emptyAssistantMessage}>
              <span style={styles.emptyAssistantDot} />
              <span>等待响应内容</span>
            </div>
          )}
        </div>
      );
    };
    
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
        
        {/* 渲染消息主体 */}
        {renderBody()}

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
            handleCopyMessage(msg, msgId);
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
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{safeStringify(msg.payload)}</pre>
            </div>
          )}
          {msg.raw && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{t('msg.raw_data')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--text-color)', backgroundColor: 'transparent', borderRadius: '4px' }}>{safeStringify(msg.raw)}</pre>
            </div>
          )}
        </div>
      )}
      </div>
    );
  };
  
  const renderRuntimeDetailsPanel = (group, isActiveGroup = false) => {
    const isRunningGroup = status === 'running' && isActiveGroup;
    const isExpanded = isRunningGroup || expandedRuntimePanels.has(group.id);
    return (
      <RuntimeDetailsPanel
        group={group}
        status={status}
        isActiveGroup={isActiveGroup}
        isExpanded={isExpanded}
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
  };

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
                  {msg.thinkingText || msg.summary || msg.content || t('msg.model_thinking')}
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
          color: var(--primary-color);
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
          background-color: var(--surface-color);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 12px;
          color: var(--text-color);
        }
        .markdown pre {
          background-color: var(--surface-color);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
          font-size: 12px;
          margin: 10px 0;
        }
        .markdown pre code {
          background: transparent;
          padding: 0;
        }
        .markdown .markup-block {
          position: relative;
          margin: 0;
          padding: 28px 12px 12px;
          overflow-x: auto;
          white-space: pre;
          word-break: normal;
          border: 1px solid var(--border-subtle);
          border-radius: 7px;
          background-color: var(--surface-color);
          color: var(--text-color);
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.22;
        }
        .markdown .markup-block::before {
          content: attr(data-language);
          position: absolute;
          top: 7px;
          right: 10px;
          color: var(--text-muted);
          font-family: var(--font-family);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .markdown .markup-block code {
          background: transparent;
          padding: 0;
          white-space: inherit;
        }
        .markdown p {
          margin: 1px 0;
          line-height: 1.05;
          font-size: 12px;
          color: var(--text-color);
          padding: 0;
        }
        .markdown p:first-child,
        .markdown ul:first-child,
        .markdown ol:first-child,
        .markdown pre:first-child,
        .markdown blockquote:first-child {
          margin-top: 0;
        }
        .markdown p:last-child,
        .markdown ul:last-child,
        .markdown ol:last-child,
        .markdown pre:last-child,
        .markdown blockquote:last-child {
          margin-bottom: 0;
        }
        .markdown blockquote {
          margin: 8px 0;
          padding: 4px 6px;
          border-left: 3px solid var(--primary-color);
          background-color: var(--surface-subtle);
          border-radius: 0 6px 6px 0;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.1;
        }
        .markdown h1, .markdown h2, .markdown h3, .markdown h4 {
          margin: 14px 0 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border-subtle);
          font-weight: 600;
          color: var(--text-color);
        }
        .markdown h1 { font-size: 14px; }
        .markdown h2 { font-size: 12px; }
        .markdown h3 { font-size: 10px; }
        .markdown h4 { font-size: 8px; border-bottom: none; }
        .markdown ul, .markdown ol {
          margin: 4px 0;
          padding-left: 20px;
          font-size: 12px;
          line-height: 1.05;
        }
        .markdown li {
          margin: 1px 0;
          line-height: 1.05;
        }
        .markdown hr {
          border: none;
          border-top: 1px dashed var(--border-subtle);
          margin: 14px 0;
        }
        .markdown table {
          border-collapse: collapse;
          margin: 10px 0;
          font-size: 12px;
          width: 100%;
        }
        .markdown th, .markdown td {
          border: 1px solid var(--border-subtle);
          padding: 6px 10px;
          text-align: left;
        }
        .markdown th {
          background-color: var(--surface-subtle);
          font-weight: 600;
        }
        @keyframes thinkingPulse {
          0%, 100% { opacity: 0.58; }
          50% { opacity: 1; }
        }
        @keyframes streamingCursor {
          0%, 45% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes streamingDot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes streamingSkeleton {
          0% { opacity: 0.45; }
          50% { opacity: 0.95; }
          100% { opacity: 0.45; }
        }
        @keyframes streamingEdge {
          0%, 100% { border-color: var(--primary-border); }
          50% { border-color: var(--primary-strong); }
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
              aria-label={t('msg.search_hint')}
            >
              <Icon name="search" size={14} />
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
              aria-label={t('msg.list_view')}
            >
              <Icon name="list" size={14} />
            </button>
            <button
              style={{
                ...styles.viewButton,
                ...(viewMode === 'timeline' ? styles.viewButtonActive : {})
              }}
              onClick={() => handleViewChange('timeline')}
              title={t('msg.timeline_view')}
              aria-label={t('msg.timeline_view')}
            >
              <Icon name="timeline" size={14} />
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
          
          {/* 自动滚动按钮 — 跟随模式/锁定模式 */}
          <button
            style={{
              ...styles.button,
              ...(autoScroll ? styles.buttonActive : {}),
              ...(!autoScroll ? {
                color: 'var(--warning-color)',
                borderColor: 'var(--warning-color)',
                fontWeight: '500',
              } : {})
            }}
            onClick={handleAutoScrollChange}
            title={autoScroll ? '跟随新内容 (点击锁定当前位置)' : '已锁定 — 点击恢复跟随滚动'}
          >
            <Icon name={autoScroll ? 'pin' : 'lock'} size={14} />
            {autoScroll ? '跟随' : '已锁定'}
          </button>
          
          {/* 清空按钮 */}
          <button
            style={styles.button}
            onClick={handleClear}
            title={t('msg.clear_hint')}
            aria-label={t('msg.clear_hint')}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>
      
      {/* 消息列表 */}
      <div
        ref={listRef}
        style={styles.messageList}
        onScroll={handleListScroll}
      >
        {/* 时间线视图 */}
        {viewMode === 'timeline' && groupedMessages && (
          <div style={styles.timelineView}>
            <div style={styles.timelineLine} />
            {Object.entries(groupedMessages).map(([groupTitle, msgs]) => (
              <React.Fragment key={groupTitle}>
                {renderGroupHeader(groupTitle, msgs.length)}
                {msgs.map((msg, index) => renderMessage(msg, `${groupTitle}_${index}`, true))}
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
