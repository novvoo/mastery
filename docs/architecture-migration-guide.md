# 架构迁移指南：Runtime Layer 重构

## 📋 概述

本次重构引入了一个**平台无关的 Runtime Layer**，使得相同的核心代码可以在 CLI 和 Desktop 应用中共用。

## 🏗️ 新架构

```
src/
├── runtime/                    # 核心运行时（平台无关）
│   ├── index.js               # 导出 API
│   ├── types.js               # 类型定义
│   ├── event-bus.js           # 事件总线
│   └── agent-engine.js        # Agent 引擎
│
├── adapters/                  # 平台适配器
│   ├── cli/                   # CLI 适配器
│   │   ├── index.js
│   │   └── ui-adapter.js
│   └── desktop/               # Desktop 适配器（预留）
│       └── ipc-adapter.js
│
├── core/                      # 核心业务逻辑
├── cli/                       # CLI UI 组件（保持不变）
└── index.js                   # 主入口（向后兼容）
```

## 🚀 快速开始

### 使用新架构

```javascript
import { createAgentEngine, PlatformType } from './src/runtime/index.js';

// 创建引擎
const engine = createAgentEngine({
  platform: PlatformType.CLI,
  workingDirectory: process.cwd(),
  debug: false,
  maxIterations: 180
});

// 初始化
await engine.initialize();

// 挂载模型提供者
engine.attachModelProvider(modelProvider);

// 注册额外工具
engine.registerTool(customTool);

// 处理输入
const result = await engine.processInput("你的任务");
```

### 使用 CLI 适配器

```javascript
import { runCLIRuntime } from './src/adapters/cli/index.js';

const { engine, toolRegistry } = await runCLIRuntime({
  workingDirectory: './my-project',
  debug: true
});
```

## 📦 Runtime API

### AgentEngine

核心引擎类，提供以下方法：

- `initialize()` - 初始化引擎
- `attachModelProvider(provider)` - 挂载模型提供者
- `registerTool(tool)` - 注册单个工具
- `registerTools(tools)` - 批量注册工具
- `processInput(input)` - 处理用户输入
- `getState()` - 获取引擎状态
- `getToolRegistry()` - 获取工具注册表
- `getMemoryManager()` - 获取记忆管理器
- `getSecurityPolicy()` - 获取安全策略
- `stop()` - 停止当前执行
- `dispose()` - 释放资源

### EventBus

事件总线，支持订阅/发布模式：

```javascript
import { getEventBus, RuntimeEvent } from './src/runtime/index.js';

const eventBus = getEventBus();

// 订阅事件
const unsubscribe = eventBus.subscribe(RuntimeEvent.AGENT_START, (event) => {
  console.log('Agent started:', event.task);
});

// 发布事件
eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'Working...', level: 'info' });

// 取消订阅
unsubscribe();
```

### RuntimeEvent 事件类型

- `agent:start` - Agent 开始执行
- `agent:stop` - Agent 停止
- `agent:error` - Agent 错误
- `agent:complete` - Agent 完成
- `tool:call` - 工具调用
- `tool:result` - 工具结果
- `tool:error` - 工具错误
- `message:received` - 收到消息
- `message:sent` - 发送消息
- `status:update` - 状态更新
- `config:change` - 配置变更

## 🔄 从旧架构迁移

### 旧代码

```javascript
// src/index.js
const agent = new ReActAgent(modelProvider, toolRegistry, memoryManager, config, ui);
await agent.processInput(input);
```

### 新代码

```javascript
// 使用 runtime
import { createAgentEngine } from './src/runtime/index.js';

const engine = createAgentEngine({ workingDirectory: process.cwd() });
await engine.initialize();
engine.attachModelProvider(modelProvider);
const result = await engine.processInput(input);
```

### 主要变化

| 旧架构 | 新架构 | 说明 |
|--------|--------|------|
| 直接实例化 `ReActAgent` | 使用 `AgentEngine` | 统一初始化流程 |
| 手动创建组件 | 自动初始化 | 减少样板代码 |
| 紧耦合 UI | 通过 EventBus 解耦 | 支持多平台 |
| 硬编码工具注册 | 可扩展的工具注册 | 更灵活 |

## 🎯 Desktop 集成（未来）

Desktop 应用可以使用相同的 Runtime Layer：

```javascript
// Desktop 入口
import { createAgentEngine, PlatformType } from './src/runtime/index.js';
import { DesktopIPCAdapter } from './src/adapters/desktop/ipc-adapter.js';

const engine = createAgentEngine({
  platform: PlatformType.DESKTOP,
  workingDirectory: projectPath
});

const ipcAdapter = new DesktopIPCAdapter(eventBus, ipcMain);
ipcAdapter.attachEngine(engine);
```

## 📝 迁移清单

### Phase 1: 基础设施（已完成）
- [x] 创建 runtime 层
- [x] 实现 EventBus
- [x] 创建 AgentEngine
- [x] 创建 CLI 适配器
- [x] 创建 Desktop 适配器占位符

### Phase 2: 完善功能
- [ ] 更新 AgentEngine 支持所有工具
- [ ] 完善 CLI 适配器
- [ ] 添加集成测试
- [ ] 性能优化

### Phase 3: 迁移
- [ ] 迁移 src/index.js 使用新架构
- [ ] 保持向后兼容
- [ ] 更新文档
- [ ] 测试所有功能

### Phase 4: Desktop 集成
- [ ] 实现 Desktop IPC 适配器
- [ ] 创建 Electron 入口
- [ ] 实现 React UI 通信
- [ ] 端到端测试

## 🧪 测试

运行集成测试：

```bash
npm test
```

或运行特定测试：

```bash
npm test -- runtime
npm test -- adapters
```

## 📚 相关文档

- [Runtime API 文档](./runtime-api.md)
- [适配器开发指南](./adapters-guide.md)
- [Desktop 集成计划](./desktop-plan.md)

## ❓ 常见问题

### Q: 旧代码还能用吗？
A: 是的！`src/index.js` 保持不变，所有现有功能继续工作。

### Q: 为什么要用 EventBus？
A: EventBus 允许 UI 层和业务逻辑解耦，使得同一套 Runtime 可以在不同平台上工作。

### Q: 如何添加自定义工具？
A: 使用 `engine.registerTool(tool)` 或 `engine.registerTools([tool1, tool2])`。

### Q: Desktop 版本什么时候完成？
A: Desktop 适配器框架已预留，具体实现取决于 Desktop 项目的开发计划。

## 🤝 贡献

欢迎提交 PR 和 Issue！
