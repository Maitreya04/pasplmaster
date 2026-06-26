import { useCallback, useEffect, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 6000;

export type UndoToastDetail = {
  qty: number;
  uom: string;
  mrp: number;
};

export type UndoToastState = {
  label: string;
  /** When the undo window expires — progress bar animates via CSS, no polling. */
  expiresAt: number;
  /** Bumps on each trigger so the progress bar animation restarts. */
  toastKey: number;
  /** Structured display — qty hero with price subline. */
  detail?: UndoToastDetail;
};

export function useUndoableAction<TPayload>() {
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const payloadRef = useRef<TPayload | null>(null);
  const undoHandlerRef = useRef<((payload: TPayload) => void | Promise<void>) | null>(null);
  const commitDoneRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastKeyRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setToast(null);
    payloadRef.current = null;
    undoHandlerRef.current = null;
    commitDoneRef.current = false;
  }, [clearTimers]);

  const trigger = useCallback(
    async (action: {
      label: string;
      detail?: UndoToastDetail;
      payload: TPayload;
      onCommit: (payload: TPayload) => void | Promise<void>;
      onUndo: (payload: TPayload) => void | Promise<void>;
    }) => {
      clearTimers();
      payloadRef.current = action.payload;
      undoHandlerRef.current = action.onUndo;
      commitDoneRef.current = false;

      toastKeyRef.current += 1;
      const expiresAt = Date.now() + UNDO_WINDOW_MS;
      setToast({
        label: action.label,
        detail: action.detail,
        expiresAt,
        toastKey: toastKeyRef.current,
      });

      try {
        await action.onCommit(action.payload);
        commitDoneRef.current = true;
      } catch {
        dismiss();
        return;
      }

      timerRef.current = setTimeout(() => {
        dismiss();
      }, UNDO_WINDOW_MS);
    },
    [clearTimers, dismiss],
  );

  const runUndo = useCallback(
    async (fallback?: (payload: TPayload) => void | Promise<void>) => {
      const payload = payloadRef.current;
      const handler = undoHandlerRef.current ?? fallback;
      if (!payload || !handler) return;
      clearTimers();
      setToast(null);
      if (commitDoneRef.current) {
        await handler(payload);
      }
      payloadRef.current = null;
      undoHandlerRef.current = null;
      commitDoneRef.current = false;
    },
    [clearTimers],
  );

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { trigger, toast, dismiss, runUndo };
}

export type UseUndoableActionReturn<TPayload> = ReturnType<typeof useUndoableAction<TPayload>>;
