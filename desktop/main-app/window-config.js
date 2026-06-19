/**
 * 构建 BrowserWindow 配置（方案 B：透明窗口 + 原生毛玻璃）。
 *
 * 平台策略：
 * - macOS: vibrancy 'under-window' 透桌面壁纸，titleBarStyle 'hiddenInset' 保留红绿灯
 * - Win11: backgroundMaterial 'mica'（旧 Win 忽略，退纯透明）
 * - Linux: 强行 transparent（用户决定；无合成器 WM 可能黑底，已接受）
 *
 * 三平台统一 transparent + 不透明 backgroundColor 清零 + show:false（ready-to-show 防闪烁）。
 *
 * @param {NodeJS.Platform|'darwin'|'win32'|'linux'} platform - process.platform
 * @param {{ width?: number, height?: number, minWidth?: number, minHeight?: number }} base - 基础尺寸
 * @returns {Electron.BrowserWindowConstructorOptions}
 */
export function buildWindowConfig(platform, base = {}) {
  const common = {
    width: base.width || 1400,
    height: base.height || 900,
    minWidth: base.minWidth || 800,
    minHeight: base.minHeight || 600,
    show: false,
    hasShadow: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: true,
  };

  if (platform === 'darwin') {
    return {
      ...common,
      titleBarStyle: 'hiddenInset',
      vibrancy: 'under-window',
      visualEffectState: 'active',
    };
  }

  if (platform === 'win32') {
    return {
      ...common,
      titleBarStyle: 'default',
      backgroundMaterial: 'mica',
    };
  }

  // linux（及其它）：强行透明，无原生材质，无降级
  return {
    ...common,
    titleBarStyle: 'default',
  };
}
