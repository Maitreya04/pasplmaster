export interface NumpadProps {
  display: string;
  onKey: (key: string) => void;
  onConfirm: () => void;
  confirmLabel: string;
  tone?: 'default' | 'amber';
  /** Prefix shown before display (e.g. ₹ for MRP entry). */
  prefix?: string;
  /** When true, omit the confirm button — parent renders it in a sticky footer. */
  hideConfirm?: boolean;
}

export function Numpad({
  display,
  onKey,
  onConfirm,
  confirmLabel,
  tone = 'default',
  prefix,
  hideConfirm = false,
}: NumpadProps): React.JSX.Element {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, '00', 0, '⌫'] as const;
  const isAmber = tone === 'amber';

  return (
    <>
      <div className="mb-2 text-right sm:mb-3">
        <div
          className={`pick-sheet-display inline-flex items-baseline justify-end gap-1 font-mono font-extrabold tracking-tight ${
            isAmber ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-accent)]'
          }`}
        >
          {prefix ? (
            <span className="text-[0.45em] font-medium text-[var(--content-tertiary)]">{prefix}</span>
          ) : null}
          <span>{display || '0'}</span>
        </div>
      </div>
      <div className={`pick-numpad-grid ${hideConfirm ? '' : 'mb-3'}`}>
        {keys.map((k) => (
          <button
            key={String(k)}
            type="button"
            onClick={() => onKey(String(k))}
            className={`pick-numpad-key rounded-xl border font-mono font-extrabold pick-pressable ${
              k === '⌫'
                ? isAmber
                  ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]'
                : isAmber
                  ? 'border-[var(--border-warning)] bg-white text-[var(--content-warning-on-light)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-primary)]'
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      {!hideConfirm ? (
        <button
          type="button"
          onClick={onConfirm}
          className={`w-full rounded-xl py-4 text-base font-extrabold text-white pick-pressable ${
            isAmber ? 'bg-[var(--bg-warning)]' : 'bg-[var(--bg-inverse-primary)]'
          }`}
        >
          {confirmLabel}
        </button>
      ) : null}
    </>
  );
}

export function NumpadConfirmButton({
  onConfirm,
  confirmLabel,
  disabled = false,
  tone = 'default',
}: {
  onConfirm: () => void;
  confirmLabel: string;
  disabled?: boolean;
  tone?: 'default' | 'amber';
}): React.JSX.Element {
  const isAmber = tone === 'amber';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onConfirm}
      className={`w-full min-h-[48px] rounded-xl px-2 py-3.5 text-sm font-extrabold leading-snug text-white pick-pressable disabled:opacity-40 sm:min-h-[52px] sm:py-4 sm:text-base ${
        isAmber ? 'bg-[var(--bg-warning)]' : 'bg-[var(--bg-inverse-primary)]'
      }`}
    >
      {confirmLabel}
    </button>
  );
}

export function numKey(key: string, buf: string, setBuf: (v: string | ((p: string) => string)) => void): void {
  if (key === '⌫') {
    setBuf((v) => v.slice(0, -1));
    return;
  }
  if (buf.length < 6) {
    setBuf((v) => v + key);
  }
}
