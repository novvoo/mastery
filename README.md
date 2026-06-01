# AI Engineering Mastery Agent

一个面向真实工程任务的本地 ReAct Agent。它把 LLM、意图识别、工具路由、方法论工具、文件/终端/Web 工具、记忆和集成测试组织成一条可验证的执行链路。

当前设计目标不是“让模型自由发挥”，而是让模型在本地运行时里被可靠地引导：先识别任务，选择工具，执行变更，验证结果，最后输出对用户有用的结论。

## 核心能力

- **智能意图识别**：短输入如“上海天气”会先经过 LLM intent classifier，生成结构化 routing hint，再进入 ReAct 循环。明显天气查询有窄兜底，避免模型漏判。
- **ReAct 工具执行**：支持原生 function calling，也支持文本模型输出的 `CALL tool({...})`、JSON action、XML、`<tool_code>`、bash code fence 等工具格式。
- **编码任务守门**：编码类请求会自动进入 coding task mode，要求理解仓库、做最小必要修改、检查变更、运行验证，再给最终答案。
- **方法论工具**：内置 `setup`、`diagnose`、`grill`、`zoom_out`、`brainstorm`、`tdd`、`review`、`verify`、`architect`、`to_prd`、`to_issues` 等工程流程工具。
- **Web 查询链路**：`web_search` 默认优先 Bing，失败或无结果时 fallback 到 DuckDuckGo；需要详情时继续 `web_fetch`。
- **本地系统工具**：文件读写、目录列表、shell、PTY、语义搜索、浏览器打开等工具统一通过 tool registry 暴露。
- **默认安静运行**：`DEBUG=false` 为默认模式；需要排障时可用 `/debug on` 或 `bun run start:debug` 打开详细事件日志。
- **集成测试覆盖**：`test-integration.mjs` 覆盖 Agent 循环、工具解析、Web 搜索、CLI 输入、编码守门和稳定性。

## 运行链路

```text
User Input
  -> IntentClassifier
     -> structured intent / routing hint
  -> SessionManager
     -> system prompt + tool instructions + recent context
  -> ReActAgent loop
     -> LLM request
     -> native tool calls or TextToolParser parsed calls
     -> ToolRegistry executes tools
     -> observations added back to session
     -> completion gates
  -> Final Answer
```

关键文件：

- `src/index.js`：CLI 入口、配置加载、工具注册、模型 provider 初始化、slash command、debug 开关。
- `src/core/agent.js`：ReAct 主循环、意图路由注入、工具执行、编码任务守门、自动任务编排、最终答案处理。
- `src/core/intent-classifier.js`：LLM-backed intent classifier，把短输入转换成结构化任务意图。
- `src/core/text-tool-parser.js`：兼容非 function calling 模型的文本工具调用解析。
- `src/core/tool-registry.js`：工具注册、查找、执行和 function definitions 输出。
- `src/prompts/system-prompt.js`：系统提示、工具使用规范、Web 查询和编码方法论约束。
- `src/tools/web/web-tools.js`：`web_search`、`web_fetch`、`browser_open`。
- `src/tools/skills/*.js`：AI Engineering Mastery 方法论工具。
- `test-integration.mjs`：端到端集成测试套件。

## 方法论

Agent 的工程方法论可以概括为六步：

1. **识别意图**：先判断用户是在问实时信息、做本地文件任务、运行终端、写代码、解释概念，还是普通聊天。
2. **选择最小工具路径**：能用结构化工具就不用猜；实时信息走 `web_search -> web_fetch`，本地信息走文件/终端工具。
3. **先理解再修改**：编码任务先读相关文件和上下文，避免凭空生成。
4. **小步修改**：只改完成任务需要的文件，不做无关重构。
5. **证据验证**：运行测试、lint、构建、Bun 语法/打包检查或 `verify/review`，失败则继续修复。
6. **收口清楚**：最终答案说明改了什么、验证了什么、还有什么风险或限制。

实际运行时采用“证据型守门”，而不是固定死板的流程编排：

- 系统提示会鼓励新功能先 `brainstorm`、实现时用 `tdd`、完成前 `verify`。
- Agent completion gate 的强制条件更宽松：非平凡编码任务需要至少一个成功的方法论工具证据，但不强制必须是 `brainstorm` 或 `tdd`。
- 变更后的验证可以是 `verify` / `review`，也可以是等价的 fresh verification command，例如 `bun test`、`bun run lint`、`tsc`、`pytest`、`lint` 等。
- 小型、显然的单文件任务可以跳过部分方法论工具，但仍应读回结果并给出验证证据。

方法论工具的推荐用法：

- `setup`：项目缺少上下文文档时初始化。
- `diagnose`：排查 bug、异常、失败日志。
- `grill`：需求含糊、假设多、风险高时追问和拆解。
- `zoom_out`：跨模块、大范围或架构影响的修改前先看全局。
- `brainstorm`：非平凡功能设计前比较方案。
- `tdd`：需要测试驱动或明确红绿重构流程时使用。
- `review`：修改后做代码审查。
- `verify`：结束前汇总证据，确认是否真的完成。

## Web 搜索策略

`web_search` 默认顺序：

1. Bing localized search：`mkt=zh-CN&setlang=zh-CN`
2. DuckDuckGo Lite
3. DuckDuckGo HTML

搜索结果只提供标题、摘要和 URL。遇到天气、新闻、价格、汇率、文档变更等时效信息，Agent 应先 `web_search`，再对最相关结果调用 `web_fetch` 获取可引用内容。

如果 Bing 请求成功但解析不到结果，会记录 provider no-results 事件并继续 fallback。这个 fallback 是可接受行为，不代表没有优先尝试 Bing。

## 上下文管理

当前 Agent 自动上下文管理由 `SessionManager` 保存会话，并在接近上下文窗口时调用 `DynamicContextPruning`：

- token 数量使用 CJK-aware fallback 估算
- 超过模型上下文窗口 80% 时触发裁剪
- 裁剪目标约为窗口 60%，并保留 system prompt、重要消息和最近消息
- `SessionManager` 会在动态裁剪后再次确保至少保留最近 6 条消息，避免 continuation prompt 或当前用户请求被剪掉

`DynamicContextPruning` 支持重要性评分、recent/system message 保留、压缩建议和更细的 token counter。`Tokenizer` 仍是独立能力和测试对象，目前没有作为 `SessionManager` 的默认精确 tokenizer。

## 调试策略

默认 `.env`：

```env
DEBUG=false
```

常用方式：

```bash
bun start                 # 默认安静运行
bun run start:debug       # 启动时打开 DEBUG 和 AGENT_TRACE
```

运行中：

```text
/debug on
/debug off
/debug
```

说明：

- `DEBUG=true` 会显示 Agent 生命周期、LLM request/response、工具调用、Web provider 等 `🔍` 日志。
- `AGENT_TRACE=true` 用于 provider 层 trace；UI debug 不会再仅因 `AGENT_TRACE=true` 自动刷屏。

## 快速开始

开发环境可以在项目目录使用 `.env`：

```bash
git clone <repository-url>
cd ai-engineering-mastery-agent
bun install
cp .env.example .env
```

编辑 `.env`，至少配置模型：

```env
MODEL_PROVIDER=openai
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4
DEBUG=false
```

启动：

```bash
bun start
```

通过 `.deb`、`.pkg`、`.msi` 安装后，也可以直接运行 `agent`。如果没有配置 `.env` 或环境变量，交互式终端会进入首次启动向导，选择 provider、填写 API Key、Base URL、模型和工作目录，并写入用户配置文件。

配置加载优先级：

1. 系统环境变量
2. 当前运行目录的 `.env`
3. 用户配置目录的 `.env`

用户配置目录默认位置：

- macOS / Linux: `~/.config/ai-engineering-mastery-agent/.env`
- Windows: `%APPDATA%\ai-engineering-mastery-agent\.env`

可以用 `AGENT_CONFIG_DIR=/path/to/config-dir` 改写用户配置目录。

## 常用命令

```bash
bun start               # 运行 CLI Agent
bun run start:debug     # 带详细调试日志运行
bun run dev             # Bun watch 开发模式
bun test-integration.mjs # 运行完整集成测试
bun run lint            # 运行 ESLint
bun run package:release # 生成当前系统的 dist 分发目录
bunx eslint src/tools/web/web-tools.js
```

## CI / CD

CI 用于验证代码质量，不负责发布：

- `.github/workflows/ci.yml` 在 push 和 pull request 时运行 `bun install --frozen-lockfile`、`bun run lint`、`bun test-integration.mjs`。
- 分支和 PR 都可以跑 CI；这能在合并前发现回归。

CD / Release 用于生成系统安装包：

- `.github/workflows/release.yml` 只在 `main` 相关发布场景生效。
- 手动触发 `workflow_dispatch` 时必须从 `main` 分支启动，只生成可下载 artifacts，不创建 GitHub Release。
- 推送 `v*` tag 时，tag 指向的 commit 必须已经包含在 `origin/main`，然后会在 Linux、macOS、Windows runner 上分别生成系统安装包并发布到 GitHub Release。
- Linux 产物是 `.deb`，安装到 `/usr/lib/ai-engineering-mastery-agent`，并提供 `/usr/bin/agent` 命令。
- macOS 产物是 `.pkg`，安装到 `/usr/local/lib/ai-engineering-mastery-agent`，并提供 `/usr/local/bin/agent` 命令。
- Windows 产物是 `.msi`，安装到 `Program Files`，并将安装目录下的 `bin` 加入系统 `PATH`。
- 安装包内包含 Bun standalone binary、`README.md`、`.env.example` 和 License，不包含 `src/`、`package.json`、lockfile 或 `node_modules`；运行机器不需要额外安装 Node.js 或 Bun。
- PTY 工具不再依赖 `node-pty`。如果配置 `AGENT_PTY_HELPER` 会优先走外部 PTY helper，否则自动使用 pipe fallback，不影响 CLI 启动和普通命令执行。

发布流程示例：

```bash
git checkout main
git pull origin main
git tag v1.0.4
git push origin v1.0.4
```

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AGENT_CONFIG_DIR` | 系统配置目录 | 用户级 `.env` 所在目录 |
| `MODEL_PROVIDER` | `openai` | 模型提供者：`openai`、`llama`、`zhipu`、`deepseek`、`openrouter` |
| `OPENAI_API_KEY` / `ZHIPU_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` | 无 | 对应 provider 的必要密钥 |
| `OPENAI_MODEL` / `ZHIPU_MODEL` / `DEEPSEEK_MODEL` / `OPENROUTER_MODEL` / `MODEL` | provider 默认值 | 模型名 |
| `OPENAI_BASE_URL` / `OPENAI_API_URL` | `https://api.openai.com/v1` | OpenAI-compatible API 地址 |
| `ZHIPU_BASE_URL` / `DEEPSEEK_BASE_URL` / `OPENROUTER_BASE_URL` | provider 默认值 | 对应 provider API 地址 |
| `MAX_ITERATIONS` | `10` | 每次任务最大 ReAct 轮数 |
| `MAX_TOKENS` | `2048` | 单次模型输出 token 上限 |
| `TEMPERATURE` | `0.7` | 采样温度 |
| `WORKING_DIRECTORY` | 当前目录 | Agent 工具工作的目录 |
| `DEBUG` | `false` | UI debug 日志开关 |
| `INTENT_CLASSIFICATION` | `true` | 是否启用意图识别层 |

## 项目结构

```text
ai-engineering-mastery-agent/
├── src/
│   ├── cli/                 # CLI UI、slash command、增强命令
│   ├── core/                # ReActAgent、Session、ToolRegistry、IntentClassifier、TextToolParser
│   ├── errors/              # 错误分类、重试、timeout
│   ├── eval/                # Agent eval runner
│   ├── mcp/                 # MCP client / adapter
│   ├── memory/              # 记忆和语义搜索支持
│   ├── models/              # OpenAI / Llama / Zhipu / DeepSeek / OpenRouter provider
│   ├── planner/             # 图任务规划器
│   ├── prompts/             # 系统提示
│   ├── sandbox/             # 安全执行层
│   ├── scheduler/           # 自动化与任务调度
│   └── tools/               # 文件、系统、Web、MCP、方法论工具
├── eval/golden_cases/       # 黄金用例
├── workspace/               # 默认工作区
├── test-integration.mjs     # 集成测试入口
├── package.json
├── bun.lock
└── README.md
```

## 近期重要行为

- 短中文天气输入会被识别成 `weather_query`，并推荐 `web_search`。
- `web_search` 默认优先 Bing，中文查询使用本地化 Bing 参数。
- `<tool_code>print(list_files("."))</tool_code>` 等上游工具代码会被解析成真实工具调用，不会再泄漏成 Final Answer。
- 如果模型输出未能解析的工具语法，Agent 会要求重发合法工具调用，而不是直接结束。
- 默认关闭 debug，避免正常使用时被 `🔍` 日志刷屏。

## 当前限制和 TODO

- **精确 token 计算**：项目有 `Tokenizer` 模块和相关测试，但 `SessionManager` 默认仍使用同步 fallback counter，没有接入 provider-specific 精确 tokenizer。
- **方法论强制程度**：运行时守门验证“是否有方法论/改动/验证证据”，不保证严格按照 `brainstorm -> tdd -> review -> verify` 的固定顺序执行。
- **SubAgent / Multi-Agent**：已有 `spawn -> execute -> get_result -> cleanup` 集成测试；下一步可继续补并发、失败恢复、嵌套 SubAgent 的 E2E。
- **Lint 清洁度**：`bun run lint` 已可通过，但仓库仍有较多历史 warning，后续可逐步清理到 warning-free。
- **CI/CD 覆盖**：已添加 GitHub Actions 跑 CI 和跨系统 release packaging；如果仓库策略需要更严格质量门，可继续加覆盖率、eval 和签名/校验和。

## 测试状态

当前主要回归入口：

```bash
bun test-integration.mjs
```

最近一次相关验证覆盖：

- Web 搜索 Bing 优先和中文 Bing 解析
- 意图分类和天气查询 routing hint
- `<tool_code>` 工具调用解析
- 编码任务守门和自动任务编排
- `DynamicContextPruning` 接入 Agent 自动上下文裁剪
- Tokenizer / TokenScope 独立模块能力
- SecurityPolicy 工具审批拦截和结果截断
- SubAgent 同步执行、结果返回和清理链路

## License

MIT
