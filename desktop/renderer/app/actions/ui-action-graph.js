export const UI_ACTION_STATUS = Object.freeze({
  READY: 'ready',
  BLOCKED: 'blocked',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
});

export const UI_ACTION_GRAPH = Object.freeze({
  'navigation.new-task': {
    surface: 'sidebar',
    outcome: 'create-session',
    feedback: 'workspace',
  },
  'navigation.open-project': {
    surface: 'sidebar',
    outcome: 'select-working-directory',
    capability: 'workspace.files',
    feedback: 'project-tree',
  },
  'navigation.search-tasks': {
    surface: 'sidebar',
    outcome: 'toggle-task-search',
    feedback: 'inline',
  },
  'navigation.show-tools': {
    surface: 'sidebar',
    outcome: 'show-tool-catalog',
    feedback: 'sidebar-panel',
  },
  'navigation.open-settings': {
    surface: 'sidebar',
    outcome: 'open-settings',
    feedback: 'dialog',
  },
  'workbench.preview': {
    surface: 'topbar',
    outcome: 'open-preview-inspector',
    capability: 'preview.viewer',
    feedback: 'inspector',
  },
  'workbench.export': {
    surface: 'topbar',
    outcome: 'download-conversation',
    requiresContent: true,
    feedback: 'toast',
  },
  'workbench.toggle-sidebar': {
    surface: 'topbar',
    outcome: 'toggle-sidebar',
    feedback: 'pressed-state',
  },
  'workbench.toggle-terminal': {
    surface: 'topbar',
    outcome: 'toggle-terminal',
    capability: 'terminal.execute',
    feedback: 'pressed-state',
  },
  'workbench.toggle-inspector': {
    surface: 'topbar',
    outcome: 'toggle-inspector',
    feedback: 'pressed-state',
  },
  'workbench.clear': {
    surface: 'topbar',
    outcome: 'clear-conversation',
    requiresContent: true,
    feedback: 'toast',
  },
  'composer.add-context': {
    surface: 'composer',
    outcome: 'open-context-menu',
    capability: 'agent.runtime',
    feedback: 'menu',
  },
  'composer.send': {
    surface: 'composer',
    outcome: 'submit-message',
    capability: 'agent.runtime',
    feedback: 'runtime-status',
  },
  'composer.stop': {
    surface: 'composer',
    outcome: 'stop-runtime',
    capability: 'agent.runtime',
    feedback: 'runtime-status',
  },
  'composer.starter.explain': {
    surface: 'empty-state',
    outcome: 'prefill-composer',
    capability: 'agent.runtime',
    feedback: 'composer',
  },
  'composer.starter.fix': {
    surface: 'empty-state',
    outcome: 'prefill-composer',
    capability: 'agent.runtime',
    feedback: 'composer',
  },
  'composer.starter.test': {
    surface: 'empty-state',
    outcome: 'prefill-composer',
    capability: 'agent.runtime',
    feedback: 'composer',
  },
});

export function getUiAction(actionId) {
  return UI_ACTION_GRAPH[actionId] || null;
}

export function resolveUiActionState(actionId, {
  capabilityGraph,
  contentCount = 0,
  running = false,
} = {}) {
  const action = getUiAction(actionId);
  if (!action) {
    return { status: UI_ACTION_STATUS.BLOCKED, reason: '未注册的界面动作' };
  }
  if (running) {
    return { status: UI_ACTION_STATUS.RUNNING, reason: '' };
  }
  if (action.requiresContent && contentCount === 0) {
    return { status: UI_ACTION_STATUS.BLOCKED, reason: '当前没有可操作的内容' };
  }
  if (action.capability && capabilityGraph?.get) {
    const capability = capabilityGraph.get(action.capability);
    if (capability?.status !== 'available') {
      return {
        status: UI_ACTION_STATUS.BLOCKED,
        reason: capability?.reason || `${action.capability} 能力不可用`,
      };
    }
  }
  return { status: UI_ACTION_STATUS.READY, reason: '' };
}
