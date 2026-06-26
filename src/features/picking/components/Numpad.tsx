export type NumpadTone = 'default' | 'money' | 'amber' | 'danger' | 'success';

export interface NumpadProps {
  display: string;
  onKey: (key: string) => void;
  tone?: NumpadTone;
  /** Prefix shown before display (e.g. ₹ for MRP entry). */
  prefix?: string;
  /** Placeholder when display is empty. */
  emptyPlaceholder?: string;
  /** Large money entry panel with prominent ₹ symbol. */
  heroMoney?: boolean;
  /** Large qty entry panel — mirrors heroMoney for quantity step. */
  heroQty?: boolean;
  /** Secondary line under hero display (e.g. "at ₹200 · MRP batch 1"). */
  heroSupporting?: React.ReactNode;
  /** Tighter hero panel for pinned footer deck. */
  compactHero?: boolean;
  hideDisplay?: boolean;
  hideKeys?: boolean;
}

function displayToneClass(tone: NumpadTone): string {
  switch (tone) {
    case 'money':
      return 'text-content-signal-ok';
    case 'amber':
      return 'text-[var(--content-warning-on-light)]';
    case 'danger':
      return 'text-[var(--content-negative)]';
    case 'success':
      return 'text-[var(--content-positive)]';
    default:
      return 'text-[var(--content-primary)]';
  }
}

function keyToneClass(tone: NumpadTone, key: string | number): string {
  const isClear = key === 'C';
  const isBackspace = key === '⌫';

  if (isBackspace || isClear) {
    return tone === 'amber' || tone === 'danger'
      ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
      : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-secondary)]';
  }

  if (tone === 'amber') {
    return 'border-[var(--border-warning)] bg-white text-[var(--content-warning-on-light)]';
  }

  return 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-primary)]';
}

export function Numpad({
  display,
  onKey,
  tone = 'default',
  prefix,
  emptyPlaceholder = '—',
  heroMoney = false,
  heroQty = false,
  heroSupporting,
  compactHero = false,
  hideDisplay = false,
  hideKeys = false,
}: NumpadProps): React.JSX.Element {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'] as const;
  const shown = display || emptyPlaceholder;
  const isEmpty = !display;

  const displayBlock =
    hideDisplay ? null : heroMoney && tone === 'money' ? (
      <div
        className={`pick-mrp-entry-panel mx-auto max-w-sm rounded-2xl border text-center ${
          compactHero ? 'mb-2 px-3 py-3' : 'mb-3 px-4 py-5'
        } ${
          isEmpty
            ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
            : 'border-[var(--border-positive)] bg-[var(--bg-secondary)] shadow-sm'
        }`}
      >
        <p className="pick-identity-label text-[var(--content-positive)]">Enter MRP</p>
        <div
          className={`pick-mrp-entry-value mt-1 inline-flex items-baseline justify-center gap-1 font-mono font-extrabold tabular-nums tracking-tight ${displayToneClass(tone)} ${compactHero ? 'pick-mrp-entry-value-compact' : ''} ${isEmpty ? 'opacity-70' : ''}`}
        >
          <span className={`pick-mrp-entry-symbol ${compactHero ? 'pick-mrp-entry-symbol-compact' : ''}`} aria-hidden>
            ₹
          </span>
          <span>{shown}</span>
        </div>
        {isEmpty && !compactHero ? (
          <p className="mt-2 font-ds-micro text-[var(--content-positive)]">Tap the numpad below</p>
        ) : null}
      </div>
    ) : heroQty ? (
      <div
        className={`pick-qty-entry-panel mx-auto max-w-sm rounded-2xl border text-center ${
          compactHero ? 'mb-2 px-3 py-3' : 'mb-3 px-4 py-5'
        } ${
          tone === 'danger'
            ? 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)]'
            : tone === 'success'
              ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
              : isEmpty
                ? 'border-[color-mix(in_srgb,var(--amber-5)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--amber-1)_50%,var(--bg-secondary))]'
                : 'border-[color-mix(in_srgb,var(--amber-5)_35%,var(--border-subtle))] bg-[var(--bg-secondary)] shadow-sm'
        }`}
      >
        <p className="pick-identity-label text-[var(--amber-9)]">Enter qty</p>
        <div
          className={`pick-qty-entry-value mt-1 font-mono font-extrabold tabular-nums tracking-tight ${displayToneClass(tone)} ${compactHero ? 'pick-qty-entry-value-compact' : ''} ${isEmpty ? 'opacity-70' : ''}`}
        >
          {shown}
        </div>
        {heroSupporting ? (
          <p className="mt-1.5 font-ds-micro leading-snug text-[var(--content-tertiary)]">
            {heroSupporting}
          </p>
        ) : null}
        {isEmpty && !compactHero ? (
          <p className="mt-2 font-ds-micro text-[var(--content-tertiary)]">Tap the numpad below</p>
        ) : null}
      </div>
    ) : (
      <div className={`text-right ${compactHero ? 'mb-1' : 'mb-2 sm:mb-3'}`}>
        <div
          className={`pick-sheet-display inline-flex items-baseline justify-end gap-1 font-mono font-extrabold tracking-tight ${displayToneClass(tone)} ${isEmpty ? 'opacity-40' : ''}`}
        >
          {prefix ? (
            <span
              className={`text-[0.45em] font-medium ${tone === 'money' ? 'text-content-signal-ok' : 'text-[var(--content-tertiary)]'}`}
            >
              {prefix}
            </span>
          ) : null}
          <span>{shown}</span>
        </div>
      </div>
    );

  return (
    <>
      {displayBlock}
      {hideKeys ? null : (
        <div className="pick-numpad-grid">
          {keys.map((k) => (
            <button
              key={String(k)}
              type="button"
              onClick={() => onKey(String(k))}
              className={`pick-numpad-key rounded-xl border font-mono font-extrabold pick-pressable ${keyToneClass(tone, k)}`}
            >
              {k === 'C' ? 'C' : k}
            </button>
          ))}
        </div>
      )}
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
  tone?: 'default' | 'amber' | 'danger' | 'success';
}): React.JSX.Element {
  const toneClass =
    tone === 'danger'
      ? 'bg-[var(--bg-negative)] text-[var(--content-on-color)]'
      : tone === 'amber'
        ? 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
        : tone === 'success'
          ? 'bg-[var(--bg-positive)] text-[var(--content-on-color)]'
          : 'bg-[var(--bg-inverse-primary)] text-white';

  const hasArrowSuffix = confirmLabel.endsWith(' →');
  const labelText = hasArrowSuffix ? confirmLabel.slice(0, -2) : confirmLabel;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onConfirm}
      className={`w-full min-h-[48px] rounded-xl px-2 py-3.5 text-sm font-extrabold leading-snug pick-pressable disabled:opacity-40 sm:min-h-[52px] sm:py-4 sm:text-base ${toneClass}`}
    >
      <span className="inline-flex items-center justify-center gap-1">
        <span>{labelText}</span>
        {hasArrowSuffix ? <span aria-hidden="true" className="shrink-0">→</span> : null}
      </span>
    </button>
  );
}

export function numKey(
  key: string,
  buf: string,
  setBuf: (v: string | ((p: string) => string)) => void,
): void {
  if (key === '⌫') {
    setBuf((v) => v.slice(0, -1));
    return;
  }
  if (key === 'C') {
    setBuf('');
    return;
  }
  if (buf.length < 6) {
    setBuf((v) => v + key);
  }
}
