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
  'session.new': {
    surface: 'inspector-history',
    outcome: 'create-session',
    feedback: 'toast',
  },
  'session.switch': {
    surface: 'inspector-history',
    outcome: 'load-session',
    feedback: 'workspace',
  },
  'session.delete': {
    surface: 'inspector-history',
    outcome: 'delete-session',
    feedback: 'toast',
  },
  'session.bulk-delete': {
    surface: 'inspector-history',
    outcome: 'delete-sessions',
    feedback: 'toast',
  },
  'session.fork': {
    surface: 'inspector-history',
    outcome: 'fork-session',
    feedback: 'toast',
  },
  'session.clear-history': {
    surface: 'inspector-history',
    outcome: 'clear-all-sessions',
    feedback: 'toast',
  },
  'session.load-more': {
    surface: 'inspector-history',
    outcome: 'load-more-sessions',
    feedback: 'inline',
  },
  'rag.add-documents': {
    surface: 'inspector-rag',
    outcome: 'upload-rag-documents',
    feedback: 'toast',
  },
  'rag.initialize-index': {
    surface: 'inspector-rag',
    outcome: 'build-rag-index',
    feedback: 'toast',
  },
  'rag.remove-document': {
    surface: 'inspector-rag',
    outcome: 'remove-rag-document',
    feedback: 'toast',
  },
  'rag.reset': {
    surface: 'inspector-rag',
    outcome: 'reset-rag',
    feedback: 'toast',
  },
  'rag.insert-doc-search': {
    surface: 'inspector-rag',
    outcome: 'insert-doc-search-command',
    feedback: 'composer',
  },
  'preview.start': {
    surface: 'inspector-preview',
    outcome: 'start-preview-server',
    capability: 'preview.viewer',
    feedback: 'inspector',
  },
  'preview.stop': {
    surface: 'inspector-preview',
    outcome: 'stop-preview-server',
    feedback: 'inspector',
  },
  'preview.refresh': {
    surface: 'inspector-preview',
    outcome: 'refresh-preview-frame',
    feedback: 'inline',
  },
  'preview.open-url': {
    surface: 'inspector-preview',
    outcome: 'navigate-preview',
    feedback: 'inspector',
  },
  'project-tree.refresh': {
    surface: 'sidebar-project',
    outcome: 'refresh-directory',
    capability: 'workspace.files',
    feedback: 'inline',
  },
  'project-tree.create-file': {
    surface: 'sidebar-project',
    outcome: 'create-file',
    capability: 'workspace.files',
    feedback: 'toast',
  },
  'project-tree.create-directory': {
    surface: 'sidebar-project',
    outcome: 'create-directory',
    capability: 'workspace.files',
    feedback: 'toast',
  },
  'project-tree.rename': {
    surface: 'sidebar-project',
    outcome: 'rename-item',
    capability: 'workspace.files',
    feedback: 'toast',
  },
  'project-tree.delete': {
    surface: 'sidebar-project',
    outcome: 'delete-item',
    capability: 'workspace.files',
    feedback: 'toast',
  },
  'runtime.select-model': {
    surface: 'composer-runtime',
    outcome: 'switch-model',
    capability: 'agent.runtime',
    feedback: 'toast',
  },
  'runtime.set-thinking': {
    surface: 'composer-runtime',
    outcome: 'set-thinking-level',
    capability: 'agent.runtime',
    feedback: 'toast',
  },
  'runtime.load-models': {
    surface: 'composer-runtime',
    outcome: 'load-available-models',
    capability: 'agent.runtime',
    feedback: 'inline',
  },
  'file-workbench.save': {
    surface: 'file-workbench',
    outcome: 'save-file',
    capability: 'workspace.files',
    feedback: 'toast',
  },
  'working-directory.change': {
    surface: 'sidebar',
    outcome: 'switch-working-directory',
    capability: 'workspace.files',
    feedback: 'toast',
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

export function transitionUiActionState(current = {}, event, detail = {}) {
  const status = current.status || UI_ACTION_STATUS.READY;
  if (event === 'facts_changed') {
    return { status: UI_ACTION_STATUS.READY, reason: '' };
  }
  if (event === 'admit') {
    return status === UI_ACTION_STATUS.BLOCKED
      ? current
      : { status: UI_ACTION_STATUS.RUNNING, reason: '' };
  }
  if (event === 'succeed' && status === UI_ACTION_STATUS.RUNNING) {
    return { status: UI_ACTION_STATUS.SUCCEEDED, reason: '' };
  }
  if (event === 'fail' && status === UI_ACTION_STATUS.RUNNING) {
    return {
      status: UI_ACTION_STATUS.FAILED,
      reason: detail.reason || '操作失败',
    };
  }
  if (
    ['acknowledge', 'dismiss', 'retry', 'recover'].includes(event)
    && [UI_ACTION_STATUS.SUCCEEDED, UI_ACTION_STATUS.FAILED].includes(status)
  ) {
    return { status: UI_ACTION_STATUS.READY, reason: '' };
  }
  return current;
}
