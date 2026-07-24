import React, { createContext, useContext, useCallback } from 'react';
import { useActionRegistry } from '../hooks/useActionLifecycle.js';
import { UI_ACTION_STATUS } from '../app/actions/ui-action-graph.js';

const ActionLifecycleContext = createContext(null);

export function ActionLifecycleProvider({
  children,
  capabilityGraph,
  contentCount = 0,
  onFeedback,
}) {
  const actionRegistry = useActionRegistry({}, {
    capabilityGraph,
    contentCount,
  });

  const executeActionWithFeedback = useCallback(
    async (actionId, asyncFn, feedbackConfig = {}) => {
      const result = await actionRegistry.executeAction(actionId, asyncFn);
      const state = actionRegistry.getState(actionId);

      if (state.status === UI_ACTION_STATUS.SUCCEEDED) {
        const message = feedbackConfig.successMessage || '操作成功';
        onFeedback?.({ tone: 'success', message });
      } else if (state.status === UI_ACTION_STATUS.FAILED) {
        const message = feedbackConfig.failureMessage || state.reason || '操作失败';
        onFeedback?.({ tone: 'error', message });
      }

      return result;
    },
    [actionRegistry, onFeedback],
  );

  const value = {
    ...actionRegistry,
    executeActionWithFeedback,
  };

  return (
    <ActionLifecycleContext.Provider value={value}>
      {children}
    </ActionLifecycleContext.Provider>
  );
}

export function useActionLifecycleContext() {
  const context = useContext(ActionLifecycleContext);
  if (!context) {
    throw new Error('useActionLifecycleContext must be used within ActionLifecycleProvider');
  }
  return context;
}

export function useActionState(actionId) {
  const context = useContext(ActionLifecycleContext);
  if (!context) {
    return { status: UI_ACTION_STATUS.READY, reason: '' };
  }
  // 订阅 actionStates 的变化，确保状态更新时组件重新渲染
  const { actionStates, getState } = context;
  // 读取 actionStates 来触发重新渲染
  const _ = actionStates[actionId];
  return getState(actionId);
}

export default ActionLifecycleContext;
