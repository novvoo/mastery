import { useState, useCallback, useRef, useEffect } from 'react';
import {
  UI_ACTION_STATUS,
  getUiAction,
  resolveUiActionState,
  transitionUiActionState,
} from '../app/actions/ui-action-graph.js';

const DEFAULT_AUTO_RESET_MS = 2400;

export function useActionLifecycle(actionId, options = {}) {
  const {
    capabilityGraph,
    contentCount,
    autoReset = true,
    autoResetMs = DEFAULT_AUTO_RESET_MS,
    successMessage,
    failureMessage,
    onSuccess,
    onFailure,
  } = options;

  const actionDef = getUiAction(actionId);
  const initialState = resolveUiActionState(actionId, {
    capabilityGraph,
    contentCount,
  });

  const [state, setState] = useState(initialState);
  const autoResetTimerRef = useRef(null);

  const clearAutoResetTimer = useCallback(() => {
    if (autoResetTimerRef.current) {
      clearTimeout(autoResetTimerRef.current);
      autoResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const resolved = resolveUiActionState(actionId, {
      capabilityGraph,
      contentCount,
      running: state.status === UI_ACTION_STATUS.RUNNING,
    });
    if (
      state.status !== UI_ACTION_STATUS.RUNNING
      && state.status !== UI_ACTION_STATUS.SUCCEEDED
      && state.status !== UI_ACTION_STATUS.FAILED
    ) {
      setState(resolved);
    }
  }, [actionId, capabilityGraph, contentCount, state.status]);

  useEffect(() => () => clearAutoResetTimer(), [clearAutoResetTimer]);

  const setRunning = useCallback(() => {
    clearAutoResetTimer();
    setState((prev) => transitionUiActionState(prev, 'admit'));
  }, [clearAutoResetTimer]);

  const setSucceeded = useCallback((detail = {}) => {
    setState((prev) => transitionUiActionState(prev, 'succeed', detail));
    if (autoReset) {
      clearAutoResetTimer();
      autoResetTimerRef.current = setTimeout(() => {
        setState((prev) => transitionUiActionState(prev, 'acknowledge'));
      }, autoResetMs);
    }
    onSuccess?.(detail);
  }, [autoReset, autoResetMs, clearAutoResetTimer, onSuccess]);

  const setFailed = useCallback((detail = {}) => {
    setState((prev) => transitionUiActionState(prev, 'fail', detail));
    if (autoReset) {
      clearAutoResetTimer();
      autoResetTimerRef.current = setTimeout(() => {
        setState((prev) => transitionUiActionState(prev, 'dismiss'));
      }, autoResetMs);
    }
    onFailure?.(detail);
  }, [autoReset, autoResetMs, clearAutoResetTimer, onFailure]);

  const reset = useCallback(() => {
    clearAutoResetTimer();
    setState(resolveUiActionState(actionId, {
      capabilityGraph,
      contentCount,
    }));
  }, [actionId, capabilityGraph, contentCount, clearAutoResetTimer]);

  const execute = useCallback(
    async (asyncFn) => {
      if (state.status === UI_ACTION_STATUS.RUNNING) return null;
      if (state.status === UI_ACTION_STATUS.BLOCKED) return null;

      setRunning();
      try {
        const result = await asyncFn();
        setSucceeded({ result });
        return { success: true, result };
      } catch (error) {
        const reason = error?.message || failureMessage || '操作失败';
        setFailed({ reason, error });
        return { success: false, error };
      }
    },
    [state.status, setRunning, setSucceeded, setFailed, failureMessage],
  );

  const isReady = state.status === UI_ACTION_STATUS.READY;
  const isBlocked = state.status === UI_ACTION_STATUS.BLOCKED;
  const isRunning = state.status === UI_ACTION_STATUS.RUNNING;
  const isSucceeded = state.status === UI_ACTION_STATUS.SUCCEEDED;
  const isFailed = state.status === UI_ACTION_STATUS.FAILED;
  const isTerminal = isSucceeded || isFailed;

  const feedback = isTerminal ? {
    tone: isSucceeded ? 'success' : 'error',
    message: isSucceeded
      ? (successMessage || '操作成功')
      : (state.reason || failureMessage || '操作失败'),
  } : null;

  return {
    actionId,
    actionDef,
    state,
    status: state.status,
    reason: state.reason,
    isReady,
    isBlocked,
    isRunning,
    isSucceeded,
    isFailed,
    isTerminal,
    feedback,
    setRunning,
    setSucceeded,
    setFailed,
    reset,
    execute,
    buttonProps: {
      disabled: isBlocked || isRunning,
      busy: isRunning,
      title: isBlocked ? state.reason : undefined,
      'data-action-id': actionId,
      'aria-busy': isRunning || undefined,
    },
  };
}

export function useActionRegistry(initialActions = {}, options = {}) {
  const { capabilityGraph, contentCount } = options;
  const [actionStates, setActionStates] = useState({});
  const timersRef = useRef({});

  const getState = useCallback((actionId) => {
    if (actionStates[actionId]) return actionStates[actionId];
    return resolveUiActionState(actionId, { capabilityGraph, contentCount });
  }, [actionStates, capabilityGraph, contentCount]);

  const dispatch = useCallback((actionId, event, detail = {}) => {
    setActionStates((prev) => {
      const current = prev[actionId]
        || resolveUiActionState(actionId, { capabilityGraph, contentCount });
      const next = transitionUiActionState(current, event, detail);
      return { ...prev, [actionId]: next };
    });

    if (timersRef.current[actionId]) {
      clearTimeout(timersRef.current[actionId]);
      timersRef.current[actionId] = null;
    }

    if (event === 'succeed' || event === 'fail') {
      timersRef.current[actionId] = setTimeout(() => {
        setActionStates((prev) => {
          const current = prev[actionId];
          if (!current) return prev;
          const next = transitionUiActionState(
            current,
            event === 'succeed' ? 'acknowledge' : 'dismiss',
          );
          return { ...prev, [actionId]: next };
        });
        timersRef.current[actionId] = null;
      }, DEFAULT_AUTO_RESET_MS);
    }
  }, [capabilityGraph, contentCount]);

  const executeAction = useCallback(
    async (actionId, asyncFn) => {
      const current = getState(actionId);
      if (current.status === UI_ACTION_STATUS.RUNNING) return { success: false };
      if (current.status === UI_ACTION_STATUS.BLOCKED) return { success: false };

      dispatch(actionId, 'admit');
      try {
        const result = await asyncFn();
        dispatch(actionId, 'succeed', { result });
        return { success: true, result };
      } catch (error) {
        dispatch(actionId, 'fail', { reason: error?.message || '操作失败', error });
        return { success: false, error };
      }
    },
    [dispatch, getState],
  );

  useEffect(() => {
    setActionStates((prev) => {
      const next = { ...prev };
      for (const actionId of Object.keys(initialActions)) {
        if (!next[actionId]) {
          next[actionId] = resolveUiActionState(actionId, {
            capabilityGraph,
            contentCount,
          });
        }
      }
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
      timersRef.current = {};
    },
    [],
  );

  return {
    getState,
    dispatch,
    executeAction,
    actionStates,
  };
}

export default useActionLifecycle;
