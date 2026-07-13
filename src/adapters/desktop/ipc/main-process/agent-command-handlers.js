import { RuntimeEvent } from '../../../../runtime/types.js';
import { parsePreviewArgs } from '../../protocol/ipc-protocol.js';

export function serializeTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.map(({ handler, execute, fn, ...tool }) => tool);
}

export function handleDebugCommand(input, { engine, broadcast }) {
  const trimmedInput = String(input || '').trim();
  const match = trimmedInput.match(
    /^\/debug(?:\s+(status|on|off|enable|disable|true|false|toggle))?$/i,
  );
  if (!match) {
    return null;
  }

  const action = (match[1] || 'toggle').toLowerCase();
  const current = typeof engine.getDebugMode === 'function' ? engine.getDebugMode() : false;

  let enabled = current;
  if (['on', 'enable', 'true'].includes(action)) {
    enabled = true;
  } else if (['off', 'disable', 'false'].includes(action)) {
    enabled = false;
  } else if (action === 'toggle') {
    enabled = !current;
  }

  if (action !== 'status') {
    engine.setDebugMode(enabled);
    process.env.DEBUG = enabled ? 'true' : 'false';
  }

  const content =
    action === 'status'
      ? `调试模式当前${enabled ? '已开启' : '已关闭'}`
      : `调试模式已${enabled ? '开启' : '关闭'}`;

  broadcast(RuntimeEvent.STATUS_UPDATE, {
    message: content,
    level: enabled ? 'debug' : 'info',
    debug: enabled,
  });

  return {
    success: true,
    localCommand: true,
    command: '/debug',
    debug: enabled,
    content,
  };
}

export async function handlePreviewCommand(input, { engine, broadcast }) {
  const trimmedInput = String(input || '').trim();
  if (!trimmedInput.toLowerCase().startsWith('/preview')) {
    return null;
  }

  parsePreviewArgs(trimmedInput.slice('/preview'.length).trim());
  const preview = { success: false, error: '请使用桌面端预览面板启动或停止预览' };
  broadcast('preview:started', preview);
  return {
    ...preview,
    localCommand: true,
    command: '/preview',
    content: preview.error,
  };
}
