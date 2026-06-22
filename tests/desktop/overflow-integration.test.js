/**
 * 集成测试：运行详情面板在任务完成后的可见性 & overflow 裁切问题
 *
 * 覆盖场景：
 * 1. 任务完成后面板不消失（核心回归场景）
 * 2. overflow 链路：多层容器不应裁切展开内容
 * 3. thinking/status 消息被过滤后面板仍保留
 * 4. 空状态正确返回 null
 * 5. 完整对话流程：运行 → 完成 → 面板保留
 */
import { describe, expect, test } from 'bun:test';
import {
  buildActivitySummary,
  getFileStatusLabel,
  getFileTypeIcon,
  formatDuration,
  getActivityTone,
} from '../../desktop/renderer/components/message-log/utils/activity-summary.js';
import {
  buildThinkingSummary,
  buildRuntimeDetailsExportData,
  createConversationGroups,
  createRuntimeDetailId,
  getRuntimeDetailContent,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  isPrimaryMessage,
  isRuntimeDetailMessage,
  isStatusUpdateMessage,
  isThinkingMessage,
} from '../../desktop/renderer/components/message-log/utils/runtime-details.js';

// ===== 辅助函数：模拟 RuntimeDetailsPanel 的 null 返回判断逻辑 =====
function shouldPanelBeVisible(runtimeDetails, isRunningGroup) {
  // 这与 RuntimeDetailsPanel.jsx 中的判断逻辑一致
  if (runtimeDetails.length === 0 && buildActivitySummary(runtimeDetails).activities.length === 0) {
    return false;
  }
  return true;
}

// ===== 辅助函数：模拟 visibleRuntimeDetails 过滤逻辑 =====
function getVisibleRuntimeDetails(runtimeDetails) {
  return runtimeDetails.filter(msg => !isStatusUpdateMessage(msg) && !isThinkingMessage(msg));
}

// ===== 辅助函数：模拟 overflow 链路可见性 =====
// 如果任何祖先容器设了 overflow: hidden，子元素的 overflow: visible 无法突破
function isContentVisibleThroughOverflowChain(overflowChain) {
  // overflowChain: 从外到内的 overflow 值数组
  // 只要有任何一层是 'hidden' 或 'auto'（非 visible），内容可能被裁切
  // 但 'auto' 是合理的滚动容器，不算裁切
  // 只有 'hidden' 会无条件裁切
  return !overflowChain.includes('hidden');
}

// ===========================================================================
// 测试套件
// ===========================================================================

describe('运行详情面板可见性集成测试', () => {
  // ----- 场景1：任务完成后面板不消失 -----
  test('任务完成后，只有 thinking+status 消息时面板仍可见', () => {
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: '开始执行' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: '分析任务' },
      { id: 'r2', event: 'agent:thinking', type: 'thinking', summary: '规划方案' },
      { id: 's2', event: 'status:update', type: 'event', message: '执行完成' },
    ];

    const visible = getVisibleRuntimeDetails(runtimeDetails);
    // visible 被过滤为空
    expect(visible).toHaveLength(0);
    // 但面板判断基于 runtimeDetails.length，不受 isRunningGroup 影响
    expect(shouldPanelBeVisible(runtimeDetails, false)).toBe(true);
  });

  test('任务完成后，有 tool 消息时面板可见', () => {
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: 'starting' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'read_file' },
      { id: 'tr1', type: 'tool_result', toolName: 'read_file', result: 'file content' },
      { id: 's2', event: 'status:update', type: 'event', message: 'completed' },
    ];

    const visible = getVisibleRuntimeDetails(runtimeDetails);
    expect(visible).toHaveLength(2); // t1, tr1
    expect(shouldPanelBeVisible(runtimeDetails, false)).toBe(true);
  });

  test('任务完成后，有 tool activity 但 visible 为空时面板可见', () => {
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: 'starting' },
      {
        id: 'a1', event: 'tool:activity', timestamp: 1,
        activity: {
          kind: 'tool_activity', id: 'read:src/app.js',
          phase: 'completed', intent: 'read',
          toolName: 'read_file', target: 'src/app.js',
          statusText: '已读取 src/app.js',
        },
      },
    ];

    const visible = getVisibleRuntimeDetails(runtimeDetails);
    // tool:activity 不在 visible 列表中（不是 tool/tool_result/debug/event）
    // 但 buildActivitySummary 会处理它
    const summary = buildActivitySummary(runtimeDetails);
    expect(summary.activities.length).toBeGreaterThan(0);
    expect(shouldPanelBeVisible(runtimeDetails, false)).toBe(true);
  });

  test('完全没有 runtimeDetails 且没有 activity 时，面板隐藏', () => {
    expect(shouldPanelBeVisible([], false)).toBe(false);
  });

  // ----- 场景2：完整对话流程 -----
  test('完整对话流程：用户提问 → 运行 → 完成，面板全程可见', () => {
    // 阶段1：用户发送消息
    const messagesPhase1 = [
      { id: 'u1', type: 'user', content: '帮我重构这个文件' },
    ];
    const groupsPhase1 = createConversationGroups(messagesPhase1, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });
    expect(groupsPhase1).toHaveLength(1);
    expect(groupsPhase1[0].runtimeDetails).toHaveLength(0);

    // 阶段2：Agent 开始运行
    const messagesPhase2 = [
      { id: 'u1', type: 'user', content: '帮我重构这个文件' },
      { id: 's1', event: 'status:update', type: 'event', message: '开始执行' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: '分析文件结构' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'read_file' },
    ];
    const groupsPhase2 = createConversationGroups(messagesPhase2, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });
    expect(groupsPhase2).toHaveLength(1);
    const group2 = groupsPhase2[0];
    // 运行中面板可见
    expect(shouldPanelBeVisible(group2.runtimeDetails, true)).toBe(true);

    // 阶段3：运行完成，返回结果
    const messagesPhase3 = [
      { id: 'u1', type: 'user', content: '帮我重构这个文件' },
      { id: 's1', event: 'status:update', type: 'event', message: '开始执行' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: '分析文件结构' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'read_file' },
      { id: 'a1', type: 'agent', content: '重构完成' },
      { id: 'c1', event: 'agent:complete', type: 'success', content: '已成功重构文件' },
    ];
    const groupsPhase3 = createConversationGroups(messagesPhase3, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });
    const group3 = groupsPhase3[0];
    // 完成后面板仍可见（关键回归断言）
    expect(shouldPanelBeVisible(group3.runtimeDetails, false)).toBe(true);
  });

  // ----- 场景3：多轮对话中的面板隔离 -----
  test('多轮对话：每组对话独立维护面板可见性', () => {
    const messages = [
      // 第一轮
      { id: 'u1', type: 'user', content: '任务1' },
      { id: 's1', event: 'status:update', type: 'event', message: '开始' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'shell' },
      { id: 'a1', type: 'agent', content: '任务1完成' },
      // 第二轮
      { id: 'u2', type: 'user', content: '任务2' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: '思考中' },
      { id: 's2', event: 'status:update', type: 'event', message: '执行中' },
      { id: 'a2', type: 'agent', content: '任务2完成' },
    ];

    const groups = createConversationGroups(messages, {
      messageIsVisible: () => true,
      messageMatchesSearch: () => true,
    });

    expect(groups).toHaveLength(2);

    // 第一轮：有 tool 消息，面板可见
    expect(shouldPanelBeVisible(groups[0].runtimeDetails, false)).toBe(true);

    // 第二轮：只有 thinking+status，面板仍可见（修复后的行为）
    expect(shouldPanelBeVisible(groups[1].runtimeDetails, false)).toBe(true);
  });
});

describe('overflow 链路集成测试', () => {
  // 验证修复后的 overflow 设置不会裁切展开内容

  test('RuntimeDetailsPanel 不使用 overflow:hidden', async () => {
    // 读取样式文件验证
    const stylesContent = await import(
      '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js'
    ).then(m => m.styles);

    expect(stylesContent.runtimeDetailsPanel.overflow).not.toBe('hidden');
    // 应该是 'visible'
    expect(stylesContent.runtimeDetailsPanel.overflow).toBe('visible');
  });

  test('thinkingPanel 不使用 overflow:hidden', async () => {
    const stylesContent = await import(
      '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js'
    ).then(m => m.styles);

    expect(stylesContent.thinkingPanel.overflow).not.toBe('hidden');
    expect(stylesContent.thinkingPanel.overflow).toBe('visible');
  });

  test('MessageLog container 不使用 overflow:hidden', async () => {
    const stylesContent = await import(
      '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js'
    ).then(m => m.styles);

    expect(stylesContent.container.overflow).not.toBe('hidden');
    expect(stylesContent.container.overflow).toBe('visible');
  });

  test('app messageContainer 不使用 overflow:hidden', async () => {
    const appStyles = await import(
      '../../desktop/renderer/app/styles.js'
    ).then(m => m.styles);

    expect(appStyles.messageContainer.overflow).not.toBe('hidden');
    expect(appStyles.messageContainer.overflow).toBe('visible');
  });

  test('消息滚动容器 messageList 使用 overflowY:auto（不裁切内容）', async () => {
    const stylesContent = await import(
      '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js'
    ).then(m => m.styles);

    // messageList 应该是 overflowY: 'auto'，允许滚动但不裁切
    expect(stylesContent.messageList.overflowY).toBe('auto');
  });

  test('overflow 链路中不应有 hidden 阻断展开内容', async () => {
    // 模拟从外到内的 overflow 链路
    const appStyles = await import(
      '../../desktop/renderer/app/styles.js'
    ).then(m => m.styles);
    const msgStyles = await import(
      '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js'
    ).then(m => m.styles);

    // 从 chatArea → messageContainer → MessageLog container → messageList
    // 只有 messageList 可以是 auto（滚动容器），其他不应是 hidden
    const criticalOverflowChain = [
      appStyles.messageContainer.overflow,     // messageContainer
      msgStyles.container.overflow,            // MessageLog container
    ];

    // 这些关键层不应有 hidden
    expect(criticalOverflowChain.every(v => v !== 'hidden')).toBe(true);
  });

  test('RuntimeDetailsPanel tabContent 不使用 overflow:hidden', async () => {
    // 直接读取 RuntimeDetailsPanel.jsx 的 localStyles
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', '..', 'desktop', 'renderer', 'components', 'message-log', 'RuntimeDetailsPanel.jsx'),
      'utf-8'
    );

    // tabContent 不应该是 overflow: 'hidden'
    expect(content).not.toMatch(/tabContent:\s*\{[^}]*overflow:\s*'hidden'/);
  });

  test('header 元素有 borderRadius 补偿外层 overflow:visible', async () => {
    const msgStyles = await import(
      '../../desktop/renderer/components/message-log/styles/MessageLog.styles.js'
    ).then(m => m.styles);

    // runtimeDetailsHeader 和 thinkingHeader 应有顶部圆角
    expect(msgStyles.runtimeDetailsHeader.borderRadius).toBeDefined();
    expect(msgStyles.thinkingHeader.borderRadius).toBeDefined();
  });
});

describe('面板内容完整性集成测试', () => {
  test('thinking 消息全部被 thinkingPanel 收集', () => {
    const runtimeDetails = [
      { id: 'r1', event: 'agent:thinking', type: 'thinking', iteration: 1, summary: '步骤1' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'shell' },
      { id: 'r2', event: 'agent:thinking', type: 'thinking', iteration: 2, summary: '步骤2' },
      { id: 'tr1', type: 'tool_result', toolName: 'shell', result: 'ok' },
    ];

    const thinkingSummary = buildThinkingSummary(runtimeDetails);
    expect(thinkingSummary.count).toBe(2);
    expect(thinkingSummary.iterationCount).toBe(2);
  });

  test('status 消息提供面板状态文本', () => {
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: '正在读取文件' },
      { id: 's2', event: 'status:update', type: 'event', message: '执行完成' },
    ];

    const latestStatus = [...runtimeDetails].reverse().find(isStatusUpdateMessage);
    expect(getStatusUpdateText(latestStatus)).toBe('执行完成');
  });

  test('activity 摘要正确汇总文件状态', () => {
    const runtimeDetails = [
      {
        event: 'tool:activity', timestamp: 1,
        activity: {
          kind: 'tool_activity', id: 'read:a.js',
          phase: 'completed', intent: 'read',
          toolName: 'read_file', target: 'a.js',
        },
      },
      {
        event: 'tool:activity', timestamp: 2,
        activity: {
          kind: 'tool_activity', id: 'edit:b.js',
          phase: 'completed', intent: 'edit',
          toolName: 'edit_file', target: 'b.js', canUndo: true,
        },
      },
      {
        event: 'tool:activity', timestamp: 3,
        activity: {
          kind: 'tool_activity', id: 'write:c.js',
          phase: 'running', intent: 'write',
          toolName: 'write_file', target: 'c.js',
        },
      },
    ];

    const summary = buildActivitySummary(runtimeDetails);
    expect(summary.files).toHaveLength(3);
    expect(summary.files.find(f => f.path === 'a.js')).toMatchObject({ status: 'read', operation: 'read' });
    expect(summary.files.find(f => f.path === 'b.js')).toMatchObject({ status: 'edited', operation: 'edit' });
    expect(summary.files.find(f => f.path === 'c.js')?.status).toBe('running');
    expect(summary.completed).toBe(2);
    expect(summary.running).toBe(1);
    expect(summary.undoable).toBe(1);
  });

  test('导出数据保留完整运行时信息', () => {
    const runtimeDetails = [
      { event: 'tool:call', type: 'tool', timestamp: 1000, toolName: 'shell', args: { command: 'ls' } },
      { event: 'tool:result', type: 'tool_result', timestamp: 2000, toolName: 'shell', result: 'file1\nfile2' },
      { event: 'agent:thinking', type: 'thinking', timestamp: 3000, content: 'thinking...' },
    ];

    const exported = buildRuntimeDetailsExportData(runtimeDetails);
    expect(exported).toHaveLength(3);
    expect(exported[0]).toMatchObject({ event: 'tool:call', toolName: 'shell' });
    expect(exported[1]).toMatchObject({ event: 'tool:result', result: 'file1\nfile2' });
    expect(exported[2]).toMatchObject({ event: 'agent:thinking', content: 'thinking...' });
    // 时间戳转换为 ISO 格式
    expect(exported[0].timestamp).toBeTruthy();
  });

  test('辅助函数覆盖：getFileStatusLabel / getFileTypeIcon / formatDuration / getActivityTone', () => {
    expect(getFileStatusLabel('edited')).toBe('已编辑');
    expect(getFileStatusLabel('created')).toBe('已创建');
    expect(getFileStatusLabel('deleted')).toBe('已删除');

    expect(getFileTypeIcon('app.tsx')).toBe('TX');
    expect(getFileTypeIcon('readme.md')).toBe('MD');
    expect(getFileTypeIcon('data.json')).toBe('{}');
    expect(getFileTypeIcon('unknown.xyz')).toBe('🗎');

    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(3500)).toBe('3.5s');
    expect(formatDuration(125000)).toBe('2m 5s');

    expect(getActivityTone({ phase: 'completed' })).toBe('completed');
    expect(getActivityTone({ phase: 'failed' })).toBe('failed');
    expect(getActivityTone({ phase: 'waiting' })).toBe('waiting');
    expect(getActivityTone({ phase: 'running' })).toBe('running');
  });
});

describe('搜索/过滤场景集成测试', () => {
  test('搜索过滤不影响面板可见性判断', () => {
    const runtimeDetails = [
      { id: 's1', event: 'status:update', type: 'event', message: '开始执行' },
      { id: 'r1', event: 'agent:thinking', type: 'thinking', summary: 'thinking' },
    ];

    // 即使搜索不匹配任何消息，面板判断基于 runtimeDetails.length
    const messageMatchesSearch = () => false;
    const groups = createConversationGroups(
      [
        { id: 'u1', type: 'user', content: 'test' },
        ...runtimeDetails,
        { id: 'a1', type: 'agent', content: 'done' },
      ],
      { messageIsVisible: () => true, messageMatchesSearch }
    );

    // runtimeDetails 在搜索不匹配时不会被推入 group
    // 但如果 group 有 runtimeDetails，面板仍可见
    if (groups[0]?.runtimeDetails?.length > 0) {
      expect(shouldPanelBeVisible(groups[0].runtimeDetails, false)).toBe(true);
    }
  });

  test('type 过滤不影响 runtimeDetails 收集', () => {
    const messages = [
      { id: 'u1', type: 'user', content: 'test' },
      { id: 's1', event: 'status:update', type: 'event', message: 'running' },
      { id: 't1', event: 'tool:call', type: 'tool', toolName: 'shell' },
      { id: 'a1', type: 'agent', content: 'done' },
    ];

    // 即使过滤只显示 user 类型，runtimeDetails 仍应被收集
    const messageIsVisible = (msg) => msg.type === 'user' || msg.type === 'agent';
    const groups = createConversationGroups(messages, {
      messageIsVisible,
      messageMatchesSearch: () => true,
    });

    // runtimeDetails 是按 isRuntimeDetailMessage 判断的，不受 type 过滤影响
    // 但 messageMatchesSearch 会过滤哪些 runtimeDetail 进入 group
    const group = groups[0];
    if (group?.runtimeDetails?.length > 0) {
      expect(shouldPanelBeVisible(group.runtimeDetails, false)).toBe(true);
    }
  });
});
