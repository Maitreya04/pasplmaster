import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomSheet } from '../../../components/shared';
import { Numpad, NumpadConfirmButton, nextNumKey } from './Numpad';

export interface PriceFixOverlayProps {
  isOpen: boolean;
  qty: number;
  uom: string;
  oldMrp: number;
  onClose: () => void;
  onConfirm: (newMrp: number) => void;
}

export function PriceFixOverlay({
  isOpen,
  qty,
  uom,
  oldMrp,
  onClose,
  onConfirm,
}: PriceFixOverlayProps): React.JSX.Element {
  const [buf, setBuf] = useState('');
  const replaceOnNextDigitRef = useRef(false);
  const [replaceHint, setReplaceHint] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setBuf('');
      replaceOnNextDigitRef.current = false;
      setReplaceHint(false);
      return;
    }
    const rounded = Math.round(oldMrp);
    if (rounded > 0) {
      setBuf(String(rounded));
      replaceOnNextDigitRef.current = true;
      setReplaceHint(true);
    } else {
      setBuf('');
      replaceOnNextDigitRef.current = false;
      setReplaceHint(false);
    }
  }, [isOpen, oldMrp]);

  const parsed = parseInt(buf, 10);
  const valid = Number.isFinite(parsed) && parsed > 0;

  const handleClose = (): void => {
    setBuf('');
    replaceOnNextDigitRef.current = false;
    onClose();
  };

  const handleConfirm = (): void => {
    if (!valid) return;
    onConfirm(parsed);
    setBuf('');
    replaceOnNextDigitRef.current = false;
  };

  const handleKey = useCallback((key: string) => {
    setReplaceHint(false);
    setBuf((current) =>
      nextNumKey(key, current, { replaceOnNextDigit: replaceOnNextDigitRef }),
    );
  }, []);

  const footer = (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={handleClose}
        className="min-h-11 rounded-xl border border-[var(--border-subtle)] font-ds-body-size font-semibold text-[var(--content-secondary)] pick-pressable"
      >
        Cancel
      </button>
      <div className="col-span-2">
        <NumpadConfirmButton
          confirmLabel={valid ? `Update to ₹${parsed} →` : 'Update price →'}
          disabled={!valid}
          onConfirm={handleConfirm}
        />
      </div>
    </div>
  );

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Fix the price"
      keepMounted
      keyboardBehavior="static"
      rootClassName="z-[70]"
      sheetClassName="max-h-[min(92dvh,92vh)] pick-sheet-compact price-fix-sheet"
      contentClassName="pick-sheet-compact !px-3 !pb-2"
      footer={footer}
    >
      <div className="space-y-3">
        <p className="font-ds-caption-size leading-snug text-[var(--content-secondary)]">
          {qty} {uom} kept — update the label price only.
        </p>

        <div className="price-fix-compare flex items-center justify-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5">
          <div className="min-w-0 flex-1 text-center">
            <p className="font-ds-micro font-semibold uppercase tracking-wider text-[var(--content-quaternary)]">
              Was
            </p>
            <p className="mt-0.5 font-mono text-lg font-extrabold tabular-nums text-[var(--content-secondary)] line-through decoration-[var(--content-quaternary)]">
              ₹{Math.round(oldMrp)}
            </p>
          </div>
          <span className="shrink-0 text-sm text-[var(--content-quaternary)]" aria-hidden="true">
            →
          </span>
          <div className="min-w-0 flex-1 text-center">
            <p className="font-ds-micro font-semibold uppercase tracking-wider text-[var(--content-quaternary)]">
              Now
            </p>
            <p
              className={`mt-0.5 font-mono text-lg font-extrabold tabular-nums ${
                valid ? 'text-content-signal-ok' : 'text-[var(--content-quaternary)]'
              }`}
            >
              {valid ? `₹${parsed}` : '—'}
            </p>
          </div>
        </div>

        <Numpad
          display={buf}
          tone="money"
          layout="deck"
          heroMoney
          compactHero
          heroHint={
            replaceHint && buf ? 'Type a digit to replace · then keep typing' : undefined
          }
          emptyPlaceholder="—"
          onKey={handleKey}
        />
      </div>
    </BottomSheet>
  );
}
