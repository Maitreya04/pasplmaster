import type { StockMrpHistoryEntry } from '../../types';
import type { PickDockStep, PickerV10Line } from './types';

export interface PickDockProps {
  step: PickDockStep;
  item: PickerV10Line;
  mrpHistory: StockMrpHistoryEntry[];
  finalMrp: number | null;
  mrpFlagged: boolean;
  dispQty: number;
  outOfStock: boolean;
  confirming: boolean;
  onVerify: () => void;
  onConfirmMrp: () => void;
  onDone: () => void;
  onFlag: () => void;
}

export function PickDock({
  step,
  item,
  mrpHistory,
  finalMrp,
  mrpFlagged,
  dispQty,
  outOfStock,
  confirming,
  onVerify,
  onConfirmMrp,
  onDone,
  onFlag,
}: PickDockProps): React.JSX.Element {
  const isMultiMrp = mrpHistory.length > 1;
  const latestMrp = mrpHistory[0]?.mrp ?? null;

  if (step === 'verify') {
    const icon = item.verifyMode === 'scan' ? '📷' : item.verifyMode === 'type' ? '⌨' : '◎';
    const hint =
      item.verifyMode === 'scan'
        ? 'Bin has a QR sticker'
        : item.verifyMode === 'type'
          ? 'No QR — read label'
          : 'No scannable code';

    return (
      <div className="px-5 pt-3.5">
        <p className="mb-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Step 1 · Verify item
        </p>
        <button
          type="button"
          onClick={onVerify}
          className="flex w-full items-center justify-between rounded-xl bg-[var(--bg-inverse-primary)] px-5 py-4 pick-pressable"
        >
          <div className="text-left">
            <p className="text-base font-extrabold text-white">
              {icon} Verify item
            </p>
            <p className="mt-0.5 text-[11px] text-white/50">{hint}</p>
          </div>
          <span className="text-xl text-white/45">›</span>
        </button>
      </div>
    );
  }

  if (step === 'mrp') {
    return (
      <div className="px-5 pt-3.5">
        <p className="mb-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Step 2 · {isMultiMrp ? 'Confirm MRP — multiple records found' : 'Confirm MRP'}
        </p>
        <button
          type="button"
          onClick={onConfirmMrp}
          className={`flex w-full items-center justify-between rounded-xl px-5 py-4 pick-pressable ${
            isMultiMrp
              ? 'border-[1.5px] border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
              : 'bg-[var(--bg-inverse-primary)]'
          }`}
        >
          <div className="text-left">
            <p
              className={`text-base font-extrabold ${
                isMultiMrp ? 'text-[var(--content-warning-on-light)]' : 'text-white'
              }`}
            >
              {isMultiMrp
                ? `⚠ ${mrpHistory.length} MRPs in system`
                : '📋 Confirm MRP on label'}
            </p>
            <p
              className={`mt-0.5 text-[11px] ${
                isMultiMrp ? 'text-[var(--content-warning-on-light)]/70' : 'text-white/45'
              }`}
            >
              {isMultiMrp
                ? `${mrpHistory.map((h) => `₹${Math.round(h.mrp)}`).join(' · ')} — tap to confirm which`
                : latestMrp != null
                  ? `System shows ₹${Math.round(latestMrp)} — does label match?`
                  : 'Tap to enter MRP from label'}
            </p>
          </div>
          <span
            className={`text-xl ${isMultiMrp ? 'text-[var(--content-warning-on-light)]' : 'text-white/45'}`}
          >
            ›
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pt-3.5">
      <div className="mb-2.5 flex flex-wrap justify-center gap-1.5">
        <span className="rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--content-positive)]">
          ✅ Verified
        </span>
        {finalMrp != null && !mrpFlagged && (
          <span className="rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--content-positive)]">
            ✅ MRP confirmed
          </span>
        )}
        {mrpFlagged && (
          <span className="rounded-full border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--content-warning-on-light)]">
            ⚠ MRP mismatch flagged
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onDone}
        className={`w-full rounded-xl py-4 text-base font-extrabold text-white pick-pressable transition-colors ${
          confirming ? 'bg-[var(--bg-positive)]' : 'bg-[var(--bg-inverse-primary)]'
        }`}
      >
        {confirming ? '✓ Picked!' : outOfStock ? 'Mark out of stock' : `Done — ${dispQty} pcs`}
      </button>
      <button
        type="button"
        onClick={onFlag}
        className="mt-2 w-full py-2 text-xs font-semibold text-[var(--content-tertiary)] pick-pressable"
      >
        ⚑ Flag this item
      </button>
    </div>
  );
}
