/**
 * 诊断脚本：验证 useIPC.js 的纯函数核心（不依赖 React / Electron）
 * - 模拟 "window.electronAPI 正常" 场景
 * - 模拟 "window.electronAPI 缺少" 场景
 * - 模拟 "connect 抛出错误" 场景
 */

import { connectElectronAPI, hasElectronAPI, getElectronAPI } from './renderer/hooks/useIPC.js';

async function runDiagnosis() {
  console.log('========== IPC Hook 诊断 ==========');

  // 场景 1：没有 window.electronAPI
  console.log('\n[场景 1] 没有 window.electronAPI');
  globalThis.window = {};
  try {
    const r1 = await connectElectronAPI();
    console.log('  connectElectronAPI() 返回:', r1 === null ? 'null ✅ (预期)' : r1);
    console.log('  hasElectronAPI():', hasElectronAPI());
    console.log('  getElectronAPI():', getElectronAPI());
  } catch (err) {
    console.log('  抛出错误:', err.message);
  }

  // 场景 2：window.electronAPI 正常
  console.log('\n[场景 2] window.electronAPI 正常');
  globalThis.window = {
    electronAPI: {
      connect: async () => ({ success: true, windowId: 1 }),
      invoke: async (channel, ...args) => ({ channel, args }),
      on: (channel, cb) => () => {},
      once: (channel, cb) => Promise.resolve(null),
      send: (channel, data) => {},
      disconnect: () => {},
      getPlatform: () => ({ platform: 'darwin' }),
      getVersions: () => ({ electron: 'test' }),
    },
  };
  try {
    console.log('  hasElectronAPI():', hasElectronAPI());
    const r2 = await connectElectronAPI({
      onConnected: (info) => console.log('  onConnected 回调 ✅:', info),
    });
    console.log('  connectElectronAPI() 返回:', r2);
  } catch (err) {
    console.log('  抛出错误:', err.message);
  }

  // 场景 3：connect 抛出错误
  console.log('\n[场景 3] connect 抛出错误');
  globalThis.window = {
    electronAPI: {
      connect: async () => { throw new Error('测试：主进程拒绝连接'); },
    },
  };
  try {
    const r3 = await connectElectronAPI();
    console.log('  connectElectronAPI() 返回:', r3 === null ? 'null ✅ (预期)' : r3);
  } catch (err) {
    console.log('  抛出错误:', err.message);
  }

  console.log('\n========== 诊断完成 ==========');
}

runDiagnosis().catch(err => {
  console.error('诊断脚本异常:', err);
  process.exit(1);
});
