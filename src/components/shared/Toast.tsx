import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { ToastItem } from '../../context/ToastContext.tsx';

const dotColorMap: Record<ToastItem['type'], string> = {
  success: 'bg-[var(--bg-positive)]',
  error: 'bg-[var(--bg-negative)]',
  info: 'bg-[var(--bg-accent)]',
};

interface ToastNotificationProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastNotification({ toast, onDismiss }: ToastNotificationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg
        bg-[var(--bg-inverse-primary)] text-[var(--content-inverse-primary)]
        transition-all duration-200 ease-out
        ${visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColorMap[toast.type]}`} />
      <span className="text-sm font-medium flex-1">{toast.message}</span>
      <button
        onClick={handleDismiss}
        className="p-1 rounded opacity-40 hover:opacity-80 transition-opacity duration-150 shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} weight="regular" />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastNotification toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
