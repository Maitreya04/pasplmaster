import { BottomSheet } from '../../../components/shared';
import { Numpad, NumpadConfirmButton, numKey } from './Numpad';
import { useState } from 'react';

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

  const parsed = parseInt(buf, 10);
  const valid = Number.isFinite(parsed) && parsed > 0;

  const handleClose = (): void => {
    setBuf('');
    onClose();
  };

  const handleConfirm = (): void => {
    if (!valid) return;
    onConfirm(parsed);
    setBuf('');
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title="Fix the price" keepMounted>
      <div className="space-y-4">
        <p className="font-ds-body-size text-[var(--content-secondary)]">
          qty stays at {qty} — only the price changes
        </p>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 font-ds-caption-size text-[var(--content-secondary)]">
          The {qty} {uom} you already typed are kept. Update the price and continue.
        </div>
        <div className="flex items-center justify-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4">
          <div className="min-w-0 flex-1 text-center">
            <p className="font-ds-label-size font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Was
            </p>
            <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-[var(--content-secondary)] line-through decoration-[var(--content-quaternary)]">
              ₹{Math.round(oldMrp)}
            </p>
          </div>
          <span className="shrink-0 font-ds-body-size text-[var(--content-quaternary)]" aria-hidden="true">
            →
          </span>
          <div className="min-w-0 flex-1 text-center">
            <p className="font-ds-label-size font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Now
            </p>
            <p
              className={`mt-1 font-mono text-2xl font-extrabold tabular-nums ${
                valid ? 'text-content-signal-ok' : 'text-[var(--content-quaternary)]'
              }`}
            >
              {valid ? `₹${parsed}` : '—'}
            </p>
          </div>
        </div>
        <div className="text-center">
          <p className="font-ds-caption-size font-semibold text-[var(--content-secondary)]">
            New price on the label?
          </p>
          <Numpad
            display={buf}
            tone="money"
            prefix="₹"
            onKey={(k) => numKey(k, buf, setBuf)}
          />
        </div>
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
      </div>
    </BottomSheet>
  );
}
