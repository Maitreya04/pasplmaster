import { useEffect, useState } from 'react';
import { Package } from '@phosphor-icons/react';
import { BottomSheet } from '../shared';
import { Numpad, NumpadConfirmButton, numKey } from '../picker-v10/Numpad';
import { PickSheetContext } from './PickSheetContext';
import { appHaptics } from '../../lib/haptics';

export interface PickQtySheetProps {
  isOpen: boolean;
  /** Pre-filled value — usually remaining qty to pick. */
  initialQty: number;
  targetQty: number;
  pickedQty: number;
  partCode?: string | null;
  rackNo?: string | null;
  /** When picking a split MRP batch. */
  segmentMrp?: number | null;
  lineRemaining?: number;
  onConfirm: (qty: number) => void;
  onOutOfStock: () => void;
  onClose: () => void;
}

/**
 * Warehouse qty entry: numpad-first, with OOS as a separate exception chip (not mixed into the pad).
 */
export function PickQtySheet({
  isOpen,
  initialQty,
  targetQty,
  pickedQty,
  partCode = null,
  rackNo = null,
  segmentMrp = null,
  lineRemaining,
  onConfirm,
  onOutOfStock,
  onClose,
}: PickQtySheetProps): React.JSX.Element | null {
  const [buf, setBuf] = useState('');
  const [oosStep, setOosStep] = useState<'idle' | 'confirm'>('idle');

  const remaining = lineRemaining ?? Math.max(0, targetQty - pickedQty);

  useEffect(() => {
    if (isOpen) {
      setBuf(String(Math.max(0, initialQty)));
      setOosStep('idle');
    }
  }, [isOpen, initialQty]);

  const parsed = parseInt(buf, 10);
  const canConfirm = Number.isFinite(parsed) && parsed > 0;
  const overRemaining = canConfirm && parsed > remaining;

  const handleClose = (): void => {
    setOosStep('idle');
    onClose();
  };

  const handleConfirm = (): void => {
    if (!canConfirm) return;
    appHaptics.success();
    onConfirm(parsed);
    handleClose();
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={segmentMrp != null ? `How many at ₹${Math.round(segmentMrp)}?` : 'Pick quantity'}
      closeOnly
      keyboardBehavior="static"
      sheetClassName="max-h-[min(92dvh,92vh)] pick-sheet-compact"
      contentClassName="pick-sheet-compact"
      footer={
        oosStep === 'idle' ? (
          <NumpadConfirmButton
            onConfirm={handleConfirm}
            confirmLabel={canConfirm ? `Set ${parsed} pcs` : 'Enter qty'}
            disabled={!canConfirm}
          />
        ) : null
      }
    >
      <PickSheetContext partCode={partCode} rackNo={rackNo} />

      <p className="mb-3 text-xs text-[var(--content-tertiary)]">
        {segmentMrp != null
          ? `${remaining} left on this line · enter qty for this MRP batch`
          : pickedQty > 0
            ? `${pickedQty} already picked · ${remaining} left · ${targetQty} on order`
            : `${targetQty} pcs on this line`}
      </p>

      {oosStep === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            appHaptics.warning();
            setOosStep('confirm');
          }}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] py-3.5 text-sm font-bold text-[var(--content-negative)] pick-pressable"
        >
          <Package size={18} weight="fill" />
          Out of stock — can&apos;t pick
        </button>
      ) : (
        <div className="mb-4 rounded-xl border-[1.5px] border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] p-4">
          <p className="text-sm font-bold text-[var(--content-negative)]">Nothing on shelf for this line?</p>
          <p className="mt-1 text-xs text-[var(--content-tertiary)]">
            This flags the line as out of stock. Billing will see it.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setOosStep('idle')}
              className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-3 text-sm font-bold pick-pressable"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                appHaptics.error();
                onOutOfStock();
                handleClose();
              }}
              className="flex-1 rounded-xl bg-[var(--bg-negative)] py-3 text-sm font-bold text-white pick-pressable"
            >
              Yes, flag OOS
            </button>
          </div>
        </div>
      )}

      {oosStep === 'idle' ? (
        <>
          <div className="mb-1 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Pieces picking now
            </p>
          </div>

          {overRemaining ? (
            <p className="mb-2 text-center text-xs font-semibold text-[var(--content-warning-on-light)]">
              Only {remaining} left on line
            </p>
          ) : null}

          <Numpad
            display={buf}
            onKey={(k) => numKey(k, buf, setBuf)}
            onConfirm={handleConfirm}
            confirmLabel={canConfirm ? `Set ${parsed} pcs` : 'Enter qty'}
            hideConfirm
          />
        </>
      ) : null}
    </BottomSheet>
  );
}
