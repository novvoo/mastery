import { handleFileDiff } from './workspace-handlers.js';

export async function handleActivityUndo(payload = {}, { engine, broadcast }) {
  const activity = payload?.activity || payload || {};
  const target = String(activity.target || payload?.target || '').trim();
  const diff = target ? await handleFileDiff({ path: target }, { engine }) : null;
  const result = {
    success: true,
    action: 'undo',
    mode: payload?.confirm === true ? 'not_implemented' : 'prepare',
    requiresConfirmation: payload?.confirm !== true,
    activity,
    target,
    diff: diff?.diff || '',
    hasDiff: Boolean(diff?.hasDiff),
    message:
      payload?.confirm === true
        ? '结构化撤销通道已接收确认，但自动写回尚未启用。'
        : '已准备撤销信息，请确认后再执行写回。',
  };
  broadcast('activity:undo', result);
  return result;
}

export async function handleActivityReview(payload = {}, { engine, broadcast }) {
  const activity = payload?.activity || payload || {};
  const target = String(activity.target || payload?.target || '').trim();
  const diff = target ? await handleFileDiff({ path: target }, { engine }) : null;
  const result = {
    success: true,
    action: 'review',
    activity,
    target,
    diff: diff?.diff || '',
    hasDiff: Boolean(diff?.hasDiff),
    message: diff?.hasDiff ? '已获取文件 diff，可在 UI 中审核。' : '没有可显示的未提交 diff。',
  };
  broadcast('activity:review', result);
  return result;
}

export async function handleActivityApprove(payload = {}, { engine, broadcast }) {
  const activity = payload?.activity || payload || {};
  const input = String(payload?.input || payload?.answer || '').trim() || '我确认继续。';
  const result = engine
    ? await engine.processInput(input, {
        continuation: true,
        activityAction: 'approve',
        activity,
      })
    : { success: false, error: '引擎未初始化' };
  broadcast('activity:approve', {
    success: result?.success !== false,
    action: 'approve',
    activity,
    result,
  });
  return result;
}
