import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../context/ToastContext.tsx';

/** Avoid duplicate toasts under React StrictMode double-mount and single-flight the banner per waiting SW. */
let needRefreshPromptShown = false;

export function PwaUpdatePrompt(): null {
  const toast = useToast();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  const updateServiceWorkerRef = useRef(updateServiceWorker);
  updateServiceWorkerRef.current = updateServiceWorker;

  useEffect(() => {
    if (!needRefresh) {
      needRefreshPromptShown = false;
      return;
    }
    if (needRefreshPromptShown) return;
    needRefreshPromptShown = true;

    toast.info('A new version is ready. Tap Update to reload.', {
      action: {
        label: 'Update',
        onClick: () => {
          void updateServiceWorkerRef.current(true);
        },
      },
    });
  }, [needRefresh, toast]);

  return null;
}
