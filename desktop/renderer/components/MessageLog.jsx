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
  buildThinkingSummary,
  buildRuntimeDetailsExportData,
  createConversationGroups,
  isPrimaryMessage,
  isRuntimeDetailMessage,
} from '../runtime/runtime-details.js';
import { getMessageDisplayText, getMessageSerializableText, getStableMessageId, safeStringify } from './message-log/utils/message-utils.js';
import {
  PLAN_ARCHITECTURE_LABELS,
  PLAN_PHASE_LABELS,
  formatPlanStrategyValue,
  getPlanModeLabel,
  getPlanPhaseLabel,
  getPlanShapeLabel,
  groupPlanTasksByPhase,
} from './message-log/utils/plan-display.js';

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
    if (!target || target.nodeType !== 1) {return;}

    // 查找最近的 <a> 祖先元素
    const anchor = target.closest('a');
    if (!anchor) {return;}

    const href = anchor.getAttribute('href') || anchor.href;
    if (!href) {return;}

    // 只处理外部链接（http/https）
    if (!/^https?:\/\//i.test(href) && !/^www\./i.test(href)) {return;}

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
  const [planFrameSelections, setPlanFrameSelections] = useState({});
  
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
    if (!el) {return false;}
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom < 80;
  }, []);

  // 主消息列表滚动事件：根据用户滚动行为智能切换 autoScroll
  const handleListScroll = useCallback((e) => {
    const el = e.target;
    if (!el) {return;}
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
    if (!listRef.current) {return;}
    if (!autoScroll) {return;}  // 用户主动查看历史，不滚动

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
    if (!el) {return;}
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

  // 判断消息是否是 AI 助手消息（需要自动折叠的类型）
  const isAssistantMessage = (msg) => {
    return msg.type === 'agent' || msg.type === 'assistant' || msg.type === 'assistant_stream' || msg.type === 'result' || msg.type === 'success';
  };

  // 跟踪用户手动展开的消息，避免自动折叠覆盖用户操作
  const userUncollapsedRef = useRef(new Set());

  // 跟踪上一次的 filteredMessages 长度，避免不必要的更新
  const prevFilteredMessagesLengthRef = useRef(0);

  // 自动折叠逻辑：所有 assistant 消息默认折叠，最后一条总结消息展开
  useEffect(() => {
    // 只有当 filteredMessages 数量变化时才重新计算（避免每次都触发）
    if (filteredMessages.length === prevFilteredMessagesLengthRef.current) {
      return;
    }
    prevFilteredMessagesLengthRef.current = filteredMessages.length;

    const assistantIndices = [];
    filteredMessages.forEach((msg, index) => {
      if (isAssistantMessage(msg)) {
        assistantIndices.push(index);
      }
    });

    // 使用函数式更新，避免依赖 collapsedMessages
    setCollapsedMessages(prev => {
      const newCollapsed = new Set(prev);
      const lastAssistantIndex = assistantIndices.length > 0 ? assistantIndices[assistantIndices.length - 1] : -1;

      assistantIndices.forEach((index) => {
        const msg = filteredMessages[index];
        const msgId = getStableMessageId(msg, `${index}`);

        if (index !== lastAssistantIndex) {
          // 不是最后一条 assistant 消息，应该折叠
          // 如果用户手动展开了这条消息，则不自动折叠
          if (!userUncollapsedRef.current.has(msgId)) {
            newCollapsed.add(msgId);
          }
        } else {
          // 最后一条 assistant 消息（总结）保持展开
          newCollapsed.delete(msgId);
          // 同时记录用户手动展开（避免后续被自动折叠）
          userUncollapsedRef.current.add(msgId);
        }
      });

      return newCollapsed;
    });
  }, [filteredMessages]);

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
    if (viewMode !== 'timeline') {return null;}
    
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

  const handlePlanFrameChange = useCallback((msgId, frameIndex) => {
    setPlanFrameSelections(prev => ({
      ...prev,
      [msgId]: frameIndex,
    }));
  }, []);

  const handlePlanFrameLatest = useCallback((msgId) => {
    setPlanFrameSelections(prev => {
      if (!(msgId in prev)) {return prev;}
      const next = { ...prev };
      delete next[msgId];
      return next;
    });
  }, []);

  /**
   * 导出运行详情为 JSON 文件
   */
  const handleExportRuntimeDetails = useCallback((group) => {
    const details = group?.runtimeDetails || [];
    if (details.length === 0) {return;}

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
        // 用户手动展开了消息，记录到 userUncollapsedRef
        userUncollapsedRef.current.add(msgId);
      } else {
        newSet.add(msgId);
        // 用户手动折叠了消息，从 userUncollapsedRef 移除
        userUncollapsedRef.current.delete(msgId);
        setShowDetails(detailsPrev => {
          if (!detailsPrev.has(msgId)) {return detailsPrev;}
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
      if (!prev.has(msgId)) {return prev;}
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
        return { iconName: 'info', text: t('msg.info') };
      case 'success':
        return { iconName: 'success', text: t('msg.success') };
      case 'error':
        return { iconName: 'error', text: t('msg.error') };
      case 'warning':
        return { iconName: 'warning', text: t('msg.warning') };
      case 'debug':
        return { iconName: 'debug', text: t('msg.debug') };
      case 'tool':
        return { iconName: 'tool', text: t('msg.tool') };
      case 'tool_result':
        return { iconName: 'tool_result', text: t('msg.tool_result') };
      case 'event':
        return { iconName: 'event', text: t('msg.event') };
      case 'result':
        return { iconName: 'result', text: t('msg.result') };
      case 'user':
        return { iconName: 'user', text: t('msg.user') };
      case 'agent':
        return { iconName: 'assistant', text: t('msg.assistant') };
      case 'thinking':
        return { iconName: 'thinking', text: t('msg.thinking') };
      case 'plan':
        return { iconName: 'plan', text: t('msg.plan') };
      default:
        return { iconName: 'message', text: t('msg.message') };
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
      const toolName = msg.toolName || msg.name || (msg.content && msg.content.length < 80 ? msg.content : t('tool.unknown'));
      const toolIconName = msg.toolName?.includes('write') ? 'write'
        : msg.toolName?.includes('subagent') ? 'subagent'
        : msg.toolName?.includes('read') || msg.toolName?.includes('cat') ? 'read'
        : msg.toolName?.includes('shell') || msg.toolName?.includes('exec') || msg.toolName?.includes('bash') ? 'shell'
        : msg.toolName?.includes('search') || msg.toolName?.includes('find') || msg.toolName?.includes('glob') ? 'search'
        : msg.toolName?.includes('ask_human') || msg.toolName?.includes('human') ? 'user'
        : msg.toolName?.includes('file') ? 'preview'
        : 'tool';

      let args = null;
      if (msg.args && typeof msg.args === 'object' && Object.keys(msg.args).length > 0) {
        args = msg.args;
      } else if (msg.content && msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object') {args = parsed;}
        } catch (e) {}
      }

      return (
        <div style={styles.actionCard}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxTool }}>
              <Icon name={toolIconName} size={16} />
            </div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>{toolName}</div>
              <div style={styles.actionSubtitle}>
                {toolName.includes('subagent') ? t('tool.subagent_task') : t('tool.execute')}
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

      const summary = msg.content ?? msg.message ?? msg.result ?? msg.payload ?? t('tool.success');
      const displayText = safeStringify(summary, t('tool.success'));
      const hasContent = Boolean(displayText.trim());

      return (
        <div style={{ ...styles.actionCard, borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--ds-status-success-s2)' }}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxResult }}>
              <Icon name="success" size={16} />
            </div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>{t('tool.success')}</div>
              <div style={styles.actionSubtitle}>{msg.toolName || t('tool.result')}</div>
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
      const errorMsg = msg.content ?? msg.message ?? msg.error ?? msg.payload ?? t('tool.failed');
      const displayMsg = safeStringify(errorMsg, t('tool.failed'));

      return (
        <div style={{ ...styles.actionCard, borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--ds-status-error-s2)' }}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxError }}>
              <Icon name="error" size={16} />
            </div>
            <div style={styles.actionTitleWrap}>
              <div style={{ ...styles.actionName, color: 'var(--ds-status-error)' }}>
                {msg.event === 'tool:error' ? t('tool.error') : t('msg.error')}
              </div>
              <div style={styles.actionSubtitle}>{t('msg.hand_to_agent_hint')}</div>
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
                color: 'var(--ds-status-error)'
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
      if (!content) {return null;}

      return (
        <div style={styles.thinkingCard}>
          <div style={styles.thinkingCardHeader}>
            <span>💭</span>
            <span>{t('msg.thinking_in_progress')}</span>
          </div>
          {!isCollapsed && (
            <div style={{ fontSize: '13px', color: 'var(--ds-text-tertiary)', lineHeight: 1.7 }}>
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
            <span>{content ? t('status.generating') : t('status.organizing')}</span>
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
      const snapshots = Array.isArray(msg.planSnapshots) && msg.planSnapshots.length > 0
        ? msg.planSnapshots
        : [{
            content: msg.content,
            timestamp: msg.timestamp,
            plan: msg.plan || {},
            planTasks: Array.isArray(msg.planTasks) ? msg.planTasks : [],
            planProgress: msg.planProgress || {},
            planSummary: msg.planSummary || '',
            planUpdate: msg.planUpdate || null,
            toolName: msg.toolName,
          }];
      const latestFrameIndex = Math.max(0, snapshots.length - 1);
      const selectedFrameIndex = Math.min(
        latestFrameIndex,
        Math.max(0, planFrameSelections[msgId] ?? latestFrameIndex),
      );
      const frame = snapshots[selectedFrameIndex] || snapshots[latestFrameIndex] || {};
      const isLatestFrame = selectedFrameIndex === latestFrameIndex;
      const tasks = Array.isArray(frame.planTasks) ? frame.planTasks : [];
      const progress = frame.planProgress || {};
      const plan = frame.plan || {};
      const strategy = plan.strategy || plan.context?.strategy || {};
      const title = frame.content || msg.content || t('plan.title');
      const modeLabel = getPlanModeLabel(plan);
      const shapeLabel = getPlanShapeLabel(plan, tasks);
      const decomposition = String(strategy.decomposition || plan?.context?.decomposition || '').toLowerCase();
      const architectureId = strategy.planningArchitecture || strategy.architecture;
      const architecture = strategy.planningArchitectureLabel || PLAN_ARCHITECTURE_LABELS[architectureId] || formatPlanStrategyValue(architectureId);
      const strategyFacts = [
        [t('plan.strategy.mode'), architecture],
        [t('plan.strategy.verification'), formatPlanStrategyValue(strategy.verificationStrength)],
        [t('plan.strategy.parallel'), formatPlanStrategyValue(strategy.parallelPotential)],
        [t('plan.strategy.phase'), strategy.phaseCount ? `${strategy.phaseCount} ${t('plan.strategy.units')}` : null],
      ].filter(([, value]) => value);
      const phaseGroups = groupPlanTasksByPhase(tasks);
      const statusTone = progress.failed > 0 ? 'var(--ds-status-error)'
        : progress.needsRepair > 0 ? 'var(--ds-status-warning)'
        : progress.completed === progress.total && progress.total > 0 ? 'var(--ds-status-success)'
        : 'var(--ds-status-warning)';

      const taskLabel = (task) => task.name || task.id || 'Task';
      const taskStatus = (task) => String(task.displayStatus || task.status || 'pending').toLowerCase();
      const taskStatusText = (statusValue) => {
        switch (statusValue) {
          case 'completed': return t('plan.status.completed');
          case 'running': return t('plan.status.running');
          case 'needs_repair': return t('plan.status.needs_repair');
          case 'failed': return t('plan.status.failed');
          case 'blocked': return t('plan.status.waiting');
          default: return t('plan.status.pending');
        }
      };

      /* 轨道 dot 样式映射 */
      const dotStyleFor = (statusValue) => ({
        ...styles.planTimelineDot,
        ...(statusValue === 'completed' ? styles.planTimelineDotDone : {}),
        ...(statusValue === 'running' ? styles.planTimelineDotRunning : {}),
        ...(statusValue === 'needs_repair' ? styles.planTimelineDotRepair : {}),
        ...(statusValue === 'failed' ? styles.planTimelineDotFailed : {}),
      });

      /* tag 状态映射 */
      const tagStyleFor = (tone) => {
        if (tone === 'var(--ds-status-success)' || tone === 'success') return styles.planTagSuccess;
        if (tone === 'var(--ds-status-error)' || tone === 'error') return styles.planTagDanger;
        if (tone === 'var(--ds-status-warning)' || tone === 'warning') return styles.planTagWarning;
        return styles.planTag;
      };

      /* 摘要指标 */
      const summaryItems = [
        { label: t('plan.status.completed'), value: `${progress.completed || 0}/${progress.total || tasks.length}` },
        { label: t('plan.strategy.mode'), value: architecture || modeLabel },
        ...(decomposition ? [{ label: '分解方式', value: decomposition === 'llm' ? t('plan.decomposition_llm') : t('plan.decomposition_template') }] : []),
        { label: '进度', value: `${progress.progress ?? 0}%` },
      ];

      return (
        <div style={styles.planCard}>
          {/* ── Section 01: 概览 ── */}
          <div style={styles.planCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.planIconBox }}>
              <Icon name="plan" size={16} />
            </div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>{title}</div>
              <div style={styles.actionSubtitle}>
                {modeLabel} · {architecture || shapeLabel}
                {msg.toolName ? ` · 由 ${msg.toolName} 推进` : ''}
              </div>
            </div>
            <span style={{ ...styles.planProgressBadge, color: statusTone }}>
              {progress.progress ?? 0}%
            </span>
          </div>

          {/* 摘要指标网格 — 替代旧的 pill 横排 */}
          <div style={styles.planSummaryGrid}>
            {summaryItems.map((item) => (
              <div key={item.label} style={styles.planSummaryCard}>
                <span style={styles.planSummaryLabel}>{item.label}</span>
                <span style={styles.planSummaryValue}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* 状态 tags — 动态重规划 / 运行中 / 需修复 */}
          {((frame.planUpdate || strategy.dynamicReplanning) || progress.running > 0 || progress.needsRepair > 0) && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
              {(frame.planUpdate || strategy.dynamicReplanning) && <span style={{ ...styles.planTag, ...styles.planTagBrand }}>{t('plan.dynamic_replanning')}</span>}
              {progress.running > 0 && <span style={styles.planTag}>{t('plan.running_count', { count: progress.running })}</span>}
              {progress.needsRepair > 0 && <span style={{ ...styles.planTag, ...styles.planTagWarning }}>{t('plan.needs_repair_count', { count: progress.needsRepair })}</span>}
            </div>
          )}

          {/* 快照时间线 — 隐藏 slider，保留动态刷新指示器 */}
          {snapshots.length > 1 && (
            <div style={{
              ...styles.planTimelineControl,
              padding: '4px var(--spacing-sm)',
            }}>
              <div style={styles.planTimelineMeta}>
                <span>
                  进度帧 {selectedFrameIndex + 1}/{snapshots.length}
                  {isLatestFrame ? ' · 最新' : ' · 历史'}
                </span>
                <span>{frame.timestamp ? new Date(frame.timestamp).toLocaleTimeString() : ''}</span>
              </div>
            </div>
          )}

          {/* 进度条 */}
          <div style={styles.planProgressTrack}>
            <div
              style={{
                ...styles.planProgressFill,
                width: `${Math.max(4, progress.progress || 0)}%`,
                backgroundColor: statusTone,
              }}
            />
          </div>

          {/* ── Section 02: 策略（展开时显示） ── */}
          {!isCollapsed && strategyFacts.length > 0 && (
            <div style={styles.planStrategyGrid}>
              {strategyFacts.map(([label, value]) => (
                <div key={label} style={styles.planStrategyItem}>
                  <span style={styles.planStrategyLabel}>{label}</span>
                  <span style={styles.planStrategyValue}>{value}</span>
                </div>
              ))}
              {strategy.recommendedReview ? (
                <div style={styles.planStrategyItemWide}>
                  <span style={styles.planStrategyLabel}>推荐方法论</span>
                  <span style={styles.planStrategyValue}>{strategy.recommendedReview}</span>
                </div>
              ) : null}
              {strategy.architectureDescription ? (
                <div style={styles.planStrategyItemWide}>
                  <span style={styles.planStrategyLabel}>模式说明</span>
                  <span style={styles.planStrategyValue}>{strategy.architectureDescription}</span>
                </div>
              ) : null}
              {strategy.intent ? (
                <div style={styles.planStrategyItemWide}>
                  <span style={styles.planStrategyLabel}>策略意图</span>
                  <span style={styles.planStrategyValue}>{strategy.intent}</span>
                </div>
              ) : null}
            </div>
          )}

          {/* ── Section 03: 任务时间线（展开时显示） ── */}
          {!isCollapsed && phaseGroups.length > 0 && (
            <div style={styles.planTaskList}>
              {phaseGroups.map(([phase, phaseTasks], phaseIdx) => (
                <div key={phase} style={{
                  ...styles.planPhaseGroup,
                  ...(phaseIdx === 0 ? styles.planPhaseGroupFirst : {}),
                }}>
                  <div style={styles.planPhaseHeader}>
                    <span>{getPlanPhaseLabel(phase) || phase}</span>
                    <span style={{ ...styles.planTag, ...(phaseTasks.filter((t) => taskStatus(t) === 'completed').length === phaseTasks.length ? styles.planTagSuccess : {}) }}>
                      {phaseTasks.filter((t) => taskStatus(t) === 'completed').length}/{phaseTasks.length}
                    </span>
                  </div>
                  {phaseTasks.map((task, taskIndex) => {
                    const statusValue = taskStatus(task);
                    const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
                    const isLast = taskIndex === phaseTasks.length - 1;
                    return (
                      <div key={task.id || `${phase}-${taskIndex}`} style={styles.planTimelineRow}>
                        {/* 轨道 */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                          <span style={dotStyleFor(statusValue)} />
                          {!isLast && <div style={styles.planTimelineLine} />}
                        </div>
                        {/* 内容 */}
                        <div style={styles.planTaskContent}>
                          <span style={styles.planTaskName} title={task.description || taskLabel(task)}>
                            {taskLabel(task)}
                            {task.cycleLabel ? <span style={styles.planTaskDependency}> · {task.cycleLabel}</span> : ''}
                            {dependencies.length > 0 ? <span style={styles.planTaskDependency}>依赖 {dependencies.length}</span> : null}
                          </span>
                          <span style={{
                            ...styles.planTaskStatus,
                            ...(statusValue === 'completed' ? { color: 'var(--ds-status-success)' } : {}),
                            ...(statusValue === 'running' ? { color: 'var(--ds-status-warning)' } : {}),
                            ...(statusValue === 'failed' ? { color: 'var(--ds-status-error)' } : {}),
                            ...(statusValue === 'needs_repair' ? { color: 'var(--ds-status-warning)' } : {}),
                          }}>
                            {taskStatusText(statusValue)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {!isCollapsed && phaseGroups.length === 0 && tasks.length > 0 && (
            <div style={styles.planTaskList}>
              {tasks.map((task, taskIndex) => {
                const statusValue = taskStatus(task);
                const isLast = taskIndex === tasks.length - 1;
                return (
                  <div key={task.id || taskIndex} style={styles.planTimelineRow}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                      <span style={dotStyleFor(statusValue)} />
                      {!isLast && <div style={styles.planTimelineLine} />}
                    </div>
                    <div style={styles.planTaskContent}>
                      <span style={styles.planTaskName}>
                        {taskLabel(task)}
                        {task.cycleLabel ? <span style={styles.planTaskDependency}> · {task.cycleLabel}</span> : ''}
                      </span>
                      <span style={{
                        ...styles.planTaskStatus,
                        ...(statusValue === 'completed' ? { color: 'var(--ds-status-success)' } : {}),
                        ...(statusValue === 'running' ? { color: 'var(--ds-status-warning)' } : {}),
                        ...(statusValue === 'failed' ? { color: 'var(--ds-status-error)' } : {}),
                      }}>
                        {taskStatusText(statusValue)}
                      </span>
                    </div>
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
            <span style={{ color: 'var(--ds-text-secondary)', fontSize: '12px' }}>
              {preview}{preview.length >= 60 ? '…' : ''}
            </span>
          </div>
        );
      }

      if (msg.type === 'tool') {return renderToolCard();}
      if (isAssistantMarkdownMessage && !isStreaming) {return renderAssistantBubble();}
      if (msg.type === 'error') {return renderErrorCard();}
      if (msg.type === 'thinking') {return renderThinkingCard();}
      if (msg.type === 'plan') {
        const planProgress = msg.planSnapshots?.length > 0
          ? msg.planSnapshots[msg.planSnapshots.length - 1]?.planProgress
          : msg.planProgress;
        const pct = planProgress?.progress ?? 0;
        return (
          <div style={styles.planInlineIndicator}>
            <Icon name="plan" size={12} />
            <span>{t('plan.title')}</span>
            <span style={{ margin: '0 2px', opacity: 0.6 }}>·</span>
            <span>{pct}%</span>
          </div>
        );
      }
      // streaming card：只有在没有 plan 的任务中立即显示，或者有 plan 但 plan 已经出现后才显示
      if (isStreaming && (!hasPlanInTask || planHasAppeared)) {return renderStreamingCard();}

      const content = getMessageDisplayText(msg);
      if (!content) {
        return null;
      }
      return (
        <div style={{
          ...styles.enhancedMessageBubble,
          ...(isUser ? styles.enhancedMessageBubbleUser : styles.enhancedMessageBubbleAgent)
        }}>
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
            backgroundColor: getTypeStyle(msg.type).border?.split(' ')[1] || 'var(--ds-brand)'
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
            <Icon name={typeDisplay.iconName} size={14} style={{ marginRight: '4px' }} />
            <span>{typeDisplay.text}</span>
          </span>
          
          <div style={styles.messageTime}>
            <span>
              {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
            </span>
            <span style={{ fontSize: '10px', cursor: 'pointer' }}>
              {isCollapsed ? t('plan.expand') : t('plan.collapse')}
            </span>
          </div>
        </div>
        
        {/* 渲染消息主体 */}
        {renderBody()}

        {/* 对于事件类型，在消息流中显示简要负载，方便直接查看 */}
        {!isCollapsed && msg.type === 'event' && msg.payloadSummary && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--ds-text-secondary)' }}>
            <div style={{ marginBottom: '6px', color: 'var(--ds-text-secondary)' }}>{t('msg.payload')}</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--ds-text-primary)', backgroundColor: 'transparent', borderRadius: '4px' }}>{msg.payloadSummary}</pre>
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
              <div style={{ fontSize: '12px', color: 'var(--ds-text-secondary)', marginBottom: '6px' }}>{t('msg.payload')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--ds-text-primary)', backgroundColor: 'transparent', borderRadius: '4px' }}>{safeStringify(msg.payload)}</pre>
            </div>
          )}
          {msg.raw && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--ds-text-secondary)', marginBottom: '6px' }}>{t('msg.raw_data')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', color: 'var(--ds-text-primary)', backgroundColor: 'transparent', borderRadius: '4px' }}>{safeStringify(msg.raw)}</pre>
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
            color: 'var(--ds-text-secondary)',
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
                  if (!searchQuery) {setSearchExpanded(false);}
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
                color: 'var(--ds-status-warning)',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: 'var(--ds-status-warning)',
                fontWeight: '500',
              } : {})
            }}
            onClick={handleAutoScrollChange}
            title={autoScroll ? t('status.follow_new') : t('status.locked')}
          >
            <Icon name={autoScroll ? 'pin' : 'lock'} size={14} />
            {autoScroll ? t('status.follow') : t('status.locked_position')}
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
