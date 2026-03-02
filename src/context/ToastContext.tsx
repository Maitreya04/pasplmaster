import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ToastContainer } from '../components/shared/Toast.tsx';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  action?: ToastAction;
}

interface ToastAPI {
  success: (message: string, options?: { action?: ToastAction }) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timeoutRefs.current.get(id);
    if (t) {
      clearTimeout(t);
      timeoutRefs.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type: ToastItem['type'], message: string, options?: { action?: ToastAction }) => {
      const id = String(++counterRef.current);
      const item: ToastItem = { id, type, message, action: options?.action };
      setToasts((prev) => [...prev, item]);
      const t = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timeoutRefs.current.set(id, t);
    },
    [dismiss],
  );

  const api: ToastAPI = {
    success: useCallback(
      (msg: string, options?: { action?: ToastAction }) => show('success', msg, options),
      [show],
    ),
    error: useCallback((msg: string) => show('error', msg), [show]),
    info: useCallback((msg: string) => show('info', msg), [show]),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
