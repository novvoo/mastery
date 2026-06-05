# Build Resources

此文件夹包含应用的图标和其他构建资源文件。

## 图标文件

请将以下图标文件放置在此目录中：

- `icon.icns` - macOS 应用图标（1024x1024px）
- `icon.ico` - Windows 应用图标（256x256px 包含多个尺寸）
- `icon.png` - Linux 应用图标（512x512px）

### 图标制作工具

- macOS: 使用 [Iconverter](https://iconverticons.com) 或 `sips` 命令行工具
- Windows: 使用 [IcoFX](https://icofx.ro)
- 通用: 使用在线工具如 [Convertio](https://convertio.co)

## 可选文件

- `entitlements.mac.plist` - macOS 权限配置（用于代码签名）
- `installer.nsh` - NSIS 安装程序自定义脚本
- `notarize.js` - macOS 公证脚本（仅用于应用商店分发）
