import { useState, useCallback } from 'react';

export function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState(null);

  const requestConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmDialog({
        ...options,
        onConfirm: () => {
          setConfirmDialog(null);
          options.onConfirm?.();
          resolve(true);
        },
        onCancel: () => {
          setConfirmDialog(null);
          options.onCancel?.();
          resolve(false);
        },
      });
    });
  }, []);

  return {
    confirmDialog,
    setConfirmDialog,
    requestConfirm,
  };
}
