# Mastery 系统架构

> 状态：Maintained  
> 架构风格：本地优先、事件驱动、端口适配器式模块化单体 + 进程外 Agent Runtime  
> 适用版本：`package.json` 当前主线  
> 验证入口：`bun run verify`

本文同时描述 Current Architecture（已实现）与 Target Architecture（演进目标）。带 `Target` 标记的组件不得被描述为现有能力；每个目标都必须有迁移阶段和退出条件。运行代码是行为真相来源，本文是设计意图和允许依赖的真相来源。

## 1. 目标、约束与非目标

### 1.1 设计目标

| 质量属性 | 目标 | 设计响应 | 验证方式 |
| --- | --- | --- | --- |
| 安全性 | Renderer 被攻陷时不能直接获得 Node、文件系统或任意 IPC 能力 | `sandbox: true`、`contextIsolation: true`、Preload 白名单、主进程校验 | Desktop 安全配置测试、Renderer 边界测试 |
| 可恢复性 | 单次 Agent、工具、预览或 UI 故障不破坏整个工作台 | 生命周期状态机、面板级错误、根级错误边界、初始化失败清理 | 生命周期与错误路径测试 |
| 响应性 | 流式输出不因高频 IPC 更新阻塞交互 | 增量事件、Renderer 批处理、折叠历史消息 | Runtime 测试、生产构建、真实页面检查 |
| 可演进性 | OMP 协议、Electron API 与 React UI 可以独立变化 | Adapter、RuntimeEvent、Preload Contract 三个防腐层 | 架构契约测试 |
| 可诊断性 | 启动、IPC、Agent 和能力故障能够定位到边界 | 结构化状态、诊断 handler、有限事件缓冲 | `ipc:diagnose`、状态与事件测试 |
| 本地优先 | 源码、会话和设置默认保留在用户设备 | 文件系统为工作区真相来源；无服务端控制平面 | 数据所有权审查 |

### 1.2 约束

- Electron 主进程是本地特权边界，Renderer 必须视为不可信。
- OMP 以独立子进程运行，Desktop 不依赖其内部 JavaScript 对象。
- CLI 是直接启动 OMP CLI 的薄代理；Desktop 才使用 `OmpAdapter`。
- EventBus 和事件缓冲均为单进程、易失性机制，不提供事务、持久重放或 exactly-once。
- 当前是单用户、单设备、单主窗口架构；不承诺跨设备同步和多窗口一致性。

### 1.3 非目标

- 不定义 OMP 内部推理、工具调度和 Provider 算法。
- 不提供远程多租户控制平面、服务器端会话存储或分布式任务队列。
- 不把浏览器预览视为 Electron 安全和 IPC 行为的等价测试环境。
- 不在本文维护逐个 React 组件的视觉规格；UI 细节属于设计系统和组件契约。

## 2. 架构北极星

Mastery 的目标不是把本地应用拆成微服务，而是在一个部署单元内形成清晰的逻辑平面、可替换端口和可演进协议。只有 OMP、Preview、Terminal 等需要故障或权限隔离的能力运行在独立进程中。

```mermaid
flowchart LR
  UI["Experience Plane<br/>Workbench / CLI"]

  subgraph Control["Control Plane"]
    Supervisor["Runtime Supervisor<br/>生命周期 / 恢复 / 健康度"]
    Policy["Capability Policy<br/>权限 / 风险 / 配额"]
    Registry["Capability Registry<br/>发现 / 版本 / 状态"]
  end

  subgraph Data["Data Plane"]
    Command["Command Gateway<br/>版本化请求"]
    Stream["Event Stream<br/>背压 / 优先级 / envelope"]
    Projection["Read Models<br/>会话 / UI 投影"]
  end

  subgraph Execution["Execution Plane"]
    OMP["Agent Runtime"]
    Tools["Tool / Terminal Workers"]
    Preview["Preview Workers"]
  end

  subgraph Foundation["Foundation Plane"]
    Workspace["Workspace Store"]
    Session["Session Store"]
    Telemetry["Telemetry<br/>trace / metric / log"]
  end

  UI --> Command
  UI --> Projection
  Supervisor --> Execution
  Policy --> Command
  Registry --> UI
  Command --> Execution
  Execution --> Stream
  Stream --> Projection
  Stream --> Telemetry
  Execution --> Workspace
  Projection --> Session
```

### 2.1 平面职责

| 平面 | 职责 | 当前实现 | Target |
| --- | --- | --- | --- |
| Experience | 输入、展示、交互恢复 | React Workbench、CLI | capability-driven UI，不感知进程位置 |
| Control | 生命周期、策略、能力健康度 | `DesktopCore` + 分散配置 | Runtime Supervisor、Capability Registry、Policy Engine |
| Data | 命令、事件、读模型 | IPC + RuntimeEvent + Hooks | 版本化 contract、背压、可重建 projection |
| Execution | Agent、工具、终端、预览执行 | OMP 子进程、一次性 Terminal command；内置 Preview runner 已移除 | 统一 Worker lifecycle 与隔离等级 |
| Foundation | 工作区、会话、安全存储、遥测 | 文件系统、safeStorage、局部指标 | correlation-aware telemetry、schema migration |

### 2.2 设计不变量

1. **Local-first，不等于 local-only。** 数据权威默认在本机，但所有端口必须允许未来接入远程实现。
2. **Contract-first。** 跨进程数据先定义 schema、版本、错误语义和兼容策略，再实现 handler。
3. **CQRS-lite。** 改变状态使用 Command；高频事实使用 Event；UI 查询稳定 Read Model，三者不混用。
4. **Supervised execution。** 独立进程必须有健康状态、终止语义、重启预算和熔断边界。
5. **Capability-oriented modularity。** Workspace、Session、Runtime、Preview、Terminal 按能力垂直切片，而不是按技术层无限横向堆积。
6. **Observability by construction。** request、event、tool run 从创建时携带 correlation/causation 上下文，而不是出故障后拼接日志。
7. **Backpressure over buffering。** 高频流优先合并、采样或降级；不能靠无限队列掩盖消费者跟不上。
8. **Least authority。** UI 只能请求能力，权限判断和路径约束必须在可信执行边界完成。

### 2.3 Current → Target 演进

```mermaid
flowchart LR
  C0["Current<br/>IPC handlers + EventBus"]
  C1["Phase 1<br/>Event Envelope v1"]
  C2["Phase 2<br/>Versioned Command Schemas"]
  C3["Phase 3<br/>Runtime Supervisor"]
  C4["Phase 4<br/>Capability Registry + Policy"]
  C5["Phase 5<br/>Projection / Backpressure"]

  C0 --> C1 --> C2 --> C3 --> C4 --> C5
```

| 阶段 | 交付物 | 退出条件 |
| --- | --- | --- |
| Phase 1 | Event Envelope v1：`schemaVersion`、`sequence`、`correlationId`、`causationId` | EventBus 同步/异步路径契约通过；旧消费者保持兼容 |
| Phase 2（完成） | IPC command schema registry、标准错误码、协议兼容测试 | 所有可调用 channel 都有 v1 输入/输出 contract；缺失契约 fail closed |
| Phase 3（完成） | OMP Runtime Supervisor、重启预算、健康状态 | OMP 异常退出按预算自动恢复；并发信号合并；新 Engine 重绑 IPC |
| Phase 4（完成） | capability manifest、Policy Engine、Renderer capability discovery | 所有 command 经过策略决策；UI 可读取能力和 contract |
| Phase 5 | 明确 stream QoS、projection rebuild、消息虚拟化 | 压力测试下交互延迟和内存满足预算 |

当前代码已完成 Phase 1–4。Phase 2 对直接和动态注册的 IPC command 强制建立 contract，并验证返回值可跨 IPC 传输；Phase 3 对 OMP 的启动、意外退出、退避恢复、重启预算和 IPC 重绑形成闭环；Phase 4 将 Policy Engine 接入所有 command，并通过 `capabilities:list`、`contracts:list` 和 `useIPC` 暴露发现端口。Phase 5 的 projection 重建、QoS 压测和消息虚拟化仍未开始。

## 3. 系统上下文

```mermaid
flowchart LR
  Person["开发者"]
  Workspace["本地工作区<br/>源码、资源、Git"]
  Provider["模型 Provider<br/>外部系统"]
  OMP["OMP Coding Agent<br/>外部依赖"]

  subgraph Mastery["Mastery 产品边界"]
    CLI["CLI 薄代理"]
    Desktop["Desktop 工作台"]
  end

  Person -->|"终端命令"| CLI
  Person -->|"图形交互"| Desktop
  CLI -->|"spawn；继承 stdio"| OMP
  Desktop -->|"RPC 子进程"| OMP
  Desktop -->|"受控文件操作"| Workspace
  OMP -->|"模型请求"| Provider
```

Mastery 有两条有意不同的执行路径：

1. CLI 在 `src/index.js` 中解析 OMP 可执行文件并透传参数、环境和 stdio。它不创建 `DesktopCore`。
2. Desktop 使用 Electron 进程模型，经 `OmpAdapter` 把 OMP RPC 帧转换成稳定的 RuntimeEvent，再交给 UI。

这种分离避免 CLI 为图形能力支付启动和依赖成本，也防止 Desktop UI 直接绑定第三方协议。

## 4. 容器视图

```mermaid
flowchart LR
  User["开发者"]

  subgraph Desktop["Electron Application"]
    Main["Main Process<br/>生命周期与特权能力"]
    Preload["Preload<br/>能力白名单"]
    Renderer["Renderer<br/>React 工作台"]
    Core["DesktopCore<br/>运行编排"]
    Bus["RuntimeEventBus<br/>进程内事件"]
  end

  OMP["OMP RPC Process"]
  FS["Workspace / Session / Config"]
  Preview["Local Preview Server"]

  User --> Renderer
  Renderer -->|"invoke / subscribe"| Preload
  Preload -->|"校验频道"| Main
  Main --> Core
  Core --> OMP
  OMP --> Core
  Core --> Bus
  Bus --> Main
  Main -->|"事件广播"| Preload
  Preload --> Renderer
  Main --> FS
  Main --> Preview
```

### 4.1 容器职责

| 容器 | 职责 | 拥有的状态 | 禁止承担 |
| --- | --- | --- | --- |
| Main Process | 启动编排、窗口、IPC、文件、会话、配置、终端、预览 | 特权资源句柄和应用生命周期 | 展示状态、React 业务逻辑 |
| Preload | 暴露最小且稳定的 `window.electronAPI` | 无持久业务状态 | 任意频道透传、业务编排 |
| Renderer | 展示、交互、短生命周期视图状态 | 当前布局、选择、流式展示模型 | Node/Electron 直接访问、工作区真相 |
| DesktopCore | Agent 生命周期和事件转发 | Core 状态、Engine 引用、有限事件缓冲 | UI 布局、文件展示 |
| OmpAdapter | OMP 子进程、RPC 关联、协议转换 | pending request、RPC buffer、session ID | Electron 或 React 逻辑 |
| RuntimeEventBus | 进程内发布订阅 | 订阅、有限历史/缓存 | 持久消息队列、跨进程一致性 |

## 5. 组件与依赖边界

### 5.1 Main / Runtime 组件

```mermaid
flowchart TB
  Bootstrap["desktop/main-app.js<br/>Composition Root"]
  Router["ipc-router.js<br/>Use-case Router"]
  Core["desktop-core.js<br/>Agent Lifecycle"]
  Adapter["omp-adapter.js<br/>Anti-corruption Layer"]
  IPC["MainProcessIPCAdapter<br/>Transport"]
  Bus["RuntimeEventBus<br/>Domain Events"]
  Capabilities["Workspace / Session / Preview / LLM Config"]
  OMP["OMP RPC"]

  Bootstrap --> Router
  Bootstrap --> Core
  Core --> Adapter
  Core --> Bus
  Core --> IPC
  Router --> IPC
  Router --> Capabilities
  Adapter --> OMP
  Adapter --> Bus
  Bus --> Core
```

设计规则：

- `desktop/main-app.js` 是唯一应用组合根；只决定装配和启动顺序。
- IPC Router 将频道映射为用例，不承载 Runtime 状态机。
- `OmpAdapter` 是第三方协议防腐层。OMP 原始帧不得越过该层。
- `DesktopCore` 只消费 RuntimeEvent，不解释 Renderer 展示格式。
- 工作区、会话、预览和配置是独立能力域；失败应限制在对应用例。

### 5.2 Renderer 组件

```mermaid
flowchart TB
  App["App.jsx<br/>Composition Root"]
  Views["components/<br/>Semantic Views"]
  Hooks["hooks/<br/>Use-case State"]
  Domain["app/ + runtime/<br/>Pure Domain Logic"]
  IPC["useIPC<br/>Preload Port"]
  API["window.electronAPI"]

  Domain --> Hooks
  API --> IPC
  IPC --> Hooks
  Hooks --> App
  Views --> App
  Domain --> Views
```

| 层 | 可以依赖 | 禁止依赖 |
| --- | --- | --- |
| `App.jsx` | Hooks、Views、纯领域服务 | Electron 主进程实现、OMP 原始对象 |
| `hooks/` | `app/`、`runtime/`、`useIPC` | `components/`、Main Process 文件 |
| `app/`、`runtime/` | 配置常量和纯函数 | React 组件、Electron、隐式 DOM 查询 |
| `components/` | 语义数据、回调、设计系统 | Node 内置模块、主进程模块 |
| `useIPC` | `window.electronAPI` | 白名单之外的能力 |

依赖只允许从稳定策略流向具体展示组合。Hooks 不得反向导入 Views；领域逻辑不得通过组件文件复用。

### 5.3 Capability-driven UI Graph

Renderer 不再通过“方法是否存在”推断功能。连接完成后，`useCapabilities` 并行读取 `capabilities:list` 与 `contracts:list`，生成唯一 UI Read Model；所有特权入口从该投影派生。

```mermaid
flowchart LR
  Registry["Capability Registry"]
  Contracts["Command Contract Registry"]
  Port["useIPC Discovery Port"]
  Graph["useCapabilities<br/>UI Read Model"]

  subgraph Surfaces["Workbench Surfaces"]
    Composer["Agent Composer"]
    Files["Workspace / Files"]
    Terminal["Terminal"]
    Preview["Preview Viewer"]
    Models["Model Management"]
    Status["Capability Status Bar"]
  end

  Registry -->|"status / risk / reason"| Port
  Contracts -->|"schema / channel / result"| Port
  Port --> Graph
  Graph --> Composer
  Graph --> Files
  Graph --> Terminal
  Graph --> Preview
  Graph --> Models
  Graph --> Status
```

UI 投影规则：

- `available`：入口可操作。
- `degraded`：入口停止产生新 command，保留当前内容并展示恢复原因。
- `unavailable`：入口禁用；若能力本身不存在，不渲染伪造的运行状态。
- 未出现在 manifest 的特权能力默认 `unavailable`，即 UI fail closed。
- `preview.viewer` 与 `preview.process` 分离：本地 URL 查看器可用不代表应用拥有 Preview 子进程。
- Runtime 停止后重新读取 manifest，使自动恢复结果进入同一个 UI graph。
- 浏览器预览只启用 Renderer 本地能力，不模拟 Electron、文件、终端或 Agent 权限。

## 6. 关键运行时流程

### 6.1 Desktop 启动时序

```mermaid
sequenceDiagram
  participant App as Electron App
  participant Core as DesktopCore
  participant OMP as OmpAdapter
  participant Config as Model Config
  participant IPC as IPC Router
  participant Window as BrowserWindow

  App->>App: whenReady
  App->>App: menu + local file server
  App->>Core: initialize
  Core->>OMP: spawn RPC process
  OMP-->>Core: ready
  Core-->>App: ready
  App->>Config: restore and attach provider
  Config-->>App: active or explicit unconfigured state
  App->>IPC: attach + initialize + register handlers
  IPC-->>App: ready
  App->>Window: create
```

启动采用 fail-fast：

- Core、Provider 恢复和 IPC 注册在首个窗口创建前完成。
- `attachIPCAdapter` 只装配；异步 `initialize` 必须显式等待。
- 必要步骤失败时不创建半可用窗口，并释放已经创建的 Engine。
- 可选能力必须返回明确的 unavailable 状态，不能伪装为成功。

### 6.2 Agent 请求与流式响应

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant Main as IPC / DesktopCore
  participant Adapter as OmpAdapter
  participant OMP as OMP RPC
  participant Bus as RuntimeEventBus

  UI->>Main: agent:processInput(request)
  Main->>Adapter: processInput
  Adapter->>OMP: RPC command(id)
  OMP-->>Adapter: response(id)
  OMP-->>Adapter: message_update / tool / lifecycle
  Adapter->>Bus: normalized RuntimeEvent
  Bus->>Main: event
  Main-->>UI: IPC broadcast
  UI->>UI: normalize, merge, render
```

请求/事件语义：

- 命令使用 request ID 关联成功、失败和超时。
- RuntimeEvent 是异步事实，不与命令响应共享 exactly-once 保证。
- 文本 delta 允许批量交付；生命周期事件必须最终使 UI 离开 streaming 状态。
- 工具、计划和交互按稳定 ID 合并，不按到达顺序猜测身份。
- Renderer 重连后以 `agent:getState` 和会话数据重建状态，不依赖事件缓冲完整回放。

### 6.3 工作目录切换

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant Main as Main Process
  participant Core as DesktopCore
  participant OMP as OmpAdapter
  participant Watcher as Workspace Watcher

  UI->>Main: workspace:setWorkingDirectory(path)
  Main->>Main: validate and canonicalize
  Main->>Core: setWorkingDirectory(path)
  Core->>OMP: setWorkingDirectory(path)
  OMP-->>Core: acknowledged
  Main->>Watcher: replace watched root
  Main-->>UI: success + canonical path
  Main-->>UI: workspace:changed
```

切换操作是一个有序用例，而不是多个组件各自修改路径。失败时保留旧工作目录；成功响应前不得向 UI 暴露新目录状态。

## 7. 状态、数据与一致性

### 7.1 状态所有权

| 状态 | 唯一权威 | 持久化 | 恢复策略 |
| --- | --- | --- | --- |
| Core 生命周期 | `DesktopCore` | 否 | 重新初始化 |
| OMP 执行与 Session ID | `OmpAdapter` / OMP | OMP 会话存储 | RPC 状态查询 |
| 会话目录和内容 | Session handlers / 文件系统 | 本地文件 | 列表重读，损坏项隔离 |
| 工作区文件 | 文件系统 | 本地文件 | 重新扫描/增量 watcher |
| 模型配置 | Main Process 配置模块 | 配置文件；密钥优先 `safeStorage` | 校验、迁移、安全默认值 |
| UI 布局 | `useLayout` | localStorage | schema 归一化和范围约束 |
| Runtime 展示模型 | `useRuntime` | 会话按需保存 | 状态查询 + 会话重载 |
| Preview 能力 | Capability Registry | 否 | 当前明确报告 `unavailable`，可连接外部本地 URL |

一致性模型：

- 文件系统和 OMP Session 是权威数据；Renderer cache 是可丢弃投影。
- IPC 命令采用 request/response；RuntimeEvent 采用 at-most-once 的实时通知语义。
- EventBus 事件缓冲上限由 `DESKTOP_ARCHITECTURE_LIMITS.eventBufferSize` 定义，当前为 1000 条，只用于诊断，不是恢复日志。
- localStorage 数据必须在 Hook 使用前完成版本兼容、枚举校验和数值约束。
- 跨域更新不得通过隐式 DOM、全局可变对象或重复 localStorage key 协调。

### 7.2 Event Envelope v1

```text
RuntimeEventEnvelope {
  type: string
  id: string
  schemaVersion: 1
  timestamp: epoch-milliseconds
  source: string
  sequence?: integer
  correlationId?: string
  causationId?: string
  ...payload
}
```

- `id` 标识单个事件；`correlationId` 标识一次用户意图或 Agent run；`causationId` 指向直接触发者。
- `sequence` 只保证同一个 EventBus 实例内单调递增，不代表跨进程或跨重启的全局顺序。
- 新增可选 metadata 是向后兼容变更；删除字段、改变含义或 payload 结构必须提升 schema version。
- 消费者必须忽略未知 metadata，不能用对象字段完全相等判断兼容性。
- Envelope 是可观测性和协议演进的基础，不等于持久事件溯源。

### 7.3 内容显示管线

```mermaid
flowchart LR
  Frame["RuntimeEvent"]
  Normalize["事件归一化"]
  Merge["按稳定 ID 合并生命周期"]
  Sanitize["协议文本过滤"]
  Store["Renderer Message Projection"]
  Prepare["Markdown 纯转换"]
  Render["语义化渲染"]

  Frame --> Normalize --> Merge --> Sanitize --> Store --> Prepare --> Render
```

- Runtime 层决定事件含义；组件只决定如何展示。
- `stripToolProtocolText` 是协议文本过滤的唯一实现。
- `prepareMarkdownDisplay` 负责链接、工作区图片、流式 fence 和安全文本准备。
- fenced code 不参与普通正文自动转换；原始 payload 只进入诊断详情。
- 长历史消息先裁剪展示投影，再进入 Markdown 解析。当前没有列表虚拟化，这是已知容量限制。

## 8. 安全架构

### 8.1 信任边界

```mermaid
flowchart LR
  subgraph Untrusted["不可信"]
    Content["模型 / Markdown / Tool Output"]
    Renderer["Renderer"]
    Preview["Preview Content"]
  end

  subgraph Boundary["受控边界"]
    Markdown["安全渲染规则"]
    Preload["Preload Channel Allowlist"]
    Validation["IPC 输入与路径校验"]
  end

  subgraph Trusted["本地特权区"]
    Main["Electron Main"]
    FS["Filesystem"]
    Secrets["safeStorage / Config"]
    Shell["Terminal / External Open"]
  end

  Content --> Markdown --> Renderer
  Preview --> Renderer
  Renderer --> Preload --> Validation --> Main
  Main --> FS
  Main --> Secrets
  Main --> Shell
```

安全不变量：

1. BrowserWindow 强制 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。
2. Preload 只暴露显式 invoke/send/receive 白名单；Renderer 不获得原始 `ipcRenderer`。
3. 文件路径必须相对已选择工作区解析并防止目录穿越。
4. `openExternal` 只接受 `http:` 和 `https:`。
5. 模型密钥优先使用 Electron `safeStorage`；日志和诊断不得包含密钥、Authorization header 或完整配置。
6. Preview iframe 使用 sandbox；预览内容不能继承 Main Process 权限。
7. 终端执行属于高风险能力，授权与命令边界必须在 Main Process 执行，不能只依赖 UI 禁用态。

## 9. 可靠性、容量与可观测性

### 9.1 故障隔离

| 故障 | 隔离范围 | 系统响应 | 恢复路径 |
| --- | --- | --- | --- |
| OMP 启动失败 | Agent Runtime | Core 进入 `error`，不创建窗口 | 显式重试初始化 |
| OMP 运行中退出 | 当前运行 | 拒绝 pending requests，发出 stop | 重启 Runtime / 应用 |
| IPC 初始化失败 | Desktop 启动 | fail-fast，不创建半可用窗口 | 修复后重启 |
| Preload 不可用 | 当前 Renderer | 显示能力不可用诊断 | 重载窗口 |
| React 渲染异常 | Renderer 树 | `UIErrorBoundary` 隔离 | 重试或重载 |
| 单个文件/预览/RAG 操作失败 | 当前能力 | 局部错误，不终止 Agent | 重试该操作 |
| localStorage 损坏 | 单个 UI 状态域 | 丢弃非法值并使用默认值 | 自动恢复 |

### 9.2 容量预算

| 资源 | 当前边界 | 超限行为 | 备注 |
| --- | --- | --- | --- |
| Desktop 诊断事件缓冲 | 1000 条 | 丢弃最旧事件 | 非持久恢复机制 |
| IPC request | 默认 30 秒 | reject timeout | 长任务依赖事件流，不延长同步请求 |
| IPC 重连 | 默认 5 次、1 秒退避 | 进入断开状态 | 当前不是指数退避 |
| Renderer 消息列表 | 未设硬上限 | 折叠旧消息降低成本 | 尚未虚拟化 |
| 单主窗口 | 1 个主要工作台 | 不定义跨窗口同步 | 多窗口是未来架构议题 |

容量值必须来自实现常量或配置，不允许只存在于文档。调整预算时要同时更新代码、测试和本表。

### 9.3 可观测性

- 生命周期状态：`idle → initializing → ready ↔ running → error/disposed`。
- 诊断接口：`ipc:diagnose` 仅返回版本、路径存在性、连接状态、窗口身份和 handler 统计。
- Runtime 指标：事件、请求、错误和连接统计通过显式 snapshot 查询。
- 日志必须带边界上下文，但不得记录 secret 或完整敏感 payload。
- Event Envelope 已提供 correlation/causation 承载位，但尚未贯通 IPC command、OMP RPC 和工具调用；当前也没有持久日志管线和崩溃遥测。

## 10. 部署与发布视图

```mermaid
flowchart TB
  Source["Source Tree"]
  CLI["CLI Package<br/>src/ + package.json"]
  Desktop["Electron Bundle<br/>Main + Preload + Renderer"]
  Renderer["Vite Production Assets"]
  OMP["npm dependency<br/>@oh-my-pi/pi-coding-agent"]
  Artifacts["DMG / ZIP / NSIS / AppImage"]

  Source --> CLI
  Source --> Desktop
  Source --> Renderer
  OMP --> CLI
  OMP --> Desktop
  Renderer --> Desktop
  Desktop --> Artifacts
```

- CLI 和 Desktop 共享发布仓库与 OMP 依赖，但入口和生命周期独立。
- Renderer 由 Vite 产出静态资源，打包进 Electron 应用。
- Desktop 包必须包含 sandbox-compatible CommonJS Preload。
- `bun run verify` 是提交前统一门禁；平台安装包由独立发布脚本生成。

## 11. 架构决策

| ID | 决策 | 原因 | 代价 / 触发复审条件 |
| --- | --- | --- | --- |
| ADR-001 | CLI 直接代理 OMP，不复用 DesktopCore | 启动轻、stdio 原生、避免 Electron 依赖 | CLI/Desktop 行为可能漂移；需要共享业务能力时复审 |
| ADR-002 | OMP 以 RPC 子进程接入 | 故障隔离、协议边界清晰、可替换 | 有序关闭、超时和进程恢复更复杂 |
| ADR-003 | RuntimeEvent Envelope v1 作为稳定事件语言 | 隔离 OMP 原始帧，提供版本、顺序和因果上下文 | metadata 需逐步贯通各边界；不提供持久重放 |
| ADR-004 | Preload 白名单是唯一 Renderer 特权端口 | 降低 Electron 攻击面 | 新能力必须同时更新 Preload、handler 和测试 |
| ADR-005 | 文件系统是工作区和会话真相来源 | 本地优先、可检查、无服务端依赖 | 不支持跨设备一致性 |
| ADR-006 | Renderer 使用 Hooks + 纯领域模块，不引入全局状态框架 | 当前规模下依赖透明、测试简单 | 状态图出现循环或跨页面事务时复审 |
| ADR-007 | 事件缓冲仅用于有限诊断 | 控制内存且避免伪装成可靠队列 | 需要崩溃恢复/离线重放时引入持久事件日志 |
| ADR-008 | IPC command 默认 fail closed | 未注册 contract 的命令不得进入 handler | 新 channel 必须同时声明 payload、result 和 risk |
| ADR-009 | 长驻 OMP 由 Runtime Supervisor 管理 | 将异常退出、恢复预算和 Engine 重绑集中到一处 | 一次性 Terminal command 使用超时终止；Preview runner 当前不存在 |
| ADR-010 | Policy Engine 是 command 的统一决策点 | 权限不依赖 Renderer 状态，且保留有限决策审计 | 默认 `local-full` 兼容现有本地体验；企业策略需新增 profile |

任何改变进程边界、状态权威、IPC 语义、安全不变量或一致性模型的修改，都必须新增或更新 ADR。

## 12. 已知限制与演进路线

| 优先级 | 限制 | 风险 | 演进方向 |
| --- | --- | --- | --- |
| P1 | 默认策略 profile 是 `local-full`，尚无逐次用户授权界面 | 本地高风险 command 默认允许 | 增加交互式 consent rule 和团队策略 profile |
| P2 | `App.jsx` 仍是较大的组合根 | 跨域编排继续增长 | 按 Workbench capability 拆分 feature controller |
| P2 | 消息列表未虚拟化 | 超长会话渲染成本增长 | 引入测量型虚拟列表并保持锚点 |
| P2 | correlation/causation 尚未端到端贯通 | 跨 OMP、IPC、UI 排障仍需人工关联 | Command、RPC 和 Tool run 继承同一上下文 |
| P3 | localStorage 不支持多窗口和跨设备一致性 | 未来扩展受限 | 引入版本化本地状态仓库；需求明确后再同步 |

演进优先修复安全与恢复边界，不以增加抽象层数量作为“架构升级”。只有当当前约束被真实需求突破时，才引入新进程、队列或状态框架。

## 13. 变更闭环

```mermaid
flowchart LR
  Decision["识别质量属性与边界变化"]
  ADR["更新设计 / ADR"]
  Contract["更新接口与架构契约"]
  Code["实现最小变更"]
  Verify["Lint + Unit + Desktop + Build"]
  Review["验证运行证据与残留风险"]

  Decision --> ADR --> Contract --> Code --> Verify --> Review
  Verify -->|"失败"| Code
  Review -->|"设计不成立"| ADR
```

| 变更类型 | 必须检查 | 最低证据 |
| --- | --- | --- |
| Core / OmpAdapter | 状态转换、并发初始化、失败清理、dispose | 生命周期单测 + Desktop 测试 |
| IPC / Preload | 白名单、输入校验、handler 对称性、错误传播 | IPC 契约 + Desktop 安全测试 |
| RuntimeEvent | 命名、payload、顺序容忍、流式收口 | RuntimeEvent 单测 |
| Renderer 领域 | 单向依赖、纯转换、异常输入 | 边界测试 + 对应单测 |
| UI / Design | 语义、键盘、主题、窄窗口、错误态 | 设计契约 + 构建 + 视觉检查 |
| 状态 / 配置 | 权威归属、迁移、损坏数据、secret | 归一化与安全存储测试 |
| 架构边界 | 本文、ADR、预算和实现常量 | `architecture-contract.test.js` |

本地统一命令：

```bash
bun run verify
```

`verify` 固定执行 ESLint、Renderer 生产构建、全部单元测试和 Desktop 测试。架构契约测试位于单元测试目录，因此自动纳入门禁。

## 14. 实现索引

| 设计元素 | 实现位置 |
| --- | --- |
| CLI 薄代理 | `src/index.js` |
| Desktop 生命周期 | `src/adapters/desktop/desktop-core.js` |
| OMP 防腐层 | `src/adapters/desktop/omp-adapter.js` |
| Event Envelope | `src/runtime/event-bus/records.js` |
| Command Contract Registry | `src/adapters/desktop/protocol/command-contracts.js` |
| Runtime Supervisor | `src/adapters/desktop/runtime-supervisor.js` |
| Capability Registry | `src/adapters/desktop/capability-registry.js` |
| Policy Engine | `src/adapters/desktop/policy-engine.js` |
| IPC 传输 | `src/adapters/desktop/ipc-adapter.js` |
| IPC 用例路由 | `desktop/main-app/ipc-router.js` |
| 安全 Preload | `desktop/preload.cjs` |
| Renderer 组合根 | `desktop/renderer/App.jsx` |
| Renderer 特权端口 | `desktop/renderer/hooks/useIPC.js` |
| UI Capability Read Model | `desktop/renderer/hooks/useCapabilities.js` |
| UI Capability Graph | `desktop/renderer/app/capabilities/capability-graph.js` |
| 布局领域 | `desktop/renderer/app/layout/layout-state.js` |
| 内容管线 | `desktop/renderer/app/content/content-pipeline.js` |
| 架构契约 | `tests/unit/architecture-contract.test.js` |
