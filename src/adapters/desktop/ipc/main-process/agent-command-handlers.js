import { RuntimeEvent } from '../../../../runtime/types.js';
import {
  listPreviews,
  startPreview,
  stopPreview,
} from '../../../../core/runtime/preview-server.js';
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

  const args = parsePreviewArgs(trimmedInput.slice('/preview'.length).trim());
  const subcommand = (args[0] || 'start').toLowerCase();

  if (subcommand === 'list') {
    return {
      success: true,
      localCommand: true,
      command: '/preview',
      content: 'Active preview sessions',
      previews: listPreviews(),
    };
  }

  if (subcommand === 'stop') {
    const result = stopPreview(args[1]);
    return {
      ...result,
      localCommand: true,
      command: '/preview',
      content: result.success ? `Preview stopped: ${args[1]}` : result.error,
    };
  }

  const kind = ['static', 'node', 'auto'].includes(subcommand) ? subcommand : 'auto';
  const target = ['static', 'node', 'auto'].includes(subcommand) ? args[1] || '.' : args[0] || '.';
  const command = kind === 'node' && args.length > 2 ? args.slice(2).join(' ') : undefined;
  const preview = await startPreview({
    workingDirectory: engine?.getConfig?.().workingDirectory,
    target,
    kind,
    command,
  });
  broadcast('preview:started', preview);
  return {
    ...preview,
    localCommand: true,
    command: '/preview',
    content: `Preview ready: ${preview.url}`,
  };
}
