import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ToastContainer } from '../components/shared/Toast.tsx';
import { appHaptics } from '../lib/haptics';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  action?: ToastAction;
}

interface ToastAPI {
  success: (message: string, options?: { action?: ToastAction }) => void;
  error: (message: string) => void;
  info: (message: string, options?: { action?: ToastAction }) => void;
  warning: (message: string, options?: { action?: ToastAction }) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const toastKeyByIdRef = useRef<Map<string, string>>(new Map());
  const activeToastIdByKeyRef = useRef<Map<string, string>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timeoutRefs.current.get(id);
    if (t) {
      clearTimeout(t);
      timeoutRefs.current.delete(id);
    }
    const key = toastKeyByIdRef.current.get(id);
    if (key) {
      toastKeyByIdRef.current.delete(id);
      activeToastIdByKeyRef.current.delete(key);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (type: ToastItem['type'], message: string, options?: { action?: ToastAction }) => {
      if (type === 'success') appHaptics.success();
      if (type === 'warning') appHaptics.warning();
      if (type === 'error') appHaptics.error();

      const key = `${type}:${message}`;
      if (activeToastIdByKeyRef.current.has(key)) return;

      const id = String(++counterRef.current);
      const item: ToastItem = { id, type, message, action: options?.action };
      activeToastIdByKeyRef.current.set(key, id);
      toastKeyByIdRef.current.set(id, key);
      setToasts((prev) => [...prev, item]);
      const ms = options?.action ? 6000 : AUTO_DISMISS_MS;
      const t = setTimeout(() => dismiss(id), ms);
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
    info: useCallback(
      (msg: string, options?: { action?: ToastAction }) => show('info', msg, options),
      [show],
    ),
    warning: useCallback(
      (msg: string, options?: { action?: ToastAction }) => show('warning', msg, options),
      [show],
    ),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
