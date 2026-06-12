interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  isSubmitting = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const confirmClass =
    tone === 'danger'
      ? 'bg-[var(--content-negative)] text-white'
      : 'bg-[var(--content-accent)] text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="ds-card p-6 max-w-md w-full shadow-xl animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="text-base font-bold text-[var(--content-primary)] mb-2">
          {title}
        </h3>
        <p className="text-sm text-[var(--content-secondary)] mb-5">{description}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 ${confirmClass}`}
          >
            {isSubmitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
