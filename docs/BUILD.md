# AI Engineering Mastery Agent - 统一打包说明

## 概述

AI Engineering Mastery Agent 提供两种使用方式：
1. **CLI 版本** - 命令行界面
2. **Desktop 版本** - Electron 桌面应用

两者共用相同的 Runtime 层代码（`src/runtime/`），确保功能一致性。

## 打包工具

- **CLI**: 使用 `npm pack` 或 `bun pack` 打包成 npm tarball
- **Desktop**: 使用 `electron-builder` 打包成可执行文件

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

**CLI 版本:**
```bash
bun src/index.js
# 或
npm start
```

**Desktop 版本:**
```bash
npm run desktop:dev
```

### 构建

**构建 CLI 包:**
```bash
npm run build:cli
```

**构建 Desktop 应用:**
```bash
npm run desktop:build        # 当前平台
npm run desktop:build:win    # Windows
npm run desktop:build:mac    # macOS
npm run desktop:build:linux  # Linux
npm run desktop:build:all    # 所有平台
```

**构建全部（CLI + Desktop）:**
```bash
npm run build:all
```

### 发布

**发布 CLI 到 npm:**
```bash
npm run release:cli
```

**发布 Desktop 到 GitHub Releases:**
```bash
npm run release:desktop
```

**发布全部:**
```bash
npm run release:all
# 或
npm run publish
```

## 打包产物

构建完成后，产物会输出到以下目录：

- **CLI**: `ai-engineering-mastery-agent-*.tgz`
- **Desktop**: 
  - Windows: `release/win-unpacked/`
  - macOS: `release/mac/`
  - Linux: `release/linux-unpacked/`

## 安装和使用

### CLI 版本

```bash
# 本地安装
npm install ./ai-engineering-mastery-agent-*.tgz

# 全局安装
npm install -g ./ai-engineering-mastery-agent-*.tgz

# 使用
agent "你的问题"
ai-agent "你的问题"
```

### Desktop 版本

```bash
# Windows
./release/win-unpacked/AI\ Engineering\ Mastery\ Agent.exe

# macOS
open ./release/mac/AI\ Engineering\ Mastery\ Agent.dmg

# Linux
./release/linux-unpacked/ai-engineering-mastery-agent
```

## 统一打包架构

```
ai-engineering-mastery-agent/
├── src/
│   ├── runtime/          # ⭐ 共用 Runtime 层
│   ├── cli/              # CLI UI 渲染
│   ├── core/             # 核心业务逻辑
│   └── adapters/         # 平台适配器
├── desktop/             # Electron 应用
│   ├── main.js         # Electron 主进程
│   ├── preload.js      # Preload 脚本
│   └── renderer/       # React UI
├── scripts/            # 打包脚本
│   ├── build-all.js
│   ├── build-cli.js
│   ├── build-desktop.js
│   └── release-*.js
└── package.json        # 统一配置
```

## 技术栈

- **运行时**: Bun / Node.js
- **CLI 渲染**: Chalk, Ora, Boxen, Cli-table3
- **桌面应用**: Electron + React
- **打包工具**: electron-builder, npm pack

## 许可证

MIT License
