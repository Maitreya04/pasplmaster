import { Backspace } from '@phosphor-icons/react';
import { appHaptics } from '../../../lib/haptics';

export type NumpadTone = 'default' | 'money' | 'amber' | 'danger' | 'success';
export type NumpadLayout = 'default' | 'deck';

export interface NumpadProps {
  display: string;
  onKey: (key: string) => void;
  tone?: NumpadTone;
  layout?: NumpadLayout;
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
  /** Hint under hero display (e.g. suggested value replace cue). */
  heroHint?: string;
  hideDisplay?: boolean;
  hideKeys?: boolean;
}

const NUMPAD_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'] as const;

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

function keyClass(tone: NumpadTone, key: string | number, layout: NumpadLayout): string {
  const isClear = key === 'C';
  const isBackspace = key === '⌫';
  const isUtility = isClear || isBackspace;

  if (isUtility) {
    return `pick-numpad-key pick-numpad-key--utility ${
      isClear ? 'pick-numpad-key--clear ' : ''
    }${
      tone === 'danger'
        ? 'pick-numpad-key--utility-danger'
        : tone === 'amber'
          ? 'pick-numpad-key--utility-warn'
          : ''
    }`;
  }

  if (tone === 'danger') {
    return 'pick-numpad-key pick-numpad-key--digit pick-numpad-key--digit-danger';
  }
  if (tone === 'success') {
    return 'pick-numpad-key pick-numpad-key--digit pick-numpad-key--digit-success';
  }
  if (tone === 'amber' || tone === 'money') {
    return 'pick-numpad-key pick-numpad-key--digit';
  }

  return layout === 'deck'
    ? 'pick-numpad-key pick-numpad-key--digit'
    : 'pick-numpad-key pick-numpad-key--digit pick-numpad-key--legacy';
}

function keyLabel(key: string | number): React.ReactNode {
  if (key === 'C') {
    return <span className="pick-numpad-clear-label">Clear</span>;
  }
  if (key === '⌫') {
    return <Backspace size={20} weight="bold" aria-hidden />;
  }
  return key;
}

function keyAriaLabel(key: string | number): string {
  if (key === 'C') return 'Clear';
  if (key === '⌫') return 'Backspace';
  return String(key);
}

export function Numpad({
  display,
  onKey,
  tone = 'default',
  layout = 'default',
  prefix,
  emptyPlaceholder = '—',
  heroMoney = false,
  heroQty = false,
  heroSupporting,
  compactHero = false,
  heroHint,
  hideDisplay = false,
  hideKeys = false,
}: NumpadProps): React.JSX.Element {
  const shown = display || emptyPlaceholder;
  const isEmpty = !display;

  const handleKey = (key: string): void => {
    appHaptics.impactLight();
    onKey(key);
  };

  const displayBlock =
    hideDisplay ? null : heroMoney && tone === 'money' ? (
      <div
        className={`pick-mrp-entry-panel mx-auto max-w-sm rounded-2xl border text-center ${
          compactHero ? 'mb-2 px-3 py-2.5' : 'mb-3 px-4 py-5'
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
          <span
            className={`pick-mrp-entry-symbol ${compactHero ? 'pick-mrp-entry-symbol-compact' : ''}`}
            aria-hidden
          >
            ₹
          </span>
          <span>{shown}</span>
        </div>
        {heroHint ? (
          <p className="mt-1.5 font-ds-micro text-[var(--content-tertiary)]">{heroHint}</p>
        ) : isEmpty && !compactHero ? (
          <p className="mt-2 font-ds-micro text-[var(--content-positive)]">Tap the numpad below</p>
        ) : null}
      </div>
    ) : heroQty ? (
      <div
        className={`pick-qty-entry-panel mx-auto w-full rounded-2xl border text-center ${
          compactHero ? 'mb-2 px-3 py-2.5' : 'mb-3 px-4 py-4'
        } ${
          tone === 'danger'
            ? 'pick-qty-entry-panel--danger'
            : tone === 'success'
              ? 'pick-qty-entry-panel--success'
              : isEmpty
                ? 'border-[color-mix(in_srgb,var(--amber-5)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--amber-1)_50%,var(--bg-secondary))]'
                : 'border-[color-mix(in_srgb,var(--amber-5)_35%,var(--border-subtle))] bg-[var(--bg-secondary)] shadow-sm'
        }`}
      >
        <p
          className={`pick-identity-label ${
            tone === 'danger'
              ? 'text-[var(--content-negative)]'
              : tone === 'success'
                ? 'text-[var(--content-positive)]'
                : 'text-[var(--amber-9)]'
          }`}
        >
          Enter qty
        </p>
        <div
          className={`pick-qty-entry-value mt-0.5 font-mono font-extrabold tabular-nums tracking-tight ${displayToneClass(tone)} ${compactHero ? 'pick-qty-entry-value-compact' : ''} ${isEmpty ? 'opacity-70' : ''}`}
        >
          {shown}
        </div>
        {heroSupporting ? (
          <p className="mt-1 font-ds-micro leading-snug text-[var(--content-tertiary)]">
            {heroSupporting}
          </p>
        ) : null}
        {heroHint ? (
          <p className="mt-1 font-ds-micro text-[var(--content-tertiary)]">{heroHint}</p>
        ) : isEmpty && !compactHero ? (
          <p className="mt-2 font-ds-micro text-[var(--content-tertiary)]">Tap the numpad below</p>
        ) : null}
      </div>
    ) : (
      <div className={`text-right ${compactHero ? 'mb-1' : 'mb-2 sm:mb-3'}`}>
        <div
          className={`pick-sheet-display inline-flex items-baseline justify-end gap-1 font-mono font-extrabold tabular-nums tracking-tight ${displayToneClass(tone)} ${isEmpty ? 'opacity-40' : ''}`}
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

  const grid = hideKeys ? null : (
    <div
      className={`pick-numpad-grid ${layout === 'deck' ? 'pick-numpad-grid--deck' : ''} ${
        tone === 'danger' ? 'pick-numpad-grid--danger' : tone === 'success' ? 'pick-numpad-grid--success' : ''
      }`}
    >
      {NUMPAD_KEYS.map((k) => (
        <button
          key={String(k)}
          type="button"
          onClick={() => handleKey(String(k))}
          aria-label={keyAriaLabel(k)}
          className={`${keyClass(tone, k, layout)} pick-pressable`}
        >
          {keyLabel(k)}
        </button>
      ))}
    </div>
  );

  if (layout === 'deck' && !hideDisplay) {
    return (
      <div className="pick-numpad-deck">
        {displayBlock}
        {grid}
      </div>
    );
  }

  return (
    <>
      {displayBlock}
      {grid}
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
      onClick={() => {
        appHaptics.impactMedium();
        onConfirm();
      }}
      className={`pick-numpad-confirm w-full min-h-[44px] rounded-xl px-2 py-3 font-ds-caption-size font-extrabold leading-snug pick-pressable disabled:opacity-40 sm:min-h-[48px] sm:text-base ${toneClass}`}
    >
      <span className="inline-flex items-center justify-center gap-1">
        <span>{labelText}</span>
        {hasArrowSuffix ? (
          <span aria-hidden="true" className="shrink-0">
            →
          </span>
        ) : null}
      </span>
    </button>
  );
}

export type NumKeyOptions = {
  /** When true, the next digit replaces the whole buffer (suggested/prefilled values). */
  replaceOnNextDigit?: { current: boolean };
  maxLength?: number;
};

/** Pure — compute next buffer without setState (avoids stale closures). */
export function nextNumKey(
  key: string,
  buf: string,
  options?: NumKeyOptions,
): string {
  const maxLen = options?.maxLength ?? 6;
  const replaceRef = options?.replaceOnNextDigit;

  if (key === '⌫') {
    if (replaceRef) replaceRef.current = false;
    return buf.slice(0, -1);
  }
  if (key === 'C') {
    if (replaceRef) replaceRef.current = false;
    return '';
  }
  if (!/^\d$/.test(key)) {
    return buf;
  }
  if (replaceRef?.current) {
    replaceRef.current = false;
    return key;
  }
  if (buf.length >= maxLen) {
    return buf;
  }
  return buf + key;
}

/** Apply a numpad key and return the next buffer string. */
export function applyNumKey(
  key: string,
  buf: string,
  setBuf: (v: string | ((p: string) => string)) => void,
  options?: NumKeyOptions,
): string {
  const next = nextNumKey(key, buf, options);
  setBuf(next);
  return next;
}

export function numKey(
  key: string,
  buf: string,
  setBuf: (v: string | ((p: string) => string)) => void,
  options?: NumKeyOptions,
): void {
  applyNumKey(key, buf, setBuf, options);
}
