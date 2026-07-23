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

/* ── Inline SVG Icons (replaces emoji) ───────────────────── */

const MsgIcons = {
  check: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.7117 2.90824C13.9472 2.656 14.3432 2.64248 14.5955 2.87797C14.8477 3.1135 14.8612 3.50945 14.6257 3.76176L6.38551 12.5909C6.06158 12.9379 5.51701 12.9556 5.17067 12.6309L1.74098 9.41606C1.48925 9.17996 1.47661 8.78405 1.71266 8.53227C1.94875 8.28054 2.34466 8.2679 2.59645 8.50395L5.73903 11.4502L13.7117 2.90824Z" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.0415 8.53288C10.0415 7.96275 10.0408 7.57225 10.0161 7.27019C9.99201 6.97565 9.94869 6.81974 9.89209 6.70866C9.76027 6.45 9.54919 6.23987 9.29053 6.10808C9.17939 6.05151 9.02362 6.00715 8.729 5.98308C8.42689 5.95841 8.03654 5.95866 7.46631 5.95866H5.8667C5.29648 5.95866 4.90612 5.95841 4.604 5.98308C4.30934 6.00715 4.15358 6.05151 4.04248 6.10808C3.78381 6.23987 3.57275 6.45001 3.44092 6.70866C3.38432 6.81975 3.34099 6.97565 3.3169 7.27019C3.29222 7.57225 3.2915 7.96275 3.2915 8.53288V10.1335C3.2915 10.7038 3.29221 11.094 3.3169 11.3962C3.34098 11.6908 3.38433 11.8466 3.44092 11.9577C3.57274 12.2164 3.78375 12.4265 4.04248 12.5583C4.15359 12.6149 4.30922 12.6592 4.604 12.6833C4.90612 12.7079 5.29646 12.7087 5.8667 12.7087H7.46631C8.03656 12.7087 8.42689 12.7079 8.729 12.6833C9.02374 12.6592 9.17938 12.6149 9.29053 12.5583C9.54924 12.4265 9.76028 12.2164 9.89209 11.9577C9.94868 11.8466 9.99203 11.6908 10.0161 11.3962C10.0408 11.094 10.0415 10.7038 10.0415 10.1335V8.53288Z" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.3958 8.125C13.3958 5.15647 10.9893 2.75 8.02075 2.75C5.05222 2.75 2.64575 5.15647 2.64575 8.125C2.64575 11.0936 5.05222 13.5 8.02075 13.5C10.9893 13.5 13.3958 11.0936 13.3958 8.125ZM7.39575 10.792V8.08301H7.35376C7.00873 8.08283 6.72876 7.80308 6.72876 7.45801C6.72894 7.11309 7.00884 6.83318 7.35376 6.83301H8.02075C8.36582 6.83301 8.64558 7.11298 8.64575 7.45801V10.792C8.64558 11.137 8.36582 11.417 8.02075 11.417C7.67568 11.417 7.39593 11.137 7.39575 10.792Z" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevronRight: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.33398 2.04199C10.2562 2.0423 12.625 4.41167 12.625 7.33398C12.6248 8.5697 12.1992 9.70502 11.4893 10.6055L13.7754 12.8916C14.0192 13.1357 14.0193 13.5314 13.7754 13.7754C13.5314 14.0194 13.1357 14.0192 12.8916 13.7754L10.6045 11.4893C9.70413 12.1989 8.56941 12.6249 7.33398 12.625C4.4117 12.625 2.04235 10.2562 2.04199 7.33398C2.04199 4.41148 4.41148 2.04199 7.33398 2.04199Z" />
    </svg>
  ),
  folder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.375 10.6667V4.66666C1.375 3.21691 2.55026 2.04166 4 2.04166H5.95312C6.60779 2.04167 7.21883 2.36904 7.58203 2.91373L8.12402 3.72623L8.17773 3.79654C8.31129 3.95108 8.50671 4.04166 8.71387 4.04166H12C13.4498 4.04166 14.625 5.21692 14.625 6.66666V10.6667C14.625 12.1164 13.4498 13.2917 12 13.2917H4C2.55026 13.2917 1.375 12.1164 1.375 10.6667Z" />
    </svg>
  ),
  brain: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2.5C5.51472 2.5 3.5 4.51472 3.5 7C3.5 7.88564 3.74512 8.71387 4.16602 9.41602L3.91699 11.083L5.58496 10.834C6.28711 11.2549 7.11436 11.5 8 11.5C10.4853 11.5 12.5 9.48528 12.5 7C12.5 4.51472 10.4853 2.5 8 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 5.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6.5 7H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.8906 3.55786C11.871 2.57751 13.4609 2.5777 14.4414 3.55786C15.4219 4.53832 15.4219 6.12816 14.4414 7.10864L9.02734 12.5227C8.53509 13.0149 7.86701 13.2913 7.1709 13.2913H5.33301C4.98794 13.2911 4.70801 13.0114 4.70801 12.6663V10.8284C4.70805 10.1322 4.98439 9.46415 5.47656 8.97192L10.8906 3.55786Z" />
    </svg>
  ),
};
import {
  buildThinkingSummary,
  buildRuntimeDetailsExportData,
  isPrimaryMessage,
  isRuntimeDetailMessage,
} from '../runtime/runtime-details.js';
import {
  buildMessageDisplayGraph,
  computeNextCollapsedGroups,
  computeNextCollapsedMessages,
  createCompletedCollapseSignature,
} from '../runtime/message-graph.js';
import { getMessageDisplayText, getMessageSerializableText, getStableMessageId, safeStringify } from './message-log/utils/message-utils.js';
import { createCollapsedContentPreview } from '../app/content/content-pipeline.js';
import {
  PLAN_ARCHITECTURE_LABELS,
  PLAN_PHASE_LABELS,
  formatPlanStrategyValue,
  getPlanModeLabel,
  getPlanPhaseLabel,
  getPlanShapeLabel,
  groupPlanTasksByPhase,
} from './message-log/utils/plan-display.js';

import { buildMessageTree, flattenTree } from '../hooks/useRuntime.js';
// 样式定义
/**
 * 消息日志组件
 * @param {Object} props - 组件属性
 * @param {Array} props.messages - 消息列表
 * @param {string} props.status - 当前状态
 * @param {Function} props.onClear - 清空消息回调
 * @param {Function} props.onAskAgent - 将错误消息交给 Agent 处理
 */
function MessageLog({ messages, status, workingDirectory, fileServerUrl, onClear, onAskAgent, onStarterPrompt, starterPromptsEnabled = true }) {
  const ipc = useIPC();

  // Tree utilities available but rendering integration deferred

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

  // ReactMarkdown 只负责输出语义结构；视觉规则统一由 index.css 管理。
  const markdownComponents = useMemo(() => ({
    img: ({ node: _node, src, alt, ...rest }) => (
      <img
        src={src}
        alt={alt || ''}
        referrerPolicy="no-referrer"
        {...rest}
      />
    ),
    table: ({ node: _node, children, ...rest }) => (
      <div
        className="markdown-table-scroll"
        role="region"
        aria-label="Scrollable content table"
        tabIndex={0}
      >
        <table {...rest}>{children}</table>
      </div>
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
  // 消息组折叠状态 — 同一阶段的工具/事件/思维过程折叠在组内
  const [groupCollapsed, setGroupCollapsed] = useState(() => new Set());
  
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

  // 跟踪用户手动展开的消息，避免自动折叠覆盖用户操作
  const userUncollapsedRef = useRef(new Set());
  const userExpandedGroupsRef = useRef(new Set());
  const userCollapsedGroupsRef = useRef(new Set());

  // 跟踪上一次的可折叠完成消息集合，避免运行中消息刷新触发旧消息折叠
  const prevCompletedCollapseSignatureRef = useRef('');

  // 自动折叠逻辑：所有 assistant 消息默认折叠，最后一条总结消息展开
  useEffect(() => {
    const getCollapseMessageId = (message, index) => getStableMessageId(message, `${index}`);
    const completedSignature = createCompletedCollapseSignature(filteredMessages, getCollapseMessageId);
    if (completedSignature === prevCompletedCollapseSignatureRef.current) {
      return;
    }
    prevCompletedCollapseSignatureRef.current = completedSignature;

    setCollapsedMessages(previousCollapsed => computeNextCollapsedMessages({
      messages: filteredMessages,
      previousCollapsed,
      userExpandedMessageIds: userUncollapsedRef.current,
      getMessageId: getCollapseMessageId,
    }));
  }, [filteredMessages]);

  const runtimeDetailMessages = useMemo(() => (
    messages.filter(msg => isRuntimeDetailMessage(msg) && messageMatchesSearch(msg))
  ), [messages, searchQuery]);
  const primaryMessages = useMemo(() => (
    filteredMessages.filter(isPrimaryMessage)
  ), [filteredMessages]);

  const conversationGroups = useMemo(() => (
    buildMessageDisplayGraph(messages).filter((group) => (
      group.messages.some((message) => (
        messageMatchesFilter(message) && messageMatchesSearch(message)
      ))
    ))
  ), [messages, filter, searchQuery]);

  useEffect(() => {
    for (const group of conversationGroups) {
      if (group.runtimeDetails.length === 0) {
        continue;
      }
      const panelRef = runtimeDetailsRefs.current.get(group.id);
      if (panelRef && isNearBottom(panelRef)) {
        panelRef.scrollTop = panelRef.scrollHeight;
      }
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

  // 自动折叠旧的已完成消息组，只保留当前上下文展开；用户手动展开过的组不再自动折回
  useEffect(() => {
    setGroupCollapsed(previousCollapsed => computeNextCollapsedGroups({
      groups: conversationGroups,
      previousCollapsed,
      userExpandedGroupIds: userExpandedGroupsRef.current,
      userCollapsedGroupIds: userCollapsedGroupsRef.current,
    }));
  }, [conversationGroups]);


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
    setGroupCollapsed(new Set());
    userUncollapsedRef.current = new Set();
    userExpandedGroupsRef.current = new Set();
    userCollapsedGroupsRef.current = new Set();
    prevCompletedCollapseSignatureRef.current = '';
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
  // 处理消息组折叠/展开
  const handleGroupCollapseToggle = useCallback((groupId) => {
    setGroupCollapsed(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
        userExpandedGroupsRef.current.add(groupId);
        userCollapsedGroupsRef.current.delete(groupId);
      } else {
        newSet.add(groupId);
        userExpandedGroupsRef.current.delete(groupId);
        userCollapsedGroupsRef.current.add(groupId);
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
      const visibleContent = isCollapsed
        ? createCollapsedContentPreview(content)
        : content;

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
              text={visibleContent}
              isCollapsed={isCollapsed}
              isStreaming={streaming}
              workingDirectory={workingDirectory}
              fileServerUrl={fileServerUrl}
              markdownComponents={markdownComponents}
              onLinkClick={handleMessageContainerClick}
            />
          ) : (
            <div style={styles.emptyAssistantMessage}>
            <span style={styles.emptyAssistantPulse} />
            <span style={{ color: 'var(--ds-text-tertiary)', fontSize: '11px' }}>暂无回复内容</span>
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

      const isWaiting = !msg.toolResult && !msg.isError;
      const hasResult = msg.result != null || Boolean(msg.content);
      const hasError = msg.isError || msg.type === 'error';
      const borderColor = hasError
        ? 'var(--ds-status-error-s2)'
        : isWaiting
          ? 'var(--message-tool-border)'
          : 'var(--ds-status-success-s2)';

      let args = null;
      if (msg.args && typeof msg.args === 'object' && Object.keys(msg.args).length > 0) {
        args = msg.args;
      } else if (msg.content && msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object') {args = parsed;}
        } catch (e) {}
      }

      const rawResult = msg.result ?? msg.content ?? '';
      const resultText = typeof rawResult === 'string' ? rawResult : safeStringify(rawResult);
      const progress = Number.isFinite(Number(msg.progress)) ? Math.max(0, Math.min(100, Number(msg.progress))) : null;
      const argumentSummary = args
        ? args.command || args.path || args.file || args.query || args.pattern || args.url
        : '';

      return (
        <div style={{ ...styles.actionCard, borderColor }}>
          <div style={styles.actionCardHeader}>
            <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxTool }}>
              {isWaiting ? (
                <span style={styles.actionLoader} />
              ) : hasError ? (
                <Icon name="error" size={16} />
              ) : (
                <Icon name={toolIconName} size={16} />
              )}
            </div>
            <div style={styles.actionTitleWrap}>
              <div style={styles.actionName}>{toolName}</div>
              <div style={styles.actionSubtitle}>
                {isWaiting
                  ? (msg.progressText || argumentSummary || t('tool.executing'))
                  : hasError
                    ? t('tool.error_occurred')
                    : (msg.duration != null ? `${msg.duration}ms` : t('tool.completed'))}
              </div>
            </div>
            {msg.duration && !isWaiting && (
              <span style={styles.actionDurationBadge}>{msg.duration}ms</span>
            )}
            {msg.exitCode != null && !isWaiting && (
              <span style={{
                ...styles.actionExitCode,
                color: msg.exitCode === 0 ? 'var(--ds-status-success)' : 'var(--ds-status-error)',
              }}>
                {t('tool.exit_code', { code: msg.exitCode })}
              </span>
            )}
          </div>

          {isWaiting && progress != null && (
            <div
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={progress}
              style={{ height: '3px', background: 'var(--border-subtle)', overflow: 'hidden' }}
            >
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--primary-color)', transition: 'width 160ms ease' }} />
            </div>
          )}

          {/* 工具参数 */}
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

          {/* 加载动画（等待中） */}
          {isWaiting && progress == null && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              padding: '12px',
            }}>
              <span style={styles.actionLoader} />
              <span style={{ fontSize: '10px', color: 'var(--ds-text-tertiary)', fontWeight: 500 }}>{t('tool.executing')}</span>
            </div>
          )}

          {/* 结果内容 */}
          {hasResult && !hasError && !isCollapsed && (
            <div style={{
              ...styles.actionResultSummary,
              borderColor: hasError ? 'var(--ds-status-error-s2)' : 'var(--message-result-border)',
            }}>
              <MarkdownMessageContent
                text={resultText.length > 2000 ? resultText.slice(0, 2000) + '…' : resultText}
                isCollapsed={isCollapsed}
                workingDirectory={workingDirectory}
                fileServerUrl={fileServerUrl}
                markdownComponents={markdownComponents}
                onLinkClick={handleMessageContainerClick}
              />
            </div>
          )}

          {/* 错误详情 */}
          {hasError && !isCollapsed && (
            <div style={styles.actionErrorBody}>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                fontSize: '11px',
                lineHeight: 1.5,
                color: 'var(--ds-status-error)'
              }}>
                {(msg.error || msg.result || msg.content || '').length > 500
                  ? (msg.error || msg.result || msg.content || '').slice(0, 500) + '…'
                  : msg.error || msg.result || msg.content || ''}
              </pre>
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
        <div style={{ ...styles.actionCard, borderColor: 'var(--ds-status-success-s2)' }}>
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
        <div style={{ ...styles.actionCard, borderColor: 'var(--ds-status-error-s2)' }}>
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
            <span style={{ width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{MsgIcons.brain}</span>
            <span>{t('msg.thinking_in_progress')}</span>
          </div>
          {!isCollapsed && (
            <div style={{ fontSize: '12px', color: 'var(--ds-text-tertiary)', lineHeight: 1.5 }}>
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
          ) : null}
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
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--ds-bg-overlay-l1)',
            maxWidth: '88%',
          }}>
            <span style={{ color: 'var(--ds-text-tertiary)', fontSize: '11px', lineHeight: '18px' }}>
              {preview}{preview.length >= 60 ? '…' : ''}
            </span>
          </div>
        );
      }

      if (msg.type === 'tool') {return renderToolCard();}
      if (msg.type === 'tool_result') {
        // 这里的 tool_result 是兜底消息（没有匹配的 tool:call）
        // 渲染为简洁的结果卡片
        return (
          <div style={{ ...styles.actionCard, borderColor: 'var(--ds-status-success-s2)' }}>
            <div style={styles.actionCardHeader}>
              <div style={{ ...styles.actionIconBox, ...styles.actionIconBoxResult }}>
                <Icon name="success" size={16} />
              </div>
              <div style={styles.actionTitleWrap}>
                <div style={styles.actionName}>{msg.toolName || t('tool.result')}</div>
                <div style={styles.actionSubtitle}>{msg.duration ? `${msg.duration}ms` : t('tool.completed')}</div>
              </div>
            </div>
            {msg.result && !isCollapsed && (
              <div style={styles.actionResultSummary}>
                <MarkdownMessageContent
                  text={String(msg.result).slice(0, 1000)}
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
      }
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
          ...(isTimeline && isUser ? { marginRight: '16px' } : {}),
          // Tree structure indentation based on depth
          ...(msg.treeDepth > 0 ? { paddingLeft: `${Math.min(msg.treeDepth, 4) * 16}px` } : {}),
        }}
        onMouseEnter={() => handleMouseEnter(msgId)}
        onMouseLeave={handleMouseLeave}
      >
        {isTimeline && (
          <div style={{
            ...styles.timelineDot,
            top: '12px',
            backgroundColor: getTypeStyle(msg.type).border?.split(' ')[1] || 'var(--ds-brand)'
          }} />
        )}
        
        {/* 消息头部 - 轻量内联 */}
        <div 
          style={{
            ...styles.messageHeader,
            ...(isUser ? { flexDirection: 'row-reverse' } : {}),
            opacity: isSelected ? 1 : 0.6,
            transition: 'opacity 0.15s ease'
          }}
          onClick={() => handleToggleCollapse(msgId)}
        >
          <span style={getTypeStyle(msg.type)}>
            <Icon name={typeDisplay.iconName} size={12} style={{ marginRight: '3px' }} />
            <span>{typeDisplay.text}</span>
          </span>
          
          <div style={styles.messageTime}>
            <span>
              {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
            </span>
          </div>
        </div>
        
        {/* 渲染消息主体 */}
        {renderBody()}

        {/* 对于事件类型，在消息流中显示简要负载，方便直接查看 */}
        {!isCollapsed && msg.type === 'event' && msg.payloadSummary && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--ds-text-secondary)' }}>
            <div style={{ marginBottom: '2px', color: 'var(--ds-text-secondary)' }}>{t('msg.payload')}</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11px', color: 'var(--ds-text-primary)', backgroundColor: 'transparent', borderRadius: '4px' }}>{msg.payloadSummary}</pre>
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
          <span style={{ width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{MsgIcons.copy}</span>
          {t('msg.copy')}
        </button>
        
        <button
          style={styles.actionButton}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleDetails(msgId);
          }}
          title={t('msg.details')}
        >
          <span style={{ width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{MsgIcons.info}</span>
          {showDetail ? t('msg.hide_details') : t('msg.details')}
        </button>
        
        <button
          style={styles.actionButton}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleCollapse(msgId);
          }}
          title={t('msg.expand')}
        >
          <span style={{ width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {isCollapsed ? MsgIcons.chevronRight : MsgIcons.chevronDown}
          </span>
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
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '10px', color: 'var(--ds-text-tertiary)', marginBottom: '2px' }}>{t('msg.payload')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '10px', color: 'var(--ds-text-secondary)', backgroundColor: 'transparent', borderRadius: '4px' }}>{safeStringify(msg.payload)}</pre>
            </div>
          )}
          {msg.raw && (
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '10px', color: 'var(--ds-text-tertiary)', marginBottom: '2px' }}>{t('msg.raw_data')}</div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '10px', color: 'var(--ds-text-secondary)', backgroundColor: 'transparent', borderRadius: '4px' }}>{safeStringify(msg.raw)}</pre>
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
    const requestMessage = group.requestMessage || null;
    const responseMessages = group.responseMessages?.length
      ? group.responseMessages
      : group.primaryMessages?.filter((message) => message !== requestMessage) || [];
    const summaryMessage = group.responseMessage || requestMessage || group.primaryMessage;
    const isPinnedOpenTurn = group.status === 'running' || group.status === 'waiting';
    const isCollapsed = groupCollapsed.has(group.id) && !isPinnedOpenTurn;
    const detailCount = group.toolCollections?.length || group.runtimeDetails.length;
    const detailLabel = group.toolCollections?.length ? `${detailCount} 调用` : `${detailCount} 步`;
    const primaryText = getMessageDisplayText(summaryMessage || {});
    const preview = String(primaryText || '').replace(/\s+/g, ' ').slice(0, 80) || (detailCount > 0 ? '运行详情' : t('msg.no_content'));
    const statusLabel = {
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      stopped: '已停止',
      waiting: '等待输入',
    }[group.status];
    const typeDisplay = summaryMessage ? getTypeDisplay(summaryMessage.type) : { iconName: 'event', text: '运行' };
    const summaryLabel = statusLabel || group.primary?.phaseLabel || typeDisplay.text;

    return (
      <div key={group.id} style={{
        marginBottom: '6px',
      }}>
        {/* 组折叠/展开头部 */}
        <button
          type="button"
          onClick={() => {
            if (!isPinnedOpenTurn) {
              handleGroupCollapseToggle(group.id);
            }
          }}
          aria-expanded={!isCollapsed}
          aria-disabled={isPinnedOpenTurn}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '8px 10px',
            border: 'none',
            borderRadius: isCollapsed ? 'var(--radius-md)' : 'var(--radius-md) var(--radius-md) 0 0',
            backgroundColor: isCollapsed ? 'transparent' : 'var(--surface-card)',
            color: 'var(--text-color)',
            cursor: isPinnedOpenTurn ? 'default' : 'pointer',
            fontSize: '12px',
            textAlign: 'left',
            transition: 'background-color 0.12s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isCollapsed ? 'transparent' : 'var(--surface-card)'; }}
        >
          <span style={{
            width: '16px',
            height: '16px',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            transition: 'transform 0.15s ease',
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            opacity: isPinnedOpenTurn ? 0.45 : 1,
          }}>
            {MsgIcons.chevronDown}
          </span>
          <span style={{
            width: '16px',
            height: '16px',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
          }}>
            {MsgIcons.folder}
          </span>
          <span style={{
            fontWeight: 600,
            fontSize: '11px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            flexShrink: 0,
          }}>
            {summaryLabel}
          </span>
          {isCollapsed && (
            <span style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              opacity: 0.8,
            }}>
              {preview}
            </span>
          )}
          {detailCount > 0 && (
            <span style={{
              flexShrink: 0,
              padding: '1px 6px',
              borderRadius: '999px',
              backgroundColor: 'var(--primary-faint)',
              color: 'var(--primary-color)',
              fontSize: '10px',
              fontWeight: 600,
            }}>
              {detailLabel}
            </span>
          )}
        </button>

        {/* 展开后的内容 */}
        {!isCollapsed && (
          <div style={{
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {requestMessage && renderMessage(requestMessage, `${group.id}_request`)}
            {detailCount > 0 && renderRuntimeDetailsPanel(group, isActiveGroup)}
            {responseMessages.map((message, index) => (
              renderMessage(message, `${group.id}_response_${index}`)
            ))}
            {!requestMessage && responseMessages.length === 0 && group.primaryMessage && (
              renderMessage(group.primaryMessage, `${group.id}_primary`)
            )}
          </div>
        )}
      </div>
    );
  };
  
  // 渲染分组标题
  const renderGroupHeader = (title, count) => (
    <div style={styles.groupHeader}>
      <span style={{ ...styles.groupIcon, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px' }}>{MsgIcons.folder}</span>
      <span style={styles.groupTitle}>{title}</span>
      <span style={styles.groupCount}>{count} 条消息</span>
    </div>
  );
  
  // 渲染空状态
  if (messages.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyContainer}>
          <div style={styles.emptyIcon}>
            <span style={{ width: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ds-brand)' }}>{MsgIcons.brain}</span>
          </div>
          <div style={{ ...styles.emptyText, fontSize: '15px', fontWeight: 650 }}>从一个具体任务开始</div>
          <div style={styles.emptyHint}>
            描述你想查看、修改或验证的内容，Agent 会在当前工作区内完成它。
          </div>
          
          {/* 快捷提示 */}
          <div style={{
            marginTop: '24px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            justifyContent: 'center'
          }}>
            {[
              ['explain', '解释这个项目', '解释这个项目的架构、关键模块和运行流程'],
              ['fix', '修复一个问题', '检查当前项目，定位一个影响最大的实际问题并修复'],
              ['test', '运行并检查测试', '运行项目测试，分析失败原因并修复所有相关问题'],
            ].map(([id, label, prompt]) => (
              <button
                key={id}
                type="button"
                className="mastery-starter-action"
                style={styles.emptyChip}
                data-action-id={`composer.starter.${id}`}
                disabled={!starterPromptsEnabled}
                title={starterPromptsEnabled ? `填入“${label}”` : 'Agent Runtime 当前不可用'}
                onClick={() => onStarterPrompt?.(prompt)}
              >
                {label}
              </button>
            ))}
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
          <span>{t('msg.message_details')}</span>
          <span style={{
            fontSize: '10px',
            color: 'var(--ds-text-tertiary)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {filteredMessages.length}{filteredMessages.length !== messages.length ? `/${messages.length}` : ''}
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
            <option value="user">{t('msg.user')}</option>
            <option value="info">{t('msg.info')}</option>
            <option value="success">{t('msg.success')}</option>
            <option value="error">{t('msg.error')}</option>
            <option value="tool">{t('msg.tool')}</option>
            <option value="result">{t('msg.result')}</option>
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
            <div style={{ ...styles.emptyIcon, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{MsgIcons.search}</div>
            <div style={styles.emptyText}>{t('status.not_set')}</div>
            <div style={styles.emptyHint}>
              {t('msg.search_messages')}
            </div>
          </div>
        )}
      </div>
      
      {/* 复制成功提示 */}
      {copiedMessage && (
        <div style={{
          ...styles.copyToast,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{ width: '14px', height: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-on-success)' }}>{MsgIcons.check}</span>
          已复制到剪贴板
        </div>
      )}
      
    </div>
  );
}

export default MessageLog;
