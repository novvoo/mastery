# AI Agent Desktop 打包文档

本文档详细介绍如何构建、打包和发布 AI Agent Desktop 桌面应用程序。

## 目录结构

```
workspace/
├── desktop/                    # Electron 桌面应用目录
│   ├── package.json            # Electron 应用配置
│   ├── main.js                 # Electron 主进程
│   ├── preload.js              # preload 脚本（安全暴露 IPC）
│   ├── electron-builder.json   # 打包配置
│   ├── renderer/               # 渲染进程（React UI）
│   │   ├── App.jsx             # 主应用组件
│   │   ├── components/         # UI 组件
│   │   │   ├── AgentControl.jsx    # Agent 控制面板
│   │   │   ├── ToolPanel.jsx       # 工具面板
│   │   │   ├── MessageLog.jsx      # 消息日志
│   │   │   └── StatusBar.jsx       # 状态栏
│   │   └── hooks/              # React Hooks
│   │       ├── useRuntime.js       # Runtime Hook
│   │       ├── useIPC.js           # IPC Hook
│   ├── build/                  # 构建资源（图标等）
│   │   ├── icon.ico            # Windows 图标
│   │   ├── icon.icns           # macOS 图标
│   │   └── icons/              # Linux 图标目录
│   └── dist/                   # 打包输出目录
├── src/                        # Runtime 核心代码
├── tests/
│   └── e2e/                    # 端到端测试
│       └── runtime-e2e.test.js
└── docs/
    └── desktop-packaging.md    # 本文档
```

## 环境准备

### 1. 安装依赖

```bash
# 安装主项目依赖
bun install

# 安装桌面应用依赖
cd desktop
npm install
cd ..
```

### 2. 安装 Electron

```bash
cd desktop
npm install electron --save-dev
npm install electron-builder --save-dev
cd ..
```

### 3. 安装 React 相关依赖

```bash
cd desktop
npm install react react-dom --save
npm install @vitejs/plugin-react vite --save-dev
cd ..
```

## 开发模式

### 启动开发服务器

```bash
# 方式 1: 使用主项目命令
bun run desktop:dev

# 方式 2: 直接进入 desktop 目录
cd desktop
npm run dev
```

开发模式特性：
- 自动打开 DevTools
- 支持热重载
- 加载本地开发服务器 (http://localhost:5173)
- 详细的调试日志

### 开发模式配置

在 `desktop/main.js` 中，开发模式配置：

```javascript
if (this.#config.debug) {
  // 加载本地开发服务器
  this.#mainWindow.loadURL('http://localhost:5173');
  this.#mainWindow.webContents.openDevTools();
}
```

## 构建打包

### 打包命令

```bash
# 构建所有平台
bun run desktop:build:all

# 或单独构建各平台
bun run desktop:build:win    # Windows
bun run desktop:build:mac    # macOS
bun run desktop:build:linux  # Linux
```

### 打包输出

打包后的文件位于 `desktop/dist/` 目录：

```
desktop/dist/
├── AI Agent Desktop-1.0.13-x64-setup.exe    # Windows 安装包
├── AI Agent Desktop-1.0.13-x64-portable.exe # Windows 便携版
├── AI Agent Desktop-1.0.13-x64.dmg          # macOS DMG
├── AI Agent Desktop-1.0.13-x64.zip          # macOS ZIP
├── AI Agent Desktop-1.0.13-x64.AppImage     # Linux AppImage
├── AI Agent Desktop-1.0.13-x64.deb          # Linux Debian 包
├── AI Agent Desktop-1.0.13-x64.rpm          # Linux RPM 包
└── AI Agent Desktop-1.0.13-x64.snap         # Linux Snap 包
```

## 平台特定配置

### Windows 配置

#### NSIS 安装包配置

在 `desktop/electron-builder.json` 中：

```json
{
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "AI Agent Desktop",
    "installerLanguages": ["zh_CN", "en_US"],
    "language": "zh_CN"
  }
}
```

#### Windows 图标

需要准备以下图标文件：
- `desktop/build/icon.ico` - 256x256 或更大的 ICO 格式图标

### macOS 配置

#### DMG 配置

```json
{
  "dmg": {
    "contents": [
      { "x": 130, "y": 220, "type": "file" },
      { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
    ],
    "window": { "width": 540, "height": 380 }
  }
}
```

#### macOS 图标

需要准备以下图标文件：
- `desktop/build/icon.icns` - ICNS 格式图标

#### macOS 权限配置

创建 `desktop/build/entitlements.mac.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

### Linux 配置

#### AppImage 配置

```json
{
  "appImage": {
    "systemIntegration": "ask"
  }
}
```

#### Linux 图标

需要在 `desktop/build/icons/` 目录准备各种尺寸的 PNG 图标：
- 16x16.png
- 32x32.png
- 48x48.png
- 64x64.png
- 128x128.png
- 256x256.png
- 512x512.png

#### Debian 包依赖

```json
{
  "deb": {
    "depends": ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "xtst6"]
  }
}
```

## 图标资源准备

### 图标规格

| 平台 | 格式 | 尺寸 | 文件路径 |
|------|------|------|----------|
| Windows | ICO | 256x256+ | desktop/build/icon.ico |
| macOS | ICNS | 512x512+ | desktop/build/icon.icns |
| Linux | PNG | 多尺寸 | desktop/build/icons/*.png |

### 图标生成工具

推荐使用以下工具生成图标：

1. **electron-icon-builder**
   ```bash
   npm install electron-icon-builder --save-dev
   electron-icon-builder --input=./logo.png --output=./build
   ```

2. **在线工具**
   - https://www.electronforge.io/guides/create-and-add-icons
   - https://icoconvert.com/
   - https://iconverticons.com/online/

## 自动更新配置

### GitHub 发布配置

在 `desktop/electron-builder.json` 中：

```json
{
  "publish": {
    "provider": "github",
    "owner": "ai-agent",
    "repo": "ai-agent-desktop",
    "releaseType": "release"
  }
}
```

### 发布流程

1. **创建 GitHub Release**
   ```bash
   # 打包应用
   bun run desktop:build:all
   
   # 上传到 GitHub
   # 自动发布到 GitHub Releases
   ```

2. **自动更新实现**
   
   在 `desktop/main.js` 中添加自动更新逻辑：

   ```javascript
   import { autoUpdater } from 'electron-updater';
   
   // 设置自动更新
   autoUpdater.setFeedURL({
     provider: 'github',
     owner: 'ai-agent',
     repo: 'ai-agent-desktop'
   });
   
   // 检查更新
   autoUpdater.checkForUpdatesAndNotify();
   ```

## 安全性配置

### Context Isolation

确保 `desktop/main.js` 中启用：

```javascript
webPreferences: {
  nodeIntegration: false,     // 禁用 nodeIntegration
  contextIsolation: true,     // 启用 contextIsolation
  sandbox: true,              // 启用沙箱
  webSecurity: true           // 启用 web 安全
}
```

### preload.js 白名单机制

在 `desktop/preload.js` 中定义允许的 IPC 频道：

```javascript
const ALLOWED_CHANNELS = {
  invoke: ['ipc:connect', 'agent:processInput', ...],
  send: ['ipc:disconnect', ...],
  receive: ['ipc:response', 'ipc:event', ...]
};

function isValidChannel(type, channel) {
  return ALLOWED_CHANNELS[type]?.includes(channel);
}
```

### 安全性最佳实践

1. **禁用 nodeIntegration** - 防止渲染进程直接访问 Node.js
2. **启用 contextIsolation** - 隔离 preload 脚本和渲染进程
3. **使用白名单机制** - 限制可访问的 IPC 频道
4. **验证 IPC 消息** - 验证消息结构和来源
5. **使用沙箱模式** - 限制渲染进程权限

## 测试

### 端到端测试

```bash
# 运行端到端测试
bun run test:e2e

# 监听模式
bun run test:e2e:watch
```

### 测试覆盖范围

端到端测试覆盖：
- Runtime 完整流程（初始化 -> 工具注册 -> 执行 -> 清理）
- CLI 适配器完整流程
- Desktop IPC 适配器完整流程
- 插件系统完整流程
- 事件系统完整流程

## 发布流程

### 1. 准备发布

```bash
# 确保所有测试通过
bun run test:all
bun run test:e2e

# 检查代码质量
bun run lint
bun run format:check
```

### 2. 构建应用

```bash
# 构建所有平台
bun run desktop:build:all

# 或单独构建
bun run desktop:build:win
bun run desktop:build:mac
bun run desktop:build:linux
```

### 3. 测试打包应用

在各个平台上测试打包后的应用：
- Windows: 运行 .exe 安装包
- macOS: 运行 .dmg 并安装
- Linux: 运行 .AppImage 或安装 .deb/.rpm

### 4. 发布到 GitHub

```bash
# 创建 Git 标签
git tag v1.0.13
git push origin v1.0.13

# 上传打包文件到 GitHub Releases
# electron-builder 会自动处理
```

## 常见问题

### 1. 打包失败

**问题**: 打包时提示缺少图标文件

**解决**: 确保在 `desktop/build/` 目录准备好所有图标文件

### 2. macOS 签名失败

**问题**: macOS 应用无法签名

**解决**: 
- 确保 Apple Developer 证书已安装
- 配置正确的 entitlements
- 使用 `electron-builder notarize`

### 3. Windows 安装包过大

**问题**: Windows 安装包体积过大

**解决**:
- 检查 `extraResources` 配置
- 排除不必要的 node_modules
- 使用 `asar` 打包

### 4. Linux AppImage 无法运行

**问题**: AppImage 提示权限不足

**解决**:
```bash
chmod +x AI-Agent-Desktop-1.0.13-x64.AppImage
./AI-Agent-Desktop-1.0.13-x64.AppImage
```

### 5. 自动更新失败

**问题**: 应用无法自动更新

**解决**:
- 检查 GitHub 发布配置
- 确保 `electron-updater` 正确配置
- 检查网络连接

## 性能优化

### 1. 减小包体积

```json
{
  "files": [
    "!**/node_modules/*/{test,__tests__,tests}",
    "!**/*.d.ts",
    "!**/{.DS_Store,.git,.hg}"
  ]
}
```

### 2. 优化启动速度

- 使用 `asar` 打包
- 延迟加载非必要模块
- 优化 React 组件

### 3. 内存优化

- 限制历史记录大小
- 及时清理缓存
- 使用虚拟列表

## 开发建议

### 1. 模块化设计

- 保持组件独立性
- 使用 React Hooks 管理状态
- 分离业务逻辑和 UI

### 2. 错误处理

- 全局错误捕获
- 用户友好的错误提示
- 详细的错误日志

### 3. 用户体验

- 响应式设计
- 加载状态提示
- 操作反馈

## 附录

### 相关文档

- [Electron 官方文档](https://www.electronjs.org/docs)
- [electron-builder 文档](https://www.electron.build/)
- [React 官方文档](https://react.dev/)

### 示例代码

完整的示例代码位于：
- `/workspace/examples/electron-main.js` - Electron 主进程示例
- `/workspace/examples/desktop-integration.js` - Desktop 集成示例
- `/workspace/examples/react-ui-bridge.js` - React UI 桥接示例

### 联系支持

如有问题，请：
1. 查看本文档
2. 搜索 GitHub Issues
3. 提交新的 Issue