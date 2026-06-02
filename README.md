# AI Engineering Mastery Agent

一个面向真实工程任务的本地 ReAct Agent。它把 LLM、意图识别、工具路由、方法论工具、文件/终端/Web 工具、记忆和集成测试组织成一条可验证的执行链路。

当前设计目标不是“让模型自由发挥”，而是让模型在本地运行时里被可靠地引导：先识别任务，选择工具，执行变更，验证结果，最后输出对用户有用的结论。

## 核心能力

- **智能意图识别**：短输入如“上海天气”会先经过 LLM intent classifier，生成结构化 routing hint，再进入 ReAct 循环。明显天气查询有窄兜底，避免模型漏判。
- **按需工具路由**：每轮 LLM request 只暴露当前任务需要的工具子集。工程任务默认使用文件、终端、PTY、方法论和只读 Git 工具；如果任务提到最新资料、浏览器、MCP、后台任务或发布操作，会按需加入 Web、Browser、MCP、调度或 Git 写入工具。
- **轻量任务画像**：明显工程任务会先用本地画像识别，跳过无收益的 intent 预请求，避免首轮在工具很多时等待额外 LLM 调用。
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

- `src/index.js`：CLI 入口、配置加载、工具注册、模型 provider 初始化、slash command、debug 开关。
- `src/core/agent.js`：ReAct 主循环、意图路由注入、工具执行、编码任务守门、自动任务编排、最终答案处理。
- `src/core/intent-classifier.js`：LLM-backed intent classifier，把短输入转换成结构化任务意图。
- `src/core/tool-router.js`：本地任务画像和按需工具路由，避免每轮向模型暴露全量工具。
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
- 工具暴露采用“按需裁剪”而不是“永久隐藏”。例如普通工程任务不会默认暴露 Web/MCP/调度工具，但如果需求里出现“查最新文档”“连接 MCP”“创建后台任务”等信号，对应工具组会加入本轮 function definitions。
- 明显工程任务会跳过 LLM intent classifier 的预请求；天气、新闻、汇率、实时价格等时效性任务仍会使用 intent classifier 或窄兜底生成 routing hint。
- Agent completion gate 的强制条件更宽松：非平凡编码任务需要至少一个成功的方法论工具证据，但不强制必须是 `brainstorm` 或 `tdd`。
- 变更后的验证可以是 `verify` / `review`，也可以是等价的 fresh verification command，例如 `bun test`、`bun run lint`、`tsc`、`pytest`、`lint` 等。
- 对涉及时间、速度、动画、游戏循环、第三方 API、状态转换、并发 I/O 或安全边界的编码任务，Agent 会自动插入 `semantic_risk_review` 编排节点，并要求 `review` / `verify` 覆盖单位、API 参数语义、状态不变量和用户可感知行为。
- 小型、显然的单文件任务可以跳过部分方法论工具，但仍应读回结果并给出验证证据。

语义风险审查不是硬编码某个库的 API 规则。例如不会写死“pygame 的 `clock.tick()` 参数是 FPS”。它做的是通用检查：

- 变量名和数值是否暴露单位，例如 `move_interval_ms`、`target_fps`、`elapsed_ms`
- API 参数语义是否被确认，例如 FPS、毫秒、秒、像素、格子、弧度、角度、超时和重试次数
- 渲染频率是否和业务/模拟更新频率分离
- 状态转换、边界条件和重复操作是否保持不变量
- 验证是否覆盖用户可感知行为，而不只是“代码能运行”

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

当前 Agent 自动上下文管理由 `SessionManager` 保存会话，并在接近上下文窗口时调用 `DynamicContextPruning`。模型上下文窗口由统一的 model capabilities registry 提供：

- 已知模型先使用本地能力表，保证离线启动
- 未知模型默认尝试查询 OpenRouter Models API 和 LiteLLM 公共模型 catalog，获取 `context_length` / `max_input_tokens` 等实时能力信息
- 可用 `MODEL_CONTEXT_WINDOW` / `MODEL_MAX_CONTEXT_TOKENS` 对未知或私有模型强制覆盖上下文窗口
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
- 当前只覆盖 `shell` 工具，不覆盖文件工具、Web 工具、PTY helper 或模型 provider 自身。
- `AGENT_SANDBOX_ALLOWED_DOMAINS` 目前作为配置保留，命令级域名精确放行还未实现。

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

安装后推荐流程：

```bash
agent setup       # 显式运行配置向导
agent doctor      # 检查配置和工作目录
agent             # 启动交互式 Agent
agent --help      # 查看 CLI 用法
agent config-path # 查看用户配置文件位置
```

配置加载优先级：

1. 系统环境变量
2. 当前运行目录的 `.env`
3. 用户配置目录的 `.env`

用户配置目录默认位置：

- macOS / Linux: `~/.config/ai-engineering-mastery-agent/.env`
- Windows: `%APPDATA%\ai-engineering-mastery-agent\.env`

可以用 `AGENT_CONFIG_DIR=/path/to/config-dir` 改写用户配置目录。

## 安装与卸载

从 GitHub Release 下载对应系统安装包：

- macOS Apple Silicon: `ai-engineering-mastery-agent-<version>-darwin-arm64.pkg`
- Linux x64: `ai-engineering-mastery-agent-<version>-linux-x64.deb`
- Windows x64: `ai-engineering-mastery-agent-<version>-win32-x64.msi`

macOS 安装：

```bash
sudo installer -pkg ai-engineering-mastery-agent-<version>-darwin-arm64.pkg -target /
agent --version
```

macOS 卸载：

```bash
sudo rm -rf /usr/local/lib/ai-engineering-mastery-agent
sudo rm -f /usr/local/bin/agent
pkgutil --forget com.novvoo.ai-engineering-mastery-agent 2>/dev/null || true
```

如果 macOS 安装新版本时提示安装包“已损坏”或无法打开，优先卸载旧版本后重新安装。用户配置文件不会被上面的卸载命令删除；需要重置配置时再删除 `~/.config/ai-engineering-mastery-agent/.env`。

Linux 安装与升级：

```bash
sudo apt install ./ai-engineering-mastery-agent-<version>-linux-x64.deb
agent --version
```

Linux 卸载：

```bash
sudo apt remove ai-engineering-mastery-agent
```

Windows 安装：双击 `.msi`，或在管理员 PowerShell 中运行：

```powershell
msiexec /i .\ai-engineering-mastery-agent-<version>-win32-x64.msi
agent --version
```

Windows 卸载：在“设置 → 应用 → 已安装的应用”中卸载，或使用管理员 PowerShell：

```powershell
msiexec /x .\ai-engineering-mastery-agent-<version>-win32-x64.msi
```

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

安装包命令：

```bash
agent setup       # 配置 provider、API Key、模型和工作目录
agent doctor      # 检查必要配置是否齐全
agent config-path # 输出用户级 .env 路径
agent --version   # 输出版本
agent --help      # 输出帮助
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
- 新版本安装包按升级替换旧版本设计：Linux 依赖稳定包名和递增版本升级；macOS 使用稳定 package identifier，并在安装前清理旧安装目录；Windows MSI 使用稳定 `UpgradeCode` 和 `MajorUpgrade`，阻止降级并允许同版本重装。
- 安装包内包含 Bun standalone binary、`README.md`、`.env.example` 和 License，不包含 `src/`、`package.json`、lockfile 或 `node_modules`；运行机器不需要额外安装 Node.js 或 Bun。
- PTY 工具不再依赖 `node-pty`。如果配置 `AGENT_PTY_HELPER` 会优先走外部 PTY helper，否则自动使用 pipe fallback，不影响 CLI 启动和普通命令执行。
- 游戏窗口、dev server、watcher、REPL/TUI 等长驻命令会优先进入可观察、可停止的 PTY session；普通 `shell` 误调用这类命令时，会先由 LLM 基于命令和入口文件内容判断是否应转成 PTY，并提示用 `pty_read` 查看、`pty_stop` 停止，避免等待-超时-重试循环。

发布流程示例：

```bash
git checkout main
git pull origin main
VERSION="$(bun -e "const pkg = await import('./package.json'); console.log(pkg.default.version)")"
git tag "v$VERSION"
git push origin "v$VERSION"
```

不切换当前开发分支时，可以用临时 worktree 完成 main 发布：

```bash
git fetch origin
git worktree add /tmp/ai-engineering-mastery-agent-main origin/main
cd /tmp/ai-engineering-mastery-agent-main
git switch -c main-release origin/main
git merge --ff-only origin/<feature-branch>
git push origin HEAD:main
VERSION="$(bun -e "const pkg = await import('./package.json'); console.log(pkg.default.version)")"
git tag "v$VERSION"
git push origin "v$VERSION"
cd -
git worktree remove /tmp/ai-engineering-mastery-agent-main
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
| `MODEL_CONTEXT_WINDOW` / `MODEL_MAX_CONTEXT_TOKENS` | 自动识别 | 强制指定当前模型上下文窗口 |
| `MODEL_MAX_OUTPUT_TOKENS` | 自动识别或 `8192` | 强制指定当前模型最大输出 token |
| `MODEL_CAPABILITY_LOOKUP` | `true` | 是否允许启动时通过网络查询未知模型能力 |
| `MODEL_CAPABILITY_REFRESH` | `false` | 是否跳过本地已知模型并强制刷新网络能力信息 |
| `MODEL_CAPABILITY_LOOKUP_TIMEOUT_MS` | `3000` | 模型能力网络查询超时时间 |
| `TEMPERATURE` | `0.7` | 采样温度 |
| `WORKING_DIRECTORY` | 当前目录 | Agent 工具工作的目录 |
| `DEBUG` | `false` | UI debug 日志开关 |
| `INTENT_CLASSIFICATION` | `true` | 是否启用意图识别层 |
| `AGENT_SHELL_SANDBOX` | `false` | 是否开启 shell 沙箱 |
| `AGENT_SHELL_SANDBOX_BACKEND` | `auto` | 沙箱后端：`auto`、`seatbelt`、`bubblewrap`、`policy` |
| `AGENT_SHELL_SANDBOX_FAIL_IF_UNAVAILABLE` | `false` | 后端不可用时是否失败关闭 |
| `AGENT_SHELL_SANDBOX_ALLOW_UNSANDBOXED` | `true` | 后端不可用或命令被排除时是否允许无沙箱执行 |
| `AGENT_SHELL_SANDBOX_EXCLUDED_COMMANDS` | 无 | 按系统 path delimiter 分隔的排除命令模式，支持 `*` |
| `AGENT_SANDBOX_ALLOW_READ` | 无 | 预留读路径 allowlist，按系统 path delimiter 分隔 |
| `AGENT_SANDBOX_DENY_READ` | `~/.ssh`、`~/.aws`、`~/.config/gh`、`~/.netrc` | shell 沙箱拒绝读取/引用的敏感路径 |
| `AGENT_SANDBOX_ALLOW_WRITE` | `.` | 允许 shell 写入的路径 |
| `AGENT_SANDBOX_DENY_WRITE` | `~`、`/etc`、`/usr`、`/bin`、`/sbin`、`/System` | 拒绝 shell 写入/引用的路径 |
| `AGENT_SANDBOX_NETWORK` | `false` | 是否允许 shell 网络访问 |
| `AGENT_SANDBOX_ALLOWED_DOMAINS` | 无 | 预留域名 allowlist，当前不做精确命令级放行 |

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
- 未知模型的上下文窗口会优先联网查询 OpenRouter / LiteLLM catalog；需要离线或固定配置时可设置 `MODEL_CAPABILITY_LOOKUP=false` 或 `MODEL_CONTEXT_WINDOW`。
- `<tool_code>print(list_files("."))</tool_code>` 等上游工具代码会被解析成真实工具调用，不会再泄漏成 Final Answer。
- 如果模型输出未能解析的工具语法，Agent 会要求重发合法工具调用，而不是直接结束。
- 默认关闭 debug，避免正常使用时被 `🔍` 日志刷屏。
- Shell 沙箱默认关闭；开启 `AGENT_SHELL_SANDBOX=true` 后会优先使用 macOS Seatbelt 或 Linux bubblewrap，后端不可用时可按配置失败关闭或降级为 policy 预检。

## 当前限制和 TODO

- **精确 token 计算**：项目有 `Tokenizer` 模块和相关测试；模型上下文窗口已支持能力表和网络查询，但 `SessionManager` 默认仍使用同步 fallback counter，没有接入 provider-specific 精确 tokenizer。
- **方法论强制程度**：运行时守门验证“是否有方法论/改动/验证证据”，不保证严格按照 `brainstorm -> tdd -> review -> verify` 的固定顺序执行。
- **SubAgent / Multi-Agent**：已有 `spawn -> execute -> get_result -> cleanup` 集成测试；下一步可继续补并发、失败恢复、嵌套 SubAgent 的 E2E。
- **Lint 清洁度**：`bun run lint` 已可通过，但仓库仍有较多历史 warning，后续可逐步清理到 warning-free。
- **CI/CD 覆盖**：已添加 GitHub Actions 跑 CI 和跨系统 release packaging；如果仓库策略需要更严格质量门，可继续加覆盖率、eval 和签名/校验和。
- **沙箱范围**：Shell 已支持可选沙箱和策略预检，但完整生产级隔离仍建议叠加容器、VM 或远端 microVM；文件工具和 PTY 还没有统一纳入同一沙箱边界。

## 测试状态

当前主要回归入口：

```bash
bun test-integration.mjs
```

最近一次相关验证覆盖：

- Web 搜索 Bing 优先和中文 Bing 解析
- 意图分类和天气查询 routing hint
- `<tool_code>` 工具调用解析
- 模型能力识别、OpenRouter / LiteLLM 上下文窗口查询、`MODEL_CONTEXT_WINDOW` 覆盖
- 编码任务守门和自动任务编排
- `DynamicContextPruning` 接入 Agent 自动上下文裁剪
- Tokenizer / TokenScope 独立模块能力
- SecurityPolicy 工具审批拦截和结果截断
- Shell sandbox policy、网络拦截、写入 allowlist、后端不可用 fail-closed/fallback
- SubAgent 同步执行、结果返回和清理链路

## License

MIT
