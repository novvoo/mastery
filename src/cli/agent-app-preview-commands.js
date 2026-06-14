import { enhancedUI } from './enhanced-ui.js';
import { listPreviews, startPreview, stopPreview } from '../core/preview-server.js';

export async function handlePreviewCommand(agent, argsText = '') {
  const args = parseArgs(argsText || '');
  const subcommand = (args[0] || 'start').toLowerCase();

  if (['help', '--help', '-h'].includes(subcommand)) {
    showPreviewHelp();
    return;
  }

  if (subcommand === 'list') {
    const previews = listPreviews();
    if (previews.length === 0) {
      enhancedUI.info('No active preview sessions.');
      return;
    }
    for (const preview of previews) {
      enhancedUI.info(`${preview.session_id} ${preview.mode} ${preview.url}`);
    }
    return;
  }

  if (subcommand === 'stop') {
    const sessionId = args[1];
    if (!sessionId) {
      enhancedUI.info('Usage: /preview stop <session-id>');
      return;
    }
    const result = stopPreview(sessionId);
    if (result.success) {
      enhancedUI.success(`Preview stopped: ${sessionId}`);
    } else {
      enhancedUI.warning(result.error);
    }
    return;
  }

  const kind = ['static', 'node', 'auto'].includes(subcommand) ? subcommand : 'auto';
  const target = ['static', 'node', 'auto'].includes(subcommand)
    ? (args[1] || '.')
    : (args[0] || '.');
  const command = kind === 'node' && args.length > 2 ? args.slice(2).join(' ') : undefined;
  const spinner = enhancedUI.spinner('Starting preview...');
  spinner.start();
  try {
    const preview = await startPreview({
      workingDirectory: agent.workingDir,
      target,
      kind,
      command,
    });
    spinner.stop();
    enhancedUI.success(`Preview ready: ${preview.url}`);
    enhancedUI.info(`Session: ${preview.session_id} (${preview.mode})`);
  } catch (error) {
    spinner.stop();
    enhancedUI.error(`Preview failed: ${error.message}`);
  }
}

function showPreviewHelp() {
  console.log(enhancedUI.createHeader('Command Help: Preview'));
  console.log('Start, list, or stop local preview sessions.');
  console.log('');
  console.log('Usage:');
  console.log('  /preview [target]');
  console.log('  /preview list');
  console.log('  /preview stop <session-id>');
  console.log('');
}

function parseArgs(text) {
  return text.split(/\s+/).filter(Boolean);
}
