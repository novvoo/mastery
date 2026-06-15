/**
 * Renderer-side I18n - 渲染进程国际化模块
 *
 * Browser-compatible (no fs dependency). Used by the Electron UI.
 */

// 支持的语言
export const SupportedLanguages = Object.freeze({
  EN: 'en',
  ZH_CN: 'zh-CN',
  ZH_TW: 'zh-TW',
});

const DEFAULT_LANGUAGE = 'zh-CN';
const STORAGE_KEY = 'agent_ui_language';

// 翻译表：同时包含 UI 文本和 agent 文本
const TRANSLATIONS = {
  'en': {
    // ===== UI 组件 =====
    'ui.root': 'ROOT',
    'ui.settings': 'Settings',
    'ui.auto_save': 'Auto Save',
    'ui.auto_scroll': 'Auto Scroll',
    'ui.developer_mode': 'Developer Mode',
    'ui.verbose_logging': 'Verbose logging',
    'ui.max_iterations': 'Max iterations',
    'ui.theme': 'Theme',
    'ui.theme_light': 'Light',
    'ui.theme_dark': 'Dark',
    'ui.setup': 'Setup...',
    'ui.send_message': 'Send a message...',
    'ui.stop': 'Stop',
    'ui.new_chat': 'New Chat',
    'ui.clear': 'Clear',
    'ui.close': 'Close',

    // ===== 聊天 =====
    'chat.title': 'Chat',
    'chat.message_count': '{count} messages',
    'chat.export': 'Export',
    'chat.preview': 'Preview',
    'chat.hide_inspector': 'Hide Inspector',
    'chat.show_inspector': 'Show Inspector',
    'chat.clear_messages': 'Clear Chat',
    'chat.waiting_input': 'Awaiting Input',
    'chat.continue_round': 'Continue current Agent turn',
    'chat.continue': 'Continue',
    'chat.supplementary': 'Enter supplementary info...',
    'chat.placeholder': 'Send a message... (Ctrl+Enter to send | type / to see commands)',
    'chat.stop_running': 'Stop execution (Cmd+Ctrl+.)',
    'chat.send_message': 'Send message (Ctrl+Enter)',
    'chat.hint': 'Press <kbd>Ctrl+Enter</kbd> to send | Type <kbd>/skill_name</kbd> for quick call',

    // ===== 消息类型 =====
    'msg.info': 'Info',
    'msg.success': 'Success',
    'msg.error': 'Error',
    'msg.warning': 'Warning',
    'msg.debug': 'Debug',
    'msg.tool': 'Tool',
    'msg.tool_result': 'Tool Result',
    'msg.event': 'Event',
    'msg.result': 'Result',
    'msg.user': 'User',
    'msg.thinking': 'Thinking',
    'msg.message': 'Message',
    'msg.tool_name': 'Tool: {name}',
    'msg.args': 'Args: {args}',
    'msg.duration': 'Duration: {duration}ms',
    'msg.event_payload': 'Event Payload Preview',
    'msg.hand_to_agent': 'Hand to Agent',
    'msg.hand_to_agent_hint': 'Let Agent analyze this error',
    'msg.copy': 'Copy',
    'msg.copy_hint': 'Copy content',
    'msg.details': 'Details',
    'msg.hide_details': 'Hide Details',
    'msg.collapse': 'Collapse',
    'msg.expand': 'Expand',
    'msg.message_details': 'Message Details',
    'msg.message_id': 'Message ID:',
    'msg.type': 'Type:',
    'msg.time': 'Time:',
    'msg.tool_name_label': 'Tool Name:',
    'msg.duration_label': 'Duration:',
    'msg.payload': 'Payload',
    'msg.raw_data': 'Raw Data',
    'msg.thinking_summary': 'Model is organizing thoughts',
    'msg.thinking_in_progress': 'Thinking...',
    'msg.thinking_summary_label': 'Thinking Summary',
    'msg.iteration_x': 'Iteration {n}',
    'msg.iteration_x_of_y': 'Iteration {n} / {total}',
    'msg.count_messages': '{count} messages',
    'msg.model_thinking': 'Model is thinking',
    'msg.message_in_group': '{count} messages',
    'msg.expand_thinking': 'Expand thinking process',
    'msg.collapse_thinking': 'Collapse thinking process',
    'msg.search_messages': 'Search messages...',
    'msg.search_hint': 'Search messages',
    'msg.list_view': 'List View',
    'msg.timeline_view': 'Timeline View',
    'msg.auto_scroll_stop': 'Stop Auto Scroll',
    'msg.auto_scroll_start': 'Enable Auto Scroll',
    'msg.clear_hint': 'Clear messages',
    'msg.fragment_n': 'Fragment {n}',
    'msg.turn_n': 'Turn {n}',

    // ===== 执行摘要 =====
    'exec.summary': 'Execution Summary',
    'exec.overview': 'Overview',
    'exec.tools_used': 'Tools Used',
    'exec.files_written': 'Files Written',
    'exec.activity_log': 'Activity Log',
    'exec.iterations': 'Iterations',
    'exec.duration': 'Duration',
    'exec.tokens': 'Tokens',
    'exec.start_time': 'Start',
    'exec.end_time': 'End',
    'exec.confirm_continue': 'Confirm to continue',
    'exec.expand_diff': 'Expand diff',
    'exec.collapse_diff': 'Collapse diff',
    'exec.search_activity': 'Search activity...',
    'exec.filter_label': 'Filter: {label}',
    'exec.status_label': 'Status: {label}',
    'exec.expand_details': 'Expand Details',
    'exec.collapse_details': 'Collapse Details',
    'exec.ask_revert': 'Ask Agent to prepare revert',
    'exec.review_change': 'Review this file change',
    'exec.export_json': 'Export execution details as JSON',
    'exec.expand_runtime': 'Expand Runtime Details',
    'exec.collapse_runtime': 'Collapse Runtime Details',
    'exec.restore_panel': 'Restore execution panel',
    'exec.enlarge_panel': 'Enlarge execution panel',

    // ===== 状态 =====
    'status.idle': 'Idle',
    'status.running': 'Running',
    'status.completed': 'Completed',
    'status.error': 'Error',
    'status.needs_user_input': 'Needs Input',
    'status.waiting': 'Waiting',
    'status.connected': 'Connected',
    'status.disconnected': 'Disconnected',
    'status.not_set': 'Not set',
    'status.tools_count': '{count} Tools',
    'status.message_count': 'Messages: {count}',
    'status.tool_calls': 'Tool Calls: {count}',
    'status.ipc': 'IPC: {state}',

    // ===== 窗口控制 =====
    'window.expand_sidebar': 'Expand Sidebar',
    'window.collapse_sidebar': 'Collapse Sidebar',
    'window.minimize': 'Minimize',
    'window.maximize': 'Maximize',
    'window.restore': 'Restore',
    'window.close': 'Close',

    // ===== Inspector / 面板 =====
    'inspector.open_external': 'Click to open in external browser',
    'inspector.expand': 'Enlarge Preview Area',
    'inspector.restore': 'Restore Preview Area',
    'inspector.preview_url_placeholder': '127.0.0.1:41730',
    'inspector.panel': 'Inspector Panel',
    'inspector.drag_resize': 'Drag to resize Inspector',
    'inspector.tools': 'Tools',
    'inspector.settings': 'Settings',
    'inspector.agent_panel': 'Agent Panel',
    'inspector.tools_panel': 'Tools Panel',
    'inspector.tools_title': 'Tools',
    'inspector.settings_title': 'Settings',
    'inspector.search_tools': 'Search tool name, description or category',
    'inspector.sessions': 'Sessions',
    'inspector.new_chat': 'New Chat',

    // ===== 侧边栏 =====
    'sidebar.tools': 'Tools',
    'sidebar.sessions': 'Sessions',
    'sidebar.switch_to': 'Switch to session: {name}',
    'sidebar.new_task': 'New Task',

    // ===== Agent =====
    'agent.thinking': 'Thinking...',
    'agent.reasoning': 'Reasoning...',
    'agent.executing': 'Executing...',
    'agent.completed': 'Completed',
    'agent.failed': 'Failed',
    'agent.waiting': 'Waiting...',
    'agent.tool_call': 'Calling tool: {tool}',
    'agent.tool_result': 'Tool result received',
    'agent.final_answer': 'Final Answer',
    'agent.max_iterations': 'Maximum iterations reached',
    'agent.timeout': 'Operation timed out',

    // ===== LLM 设置 =====
    'llm.api_key_placeholder': 'Enter API Key',
    'llm.change_workdir': 'Change working directory',
    'llm.refresh_files': 'Refresh file list',
    'llm.show_templates': 'Show input templates',
    'llm.clear_all_sessions': 'Clear all sessions',

    // ===== 通用 =====
    'common.ok': 'OK',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.error': 'Error',
    'common.warning': 'Warning',
    'common.success': 'Success',
    'common.loading': 'Loading...',
    'common.done': 'Done',
    'common.failed': 'Failed',
    'common.retry': 'Retry',
    'common.close': 'Close',
    'common.save': 'Save',
    'common.upload': 'Upload',
    'common.init': 'Initialize',
    'common.status': 'Status',
    'common.refresh': 'Refresh',
    'common.browser': 'Browser',
    'common.start': 'Start',
    'common.export': 'Export',
    'common.undo': 'Undo',

    // ===== Agent =====
    'agent.thinking': 'Thinking...',
    'agent.reasoning': 'Reasoning...',
    'agent.executing': 'Executing...',
    'agent.completed': 'Completed',
    'agent.failed': 'Failed',
    'agent.waiting': 'Waiting...',
    'agent.tool_call': 'Calling tool: {tool}',
    'agent.tool_result': 'Tool result received',
    'agent.final_answer': 'Final Answer',
    'agent.max_iterations': 'Maximum iterations reached',
    'agent.timeout': 'Operation timed out',

    // ===== 通用 =====
    'common.ok': 'OK',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.error': 'Error',
    'common.warning': 'Warning',
    'common.success': 'Success',
    'common.loading': 'Loading...',
    'common.done': 'Done',
    'common.failed': 'Failed',
    'common.retry': 'Retry',
    'common.close': 'Close',
    'common.save': 'Save',

    // ===== 语言 =====
    'ui.language': 'Language',
    'ui.language_zh': '中文',
    'ui.language_en': 'English',
    'ui.language_tw': '繁體中文',
  },

  'zh-CN': {
    // ===== UI 组件 =====
    'ui.root': '根',
    'ui.settings': '设置',
    'ui.auto_save': '自动保存',
    'ui.auto_scroll': '自动滚动',
    'ui.developer_mode': '开发者模式',
    'ui.verbose_logging': '详细日志',
    'ui.max_iterations': '最大迭代',
    'ui.theme': '主题',
    'ui.theme_light': '亮色',
    'ui.theme_dark': '暗色',
    'ui.setup': '设置...',
    'ui.send_message': '发送消息...',
    'ui.stop': '停止',
    'ui.new_chat': '新对话',
    'ui.clear': '清除',
    'ui.close': '关闭',

    // ===== 聊天 =====
    'chat.title': '对话',
    'chat.message_count': '{count} 条消息',
    'chat.export': '导出',
    'chat.preview': '预览',
    'chat.hide_inspector': '隐藏',
    'chat.show_inspector': '显示',
    'chat.clear_messages': '清除',
    'chat.waiting_input': '等待补充信息',
    'chat.continue_round': '继续当前 Agent 回合',
    'chat.continue': '继续',
    'chat.supplementary': '输入补充信息...',
    'chat.placeholder': '输入消息... (Ctrl+Enter 发送 | 输入 / 查看命令)',
    'chat.stop_running': '停止执行 (Cmd+Ctrl+.)',
    'chat.send_message': '发送消息 (Ctrl+Enter)',
    'chat.hint': '按 <kbd>Ctrl+Enter</kbd> 发送 | 输入 <kbd>/技能名</kbd> 快速调用技能',

    // ===== 消息类型 =====
    'msg.info': '信息',
    'msg.success': '成功',
    'msg.error': '错误',
    'msg.warning': '警告',
    'msg.debug': '调试',
    'msg.tool': '工具',
    'msg.tool_result': '工具结果',
    'msg.event': '事件',
    'msg.result': '结果',
    'msg.user': '用户',
    'msg.thinking': '思考',
    'msg.message': '消息',
    'msg.tool_name': '工具: {name}',
    'msg.args': '参数: {args}',
    'msg.duration': '耗时: {duration}ms',
    'msg.event_payload': '事件负载预览',
    'msg.hand_to_agent': '交给 Agent',
    'msg.hand_to_agent_hint': '把错误消息交给 Agent 分析处理',
    'msg.copy': '复制',
    'msg.copy_hint': '复制内容',
    'msg.details': '详情',
    'msg.hide_details': '隐藏详情',
    'msg.collapse': '折叠',
    'msg.expand': '展开',
    'msg.message_details': '消息详情',
    'msg.message_id': '消息ID:',
    'msg.type': '类型:',
    'msg.time': '时间:',
    'msg.tool_name_label': '工具名称:',
    'msg.duration_label': '执行耗时:',
    'msg.payload': '负载 (payload)',
    'msg.raw_data': '原始数据',
    'msg.thinking_summary': '模型正在整理思路',
    'msg.thinking_in_progress': '思考中',
    'msg.thinking_summary_label': '思考摘要',
    'msg.iteration_x': '第 {n} 轮',
    'msg.iteration_x_of_y': '第 {n} 轮 / 共 {total} 轮',
    'msg.count_messages': '{count} 条',
    'msg.model_thinking': '模型正在思考',
    'msg.message_in_group': '{count} 条消息',
    'msg.expand_thinking': '展开思考过程',
    'msg.collapse_thinking': '收起思考过程',
    'msg.search_messages': '搜索消息...',
    'msg.search_hint': '搜索消息',
    'msg.list_view': '列表视图',
    'msg.timeline_view': '时间线视图',
    'msg.auto_scroll_stop': '停止自动滚动',
    'msg.auto_scroll_start': '启用自动滚动',
    'msg.clear_hint': '清空消息',
    'msg.fragment_n': '片段 {n}',
    'msg.turn_n': '第 {n} 轮',

    // ===== 执行摘要 =====
    'exec.summary': '执行摘要',
    'exec.overview': '概览',
    'exec.tools_used': '使用的工具',
    'exec.files_written': '写入的文件',
    'exec.activity_log': '活动日志',
    'exec.iterations': '迭代次数',
    'exec.duration': '耗时',
    'exec.tokens': '令牌',
    'exec.start_time': '开始',
    'exec.end_time': '结束',
    'exec.confirm_continue': '确认继续执行',
    'exec.expand_diff': '展开 diff',
    'exec.collapse_diff': '收起 diff',
    'exec.search_activity': '搜索活动...',
    'exec.filter_label': '筛选: {label}',
    'exec.status_label': '状态: {label}',
    'exec.expand_details': '展开详情',
    'exec.collapse_details': '收起详情',
    'exec.ask_revert': '让 Agent 准备撤销这次变更',
    'exec.review_change': '审核这次文件变更',
    'exec.export_json': '导出运行详情为 JSON',
    'exec.expand_runtime': '展开运行详情',
    'exec.collapse_runtime': '收起运行详情',
    'exec.restore_panel': '还原执行过程窗口',
    'exec.enlarge_panel': '放大执行过程窗口',

    // ===== 状态 =====
    'status.idle': '空闲',
    'status.running': '运行中',
    'status.completed': '已完成',
    'status.error': '错误',
    'status.needs_user_input': '需要输入',
    'status.waiting': '等待中',
    'status.connected': '已连接',
    'status.disconnected': '未连接',
    'status.not_set': '未设置',
    'status.tools_count': '{count} 工具',
    'status.message_count': '消息: {count}',
    'status.tool_calls': '工具调用: {count}',
    'status.ipc': 'IPC: {state}',

    // ===== 窗口控制 =====
    'window.expand_sidebar': '展开侧边栏',
    'window.collapse_sidebar': '收起侧边栏',
    'window.minimize': '最小化',
    'window.maximize': '最大化',
    'window.restore': '还原',
    'window.close': '关闭',

    // ===== Inspector / 面板 =====
    'inspector.open_external': '点击在外部浏览器中打开',
    'inspector.expand': '放大预览区域',
    'inspector.restore': '还原预览区域',
    'inspector.preview_url_placeholder': '127.0.0.1:41730',
    'inspector.panel': 'Inspector 面板',
    'inspector.drag_resize': '拖拽调整 Inspector 宽度',
    'inspector.tools': '工具',
    'inspector.settings': '设置',
    'inspector.agent_panel': 'Agent 面板',
    'inspector.tools_panel': '工具面板',
    'inspector.tools_title': '工具',
    'inspector.settings_title': '设置',
    'inspector.search_tools': '搜索工具名称、说明或分类',
    'inspector.sessions': '会话',
    'inspector.new_chat': '新对话',

    // ===== 侧边栏 =====
    'sidebar.tools': '工具',
    'sidebar.sessions': '会话',
    'sidebar.switch_to': '切换到会话: {name}',
    'sidebar.new_task': '新任务',

    // ===== Agent =====
    'agent.thinking': '思考中...',
    'agent.reasoning': '推理中...',
    'agent.executing': '执行中...',
    'agent.completed': '已完成',
    'agent.failed': '失败',
    'agent.waiting': '等待中...',
    'agent.tool_call': '调用工具: {tool}',
    'agent.tool_result': '收到工具结果',
    'agent.final_answer': '最终答案',
    'agent.max_iterations': '已达到最大迭代次数',
    'agent.timeout': '操作超时',

    // ===== LLM 设置 =====
    'llm.api_key_placeholder': '输入 API Key',
    'llm.change_workdir': '更改工作目录',
    'llm.refresh_files': '刷新文件列表',
    'llm.show_templates': '显示输入模板',
    'llm.clear_all_sessions': '清空所有会话',

    // ===== 通用 =====
    'common.ok': '确定',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.error': '错误',
    'common.warning': '警告',
    'common.success': '成功',
    'common.loading': '加载中...',
    'common.done': '完成',
    'common.failed': '失败',
    'common.retry': '重试',
    'common.close': '关闭',
    'common.save': '保存',
    'common.upload': '上传',
    'common.init': '初始化',
    'common.status': '状态',
    'common.refresh': '刷新',
    'common.browser': '浏览器',
    'common.start': '启动',
    'common.export': '导出',
    'common.undo': '撤销',

    // ===== 语言 =====
    'ui.language': '语言',
    'ui.language_zh': '中文',
    'ui.language_en': 'English',
    'ui.language_tw': '繁體中文',
  },

  'zh-TW': {
    // ===== UI 组件 =====
    'ui.root': '根',
    'ui.settings': '設定',
    'ui.auto_save': '自動儲存',
    'ui.auto_scroll': '自動滾動',
    'ui.developer_mode': '開發者模式',
    'ui.verbose_logging': '詳細日誌',
    'ui.max_iterations': '最大迭代',
    'ui.theme': '主題',
    'ui.theme_light': '亮色',
    'ui.theme_dark': '暗色',
    'ui.setup': '設定...',
    'ui.send_message': '發送訊息...',
    'ui.stop': '停止',
    'ui.new_chat': '新對話',
    'ui.clear': '清除',
    'ui.close': '關閉',

    // ===== 聊天 =====
    'chat.title': '對話',
    'chat.message_count': '{count} 條訊息',
    'chat.export': '匯出',
    'chat.preview': '預覽',
    'chat.hide_inspector': '隱藏',
    'chat.show_inspector': '顯示',
    'chat.clear_messages': '清除',
    'chat.waiting_input': '等待補充資訊',
    'chat.continue_round': '繼續目前 Agent 回合',
    'chat.continue': '繼續',
    'chat.supplementary': '輸入補充資訊...',
    'chat.placeholder': '輸入訊息... (Ctrl+Enter 送出 | 輸入 / 檢視指令)',
    'chat.stop_running': '停止執行 (Cmd+Ctrl+.)',
    'chat.send_message': '送出訊息 (Ctrl+Enter)',
    'chat.hint': '按 <kbd>Ctrl+Enter</kbd> 送出 | 輸入 <kbd>/技能名</kbd> 快速呼叫技能',

    // ===== 消息类型 =====
    'msg.info': '資訊',
    'msg.success': '成功',
    'msg.error': '錯誤',
    'msg.warning': '警告',
    'msg.debug': '除錯',
    'msg.tool': '工具',
    'msg.tool_result': '工具結果',
    'msg.event': '事件',
    'msg.result': '結果',
    'msg.user': '使用者',
    'msg.thinking': '思考',
    'msg.message': '訊息',
    'msg.tool_name': '工具: {name}',
    'msg.args': '參數: {args}',
    'msg.duration': '耗時: {duration}ms',
    'msg.event_payload': '事件裝載預覽',
    'msg.hand_to_agent': '交給 Agent',
    'msg.hand_to_agent_hint': '把錯誤訊息交給 Agent 分析處理',
    'msg.copy': '複製',
    'msg.copy_hint': '複製內容',
    'msg.details': '詳情',
    'msg.hide_details': '隱藏詳情',
    'msg.collapse': '折疊',
    'msg.expand': '展開',
    'msg.message_details': '訊息詳情',
    'msg.message_id': '訊息ID:',
    'msg.type': '類型:',
    'msg.time': '時間:',
    'msg.tool_name_label': '工具名稱:',
    'msg.duration_label': '執行耗時:',
    'msg.payload': '裝載 (payload)',
    'msg.raw_data': '原始資料',
    'msg.thinking_summary': '模型正在整理思路',
    'msg.thinking_in_progress': '思考中',
    'msg.thinking_summary_label': '思考摘要',
    'msg.iteration_x': '第 {n} 輪',
    'msg.iteration_x_of_y': '第 {n} 輪 / 共 {total} 輪',
    'msg.count_messages': '{count} 條',
    'msg.model_thinking': '模型正在思考',
    'msg.message_in_group': '{count} 條訊息',
    'msg.expand_thinking': '展開思考過程',
    'msg.collapse_thinking': '收起思考過程',
    'msg.search_messages': '搜尋訊息...',
    'msg.search_hint': '搜尋訊息',
    'msg.list_view': '清單檢視',
    'msg.timeline_view': '時間軸檢視',
    'msg.auto_scroll_stop': '停止自動捲動',
    'msg.auto_scroll_start': '啟用自動捲動',
    'msg.clear_hint': '清空訊息',
    'msg.fragment_n': '片段 {n}',
    'msg.turn_n': '第 {n} 輪',

    // ===== 执行摘要 =====
    'exec.summary': '執行摘要',
    'exec.overview': '概覽',
    'exec.tools_used': '使用的工具',
    'exec.files_written': '寫入的檔案',
    'exec.activity_log': '活動日誌',
    'exec.iterations': '迭代次數',
    'exec.duration': '耗時',
    'exec.tokens': '令牌',
    'exec.start_time': '開始',
    'exec.end_time': '結束',
    'exec.confirm_continue': '確認繼續執行',
    'exec.expand_diff': '展開 diff',
    'exec.collapse_diff': '收起 diff',
    'exec.search_activity': '搜尋活動...',
    'exec.filter_label': '篩選: {label}',
    'exec.status_label': '狀態: {label}',
    'exec.expand_details': '展開詳情',
    'exec.collapse_details': '收起詳情',
    'exec.ask_revert': '讓 Agent 準備復原這次變更',
    'exec.review_change': '審核這次檔案變更',
    'exec.export_json': '匯出執行細節為 JSON',
    'exec.expand_runtime': '展開執行細節',
    'exec.collapse_runtime': '收起執行細節',
    'exec.restore_panel': '還原執行過程視窗',
    'exec.enlarge_panel': '放大執行過程視窗',

    // ===== 状态 =====
    'status.idle': '閒置',
    'status.running': '執行中',
    'status.completed': '已完成',
    'status.error': '錯誤',
    'status.needs_user_input': '需要輸入',
    'status.waiting': '等待中',
    'status.connected': '已連接',
    'status.disconnected': '未連接',
    'status.not_set': '未設定',
    'status.tools_count': '{count} 工具',
    'status.message_count': '訊息: {count}',
    'status.tool_calls': '工具呼叫: {count}',
    'status.ipc': 'IPC: {state}',

    // ===== 窗口控制 =====
    'window.expand_sidebar': '展開側邊欄',
    'window.collapse_sidebar': '收起側邊欄',
    'window.minimize': '最小化',
    'window.maximize': '最大化',
    'window.restore': '還原',
    'window.close': '關閉',

    // ===== Inspector / 面板 =====
    'inspector.open_external': '點擊在外部瀏覽器中開啟',
    'inspector.expand': '放大預覽區域',
    'inspector.restore': '還原預覽區域',
    'inspector.preview_url_placeholder': '127.0.0.1:41730',
    'inspector.panel': 'Inspector 面板',
    'inspector.drag_resize': '拖曳調整 Inspector 寬度',
    'inspector.tools': '工具',
    'inspector.settings': '設定',
    'inspector.agent_panel': 'Agent 面板',
    'inspector.tools_panel': '工具面板',
    'inspector.tools_title': '工具',
    'inspector.settings_title': '設定',
    'inspector.search_tools': '搜尋工具名稱、說明或分類',
    'inspector.sessions': '會話',
    'inspector.new_chat': '新對話',

    // ===== 侧边栏 =====
    'sidebar.tools': '工具',
    'sidebar.sessions': '會話',
    'sidebar.switch_to': '切換到會話: {name}',
    'sidebar.new_task': '新任務',

    // ===== Agent =====
    'agent.thinking': '思考中...',
    'agent.reasoning': '推理中...',
    'agent.executing': '執行中...',
    'agent.completed': '已完成',
    'agent.failed': '失敗',
    'agent.waiting': '等待中...',
    'agent.tool_call': '呼叫工具: {tool}',
    'agent.tool_result': '收到工具結果',
    'agent.final_answer': '最終答案',
    'agent.max_iterations': '已達到最大迭代次數',
    'agent.timeout': '操作逾時',

    // ===== LLM 设置 =====
    'llm.api_key_placeholder': '輸入 API Key',
    'llm.change_workdir': '變更工作目錄',
    'llm.refresh_files': '重新整理檔案清單',
    'llm.show_templates': '顯示輸入範本',
    'llm.clear_all_sessions': '清空所有會話',

    // ===== 通用 =====
    'common.ok': '確定',
    'common.cancel': '取消',
    'common.confirm': '確認',
    'common.error': '錯誤',
    'common.warning': '警告',
    'common.success': '成功',
    'common.loading': '載入中...',
    'common.done': '完成',
    'common.failed': '失敗',
    'common.retry': '重試',
    'common.close': '關閉',
    'common.save': '儲存',

    // ===== 语言 =====
    'ui.language': '語言',
    'ui.language_zh': '簡體中文',
    'ui.language_en': 'English',
    'ui.language_tw': '繁體中文',
  },
};

// 单例实例
let _instance = null;
const _listeners = new Set();

export class I18n {
  constructor(options = {}) {
    this._currentLanguage = options.language || this._detectLanguage();
    this._fallbackLanguage = options.fallbackLanguage || DEFAULT_LANGUAGE;
    this._translations = new Map();
    this._loadTranslations();
  }

  _detectLanguage() {
    // 尝试从 localStorage 读取
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && Object.values(SupportedLanguages).includes(stored)) {
        return stored;
      }
    } catch (_) { /* ignore */ }

    // 尝试从浏览器语言检测
    try {
      const nav = navigator.language || navigator.userLanguage || '';
      const lower = nav.toLowerCase();
      if (lower.startsWith('zh')) {
        if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo')) {
          return 'zh-TW';
        }
        return 'zh-CN';
      }
      if (lower.startsWith('en')) return 'en';
    } catch (_) { /* ignore */ }

    return DEFAULT_LANGUAGE;
  }

  _loadTranslations() {
    for (const [lang, translations] of Object.entries(TRANSLATIONS)) {
      this._translations.set(lang, translations);
    }
  }

  getLanguage() {
    return this._currentLanguage;
  }

  setLanguage(lang) {
    const validLanguages = Object.values(SupportedLanguages);
    if (!validLanguages.includes(lang)) {
      console.warn(`[i18n] 不支持的语言: ${lang}`);
      return;
    }
    this._currentLanguage = lang;

    // 持久化到 localStorage
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) { /* ignore */ }

    // 通知监听器
    this._notifyListeners();
  }

  /**
   * 获取翻译
   * @param {string} key - 翻译键
   * @param {object} params - 可选参数，用于替换 {key} 占位符
   * @param {string} fallback - 可选回退文本（当键不存在时使用）
   */
  t(key, params = {}, fallback = null) {
    const lang = this._currentLanguage;
    const translations = this._translations.get(lang) || {};
    let text = translations[key];

    // 如果当前语言没有，尝试回退语言
    if (text === undefined) {
      const fallbackTranslations = this._translations.get(this._fallbackLanguage) || {};
      text = fallbackTranslations[key];
    }

    // 仍然没有，返回 fallback 或 key 本身
    if (text === undefined) {
      text = fallback !== null ? fallback : key;
    }

    // 替换 {param} 占位符
    if (params && Object.keys(params).length > 0) {
      for (const [k, v] of Object.entries(params)) {
        const placeholder = new RegExp(`\\{${k}\\}`, 'g');
        text = text.replace(placeholder, String(v));
      }
    }

    return text;
  }

  /**
   * 订阅语言变化
   */
  subscribe(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  _notifyListeners() {
    for (const listener of _listeners) {
      try {
        listener(this._currentLanguage);
      } catch (err) {
        console.warn('[i18n] 监听器错误:', err);
      }
    }
  }
}

/** 获取全局单例 */
export function getI18n() {
  if (!_instance) {
    _instance = new I18n();
  }
  return _instance;
}

/** 便捷翻译函数 */
export function t(key, params, fallback) {
  return getI18n().t(key, params, fallback);
}

export default I18n;
