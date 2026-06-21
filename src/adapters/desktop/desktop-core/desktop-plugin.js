import { HOOKS } from '../../../runtime/index.js';
import { PlatformType } from '../../../runtime/types.js';
import { createPlugin } from '../../../runtime/plugin-system.js';

/**
 * DesktopPlugin - 桌面专用插件
 */
export const DesktopPlugin = createPlugin({
  name: 'desktop',
  version: '1.0.0',
  description: '桌面集成插件 - 提供桌面应用特有的功能',
  
  initialize({ eventBus, engine }) {
    console.log('🖥️  Desktop plugin 已初始化');
    
    // 存储桌面信息
    this.desktopInfo = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions?.electron || 'N/A'
    };
    
    // 注册桌面特有的工具（如果需要）
    this._registerDesktopTools(engine);
  },
  
  // 内部方法：注册桌面工具
  _registerDesktopTools(engine) {
    // 可以在这里注册桌面特有的工具
    // 例如：窗口管理、系统通知、文件对话框等
  },
  
  hooks: {
    [HOOKS.BEFORE_INIT]: async (config) => {
      console.log('🖥️  Desktop plugin - 初始化前检查');
      
      // 验证桌面配置
      if (config.platform !== PlatformType.DESKTOP) {
        console.warn('⚠️  配置的 platform 不是 DESKTOP，将自动调整');
        config.platform = PlatformType.DESKTOP;
      }
    },
    
    [HOOKS.AFTER_INIT]: async (engine) => {
      console.log('🖥️  Desktop plugin - 引擎已初始化');
      
      // 可以在这里添加桌面特有的初始化逻辑
    },
    
    [HOOKS.BEFORE_AGENT_START]: async (input) => {
      console.log('🖥️  Desktop plugin - 代理即将启动');
    },
    
    [HOOKS.AFTER_AGENT_COMPLETE]: async (result) => {
      console.log('🖥️  Desktop plugin - 代理已完成');
    },
    
    [HOOKS.ON_TOOL_ERROR]: async (toolName, error) => {
      console.error(`🖥️  Desktop plugin - 工具错误: ${toolName}`, error.message);
    }
  }
});
