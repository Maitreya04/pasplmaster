export interface NumpadProps {
  display: string;
  onKey: (key: string) => void;
  onConfirm: () => void;
  confirmLabel: string;
  tone?: 'default' | 'amber';
  /** When true, omit the confirm button — parent renders it in a sticky footer. */
  hideConfirm?: boolean;
}

export function Numpad({
  display,
  onKey,
  onConfirm,
  confirmLabel,
  tone = 'default',
  hideConfirm = false,
}: NumpadProps): React.JSX.Element {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, '00', 0, '⌫'] as const;
  const isAmber = tone === 'amber';

  return (
    <>
      <div className="mb-3.5 text-right">
        <div
          className={`font-mono text-5xl font-extrabold leading-none tracking-tight ${
            isAmber ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-accent)]'
          }`}
        >
          {display || '0'}
        </div>
      </div>
      <div className={`grid grid-cols-3 gap-2 ${hideConfirm ? '' : 'mb-3'}`}>
        {keys.map((k) => (
          <button
            key={String(k)}
            type="button"
            onClick={() => onKey(String(k))}
            className={`rounded-xl border py-3.5 font-mono text-lg font-extrabold pick-pressable ${
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
      className={`w-full rounded-xl py-4 text-base font-extrabold text-white pick-pressable disabled:opacity-40 ${
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
