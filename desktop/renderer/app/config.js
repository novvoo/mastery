export const LAYOUT = {
  activityRailWidth: 52,
  sidebarWidth: 300,
  inspectorPanelWidth: 380,
  inspectorMinWidth: 320,
  inspectorMaxWidth: 860,
  inspectorExpandedWidth: 720,
  headerHeight: 44,           // legacy: 旧 TopBar 高度，保留以防遗漏引用
  dragRegionHeight: 32,
  capsuleTop: 8,
  capsuleBottom: 10,
  capsuleSide: 12,
  macTrafficLightOffset: 74,
  inputAreaHeight: 140,
};



export const LLM_PROVIDER_OPTIONS = {
  openai: {
    label: 'OpenAI / OpenAI Compatible',
    keyLabel: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    defaultBaseUrl: 'https://api.openai.com/v1'
  },
  deepseek: {
    label: 'DeepSeek',
    keyLabel: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1'
  },
  zhipu: {
    label: 'Zhipu',
    keyLabel: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4'
  },
  openrouter: {
    label: 'OpenRouter',
    keyLabel: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    defaultBaseUrl: 'https://openrouter.ai/api/v1'
  }
};



export const SKILL_BUNDLES = {
  '后端开发': [
    { name: 'architect', desc: '架构设计', icon: '🏗️' },
    { name: 'tdd', desc: '测试驱动开发', icon: '🧪' },
    { name: 'diagnose', desc: '问题诊断', icon: '🔬' }
  ],
  '前端开发': [
    { name: 'grill', desc: 'UI 快速构建', icon: '🔥' },
    { name: 'setup', desc: '项目初始化', icon: '⚡' }
  ],
  '协作': [
    { name: 'review', desc: '代码审查', icon: '👀' },
    { name: 'handoff', desc: '任务交接', icon: '🤝' }
  ]
};

