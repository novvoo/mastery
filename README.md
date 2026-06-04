# AI Engineering Mastery Agent

一个面向真实工程任务的本地 ReAct Agent。它把 LLM、意图识别、工具路由、方法论工具、文件/终端/Web 工具、记忆和集成测试组织成一条可验证的执行链路。

当前设计目标不是“让模型自由发挥”，而是让模型在本地运行时里被可靠地引导：先识别任务，选择工具，执行变更，验证结果，最后输出对用户有用的结论。

## 核心能力

- **智能意图识别**：短输入如"上海天气"会先经过 LLM intent classifier，生成结构化 routing hint，再进入 ReAct 循环。明显天气查询有窄兜底，避免模型漏判。
- **按需工具路由**：每轮 LLM request 只暴露当前任务需要的工具子集。工程任务默认使用文件、终端、PTY、方法论和只读 Git 工具；如果任务提到最新资料、浏览器、MCP、后台任务或发布操作，会按需加入 Web、Browser、MCP、调度或 Git 写入工具。
- **轻量任务画像**：明显工程任务会先用本地画像识别，跳过无收益的 intent 预请求，避免首轮在工具很多时等待额外 LLM 调用。
- **ReAct 工具执行**：支持原生 function calling，也支持文本模型输出的 `CALL tool({...})`、JSON action、XML、`&lt;tool_code&gt;`、bash code fence 等工具格式。
- **编码任务守门**：编码类请求会自动进入 coding task mode，要求理解仓库、做最小必要修改、检查变更、运行验证，再给最终答案。
- **方法论工具**：内置 `setup`、`diagnose`、`grill`、`zoom_out`、`brainstorm`、`tdd`、`review`、`verify`、`architect`、`to_prd`、`to_issues`、`caveman`、`handoff` 等 12+ 工程流程工具。
- **Web 查询链路**：`web_search` 默认优先 Bing（中文本地化），失败或无结果时 fallback 到 DuckDuckGo；需要详情时继续 `web_fetch`。
- **用户文档 RAG**：支持用 `/doc add`、Finder 文件选择器、自然语言 `@路径` 或网络文档 URL 索引 `.txt`、`.md`、`.json`、`.html`、`.pdf`、`.docx`，再用 `document_search` 或自然语言问题检索回答。
- **本地系统工具**：文件读写、目录列表、shell、PTY、语义搜索、浏览器打开等工具统一通过 tool registry 暴露。
- **会话与上下文管理**：SessionManager + DynamicContextPruning，支持动态裁剪、智能摘要、会话记忆。
- **Document RAG**：文档索引、检索和问答。
- **语义搜索**：项目文件语义检索。
- **自动任务编排**：SchedulerEngine + TaskGroup + ConcurrencyCoordinator，支持工作流触发、条件分支、并发执行、失败恢复。
- **安全审批层**：SecurityPolicy 工具审批、结果截断、敏感路径保护、沙箱执行。
- **多 Provider 支持**：OpenAI、Llama、Zhipu、DeepSeek、OpenRouter，支持模型能力自动识别和在线查询。
- **MCP 协议支持**：MCP client/adapter，支持扩展工具集成，兼容第三方 MCP 服务。
- **Shell 沙箱**：macOS Seatbelt、Linux bubblewrap、Policy 策略检查，支持可选隔离执行。
- **默认安静运行**：`DEBUG=false` 为默认模式；需要排障时可用 `/debug on` 或 `bun run start:debug` 打开详细事件日志。
- **集成测试覆盖**：`test-integration.mjs` 覆盖 Agent 循环、工具解析、Web 搜索、CLI 输入、编码守门、记忆系统、安全策略和稳定性。

## 运行链路

```text
User Input
  -> Local Task Profile
     -> coding / fresh-data / browser / git / mcp / scheduler signals
  -> Optional IntentClassifier
     -> structured intent / routing hint for ambiguous fresh-data tasks
  -> SessionManager
     -> compact system prompt + compact tool instructions + recent context
  -> ReActAgent loop
     -> ToolRouter selects current tool subset
     -> LLM request
     -> native tool calls or TextToolParser parsed calls
     -> ToolRegistry executes tools
     -> observations added back to session
     -> completion gates
  -> Final Answer
```

关键文件：

- `src/index.js`：CLI 入口、配置加载、工具注册、模型 provider 初始化、slash command、debug 开关、SchedulerEngine 启动。
- `src/core/agent.js`：ReAct 主循环、意图路由注入、工具执行、编码任务守门、自动任务编排、最终答案处理。
- `src/core/intent-classifier.js`：LLM-backed intent classifier，把短输入转换成结构化任务意图。
- `src/core/tool-router.js`：本地任务画像和按需工具路由，避免每轮向模型暴露全量工具。
- `src/core/text-tool-parser.js`：兼容非 function calling 模型的文本工具调用解析。
- `src/core/tool-registry.js`：工具注册、查找、执行和 function definitions 输出。
- `src/core/session-manager.js`：会话管理、上下文裁剪、消息历史维护。
- `src/core/security-policy.js`：工具审批、结果截断、敏感信息保护。
- `src/core/dynamic-context-pruning.js`：动态上下文裁剪、智能摘要生成。
- `src/memory/memory-manager.js`：记忆管理、项目上下文存储。
- `src/core/token-juice.js`：Token 计数、上下文压缩、JSON 规则引擎。
- `src/prompts/system-prompt.js`：系统提示、工具使用规范、Web 查询和编码方法论约束。
- `src/tools/web/web-tools.js`：`web_search`、`web_fetch`、`browser_open`。
- `src/tools/memory/document-rag.js`：用户文档 RAG，负责本地文件/URL 加载、PDF/DOCX 提取、chunk 和语义检索。
- `src/tools/skills/*.js`：AI Engineering Mastery 方法论工具（12+ 个）。
- `src/sandbox/shell-sandbox.js`：Shell 沙箱、策略检查、隔离执行。
- `src/scheduler/SchedulerEngine.js`：任务调度、工作流自动化、并发协调。
- `src/scheduler/concurrency/`：TaskGroup、ConcurrencyCoordinator 任务并发管理。
- `src/mcp/`：MCP 客户端、协议适配、工具桥接。
- `src/models/`：多 provider 适配（OpenAI, Llama, Zhipu, DeepSeek, OpenRouter）。
- `test-integration.mjs`：端到端集成测试套件。

## 方法论

Agent 的工程方法论可以概括为六步：

1. **识别意图**：先判断用户是在问实时信息、做本地文件任务、运行终端、写代码、解释概念，还是普通聊天。
2. **选择最小工具路径**：能用结构化工具就不用猜；实时信息走 `web_search -&gt; web_fetch`，本地信息走文件/终端工具。
3. **先理解再修改**：编码任务先读相关文件和上下文，避免凭空生成。
4. **小步修改**：只改完成任务需要的文件，不做无关重构。
5. **证据验证**：运行测试、lint、构建、Bun 语法/打包检查或 `verify/review`，失败则继续修复。
6. **收口清楚**：最终答案说明改了什么、验证了什么、还有什么风险或限制。

实际运行时采用"证据型守门"，而不是固定死板的流程编排：

- 系统提示会鼓励新功能先 `brainstorm`、实现时用 `tdd`、完成前 `verify`。
- 工具暴露采用"按需裁剪"而不是"永久隐藏"。例如普通工程任务不会默认暴露 Web/MCP/调度工具，但如果需求里出现"查最新文档""连接 MCP""创建后台任务"等信号，对应工具组会加入本轮 function definitions。
- 明显工程任务会跳过 LLM intent classifier 的预请求；天气、新闻、汇率、实时价格等时效性任务仍会使用 intent classifier 或窄兜底生成 routing hint。
- Agent completion gate 的强制条件更宽松：非平凡编码任务需要至少一个成功的方法论工具证据，但不强制必须是 `brainstorm` 或 `tdd`。
- 变更后的验证可以是 `verify` / `review`，也可以是等价的 fresh verification command，例如 `bun test`、`bun run lint`、`tsc`、`pytest`、`lint` 等。
- 对涉及时间、速度、动画、游戏循环、第三方 API、状态转换、并发 I/O 或安全边界的编码任务，Agent 会自动插入 `semantic_risk_review` 编排节点，并要求 `review` / `verify` 覆盖单位、API 参数语义、状态不变量和用户可感知行为。
- 小型、显然的单文件任务可以跳过部分方法论工具，但仍应读回结果并给出验证证据。

## Web 搜索策略

`web_search` 默认顺序：

1. Bing localized search：`mkt=zh-CN&amp;setlang=zh-CN`
2. DuckDuckGo Lite
3. DuckDuckGo HTML

搜索结果只提供标题、摘要和 URL。遇到天气、新闻、价格、汇率、文档变更等时效信息，Agent 应先 `web_search`，再对最相关结果调用 `web_fetch` 获取可引用内容。

如果 Bing 请求成功但解析不到结果，会记录 provider no-results 事件并继续 fallback。这个 fallback 是可接受行为，不代表没有优先尝试 Bing。

## 用户文档 RAG

CLI 里的"上传文档"不是浏览器表单上传，而是把用户提供的文件路径、macOS 文件选择器结果、网络文档链接或粘贴文本加入当前 CLI 会话的文档索引。索引是内存态的，退出当前进程后需要重新添加；这样默认不把私人文档持久化到磁盘。

显式命令：

```text
/doc init
/doc add ./docs/spec.pdf
/doc add "docs/Product Requirements.docx"
/doc add https://example.com/runbook.html
/doc search "回滚策略和审批人"
/doc list
/doc clear
/doc clear &lt;document-id&gt;
```

自然入口：

```text
根据 @./docs/spec.pdf 总结主要风险
对比 @"./docs/Product Requirements.docx" 和当前实现
读一下 @https://example.com/runbook.html，告诉我部署失败怎么恢复
```

交互体验：

- `/doc add` 不带参数时，macOS 会弹 Finder 选择文件；非 macOS 会提示输入路径或 URL。
- `/doc init` 会预热并诊断文档 RAG embedding runtime；模型文件缺失且自动下载开启时，会先轻量探测官方源和镜像源，选择当前可用的下载源，再逐行显示下载 URL、超时、文件大小和下载进度，最后显示模型路径、文件状态、ONNX 初始化结果和 fallback 原因。
- `@路径` 只会索引真实存在的本地文件或 `http(s)` URL，不存在的 `@mention` 会被忽略。
- 路径里有空格时，推荐写成 `@"path with spaces.pdf"` 或 `/doc add "path with spaces.pdf"`。
- 常见句尾标点会被自动剥离，例如 `@./docs/spec.pdf。`。
- 当前支持 `.txt`、`.md`、`.json`、`.html`、`.pdf`、`.docx`；单个文档默认限制 15MB。

## 上下文管理

当前 Agent 自动上下文管理由 `SessionManager` 保存会话，并在接近上下文窗口时调用 `DynamicContextPruning`。模型上下文窗口由统一的 model capabilities registry 提供：

- 已知模型先使用本地能力表，保证离线启动
- 未知模型默认尝试查询 OpenRouter Models API 和 LiteLLM 公共模型 catalog，获取 `context_length` / `max_input_tokens` 等实时能力信息
- 可用 `MODEL_CONTEXT_WINDOW` / `MODEL_MAX_CONTEXT_TOKENS` 对未知或私有模型强制覆盖上下文窗口
- token 数量默认使用 `Tokenizer` 的同步 provider-specific counter；在 tokenizer 不可用或未知模型时回退到 CJK-aware 估算
- 超过模型上下文窗口 80% 时触发裁剪
- 裁剪目标约为窗口 60%，并保留 system prompt、重要消息和最近消息
- 裁剪时会生成智能摘要，保持上下文连续性

`DynamicContextPruning` 支持重要性评分、recent/system message 保留、压缩建议和更细的 token counter。`SessionManager` 默认使用 `Tokenizer` 的同步 provider-specific counter，并在 tokenizer 不可用或未知模型时回退到 CJK-aware 估算。

## Shell 沙箱

Shell 工具支持可选沙箱模式，默认关闭以保持本地开发兼容性。开启后，命令会先经过统一策略检查，再按平台选择后端：

1. macOS：优先使用系统 `sandbox-exec` Seatbelt profile。
2. Linux：优先使用 `bubblewrap`。
3. 其他环境或后端不可用：使用 `policy` 后端，只做命令预检和路径/网络拦截，不提供 OS 级隔离。

推荐本地安全模式：

```env
AGENT_SHELL_SANDBOX=true
AGENT_SHELL_SANDBOX_BACKEND=auto
AGENT_SHELL_SANDBOX_FAIL_IF_UNAVAILABLE=true
AGENT_SANDBOX_ALLOW_WRITE=.
AGENT_SANDBOX_NETWORK=false
```

默认策略会阻止常见网络命令和工作区外的写操作，并拒绝引用 `~/.ssh`、`~/.aws`、`~/.config/gh`、`~/.netrc` 等敏感路径。需要联网安装依赖或拉取代码时，应临时显式打开网络或把命令移到人工确认流程。

边界说明：

- `policy` 后端不是完整沙箱，只是安全预检；真正隔离依赖 Seatbelt、bubblewrap、容器或 VM。
- 当前只覆盖 `shell` 工具，不覆盖文件工具、PTY helper 或模型 provider 自身。

## 项目结构

```text
ai-engineering-mastery-agent/
├── src/
│   ├── cli/             # CLI UI、slash command、增强命令
│   ├── core/            # ReActAgent、Session、ToolRegistry、IntentClassifier、TextToolParser
│   ├── errors/          # 错误分类、重试、timeout
│   ├── eval/            # Agent eval runner
│   ├── mcp/             # MCP client / adapter
│   ├── memory/          # 记忆和语义搜索支持
│   ├── models/          # OpenAI / Llama / Zhipu / DeepSeek / OpenRouter provider
│   ├── planner/         # 图任务规划器
│   ├── prompts/         # 系统提示
│   ├── sandbox/         # 安全执行层
│   ├── scheduler/       # 自动化与任务调度
│   └── tools/           # 文件、系统、Web、MCP、方法论工具
├── eval/golden_cases/   # 黄金用例
├── workspace/           # 默认工作区
├── test-integration.mjs # 集成测试入口
├── package.json
├── bun.lock
└── README.md
```

## 已知限制与待办

- **Embedder 容错与模型分发**：ONNX 模型依赖 HuggingFace 下载，国内环境不稳定。fallback 伪 embedding 语义质量有限。
- **Token 计数精度**：fallback 计数对中英文混排仍是估算，需要接入真实 tokenizer 确保上下文剪枝时机准确。
- **ReAct 串行循环**：`agent.js` 的 `run()` 是 Think→Act→Observe 串行循环，每轮需要完整 LLM 调用。
- **LLM 调用流式输出**：`modelProvider.chat()` 阻塞等待完整响应，大上下文时可能耗时较长。
- **沙箱扩展**：Shell 已支持可选沙箱和策略预检，但文件工具和 PTY 尚未纳入同一沙箱边界。

## 测试

当前主要回归入口：

```bash
bun test-integration.mjs
```

## License

MIT
